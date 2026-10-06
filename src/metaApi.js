import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// Load .env.local first, then fall back to .env
if (fs.existsSync(path.join(projectRoot, ".env.local"))) {
  dotenv.config({ path: path.join(projectRoot, ".env.local") });
} else if (fs.existsSync(path.join(projectRoot, ".env"))) {
  dotenv.config({ path: path.join(projectRoot, ".env") });
} else {
  dotenv.config();
}

// Force Node.js CommonJS resolver to load the Node server bundle instead of web bundle
const require = createRequire(import.meta.url);
const MetaApi = require("metaapi.cloud-sdk").default || require("metaapi.cloud-sdk");

let apiInstance = null;
let accountInstance = null;
let connectionInstance = null;
let isInitialized = false;

/**
 * Singleton helper to initialize, deploy, and connect to MetaApi Cloud once.
 */
async function initializeMetaApi() {
  if (isInitialized && accountInstance && connectionInstance) {
    return { account: accountInstance, connection: connectionInstance };
  }

  const token = process.env.METAAPI_TOKEN?.trim();
  const accountId = process.env.METAAPI_ACCOUNT_ID?.trim();

  if (!token || !accountId) {
    console.error("❌ [MetaApi Error] Missing environment variables.");
    console.error(`- METAAPI_TOKEN present: ${!!token}`);
    console.error(`- METAAPI_ACCOUNT_ID present: ${!!accountId}`);
    throw new Error("Missing METAAPI_TOKEN or METAAPI_ACCOUNT_ID in environment variables.");
  }

  if (!apiInstance) {
    console.log("🔌 [MetaApi] Initializing MetaApi Cloud SDK...");
    apiInstance = new MetaApi(token);
  }

  if (!accountInstance) {
    console.log(`🔌 [MetaApi] Retrieving account (${accountId})...`);
    accountInstance = await apiInstance.metatraderAccountApi.getAccount(accountId);
  }

  if (accountInstance.state !== "DEPLOYED") {
    console.log(`🚀 [MetaApi] Account state is "${accountInstance.state}". Deploying account now...`);
    await accountInstance.deploy();
  }

  console.log("🔌 [MetaApi] Waiting for account connection to broker...");
  await accountInstance.waitConnected();

  if (!connectionInstance) {
    console.log("🔌 [MetaApi] Establishing RPC Connection...");
    connectionInstance = accountInstance.getRPCConnection();
    await connectionInstance.connect();
    console.log("🔌 [MetaApi] Synchronizing terminal state with IC Markets...");
    await connectionInstance.waitSynchronized();
    console.log("✅ [MetaApi] Connection fully synchronized and ready!");
  }

  isInitialized = true;
  return { account: accountInstance, connection: connectionInstance };
}

/**
 * Ensures account and RPC connection remain connected and synchronized.
 * Re-schedules synchronization if MetaApi WebSocket stream drops.
 */
async function ensureSynced() {
  const { account, connection } = await initializeMetaApi();

  try {
    if (account.state !== "DEPLOYED") {
      await account.deploy();
    }
    await account.waitConnected();

    if (!connection.isSynchronized) {
      console.log("🔄 [MetaApi] RPC connection desynchronized. Resynchronizing with broker...");
      await connection.waitSynchronized();
    }
  } catch (err) {
    console.warn(`⚠️ [MetaApi] Synchronization check failed: ${err.message}. Forcing reconnect...`);
    isInitialized = false;
    connectionInstance = null;
    return await initializeMetaApi();
  }

  return { account, connection };
}

/**
 * Map strategy timeframes to MetaApi granularity format
 */
export function getMetaApiTimeframe(tf) {
  const map = {
    "1H": "1h",
    "4H": "4h",
    "1D": "1d",
    "D": "1d",
    "1W": "1w",
    "W": "1w"
  };
  return map[tf] || tf.toLowerCase();
}

/**
 * Fetch historical candles from MetaApi Account API with connection retry guards.
 * Candles are reversed so index 0 is always the most recent candle.
 */
export async function getCandles(symbol, timeframe, count = 200, retries = 3) {
  const metaTf = getMetaApiTimeframe(timeframe);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { account } = await ensureSynced();

      console.log(`📥 [MetaApi] Fetching ${count} candles for ${symbol} (${metaTf})${attempt > 1 ? ` (Retry ${attempt}/${retries})` : ""}...`);
      const candles = await account.getHistoricalCandles(symbol, metaTf, undefined, count);

      if (!candles || candles.length === 0) {
        console.warn(`⚠️ [MetaApi] No candle data returned for ${symbol}`);
        return null;
      }

      return candles
        .slice()
        .reverse()
        .map((c) => ({
          time: new Date(c.time).getTime(),
          open: parseFloat(c.open),
          high: parseFloat(c.high),
          low: parseFloat(c.low),
          close: parseFloat(c.close)
        }));
    } catch (error) {
      console.error(`❌ [MetaApi] Error fetching candles for ${symbol} (${timeframe}) [Attempt ${attempt}/${retries}]:`, error.message || error);
      if (attempt === retries) return null;
      isInitialized = false;
      connectionInstance = null;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  return null;
}

/**
 * Fetch current account equity/balance from IC Markets via MetaApi.
 */
export async function getAccountBalance() {
  try {
    const { connection } = await ensureSynced();
    const info = await connection.getAccountInformation();
    const balance = parseFloat(info.equity || info.balance || 1000);
    console.log(`💰 [MetaApi] Connected Account Balance/Equity: $${balance.toFixed(2)}`);
    return balance;
  } catch (error) {
    console.error("❌ [MetaApi] Balance fetch error:", error.message || error);
    return 1000;
  }
}

/**
 * Fetch the current live bid/ask price for a symbol via MetaApi RPC.
 * Used by goldGuard spread validation in index.js.
 *
 * @param {string} symbol - Trading symbol (e.g. "XAUUSD")
 * @returns {Promise<{bid: number, ask: number}|null>}
 */
export async function getSymbolPrice(symbol) {
  try {
    const { connection } = await ensureSynced();
    const priceInfo = await connection.getSymbolPrice(symbol);
    if (!priceInfo || !priceInfo.bid || !priceInfo.ask) return null;
    return { bid: parseFloat(priceInfo.bid), ask: parseFloat(priceInfo.ask) };
  } catch (error) {
    console.error(`❌ [MetaApi] getSymbolPrice error for ${symbol}:`, error.message || error);
    return null;
  }
}

/**
 * Execute a market order on IC Markets MT5 via MetaApi RPC.
 */
export async function placeOrder({ symbol, amount, side, sl, tp }) {
  try {
    const { connection } = await ensureSynced();
    const priceInfo = await connection.getSymbolPrice(symbol);

    if (!priceInfo || !priceInfo.ask || !priceInfo.bid) {
      throw new Error(`Could not retrieve live market quote for ${symbol}`);
    }

    const isBuy = side.toLowerCase() === "buy";
    const entryPrice = isBuy ? priceInfo.ask : priceInfo.bid;
    const slDistance = Math.abs(entryPrice - sl);

    if (slDistance === 0) {
      throw new Error("Invalid Stop Loss distance (cannot be zero).");
    }

    // Convert risk dollar amount into MT5 lot volume (0.01 lot min)
    let riskPerLot = slDistance * 100000;
    if (symbol.includes("JPY")) {
      riskPerLot = (slDistance / entryPrice) * 100000;
    }

    let volume = amount / riskPerLot;
    volume = Math.max(0.01, Math.round(volume * 100) / 100);

    console.log(`🎯 [MetaApi] Placing ${side.toUpperCase()} on ${symbol} | Lot Size: ${volume} | Entry: ${entryPrice} | SL: ${sl} | TP: ${tp}`);

    let result;
    const options = { comment: "normal-bot order" };

    if (isBuy) {
      result = await connection.createMarketBuyOrder(symbol, volume, sl, tp, options);
    } else {
      result = await connection.createMarketSellOrder(symbol, volume, sl, tp, options);
    }

    return {
      contract_id: result.orderId || result.numericCode || "FILLED",
      volume,
      entryPrice
    };
  } catch (error) {
    console.error(`❌ [MetaApi] Order placement failed for ${symbol}:`, error.message || error);
    return null;
  }
}

/**
 * Fetch the list of currently open positions from the MT5 account via MetaApi RPC.
 * Used by the correlationGuard to evaluate live currency cluster exposure.
 *
 * @returns {Promise<Object[]>} - Array of open position objects from MetaApi.
 */
export async function getOpenPositions() {
  try {
    const { connection } = await ensureSynced();
    const positions = await connection.getPositions();
    return Array.isArray(positions) ? positions : [];
  } catch (error) {
    console.error("❌ [MetaApi] getOpenPositions error:", error.message || error);
    return [];
  }
}
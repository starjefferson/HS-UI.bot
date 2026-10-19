import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import dotenv from "dotenv";
import { formatSymbol } from "./utils/symbolHelper.js";

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
let initializationPromise = null;
let symbolsPromise = null;

/**
 * Singleton helper to initialize, deploy, and connect to MetaApi Cloud once.
 */
async function initializeMetaApi() {
  if (isInitialized && accountInstance && connectionInstance) {
    return { account: accountInstance, connection: connectionInstance };
  }
  if (initializationPromise) return initializationPromise;

  const initialization = (async () => {
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
      console.log("🔌 [MetaApi] Synchronizing terminal state with HotForex...");
      await connectionInstance.waitSynchronized();
      console.log("✅ [MetaApi] Connection fully synchronized and ready!");
    }

    isInitialized = true;
    return { account: accountInstance, connection: connectionInstance };
  })();

  initializationPromise = initialization
    .catch(async (error) => {
      isInitialized = false;
      if (connectionInstance) {
        try {
          await connectionInstance.close?.();
        } catch (closeError) {
          console.warn(`⚠️ [MetaApi] Failed to close incomplete RPC connection: ${closeError.message || closeError}`);
        }
        connectionInstance = null;
      }
      throw error;
    })
    .finally(() => {
      initializationPromise = null;
    });
  return initializationPromise;
}

/**
 * Ensures account and RPC connection remain connected and synchronized.
 */
async function ensureSynced() {
  const { account, connection } = await initializeMetaApi();

  try {
    if (account.state !== "DEPLOYED") {
      await account.deploy();
    }
    await account.waitConnected();

    // isSynchronized can be a boolean property or a getter depending on
    // connection type — guard against non-boolean falsy values (undefined/null).
    const synced = typeof connection.isSynchronized === "function"
      ? connection.isSynchronized()
      : connection.isSynchronized;

    if (synced === false) {
      console.log("🔄 [MetaApi] RPC connection desynchronized. Resynchronizing with broker...");
      await connection.waitSynchronized();
    }
  } catch (err) {
    console.warn(`⚠️ [MetaApi] Synchronization check failed: ${err.message}. Forcing reconnect...`);
    await safeReconnect();
    return { account: accountInstance, connection: connectionInstance };
  }

  return { account, connection };
}

/**
 * Verifies that the account connection is active before starting a symbol scan.
 */
export async function ensureMetaApiConnection() {
  const { account, connection } = await ensureSynced();
  const isConnectionActive = typeof account.isConnectionActive === "function"
    ? await account.isConnectionActive()
    : account.isConnectionActive;
  const isSynchronized = typeof connection.isSynchronized === "function"
    ? connection.isSynchronized()
    : connection.isSynchronized;

  if (isConnectionActive === false || isSynchronized === false) {
    console.warn("🔄 [MetaApi] Account connection is inactive. Waiting for reconnection...");
    await account.waitConnected();
    await connection.waitSynchronized();
  }
}

/**
 * Map strategy timeframes to MetaApi granularity format
 */
export function getMetaApiTimeframe(tf) {
  const map = {
    "15m": "15m",
    "1H": "1h",
    "4H": "4h",
    "1D": "1d",
    "D": "1d",
    "1W": "1w",
    "W": "1w"
  };
  return map[tf] || tf.toLowerCase();
}

// Serialized reconnect lock — prevents multiple concurrent candle fetches from
// each tearing down and rebuilding the MetaApi connection simultaneously, which
// was the root cause of the subscription TimeoutError crash loop.
let reconnectPromise = null;

async function safeReconnect() {
  if (reconnectPromise) return reconnectPromise;
  reconnectPromise = (async () => {
    try {
      console.log("🔄 [MetaApi] Reconnecting to broker (serialized)...");
      // Only reset the connection layer; the api/account instances stay alive.
      if (connectionInstance) {
        try {
          await connectionInstance.close?.();
        } catch (error) {
          console.warn(`⚠️ [MetaApi] Error closing stale RPC connection: ${error.message || error}`);
        }
      }
      connectionInstance = null;
      isInitialized = false;
      await initializeMetaApi();
      console.log("✅ [MetaApi] Reconnection complete.");
    } finally {
      reconnectPromise = null;
    }
  })();
  return reconnectPromise;
}

/**
 * Fetch historical candles from MetaApi Account API with connection retry guards.
 * Candles are reversed so index 0 is always the most recent candle.
 */
export async function getCandles(symbol, timeframe, count = 200, retries = 3) {
  const metaTf = getMetaApiTimeframe(timeframe);
  const brokerSymbol = formatSymbol(symbol);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { account } = await ensureSynced();

      console.log(`📥 [MetaApi] Fetching ${count} candles for ${brokerSymbol} (${metaTf})${attempt > 1 ? ` (Retry ${attempt}/${retries})` : ""}...`);
      const candles = await account.getHistoricalCandles(brokerSymbol, metaTf, undefined, count);

      if (!candles || candles.length === 0) {
        console.warn(`⚠️ [MetaApi] No candle data returned for ${brokerSymbol}`);
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
      console.error(`❌ [MetaApi] Error fetching candles for ${brokerSymbol} (${timeframe}) [Attempt ${attempt}/${retries}]:`, error.message || error);
      if (attempt === retries) return null;
      // Serialized reconnect — safe even when many candle fetches run concurrently.
      await safeReconnect();
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  return null;
}

/**
 * Fetch current account equity/balance from HotForex via MetaApi.
 */
export async function getAccountBalance() {
  try {
    const { connection } = await ensureSynced();
    const info = await connection.getAccountInformation();
    const balance = Number(info?.equity ?? info?.balance);
    if (!Number.isFinite(balance) || balance <= 0) {
      throw new Error("MetaApi returned an invalid account equity/balance.");
    }
    console.log(`💰 [MetaApi] Connected Account Balance/Equity: ${info.currency} ${balance.toFixed(2)}`);
    return balance;
  } catch (error) {
    console.error("❌ [MetaApi] Balance fetch error:", error.message || error);
    throw error;
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
  const brokerSymbol = formatSymbol(symbol);
  try {
    const { connection } = await ensureSynced();
    const priceInfo = await connection.getSymbolPrice(brokerSymbol);
    if (!priceInfo || !priceInfo.bid || !priceInfo.ask) return null;
    return { bid: parseFloat(priceInfo.bid), ask: parseFloat(priceInfo.ask) };
  } catch (error) {
    console.error(`❌ [MetaApi] getSymbolPrice error for ${brokerSymbol}:`, error.message || error);
    return null;
  }
}

/**
 * Execute a market order on HotForex MT5 via MetaApi RPC.
 */
export async function placeOrder({ symbol, amount, side, sl, tp, minimumRR }) {
  const brokerSymbol = formatSymbol(symbol);
  try {
    const { connection } = await ensureSynced();
    if (side !== "buy" && side !== "sell") {
      throw new Error(`Invalid order side "${side}" for ${brokerSymbol}.`);
    }
    const [priceInfo, specification, accountInfo] = await Promise.all([
      connection.getSymbolPrice(brokerSymbol),
      connection.getSymbolSpecification(brokerSymbol),
      connection.getAccountInformation()
    ]);

    if (!priceInfo || !priceInfo.ask || !priceInfo.bid) {
      throw new Error(`Could not retrieve live market quote for ${brokerSymbol}`);
    }

    const isBuy = side.toLowerCase() === "buy";
    const entryPrice = isBuy ? priceInfo.ask : priceInfo.bid;
    const slDistance = isBuy ? entryPrice - sl : sl - entryPrice;
    const rewardDistance = isBuy ? tp - entryPrice : entryPrice - tp;

    if (!(slDistance > 0) || !(rewardDistance > 0) || !(amount > 0) || !Number.isFinite(amount)) {
      throw new Error("Invalid order risk geometry or non-positive risk budget.");
    }

    const liveRR = rewardDistance / slDistance;
    if (Number.isFinite(minimumRR) && liveRR < minimumRR) {
      throw new Error(
        `Live quote reduces ${brokerSymbol} risk/reward to ${liveRR.toFixed(2)}, below minimum ${minimumRR}.`
      );
    }

    const profitCurrency = specification.profitCurrency;
    const accountCurrency = accountInfo.currency;
    const contractSize = specification.contractSize;
    if (!profitCurrency || !accountCurrency || !(contractSize > 0)) {
      throw new Error(`Missing contract or currency specification needed to size ${brokerSymbol} safely.`);
    }

    const currencyConversionRate = await getCurrencyConversionRate(
      connection,
      profitCurrency,
      accountCurrency
    );
    const riskPerLot = slDistance * contractSize * currencyConversionRate;
    if (!(riskPerLot > 0) || !Number.isFinite(riskPerLot)) {
      throw new Error(`Could not calculate per-lot risk for ${brokerSymbol}.`);
    }

    const rawVolume = amount / riskPerLot;
    const minimumVolume = specification.minVolume;
    const volumeStep = specification.volumeStep;
    if (!(minimumVolume > 0) || !(volumeStep > 0)) {
      throw new Error(`Missing minimum volume or volume step for ${brokerSymbol}.`);
    }
    const maxVolume = specification.maxVolume;
    const limitedVolume = Number.isFinite(maxVolume) ? Math.min(rawVolume, maxVolume) : rawVolume;
    const volume = Number(
      (Math.floor((limitedVolume + Number.EPSILON) / volumeStep) * volumeStep).toFixed(8)
    );
    if (volume < minimumVolume) {
      throw new Error(
        `Minimum ${minimumVolume} lot would exceed the ${accountCurrency} ${amount.toFixed(2)} risk budget for ${brokerSymbol}.`
      );
    }

    console.log(`🎯 [MetaApi] Placing ${side.toUpperCase()} on ${brokerSymbol} | Lot Size: ${volume} | Entry: ${entryPrice} | SL: ${sl} | TP: ${tp}`);

    let result;
    const options = { comment: "normal-bot order" };

    if (isBuy) {
      result = await connection.createMarketBuyOrder(brokerSymbol, volume, sl, tp, options);
    } else {
      result = await connection.createMarketSellOrder(brokerSymbol, volume, sl, tp, options);
    }

    return {
      contract_id: result.orderId || result.numericCode || "FILLED",
      volume,
      entryPrice
    };
  } catch (error) {
    console.error(`❌ [MetaApi] Order placement failed for ${brokerSymbol}:`, error.message || error);
    return null;
  }
}

async function getCurrencyConversionRate(connection, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return 1;

  if (!symbolsPromise) symbolsPromise = connection.getSymbols();
  let symbols;
  try {
    symbols = await symbolsPromise;
  } catch (error) {
    symbolsPromise = null;
    throw new Error(
      `Could not retrieve symbols for ${fromCurrency}/${toCurrency} risk conversion: ${error.message || error}`
    );
  }

  const normalized = (symbol) => symbol.toUpperCase().replace(/[^A-Z]/g, "");
  const directPair = `${fromCurrency}${toCurrency}`;
  const directSymbol = symbols.find(symbol => normalized(symbol).includes(directPair));
  if (directSymbol) {
    const price = await connection.getSymbolPrice(directSymbol);
    if (Number.isFinite(price.ask) && price.ask > 0) return price.ask;
  }

  const inversePair = `${toCurrency}${fromCurrency}`;
  const inverseSymbol = symbols.find(symbol => normalized(symbol).includes(inversePair));
  if (inverseSymbol) {
    const price = await connection.getSymbolPrice(inverseSymbol);
    if (Number.isFinite(price.bid) && price.bid > 0) return 1 / price.bid;
  }

  throw new Error(
    `No live ${fromCurrency}/${toCurrency} conversion quote is available; refusing unsafe position sizing.`
  );
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

/**
 * Fetch open positions for hard execution limits; unlike getOpenPositions,
 * account/query failures are propagated so callers can fail closed.
 */
export async function getOpenPositionsForSafety() {
  const { connection } = await ensureSynced();
  const positions = await connection.getPositions();
  if (!Array.isArray(positions)) {
    throw new Error("MetaApi returned an invalid open positions response.");
  }
  return positions;
}
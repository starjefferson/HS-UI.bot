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
let connectionInstance = null;

/**
 * Singleton helper to initialize and synchronize an RPC connection to MetaApi Cloud.
 */
async function getConnection() {
  if (connectionInstance) return connectionInstance;

  const token = process.env.METAAPI_TOKEN?.trim();
  const accountId = process.env.METAAPI_ACCOUNT_ID?.trim();

  if (!token || !accountId) {
    throw new Error("Missing METAAPI_TOKEN or METAAPI_ACCOUNT_ID in environment variables.");
  }

  if (!apiInstance) {
    apiInstance = new MetaApi(token);
  }

  const account = await apiInstance.metatraderAccountApi.getAccount(accountId);
  await account.waitConnected();

  connectionInstance = account.getRPCConnection();
  await connectionInstance.connect();
  await connectionInstance.waitSynchronized();

  return connectionInstance;
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
 * Fetch historical candles from MetaApi RPC.
 * Candles are reversed so index 0 is always the most recent candle.
 */
export async function getCandles(symbol, timeframe, count = 200) {
  try {
    const conn = await getConnection();
    const metaTf = getMetaApiTimeframe(timeframe);

    const candles = await conn.getHistoricalCandles(symbol, metaTf, undefined, count);

    if (!candles || candles.length === 0) return null;

    // MetaApi returns candles chronologically (oldest at index 0).
    // Reversing ensures index 0 = most recent candle (preserving engine behavior).
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
    console.error(`❌ [MetaApi] Error fetching candles for ${symbol} (${timeframe}):`, error.message || error);
    return null;
  }
}

/**
 * Fetch current account equity/balance from IC Markets via MetaApi.
 */
export async function getAccountBalance() {
  try {
    const conn = await getConnection();
    const info = await conn.getAccountInformation();
    return parseFloat(info.equity || info.balance || 1000);
  } catch (error) {
    console.error("❌ [MetaApi] Balance fetch error:", error.message || error);
    return 1000;
  }
}

/**
 * Execute a market order on IC Markets MT5 via MetaApi RPC.
 */
export async function placeOrder({ symbol, amount, side, sl, tp }) {
  try {
    const conn = await getConnection();
    const priceInfo = await conn.getSymbolPrice(symbol);

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
      result = await conn.createMarketBuyOrder(symbol, volume, sl, tp, options);
    } else {
      result = await conn.createMarketSellOrder(symbol, volume, sl, tp, options);
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
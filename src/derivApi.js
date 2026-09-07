import WebSocket from "ws";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const APP_ID = process.env.DERIV_APP_ID || "1089";
const API_TOKEN = process.env.DERIV_API_TOKEN;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

/**
 * Universal WebSocket helper for sending requests to Deriv API
 */
function sendWsRequest(requestPayload) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);

    ws.on("open", () => {
      ws.send(JSON.stringify(requestPayload));
    });

    ws.on("message", (data) => {
      const response = JSON.parse(data.toString());
      ws.close();

      if (response.error) {
        reject(response.error);
      } else {
        resolve(response);
      }
    });

    ws.on("error", (err) => reject(err));
  });
}

/**
 * Convert standard symbol format (e.g. EURUSD or EUR_USD) to Deriv format (e.g. frxEURUSD)
 */
export function formatSymbolForDeriv(symbol) {
  const clean = symbol.replace("_", "").toUpperCase();
  return clean.startsWith("FRX") ? clean : `frx${clean}`;
}

/**
 * Map strategy timeframes to Deriv granularity in seconds
 */
export function getDerivGranularity(tf) {
  const map = {
    "1H": 3600,
    "4H": 14400,
    "1D": 86400,
    "D": 86400,
    "1W": 604800,
    "W": 604800
  };
  return map[tf] || 3600;
}

/**
 * Fetch historical candles from Deriv WebSocket API
 */
export async function getCandles(symbol, timeframe, count = 200) {
  try {
    const derivSymbol = formatSymbolForDeriv(symbol);
    const granularity = getDerivGranularity(timeframe);

    const payload = {
      ticks_history: derivSymbol,
      adjust_start_time: 1,
      count: count,
      end: "latest",
      style: "candles",
      granularity: granularity
    };

    const res = await sendWsRequest(payload);

    if (!res.candles || res.candles.length === 0) return null;

    // Convert candle structure and reverse so index 0 is the most recent candle
    return res.candles.map(c => ({
      time: c.epoch * 1000,
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close)
    })).reverse();
  } catch (error) {
    console.error(`❌ [Deriv API] Error fetching candles for ${symbol} (${timeframe}):`, error.message || error);
    return null;
  }
}

/**
 * Fetch current account balance from Deriv
 */
export async function getAccountBalance() {
  try {
    if (!API_TOKEN) return 1000;

    const res = await sendWsRequest({ authorize: API_TOKEN });
    return parseFloat(res.authorize.balance);
  } catch (error) {
    console.error("❌ [Deriv API] Balance fetch error:", error.message || error);
    return 1000;
  }
}

/**
 * Execute order via Deriv WebSocket API
 */
export async function placeOrder({ symbol, amount, side, sl, tp }) {
  try {
    if (!API_TOKEN) throw new Error("DERIV_API_TOKEN is missing in .env.local");

    const derivSymbol = formatSymbolForDeriv(symbol);
    const contractType = side.toLowerCase() === "buy" ? "MULTUP" : "MULTDOWN";

    // 1. Request trade proposal from Deriv
    const proposalPayload = {
      authorize: API_TOKEN,
      proposal: 1,
      amount: amount,
      basis: "stake",
      contract_type: contractType,
      currency: "USD",
      symbol: derivSymbol,
      multiplier: 100,
      limit_order: {
        take_profit: parseFloat(tp.toFixed(5)),
        stop_loss: parseFloat(sl.toFixed(5))
      }
    };

    const proposalRes = await sendWsRequest(proposalPayload);

    if (!proposalRes.proposal) throw new Error("Proposal generation failed");

    // 2. Buy contract using proposal ID
    const buyRes = await sendWsRequest({
      buy: proposalRes.proposal.id,
      price: amount
    });

    return buyRes.buy;
  } catch (error) {
    console.error(`❌ [Deriv API] Order placement failed for ${symbol}:`, error.message || error);
    return null;
  }
}
import WebSocket from "ws";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const APP_ID = process.env.DERIV_APP_ID || "1089";
const API_TOKEN = process.env.DERIV_API_TOKEN;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

/**
 * Send a single request on a new WebSocket connection.
 * Opens → sends → waits for one response → closes.
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
 * Send a sequence of requests on a single persistent WebSocket connection.
 * Each message is sent only after the previous response is received.
 * The connection closes after the final response.
 * Returns an array of all responses in order.
 */
function sendWsSequence(requests) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const results = [];
    let step = 0;

    ws.on("open", () => {
      ws.send(JSON.stringify(requests[0]));
    });

    ws.on("message", (data) => {
      const response = JSON.parse(data.toString());

      if (response.error) {
        ws.close();
        reject(response.error);
        return;
      }

      results.push(response);
      step++;

      if (step < requests.length) {
        // Send the next request in the sequence
        ws.send(JSON.stringify(requests[step]));
      } else {
        // All requests complete — close and resolve
        ws.close();
        resolve(results);
      }
    });

    ws.on("error", (err) => {
      ws.close();
      reject(err);
    });
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
 * Fetch historical candles from Deriv WebSocket API.
 * Candles are reversed so index 0 is always the most recent.
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

    // Reverse so index 0 = most recent candle
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
 * Fetch current account balance from Deriv.
 * Returns 1000 as a safe fallback if the token is missing or the call fails.
 */
export async function getAccountBalance() {
  try {
    if (!API_TOKEN) {
      console.warn("⚠️ [Deriv API] DERIV_API_TOKEN not set. Using fallback balance of 1000.");
      return 1000;
    }

    const res = await sendWsRequest({ authorize: API_TOKEN });
    return parseFloat(res.authorize.balance);
  } catch (error) {
    console.error("❌ [Deriv API] Balance fetch error:", error.message || error);
    return 1000;
  }
}

/**
 * Execute a multiplier contract via Deriv WebSocket API.
 *
 * Correct 3-step flow on a single authenticated connection:
 *   1. authorize  → authenticates the session
 *   2. proposal   → requests a contract quote and proposal ID
 *   3. buy        → buys the proposal using the returned proposal ID
 */
export async function placeOrder({ symbol, amount, side, sl, tp }) {
  try {
    if (!API_TOKEN) throw new Error("DERIV_API_TOKEN is missing in .env.local");

    const derivSymbol = formatSymbolForDeriv(symbol);
    const contractType = side.toLowerCase() === "buy" ? "MULTUP" : "MULTDOWN";

    // Step 1 — Authorize the session
    const authRes = await sendWsRequest({ authorize: API_TOKEN });
    if (!authRes.authorize) throw new Error("Deriv authorization failed");

    // Step 2 — Request a contract proposal on a fresh authenticated connection
    const proposalRes = await sendWsRequest({
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
    });

    if (!proposalRes.proposal) throw new Error("Deriv proposal generation failed");
    const proposalId = proposalRes.proposal.id;

    // Step 3 — Buy the contract using the proposal ID
    const buyRes = await sendWsRequest({
      buy: proposalId,
      price: amount
    });

    if (!buyRes.buy) throw new Error("Deriv buy response missing contract data");
    return buyRes.buy;
  } catch (error) {
    console.error(`❌ [Deriv API] Order placement failed for ${symbol}:`, error.message || error);
    return null;
  }
}
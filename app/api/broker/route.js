import fs from "fs";
import path from "path";
import { runBot } from "@/botEngine/engine.js";
import { getBalance, placeOrder } from "@/executionModule/brokerConnector.js";

// Persistent files
const logPath = path.resolve("./closedTrades.json");       // trade history from your bot
const signalPath = path.resolve("./latestSignal.json");    // last signal for EA polling

// Helpers
function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error("JSON read error:", e);
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error("JSON write error:", e);
    return false;    
  }
}

// Format a trade object into EA-consumable signal
function tradeToSignal(trade) {
  if (!trade) return null;

  const action = trade.action || (trade.direction ? trade.direction : null);
  const symbol = trade.pair || trade.symbol || null;
  const sl = trade.sl ?? null;
  const tp = trade.tp ?? null;
  const lot = trade.lot ?? 0.1;

  if (!action || !symbol || sl === null || tp === null) return null;

  return { action, symbol, sl, tp, lot };
}

// GET handler: multiplexed by ?type=balance|open|trades|execute
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    // 1) Live balance
    if (type === "balance") {
      try {
        const balance = await getBalance();
        return Response.json({ balance });
      } catch (err) {
        console.error("Balance fetch failed:", err);
        return Response.json({ balance: 0 });
      }
    }

    // 2) Last open trade
    if (type === "open") {
      const trades = readJsonSafe(logPath, []);
      const lastTrade = trades.length ? trades[trades.length - 1] : null;
      return Response.json(lastTrade || { pair: null });
    }

    // 3) Total trades count
    if (type === "trades") {
      const trades = readJsonSafe(logPath, []);
      return Response.json({ totalTrades: trades.length });
    }

    // 4) EA polling endpoint
    if (type === "execute") {
      const persistedSignal = readJsonSafe(signalPath, null);
      if (persistedSignal) return Response.json(persistedSignal);

      const trades = readJsonSafe(logPath, []);
      const lastTrade = trades.length ? trades[trades.length - 1] : null;
      const signal = tradeToSignal(lastTrade);
      return Response.json(signal || {});
    }

    return Response.json({ error: "Invalid type" }, { status: 400 });
  } catch (err) {
    console.error("GET /api/broker error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}

// POST handler
export async function POST(request) {
  try {
    const body = await request.json();
    const action = body?.action;

    // 1) Run bot
    if (action === "runBot") {
      const candleData = body?.candleData ?? null;
      const result = await runBot(candleData);

      const trades = readJsonSafe(logPath, []);
      const lastTrade = trades.length ? trades[trades.length - 1] : null;
      const signal = tradeToSignal(lastTrade);

      if (signal) writeJsonSafe(signalPath, signal);

      return Response.json({
        status: "Bot executed",
        signal: signal || null,
        result: result ?? null,
      });
    }

    // 2) Manually set signal
    if (action === "setSignal") {
      const signal = tradeToSignal(body);
      if (!signal) {
        return Response.json({ error: "Invalid signal payload" }, { status: 400 });
      }
      writeJsonSafe(signalPath, signal);
      return Response.json({ status: "Signal set", signal });
    }

    // 3) Execute order
    if (action === "executeOrder") {
      const signal = tradeToSignal(body);
      if (!signal) {
        return Response.json({ error: "Invalid order payload" }, { status: 400 });
      }
      try {
        const execRes = await placeOrder(signal);
        return Response.json({ status: "Order executed", execRes });
      } catch (err) {
        console.error("Order execution failed:", err);
        return Response.json({ error: "Execution failed" }, { status: 500 });
      }
    }

    return Response.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/broker error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
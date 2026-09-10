/**
 * Next.js API Route: /api/broker
 *
 * Serves live data to the Dashboard UI.
 * Architecture: Direct Deriv API — reads history.json for trade records,
 * calls derivApi.js for live balance and order placement.
 *
 * GET  ?type=balance    → Live account balance from Deriv
 * GET  ?type=open       → Last recorded trade from history.json
 * GET  ?type=trades     → Total trade count from history.json
 * GET  ?type=history    → Full trade history array
 * POST action=execute   → Manually place an order via Deriv API
 */

import fs from "fs";
import path from "path";
import { getAccountBalance, placeOrder } from "@/metaApi.js";

// Persistent trade history written by the bot engine (index.js)
const HISTORY_PATH = path.resolve("./history.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readHistory() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    const raw = fs.readFileSync(HISTORY_PATH, "utf-8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("[/api/broker] Failed to read history.json:", e.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET Handler
// ---------------------------------------------------------------------------

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    // 1) Live balance from Deriv
    if (type === "balance") {
      const balance = await getAccountBalance();
      return Response.json({ balance });
    }

    // 2) Most recent trade entry (last item in history.json)
    if (type === "open") {
      const trades = readHistory();
      const lastTrade = trades.length ? trades[trades.length - 1] : null;
      return Response.json(lastTrade || { symbol: null });
    }

    // 3) Total trade count
    if (type === "trades") {
      const trades = readHistory();
      return Response.json({ totalTrades: trades.length });
    }

    // 4) Full trade history (for a history table / widget)
    if (type === "history") {
      const trades = readHistory();
      return Response.json({ trades });
    }

    return Response.json({ error: "Invalid type. Use: balance | open | trades | history" }, { status: 400 });
  } catch (err) {
    console.error("GET /api/broker error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST Handler
// ---------------------------------------------------------------------------

export async function POST(request) {
  try {
    const body = await request.json();
    const action = body?.action;

    // Manual order execution via UI
    if (action === "execute") {
      const { symbol, amount, side, sl, tp } = body;

      if (!symbol || !amount || !side || sl == null || tp == null) {
        return Response.json(
          { error: "Missing required fields: symbol, amount, side, sl, tp" },
          { status: 400 }
        );
      }

      const result = await placeOrder({ symbol, amount, side, sl, tp });

      if (!result) {
        return Response.json({ error: "Order placement failed. Check bot logs." }, { status: 500 });
      }

      return Response.json({ status: "Order executed", result });
    }

    return Response.json({ error: "Invalid action. Use: execute" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/broker error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
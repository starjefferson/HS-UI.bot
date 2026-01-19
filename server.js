// server.js
// -------------------------------------------------------------
// Purpose:
// - Expose endpoints for your MT5 EA to poll trade signals,
//   check balance, and place manual orders.
// - Restrict trading to major forex pairs only.
// - Return consistently valid JSON to avoid parsing errors.
// -------------------------------------------------------------

import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Import your broker connector functions (you already have these)
import { executeTrade, getBalance, placeOrder } from "./src/executionModule/brokerConnector.js";

// -------------------------------------------------------------
// Setup: resolve __dirname for ES modules
// -------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------------------------------------------------
// App and port
// -------------------------------------------------------------
const app = express();
const PORT = 3001;

// -------------------------------------------------------------
// Middleware: parse JSON bodies safely
// - bodyParser.json() ensures req.body is already an object.
// - Do NOT call JSON.parse(req.body) later—it's already parsed.
// -------------------------------------------------------------
app.use(bodyParser.json());

// -------------------------------------------------------------
// File path for signals/logs
// - This file is expected to contain an array of trade objects.
// - Example object:
//   { "type":"buy", "pair":"EURUSD", "sl":1.0920, "tp":1.1010, "lot":0.1 }
// -------------------------------------------------------------
const logPath = path.resolve(__dirname, "./closedTrades.json");

// -------------------------------------------------------------
// Whitelist: major forex pairs only
// - The EA should only trade these pairs.
// -------------------------------------------------------------
const MAJOR_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD"];

// -------------------------------------------------------------
// Helper: safe JSON file read
// - Returns [] if file missing or invalid.
// -------------------------------------------------------------
function readTradesFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw || raw.trim() === "") return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to read/parse trades file:", err);
    return [];
  }
}

// -------------------------------------------------------------
// GET /execute
// - EA polls this endpoint for the latest signal.
// - We return a consistent JSON shape:
//   { action, symbol, sl, tp, lot } or { action: null }
// - We filter to major pairs only.
// -------------------------------------------------------------
app.get("/execute", async (req, res) => {
  try {
    const trades = readTradesFileSafe(logPath);
    const lastTrade = trades.length ? trades[trades.length - 1] : null;

    if (
      lastTrade &&
      lastTrade.type &&
      lastTrade.pair &&
      MAJOR_PAIRS.includes(lastTrade.pair)
    ) {
      return res.json({
        action: lastTrade.type,   // "buy" or "sell"
        symbol: lastTrade.pair,   // e.g. "USDJPY"
        sl: Number(lastTrade.sl),
        tp: Number(lastTrade.tp),
        lot: Number(lastTrade.lot) || 0.1,
      });
    }

    // No signal → return EMPTY payload
    return res.json({});
  } catch (err) {
    console.error("Error in /execute:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------------------------------------------------
// GET /balance
// - Returns account balance from your broker connector.
// - Always returns a numeric balance (0 on error).
// -------------------------------------------------------------
app.get("/balance", async (req, res) => {
  try {
    const balance = await getBalance();
    res.json({ balance: Number(balance) || 0 });
  } catch (err) {
    console.error("Error in /balance:", err);
    res.status(500).json({ balance: 0 });
  }
});

// -------------------------------------------------------------
// POST /order
// - Accepts a manual order request from external tools or EA.
// - Validates body and forwards to placeOrder().
// - Example body:
//   { "action":"buy", "symbol":"EURUSD", "sl":1.0920, "tp":1.1010, "lot":0.1 }
// -------------------------------------------------------------
app.post("/order", async (req, res) => {
  try {
    // Validate presence of body
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: "Empty JSON body" });
    }

    const { action, symbol, sl, tp, lot } = req.body;

    // Validate required fields
    if (!action || !symbol) {
      return res.status(400).json({ error: "Missing required fields: action or symbol" });
    }

    // Enforce major pairs only
    if (!MAJOR_PAIRS.includes(symbol)) {
      return res.status(400).json({ error: `Symbol ${symbol} is not a major pair` });
    }

    // Log for debugging
    console.log("Incoming order:", req.body);

    // Forward to your broker connector
    const result = await placeOrder({
      action: String(action).toLowerCase(), // normalize
      symbol,
      sl: Number(sl) || 0,
      tp: Number(tp) || 0,
      lot: Number(lot) || 0.1,
    });

    res.json({ status: "Order executed", result });
  } catch (err) {
    console.error("Error in /order:", err);
    res.status(500).json({ error: "Execution failed" });
  }
});

// -------------------------------------------------------------
// Start server
// -------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Broker server running on http://127.0.0.1:${PORT}`);
});
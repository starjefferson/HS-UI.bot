import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import { executeTrade, getBalance, placeOrder } from "./src/executionModule/brokerConnector.js";

const app = express();
const PORT = 3001;

app.use(bodyParser.json());

const logPath = path.resolve("./closedTrades.json");

// ✅ EA polling endpoint
app.get("/execute", async (req, res) => {
  try {
    if (fs.existsSync(logPath)) {
      const trades = JSON.parse(fs.readFileSync(logPath, "utf-8"));
      const lastTrade = trades[trades.length - 1];
      if (lastTrade) {
        const signal = {
          action: lastTrade.type,
          symbol: lastTrade.pair,
          sl: lastTrade.sl,
          tp: lastTrade.tp,
          lot: lastTrade.lot || 0.1,
        };
        return res.json(signal);
      }
    }
    return res.json({});
  } catch (err) {
    console.error("Error in /execute:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Balance endpoint
app.get("/balance", async (req, res) => {
  try {
    const balance = await getBalance();
    res.json({ balance });
  } catch (err) {
    console.error("Error in /balance:", err);
    res.status(500).json({ balance: 0 });
  }
});

// ✅ Manual order execution (optional)
app.post("/order", async (req, res) => {
  try {
    const signal = req.body;
    const result = await placeOrder(signal);
    res.json({ status: "Order executed", result });
  } catch (err) {
    console.error("Error in /order:", err);
    res.status(500).json({ error: "Execution failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Broker server running on http://127.0.0.1:${PORT}`);
});
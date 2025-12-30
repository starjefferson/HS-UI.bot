import { runBot } from "@/botEngine/engine.js";
import fs from "fs";

export default async function handler(req, res) {
  try {
    // Later this will be replaced with real TradingView candle fetch
    const candleData = JSON.parse(fs.readFileSync("closedTrades.json"));
    await runBot(candleData);
    return res.status(200).json({ status: "ok", message: "Bot executed" });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
}

/**
 * BROKER API CONNECTOR (HotForex → MT5 Terminal)
 * This module sends trade instructions from your JS bot to MT5 using local files.
 * Later, you can replace file-based execution with a real API bridge (eg. MetaApi, DXTrade, or MT5 Manager API).
 */

import fs from "fs";
import path from "path";

// Location where trade instructions will be written for MT5 to read
const TRADE_SIGNAL_PATH = path.join(process.cwd(), "trade-signals");

// Ensure folder exists
if (!fs.existsSync(TRADE_SIGNAL_PATH)) {
  fs.mkdirSync(TRADE_SIGNAL_PATH, { recursive: true });
}

/**
 * Send a trade execution request to MT5
 * @param {Object} trade - trade details from bot
 */
export async function executeTrade(trade) {
  /**
   * trade object contains:
   *  - pair (string) eg "EURUSD"
   *  - direction ("buy"|"sell")
   *  - entry (number)
   *  - stopLoss (number)
   *  - takeProfit (number)
   *  - lotSize (number)
   *  - reason (string) explanation of pattern
   */

  const fileName = `${trade.pair}-${Date.now()}.json`;
  const filePath = path.join(TRADE_SIGNAL_PATH, fileName);

  // Write trade signal file for MT5 EA to read later
  fs.writeFileSync(filePath, JSON.stringify(trade, null, 2));

  console.log(`[TRADE SENT TO MT5]:`, trade);
  return true;
}

/**
 * Fetch account balance from MT5
 * CURRENT METHOD: Reads MT5 Journal log file to extract balance.
 * LATER UPGRADE: Replace with broker API fetch.
 */
export function getAccountBalance() {
  try {
    const journalPath = path.join(
      process.env.APPDATA,
      "MetaQuotes",
      "Terminal",
      "Common",
      "Files",
      "balance.json"
    );

    if (fs.existsSync(journalPath)) {
      const data = JSON.parse(fs.readFileSync(journalPath, "utf8"));
      return data.balance;
    }
  } catch (err) {
    console.log("Balance read error:", err);
  }
  return null; // null means not available yet
}

/**
 * Check if a trade is already open
 * CURRENT METHOD: Reads file updated by MT5 EA.
 */
export function getOpenTrade() {
  const openTradePath = path.join(TRADE_SIGNAL_PATH, "open-trade.json");
  if (fs.existsSync(openTradePath)) {
    return JSON.parse(fs.readFileSync(openTradePath, "utf8"));
  }
  return null;
}

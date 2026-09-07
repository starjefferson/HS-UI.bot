import fs from "fs";
import path from "path";
import { config } from "../../config.js";

const logPath = path.resolve("./history.json");

/**
 * Validates if a new trade can be taken based on weekly limits and cooldown rules
 */
export function canTrade() {
  if (!fs.existsSync(logPath)) return true;

  try {
    const fileContent = fs.readFileSync(logPath, "utf-8");
    if (!fileContent.trim()) return true;

    const trades = JSON.parse(fileContent);
    if (!Array.isArray(trades) || trades.length === 0) return true;

    const now = new Date();

    // 1. Check maximum trades taken in the current week
    const weekTrades = trades.filter(t => {
      const rawDate = t.executionTime || t.closedAt || t.timestamp;
      if (!rawDate) return false;
      const tDate = new Date(rawDate);
      return (
        getWeekNumber(tDate) === getWeekNumber(now) &&
        tDate.getFullYear() === now.getFullYear()
      );
    });

    if (weekTrades.length >= config.maxTradesPerWeek) return false;

    // 2. Check minimum days cooldown since the last trade
    const lastTrade = trades[trades.length - 1];
    if (!lastTrade) return true;

    const lastRawDate = lastTrade.executionTime || lastTrade.closedAt || lastTrade.timestamp;
    if (!lastRawDate) return true;

    const lastDate = new Date(lastRawDate);
    const diffDays = (now - lastDate) / (1000 * 60 * 60 * 24);
    if (diffDays < config.minDaysBetweenTrades) return false;

    return true;
  } catch (e) {
    console.error("⚠️ [Risk Manager] Error reading trade log:", e.message);
    return true;
  }
}

export function riskCheck(trade) {
  return canTrade();
}

function getWeekNumber(d) {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}
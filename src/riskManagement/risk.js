import fs from "fs";
import path from "path";
import { config } from "../config.js";

const logPath = path.resolve("./closedTrades.json");

export function canTrade() {
  if (!fs.existsSync(logPath)) return true;

  const trades = JSON.parse(fs.readFileSync(logPath));
  const now = new Date();

  // Trades in current week
  const weekTrades = trades.filter(t => {
    const tDate = new Date(t.closedAt);
    return getWeekNumber(tDate) === getWeekNumber(now);
  });

  if (weekTrades.length >= config.maxTradesPerWeek) return false;

  // Last trade cooldown
  const lastTrade = trades[trades.length - 1];
  if (!lastTrade) return true;
  const lastDate = new Date(lastTrade.closedAt);
  const diffDays = (now - lastDate) / (1000*60*60*24);
  if (diffDays < config.minDaysBetweenTrades) return false;

  return true;
}

export function riskCheck(trade) {
  // For simplicity, risk check always true for demo
  return canTrade();
}

function getWeekNumber(d) {
  const date = new Date(d.getTime());
  date.setHours(0,0,0,0);
  date.setDate(date.getDate() + 4 - (date.getDay()||7));
  const yearStart = new Date(date.getFullYear(),0,1);
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1)/7);
  return weekNo;
}

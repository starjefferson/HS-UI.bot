import { detectPatterns } from "./headShoulders.js";
import { checkTopDownAlignment } from "./topDownAnalysis.js";
import { config } from "../../config.js";

export function runDetection(candleData, symbol) {
  // 1. Detect Pattern on the lowest provided timeframe (usually first in candleData)
  const mainTF = Object.keys(candleData)[0];
  const pattern = detectPatterns(candleData[mainTF]);
  if (!pattern) return null;

  // 2. Check Top-Down Alignment (1W, 1D, 4H, 1H)
  const trend = checkTopDownAlignment(candleData, config.topDownTFs);
  
  // 3. Filter: Only Sell H&S in Down-trend, Only Buy Inv H&S in Up-trend
  if (pattern.type === "sell" && trend !== "down") return null;
  if (pattern.type === "buy" && trend !== "up") return null;

  return {
    type: pattern.type,
    pair: symbol,
    sl: pattern.sl,
    tp: pattern.tp,
    patternType: pattern.label,
    timestamp: Date.now()
  };
}
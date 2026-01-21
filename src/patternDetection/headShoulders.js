import { config } from "../../config.js";

function getSwings(candles, lookback = 3) {
  const swings = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    if (high > Math.max(...candles.slice(i-lookback, i).map(c=>c.high)) && 
        high > Math.max(...candles.slice(i+1, i+lookback).map(c=>c.high))) {
      swings.push({ type: "high", index: i, value: high });
    }
    if (low < Math.min(...candles.slice(i-lookback, i).map(c=>c.low)) && 
        low < Math.min(...candles.slice(i+1, i+lookback).map(c=>c.low))) {
      swings.push({ type: "low", index: i, value: low });
    }
  }
  return swings;
}

export function detectPatterns(candles) {
  const swings = getSwings(candles);
  if (swings.length < 5) return null;

  const lastSwings = swings.slice(-5);
  const currentPrice = candles[0].close;

  // Detect Regular H&S (Sell)
  const highs = lastSwings.filter(s => s.type === "high");
  if (highs.length >= 3) {
    const [ls, head, rs] = highs.slice(-3);
    if (head.value > ls.value && head.value > rs.value) {
      const sl = rs.value + (Math.abs(head.value - rs.value) * 0.2); // Structural SL
      const risk = Math.abs(currentPrice - sl);
      const tp = currentPrice - (risk * config.rrRatio);
      return { type: "sell", sl, tp, label: "H&S" };
    }
  }

  // Detect Inverse H&S (Buy)
  const lows = lastSwings.filter(s => s.type === "low");
  if (lows.length >= 3) {
    const [ls, head, rs] = lows.slice(-3);
    if (head.value < ls.value && head.value < rs.value) {
      const sl = rs.value - (Math.abs(head.value - rs.value) * 0.2);
      const risk = Math.abs(currentPrice - sl);
      const tp = currentPrice + (risk * config.rrRatio);
      return { type: "buy", sl, tp, label: "Inverse H&S" };
    }
  }

  return null;
}
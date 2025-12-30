import { config } from "../config.js";

/**
 * Detect swing highs/lows
 */
function getSwings(candles) {
  const swings = [];
  for (let i = 1; i < candles.length - 1; i++) {
    if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high) {
      swings.push({ type: "high", index: i, value: candles[i].high });
    }
    if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low) {
      swings.push({ type: "low", index: i, value: candles[i].low });
    }
  }
  return swings;
}

/**
 * Detect Head & Shoulders pattern
 */
function detectHeadShoulders(swings) {
  for (let i = 0; i < swings.length - 4; i++) {
    const ls = swings[i];
    const head = swings[i + 1];
    const rs = swings[i + 2];
    if (
      ls.type === "high" &&
      head.type === "high" &&
      rs.type === "high" &&
      head.value > ls.value &&
      rs.value < head.value
    ) {
      const neckLow1 = swings[i + 0].index + 1 < swings.length ? swings[i + 1].value : null;
      const neckLow2 = swings[i + 1].index + 1 < swings.length ? swings[i + 2].value : null;
      const neckline = (neckLow1 + neckLow2) / 2;
      return { type: "H&S", LS: ls, Head: head, RS: rs, neckline, entryConfirmed: false };
    }
  }
  return null;
}

/**
 * Detect Inverse Head & Shoulders pattern
 */
function detectInverseHeadShoulders(swings) {
  for (let i = 0; i < swings.length - 4; i++) {
    const ls = swings[i];
    const head = swings[i + 1];
    const rs = swings[i + 2];
    if (
      ls.type === "low" &&
      head.type === "low" &&
      rs.type === "low" &&
      head.value < ls.value &&
      rs.value > head.value
    ) {
      const neckHigh1 = swings[i + 0].index + 1 < swings.length ? swings[i + 1].value : null;
      const neckHigh2 = swings[i + 1].index + 1 < swings.length ? swings[i + 2].value : null;
      const neckline = (neckHigh1 + neckHigh2) / 2;
      return { type: "Inverse H&S", LS: ls, Head: head, RS: rs, neckline, entryConfirmed: false };
    }
  }
  return null;
}

/**
 * Confirm neckline retest and set fixed 1:3 SL/TP
 */
function confirmNecklineRetest(candles, pattern) {
  const tolerance = pattern.type === "H&S" ? -config.tolerancePercent / 100 : config.tolerancePercent / 100;
  for (let i = pattern.RS.index + 1; i < candles.length; i++) {
    const candle = candles[i];
    if (
      (pattern.type === "H&S" && candle.high >= pattern.neckline * (1 + tolerance) && candle.low <= pattern.neckline) ||
      (pattern.type === "Inverse H&S" && candle.low <= pattern.neckline * (1 - tolerance) && candle.high >= pattern.neckline)
    ) {
      if (
        (pattern.type === "H&S" && candle.close < pattern.neckline) ||
        (pattern.type === "Inverse H&S" && candle.close > pattern.neckline)
      ) {
        pattern.entryConfirmed = true;
        pattern.retestCandle = candle;

        const entryPrice = candle.close;
        if (pattern.type === "H&S") {
          pattern.sl = pattern.RS.value + pattern.RS.value * (config.slBufferPercent / 100);
          const risk = pattern.sl - entryPrice;
          pattern.tp = entryPrice - risk * config.riskReward.fixed;
        } else {
          pattern.sl = pattern.RS.value - pattern.RS.value * (config.slBufferPercent / 100);
          const risk = entryPrice - pattern.sl;
          pattern.tp = entryPrice + risk * config.riskReward.fixed;
        }

        return true;
      }
    }
  }
  return false;
}

/**
 * Confirm HH/LL break after retest
 */
function checkBreakAfterRetest(candles, pattern) {
  if (!pattern.entryConfirmed) return false;
  const start = pattern.retestCandle.index + 1;
  for (let i = start; i < candles.length; i++) {
    const candle = candles[i];
    if (pattern.type === "H&S" && candle.low < pattern.RS.value) {
      pattern.entryCandle = candle;
      return true;
    }
    if (pattern.type === "Inverse H&S" && candle.high > pattern.RS.value) {
      pattern.entryCandle = candle;
      return true;
    }
  }
  return false;
}

/**
 * Detect and confirm patterns for trading
 */
export function detectPatterns(candles) {
  const swings = getSwings(candles);
  let pattern = detectHeadShoulders(swings);
  if (!pattern) pattern = detectInverseHeadShoulders(swings);
  if (!pattern) return null;
  if (!confirmNecklineRetest(candles, pattern)) return null;
  if (!checkBreakAfterRetest(candles, pattern)) return null;
  return pattern;
}

/**
 * Ensure all configured TFs align
 */
export function checkTopDownAlignment(candleData, topDownTFs) {
  let trendDirection = null;
  for (let tf of topDownTFs) {
    const candles = candleData[tf];
    if (!candles || candles.length < 2) return false;
    const tfTrend = detectTrend(candles);
    if (!tfTrend) return false;
    if (!trendDirection) trendDirection = tfTrend;
    else if (trendDirection !== tfTrend) return false;
  }
  return trendDirection;
}

/**
 * Detect trend for a timeframe
 */
function detectTrend(candles) {
  const last = candles.length - 1;
  const isUp = candles[last].high > candles[last - 1].high && candles[last].low > candles[last - 1].low;
  const isDown = candles[last].high < candles[last - 1].high && candles[last].low < candles[last - 1].low;
  if (isUp) return "up";
  if (isDown) return "down";
  return null;
}

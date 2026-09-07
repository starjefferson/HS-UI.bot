/**
 * Top-Down Trend Alignment (3/4 SMA Rule)
 * Scans specified timeframes (e.g. ["1W", "1D", "4H", "1H"])
 * Requires at least 3 out of 4 timeframes to agree on direction.
 */
export function checkTopDownAlignment(candleData, topDownTFs) {
  let votes = { buy: 0, sell: 0 };

  for (let tf of topDownTFs) {
    const candles = candleData[tf];
    if (!candles || candles.length < 20) continue;

    // Detect trend using a 20-candle SMA comparison on most recent 20 bars
    const sma = candles.slice(0, 20).reduce((acc, c) => acc + c.close, 0) / 20;
    const currentPrice = candles[0].close;

    if (currentPrice > sma) votes.buy++;
    if (currentPrice < sma) votes.sell++;
  }

  // Enforces 3 out of 4 alignment (allowing 1 mismatch)
  const threshold = topDownTFs.length - 1;

  if (votes.buy >= threshold) return "buy";
  if (votes.sell >= threshold) return "sell";

  return null; // Return null if trend bias is divided or unclear
}
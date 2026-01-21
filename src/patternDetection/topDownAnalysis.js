export function checkTopDownAlignment(candleData, topDownTFs) {
  let votes = { up: 0, down: 0 };

  for (let tf of topDownTFs) {
    const candles = candleData[tf];
    if (!candles || candles.length < 20) continue;

    // Detect trend using a 20-candle SMA comparison
    const sma = candles.slice(0, 20).reduce((a, b) => a + b.close, 0) / 20;
    const current = candles[0].close;

    if (current > sma) votes.up++;
    if (current < sma) votes.down++;
  }

  // Consistent with your "allow one mismatch" logic:
  // If we have 4 TFs, we need at least 3 to align.
  const threshold = topDownTFs.length - 1;

  if (votes.up >= threshold) return "up";
  if (votes.down >= threshold) return "down";
  
  return null;
}
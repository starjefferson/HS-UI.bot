// Helper functions
export function average(a, b) { return (a + b) / 2; }
export function percentDifference(a, b) { return Math.abs(a - b) / ((a + b) / 2) * 100; }

/**
 * Calculate ADX (Average Directional Index) from candle data.
 *
 * Candles must be ordered newest-first (index 0 = most recent).
 * Returns the current ADX value (0–100), or NaN if there is
 * insufficient data for the given period.
 *
 * @param {Array}  candles - Candle objects with { high, low, close }
 * @param {number} [period=14] - ADX smoothing period (standard: 14)
 * @returns {number}
 */
export function calculateADX(candles, period = 14) {
    // ADX needs at least (2 * period) + 1 candles to produce a meaningful value.
    const minCandles = 2 * period + 1;
    if (!candles || candles.length < minCandles) return NaN;

    // Work oldest-to-newest so the smoothing accumulates forward in time.
    const reversed = candles.slice(0, Math.min(candles.length, 200)).slice().reverse();

    // ── Step 1: Raw True Range, +DM, -DM for each bar ────────────────────────
    const trueRanges = [];
    const plusDMs = [];
    const minusDMs = [];

    for (let i = 1; i < reversed.length; i++) {
        const curr = reversed[i];
        const prev = reversed[i - 1];

        const highLow   = curr.high - curr.low;
        const highClose = Math.abs(curr.high - prev.close);
        const lowClose  = Math.abs(curr.low - prev.close);
        trueRanges.push(Math.max(highLow, highClose, lowClose));

        const upMove   = curr.high - prev.high;
        const downMove = prev.low - curr.low;
        plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }

    if (trueRanges.length < 2 * period) return NaN;

    // ── Step 2: Wilder-smooth TR, +DM, -DM over the first `period` bars ──────
    let smoothTR    = trueRanges.slice(0, period).reduce((s, v) => s + v, 0);
    let smoothPlusDM  = plusDMs.slice(0, period).reduce((s, v) => s + v, 0);
    let smoothMinusDM = minusDMs.slice(0, period).reduce((s, v) => s + v, 0);

    const dxValues = [];

    for (let i = period; i < trueRanges.length; i++) {
        smoothTR      = smoothTR      - smoothTR / period      + trueRanges[i];
        smoothPlusDM  = smoothPlusDM  - smoothPlusDM / period  + plusDMs[i];
        smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDMs[i];

        if (smoothTR === 0) {
            dxValues.push(0);
            continue;
        }

        const plusDI  = (smoothPlusDM / smoothTR) * 100;
        const minusDI = (smoothMinusDM / smoothTR) * 100;
        const diSum   = plusDI + minusDI;
        if (diSum === 0) {
            dxValues.push(0);
            continue;
        }

        dxValues.push(Math.abs(plusDI - minusDI) / diSum * 100);
    }

    if (dxValues.length < period) return NaN;

    // ── Step 3: Smooth DX into ADX ───────────────────────────────────────────
    let adx = dxValues.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < dxValues.length; i++) {
        adx = (adx * (period - 1) + dxValues[i]) / period;
    }

    return adx;
}

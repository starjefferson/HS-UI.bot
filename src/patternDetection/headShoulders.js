/**
 * headShoulders.js
 * Flexible structural detection for H&S and Inverted H&S patterns.
 *
 * Uses candle timestamps to generate unique patternID fingerprints in index.js,
 * preventing the same pattern from being traded twice across scan cycles.
 */

// ─── Public Detection Entry Point ────────────────────────────────────────────

/**
 * Detects H&S / Inverted H&S patterns on the supplied candle array.
 *
 * @param {Array}  candles - Structural candles (4H or 1D timeframe)
 * @param {"sell"|"buy"} expectedType - Pattern direction matching trend bias
 * @param {Function} [onDiagnostic] - Reports geometry and TP/RR evaluation stages
 * @returns {Object|null}
 */
export function detectPatterns(candles, expectedType, onDiagnostic) {
    if (!candles || candles.length < 200) return null;

    return findHS(candles, expectedType, onDiagnostic);
}

// ─── Internal Pattern Finder ─────────────────────────────────────────────────

/**
 * Core H&S / Inverted H&S structural finder.
 *
 * @param {Array}    candles         - Structural candles (4H or 1D)
 * @param {"sell"|"buy"} type
 * @param {Function} [onDiagnostic]
 * @returns {Object|null}
 */
function findHS(candles, type, onDiagnostic) {
    const mainData    = type === "sell" ? candles.map(c => c.high) : candles.map(c => c.low);
    const supportData = type === "sell" ? candles.map(c => c.low)  : candles.map(c => c.high);

    let extrema = [];
    const radius = 5;
    const limit  = mainData.length - radius;

    // Identify local peaks (sell) or valleys (buy) across 200 bars
    for (let i = radius; i < limit; i++) {
        const window = mainData.slice(i - radius, i + radius + 1);
        const isPivot = type === "sell"
            ? mainData[i] === Math.max(...window)
            : mainData[i] === Math.min(...window);
        if (isPivot) extrema.push({ val: mainData[i], idx: i });
    }

    if (extrema.length < 3) return null;

    // Assign roles: most-recent → Right Shoulder, next → Head, then → Left Shoulder
    const s2   = extrema[0];  // Right Shoulder (most recent)
    const head = extrema[1];  // Head
    const s1   = extrema[2];  // Left Shoulder

    // Pip buffers: standard pairs ≈ 5 pips, JPY pairs ≈ 50 pips
    const pipBuffer = 0.0005;
    const jpyBuffer = 0.05;

    // Candle timestamp used as pattern fingerprint
    const headTime = candles?.[head.idx]?.time ?? head.idx;

    if (type === "sell") {
        // ── SELL: Head must be the highest peak ──────────────────────────────
        if (!(head.val > s1.val && head.val > s2.val)) return null;

        const trough1 = Math.min(...supportData.slice(head.idx, s1.idx));
        const trough2 = Math.min(...supportData.slice(s2.idx, head.idx));
        const nHigh   = Math.max(trough1, trough2);
        const nLow    = Math.min(trough1, trough2);

        const slPrice    = s2.val + (s2.val > 50 ? jpyBuffer : pipBuffer);
        const entryPrice = nLow; // Neckline breakout level

        onDiagnostic?.({ type, stage: "geometry" });

        // ── TP Calculation ────────────────────────────────────────────────────
        const tpResult = calculateHistoricalTP(candles, entryPrice, slPrice, "sell");
        if (!tpResult) {
            onDiagnostic?.({ type, stage: "tp-rejected" });
            return null; // Rejected if key support too close (RR < 2.5)
        }

        return {
            type: "sell",
            label: "Head and Shoulders",
            necklineHigh: nHigh,
            necklineLow:  nLow,
            sl: slPrice,
            tp: tpResult.tp,
            targetRR: tpResult.rr,
            headTime
        };

    } else {
        // ── BUY: Head must be the lowest valley ──────────────────────────────
        if (!(head.val < s1.val && head.val < s2.val)) return null;

        const peak1 = Math.max(...supportData.slice(head.idx, s1.idx));
        const peak2 = Math.max(...supportData.slice(s2.idx, head.idx));
        const nHigh = Math.max(peak1, peak2);
        const nLow  = Math.min(peak1, peak2);

        const slPrice    = s2.val - (s2.val > 50 ? jpyBuffer : pipBuffer);
        const entryPrice = nHigh; // Neckline breakout level

        onDiagnostic?.({ type, stage: "geometry" });

        // ── TP Calculation ────────────────────────────────────────────────────
        const tpResult = calculateHistoricalTP(candles, entryPrice, slPrice, "buy");
        if (!tpResult) {
            onDiagnostic?.({ type, stage: "tp-rejected" });
            return null; // Rejected if key resistance too close (RR < 2.5)
        }

        return {
            type: "buy",
            label: "Inverted Head and Shoulders",
            necklineHigh: nHigh,
            necklineLow:  nLow,
            sl: slPrice,
            tp: tpResult.tp,
            targetRR: tpResult.rr,
            headTime
        };
    }
}

// ─── Historical TP Calculation ───────────────────────────────────────────────

/**
 * Historical Support & Resistance TP Calculation:
 * 1. Scans past candles for historical swing Lows (Support for SELL) or Highs (Resistance for BUY).
 * 2. Identifies the nearest key historical zone in the path of the trade.
 * 3. Enforces Risk-to-Reward rules:
 *    - If Key Zone RR > 3.0: Caps TP at exactly 3.0 RR.
 *    - If Key Zone RR < 2.5: Returns null (Rejects trade because support/resistance blocks profit).
 *    - If 2.5 <= RR <= 3.0: Snaps TP directly to the historical zone.
 */
function calculateHistoricalTP(candles, entryPrice, slPrice, type) {
    const risk = Math.abs(entryPrice - slPrice);
    if (risk <= 0) return null;

    const radius = 5;
    let keyZone  = null;

    if (type === "sell") {
        let supportZones = [];
        for (let i = radius; i < candles.length - radius; i++) {
            const windowLows = candles.slice(i - radius, i + radius + 1).map(c => c.low);
            if (candles[i].low === Math.min(...windowLows) && candles[i].low < entryPrice) {
                supportZones.push(candles[i].low);
            }
        }
        if (supportZones.length > 0) keyZone = Math.max(...supportZones);

        let targetTP = keyZone ? keyZone : (entryPrice - (risk * 3.0));
        let reward   = entryPrice - targetTP;
        let rr       = reward / risk;

        if (rr > 3.0) { targetTP = entryPrice - (risk * 3.0); rr = 3.0; }
        if (rr < 2.5) return null;

        return { tp: targetTP, rr };

    } else {
        let resistanceZones = [];
        for (let i = radius; i < candles.length - radius; i++) {
            const windowHighs = candles.slice(i - radius, i + radius + 1).map(c => c.high);
            if (candles[i].high === Math.max(...windowHighs) && candles[i].high > entryPrice) {
                resistanceZones.push(candles[i].high);
            }
        }
        if (resistanceZones.length > 0) keyZone = Math.min(...resistanceZones);

        let targetTP = keyZone ? keyZone : (entryPrice + (risk * 3.0));
        let reward   = targetTP - entryPrice;
        let rr       = reward / risk;

        if (rr > 3.0) { targetTP = entryPrice + (risk * 3.0); rr = 3.0; }
        if (rr < 2.5) return null;

        return { tp: targetTP, rr };
    }
}
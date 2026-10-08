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
    const radius = 5;
    const pivots = findAlternatingPivots(candles, radius);
    if (pivots.length < 5) return null;

    const expectedPivotTypes = type === "sell"
        ? ["high", "low", "high", "low", "high"]
        : ["low", "high", "low", "high", "low"];
    const maxCandidates = Math.min(pivots.length - 4, 12);

    // Pivots are ordered newest-to-oldest because candle index 0 is most recent.
    for (let start = 0; start < maxCandidates; start++) {
        const candidate = pivots.slice(start, start + 5);
        if (candidate.some((pivot, index) => pivot.type !== expectedPivotTypes[index])) continue;

        const [rightShoulder, rightNeck, head, leftNeck, leftShoulder] = candidate;
        const gaps = candidate.slice(1).map((pivot, index) => pivot.idx - candidate[index].idx);
        if (gaps.some(gap => gap < 3 || gap > 60)) continue;
        if (leftShoulder.idx - rightShoulder.idx > 120) continue;

        const atr = calculatePatternATR(candles, rightShoulder.idx, leftShoulder.idx);
        if (!Number.isFinite(atr) || atr <= 0) continue;

        const shoulderDifference = Math.abs(leftShoulder.val - rightShoulder.val);
        const necklineDifference = Math.abs(leftNeck.val - rightNeck.val);
        const headProminence = type === "sell"
            ? head.val - Math.max(leftShoulder.val, rightShoulder.val)
            : Math.min(leftShoulder.val, rightShoulder.val) - head.val;
        const headToNeckline = type === "sell"
            ? head.val - (leftNeck.val + rightNeck.val) / 2
            : (leftNeck.val + rightNeck.val) / 2 - head.val;

        // Allow ordinary market variation, but reject shallow heads, mismatched
        // shoulders, and necklines whose two reactions are materially different.
        if (shoulderDifference > atr * 2) continue;
        if (necklineDifference > atr * 2) continue;
        if (headProminence < atr * 0.5 || headToNeckline < atr) continue;

        const headTime = candles?.[head.idx]?.time ?? head.idx;
        const leftShoulderTime = candles?.[leftShoulder.idx]?.time;
        const leftNeckTime = candles?.[leftNeck.idx]?.time;
        const rightShoulderTime = candles?.[rightShoulder.idx]?.time;
        const rightNeckTime = candles?.[rightNeck.idx]?.time;
        const necklineStartTime = candles?.[leftNeck.idx]?.time;
        const necklineEndTime = candles?.[rightNeck.idx]?.time;
        if (![leftShoulderTime, leftNeckTime, headTime, rightNeckTime, rightShoulderTime].every(Number.isFinite)) continue;

        const necklineHigh = Math.max(leftNeck.val, rightNeck.val);
        const necklineLow = Math.min(leftNeck.val, rightNeck.val);
        const necklineMidpoint = (leftNeck.val + rightNeck.val) / 2;
        const measuredMove = Math.abs(head.val - necklineMidpoint);
        if (!Number.isFinite(measuredMove) || measuredMove <= 0) continue;

        const slBuffer = atr * 0.25;
        const slPrice = type === "sell"
            ? rightShoulder.val + slBuffer
            : rightShoulder.val - slBuffer;

        onDiagnostic?.({
            type,
            stage: "geometry",
            leftShoulderPrice: leftShoulder.val,
            leftShoulderTime,
            leftNeckPrice: leftNeck.val,
            leftNeckTime,
            headPrice: head.val,
            headTime,
            rightNeckPrice: rightNeck.val,
            rightNeckTime,
            rightShoulderPrice: rightShoulder.val,
            rightShoulderTime
        });

        const invalidationCandle = candles
            .slice(0, rightShoulder.idx)
            .find(candle => type === "sell"
                ? candle.high > head.val
                : candle.low < head.val);
        if (invalidationCandle) {
            onDiagnostic?.({
                type,
                stage: "invalidated",
                headPrice: head.val,
                invalidationPrice: type === "sell" ? invalidationCandle.high : invalidationCandle.low,
                invalidationTime: invalidationCandle.time
            });
            return null;
        }

        return {
            type,
            label: type === "sell" ? "Head and Shoulders" : "Inverted Head and Shoulders",
            necklineHigh,
            necklineLow,
            measuredMove,
            sl: slPrice,
            headTime,
            rightShoulderTime,
            necklineStartTime,
            necklineStartPrice: leftNeck.val,
            necklineEndTime,
            necklineEndPrice: rightNeck.val
        };
    }

    return null;
}

function findAlternatingPivots(candles, radius) {
    const rawPivots = [];
    const limit = candles.length - radius;

    for (let i = radius; i < limit; i++) {
        const window = candles.slice(i - radius, i + radius + 1);
        const highs = window.map(candle => candle.high);
        const lows = window.map(candle => candle.low);
        const isHigh = candles[i].high === Math.max(...highs);
        const isLow = candles[i].low === Math.min(...lows);

        if (isHigh === isLow) continue;
        rawPivots.push({
            type: isHigh ? "high" : "low",
            val: isHigh ? candles[i].high : candles[i].low,
            idx: i
        });
    }

    const pivots = [];
    for (const pivot of rawPivots) {
        const previous = pivots[pivots.length - 1];
        if (!previous || previous.type !== pivot.type) {
            pivots.push(pivot);
            continue;
        }

        const isMoreExtreme = pivot.type === "high"
            ? pivot.val > previous.val
            : pivot.val < previous.val;
        if (isMoreExtreme) pivots[pivots.length - 1] = pivot;
    }

    return pivots;
}

function calculatePatternATR(candles, newestIdx, oldestIdx, period = 14) {
    const trueRanges = [];
    const start = Math.max(newestIdx, 1);
    const end = Math.min(oldestIdx, start + period);

    for (let i = start; i < end; i++) {
        const candle = candles[i];
        const previousClose = candles[i + 1]?.close;
        const trueRange = Number.isFinite(previousClose)
            ? Math.max(
                candle.high - candle.low,
                Math.abs(candle.high - previousClose),
                Math.abs(candle.low - previousClose)
            )
            : candle.high - candle.low;
        trueRanges.push(trueRange);
    }

    if (trueRanges.length === 0) return NaN;
    return trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length;
}

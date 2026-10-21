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
export function detectPatterns(candles, expectedType, onDiagnostic, stopBuffer = 0) {
    if (!candles || candles.length < 200) return null;

    return findHS(candles, expectedType, onDiagnostic, stopBuffer);
}

// ─── Internal Pattern Finder ─────────────────────────────────────────────────
const MAX_PATTERN_AGE_CANDLES = 24;

/**
 * Core H&S / Inverted H&S structural finder.
 *
 * @param {Array}    candles         - Structural candles (4H or 1D)
 * @param {"sell"|"buy"} type
 * @param {Function} [onDiagnostic]
 * @returns {Object|null}
 */
function findHS(candles, type, onDiagnostic, stopBuffer) {
    const radius = 5;
    const pivots = findAlternatingPivots(candles, radius);
    if (pivots.length < 4) return null;

    const expectedPivotTypes = type === "sell"
        ? ["high", "low", "high", "low", "high"]
        : ["low", "high", "low", "high", "low"];
    const maxCandidates = Math.min(pivots.length - 3, 12);

    // Pivots are ordered newest-to-oldest because candle index 0 is most recent.
    for (let start = 0; start < maxCandidates; start++) {
        let candidate = pivots.slice(start, start + 5);
        let formingRightShoulder = false;
        if (candidate.length < 5 || candidate.some((pivot, index) => pivot.type !== expectedPivotTypes[index])) {
            const confirmedPivots = pivots.slice(start, start + 4);
            if (
                confirmedPivots.length !== 4 ||
                confirmedPivots.some((pivot, index) => pivot.type !== expectedPivotTypes[index + 1])
            ) continue;

            const rightNeck = confirmedPivots[0];
            const developingCandles = candles.slice(0, rightNeck.idx);
            if (developingCandles.length === 0) continue;
            const extreme = type === "sell"
                ? developingCandles.reduce((best, candle, index) =>
                    candle.close > best.val ? { val: candle.close, idx: index } : best,
                { val: -Infinity, idx: -1 })
                : developingCandles.reduce((best, candle, index) =>
                    candle.close < best.val ? { val: candle.close, idx: index } : best,
                { val: Infinity, idx: -1 });
            if (extreme.idx < 0) continue;

            candidate = [
                { type: expectedPivotTypes[0], val: extreme.val, idx: extreme.idx },
                ...confirmedPivots
            ];
            formingRightShoulder = true;
        }

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

        // Allow visibly uneven shoulders and sloped necklines while still
        // rejecting shapes whose pivot levels are too far apart.
        if (shoulderDifference > atr * 3.5) continue;
        if (necklineDifference > atr * 4) continue;
        if (headProminence < atr * 0.6 || headToNeckline < atr * 1.1) continue;

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

        const slPrice = type === "sell"
            ? rightShoulder.val + stopBuffer
            : rightShoulder.val - stopBuffer;

        const pivotDetails = {
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
        };
        onDiagnostic?.({
            type,
            stage: "geometry",
            formingRightShoulder,
            ...pivotDetails
        });

        const invalidationCandle = candles
            .slice(0, rightShoulder.idx)
            .find(candle => type === "sell"
                ? candle.close > head.val
                : candle.close < head.val);
        if (invalidationCandle) {
            onDiagnostic?.({
                type,
                stage: "invalidated",
                headPrice: head.val,
                headTime,
                rightShoulderTime,
                invalidationPrice: invalidationCandle.close,
                invalidationTime: invalidationCandle.time
            });
            return null;
        }

        if (rightShoulder.idx > MAX_PATTERN_AGE_CANDLES) {
            onDiagnostic?.({
                type,
                stage: "stale",
                ageCandles: rightShoulder.idx,
                maxAgeCandles: MAX_PATTERN_AGE_CANDLES,
                ...pivotDetails
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
            headPrice: head.val,
            headTime,
            rightShoulderPrice: rightShoulder.val,
            rightShoulderTime,
            necklineStartTime,
            necklineStartPrice: leftNeck.val,
            necklineEndTime,
            necklineEndPrice: rightNeck.val,
            formingRightShoulder
        };
    }

    return null;
}

function findAlternatingPivots(candles, radius) {
    const rawPivots = [];
    const limit = candles.length - radius;

    for (let i = radius; i < limit; i++) {
        const window = candles.slice(i - radius, i + radius + 1);
        const closes = window.map(candle => candle.close);
        const isHigh = candles[i].close === Math.max(...closes);
        const isLow = candles[i].close === Math.min(...closes);

        if (isHigh === isLow) continue;
        rawPivots.push({
            type: isHigh ? "high" : "low",
            val: candles[i].close,
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
    const closeChanges = [];
    const start = Math.max(newestIdx, 1);
    const end = Math.min(oldestIdx, start + period);

    for (let i = start; i < end; i++) {
        const previousClose = candles[i + 1]?.close;
        const closeChange = Math.abs(candles[i].close - previousClose);
        if (Number.isFinite(closeChange)) closeChanges.push(closeChange);
    }

    if (closeChanges.length === 0) return NaN;
    return closeChanges.reduce((sum, value) => sum + value, 0) / closeChanges.length;
}

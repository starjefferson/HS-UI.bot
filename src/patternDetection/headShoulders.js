/**
 * headShoulders.js
 * Flexible structural detection for H&S and Inverted H&S patterns.
 * 
 * Uses candle timestamps to generate unique patternID fingerprints in index.js,
 * preventing the same pattern from being traded twice across scan cycles.
 */

export function detectPatterns(candles) {
    if (!candles || candles.length < 200) return null;

    const highs = candles.map(c => c.high);
    const lows  = candles.map(c => c.low);

    // Scan for Sell (Head and Shoulders)
    const hs = findHS(highs, lows, "sell", candles);
    if (hs) return hs;

    // Scan for Buy (Inverted Head and Shoulders)
    const ihs = findHS(lows, highs, "buy", candles);
    if (ihs) return ihs;

    return null;
}

function findHS(mainData, supportData, type, candles) {
    let extrema = [];
    const radius = 5;
    const limit  = mainData.length - radius;

    // Identify local peaks or valleys across 200 bars
    for (let i = radius; i < limit; i++) {
        const window = mainData.slice(i - radius, i + radius + 1);
        if (type === "sell") {
            if (mainData[i] === Math.max(...window)) {
                extrema.push({ val: mainData[i], idx: i });
            }
        } else {
            if (mainData[i] === Math.min(...window)) {
                extrema.push({ val: mainData[i], idx: i });
            }
        }
    }

    if (extrema.length < 3) return null;

    // s2 = Right Shoulder (most recent), head = Head, s1 = Left Shoulder
    const s2   = extrema[0];
    const head = extrema[1];
    const s1   = extrema[2];

    // Pip buffers: standard pairs use 0.0005 (5 pips), JPY pairs use 0.05
    const pipBuffer = 0.0005;
    const jpyBuffer = 0.05;

    // Candle timestamp used as pattern fingerprint
    const headTime = candles?.[head.idx]?.time ?? head.idx;

    if (type === "sell") {
        if (head.val > s1.val && head.val > s2.val) {
            const trough1 = Math.min(...supportData.slice(head.idx, s1.idx));
            const trough2 = Math.min(...supportData.slice(s2.idx, head.idx));

            const nHigh = Math.max(trough1, trough2);
            const nLow  = Math.min(trough1, trough2);

            // SL is placed 5 pips above the Right Shoulder (s2)
            const slPrice = s2.val + (s2.val > 50 ? jpyBuffer : pipBuffer);
            const entryPrice = nLow; // Breakout level at neckline zone

            // Calculate TP based on Historical Support Zones & RR Rules
            const tpResult = calculateHistoricalTP(candles, entryPrice, slPrice, "sell");
            if (!tpResult) return null; // Rejected if Key Support is too close (RR < 2.5)

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
        }
    } else {
        if (head.val < s1.val && head.val < s2.val) {
            const peak1 = Math.max(...supportData.slice(head.idx, s1.idx));
            const peak2 = Math.max(...supportData.slice(s2.idx, head.idx));

            const nHigh = Math.max(peak1, peak2);
            const nLow  = Math.min(peak1, peak2);

            // SL is placed 5 pips below the Right Shoulder (s2)
            const slPrice = s2.val - (s2.val > 50 ? jpyBuffer : pipBuffer);
            const entryPrice = nHigh; // Breakout level at neckline zone

            // Calculate TP based on Historical Resistance Zones & RR Rules
            const tpResult = calculateHistoricalTP(candles, entryPrice, slPrice, "buy");
            if (!tpResult) return null; // Rejected if Key Resistance is too close (RR < 2.5)

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
    return null;
}

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
    let keyZone = null;

    if (type === "sell") {
        let supportZones = [];
        for (let i = radius; i < candles.length - radius; i++) {
            const windowLows = candles.slice(i - radius, i + radius + 1).map(c => c.low);
            if (candles[i].low === Math.min(...windowLows) && candles[i].low < entryPrice) {
                supportZones.push(candles[i].low);
            }
        }

        if (supportZones.length > 0) {
            keyZone = Math.max(...supportZones);
        }

        let targetTP = keyZone ? keyZone : (entryPrice - (risk * 3.0));
        let reward = entryPrice - targetTP;
        let rr = reward / risk;

        if (rr > 3.0) {
            targetTP = entryPrice - (risk * 3.0);
            rr = 3.0;
        }

        if (rr < 2.5) {
            return null;
        }

        return { tp: targetTP, rr };

    } else {
        let resistanceZones = [];
        for (let i = radius; i < candles.length - radius; i++) {
            const windowHighs = candles.slice(i - radius, i + radius + 1).map(c => c.high);
            if (candles[i].high === Math.max(...windowHighs) && candles[i].high > entryPrice) {
                resistanceZones.push(candles[i].high);
            }
        }

        if (resistanceZones.length > 0) {
            keyZone = Math.min(...resistanceZones);
        }

        let targetTP = keyZone ? keyZone : (entryPrice + (risk * 3.0));
        let reward = targetTP - entryPrice;
        let rr = reward / risk;

        if (rr > 3.0) {
            targetTP = entryPrice + (risk * 3.0);
            rr = 3.0;
        }

        if (rr < 2.5) {
            return null;
        }

        return { tp: targetTP, rr };
    }
}
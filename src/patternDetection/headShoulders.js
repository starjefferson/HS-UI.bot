/**
 * headShoulders.js
 * Flexible structural detection for H&S and Inverted H&S patterns.
 * 
 * IMPORTANT: Candles must include a `time` field (Unix timestamp from MT5).
 * This is used to generate a truly unique patternID fingerprint in server.js,
 * preventing the same pattern from being traded twice across scan cycles.
 */

export function detectPatterns(candles) {
    if (candles.length < 200) return null;

    const highs = candles.map(c => c.high);
    const lows  = candles.map(c => c.low);

    // Pass full candles array so findHS can read candle timestamps
    const hs = findHS(highs, lows, "sell", candles);
    if (hs) return hs;

    const ihs = findHS(lows, highs, "buy", candles);
    if (ihs) return ihs;

    return null;
}

function findHS(mainData, supportData, type, candles) {
    let extrema = [];
    const radius = 5;
    const limit  = mainData.length - radius; // Use full array, not hardcoded 200

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

    // Pip buffers: standard pairs use 0.0005, JPY pairs use 0.05
    const pipBuffer = 0.0005;
    const jpyBuffer = 0.05;

    // Use the real candle timestamp (Unix seconds from MT5) as the pattern fingerprint.
    // Falls back to the array index if `time` is not present (e.g., test data).
    const headTime = candles?.[head.idx]?.time ?? head.idx;

    if (type === "sell") {
        if (head.val > s1.val && head.val > s2.val) {
            const trough1 = Math.min(...supportData.slice(head.idx, s1.idx));
            const trough2 = Math.min(...supportData.slice(s2.idx, head.idx));

            const nHigh = Math.max(trough1, trough2);
            const nLow  = Math.min(trough1, trough2);

            // SL is just above the Right Shoulder
            const slPrice    = s2.val + (s2.val > 50 ? jpyBuffer : pipBuffer);
            const riskAmount = slPrice - nLow;

            return {
                type: "sell",
                label: "Head and Shoulders",
                necklineHigh: nHigh,
                necklineLow:  nLow,
                sl: slPrice,
                tp: nLow - (riskAmount * 3), // 1:3 base — server validates actual RR
                headTime,
            };
        }
    } else {
        if (head.val < s1.val && head.val < s2.val) {
            const peak1 = Math.max(...supportData.slice(head.idx, s1.idx));
            const peak2 = Math.max(...supportData.slice(s2.idx, head.idx));

            const nHigh = Math.max(peak1, peak2);
            const nLow  = Math.min(peak1, peak2);

            // SL is just below the Right Shoulder
            const slPrice    = s2.val - (s2.val > 50 ? jpyBuffer : pipBuffer);
            const riskAmount = nHigh - slPrice;

            return {
                type: "buy",
                label: "Inverted Head and Shoulders",
                necklineHigh: nHigh,
                necklineLow:  nLow,
                sl: slPrice,
                tp: nHigh + (riskAmount * 3), // 1:3 base — server validates actual RR
                headTime,
            };
        }
    }
    return null;
}
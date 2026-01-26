/**
 * headShoulders.js
 * Flexible structural detection for H&S and Inverted H&S patterns.
 */

export function detectPatterns(candles) {
    if (candles.length < 200) return null;

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    const hs = findHS(highs, lows, "sell");
    if (hs) return hs;

    const ihs = findHS(lows, highs, "buy");
    if (ihs) return ihs;

    return null;
}

function findHS(mainData, supportData, type) {
    let extrema = [];
    const radius = 5; 

    for (let i = radius; i < 200 - radius; i++) {
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
    const s2 = extrema[0];   
    const head = extrema[1]; 
    const s1 = extrema[2];   

    // Define a 5-pip buffer (using 0.0005 for standard pairs, adjusted in logic below)
    const pipBuffer = 0.0005; 
    const jpyBuffer = 0.05;

    if (type === "sell") {
        if (head.val > s1.val && head.val > s2.val) {
            const trough1 = Math.min(...supportData.slice(head.idx, s1.idx));
            const trough2 = Math.min(...supportData.slice(s2.idx, head.idx));
            
            const nHigh = Math.max(trough1, trough2);
            const nLow = Math.min(trough1, trough2);

            // Calculation based on Right Shoulder + Buffer
            const slPrice = s2.val + (s2.val > 50 ? jpyBuffer : pipBuffer);
            
            // TP is projected from the Neckline using the 1:3 ratio logic
            // (Standard H&S TP is the height of the head, but we use RR multiplier here)
            const riskAmount = slPrice - nLow;

            return {
                type: "sell",
                label: "Head and Shoulders",
                necklineHigh: nHigh,
                necklineLow: nLow,
                sl: slPrice, 
                tp: nLow - (riskAmount * 3), // Setting base TP to 1:3 for the server to filter
                headTime: head.idx 
            };
        }
    } else {
        if (head.val < s1.val && head.val < s2.val) {
            const peak1 = Math.max(...supportData.slice(head.idx, s1.idx));
            const peak2 = Math.max(...supportData.slice(s2.idx, head.idx));

            const nHigh = Math.max(peak1, peak2);
            const nLow = Math.min(peak1, peak2);

            // Calculation based on Right Shoulder - Buffer
            const slPrice = s2.val - (s2.val > 50 ? jpyBuffer : pipBuffer);
            const riskAmount = nHigh - slPrice;

            return {
                type: "buy",
                label: "Inverted Head and Shoulders",
                necklineHigh: nHigh,
                necklineLow: nLow,
                sl: slPrice,
                tp: nHigh + (riskAmount * 3), // Setting base TP to 1:3 for the server to filter
                headTime: head.idx
            };
        }
    }
    return null;
}
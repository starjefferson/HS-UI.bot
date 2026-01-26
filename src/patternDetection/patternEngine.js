import { detectPatterns } from "./headShoulders.js";

/**
 * Enhanced Detection Hub
 * Scans D1, H4, and H1. If patterns align, it uses the lowest TF for SL/TP.
 */
export function runDetection(candleData, symbol) {
    const timeframes = ["1D", "4H", "1H"];
    let detectedSetups = {};

    // 1. Scan each timeframe for a valid structural pattern
    for (const tf of timeframes) {
        if (candleData[tf] && candleData[tf].length >= 200) {
            const result = detectPatterns(candleData[tf]);
            if (result) {
                detectedSetups[tf] = result;
            }
        }
    }

    // 2. Logic: Require at least H1. If higher TFs also have patterns, they must align.
    const h1Pattern = detectedSetups["1H"];
    if (!h1Pattern) return null; // No trade without H1 structure

    // 3. Check for multi-TF alignment (Directional Check)
    if (detectedSetups["1D"] && detectedSetups["1D"].type !== h1Pattern.type) return null;
    if (detectedSetups["4H"] && detectedSetups["4H"].type !== h1Pattern.type) return null;

    // --- NEW: STRUCTURAL INTEGRITY GUARD ---
    // This ensures the TP is actually placed in the direction of the trade.
    // If a SELL TP is higher than the neckline, or a BUY TP is lower, the pattern is malformed.
    const isSell = h1Pattern.type === "sell";
    if (isSell && h1Pattern.tp >= h1Pattern.necklineLow) {
        console.log(`❌ [${symbol}] Logic Error: Sell TP is above Neckline. Pattern rejected.`);
        return null;
    }
    if (!isSell && h1Pattern.tp <= h1Pattern.necklineHigh) {
        console.log(`❌ [${symbol}] Logic Error: Buy TP is below Neckline. Pattern rejected.`);
        return null;
    }

    // 4. Determine final SL/TP (Prioritize H1 for precision)
    const finalSetup = h1Pattern;

    console.log(`✅ [${symbol}] Multi-TF Alignment: ${Object.keys(detectedSetups).join(" + ")}`);

    return {
        type: finalSetup.type,
        label: `${finalSetup.label} (Multi-TF)`,
        pair: symbol,
        sl: finalSetup.sl,
        tp: finalSetup.tp,
        necklineHigh: finalSetup.necklineHigh,
        necklineLow: finalSetup.necklineLow,
        // headTime is used as a unique fingerprint in server.js to prevent duplicate trades
        headTime: finalSetup.headTime || Date.now(), 
        activeTFs: Object.keys(detectedSetups), // For logging
        timestamp: Date.now()
    };
}
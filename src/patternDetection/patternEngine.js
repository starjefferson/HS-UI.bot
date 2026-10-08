import { detectPatterns } from "./headShoulders.js";

/**
 * Enhanced Detection Hub
 *
 * Architecture:
 *  - STRUCTURAL DETECTION: 4H and 1D candles only. The H&S / IH&S shape is
 *    identified on these timeframes. 1H is NOT used for structure.
 *  - ENTRY TRIGGER:        A closed 1H candle breaking through the 4H/1D
 *    neckline zone is the sole execution trigger.
 *
 * candleData shape expected:
 *  {
 *    "1W": [...],   // Weekly candles — trend alignment
 *    "1D": [...],   // Daily candles  — structural detection + trend alignment
 *    "4H": [...],   // 4-Hour candles — structural detection
 *    "1H": [...],   // Hourly candles — breakout trigger only
 *  }
 */
export function runDetection(candleData, symbol, expectedBias, onPatternDetected) {
    if (expectedBias !== "buy" && expectedBias !== "sell") {
        console.log(`⚠️ [${symbol}] Pattern detection skipped: directional trend bias is required.`);
        return null;
    }

    // ── 1. Structural detection on 4H and 1D only ────────────────────────────
    const structuralTFs = ["4H", "1D"];
    let detectedSetups  = {};

    for (const tf of structuralTFs) {
        if (candleData[tf] && candleData[tf].length >= 200) {
            let geometryFound = false;
            const result = detectPatterns(
                candleData[tf], // structural candles
                expectedBias,
                ({ type, stage }) => {
                    if (stage === "geometry") {
                        geometryFound = true;
                        console.log(
                            `🔎 [${symbol}] ${tf} ${type.toUpperCase()} geometry matches trend bias; ` +
                            `evaluating historical TP/RR.`
                        );
                    } else if (stage === "tp-rejected") {
                        console.log(
                            `❌ [${symbol}] ${tf} ${type.toUpperCase()} geometry is valid but setup rejected: ` +
                            `invalid risk distance or historical S/R target below the 2.5R minimum.`
                        );
                    }
                }
            );
            if (result) {
                detectedSetups[tf] = result;
            } else if (!geometryFound) {
                console.log(
                    `ℹ️ [${symbol}] No ${expectedBias.toUpperCase()} H&S geometry found on ${tf}; ` +
                    `opposite-bias patterns are ignored.`
                );
            }
        }
    }

    // ── 2. Require at least one structural setup on 4H or 1D ─────────────────
    const primaryPattern = detectedSetups["4H"] || detectedSetups["1D"];
    if (!primaryPattern) return null;

    // ── 3. Multi-TF alignment: if both 4H and 1D detected, they must agree ───
    if (detectedSetups["4H"] && detectedSetups["1D"]) {
        if (detectedSetups["4H"].type !== detectedSetups["1D"].type) {
            console.log(
                `❌ [${symbol}] Multi-TF conflict: 4H is "${detectedSetups["4H"].type}" ` +
                `but 1D is "${detectedSetups["1D"].type}". Setup rejected.`
            );
            return null;
        }
    }

    // Use 4H when available (more precise SL/TP), fall back to 1D
    const structuralSetup = detectedSetups["4H"] || detectedSetups["1D"];

    if (expectedBias && structuralSetup.type !== expectedBias) {
        console.log(
            `⚠️ [${symbol}] Pattern rejected: ${structuralSetup.type.toUpperCase()} setup ` +
            `conflicts with Bias (${expectedBias.toUpperCase()}).`
        );
        return null;
    }

    // ── Structural Integrity Guard ──────────────────────────────────────────
    // Validate the target before checking whether the 1H breakout has occurred.
    const isSell = structuralSetup.type === "sell";
    if (isSell && structuralSetup.tp >= structuralSetup.necklineLow) {
        console.log(
            `❌ [${symbol}] REJECTED: Sell TP must be below neckline | ` +
            `TP: ${structuralSetup.tp} | Neckline Low: ${structuralSetup.necklineLow}`
        );
        return null;
    }
    if (!isSell && structuralSetup.tp <= structuralSetup.necklineHigh) {
        console.log(
            `❌ [${symbol}] REJECTED: Buy TP must be above neckline | ` +
            `TP: ${structuralSetup.tp} | Neckline High: ${structuralSetup.necklineHigh}`
        );
        return null;
    }

    onPatternDetected?.({
        type: structuralSetup.type,
        activeTFs: Object.keys(detectedSetups)
    });

    // ── 4. 1H Breakout Trigger — closed 1H candle must breach the neckline ───
    const h1Candles = candleData["1H"];
    if (!h1Candles || h1Candles.length < 2) {
        console.log(`⏳ [${symbol}] Waiting: no 1H candles available for breakout confirmation.`);
        return null;
    }

    // candles[0] is the most recent closed 1H candle (already closed, confirmed)
    const lastClosedH1 = h1Candles[0];

    const breakoutConfirmed = checkH1NecklineBreakout(lastClosedH1, structuralSetup);
    if (!breakoutConfirmed) {
        console.log(
            `⏳ [${symbol}] Waiting: last closed 1H candle has not yet broken the ` +
            `${structuralSetup.type === "sell" ? "necklineLow" : "necklineHigh"} ` +
            `(${structuralSetup.type === "sell" ? structuralSetup.necklineLow : structuralSetup.necklineHigh}).`
        );
        return null;
    }

    // ── 6. Build final setup ──────────────────────────────────────────────────
    const activeTFs = Object.keys(detectedSetups);
    console.log(
        `✅ [${symbol}] Setup confirmed — Structure: ${activeTFs.join(" + ")} | ` +
        `Trigger: 1H breakout at ${lastClosedH1.close}`
    );

    return {
        type:         structuralSetup.type,
        label:        `${structuralSetup.label} (${activeTFs.join("+")} / 1H trigger)`,
        pair:         symbol,
        sl:           structuralSetup.sl,
        tp:           structuralSetup.tp,
        necklineHigh: structuralSetup.necklineHigh,
        necklineLow:  structuralSetup.necklineLow,
        // headTime is used as a unique fingerprint in server.js to prevent duplicate trades
        headTime:     structuralSetup.headTime || Date.now(),
        activeTFs,
        timestamp:    Date.now()
    };
}

// ─── 1H Neckline Breakout Check ──────────────────────────────────────────────

/**
 * Validates that the most recently CLOSED 1H candle has broken through the
 * 4H/1D neckline zone, confirming the breakout trigger.
 *
 * SELL breakout: the 1H candle must close BELOW the necklineLow.
 * BUY  breakout: the 1H candle must close ABOVE the necklineHigh.
 *
 * @param {{ close: number, high: number, low: number }} h1Candle
 * @param {{ type: string, necklineHigh: number, necklineLow: number }} setup
 * @returns {boolean}
 */
function checkH1NecklineBreakout(h1Candle, setup) {
    if (setup.type === "sell") {
        return h1Candle.close < setup.necklineLow;
    } else {
        return h1Candle.close > setup.necklineHigh;
    }
}
import { detectPatterns } from "./headShoulders.js";

/**
 * Enhanced Detection Hub
 *
 * Architecture:
 *  - STRUCTURAL DETECTION: 4H and 1D candles only. The H&S / IH&S shape is
 *    identified on these timeframes. 1H is NOT used for structure.
 *  - ENTRY TRIGGER:        The first closed 1H candle clearing the far edge of
 *    the 4H/1D neckline region by the configured pip buffer is the sole trigger.
 *
 * candleData shape expected:
 *  {
 *    "1W": [...],   // Weekly candles — trend alignment
 *    "1D": [...],   // Daily candles  — structural detection + trend alignment
 *    "4H": [...],   // 4-Hour candles — structural detection
 *    "1H": [...],   // Hourly candles — breakout trigger only
 *  }
 */
export function runDetection(
    candleData,
    symbol,
    expectedBias,
    onPatternDetected,
    {
        breakoutBuffer = getPipSize(symbol) * 2,
        minimumRR = 2.5
    } = {}
) {
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
                            `calculating the pattern-based stop and target.`
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

    const activeTFs = Object.keys(detectedSetups);
    const reportPatternState = (stage) => onPatternDetected?.({
        type: structuralSetup.type,
        activeTFs,
        stage
    });

    // ── 4. 1H Breakout Trigger — require a fresh close across the neckline ───
    const h1Candles = candleData["1H"];
    const oneHourMs = 60 * 60 * 1000;
    const closedH1Candles = (h1Candles || [])
        .filter(candle => Number.isFinite(candle.time) && candle.time + oneHourMs <= Date.now())
        .slice(0, 200);
    if (closedH1Candles.length < 2) {
        console.log(`⏳ [${symbol}] Waiting: fewer than two fully closed 1H candles are available.`);
        reportPatternState("waiting-data");
        return null;
    }

    const lastClosedH1 = closedH1Candles[0];
    const previousClosedH1 = closedH1Candles[1];
    const oldestClosedH1 = closedH1Candles[closedH1Candles.length - 1];
    if (structuralSetup.rightShoulderTime < oldestClosedH1.time) {
        console.log(
            `⏭️ [${symbol}] No entry: the right-shoulder setup predates the available 1H breakout history; ` +
            `whether its first break was missed cannot be verified.`
        );
        reportPatternState("breakout-history-insufficient");
        return null;
    }

    const previousBreakout = closedH1Candles
        .slice(1)
        .find(candle =>
            candle.time >= structuralSetup.rightShoulderTime &&
            isBeyondNeckline(
                candle.close,
                getBreakoutLevel(structuralSetup, candle.time + oneHourMs, breakoutBuffer),
                structuralSetup.type
            )
        );
    if (previousBreakout) {
        console.log(
            `⏭️ [${symbol}] No re-entry: neckline region was already broken by a closed 1H candle ` +
            `at ${new Date(previousBreakout.time).toISOString()}.`
        );
        reportPatternState("breakout-missed");
        return null;
    }

    const previousBreakoutLevel = getBreakoutLevel(
        structuralSetup,
        previousClosedH1.time + oneHourMs,
        breakoutBuffer
    );
    const breakoutLevel = getBreakoutLevel(
        structuralSetup,
        lastClosedH1.time + oneHourMs,
        breakoutBuffer
    );
    const breakoutConfirmed = checkH1NecklineBreakout(
        previousClosedH1.close,
        lastClosedH1.close,
        previousBreakoutLevel,
        breakoutLevel,
        structuralSetup.type
    );
    if (!breakoutConfirmed) {
        console.log(
            `⏳ [${symbol}] Waiting: no fresh 1H close cleared the sloped neckline by ${breakoutBuffer} ` +
            `| Previous threshold: ${previousBreakoutLevel} | Latest threshold: ${breakoutLevel} | ` +
            `Previous close: ${previousClosedH1.close} | Latest close: ${lastClosedH1.close}.`
        );
        reportPatternState("waiting-breakout");
        return null;
    }

    const entryPrice = lastClosedH1.close;
    const necklineAtBreakout = getNecklineAtTime(
        structuralSetup,
        lastClosedH1.time + oneHourMs
    );
    const tp = structuralSetup.type === "sell"
        ? necklineAtBreakout - structuralSetup.measuredMove
        : necklineAtBreakout + structuralSetup.measuredMove;
    const risk = structuralSetup.type === "sell"
        ? structuralSetup.sl - entryPrice
        : entryPrice - structuralSetup.sl;
    const reward = structuralSetup.type === "sell"
        ? entryPrice - tp
        : tp - entryPrice;
    const rr = risk > 0 ? reward / risk : NaN;

    if (!(risk > 0) || !(reward > 0) || !Number.isFinite(rr)) {
        console.log(
            `❌ [${symbol}] REJECTED: Invalid measured-move trade levels | ` +
            `Entry: ${entryPrice} | SL: ${structuralSetup.sl} | TP: ${tp} | ` +
            `Risk: ${risk} | Reward: ${reward}`
        );
        reportPatternState("invalid-levels");
        return null;
    }
    if (rr < minimumRR) {
        console.log(
            `❌ [${symbol}] REJECTED: Breakout close is overextended; measured-move RR ${rr.toFixed(2)} ` +
            `is below the ${minimumRR} minimum | Entry: ${entryPrice} | SL: ${structuralSetup.sl} | TP: ${tp}.`
        );
        reportPatternState("rr-rejected");
        return null;
    }

    // ── 6. Build final setup ──────────────────────────────────────────────────
    reportPatternState("breakout-confirmed");
    console.log(
        `✅ [${symbol}] First 1H close beyond sloped neckline by ${breakoutBuffer} — Structure: ${activeTFs.join(" + ")} | ` +
        `Entry: ${entryPrice} | SL: ${structuralSetup.sl} | TP: ${tp} | RR: ${rr.toFixed(2)}`
    );

    return {
        type:         structuralSetup.type,
        label:        `${structuralSetup.label} (${activeTFs.join("+")} / 1H trigger)`,
        pair:         symbol,
        sl:           structuralSetup.sl,
        tp,
        entryPrice,
        breakoutNeckline: breakoutLevel,
        targetRR:     rr,
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
 * A breakout requires a candle close beyond the far edge of the neckline region.
 */
function checkH1NecklineBreakout(previousClose, latestClose, previousBoundary, latestBoundary, type) {
    if (type === "sell") {
        return previousClose >= previousBoundary && latestClose < latestBoundary;
    }
    return previousClose <= previousBoundary && latestClose > latestBoundary;
}

function isBeyondNeckline(close, boundary, type) {
    return type === "sell" ? close < boundary : close > boundary;
}

function getBreakoutLevel(setup, time, breakoutBuffer) {
    const neckline = getNecklineAtTime(setup, time);
    return setup.type === "sell"
        ? neckline - breakoutBuffer
        : neckline + breakoutBuffer;
}

function getNecklineAtTime(setup, time) {
    const elapsed = setup.necklineEndTime - setup.necklineStartTime;
    if (!(elapsed > 0)) return setup.necklineEndPrice;

    const progress = (time - setup.necklineStartTime) / elapsed;
    return setup.necklineStartPrice +
        (setup.necklineEndPrice - setup.necklineStartPrice) * progress;
}

function getPipSize(symbol) {
    if (symbol.includes("JPY")) return 0.01;
    if (symbol.includes("XAU") || symbol.includes("GOLD")) return 0.01;
    return 0.0001;
}
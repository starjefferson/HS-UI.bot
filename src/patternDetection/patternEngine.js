import { detectPatterns } from "./headShoulders.js";

const trackedStructures = new Map();
const STRUCTURE_MAX_AGE_CANDLES = 24;
const TIMEFRAME_MILLISECONDS = {
    "1H": 1 * 60 * 60 * 1000,
    "4H": 4 * 60 * 60 * 1000,
    "1D": 24 * 60 * 60 * 1000
};

// Breakout confirmation timeframe per structural timeframe.
// 1H patterns use 15m candles; all higher-TF patterns continue to use 1H.
const BREAKOUT_TF_FOR_STRUCTURAL = {
    "1H": "15m",
    "4H": "1H",
    "1D": "1H"
};
const BREAKOUT_TF_MILLISECONDS = {
    "15m": 15 * 60 * 1000,
    "1H":  60 * 60 * 1000
};

/**
 * Enhanced Detection Hub
 *
 * Architecture:
 *  - STRUCTURAL DETECTION: 1H, 4H, and 1D candles. The H&S / IH&S shape is
 *    identified on these timeframes.
 *  - ENTRY TRIGGER (4H / 1D patterns): The first closed 1H candle clearing the
 *    far edge of the neckline region by the configured pip buffer.
 *  - ENTRY TRIGGER (1H patterns):      Uses 15m candles instead of 1H for the
 *    breakout check — all other rules remain identical.
 *
 * candleData shape expected:
 *  {
 *    "1W":  [...],  // Weekly candles  — trend alignment
 *    "1D":  [...],  // Daily candles   — structural detection + trend alignment
 *    "4H":  [...],  // 4-Hour candles  — structural detection
 *    "1H":  [...],  // Hourly candles  — structural detection + breakout trigger (4H/1D patterns)
 *    "15m": [...],  // 15-min candles  — breakout trigger for 1H patterns only
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

    // ── 1. Structural detection on 1D, 4H and 1H ─────────────────────────────
    const structuralTFs = ["1D", "4H", "1H"];
    let detectedSetups  = {};

    for (const tf of structuralTFs) {
        const candles = candleData[tf];
        if (!candles || candles.length < 200) {
            console.log(
                `⚠️ [${symbol}] ${tf} structure scan skipped: ` +
                `${candles?.length ?? 0} candles available; 200 required.`
            );
            continue;
        }

        console.log(`[${symbol}] Scanning ${tf} candles for ${expectedBias.toUpperCase()} H&S structure.`);
        let geometryFound = false;
        let geometryCandidate = null;
        let terminalCandidate = null;
        const trackingKey = `${symbol}:${tf}`;
        const tracked = trackedStructures.get(trackingKey);
        if (tracked && tracked.type !== expectedBias) {
            console.log(
                `[${symbol}] Clearing tracked ${tf} ${tracked.type.toUpperCase()} structure: ` +
                `current trend bias is ${expectedBias.toUpperCase()}.`
            );
            trackedStructures.delete(trackingKey);
        }
        const result = detectPatterns(
            candles,
            expectedBias,
            ({
                type,
                stage,
                leftShoulderPrice,
                leftShoulderTime,
                leftNeckPrice,
                leftNeckTime,
                headPrice,
                headTime,
                rightNeckPrice,
                rightNeckTime,
                rightShoulderPrice,
                rightShoulderTime,
                formingRightShoulder,
                invalidationPrice,
                invalidationTime,
                ageCandles,
                maxAgeCandles
            }) => {
                if (stage === "geometry") {
                    geometryFound = true;
                    geometryCandidate = {
                        headTime,
                        rightShoulderTime,
                        headPrice,
                        type
                    };
                    console.log(
                        `🔎 [${symbol}] ${tf} ${type.toUpperCase()} geometry candidate; ` +
                        `Pivots oldest→newest (times UTC): ` +
                        `LS ${leftShoulderPrice} @ ${new Date(leftShoulderTime).toISOString()} | ` +
                        `LN ${leftNeckPrice} @ ${new Date(leftNeckTime).toISOString()} | ` +
                        `Head ${headPrice} @ ${new Date(headTime).toISOString()} | ` +
                        `RN ${rightNeckPrice} @ ${new Date(rightNeckTime).toISOString()} | ` +
                        `RS ${rightShoulderPrice} @ ${new Date(rightShoulderTime).toISOString()}` +
                        `${formingRightShoulder ? " (forming)" : ""}.`
                    );
                } else if (stage === "invalidated") {
                    terminalCandidate = {
                        headTime,
                        rightShoulderTime,
                        stage
                    };
                    console.log(
                        `❌ [${symbol}] ${tf} ${type.toUpperCase()} setup invalidated: ` +
                        `price ${invalidationPrice} moved ${type === "sell" ? "above" : "below"} ` +
                        `the head at ${headPrice} on ${new Date(invalidationTime).toISOString()}. ` +
                        `Older structures will not be considered.`
                    );
                } else if (stage === "stale") {
                    terminalCandidate = {
                        headTime,
                        rightShoulderTime,
                        stage
                    };
                    console.log(
                        `⌛ [${symbol}] ${tf} ${type.toUpperCase()} structure expired: ` +
                        `right shoulder is ${ageCandles} ${tf} candles old ` +
                        `(maximum ${maxAgeCandles} ${tf} candles). Older structures will not be considered.`
                    );
                }
            }
        );
        const currentTracked = trackedStructures.get(trackingKey);
        let selected = currentTracked;

        if (
            geometryCandidate &&
            (!currentTracked || geometryCandidate.rightShoulderTime > currentTracked.rightShoulderTime)
        ) {
            if (result) {
                if (currentTracked) {
                    console.log(
                        `[${symbol}] ${tf} replacing monitored ${currentTracked.type.toUpperCase()} structure ` +
                        `(right shoulder ${new Date(currentTracked.rightShoulderTime).toISOString()}) with newer ` +
                        `${result.type.toUpperCase()} structure ` +
                        `(right shoulder ${new Date(result.rightShoulderTime).toISOString()}).`
                    );
                } else {
                    console.log(
                        `[${symbol}] ${tf} locking ${result.type.toUpperCase()} structure ` +
                        `(right shoulder ${new Date(result.rightShoulderTime).toISOString()}) for monitoring.`
                    );
                }
                trackedStructures.set(trackingKey, result);
                selected = result;
            } else {
                trackedStructures.delete(trackingKey);
                selected = null;
            }
        } else if (
            currentTracked &&
            terminalCandidate?.rightShoulderTime === currentTracked.rightShoulderTime
        ) {
            trackedStructures.delete(trackingKey);
            selected = null;
        } else if (result && currentTracked?.rightShoulderTime === result.rightShoulderTime) {
            const sameCandidate = currentTracked.headTime === result.headTime &&
                currentTracked.type === result.type;
            const formingShoulderExtended = result.formingRightShoulder &&
                (result.type === "sell"
                    ? result.rightShoulderPrice > currentTracked.rightShoulderPrice
                    : result.rightShoulderPrice < currentTracked.rightShoulderPrice);
            if (sameCandidate && formingShoulderExtended) {
                trackedStructures.set(trackingKey, result);
                selected = result;
                console.log(
                    `[${symbol}] ${tf} forming right shoulder extended to ${result.rightShoulderPrice}; ` +
                    `updated provisional stop to ${result.sl}.`
                );
            } else if (sameCandidate && currentTracked.formingRightShoulder && !result.formingRightShoulder) {
                trackedStructures.set(trackingKey, result);
                selected = result;
                console.log(
                    `[${symbol}] ${tf} right shoulder confirmed at ${result.rightShoulderPrice}; ` +
                    `locked stop ${result.sl}.`
                );
            } else {
                selected = currentTracked;
            }
        } else if (!currentTracked && result) {
            trackedStructures.set(trackingKey, result);
            selected = result;
            console.log(
                `[${symbol}] ${tf} locking ${result.type.toUpperCase()} structure ` +
                `(right shoulder ${new Date(result.rightShoulderTime).toISOString()}) for monitoring.`
            );
        }

        if (selected) {
            const ageCandles = Math.floor(
                Math.max(0, candles[0].time - selected.rightShoulderTime) /
                TIMEFRAME_MILLISECONDS[tf]
            );
            const invalidationCandle = candles.find(candle =>
                candle.time > selected.rightShoulderTime &&
                (selected.type === "sell"
                    ? candle.high > selected.headPrice
                    : candle.low < selected.headPrice)
            );
            if (ageCandles > STRUCTURE_MAX_AGE_CANDLES) {
                console.log(
                    `⌛ [${symbol}] ${tf} monitored structure expired: right shoulder is ` +
                    `${ageCandles} ${tf} candles old (maximum ${STRUCTURE_MAX_AGE_CANDLES}).`
                );
                trackedStructures.delete(trackingKey);
                selected = null;
            } else if (invalidationCandle) {
                console.log(
                    `❌ [${symbol}] ${tf} monitored structure invalidated: price ` +
                    `${selected.type === "sell" ? invalidationCandle.high : invalidationCandle.low} ` +
                    `crossed the head ${selected.type === "sell" ? "above" : "below"} ` +
                    `${selected.headPrice} on ${new Date(invalidationCandle.time).toISOString()}.`
                );
                trackedStructures.delete(trackingKey);
                selected = null;
            }
        }

        if (selected) {
            detectedSetups[tf] = selected;
            console.log(
                `✅ [${symbol}] ${tf} ${selected.type.toUpperCase()} monitored structure: ` +
                `head ${selected.headTime}; neckline ${selected.necklineStartPrice} → ` +
                `${selected.necklineEndPrice}; stop ${selected.sl}; measured move ${selected.measuredMove}` +
                `${selected.formingRightShoulder ? "; right shoulder is forming" : ""}.`
            );
        } else if (!geometryFound) {
            console.log(
                `ℹ️ [${symbol}] No ${expectedBias.toUpperCase()} H&S geometry found on ${tf}; ` +
                `opposite-bias patterns are ignored.`
            );
        }
    }

    const acceptedTFs = Object.keys(detectedSetups);
    if (acceptedTFs.length === 0) {
        console.log(`[${symbol}] No accepted structural setup; no entry or stop levels will be used.`);
        return null;
    }

    // ── 3. Multi-TF alignment: all detected TFs must agree on direction ───────
    const detectedTypes = Object.values(detectedSetups).map(s => s.type);
    if (detectedTypes.length > 1 && new Set(detectedTypes).size > 1) {
        console.log(
            `❌ [${symbol}] Multi-TF conflict: detected timeframes disagree on direction ` +
            `(${Object.entries(detectedSetups).map(([tf, s]) => `${tf}="${s.type}"`).join(", ")}). ` +
            `Setup rejected; no levels will be used.`
        );
        return null;
    }

    // Higher timeframes own levels when multiple structures agree.
    // Priority: 1D > 4H > 1H.
    const structuralTF = detectedSetups["1D"] ? "1D"
        : detectedSetups["4H"] ? "4H"
        : "1H";
    const structuralSetup = detectedSetups[structuralTF];
    const contextNote = acceptedTFs.length > 1
        ? `; ${acceptedTFs.filter(tf => tf !== structuralTF).join(" + ")} provide context only`
        : "";
    console.log(
        `[${symbol}] Selected ${structuralTF} ${structuralSetup.type.toUpperCase()} structure for entry/SL/TP levels${contextNote}. ` +
        `Neckline ${structuralSetup.necklineStartPrice} → ${structuralSetup.necklineEndPrice}; ` +
        `SL ${structuralSetup.sl}; measured move ${structuralSetup.measuredMove}.`
    );

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
        structuralTF,
        stage
    });

    // ── 4. Breakout Trigger — require a fresh candle close across the neckline ─
    // For 1H structural patterns use 15m breakout candles; for 4H/1D use 1H.
    const breakoutTF    = BREAKOUT_TF_FOR_STRUCTURAL[structuralTF] ?? "1H";
    const breakoutTFMs  = BREAKOUT_TF_MILLISECONDS[breakoutTF];
    const rawBreakoutCandles = candleData[breakoutTF];
    const closedBreakoutCandles = (rawBreakoutCandles || [])
        .filter(candle => Number.isFinite(candle.time) && candle.time + breakoutTFMs <= Date.now())
        .slice(0, 200);
    if (closedBreakoutCandles.length < 2) {
        console.log(`⏳ [${symbol}] Waiting: fewer than two fully closed ${breakoutTF} candles are available.`);
        reportPatternState("waiting-data");
        return null;
    }

    const lastClosedBreakout     = closedBreakoutCandles[0];
    const previousClosedBreakout = closedBreakoutCandles[1];
    const oldestClosedBreakout   = closedBreakoutCandles[closedBreakoutCandles.length - 1];
    if (structuralSetup.rightShoulderTime < oldestClosedBreakout.time) {
        console.log(
            `⏭️ [${symbol}] No entry: the right-shoulder setup predates the available ${breakoutTF} breakout history; ` +
            `whether its first break was missed cannot be verified.`
        );
        reportPatternState("breakout-history-insufficient");
        return null;
    }

    const previousBreakout = closedBreakoutCandles
        .slice(1)
        .find(candle => {
            if (candle.time < structuralSetup.rightShoulderTime) return false;
            const threshold = getBreakoutLevel(
                structuralSetup,
                candle.time + breakoutTFMs,
                breakoutBuffer
            );
            return isBeyondNeckline(candle.close, threshold, structuralSetup.type);
        });
    if (previousBreakout) {
        const breakoutCheckTime = previousBreakout.time + breakoutTFMs;
        const breakoutNeckline  = getNecklineAtTime(structuralSetup, breakoutCheckTime);
        const breakoutThreshold = getBreakoutLevel(structuralSetup, breakoutCheckTime, breakoutBuffer);
        console.log(
            `⏭️ [${symbol}] No late entry: ${structuralTF} ${structuralSetup.type.toUpperCase()} ` +
            `setup head ${new Date(structuralSetup.headTime).toISOString()} had a prior ${breakoutTF} close beyond ` +
            `its projected neckline | Candle: ${new Date(previousBreakout.time).toISOString()} ` +
            `close ${previousBreakout.close} | Neckline ${breakoutNeckline} | ` +
            `${structuralSetup.type.toUpperCase()} threshold ${breakoutThreshold} ` +
            `(buffer ${breakoutBuffer}).`
        );
        reportPatternState("breakout-missed");
        return null;
    }

    const previousCheckTime   = previousClosedBreakout.time + breakoutTFMs;
    const latestCheckTime     = lastClosedBreakout.time     + breakoutTFMs;
    const previousNeckline    = getNecklineAtTime(structuralSetup, previousCheckTime);
    const latestNeckline      = getNecklineAtTime(structuralSetup, latestCheckTime);
    const previousBreakoutLevel = getBreakoutLevel(structuralSetup, previousCheckTime, breakoutBuffer);
    const breakoutLevel         = getBreakoutLevel(structuralSetup, latestCheckTime,   breakoutBuffer);
    const breakoutConfirmed = checkNecklineBreakout(
        previousClosedBreakout.close,
        lastClosedBreakout.close,
        previousBreakoutLevel,
        breakoutLevel,
        structuralSetup.type
    );
    if (!breakoutConfirmed) {
        console.log(
            `⏳ [${symbol}] Waiting: no fresh ${breakoutTF} close cleared the sloped neckline by ${breakoutBuffer} ` +
            `| Previous ${breakoutTF} check: neckline ${previousNeckline}, ` +
            `${structuralSetup.type === "sell" ? "SELL" : "BUY"} threshold ${previousBreakoutLevel}, ` +
            `close ${previousClosedBreakout.close} | ` +
            `Latest ${breakoutTF} check: neckline ${latestNeckline}, ` +
            `${structuralSetup.type === "sell" ? "SELL" : "BUY"} threshold ${breakoutLevel}, ` +
            `close ${lastClosedBreakout.close}.`
        );
        reportPatternState("waiting-breakout");
        return null;
    }

    const entryPrice = lastClosedBreakout.close;
    const necklineAtBreakout = getNecklineAtTime(
        structuralSetup,
        lastClosedBreakout.time + breakoutTFMs
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
        `✅ [${symbol}] First ${breakoutTF} close beyond sloped neckline by ${breakoutBuffer} — Structure: ${activeTFs.join(" + ")} | ` +
        `Entry/SL/TP source: ${structuralTF} | Breakout TF: ${breakoutTF} | Entry: ${entryPrice} | ` +
        `SL: ${structuralSetup.sl} | TP: ${tp} | RR: ${rr.toFixed(2)}`
    );

    return {
        type:         structuralSetup.type,
        label:        `${structuralSetup.label} (${structuralTF} levels / ${breakoutTF} trigger)`,
        pair:         symbol,
        sl:           structuralSetup.sl,
        tp,
        entryPrice,
        structuralTF,
        breakoutTF,
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

// ─── Neckline Breakout Check ─────────────────────────────────────────────────

/**
 * A breakout requires a candle close beyond the far edge of the neckline region.
 * Works for any breakout timeframe (1H for 4H/1D structures, 15m for 1H structures).
 */
function checkNecklineBreakout(previousClose, latestClose, previousBoundary, latestBoundary, type) {
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
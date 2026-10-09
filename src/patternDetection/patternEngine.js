import { detectPatterns } from "./headShoulders.js";

const trackedStructures = new Map();
const STRUCTURE_MAX_AGE_CANDLES = 24;
const TIMEFRAME_MILLISECONDS = { "4H": 4 * 60 * 60 * 1000, "1D": 24 * 60 * 60 * 1000 };

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

    // ── 3. Multi-TF alignment: if both 4H and 1D detected, they must agree ───
    if (detectedSetups["4H"] && detectedSetups["1D"]) {
        if (detectedSetups["4H"].type !== detectedSetups["1D"].type) {
            console.log(
                `❌ [${symbol}] Multi-TF conflict: 4H is "${detectedSetups["4H"].type}" ` +
                `but 1D is "${detectedSetups["1D"].type}". Setup rejected; no levels will be used.`
            );
            return null;
        }
    }

    // The smaller structural timeframe owns levels whenever both are accepted.
    const structuralTF = detectedSetups["4H"] ? "4H" : "1D";
    const structuralSetup = detectedSetups[structuralTF];
    console.log(
        `[${symbol}] Selected ${structuralTF} ${structuralSetup.type.toUpperCase()} structure for entry/SL/TP levels` +
        `${acceptedTFs.length > 1 ? `; 1D is context only, 4H levels take precedence` : ""}. ` +
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
        .find(candle => {
            if (candle.time < structuralSetup.rightShoulderTime) return false;
            const threshold = getBreakoutLevel(
                structuralSetup,
                candle.time + oneHourMs,
                breakoutBuffer
            );
            return isBeyondNeckline(candle.close, threshold, structuralSetup.type);
        });
    if (previousBreakout) {
        const breakoutCheckTime = previousBreakout.time + oneHourMs;
        const breakoutNeckline = getNecklineAtTime(structuralSetup, breakoutCheckTime);
        const breakoutThreshold = getBreakoutLevel(
            structuralSetup,
            breakoutCheckTime,
            breakoutBuffer
        );
        console.log(
            `⏭️ [${symbol}] No late entry: ${structuralTF} ${structuralSetup.type.toUpperCase()} ` +
            `setup head ${new Date(structuralSetup.headTime).toISOString()} had a prior 1H close beyond ` +
            `its projected neckline | Candle: ${new Date(previousBreakout.time).toISOString()} ` +
            `close ${previousBreakout.close} | Neckline ${breakoutNeckline} | ` +
            `${structuralSetup.type.toUpperCase()} threshold ${breakoutThreshold} ` +
            `(buffer ${breakoutBuffer}).`
        );
        reportPatternState("breakout-missed");
        return null;
    }

    const previousCheckTime = previousClosedH1.time + oneHourMs;
    const latestCheckTime = lastClosedH1.time + oneHourMs;
    const previousNeckline = getNecklineAtTime(structuralSetup, previousCheckTime);
    const latestNeckline = getNecklineAtTime(structuralSetup, latestCheckTime);
    const previousBreakoutLevel = getBreakoutLevel(structuralSetup, previousCheckTime, breakoutBuffer);
    const breakoutLevel = getBreakoutLevel(structuralSetup, latestCheckTime, breakoutBuffer);
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
            `| Previous 1H check: neckline ${previousNeckline}, ` +
            `${structuralSetup.type === "sell" ? "SELL" : "BUY"} threshold ${previousBreakoutLevel}, ` +
            `close ${previousClosedH1.close} | ` +
            `Latest 1H check: neckline ${latestNeckline}, ` +
            `${structuralSetup.type === "sell" ? "SELL" : "BUY"} threshold ${breakoutLevel}, ` +
            `close ${lastClosedH1.close}.`
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
        `Entry/SL/TP source: ${structuralTF} | Entry: ${entryPrice} | ` +
        `SL: ${structuralSetup.sl} | TP: ${tp} | RR: ${rr.toFixed(2)}`
    );

    return {
        type:         structuralSetup.type,
        label:        `${structuralSetup.label} (${structuralTF} levels / 1H trigger)`,
        pair:         symbol,
        sl:           structuralSetup.sl,
        tp,
        entryPrice,
        structuralTF,
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
import { detectPatterns } from "./headShoulders.js";
import { selectTakeProfit } from "./targetSelection.js";
import { calculateADX } from "./utils.js";

const trackedStructures = new Map();
const STRUCTURE_MAX_AGE_CANDLES = 168;
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

export function getPendingHourlyStructures() {
    return [...trackedStructures.entries()]
        .filter(([key, setup]) => key.endsWith(":1H") && setup.monitoringState === "pending")
        .map(([key, setup]) => ({
            symbol: key.slice(0, -3),
            setup
        }));
}

export function setHourlyStructureMonitoringState(symbol, headTime, state, capBlocked = false) {
    const setup = trackedStructures.get(`${symbol}:1H`);
    if (!setup || setup.headTime !== headTime) return;
    setup.monitoringState = state;
    setup.capBlocked = capBlocked;
    if (state === "pending" && !capBlocked) {
        setup.pendingBreakoutCandle = null;
    }
}

export function pauseHourlyStructureMonitoring(symbol) {
    const setup = trackedStructures.get(`${symbol}:1H`);
    if (setup?.monitoringState === "pending") {
        setup.monitoringState = "bias-unavailable";
    }
}

export function checkPendingHourlyBreakout(symbol, closedCandles, breakoutBuffer, minimumRR) {
    const setup = trackedStructures.get(`${symbol}:1H`);
    if (!setup || setup.monitoringState !== "pending") return null;

    const breakoutTFMs = BREAKOUT_TF_MILLISECONDS["15m"];
    const candles = (Array.isArray(closedCandles) ? closedCandles : [])
        .filter(candle => Number.isFinite(candle.time) && Number.isFinite(candle.close))
        .sort((a, b) => a.time - b.time);
    let previousCandle = setup.lastBreakoutCandle;
    if (!previousCandle) return null;

    if (setup.firstBreakoutTime && hasNecklineRecrossAfterBreakout(
        setup,
        candles,
        setup.firstBreakoutTime,
        breakoutTFMs
    )) {
        setup.monitoringState = "neckline-recrossed";
        setup.pendingBreakoutCandle = null;
        console.log(
            `❌ [${symbol}] 1H structure invalidated: a closed 15m candle returned across the neckline ` +
            `after its first breakout; no re-entry will be taken.`
        );
        return null;
    }

    if (setup.pendingBreakoutCandle) {
        const pending = setup.pendingBreakoutCandle;
        setup.firstBreakoutTime ??= pending.time;
        const level = getBreakoutLevel(setup, pending.time + breakoutTFMs, breakoutBuffer);
        const pattern = buildHourlyBreakoutPattern(
            symbol, setup, pending, level, minimumRR
        );
        return pattern;
    }

    for (const candle of candles) {
        if (candle.time <= previousCandle.time) continue;
        if (previousCandle.time >= setup.rightShoulderTime) {
            const previousLevel = getBreakoutLevel(
                setup, previousCandle.time + breakoutTFMs, breakoutBuffer
            );
            const level = getBreakoutLevel(setup, candle.time + breakoutTFMs, breakoutBuffer);
            if (checkNecklineBreakout(
                previousCandle.close,
                candle.close,
                previousLevel,
                level,
                setup.type
            )) {
                setup.lastBreakoutCandle = candle;
                previousCandle = candle;
                setup.firstBreakoutTime ??= candle.time;
                const pattern = buildHourlyBreakoutPattern(
                    symbol, setup, candle, level, minimumRR
                );
                if (pattern) return pattern;
                continue;
            }
        }
        setup.lastBreakoutCandle = candle;
        previousCandle = candle;
    }
    return null;
}

function buildHourlyBreakoutPattern(symbol, setup, candle, breakoutLevel, minimumRR) {
    const stopLoss = setup.sl;
    const breakoutNeckline = getNecklineAtTime(
        setup,
        candle.time + BREAKOUT_TF_MILLISECONDS["15m"]
    );
    const entryPrice = candle.close;
    const measuredMoveTarget = setup.type === "sell"
        ? breakoutNeckline - setup.measuredMove
        : breakoutNeckline + setup.measuredMove;
    const risk = setup.type === "sell" ? stopLoss - entryPrice : entryPrice - stopLoss;
    const target = selectTakeProfit({
        side: setup.type,
        entryPrice,
        stopLoss,
        measuredMoveTarget,
        minimumRR,
        onDiagnostic: diagnostic => logTargetDiagnostic(symbol, diagnostic)
    });
    const tp = target?.tp;
    const rr = target?.actualRR ?? NaN;
    const reward = setup.type === "sell" ? entryPrice - tp : tp - entryPrice;

    if (!(risk > 0) || !(reward > 0) || !Number.isFinite(rr) || rr < minimumRR) {
        console.log(
            `❌ [${symbol}] REJECTED: Pattern target does not meet minimum RR ${minimumRR} | ` +
            `Entry: ${entryPrice} | SL: ${stopLoss} | Measured move: ${measuredMoveTarget} | Risk: ${risk}`
        );
        return null;
    }

    setup.pendingBreakoutCandle = candle;
    console.log(
        `✅ [${symbol}] 15m candle crossed the neckline — Structure: 1H | ` +
        `Candle: ${new Date(candle.time).toISOString()} | Entry: ${entryPrice} | ` +
        `Breakout neckline: ${breakoutNeckline} | ` +
        `Threshold: ${breakoutLevel} | SL: ${stopLoss} | ` +
        `TP: ${tp} (${target.source}${target.timeframe ? ` ${target.timeframe}` : ""}) | RR: ${rr.toFixed(2)}`
    );
    return {
        type: setup.type,
        label: `${setup.label} (1H breakout / levels / 15m trigger)`,
        pair: symbol,
        sl: stopLoss,
        tp,
        targetSource: target.source,
        stopLossTF: "1H",
        targetTF: "1H",
        entryPrice,
        structuralTF: "1H",
        breakoutTF: "15m",
        breakoutNeckline: breakoutLevel,
        breakoutTime: candle.time,
        targetRR: rr,
        necklineHigh: setup.necklineHigh,
        necklineLow: setup.necklineLow,
        headTime: setup.headTime || Date.now(),
        activeTFs: ["1H"],
        timestamp: Date.now()
    };
}

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
        minimumRR = 2,
        deferHourlyBreakouts = false,
        excludedStructuralTFs = []
    } = {}
) {
    if (expectedBias !== "buy" && expectedBias !== "sell") {
        console.log(`⚠️ [${symbol}] Pattern detection skipped: directional trend bias is required.`);
        return null;
    }

    // ── 1. Structural detection on 1D and 4H ─────────────────────────────────
    const structuralTFs = ["1D", "4H"];
    let detectedSetups  = {};

    for (const tf of structuralTFs) {
        if (excludedStructuralTFs.includes(tf)) continue;
        const candles = candleData[tf];
        if (!candles || candles.length < 200) {
            console.log(
                `⚠️ [${symbol}] ${tf} structure scan skipped: ` +
                `${candles?.length ?? 0} candles available; 200 required.`
            );
            continue;
        }

        const adxValue = calculateADX(candles);
        if (Number.isFinite(adxValue) && adxValue < 20) {
            console.log(
                `⚠️ [${symbol}] ${tf} structure scan skipped: ADX ${adxValue.toFixed(1)} is below 20 — market is consolidating.`
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
            },
            breakoutBuffer
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
            if (selected.monitoringState === "neckline-recrossed") {
                selected = null;
            }
        }

        if (selected) {
            const ageCandles = Math.floor(
                Math.max(0, candles[0].time - selected.rightShoulderTime) /
                TIMEFRAME_MILLISECONDS[tf]
            );
            const invalidationCandle = candles.find(candle =>
                candle.time > selected.rightShoulderTime &&
                (selected.type === "sell"
                    ? candle.close > selected.headPrice
                    : candle.close < selected.headPrice)
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
                    `${invalidationCandle.close} ` +
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
        const hourlySetup = trackedStructures.get(`${symbol}:1H`);
        if (hourlySetup?.monitoringState === "pending") {
            hourlySetup.monitoringState = "multi-timeframe-conflict";
        }
        console.log(
            `❌ [${symbol}] Multi-TF conflict: detected timeframes disagree on direction ` +
            `(${Object.entries(detectedSetups).map(([tf, s]) => `${tf}="${s.type}"`).join(", ")}). ` +
            `Setup rejected; no levels will be used.`
        );
        return null;
    }

    const activeTFs = Object.keys(detectedSetups);
    const structuralTF = activeTFs.length > 1
        ? pickEarliestBreakoutTF(activeTFs, detectedSetups, candleData, breakoutBuffer)
        : activeTFs[0];
    const structuralSetup = detectedSetups[structuralTF];
    const stopLoss = structuralSetup.sl;
    const stopLossTF = structuralTF;
    const targetSetup = structuralSetup;
    const targetTF = structuralTF;
    for (const [timeframe, setup] of Object.entries(detectedSetups)) {
        setup.structuralTF = timeframe;
    }
    if (activeTFs.length > 1) {
        console.log(
            `[${symbol}] Multi-TF setup confirmed (${activeTFs.join(" + ")}); monitoring all accepted structures. ` +
            `The first neckline breakout triggers a trade using that structure's own stop and target levels.`
        );
    }
    const contextNote = activeTFs.length > 1
        ? `; monitoring ${activeTFs.join(" + ")}; first neckline break wins`
        : "";
    console.log(
        `[${symbol}] Selected ${structuralTF} ${structuralSetup.type.toUpperCase()} structure for breakout; ` +
        `using ${structuralTF} levels${contextNote}. ` +
        `Neckline ${structuralSetup.necklineStartPrice} → ${structuralSetup.necklineEndPrice}; ` +
        `SL ${stopLoss}; measured move ${targetSetup.measuredMove}.`
    );

    if (expectedBias && structuralSetup.type !== expectedBias) {
        console.log(
            `⚠️ [${symbol}] Pattern rejected: ${structuralSetup.type.toUpperCase()} setup ` +
            `conflicts with Bias (${expectedBias.toUpperCase()}).`
        );
        return null;
    }

    const reportPatternState = (stage, breakoutCandle = null) => {
        const tracked = trackedStructures.get(`${symbol}:${structuralTF}`);
        if (tracked?.headTime === structuralSetup.headTime) {
            if (stage === "waiting-breakout" || stage === "waiting-data") {
                tracked.monitoringState = "pending";
                const latestClosed = (rawBreakoutCandles || []).find(candle =>
                    Number.isFinite(candle.time) &&
                    candle.time + breakoutTFMs <= Date.now()
                );
                if (latestClosed && (
                    !tracked.lastBreakoutCandle ||
                    latestClosed.time > tracked.lastBreakoutCandle.time
                )) {
                    tracked.lastBreakoutCandle = latestClosed;
                }
                if (breakoutCandle) tracked.pendingBreakoutCandle = breakoutCandle;
            } else if (stage === "breakout-missed" && tracked.capBlocked) {
                tracked.monitoringState = "pending";
                const latestClosed = (rawBreakoutCandles || []).find(candle =>
                    Number.isFinite(candle.time) &&
                    candle.time + breakoutTFMs <= Date.now()
                );
                if (latestClosed && (
                    !tracked.lastBreakoutCandle ||
                    latestClosed.time > tracked.lastBreakoutCandle.time
                )) {
                    tracked.lastBreakoutCandle = latestClosed;
                }
            } else if (stage === "breakout-confirmed" && structuralTF === "1H" && deferHourlyBreakouts) {
                tracked.monitoringState = "pending";
                tracked.firstBreakoutTime ??= breakoutCandle?.time;
                tracked.lastBreakoutCandle = (rawBreakoutCandles || []).find(candle =>
                    Number.isFinite(candle.time) &&
                    candle.time + breakoutTFMs <= Date.now()
                ) || tracked.lastBreakoutCandle;
                tracked.pendingBreakoutCandle = breakoutCandle;
            } else if (
                (stage === "rr-rejected" || stage === "invalid-levels") &&
                structuralTF === "1H" &&
                deferHourlyBreakouts
            ) {
                tracked.monitoringState = "pending";
                tracked.lastBreakoutCandle = (rawBreakoutCandles || []).find(candle =>
                    Number.isFinite(candle.time) &&
                    candle.time + breakoutTFMs <= Date.now()
                ) || tracked.lastBreakoutCandle;
                tracked.pendingBreakoutCandle = null;
            } else {
                tracked.monitoringState = stage;
            }
        }
        onPatternDetected?.({
            type: structuralSetup.type,
            activeTFs,
            structuralTF,
            stage
        });
    };
    const rejectAndTryNextSetup = (stage) => {
        reportPatternState(stage);
        const nextExcludedTFs = [...new Set([...excludedStructuralTFs, structuralTF])];
        console.log(
            `↪️ [${symbol}] ${structuralTF} setup ${stage}; checking the next available timeframe setup.`
        );
        return runDetection(
            candleData,
            symbol,
            expectedBias,
            onPatternDetected,
            {
                breakoutBuffer,
                minimumRR,
                deferHourlyBreakouts,
                excludedStructuralTFs: nextExcludedTFs
            }
        );
    };

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

    let lastClosedBreakout     = closedBreakoutCandles[0];
    let previousClosedBreakout = closedBreakoutCandles[1];
    const oldestClosedBreakout   = closedBreakoutCandles[closedBreakoutCandles.length - 1];
    if (structuralSetup.rightShoulderTime < oldestClosedBreakout.time) {
        console.log(
            `⏭️ [${symbol}] No entry: the right-shoulder setup predates the available ${breakoutTF} breakout history; ` +
            `whether its first break was missed cannot be verified.`
        );
        return rejectAndTryNextSetup("breakout-history-insufficient");
    }

    let detectedHistoricalCross = false;
    for (let index = closedBreakoutCandles.length - 2; index >= 0; index--) {
        const newer = closedBreakoutCandles[index];
        const older = closedBreakoutCandles[index + 1];
        if (newer.time < structuralSetup.rightShoulderTime) continue;
        const olderLevel = getBreakoutLevel(
            structuralSetup,
            older.time + breakoutTFMs,
            breakoutBuffer
        );
        const newerLevel = getBreakoutLevel(
            structuralSetup,
            newer.time + breakoutTFMs,
            breakoutBuffer
        );
        if (checkNecklineBreakout(
            older.close,
            newer.close,
            olderLevel,
            newerLevel,
            structuralSetup.type
        )) {
            lastClosedBreakout = newer;
            previousClosedBreakout = older;
            detectedHistoricalCross = true;
            break;
        }
    }

    if (!detectedHistoricalCross) {
        const previousLevel = getBreakoutLevel(
            structuralSetup,
            previousClosedBreakout.time + breakoutTFMs,
            breakoutBuffer
        );
        const latestLevel = getBreakoutLevel(
            structuralSetup,
            lastClosedBreakout.time + breakoutTFMs,
            breakoutBuffer
        );
        console.log(
            `⏳ [${symbol}] Waiting for a ${breakoutTF} close to cross the sloped neckline | ` +
            `Previous close: ${previousClosedBreakout.close} (threshold ${previousLevel}) | ` +
            `Latest close: ${lastClosedBreakout.close} (threshold ${latestLevel}).`
        );
        reportPatternState("waiting-breakout");
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

    const trackedBreakout = trackedStructures.get(`${symbol}:${structuralTF}`);
    if (trackedBreakout?.headTime === structuralSetup.headTime) {
        trackedBreakout.firstBreakoutTime ??= lastClosedBreakout.time;
    }

    const firstBreakoutTime = structuralSetup.firstBreakoutTime ?? lastClosedBreakout.time;
    const candlesSinceBreakout = closedBreakoutCandles.filter(candle =>
        candle.time >= firstBreakoutTime
    );

    if (hasNecklineRecrossAfterBreakout(
        structuralSetup,
        candlesSinceBreakout,
        lastClosedBreakout.time,
        breakoutTFMs
    )) {
        console.log(
            `❌ [${symbol}] ${structuralTF} structure invalidated: a closed ${breakoutTF} candle ` +
            `returned across the neckline after its first breakout; no re-entry will be taken.`
        );
        return rejectAndTryNextSetup("neckline-recrossed");
    }

    const entryPrice = lastClosedBreakout.close;
    const targetNecklineAtBreakout = getNecklineAtTime(
        targetSetup,
        lastClosedBreakout.time + breakoutTFMs
    );
    const measuredMoveTarget = structuralSetup.type === "sell"
        ? targetNecklineAtBreakout - targetSetup.measuredMove
        : targetNecklineAtBreakout + targetSetup.measuredMove;
    const target = selectTakeProfit({
        side: structuralSetup.type,
        entryPrice,
        stopLoss,
        measuredMoveTarget,
        minimumRR,
        onDiagnostic: diagnostic => logTargetDiagnostic(symbol, diagnostic)
    });
    const tp = target?.tp;
    const risk = structuralSetup.type === "sell"
        ? stopLoss - entryPrice
        : entryPrice - stopLoss;
    const reward = structuralSetup.type === "sell"
        ? entryPrice - tp
        : tp - entryPrice;
    const rr = target?.actualRR ?? NaN;

    if (!(risk > 0) || !(reward > 0) || !Number.isFinite(rr) || rr < minimumRR) {
        console.log(
            `❌ [${symbol}] REJECTED: No valid target with minimum RR ${minimumRR} | ` +
            `Entry: ${entryPrice} | SL: ${stopLoss} (${stopLossTF}) | ` +
            `Measured move: ${measuredMoveTarget} | Risk: ${risk}`
        );
        return rejectAndTryNextSetup(risk > 0 ? "rr-rejected" : "invalid-levels");
    }

    const slBreached = candlesSinceBreakout.find(candle =>
        structuralSetup.type === "sell"
            ? candle.close >= stopLoss
            : candle.close <= stopLoss
    );
    if (slBreached) {
        console.log(
            `❌ [${symbol}] REJECTED: Stop loss was breached after breakout | ` +
            `Candle: ${new Date(slBreached.time).toISOString()} | ` +
            `Breach close: ${slBreached.close} | ` +
            `SL: ${stopLoss} (${stopLossTF})`
        );
        return rejectAndTryNextSetup("invalid-levels");
    }

    const tpReached = candlesSinceBreakout.find(candle =>
        structuralSetup.type === "sell"
            ? candle.close <= tp
            : candle.close >= tp
    );
    if (tpReached) {
        console.log(
            `ℹ️ [${symbol}] REJECTED: Selected TP already reached after breakout | ` +
            `Candle: ${new Date(tpReached.time).toISOString()} | ` +
            `Close: ${tpReached.close} | ` +
            `TP: ${tp}`
        );
        return rejectAndTryNextSetup("breakout-missed");
    }
    // ── 6. Build final setup ──────────────────────────────────────────────────
    reportPatternState("breakout-confirmed", lastClosedBreakout);
    console.log(
        `✅ [${symbol}] First ${breakoutTF} close beyond sloped neckline by ${breakoutBuffer} — Structure: ${activeTFs.join(" + ")} | ` +
        `Breakout/SL/TP source: ${structuralTF} | ` +
        `Breakout TF: ${breakoutTF} | Entry: ${entryPrice} | ` +
        `SL: ${stopLoss} | TP: ${tp} (${target.source}${target.timeframe ? ` ${target.timeframe}` : ""}) | ` +
        `RR: ${rr.toFixed(2)}`
    );

    return {
        type:         structuralSetup.type,
        label:        `${structuralSetup.label} (${structuralTF} breakout / ${stopLossTF} SL / ${targetTF} TP)`,
        pair:         symbol,
        sl:           stopLoss,
        tp,
        targetSource: target.source,
        stopLossTF,
        targetTF,
        entryPrice,
        structuralTF,
        breakoutTF,
        breakoutNeckline: breakoutLevel,
        breakoutTime: lastClosedBreakout.time,
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
function pickEarliestBreakoutTF(activeTFs, detectedSetups, candleData, breakoutBuffer) {
    const candidates = activeTFs
        .map(tf => {
            const setup = detectedSetups[tf];
            const breakoutTF = BREAKOUT_TF_FOR_STRUCTURAL[tf] ?? "1H";
            const breakoutTFMs = BREAKOUT_TF_MILLISECONDS[breakoutTF] ?? BREAKOUT_TF_MILLISECONDS["1H"];
            const candles = (candleData[breakoutTF] || [])
                .filter(candle => Number.isFinite(candle.time) && candle.time + breakoutTFMs <= Date.now())
                .slice(0, 200);
            if (candles.length < 2) return { tf, breakoutTime: Number.POSITIVE_INFINITY };

            for (let index = candles.length - 2; index >= 0; index--) {
                const newer = candles[index];
                const older = candles[index + 1];
                if (newer.time < setup.rightShoulderTime) continue;
                const olderLevel = getBreakoutLevel(setup, older.time + breakoutTFMs, breakoutBuffer);
                const newerLevel = getBreakoutLevel(setup, newer.time + breakoutTFMs, breakoutBuffer);
                if (checkNecklineBreakout(
                    older.close,
                    newer.close,
                    olderLevel,
                    newerLevel,
                    setup.type
                )) {
                    return { tf, breakoutTime: newer.time };
                }
            }

            return { tf, breakoutTime: Number.POSITIVE_INFINITY };
        })
        .filter(candidate => Number.isFinite(candidate.breakoutTime));

    const earliest = candidates.sort((a, b) => a.breakoutTime - b.breakoutTime)[0];
    return earliest?.tf || activeTFs[0];
}

function checkNecklineBreakout(previousClose, latestClose, previousBoundary, latestBoundary, type) {
    if (type === "sell") {
        return previousClose >= previousBoundary && latestClose < latestBoundary;
    }
    return previousClose <= previousBoundary && latestClose > latestBoundary;
}

function isBeyondNeckline(close, boundary, type) {
    return type === "sell" ? close < boundary : close > boundary;
}

export function hasNecklineRecrossAfterBreakout(setup, candles, breakoutTime, timeframeMs) {
    return candles.some(candle =>
        candle.time > breakoutTime &&
        !isBeyondNeckline(
            candle.close,
            getNecklineAtTime(setup, candle.time + timeframeMs),
            setup.type
        )
    );
}

function getBreakoutLevel(setup, time, breakoutBuffer) {
    const neckline = getNecklineAtTime(setup, time);
    return setup.type === "sell"
        ? neckline - breakoutBuffer
        : neckline + breakoutBuffer;
}

export function getNecklineAtTime(setup, time) {
    if (!setup) return 0;
    const elapsed = setup.necklineEndTime - setup.necklineStartTime;
    if (!(elapsed > 0) || time >= setup.necklineEndTime) {
        // Clamp to Right Neckline price once past the Right Neckline pivot to prevent
        // projecting the slope infinitely into the future and dragging thresholds away.
        return setup.necklineEndPrice;
    }
    if (time <= setup.necklineStartTime) {
        return setup.necklineStartPrice;
    }

    const progress = Math.min(1, Math.max(0, (time - setup.necklineStartTime) / elapsed));
    return setup.necklineStartPrice +
        (setup.necklineEndPrice - setup.necklineStartPrice) * progress;
}

function getPipSize(symbol) {
    if (symbol.includes("JPY")) return 0.01;
    if (symbol.includes("XAU") || symbol.includes("GOLD")) return 0.01;
    return 0.0001;
}

function logTargetDiagnostic(symbol, diagnostic) {
    const label = `pattern measured move ${diagnostic.price}`;
    console.log(
        `[${symbol}] TP candidate ${label} | TP: ${diagnostic.tp} | RR: ` +
        `${Number.isFinite(diagnostic.rr) ? diagnostic.rr.toFixed(2) : "invalid"} | ` +
        `${diagnostic.selected ? `SELECTED${diagnostic.detail ? ` (${diagnostic.detail})` : ""}` : `REJECTED: ${diagnostic.reason}`}`
    );
}
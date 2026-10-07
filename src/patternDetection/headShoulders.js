/**
 * headShoulders.js
 * Flexible structural detection for H&S and Inverted H&S patterns.
 *
 * Uses candle timestamps to generate unique patternID fingerprints in index.js,
 * preventing the same pattern from being traded twice across scan cycles.
 *
 * HTF Confluence Rules (applied here, not in patternEngine):
 *  - HEAD must originate near a 1D/1W Resistance (SELL) or Support (BUY) zone.
 *  - The breakout path must have >= 1.0x SL distance of clearance before the
 *    nearest opposing HTF zone.
 */

// ─── HTF Zone Generation ────────────────────────────────────────────────────

/**
 * Generates HTF Support & Resistance zones from a candle array.
 * Uses a wider pivot radius (10 bars) suitable for daily/weekly candles.
 *
 * @param {Array} candles  - Array of candle objects { high, low, close, ... }
 * @returns {{ resistances: number[], supports: number[] }}
 */
export function generateHTFZones(candles) {
    if (!candles || candles.length < 20) return { resistances: [], supports: [] };

    const radius = 10;
    const limit  = candles.length - radius;
    const resistances = [];
    const supports    = [];

    for (let i = radius; i < limit; i++) {
        const window = candles.slice(i - radius, i + radius + 1);
        const windowHighs = window.map(c => c.high);
        const windowLows  = window.map(c => c.low);

        // Swing high → Resistance zone (stored as the candle high)
        if (candles[i].high === Math.max(...windowHighs)) {
            resistances.push(candles[i].high);
        }

        // Swing low → Support zone (stored as the candle low)
        if (candles[i].low === Math.min(...windowLows)) {
            supports.push(candles[i].low);
        }
    }

    return { resistances, supports };
}

// ─── HTF Catalyst Confluence (Head Position) ────────────────────────────────

/**
 * Checks whether a Head peak or valley originated at a qualifying HTF zone.
 *
 * For a SELL setup the head is a peak — it must be near or inside a HTF
 * Resistance level (i.e. head HIGH ≈ resistance, meaning price was rejected
 * from above by that level).
 *
 * For a BUY setup the head is a valley — it must be near or inside a HTF
 * Support level (i.e. head LOW ≈ support, meaning price bounced from below).
 *
 * Proximity tolerance: within 0.3 % of the HTF zone level.
 *
 * @param {number}   headVal    - The head's extreme price (high for sell, low for buy)
 * @param {number[]} htfLevels  - Array of HTF resistance (sell) or support (buy) prices
 * @param {"sell"|"buy"} type
 * @returns {boolean}
 */
function isHeadAtHTFZone(headVal, htfLevels, type) {
    if (!htfLevels || htfLevels.length === 0) return false;
    const tolerancePct = 0.003; // 0.3 %

    for (const level of htfLevels) {
        const tolerance = level * tolerancePct;
        if (type === "sell") {
            // Head peak should be at or just below a resistance level
            if (headVal >= level - tolerance && headVal <= level + tolerance) return true;
        } else {
            // Head valley should be at or just above a support level
            if (headVal >= level - tolerance && headVal <= level + tolerance) return true;
        }
    }
    return false;
}

// ─── Path Clearance Guard (Obstacle at Breakout Entry) ──────────────────────

/**
 * Determines whether there is sufficient clearance between the neckline entry
 * and the nearest opposing HTF zone in the direction of the trade.
 *
 * Rule: clearance must be >= 1.0x the SL distance; otherwise reject.
 *
 * @param {number}   entryPrice   - Neckline breakout price (1H trigger level)
 * @param {number}   slDistance   - Absolute distance from entry to SL
 * @param {number[]} htfLevels    - Opposing HTF zone levels
 *                                  (HTF Supports for SELL, HTF Resistances for BUY)
 * @param {"sell"|"buy"} type
 * @returns {{ clear: boolean, nearestLevel: number|null, clearance: number }}
 */
function getPathClearance(entryPrice, slDistance, htfLevels, type) {
    if (!htfLevels || htfLevels.length === 0) {
        return { clear: true, nearestLevel: null, clearance: Infinity };
    }

    let nearestLevel = null;
    let clearance    = Infinity;

    if (type === "sell") {
        // For SELL: find nearest HTF Support BELOW entry (top edge = the level itself)
        const below = htfLevels.filter(l => l < entryPrice);
        if (below.length > 0) {
            nearestLevel = Math.max(...below); // closest one beneath entry
            clearance    = entryPrice - nearestLevel; // distance to top edge of support
        }
    } else {
        // For BUY: find nearest HTF Resistance ABOVE entry (bottom edge = level itself)
        const above = htfLevels.filter(l => l > entryPrice);
        if (above.length > 0) {
            nearestLevel = Math.min(...above); // closest one above entry
            clearance    = nearestLevel - entryPrice; // distance to bottom edge of resistance
        }
    }

    const clear = clearance >= slDistance * 1.0;
    return { clear, nearestLevel, clearance };
}

// ─── Public Detection Entry Point ────────────────────────────────────────────

/**
 * Detects H&S / Inverted H&S patterns on the supplied candle array.
 *
 * HTF confluence filters are applied here using 1D and 1W candle data:
 *   1. Head must be at a qualifying HTF Resistance (sell) or Support (buy) zone.
 *   2. Breakout path must clear the nearest opposing HTF zone by >= 1.0x SL distance.
 *
 * @param {Array}  candles        - Structural candles (4H or 1D timeframe)
 * @param {Array}  htf1DCandles   - Daily candles for HTF zone generation
 * @param {Array}  htf1WCandles   - Weekly candles for HTF zone generation
 * @param {string} [symbol]       - Symbol string for logging
 * @returns {Object|null}
 */
export function detectPatterns(candles, htf1DCandles, htf1WCandles, symbol = "UNKNOWN") {
    if (!candles || candles.length < 200) return null;

    // Build combined HTF zones from 1D and 1W candles
    const zones1D = generateHTFZones(htf1DCandles || []);
    const zones1W = generateHTFZones(htf1WCandles || []);

    const htfResistances = [...zones1D.resistances, ...zones1W.resistances];
    const htfSupports    = [...zones1D.supports,    ...zones1W.supports];

    // Scan for Sell (Head and Shoulders)
    const hs = findHS(candles, "sell", symbol, htfResistances, htfSupports);
    if (hs) return hs;

    // Scan for Buy (Inverted Head and Shoulders)
    const ihs = findHS(candles, "buy", symbol, htfResistances, htfSupports);
    if (ihs) return ihs;

    return null;
}

// ─── Internal Pattern Finder ─────────────────────────────────────────────────

/**
 * Core H&S / Inverted H&S structural finder.
 *
 * @param {Array}    candles         - Structural candles (4H or 1D)
 * @param {"sell"|"buy"} type
 * @param {string}   symbol          - For logging
 * @param {number[]} htfResistances  - Combined 1D+1W resistance levels
 * @param {number[]} htfSupports     - Combined 1D+1W support levels
 * @returns {Object|null}
 */
function findHS(candles, type, symbol, htfResistances, htfSupports) {
    const mainData    = type === "sell" ? candles.map(c => c.high) : candles.map(c => c.low);
    const supportData = type === "sell" ? candles.map(c => c.low)  : candles.map(c => c.high);

    let extrema = [];
    const radius = 5;
    const limit  = mainData.length - radius;

    // Identify local peaks (sell) or valleys (buy) across 200 bars
    for (let i = radius; i < limit; i++) {
        const window = mainData.slice(i - radius, i + radius + 1);
        const isPivot = type === "sell"
            ? mainData[i] === Math.max(...window)
            : mainData[i] === Math.min(...window);
        if (isPivot) extrema.push({ val: mainData[i], idx: i });
    }

    if (extrema.length < 3) return null;

    // Assign roles: most-recent → Right Shoulder, next → Head, then → Left Shoulder
    const s2   = extrema[0];  // Right Shoulder (most recent)
    const head = extrema[1];  // Head
    const s1   = extrema[2];  // Left Shoulder

    // Pip buffers: standard pairs ≈ 5 pips, JPY pairs ≈ 50 pips
    const pipBuffer = 0.0005;
    const jpyBuffer = 0.05;

    // Candle timestamp used as pattern fingerprint
    const headTime = candles?.[head.idx]?.time ?? head.idx;

    if (type === "sell") {
        // ── SELL: Head must be the highest peak ──────────────────────────────
        if (!(head.val > s1.val && head.val > s2.val)) return null;

        const trough1 = Math.min(...supportData.slice(head.idx, s1.idx));
        const trough2 = Math.min(...supportData.slice(s2.idx, head.idx));
        const nHigh   = Math.max(trough1, trough2);
        const nLow    = Math.min(trough1, trough2);

        const slPrice    = s2.val + (s2.val > 50 ? jpyBuffer : pipBuffer);
        const entryPrice = nLow; // Neckline breakout level

        // ── Rule 1: HTF Catalyst Confluence — Head at HTF Resistance ─────────
        if (!isHeadAtHTFZone(head.val, htfResistances, "sell")) {
            console.log(`❌ [${symbol}] REJECTED: Head did not form at HTF Resistance.`);
            return { rejected: true };
        }

        // ── Rule 2: Path Clearance — No HTF Support blocking the sell path ───
        const slDistance = Math.abs(entryPrice - slPrice);
        const pathCheck  = getPathClearance(entryPrice, slDistance, htfSupports, "sell");
        if (!pathCheck.clear) {
            console.log(
                `❌ [${symbol}] REJECTED: Insufficient clearance to opposing HTF Zone ` +
                `(Requires >= 1.0x SL distance). ` +
                `Clearance: ${pathCheck.clearance.toFixed(5)} | SL Distance: ${slDistance.toFixed(5)} | ` +
                `Nearest HTF Support: ${pathCheck.nearestLevel}`
            );
            return { rejected: true };
        }

        // ── TP Calculation ────────────────────────────────────────────────────
        const tpResult = calculateHistoricalTP(candles, entryPrice, slPrice, "sell");
        if (!tpResult) return null; // Rejected if key support too close (RR < 2.5)

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

    } else {
        // ── BUY: Head must be the lowest valley ──────────────────────────────
        if (!(head.val < s1.val && head.val < s2.val)) return null;

        const peak1 = Math.max(...supportData.slice(head.idx, s1.idx));
        const peak2 = Math.max(...supportData.slice(s2.idx, head.idx));
        const nHigh = Math.max(peak1, peak2);
        const nLow  = Math.min(peak1, peak2);

        const slPrice    = s2.val - (s2.val > 50 ? jpyBuffer : pipBuffer);
        const entryPrice = nHigh; // Neckline breakout level

        // ── Rule 1: HTF Catalyst Confluence — Head at HTF Support ────────────
        if (!isHeadAtHTFZone(head.val, htfSupports, "buy")) {
            console.log(`❌ [${symbol}] REJECTED: Head did not form at HTF Support.`);
            return { rejected: true };
        }

        // ── Rule 2: Path Clearance — No HTF Resistance blocking the buy path ─
        const slDistance = Math.abs(entryPrice - slPrice);
        const pathCheck  = getPathClearance(entryPrice, slDistance, htfResistances, "buy");
        if (!pathCheck.clear) {
            console.log(
                `❌ [${symbol}] REJECTED: Insufficient clearance to opposing HTF Zone ` +
                `(Requires >= 1.0x SL distance). ` +
                `Clearance: ${pathCheck.clearance.toFixed(5)} | SL Distance: ${slDistance.toFixed(5)} | ` +
                `Nearest HTF Resistance: ${pathCheck.nearestLevel}`
            );
            return { rejected: true };
        }

        // ── TP Calculation ────────────────────────────────────────────────────
        const tpResult = calculateHistoricalTP(candles, entryPrice, slPrice, "buy");
        if (!tpResult) return null; // Rejected if key resistance too close (RR < 2.5)

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

// ─── Historical TP Calculation ───────────────────────────────────────────────

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
    let keyZone  = null;

    if (type === "sell") {
        let supportZones = [];
        for (let i = radius; i < candles.length - radius; i++) {
            const windowLows = candles.slice(i - radius, i + radius + 1).map(c => c.low);
            if (candles[i].low === Math.min(...windowLows) && candles[i].low < entryPrice) {
                supportZones.push(candles[i].low);
            }
        }
        if (supportZones.length > 0) keyZone = Math.max(...supportZones);

        let targetTP = keyZone ? keyZone : (entryPrice - (risk * 3.0));
        let reward   = entryPrice - targetTP;
        let rr       = reward / risk;

        if (rr > 3.0) { targetTP = entryPrice - (risk * 3.0); rr = 3.0; }
        if (rr < 2.5) return null;

        return { tp: targetTP, rr };

    } else {
        let resistanceZones = [];
        for (let i = radius; i < candles.length - radius; i++) {
            const windowHighs = candles.slice(i - radius, i + radius + 1).map(c => c.high);
            if (candles[i].high === Math.max(...windowHighs) && candles[i].high > entryPrice) {
                resistanceZones.push(candles[i].high);
            }
        }
        if (resistanceZones.length > 0) keyZone = Math.min(...resistanceZones);

        let targetTP = keyZone ? keyZone : (entryPrice + (risk * 3.0));
        let reward   = targetTP - entryPrice;
        let rr       = reward / risk;

        if (rr > 3.0) { targetTP = entryPrice + (risk * 3.0); rr = 3.0; }
        if (rr < 2.5) return null;

        return { tp: targetTP, rr };
    }
}
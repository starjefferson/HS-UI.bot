const TIMEFRAME_WEIGHTS = {
    "1W": 4,
    "1D": 3,
    "4H": 2,
    "1H": 1
};
const PIVOT_RADIUS = 3;
const STRONG_ZONE_THRESHOLD = 2.4;

export function buildTargetZones(candleData, symbol) {
    const levels = [];
    const pipSize = getPipSize(symbol);

    for (const [timeframe, weight] of Object.entries(TIMEFRAME_WEIGHTS)) {
        const candles = candleData?.[timeframe];
        if (!Array.isArray(candles) || candles.length < PIVOT_RADIUS * 2 + 2) continue;
        const atr = calculateATR(candles);
        if (!(atr > 0)) continue;

        for (let index = PIVOT_RADIUS; index < candles.length - PIVOT_RADIUS; index++) {
            const candle = candles[index];
            if (!Number.isFinite(candle.close)) continue;

            const neighborhood = candles.slice(index - PIVOT_RADIUS, index + PIVOT_RADIUS + 1);
            const isResistance = neighborhood.every(other => candle.close >= other.close);
            const isSupport = neighborhood.every(other => candle.close <= other.close);
            if (isResistance) {
                levels.push({
                    side: "buy",
                    price: candle.close,
                    low: candle.close,
                    high: candle.high,
                    broken: candles.slice(0, index).some(newer => newer.close > candle.high),
                    timeframe,
                    weight,
                    atr,
                    index,
                    count: candles.length
                });
            }
            if (isSupport) {
                levels.push({
                    side: "sell",
                    price: candle.close,
                    low: candle.low,
                    high: candle.close,
                    broken: candles.slice(0, index).some(newer => newer.close < candle.low),
                    timeframe,
                    weight,
                    atr,
                    index,
                    count: candles.length
                });
            }
        }
    }

    return ["buy", "sell"].flatMap(side => clusterLevels(
        levels.filter(level => level.side === side),
        pipSize
    ).map(zone => ({ ...zone, side })));
}

export function selectTakeProfit({
    zones,
    side,
    entryPrice,
    stopLoss,
    measuredMoveTarget,
    minimumRR,
    onDiagnostic
}) {
    const risk = side === "buy" ? entryPrice - stopLoss : stopLoss - entryPrice;
    if (!(risk > 0) || !Number.isFinite(risk)) return null;

    const candidates = [];
    for (const zone of Array.isArray(zones) ? zones : []) {
        if (zone.side !== side || zone.score < STRONG_ZONE_THRESHOLD) continue;

        const buffer = Math.max(zone.pipSize ?? 0, zone.atr * 0.1);
        const tp = side === "buy" ? zone.low - buffer : zone.high + buffer;
        const reward = side === "buy" ? tp - entryPrice : entryPrice - tp;
        const rr = reward / risk;
        let reason = null;

        if (zone.broken) {
            reason = "zone already broken by a close beyond its wick boundary";
        } else if (!(reward > 0) || !Number.isFinite(rr)) {
            reason = "zone is not beyond entry";
        } else if (rr < minimumRR) {
            reason = `RR ${rr.toFixed(2)} is below minimum ${minimumRR}`;
        } else {
            const barrier = findStrongBarrier(zones, side, entryPrice, tp, zone);
            if (barrier) {
                reason = `blocked by intact ${barrier.timeframe} zone at ${barrier.price}`;
            }
        }

        const diagnostic = {
            timeframe: zone.timeframe,
            price: zone.price,
            low: zone.low,
            high: zone.high,
            score: zone.score,
            broken: Boolean(zone.broken),
            tp,
            rr,
            selected: reason === null,
            reason
        };
        if (reason === null) {
            candidates.push({ zone, tp, rr, diagnostic });
        } else {
            onDiagnostic?.(diagnostic);
        }
    }

    candidates.sort((a, b) => side === "buy" ? a.tp - b.tp : b.tp - a.tp);
    if (candidates.length > 0) {
        const firstCandidate = candidates[0];
        onDiagnostic?.({ ...firstCandidate.diagnostic, selected: true });
        for (const candidate of candidates.slice(1)) {
            onDiagnostic?.({
                ...candidate.diagnostic,
                selected: false,
                reason: "a nearer valid support/resistance target was selected"
            });
        }
    }

    const measuredReward = side === "buy"
        ? measuredMoveTarget - entryPrice
        : entryPrice - measuredMoveTarget;
    const measuredRR = measuredReward / risk;
    let measuredReason = null;
    if (!(measuredReward > 0) || !Number.isFinite(measuredRR)) {
        measuredReason = "measured-move target is not beyond entry";
    } else if (measuredRR < minimumRR) {
        measuredReason = `RR ${measuredRR.toFixed(2)} is below minimum ${minimumRR}`;
    } else {
        const barrier = findStrongBarrier(zones, side, entryPrice, measuredMoveTarget, null);
        if (barrier) {
            measuredReason = `blocked by intact ${barrier.timeframe} zone at ${barrier.price}`;
        }
    }
    onDiagnostic?.({
        timeframe: null,
        price: measuredMoveTarget,
        tp: measuredMoveTarget,
        rr: measuredRR,
        selected: candidates.length === 0 && measuredReason === null,
        reason: candidates.length > 0
            ? "support/resistance target selected instead"
            : measuredReason
    });

    if (candidates.length > 0) {
        const firstCandidate = candidates[0];
        return {
            tp: firstCandidate.tp,
            rr: firstCandidate.rr,
            source: "support/resistance",
            timeframe: firstCandidate.zone.timeframe,
            level: firstCandidate.zone.price
        };
    }

    if (
        measuredReason === null
    ) {
        return {
            tp: measuredMoveTarget,
            rr: measuredRR,
            source: "measured move",
            timeframe: null,
            level: measuredMoveTarget
        };
    }

    return null;
}

function findStrongBarrier(zones, side, entryPrice, target, targetZone) {
    return (Array.isArray(zones) ? zones : []).find(zone => {
        if (
            zone.side !== side ||
            zone.score < STRONG_ZONE_THRESHOLD ||
            zone.broken ||
            zone === targetZone
        ) return false;
        const boundary = side === "buy" ? zone.low : zone.high;
        return side === "buy"
            ? boundary > entryPrice && boundary < target
            : boundary < entryPrice && boundary > target;
    }) ?? null;
}

function clusterLevels(levels, pipSize) {
    const sorted = levels.sort((a, b) => a.price - b.price);
    const clusters = [];

    for (const level of sorted) {
        const cluster = clusters[clusters.length - 1];
        const tolerance = Math.max(pipSize * 2, Math.min(cluster?.minAtr ?? level.atr, level.atr) * 0.2);
        if (!cluster || level.price - cluster.centerHigh > tolerance) {
            clusters.push({
                low: level.low,
                high: level.high,
                centerHigh: level.price,
                levels: [level],
                minAtr: level.atr
            });
        } else {
            cluster.low = Math.min(cluster.low, level.low);
            cluster.high = Math.max(cluster.high, level.high);
            cluster.centerHigh = Math.max(cluster.centerHigh, level.price);
            cluster.levels.push(level);
            cluster.minAtr = Math.min(cluster.minAtr, level.atr);
        }
    }

    return clusters.map(cluster => {
        const bestWeight = Math.max(...cluster.levels.map(level => level.weight));
        const recency = Math.max(...cluster.levels.map(level => 1 - level.index / level.count));
        const score = bestWeight +
            Math.min(1, (cluster.levels.length - 1) * 0.5) +
            recency * 0.5;
        const weightedPrice = cluster.levels.reduce(
            (sum, level) => sum + level.price * level.weight,
            0
        ) / cluster.levels.reduce((sum, level) => sum + level.weight, 0);

        return {
            low: cluster.low,
            high: cluster.high,
            price: weightedPrice,
            atr: cluster.minAtr,
            pipSize,
            broken: cluster.levels.every(level => level.broken),
            score,
            timeframe: cluster.levels
                .slice()
                .sort((a, b) => b.weight - a.weight)[0].timeframe
        };
    });
}

function calculateATR(candles) {
    const sample = candles.slice(0, 15);
    if (sample.length < 2) return 0;
    let total = 0;
    let count = 0;

    for (let index = 0; index < sample.length - 1; index++) {
        const previousClose = sample[index + 1].close;
        const range = Math.abs(sample[index].close - previousClose);
        if (Number.isFinite(range) && range > 0) {
            total += range;
            count++;
        }
    }
    return count > 0 ? total / count : 0;
}

function getPipSize(symbol) {
    if (symbol.includes("JPY")) return 0.01;
    if (symbol.includes("XAU") || symbol.includes("GOLD")) return 0.01;
    return 0.0001;
}

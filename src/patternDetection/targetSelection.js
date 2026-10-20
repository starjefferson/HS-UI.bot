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
                levels.push({ side: "buy", price: candle.close, timeframe, weight, atr, index, count: candles.length });
            }
            if (isSupport) {
                levels.push({ side: "sell", price: candle.close, timeframe, weight, atr, index, count: candles.length });
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
    minimumRR
}) {
    const risk = side === "buy" ? entryPrice - stopLoss : stopLoss - entryPrice;
    if (!(risk > 0) || !Number.isFinite(risk)) return null;

    const candidates = (Array.isArray(zones) ? zones : [])
        .filter(zone => zone.side === side && zone.score >= STRONG_ZONE_THRESHOLD)
        .map(zone => {
            const buffer = Math.max(zone.pipSize ?? 0, zone.atr * 0.1);
            const tp = side === "buy" ? zone.low - buffer : zone.high + buffer;
            const reward = side === "buy" ? tp - entryPrice : entryPrice - tp;
            return { zone, tp, reward, rr: reward / risk };
        })
        .filter(candidate =>
            candidate.reward > 0 &&
            Number.isFinite(candidate.rr) &&
            candidate.rr >= minimumRR
        )
        .sort((a, b) => side === "buy" ? a.tp - b.tp : b.tp - a.tp);

    const firstCandidate = candidates.find(candidate => !hasStrongBarrier(
        zones,
        side,
        entryPrice,
        candidate.tp,
        candidate.zone
    ));
    if (firstCandidate) {
        return {
            tp: firstCandidate.tp,
            rr: firstCandidate.rr,
            source: "support/resistance",
            timeframe: firstCandidate.zone.timeframe,
            level: firstCandidate.zone.price
        };
    }

    const measuredReward = side === "buy"
        ? measuredMoveTarget - entryPrice
        : entryPrice - measuredMoveTarget;
    const measuredRR = measuredReward / risk;
    if (
        measuredReward > 0 &&
        Number.isFinite(measuredRR) &&
        measuredRR >= minimumRR &&
        !hasStrongBarrier(zones, side, entryPrice, measuredMoveTarget, null)
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

function hasStrongBarrier(zones, side, entryPrice, target, targetZone) {
    return (Array.isArray(zones) ? zones : []).some(zone => {
        if (zone.side !== side || zone.score < STRONG_ZONE_THRESHOLD || zone === targetZone) return false;
        const level = side === "buy" ? zone.low : zone.high;
        return side === "buy"
            ? level > entryPrice && level < target
            : level < entryPrice && level > target;
    });
}

function clusterLevels(levels, pipSize) {
    const sorted = levels.sort((a, b) => a.price - b.price);
    const clusters = [];

    for (const level of sorted) {
        const cluster = clusters[clusters.length - 1];
        const tolerance = Math.max(pipSize * 2, Math.min(cluster?.minAtr ?? level.atr, level.atr) * 0.2);
        if (!cluster || level.price - cluster.high > tolerance) {
            clusters.push({
                low: level.price,
                high: level.price,
                levels: [level],
                minAtr: level.atr
            });
        } else {
            cluster.low = Math.min(cluster.low, level.price);
            cluster.high = Math.max(cluster.high, level.price);
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

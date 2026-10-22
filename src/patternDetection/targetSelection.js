const FALLBACK_TARGET_RR = 2.2;

export function selectTakeProfit({
    side,
    entryPrice,
    stopLoss,
    measuredMoveTarget,
    minimumRR,
    onDiagnostic
}) {
    const risk = side === "buy" ? entryPrice - stopLoss : stopLoss - entryPrice;
    if (
        !["buy", "sell"].includes(side) ||
        !(risk > 0) ||
        !Number.isFinite(risk) ||
        !Number.isFinite(entryPrice) ||
        !Number.isFinite(minimumRR) ||
        minimumRR <= 0
    ) return null;

    const measuredReward = side === "buy"
        ? measuredMoveTarget - entryPrice
        : entryPrice - measuredMoveTarget;
    const measuredRR = measuredReward / risk;
    if (!Number.isFinite(measuredMoveTarget) || !Number.isFinite(measuredRR)) {
        onDiagnostic?.({
            timeframe: null,
            price: measuredMoveTarget,
            tp: measuredMoveTarget,
            rr: measuredRR,
            selected: false,
            reason: "measured-move target is invalid"
        });
        return null;
    }

    const extended = measuredRR < minimumRR;
    const fallbackRR = Math.max(minimumRR, FALLBACK_TARGET_RR);
    const tp = extended
        ? entryPrice + (side === "buy" ? 1 : -1) * risk * fallbackRR
        : measuredMoveTarget;
    const actualRR = (side === "buy" ? tp - entryPrice : entryPrice - tp) / risk;
    onDiagnostic?.({
        timeframe: null,
        price: measuredMoveTarget,
        tp,
        rr: actualRR,
        actualRR,
        selected: true,
        detail: extended
            ? `set target from ${measuredRR.toFixed(2)}R move to ${fallbackRR}R fallback`
            : null
    });

    return {
        tp,
        rr: actualRR,
        actualRR,
        source: "measured move",
        timeframe: null,
        level: measuredMoveTarget
    };
}

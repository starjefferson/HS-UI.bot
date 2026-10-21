export function selectTakeProfit({
    side,
    entryPrice,
    stopLoss,
    measuredMoveTarget,
    plannedEntryPrice = entryPrice,
    minimumRR,
    maximumRR,
    onDiagnostic
}) {
    const risk = side === "buy" ? entryPrice - stopLoss : stopLoss - entryPrice;
    if (
        !["buy", "sell"].includes(side) ||
        !(risk > 0) ||
        !Number.isFinite(risk) ||
        !Number.isFinite(minimumRR) ||
        !Number.isFinite(maximumRR) ||
        minimumRR <= 0 ||
        maximumRR < minimumRR
    ) return null;

    const plannedRisk = side === "buy"
        ? plannedEntryPrice - stopLoss
        : stopLoss - plannedEntryPrice;
    if (!(plannedRisk > 0) || !Number.isFinite(plannedRisk) || !Number.isFinite(plannedEntryPrice)) {
        return null;
    }

    const measuredReward = side === "buy"
        ? measuredMoveTarget - plannedEntryPrice
        : plannedEntryPrice - measuredMoveTarget;
    const measuredRR = measuredReward / plannedRisk;
    let reason = null;

    if (!Number.isFinite(measuredMoveTarget) || !Number.isFinite(measuredRR)) {
        reason = "measured-move target is invalid";
    }

    if (reason) {
        onDiagnostic?.({
            timeframe: null,
            price: measuredMoveTarget,
            tp: measuredMoveTarget,
            rr: measuredRR,
            selected: false,
            reason
        });
        return null;
    }

    const extended = measuredRR < minimumRR;
    const adjustedRR = Math.max(measuredRR, minimumRR);
    const capped = adjustedRR > maximumRR;
    const tp = capped
        ? plannedEntryPrice + (side === "buy" ? 1 : -1) * plannedRisk * maximumRR
        : extended
            ? plannedEntryPrice + (side === "buy" ? 1 : -1) * plannedRisk * minimumRR
            : measuredMoveTarget;
    const rr = Math.min(adjustedRR, maximumRR);
    const actualRR = (side === "buy" ? tp - entryPrice : entryPrice - tp) / risk;
    const details = [];
    if (extended) details.push(`extended ${measuredRR.toFixed(2)}R move to minimum ${minimumRR}R`);
    if (capped) details.push(`capped at maximum ${maximumRR}R`);
    onDiagnostic?.({
        timeframe: null,
        price: measuredMoveTarget,
        tp,
        rr,
        actualRR,
        selected: true,
        detail: details.length > 0 ? details.join("; ") : null
    });

    return {
        tp,
        rr,
        actualRR,
        source: "measured move",
        timeframe: null,
        level: measuredMoveTarget
    };
}

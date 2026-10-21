export function selectTakeProfit({
    side,
    entryPrice,
    stopLoss,
    measuredMoveTarget,
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

    const measuredReward = side === "buy"
        ? measuredMoveTarget - entryPrice
        : entryPrice - measuredMoveTarget;
    const measuredRR = measuredReward / risk;
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
        ? entryPrice + (side === "buy" ? 1 : -1) * risk * maximumRR
        : extended
            ? entryPrice + (side === "buy" ? 1 : -1) * risk * minimumRR
            : measuredMoveTarget;
    const rr = Math.min(adjustedRR, maximumRR);
    const details = [];
    if (extended) details.push(`extended ${measuredRR.toFixed(2)}R move to minimum ${minimumRR}R`);
    if (capped) details.push(`capped at maximum ${maximumRR}R`);
    onDiagnostic?.({
        timeframe: null,
        price: measuredMoveTarget,
        tp,
        rr,
        selected: true,
        detail: details.length > 0 ? details.join("; ") : null
    });

    return {
        tp,
        rr,
        source: "measured move",
        timeframe: null,
        level: measuredMoveTarget
    };
}

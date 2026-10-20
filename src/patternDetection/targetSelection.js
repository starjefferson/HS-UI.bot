export function selectTakeProfit({
    side,
    entryPrice,
    stopLoss,
    measuredMoveTarget,
    minimumRR,
    maximumRR,
    onDiagnostic
}) {
    const measuredMoveBufferRR = 0.5;
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

    if (!(measuredReward > 0) || !Number.isFinite(measuredRR)) {
        reason = "measured-move target is not beyond entry";
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
    const adjustedRR = measuredRR + (extended ? measuredMoveBufferRR : 0);
    if (adjustedRR < minimumRR) {
        onDiagnostic?.({
            timeframe: null,
            price: measuredMoveTarget,
            tp: measuredMoveTarget,
            rr: adjustedRR,
            selected: false,
            reason:
                `measured-move RR ${measuredRR.toFixed(2)} plus ${measuredMoveBufferRR.toFixed(2)}R ` +
                `buffer is below minimum ${minimumRR}`
        });
        return null;
    }

    const capped = adjustedRR > maximumRR;
    const tp = capped
        ? entryPrice + (side === "buy" ? 1 : -1) * risk * maximumRR
        : measuredMoveTarget + (side === "buy" ? 1 : -1) *
            risk * (extended ? measuredMoveBufferRR : 0);
    const rr = Math.min(adjustedRR, maximumRR);
    const details = [];
    if (extended) details.push(`extended ${measuredRR.toFixed(2)}R move by ${measuredMoveBufferRR.toFixed(2)}R`);
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

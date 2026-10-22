import test from "node:test";
import assert from "node:assert/strict";
import { selectTakeProfit } from "../src/patternDetection/targetSelection.js";

const defaults = {
    side: "buy",
    entryPrice: 100,
    stopLoss: 95,
    minimumRR: 2
};

test("uses the natural measured move when it meets the minimum RR", () => {
    const target = selectTakeProfit({
        ...defaults,
        side: "sell",
        entryPrice: 100,
        stopLoss: 105,
        measuredMoveTarget: 87,
        minimumRR: 2
    });

    assert.equal(target.source, "measured move");
    assert.equal(target.tp, 87);
    assert.equal(target.rr, 2.6);
    assert.equal(target.actualRR, 2.6);
});

test("keeps natural measured moves above four times the risk unchanged", () => {
    const buyTarget = selectTakeProfit({
        ...defaults,
        measuredMoveTarget: 125
    });
    const sellTarget = selectTakeProfit({
        ...defaults,
        side: "sell",
        entryPrice: 100,
        stopLoss: 102,
        measuredMoveTarget: 90
    });

    assert.equal(buyTarget.tp, 125);
    assert.equal(buyTarget.rr, 5);
    assert.equal(sellTarget.tp, 90);
    assert.equal(sellTarget.rr, 5);
});

test("sets buy and sell targets below 2R to 2R from the actual entry", () => {
    const buyTarget = selectTakeProfit({
        ...defaults,
        measuredMoveTarget: 109
    });
    const sellTarget = selectTakeProfit({
        ...defaults,
        side: "sell",
        entryPrice: 100,
        stopLoss: 105,
        measuredMoveTarget: 98
    });

    assert.equal(buyTarget.tp, 110);
    assert.equal(buyTarget.rr, 2);
    assert.equal(sellTarget.tp, 90);
    assert.equal(sellTarget.rr, 2);
});

test("moves a naturally sub-2R delayed-entry target to 2R from the actual entry", () => {
    const target = selectTakeProfit({
        ...defaults,
        entryPrice: 105,
        measuredMoveTarget: 115
    });

    assert.equal(target.tp, 125);
    assert.equal(target.rr, 2);
    assert.equal(target.actualRR, 2);
});

test("extends the USDCHF example to a full 2R from its actual breakout entry", () => {
    const target = selectTakeProfit({
        side: "sell",
        entryPrice: 0.82313,
        stopLoss: 0.82619,
        measuredMoveTarget: 0.820145,
        minimumRR: 2
    });

    assert.ok(Math.abs(target.tp - 0.81701) < 1e-12);
    assert.ok(Math.abs(target.actualRR - 2) < 1e-12);
});

test("keeps a natural target that meets 2R at the actual entry unchanged", () => {
    const target = selectTakeProfit({
        ...defaults,
        entryPrice: 102,
        measuredMoveTarget: 116
    });

    assert.equal(target.tp, 116);
    assert.equal(target.rr, 2);
    assert.equal(target.actualRR, 2);
});

test("uses the natural target when actual-entry RR is above the minimum", () => {
    const target = selectTakeProfit({
        ...defaults,
        entryPrice: 102,
        measuredMoveTarget: 123
    });

    assert.equal(target.tp, 123);
    assert.equal(target.rr, 3);
});

test("leaves measured moves at or above the minimum unchanged", () => {
    const target = selectTakeProfit({
        ...defaults,
        side: "sell",
        entryPrice: 100,
        stopLoss: 105,
        measuredMoveTarget: 85
    });

    assert.equal(target.tp, 85);
    assert.equal(target.rr, 3);
});

test("rejects invalid entry, stop, or target geometry", () => {
    assert.equal(selectTakeProfit({
        ...defaults,
        measuredMoveTarget: 115,
        stopLoss: 101
    }), null);
    assert.equal(selectTakeProfit({
        ...defaults,
        measuredMoveTarget: NaN
    }), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { selectTakeProfit } from "../src/patternDetection/targetSelection.js";

const defaults = {
    side: "buy",
    entryPrice: 100,
    stopLoss: 95,
    minimumRR: 2,
    maximumRR: 4
};

test("uses the measured move when planned reward-to-risk is within the configured range", () => {
    const target = selectTakeProfit({
        ...defaults,
        side: "sell",
        entryPrice: 100,
        stopLoss: 105,
        measuredMoveTarget: 87,
        minimumRR: 2,
        maximumRR: 4
    });

    assert.equal(target.source, "measured move");
    assert.equal(target.tp, 87);
    assert.equal(target.rr, 2.6);
    assert.equal(target.actualRR, 2.6);
});

test("caps buy and sell measured moves at four times the risk", () => {
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

    assert.equal(buyTarget.tp, 120);
    assert.equal(buyTarget.rr, 4);
    assert.equal(sellTarget.tp, 92);
    assert.equal(sellTarget.rr, 4);
});

test("extends planned measured moves below 2R to the planned 2R minimum", () => {
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

test("does not re-buffer a planned target above 2R when the actual entry is delayed", () => {
    const target = selectTakeProfit({
        ...defaults,
        entryPrice: 105,
        measuredMoveTarget: 115,
        plannedEntryPrice: 100
    });

    assert.equal(target.tp, 115);
    assert.equal(target.rr, 3);
    assert.equal(target.actualRR, 1);
});

test("buffers from the planned entry and reports reduced RR at a delayed actual entry", () => {
    const target = selectTakeProfit({
        ...defaults,
        entryPrice: 102,
        measuredMoveTarget: 108,
        plannedEntryPrice: 100
    });

    assert.equal(target.tp, 110);
    assert.equal(target.rr, 2);
    assert.equal(target.actualRR, 8 / 7);
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
        plannedEntryPrice: 90
    }), null);
    assert.equal(selectTakeProfit({
        ...defaults,
        stopLoss: 101,
        measuredMoveTarget: 115
    }), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { selectTakeProfit } from "../src/patternDetection/targetSelection.js";

test("uses the measured move when its reward-to-risk is within the configured range", () => {
    const target = selectTakeProfit({
        side: "sell",
        entryPrice: 100,
        stopLoss: 105,
        measuredMoveTarget: 87,
        minimumRR: 2.5,
        maximumRR: 4
    });

    assert.equal(target.source, "measured move");
    assert.equal(target.tp, 87);
    assert.equal(target.rr, 2.6);
});

test("caps a buy measured move at four times the risk", () => {
    const target = selectTakeProfit({
        side: "buy",
        entryPrice: 100,
        stopLoss: 95,
        measuredMoveTarget: 125,
        minimumRR: 2.5,
        maximumRR: 4
    });

    assert.equal(target.tp, 120);
    assert.equal(target.rr, 4);
});

test("caps a sell measured move at four times the risk", () => {
    const target = selectTakeProfit({
        side: "sell",
        entryPrice: 100,
        stopLoss: 102,
        measuredMoveTarget: 90,
        minimumRR: 2.5,
        maximumRR: 4
    });

    assert.equal(target.tp, 92);
    assert.equal(target.rr, 4);
});

test("extends a sub-2.5R measured move to the 2.5R minimum", () => {
    const target = selectTakeProfit({
        side: "buy",
        entryPrice: 100,
        stopLoss: 95,
        measuredMoveTarget: 110,
        minimumRR: 2.5,
        maximumRR: 4
    });

    assert.equal(target.tp, 112.5);
    assert.equal(target.rr, 2.5);
});

test("extends a measured move far below the minimum rather than rejecting the pattern", () => {
    const target = selectTakeProfit({
        side: "sell",
        entryPrice: 100,
        stopLoss: 105,
        measuredMoveTarget: 98,
        minimumRR: 2.5,
        maximumRR: 4
    });

    assert.equal(target.tp, 87.5);
    assert.equal(target.rr, 2.5);
});

test("leaves measured moves at or above the minimum unchanged", () => {
    const target = selectTakeProfit({
        side: "sell",
        entryPrice: 100,
        stopLoss: 105,
        measuredMoveTarget: 85,
        minimumRR: 2.5,
        maximumRR: 4
    });

    assert.equal(target.tp, 85);
    assert.equal(target.rr, 3);
});

test("caps a measured move at the configured maximum", () => {
    const target = selectTakeProfit({
        side: "buy",
        entryPrice: 100,
        stopLoss: 95,
        measuredMoveTarget: 120,
        minimumRR: 2.5,
        maximumRR: 3
    });

    assert.equal(target.tp, 115);
    assert.equal(target.rr, 3);
});

test("extends a measured move on the wrong side of entry and rejects invalid risk", () => {
    const target = selectTakeProfit({
        side: "sell",
        entryPrice: 100,
        stopLoss: 105,
        measuredMoveTarget: 101,
        minimumRR: 2.5,
        maximumRR: 4
    });
    assert.equal(target.tp, 87.5);
    assert.equal(target.rr, 2.5);

    assert.equal(selectTakeProfit({
        side: "buy",
        entryPrice: 100,
        stopLoss: 101,
        measuredMoveTarget: 115,
        minimumRR: 2.5,
        maximumRR: 4
    }), null);
});

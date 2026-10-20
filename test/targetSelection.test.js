import test from "node:test";
import assert from "node:assert/strict";
import { selectTakeProfit } from "../src/patternDetection/targetSelection.js";

test("uses the measured move when its reward-to-risk is within the configured range", () => {
    const target = selectTakeProfit({
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
});

test("caps a buy measured move at four times the risk", () => {
    const target = selectTakeProfit({
        side: "buy",
        entryPrice: 100,
        stopLoss: 95,
        measuredMoveTarget: 125,
        minimumRR: 2,
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
        minimumRR: 2,
        maximumRR: 4
    });

    assert.equal(target.tp, 92);
    assert.equal(target.rr, 4);
});

test("adds 0.5R to a sub-2R measured move when the adjusted target reaches 2R", () => {
    const target = selectTakeProfit({
        side: "buy",
        entryPrice: 100,
        stopLoss: 95,
        measuredMoveTarget: 109,
        minimumRR: 2,
        maximumRR: 4
    });

    assert.equal(target.tp, 111.5);
    assert.equal(target.rr, 2.3);
});

test("rejects a sub-2R move when the 0.5R extension still falls short", () => {
    const target = selectTakeProfit({
        side: "sell",
        entryPrice: 100,
        stopLoss: 105,
        measuredMoveTarget: 93,
        minimumRR: 2,
        maximumRR: 4
    });

    assert.equal(target, null);
});

test("leaves measured moves at or above the minimum unchanged", () => {
    const target = selectTakeProfit({
        side: "sell",
        entryPrice: 100,
        stopLoss: 105,
        measuredMoveTarget: 90,
        minimumRR: 2,
        maximumRR: 4
    });

    assert.equal(target.tp, 90);
    assert.equal(target.rr, 2);
});

test("caps an extended measured move at the four-R maximum", () => {
    const target = selectTakeProfit({
        side: "buy",
        entryPrice: 100,
        stopLoss: 95,
        measuredMoveTarget: 109,
        minimumRR: 2,
        maximumRR: 2.2
    });

    assert.equal(target.tp, 111);
    assert.equal(target.rr, 2.2);
});

test("rejects a measured move on the wrong side of entry or invalid risk", () => {
    assert.equal(selectTakeProfit({
        side: "sell",
        entryPrice: 100,
        stopLoss: 105,
        measuredMoveTarget: 101,
        minimumRR: 2,
        maximumRR: 4
    }), null);
    assert.equal(selectTakeProfit({
        side: "buy",
        entryPrice: 100,
        stopLoss: 101,
        measuredMoveTarget: 115,
        minimumRR: 2,
        maximumRR: 4
    }), null);
});

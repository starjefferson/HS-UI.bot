import test from "node:test";
import assert from "node:assert/strict";
import {
    hasNecklineRecrossAfterBreakout,
    selectAlignedLevelSetups
} from "../src/patternDetection/patternEngine.js";

const flatNeckline = type => ({
    type,
    necklineStartTime: 0,
    necklineEndTime: 100,
    necklineStartPrice: 100,
    necklineEndPrice: 100
});

test("uses the smallest aligned timeframe for the stop and largest for the target", () => {
    const setups = {
        "1D": { sl: 110, measuredMove: 20 },
        "1H": { sl: 105, measuredMove: 8 },
        "4H": { sl: 108, measuredMove: 14 }
    };

    const levels = selectAlignedLevelSetups(["1D", "4H", "1H"], setups);

    assert.equal(levels.stopTimeframe, "1H");
    assert.equal(levels.stopSetup, setups["1H"]);
    assert.equal(levels.targetTimeframe, "1D");
    assert.equal(levels.targetSetup, setups["1D"]);
});

test("uses the sole detected timeframe for both stop and target", () => {
    const setup = { sl: 105, measuredMove: 8 };
    const levels = selectAlignedLevelSetups(["4H"], { "4H": setup });

    assert.equal(levels.stopTimeframe, "4H");
    assert.equal(levels.targetTimeframe, "4H");
});

test("does not use aligned structures whose right shoulder formed after breakout", () => {
    const setups = {
        "1H": { sl: 105, measuredMove: 8, rightShoulderTime: 100 },
        "4H": { sl: 108, measuredMove: 14, rightShoulderTime: 110 },
        "1D": { sl: 110, measuredMove: 20, rightShoulderTime: 120 }
    };

    const levels = selectAlignedLevelSetups(["1H", "4H", "1D"], setups, 115);

    assert.equal(levels.stopTimeframe, "1H");
    assert.equal(levels.targetTimeframe, "4H");
});

test("never treats 15m breakout candles as a structural timeframe", () => {
    const setups = {
        "15m": { sl: 101, measuredMove: 2 },
        "1H": { sl: 105, measuredMove: 8 },
        "4H": { sl: 108, measuredMove: 14 }
    };

    const levels = selectAlignedLevelSetups(["15m", "1H", "4H"], setups);

    assert.equal(levels.stopTimeframe, "1H");
    assert.equal(levels.targetTimeframe, "4H");
});

test("allows a buy retry while closes remain above the neckline", () => {
    assert.equal(hasNecklineRecrossAfterBreakout(
        flatNeckline("buy"),
        [{ time: 101, close: 100.1 }],
        100,
        0
    ), false);
});

test("invalidates a buy setup after a close back below the neckline", () => {
    assert.equal(hasNecklineRecrossAfterBreakout(
        flatNeckline("buy"),
        [{ time: 101, close: 99.9 }],
        100,
        0
    ), true);
});

test("allows a sell retry while closes remain below the neckline", () => {
    assert.equal(hasNecklineRecrossAfterBreakout(
        flatNeckline("sell"),
        [{ time: 101, close: 99.9 }],
        100,
        0
    ), false);
});

test("invalidates a sell setup after a close back above the neckline", () => {
    assert.equal(hasNecklineRecrossAfterBreakout(
        flatNeckline("sell"),
        [{ time: 101, close: 100.1 }],
        100,
        0
    ), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { hasNecklineRecrossAfterBreakout } from "../src/patternDetection/patternEngine.js";

const flatNeckline = type => ({
    type,
    necklineStartTime: 0,
    necklineEndTime: 100,
    necklineStartPrice: 100,
    necklineEndPrice: 100
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

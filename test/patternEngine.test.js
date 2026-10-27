import test from "node:test";
import assert from "node:assert/strict";
import { hasNecklineRecrossAfterBreakout } from "../src/patternDetection/patternEngine.js";
import { calculateADX } from "../src/patternDetection/utils.js";

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

test("correctly calculates ADX and identifies trending vs consolidating candles", () => {
    // Flat consolidating candles (no directional movement)
    const flatCandles = Array.from({ length: 50 }, (_, i) => ({
        time: i,
        open: 100 + (i % 2 === 0 ? 0.2 : -0.2),
        high: 100.5,
        low: 99.5,
        close: 100 + (i % 2 === 0 ? -0.2 : 0.2)
    })).reverse();
    const lowAdx = calculateADX(flatCandles);
    assert.ok(Number.isFinite(lowAdx));
    assert.ok(lowAdx < 20);

    // Strongly trending candles
    const trendingCandles = Array.from({ length: 50 }, (_, i) => ({
        time: i,
        open: 100 + i * 2,
        high: 102 + i * 2,
        low: 99.5 + i * 2,
        close: 101.5 + i * 2
    })).reverse();
    const highAdx = calculateADX(trendingCandles);
    assert.ok(Number.isFinite(highAdx));
    assert.ok(highAdx > 25);
});

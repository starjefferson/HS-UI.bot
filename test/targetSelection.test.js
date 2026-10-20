import test from "node:test";
import assert from "node:assert/strict";
import { buildTargetZones, selectTakeProfit } from "../src/patternDetection/targetSelection.js";

test("builds confirmed swing zones from timeframe candles", () => {
    const candles = Array.from({ length: 20 }, (_, index) => ({
        time: 20 - index,
        high: index === 10 ? 500 : 101,
        low: index === 10 ? 1 : 99,
        close: index === 10 ? 105 : 100
    }));
    const zones = buildTargetZones({ "1D": candles }, "EURUSD");

    assert.ok(zones.some(zone =>
        zone.side === "buy" &&
        zone.timeframe === "1D" &&
        zone.low === 105 &&
        zone.high === 500 &&
        zone.score >= 2.5
    ));
});

test("defines support zone with the wick low and close as its upper edge", () => {
    const candles = Array.from({ length: 20 }, (_, index) => ({
        time: 20 - index,
        high: index === 10 ? 108 : 101,
        low: index === 10 ? 80 : 99,
        close: index === 10 ? 95 : 100
    }));
    const zones = buildTargetZones({ "1D": candles }, "EURUSD");

    assert.ok(zones.some(zone =>
        zone.side === "sell" &&
        zone.timeframe === "1D" &&
        zone.low === 80 &&
        zone.high === 95
    ));
});

test("marks support broken only after a candle closes beyond the wick boundary", () => {
    const candles = Array.from({ length: 20 }, (_, index) => ({
        time: 20 - index,
        high: index === 10 ? 108 : 101,
        low: index === 10 ? 90 : 99,
        close: index === 10 ? 95 : 100
    }));
    candles[6].close = 94;
    const intactZones = buildTargetZones({ "1D": candles }, "EURUSD");
    const intactSupport = intactZones.find(zone => zone.side === "sell" && zone.high === 95);
    assert.equal(intactSupport.broken, false);

    candles[3].close = 89;
    const brokenZones = buildTargetZones({ "1D": candles }, "EURUSD");
    const brokenSupport = brokenZones.find(zone => zone.side === "sell" && zone.high === 95);
    assert.equal(brokenSupport.broken, true);
});

test("selects a farther support/resistance target when it clears minimum RR", () => {
    const target = selectTakeProfit({
        zones: [
            { side: "buy", low: 114.5, high: 115.5, price: 115, atr: 1, score: 3, timeframe: "1D" }
        ],
        side: "buy",
        entryPrice: 100,
        stopLoss: 95,
        measuredMoveTarget: 110,
        minimumRR: 2.5
    });

    assert.equal(target.source, "support/resistance");
    assert.equal(target.timeframe, "1D");
    assert.equal(target.tp, 114.4);
    assert.ok(target.rr >= 2.5);
});

test("rejects a farther target that crosses a strong opposing zone", () => {
    const target = selectTakeProfit({
        zones: [
            { side: "buy", low: 107.5, high: 108.5, price: 108, atr: 1, score: 3, timeframe: "4H" },
            { side: "buy", low: 114.5, high: 115.5, price: 115, atr: 1, score: 3, timeframe: "1D" }
        ],
        side: "buy",
        entryPrice: 100,
        stopLoss: 95,
        measuredMoveTarget: 120,
        minimumRR: 2.5
    });

    assert.equal(target, null);
});

test("allows a farther support target after an intervening support closes through its wick zone", () => {
    const target = selectTakeProfit({
        zones: [
            { side: "sell", low: 94, high: 96, price: 95, atr: 1, score: 3, timeframe: "4H", broken: true },
            { side: "sell", low: 89, high: 90, price: 89.5, atr: 1, score: 3, timeframe: "1D", broken: false }
        ],
        side: "sell",
        entryPrice: 100,
        stopLoss: 102,
        measuredMoveTarget: 98,
        minimumRR: 2
    });

    assert.equal(target.source, "support/resistance");
    assert.equal(target.timeframe, "1D");
    assert.equal(target.tp, 90.1);
    assert.ok(target.rr >= 2);
});

test("retains the measured-move target when it independently clears minimum RR", () => {
    const target = selectTakeProfit({
        zones: [],
        side: "sell",
        entryPrice: 100,
        stopLoss: 105,
        measuredMoveTarget: 87,
        minimumRR: 2.5
    });

    assert.equal(target.source, "measured move");
    assert.equal(target.tp, 87);
    assert.equal(target.rr, 2.6);
});

test("does not reduce the required RR when no target qualifies", () => {
    const target = selectTakeProfit({
        zones: [],
        side: "buy",
        entryPrice: 100,
        stopLoss: 95,
        measuredMoveTarget: 110,
        minimumRR: 2.5
    });

    assert.equal(target, null);
});

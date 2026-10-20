import test from "node:test";
import assert from "node:assert/strict";
import { detectPatterns } from "../src/patternDetection/headShoulders.js";

test("detects pivots and places the stop using closes instead of extreme wicks", () => {
    const turningPoints = [
        [0, 106],
        [10, 108],
        [20, 103],
        [30, 115],
        [40, 103],
        [50, 108],
        [60, 106],
        [199, 110]
    ];
    const closes = Array.from({ length: 200 }, (_, index) => {
        const segment = turningPoints.findIndex(([time]) => time >= index);
        const [startTime, startPrice] = turningPoints[segment - 1] || turningPoints[0];
        const [endTime, endPrice] = turningPoints[segment] || turningPoints.at(-1);
        const progress = (index - startTime) / (endTime - startTime);
        return startPrice + (endPrice - startPrice) * progress;
    });
    for (const [index, close] of turningPoints) closes[index] = close;
    const candles = closes.map((close, index) => ({
        time: 2000 - index,
        open: close,
        close,
        high: close + 20,
        low: close - 20
    }));

    const setup = detectPatterns(candles, "sell", undefined, 0.0002);

    assert.ok(setup);
    assert.equal(setup.rightShoulderPrice, 108);
    assert.equal(setup.sl, 108.0002);
    assert.equal(setup.headPrice, 115);
});

test("accepts a BUY structure with uneven shoulders and a sloped neckline", () => {
    const turningPoints = [
        [0, 108],
        [140, 103],
        [150, 110],
        [160, 90],
        [175, 113.3],
        [190, 100.5],
        [199, 108]
    ];
    const chronologicalCloses = Array.from({ length: 200 }, (_, index) => {
        const nextPointIndex = turningPoints.findIndex(([time]) => time >= index);
        const [startTime, startPrice] = turningPoints[nextPointIndex - 1] || turningPoints[0];
        const [endTime, endPrice] = turningPoints[nextPointIndex] || turningPoints.at(-1);
        const progress = (index - startTime) / (endTime - startTime);
        return startPrice + (endPrice - startPrice) * progress;
    });
    for (const [index, close] of turningPoints) chronologicalCloses[index] = close;

    const candles = chronologicalCloses
        .map((close, index) => ({
            time: 2000 + index,
            open: close,
            close,
            high: close + 20,
            low: close - 20
        }))
        .reverse();

    const setup = detectPatterns(candles, "buy");

    assert.ok(setup);
    assert.equal(setup.type, "buy");
    assert.equal(setup.rightShoulderPrice, 100.5);
    assert.equal(setup.necklineStartPrice, 110);
    assert.equal(setup.necklineEndPrice, 113.3);
});

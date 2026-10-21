import test from "node:test";
import assert from "node:assert/strict";
import { canExecuteCorrelatedTrade, parseCurrencies } from "../src/risk/correlationGuard.js";

test("parses HotForex symbols with a trailing r suffix", () => {
  assert.deepEqual(parseCurrencies("USDJPYr"), ["USD", "JPY"]);
});

test("counts currency exposure from HotForex-suffixed open positions", () => {
  const result = canExecuteCorrelatedTrade("EURJPY", [
    { symbol: "USDJPYr" },
    { symbol: "AUDJPYr" }
  ]);

  assert.equal(result.isAllowed, false);
  assert.equal(result.reason, "JPY cluster limit reached (2/2 active trades).");
});

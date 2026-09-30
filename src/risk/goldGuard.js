/**
 * goldGuard.js
 *
 * Dedicated risk guard module for XAUUSD (Gold) instruments.
 *
 * Gold requires special handling because it does NOT follow the standard
 * Forex 4-decimal pip convention (where 1 pip = 0.0001 x 100,000 = $10/lot).
 * For Gold, price moves in full dollars and pip value is approximately $1/lot.
 *
 * All methods are pure/stateless utility functions — no side effects,
 * no auto-close logic, no position flattening.
 */

// --- Symbol Classification ---------------------------------------------------

const GOLD_SYMBOLS = new Set(["XAUUSD", "GOLD", "XAUUSD.A", "XAUUSD.M"]);

/**
 * Returns true if the given trading symbol is a Gold instrument.
 * Supports: XAUUSD, GOLD, XAUUSD.a (ECN suffix), XAUUSD.m (mini suffix)
 *
 * @param {string} symbol
 * @returns {boolean}
 */
export function isGoldSymbol(symbol) {
  if (!symbol || typeof symbol !== "string") return false;
  return GOLD_SYMBOLS.has(symbol.toUpperCase().trim());
}

// --- Gold Lot Size Calculation -----------------------------------------------

/**
 * Calculates Gold position size using the commodity-specific pip formula.
 *
 * Formula:
 *   Lots = (Balance x RiskPct / 100) / (|Entry - SL| x 100)
 *
 * The divisor x100 reflects Gold's approximate pip value per standard lot
 * ($100/full dollar move on a 100oz contract) rather than Forex's $10/pip.
 *
 * Result is rounded to 0.01 lot precision with a minimum of 0.01 lots.
 *
 * @param {number} balance       - Account equity/balance in USD
 * @param {number} riskPct       - Risk percentage (e.g. 5.0 for 5%)
 * @param {number} entryPrice    - Gold entry price (e.g. 1985.50)
 * @param {number} slPrice       - Stop-loss price (e.g. 1983.00)
 * @returns {number}             - Calculated lot size
 */
export function calculateGoldLotSize(balance, riskPct, entryPrice, slPrice) {
  const slDistance = Math.abs(entryPrice - slPrice);

  if (slDistance === 0 || balance <= 0 || riskPct <= 0) {
    console.warn("[GOLD GUARD] Invalid inputs for lot sizing. Defaulting to 0.01 lot.");
    return 0.01;
  }

  const riskAmount = balance * (riskPct / 100);
  const rawLots = riskAmount / (slDistance * 100);

  // Round to 2 decimal places (0.01 precision), enforce minimum
  const lots = Math.max(0.01, Math.round(rawLots * 100) / 100);

  console.log(
    `[GOLD GUARD] Lot Size | Balance: $${balance.toFixed(2)} | ` +
    `Risk: ${riskPct}% ($${riskAmount.toFixed(2)}) | ` +
    `SL Distance: $${slDistance.toFixed(2)} | ` +
    `Calculated Lots: ${lots}`
  );

  return lots;
}

// --- Structural SL Buffer ----------------------------------------------------

/**
 * Applies a mandatory $1.50 structural SL buffer beyond the Right Shoulder (s2)
 * to avoid being stopped out by minor wicks around the pattern extremity.
 *
 * - SELL H&S:         SL = Right Shoulder High  + 1.50
 * - BUY Inverted H&S: SL = Right Shoulder Low   - 1.50
 *
 * @param {"sell"|"buy"} type       - Trade direction
 * @param {number} rightShoulderVal - Right shoulder (s2) high or low price
 * @returns {number}                - Adjusted SL price
 */
export function applyGoldSLBuffer(type, rightShoulderVal) {
  const BUFFER = 1.50;

  if (typeof rightShoulderVal !== "number" || isNaN(rightShoulderVal)) {
    throw new Error("[GOLD GUARD] applyGoldSLBuffer: rightShoulderVal must be a valid number.");
  }

  const sl = type === "sell"
    ? rightShoulderVal + BUFFER
    : rightShoulderVal - BUFFER;

  console.log(
    `[GOLD GUARD] SL Buffer | Direction: ${type.toUpperCase()} | ` +
    `Right Shoulder: ${rightShoulderVal} | Buffer: +/-$${BUFFER} | Final SL: ${sl}`
  );

  return sl;
}

// --- Spread Expansion Guard --------------------------------------------------

const MAX_GOLD_SPREAD = 0.50; // $0.50 maximum spread tolerance for Gold

/**
 * Validates that the current Gold market spread is within the acceptable limit.
 * Gold spreads can expand significantly during news events or low-liquidity sessions.
 *
 * @param {number} bid - Current bid price
 * @param {number} ask - Current ask price
 * @returns {{ allowed: boolean, spread: number }} - Validation result with spread value
 */
export function validateGoldSpread(bid, ask) {
  const spread = ask - bid;

  const allowed = spread <= MAX_GOLD_SPREAD;

  if (!allowed) {
    console.warn(
      `[GOLD GUARD] Spread Rejected | Bid: ${bid} | Ask: ${ask} | ` +
      `Spread: $${spread.toFixed(3)} | Limit: $${MAX_GOLD_SPREAD}`
    );
  } else {
    console.log(
      `[GOLD GUARD] Spread OK | Spread: $${spread.toFixed(3)} | ` +
      `Limit: $${MAX_GOLD_SPREAD}`
    );
  }

  return { allowed, spread: parseFloat(spread.toFixed(3)) };
}

// --- Distribution Limit ------------------------------------------------------

const MAX_GOLD_DISTRIBUTION = 3.00; // $3.00 maximum move past neckline

/**
 * Checks whether Gold price has already moved too far past the neckline breakout
 * level, indicating the trade entry opportunity has been missed or overextended.
 *
 * Rejected if: |currentPrice - necklinePrice| > $3.00
 *
 * @param {number} currentPrice   - Live Gold price
 * @param {number} necklinePrice  - Neckline breakout boundary (necklineLow for SELL, necklineHigh for BUY)
 * @returns {boolean}             - true = price has distributed too far (REJECT entry)
 */
export function isGoldDistributed(currentPrice, necklinePrice) {
  const distance = Math.abs(currentPrice - necklinePrice);
  const tooFar = distance > MAX_GOLD_DISTRIBUTION;

  if (tooFar) {
    console.warn(
      `[GOLD GUARD] Distribution Limit Exceeded | ` +
      `Current: ${currentPrice} | Neckline: ${necklinePrice} | ` +
      `Distance: $${distance.toFixed(2)} | Limit: $${MAX_GOLD_DISTRIBUTION}`
    );
  }

  return tooFar;
}

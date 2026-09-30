/**
 * correlationGuard.js
 *
 * Prevents dangerous currency cluster exposure by limiting the number of
 * simultaneously open trades that share the same base or quote currency.
 *
 * Motivation: Opening EURUSD + EURGBP + EURJPY simultaneously creates
 * triple exposure to EUR. If EUR collapses, all three trades lose together,
 * magnifying drawdown beyond the intended per-trade risk budget.
 *
 * This guard is stateless — it evaluates exposure against the live list of
 * open positions provided by the caller at the time of trade evaluation.
 */

// --- Currency Parsing --------------------------------------------------------

/**
 * Known FX/commodity symbols that do not follow the standard 6-char base+quote
 * convention, or require special parsing to extract currency codes.
 *
 * Format: symbol -> [base, quote]
 */
const SYMBOL_OVERRIDES = {
  "GOLD":     ["XAU", "USD"],
  "XAUUSD":   ["XAU", "USD"],
  "XAUUSD.A": ["XAU", "USD"],
  "XAUUSD.M": ["XAU", "USD"],
  "XAGUSD":   ["XAG", "USD"],
};

/**
 * Extracts the base and quote currency from a trading symbol.
 *
 * Standard 6-character FX pairs split at position 3 (e.g. EURUSD -> EUR, USD).
 * Exotic suffixes like ".a" or ".m" (ECN/mini) are stripped before parsing.
 * Special instruments (XAUUSD, GOLD, etc.) are resolved via SYMBOL_OVERRIDES.
 *
 * @param {string} symbol - Trading symbol (e.g. "EURUSD", "XAUUSD", "USDZAR")
 * @returns {string[]}    - Two-element array: [baseCurrency, quoteCurrency]
 *                          Returns [] if symbol cannot be parsed.
 */
export function parseCurrencies(symbol) {
  if (!symbol || typeof symbol !== "string") return [];

  const normalized = symbol.toUpperCase().trim();

  // Check override map first (handles GOLD, XAUUSD.a, etc.)
  if (SYMBOL_OVERRIDES[normalized]) {
    return SYMBOL_OVERRIDES[normalized];
  }

  // Strip common broker-specific suffixes (.a, .m, .ecn, .pro, etc.)
  const stripped = normalized.replace(/\.[A-Z0-9]+$/, "");

  // Standard 6-character FX pair (most majors, minors, exotics)
  if (stripped.length === 6) {
    return [stripped.slice(0, 3), stripped.slice(3, 6)];
  }

  // Handle suffixed variants that weren't caught above
  if (SYMBOL_OVERRIDES[stripped]) {
    return SYMBOL_OVERRIDES[stripped];
  }

  console.warn(`[CORRELATION GUARD] Could not parse currencies from symbol: "${symbol}"`);
  return [];
}

// --- Cluster Exposure Guard --------------------------------------------------

/**
 * Determines whether a new trade entry should be allowed based on the current
 * currency cluster exposure across all live open positions.
 *
 * Rule: If EITHER the base currency OR the quote currency of the candidate
 * symbol already appears in 2 or more open positions (as base or quote),
 * the new trade is rejected.
 *
 * @param {string}   candidateSymbol    - Symbol being considered for trade entry
 * @param {Object[]} openPositions      - Array of live open position objects.
 *                                        Each object must have a `symbol` string field.
 *                                        (Matches MetaApi getPositions() response shape)
 * @param {number}   [maxPerCurrency=2] - Maximum allowed open trades per currency
 * @returns {{ isAllowed: boolean, reason: string|null }}
 */
export function canExecuteCorrelatedTrade(candidateSymbol, openPositions, maxPerCurrency = 2) {
  // Ensure we always work with an array, even if caller passes null/undefined
  const positions = Array.isArray(openPositions) ? openPositions : [];

  const candidateCurrencies = parseCurrencies(candidateSymbol);

  if (candidateCurrencies.length === 0) {
    // Cannot parse symbol — allow the trade but log a warning
    console.warn(
      `[CORRELATION GUARD] Unparseable symbol "${candidateSymbol}" — bypassing correlation check.`
    );
    return { isAllowed: true, reason: null };
  }

  const [candidateBase, candidateQuote] = candidateCurrencies;

  // Build a frequency map: currencyCode -> count of open positions exposing that currency
  const currencyExposure = {};

  for (const position of positions) {
    const posCurrencies = parseCurrencies(position.symbol);
    for (const currency of posCurrencies) {
      currencyExposure[currency] = (currencyExposure[currency] || 0) + 1;
    }
  }

  const baseCount  = currencyExposure[candidateBase]  || 0;
  const quoteCount = currencyExposure[candidateQuote] || 0;

  console.log(
    `[CORRELATION GUARD] ${candidateSymbol} | ` +
    `${candidateBase} exposure: ${baseCount}/${maxPerCurrency} | ` +
    `${candidateQuote} exposure: ${quoteCount}/${maxPerCurrency}`
  );

  if (baseCount >= maxPerCurrency) {
    const reason = `${candidateBase} cluster limit reached (${baseCount}/${maxPerCurrency} active trades).`;
    console.warn(`[CORRELATION GUARD] BLOCKED ${candidateSymbol}: ${reason}`);
    return { isAllowed: false, reason };
  }

  if (quoteCount >= maxPerCurrency) {
    const reason = `${candidateQuote} cluster limit reached (${quoteCount}/${maxPerCurrency} active trades).`;
    console.warn(`[CORRELATION GUARD] BLOCKED ${candidateSymbol}: ${reason}`);
    return { isAllowed: false, reason };
  }

  return { isAllowed: true, reason: null };
}

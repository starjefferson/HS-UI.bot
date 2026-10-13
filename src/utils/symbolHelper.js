/**
 * Applies the configured broker suffix to a base trading symbol.
 *
 * The configured suffix may be empty for standard symbol names. Existing
 * suffixes are preserved so callers can safely pass formatted symbols too.
 *
 * @param {string} baseSymbol
 * @returns {string}
 */
export function formatSymbol(baseSymbol) {
  const cleanSymbol = String(baseSymbol ?? "").trim();
  const suffix = process.env.BROKER_SYMBOL_SUFFIX?.trim() ?? "";

  if (!suffix || cleanSymbol.endsWith(suffix)) return cleanSymbol;
  return `${cleanSymbol}${suffix}`;
}

/**
 * Formats a list of base trading symbols for the configured broker account.
 *
 * @param {string[]} symbolsArray
 * @returns {string[]}
 */
export function getFormattedSymbols(symbolsArray) {
  return symbolsArray.map(formatSymbol);
}

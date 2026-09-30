/**
 * historyLogger.js
 *
 * Asynchronous trade lifecycle logger using fs.promises (non-blocking).
 *
 * Manages local history.json entries for trade open and close events.
 * All file I/O is async to avoid blocking the main scan/execution loop.
 *
 * Designed as a drop-in upgrade for the synchronous saveJSON pattern
 * used in index.js, adding structured lifecycle tracking and close outcome
 * recording without breaking the existing flat-array history.json schema.
 *
 * File schema per trade record:
 * {
 *   patternID:     string,   -- Unique fingerprint ("EURUSD_sell_<headTime>")
 *   ticketId:      string,   -- MetaApi order/ticket ID
 *   symbol:        string,
 *   type:          "buy"|"sell",
 *   entryPrice:    number,
 *   sl:            number,
 *   tp:            number,
 *   volume:        number,   -- Lot size
 *   rr:            string,   -- "2.50" etc.
 *   executionTime: string,   -- ISO 8601
 *   status:        "OPEN"|"CLOSED",
 *   // Fields added on close:
 *   closePrice?:   number,
 *   closeTime?:    string,   -- ISO 8601
 *   realizedPnL?:  number,   -- USD
 *   pipsGained?:   number,
 *   closeReason?:  "TAKE_PROFIT_HIT"|"STOP_LOSS_HIT"|"MANUAL_CLOSE"
 * }
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.resolve(__dirname, "../../history.json");

// --- Internal Helpers --------------------------------------------------------

/**
 * Reads and parses history.json asynchronously.
 * Returns an empty array on any read/parse error (fail-safe).
 *
 * @returns {Promise<Object[]>}
 */
async function readHistory() {
  try {
    const raw = await fs.promises.readFile(HISTORY_PATH, "utf-8");
    const trimmed = raw.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === "ENOENT") {
      // File doesn't exist yet -- that's fine
      return [];
    }
    console.error("[HISTORY LOGGER] Failed to read history.json:", err.message);
    return [];
  }
}

/**
 * Serializes and writes the history array to history.json asynchronously.
 *
 * @param {Object[]} history
 * @returns {Promise<void>}
 */
async function writeHistory(history) {
  try {
    await fs.promises.writeFile(
      HISTORY_PATH,
      JSON.stringify(history, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.error("[HISTORY LOGGER] Failed to write history.json:", err.message);
  }
}

// --- Public API --------------------------------------------------------------

/**
 * Appends a new trade execution payload to history.json with status "OPEN".
 *
 * Designed to be called immediately after a successful placeOrder() call.
 * Non-blocking -- the scan loop does not need to await completion.
 *
 * @param {Object} tradePayload
 * @param {string} tradePayload.patternID     - Unique pattern fingerprint
 * @param {string} tradePayload.ticketId      - Broker order/ticket ID
 * @param {string} tradePayload.symbol        - Trading symbol
 * @param {"buy"|"sell"} tradePayload.type    - Trade direction
 * @param {number} tradePayload.entryPrice    - Executed entry price
 * @param {number} tradePayload.sl            - Stop-loss price
 * @param {number} tradePayload.tp            - Take-profit price
 * @param {number} tradePayload.volume        - Lot size
 * @param {string} tradePayload.rr            - Risk-to-reward ratio (e.g. "2.50")
 * @param {string} [tradePayload.executionTime] - ISO timestamp (defaults to now)
 * @returns {Promise<void>}
 */
export async function logTradeOpen(tradePayload) {
  try {
    const history = await readHistory();

    const record = {
      patternID:     tradePayload.patternID     ?? null,
      ticketId:      tradePayload.ticketId      ?? null,
      symbol:        tradePayload.symbol        ?? null,
      type:          tradePayload.type          ?? null,
      entryPrice:    tradePayload.entryPrice    ?? null,
      sl:            tradePayload.sl            ?? null,
      tp:            tradePayload.tp            ?? null,
      volume:        tradePayload.volume        ?? null,
      rr:            tradePayload.rr            ?? null,
      executionTime: tradePayload.executionTime ?? new Date().toISOString(),
      status:        "OPEN",
    };

    history.push(record);
    await writeHistory(history);

    console.log(
      `[HISTORY LOGGER] Trade OPEN logged | ` +
      `${record.symbol} ${record.type?.toUpperCase()} | ` +
      `Ticket: ${record.ticketId} | Pattern: ${record.patternID}`
    );
  } catch (err) {
    // Never throw -- logging failure must not halt trade execution
    console.error("[HISTORY LOGGER] logTradeOpen error:", err.message);
  }
}

/**
 * Locates an existing OPEN trade record by ticketId (or patternID as fallback)
 * and updates it with close outcome data, setting status to "CLOSED".
 *
 * @param {string} ticketId  - The broker ticket/order ID of the trade to close
 * @param {Object} closeData
 * @param {number} closeData.closePrice  - Exit price
 * @param {string} [closeData.closeTime] - ISO 8601 close timestamp (defaults to now)
 * @param {number} closeData.realizedPnL - Net profit/loss in USD
 * @param {number} closeData.pipsGained  - Pips gained (negative = loss)
 * @param {"TAKE_PROFIT_HIT"|"STOP_LOSS_HIT"|"MANUAL_CLOSE"} closeData.closeReason
 * @param {string} [patternID]           - Optional patternID fallback if ticketId unavailable
 * @returns {Promise<boolean>}           - true if record was found and updated
 */
export async function logTradeClose(ticketId, closeData, patternID = null) {
  try {
    const history = await readHistory();

    // Primary match: ticketId. Fallback: patternID (for manually tracked trades)
    const idx = history.findIndex((record) =>
      (ticketId && record.ticketId === ticketId) ||
      (patternID && record.patternID === patternID)
    );

    if (idx === -1) {
      console.warn(
        `[HISTORY LOGGER] logTradeClose: No matching OPEN record found. ` +
        `ticketId="${ticketId}" patternID="${patternID}"`
      );
      return false;
    }

    const VALID_REASONS = new Set(["TAKE_PROFIT_HIT", "STOP_LOSS_HIT", "MANUAL_CLOSE"]);
    const closeReason = VALID_REASONS.has(closeData.closeReason)
      ? closeData.closeReason
      : "MANUAL_CLOSE";

    history[idx] = {
      ...history[idx],
      status:      "CLOSED",
      closePrice:  closeData.closePrice  ?? null,
      closeTime:   closeData.closeTime   ?? new Date().toISOString(),
      realizedPnL: closeData.realizedPnL ?? null,
      pipsGained:  closeData.pipsGained  ?? null,
      closeReason,
    };

    await writeHistory(history);

    const record = history[idx];
    console.log(
      `[HISTORY LOGGER] Trade CLOSED logged | ` +
      `${record.symbol} | Ticket: ${record.ticketId} | ` +
      `PnL: $${record.realizedPnL?.toFixed(2) ?? "N/A"} | ` +
      `Reason: ${record.closeReason}`
    );

    return true;
  } catch (err) {
    console.error("[HISTORY LOGGER] logTradeClose error:", err.message);
    return false;
  }
}

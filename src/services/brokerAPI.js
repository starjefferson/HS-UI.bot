/**
 * BROKER API SERVICE
 *
 * Architecture: Direct Deriv WebSocket API integration.
 * This is a thin re-export wrapper around derivApi.js so other modules
 * have a consistent import surface regardless of broker changes.
 *
 * NOTE: The previous MT5/HotForex file-based approach has been removed.
 * The bot now executes trades directly via the Deriv WebSocket API.
 */

export { getAccountBalance as getBalance, placeOrder } from "../derivApi.js";

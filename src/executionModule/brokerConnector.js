import { config } from "../config.js";

/**
 * Pip value per lot for major pairs
 * - EURUSD, GBPUSD → $10 per pip per lot
 * - USDJPY → ~$9.1 per pip per lot (approx)
 */
function getPipValuePerLot(symbol) {
  switch (symbol) {
    case "USDJPY":
      return 9.1; // approximate pip value per lot
    case "EURUSD":
    case "GBPUSD":
    default:
      return 10; // $10 per pip per lot
  }
}

/**
 * Calculate lot size based on riskPercent in config
 * balance: account balance
 * entryPrice: trade entry price
 * slPrice: stop loss price
 * symbol: trading pair
 */
function calculateLotSize(balance, entryPrice, slPrice, symbol = "EURUSD") {
  const riskAmount = balance * (config.riskPercent / 100); // 5% of balance

  // Stop loss distance in pips
  let stopLossPips;
  if (symbol === "USDJPY") {
    // JPY pairs: pip = 0.01
    stopLossPips = Math.abs(entryPrice - slPrice) * 100;
  } else {
    // Standard 5-digit pairs: pip = 0.0001
    stopLossPips = Math.abs(entryPrice - slPrice) * 10000;
  }

  const pipValuePerLot = getPipValuePerLot(symbol);

  if (stopLossPips === 0) return config.defaultLotSize || 0.1; // fallback

  const lotSize = riskAmount / (stopLossPips * pipValuePerLot);

  // Round to 0.01 lots minimum
  return Math.max(0.01, parseFloat(lotSize.toFixed(2)));
}

/**
 * Execute trade via broker API (MT5 EA bridge)
 * pattern: { type, pair, entryCandle, sl, tp }
 */
export async function executeTrade(pattern) {
  try {
    const balance = await getBalance();

    const lot = calculateLotSize(
      balance,
      pattern.entryCandle.close,
      pattern.sl,
      pattern.pair
    );

    const signal = {
      action: pattern.type.toLowerCase(), // "buy" or "sell"
      symbol: pattern.pair,
      sl: pattern.sl,
      tp: pattern.tp,
      lot,
    };

    console.log("Sending trade signal to MT5 EA:", signal);

    const res = await fetch("http://127.0.0.1:3000/api/broker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setSignal", ...signal }),
    });

    const data = await res.json();
    console.log("Broker response:", data);
    return data;
  } catch (err) {
    console.error("Trade execution failed:", err);
    return null;
  }
}

/**
 * Get account balance from broker (via EA bridge)
 */
export async function getBalance() {
  try {
    const res = await fetch("http://127.0.0.1:3000/api/broker?type=balance");
    const data = await res.json();
    return data.balance;
  } catch (err) {
    console.error("Balance fetch failed:", err);
    return 0;
  }
}

/**
 * Place order directly (optional shortcut)
 * signal: { action, symbol, sl, tp, lot }
 */
export async function placeOrder(signal) {
  try {
    const res = await fetch("http://127.0.0.1:3000/api/broker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "executeOrder", ...signal }),
    });

    const data = await res.json();
    return data;
  } catch (err) {
    console.error("Order placement failed:", err);
    return null;
  }
}
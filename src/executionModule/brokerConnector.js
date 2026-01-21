import { config } from "../../config.js";

/** Pip value per lot */
function getPipValuePerLot(symbol) {
  switch (symbol) {
    case "USDJPY": return 9.1;
    case "EURUSD":
    case "GBPUSD":
    default: return 10;
  }
}

/** Lot size calculation */
function calculateLotSize(balance, entryPrice, slPrice, symbol = "EURUSD") {
  const riskAmount = balance * (config.riskPercent / 100);
  let stopLossPips = symbol === "USDJPY"
    ? Math.abs(entryPrice - slPrice) * 100
    : Math.abs(entryPrice - slPrice) * 10000;

  const pipValuePerLot = getPipValuePerLot(symbol);
  if (stopLossPips === 0) return config.defaultLotSize || 0.1;

  const lotSize = riskAmount / (stopLossPips * pipValuePerLot);
  return Math.max(0.01, parseFloat(lotSize.toFixed(2)));
}

/** Execute trade via server.js */
export async function executeTrade(pattern) {
  try {
    const balance = await getBalance();
    const lot = calculateLotSize(balance, pattern.entryCandle.close, pattern.sl, pattern.pair);

    const signal = {
      action: pattern.type.toLowerCase(),
      symbol: pattern.pair,
      sl: pattern.sl,
      tp: pattern.tp,
      lot,
    };

    console.log("Sending trade signal:", signal);

    const res = await fetch("http://127.0.0.1:3001/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signal),
    });

    return await res.json();
  } catch (err) {
    console.error("Trade execution failed:", err);
    return null;
  }
}

/** Get account balance */
export async function getBalance() {
  try {
    const res = await fetch("http://127.0.0.1:3001/balance");
    const data = await res.json();
    return data.balance;
  } catch (err) {
    console.error("Balance fetch failed:", err);
    return 0;
  }
}

/** Place order directly */
export async function placeOrder(signal) {
  try {
    const res = await fetch("http://127.0.0.1:3001/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signal),
    });
    return await res.json();
  } catch (err) {
    console.error("Order placement failed:", err);
    return null;
  }
}
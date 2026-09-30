import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { getCandles, getAccountBalance, placeOrder, getOpenPositions, getSymbolPrice } from "./src/metaApi.js";
import { runDetection } from "./src/patternDetection/patternEngine.js";
import * as goldGuard from "./src/risk/goldGuard.js";
import { canExecuteCorrelatedTrade } from "./src/risk/correlationGuard.js";
import { logTradeOpen } from "./src/utils/historyLogger.js";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (fs.existsSync(path.join(__dirname, ".env.local"))) {
  dotenv.config({ path: path.join(__dirname, ".env.local") });
} else if (fs.existsSync(path.join(__dirname, ".env"))) {
  dotenv.config({ path: path.join(__dirname, ".env") });
} else {
  dotenv.config();
}

const PAIRS = [
  // Forex Majors (7) — deep liquidity, clean H&S structure
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
  // Precious Metals (1)
  "XAUUSD",
  // Best FX Crosses (4) — high liquidity, reliable MetaApi data
  "EURGBP", "EURJPY", "GBPJPY", "AUDJPY",
];

const HISTORY_PATH = "./history.json";
const RISK_PERCENT = parseFloat(process.env.RISK_PERCENT || "2.0");
const MIN_RR = parseFloat(process.env.MIN_RR || "2.5");
const MAX_RR = parseFloat(process.env.MAX_RR || "3.0");

const loadJSON = (f) => {
  try {
    if (!fs.existsSync(f)) { fs.writeFileSync(f, "[]"); return []; }
    return JSON.parse(fs.readFileSync(f, "utf-8"));
  } catch (e) { return []; }
};

const saveJSON = (f, d) => {
  try { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }
  catch (e) { console.error(`❌ DISK ERROR: ${e.code}`); }
};

const calculateSMA = (data, period) => {
  if (!data || data.length < period) return null;
  const sum = data.slice(0, period).reduce((acc, c) => acc + c.close, 0);
  return sum / period;
};

/**
 * Central Scan Cycle for IC Markets via MetaApi
 */
async function runTradingCycle() {
  console.log(`\n==================================================`);
  console.log(`🔍 [${new Date().toISOString()}] Starting IC Markets (MetaApi) Market Scan...`);
  console.log(`==================================================`);

  const history = loadJSON(HISTORY_PATH);
  const balance = await getAccountBalance();

  // Fetch live open positions once per cycle for the correlation guard.
  // Degrades gracefully to [] on error — guard will pass all trades through.
  const openPositions = await getOpenPositions();

  for (const symbol of PAIRS) {
    try {
      // 1. Fetch historical candles for 1W, 1D, 4H, 1H from MetaApi
      const w1 = await getCandles(symbol, "1W", 50);
      const d1 = await getCandles(symbol, "1D", 200);
      const h4 = await getCandles(symbol, "4H", 200);
      const h1 = await getCandles(symbol, "1H", 200);

      if (!w1 || !d1 || !h4 || !h1 || h1.length < 200) {
        console.log(`⚠️ [${symbol}] Insufficient candle history returned from MetaApi.`);
        continue;
      }

      const candleData = { "1W": w1, "1D": d1, "4H": h4, "1H": h1 };
      const currentPrice = h1[0].close;

      // 2. Trend Alignment (3/4 SMA Rule)
      const getDir = (tf) => {
        const d = candleData[tf];
        if (!d || d.length < 20) return "none";
        const sma = calculateSMA(d, 20);
        return (sma && d[0].close > sma) ? "buy" : "sell";
      };

      const t = { W1: getDir("1W"), D1: getDir("1D"), H4: getDir("4H"), H1: getDir("1H") };
      const buyPoints = Object.values(t).filter(v => v === "buy").length;
      const sellPoints = Object.values(t).filter(v => v === "sell").length;
      const bias = (buyPoints >= 3) ? "buy" : (sellPoints >= 3) ? "sell" : "none";

      console.log(`📡 [${symbol}] Trends | W1:${t.W1} D1:${t.D1} H4:${t.H4} H1:${t.H1} | Bias: ${bias.toUpperCase()}`);

      if (bias === "none") continue;

      // 3. Pattern Detection Engine
      const pattern = runDetection(candleData, symbol);
      if (!pattern) continue;

      if (pattern.type !== bias) {
        console.log(`⚠️ [${symbol}] Pattern detected (${pattern.type.toUpperCase()}) but conflicts with Bias (${bias.toUpperCase()})`);
        continue;
      }

      // 4. Pattern Fingerprinting Guard (One & Done)
      const patternID = `${symbol}_${pattern.type}_${pattern.headTime}`;
      if (history.find(h => h.patternID === patternID)) {
        console.log(`ℹ️ [${symbol}] Pattern ${patternID} already traded or processed.`);
        continue;
      }

      // 5. Distribution Guard (Stop chasing if price moved too far)
      const isJpy = symbol.includes("JPY");
      const tooFar = isJpy ? 0.20 : 0.0020;
      if (pattern.type === "sell" && currentPrice < (pattern.necklineLow - tooFar)) {
        console.log(`❌ [${symbol}] Setup Expired: Price already distributed past neckline.`);
        continue;
      }
      if (pattern.type === "buy" && currentPrice > (pattern.necklineHigh + tooFar)) {
        console.log(`❌ [${symbol}] Setup Expired: Price already distributed past neckline.`);
        continue;
      }

      // 6. Breakout & Close Trigger Check
      const isBreakout = (pattern.type === "sell" && currentPrice < pattern.necklineLow) ||
                         (pattern.type === "buy" && currentPrice > pattern.necklineHigh);

      if (!isBreakout) {
        console.log(`⏳ [${symbol}] Pattern Valid. Waiting for breakout close past zone [${pattern.necklineLow} - ${pattern.necklineHigh}]`);
        continue;
      }

      // 7. Risk-to-Reward (RR) Filter
      const risk = Math.abs(currentPrice - pattern.sl);
      const reward = Math.abs(pattern.tp - currentPrice);
      const rr = reward / risk;

      if (rr < MIN_RR || rr > MAX_RR) {
        console.log(`⚠️ [${symbol}] Rejected RR: ${rr.toFixed(2)} (Target: ${MIN_RR} - ${MAX_RR})`);
        continue;
      }

      // 8. Trade Frequency Guard (Max 10 trades per rolling week, no cooldown)
      const nowMs = Date.now();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      const tradesThisWeek = history.filter(h => (nowMs - new Date(h.executionTime).getTime()) < oneWeekMs);
      
      if (tradesThisWeek.length >= 10) {
        console.log(`🚫 [${symbol}] Risk Manager: Weekly trade limit (10 trades/week) reached (${tradesThisWeek.length}/10). Skipping.`);
        continue;
      }

      // ── Pre-Trade Validation Pipeline ──────────────────────────────────────

      // 8.5a. Currency Correlation Guard
      // Blocks entry if either the base or quote currency already has 2 open
      // trades, preventing dangerous cluster exposure to a single currency.
      const correlationCheck = canExecuteCorrelatedTrade(symbol, openPositions);
      if (!correlationCheck.isAllowed) {
        console.log(`[CORRELATION GUARD] ${symbol} blocked: ${correlationCheck.reason}`);
        continue;
      }

      // 8.5b. Gold-Specific Guards (only applied when symbol is XAUUSD / GOLD)
      if (goldGuard.isGoldSymbol(symbol)) {
        // Live spread check using MetaApi tick price
        try {
          const priceInfo = await getSymbolPrice(symbol);
          if (priceInfo?.bid && priceInfo?.ask) {
            const spreadCheck = goldGuard.validateGoldSpread(priceInfo.bid, priceInfo.ask);
            if (!spreadCheck.allowed) {
              console.log(`[GOLD GUARD] ${symbol} blocked: Spread too wide ($${spreadCheck.spread}).`);
              continue;
            }
          }
        } catch (_) {
          // Non-fatal — if price fetch fails, skip spread check for this cycle
          console.warn(`[GOLD GUARD] ${symbol}: Spread check skipped (price fetch error).`);
        }

        // Gold Distribution Guard: rejects if price moved > $3.00 past neckline
        const necklineRef = pattern.type === "sell" ? pattern.necklineLow : pattern.necklineHigh;
        if (goldGuard.isGoldDistributed(currentPrice, necklineRef)) {
          console.log(`[GOLD GUARD] ${symbol} blocked: Price distributed > $3.00 past neckline.`);
          continue;
        }
      }


      // ── End Pre-Trade Validation Pipeline ──────────────────────────────────

      // 9. Order Execution via MetaApi
      const stakeAmount = balance * (RISK_PERCENT / 100);
      console.log(`🎯 [${symbol}] TARGET RR ACHIEVED (${rr.toFixed(2)}). Placing IC Markets Order ($${stakeAmount.toFixed(2)} Risk Stake)...`);

      const orderResult = await placeOrder({
        symbol,
        amount: stakeAmount,
        side: pattern.type,
        sl: pattern.sl,
        tp: pattern.tp
      });

      if (orderResult) {
        console.log(`🚀 [MetaApi] Order Executed Successfully for ${symbol}! Order ID: ${orderResult.contract_id}`);

        // Record in history.json via async historyLogger (non-blocking)
        logTradeOpen({
          patternID,
          ticketId:      String(orderResult.contract_id),
          symbol,
          type:          pattern.type,
          entryPrice:    orderResult.entryPrice ?? currentPrice,
          sl:            pattern.sl,
          tp:            pattern.tp,
          volume:        orderResult.volume,
          rr:            rr.toFixed(2),
          executionTime: new Date().toISOString(),
        });

        // Keep the synchronous in-memory history array up to date so the
        // fingerprinting guard (step 4) works correctly within the same cycle.
        history.push({ patternID, executionTime: new Date().toISOString() });
      }

    } catch (err) {
      console.error(`❌ Critical Error processing ${symbol}:`, err.message);
    }
  }
}

/**
 * Smart Hourly Scheduler
 * Waits until 5 seconds past the top of the next hour before running the next scan cycle.
 */
function scheduleNextHourlyScan() {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 5, 0);

  const delayMs = nextHour.getTime() - now.getTime();
  const minutesRemaining = (delayMs / 1000 / 60).toFixed(1);

  console.log(`\n⏰ Next scheduled scan in ${minutesRemaining} minutes (at ${nextHour.toLocaleTimeString()}).`);

  setTimeout(async () => {
    await runTradingCycle();
    scheduleNextHourlyScan();
  }, delayMs);
}

// Startup Engine
console.log("🚀 Starting Standalone MetaApi Head & Shoulders Trading Engine (Smart Hourly Mode)...");
runTradingCycle().then(() => {
  scheduleNextHourlyScan();
});
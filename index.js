import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { getCandles, getAccountBalance, placeOrder, getOpenPositions, getSymbolPrice, ensureMetaApiConnection } from "./src/metaApi.js";
import { runDetection } from "./src/patternDetection/patternEngine.js";
import * as goldGuard from "./src/risk/goldGuard.js";
import { canExecuteCorrelatedTrade } from "./src/risk/correlationGuard.js";
import { logTradeOpen } from "./src/utils/historyLogger.js";
import { config } from "./config.js";


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
const RISK_PERCENT = Number(process.env.RISK_PERCENT ?? config.riskPercent);
const MIN_RR = Number(process.env.MIN_RR ?? config.rrRatio);
const BREAKOUT_BUFFER_PIPS = Number(
  process.env.BREAKOUT_BUFFER_PIPS ?? config.breakoutBufferPips
);

if (!Number.isFinite(RISK_PERCENT) || RISK_PERCENT <= 0 || RISK_PERCENT > config.riskPercent) {
  throw new Error(`RISK_PERCENT must be greater than 0 and no more than ${config.riskPercent}.`);
}
if (!Number.isFinite(MIN_RR) || MIN_RR < 2.5) {
  throw new Error("MIN_RR must be at least 2.5.");
}
if (!Number.isFinite(BREAKOUT_BUFFER_PIPS) || BREAKOUT_BUFFER_PIPS < 0) {
  throw new Error("BREAKOUT_BUFFER_PIPS must be a finite non-negative number.");
}

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

function getPipSize(symbol) {
  if (symbol.includes("JPY")) return 0.01;
  if (symbol.includes("XAU") || symbol.includes("GOLD")) return 0.01;
  return 0.0001;
}

/**
 * Central Scan Cycle for IC Markets via MetaApi
 */
async function runTradingCycle() {
  console.log(`\n==================================================`);
  console.log(`🔍 [${new Date().toISOString()}] Starting IC Markets (MetaApi) Market Scan...`);
  console.log(`==================================================`);

  const history = loadJSON(HISTORY_PATH);
  let balance;
  try {
    balance = await getAccountBalance();
  } catch (error) {
    console.error(`❌ [MetaApi] Market scan aborted: account equity is unavailable (${error.message || error}).`);
    return;
  }

  // Fetch live open positions once per cycle for the correlation guard.
  // Degrades gracefully to [] on error — guard will pass all trades through.
  const openPositions = await getOpenPositions();

  for (const symbol of PAIRS) {
    let finalStatus = `⏭️ [${symbol}] Status: Scan complete (No valid setup)`;
    try {
      // Stage 1: Fetch historical candles for all scan timeframes.
      console.log(`📥 [${symbol}] Fetching candles: W1, D1, H4, H1...`);
      await ensureMetaApiConnection();
      const w1 = await getCandles(symbol, "1W", 50);
      const d1 = await getCandles(symbol, "1D", 200);
      const h4 = await getCandles(symbol, "4H", 200);
      const h1 = await getCandles(symbol, "1H", 200);

      const candleData = { "1W": w1, "1D": d1, "4H": h4, "1H": h1 };
      const getDir = (tf) => {
        const d = candleData[tf];
        if (!d || d.length < 20) return "none";
        const sma = calculateSMA(d, 20);
        return (sma && d[0].close > sma) ? "buy" : "sell";
      };

      // Stage 2: Trend alignment (3/4 SMA Rule).
      const t = { W1: getDir("1W"), D1: getDir("1D"), H4: getDir("4H"), H1: getDir("1H") };
      const buyPoints = Object.values(t).filter(v => v === "buy").length;
      const sellPoints = Object.values(t).filter(v => v === "sell").length;
      const bias = (buyPoints >= 3) ? "buy" : (sellPoints >= 3) ? "sell" : "none";
      console.log(`📡 [${symbol}] Trends | W1:${t.W1} D1:${t.D1} H4:${t.H4} H1:${t.H1} | Bias: ${bias.toUpperCase()}`);

      if (!w1 || !d1 || !h4 || !h1 || h1.length < 200) {
        console.log(`⚠️ [${symbol}] Insufficient candle history returned from MetaApi.`);
        console.log(`ℹ️ [${symbol}] No valid Head & Shoulders pattern detected.`);
        continue;
      }

      const currentPrice = h1[0].close;

      if (bias === "none") {
        console.log(`ℹ️ [${symbol}] Scan skipped: W1/D1/H4/H1 trend bias is not aligned.`);
        continue;
      }

      // Stage 3: Pattern detection; the callback also reports valid structures
      // that are still waiting for their 1H breakout.
      let patternDetected = false;
      const pattern = runDetection(candleData, symbol, bias, ({ type, activeTFs, stage }) => {
        patternDetected = true;
        if (stage === "waiting-breakout" || stage === "waiting-data") {
          console.log(`✅ [${symbol}] H&S Pattern Detected: [${type.toUpperCase()}/${activeTFs.join("+")}]`);
          finalStatus = `⏳ [${symbol}] Pending: Waiting for neckline break`;
        } else if (stage === "breakout-missed") {
          console.log(`ℹ️ [${symbol}] Pattern [${type.toUpperCase()}/${activeTFs.join("+")}] breakout already occurred; re-entry disabled.`);
          finalStatus = `⏭️ [${symbol}] Status: Scan complete (Breakout missed; no re-entry)`;
        } else if (stage === "breakout-history-insufficient") {
          finalStatus = `⏭️ [${symbol}] Status: Scan complete (Breakout history unavailable; no entry)`;
        } else if (stage === "breakout-confirmed") {
          console.log(`✅ [${symbol}] H&S Pattern Detected: [${type.toUpperCase()}/${activeTFs.join("+")}]`);
          finalStatus = `⏭️ [${symbol}] Status: Scan complete (No valid setup)`;
        } else if (stage === "invalid-levels") {
          finalStatus = `⏭️ [${symbol}] Status: Scan complete (Invalid trade levels)`;
        } else if (stage === "rr-rejected") {
          finalStatus = `⏭️ [${symbol}] Status: Scan complete (Breakout close below minimum RR)`;
        }
      }, {
        breakoutBuffer: getPipSize(symbol) * BREAKOUT_BUFFER_PIPS,
        minimumRR: MIN_RR
      });

      if (!patternDetected) {
        console.log(
          `ℹ️ [${symbol}] No actionable setup returned; see pattern geometry and timeframe diagnostics above.`
        );
      }

      if (!pattern) {
        continue;
      }

      // 4. Pattern Fingerprinting Guard (One & Done)
      const patternID = `${symbol}_${pattern.type}_${pattern.headTime}`;
      if (history.find(h => h.patternID === patternID)) {
        console.log(`ℹ️ [${symbol}] Pattern ${patternID} already traded or processed.`);
        continue;
      }

      // 7. Require pattern-based reward to preserve the configured minimum RR.
      const entryPrice = pattern.entryPrice;
      const risk = pattern.type === "sell"
        ? pattern.sl - entryPrice
        : entryPrice - pattern.sl;
      const reward = pattern.type === "sell"
        ? entryPrice - pattern.tp
        : pattern.tp - entryPrice;
      const rr = risk > 0 ? reward / risk : NaN;

      if (!(risk > 0) || !(reward > 0) || !Number.isFinite(rr) || rr < MIN_RR) {
        console.log(
          `❌ [${symbol}] REJECTED: Invalid levels or breakout overextended below minimum RR | ` +
          `Entry: ${entryPrice} | SL: ${pattern.sl} | TP: ${pattern.tp} | ` +
          `RR: ${Number.isFinite(rr) ? rr.toFixed(2) : "invalid"} | Minimum: ${MIN_RR} | ` +
          `Risk: ${risk} | Reward: ${reward}`
        );
        continue;
      }

      // 8. Trade Frequency Guard (Max 10 trades per rolling week, no cooldown)
      const nowMs = Date.now();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      const tradesThisWeek = history.filter(h => (nowMs - new Date(h.executionTime).getTime()) < oneWeekMs);
      
      if (tradesThisWeek.length >= 10) {
        console.log(`❌ [${symbol}] REJECTED: Weekly trade limit reached | Trades: ${tradesThisWeek.length} | Required: <10`);
        continue;
      }

      // ── Pre-Trade Validation Pipeline ──────────────────────────────────────

      // 8.5a. Currency Correlation Guard
      // Blocks entry if either the base or quote currency already has 2 open
      // trades, preventing dangerous cluster exposure to a single currency.
      const correlationCheck = canExecuteCorrelatedTrade(symbol, openPositions);
      if (!correlationCheck.isAllowed) {
        console.log(`❌ [${symbol}] REJECTED: Currency correlation guard | Reason: ${correlationCheck.reason}`);
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
              console.log(`❌ [${symbol}] REJECTED: Gold spread too wide | Spread: $${spreadCheck.spread}`);
              continue;
            }
          }
        } catch (err) {
          // Non-fatal — if price fetch fails, skip spread check for this cycle
          console.warn(`[GOLD GUARD] ${symbol}: Spread check skipped (price fetch error): ${err?.message || String(err)}`);
        }

      }


      // ── End Pre-Trade Validation Pipeline ──────────────────────────────────

      // 9. Order Execution via MetaApi
      const stakeAmount = balance * (RISK_PERCENT / 100);
      console.log(`🎯 [${symbol}] RR ${rr.toFixed(2)} meets minimum ${MIN_RR}. Maximum risk budget: $${stakeAmount.toFixed(2)}.`);

      const orderResult = await placeOrder({
        symbol,
        amount: stakeAmount,
        side: pattern.type,
        sl: pattern.sl,
        tp: pattern.tp,
        minimumRR: MIN_RR
      });

      if (orderResult) {
        finalStatus = `🚀 [${symbol}] Action: Executing Trade / Sending Alert | Order ID: ${orderResult.contract_id}`;

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
      } else {
        console.error(`❌ [${symbol}] Trade execution failed: MetaApi did not return an order result.`);
        finalStatus = `❌ [${symbol}] Status: Trade execution failed`;
      }

    } catch (err) {
      const message = err?.message || String(err);
      console.error(`❌ [${symbol}] Scan skipped due to RPC error: ${message}`);
      finalStatus = `❌ [${symbol}] Status: Scan skipped due to RPC error`;
    } finally {
      console.log(finalStatus);
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
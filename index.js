import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { getCandles, getAccountBalance, placeOrder, getOpenPositionsForSafety, getSymbolPrice, ensureMetaApiConnection } from "./src/metaApi.js";
import {
  runDetection,
  getPendingHourlyStructures,
  checkPendingHourlyBreakout,
  setHourlyStructureMonitoringState,
  pauseHourlyStructureMonitoring
} from "./src/patternDetection/patternEngine.js";
import * as goldGuard from "./src/risk/goldGuard.js";
import { canExecuteCorrelatedTrade } from "./src/risk/correlationGuard.js";
import { logTradeOpen } from "./src/utils/historyLogger.js";
import { getFormattedSymbols } from "./src/utils/symbolHelper.js";
import { config } from "./config.js";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (fs.existsSync(path.join(__dirname, ".env.local"))) {
  dotenv.config({ path: path.join(__dirname, ".env.local") });
} else if (fs.existsSync(path.join(__dirname, ".env"))) {
  dotenv.config({ path: path.join(__dirname, ".env") });
} else {
  dotenv.config();
}

const BASE_PAIRS = config.pairs;
const PAIRS = getFormattedSymbols(BASE_PAIRS);
const MAX_OPEN_TRADES = 5;
const executingPatterns = new Set();
const processedPatterns = new Set();
let orderQueue = Promise.resolve();

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

async function withOrderLock(task) {
  const previous = orderQueue;
  let release;
  orderQueue = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

async function executePatternTrade({ symbol, pattern, history, balance, currentPrice }) {
  const patternID = `${symbol}_${pattern.type}_${pattern.headTime}` +
    (Number.isFinite(pattern.breakoutTime) ? `_${pattern.breakoutTime}` : "");
  if (processedPatterns.has(patternID) || history.find(h => h.patternID === patternID)) {
    console.log(`ℹ️ [${symbol}] Pattern ${patternID} already traded or processed.`);
    if (pattern.structuralTF === "1H") {
      setHourlyStructureMonitoringState(symbol, pattern.headTime, "pending");
    }
    return null;
  }
  if (executingPatterns.has(patternID)) {
    console.log(`ℹ️ [${symbol}] Pattern ${patternID} is already being executed.`);
    return null;
  }

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
    return null;
  }

  const nowMs = Date.now();
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
  const tradesThisWeek = history.filter(h => (nowMs - new Date(h.executionTime).getTime()) < oneWeekMs);
  if (tradesThisWeek.length >= 10) {
    console.log(`❌ [${symbol}] REJECTED: Weekly trade limit reached | Trades: ${tradesThisWeek.length} | Required: <10`);
    return null;
  }

  if (goldGuard.isGoldSymbol(symbol)) {
    try {
      const priceInfo = await getSymbolPrice(symbol);
      if (priceInfo?.bid && priceInfo?.ask) {
        const spreadCheck = goldGuard.validateGoldSpread(priceInfo.bid, priceInfo.ask);
        if (!spreadCheck.allowed) {
          console.log(`❌ [${symbol}] REJECTED: Gold spread too wide | Spread: $${spreadCheck.spread}`);
          return null;
        }
      }
    } catch (err) {
      console.warn(`[GOLD GUARD] ${symbol}: Spread check skipped (price fetch error): ${err?.message || String(err)}`);
    }
  }

  if (executingPatterns.has(patternID)) return null;
  executingPatterns.add(patternID);
  try {
    return await withOrderLock(async () => {
      if (processedPatterns.has(patternID) || history.find(h => h.patternID === patternID)) {
        console.log(`ℹ️ [${symbol}] Pattern ${patternID} already traded or processed.`);
        if (pattern.structuralTF === "1H") {
          setHourlyStructureMonitoringState(symbol, pattern.headTime, "pending");
        }
        return null;
      }

      let openPositions;
      try {
        openPositions = await getOpenPositionsForSafety();
      } catch (error) {
        console.error(`❌ [MetaApi] Open-position safety check failed for ${symbol}: ${error.message || error}`);
        console.error(`⚠️ [${symbol}] SAFETY: Refusing order because the number of open trades could not be verified.`);
        if (pattern.structuralTF === "1H") {
          setHourlyStructureMonitoringState(symbol, pattern.headTime, "pending", true);
        }
        return `❌ [${symbol}] Status: Open-trade safety check failed`;
      }

      if (openPositions.length >= MAX_OPEN_TRADES) {
        console.warn(
          `⚠️ [${symbol}] SAFETY: Maximum open trades reached (${openPositions.length}/${MAX_OPEN_TRADES}); ` +
          `order skipped and structure remains monitored.`
        );
        if (pattern.structuralTF === "1H") {
          setHourlyStructureMonitoringState(symbol, pattern.headTime, "pending", true);
        }
        return `⏭️ [${symbol}] Status: Maximum open trades reached (${openPositions.length}/${MAX_OPEN_TRADES})`;
      }

      const correlationCheck = canExecuteCorrelatedTrade(symbol, openPositions);
      if (!correlationCheck.isAllowed) {
        console.log(`❌ [${symbol}] REJECTED: Currency correlation guard | Reason: ${correlationCheck.reason}`);
        return null;
      }

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

      if (!orderResult) {
        console.error(`❌ [${symbol}] Trade execution failed: MetaApi did not return an order result.`);
        return `❌ [${symbol}] Status: Trade execution failed`;
      }

      const executionTime = new Date().toISOString();
      const status = `🚀 [${symbol}] Action: Executing Trade / Sending Alert | Order ID: ${orderResult.contract_id}`;
      logTradeOpen({
        patternID,
        ticketId: String(orderResult.contract_id),
        symbol,
        type: pattern.type,
        entryPrice: orderResult.entryPrice ?? currentPrice,
        sl: pattern.sl,
        tp: pattern.tp,
        volume: orderResult.volume,
        rr: rr.toFixed(2),
        executionTime
      });
      history.push({ patternID, executionTime });
      processedPatterns.add(patternID);
      if (pattern.structuralTF === "1H") {
        setHourlyStructureMonitoringState(symbol, pattern.headTime, "pending");
      }
      return status;
    });
  } finally {
    executingPatterns.delete(patternID);
  }
}

/**
 * Central Scan Cycle for HotForex via MetaApi
 */
async function runTradingCycle() {
  console.log(`\n==================================================`);
  console.log(`🔍 [${new Date().toISOString()}] Starting HotForex (MetaApi) Market Scan...`);
  console.log(`==================================================`);

  const history = loadJSON(HISTORY_PATH);
  let balance;
  try {
    balance = await getAccountBalance();
  } catch (error) {
    console.error(`❌ [MetaApi] Market scan aborted: account equity is unavailable (${error.message || error}).`);
    return;
  }

  for (const [pairIndex, brokerSymbol] of PAIRS.entries()) {
    const symbol = BASE_PAIRS[pairIndex];
    let finalStatus = `⏭️ [${symbol}] Status: Scan complete (No valid setup)`;
    try {
      // Stage 1: Fetch historical candles for all scan timeframes.
      console.log(`📥 [${symbol}] Fetching candles: W1, D1, H4, H1, M15...`);
      await ensureMetaApiConnection();
      const w1  = await getCandles(brokerSymbol, "1W",  50);
      const d1  = await getCandles(brokerSymbol, "1D",  200);
      const h4  = await getCandles(brokerSymbol, "4H",  200);
      const h1  = await getCandles(brokerSymbol, "1H",  200);
      const m15 = await getCandles(brokerSymbol, "15m", 200);

      const candleData = { "1W": w1, "1D": d1, "4H": h4, "1H": h1, "15m": m15 };
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
        pauseHourlyStructureMonitoring(symbol);
        console.log(`⚠️ [${symbol}] Insufficient candle history returned from MetaApi.`);
        console.log(`ℹ️ [${symbol}] No valid Head & Shoulders pattern detected.`);
        continue;
      }

      const currentPrice = h1[0].close;

      if (bias === "none") {
        pauseHourlyStructureMonitoring(symbol);
        console.log(`ℹ️ [${symbol}] Scan skipped: W1/D1/H4/H1 trend bias is not aligned.`);
        continue;
      }

      // Stage 3: Pattern detection; the callback also reports valid structures
      // that are still waiting for their timeframe-appropriate breakout.
      let patternDetected = false;
      const pattern = runDetection(candleData, symbol, bias, ({ type, activeTFs, structuralTF, stage }) => {
        patternDetected = true;
        if (stage === "waiting-breakout" || stage === "waiting-data") {
          console.log(
            `✅ [${symbol}] H&S Pattern Detected: ${type.toUpperCase()} | ` +
            `Entry/SL/TP levels: ${structuralTF} | Detected structures: ${activeTFs.join("+")}`
          );
          finalStatus = `⏳ [${symbol}] Pending: Waiting for neckline break`;
        } else if (stage === "breakout-missed") {
          console.log(
            `ℹ️ [${symbol}] ${type.toUpperCase()} pattern breakout already occurred; ` +
            `entry/SL/TP source was ${structuralTF}; detected structures: ${activeTFs.join("+")}. ` +
            `Re-entry disabled.`
          );
          finalStatus = `⏭️ [${symbol}] Status: Scan complete (Breakout missed; no re-entry)`;
        } else if (stage === "breakout-history-insufficient") {
          finalStatus = `⏭️ [${symbol}] Status: Scan complete (Breakout history unavailable; no entry)`;
        } else if (stage === "breakout-confirmed") {
          console.log(
            `✅ [${symbol}] ${type.toUpperCase()} pattern breakout confirmed; ` +
            `entry/SL/TP source: ${structuralTF}; detected structures: ${activeTFs.join("+")}.`
          );
          finalStatus = `⏭️ [${symbol}] Status: Scan complete (No valid setup)`;
        } else if (stage === "invalid-levels") {
          finalStatus = `⏭️ [${symbol}] Status: Scan complete (Invalid trade levels)`;
        } else if (stage === "rr-rejected") {
          finalStatus = `⏭️ [${symbol}] Status: Scan complete (No safe target meets minimum RR)`;
        }
      }, {
        breakoutBuffer: getPipSize(symbol) * BREAKOUT_BUFFER_PIPS,
        minimumRR: MIN_RR,
        deferHourlyBreakouts: true
      });

      if (!patternDetected) {
        console.log(
          `ℹ️ [${symbol}] No actionable setup returned; see pattern geometry and timeframe diagnostics above.`
        );
      }

      if (!pattern) {
        continue;
      }

      const tradeStatus = await executePatternTrade({
        symbol,
        pattern,
        history,
        balance,
        currentPrice
      });
      if (tradeStatus) finalStatus = tradeStatus;

    } catch (err) {
      const message = err?.message || String(err);
      console.error(`❌ [${symbol}] Scan skipped due to RPC error: ${message}`);
      finalStatus = `❌ [${symbol}] Status: Scan skipped due to RPC error`;
    } finally {
      console.log(finalStatus);
    }
  }
}

async function runBreakoutMonitoringCycle() {
  const pendingStructures = getPendingHourlyStructures();
  if (pendingStructures.length === 0) return;

  console.log(
    `\n🔎 [${new Date().toISOString()}] Checking ${pendingStructures.length} armed 1H structure(s) for 15m breakouts...`
  );

  const history = loadJSON(HISTORY_PATH);
  const pairIndexes = new Map(BASE_PAIRS.map((symbol, index) => [symbol, index]));

  for (const { symbol } of pendingStructures) {
    const pairIndex = pairIndexes.get(symbol);
    if (pairIndex === undefined) {
      console.error(`❌ [15m Monitor] Ignoring unconfigured monitored symbol: ${symbol}`);
      continue;
    }

    try {
      await ensureMetaApiConnection();
      const candles = await getCandles(PAIRS[pairIndex], "15m", 200);
      const closedCandles = (candles || []).filter(candle =>
        Number.isFinite(candle.time) && candle.time + 15 * 60 * 1000 <= Date.now()
      );
      if (closedCandles.length === 0) {
        console.log(`⏳ [${symbol}] 15m monitor waiting: no fully closed 15m candle is available.`);
        continue;
      }

      const pattern = checkPendingHourlyBreakout(
        symbol,
        closedCandles,
        getPipSize(symbol) * BREAKOUT_BUFFER_PIPS,
        MIN_RR
      );
      if (!pattern) continue;

      const balance = await getAccountBalance();
      const tradeStatus = await executePatternTrade({
        symbol,
        pattern,
        history,
        balance,
        currentPrice: pattern.entryPrice
      });
      if (tradeStatus) console.log(tradeStatus);
    } catch (error) {
      console.error(`❌ [${symbol}] 15m breakout check skipped due to RPC error: ${error?.message || error}`);
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
    try {
      await runTradingCycle();
    } catch (err) {
      console.error(`❌ [Scheduler] Hourly scan cycle failed: ${err?.message || err}. Continuing to next cycle.`);
    }
    scheduleNextHourlyScan();
  }, delayMs);
}

function scheduleNextBreakoutMonitor() {
  const now = new Date();
  const nextCheck = new Date(now);
  nextCheck.setSeconds(5, 0);
  nextCheck.setMinutes(Math.floor(now.getMinutes() / 15) * 15 + 15);

  const delayMs = nextCheck.getTime() - now.getTime();
  setTimeout(async () => {
    try {
      await runBreakoutMonitoringCycle();
    } catch (err) {
      console.error(`❌ [15m Monitor] Check cycle failed: ${err?.message || err}. Continuing to next check.`);
    }
    scheduleNextBreakoutMonitor();
  }, delayMs);
}

// Startup Engine
console.log("🚀 Starting Standalone MetaApi Head & Shoulders Trading Engine (HotForex / Smart Hourly Mode)...");

runTradingCycle()
  .catch((err) => {
    console.error(`❌ [Startup] Initial scan cycle failed: ${err?.message || err}. Scheduler will retry on next hour.`);
  })
  .then(() => {
    scheduleNextHourlyScan();
    scheduleNextBreakoutMonitor();
  });
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { runDetection } from "./src/patternDetection/patternEngine.js";
import { canTrade } from "./src/riskManagement/risk.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = 3001;

app.use(express.json({ limit: "100mb" }));

const signalsPath     = "./signals.json";
const historyPath     = "./history.json";
const closedPath      = "./closedTrades.json";

// ─── GLOBAL STATE ────────────────────────────────────────────────────────────
// executionLock: prevents a double-fill if two MT5 ticks hit /execute at the
// same millisecond before the first write completes.
let executionLock = false;

// lastBalance: updated every time MT5 polls /execute with ?balance=XXX.
// Served back to the Next.js Dashboard via GET /balance.
let lastBalance = 0;

// ─── AUTO-CLEAR ON STARTUP ───────────────────────────────────────────────────
// Wipe the pending signal queue so we start clean every time the server boots.
const clearPendingSignals = () => {
    try {
        console.log("🧹 [System] Clearing pending queue for a clean start...");
        fs.writeFileSync(signalsPath, "[]");
    } catch (e) {
        console.error("❌ Failed to clear signals.json:", e);
    }
};
clearPendingSignals();

// ─── FILE HELPERS ────────────────────────────────────────────────────────────
const loadJSON = (f) => {
    try {
        if (!fs.existsSync(f)) { fs.writeFileSync(f, "[]"); return []; }
        const data = fs.readFileSync(f, "utf-8");
        return data ? JSON.parse(data) : [];
    } catch (e) { return []; }
};

const saveJSON = (f, d) => {
    try { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }
    catch (e) { console.error(`❌ DISK ERROR: ${e.code}`); }
};

// ─── MATH HELPERS ────────────────────────────────────────────────────────────
const calculateSMA = (data, period) => {
    if (!data || data.length < period) return null;
    const sum = data.slice(0, period).reduce((acc, c) => acc + c.close, 0);
    return sum / period;
};

function calculateLotSize(balance, entry, sl, symbol) {
    const riskAmount = balance * (config.riskPercent / 100);
    const isJpy  = symbol.includes("JPY");
    const pipSize = isJpy ? 0.01 : 0.0001;
    const slPips  = Math.abs(entry - sl) / pipSize;
    if (slPips <= 1) return 0.01;
    let lots = riskAmount / (slPips * 10);
    return Math.max(0.01, Math.round(lots * 100) / 100);
}

// ─── BALANCE ROUTE (for the Next.js Dashboard) ───────────────────────────────
// The MT5 EA sends its live account balance on every /execute poll.
// We cache it here so the Dashboard can display it without hitting MT5 directly.
app.get("/balance", (req, res) => {
    res.json({ balance: lastBalance });
});

// ─── CANDLE HANDLER ──────────────────────────────────────────────────────────
app.post("/candles", (req, res) => {
    try {
        const { candleData, symbol } = req.body;
        if (!candleData || !symbol) return res.json({ status: "waiting" });

        // ── Trading Hours Guard (GMT+1) ──────────────────────────────────────
        // Only scan for patterns during the configured trading window.
        // Signals queued outside this window would force the EA to execute at bad times.
        const nowHour = new Date().getUTCHours() + 1; // convert UTC to GMT+1
        if (nowHour < config.tradingHours.start || nowHour >= config.tradingHours.end) {
            return res.json({ status: "outside_hours" });
        }

        const h1 = candleData["1H"];
        const h4 = candleData["4H"];
        if (!h1 || h1.length < 2 || !h4 || h4.length < 2) return res.json({ status: "low_data" });

        // ── 1. Trend Alignment — 3-of-4 SMA Filter ──────────────────────────
        // For each timeframe, we check if price is above the 20-candle SMA.
        // Above SMA = bullish bias, Below SMA = bearish bias.
        // We need at least 3 of the 4 timeframes (W1, D1, H4, H1) to agree
        // before we consider the market directionally aligned.
        const getDir = (tf) => {
            const d = candleData[tf];
            if (!d || d.length < 20) return "none";
            const sma = calculateSMA(d, 20);
            return (sma && d[0].close > sma) ? "buy" : "sell";
        };

        const t = { W1: getDir("1W"), D1: getDir("1D"), H4: getDir("4H"), H1: getDir("1H") };
        const buyPoints  = Object.values(t).filter(v => v === "buy").length;
        const sellPoints = Object.values(t).filter(v => v === "sell").length;
        let bias = (buyPoints >= 3) ? "buy" : (sellPoints >= 3) ? "sell" : "none";

        // ── 2. Pattern Detection ─────────────────────────────────────────────
        // Run the H&S engine across D1, H4, H1 looking for structural patterns.
        const pattern = runDetection(candleData, symbol);

        if (pattern) {
            console.log(`\n--- 📊 [${symbol}] Scan ---`);
            console.log(`Trends | W1:${t.W1} D1:${t.D1} H4:${t.H4} H1:${t.H1}`);
            console.log(`Scores | BUY: ${buyPoints}/4 | SELL: ${sellPoints}/4 | BIAS: ${bias.toUpperCase()}`);

            // ── 3. Trend Bias Confirmation ───────────────────────────────────
            // The pattern direction must match the macro trend bias.
            // A sell H&S in a 3-of-4 bullish market is rejected.
            if (pattern.type !== bias) {
                console.log(`⏳ [${symbol}] Pattern (${pattern.type}) does not match Trend Bias (${bias}).`);
                return res.json({ status: "bias_mismatch" });
            }

            // ── 4. Duplicate Trade Guard ─────────────────────────────────────
            // The patternID is built from symbol + direction + the head candle's
            // actual Unix timestamp. This ensures the same structural pattern is
            // never traded twice, even across multiple server restarts.
            const patternID = `${symbol}_${pattern.type}_${pattern.headTime}`;
            const history   = loadJSON(historyPath);

            if (history.find(h => h.patternID === patternID)) {
                return res.json({ status: "already_traded_pattern" });
            }

            const currentPrice = h1[0].close;
            const isJpy  = symbol.includes("JPY");
            const buffer = isJpy ? 0.02 : 0.0002;

            // ── 5. Distribution Guard (Expiry Check) ─────────────────────────
            // If price has already moved far past the neckline, the setup is stale.
            // We skip it to avoid chasing a move that has already distributed.
            const tooFar = isJpy ? 0.20 : 0.0020;
            if (pattern.type === "sell" && currentPrice < (pattern.necklineLow - tooFar)) {
                console.log(`❌ [${symbol}] Setup Expired: Price already distributed.`);
                return res.json({ status: "expired" });
            }
            if (pattern.type === "buy" && currentPrice > (pattern.necklineHigh + tooFar)) {
                console.log(`❌ [${symbol}] Setup Expired: Price already distributed.`);
                return res.json({ status: "expired" });
            }

            // ── 6. Neckline Breakout Confirmation ────────────────────────────
            // We don't trade the pattern immediately on detection.
            // We wait for price to actually BREAK the neckline — the previous candle
            // must have been above/at the neckline, and the current candle is below it.
            const checkBreakout = (data) => {
                const current = data[0].close;
                const prev    = data[1].close;
                if (pattern.type === "sell") return (current < (pattern.necklineLow - buffer) && prev >= pattern.necklineLow);
                if (pattern.type === "buy")  return (current > (pattern.necklineHigh + buffer) && prev <= pattern.necklineHigh);
                return false;
            };

            if (checkBreakout(h1) || checkBreakout(h4)) {
                const risk   = Math.abs(currentPrice - pattern.sl);
                const reward = Math.abs(pattern.tp - currentPrice);
                const rr     = reward / risk;

                console.log(`📈 [${symbol}] Breakout detected! Calculating RR: ${rr.toFixed(2)}`);

                // ── 7. RR Quality Filter ─────────────────────────────────────
                // Only execute trades with an RR between 2.5 and 3.0.
                // Too low = not worth the risk. Too high = SL is probably wrong.
                if (rr < 2.5 || rr > 3.0) {
                    console.log(`⚠️ [${symbol}] Rejected: RR ${rr.toFixed(2)} is outside 2.5–3.0 range.`);
                    return res.json({ status: "invalid_rr" });
                }

                // ── 8. Queue Signal ──────────────────────────────────────────
                let signals = loadJSON(signalsPath);
                if (!signals.find(s => s.patternID === patternID)) {
                    console.log(`🎯 [${symbol}] TARGET RR ACHIEVED: ${rr.toFixed(2)}! Sending to Queue.`);
                    signals.push({
                        ...pattern,
                        patternID,
                        entryPrice: currentPrice,
                        executed: false,
                        rr: rr.toFixed(2),
                        timestamp: Date.now()
                    });
                    saveJSON(signalsPath, signals);
                }
            } else {
                console.log(`⏳ [${symbol}] Setup Valid. Monitoring for Neckline Breakout...`);
            }
        }

        res.json({ status: "scanning" });
    } catch (e) {
        console.error("❌ /candles error:", e);
        res.json({ status: "error" });
    }
});

// ─── EXECUTION ROUTE ─────────────────────────────────────────────────────────
// The MT5 EA polls this endpoint on every tick.
// executionLock ensures only one execution can happen at a time, even if the EA
// fires multiple simultaneous HTTP requests (which can happen on busy markets).
app.get("/execute", (req, res) => {
    if (executionLock) return res.json({});
    executionLock = true;

    try {
        // ── Weekly Trade Limit ────────────────────────────────────────────────
        // canTrade() checks closedTrades.json against config.maxTradesPerWeek.
        // If the limit is reached, no new signals are executed.
        if (!canTrade()) {
            console.log("🚫 [Risk] Weekly trade limit reached. No execution this poll.");
            return res.json({});
        }

        let signals = loadJSON(signalsPath);
        let history  = loadJSON(historyPath);

        // Find the first un-executed signal in the queue
        const idx = signals.findIndex(s => !s.executed);
        if (idx === -1) return res.json({});

        const signal    = signals[idx];
        const signalAge = (Date.now() - signal.timestamp) / (1000 * 60); // minutes

        // ── Signal Expiry ─────────────────────────────────────────────────────
        // If a signal sits in the queue for more than 4 hours (240 min)
        // without being acted on, the market has moved — discard it.
        if (signalAge > 240) {
            console.log(`⚠️ [${signal.pair}] Signal expired after ${Math.round(signalAge)} min. Discarding.`);
            saveJSON(signalsPath, signals.filter((_, i) => i !== idx));
            return res.json({});
        }

        // ── Lot Size Calculation ──────────────────────────────────────────────
        // The MT5 EA sends its live account balance as a query parameter.
        // We use that to calculate the correct lot size based on the configured
        // risk percentage (default 5% of account balance per trade).
        const bal  = parseFloat(req.query.balance || 100);
        lastBalance = bal; // Cache for the /balance route used by the Dashboard
        const lot  = calculateLotSize(bal, signal.entryPrice, signal.sl, signal.pair);

        const out = {
            action: signal.type,   // "buy" or "sell"
            symbol: signal.pair,
            sl:     signal.sl,
            tp:     signal.tp,
            lot:    lot
        };

        // ── Mark as Executed ──────────────────────────────────────────────────
        signal.executed      = true;
        signal.executionTime = new Date().toISOString();
        signal.closedAt      = new Date().toISOString(); // needed by risk.js

        history.push(signal);

        // Write to both log files:
        // - history.json   → internal dedup + signal log
        // - closedTrades.json → read by risk.js (weekly limits) + Dashboard
        const updatedSignals = signals.filter((_, i) => i !== idx);
        saveJSON(signalsPath,  updatedSignals);
        saveJSON(historyPath,  history);

        let closedTrades = loadJSON(closedPath);
        closedTrades.push({ ...signal });
        saveJSON(closedPath, closedTrades);

        console.log(`🚀 [MT5] Executing: ${out.symbol} | ${out.action.toUpperCase()} | RR: ${signal.rr} | Lot: ${out.lot} | Balance: $${bal}`);
        res.json(out);

    } catch (e) {
        console.error("❌ /execute error:", e);
        res.json({});
    } finally {
        // Always release the lock, even if an error occurred
        executionLock = false;
    }
});

// ─── STATUS ROUTE (for quick health checks) ──────────────────────────────────
app.get("/status", (req, res) => {
    const signals      = loadJSON(signalsPath);
    const closedTrades = loadJSON(closedPath);
    res.json({
        status:        "online",
        balance:       lastBalance,
        pendingSignals: signals.filter(s => !s.executed).length,
        totalExecuted:  closedTrades.length,
        tradingWindow: `${config.tradingHours.start}:00 – ${config.tradingHours.end}:00 GMT+1`,
        riskPercent:   config.riskPercent,
        pairs:         config.pairs
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 HS-Bot Bridge Active | Port ${PORT}`);
    console.log(`📊 Status: http://localhost:${PORT}/status`);
    console.log(`⏰ Trading Window: ${config.tradingHours.start}:00 – ${config.tradingHours.end}:00 GMT+1`);
    console.log(`💰 Risk Per Trade: ${config.riskPercent}%`);
});
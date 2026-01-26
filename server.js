import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { runDetection } from "./src/patternDetection/patternEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = 3001;

app.use(express.json({ limit: "100mb" }));

const signalsPath = "./signals.json";
const historyPath = "./history.json";

// --- AUTO-CLEAR ON STARTUP ---
const clearPendingSignals = () => {
    try {
        console.log("🧹 [System] Clearing pending queue for a clean start...");
        fs.writeFileSync(signalsPath, "[]");
    } catch (e) {
        console.error("❌ Failed to clear signals.json:", e);
    }
};
clearPendingSignals();

// --- FILE HELPERS ---
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

// --- MATH HELPERS ---
const calculateSMA = (data, period) => {
    if (!data || data.length < period) return null;
    const sum = data.slice(0, period).reduce((acc, c) => acc + c.close, 0);
    return sum / period;
};

function calculateLotSize(balance, entry, sl, symbol) {
    const riskAmount = balance * (config.riskPercent / 100);
    const isJpy = symbol.includes("JPY");
    const pipSize = isJpy ? 0.01 : 0.0001;
    const slPips = Math.abs(entry - sl) / pipSize;
    if (slPips <= 1) return 0.01;
    let lots = riskAmount / (slPips * 10); 
    return Math.max(0.01, Math.round(lots * 100) / 100);
}

// --- MAIN CANDLE HANDLER ---
app.post("/candles", (req, res) => {
    try {
        const { candleData, symbol } = req.body;
        if (!candleData || !symbol) return res.json({ status: "waiting" });

        const h1 = candleData["1H"];
        const h4 = candleData["4H"];
        if (!h1 || h1.length < 2 || !h4 || h4.length < 2) return res.json({ status: "low_data" });

        // 1. Trend Alignment (3/4 SMA Filter)
        const getDir = (tf) => {
            const d = candleData[tf];
            if (!d || d.length < 20) return "none";
            const sma = calculateSMA(d, 20);
            return (sma && d[0].close > sma) ? "buy" : "sell";
        };

        const t = { W1: getDir("1W"), D1: getDir("1D"), H4: getDir("4H"), H1: getDir("1H") };
        const buyPoints = Object.values(t).filter(v => v === "buy").length;
        const sellPoints = Object.values(t).filter(v => v === "sell").length;
        let bias = (buyPoints >= 3) ? "buy" : (sellPoints >= 3) ? "sell" : "none";

        // 2. Pattern Detection
        const pattern = runDetection(candleData, symbol);
        
        // --- RESTORED LOGGING ---
        if (pattern) {
            console.log(`\n--- 📊 [${symbol}] Scan ---`);
            console.log(`Trends | W1:${t.W1} D1:${t.D1} H4:${t.H4} H1:${t.H1}`);
            console.log(`Scores | BUY: ${buyPoints}/4 | SELL: ${sellPoints}/4 | BIAS: ${bias.toUpperCase()}`);
            
            if (pattern.type !== bias) {
                console.log(`⏳ [${symbol}] Pattern (${pattern.type}) does not match Trend Bias (${bias}).`);
                return res.json({ status: "bias_mismatch" });
            }

            const patternID = `${symbol}_${pattern.type}_${pattern.headTime}`;
            const history = loadJSON(historyPath);

            if (history.find(h => h.patternID === patternID)) {
                return res.json({ status: "already_traded_pattern" });
            }

            const currentPrice = h1[0].close;
            const isJpy = symbol.includes("JPY");
            const buffer = isJpy ? 0.02 : 0.0002;

            // Distribution Guard
            const tooFar = isJpy ? 0.20 : 0.0020;
            if (pattern.type === "sell" && currentPrice < (pattern.necklineLow - tooFar)) {
                console.log(`❌ [${symbol}] Setup Expired: Price already distributed.`);
                return res.json({ status: "expired" });
            }
            if (pattern.type === "buy" && currentPrice > (pattern.necklineHigh + tooFar)) {
                console.log(`❌ [${symbol}] Setup Expired: Price already distributed.`);
                return res.json({ status: "expired" });
            }

            const checkBreakout = (data) => {
                const current = data[0].close;
                const prev = data[1].close;
                if (pattern.type === "sell") return (current < (pattern.necklineLow - buffer) && prev >= pattern.necklineLow);
                if (pattern.type === "buy") return (current > (pattern.necklineHigh + buffer) && prev <= pattern.necklineHigh);
                return false;
            };

            if (checkBreakout(h1) || checkBreakout(h4)) {
                const risk = Math.abs(currentPrice - pattern.sl);
                const reward = Math.abs(pattern.tp - currentPrice);
                const rr = reward / risk;

                console.log(`📈 [${symbol}] Breakout detected! Calculating RR: ${rr.toFixed(2)}`);

                if (rr < 2.5 || rr > 3.0) {
                    console.log(`⚠️ [${symbol}] Rejected: RR ${rr.toFixed(2)} is outside 2.5-3.0 range.`);
                    return res.json({ status: "invalid_rr" });
                }

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
    } catch (e) { res.json({ status: "error" }); }
});

// --- EXECUTION ROUTE (LOOP-PROOF) ---
app.get("/execute", (req, res) => {
    try {
        let signals = loadJSON(signalsPath);
        let history = loadJSON(historyPath);
        
        const idx = signals.findIndex(s => !s.executed);
        if (idx === -1) return res.json({});

        const signal = signals[idx];
        const signalAge = (Date.now() - signal.timestamp) / (1000 * 60);

        if (signalAge > 240) {
            console.log(`⚠️ [${signal.pair}] Pattern Expired.`);
            saveJSON(signalsPath, signals.filter((_, i) => i !== idx));
            return res.json({});
        }

        const bal = parseFloat(req.query.balance || 100);
        const lot = calculateLotSize(bal, signal.entryPrice, signal.sl, signal.pair);

        const out = {
            action: signal.type,
            symbol: signal.pair,
            sl: signal.sl,
            tp: signal.tp,
            lot: lot
        };

        signal.executed = true;
        signal.executionTime = new Date().toISOString();
        history.push(signal);
        
        const updatedSignals = signals.filter((_, i) => i !== idx);
        saveJSON(signalsPath, updatedSignals);
        saveJSON(historyPath, history);
        
        console.log(`🚀 [MT5] Executing: ${out.symbol} | RR: ${signal.rr} | Lot: ${out.lot}`);
        res.json(out);
    } catch (e) { res.json({}); }
});

app.listen(PORT, "127.0.0.1", () => console.log(`🚀 AI Trading Bridge Active`));
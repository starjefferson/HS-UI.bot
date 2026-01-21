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

const signalsPath = path.resolve(__dirname, "signals.json");
const historyPath = path.resolve(__dirname, "history.json");

const loadJSON = (f) => { 
    try { 
        if (!fs.existsSync(f)) return [];
        return JSON.parse(fs.readFileSync(f, "utf-8")); 
    } catch { return []; } 
};
const saveJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

function calculateLotSize(balance, entry, sl, symbol) {
    const riskAmount = balance * (config.riskPercent / 100);
    const isJpy = symbol.includes("JPY");
    const pipSize = isJpy ? 0.01 : 0.0001;
    const slPips = Math.abs(entry - sl) / pipSize;
    if (slPips <= 1) return 0.01;
    let lots = riskAmount / (slPips * 10); 
    return Math.max(0.01, Math.round(lots * 100) / 100);
}

app.post("/candles", (req, res) => {
    try {
        const { candleData, symbol } = req.body;
        if (!candleData || !symbol) return res.json({ status: "waiting" });

        const getDir = (tf) => {
            const d = candleData[tf];
            return (d && d.length > 1 && d[0].close > d[1].close) ? "buy" : "sell";
        };

        const t = { w: getDir("1W"), d: getDir("1D"), h4: getDir("4H"), h1: getDir("1H") };
        const buyPoints = Object.values(t).filter(v => v === "buy").length;
        const sellPoints = Object.values(t).filter(v => v === "sell").length;

        let bias = buyPoints >= 3 ? "buy" : sellPoints >= 3 ? "sell" : "none";
        
        // --- ADD THESE LOGS HERE ---
        console.log(`📡 [${symbol}] Trends: W1:${t.w}, D1:${t.d}, H4:${t.h4}, H1:${t.h1}`);
        console.log(`📊 Score: Buy ${buyPoints}/4, Sell ${sellPoints}/4 | Bias: ${bias.toUpperCase()}`);
        // ---------------------------

        if (bias === "none") return res.json({ status: "Mixed Trend" });

        if (bias === "none") return res.json({ status: "Mixed Trend" });

        const patternTFs = ["1D", "4H", "1H"];
        let found = null;
        for (let tf of patternTFs) {
            const sig = runDetection(candleData[tf], symbol);
            if (sig && sig.type === bias) { found = { ...sig, timeframe: tf }; break; }
        }

        if (found) {
            const signals = loadJSON(signalsPath);
            const history = loadJSON(historyPath);

            const isCooldown = history.some(h => h.pair === symbol && Date.now() - h.timestamp < 86400000);
            const isPending = signals.some(s => s.pair === symbol && !s.executed);

            if (!isCooldown && !isPending) {
                const entry = candleData["1H"][0].close;
                signals.push({ ...found, entryPrice: entry, executed: false, timestamp: Date.now(), pair: symbol });
                saveJSON(signalsPath, signals);
                console.log(`🎯 SIGNAL: ${symbol} ${found.type} added.`);
            }
        }
        res.json({ status: "scanning" });
    } catch (e) { res.json({ status: "error" }); }
});

app.get("/execute", (req, res) => {
    let signals = loadJSON(signalsPath);
    let history = loadJSON(historyPath);

    if (signals.some(s => s.executed === true)) return res.json({});

    const idx = signals.findIndex(s => !s.executed);
    if (idx === -1) return res.json({});

    const bal = parseFloat(req.query.balance || 50);
    const lot = calculateLotSize(bal, signals[idx].entryPrice, signals[idx].sl, signals[idx].pair);

    const out = {
        action: signals[idx].type,
        symbol: signals[idx].pair,
        sl: signals[idx].sl,
        tp: signals[idx].tp,
        lot: lot
    };

    signals[idx].executed = true;
    history.push({ ...signals[idx], timestamp: Date.now() });
    saveJSON(signalsPath, signals);
    saveJSON(historyPath, history);

    console.log(`💰 TRADE SENT: ${out.symbol} ${out.lot} Lots`);
    res.json(out);
});

app.listen(PORT, "127.0.0.1", () => console.log(`🚀 Bridge Active`));
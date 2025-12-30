import { checkTopDownAlignment } from "../patternDetection/topDownAnalysis.js";
import { detectPatterns } from "../patternDetection/headShoulders.js";
import { riskCheck } from "../riskManagement/risk.js";
import { executeTrade } from "../executionModule/brokerConnector.js";
import { sendEmailNotification } from "../notificationService/emailNotifications.js";
import { config } from "../config.js";
import fs from "fs";
import path from "path";

const logPath = path.resolve("./closedTrades.json");

export async function runBot(candleData) {
  for (let pair of config.pairs) {
    const pairCandles = candleData[pair];
    const alignment = checkTopDownAlignment(pairCandles, config.topDownTFs);
    if (!alignment) continue;

    const pattern = detectPatterns(pairCandles);
    if (!pattern) continue;

    const riskOk = riskCheck(pattern);
    if (!riskOk) continue;

    const now = new Date();
    const gmt1Hour = now.getUTCHours() + 1;
    if (gmt1Hour < config.tradingHours.start || gmt1Hour >= config.tradingHours.end) continue;

    // Execute trade
    await executeTrade(pattern);

    // Save closed trade (dummy example)
    const tradeLog = {
      pair,
      pattern: pattern.type,
      entry: pattern.entry,
      sl: pattern.sl,
      tp: pattern.tp,
      riskPercent: config.riskPercent,
      rrRatio: config.rrRatio,
      description: "Trade executed by H&S bot",
      closedAt: new Date()
    };

    // Append to JSON
    let data = [];
    if (fs.existsSync(logPath)) data = JSON.parse(fs.readFileSync(logPath));
    data.push(tradeLog);
    fs.writeFileSync(logPath, JSON.stringify(data, null, 2));

    // Send notification
    await sendEmailNotification({
      subject: "Trade executed",
      body: `Pair: ${pair}, Pattern: ${pattern.type}, Entry: ${pattern.entry}`,
    });

    console.log("Trade executed and logged:", tradeLog);
  }
}

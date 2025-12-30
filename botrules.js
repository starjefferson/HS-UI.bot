{/* /All rules applied:

H&S & Inverse H&S detection with neckline retest + HH/LL break

Top-down analysis across 1W → 1D → 4H → 1H

Trading window 08:00–16:00 GMT+1

Single trade at a time per pair

1 trade per week per pair enforced

Max 7-day trade duration

Fixed 1:3 RR ratio for every trade (no min/max, no trailing)

Major forex pairs only

Modular React / Next.js + Tailwind
Full SL/TP calculation, logging, and notification placeholders




HS-bot
 ├─ botEngine
 │   └─ engine.js           <-- main bot logic
 ├─ patternDetection
 │   ├─ topDownAnalysis.js  <-- TF alignment
 │   └─ headShoulders.js    <-- H&S pattern detection
 ├─ executionModule
 │   └─ brokerConnector.js  <-- MT5 / broker execution
 ├─ notificationService
 │   └─ emailNotifications.js
 ├─ riskManagement
 │   └─ risk.js             <-- trade frequency, risk %, cooldown checks
 ├─ config.js               <-- trading config, pairs, TFs, RR ratio, max trades/week
 └─ closedTrades.json       <-- persistent log of closed trades


 [hs-ui / botEngine.js]
   │
   ├─ Writes trade JSON files → monitored by MT5 EA
   └─ Logs closed trades → dashboard displays stats
MT5 (.mq5 EA)
   │
   └─ Reads JSON → executes trade → updates logs
Dashboard (hs-ui)
   └─ Reads logs + balance → displays account overview

*/}
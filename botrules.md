# Bot Rules & Architecture Reference

## Trading Rules Applied

- H&S & Inverse H&S detection with neckline retest + HH/LL break
- Top-down analysis across 1W → 1D → 4H → 1H
- Trading window: 08:00–21:00 GMT+1 (enforced in `config.js`)
- Single trade at a time per pair
- Max 2 trades per week per pair enforced (`maxTradesPerWeek`)
- Minimum 2-day cooldown between trades (`minDaysBetweenTrades`)
- Max 7-day trade duration (`maxTradeHoldDays`)
- Fixed 1:3 RR ratio target (2.5–3.0 RR range accepted)
- Major forex pairs only
- Modular React / Next.js + Tailwind dashboard UI
- Full SL/TP calculation, logging, and pattern fingerprinting guard

---

## Architecture (Current — Direct Deriv API)

```
HS-UI.bot
 ├─ index.js                    ← Main bot engine (hourly scan loop)
 ├─ config.js                   ← Trading config (pairs, TFs, RR, limits)
 ├─ src/
 │   ├─ derivApi.js             ← Direct Deriv WebSocket API integration
 │   ├─ patternDetection/
 │   │   ├─ patternEngine.js    ← Multi-TF detection hub
 │   │   ├─ headShoulders.js    ← H&S structural detection
 │   │   ├─ topDownAnalysis.js  ← SMA-based trend alignment
 │   │   └─ utils.js            ← Math helpers
 │   ├─ riskManagement/
 │   │   └─ risk.js             ← Trade frequency & cooldown checks
 │   ├─ services/
 │   │   └─ brokerAPI.js        ← Deriv API service wrapper
 │   ├─ notificationService/
 │   │   └─ emailNotifications.js ← Notification placeholder
 │   └─ components/
 │       ├─ Dashboard.js        ← Main dashboard React component
 │       └─ DashboardWidget.js  ← Trade log widget
 ├─ app/
 │   ├─ layout.js               ← Next.js root layout
 │   ├─ page.js                 ← Root page (renders Dashboard)
 │   ├─ globals.css             ← Global Tailwind styles
 │   └─ api/broker/route.js     ← Next.js API route for UI data
 ├─ history.json                ← Persistent log of executed trades
 └─ pm2.ecosystem.config.cjs    ← PM2 production process config
```

---

## Data Flow

```
index.js (Bot Engine — hourly)
  │
  ├─ derivApi.js → Deriv WebSocket API → Fetches candles + balance
  ├─ patternEngine.js → detectPatterns (H&S / Inverted H&S)
  ├─ risk.js → canTrade() (weekly limit + cooldown check)
  └─ derivApi.js → placeOrder() → Direct Deriv contract execution
        │
        └─ Writes result to history.json

Next.js Dashboard (app/)
  │
  └─ app/api/broker/route.js
       ├─ GET ?type=balance  → derivApi.getAccountBalance()
       ├─ GET ?type=open     → reads history.json (last trade)
       └─ GET ?type=trades   → reads history.json (total count)
```

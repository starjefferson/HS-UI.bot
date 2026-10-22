# Bot Rules and Architecture

## Runtime

- `index.js` runs as a standalone Node.js process and schedules hourly scans.
- `src/metaApi.js` connects to the configured MetaApi MetaTrader account for
  candles, account information, positions, quotes, and order execution.
- Credentials belong in `.env.local`; never commit them.

## Scan and Trade Rules

- Trend alignment uses W1, D1, H4, and H1; at least three timeframes must agree
  to establish directional bias.
- H&S and inverse H&S structures are scanned on D1, H4, and H1.
- Conflicting pattern directions across accepted timeframes reject the setup.
- When multiple same-direction patterns are accepted, the first neckline
  breakout triggers the trade using that breakout structure's own
  right-shoulder stop and measured-move target. Do not mix levels across
  timeframes.
- Breakout confirmation uses H1 candles for D1/H4 structures and M15 candles
  for H1 structures.
- Calculate take-profit from the confirmed breakout candle close. Keep natural
  measured-move targets unchanged when they meet the configured minimum RR;
  otherwise extend to at least 2.2R (or the configured minimum when higher).
  Keep the initial target fixed and reject order execution if the live quote
  falls below the configured minimum RR.
- Before order placement the bot applies pattern fingerprinting, minimum RR,
  trade-frequency, currency-correlation, and gold-specific checks.
- Opened trades are recorded in `history.json`.

The configured instruments, default risk cap, minimum RR, and breakout buffer
are defined in `config.js`. Runtime overrides and their validation are in
`index.js`.

## Operations

- Foreground: `npm start`
- PM2: `npm run start:prod`
- Logs: `npm run logs`
- Process configuration: `pm2.ecosystem.config.cjs`

This is a bot-only repository: it does not include a web UI or dashboard.

# HS-Bot

An automated Head & Shoulders trading bot for a MetaTrader account connected
through MetaApi. It runs as a Node.js process and is monitored through MT5 and
its process logs; this project has no web dashboard or UI.

## Run

1. Install Node.js 20 or later.
2. Run `npm install`.
3. Configure `.env.local` with `METAAPI_TOKEN` and `METAAPI_ACCOUNT_ID`.
   Optionally set `BROKER_SYMBOL_SUFFIX` if the broker uses suffixed symbols
   (for example, `r`). Set risk overrides only after checking `config.js`.
4. Start a foreground scan with `npm start`, or use PM2 with `npm run start:prod`.

See [setup-guide.txt](./setup-guide.txt) for operational details and
[BOT_GUIDE.txt](./BOT_GUIDE.txt) for the current scan flow.

The PM2 configuration starts only `hs-bot`. If a previous deployment still has
an `hs-ui` PM2 process, remove that stale process on the deployment host with
`pm2 delete hs-ui`.

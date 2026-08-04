/**
 * PM2 Ecosystem Config
 * 
 * This file tells PM2 how to run both processes on your VPS:
 *   - hs-bot-server  → the Express bridge on port 3001 (talks to MT5)
 *   - hs-dashboard   → the Next.js UI on port 3000 (your browser view)
 * 
 * COMMANDS:
 *   Start both:   pm2 start pm2.ecosystem.config.cjs
 *   Stop both:    pm2 stop all
 *   Restart both: pm2 restart all
 *   View logs:    pm2 logs
 *   Monitor live: pm2 monit
 *   Auto-restart on VPS reboot: pm2 startup && pm2 save
 */

module.exports = {
  apps: [
    {
      // ── Express Bridge Server (port 3001) ─────────────────────────────────
      // This is the core of the bot — receives candles from MT5, runs the
      // pattern engine, and serves trade signals back to the EA.
      name:          "hs-bot-server",
      script:        "server.js",
      watch:         false,
      restart_delay: 3000,        // Wait 3 seconds before restarting after a crash
      max_restarts:  10,          // Give up after 10 rapid crashes (prevents crash loop)
      env: {
        NODE_ENV: "production",
        PORT:     3001
      },
      error_file: "./logs/server-error.log",
      out_file:   "./logs/server-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss"
    },
    {
      // ── Next.js Dashboard (port 3000) ─────────────────────────────────────
      // The visual dashboard you open in a browser.
      // Run `npm run build` before starting this for the first time.
      name:          "hs-dashboard",
      script:        "node_modules/.bin/next",
      args:          "start",
      watch:         false,
      restart_delay: 3000,
      max_restarts:  10,
      env: {
        NODE_ENV: "production",
        PORT:     3000
      },
      error_file: "./logs/dashboard-error.log",
      out_file:   "./logs/dashboard-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss"
    }
  ]
};

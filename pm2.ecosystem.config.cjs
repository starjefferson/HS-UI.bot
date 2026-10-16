// pm2.ecosystem.config.cjs
// Production process manager config for Linux VPS
// Usage: npm run start:prod  (or: pm2 start pm2.ecosystem.config.cjs)

module.exports = {
  apps: [
    {
      name: "hs-bot",
      script: "index.js",
      interpreter: "node",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/hs-bot-error.log",
      out_file: "./logs/hs-bot-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};

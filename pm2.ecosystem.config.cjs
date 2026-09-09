// pm2.ecosystem.config.cjs
// Production process manager config for Linux VPS
// Usage: npm run start:prod  (or: pm2 start pm2.ecosystem.config.cjs)

module.exports = {
  apps: [
    // Process 1: The standalone trading bot engine
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

    // Process 2: The Next.js dashboard UI
    {
      name: "hs-ui",
      script: "node_modules/.bin/next",
      args: "start",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      error_file: "./logs/hs-ui-error.log",
      out_file: "./logs/hs-ui-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};

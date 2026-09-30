export const config = {
  // Monitored Assets
  pairs: [
    // Forex Majors (7)
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
    // Precious Metals (1) - Remove if Gold is completely disabled
    "XAUUSD",
    // Best FX Crosses (4)
    "EURGBP", "EURJPY", "GBPJPY", "AUDJPY",
  ],

  // Analysis timeframes for top-down trend bias & pattern scanning
  topDownTFs: ["1W", "1D", "4H", "1H"],

  // 24-Hour continuous scanning (controlled by real-time spread guards)
  tradingHours: { start: 0, end: 24 },

  // Risk & Reward Targets
  rrRatio: 2.5,       // Target Risk-to-Reward ratio (2.5 or 3)
  riskPercent: 5.0,   // Risk percentage per trade
};
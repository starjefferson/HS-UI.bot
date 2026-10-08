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

  // Trade risk and breakout confirmation
  rrRatio: 2.5,              // Minimum risk-to-reward ratio
  riskPercent: 3.0,           // Maximum account risk per trade
  breakoutBufferPips: 2,      // Closed 1H candle must clear neckline region by this many pips
};
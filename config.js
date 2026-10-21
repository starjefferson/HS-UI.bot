export const config = {
  // Monitored Assets
  pairs: [
    // G10 Forex pairs (28)
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
    "EURGBP", "EURJPY", "EURCHF", "EURCAD", "EURAUD", "EURNZD",
    "GBPJPY", "GBPCHF", "GBPCAD", "GBPAUD", "GBPNZD",
    "AUDJPY", "AUDCHF", "AUDCAD", "AUDNZD",
    "NZDJPY", "NZDCHF", "NZDCAD",
    "CADJPY", "CADCHF",
    "CHFJPY",
    // Precious metal (1)
    "XAUUSD",
  ],

  // Analysis timeframes for top-down trend bias & pattern scanning
  topDownTFs: ["1W", "1D", "4H", "1H"],

  // 24-Hour continuous scanning (controlled by real-time spread guards)
  tradingHours: { start: 0, end: 24 },

  // Trade risk and breakout confirmation
  rrRatio: 2.5,              // Minimum risk-to-reward ratio
  maxRR: 4,                  // Cap take-profit distance at four times the risk
  riskPercent: 3.0,           // Maximum account risk per trade
  breakoutBufferPips: 2,      // Closed 1H candle must clear neckline region by this many pips
};
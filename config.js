export const config = {
  pairs: [
    // Forex Majors (7) — deep liquidity, clean H&S structure
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
    // Precious Metals (1)
    "XAUUSD",
    // Best FX Crosses (4) — high liquidity, reliable MetaApi data
    "EURGBP", "EURJPY", "GBPJPY", "AUDJPY",
  ],
  topDownTFs: ["1W", "1D", "4H", "1H"],
  maxTradesPerWeek: 2,
  minDaysBetweenTrades: 2,
  tradingHours: { start: 8, end: 21 }, // GMT+1
  rrRatio: 3,
  riskPercent: 5,   // 5% risk per trade
  maxTradeHoldDays: 7
};

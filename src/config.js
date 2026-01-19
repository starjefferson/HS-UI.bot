export const config = {
  pairs: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD"],
  topDownTFs: ["1W", "1D", "4H", "1H"],
  maxTradesPerWeek: 5,
  minDaysBetweenTrades: 0,
  tradingHours: { start: 8, end: 21 }, // GMT+1
  rrRatio: 3,
  riskPercent: 5,  // 5% risk per trade
  maxTradeHoldDays: 7
};

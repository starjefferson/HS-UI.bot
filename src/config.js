export const config = {
  pairs: ["EURUSD", "GBPUSD", "USDJPY"],
  topDownTFs: ["1W", "1D", "4H", "1H"],
  maxTradesPerWeek: 2,
  minDaysBetweenTrades: 2,
  tradingHours: { start: 8, end: 16 }, // GMT+1
  rrRatio: 3,
  riskPercent: 5,  // 5% risk per trade
  maxTradeHoldDays: 7
};

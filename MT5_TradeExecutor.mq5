//+------------------------------------------------------------------+
//| MT5 Trade Executor Bridge for Node.js H&S Bot                    |
//| Polls Node.js for signals and executes trades on major pairs     |
//+------------------------------------------------------------------+
#property strict
#include <Trade/Trade.mqh>

CTrade trade;

// -------------------------------------------------------------------
// Input: Node.js endpoint for polling signals
// -------------------------------------------------------------------
input string WebhookURL = "http://127.0.0.1:3001/execute";

// -------------------------------------------------------------------
// Helper: Send HTTP GET request to Node.js
// -------------------------------------------------------------------
string SendRequest(string url)
{
   char result[];
   char data[];        
   string headers = ""; 
   int timeout = 5000; 

   ResetLastError();
   int res = WebRequest("GET", url, headers, timeout, data, result, headers);

   if (res == -1)
   {
      Print("WebRequest Error. Code: ", GetLastError());
      return "";
   }

   return CharArrayToString(result);
}

// -------------------------------------------------------------------
// Helper: Extract a string field from JSON
// -------------------------------------------------------------------
string ExtractStringField(string json, string key)
{
   string pattern = StringFormat("\"%s\":\"", key);
   int start = StringFind(json, pattern);
   if (start < 0) return "";

   int valueStart = start + StringLen(pattern);
   int valueEnd = StringFind(json, "\"", valueStart);
   if (valueEnd < 0) return "";

   return StringSubstr(json, valueStart, valueEnd - valueStart);
}

// -------------------------------------------------------------------
// Helper: Extract a numeric field from JSON
// -------------------------------------------------------------------
double ExtractNumberField(string json, string key)
{
   string pattern = StringFormat("\"%s\":", key);
   int start = StringFind(json, pattern);
   if (start < 0) return 0.0;

   int valueStart = start + StringLen(pattern);
   string slice = StringSubstr(json, valueStart, 20);

   int commaPos = StringFind(slice, ",");
   if (commaPos >= 0) slice = StringSubstr(slice, 0, commaPos);

   int bracePos = StringFind(slice, "}");
   if (bracePos >= 0) slice = StringSubstr(slice, 0, bracePos);

   while (StringLen(slice) > 0 && (StringGetCharacter(slice, 0) == ' ')) {
      slice = StringSubstr(slice, 1);
   }

   return StringToDouble(slice);
}

// -------------------------------------------------------------------
// Helper: Check if a symbol is a major pair
// -------------------------------------------------------------------
bool IsMajorPair(string symbol)
{
   string majors[] = {"EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD","NZDUSD"};
   for (int i = 0; i < ArraySize(majors); i++)
   {
      if (symbol == majors[i]) return true;
   }
   return false;
}

// -------------------------------------------------------------------
// Helper: Execute a trade (buy/sell) with SL/TP/lot
// - Enforces broker stop levels and symbol precision
// - Logs final executed SL/TP
// -------------------------------------------------------------------
bool ExecuteTrade(string action, string symbol, double lot, double sl, double tp)
{
   if (!SymbolSelect(symbol, true))
   {
      Print("Symbol not available: ", symbol);
      return false;
   }

   // Broker info
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double stopLevelPoints = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minStopDistance = stopLevelPoints * point;
   double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);

   // Normalize lot
   if (lot <= 0) lot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);

   bool hasPosition = PositionSelect(symbol);
   double price = 0.0;

   if (StringCompare(action, "buy") == 0)
   {
      price = ask;

      if (sl >= price || (price - sl) < minStopDistance) sl = price - minStopDistance;
      if (tp <= price || (tp - price) < minStopDistance) tp = price + minStopDistance;

      sl = NormalizeDouble(sl, digits);
      tp = NormalizeDouble(tp, digits);

      if (!hasPosition)
      {
         if (trade.Buy(lot, symbol, 0, sl, tp, "H&S Bot Buy"))
         {
            Print("BUY executed on ", symbol, " lot=", lot, " SL=", sl, " TP=", tp);
            return true;
         }
         Print("BUY failed on ", symbol, " (", GetLastError(), ")");
      }
   }
   else if (StringCompare(action, "sell") == 0)
   {
      price = bid;

      if (sl <= price || (sl - price) < minStopDistance) sl = price + minStopDistance;
      if (tp >= price || (price - tp) < minStopDistance) tp = price - minStopDistance;

      sl = NormalizeDouble(sl, digits);
      tp = NormalizeDouble(tp, digits);

      if (!hasPosition)
      {
         if (trade.Sell(lot, symbol, 0, sl, tp, "H&S Bot Sell"))
         {
            Print("SELL executed on ", symbol, " lot=", lot, " SL=", sl, " TP=", tp);
            return true;
         }
         Print("SELL failed on ", symbol, " (", GetLastError(), ")");
      }
   }
   else
   {
      Print("Unknown action: ", action);
   }

   return false;
}

// -------------------------------------------------------------------
// OnTick: main loop
// -------------------------------------------------------------------
void OnTick()
{
   string response = SendRequest(WebhookURL);

   if (response == "" || response == "{}" || StringFind(response, "\"action\":") < 0)
      return;

   // Parse JSON
   string action = ExtractStringField(response, "action");
   string symbol = ExtractStringField(response, "symbol");
   double sl     = ExtractNumberField(response, "sl");
   double tp     = ExtractNumberField(response, "tp");
   double lot    = ExtractNumberField(response, "lot");

   if (action == "" || symbol == "")
      return;

   if (!IsMajorPair(symbol))
   {
      Print("Ignored non-major pair: ", symbol);
      return;
   }

   ExecuteTrade(action, symbol, lot, sl, tp);
}

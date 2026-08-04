//+------------------------------------------------------------------+
//| MT5 Trade Executor Bridge                                        |
//| H&S Bot — sends candle data to Node.js server, receives orders  |
//|                                                                  |
//| SETUP (do this once):                                           |
//|   Tools → Options → Expert Advisors → Allow WebRequest for URLs |
//|   Add: http://127.0.0.1:3001                                    |
//+------------------------------------------------------------------+
#property strict
#include <Trade/Trade.mqh>

CTrade trade;

// -------------------------------------------------------------------
// Inputs (configurable from MT5 EA panel)
// -------------------------------------------------------------------
input string ExecuteURL    = "http://127.0.0.1:3001/execute";
input string CandlesURL    = "http://127.0.0.1:3001/candles";
input int    BarsToRequest = 250;  // FIX: was 50 — pattern detection needs ≥200 candles

// -------------------------------------------------------------------
// Symbols & Globals
// -------------------------------------------------------------------
string majors[]  = {"EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD","NZDUSD"};
datetime lastSent = 0;

// -------------------------------------------------------------------
// Visual Logic: Drawing SL/TP/Entry Lines on the chart
// -------------------------------------------------------------------
void DrawTradeLines(string symbol, double entry, double sl, double tp)
{
   // Remove any previous lines first
   ObjectDelete(0, "HS_EntryLine");
   ObjectDelete(0, "HS_SLLine");
   ObjectDelete(0, "HS_TPLine");

   // Entry Line (solid green)
   ObjectCreate(0, "HS_EntryLine", OBJ_HLINE, 0, 0, entry);
   ObjectSetInteger(0, "HS_EntryLine", OBJPROP_COLOR, clrGreen);
   ObjectSetInteger(0, "HS_EntryLine", OBJPROP_WIDTH, 2);
   ObjectSetString(0,  "HS_EntryLine", OBJPROP_TEXT, "H&S Entry");

   // Stop Loss Line (dashed red)
   ObjectCreate(0, "HS_SLLine", OBJ_HLINE, 0, 0, sl);
   ObjectSetInteger(0, "HS_SLLine", OBJPROP_COLOR, clrRed);
   ObjectSetInteger(0, "HS_SLLine", OBJPROP_STYLE, STYLE_DASH);
   ObjectSetInteger(0, "HS_SLLine", OBJPROP_WIDTH, 1);
   ObjectSetString(0,  "HS_SLLine", OBJPROP_TEXT, "H&S SL");

   // Take Profit Line (solid lime green)
   ObjectCreate(0, "HS_TPLine", OBJ_HLINE, 0, 0, tp);
   ObjectSetInteger(0, "HS_TPLine", OBJPROP_COLOR, clrLimeGreen);
   ObjectSetInteger(0, "HS_TPLine", OBJPROP_WIDTH, 2);
   ObjectSetString(0,  "HS_TPLine", OBJPROP_TEXT, "H&S TP");

   ChartRedraw();
   Print("🎨 Visual lines drawn for ", symbol, " | Entry:", entry, " SL:", sl, " TP:", tp);
}

// -------------------------------------------------------------------
// HTTP Request Helper (UTF-8 safe)
// -------------------------------------------------------------------
string HttpRequest(string method, string url, string payload="")
{
   uchar  data[];
   uchar  result[];
   string headers = "Content-Type: application/json\r\n";
   string response_headers;

   if(payload != "") StringToCharArray(payload, data, 0, StringLen(payload), CP_UTF8);

   ResetLastError();
   int res = WebRequest(method, url, headers, 5000, data, result, response_headers);

   if(res == -1) {
      int err = GetLastError();
      // Error 4060 = WebRequest not allowed — user forgot to add URL in MT5 settings
      if(err == 4060) Print("⛔ WebRequest blocked. Go to: Tools → Options → Expert Advisors → Add URL: http://127.0.0.1:3001");
      else            Print("⚠️ WebRequest Error: ", err);
      return "";
   }
   return CharArrayToString(result, 0, -1, CP_UTF8);
}

// -------------------------------------------------------------------
// Candle Data Packaging
// FIX: Now includes the candle's `time` (Unix timestamp) field.
// This is used by headShoulders.js to create a truly unique patternID,
// preventing the same structural pattern from being traded more than once.
// -------------------------------------------------------------------
string CandlesToJson(const MqlRates &rates[])
{
   string json = "[";
   int size = ArraySize(rates);
   for(int i=0; i<size; i++) {
      // time is included so Node.js can fingerprint each pattern uniquely
      json += StringFormat("{\"time\":%d,\"close\":%f,\"high\":%f,\"low\":%f}",
              (long)rates[i].time, rates[i].close, rates[i].high, rates[i].low);
      if(i < size - 1) json += ",";
   }
   return json + "]";
}

// -------------------------------------------------------------------
// Send candle data for all 7 pairs across 4 timeframes
// Called every 5 minutes (300 seconds) from OnTick
// -------------------------------------------------------------------
void SendAllCandles()
{
   MqlRates rates[];
   ArraySetAsSeries(rates, true);

   for(int i=0; i<ArraySize(majors); i++) {
      string sym = majors[i];
      if(!SymbolSelect(sym, true)) {
         Print("⚠️ Could not select symbol: ", sym, " — is it in Market Watch?");
         continue;
      }

      // Fetch 250 bars per timeframe (minimum 200 required by pattern engine)
      CopyRates(sym, PERIOD_W1, 0, BarsToRequest, rates); string w1 = CandlesToJson(rates);
      CopyRates(sym, PERIOD_D1, 0, BarsToRequest, rates); string d1 = CandlesToJson(rates);
      CopyRates(sym, PERIOD_H4, 0, BarsToRequest, rates); string h4 = CandlesToJson(rates);
      CopyRates(sym, PERIOD_H1, 0, BarsToRequest, rates); string h1 = CandlesToJson(rates);

      string payload = StringFormat(
         "{\"symbol\":\"%s\",\"candleData\":{\"1W\":%s,\"1D\":%s,\"4H\":%s,\"1H\":%s}}",
         sym, w1, d1, h4, h1
      );

      string resp = HttpRequest("POST", CandlesURL, payload);
      if(resp != "") Print("📤 [", sym, "] Scan response: ", resp);
   }
}

// -------------------------------------------------------------------
// JSON Field Extractors (no external JSON library needed)
// -------------------------------------------------------------------
string ExtractStringField(string json, string key) {
   string pattern = "\"" + key + "\":\"";
   int start = StringFind(json, pattern);
   if(start < 0) return "";
   start += StringLen(pattern);
   return StringSubstr(json, start, StringFind(json, "\"", start) - start);
}

double ExtractNumberField(string json, string key) {
   string pattern = "\"" + key + "\":";
   int start = StringFind(json, pattern);
   if(start < 0) return 0.0;
   start += StringLen(pattern);
   string slice = StringSubstr(json, start, 20);
   int p = StringFind(slice, ",");
   if(p > 0) slice = StringSubstr(slice, 0, p);
   p = StringFind(slice, "}");
   if(p > 0) slice = StringSubstr(slice, 0, p);
   return StringToDouble(slice);
}

// -------------------------------------------------------------------
// Execute a trade from the server's JSON response
// -------------------------------------------------------------------
void ExecuteTrade(string response)
{
   string action = ExtractStringField(response, "action");
   string symbol = ExtractStringField(response, "symbol");
   double lot    = ExtractNumberField(response, "lot");
   double sl     = ExtractNumberField(response, "sl");
   double tp     = ExtractNumberField(response, "tp");

   if(action == "" || symbol == "" || lot == 0.0) {
      Print("⚠️ Incomplete signal received. Skipping.");
      return;
   }

   if(!SymbolSelect(symbol, true)) {
      Print("⛔ Cannot select symbol: ", symbol);
      return;
   }

   int    digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double entry  = (action == "buy")
                   ? SymbolInfoDouble(symbol, SYMBOL_ASK)
                   : SymbolInfoDouble(symbol, SYMBOL_BID);

   // Draw visual lines on the chart BEFORE sending the order
   DrawTradeLines(symbol, entry, sl, tp);

   bool alreadyOpen = PositionSelect(symbol);

   if(action == "buy" && !alreadyOpen) {
      bool ok = trade.Buy(lot, symbol, entry,
                          NormalizeDouble(sl, digits),
                          NormalizeDouble(tp, digits),
                          "H&S Bot");
      Print(ok ? "✅ BUY executed" : "❌ BUY failed — error: " + IntegerToString(GetLastError()),
            " | ", symbol, " | Lot:", lot, " SL:", sl, " TP:", tp);
   }
   else if(action == "sell" && !alreadyOpen) {
      bool ok = trade.Sell(lot, symbol, entry,
                           NormalizeDouble(sl, digits),
                           NormalizeDouble(tp, digits),
                           "H&S Bot");
      Print(ok ? "✅ SELL executed" : "❌ SELL failed — error: " + IntegerToString(GetLastError()),
            " | ", symbol, " | Lot:", lot, " SL:", sl, " TP:", tp);
   }
   else if(alreadyOpen) {
      Print("ℹ️ Position already open on ", symbol, " — skipping duplicate.");
   }
}

// -------------------------------------------------------------------
// Main Loop — runs on every price tick
// -------------------------------------------------------------------
void OnTick()
{
   // Send candle data every 5 minutes (300 seconds)
   // This is the heartbeat that drives the entire bot
   if(TimeCurrent() - lastSent >= 300) {
      SendAllCandles();
      lastSent = TimeCurrent();
   }

   // Poll for execution orders on every tick.
   // The server sends the live account balance so it can calculate
   // the correct lot size based on the current account equity.
   double balance  = AccountInfoDouble(ACCOUNT_BALANCE);
   string pollUrl  = ExecuteURL + "?balance=" + DoubleToString(balance, 2);
   string response = HttpRequest("GET", pollUrl);

   // Only call ExecuteTrade if the server returned a valid signal (has "action" field)
   if(response != "" && StringFind(response, "\"action\"") >= 0) {
      Print("📩 Signal received: ", response);
      ExecuteTrade(response);
   }
}
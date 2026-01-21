//+------------------------------------------------------------------+
//| MT5 Trade Executor Bridge - Visual Pro Version                   |
//| Features: Dynamic 20% Risk, Visual Trade Lines, Multi-TF Support |
//+------------------------------------------------------------------+
#property strict
#include <Trade/Trade.mqh>

CTrade trade;

// -------------------------------------------------------------------
// Inputs
// -------------------------------------------------------------------
input string ExecuteURL    = "http://127.0.0.1:3001/execute";
input string CandlesURL    = "http://127.0.0.1:3001/candles";
input int    BarsToRequest = 50; 

// -------------------------------------------------------------------
// Symbols & Globals
// -------------------------------------------------------------------
string majors[] = {"EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD","NZDUSD"};
datetime lastSent = 0;

// -------------------------------------------------------------------
// Visual Logic: Drawing SL/TP/Entry Lines
// -------------------------------------------------------------------
void DrawTradeLines(string symbol, double entry, double sl, double tp)
{
   // Clean up existing lines first
   ObjectDelete(0, "HS_EntryLine");
   ObjectDelete(0, "HS_SLLine");
   ObjectDelete(0, "HS_TPLine");

   // Entry Line (Green)
   ObjectCreate(0, "HS_EntryLine", OBJ_HLINE, 0, 0, entry);
   ObjectSetInteger(0, "HS_EntryLine", OBJPROP_COLOR, clrGreen);
   ObjectSetInteger(0, "HS_EntryLine", OBJPROP_WIDTH, 2);
   ObjectSetString(0, "HS_EntryLine", OBJPROP_TEXT, "H&S Entry");

   // Stop Loss Line (Red - Dashed)
   ObjectCreate(0, "HS_SLLine", OBJ_HLINE, 0, 0, sl);
   ObjectSetInteger(0, "HS_SLLine", OBJPROP_COLOR, clrRed);
   ObjectSetInteger(0, "HS_SLLine", OBJPROP_STYLE, STYLE_DASH);
   ObjectSetInteger(0, "HS_SLLine", OBJPROP_WIDTH, 1);

   // Take Profit Line (Green - Solid)
   ObjectCreate(0, "HS_TPLine", OBJ_HLINE, 0, 0, tp);
   ObjectSetInteger(0, "HS_TPLine", OBJPROP_COLOR, clrLimeGreen);
   ObjectSetInteger(0, "HS_TPLine", OBJPROP_WIDTH, 2);

   ChartRedraw();
   Print("🎨 Visual lines drawn for ", symbol);
}

// -------------------------------------------------------------------
// HTTP Request (UTF-8 Safe)
// -------------------------------------------------------------------
string HttpRequest(string method, string url, string payload="")
{
   uchar data[];
   uchar result[];
   string headers = "Content-Type: application/json\r\n";
   string response_headers;
   
   if(payload != "") StringToCharArray(payload, data, 0, StringLen(payload), CP_UTF8);

   ResetLastError();
   int res = WebRequest(method, url, headers, 5000, data, result, response_headers);

   if(res == -1) {
      Print("WebRequest Error: ", GetLastError());
      return "";
   }
   return CharArrayToString(result, 0, -1, CP_UTF8);
}

// -------------------------------------------------------------------
// Candle Data Packaging
// -------------------------------------------------------------------
string CandlesToJson(const MqlRates &rates[])
{
   string json = "[";
   int size = ArraySize(rates);
   for(int i=0; i<size; i++) {
      json += StringFormat("{\"close\":%f,\"high\":%f,\"low\":%f}", 
              rates[i].close, rates[i].high, rates[i].low);
      if(i < size - 1) json += ",";
   }
   return json + "]";
}

void SendAllCandles()
{
   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   for(int i=0; i<ArraySize(majors); i++) {
      string sym = majors[i];
      if(!SymbolSelect(sym, true)) continue;

      CopyRates(sym, PERIOD_W1, 0, BarsToRequest, rates); string w1 = CandlesToJson(rates);
      CopyRates(sym, PERIOD_D1, 0, BarsToRequest, rates); string d1 = CandlesToJson(rates);
      CopyRates(sym, PERIOD_H4, 0, BarsToRequest, rates); string h4 = CandlesToJson(rates);
      CopyRates(sym, PERIOD_H1, 0, BarsToRequest, rates); string h1 = CandlesToJson(rates);

      string payload = StringFormat("{\"symbol\":\"%s\",\"candleData\":{\"1W\":%s,\"1D\":%s,\"4H\":%s,\"1H\":%s}}",
                       sym, w1, d1, h4, h1);
      HttpRequest("POST", CandlesURL, payload);
   }
}

// -------------------------------------------------------------------
// JSON Extraction & Execution
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
   string slice = StringSubstr(json, start, 15);
   int p = StringFind(slice, ",");
   if(p > 0) slice = StringSubstr(slice, 0, p);
   p = StringFind(slice, "}");
   if(p > 0) slice = StringSubstr(slice, 0, p);
   return StringToDouble(slice);
}

void ExecuteTrade(string response)
{
   string action = ExtractStringField(response, "action");
   string symbol = ExtractStringField(response, "symbol");
   double lot    = ExtractNumberField(response, "lot");
   double sl     = ExtractNumberField(response, "sl");
   double tp     = ExtractNumberField(response, "tp");

   if(!SymbolSelect(symbol, true)) return;
   
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double entry = (action == "buy") ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);

   // Trigger Visual Lines
   DrawTradeLines(symbol, entry, sl, tp);

   if(action == "buy" && !PositionSelect(symbol))
      trade.Buy(lot, symbol, entry, NormalizeDouble(sl, digits), NormalizeDouble(tp, digits), "H&S 20% Risk");
   else if(action == "sell" && !PositionSelect(symbol))
      trade.Sell(lot, symbol, entry, NormalizeDouble(sl, digits), NormalizeDouble(tp, digits), "H&S 20% Risk");
}

// -------------------------------------------------------------------
// Main Loop
// -------------------------------------------------------------------
void OnTick()
{
   if(TimeCurrent() - lastSent >= 300) {
      SendAllCandles();
      lastSent = TimeCurrent();
   }

   // Dynamic Polling with live Balance for the 20% calculation
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   string pollUrl = ExecuteURL + "?balance=" + DoubleToString(balance, 2);
   
   string response = HttpRequest("GET", pollUrl);
   if(response != "" && StringFind(response, "\"action\"") >= 0) {
      ExecuteTrade(response);
   }
}
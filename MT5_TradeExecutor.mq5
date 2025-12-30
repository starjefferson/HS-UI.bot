//+------------------------------------------------------------------+
//|  MT5 Trade Executor Bridge for Node.js H&S Bot                    |
//|  Receives trade signals via WebRequest and executes in MT5        |
//+------------------------------------------------------------------+
#include <Trade/Trade.mqh>
CTrade trade;

// Allow WebRequests to local server
input string WebhookURL = "http://127.0.0.1:3001/execute"; // Node.js bot endpoint

// Function to send HTTP request
string SendRequest(string url) {
   char result[];
   char data[];
   string headers;
   int timeout = 5000;
   ResetLastError();

   int res = WebRequest("GET", url, headers, timeout, data, result, headers);
   if(res == -1) {
      Print("WebRequest Error. Code: ", GetLastError());
      return "";
   }
   return CharArrayToString(result);
}

// Main EA loop - checks for signals
void OnTick() {
   // Call the webhook to check if bot has a trade signal
   string response = SendRequest(WebhookURL);

   if(response == "") return; // No valid response

   // Expected JSON format:
   // {"action":"buy","symbol":"EURUSD","sl":1.0920,"tp":1.1010,"lot":0.1}

   if(StringFind(response, "buy") >= 0) {
      double sl = 0, tp = 0, lot = 0.1;
      string symbol = "EURUSD";

      // Parse SL/TP/LOT from JSON response (simple extraction)
      int slPos = StringFind(response, "\"sl\":");
      int tpPos = StringFind(response, "\"tp\":");
      int lotPos = StringFind(response, "\"lot\":");

      if(slPos > 0) sl = StringToDouble(StringSubstr(response, slPos + 5, 10));
      if(tpPos > 0) tp = StringToDouble(StringSubstr(response, tpPos + 5, 10));
      if(lotPos > 0) lot = StringToDouble(StringSubstr(response, lotPos + 6, 5));

      // Execute BUY trade
      if(PositionSelect(symbol) == false) {
         if(trade.Buy(lot, symbol, 0, sl, tp, "H&S Bot Buy")) {
            Print("BUY order executed on ", symbol);
         }
      }
   }

   if(StringFind(response, "sell") >= 0) {
      double sl = 0, tp = 0, lot = 0.1;
      string symbol = "EURUSD";

      // Parse SL/TP/LOT from JSON response (simple extraction)
      int slPos = StringFind(response, "\"sl\":");
      int tpPos = StringFind(response, "\"tp\":");
      int lotPos = StringFind(response, "\"lot\":");

      if(slPos > 0) sl = StringToDouble(StringSubstr(response, slPos + 5, 10));
      if(tpPos > 0) tp = StringToDouble(StringSubstr(response, tpPos + 5, 10));
      if(lotPos > 0) lot = StringToDouble(StringSubstr(response, lotPos + 6, 5));

      // Execute SELL trade
      if(PositionSelect(symbol) == false) {
         if(trade.Sell(lot, symbol, 0, sl, tp, "H&S Bot Sell")) {
            Print("SELL order executed on ", symbol);
         }
      }
   }
}

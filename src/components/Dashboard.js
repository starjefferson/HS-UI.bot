"use client";

import { useEffect, useState } from "react";
import { Cpu, Activity, DollarSign } from "lucide-react";

export default function Dashboard() {
  const [balance, setBalance] = useState(0);
  const [openTrade, setOpenTrade] = useState(null);
  const [totalTrades, setTotalTrades] = useState(0);

  useEffect(() => {
    async function fetchData() {
      try {
        // 1) Account balance
        const balanceRes = await fetch("/api/broker?type=balance");
        const balanceData = await balanceRes.json();
        setBalance(balanceData.balance);

        // 2) Last open trade
        const openRes = await fetch("/api/broker?type=open");
        const openData = await openRes.json();
        setOpenTrade(openData);

        // 3) Total trades count
        const tradesRes = await fetch("/api/broker?type=trades");
        const tradesData = await tradesRes.json();
        setTotalTrades(tradesData.totalTrades);
      } catch (err) {
        console.error("Dashboard fetch error:", err);
      }
    }

    fetchData();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white p-6">
      {/* Header */}
      <h1 className="text-3xl font-bold mb-8 md:text-left">
        Broker Dashboard
      </h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Balance */}
        <div className="bg-gray-900 p-6 rounded-lg shadow-lg flex items-center space-x-4">
          <DollarSign className="w-10 h-10 text-green-400" />
          <div>
            <p className="text-sm text-gray-400">Account Balance</p>
            <p className="text-2xl font-semibold">${balance}</p>
          </div>
        </div>

        {/* Open Trade */}
        <div className="bg-gray-900 p-6 rounded-lg shadow-lg flex items-center space-x-4">
          <Cpu className="w-10 h-10 text-blue-400" />
          <div>
            <p className="text-sm text-gray-400">Open Trade</p>
            <p className="text-2xl font-semibold">
              {openTrade && openTrade.pair ? openTrade.pair : "None"}
            </p>
          </div>
        </div>

        {/* Total Trades */}
        <div className="bg-gray-900 p-6 rounded-lg shadow-lg flex items-center space-x-4">
          <Activity className="w-10 h-10 text-purple-400" />
          <div>
            <p className="text-sm text-gray-400">Total Trades</p>
            <p className="text-2xl font-semibold">{totalTrades}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
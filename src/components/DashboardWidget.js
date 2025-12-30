import React from "react";

export default function DashboardWidget({ logs }) {
  return (
    <div className="p-4 border rounded shadow">
      <h2 className="font-semibold">Recent Trades</h2>
      <pre>{JSON.stringify(logs, null, 2)}</pre>
    </div>
  );
}

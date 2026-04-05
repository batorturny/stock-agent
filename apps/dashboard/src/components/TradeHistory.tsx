import { formatCurrency, formatDate } from "~/lib/utils";
import type { Trade } from "~/lib/api";

export function TradeHistory({ trades }: { trades: Trade[] }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-zinc-400">
        Trade History
      </h2>

      {trades.length === 0 ? (
        <p className="text-center text-sm text-zinc-500">
          No trades executed yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Action</th>
                <th className="pb-2 pr-4">Ticker</th>
                <th className="pb-2 pr-4 text-right">Shares</th>
                <th className="pb-2 pr-4 text-right">Price</th>
                <th className="pb-2 pr-4 text-right">Total</th>
                <th className="pb-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr
                  key={trade.id}
                  className="border-b border-zinc-800/50"
                >
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatDate(trade.executedAt)}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        trade.action === "buy"
                          ? "bg-profit/20 text-profit"
                          : "bg-loss/20 text-loss"
                      }`}
                    >
                      {trade.action.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono font-bold">
                    {trade.ticker}
                  </td>
                  <td className="py-2 pr-4 text-right">{trade.shares}</td>
                  <td className="py-2 pr-4 text-right">
                    {formatCurrency(trade.price)}
                  </td>
                  <td className="py-2 pr-4 text-right font-medium">
                    {formatCurrency(trade.total)}
                  </td>
                  <td className="py-2 max-w-[200px] truncate text-zinc-500">
                    {trade.reason || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

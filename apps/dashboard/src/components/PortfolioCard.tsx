import { formatCurrency, formatPercent } from "~/lib/utils";
import type { AccountState } from "~/lib/api";

export function PortfolioCard({ data }: { data: AccountState }) {
  const isProfit = data.totalPnl >= 0;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-zinc-400">
        Portfolio Summary
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-sm text-zinc-500">Total Value</p>
          <p className="text-2xl font-bold">{formatCurrency(data.totalValue)}</p>
        </div>
        <div>
          <p className="text-sm text-zinc-500">Cash</p>
          <p className="text-2xl font-bold">{formatCurrency(data.cash)}</p>
        </div>
        <div>
          <p className="text-sm text-zinc-500">Total P/L</p>
          <p
            className={`text-2xl font-bold ${isProfit ? "text-profit" : "text-loss"}`}
          >
            {formatCurrency(data.totalPnl)}
          </p>
        </div>
        <div>
          <p className="text-sm text-zinc-500">Return</p>
          <p
            className={`text-2xl font-bold ${isProfit ? "text-profit" : "text-loss"}`}
          >
            {formatPercent(data.totalPnlPercent)}
          </p>
        </div>
      </div>

      {data.positions.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Open Positions
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-500">
                  <th className="pb-2 pr-4">Ticker</th>
                  <th className="pb-2 pr-4 text-right">Shares</th>
                  <th className="pb-2 pr-4 text-right">Avg Price</th>
                  <th className="pb-2 pr-4 text-right">Current</th>
                  <th className="pb-2 pr-4 text-right">P/L</th>
                  <th className="pb-2 text-right">P/L %</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((pos) => (
                  <tr
                    key={pos.id}
                    className="border-b border-zinc-800/50"
                  >
                    <td className="py-2 pr-4 font-mono font-bold">
                      {pos.ticker}
                    </td>
                    <td className="py-2 pr-4 text-right">{pos.shares}</td>
                    <td className="py-2 pr-4 text-right">
                      {formatCurrency(pos.avgPrice)}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {pos.currentPrice
                        ? formatCurrency(pos.currentPrice)
                        : "—"}
                    </td>
                    <td
                      className={`py-2 pr-4 text-right ${(pos.pnl || 0) >= 0 ? "text-profit" : "text-loss"}`}
                    >
                      {pos.pnl !== undefined ? formatCurrency(pos.pnl) : "—"}
                    </td>
                    <td
                      className={`py-2 text-right ${(pos.pnlPercent || 0) >= 0 ? "text-profit" : "text-loss"}`}
                    >
                      {pos.pnlPercent !== undefined
                        ? formatPercent(pos.pnlPercent)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

import { formatCurrency, formatDate } from "~/lib/utils";
import type { PoliticianTrade, CopyTrade } from "~/lib/api";

function amountRange(from: number | null, to: number | null): string {
  if (!from && !to) return "N/A";
  if (from && to) return `${formatCurrency(from)} – ${formatCurrency(to)}`;
  return formatCurrency(from ?? to ?? 0);
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    pending: "bg-warning/20 text-warning",
    executed: "bg-profit/20 text-profit",
    cancelled: "bg-zinc-700 text-zinc-400",
    failed: "bg-loss/20 text-loss",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? "bg-zinc-700 text-zinc-400"}`}>
      {status.toUpperCase()}
    </span>
  );
}

export function PoliticianFeed({
  trades,
  copyTrades,
}: {
  trades: PoliticianTrade[];
  copyTrades: { pending: CopyTrade[]; executed: CopyTrade[] };
}) {
  const allCopyTrades = [...copyTrades.pending, ...copyTrades.executed];

  return (
    <div className="space-y-6">
      {/* Congressional trades */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-lg">🏛️</span>
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
            Congressional Trades
          </h2>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
            {trades.length}
          </span>
        </div>

        {trades.length === 0 ? (
          <p className="text-center text-sm text-zinc-500">
            No politician trades found yet. Data refreshes hourly.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-500">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Politician</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4">Ticker</th>
                  <th className="pb-2 pr-4 text-right">Amount</th>
                  <th className="pb-2">Filed</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="border-b border-zinc-800/50">
                    <td className="py-2 pr-4 text-zinc-400">
                      {t.transactionDate}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="font-medium">{t.name}</div>
                      {t.position && (
                        <div className="text-xs text-zinc-500">{t.position}</div>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          t.transactionType.toLowerCase().includes("purchase")
                            ? "bg-profit/20 text-profit"
                            : "bg-loss/20 text-loss"
                        }`}
                      >
                        {t.transactionType}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono font-bold">
                      {t.symbol}
                    </td>
                    <td className="py-2 pr-4 text-right text-zinc-300">
                      {amountRange(t.amountFrom, t.amountTo)}
                    </td>
                    <td className="py-2 text-zinc-500">{t.filingDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Copy trade queue */}
      {allCopyTrades.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-lg">📋</span>
            <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
              Copy Trades
            </h2>
            {copyTrades.pending.length > 0 && (
              <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs text-warning">
                {copyTrades.pending.length} pending
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-500">
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Ticker</th>
                  <th className="pb-2 pr-4">Politician</th>
                  <th className="pb-2 pr-4">Execute After</th>
                  <th className="pb-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {allCopyTrades.map((ct) => (
                  <tr key={ct.id} className="border-b border-zinc-800/50">
                    <td className="py-2 pr-4">{statusBadge(ct.status)}</td>
                    <td className="py-2 pr-4 font-mono font-bold">
                      {ct.symbol}
                    </td>
                    <td className="py-2 pr-4">{ct.politicianName}</td>
                    <td className="py-2 pr-4 text-zinc-400">
                      {formatDate(ct.executeAfter)}
                    </td>
                    <td className="py-2 max-w-[250px] truncate text-zinc-500">
                      {ct.reason || "—"}
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

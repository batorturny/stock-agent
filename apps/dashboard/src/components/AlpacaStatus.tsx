import { formatCurrency } from "~/lib/utils";
import type { AlpacaStatus as AlpacaStatusType } from "~/lib/api";

export function AlpacaStatus({ data }: { data: AlpacaStatusType | null }) {
  if (!data) return null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${
              data.connected ? "bg-profit" : "bg-loss"
            }`}
          />
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            Alpaca Paper Trading
          </span>
        </div>
        {data.connected ? (
          <span className="rounded-full bg-profit/10 px-2 py-0.5 text-xs text-profit">
            Connected
          </span>
        ) : (
          <span className="rounded-full bg-loss/10 px-2 py-0.5 text-xs text-loss">
            {data.reason ?? "Disconnected"}
          </span>
        )}
      </div>

      {data.connected && data.account && (
        <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-zinc-500">Portfolio Value</div>
            <div className="font-medium">
              {formatCurrency(data.account.portfolioValue)}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Cash</div>
            <div className="font-medium">
              {formatCurrency(data.account.cash)}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Positions</div>
            <div className="font-medium">{data.positionsCount ?? 0}</div>
          </div>
        </div>
      )}
    </div>
  );
}

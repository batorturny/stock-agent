import { formatCurrency, formatDate } from "~/lib/utils";
import type { PicksResponse } from "~/lib/api";

export function PicksPanel({ data }: { data: PicksResponse }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
          AI Picks of the Day
        </h2>
        {data.createdAt && (
          <span className="text-xs text-zinc-600">
            {formatDate(data.createdAt)}
          </span>
        )}
      </div>

      {/* Market Outlook */}
      <div className="mb-6 rounded-lg bg-zinc-800/50 p-4">
        <p className="text-sm leading-relaxed text-zinc-300">
          {data.outlook || "No outlook available yet."}
        </p>
      </div>

      {/* Buy Picks */}
      {data.picks.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-profit">
            <span className="inline-block h-2 w-2 rounded-full bg-profit" />
            Buy Recommendations
          </h3>
          <div className="space-y-3">
            {data.picks.map((pick, i) => (
              <div
                key={i}
                className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-4"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-lg font-bold">
                    {pick.ticker}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-zinc-400">
                      Target: {formatCurrency(pick.targetPrice)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        pick.confidence >= 0.8
                          ? "bg-profit/20 text-profit"
                          : "bg-warning/20 text-warning"
                      }`}
                    >
                      {(pick.confidence * 100).toFixed(0)}% confidence
                    </span>
                  </div>
                </div>
                <p className="mb-2 text-sm text-zinc-400">{pick.reasoning}</p>
                <div className="flex gap-4 text-xs text-zinc-500">
                  <span>Horizon: {pick.timeHorizon}</span>
                  {pick.catalysts.length > 0 && (
                    <span>Catalysts: {pick.catalysts.join(", ")}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sell Warnings */}
      {data.warnings.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-loss">
            <span className="inline-block h-2 w-2 rounded-full bg-loss" />
            Sell / Avoid Warnings
          </h3>
          <div className="space-y-2">
            {data.warnings.map((warn, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-loss/20 bg-loss/5 p-3"
              >
                <div>
                  <span className="font-mono font-bold">{warn.ticker}</span>
                  <span className="ml-3 text-sm text-zinc-400">
                    {warn.reason}
                  </span>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    warn.urgency === "high"
                      ? "bg-loss/20 text-loss"
                      : "bg-warning/20 text-warning"
                  }`}
                >
                  {warn.urgency}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.picks.length === 0 && data.warnings.length === 0 && (
        <p className="text-center text-sm text-zinc-500">
          No AI analysis available yet. The first analysis runs at 06:00 UTC daily.
        </p>
      )}
    </div>
  );
}

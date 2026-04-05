import { useCallback } from "react";
import { PortfolioCard } from "~/components/PortfolioCard";
import { PicksPanel } from "~/components/PicksPanel";
import { NewsFeed } from "~/components/NewsFeed";
import { TradeHistory } from "~/components/TradeHistory";
import { PriceChart } from "~/components/PriceChart";
import { usePolling } from "~/hooks/usePolling";
import { api } from "~/lib/api";

const MINUTE = 60 * 1000;

export function App() {
  const portfolio = usePolling(
    useCallback(() => api.getPortfolio(), []),
    MINUTE
  );
  const picks = usePolling(
    useCallback(() => api.getPicks(), []),
    15 * MINUTE
  );
  const newsData = usePolling(
    useCallback(() => api.getNews(50), []),
    15 * MINUTE
  );
  const tradeData = usePolling(
    useCallback(() => api.getHistory(50), []),
    5 * MINUTE
  );

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/20 text-brand">
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            </div>
            <h1 className="text-lg font-bold">Stock Agent</h1>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              AI-Powered
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-zinc-500">
            <span>Virtual Portfolio</span>
            <span className="h-4 w-px bg-zinc-800" />
            <span>$5,000 Starting Capital</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl space-y-6 p-6">
        {/* Disclaimer */}
        <div className="rounded-lg border border-warning/20 bg-warning/5 px-4 py-2 text-xs text-warning">
          DISCLAIMER: This is a simulation for educational purposes only.
          Not financial advice. No real money is involved. Past performance
          does not indicate future results.
        </div>

        {/* Portfolio Summary */}
        {portfolio.loading ? (
          <LoadingSkeleton label="Portfolio" />
        ) : portfolio.error ? (
          <ErrorCard message={portfolio.error} />
        ) : portfolio.data ? (
          <PortfolioCard data={portfolio.data} />
        ) : null}

        {/* Two-column layout: Picks + Charts */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* AI Picks */}
          <div>
            {picks.loading ? (
              <LoadingSkeleton label="AI Picks" />
            ) : picks.data ? (
              <PicksPanel data={picks.data} />
            ) : null}
          </div>

          {/* Price Charts */}
          <div className="space-y-4">
            {portfolio.data?.positions.map((pos) => (
              <PriceChartWrapper key={pos.ticker} ticker={pos.ticker} />
            ))}
            {(!portfolio.data || portfolio.data.positions.length === 0) && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">
                Charts will appear once positions are opened.
              </div>
            )}
          </div>
        </div>

        {/* News Feed */}
        {newsData.data && <NewsFeed items={newsData.data.items} />}

        {/* Trade History */}
        {tradeData.data && <TradeHistory trades={tradeData.data.trades} />}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 px-6 py-4 text-center text-xs text-zinc-600">
        Stock Agent v1.0 — AI-powered virtual stock portfolio management.
        Built with Claude AI, Cloudflare Workers & React.
      </footer>
    </div>
  );
}

function PriceChartWrapper({ ticker }: { ticker: string }) {
  const { data } = usePolling(
    useCallback(() => api.getPrices(ticker), [ticker]),
    MINUTE
  );

  return <PriceChart ticker={ticker} data={data?.history || []} />;
}

function LoadingSkeleton(_props: { label: string }) {
  return (
    <div className="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 h-4 w-24 rounded bg-zinc-800" />
      <div className="space-y-3">
        <div className="h-8 w-48 rounded bg-zinc-800" />
        <div className="h-4 w-64 rounded bg-zinc-800" />
      </div>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-loss/20 bg-loss/5 p-6">
      <p className="text-sm text-loss">Error: {message}</p>
      <p className="mt-1 text-xs text-zinc-500">
        Make sure the Worker API is running on localhost:8787
      </p>
    </div>
  );
}

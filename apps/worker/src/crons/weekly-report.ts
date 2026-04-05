import { desc, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { trades, analysis } from "../db/schema";
import { getAccountState } from "../services/portfolio";
import type { Env } from "../types";

export async function handleWeeklyReport(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Get account state
  const accountState = await getAccountState(env);

  // Get this week's trades
  const weekTrades = await db
    .select()
    .from(trades)
    .where(gte(trades.executedAt, weekAgo))
    .orderBy(desc(trades.executedAt));

  // Get this week's daily analyses
  const weekAnalyses = await db
    .select()
    .from(analysis)
    .where(gte(analysis.createdAt, weekAgo))
    .orderBy(desc(analysis.createdAt));

  // Build weekly summary
  const summary = {
    period: `${weekAgo} to ${now.toISOString()}`,
    portfolio: {
      totalValue: accountState.totalValue,
      cash: accountState.cash,
      totalPnl: accountState.totalPnl,
      totalPnlPercent: accountState.totalPnlPercent,
      openPositions: accountState.positions.length,
    },
    trades: {
      total: weekTrades.length,
      buys: weekTrades.filter((t) => t.action === "buy").length,
      sells: weekTrades.filter((t) => t.action === "sell").length,
      totalVolume: weekTrades.reduce((sum, t) => sum + t.total, 0),
    },
    topMovers: accountState.positions
      .sort((a, b) => Math.abs(b.pnlPercent || 0) - Math.abs(a.pnlPercent || 0))
      .slice(0, 5)
      .map((p) => ({
        ticker: p.ticker,
        pnlPercent: p.pnlPercent,
        pnl: p.pnl,
      })),
    dailyAnalyses: weekAnalyses.length,
  };

  // Save as weekly analysis
  await db.insert(analysis).values({
    type: "weekly",
    picks: JSON.stringify(summary),
    outlook: `Weekly report: Portfolio at $${accountState.totalValue.toFixed(2)} (${accountState.totalPnlPercent >= 0 ? "+" : ""}${accountState.totalPnlPercent.toFixed(2)}%). ${weekTrades.length} trades executed.`,
    portfolioChanges: JSON.stringify(weekTrades),
    riskWarnings: null,
    createdAt: now.toISOString(),
  });
}

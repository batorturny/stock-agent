import { desc, gte, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { trades, analysis, dailySnapshots, predictions } from "../db/schema";
import { getAccountState } from "../services/portfolio";
import { computePortfolioMetrics } from "../services/risk-manager";
import { getCachedPrice } from "../services/price-api";
import { sendAlert } from "../services/alerter";
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

  // Get risk metrics
  const metrics = await computePortfolioMetrics(env);

  // Get 30-day daily snapshots for SPY comparison
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const snapshots = await db
    .select()
    .from(dailySnapshots)
    .where(gte(dailySnapshots.date, thirtyDaysAgo))
    .orderBy(dailySnapshots.date);

  // Portfolio return vs SPY return (30 days)
  let portfolioReturn30d = 0;
  let spyReturn30d = 0;
  if (snapshots.length >= 2) {
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    portfolioReturn30d = ((last.totalValue - first.totalValue) / first.totalValue) * 100;
    if (first.spyPrice && last.spyPrice) {
      spyReturn30d = ((last.spyPrice - first.spyPrice) / first.spyPrice) * 100;
    }
  }

  // Resolve expired predictions
  const predictionStats = await resolvePredictions(db, env);

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
    riskMetrics: {
      sharpe30d: metrics.sharpe30d,
      maxDrawdown: metrics.maxDrawdown,
      currentDrawdown: metrics.currentDrawdown,
      beta: metrics.beta,
      portfolioReturn30d: Math.round(portfolioReturn30d * 100) / 100,
      spyReturn30d: Math.round(spyReturn30d * 100) / 100,
      alpha: Math.round((portfolioReturn30d - spyReturn30d) * 100) / 100,
    },
    trades: {
      total: weekTrades.length,
      buys: weekTrades.filter((t) => t.action === "buy").length,
      sells: weekTrades.filter((t) => t.action === "sell").length,
      totalVolume: weekTrades.reduce((sum, t) => sum + t.total, 0),
    },
    predictions: predictionStats,
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

  const alphaStr = summary.riskMetrics.alpha >= 0 ? `+${summary.riskMetrics.alpha}%` : `${summary.riskMetrics.alpha}%`;
  const outlookText = `Weekly report: $${accountState.totalValue.toFixed(2)} (${accountState.totalPnlPercent >= 0 ? "+" : ""}${accountState.totalPnlPercent.toFixed(2)}%) | Sharpe: ${metrics.sharpe30d?.toFixed(2) ?? "N/A"} | Drawdown: ${metrics.currentDrawdown}% | Alpha vs SPY: ${alphaStr} | ${weekTrades.length} trades | Predictions: ${predictionStats.total} total, ${predictionStats.accuracy}% accuracy`;

  // Save as weekly analysis
  await db.insert(analysis).values({
    type: "weekly",
    picks: JSON.stringify(summary),
    outlook: outlookText,
    portfolioChanges: JSON.stringify(weekTrades),
    riskWarnings: JSON.stringify({
      sharpe: metrics.sharpe30d,
      drawdown: metrics.currentDrawdown,
      predictions: predictionStats,
    }),
    createdAt: now.toISOString(),
  });

  // Send weekly summary alert
  await sendAlert(outlookText, "info", env);

  console.log(`[weekly-report] Done. ${outlookText}`);
}

// ─── Resolve expired predictions ───

async function resolvePredictions(
  db: ReturnType<typeof drizzle>,
  env: Env
): Promise<{ total: number; targetHit: number; stopHit: number; expired: number; pending: number; accuracy: number }> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Get all pending predictions
  const pendingPreds = await db
    .select()
    .from(predictions)
    .where(eq(predictions.outcome, "pending"));

  let resolved = 0;
  for (const pred of pendingPreds) {
    const cached = await getCachedPrice(pred.ticker, env);
    if (!cached) continue;

    const currentPrice = cached.price;
    let outcome: string | null = null;

    // Check if target was hit
    if (currentPrice >= pred.targetPrice) {
      outcome = "target_hit";
    }
    // Check if stop was hit
    else if (currentPrice <= pred.stopLoss) {
      outcome = "stop_hit";
    }
    // Check if prediction is older than 30 days (expired)
    else if (pred.predictedAt < thirtyDaysAgo) {
      outcome = "expired";
    }

    if (outcome) {
      const pnlPct = ((currentPrice - pred.entryPrice) / pred.entryPrice) * 100;
      await db
        .update(predictions)
        .set({
          outcome,
          actualPrice: currentPrice,
          resolvedAt: now.toISOString(),
          pnlPct: Math.round(pnlPct * 100) / 100,
        })
        .where(eq(predictions.id, pred.id));
      resolved++;
    }
  }

  if (resolved > 0) {
    console.log(`[weekly-report] Resolved ${resolved} predictions`);
  }

  // Compute accuracy stats
  const allPreds = await db.select().from(predictions);
  const total = allPreds.length;
  const targetHit = allPreds.filter((p) => p.outcome === "target_hit").length;
  const stopHit = allPreds.filter((p) => p.outcome === "stop_hit").length;
  const expired = allPreds.filter((p) => p.outcome === "expired").length;
  const pending = allPreds.filter((p) => p.outcome === "pending").length;
  const resolvedTotal = targetHit + stopHit + expired;
  const accuracy = resolvedTotal > 0 ? Math.round((targetHit / resolvedTotal) * 100) : 0;

  return { total, targetHit, stopHit, expired, pending, accuracy };
}

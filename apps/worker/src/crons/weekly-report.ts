import { desc, gte, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { trades, analysis, dailySnapshots, predictions, investmentPlans } from "../db/schema";
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

  // Review active investment plans
  const planReviewStats = await reviewInvestmentPlans(db, env);

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
    investmentPlans: planReviewStats,
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
  const plansStr = `Plans: ${planReviewStats.active} active, ${planReviewStats.completed} completed, ${planReviewStats.abandoned} abandoned`;
  const outlookText = `Weekly report: $${accountState.totalValue.toFixed(2)} (${accountState.totalPnlPercent >= 0 ? "+" : ""}${accountState.totalPnlPercent.toFixed(2)}%) | Sharpe: ${metrics.sharpe30d?.toFixed(2) ?? "N/A"} | Drawdown: ${metrics.currentDrawdown}% | Alpha vs SPY: ${alphaStr} | ${weekTrades.length} trades | Predictions: ${predictionStats.total} total, ${predictionStats.accuracy}% accuracy | ${plansStr}`;

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

// ─── Review active investment plans ───

async function reviewInvestmentPlans(
  db: ReturnType<typeof drizzle>,
  env: Env
): Promise<{ active: number; completed: number; abandoned: number; reviewed: number }> {
  const now = new Date();
  let reviewed = 0;

  // Get all active plans
  const activePlansList = await db
    .select()
    .from(investmentPlans)
    .where(eq(investmentPlans.status, "active"));

  for (const plan of activePlansList) {
    const cached = await getCachedPrice(plan.ticker, env);
    if (!cached) continue;

    const currentPrice = cached.price;

    // Price-based plans: check if target was reached
    if (plan.targetType === "price" && plan.targetPrice) {
      if (currentPrice >= plan.targetPrice) {
        await db
          .update(investmentPlans)
          .set({
            status: "completed",
            aiConviction: `Target price $${plan.targetPrice} reached at $${currentPrice.toFixed(2)}`,
            lastReviewed: now.toISOString(),
            updatedAt: now.toISOString(),
          })
          .where(eq(investmentPlans.id, plan.id));
        console.log(`[weekly-report] Plan ${plan.ticker}: TARGET REACHED $${currentPrice.toFixed(2)} >= $${plan.targetPrice}`);
        reviewed++;
        continue;
      }
    }

    // Time-based plans: check if hold period is done
    if (plan.targetType === "time" && plan.targetDate) {
      const targetDate = new Date(plan.targetDate);
      if (now >= targetDate) {
        // Hold period expired — check P&L to decide
        const pnlPct = ((currentPrice - plan.entryPrice) / plan.entryPrice) * 100;
        const conviction = pnlPct > 0
          ? `Hold period ended. P&L: +${pnlPct.toFixed(1)}%. Consider taking profit.`
          : `Hold period ended. P&L: ${pnlPct.toFixed(1)}%. Thesis may need reassessment.`;

        await db
          .update(investmentPlans)
          .set({
            status: "completed",
            aiConviction: conviction,
            lastReviewed: now.toISOString(),
            updatedAt: now.toISOString(),
          })
          .where(eq(investmentPlans.id, plan.id));
        console.log(`[weekly-report] Plan ${plan.ticker}: HOLD PERIOD ENDED, P&L ${pnlPct.toFixed(1)}%`);
        reviewed++;
        continue;
      }
    }

    // Still active — update conviction with current P&L
    const pnlPct = ((currentPrice - plan.entryPrice) / plan.entryPrice) * 100;
    const holdDays = Math.floor((now.getTime() - new Date(plan.createdAt).getTime()) / (24 * 60 * 60 * 1000));
    const conviction = `Day ${holdDays}: $${currentPrice.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% from entry). Thesis: ${plan.thesis}`;

    await db
      .update(investmentPlans)
      .set({
        aiConviction: conviction,
        lastReviewed: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      .where(eq(investmentPlans.id, plan.id));
    reviewed++;
  }

  if (reviewed > 0) {
    console.log(`[weekly-report] Reviewed ${reviewed} investment plans`);
  }

  // Count all plans by status
  const allPlans = await db.select().from(investmentPlans);
  const active = allPlans.filter((p) => p.status === "active").length;
  const completed = allPlans.filter((p) => p.status === "completed").length;
  const abandoned = allPlans.filter((p) => p.status === "abandoned").length;

  return { active, completed, abandoned, reviewed };
}

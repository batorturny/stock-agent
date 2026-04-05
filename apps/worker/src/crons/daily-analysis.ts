import { desc, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { news, prices, analysis } from "../db/schema";
import { runDailyAnalysis } from "../services/ai-analyst";
import { getAccountState, executeTrade, rebalancePortfolio } from "../services/portfolio";
import { getCachedPrice } from "../services/price-api";
import type { Env } from "../types";
import { PORTFOLIO_RULES } from "../types";

export async function handleDailyAnalysis(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();

  console.log("[daily-analysis] Starting daily analysis...");

  // 1. Get portfolio state
  const accountState = await getAccountState(env);
  const portfolioState = JSON.stringify(accountState, null, 2);
  const cashPct = accountState.cash / accountState.totalValue;

  console.log(
    `[daily-analysis] Portfolio: $${accountState.totalValue.toFixed(2)} total, $${accountState.cash.toFixed(2)} cash (${(cashPct * 100).toFixed(1)}%), ${accountState.positions.length} positions`
  );

  // 2. Get last 24h news
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const recentNewsItems = await db
    .select()
    .from(news)
    .where(gte(news.scrapedAt, yesterday))
    .orderBy(desc(news.scrapedAt))
    .limit(50);

  const recentNews = recentNewsItems
    .map(
      (n) =>
        `[${n.source}] ${n.title} | sentiment: ${n.sentiment} | impact: ${n.impact} | tickers: ${n.tickers}`
    )
    .join("\n");

  // 3. Get 7-day news trends
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const weekNews = await db
    .select()
    .from(news)
    .where(gte(news.scrapedAt, weekAgo))
    .orderBy(desc(news.scrapedAt))
    .limit(200);

  const tickerCounts = new Map<string, { count: number; totalSentiment: number }>();
  for (const n of weekNews) {
    const tickers: string[] = n.tickers ? JSON.parse(n.tickers) : [];
    for (const t of tickers) {
      const existing = tickerCounts.get(t) || { count: 0, totalSentiment: 0 };
      existing.count++;
      existing.totalSentiment += n.sentiment || 0;
      tickerCounts.set(t, existing);
    }
  }

  const newsTrends = [...tickerCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(
      ([ticker, data]) =>
        `${ticker}: ${data.count} mentions, avg sentiment ${(data.totalSentiment / data.count).toFixed(2)}`
    )
    .join("\n");

  // 4. Get 30-day price history for portfolio tickers
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const priceData = await db
    .select()
    .from(prices)
    .where(gte(prices.recordedAt, monthAgo))
    .orderBy(desc(prices.recordedAt))
    .limit(500);

  const priceHistory = priceData
    .slice(0, 100)
    .map((p) => `${p.ticker}: $${p.price} @ ${p.recordedAt}`)
    .join("\n");

  // 5. Run AI analysis
  console.log("[daily-analysis] Running AI analysis...");
  const result = await runDailyAnalysis(
    portfolioState,
    recentNews || "No recent news available",
    newsTrends || "No trend data available",
    priceHistory || "No price history available",
    env
  );

  console.log(
    `[daily-analysis] AI result: ${result.buyPicks.length} buy picks, ${result.sellWarnings.length} sell warnings, outlook: ${result.marketOutlook}`
  );

  // 6. Save analysis
  await db.insert(analysis).values({
    type: "daily",
    picks: JSON.stringify(result.buyPicks),
    outlook: result.marketOutlook,
    portfolioChanges: JSON.stringify(result.portfolioActions),
    riskWarnings: JSON.stringify(result.sellWarnings),
    createdAt: now.toISOString(),
  });

  // 7. Auto-execute AI portfolio actions (sells first, then buys)
  const currentState = await getAccountState(env);
  const openTickers = new Set(currentState.positions.map((p) => p.ticker));

  // Execute sell actions from AI first
  for (const action of result.portfolioActions) {
    if (action.action === "sell" && openTickers.has(action.ticker)) {
      console.log(`[daily-analysis] AI sell: ${action.ticker} — ${action.reason}`);
      const tradeResult = await executeTrade(action, env);
      console.log(`[daily-analysis] Sell result: ${tradeResult.success ? "OK" : "FAIL"} — ${tradeResult.reason}`);
      if (tradeResult.success) openTickers.delete(action.ticker);
    }
  }

  // Execute buy picks — top confident picks
  for (const pick of result.buyPicks) {
    if (pick.confidence < PORTFOLIO_RULES.MIN_CONFIDENCE) continue;
    if (openTickers.has(pick.ticker)) continue;

    // Allocate ~15% of total value per position
    const allocAmount = currentState.totalValue * 0.15;
    const currentPrice = (await getCachedPrice(pick.ticker, env))?.price;
    if (!currentPrice) continue;
    const shares = Math.floor(allocAmount / currentPrice);
    if (shares <= 0) continue;

    console.log(
      `[daily-analysis] Auto-buy: ${shares} ${pick.ticker} @ $${currentPrice} (${(pick.confidence * 100).toFixed(0)}% conf)`
    );
    const tradeResult = await executeTrade(
      { action: "buy", ticker: pick.ticker, shares, reason: pick.reasoning },
      env
    );
    console.log(`[daily-analysis] Buy result: ${tradeResult.success ? "OK" : "FAIL"} — ${tradeResult.reason}`);
    if (tradeResult.success) openTickers.add(pick.ticker);
  }

  // 8. Ensure portfolio is at least 85% invested
  const postTradeState = await getAccountState(env);
  const postCashPct = postTradeState.cash / postTradeState.totalValue;

  if (postCashPct > PORTFOLIO_RULES.MAX_CASH_PCT) {
    console.log(
      `[daily-analysis] Cash still at ${(postCashPct * 100).toFixed(1)}% after AI picks — force-investing remaining`
    );

    // Buy more of the top confident picks that we already hold or new ones
    const sortedPicks = [...result.buyPicks].sort((a, b) => b.confidence - a.confidence);

    for (const pick of sortedPicks) {
      const latestState = await getAccountState(env);
      const latestCashPct = latestState.cash / latestState.totalValue;
      if (latestCashPct <= PORTFOLIO_RULES.MAX_CASH_PCT) break;

      const excessCash = latestState.cash - latestState.totalValue * PORTFOLIO_RULES.MIN_CASH_RESERVE_PCT;
      if (excessCash <= 10) break;

      const currentPrice = (await getCachedPrice(pick.ticker, env))?.price;
      if (!currentPrice) continue;

      const shares = Math.floor(Math.min(excessCash * 0.5, latestState.totalValue * 0.15) / currentPrice);
      if (shares <= 0) continue;

      console.log(
        `[daily-analysis] Force-invest: ${shares} ${pick.ticker} @ $${currentPrice}`
      );
      await executeTrade(
        { action: "buy", ticker: pick.ticker, shares, reason: `Force-invest: cash above ${PORTFOLIO_RULES.MAX_CASH_PCT * 100}% max` },
        env
      );
    }
  }

  // 9. Final rebalance
  console.log("[daily-analysis] Running final rebalance...");
  const rebalanceActions = await rebalancePortfolio(env);
  if (rebalanceActions.length > 0) {
    console.log(`[daily-analysis] Rebalance: ${rebalanceActions.join(" | ")}`);
  }

  // 10. Final state log
  const finalState = await getAccountState(env);
  const finalCashPct = finalState.cash / finalState.totalValue;
  console.log(
    `[daily-analysis] Done. Final: $${finalState.totalValue.toFixed(2)} total, $${finalState.cash.toFixed(2)} cash (${(finalCashPct * 100).toFixed(1)}%), ${finalState.positions.length} positions, PnL: ${finalState.totalPnlPercent.toFixed(2)}%`
  );
}

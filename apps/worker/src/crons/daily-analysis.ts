import { desc, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { news, prices, analysis } from "../db/schema";
import { runDailyAnalysis } from "../services/ai-analyst";
import { getAccountState, executeTrade } from "../services/portfolio";
import type { Env } from "../types";

export async function handleDailyAnalysis(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();

  // 1. Get portfolio state
  const accountState = await getAccountState(env);
  const portfolioState = JSON.stringify(accountState, null, 2);

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

  // Aggregate by ticker
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
  const result = await runDailyAnalysis(
    portfolioState,
    recentNews || "No recent news available",
    newsTrends || "No trend data available",
    priceHistory || "No price history available",
    env
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

  // 7. Auto-execute portfolio actions with guardrails
  // Only execute buys if there's a matching pick with 70%+ confidence
  const confidentTickers = new Set(
    result.buyPicks
      .filter((p) => p.confidence >= 0.7)
      .map((p) => p.ticker)
  );

  for (const action of result.portfolioActions) {
    if (action.action === "hold") continue;
    // Buy actions require a confident pick backing them
    if (action.action === "buy" && !confidentTickers.has(action.ticker)) {
      console.log(`Skipping buy ${action.ticker}: no 70%+ confidence pick`);
      continue;
    }
    const result_trade = await executeTrade(action, env);
    console.log(`Trade ${action.action} ${action.ticker}: ${result_trade.reason}`);
  }
}

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { news, portfolio } from "../db/schema";
import { fetchAllFeeds, deduplicateNews } from "../services/news-fetcher";
import { analyzeSentiment } from "../services/ai-analyst";
import { newsReactiveSell } from "../services/portfolio";
import type { Env } from "../types";
import { PORTFOLIO_RULES } from "../types";

export async function handleNewsScrape(env: Env): Promise<void> {
  const db = drizzle(env.DB);

  // Fetch all RSS feeds + NewsAPI
  const allItems = await fetchAllFeeds(env);
  if (allItems.length === 0) {
    console.log("[news-scrape] No items from feeds");
    return;
  }

  // Deduplicate against KV cache
  const newUrls = await deduplicateNews(allItems, env);
  const newItems = allItems.filter((item) => newUrls.includes(item.url));

  if (newItems.length === 0) {
    console.log("[news-scrape] No new items after dedup");
    return;
  }

  console.log(`[news-scrape] Processing ${Math.min(newItems.length, 20)} new articles`);

  // Batch sentiment analysis — process up to 20 items per run
  const batch = newItems.slice(0, 20);
  const now = new Date().toISOString();

  // Batch analyze: send all titles+summaries in one call for efficiency
  const sentimentResults = await analyzeSentimentBatch(batch, env);

  // Get currently held tickers for reactive sell check
  const openPositions = await db
    .select({ ticker: portfolio.ticker })
    .from(portfolio)
    .where(eq(portfolio.status, "open"));
  const heldTickers = new Set(openPositions.map((p) => p.ticker));

  // Track high-impact negative news for held positions
  const reactiveSellCandidates: Array<{ ticker: string; sentiment: number; impact: number; title: string }> = [];

  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    const sentiment = sentimentResults[i];
    if (!sentiment) continue;

    await db.insert(news).values({
      source: item.source,
      title: item.title,
      url: item.url,
      summary: item.summary || null,
      tickers: JSON.stringify(sentiment.tickers),
      sentiment: sentiment.sentiment,
      impact: sentiment.impact,
      timeHorizon: sentiment.timeHorizon as "immediate" | "week" | "month" | "long",
      publishedAt: item.publishedAt,
      scrapedAt: now,
    });

    // Check if this news affects any held position with high negative impact
    if (
      sentiment.impact > PORTFOLIO_RULES.NEWS_SELL_IMPACT_THRESHOLD &&
      sentiment.sentiment < PORTFOLIO_RULES.NEWS_SELL_SENTIMENT_THRESHOLD
    ) {
      for (const ticker of sentiment.tickers) {
        if (heldTickers.has(ticker)) {
          reactiveSellCandidates.push({
            ticker,
            sentiment: sentiment.sentiment,
            impact: sentiment.impact,
            title: item.title,
          });
        }
      }
    }
  }

  // Execute reactive sells for high-impact negative news on held positions
  for (const candidate of reactiveSellCandidates) {
    console.log(
      `[news-scrape] HIGH IMPACT negative news for ${candidate.ticker}: "${candidate.title}" (impact=${candidate.impact}, sentiment=${candidate.sentiment.toFixed(2)})`
    );
    const result = await newsReactiveSell(
      candidate.ticker,
      candidate.sentiment,
      candidate.impact,
      env
    );
    console.log(`[news-scrape] Reactive sell result for ${candidate.ticker}: ${result.sold ? "SOLD" : "HELD"} — ${result.reason}`);
  }

  console.log(`[news-scrape] Done: ${batch.length} articles processed, ${reactiveSellCandidates.length} reactive sell candidates`);
}

/**
 * Batch sentiment analysis: analyze multiple items, falling back to
 * individual calls if batch fails.
 */
async function analyzeSentimentBatch(
  items: Array<{ title: string; summary: string; source: string; url: string; publishedAt: string | null }>,
  env: Env
): Promise<Array<{ tickers: string[]; sentiment: number; impact: number; timeHorizon: string } | null>> {
  // Try individual calls with Promise.allSettled for parallelism
  // (Gemini doesn't have a native batch endpoint, so we parallelize)
  const BATCH_SIZE = 5;
  const results: Array<{ tickers: string[]; sentiment: number; impact: number; timeHorizon: string } | null> = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);

    const settled = await Promise.allSettled(
      chunk.map((item) => analyzeSentiment(item.title, item.summary || "", env))
    );

    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        console.error(`[news-scrape] Sentiment analysis failed:`, result.reason);
        results.push(null);
      }
    }
  }

  return results;
}

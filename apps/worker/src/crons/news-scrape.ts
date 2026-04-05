import { drizzle } from "drizzle-orm/d1";
import { news } from "../db/schema";
import { fetchAllFeeds, deduplicateNews } from "../services/news-fetcher";
import { analyzeSentiment } from "../services/ai-analyst";
import type { Env } from "../types";

export async function handleNewsScrape(env: Env): Promise<void> {
  const db = drizzle(env.DB);

  // Fetch all RSS feeds
  const allItems = await fetchAllFeeds();
  if (allItems.length === 0) return;

  // Deduplicate against KV cache
  const newUrls = await deduplicateNews(allItems, env);
  const newItems = allItems.filter((item) => newUrls.includes(item.url));

  if (newItems.length === 0) return;

  // Batch sentiment analysis — process up to 20 items per run to stay within API limits
  const batch = newItems.slice(0, 20);
  const now = new Date().toISOString();

  for (const item of batch) {
    const sentiment = await analyzeSentiment(item.title, item.summary, env);

    await db.insert(news).values({
      source: item.source,
      title: item.title,
      url: item.url,
      summary: item.summary || null,
      tickers: JSON.stringify(sentiment.tickers),
      sentiment: sentiment.sentiment,
      impact: sentiment.impact,
      timeHorizon: sentiment.timeHorizon as
        | "immediate"
        | "week"
        | "month"
        | "long",
      publishedAt: item.publishedAt,
      scrapedAt: now,
    });
  }
}

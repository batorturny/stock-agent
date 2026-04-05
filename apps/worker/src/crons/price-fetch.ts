import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { portfolio, prices } from "../db/schema";
import { fetchQuotes, isMarketOpen, updatePriceCache } from "../services/price-api";
import { checkStopLossAndTakeProfit } from "../services/portfolio";
import type { Env } from "../types";

// Watchlist of popular tickers to always track
const DEFAULT_WATCHLIST = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA",
  "META", "TSLA", "JPM", "V", "WMT",
];

export async function handlePriceFetch(env: Env): Promise<void> {
  if (!isMarketOpen()) return;

  const db = drizzle(env.DB);

  // Get tickers from open positions
  const positions = await db
    .select({ ticker: portfolio.ticker })
    .from(portfolio)
    .where(eq(portfolio.status, "open"));

  const positionTickers = positions.map((p) => p.ticker);

  // Combine with watchlist, deduplicate
  const allTickers = [...new Set([...positionTickers, ...DEFAULT_WATCHLIST])];

  // Fetch quotes
  const quotes = await fetchQuotes(allTickers, env);
  const now = new Date().toISOString();

  // Store in D1 and KV cache
  for (const [ticker, quote] of quotes) {
    await updatePriceCache(ticker, quote, env);

    await db.insert(prices).values({
      ticker,
      price: quote.c,
      open: quote.o,
      high: quote.h,
      low: quote.l,
      volume: 0,
      recordedAt: now,
    });
  }

  // Check stop-loss and take-profit
  await checkStopLossAndTakeProfit(env);
}

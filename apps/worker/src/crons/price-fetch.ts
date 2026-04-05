import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { portfolio, prices } from "../db/schema";
import { fetchQuotes, updatePriceCache } from "../services/price-api";
import { checkStopLossAndTakeProfit } from "../services/portfolio";
import type { Env } from "../types";

// NYSE + NASDAQ top blue chips watchlist
const DEFAULT_WATCHLIST = [
  // Mega-cap tech (NASDAQ/NYSE)
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA",
  "META", "TSLA",
  // NYSE blue chips
  "JPM", "V", "WMT", "JNJ", "UNH",
  "PG", "HD", "BAC", "DIS", "KO",
  // Growth / momentum
  "CRM", "AMD", "NFLX",
];

export async function handlePriceFetch(env: Env): Promise<void> {
  // Always fetch — Finnhub returns last known price when market closed

  const db = drizzle(env.DB);

  // Get tickers from open positions
  const positions = await db
    .select({ ticker: portfolio.ticker })
    .from(portfolio)
    .where(eq(portfolio.status, "open"));

  const positionTickers = positions.map((p) => p.ticker);

  // Combine with watchlist, deduplicate
  const allTickers = [...new Set([...positionTickers, ...DEFAULT_WATCHLIST])];

  console.log(`[price-fetch] Fetching ${allTickers.length} tickers (${positionTickers.length} positions + watchlist)`);

  // Fetch quotes in batches of 5 with Promise.allSettled
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
      volume: quote.v ?? 0,
      recordedAt: now,
    });
  }

  console.log(`[price-fetch] Stored ${quotes.size} prices, checking stops...`);

  // Check stop-loss and take-profit
  const stopActions = await checkStopLossAndTakeProfit(env);
  if (stopActions.length > 0) {
    console.log(`[price-fetch] Stop actions triggered: ${stopActions.join(" | ")}`);
  }
}

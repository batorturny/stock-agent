import type { Env } from "../types";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

export type FinnhubQuote = {
  c: number; // current price
  d: number; // change
  dp: number; // percent change
  h: number; // high
  l: number; // low
  o: number; // open
  pc: number; // previous close
  t: number; // timestamp
  v?: number; // volume (from candle endpoint or added)
};

export async function fetchQuote(
  ticker: string,
  env: Env
): Promise<FinnhubQuote | null> {
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/quote?symbol=${ticker}`,
      { headers: { "X-Finnhub-Token": env.FINNHUB_API_KEY } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as FinnhubQuote;
    // Finnhub returns c=0 for invalid tickers
    if (data.c === 0) return null;
    return data;
  } catch (err) {
    console.error(`[price-api] Failed to fetch quote for ${ticker}:`, err);
    return null;
  }
}

/**
 * Fetch volume data from Finnhub candle endpoint (current day).
 * Returns volume or 0 on failure.
 */
async function fetchVolume(ticker: string, env: Env): Promise<number> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const dayAgo = now - 86400;
    const res = await fetch(
      `${FINNHUB_BASE}/stock/candle?symbol=${ticker}&resolution=D&from=${dayAgo}&to=${now}`,
      { headers: { "X-Finnhub-Token": env.FINNHUB_API_KEY } }
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as { v?: number[]; s: string };
    if (data.s === "no_data" || !data.v || data.v.length === 0) return 0;
    return data.v[data.v.length - 1] ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Batch fetch quotes using Promise.allSettled in groups of 5
 * with 1s delay between batches (Finnhub rate limit: 60/min).
 */
export async function fetchQuotes(
  tickers: string[],
  env: Env
): Promise<Map<string, FinnhubQuote>> {
  const results = new Map<string, FinnhubQuote>();
  const BATCH_SIZE = 5;

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);

    const settled = await Promise.allSettled(
      batch.map(async (ticker) => {
        const quote = await fetchQuote(ticker, env);
        if (!quote) return null;
        // Fetch volume in parallel with quote processing
        const volume = await fetchVolume(ticker, env);
        return { ticker, quote: { ...quote, v: volume } };
      })
    );

    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) {
        results.set(result.value.ticker, result.value.quote);
      }
    }

    // Delay between batches to respect rate limit (skip after last batch)
    if (i + BATCH_SIZE < tickers.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log(`[price-api] Fetched ${results.size}/${tickers.length} quotes`);
  return results;
}

export function isMarketOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;

  const hours = now.getUTCHours();
  const minutes = now.getUTCMinutes();
  const timeInMinutes = hours * 60 + minutes;

  return timeInMinutes >= 13 * 60 + 30 && timeInMinutes <= 21 * 60;
}

export async function updatePriceCache(
  ticker: string,
  quote: FinnhubQuote,
  env: Env
): Promise<void> {
  await env.CACHE.put(
    `price:${ticker}`,
    JSON.stringify({
      price: quote.c,
      change: quote.d,
      changePercent: quote.dp,
      high: quote.h,
      low: quote.l,
      open: quote.o,
      previousClose: quote.pc,
      volume: quote.v ?? 0,
      updatedAt: new Date().toISOString(),
    }),
    { expirationTtl: 300 } // 5 min TTL
  );
}

export async function getCachedPrice(
  ticker: string,
  env: Env
): Promise<{
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
  updatedAt: string;
} | null> {
  const cached = await env.CACHE.get(`price:${ticker}`);
  if (!cached) return null;
  return JSON.parse(cached);
}

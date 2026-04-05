import type { Env } from "../types";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

type FinnhubQuote = {
  c: number; // current price
  d: number; // change
  dp: number; // percent change
  h: number; // high
  l: number; // low
  o: number; // open
  pc: number; // previous close
  t: number; // timestamp
};

export async function fetchQuote(
  ticker: string,
  env: Env
): Promise<FinnhubQuote | null> {
  const res = await fetch(
    `${FINNHUB_BASE}/quote?symbol=${ticker}&token=${env.FINNHUB_API_KEY}`
  );
  if (!res.ok) return null;
  const data = (await res.json()) as FinnhubQuote;
  // Finnhub returns c=0 for invalid tickers
  if (data.c === 0) return null;
  return data;
}

export async function fetchQuotes(
  tickers: string[],
  env: Env
): Promise<Map<string, FinnhubQuote>> {
  const results = new Map<string, FinnhubQuote>();
  // Finnhub free tier: 60 req/min — fetch sequentially with small batches
  for (const ticker of tickers) {
    const quote = await fetchQuote(ticker, env);
    if (quote) results.set(ticker, quote);
  }
  return results;
}

export function isMarketOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  // Weekend check (0=Sun, 6=Sat)
  if (day === 0 || day === 6) return false;

  // NYSE hours: 9:30-16:00 ET = 14:30-21:00 UTC (EST)
  // During EDT: 13:30-20:00 UTC
  // Use conservative window: 13:30-21:00 UTC to cover both
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
  updatedAt: string;
} | null> {
  const cached = await env.CACHE.get(`price:${ticker}`);
  if (!cached) return null;
  return JSON.parse(cached);
}

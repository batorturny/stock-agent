// Politician / congressional trades via Finnhub congressional-trading endpoint
// Docs: https://finnhub.io/docs/api/congressional-trading
// Endpoint: GET /stock/congressional-trading?symbol=AAPL&from=2024-01-01&to=2024-12-31

import { drizzle } from "drizzle-orm/d1";
import { desc, eq, and, gte } from "drizzle-orm";
import { politicianTrades, copyTradeQueue } from "../db/schema";
import type { Env } from "../types";
import { COPY_TRADING_CONFIG } from "./copy-trading-config";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

interface FinnhubCongressTrade {
  symbol: string;
  name: string;
  position: string;
  ownerType: string;
  transactionType: string;
  amountFrom: number;
  amountTo: number;
  transactionDate: string;
  filingDate: string;
  assetName: string;
}

interface FinnhubCongressResponse {
  data: FinnhubCongressTrade[];
  symbol: string;
}

// ─── Fetch ───

async function fetchCongressTradesForSymbol(
  symbol: string,
  env: Env,
  fromDate: string
): Promise<FinnhubCongressTrade[]> {
  const today = new Date().toISOString().split("T")[0];
  const url = `${FINNHUB_BASE}/stock/congressional-trading?symbol=${symbol}&from=${fromDate}&to=${today}&token=${env.FINNHUB_API_KEY}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as FinnhubCongressResponse;
    return json.data ?? [];
  } catch {
    return [];
  }
}

// ─── Get tracked tickers (union of watchlist + portfolio tickers) ───

async function getTrackedSymbols(env: Env): Promise<string[]> {
  const watchlistRaw = await env.CACHE.get("watchlist");
  const watchlist: string[] = watchlistRaw ? (JSON.parse(watchlistRaw) as string[]) : [];

  // Add tickers from tracked politicians' known holdings
  const politicianTickers = COPY_TRADING_CONFIG.flatMap((p) => p.trackedTickers ?? []);

  return [...new Set([...watchlist, ...politicianTickers])];
}

// ─── Main fetch + store job ───

export async function fetchAndStorePoliticianTrades(env: Env): Promise<string> {
  const db = drizzle(env.DB);
  const symbols = await getTrackedSymbols(env);

  if (symbols.length === 0) {
    return "No tracked symbols for politician trade fetch";
  }

  // Only fetch last 90 days to keep requests manageable
  const fromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  let newTradesCount = 0;
  const now = new Date().toISOString();

  // Fetch for each symbol (respect Finnhub 60 req/min limit — add small delay)
  for (const symbol of symbols.slice(0, 20)) { // max 20 symbols per run
    const trades = await fetchCongressTradesForSymbol(symbol, env, fromDate);

    for (const trade of trades) {
      // Dedup: skip if same politician + symbol + transactionDate already stored
      const existing = await db
        .select()
        .from(politicianTrades)
        .where(
          and(
            eq(politicianTrades.symbol, trade.symbol),
            eq(politicianTrades.name, trade.name),
            eq(politicianTrades.transactionDate, trade.transactionDate),
            eq(politicianTrades.transactionType, trade.transactionType)
          )
        )
        .limit(1);

      if (existing.length > 0) continue;

      const [inserted] = await db
        .insert(politicianTrades)
        .values({
          symbol: trade.symbol,
          name: trade.name,
          position: trade.position,
          ownerType: trade.ownerType,
          transactionType: trade.transactionType,
          amountFrom: trade.amountFrom,
          amountTo: trade.amountTo,
          transactionDate: trade.transactionDate,
          filingDate: trade.filingDate,
          fetchedAt: now,
        })
        .returning();

      newTradesCount++;

      // Queue copy trade if this politician is tracked and it's a Purchase
      await maybeQueueCopyTrade(inserted, env);
    }

    // Small delay to respect rate limits
    await new Promise((r) => setTimeout(r, 200));
  }

  return `Politician trades: ${newTradesCount} new trades stored for ${symbols.length} symbols`;
}

// ─── Copy trade queueing ───

async function maybeQueueCopyTrade(
  trade: typeof politicianTrades.$inferSelect,
  env: Env
): Promise<void> {
  // Only queue purchases
  if (!trade.transactionType.toLowerCase().includes("purchase")) return;

  // Check if this politician is in our tracked list
  const trackedPolitician = COPY_TRADING_CONFIG.find(
    (p) => trade.name.toLowerCase().includes(p.namePart.toLowerCase())
  );
  if (!trackedPolitician) return;

  const db = drizzle(env.DB);
  const now = new Date();

  // Execute after configured delay (default 24h)
  const delayMs = (trackedPolitician.delayHours ?? 24) * 60 * 60 * 1000;
  const executeAfter = new Date(now.getTime() + delayMs).toISOString();

  // Size: use trackedPolitician.positionSizePct of virtual portfolio cash
  // We'll compute exact qty at execution time; store a placeholder
  const estimatedQty = trackedPolitician.positionSizePct / 100; // stored as fraction, computed at exec

  await db.insert(copyTradeQueue).values({
    symbol: trade.symbol,
    side: "buy",
    qty: estimatedQty,
    politicianName: trade.name,
    politicianTradeId: trade.id,
    executeAfter,
    status: "pending",
    reason: `Copy: ${trade.name} purchased ${trade.symbol} (~$${trade.amountFrom?.toLocaleString()}–$${trade.amountTo?.toLocaleString()})`,
    createdAt: now.toISOString(),
  });
}

// ─── Queries ───

export async function getRecentPoliticianTrades(
  env: Env,
  limit = 50
): Promise<(typeof politicianTrades.$inferSelect)[]> {
  const db = drizzle(env.DB);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  return db
    .select()
    .from(politicianTrades)
    .where(gte(politicianTrades.transactionDate, thirtyDaysAgo))
    .orderBy(desc(politicianTrades.transactionDate))
    .limit(limit);
}

export async function getPendingCopyTrades(
  env: Env
): Promise<(typeof copyTradeQueue.$inferSelect)[]> {
  const db = drizzle(env.DB);
  return db
    .select()
    .from(copyTradeQueue)
    .where(eq(copyTradeQueue.status, "pending"))
    .orderBy(desc(copyTradeQueue.createdAt));
}

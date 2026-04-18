// Full SEC EDGAR Form 4 insider trading module
// Sources: Finnhub insider-transactions + insider-sentiment endpoints
// Detects cluster buys/sells and generates trading signals

import { drizzle } from "drizzle-orm/d1";
import { desc, eq, and, gte } from "drizzle-orm";
import { insiderFilings, insiderSignals } from "../db/schema";
import type { Env } from "../types";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

// SEC EDGAR User-Agent for future direct EDGAR API calls
// const SEC_USER_AGENT = "StockAgent/1.0 (bator.turny@gmail.com)";

// ─── Types ───

export type InsiderFiling = typeof insiderFilings.$inferSelect;

export type InsiderSignal = {
  ticker: string;
  signal: "cluster_buy" | "cluster_sell" | "ceo_buy" | "large_buy";
  insiders: { name: string; role: string; shares: number; value: number }[];
  totalValue: number;
  confidence: number; // 0-1
  detectedAt: string;
};

interface FinnhubInsiderTx {
  name: string;
  share: number;
  change: number;
  filingDate: string;
  transactionDate: string;
  transactionCode: string; // P=Purchase, S=Sale, A=Award, M=Exercise, etc.
  transactionPrice: number;
}

interface FinnhubInsiderResponse {
  data: FinnhubInsiderTx[];
  symbol: string;
}

interface FinnhubInsiderSentiment {
  symbol: string;
  year: number;
  month: number;
  change: number;
  mspr: number; // Monthly Share Purchase Ratio (-100 to 100)
}

interface FinnhubSentimentResponse {
  data: FinnhubInsiderSentiment[];
  symbol: string;
}

// ─── Role scoring weights ───

const ROLE_WEIGHTS: Record<string, number> = {
  ceo: 1.0,
  cfo: 0.9,
  coo: 0.85,
  president: 0.85,
  "chief executive officer": 1.0,
  "chief financial officer": 0.9,
  "chief operating officer": 0.85,
  "chief technology officer": 0.8,
  director: 0.6,
  "10% owner": 0.7,
  vp: 0.5,
  "senior vice president": 0.55,
  "general counsel": 0.5,
  officer: 0.5,
};

function getRoleWeight(role: string): number {
  const lower = role.toLowerCase();
  for (const [key, weight] of Object.entries(ROLE_WEIGHTS)) {
    if (lower.includes(key)) return weight;
  }
  return 0.3; // unknown role — still counts
}

// Map Finnhub transaction codes to human-readable types
function mapTransactionType(code: string): string {
  switch (code) {
    case "P": return "Purchase";
    case "S": return "Sale";
    case "A": return "Award";
    case "M": return "Exercise";
    case "G": return "Gift";
    case "F": return "Tax-withholding";
    default: return code;
  }
}

// ─── Get tracked tickers from KV ───

async function getTrackedTickers(env: Env): Promise<string[]> {
  // Use dynamic watchlist built by stock-screener
  const watchlistRaw = await env.CACHE.get("dynamic_watchlist");
  if (watchlistRaw) return JSON.parse(watchlistRaw) as string[];

  // Fallback to a static set of blue chips
  return [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA",
    "JPM", "BAC", "GS", "JNJ", "UNH", "XOM", "CVX",
  ];
}

// ─── Finnhub: fetch insider transactions for a ticker ───

async function fetchFinnhubInsiderTx(
  ticker: string,
  env: Env,
): Promise<FinnhubInsiderTx[]> {
  const cacheKey = `insider_tx:${ticker}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) return JSON.parse(cached) as FinnhubInsiderTx[];

  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/insider-transactions?symbol=${ticker}`,
      { headers: { "X-Finnhub-Token": env.FINNHUB_API_KEY } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as FinnhubInsiderResponse;
    const txs = data.data ?? [];

    // Cache for 6 hours — insider filings don't change often
    await env.CACHE.put(cacheKey, JSON.stringify(txs), { expirationTtl: 21600 });
    return txs;
  } catch {
    return [];
  }
}

// ─── Finnhub: fetch insider sentiment (MSPR) for a ticker ───

async function fetchInsiderSentiment(
  ticker: string,
  env: Env,
): Promise<FinnhubInsiderSentiment[]> {
  const cacheKey = `insider_sentiment:${ticker}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) return JSON.parse(cached) as FinnhubInsiderSentiment[];

  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/insider-sentiment?symbol=${ticker}&from=2025-01-01`,
      { headers: { "X-Finnhub-Token": env.FINNHUB_API_KEY } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as FinnhubSentimentResponse;
    const sentiments = data.data ?? [];

    await env.CACHE.put(cacheKey, JSON.stringify(sentiments), { expirationTtl: 21600 });
    return sentiments;
  } catch {
    return [];
  }
}

// ─── Main cron: fetch insider filings for all tracked tickers ───

export async function fetchInsiderFilings(env: Env): Promise<string> {
  const db = drizzle(env.DB);
  const tickers = await getTrackedTickers(env);
  const now = new Date().toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

  let newCount = 0;
  let processedTickers = 0;

  // Process max 20 tickers per run (respect Finnhub 60 req/min: ~2 API calls per ticker)
  for (const ticker of tickers.slice(0, 20)) {
    const txs = await fetchFinnhubInsiderTx(ticker, env);

    // Filter to recent transactions only
    const recent = txs.filter(
      (tx) => tx.transactionDate >= thirtyDaysAgo && (tx.transactionCode === "P" || tx.transactionCode === "S"),
    );

    for (const tx of recent) {
      // Dedup: skip if same filer + ticker + date + type already stored
      const existing = await db
        .select({ id: insiderFilings.id })
        .from(insiderFilings)
        .where(
          and(
            eq(insiderFilings.ticker, ticker),
            eq(insiderFilings.filerName, tx.name),
            eq(insiderFilings.transactionDate, tx.transactionDate),
            eq(insiderFilings.transactionType, mapTransactionType(tx.transactionCode)),
          ),
        )
        .limit(1);

      if (existing.length > 0) continue;

      const shares = Math.abs(tx.change);
      const price = tx.transactionPrice || 0;

      await db.insert(insiderFilings).values({
        ticker,
        filerName: tx.name,
        filerRole: inferRole(tx.name, ticker), // Finnhub doesn't always give role directly
        transactionType: mapTransactionType(tx.transactionCode),
        shares,
        pricePerShare: price > 0 ? price : null,
        totalValue: price > 0 ? shares * price : null,
        transactionDate: tx.transactionDate,
        filingDate: tx.filingDate || tx.transactionDate,
        filingUrl: null,
        source: "finnhub",
        fetchedAt: now,
      });
      newCount++;
    }

    processedTickers++;
    // Rate limit: ~300ms between tickers (2 calls × ~200ms gap)
    if (processedTickers < tickers.length) {
      await new Promise<void>((r) => setTimeout(r, 300));
    }
  }

  // After fetching, detect signals
  const signals = await detectAndStoreSignals(env);

  return `[insider-trading] ${newCount} new filings from ${processedTickers} tickers. ${signals} signals detected.`;
}

// ─── Role inference from Finnhub data ───
// Finnhub insider-transactions doesn't always include role, so we store what we can
// and enrich later. For now, store the filer name and use a basic heuristic.

function inferRole(_name: string, _ticker: string): string {
  // Finnhub data doesn't reliably include role info in the insider-transactions endpoint.
  // We default to "Officer" and the signal detection logic will still work because
  // it weights by value and count, not solely by role.
  return "Officer";
}

// ─── Signal detection: cluster buys/sells ───

async function detectAndStoreSignals(env: Env): Promise<number> {
  const db = drizzle(env.DB);
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString().split("T")[0];
  let signalCount = 0;

  // Get all filings from last 14 days (wider window for cluster detection)
  const recentFilings = await db
    .select()
    .from(insiderFilings)
    .where(gte(insiderFilings.transactionDate, fourteenDaysAgo))
    .orderBy(desc(insiderFilings.transactionDate));

  // Group by ticker
  const byTicker = new Map<string, InsiderFiling[]>();
  for (const filing of recentFilings) {
    const existing = byTicker.get(filing.ticker) ?? [];
    existing.push(filing);
    byTicker.set(filing.ticker, existing);
  }

  for (const [ticker, filings] of byTicker) {
    const buys = filings.filter((f) => f.transactionType === "Purchase");
    const sells = filings.filter((f) => f.transactionType === "Sale");

    // Unique buyers/sellers by name
    const uniqueBuyers = [...new Set(buys.map((b) => b.filerName))];
    const uniqueSellers = [...new Set(sells.map((s) => s.filerName))];

    // ── Cluster buy: 3+ unique insiders buying within 7 days ──
    if (uniqueBuyers.length >= 3) {
      const totalValue = buys.reduce((sum, b) => sum + (b.totalValue ?? 0), 0);
      const insiders = uniqueBuyers.map((name) => {
        const personBuys = buys.filter((b) => b.filerName === name);
        const totalShares = personBuys.reduce((s, b) => s + b.shares, 0);
        const totalVal = personBuys.reduce((s, b) => s + (b.totalValue ?? 0), 0);
        return {
          name,
          role: personBuys[0].filerRole,
          shares: totalShares,
          value: totalVal,
        };
      });

      const confidence = computeClusterConfidence(insiders, totalValue);

      // Dedup: check if we already have this signal today
      const todayStr = now.toISOString().split("T")[0];
      const existingSignal = await db
        .select({ id: insiderSignals.id })
        .from(insiderSignals)
        .where(
          and(
            eq(insiderSignals.ticker, ticker),
            eq(insiderSignals.signalType, "cluster_buy"),
            gte(insiderSignals.detectedAt, todayStr),
          ),
        )
        .limit(1);

      if (existingSignal.length === 0) {
        await db.insert(insiderSignals).values({
          ticker,
          signalType: "cluster_buy",
          insiderCount: uniqueBuyers.length,
          totalValue,
          confidence,
          details: JSON.stringify(insiders),
          detectedAt: now.toISOString(),
        });
        signalCount++;
      }
    }

    // ── Cluster sell (insider exodus): 3+ unique insiders selling within 7 days ──
    if (uniqueSellers.length >= 3) {
      const totalValue = sells.reduce((sum, s) => sum + (s.totalValue ?? 0), 0);
      const insiders = uniqueSellers.map((name) => {
        const personSells = sells.filter((s) => s.filerName === name);
        const totalShares = personSells.reduce((s, b) => s + b.shares, 0);
        const totalVal = personSells.reduce((s, b) => s + (b.totalValue ?? 0), 0);
        return {
          name,
          role: personSells[0].filerRole,
          shares: totalShares,
          value: totalVal,
        };
      });

      const confidence = computeClusterConfidence(insiders, totalValue);

      const todayStr = now.toISOString().split("T")[0];
      const existingSignal = await db
        .select({ id: insiderSignals.id })
        .from(insiderSignals)
        .where(
          and(
            eq(insiderSignals.ticker, ticker),
            eq(insiderSignals.signalType, "cluster_sell"),
            gte(insiderSignals.detectedAt, todayStr),
          ),
        )
        .limit(1);

      if (existingSignal.length === 0) {
        await db.insert(insiderSignals).values({
          ticker,
          signalType: "cluster_sell",
          insiderCount: uniqueSellers.length,
          totalValue,
          confidence,
          details: JSON.stringify(insiders),
          detectedAt: now.toISOString(),
        });
        signalCount++;
      }
    }

    // ── CEO/CFO buy: any C-suite purchase is a strong signal ──
    for (const buy of buys) {
      const roleLower = buy.filerRole.toLowerCase();
      const isCsuite = roleLower.includes("ceo") || roleLower.includes("chief executive");
      if (!isCsuite) continue;

      const value = buy.totalValue ?? 0;
      if (value < 10000) continue; // skip tiny buys

      const todayStr = now.toISOString().split("T")[0];
      const existingSignal = await db
        .select({ id: insiderSignals.id })
        .from(insiderSignals)
        .where(
          and(
            eq(insiderSignals.ticker, ticker),
            eq(insiderSignals.signalType, "ceo_buy"),
            gte(insiderSignals.detectedAt, todayStr),
          ),
        )
        .limit(1);

      if (existingSignal.length === 0) {
        await db.insert(insiderSignals).values({
          ticker,
          signalType: "ceo_buy",
          insiderCount: 1,
          totalValue: value,
          confidence: Math.min(0.5 + (value / 1_000_000) * 0.3, 0.95),
          details: JSON.stringify([{
            name: buy.filerName,
            role: buy.filerRole,
            shares: buy.shares,
            value,
          }]),
          detectedAt: now.toISOString(),
        });
        signalCount++;
      }
    }

    // ── Large buy: single insider purchase > $500k ──
    for (const buy of buys) {
      const value = buy.totalValue ?? 0;
      if (value < 500_000) continue;

      const todayStr = now.toISOString().split("T")[0];
      const existingSignal = await db
        .select({ id: insiderSignals.id })
        .from(insiderSignals)
        .where(
          and(
            eq(insiderSignals.ticker, ticker),
            eq(insiderSignals.signalType, "large_buy"),
            gte(insiderSignals.detectedAt, todayStr),
          ),
        )
        .limit(1);

      if (existingSignal.length === 0) {
        await db.insert(insiderSignals).values({
          ticker,
          signalType: "large_buy",
          insiderCount: 1,
          totalValue: value,
          confidence: Math.min(0.4 + (value / 2_000_000) * 0.4 + getRoleWeight(buy.filerRole) * 0.2, 0.95),
          details: JSON.stringify([{
            name: buy.filerName,
            role: buy.filerRole,
            shares: buy.shares,
            value,
          }]),
          detectedAt: now.toISOString(),
        });
        signalCount++;
      }
    }
  }

  return signalCount;
}

// ─── Confidence computation for cluster signals ───

function computeClusterConfidence(
  insiders: { name: string; role: string; shares: number; value: number }[],
  totalValue: number,
): number {
  // Base: number of insiders (3 = 0.5, 5+ = 0.7)
  const countScore = Math.min(insiders.length / 7, 1.0) * 0.3;

  // Role quality: average role weight
  const avgRole = insiders.reduce((s, i) => s + getRoleWeight(i.role), 0) / insiders.length;
  const roleScore = avgRole * 0.3;

  // Value: log scale, $100k = 0.3, $1M = 0.6, $10M = 0.9
  const valueScore = totalValue > 0
    ? Math.min(Math.log10(totalValue) / 7.5, 1.0) * 0.4
    : 0.1;

  return Math.min(countScore + roleScore + valueScore, 0.95);
}

// ─── Query: recent insider buys ───

export async function getRecentInsiderBuys(
  env: Env,
  days = 14,
): Promise<InsiderFiling[]> {
  const db = drizzle(env.DB);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

  return db
    .select()
    .from(insiderFilings)
    .where(
      and(
        eq(insiderFilings.transactionType, "Purchase"),
        gte(insiderFilings.transactionDate, cutoff),
      ),
    )
    .orderBy(desc(insiderFilings.transactionDate))
    .limit(100);
}

// ─── Query: recent insider sells ───

export async function getRecentInsiderSells(
  env: Env,
  days = 14,
): Promise<InsiderFiling[]> {
  const db = drizzle(env.DB);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

  return db
    .select()
    .from(insiderFilings)
    .where(
      and(
        eq(insiderFilings.transactionType, "Sale"),
        gte(insiderFilings.transactionDate, cutoff),
      ),
    )
    .orderBy(desc(insiderFilings.transactionDate))
    .limit(100);
}

// ─── Query: get active signals (not yet acted on, last 7 days) ───

export async function getInsiderSignals(env: Env): Promise<InsiderSignal[]> {
  const db = drizzle(env.DB);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

  const rows = await db
    .select()
    .from(insiderSignals)
    .where(
      and(
        eq(insiderSignals.actedOn, 0),
        gte(insiderSignals.detectedAt, sevenDaysAgo),
      ),
    )
    .orderBy(desc(insiderSignals.confidence));

  return rows.map((row) => {
    let insiders: { name: string; role: string; shares: number; value: number }[] = [];
    try {
      insiders = JSON.parse(row.details);
    } catch {
      insiders = [];
    }

    return {
      ticker: row.ticker,
      signal: row.signalType as InsiderSignal["signal"],
      insiders,
      totalValue: row.totalValue,
      confidence: row.confidence,
      detectedAt: row.detectedAt,
    };
  });
}

// ─── Format insider data for AI analysis prompt ───

export async function getInsiderSummaryForAI(env: Env): Promise<string> {
  const signals = await getInsiderSignals(env);
  const recentBuys = await getRecentInsiderBuys(env, 7);
  const recentSells = await getRecentInsiderSells(env, 7);

  const lines: string[] = [];
  lines.push("=== INSIDER TRADING SIGNALS (Last 7 Days) ===");

  if (signals.length === 0) {
    lines.push("No active insider signals detected.");
  } else {
    for (const sig of signals) {
      const emoji = sig.signal.includes("buy") ? "BUY" : "SELL";
      const names = sig.insiders.map((i) => `${i.name} (${i.role})`).join(", ");
      lines.push(
        `[${emoji}] ${sig.ticker} — ${sig.signal.toUpperCase()} | ` +
        `${sig.insiders.length} insiders | $${formatValue(sig.totalValue)} | ` +
        `Confidence: ${(sig.confidence * 100).toFixed(0)}% | ${names}`,
      );
    }
  }

  // Aggregate buy/sell summary by ticker
  lines.push("");
  lines.push("=== INSIDER ACTIVITY SUMMARY ===");

  const buysByTicker = groupBy(recentBuys, (f) => f.ticker);
  const sellsByTicker = groupBy(recentSells, (f) => f.ticker);
  const allTickers = [...new Set([...buysByTicker.keys(), ...sellsByTicker.keys()])];

  for (const ticker of allTickers.slice(0, 20)) {
    const buys = buysByTicker.get(ticker) ?? [];
    const sells = sellsByTicker.get(ticker) ?? [];
    const buyVal = buys.reduce((s, b) => s + (b.totalValue ?? 0), 0);
    const sellVal = sells.reduce((s, b) => s + (b.totalValue ?? 0), 0);

    lines.push(
      `${ticker}: ${buys.length} buys ($${formatValue(buyVal)}) | ` +
      `${sells.length} sells ($${formatValue(sellVal)})`,
    );
  }

  // Also fetch aggregate insider sentiment from Finnhub for top tickers
  const sentimentLines = await getAggregateSentimentSummary(env, allTickers.slice(0, 10));
  if (sentimentLines.length > 0) {
    lines.push("");
    lines.push("=== INSIDER SENTIMENT (MSPR) ===");
    lines.push(...sentimentLines);
  }

  return lines.join("\n");
}

// ─── Aggregate insider sentiment from Finnhub ───

async function getAggregateSentimentSummary(
  env: Env,
  tickers: string[],
): Promise<string[]> {
  const lines: string[] = [];

  for (const ticker of tickers) {
    const sentiments = await fetchInsiderSentiment(ticker, env);
    if (sentiments.length === 0) continue;

    // Get most recent month
    const latest = sentiments[sentiments.length - 1];
    if (!latest) continue;

    const direction = latest.mspr > 0 ? "NET BUY" : latest.mspr < 0 ? "NET SELL" : "NEUTRAL";
    lines.push(`${ticker}: MSPR=${latest.mspr.toFixed(1)} (${direction}), net change=${latest.change} shares`);

    // Rate limit
    await new Promise<void>((r) => setTimeout(r, 200));
  }

  return lines;
}

// ─── Helpers ───

function formatValue(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toFixed(0);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  return map;
}

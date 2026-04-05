import { eq, and, lte, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { portfolio, prices, pendingOrders } from "../db/schema";
import { fetchQuotes, updatePriceCache, getCachedPrice } from "../services/price-api";
import { checkStopLossAndTakeProfit, executeTrade } from "../services/portfolio";
import { saveDailySnapshot } from "../services/risk-manager";
import { sendAlert } from "../services/alerter";
import type { Env } from "../types";

// NYSE + NASDAQ top blue chips watchlist + benchmark ETFs
const DEFAULT_WATCHLIST = [
  // Benchmark / index ETFs
  "SPY", "QQQ",
  // Sector ETFs
  "XLK", "XLF", "XLE", "XLV",
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

  console.log(`[price-fetch] Stored ${quotes.size} prices`);

  // Save daily snapshot for drawdown/Sharpe tracking
  try {
    await saveDailySnapshot(env);
  } catch (err) {
    console.error("[price-fetch] Daily snapshot failed:", err);
  }

  // ── INDEPENDENT safety net: stop-loss/take-profit/circuit breaker ──
  // This runs regardless of whether AI analysis succeeds
  console.log("[price-fetch] Running independent stop-loss/take-profit checks...");
  const stopActions = await checkStopLossAndTakeProfit(env);
  if (stopActions.length > 0) {
    console.log(`[price-fetch] Stop actions triggered: ${stopActions.join(" | ")}`);
  }

  // ── Check pending limit orders ──
  await checkPendingLimitOrders(env);
}

async function checkPendingLimitOrders(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date().toISOString();

  // Get all pending orders that haven't expired
  const pending = await db
    .select()
    .from(pendingOrders)
    .where(
      and(
        eq(pendingOrders.status, "pending"),
        gte(pendingOrders.expiresAt, now)
      )
    );

  if (pending.length === 0) return;

  console.log(`[price-fetch] Checking ${pending.length} pending limit orders...`);

  for (const order of pending) {
    const cached = await getCachedPrice(order.ticker, env);
    if (!cached) continue;

    const currentPrice = cached.price;
    let shouldExecute = false;

    // Buy limit order: execute if current price <= limit price
    if (order.action === "buy" && currentPrice <= order.limitPrice) {
      shouldExecute = true;
    }
    // Sell limit order: execute if current price >= limit price
    if (order.action === "sell" && currentPrice >= order.limitPrice) {
      shouldExecute = true;
    }

    if (shouldExecute) {
      console.log(`[price-fetch] Limit order triggered: ${order.action} ${order.shares} ${order.ticker} @ $${currentPrice} (limit: $${order.limitPrice})`);

      const result = await executeTrade(
        {
          action: order.action as "buy" | "sell",
          ticker: order.ticker,
          shares: order.shares,
          reason: order.reason || `Limit order filled at $${currentPrice} (limit: $${order.limitPrice})`,
        },
        env,
        "limit_order"
      );

      if (result.success) {
        await db
          .update(pendingOrders)
          .set({ status: "filled", filledAt: now })
          .where(eq(pendingOrders.id, order.id));

        await sendAlert(
          `LIMIT ORDER FILLED: ${order.action.toUpperCase()} ${order.shares} ${order.ticker} @ $${currentPrice} (limit: $${order.limitPrice})`,
          "info",
          env
        );
      }
    }
  }

  // Expire old orders
  const expiredOrders = await db
    .select()
    .from(pendingOrders)
    .where(
      and(
        eq(pendingOrders.status, "pending"),
        lte(pendingOrders.expiresAt, now)
      )
    );

  for (const order of expiredOrders) {
    await db
      .update(pendingOrders)
      .set({ status: "expired" })
      .where(eq(pendingOrders.id, order.id));
  }

  if (expiredOrders.length > 0) {
    console.log(`[price-fetch] Expired ${expiredOrders.length} limit orders`);
  }
}

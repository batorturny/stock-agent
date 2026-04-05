import { eq, and, lte, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { portfolio, prices, pendingOrders, investmentPlans } from "../db/schema";
import { fetchQuotes, updatePriceCache, getCachedPrice } from "../services/price-api";
import { checkStopLossAndTakeProfit, executeTrade, getAccountState } from "../services/portfolio";
import { saveDailySnapshot } from "../services/risk-manager";
import { sendAlert, HU_ALERTS } from "../services/alerter";
import { buildDynamicWatchlist, getCachedWatchlist } from "../services/stock-screener";
import type { Env } from "../types";
import { PORTFOLIO_RULES } from "../types";

export async function handlePriceFetch(env: Env): Promise<void> {
  // Always fetch — Finnhub returns last known price when market closed

  const db = drizzle(env.DB);

  // Get tickers from open positions
  const positions = await db
    .select({ ticker: portfolio.ticker })
    .from(portfolio)
    .where(eq(portfolio.status, "open"));

  const positionTickers = positions.map((p) => p.ticker);

  // Dynamic watchlist: rebuild every 4th run (~hourly), otherwise use cached
  const runCount = parseInt(await env.CACHE.get("price_fetch_count") || "0");
  await env.CACHE.put("price_fetch_count", String(runCount + 1), { expirationTtl: 3600 });

  let watchlist: string[];
  try {
    if (runCount % 4 === 0) {
      console.log("[price-fetch] Rebuilding dynamic watchlist...");
      watchlist = await buildDynamicWatchlist(env);
      console.log(`[price-fetch] Dynamic watchlist: ${watchlist.length} tickers`);
    } else {
      watchlist = await getCachedWatchlist(env);
      console.log(`[price-fetch] Using cached watchlist: ${watchlist.length} tickers`);
    }
  } catch (err) {
    console.error("[price-fetch] Watchlist fetch failed, using fallback:", err);
    // Fallback to a minimal static list if screener is unavailable
    watchlist = ["SPY", "QQQ", "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "JPM"];
  }

  // Combine with watchlist, deduplicate
  const allTickers = [...new Set([...positionTickers, ...watchlist])];

  console.log(`[price-fetch] Fetching ${allTickers.length} tickers (${positionTickers.length} positions + ${watchlist.length} watchlist)`);

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

  // ── Check realtime investment plans (price-target plans with realtime frequency) ──
  await checkRealtimeInvestmentPlans(env);

  // ── Check pending rotations (immediate reinvest after sell) ──
  await checkPendingRotation(env, watchlist);
}

/**
 * After a sell, check if there's a pending rotation and immediately
 * reinvest freed cash into the best watchlist pick.
 */
async function checkPendingRotation(env: Env, watchlist: string[]): Promise<void> {
  const raw = await env.CACHE.get("pending_rotation");
  if (!raw) return;

  const rotation = JSON.parse(raw) as {
    freedCash: number;
    fromTicker: string;
    timestamp: string;
  };

  // Clear immediately to prevent double-execution
  await env.CACHE.delete("pending_rotation");

  console.log(`[price-fetch] Pending rotation: $${rotation.freedCash.toFixed(2)} freed from ${rotation.fromTicker}`);

  const state = await getAccountState(env);
  const openTickers = new Set(state.positions.map((p) => p.ticker));

  // Find best candidate from watchlist that we don't already hold
  // Pick the first watchlist ticker we don't own (watchlist is ranked by screener)
  const candidates = watchlist.filter((t) => !openTickers.has(t) && t !== rotation.fromTicker);
  if (candidates.length === 0) {
    console.log("[price-fetch] Rotation: no eligible candidates in watchlist");
    return;
  }

  // Check position count limit
  if (state.positions.length >= PORTFOLIO_RULES.MAX_POSITIONS) {
    console.log("[price-fetch] Rotation: max positions reached, skipping");
    return;
  }

  // Try the top 3 candidates
  for (const ticker of candidates.slice(0, 3)) {
    const cached = await getCachedPrice(ticker, env);
    if (!cached) continue;

    const allocAmount = Math.min(
      rotation.freedCash * 0.9, // keep 10% buffer
      state.totalValue * PORTFOLIO_RULES.MAX_SINGLE_POSITION_PCT * 0.9
    );
    const shares = Math.floor(allocAmount / cached.price);
    if (shares <= 0) continue;

    console.log(`[price-fetch] Rotation buy: ${shares} ${ticker} @ $${cached.price.toFixed(2)}`);

    const result = await executeTrade(
      {
        action: "buy",
        ticker,
        shares,
        reason: `Rotation: reinvesting $${rotation.freedCash.toFixed(2)} freed from ${rotation.fromTicker} sell`,
      },
      env,
      "rotation"
    );

    if (result.success) {
      await sendAlert(
        HU_ALERTS.rotation(rotation.fromTicker, ticker, shares, cached.price.toFixed(2)),
        "info",
        env
      );
      return; // one rotation buy is enough
    }

    console.log(`[price-fetch] Rotation buy failed for ${ticker}: ${result.reason}`);
  }

  console.log("[price-fetch] Rotation: all candidates failed");
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
          HU_ALERTS.limitOrderFilled(order.action, order.shares, order.ticker, currentPrice.toFixed(2)),
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

/**
 * Check realtime investment plans — plans with check_frequency = 'realtime'
 * and target_type = 'price'. If target price is reached, execute sell and
 * mark plan as completed.
 */
async function checkRealtimeInvestmentPlans(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date().toISOString();

  // Get active plans with realtime check frequency
  const realtimePlans = await db
    .select()
    .from(investmentPlans)
    .where(
      and(
        eq(investmentPlans.status, "active"),
        eq(investmentPlans.checkFrequency, "realtime")
      )
    );

  if (realtimePlans.length === 0) return;

  console.log(`[price-fetch] Checking ${realtimePlans.length} realtime investment plans...`);

  for (const plan of realtimePlans) {
    if (plan.targetType !== "price" || !plan.targetPrice) continue;

    const cached = await getCachedPrice(plan.ticker, env);
    if (!cached) continue;

    const currentPrice = cached.price;

    if (currentPrice >= plan.targetPrice) {
      console.log(
        `[price-fetch] Plan target reached: ${plan.ticker} $${currentPrice.toFixed(2)} >= target $${plan.targetPrice}`
      );

      // Find open position to sell
      const positions = await db
        .select()
        .from(portfolio)
        .where(
          and(
            eq(portfolio.ticker, plan.ticker),
            eq(portfolio.status, "open")
          )
        );

      if (positions.length > 0) {
        const pos = positions[0];
        const result = await executeTrade(
          {
            action: "sell",
            ticker: plan.ticker,
            shares: pos.shares,
            reason: `Investment plan target reached: $${currentPrice.toFixed(2)} >= $${plan.targetPrice} target`,
          },
          env,
          "take_profit"
        );

        if (result.success) {
          await db
            .update(investmentPlans)
            .set({
              status: "completed",
              aiConviction: `Target $${plan.targetPrice} reached at $${currentPrice.toFixed(2)}. P&L: ${(((currentPrice - plan.entryPrice) / plan.entryPrice) * 100).toFixed(1)}%`,
              lastReviewed: now,
              updatedAt: now,
            })
            .where(eq(investmentPlans.id, plan.id));

          await sendAlert(
            `PLAN COMPLETED: ${plan.ticker} hit target $${plan.targetPrice} (entry $${plan.entryPrice}, P&L ${(((currentPrice - plan.entryPrice) / plan.entryPrice) * 100).toFixed(1)}%)`,
            "info",
            env
          );
        }
      }
    }
  }
}

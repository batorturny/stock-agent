import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { portfolio, trades, account } from "../db/schema";
import type { Env, PortfolioAction, AccountState, PortfolioPosition } from "../types";
import { PORTFOLIO_RULES } from "../types";
import { getCachedPrice, fetchQuote, updatePriceCache } from "./price-api";
import {
  addSlippage,
  checkSectorLimit,
  checkCircuitBreaker,
  checkDrawdownHalt,
  checkEarningsProximity,
} from "./risk-manager";
import { sendAlert, HU_ALERTS } from "./alerter";

// ─── Hold period helper ───

function getHoursHeld(boughtAt: string): number {
  const bought = new Date(boughtAt).getTime();
  const now = Date.now();
  return (now - bought) / (1000 * 60 * 60);
}

function isWithinHoldPeriod(boughtAt: string): boolean {
  return getHoursHeld(boughtAt) < PORTFOLIO_RULES.MIN_HOLD_HOURS;
}

// ─── Trade lock (KV-based mutex) ───

async function acquireTradeLock(env: Env): Promise<boolean> {
  const existing = await env.CACHE.get("trade_lock");
  if (existing) return false;
  await env.CACHE.put("trade_lock", "1", { expirationTtl: 60 });
  return true;
}

async function releaseTradeLock(env: Env): Promise<void> {
  await env.CACHE.delete("trade_lock");
}

function getDb(env: Env) {
  return drizzle(env.DB);
}

// ─── KV keys for take-profit trailing state ───
const TP_KEY_PREFIX = "tp_triggered:";

async function isTakeProfitTriggered(ticker: string, env: Env): Promise<boolean> {
  const val = await env.CACHE.get(`${TP_KEY_PREFIX}${ticker}`);
  return val === "true";
}

async function setTakeProfitTriggered(ticker: string, breakEvenPrice: number, env: Env): Promise<void> {
  await env.CACHE.put(
    `${TP_KEY_PREFIX}${ticker}`,
    "true",
    { expirationTtl: 86400 * 90 } // 90 days
  );
  // Store the break-even price as the new trailing stop
  await env.CACHE.put(
    `trailing_stop:${ticker}`,
    JSON.stringify(breakEvenPrice),
    { expirationTtl: 86400 * 90 }
  );
}

async function getTrailingStop(ticker: string, env: Env): Promise<number | null> {
  const val = await env.CACHE.get(`trailing_stop:${ticker}`);
  if (!val) return null;
  return JSON.parse(val) as number;
}

async function setTrailingStop(ticker: string, stopPrice: number, env: Env): Promise<void> {
  await env.CACHE.put(
    `trailing_stop:${ticker}`,
    JSON.stringify(stopPrice),
    { expirationTtl: 86400 * 90 }
  );
}

async function clearTakeProfitState(ticker: string, env: Env): Promise<void> {
  await env.CACHE.delete(`${TP_KEY_PREFIX}${ticker}`);
  await env.CACHE.delete(`trailing_stop:${ticker}`);
}

/**
 * Dynamic graduated trailing stop:
 * - After +5%: move stop to break-even (entry price)
 * - After +8%: move stop to +3%
 * - After +10%: move stop to +5%
 * The stop only moves UP, never down.
 */
async function updateDynamicTrailingStop(
  ticker: string,
  avgPrice: number,
  currentPrice: number,
  env: Env
): Promise<void> {
  const pnlPct = (currentPrice - avgPrice) / avgPrice;
  const currentStop = await getTrailingStop(ticker, env);

  let newStop: number | null = null;

  if (pnlPct >= 0.10) {
    // +10% gain: stop at +5% above entry
    newStop = Math.round(avgPrice * 1.05 * 100) / 100;
  } else if (pnlPct >= 0.08) {
    // +8% gain: stop at +3% above entry
    newStop = Math.round(avgPrice * 1.03 * 100) / 100;
  } else if (pnlPct >= 0.05) {
    // +5% gain: stop at break-even
    newStop = avgPrice;
  }

  if (newStop !== null) {
    // Only move stop UP, never down
    if (currentStop === null || newStop > currentStop) {
      await setTrailingStop(ticker, newStop, env);
      console.log(
        `[portfolio] Dynamic trailing stop: ${ticker} stop moved to $${newStop.toFixed(2)} (pnl: ${(pnlPct * 100).toFixed(1)}%)`
      );
    }
  }
}

// ─── Account State ───

export async function getAccountState(env: Env): Promise<AccountState> {
  const db = getDb(env);

  const [acct] = await db.select().from(account).limit(1);
  if (!acct) {
    const now = new Date().toISOString();
    await db.insert(account).values({
      cash: PORTFOLIO_RULES.INITIAL_CAPITAL,
      totalValue: PORTFOLIO_RULES.INITIAL_CAPITAL,
      updatedAt: now,
    });
    return {
      cash: PORTFOLIO_RULES.INITIAL_CAPITAL,
      totalValue: PORTFOLIO_RULES.INITIAL_CAPITAL,
      positions: [],
      dailyPnl: 0,
      dailyPnlPercent: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
    };
  }

  const positions = await db
    .select()
    .from(portfolio)
    .where(eq(portfolio.status, "open"));

  const enrichedPositions: PortfolioPosition[] = [];
  let totalPositionValue = 0;

  for (const pos of positions) {
    const cached = await getCachedPrice(pos.ticker, env);
    const currentPrice = cached?.price || pos.avgPrice;
    const pnl = (currentPrice - pos.avgPrice) * pos.shares;
    const pnlPercent = ((currentPrice - pos.avgPrice) / pos.avgPrice) * 100;
    totalPositionValue += currentPrice * pos.shares;

    enrichedPositions.push({
      id: pos.id,
      ticker: pos.ticker,
      shares: pos.shares,
      avgPrice: pos.avgPrice,
      boughtAt: pos.boughtAt,
      status: pos.status as "open",
      currentPrice,
      pnl: Math.round(pnl * 100) / 100,
      pnlPercent: Math.round(pnlPercent * 100) / 100,
    });
  }

  const totalValue = acct.cash + totalPositionValue;
  const totalPnl = totalValue - PORTFOLIO_RULES.INITIAL_CAPITAL;
  const totalPnlPercent = (totalPnl / PORTFOLIO_RULES.INITIAL_CAPITAL) * 100;

  await db
    .update(account)
    .set({ totalValue, updatedAt: new Date().toISOString() })
    .where(eq(account.id, acct.id));

  return {
    cash: acct.cash,
    totalValue: Math.round(totalValue * 100) / 100,
    positions: enrichedPositions,
    dailyPnl: 0,
    dailyPnlPercent: 0,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalPnlPercent: Math.round(totalPnlPercent * 100) / 100,
  };
}

// ─── Execute Trade ───

export async function executeTrade(
  action: PortfolioAction,
  env: Env,
  triggerType: string = "ai_pick"
): Promise<{ success: boolean; reason: string }> {
  // Acquire trade lock to prevent concurrent execution
  const lockAcquired = await acquireTradeLock(env);
  if (!lockAcquired) {
    return { success: false, reason: "Trade lock held — another trade in progress" };
  }

  try {
    return await executeTradeInner(action, env, triggerType);
  } finally {
    await releaseTradeLock(env);
  }
}

async function executeTradeInner(
  action: PortfolioAction,
  env: Env,
  triggerType: string
): Promise<{ success: boolean; reason: string }> {
  const db = getDb(env);
  const [acct] = await db.select().from(account).limit(1);
  if (!acct) return { success: false, reason: "No account found" };

  let cached = await getCachedPrice(action.ticker, env);
  if (!cached) {
    const quote = await fetchQuote(action.ticker, env);
    if (!quote) return { success: false, reason: `No price data for ${action.ticker}` };
    await updatePriceCache(action.ticker, quote, env);
    cached = { price: quote.c, change: quote.d, changePercent: quote.dp, updatedAt: new Date().toISOString() };
  }

  // Apply slippage to price
  const rawPrice = cached.price;
  const price = addSlippage(rawPrice, action.action === "buy" ? "buy" : "sell");
  const total = price * action.shares;
  const now = new Date().toISOString();
  const preCash = acct.cash;

  if (action.action === "buy") {
    // ── Risk checks before any buy ──
    const drawdownCheck = await checkDrawdownHalt(env);
    if (drawdownCheck.halted) {
      await sendAlert(HU_ALERTS.drawdownHalt(drawdownCheck.drawdownPct.toFixed(1)), "warning", env);
      return { success: false, reason: `Drawdown halt: portfolio down ${drawdownCheck.drawdownPct}%` };
    }

    const circuitCheck = await checkCircuitBreaker(action.ticker, rawPrice, env);
    if (circuitCheck.triggered) {
      await sendAlert(HU_ALERTS.circuitBreaker(action.ticker, "N/A"), "warning", env);
      return { success: false, reason: circuitCheck.reason };
    }

    const earningsCheck = await checkEarningsProximity(action.ticker, env);
    if (earningsCheck.nearEarnings) {
      await sendAlert(`⚠️ VÉTEL blokkolva: ${action.ticker} — earnings ${earningsCheck.daysUntil} napon belül`, "info", env);
      return { success: false, reason: `Earnings in ${earningsCheck.daysUntil} day(s) — buying blocked` };
    }

    const state = await getAccountState(env);
    const sectorCheck = checkSectorLimit(action.ticker, state.positions, state.totalValue, total);
    if (!sectorCheck.allowed) {
      return { success: false, reason: sectorCheck.reason };
    }

    // ── Standard position checks ──
    if (total > acct.cash) {
      return { success: false, reason: "Insufficient cash" };
    }

    const minCash = acct.totalValue * PORTFOLIO_RULES.MIN_CASH_RESERVE_PCT;
    if (acct.cash - total < minCash) {
      return { success: false, reason: `Would violate ${PORTFOLIO_RULES.MIN_CASH_RESERVE_PCT * 100}% cash reserve rule` };
    }

    const maxPositionValue = acct.totalValue * PORTFOLIO_RULES.MAX_SINGLE_POSITION_PCT;
    // Check existing position value + new buy
    const existingPos = await db
      .select()
      .from(portfolio)
      .where(and(eq(portfolio.ticker, action.ticker), eq(portfolio.status, "open")));

    const existingValue = existingPos.length > 0
      ? existingPos[0].shares * price
      : 0;

    if (existingValue + total > maxPositionValue) {
      return { success: false, reason: "Would exceed 20% single position limit" };
    }

    const openPositions = await db
      .select()
      .from(portfolio)
      .where(eq(portfolio.status, "open"));

    if (openPositions.length >= PORTFOLIO_RULES.MAX_POSITIONS && !existingPos.length) {
      return { success: false, reason: "Max 10 positions reached" };
    }

    // Check if we already have this ticker
    const existing = openPositions.find((p) => p.ticker === action.ticker);
    if (existing) {
      const newShares = existing.shares + action.shares;
      const newAvg =
        (existing.avgPrice * existing.shares + price * action.shares) / newShares;
      await db
        .update(portfolio)
        .set({ shares: newShares, avgPrice: newAvg })
        .where(eq(portfolio.id, existing.id));
    } else {
      await db.insert(portfolio).values({
        ticker: action.ticker,
        shares: action.shares,
        avgPrice: price,
        boughtAt: now,
        status: "open",
      });
    }

    // Deduct cash
    const newCash = acct.cash - total;
    await db
      .update(account)
      .set({ cash: newCash, updatedAt: now })
      .where(eq(account.id, acct.id));

    // Record trade with triggerType, preCash, postCash
    await db.insert(trades).values({
      ticker: action.ticker,
      action: "buy",
      shares: action.shares,
      price,
      total,
      reason: action.reason,
      triggerType,
      preCash,
      postCash: newCash,
      executedAt: now,
    });

    // Send Hungarian alert
    await sendAlert(
      HU_ALERTS.buy(action.shares, action.ticker, price.toFixed(2), action.reason.slice(0, 100)),
      "info",
      env
    );

    console.log(`[portfolio] BUY ${action.shares} ${action.ticker} @ $${price.toFixed(2)} (slippage from $${rawPrice.toFixed(2)}) | cash: $${newCash.toFixed(2)} | trigger: ${triggerType}`);

    // NOTE: autoInvestExcessCash removed from here — it caused silent failures
    // because executeTrade holds the trade lock and autoInvest calls executeTrade
    // recursively (lock re-entry fails). Called from daily-analysis.ts instead.

    return { success: true, reason: `Bought ${action.shares} ${action.ticker} @ $${price.toFixed(2)}` };
  }

  if (action.action === "sell") {
    const [position] = await db
      .select()
      .from(portfolio)
      .where(
        and(
          eq(portfolio.ticker, action.ticker),
          eq(portfolio.status, "open")
        )
      );

    if (!position) {
      return { success: false, reason: `No open position for ${action.ticker}` };
    }

    // ── Minimum hold period check for non-emergency sells ──
    // Stop-loss, circuit breaker, and trailing stop ALWAYS execute regardless.
    // News reactive sells only if impact > 7 during hold period.
    const emergencyTriggers = new Set(["stop_loss", "circuit_breaker", "trailing_stop"]);
    if (isWithinHoldPeriod(position.boughtAt) && !emergencyTriggers.has(triggerType)) {
      // For news reactive sells during hold period, only allow if reason suggests very high impact
      if (triggerType === "news_reactive") {
        // Impact is encoded in the reason string; we rely on the caller (newsReactiveSell) to gate this
        // If it reached here with news_reactive during hold period, it passed the impact > 7 check
      } else {
        const hoursLeft = PORTFOLIO_RULES.MIN_HOLD_HOURS - getHoursHeld(position.boughtAt);
        await sendAlert(HU_ALERTS.holdPeriod(action.ticker, hoursLeft), "info", env);
        return {
          success: false,
          reason: `Minimum hold period not reached (72h). ${Math.ceil(hoursLeft)}h remaining.`,
        };
      }
    }

    const sellShares = Math.min(action.shares, position.shares);
    const sellTotal = sellShares * price;

    if (sellShares >= position.shares) {
      // Close entire position
      await db
        .update(portfolio)
        .set({
          status: "closed",
          closePrice: price,
          closeReason: "manual",
          closedAt: now,
        })
        .where(eq(portfolio.id, position.id));
      // Clean up trailing stop state
      await clearTakeProfitState(action.ticker, env);
    } else {
      // Partial sell
      await db
        .update(portfolio)
        .set({ shares: position.shares - sellShares })
        .where(eq(portfolio.id, position.id));
    }

    // Add cash
    const newCash = acct.cash + sellTotal;
    await db
      .update(account)
      .set({ cash: newCash, updatedAt: now })
      .where(eq(account.id, acct.id));

    // Record trade with triggerType, preCash, postCash
    await db.insert(trades).values({
      ticker: action.ticker,
      action: "sell",
      shares: sellShares,
      price,
      total: sellTotal,
      reason: action.reason,
      triggerType,
      preCash,
      postCash: newCash,
      executedAt: now,
    });

    // Send Hungarian alert
    await sendAlert(
      HU_ALERTS.sell(sellShares, action.ticker, price.toFixed(2), action.reason.slice(0, 100)),
      "info",
      env
    );

    console.log(`[portfolio] SELL ${sellShares} ${action.ticker} @ $${price.toFixed(2)} (slippage from $${rawPrice.toFixed(2)}) | cash: $${newCash.toFixed(2)} | trigger: ${triggerType}`);

    // ROTATION: flag for immediate reinvestment via price-fetch cycle
    // Instead of calling autoInvestExcessCash (which can cause recursion),
    // we store the freed cash info in KV for the next price-fetch to pick up.
    if (sellShares >= position.shares) {
      // Full position closed — flag rotation
      await env.CACHE.put(
        "pending_rotation",
        JSON.stringify({
          freedCash: sellTotal,
          fromTicker: action.ticker,
          timestamp: now,
        }),
        { expirationTtl: 300 }
      );
      console.log(`[portfolio] Rotation flagged: $${sellTotal.toFixed(2)} freed from ${action.ticker}`);
    } else {
      // Partial sell — auto-invest handled externally (not here due to trade lock)
      console.log(`[portfolio] Partial sell of ${action.ticker} — auto-invest deferred to caller`);
    }

    return { success: true, reason: `Sold ${sellShares} ${action.ticker} @ $${price.toFixed(2)}` };
  }

  return { success: true, reason: "Hold — no action taken" };
}

// ─── Stop Loss & Take Profit (INDEPENDENT — works even if AI is down) ───

export async function checkStopLossAndTakeProfit(env: Env): Promise<string[]> {
  const db = getDb(env);
  const actions: string[] = [];

  const positions = await db
    .select()
    .from(portfolio)
    .where(eq(portfolio.status, "open"));

  for (const pos of positions) {
    const cached = await getCachedPrice(pos.ticker, env);
    if (!cached) continue;

    const pnlPercent = (cached.price - pos.avgPrice) / pos.avgPrice;
    const tpTriggered = await isTakeProfitTriggered(pos.ticker, env);

    // ── Circuit breaker: single-stock crash — sell immediately ──
    const circuitCheck = await checkCircuitBreaker(pos.ticker, cached.price, env);
    if (circuitCheck.triggered) {
      console.log(`[portfolio] CIRCUIT BREAKER: ${pos.ticker} — ${circuitCheck.reason}`);
      const result = await executeTrade(
        {
          action: "sell",
          ticker: pos.ticker,
          shares: pos.shares,
          reason: circuitCheck.reason,
        },
        env,
        "circuit_breaker"
      );
      if (result.success) {
        await db.update(portfolio).set({ closeReason: "stop_loss" }).where(eq(portfolio.id, pos.id));
        actions.push(`CIRCUIT-BREAKER: ${pos.ticker} sold — ${circuitCheck.reason}`);
        await sendAlert(
          HU_ALERTS.circuitBreaker(pos.ticker, (cached.changePercent ?? 0).toFixed(1)),
          "critical",
          env
        );
      }
      continue;
    }

    // ── Dynamic graduated trailing stop (independent of take-profit) ──
    // Updates trailing stop based on current gain level
    await updateDynamicTrailingStop(pos.ticker, pos.avgPrice, cached.price, env);

    // ── Check trailing stop (fires for both take-profit and dynamic trailing) ──
    const trailingStop = await getTrailingStop(pos.ticker, env);
    if (trailingStop && cached.price <= trailingStop) {
      const stopSource = tpTriggered ? "take-profit trailing" : "dynamic trailing";
      const result = await executeTrade(
        {
          action: "sell",
          ticker: pos.ticker,
          shares: pos.shares,
          reason: `${stopSource} stop hit at $${cached.price.toFixed(2)} (stop: $${trailingStop.toFixed(2)})`,
        },
        env,
        "trailing_stop"
      );
      if (result.success) {
        await db.update(portfolio).set({ closeReason: "stop_loss" }).where(eq(portfolio.id, pos.id));
        actions.push(`TRAILING-STOP: ${pos.ticker} sold at $${cached.price.toFixed(2)} (${stopSource} stop: $${trailingStop.toFixed(2)})`);
      }
      continue;
    }

    // ── Stop-loss: -5% — ALWAYS fires regardless of hold period ──
    if (pnlPercent <= PORTFOLIO_RULES.STOP_LOSS_PCT) {
      const result = await executeTrade(
        {
          action: "sell",
          ticker: pos.ticker,
          shares: pos.shares,
          reason: `Stop-loss triggered at ${(pnlPercent * 100).toFixed(1)}%`,
        },
        env,
        "stop_loss"
      );
      if (result.success) {
        await db.update(portfolio).set({ closeReason: "stop_loss" }).where(eq(portfolio.id, pos.id));
        actions.push(`STOP-LOSS: ${pos.ticker} at ${(pnlPercent * 100).toFixed(1)}%`);
        await sendAlert(
          HU_ALERTS.stopLoss(pos.ticker, `${(pnlPercent * 100).toFixed(1)}%`),
          "warning",
          env
        );
      }
      continue;
    }

    // ── Take-profit: +12% — sell 50%, move stop to break-even ──
    // Skip take-profit if position is within minimum hold period
    if (!tpTriggered && pnlPercent >= PORTFOLIO_RULES.TAKE_PROFIT_PCT) {
      if (isWithinHoldPeriod(pos.boughtAt)) {
        const hoursLeft = PORTFOLIO_RULES.MIN_HOLD_HOURS - getHoursHeld(pos.boughtAt);
        console.log(`[portfolio] TAKE-PROFIT skipped for ${pos.ticker}: within ${PORTFOLIO_RULES.MIN_HOLD_HOURS}h hold period (${Math.ceil(hoursLeft)}h left)`);
        await sendAlert(
          HU_ALERTS.holdPeriod(pos.ticker, hoursLeft),
          "info",
          env
        );
        continue;
      }

      const halfShares = Math.floor(pos.shares / 2);
      if (halfShares > 0) {
        const result = await executeTrade(
          {
            action: "sell",
            ticker: pos.ticker,
            shares: halfShares,
            reason: `Take-profit: sold 50% at ${(pnlPercent * 100).toFixed(1)}%, trailing stop set at break-even`,
          },
          env,
          "take_profit"
        );
        if (result.success) {
          await setTakeProfitTriggered(pos.ticker, pos.avgPrice, env);
          actions.push(`TAKE-PROFIT: ${pos.ticker} half sold at ${(pnlPercent * 100).toFixed(1)}%, trailing at $${pos.avgPrice.toFixed(2)}`);
          await sendAlert(
            HU_ALERTS.takeProfit(pos.ticker, `${(pnlPercent * 100).toFixed(1)}%`),
            "info",
            env
          );
        }
      }
    }
  }

  return actions;
}

// ─── News Reactive Sell ───

export async function newsReactiveSell(
  ticker: string,
  sentiment: number,
  impact: number,
  env: Env
): Promise<{ sold: boolean; reason: string }> {
  if (impact <= PORTFOLIO_RULES.NEWS_SELL_IMPACT_THRESHOLD) {
    return { sold: false, reason: `Impact ${impact} below threshold ${PORTFOLIO_RULES.NEWS_SELL_IMPACT_THRESHOLD}` };
  }
  if (sentiment >= PORTFOLIO_RULES.NEWS_SELL_SENTIMENT_THRESHOLD) {
    return { sold: false, reason: `Sentiment ${sentiment} above threshold ${PORTFOLIO_RULES.NEWS_SELL_SENTIMENT_THRESHOLD}` };
  }

  const db = getDb(env);
  const [position] = await db
    .select()
    .from(portfolio)
    .where(
      and(
        eq(portfolio.ticker, ticker),
        eq(portfolio.status, "open")
      )
    );

  if (!position) {
    return { sold: false, reason: `No open position for ${ticker}` };
  }

  // ── Hold period gate for news reactive sells ──
  // During hold period, only sell if impact is very high (> 7)
  if (isWithinHoldPeriod(position.boughtAt) && impact <= 7) {
    const hoursLeft = PORTFOLIO_RULES.MIN_HOLD_HOURS - getHoursHeld(position.boughtAt);
    await sendAlert(
      `📰 ${ticker}: negatív hír (impact=${impact}) de tartási időn belül (${Math.ceil(hoursLeft)}h hátra). Csak impact > 7 esetén adunk el.`,
      "info",
      env
    );
    return {
      sold: false,
      reason: `Within hold period (${Math.ceil(hoursLeft)}h left). Impact ${impact} <= 7 threshold for hold-period override.`,
    };
  }

  console.log(`[portfolio] NEWS REACTIVE SELL: ${ticker} | sentiment=${sentiment} impact=${impact}`);

  const result = await executeTrade(
    {
      action: "sell",
      ticker,
      shares: position.shares,
      reason: `News reactive sell: impact=${impact}, sentiment=${sentiment.toFixed(2)}`,
    },
    env,
    "news_reactive"
  );

  if (result.success) {
    await db
      .update(portfolio)
      .set({ closeReason: "stop_loss" })
      .where(eq(portfolio.id, position.id));
    await sendAlert(
      HU_ALERTS.sell(position.shares, ticker, "market", `Hír miatti eladás — impact=${impact}, sentiment=${sentiment.toFixed(2)}`),
      "critical",
      env
    );
    return { sold: true, reason: result.reason };
  }

  return { sold: false, reason: result.reason };
}

// ─── Rebalance Portfolio ───

export async function rebalancePortfolio(env: Env): Promise<string[]> {
  const actions: string[] = [];
  const state = await getAccountState(env);

  // 1. Check if any position exceeds 20% of total value → trim
  for (const pos of state.positions) {
    const posValue = (pos.currentPrice ?? pos.avgPrice) * pos.shares;
    const posPct = posValue / state.totalValue;

    if (posPct > PORTFOLIO_RULES.MAX_SINGLE_POSITION_PCT + 0.02) {
      // Trim to 18% to leave room
      const targetValue = state.totalValue * 0.18;
      const excessValue = posValue - targetValue;
      const sharesToSell = Math.floor(excessValue / (pos.currentPrice ?? pos.avgPrice));

      if (sharesToSell > 0) {
        const result = await executeTrade(
          {
            action: "sell",
            ticker: pos.ticker,
            shares: sharesToSell,
            reason: `Rebalance: position at ${(posPct * 100).toFixed(1)}%, trimming to ~18%`,
          },
          env,
          "rebalance"
        );
        if (result.success) {
          actions.push(`REBALANCE-TRIM: ${pos.ticker} sold ${sharesToSell} shares (was ${(posPct * 100).toFixed(1)}%)`);
        }
      }
    }
  }

  // 2. Ensure min 85% invested
  const refreshedState = await getAccountState(env);
  const cashPct = refreshedState.cash / refreshedState.totalValue;

  if (cashPct > PORTFOLIO_RULES.MAX_CASH_PCT) {
    actions.push(`REBALANCE: Cash at ${(cashPct * 100).toFixed(1)}% — exceeds ${PORTFOLIO_RULES.MAX_CASH_PCT * 100}% max. Running auto-invest.`);
    await sendAlert(
      HU_ALERTS.highCash((cashPct * 100).toFixed(1)),
      "warning",
      env
    );
    await autoInvestExcessCash(env);
  }

  console.log(`[portfolio] Rebalance complete: ${actions.length} actions`);
  return actions;
}

// ─── Auto-Invest Excess Cash ───

/**
 * If cash > 15% of total value, invest the excess into existing positions
 * that are under 20% allocation, proportionally.
 * This is called after every trade to stay always-invested.
 */
export async function autoInvestExcessCash(env: Env): Promise<void> {
  const state = await getAccountState(env);
  const cashPct = state.cash / state.totalValue;

  if (cashPct <= PORTFOLIO_RULES.MAX_CASH_PCT) return;
  if (state.positions.length === 0) return; // no positions to add to

  const excessCash = state.cash - state.totalValue * PORTFOLIO_RULES.MIN_CASH_RESERVE_PCT;
  if (excessCash <= 10) return; // not worth it

  console.log(`[portfolio] Auto-invest: cash at ${(cashPct * 100).toFixed(1)}%, excess $${excessCash.toFixed(2)}`);

  // Find positions under 20% that can absorb more
  const eligiblePositions = state.positions.filter((pos) => {
    const posValue = (pos.currentPrice ?? pos.avgPrice) * pos.shares;
    const posPct = posValue / state.totalValue;
    return posPct < PORTFOLIO_RULES.MAX_SINGLE_POSITION_PCT - 0.02; // under 18%
  });

  if (eligiblePositions.length === 0) return;

  // Split excess cash equally among eligible positions
  const perPosition = excessCash / eligiblePositions.length;

  for (const pos of eligiblePositions) {
    const price = pos.currentPrice ?? pos.avgPrice;
    const shares = Math.floor(perPosition / price);
    if (shares <= 0) continue;

    // Re-check cash after each buy (state changes)
    const currentAcct = await getAccountState(env);
    const currentCashPct = currentAcct.cash / currentAcct.totalValue;
    if (currentCashPct <= PORTFOLIO_RULES.MAX_CASH_PCT) break;

    await executeTrade(
      {
        action: "buy",
        ticker: pos.ticker,
        shares,
        reason: `Auto-invest: deploying excess cash (${(currentCashPct * 100).toFixed(1)}% > ${PORTFOLIO_RULES.MAX_CASH_PCT * 100}% max)`,
      },
      env,
      "auto_invest"
    );
  }
}

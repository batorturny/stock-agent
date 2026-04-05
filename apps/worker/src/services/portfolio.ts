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
import { sendAlert } from "./alerter";

// ─── Trade lock (KV-based mutex) ───

async function acquireTradeLock(env: Env): Promise<boolean> {
  const existing = await env.CACHE.get("trade_lock");
  if (existing) return false;
  await env.CACHE.put("trade_lock", "1", { expirationTtl: 30 });
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

async function clearTakeProfitState(ticker: string, env: Env): Promise<void> {
  await env.CACHE.delete(`${TP_KEY_PREFIX}${ticker}`);
  await env.CACHE.delete(`trailing_stop:${ticker}`);
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
      await sendAlert(`BUY blocked for ${action.ticker}: drawdown halt at ${drawdownCheck.drawdownPct}%`, "warning", env);
      return { success: false, reason: `Drawdown halt: portfolio down ${drawdownCheck.drawdownPct}%` };
    }

    const circuitCheck = await checkCircuitBreaker(action.ticker, rawPrice, env);
    if (circuitCheck.triggered) {
      await sendAlert(`BUY blocked for ${action.ticker}: ${circuitCheck.reason}`, "warning", env);
      return { success: false, reason: circuitCheck.reason };
    }

    const earningsCheck = await checkEarningsProximity(action.ticker, env);
    if (earningsCheck.nearEarnings) {
      await sendAlert(`BUY blocked for ${action.ticker}: earnings in ${earningsCheck.daysUntil} day(s)`, "info", env);
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

    console.log(`[portfolio] BUY ${action.shares} ${action.ticker} @ $${price.toFixed(2)} (slippage from $${rawPrice.toFixed(2)}) | cash: $${newCash.toFixed(2)} | trigger: ${triggerType}`);

    // After buy: auto-invest remaining cash if needed
    await autoInvestExcessCash(env);

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

    console.log(`[portfolio] SELL ${sellShares} ${action.ticker} @ $${price.toFixed(2)} (slippage from $${rawPrice.toFixed(2)}) | cash: $${newCash.toFixed(2)} | trigger: ${triggerType}`);

    // After sell: auto-invest the freed cash
    await autoInvestExcessCash(env);

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
        await sendAlert(`CIRCUIT BREAKER SELL: ${pos.ticker} @ $${cached.price.toFixed(2)} — ${circuitCheck.reason}`, "critical", env);
      }
      continue;
    }

    // ── Trailing stop after take-profit ──
    if (tpTriggered) {
      const trailingStop = await getTrailingStop(pos.ticker, env);
      if (trailingStop && cached.price <= trailingStop) {
        const result = await executeTrade(
          {
            action: "sell",
            ticker: pos.ticker,
            shares: pos.shares,
            reason: `Trailing stop hit at $${cached.price.toFixed(2)} (stop: $${trailingStop.toFixed(2)})`,
          },
          env,
          "trailing_stop"
        );
        if (result.success) {
          await db.update(portfolio).set({ closeReason: "stop_loss" }).where(eq(portfolio.id, pos.id));
          actions.push(`TRAILING-STOP: ${pos.ticker} sold at $${cached.price.toFixed(2)}`);
          await sendAlert(`TRAILING STOP: ${pos.ticker} sold at $${cached.price.toFixed(2)} (stop: $${trailingStop.toFixed(2)})`, "warning", env);
        }
        continue;
      }
    }

    // ── Stop-loss: -5% ──
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
        await sendAlert(`STOP-LOSS: ${pos.ticker} sold at ${(pnlPercent * 100).toFixed(1)}% loss`, "warning", env);
      }
      continue;
    }

    // ── Take-profit: +12% — sell 50%, move stop to break-even ──
    if (!tpTriggered && pnlPercent >= PORTFOLIO_RULES.TAKE_PROFIT_PCT) {
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
          await sendAlert(`TAKE-PROFIT: ${pos.ticker} +${(pnlPercent * 100).toFixed(1)}% — sold 50%, trailing at $${pos.avgPrice.toFixed(2)}`, "info", env);
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
    await sendAlert(`NEWS REACTIVE SELL: ${ticker} — impact=${impact}, sentiment=${sentiment.toFixed(2)}`, "critical", env);
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
    actions.push(`REBALANCE: Cash at ${(cashPct * 100).toFixed(1)}% — exceeds ${PORTFOLIO_RULES.MAX_CASH_PCT * 100}% max. Auto-invest needed.`);
    // Auto-invest is handled by autoInvestExcessCash or daily-analysis
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
async function autoInvestExcessCash(env: Env): Promise<void> {
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

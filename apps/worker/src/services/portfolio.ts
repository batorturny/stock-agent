import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { portfolio, trades, account } from "../db/schema";
import type { Env, PortfolioAction, AccountState, PortfolioPosition } from "../types";
import { PORTFOLIO_RULES } from "../types";
import { getCachedPrice } from "./price-api";

function getDb(env: Env) {
  return drizzle(env.DB);
}

export async function getAccountState(env: Env): Promise<AccountState> {
  const db = getDb(env);

  const [acct] = await db.select().from(account).limit(1);
  if (!acct) {
    // Initialize account
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
  const totalPnlPercent =
    (totalPnl / PORTFOLIO_RULES.INITIAL_CAPITAL) * 100;

  // Update account total value
  await db
    .update(account)
    .set({ totalValue, updatedAt: new Date().toISOString() })
    .where(eq(account.id, acct.id));

  return {
    cash: acct.cash,
    totalValue: Math.round(totalValue * 100) / 100,
    positions: enrichedPositions,
    dailyPnl: 0, // calculated from price history
    dailyPnlPercent: 0,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalPnlPercent: Math.round(totalPnlPercent * 100) / 100,
  };
}

export async function executeTrade(
  action: PortfolioAction,
  env: Env
): Promise<{ success: boolean; reason: string }> {
  const db = getDb(env);
  const [acct] = await db.select().from(account).limit(1);
  if (!acct) return { success: false, reason: "No account found" };

  const cached = await getCachedPrice(action.ticker, env);
  if (!cached) return { success: false, reason: `No price data for ${action.ticker}` };

  const price = cached.price;
  const total = price * action.shares;
  const now = new Date().toISOString();

  if (action.action === "buy") {
    // Validate rules
    if (total > acct.cash) {
      return { success: false, reason: "Insufficient cash" };
    }

    const minCash = acct.totalValue * PORTFOLIO_RULES.MIN_CASH_RESERVE_PCT;
    if (acct.cash - total < minCash) {
      return { success: false, reason: "Would violate 10% cash reserve rule" };
    }

    const maxPositionValue =
      acct.totalValue * PORTFOLIO_RULES.MAX_SINGLE_POSITION_PCT;
    if (total > maxPositionValue) {
      return { success: false, reason: "Would exceed 20% single position limit" };
    }

    const openPositions = await db
      .select()
      .from(portfolio)
      .where(eq(portfolio.status, "open"));

    if (openPositions.length >= PORTFOLIO_RULES.MAX_POSITIONS) {
      return { success: false, reason: "Max 10 positions reached" };
    }

    // Check if we already have this ticker
    const existing = openPositions.find((p) => p.ticker === action.ticker);
    if (existing) {
      // Average up/down
      const newShares = existing.shares + action.shares;
      const newAvg =
        (existing.avgPrice * existing.shares + price * action.shares) /
        newShares;
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
    await db
      .update(account)
      .set({ cash: acct.cash - total, updatedAt: now })
      .where(eq(account.id, acct.id));

    // Record trade
    await db.insert(trades).values({
      ticker: action.ticker,
      action: "buy",
      shares: action.shares,
      price,
      total,
      reason: action.reason,
      executedAt: now,
    });

    return { success: true, reason: `Bought ${action.shares} ${action.ticker} @ $${price}` };
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
    } else {
      // Partial sell
      await db
        .update(portfolio)
        .set({ shares: position.shares - sellShares })
        .where(eq(portfolio.id, position.id));
    }

    // Add cash
    await db
      .update(account)
      .set({ cash: acct.cash + sellTotal, updatedAt: now })
      .where(eq(account.id, acct.id));

    // Record trade
    await db.insert(trades).values({
      ticker: action.ticker,
      action: "sell",
      shares: sellShares,
      price,
      total: sellTotal,
      reason: action.reason,
      executedAt: now,
    });

    return { success: true, reason: `Sold ${sellShares} ${action.ticker} @ $${price}` };
  }

  return { success: true, reason: "Hold — no action taken" };
}

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

    // Stop-loss: -8%
    if (pnlPercent <= PORTFOLIO_RULES.STOP_LOSS_PCT) {
      const result = await executeTrade(
        {
          action: "sell",
          ticker: pos.ticker,
          shares: pos.shares,
          reason: `Stop-loss triggered at ${(pnlPercent * 100).toFixed(1)}%`,
        },
        env
      );
      if (result.success) {
        // Update close reason
        await db
          .update(portfolio)
          .set({ closeReason: "stop_loss" })
          .where(eq(portfolio.id, pos.id));
        actions.push(`STOP-LOSS: ${pos.ticker} at ${(pnlPercent * 100).toFixed(1)}%`);
      }
    }

    // Take-profit: +15% — sell half
    if (pnlPercent >= PORTFOLIO_RULES.TAKE_PROFIT_PCT) {
      const halfShares = Math.floor(pos.shares / 2);
      if (halfShares > 0) {
        const result = await executeTrade(
          {
            action: "sell",
            ticker: pos.ticker,
            shares: halfShares,
            reason: `Take-profit triggered at ${(pnlPercent * 100).toFixed(1)}%`,
          },
          env
        );
        if (result.success) {
          actions.push(`TAKE-PROFIT: ${pos.ticker} half sold at ${(pnlPercent * 100).toFixed(1)}%`);
        }
      }
    }
  }

  return actions;
}

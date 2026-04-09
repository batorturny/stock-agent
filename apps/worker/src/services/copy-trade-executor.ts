// Executes pending copy trades via Alpaca when the delay has elapsed
// Called from the cron handler

import { drizzle } from "drizzle-orm/d1";
import { eq, lte, and } from "drizzle-orm";
import { copyTradeQueue, account } from "../db/schema";
import type { Env } from "../types";
import { isAlpacaConfigured, buyWithTrailingStop } from "./alpaca-client";
import { getCachedPrice } from "./price-api";

// Trailing stop % to apply on all copy trades
const COPY_TRADE_TRAIL_PCT = 5; // 5% trailing stop

export async function executePendingCopyTrades(env: Env): Promise<string[]> {
  if (!isAlpacaConfigured(env)) {
    return ["Alpaca not configured — copy trades skipped"];
  }

  const db = drizzle(env.DB);
  const now = new Date().toISOString();
  const logs: string[] = [];

  // Find all pending copy trades whose delay has elapsed
  const pending = await db
    .select()
    .from(copyTradeQueue)
    .where(
      and(
        eq(copyTradeQueue.status, "pending"),
        lte(copyTradeQueue.executeAfter, now)
      )
    );

  if (pending.length === 0) {
    return ["No pending copy trades ready for execution"];
  }

  // Get current account to compute position sizes
  const [acct] = await db.select().from(account).limit(1);
  if (!acct) return ["No account found — copy trades skipped"];

  for (const trade of pending) {
    try {
      // Resolve qty: trade.qty stored as positionSizePct fraction (e.g. 0.05 = 5%)
      const positionSizePct = trade.qty; // 0.01–0.10
      const targetValue = acct.totalValue * positionSizePct;

      // Get current price
      const cached = await getCachedPrice(trade.symbol, env);
      if (!cached || cached.price <= 0) {
        logs.push(`[CopyTrade] ${trade.symbol}: no price data, skipping`);
        await db
          .update(copyTradeQueue)
          .set({ status: "failed", executedAt: now })
          .where(eq(copyTradeQueue.id, trade.id));
        continue;
      }

      const qty = Math.floor(targetValue / cached.price);
      if (qty < 1) {
        logs.push(`[CopyTrade] ${trade.symbol}: qty < 1 (${targetValue.toFixed(0)}/${cached.price.toFixed(2)}), skipping`);
        await db
          .update(copyTradeQueue)
          .set({ status: "cancelled", executedAt: now })
          .where(eq(copyTradeQueue.id, trade.id));
        continue;
      }

      // Execute via Alpaca with trailing stop
      const { buyOrder, stopOrder, error } = await buyWithTrailingStop(
        trade.symbol,
        qty,
        COPY_TRADE_TRAIL_PCT,
        env
      );

      if (error || !buyOrder) {
        logs.push(`[CopyTrade] ${trade.symbol}: Alpaca error — ${error}`);
        await db
          .update(copyTradeQueue)
          .set({ status: "failed", executedAt: now })
          .where(eq(copyTradeQueue.id, trade.id));
        continue;
      }

      // Mark as executed
      await db
        .update(copyTradeQueue)
        .set({
          status: "executed",
          alpacaOrderId: buyOrder.id,
          executedAt: now,
        })
        .where(eq(copyTradeQueue.id, trade.id));

      logs.push(
        `[CopyTrade] ${trade.symbol}: bought ${qty} shares @ ~$${cached.price.toFixed(2)} ` +
        `(copy of ${trade.politicianName}) — Alpaca order ${buyOrder.id}` +
        (stopOrder ? ` + trailing stop ${COPY_TRADE_TRAIL_PCT}%` : "")
      );
    } catch (err) {
      logs.push(`[CopyTrade] ${trade.symbol}: unexpected error — ${String(err)}`);
      await db
        .update(copyTradeQueue)
        .set({ status: "failed", executedAt: now })
        .where(eq(copyTradeQueue.id, trade.id));
    }
  }

  return logs;
}

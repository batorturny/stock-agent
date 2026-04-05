import { desc, gte, not, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { news, prices, analysis, predictions, trades, investmentPlans } from "../db/schema";
import { runDailyAnalysis, doubleCheckAnalysis, generateInvestmentPlan } from "../services/ai-analyst";
import { getAccountState, executeTrade, rebalancePortfolio, autoInvestExcessCash } from "../services/portfolio";
import { getCachedPrice } from "../services/price-api";
import {
  checkDrawdownHalt,
  fetchAndSaveEarningsCalendar,
  getUpcomingEarnings,
  getHistoricalPrices,
  computeRSI,
  computeSMA,
  computeMACD,
} from "../services/risk-manager";
import { sendAlert, HU_ALERTS } from "../services/alerter";
import { buildCompanyContext, getCachedSectorPerformance, getCachedWatchlist } from "../services/stock-screener";
import type { Env, BuyPick } from "../types";
import { PORTFOLIO_RULES } from "../types";

// ─── KV cache key for TA indicators ───
const TA_CACHE_KEY_PREFIX = "ta_indicators:";
const TA_CACHE_TTL = 3600; // 1 hour

async function getCachedTA(ticker: string, env: Env): Promise<string | null> {
  return env.CACHE.get(`${TA_CACHE_KEY_PREFIX}${ticker}`);
}

async function setCachedTA(ticker: string, data: string, env: Env): Promise<void> {
  await env.CACHE.put(`${TA_CACHE_KEY_PREFIX}${ticker}`, data, { expirationTtl: TA_CACHE_TTL });
}

export async function handleDailyAnalysis(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();

  console.log("[daily-analysis] Starting daily analysis...");

  // 1. Get portfolio state
  const accountState = await getAccountState(env);
  const portfolioState = JSON.stringify(accountState, null, 2);
  const cashPct = accountState.cash / accountState.totalValue;

  console.log(
    `[daily-analysis] Portfolio: $${accountState.totalValue.toFixed(2)} total, $${accountState.cash.toFixed(2)} cash (${(cashPct * 100).toFixed(1)}%), ${accountState.positions.length} positions`
  );

  // ─── Gather AI performance history for self-learning ───
  const pastAnalyses = await db.select().from(analysis)
    .orderBy(desc(analysis.createdAt)).limit(5);

  const allPredictions = await db.select().from(predictions)
    .where(not(eq(predictions.outcome, "pending")));

  const totalPredictions = allPredictions.length;
  const hits = allPredictions.filter(p => p.outcome === "target_hit").length;
  const misses = allPredictions.filter(p => p.outcome === "stop_hit").length;
  const accuracy = totalPredictions > 0 ? (hits / totalPredictions * 100).toFixed(1) : "N/A";

  const recentTrades = await db.select().from(trades)
    .orderBy(desc(trades.executedAt)).limit(20);

  const aiHistory = `
### AI Performance History
- Total predictions: ${totalPredictions} | Hits: ${hits} | Misses: ${misses} | Accuracy: ${accuracy}%
- Recent trades: ${recentTrades.map(t => `${t.action} ${t.ticker} @ $${t.price} (${t.reason?.slice(0, 50) ?? "N/A"})`).join("; ")}
- Past outlooks: ${pastAnalyses.map(a => a.outlook?.slice(0, 100) ?? "N/A").join(" | ")}

LEARN FROM YOUR MISTAKES: If accuracy is below 50%, be MORE conservative. If a sector consistently loses money, AVOID it.
`;

  console.log(`[daily-analysis] AI history: ${totalPredictions} predictions, ${accuracy}% accuracy`);

  // 2. Get last 24h news
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const recentNewsItems = await db
    .select()
    .from(news)
    .where(gte(news.scrapedAt, yesterday))
    .orderBy(desc(news.scrapedAt))
    .limit(50);

  const recentNews = recentNewsItems
    .map(
      (n) =>
        `[${n.source}] ${n.title} | sentiment: ${n.sentiment} | impact: ${n.impact} | tickers: ${n.tickers}`
    )
    .join("\n");

  // 3. Get 7-day news trends
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const weekNews = await db
    .select()
    .from(news)
    .where(gte(news.scrapedAt, weekAgo))
    .orderBy(desc(news.scrapedAt))
    .limit(200);

  const tickerCounts = new Map<string, { count: number; totalSentiment: number }>();
  for (const n of weekNews) {
    const tickers: string[] = n.tickers ? JSON.parse(n.tickers) : [];
    for (const t of tickers) {
      const existing = tickerCounts.get(t) || { count: 0, totalSentiment: 0 };
      existing.count++;
      existing.totalSentiment += n.sentiment || 0;
      tickerCounts.set(t, existing);
    }
  }

  const newsTrends = [...tickerCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(
      ([ticker, data]) =>
        `${ticker}: ${data.count} mentions, avg sentiment ${(data.totalSentiment / data.count).toFixed(2)}`
    )
    .join("\n");

  // 4. Get 30-day price history for portfolio tickers
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const priceData = await db
    .select()
    .from(prices)
    .where(gte(prices.recordedAt, monthAgo))
    .orderBy(desc(prices.recordedAt))
    .limit(500);

  const priceHistory = priceData
    .slice(0, 100)
    .map((p) => `${p.ticker}: $${p.price} @ ${p.recordedAt}`)
    .join("\n");

  // 4b. Compute technical indicators — only for portfolio tickers + top 5 watchlist picks
  // (reduced from full watchlist to avoid hitting Workers subrequest limit)
  const portfolioTickers = accountState.positions.map((p) => p.ticker);

  let watchlistTickers: string[];
  try {
    watchlistTickers = await getCachedWatchlist(env);
  } catch {
    watchlistTickers = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "JPM", "AMD", "NFLX"];
  }

  // Only compute TA for portfolio + top 5 watchlist (not all 15+)
  const allTickersForTA = [...new Set([...portfolioTickers, ...watchlistTickers.slice(0, 5)])];

  const technicalData: string[] = [];
  for (const ticker of allTickersForTA) {
    // Check KV cache first (1 hour TTL)
    const cached = await getCachedTA(ticker, env);
    if (cached) {
      technicalData.push(cached);
      continue;
    }

    const historicalPrices = await getHistoricalPrices(ticker, 60, env);
    if (historicalPrices.length < 15) continue;

    const rsi = computeRSI(historicalPrices);
    const sma20 = computeSMA(historicalPrices, 20);
    const sma50 = computeSMA(historicalPrices, 50);
    const macd = computeMACD(historicalPrices);
    const latestPrice = historicalPrices[historicalPrices.length - 1];

    let line = `${ticker}: price=$${latestPrice.toFixed(2)}`;
    if (rsi !== null) line += ` RSI=${rsi.toFixed(1)}`;
    if (sma20 !== null) line += ` SMA20=$${sma20.toFixed(2)}`;
    if (sma50 !== null) line += ` SMA50=$${sma50.toFixed(2)}`;
    if (macd) line += ` MACD=${macd.macd} signal=${macd.signal} hist=${macd.histogram}`;
    if (sma20 !== null && latestPrice > sma20) line += " [ABOVE SMA20]";
    if (sma20 !== null && latestPrice < sma20) line += " [BELOW SMA20]";
    if (rsi !== null && rsi > 70) line += " [OVERBOUGHT]";
    if (rsi !== null && rsi < 30) line += " [OVERSOLD]";

    technicalData.push(line);
    // Cache for 1 hour
    await setCachedTA(ticker, line, env);
  }

  const technicalIndicators = technicalData.length > 0
    ? "\n\n### Technical Indicators\n" + technicalData.join("\n")
    : "";

  // 4c. Fetch earnings calendar from Finnhub
  console.log("[daily-analysis] Fetching earnings calendar...");
  await fetchAndSaveEarningsCalendar(env);

  // 4d. Get upcoming earnings for portfolio tickers
  const upcomingEarnings = await getUpcomingEarnings(portfolioTickers, env);
  const earningsWarning = upcomingEarnings.length > 0
    ? "\n\n### EARNINGS WARNINGS\n" +
      upcomingEarnings.map((e) => `${e.ticker}: earnings on ${e.date} — DO NOT BUY within 3 days of earnings`).join("\n")
    : "";

  // 4e. Check drawdown halt before proceeding
  const drawdownCheck = await checkDrawdownHalt(env);
  if (drawdownCheck.halted) {
    console.log(`[daily-analysis] DRAWDOWN HALT: portfolio down ${drawdownCheck.drawdownPct}% — skipping AI buy execution`);
    await sendAlert(HU_ALERTS.drawdownHalt(drawdownCheck.drawdownPct.toFixed(1)), "critical", env);
  }

  // 4f. Get sector performance and company context from stock screener
  // Reduced company profile fetches from 10 to 5 watchlist tickers to stay under subrequest limit
  let sectorContext = "";
  let companyContext = "";
  try {
    const sectorPerf = await getCachedSectorPerformance(env);
    if (sectorPerf.length > 0) {
      sectorContext = sectorPerf
        .map((s) =>
          `${s.sector} (${s.etf}): ${s.dayChange > 0 ? "+" : ""}${s.dayChange.toFixed(2)}% today`
        )
        .join("\n");
      console.log(`[daily-analysis] Sector performance: ${sectorPerf.length} sectors loaded`);
    }
  } catch (err) {
    console.error("[daily-analysis] Sector performance fetch failed:", err);
  }

  try {
    // Reduced from watchlistTickers.slice(0, 10) to slice(0, 5) to save subrequests
    const contextTickers = [
      ...new Set([...watchlistTickers.slice(0, 5), ...portfolioTickers]),
    ];
    companyContext = await buildCompanyContext(contextTickers, env);
    console.log(`[daily-analysis] Company context built for ${contextTickers.length} tickers`);
  } catch (err) {
    console.error("[daily-analysis] Company context build failed:", err);
  }

  // 4g. Load active investment plans for AI context
  const activePlans = await db
    .select()
    .from(investmentPlans)
    .where(eq(investmentPlans.status, "active"));

  const investmentPlansContext = activePlans.length > 0
    ? activePlans.map((p) => {
        if (p.targetType === "price") {
          return `${p.ticker}: Entry $${p.entryPrice}, Target $${p.targetPrice} (price), Hold ${p.plannedHoldMonths} months. Thesis: "${p.thesis}"`;
        }
        return `${p.ticker}: Entry $${p.entryPrice}, Hold until ${p.targetDate} (time). Thesis: "${p.thesis}"`;
      }).join("\n")
    : "";

  // 4h. Get yesterday's picks for dedup (prevent same picks every day)
  const yesterdayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const yesterdayAnalyses = await db
    .select()
    .from(analysis)
    .where(gte(analysis.createdAt, yesterdayStart))
    .orderBy(desc(analysis.createdAt))
    .limit(1);

  const yesterdayPickTickers = new Set<string>();
  if (yesterdayAnalyses.length > 0) {
    try {
      const picks = JSON.parse(yesterdayAnalyses[0].picks) as BuyPick[];
      for (const p of picks) yesterdayPickTickers.add(p.ticker);
    } catch {
      // Ignore parse errors
    }
  }

  // 5. Run AI analysis with enriched data (sector + company context + AI history + plans injected)
  console.log("[daily-analysis] Running AI analysis...");
  const enrichedPriceHistory =
    (priceHistory || "No price history available") +
    technicalIndicators +
    earningsWarning +
    (sectorContext ? "\n\n### Sector Performance (ETF-based)\n" + sectorContext : "") +
    (companyContext ? "\n\n### Company Profiles & Insider Activity\n" + companyContext : "");

  const rawResult = await runDailyAnalysis(
    portfolioState,
    recentNews || "No recent news available",
    newsTrends || "No trend data available",
    enrichedPriceHistory,
    sectorContext,
    companyContext,
    env,
    aiHistory,
    investmentPlansContext
  );

  console.log(
    `[daily-analysis] Raw AI result: ${rawResult.buyPicks.length} buy picks, ${rawResult.sellWarnings.length} sell warnings`
  );

  // 5b. Double-check analysis with risk officer review
  console.log("[daily-analysis] Running double-check risk review...");
  const result = await doubleCheckAnalysis(rawResult, portfolioState, env);
  console.log(
    `[daily-analysis] After double-check: ${result.buyPicks.length} buy picks approved (was ${rawResult.buyPicks.length}), outlook: ${result.marketOutlook}`
  );

  // 6. Save analysis
  await db.insert(analysis).values({
    type: "daily",
    picks: JSON.stringify(result.buyPicks),
    outlook: result.marketOutlook,
    portfolioChanges: JSON.stringify(result.portfolioActions),
    riskWarnings: JSON.stringify(result.sellWarnings),
    createdAt: now.toISOString(),
  });

  // 6b. Save predictions from buy picks
  for (const pick of result.buyPicks) {
    try {
      await db.insert(predictions).values({
        ticker: pick.ticker,
        entryPrice: pick.currentPrice,
        targetPrice: pick.targetPrice,
        stopLoss: pick.stopLoss,
        confidence: pick.confidence,
        predictedAt: now.toISOString(),
        outcome: "pending",
      });
    } catch {
      // Ignore duplicate or insert errors
    }
  }

  // 7. Auto-execute AI portfolio actions (sells first, then buys)
  // If drawdown halt is active, skip buys but still execute sells
  const currentState = await getAccountState(env);
  const openTickers = new Set(currentState.positions.map((p) => p.ticker));

  // Execute sell actions from AI first
  for (const action of result.portfolioActions) {
    if (action.action === "sell" && openTickers.has(action.ticker)) {
      console.log(`[daily-analysis] AI sell: ${action.ticker} — ${action.reason}`);
      const tradeResult = await executeTrade(action, env, "ai_pick");
      console.log(`[daily-analysis] Sell result: ${tradeResult.success ? "OK" : "FAIL"} — ${tradeResult.reason}`);
      if (tradeResult.success) {
        openTickers.delete(action.ticker);
        // Mark corresponding investment plan as abandoned if exists
        const plan = activePlans.find((p) => p.ticker === action.ticker);
        if (plan) {
          await db.update(investmentPlans)
            .set({ status: "abandoned", updatedAt: now.toISOString() })
            .where(eq(investmentPlans.id, plan.id));
          console.log(`[daily-analysis] Investment plan for ${action.ticker} marked as abandoned`);
        }
      }
    }
  }

  // 7b. Execute buy picks — only if genuine new opportunity (dedup against yesterday)
  // Conditions: cash > 10% AND pick is not the same as yesterday's (unless we don't hold it yet)
  if (drawdownCheck.halted) {
    console.log("[daily-analysis] Skipping all buys — drawdown halt active");
  }

  const preBuyCashPct = currentState.cash / currentState.totalValue;
  const hasEnoughCash = preBuyCashPct > PORTFOLIO_RULES.MAX_CASH_PCT;

  if (!drawdownCheck.halted && !hasEnoughCash) {
    console.log(`[daily-analysis] Cash at ${(preBuyCashPct * 100).toFixed(1)}% — below ${PORTFOLIO_RULES.MAX_CASH_PCT * 100}% threshold, skipping new buys`);
  }

  for (const pick of result.buyPicks) {
    if (drawdownCheck.halted) break;
    if (!hasEnoughCash) break;
    if (pick.confidence < PORTFOLIO_RULES.MIN_CONFIDENCE) continue;
    if (openTickers.has(pick.ticker)) continue;

    // Dedup: skip if same ticker was picked yesterday and we already have enough positions
    const isRepeatPick = yesterdayPickTickers.has(pick.ticker);
    if (isRepeatPick && openTickers.size >= 6) {
      console.log(`[daily-analysis] Skipping repeat pick ${pick.ticker} — same as yesterday, portfolio has ${openTickers.size} positions`);
      continue;
    }

    // Allocate ~15% of total value per position
    const allocAmount = currentState.totalValue * 0.15;
    const currentPrice = (await getCachedPrice(pick.ticker, env))?.price;
    if (!currentPrice) continue;
    const shares = Math.floor(allocAmount / currentPrice);
    if (shares <= 0) continue;

    console.log(
      `[daily-analysis] Auto-buy: ${shares} ${pick.ticker} @ $${currentPrice} (${(pick.confidence * 100).toFixed(0)}% conf)`
    );
    const tradeResult = await executeTrade(
      { action: "buy", ticker: pick.ticker, shares, reason: pick.reasoning },
      env,
      "ai_pick"
    );
    console.log(`[daily-analysis] Buy result: ${tradeResult.success ? "OK" : "FAIL"} — ${tradeResult.reason}`);

    if (tradeResult.success) {
      openTickers.add(pick.ticker);

      // Generate and save investment plan for this buy
      try {
        console.log(`[daily-analysis] Generating investment plan for ${pick.ticker}...`);
        const plan = await generateInvestmentPlan(
          pick.ticker,
          pick.reasoning,
          currentPrice,
          pick.targetPrice,
          env
        );

        await db.insert(investmentPlans).values({
          ticker: pick.ticker,
          entryPrice: currentPrice,
          targetType: plan.targetType,
          targetPrice: plan.targetPrice ?? null,
          targetDate: plan.targetDate ?? null,
          plannedHoldMonths: plan.plannedHoldMonths,
          thesis: plan.thesis,
          sector: null,
          checkFrequency: plan.checkFrequency,
          status: "active",
          aiConviction: `Initial buy at $${currentPrice.toFixed(2)}, confidence ${(pick.confidence * 100).toFixed(0)}%`,
          lastReviewed: now.toISOString(),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        console.log(`[daily-analysis] Investment plan saved: ${pick.ticker} ${plan.targetType} target, hold ${plan.plannedHoldMonths}mo`);
      } catch (err) {
        console.error(`[daily-analysis] Failed to save investment plan for ${pick.ticker}:`, err);
      }
    }
  }

  // 8. Ensure portfolio is at least 85% invested (skip if drawdown halt)
  if (drawdownCheck.halted) {
    console.log("[daily-analysis] Skipping force-invest — drawdown halt active");
  }
  const postTradeState = await getAccountState(env);
  const postCashPct = postTradeState.cash / postTradeState.totalValue;

  if (!drawdownCheck.halted && postCashPct > PORTFOLIO_RULES.MAX_CASH_PCT) {
    console.log(
      `[daily-analysis] Cash still at ${(postCashPct * 100).toFixed(1)}% after AI picks — force-investing remaining`
    );

    // Build candidate list: AI picks first, then fall back to existing positions
    const sortedPicks = [...result.buyPicks].sort((a, b) => b.confidence - a.confidence);

    // Phase 1: Buy AI picks (new or add to existing)
    for (const pick of sortedPicks) {
      const latestState = await getAccountState(env);
      const latestCashPct = latestState.cash / latestState.totalValue;
      if (latestCashPct <= PORTFOLIO_RULES.MAX_CASH_PCT) break;

      const excessCash = latestState.cash - latestState.totalValue * PORTFOLIO_RULES.MIN_CASH_RESERVE_PCT;
      if (excessCash <= 10) break;

      const currentPrice = (await getCachedPrice(pick.ticker, env))?.price;
      if (!currentPrice) continue;

      // Invest up to the full per-position allocation (not just 50%)
      const shares = Math.floor(Math.min(excessCash, latestState.totalValue * PORTFOLIO_RULES.MAX_SINGLE_POSITION_PCT) / currentPrice);
      if (shares <= 0) continue;

      console.log(
        `[daily-analysis] Force-invest: ${shares} ${pick.ticker} @ $${currentPrice}`
      );
      await executeTrade(
        { action: "buy", ticker: pick.ticker, shares, reason: `Force-invest: cash above ${PORTFOLIO_RULES.MAX_CASH_PCT * 100}% max` },
        env,
        "force_invest"
      );
    }

    // Phase 2: If still over max cash, add to existing positions proportionally
    const afterPicksState = await getAccountState(env);
    const afterPicksCashPct = afterPicksState.cash / afterPicksState.totalValue;
    if (afterPicksCashPct > PORTFOLIO_RULES.MAX_CASH_PCT) {
      console.log(
        `[daily-analysis] Still ${(afterPicksCashPct * 100).toFixed(1)}% cash after AI picks — distributing to existing positions`
      );
      await autoInvestExcessCash(env);
    }
  }

  // 9. Final rebalance
  console.log("[daily-analysis] Running final rebalance...");
  const rebalanceActions = await rebalancePortfolio(env);
  if (rebalanceActions.length > 0) {
    console.log(`[daily-analysis] Rebalance: ${rebalanceActions.join(" | ")}`);
  }

  // 10. Final state log
  const finalState = await getAccountState(env);
  const finalCashPct = finalState.cash / finalState.totalValue;
  console.log(
    `[daily-analysis] Done. Final: $${finalState.totalValue.toFixed(2)} total, $${finalState.cash.toFixed(2)} cash (${(finalCashPct * 100).toFixed(1)}%), ${finalState.positions.length} positions, PnL: ${finalState.totalPnlPercent.toFixed(2)}%`
  );
}

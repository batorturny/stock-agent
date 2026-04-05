import { desc, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { news, prices, analysis, predictions } from "../db/schema";
import { runDailyAnalysis } from "../services/ai-analyst";
import { getAccountState, executeTrade, rebalancePortfolio } from "../services/portfolio";
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
import { sendAlert } from "../services/alerter";
import { buildCompanyContext, getCachedSectorPerformance, getCachedWatchlist } from "../services/stock-screener";
import type { Env } from "../types";
import { PORTFOLIO_RULES } from "../types";

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

  // 4b. Compute technical indicators for portfolio + dynamic watchlist tickers
  const portfolioTickers = accountState.positions.map((p) => p.ticker);

  // Use dynamic watchlist instead of static list
  let watchlistTickers: string[];
  try {
    watchlistTickers = await getCachedWatchlist(env);
  } catch {
    watchlistTickers = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "JPM", "AMD", "NFLX"];
  }

  const allTickersForTA = [...new Set([...portfolioTickers, ...watchlistTickers.slice(0, 15)])];

  const technicalData: string[] = [];
  for (const ticker of allTickersForTA) {
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
    await sendAlert(`DRAWDOWN HALT: portfolio down ${drawdownCheck.drawdownPct}% from peak — all buying paused`, "critical", env);
  }

  // 4f. Get sector performance and company context from stock screener
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
    const contextTickers = [
      ...new Set([...watchlistTickers.slice(0, 10), ...portfolioTickers]),
    ];
    companyContext = await buildCompanyContext(contextTickers, env);
    console.log(`[daily-analysis] Company context built for ${contextTickers.length} tickers`);
  } catch (err) {
    console.error("[daily-analysis] Company context build failed:", err);
  }

  // 5. Run AI analysis with enriched data (sector + company context injected)
  console.log("[daily-analysis] Running AI analysis...");
  const enrichedPriceHistory =
    (priceHistory || "No price history available") +
    technicalIndicators +
    earningsWarning +
    (sectorContext ? "\n\n### Sector Performance (ETF-based)\n" + sectorContext : "") +
    (companyContext ? "\n\n### Company Profiles & Insider Activity\n" + companyContext : "");

  const result = await runDailyAnalysis(
    portfolioState,
    recentNews || "No recent news available",
    newsTrends || "No trend data available",
    enrichedPriceHistory,
    sectorContext,
    companyContext,
    env
  );

  console.log(
    `[daily-analysis] AI result: ${result.buyPicks.length} buy picks, ${result.sellWarnings.length} sell warnings, outlook: ${result.marketOutlook}`
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
      if (tradeResult.success) openTickers.delete(action.ticker);
    }
  }

  // Execute buy picks — top confident picks (skip if drawdown halt)
  if (drawdownCheck.halted) {
    console.log("[daily-analysis] Skipping all buys — drawdown halt active");
  }
  for (const pick of result.buyPicks) {
    if (drawdownCheck.halted) break;
    if (pick.confidence < PORTFOLIO_RULES.MIN_CONFIDENCE) continue;
    if (openTickers.has(pick.ticker)) continue;

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
    if (tradeResult.success) openTickers.add(pick.ticker);
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

    // Buy more of the top confident picks that we already hold or new ones
    const sortedPicks = [...result.buyPicks].sort((a, b) => b.confidence - a.confidence);

    for (const pick of sortedPicks) {
      const latestState = await getAccountState(env);
      const latestCashPct = latestState.cash / latestState.totalValue;
      if (latestCashPct <= PORTFOLIO_RULES.MAX_CASH_PCT) break;

      const excessCash = latestState.cash - latestState.totalValue * PORTFOLIO_RULES.MIN_CASH_RESERVE_PCT;
      if (excessCash <= 10) break;

      const currentPrice = (await getCachedPrice(pick.ticker, env))?.price;
      if (!currentPrice) continue;

      const shares = Math.floor(Math.min(excessCash * 0.5, latestState.totalValue * 0.15) / currentPrice);
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

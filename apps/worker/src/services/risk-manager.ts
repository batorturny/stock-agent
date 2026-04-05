import { eq, gte, desc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { portfolio, account, dailySnapshots, earningsCalendar, prices } from "../db/schema";
import { getCachedPrice } from "./price-api";
import type { Env, PortfolioPosition } from "../types";
import { PORTFOLIO_RULES } from "../types";

// ─── Sector definitions for common tickers ───

const TICKER_SECTORS: Record<string, string> = {
  // Technology
  AAPL: "Technology", MSFT: "Technology", GOOGL: "Technology", AMZN: "Technology",
  NVDA: "Technology", META: "Technology", TSLA: "Technology", AMD: "Technology",
  CRM: "Technology",
  // Communication
  NFLX: "Communication", DIS: "Communication",
  // Financial
  JPM: "Financial", BAC: "Financial", V: "Financial", GS: "Financial", MA: "Financial",
  // Healthcare
  JNJ: "Healthcare", UNH: "Healthcare", LLY: "Healthcare", PFE: "Healthcare", ABBV: "Healthcare",
  // Consumer
  WMT: "Consumer", PG: "Consumer", HD: "Consumer", KO: "Consumer", COST: "Consumer",
  // Energy
  XOM: "Energy", CVX: "Energy", COP: "Energy",
  // Industrial
  CAT: "Industrial", HON: "Industrial", UPS: "Industrial", BA: "Industrial",
  // ETFs / Index
  SPY: "Index", QQQ: "Index", XLK: "Technology", XLF: "Financial", XLE: "Energy", XLV: "Healthcare",
};

function getDb(env: Env) {
  return drizzle(env.DB);
}

// ─── Sector helpers ───

export function getSector(ticker: string): string {
  return TICKER_SECTORS[ticker] || "Unknown";
}

export function getSectorExposure(
  positions: PortfolioPosition[],
  totalValue: number
): Record<string, { value: number; pct: number }> {
  const sectorValues: Record<string, number> = {};

  for (const pos of positions) {
    const sector = getSector(pos.ticker);
    const price = pos.currentPrice ?? pos.avgPrice;
    const value = price * pos.shares;
    sectorValues[sector] = (sectorValues[sector] || 0) + value;
  }

  const result: Record<string, { value: number; pct: number }> = {};
  for (const [sector, value] of Object.entries(sectorValues)) {
    result[sector] = {
      value: Math.round(value * 100) / 100,
      pct: Math.round((value / totalValue) * 10000) / 10000,
    };
  }

  return result;
}

export function checkSectorLimit(
  ticker: string,
  positions: PortfolioPosition[],
  totalValue: number,
  buyValue: number,
  maxSectorPct: number = PORTFOLIO_RULES.MAX_SECTOR_PCT
): { allowed: boolean; reason: string } {
  const sector = getSector(ticker);
  if (sector === "Unknown" || sector === "Index") {
    return { allowed: true, reason: `${ticker} sector: ${sector} — no sector limit applied` };
  }

  const exposure = getSectorExposure(positions, totalValue);
  const currentSectorValue = exposure[sector]?.value ?? 0;
  const newPct = (currentSectorValue + buyValue) / totalValue;

  if (newPct > maxSectorPct) {
    return {
      allowed: false,
      reason: `Sector ${sector} would be ${(newPct * 100).toFixed(1)}% (limit: ${(maxSectorPct * 100).toFixed(0)}%)`,
    };
  }

  return {
    allowed: true,
    reason: `Sector ${sector} at ${(newPct * 100).toFixed(1)}% after buy`,
  };
}

// ─── Technical indicators ───

export function computeRSI(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Wilder's smoothing for remaining data
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

export function computeSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(prices.length - period);
  return Math.round((slice.reduce((a, b) => a + b, 0) / period) * 100) / 100;
}

export function computeMACD(
  closePrices: number[]
): { macd: number; signal: number; histogram: number } | null {
  if (closePrices.length < 35) return null; // Need at least 26 + 9 periods

  const ema = (data: number[], period: number): number[] => {
    const k = 2 / (period + 1);
    const result: number[] = [data[0]];
    for (let i = 1; i < data.length; i++) {
      result.push(data[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  };

  const ema12 = ema(closePrices, 12);
  const ema26 = ema(closePrices, 26);

  const macdLine: number[] = [];
  for (let i = 0; i < closePrices.length; i++) {
    macdLine.push(ema12[i] - ema26[i]);
  }

  const signalLine = ema(macdLine.slice(26), 9); // Signal from MACD values after EMA26 converges
  const latestMacd = macdLine[macdLine.length - 1];
  const latestSignal = signalLine[signalLine.length - 1];

  return {
    macd: Math.round(latestMacd * 1000) / 1000,
    signal: Math.round(latestSignal * 1000) / 1000,
    histogram: Math.round((latestMacd - latestSignal) * 1000) / 1000,
  };
}

// ─── Portfolio-level metrics ───

export async function computePortfolioMetrics(
  env: Env
): Promise<{
  sharpe30d: number | null;
  maxDrawdown: number;
  currentDrawdown: number;
  beta: number | null;
}> {
  const db = getDb(env);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const snapshots = await db
    .select()
    .from(dailySnapshots)
    .where(gte(dailySnapshots.date, thirtyDaysAgo))
    .orderBy(dailySnapshots.date);

  if (snapshots.length < 2) {
    return { sharpe30d: null, maxDrawdown: 0, currentDrawdown: 0, beta: null };
  }

  const values = snapshots.map((s) => s.totalValue);
  const spyPrices = snapshots.map((s) => s.spyPrice).filter((p): p is number => p != null);

  // Daily returns
  const dailyReturns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    dailyReturns.push((values[i] - values[i - 1]) / values[i - 1]);
  }

  // Sharpe ratio: annualized
  let sharpe30d: number | null = null;
  if (dailyReturns.length >= 5) {
    const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance =
      dailyReturns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) /
      (dailyReturns.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      const dailyRiskFree = 0.05 / 252; // 5% annual risk-free rate
      sharpe30d = Math.round(((avgReturn - dailyRiskFree) / stdDev) * Math.sqrt(252) * 100) / 100;
    }
  }

  // Max drawdown
  let peak = values[0];
  let maxDrawdown = 0;
  for (const val of values) {
    if (val > peak) peak = val;
    const dd = (val - peak) / peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }
  maxDrawdown = Math.round(maxDrawdown * 10000) / 100; // as percentage

  // Current drawdown
  const currentPeak = snapshots[snapshots.length - 1].peakValue;
  const currentValue = snapshots[snapshots.length - 1].totalValue;
  const currentDrawdown =
    currentPeak > 0
      ? Math.round(((currentValue - currentPeak) / currentPeak) * 10000) / 100
      : 0;

  // Beta vs SPY
  let beta: number | null = null;
  if (spyPrices.length >= 5 && spyPrices.length === values.length) {
    const spyReturns: number[] = [];
    const portReturns: number[] = [];
    for (let i = 1; i < spyPrices.length; i++) {
      spyReturns.push((spyPrices[i] - spyPrices[i - 1]) / spyPrices[i - 1]);
      portReturns.push((values[i] - values[i - 1]) / values[i - 1]);
    }

    const avgSpy = spyReturns.reduce((a, b) => a + b, 0) / spyReturns.length;
    const avgPort = portReturns.reduce((a, b) => a + b, 0) / portReturns.length;

    let covariance = 0;
    let spyVariance = 0;
    for (let i = 0; i < spyReturns.length; i++) {
      covariance += (portReturns[i] - avgPort) * (spyReturns[i] - avgSpy);
      spyVariance += (spyReturns[i] - avgSpy) ** 2;
    }

    if (spyVariance > 0) {
      beta = Math.round((covariance / spyVariance) * 100) / 100;
    }
  }

  return { sharpe30d, maxDrawdown, currentDrawdown, beta };
}

// ─── Daily snapshot save ───

export async function saveDailySnapshot(env: Env): Promise<void> {
  const db = getDb(env);
  const [acct] = await db.select().from(account).limit(1);
  if (!acct) return;

  const positions = await db
    .select()
    .from(portfolio)
    .where(eq(portfolio.status, "open"));

  let totalPositionValue = 0;
  for (const pos of positions) {
    const cached = await getCachedPrice(pos.ticker, env);
    const price = cached?.price || pos.avgPrice;
    totalPositionValue += price * pos.shares;
  }

  const totalValue = acct.cash + totalPositionValue;
  const today = new Date().toISOString().split("T")[0];
  const now = new Date().toISOString();

  // Get previous snapshot for return calculation
  const prevSnapshots = await db
    .select()
    .from(dailySnapshots)
    .orderBy(desc(dailySnapshots.date))
    .limit(1);

  const prevValue = prevSnapshots.length > 0 ? prevSnapshots[0].totalValue : totalValue;
  const dailyReturnPct =
    prevValue > 0 ? Math.round(((totalValue - prevValue) / prevValue) * 10000) / 100 : 0;

  // Peak value tracking
  const peakValue = prevSnapshots.length > 0
    ? Math.max(prevSnapshots[0].peakValue, totalValue)
    : totalValue;
  const drawdownPct =
    peakValue > 0 ? Math.round(((totalValue - peakValue) / peakValue) * 10000) / 100 : 0;

  // SPY price for benchmark
  const spyCached = await getCachedPrice("SPY", env);
  const spyPrice = spyCached?.price ?? null;

  let spyReturnPct: number | null = null;
  if (spyPrice && prevSnapshots.length > 0 && prevSnapshots[0].spyPrice) {
    spyReturnPct =
      Math.round(
        ((spyPrice - prevSnapshots[0].spyPrice) / prevSnapshots[0].spyPrice) * 10000
      ) / 100;
  }

  // Compute rolling 30d Sharpe
  const metrics = await computePortfolioMetrics(env);

  // Upsert: delete today's existing snapshot if any, then insert
  try {
    await db.delete(dailySnapshots).where(eq(dailySnapshots.date, today));
  } catch {
    // Ignore if table doesn't exist yet
  }

  await db.insert(dailySnapshots).values({
    date: today,
    totalValue,
    cash: acct.cash,
    invested: totalPositionValue,
    positionsCount: positions.length,
    spyPrice,
    dailyReturnPct,
    spyReturnPct,
    peakValue,
    drawdownPct,
    sharpe30d: metrics.sharpe30d,
    createdAt: now,
  });

  console.log(
    `[risk-manager] Daily snapshot saved: $${totalValue.toFixed(2)} | dd: ${drawdownPct}% | sharpe: ${metrics.sharpe30d ?? "N/A"} (${today})`
  );
}

// ─── Circuit breaker: check for single-ticker crash ───

export async function checkCircuitBreaker(
  ticker: string,
  currentPrice: number,
  env: Env
): Promise<{ triggered: boolean; reason: string }> {
  const db = getDb(env);

  // Get previous day's close from prices table
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const prevPrices = await db
    .select()
    .from(prices)
    .where(and(eq(prices.ticker, ticker), gte(prices.recordedAt, yesterday)))
    .orderBy(prices.recordedAt)
    .limit(1);

  if (prevPrices.length === 0) {
    return { triggered: false, reason: "No previous price data for circuit breaker check" };
  }

  const prevPrice = prevPrices[0].price;
  const changePct = (currentPrice - prevPrice) / prevPrice;

  if (changePct <= -PORTFOLIO_RULES.CIRCUIT_BREAKER_PCT) {
    return {
      triggered: true,
      reason: `Circuit breaker: ${ticker} dropped ${(changePct * 100).toFixed(1)}% in 24h (threshold: -${(PORTFOLIO_RULES.CIRCUIT_BREAKER_PCT * 100).toFixed(0)}%)`,
    };
  }

  return {
    triggered: false,
    reason: `${ticker} 24h change: ${(changePct * 100).toFixed(1)}%`,
  };
}

// ─── Drawdown halt: stop all new buys if portfolio is too far below peak ───

export async function checkDrawdownHalt(
  env: Env
): Promise<{ halted: boolean; drawdownPct: number }> {
  const db = getDb(env);

  const snapshots = await db
    .select()
    .from(dailySnapshots)
    .orderBy(desc(dailySnapshots.date))
    .limit(1);

  if (snapshots.length === 0) {
    return { halted: false, drawdownPct: 0 };
  }

  const latest = snapshots[0];
  const drawdownPct =
    latest.peakValue > 0
      ? (latest.totalValue - latest.peakValue) / latest.peakValue
      : 0;

  if (drawdownPct <= -PORTFOLIO_RULES.MAX_DRAWDOWN_HALT_PCT) {
    return {
      halted: true,
      drawdownPct: Math.round(drawdownPct * 10000) / 100,
    };
  }

  return {
    halted: false,
    drawdownPct: Math.round(drawdownPct * 10000) / 100,
  };
}

// ─── Slippage simulation ───

export function addSlippage(price: number, action: "buy" | "sell"): number {
  // +0.05% for buys (pay more), -0.05% for sells (receive less)
  if (action === "buy") return Math.round(price * (1 + PORTFOLIO_RULES.SLIPPAGE_PCT) * 100) / 100;
  return Math.round(price * (1 - PORTFOLIO_RULES.SLIPPAGE_PCT) * 100) / 100;
}

// ─── Earnings proximity check ───

export async function checkEarningsProximity(
  ticker: string,
  env: Env
): Promise<{ nearEarnings: boolean; daysUntil: number | null }> {
  const db = getDb(env);
  const today = new Date().toISOString().split("T")[0];

  const upcoming = await db
    .select()
    .from(earningsCalendar)
    .where(
      and(
        eq(earningsCalendar.ticker, ticker),
        eq(earningsCalendar.status, "upcoming"),
        gte(earningsCalendar.reportDate, today)
      )
    )
    .orderBy(earningsCalendar.reportDate)
    .limit(1);

  if (upcoming.length === 0) {
    return { nearEarnings: false, daysUntil: null };
  }

  const earningsDate = new Date(upcoming[0].reportDate);
  const now = new Date();
  const daysUntil = Math.ceil((earningsDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  // Within 3 trading days = near earnings
  const nearEarnings = daysUntil <= 3;

  return { nearEarnings, daysUntil };
}

// ─── Fetch & save earnings calendar from Finnhub ───

export async function fetchAndSaveEarningsCalendar(env: Env): Promise<void> {
  const db = getDb(env);
  const now = new Date();
  const from = now.toISOString().split("T")[0];
  const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${env.FINNHUB_API_KEY}`
    );
    if (!res.ok) {
      console.error(`[risk-manager] Earnings calendar fetch failed: ${res.status}`);
      return;
    }

    const data = (await res.json()) as {
      earningsCalendar?: Array<{
        symbol: string;
        date: string;
        hour: string;
        epsEstimate: number | null;
      }>;
    };

    const entries = data.earningsCalendar || [];
    let saved = 0;

    for (const entry of entries) {
      if (!entry.symbol || !entry.date) continue;
      try {
        await db
          .delete(earningsCalendar)
          .where(
            and(
              eq(earningsCalendar.ticker, entry.symbol),
              eq(earningsCalendar.reportDate, entry.date)
            )
          );
        await db.insert(earningsCalendar).values({
          ticker: entry.symbol,
          reportDate: entry.date,
          estimateEps: entry.epsEstimate,
          status: "upcoming",
          updatedAt: now.toISOString(),
        });
        saved++;
      } catch {
        // Ignore individual insert errors
      }
    }

    console.log(`[risk-manager] Saved ${saved} earnings calendar entries (${from} to ${to})`);
  } catch (err) {
    console.error("[risk-manager] Earnings calendar fetch error:", err);
  }
}

// ─── Get upcoming earnings for specific tickers ───

export async function getUpcomingEarnings(
  tickers: string[],
  env: Env
): Promise<Array<{ ticker: string; date: string }>> {
  const db = getDb(env);
  const today = new Date().toISOString().split("T")[0];
  const results: Array<{ ticker: string; date: string }> = [];

  for (const ticker of tickers) {
    const earnings = await db
      .select()
      .from(earningsCalendar)
      .where(
        and(
          eq(earningsCalendar.ticker, ticker),
          eq(earningsCalendar.status, "upcoming"),
          gte(earningsCalendar.reportDate, today)
        )
      )
      .orderBy(earningsCalendar.reportDate)
      .limit(1);

    if (earnings.length > 0) {
      results.push({
        ticker: earnings[0].ticker,
        date: earnings[0].reportDate,
      });
    }
  }

  return results;
}

// ─── Fetch historical prices from DB for technical analysis ───

export async function getHistoricalPrices(
  ticker: string,
  days: number,
  env: Env
): Promise<number[]> {
  const db = getDb(env);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const rows = await db
    .select({ price: prices.price })
    .from(prices)
    .where(and(eq(prices.ticker, ticker), gte(prices.recordedAt, cutoff)))
    .orderBy(prices.recordedAt);

  return rows.map((r) => r.price);
}

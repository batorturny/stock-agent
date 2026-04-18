import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { and, desc, eq, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { trades, news, prices, analysis, dailySnapshots, earningsCalendar, portfolio, pushSubscriptions, copyTradeQueue } from "./db/schema";
import { getAccountState } from "./services/portfolio";
import { getCachedPrice, fetchQuote } from "./services/price-api";
import { computePortfolioMetrics, getSectorExposure } from "./services/risk-manager";
import { getCachedWatchlist, getCachedSectorPerformance, getCompanyProfile } from "./services/stock-screener";
import { handlePriceFetch } from "./crons/price-fetch";
import { handleNewsScrape } from "./crons/news-scrape";
import { handleDailyAnalysis } from "./crons/daily-analysis";
import { handleWeeklyReport } from "./crons/weekly-report";
import { getRiskProfile, getRiskLevel, getRiskProfiles, isValidRiskLevel } from "./services/risk-profile";
import { getNtfyTopic } from "./services/alerter";
import { LOGIN_HTML } from "./login";
import { getAlpacaAccount, isAlpacaConfigured, listPositions as listAlpacaPositions } from "./services/alpaca-client";
import { getRecentPoliticianTrades, getPendingCopyTrades, fetchAndStorePoliticianTrades } from "./services/politician-trades";
import { executePendingCopyTrades } from "./services/copy-trade-executor";
import { fetchInsiderFilings, getRecentInsiderBuys, getRecentInsiderSells, getInsiderSignals } from "./services/insider-trading";
import type { Env } from "./types";

const TICKER_REGEX = /^[A-Z]{1,5}$/;

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

const app = new Hono<{ Bindings: Env }>();

// Security headers
app.use("*", secureHeaders());

// CORS — restrict to dashboard origin, fallback to * in dev
app.use(
  "/api/*",
  cors({
    origin: (origin, c) => {
      const allowed = c.env.DASHBOARD_ORIGIN || "*";
      if (allowed === "*") return "*";
      return origin === allowed ? origin : null;
    },
  })
);

// ─── Login endpoint (must be before auth middleware) ───
app.post("/api/login", async (c) => {
  const body = await c.req.json<{ password?: string }>();
  const correctPassword = c.env.APP_PASSWORD;
  if (!correctPassword) return c.json({ ok: true });
  if (!body.password || body.password !== correctPassword) {
    return c.json({ error: "Hibás jelszó" }, 401);
  }
  const token = btoa(correctPassword + ":" + Date.now());
  return c.json({ ok: true }, {
    headers: {
      "Set-Cookie": `auth=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`,
    },
  });
});

// ─── Password auth middleware for ALL routes ───
app.use("*", async (c, next) => {
  const password = c.env.APP_PASSWORD;
  if (!password) return next(); // no password = open access

  // Allow login endpoint and health check
  if (c.req.path === "/api/login") return next();
  if (c.req.path === "/api/health") return next();
  // Allow PWA manifest/sw
  if (c.req.path === "/manifest.json") return next();
  if (c.req.path === "/sw.js") return next();

  // Check auth cookie
  const cookie = c.req.header("Cookie") || "";
  const authMatch = cookie.match(/auth=([^;]+)/);
  if (authMatch) {
    try {
      const decoded = atob(authMatch[1]);
      if (decoded.startsWith(password + ":")) return next();
    } catch { /* invalid cookie */ }
  }

  // Check Bearer token (for API calls)
  const bearer = c.req.header("Authorization")?.replace("Bearer ", "");
  if (bearer === password) return next();

  // If requesting HTML (dashboard), show login page
  const accept = c.req.header("Accept") || "";
  if (accept.includes("text/html") || c.req.path === "/") {
    return c.html(LOGIN_HTML);
  }

  return c.json({ error: "Unauthorized" }, 401);
});

// Bearer token auth for API_SECRET — skip health check
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") return next();
  if (c.req.path === "/api/login") return next();
  const secret = c.env.API_SECRET;
  if (!secret) return next(); // no secret configured = dev mode
  // If already authenticated via APP_PASSWORD cookie, skip API_SECRET check
  const password = c.env.APP_PASSWORD;
  if (password) {
    const cookie = c.req.header("Cookie") || "";
    const authMatch = cookie.match(/auth=([^;]+)/);
    if (authMatch) {
      try {
        const decoded = atob(authMatch[1]);
        if (decoded.startsWith(password + ":")) return next();
      } catch { /* fall through */ }
    }
  }
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (token !== secret) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

// Dashboard — full inline SPA
import { DASHBOARD_HTML } from "./dashboard";
import { MANIFEST_JSON, SERVICE_WORKER_JS } from "./pwa";
app.get("/", (c) => c.html(DASHBOARD_HTML));
app.get("/manifest.json", (c) => {
  return c.json(JSON.parse(MANIFEST_JSON));
});
app.get("/sw.js", (_c) => {
  return new Response(SERVICE_WORKER_JS, {
    headers: { "Content-Type": "application/javascript", "Service-Worker-Allowed": "/" },
  });
});

// Health check
app.get("/api/health", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString() })
);

// Portfolio state
app.get("/api/portfolio", async (c) => {
  const state = await getAccountState(c.env);
  return c.json(state);
});

// Current AI picks
app.get("/api/picks", async (c) => {
  const db = drizzle(c.env.DB);
  const [latest] = await db
    .select()
    .from(analysis)
    .where(eq(analysis.type, "daily"))
    .orderBy(desc(analysis.createdAt))
    .limit(1);

  if (!latest)
    return c.json({ picks: [], outlook: "No analysis yet", warnings: [] });

  return c.json({
    picks: safeParse(latest.picks, []),
    outlook: latest.outlook,
    warnings: latest.riskWarnings ? safeParse(latest.riskWarnings, []) : [],
    portfolioChanges: latest.portfolioChanges
      ? safeParse(latest.portfolioChanges, [])
      : [],
    createdAt: latest.createdAt,
  });
});

// Aggregated news feed
app.get("/api/news", async (c) => {
  const db = drizzle(c.env.DB);
  const limit = Math.max(1, Math.min(parseInt(c.req.query("limit") || "50", 10) || 50, 200));
  const source = c.req.query("source");
  const minImpact = parseInt(c.req.query("minImpact") || "0", 10) || 0;

  const items = await db
    .select()
    .from(news)
    .orderBy(desc(news.scrapedAt))
    .limit(limit);

  const filtered = items.filter((n) => {
    if (source && n.source !== source) return false;
    if (minImpact && (n.impact || 0) < minImpact) return false;
    return true;
  });

  return c.json({
    items: filtered.map((n) => ({
      ...n,
      tickers: n.tickers ? safeParse<string[]>(n.tickers, []) : [],
    })),
    total: filtered.length,
  });
});

// Price data — filtered by ticker in DB query
app.get("/api/prices/:ticker", async (c) => {
  const ticker = c.req.param("ticker").toUpperCase();
  if (!TICKER_REGEX.test(ticker)) {
    return c.json({ error: "Invalid ticker format" }, 400);
  }

  const cached = await getCachedPrice(ticker, c.env);

  const db = drizzle(c.env.DB);
  const monthAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const history = await db
    .select()
    .from(prices)
    .where(and(eq(prices.ticker, ticker), gte(prices.recordedAt, monthAgo)))
    .orderBy(desc(prices.recordedAt))
    .limit(500);

  return c.json({
    current: cached,
    history,
  });
});

// Trade history
app.get("/api/history", async (c) => {
  const db = drizzle(c.env.DB);
  const limit = Math.max(1, Math.min(parseInt(c.req.query("limit") || "50", 10) || 50, 500));
  const ticker = c.req.query("ticker");

  const allTrades = await db
    .select()
    .from(trades)
    .orderBy(desc(trades.executedAt))
    .limit(limit);

  const filtered = ticker
    ? allTrades.filter((t) => t.ticker === ticker)
    : allTrades;

  return c.json({ trades: filtered, total: filtered.length });
});

// Trade detail — trade + related news + AI reasoning
app.get("/api/trades/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid trade ID" }, 400);

  const db = drizzle(c.env.DB);
  const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
  if (!trade) return c.json({ error: "Trade not found" }, 404);

  // Find related news (same ticker, within 24h before trade)
  const tradeTime = new Date(trade.executedAt);
  const dayBefore = new Date(tradeTime.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const relatedNews = await db
    .select()
    .from(news)
    .where(gte(news.scrapedAt, dayBefore))
    .orderBy(desc(news.scrapedAt))
    .limit(100);

  const tickerNews = relatedNews.filter((n) => {
    const tickers: string[] = n.tickers ? safeParse<string[]>(n.tickers, []) : [];
    return tickers.includes(trade.ticker);
  });

  // Find the analysis that triggered this trade
  const [relatedAnalysis] = await db
    .select()
    .from(analysis)
    .where(gte(analysis.createdAt, dayBefore))
    .orderBy(desc(analysis.createdAt))
    .limit(1);

  return c.json({
    trade,
    relatedNews: tickerNews.map((n) => ({
      ...n,
      tickers: n.tickers ? safeParse<string[]>(n.tickers, []) : [],
    })),
    analysis: relatedAnalysis
      ? {
          outlook: relatedAnalysis.outlook,
          picks: safeParse(relatedAnalysis.picks, []),
          warnings: relatedAnalysis.riskWarnings
            ? safeParse(relatedAnalysis.riskWarnings, [])
            : [],
        }
      : null,
  });
});

// Weekly/daily reports
app.get("/api/report", async (c) => {
  const db = drizzle(c.env.DB);
  const validTypes = ["daily", "weekly", "monthly"] as const;
  const type = c.req.query("type") || "daily";
  if (!validTypes.includes(type as (typeof validTypes)[number])) {
    return c.json({ error: "Invalid report type" }, 400);
  }

  const reports = await db
    .select()
    .from(analysis)
    .where(eq(analysis.type, type as "daily" | "weekly" | "monthly"))
    .orderBy(desc(analysis.createdAt))
    .limit(10);

  return c.json({
    reports: reports.map((r) => ({
      ...r,
      picks: safeParse(r.picks, []),
      portfolioChanges: r.portfolioChanges
        ? safeParse(r.portfolioChanges, null)
        : null,
      riskWarnings: r.riskWarnings ? safeParse(r.riskWarnings, null) : null,
    })),
  });
});

// Alerts — latest alerts from KV
app.get("/api/alerts", async (c) => {
  const rawAlerts = await c.env.CACHE.get("alerts");
  const alerts = rawAlerts ? safeParse(rawAlerts, []) : [];
  return c.json({ alerts });
});

// Risk metrics — current portfolio risk metrics
app.get("/api/metrics", async (c) => {
  const state = await getAccountState(c.env);
  const metrics = await computePortfolioMetrics(c.env);
  const sectorExposure = getSectorExposure(state.positions, state.totalValue);

  // Get prediction accuracy from KV cache or compute
  let predictionAccuracy = null;
  const cachedAccuracy = await c.env.CACHE.get("prediction_accuracy");
  if (cachedAccuracy) {
    predictionAccuracy = safeParse(cachedAccuracy, null);
  }

  return c.json({
    sharpe30d: metrics.sharpe30d,
    maxDrawdown: metrics.maxDrawdown,
    currentDrawdown: metrics.currentDrawdown,
    beta: metrics.beta,
    sectorExposure,
    predictionAccuracy,
    portfolio: {
      totalValue: state.totalValue,
      cash: state.cash,
      positionCount: state.positions.length,
      totalPnlPercent: state.totalPnlPercent,
    },
  });
});

// Dynamic watchlist — current screener-ranked tickers with sector context
app.get("/api/watchlist", async (c) => {
  try {
    const watchlist = await getCachedWatchlist(c.env);
    const sectorPerf = await getCachedSectorPerformance(c.env);

    // Enrich watchlist with company profiles
    const enriched = await Promise.all(
      watchlist.map(async (ticker) => {
        const price = await getCachedPrice(ticker, c.env);
        const profile = await getCompanyProfile(ticker, c.env);
        return {
          ticker,
          price: price?.price ?? null,
          change: price?.change ?? null,
          changePercent: price?.changePercent ?? null,
          company: profile?.name ?? null,
          sector: profile?.sector ?? null,
          marketCap: profile?.marketCap ?? null,
          ceo: profile?.ceo ?? null,
        };
      })
    );

    return c.json({
      watchlist: enriched,
      sectorPerformance: sectorPerf,
      count: watchlist.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return c.json({ error: "Watchlist unavailable", details: String(err) }, 500);
  }
});

// Sector ETF performance — real-time sector rotation data
app.get("/api/sectors", async (c) => {
  try {
    const sectorPerf = await getCachedSectorPerformance(c.env);
    return c.json({
      sectors: sectorPerf,
      count: sectorPerf.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return c.json({ error: "Sector data unavailable", details: String(err) }, 500);
  }
});

// Performance: portfolio vs SPY comparison (last 30 days)
app.get("/api/performance", async (c) => {
  const db = drizzle(c.env.DB);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const snapshots = await db
    .select()
    .from(dailySnapshots)
    .where(gte(dailySnapshots.date, thirtyDaysAgo))
    .orderBy(dailySnapshots.date);

  if (snapshots.length < 2) {
    return c.json({ portfolio: [], spy: [], excessReturn: 0 });
  }

  const firstValue = snapshots[0].totalValue;
  const firstSpy = snapshots[0].spyPrice;

  const portfolioData = snapshots.map((s) => ({
    date: s.date,
    value: s.totalValue,
    returnPct: firstValue > 0
      ? Math.round(((s.totalValue - firstValue) / firstValue) * 10000) / 100
      : 0,
  }));

  const spyData = firstSpy
    ? snapshots
        .filter((s) => s.spyPrice != null)
        .map((s) => ({
          date: s.date,
          price: s.spyPrice!,
          returnPct: Math.round(((s.spyPrice! - firstSpy) / firstSpy) * 10000) / 100,
        }))
    : [];

  const lastPortReturn = portfolioData[portfolioData.length - 1]?.returnPct ?? 0;
  const lastSpyReturn = spyData[spyData.length - 1]?.returnPct ?? 0;
  const excessReturn = Math.round((lastPortReturn - lastSpyReturn) * 100) / 100;

  return c.json({ portfolio: portfolioData, spy: spyData, excessReturn });
});

// Macro indicators: VIX, 10Y Treasury, S&P 500
app.get("/api/macro", async (c) => {
  // Check KV cache first (15 min TTL)
  const cached = await c.env.CACHE.get("macro_indicators");
  if (cached) {
    return c.json(safeParse(cached, null));
  }

  const finnhubKey = c.env.FINNHUB_API_KEY;

  // Fetch VIX, TNX (10Y Treasury proxy), SPY in parallel
  const [vixQuote, tnxQuote, spyQuote] = await Promise.all([
    fetchQuote("VIX", c.env).catch(() => null),
    fetchQuote("TNX", c.env).catch(() => null),
    fetchQuote("SPY", c.env).catch(() => null),
  ]);

  // Compute SPY YTD return
  let ytdReturn: number | null = null;
  if (spyQuote) {
    // Use Finnhub candle endpoint to get Jan 1 price
    try {
      const yearStart = new Date(new Date().getFullYear(), 0, 2);
      const fromTs = Math.floor(yearStart.getTime() / 1000);
      const toTs = Math.floor(yearStart.getTime() / 1000) + 86400 * 5; // first week of Jan
      const res = await fetch(
        `https://finnhub.io/api/v1/stock/candle?symbol=SPY&resolution=D&from=${fromTs}&to=${toTs}`,
        { headers: { "X-Finnhub-Token": finnhubKey } }
      );
      if (res.ok) {
        const data = (await res.json()) as { c?: number[]; s: string };
        if (data.s !== "no_data" && data.c && data.c.length > 0) {
          const janPrice = data.c[0];
          ytdReturn = Math.round(((spyQuote.c - janPrice) / janPrice) * 10000) / 100;
        }
      }
    } catch {
      // Ignore YTD fetch errors
    }
  }

  const result = {
    vix: vixQuote
      ? { value: Math.round(vixQuote.c * 100) / 100, change: Math.round(vixQuote.d * 100) / 100 }
      : null,
    treasury10y: tnxQuote
      ? { value: Math.round(tnxQuote.c * 100) / 100, change: Math.round(tnxQuote.d * 100) / 100 }
      : null,
    sp500: spyQuote
      ? {
          value: Math.round(spyQuote.c * 100) / 100,
          change: Math.round(spyQuote.d * 100) / 100,
          changePct: Math.round(spyQuote.dp * 100) / 100,
          ytdReturn,
        }
      : null,
  };

  // Cache for 15 min
  await c.env.CACHE.put("macro_indicators", JSON.stringify(result), {
    expirationTtl: 900,
  });

  return c.json(result);
});

// Earnings calendar for held positions
app.get("/api/earnings", async (c) => {
  const db = drizzle(c.env.DB);
  const today = new Date().toISOString().split("T")[0];

  // Get current portfolio tickers
  const positions = await db
    .select({ ticker: portfolio.ticker })
    .from(portfolio)
    .where(eq(portfolio.status, "open"));

  if (positions.length === 0) {
    return c.json({ earnings: [] });
  }

  const tickers = positions.map((p) => p.ticker);
  const results: Array<{
    ticker: string;
    reportDate: string;
    daysUntil: number;
    estimateEps: number | null;
  }> = [];

  for (const ticker of tickers) {
    let upcoming: Array<typeof earningsCalendar.$inferSelect> = [];
    try {
      const all = await db
        .select()
        .from(earningsCalendar)
        .where(eq(earningsCalendar.ticker, ticker))
        .orderBy(earningsCalendar.reportDate)
        .limit(5);
      upcoming = all.filter(e => e.status === "upcoming" && e.reportDate >= today);
    } catch {
      continue;
    }

    if (upcoming.length > 0) {
      const earningsDate = new Date(upcoming[0].reportDate);
      const now = new Date();
      const daysUntil = Math.ceil(
        (earningsDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
      );
      results.push({
        ticker: upcoming[0].ticker,
        reportDate: upcoming[0].reportDate,
        daysUntil,
        estimateEps: upcoming[0].estimateEps,
      });
    }
  }

  // Sort by nearest first
  results.sort((a, b) => a.daysUntil - b.daysUntil);

  return c.json({ earnings: results });
});

// Manual trigger endpoints (bypass cron limits)
app.post("/api/trigger/prices", async (c) => {
  try {
    await handlePriceFetch(c.env);
    return c.json({ ok: true, message: "Price fetch completed" });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

app.post("/api/trigger/news", async (c) => {
  try {
    await handleNewsScrape(c.env);
    return c.json({ ok: true, message: "News scrape completed" });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

app.post("/api/trigger/analysis", async (c) => {
  try {
    await handleDailyAnalysis(c.env);
    return c.json({ ok: true, message: "Daily analysis completed" });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

// ─── Push notification endpoints ───

// Get ntfy.sh topic info for subscribing
app.get("/api/push-info", async (c) => {
  const topic = getNtfyTopic(c.env);
  if (!topic) {
    return c.json({ enabled: false, topic: null, subscribeUrl: null });
  }
  return c.json({
    enabled: true,
    topic,
    subscribeUrl: `https://ntfy.sh/${topic}`,
    webUrl: `https://ntfy.sh/${topic}`,
    appUrls: {
      android: "https://play.google.com/store/apps/details?id=io.heckel.ntfy",
      ios: "https://apps.apple.com/app/ntfy/id1625396347",
    },
  });
});

// Save push subscription (for future Web Push support)
app.post("/api/push/subscribe", async (c) => {
  const body = await c.req.json<{
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  }>();

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return c.json({ error: "Invalid subscription data" }, 400);
  }

  const db = drizzle(c.env.DB);
  await db
    .insert(pushSubscriptions)
    .values({
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        createdAt: new Date().toISOString(),
      },
    });

  return c.json({ ok: true });
});

// Remove push subscription
app.post("/api/push/unsubscribe", async (c) => {
  const body = await c.req.json<{ endpoint?: string }>();
  if (!body.endpoint) {
    return c.json({ error: "Missing endpoint" }, 400);
  }

  const db = drizzle(c.env.DB);
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, body.endpoint));

  return c.json({ ok: true });
});

// ─── Settings endpoints ───

app.get("/api/settings", async (c) => {
  const level = await getRiskLevel(c.env);
  const config = await getRiskProfile(c.env);
  const profiles = getRiskProfiles();
  return c.json({ riskLevel: level, riskConfig: config, profiles });
});

app.post("/api/settings/risk-profile", async (c) => {
  const body = await c.req.json<{ level?: string }>();
  if (!body.level || !isValidRiskLevel(body.level)) {
    return c.json({ error: "Invalid risk level. Must be: conservative, balanced, aggressive" }, 400);
  }
  await c.env.CACHE.put("setting:risk_profile", body.level);
  const config = getRiskProfiles()[body.level];
  return c.json({ ok: true, riskLevel: body.level, riskConfig: config });
});

// ─── Alpaca ───

app.get("/api/alpaca/status", async (c) => {
  if (!isAlpacaConfigured(c.env)) {
    return c.json({ connected: false, reason: "API keys not configured" });
  }
  const acct = await getAlpacaAccount(c.env);
  if (!acct) {
    return c.json({ connected: false, reason: "Failed to fetch account" });
  }
  const positions = await listAlpacaPositions(c.env);
  return c.json({
    connected: true,
    account: {
      cash: parseFloat(acct.cash),
      portfolioValue: parseFloat(acct.portfolio_value),
      buyingPower: parseFloat(acct.buying_power),
      status: acct.status,
    },
    positionsCount: positions.length,
  });
});

// ─── Politician trades ───

app.get("/api/politician-trades", async (c) => {
  const limitParam = c.req.query("limit");
  const limit = Math.min(parseInt(limitParam ?? "50", 10), 200);
  const politicianTradesList = await getRecentPoliticianTrades(c.env, limit);
  return c.json({ trades: politicianTradesList });
});

app.get("/api/copy-trades", async (c) => {
  const pending = await getPendingCopyTrades(c.env);
  const db = drizzle(c.env.DB);
  const executed = await db
    .select()
    .from(copyTradeQueue)
    .where(eq(copyTradeQueue.status, "executed"))
    .orderBy(desc(copyTradeQueue.executedAt))
    .limit(20);
  return c.json({ pending, executed });
});

app.post("/api/trigger/politician-trades", async (c) => {
  const result = await fetchAndStorePoliticianTrades(c.env);
  return c.json({ ok: true, result });
});

app.post("/api/trigger/copy-trades", async (c) => {
  const logs = await executePendingCopyTrades(c.env);
  return c.json({ ok: true, logs });
});

// ─── Insider trading ───

app.get("/api/insider/buys", async (c) => {
  const days = parseInt(c.req.query("days") ?? "14", 10);
  const buys = await getRecentInsiderBuys(c.env, Math.min(days, 90));
  return c.json({ buys, count: buys.length });
});

app.get("/api/insider/sells", async (c) => {
  const days = parseInt(c.req.query("days") ?? "14", 10);
  const sells = await getRecentInsiderSells(c.env, Math.min(days, 90));
  return c.json({ sells, count: sells.length });
});

app.get("/api/insider/signals", async (c) => {
  const signals = await getInsiderSignals(c.env);
  return c.json({ signals, count: signals.length });
});

app.post("/api/trigger/insider-filings", async (c) => {
  try {
    const result = await fetchInsiderFilings(c.env);
    return c.json({ ok: true, result });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

// Cron trigger handler
export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    // Cron runs every minute — price + trade execution always, rest on schedule
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const day = now.getUTCDay(); // 0=Sun, 1=Mon

    // EVERY MINUTE: price fetch + stop-loss/take-profit + pending orders + rotation
    ctx.waitUntil(
      handlePriceFetch(env).catch((e) =>
        console.error("[cron] Price fetch failed:", e)
      )
    );

    // EVERY MINUTE: execute pending copy trades (fires whenever delay has elapsed)
    ctx.waitUntil(
      executePendingCopyTrades(env)
        .then((logs) => logs.forEach((l) => console.info(l)))
        .catch((e) => console.error("[cron] Copy trade executor failed:", e))
    );

    // EVERY 15 MIN: news scrape + sentiment
    if (minute % 15 === 0) {
      ctx.waitUntil(
        handleNewsScrape(env).catch((e) =>
          console.error("[cron] News scrape failed:", e)
        )
      );
    }

    // HOURLY: fetch politician trades + insider filings (on the :00 minute)
    if (minute === 0) {
      ctx.waitUntil(
        fetchAndStorePoliticianTrades(env)
          .then((r) => console.info("[cron] Politician trades:", r))
          .catch((e) => console.error("[cron] Politician trades failed:", e))
      );
      ctx.waitUntil(
        fetchInsiderFilings(env)
          .then((r) => console.info("[cron] Insider filings:", r))
          .catch((e) => console.error("[cron] Insider filings failed:", e))
      );
    }

    // DAILY: AI analysis at 20:00 UTC = 22:00 Budapest (este 10)
    if (hour === 20 && minute === 0) {
      ctx.waitUntil(
        handleDailyAnalysis(env).catch((e) =>
          console.error("[cron] Daily analysis failed:", e)
        )
      );
    }

    // WEEKLY: report on Monday at 07:00 UTC
    if (day === 1 && hour === 7 && minute === 0) {
      ctx.waitUntil(
        handleWeeklyReport(env).catch((e) =>
          console.error("[cron] Weekly report failed:", e)
        )
      );
    }
  },
};

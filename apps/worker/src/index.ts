import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { and, desc, eq, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { trades, news, prices, analysis } from "./db/schema";
import { getAccountState } from "./services/portfolio";
import { getCachedPrice } from "./services/price-api";
import { computePortfolioMetrics, getSectorExposure } from "./services/risk-manager";
import { getCachedWatchlist, getCachedSectorPerformance, getCompanyProfile } from "./services/stock-screener";
import { handlePriceFetch } from "./crons/price-fetch";
import { handleNewsScrape } from "./crons/news-scrape";
import { handleDailyAnalysis } from "./crons/daily-analysis";
import { handleWeeklyReport } from "./crons/weekly-report";
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

// Bearer token auth — skip health check
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") return next();
  const secret = c.env.API_SECRET;
  if (!secret) return next(); // no secret configured = dev mode
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

// Cron trigger handler
export default {
  fetch: app.fetch,
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    switch (event.cron) {
      case "*/15 * * * *":
        ctx.waitUntil(
          handlePriceFetch(env).catch((e) =>
            console.error("Price fetch failed:", e)
          )
        );
        ctx.waitUntil(
          handleNewsScrape(env).catch((e) =>
            console.error("News scrape failed:", e)
          )
        );
        break;
      case "0 6 * * *":
        ctx.waitUntil(
          handleDailyAnalysis(env).catch((e) =>
            console.error("Daily analysis failed:", e)
          )
        );
        break;
      case "0 7 * * 1":
        ctx.waitUntil(
          handleWeeklyReport(env).catch((e) =>
            console.error("Weekly report failed:", e)
          )
        );
        break;
    }
  },
};

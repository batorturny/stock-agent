import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { and, desc, eq, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { trades, news, prices, analysis } from "./db/schema";
import { getAccountState } from "./services/portfolio";
import { getCachedPrice } from "./services/price-api";
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

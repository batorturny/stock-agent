import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const portfolio = sqliteTable("portfolio", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  shares: real("shares").notNull(),
  avgPrice: real("avg_price").notNull(),
  boughtAt: text("bought_at").notNull(),
  status: text("status", { enum: ["open", "closed"] })
    .default("open")
    .notNull(),
  closePrice: real("close_price"),
  closeReason: text("close_reason", {
    enum: ["manual", "stop_loss", "take_profit"],
  }),
  closedAt: text("closed_at"),
});

export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  action: text("action", { enum: ["buy", "sell"] }).notNull(),
  shares: real("shares").notNull(),
  price: real("price").notNull(),
  total: real("total").notNull(),
  reason: text("reason"),
  confidence: real("confidence"),
  executedAt: text("executed_at").notNull(),
});

export const news = sqliteTable("news", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  summary: text("summary"),
  tickers: text("tickers"), // JSON array
  sentiment: real("sentiment"), // -1.0 to 1.0
  impact: integer("impact"), // 0-10
  timeHorizon: text("time_horizon", {
    enum: ["immediate", "week", "month", "long"],
  }),
  publishedAt: text("published_at"),
  scrapedAt: text("scraped_at").notNull(),
});

export const prices = sqliteTable("prices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  price: real("price").notNull(),
  open: real("open"),
  high: real("high"),
  low: real("low"),
  volume: integer("volume"),
  recordedAt: text("recorded_at").notNull(),
});

export const analysis = sqliteTable("analysis", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["daily", "weekly", "monthly"] }).notNull(),
  picks: text("picks").notNull(), // JSON
  outlook: text("outlook").notNull(),
  portfolioChanges: text("portfolio_changes"), // JSON
  riskWarnings: text("risk_warnings"),
  createdAt: text("created_at").notNull(),
});

export const account = sqliteTable("account", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cash: real("cash").notNull().default(5000.0),
  totalValue: real("total_value").notNull().default(5000.0),
  updatedAt: text("updated_at").notNull(),
});

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
  triggerType: text("trigger_type"), // 'ai_pick' | 'stop_loss' | 'take_profit' | 'news_reactive' | 'force_invest' | 'rebalance'
  analysisId: integer("analysis_id"),
  preCash: real("pre_cash"),
  postCash: real("post_cash"),
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

export const sectors = sqliteTable("sectors", {
  ticker: text("ticker").primaryKey(),
  sector: text("sector").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const dailySnapshots = sqliteTable("daily_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().unique(),
  totalValue: real("total_value").notNull(),
  cash: real("cash").notNull(),
  invested: real("invested").notNull(),
  positionsCount: integer("positions_count").notNull(),
  spyPrice: real("spy_price"),
  dailyReturnPct: real("daily_return_pct"),
  spyReturnPct: real("spy_return_pct"),
  peakValue: real("peak_value").notNull(),
  drawdownPct: real("drawdown_pct").notNull().default(0),
  sharpe30d: real("sharpe_30d"),
  createdAt: text("created_at").notNull(),
});

export const predictions = sqliteTable("predictions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  entryPrice: real("entry_price").notNull(),
  targetPrice: real("target_price").notNull(),
  stopLoss: real("stop_loss").notNull(),
  confidence: real("confidence").notNull(),
  predictedAt: text("predicted_at").notNull(),
  outcome: text("outcome"), // 'target_hit' | 'stop_hit' | 'expired' | 'pending'
  actualPrice: real("actual_price"),
  resolvedAt: text("resolved_at"),
  pnlPct: real("pnl_pct"),
});

export const pendingOrders = sqliteTable("pending_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  action: text("action", { enum: ["buy", "sell"] }).notNull(),
  limitPrice: real("limit_price").notNull(),
  shares: integer("shares").notNull(),
  reason: text("reason"),
  expiresAt: text("expires_at").notNull(),
  status: text("status", { enum: ["pending", "filled", "expired", "cancelled"] }).default("pending"),
  createdAt: text("created_at").notNull(),
  filledAt: text("filled_at"),
});

export const earningsCalendar = sqliteTable("earnings_calendar", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  reportDate: text("report_date").notNull(),
  estimateEps: real("estimate_eps"),
  actualEps: real("actual_eps"),
  status: text("status", { enum: ["upcoming", "reported"] }).default("upcoming"),
  updatedAt: text("updated_at").notNull(),
});

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: text("created_at").notNull(),
});

// US congressional stock trades from Finnhub congressional-trading endpoint
export const politicianTrades = sqliteTable("politician_trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),         // politician name
  position: text("position"),           // Senator / Representative
  ownerType: text("owner_type"),        // self / spouse / child
  transactionType: text("transaction_type").notNull(), // Purchase / Sale
  amountFrom: real("amount_from"),
  amountTo: real("amount_to"),
  transactionDate: text("transaction_date").notNull(),
  filingDate: text("filing_date").notNull(),
  fetchedAt: text("fetched_at").notNull(),
});

// Copy trades queued to execute via Alpaca after delay
export const copyTradeQueue = sqliteTable("copy_trade_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  side: text("side", { enum: ["buy", "sell"] }).notNull(),
  qty: real("qty").notNull(),
  politicianName: text("politician_name").notNull(),
  politicianTradeId: integer("politician_trade_id"),
  executeAfter: text("execute_after").notNull(), // ISO timestamp — execute when this passes
  status: text("status", { enum: ["pending", "executed", "cancelled", "failed"] })
    .default("pending")
    .notNull(),
  alpacaOrderId: text("alpaca_order_id"),
  reason: text("reason"),
  createdAt: text("created_at").notNull(),
  executedAt: text("executed_at"),
});

// SEC Form 4 insider filings (from Finnhub + EDGAR)
export const insiderFilings = sqliteTable("insider_filings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  filerName: text("filer_name").notNull(),
  filerRole: text("filer_role").notNull(),
  transactionType: text("transaction_type").notNull(),
  shares: real("shares").notNull(),
  pricePerShare: real("price_per_share"),
  totalValue: real("total_value"),
  transactionDate: text("transaction_date").notNull(),
  filingDate: text("filing_date").notNull(),
  filingUrl: text("filing_url"),
  source: text("source").notNull().default("finnhub"),
  fetchedAt: text("fetched_at").notNull(),
});

// Detected insider trading signals (cluster buys, CEO buys, etc.)
export const insiderSignals = sqliteTable("insider_signals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  signalType: text("signal_type").notNull(),
  insiderCount: integer("insider_count").notNull(),
  totalValue: real("total_value").notNull(),
  confidence: real("confidence").notNull(),
  details: text("details").notNull(),
  actedOn: integer("acted_on").default(0),
  detectedAt: text("detected_at").notNull(),
});

export const investmentPlans = sqliteTable("investment_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  entryPrice: real("entry_price").notNull(),
  targetType: text("target_type", { enum: ["price", "time"] }).notNull(),
  targetPrice: real("target_price"),
  targetDate: text("target_date"),
  plannedHoldMonths: integer("planned_hold_months"),
  thesis: text("thesis").notNull(),
  sector: text("sector"),
  checkFrequency: text("check_frequency", { enum: ["realtime", "weekly"] })
    .notNull()
    .default("weekly"),
  status: text("status", { enum: ["active", "completed", "abandoned"] })
    .notNull()
    .default("active"),
  aiConviction: text("ai_conviction"),
  lastReviewed: text("last_reviewed"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

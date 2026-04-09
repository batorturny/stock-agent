export type Env = {
  DB: D1Database;
  CACHE: KVNamespace;
  GEMINI_API_KEY: string;
  FINNHUB_API_KEY: string;
  ALPACA_API_KEY_ID?: string;
  ALPACA_API_SECRET_KEY?: string;
  ENVIRONMENT: string;
  API_SECRET?: string;
  APP_PASSWORD?: string;
  RISK_PROFILE?: string;
  DASHBOARD_ORIGIN?: string;
  ALERT_WEBHOOK?: string;
  NTFY_TOPIC?: string;
};

export type BuyPick = {
  ticker: string;
  currentPrice: number;
  targetPrice: number;
  stopLoss: number;
  confidence: number;
  timeHorizon: string;
  reasoning: string;
  catalysts: string[];
  risks: string[];
};

export type SellWarning = {
  ticker: string;
  reason: string;
  urgency: "high" | "medium" | "low";
};

export type PortfolioAction = {
  action: "buy" | "sell" | "hold";
  ticker: string;
  shares: number;
  reason: string;
  riskRewardRatio?: number;
  noActionReason?: string;
};

export type DailyAnalysis = {
  reasoning: string;
  buyPicks: BuyPick[];
  sellWarnings: SellWarning[];
  portfolioActions: PortfolioAction[];
  marketOutlook: string;
  riskLevel: "low" | "medium" | "high";
  keyNarratives: string[];
  watchlistAdditions: string[];
};

export type SentimentResult = {
  tickers: string[];
  sentiment: number;
  impact: number;
  timeHorizon: string;
  category: "earnings" | "macro" | "regulatory" | "M&A" | "product" | "legal" | "analyst" | "other";
};

export type PortfolioPosition = {
  id: number;
  ticker: string;
  shares: number;
  avgPrice: number;
  boughtAt: string;
  status: "open" | "closed";
  currentPrice?: number;
  pnl?: number;
  pnlPercent?: number;
};

export type AccountState = {
  cash: number;
  totalValue: number;
  positions: PortfolioPosition[];
  dailyPnl: number;
  dailyPnlPercent: number;
  totalPnl: number;
  totalPnlPercent: number;
};

export type NewsItem = {
  id: number;
  source: string;
  title: string;
  url: string;
  summary: string | null;
  tickers: string[];
  sentiment: number | null;
  impact: number | null;
  timeHorizon: string | null;
  publishedAt: string | null;
  scrapedAt: string;
};

export type InvestmentPlanResult = {
  targetType: "price" | "time";
  targetPrice?: number;
  targetDate?: string;
  plannedHoldMonths: number;
  thesis: string;
  checkFrequency: "realtime" | "weekly";
};

// RSS feed source configuration
export type FeedSource = {
  name: string;
  url: string;
  type: "financial" | "tabloid" | "tech";
};

// Portfolio management rules — AGGRESSIVE ALWAYS-INVESTED strategy
export const PORTFOLIO_RULES = {
  INITIAL_CAPITAL: 5000.0,
  MAX_POSITIONS: 10,
  MAX_SINGLE_POSITION_PCT: 0.2, // 20% max per position
  MAX_SECTOR_PCT: 0.4, // 40% max per sector
  STOP_LOSS_PCT: -0.05, // -5% stop loss (tight)
  TAKE_PROFIT_PCT: 0.12, // +12% take profit (sell half, trail remainder)
  MIN_CONFIDENCE: 0.55, // 55% — lower bar, idle cash is worse
  MIN_CASH_RESERVE_PCT: 0.05, // 5% min cash (aggressive)
  MAX_CASH_PCT: 0.10, // 10% max cash — auto-invest above this
  NEWS_SELL_IMPACT_THRESHOLD: 6, // impact > 6 triggers reactive sell
  NEWS_SELL_SENTIMENT_THRESHOLD: -0.3, // sentiment < -0.3 triggers reactive sell
  MIN_HOLD_HOURS: 72, // 3-day minimum hold period (stop-loss always overrides)
  CIRCUIT_BREAKER_PCT: 0.15, // 15% single-day drop triggers circuit breaker
  MAX_DRAWDOWN_HALT_PCT: 0.15, // 15% drawdown from peak halts new buys
  SLIPPAGE_PCT: 0.0005, // 0.05% slippage simulation
} as const;

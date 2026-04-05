export type Env = {
  DB: D1Database;
  CACHE: KVNamespace;
  ANTHROPIC_API_KEY: string;
  FINNHUB_API_KEY: string;
  ENVIRONMENT: string;
  API_SECRET?: string;
  DASHBOARD_ORIGIN?: string;
};

export type BuyPick = {
  ticker: string;
  targetPrice: number;
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
};

export type DailyAnalysis = {
  buyPicks: BuyPick[];
  sellWarnings: SellWarning[];
  portfolioActions: PortfolioAction[];
  marketOutlook: string;
  riskLevel: "low" | "medium" | "high";
  keyNarratives: string[];
  watchlistAdditions: string[];
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

// RSS feed source configuration
export type FeedSource = {
  name: string;
  url: string;
  type: "financial" | "tabloid" | "tech";
};

// Portfolio management rules
export const PORTFOLIO_RULES = {
  INITIAL_CAPITAL: 5000.0,
  MAX_POSITIONS: 10,
  MAX_SINGLE_POSITION_PCT: 0.2, // 20%
  STOP_LOSS_PCT: -0.08, // -8%
  TAKE_PROFIT_PCT: 0.15, // +15%
  MIN_CONFIDENCE: 0.7, // 70%
  MIN_CASH_RESERVE_PCT: 0.1, // 10%
} as const;

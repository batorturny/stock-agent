const API_BASE = "/api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export type PortfolioPosition = {
  id: number;
  ticker: string;
  shares: number;
  avgPrice: number;
  boughtAt: string;
  status: string;
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
  urgency: string;
};

export type PicksResponse = {
  picks: BuyPick[];
  outlook: string;
  warnings: SellWarning[];
  createdAt: string;
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

export type Trade = {
  id: number;
  ticker: string;
  action: string;
  shares: number;
  price: number;
  total: number;
  reason: string | null;
  confidence: number | null;
  executedAt: string;
};

export type PricePoint = {
  ticker: string;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  recordedAt: string;
};

export type PoliticianTrade = {
  id: number;
  symbol: string;
  name: string;
  position: string | null;
  ownerType: string | null;
  transactionType: string;
  amountFrom: number | null;
  amountTo: number | null;
  transactionDate: string;
  filingDate: string;
  fetchedAt: string;
};

export type CopyTrade = {
  id: number;
  symbol: string;
  side: string;
  qty: number;
  politicianName: string;
  executeAfter: string;
  status: string;
  alpacaOrderId: string | null;
  reason: string | null;
  createdAt: string;
  executedAt: string | null;
};

export type AlpacaStatus = {
  connected: boolean;
  reason?: string;
  account?: {
    cash: number;
    portfolioValue: number;
    buyingPower: number;
    status: string;
  };
  positionsCount?: number;
};

export const api = {
  getPortfolio: () => fetchJson<AccountState>("/portfolio"),
  getPicks: () => fetchJson<PicksResponse>("/picks"),
  getNews: (limit = 50) => fetchJson<{ items: NewsItem[]; total: number }>(`/news?limit=${limit}`),
  getPrices: (ticker: string) =>
    fetchJson<{ current: unknown; history: PricePoint[] }>(`/prices/${ticker}`),
  getHistory: (limit = 50) =>
    fetchJson<{ trades: Trade[]; total: number }>(`/history?limit=${limit}`),
  getReport: (type = "daily") =>
    fetchJson<{ reports: unknown[] }>(`/report?type=${type}`),
  getPoliticianTrades: (limit = 50) =>
    fetchJson<{ trades: PoliticianTrade[] }>(`/politician-trades?limit=${limit}`),
  getCopyTrades: () =>
    fetchJson<{ pending: CopyTrade[]; executed: CopyTrade[] }>("/copy-trades"),
  getAlpacaStatus: () =>
    fetchJson<AlpacaStatus>("/alpaca/status"),
};

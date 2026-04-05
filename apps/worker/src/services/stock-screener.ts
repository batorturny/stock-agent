import type { Env } from "../types";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

// Sector ETFs to track for rotation signals
const SECTOR_ETFS: Record<string, string> = {
  XLK: "Technology",
  XLF: "Financial",
  XLE: "Energy",
  XLV: "Healthcare",
  XLY: "Consumer Discretionary",
  XLP: "Consumer Staples",
  XLI: "Industrial",
  XLU: "Utilities",
  XLRE: "Real Estate",
  XLB: "Materials",
  XLC: "Communication",
  GLD: "Gold",
  SLV: "Silver",
  GDX: "Gold Miners",
};

// Top stocks per sector (curated universe of ~200 liquid stocks)
const SECTOR_UNIVERSE: Record<string, string[]> = {
  Technology: [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AMD", "CRM", "INTC",
    "AVGO", "ORCL", "ADBE", "NOW", "SHOP", "PLTR", "CRWD", "NET", "SNOW", "MDB",
  ],
  Financial: [
    "JPM", "BAC", "WFC", "GS", "MS", "V", "MA", "AXP", "BLK", "SCHW",
    "C", "USB", "PNC", "TFC", "COF",
  ],
  Healthcare: [
    "JNJ", "UNH", "LLY", "PFE", "ABBV", "MRK", "TMO", "ABT", "BMY", "AMGN",
    "GILD", "ISRG", "MDT", "CVS", "HCA",
  ],
  Energy: [
    "XOM", "CVX", "COP", "SLB", "EOG", "MPC", "PSX", "VLO", "OXY", "HAL",
    "DVN", "FANG", "HES", "BKR", "KMI",
  ],
  "Consumer Discretionary": [
    "HD", "NKE", "MCD", "SBUX", "TGT", "LOW", "TJX", "BKNG", "ORLY", "DHI",
    "LEN", "GM", "F", "YUM", "CMG",
  ],
  "Consumer Staples": [
    "WMT", "PG", "COST", "KO", "PEP", "CL", "PM", "MO", "MDLZ", "KHC",
    "DG", "DLTR", "STZ", "SYY", "KR",
  ],
  Industrial: [
    "CAT", "HON", "UNP", "RTX", "GE", "BA", "LMT", "DE", "MMM", "FDX",
    "UPS", "WM", "ETN", "EMR", "ITW",
  ],
  Communication: [
    "NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS", "CHTR", "EA", "TTWO", "RBLX",
    "SPOT", "SNAP", "PINS", "ZM",
  ],
  "Gold Miners": [
    "NEM", "GOLD", "AEM", "FNV", "WPM", "KGC", "AGI", "BTG", "HMY", "AU",
  ],
  Utilities: [
    "NEE", "DUK", "SO", "D", "AEP", "SRE", "EXC", "XEL", "ED", "WEC",
    "ES", "AWK", "ATO", "CMS", "DTE",
  ],
  "Real Estate": [
    "PLD", "AMT", "CCI", "EQIX", "PSA", "SPG", "O", "WELL", "DLR", "AVB",
    "EQR", "VTR", "ARE", "MAA", "UDR",
  ],
  Materials: [
    "LIN", "APD", "ECL", "SHW", "NUE", "FCX", "STLD", "DOW", "DD", "VMC",
  ],
};

export type SectorPerformance = {
  sector: string;
  etf: string;
  dayChange: number;
  weekChange: number; // approximated from 5-day price
};

// 1. Get sector ETF performance to identify trending sectors
export async function getSectorPerformance(env: Env): Promise<SectorPerformance[]> {
  const results: SectorPerformance[] = [];
  const etfTickers = Object.keys(SECTOR_ETFS);

  // Fetch ETF quotes in batches of 5
  for (let i = 0; i < etfTickers.length; i += 5) {
    const batch = etfTickers.slice(i, i + 5);
    const settled = await Promise.allSettled(
      batch.map(async (etf) => {
        const res = await fetch(`${FINNHUB_BASE}/quote?symbol=${etf}`, {
          headers: { "X-Finnhub-Token": env.FINNHUB_API_KEY },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as {
          c: number;
          dp: number;
          pc: number;
          o: number;
        };
        if (data.c === 0) return null;
        return {
          sector: SECTOR_ETFS[etf],
          etf,
          dayChange: data.dp || 0,
          // Rough 5-day extrapolation from daily change
          weekChange: ((data.c - data.pc) / data.pc) * 100 * 5,
        };
      }),
    );
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value) results.push(r.value);
    }
    // Respect Finnhub rate limit between batches
    if (i + 5 < etfTickers.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
  }

  return results.sort((a, b) => b.dayChange - a.dayChange);
}

// 2. Build dynamic watchlist from top performing sectors
export async function buildDynamicWatchlist(env: Env): Promise<string[]> {
  const sectorPerf = await getSectorPerformance(env);

  // Store sector performance in KV for dashboard/AI
  await env.CACHE.put("sector_performance", JSON.stringify(sectorPerf), {
    expirationTtl: 900,
  });

  const watchlist: string[] = [];

  // Always include major indices
  watchlist.push("SPY", "QQQ");

  // Take top 4 performing sectors, pick top 5 stocks from each
  const topSectors = sectorPerf
    .filter((s) => s.sector !== "Gold" && s.sector !== "Silver")
    .slice(0, 4);

  for (const sector of topSectors) {
    const stocks = SECTOR_UNIVERSE[sector.sector] ?? [];
    watchlist.push(...stocks.slice(0, 5));
  }

  // If gold/silver is performing well (top 3), add gold miners
  const goldPerf = sectorPerf.find((s) => s.etf === "GLD");
  if (goldPerf && sectorPerf.indexOf(goldPerf) < 3) {
    const goldMiners = SECTOR_UNIVERSE["Gold Miners"] ?? [];
    watchlist.push(...goldMiners.slice(0, 5));
  }

  // Always include a few blue chips as anchors
  const anchors = ["AAPL", "MSFT", "NVDA", "JPM", "JNJ"];
  watchlist.push(...anchors);

  // Deduplicate
  const unique = [...new Set(watchlist)];

  // Save to KV
  await env.CACHE.put("dynamic_watchlist", JSON.stringify(unique), {
    expirationTtl: 900,
  });

  console.log(
    `[screener] Built watchlist: ${unique.length} stocks from ${topSectors.map((s) => s.sector).join(", ")}`,
  );

  return unique;
}

// 3. Get company profile from Finnhub
export type CompanyProfile = {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  ceo: string;
  marketCap: number;
  employees: number;
  ipo: string;
  exchange: string;
  weburl: string;
};

export async function getCompanyProfile(
  ticker: string,
  env: Env,
): Promise<CompanyProfile | null> {
  // Check KV cache first (profiles don't change often)
  const cached = await env.CACHE.get(`profile:${ticker}`);
  if (cached) return JSON.parse(cached) as CompanyProfile;

  try {
    const res = await fetch(`${FINNHUB_BASE}/stock/profile2?symbol=${ticker}`, {
      headers: { "X-Finnhub-Token": env.FINNHUB_API_KEY },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    if (!data.name) return null;

    const profile: CompanyProfile = {
      ticker: String(data.ticker || ticker),
      name: String(data.name || ""),
      sector: String(data.finnhubIndustry || ""),
      industry: String(data.finnhubIndustry || ""),
      ceo: "", // Finnhub profile2 doesn't include CEO
      marketCap: Number(data.marketCapitalization || 0),
      employees: 0,
      ipo: String(data.ipo || ""),
      exchange: String(data.exchange || ""),
      weburl: String(data.weburl || ""),
    };

    // Cache for 7 days
    await env.CACHE.put(`profile:${ticker}`, JSON.stringify(profile), {
      expirationTtl: 7 * 86400,
    });

    return profile;
  } catch {
    return null;
  }
}

// 4. Get insider transactions
export type InsiderTransaction = {
  name: string;
  share: number;
  change: number;
  transactionDate: string;
  transactionCode: string; // P=Purchase, S=Sale
};

export async function getInsiderTransactions(
  ticker: string,
  env: Env,
): Promise<InsiderTransaction[]> {
  const cached = await env.CACHE.get(`insider:${ticker}`);
  if (cached) return JSON.parse(cached) as InsiderTransaction[];

  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/insider-transactions?symbol=${ticker}`,
      { headers: { "X-Finnhub-Token": env.FINNHUB_API_KEY } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: InsiderTransaction[] };
    const transactions = (data.data ?? []).slice(0, 10);

    await env.CACHE.put(`insider:${ticker}`, JSON.stringify(transactions), {
      expirationTtl: 86400,
    });

    return transactions;
  } catch {
    return [];
  }
}

// 5. Build company context string for AI prompt
export async function buildCompanyContext(
  tickers: string[],
  env: Env,
): Promise<string> {
  const contexts: string[] = [];

  // Only fetch profiles for first 10 to respect rate limits
  for (const ticker of tickers.slice(0, 10)) {
    const profile = await getCompanyProfile(ticker, env);
    const insiders = await getInsiderTransactions(ticker, env);

    if (!profile) continue;

    let ctx = `${ticker} (${profile.name}): ${profile.sector}, MCap $${(profile.marketCap / 1000).toFixed(1)}B`;

    // Add insider activity summary
    const recentBuys = insiders.filter((t) => t.transactionCode === "P");
    const recentSells = insiders.filter((t) => t.transactionCode === "S");
    if (recentBuys.length > 0 || recentSells.length > 0) {
      ctx += ` | Insider: ${recentBuys.length} buys, ${recentSells.length} sells (30d)`;
    }

    contexts.push(ctx);
  }

  return contexts.join("\n");
}

// 6. Get cached watchlist (for use by other modules)
export async function getCachedWatchlist(env: Env): Promise<string[]> {
  const cached = await env.CACHE.get("dynamic_watchlist");
  if (cached) return JSON.parse(cached) as string[];
  // Fallback to building fresh
  return buildDynamicWatchlist(env);
}

// 7. Get cached sector performance
export async function getCachedSectorPerformance(
  env: Env,
): Promise<SectorPerformance[]> {
  const cached = await env.CACHE.get("sector_performance");
  if (cached) return JSON.parse(cached) as SectorPerformance[];
  return getSectorPerformance(env);
}

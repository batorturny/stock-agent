import { XMLParser } from "fast-xml-parser";
import type { Env, FeedSource } from "../types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export const FEED_SOURCES: FeedSource[] = [
  // Financial news
  {
    name: "Reuters Business",
    url: "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best",
    type: "financial",
  },
  {
    name: "CNBC",
    url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
    type: "financial",
  },
  {
    name: "MarketWatch",
    url: "https://feeds.marketwatch.com/marketwatch/topstories/",
    type: "financial",
  },
  {
    name: "Yahoo Finance",
    url: "https://finance.yahoo.com/news/rssindex",
    type: "financial",
  },
  {
    name: "Seeking Alpha",
    url: "https://seekingalpha.com/market_currents.xml",
    type: "financial",
  },
  {
    name: "Investopedia",
    url: "https://www.investopedia.com/feedbuilder/feed/getfeed/?feedName=rss_headline",
    type: "financial",
  },
  {
    name: "Motley Fool",
    url: "https://www.fool.com/feeds/index.aspx",
    type: "financial",
  },
  // Tech news (market-moving)
  {
    name: "TechCrunch",
    url: "https://techcrunch.com/feed/",
    type: "tech",
  },
  {
    name: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
    type: "tech",
  },
  // Entertainment / tabloid (brand impact)
  {
    name: "Variety",
    url: "https://variety.com/feed/",
    type: "tabloid",
  },
  {
    name: "Deadline",
    url: "https://deadline.com/feed/",
    type: "tabloid",
  },
];

// ─── NewsAPI.org — targeted company news for stocks we track ───

const NEWSAPI_BASE = "https://newsapi.org/v2/everything";

// Companies/keywords to search on NewsAPI — maps to tickers the AI can reference
const NEWSAPI_QUERIES: { query: string; tickers: string[] }[] = [
  { query: "Tesla OR Elon Musk", tickers: ["TSLA"] },
  { query: "Apple iPhone OR Apple Mac OR Tim Cook", tickers: ["AAPL"] },
  { query: "Nvidia AI chips OR Jensen Huang", tickers: ["NVDA"] },
  { query: "Microsoft Azure OR Satya Nadella", tickers: ["MSFT"] },
  { query: "Amazon AWS OR Andy Jassy", tickers: ["AMZN"] },
  { query: "Meta Zuckerberg OR Facebook Instagram", tickers: ["META"] },
  { query: "Google Alphabet OR Sundar Pichai", tickers: ["GOOGL"] },
  { query: "JPMorgan OR Jamie Dimon", tickers: ["JPM"] },
  { query: "Goldman Sachs OR Wall Street banks", tickers: ["GS"] },
  { query: "Federal Reserve OR interest rate OR inflation", tickers: [] }, // macro
  { query: "stock market crash OR market rally OR S&P 500", tickers: [] }, // macro
  { query: "SEC insider trading OR corporate scandal", tickers: [] }, // regulatory
  { query: "Netflix streaming OR Disney Plus", tickers: ["NFLX", "DIS"] },
  { query: "AMD chips OR Intel semiconductor", tickers: ["AMD", "INTC"] },
  { query: "Eli Lilly Ozempic OR weight loss drug", tickers: ["LLY"] },
];

interface NewsAPIArticle {
  source: { name: string };
  title: string;
  description: string | null;
  url: string;
  publishedAt: string;
}

interface NewsAPIResponse {
  status: string;
  totalResults: number;
  articles: NewsAPIArticle[];
}

/**
 * Fetch targeted news for tracked companies via NewsAPI.org
 * Free tier: 100 requests/day, so we rotate queries across runs
 */
export async function fetchNewsAPI(
  env: Env,
): Promise<{ source: string; title: string; url: string; summary: string; publishedAt: string }[]> {
  const apiKey = env.NEWSAPI_KEY;
  if (!apiKey) return [];

  const results: { source: string; title: string; url: string; summary: string; publishedAt: string }[] = [];

  // Rotate: pick 3 queries per run (100 req/day limit ÷ 15min intervals = ~4 queries max)
  const runIndex = await getNewsAPIRotationIndex(env);
  const startIdx = (runIndex * 3) % NEWSAPI_QUERIES.length;
  const queries = [
    NEWSAPI_QUERIES[startIdx % NEWSAPI_QUERIES.length],
    NEWSAPI_QUERIES[(startIdx + 1) % NEWSAPI_QUERIES.length],
    NEWSAPI_QUERIES[(startIdx + 2) % NEWSAPI_QUERIES.length],
  ];

  // From date: 7 days ago (NewsAPI free tier limit)
  const fromDate = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

  for (const q of queries) {
    try {
      const url = `${NEWSAPI_BASE}?q=${encodeURIComponent(q.query)}&from=${fromDate}&sortBy=publishedAt&pageSize=5&language=en&apiKey=${apiKey}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "StockAgent/1.0" },
      });

      if (!res.ok) {
        console.error(`[newsapi] Failed for "${q.query}": ${res.status}`);
        continue;
      }

      const data = (await res.json()) as NewsAPIResponse;
      if (data.status !== "ok" || !data.articles) continue;

      for (const article of data.articles.slice(0, 5)) {
        if (!article.title || article.title === "[Removed]") continue;
        results.push({
          source: `NewsAPI:${article.source?.name ?? "Unknown"}`,
          title: article.title,
          url: article.url,
          summary: stripHtmlForNewsAPI(article.description || ""),
          publishedAt: article.publishedAt || new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error(`[newsapi] Error for "${q.query}":`, err);
    }
  }

  // Increment rotation index
  await setNewsAPIRotationIndex(runIndex + 1, env);

  console.log(`[newsapi] Fetched ${results.length} articles from ${queries.length} queries`);
  return results;
}

function stripHtmlForNewsAPI(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim().slice(0, 500);
}

async function getNewsAPIRotationIndex(env: Env): Promise<number> {
  const val = await env.CACHE.get("newsapi_rotation_idx");
  return val ? parseInt(val, 10) : 0;
}

async function setNewsAPIRotationIndex(idx: number, env: Env): Promise<void> {
  await env.CACHE.put("newsapi_rotation_idx", String(idx), { expirationTtl: 86400 });
}

type RSSItem = {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  "dc:date"?: string;
};

function parseRSSItems(xml: string): RSSItem[] {
  try {
    const parsed = parser.parse(xml);

    // RSS 2.0 format
    const rssItems = parsed?.rss?.channel?.item;
    if (rssItems) {
      return Array.isArray(rssItems) ? rssItems : [rssItems];
    }

    // Atom format
    const atomEntries = parsed?.feed?.entry;
    if (atomEntries) {
      const entries = Array.isArray(atomEntries) ? atomEntries : [atomEntries];
      return entries.map((e: Record<string, unknown>) => ({
        title: typeof e.title === "object" ? (e.title as Record<string, string>)?.["#text"] || "" : String(e.title || ""),
        link: typeof e.link === "object" ? (e.link as Record<string, string>)?.["@_href"] || "" : String(e.link || ""),
        description: String(e.summary || e.content || ""),
        pubDate: String(e.published || e.updated || ""),
      }));
    }

    return [];
  } catch {
    return [];
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim().slice(0, 500);
}

export async function fetchFeed(
  source: FeedSource
): Promise<{ source: string; items: RSSItem[] }> {
  try {
    const res = await fetch(source.url, {
      headers: {
        "User-Agent": "StockAgent/1.0 RSS Reader",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
    });
    if (!res.ok) return { source: source.name, items: [] };
    const xml = await res.text();
    const items = parseRSSItems(xml).slice(0, 10); // Max 10 per source
    return { source: source.name, items };
  } catch {
    return { source: source.name, items: [] };
  }
}

export async function fetchAllFeeds(
  env?: Env,
): Promise<
  { source: string; title: string; url: string; summary: string; publishedAt: string }[]
> {
  const results = await Promise.allSettled(
    FEED_SOURCES.map((s) => fetchFeed(s))
  );

  const allItems: {
    source: string;
    title: string;
    url: string;
    summary: string;
    publishedAt: string;
  }[] = [];

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { source, items } = result.value;
    for (const item of items) {
      allItems.push({
        source,
        title: typeof item.title === "string" ? item.title : "",
        url: typeof item.link === "string" ? item.link : "",
        summary: stripHtml(item.description || ""),
        publishedAt: item.pubDate || item["dc:date"] || new Date().toISOString(),
      });
    }
  }

  // Fetch NewsAPI.org articles for tracked companies
  if (env) {
    try {
      const newsApiItems = await fetchNewsAPI(env);
      allItems.push(...newsApiItems);
    } catch (err) {
      console.error("[news-fetcher] NewsAPI fetch failed:", err);
    }
  }

  return allItems;
}

export async function deduplicateNews(
  items: { url: string }[],
  env: Env
): Promise<string[]> {
  // Return URLs that are NOT already in cache (new items)
  const newUrls: string[] = [];
  for (const item of items) {
    const exists = await env.CACHE.get(`news:${item.url}`);
    if (!exists) {
      newUrls.push(item.url);
      // Mark as seen for 7 days
      await env.CACHE.put(`news:${item.url}`, "1", {
        expirationTtl: 7 * 24 * 60 * 60,
      });
    }
  }
  return newUrls;
}

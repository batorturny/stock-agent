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

export async function fetchAllFeeds(): Promise<
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

import { formatDate, sentimentColor, sentimentLabel } from "~/lib/utils";
import type { NewsItem } from "~/lib/api";

export function NewsFeed({ items }: { items: NewsItem[] }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-zinc-400">
        News Feed
      </h2>

      {items.length === 0 ? (
        <p className="text-center text-sm text-zinc-500">
          No news scraped yet. News updates every 15 minutes.
        </p>
      ) : (
        <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-zinc-800/50 p-3 transition-colors hover:border-zinc-700"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <a
                  href={item.url.startsWith("http") ? item.url : "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium leading-snug text-zinc-200 hover:text-white"
                >
                  {item.title}
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-zinc-500">{item.source}</span>
                <span className="text-zinc-700">•</span>
                <span className={sentimentColor(item.sentiment)}>
                  {sentimentLabel(item.sentiment)}
                  {item.sentiment !== null && ` (${item.sentiment.toFixed(2)})`}
                </span>
                {item.impact !== null && item.impact > 0 && (
                  <>
                    <span className="text-zinc-700">•</span>
                    <span className="text-zinc-400">
                      Impact: {item.impact}/10
                    </span>
                  </>
                )}
                {item.tickers.length > 0 && (
                  <>
                    <span className="text-zinc-700">•</span>
                    <span className="font-mono text-brand">
                      {item.tickers.join(", ")}
                    </span>
                  </>
                )}
                <span className="ml-auto text-zinc-600">
                  {item.publishedAt ? formatDate(item.publishedAt) : formatDate(item.scrapedAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

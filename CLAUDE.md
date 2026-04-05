## Project

**Stock Agent — AI-Powered Virtual Stock Portfolio Manager**

Autonomous AI agent that monitors financial and tabloid news, runs sentiment analysis via Claude API, manages a virtual $5,000 portfolio with automated trading rules, and displays everything on a real-time dashboard.

### Stack

- **Backend**: Cloudflare Workers + Hono 4.x
- **Database**: Cloudflare D1 (SQLite via Drizzle ORM)
- **Cache**: Cloudflare KV (price cache, news dedup)
- **AI**: Anthropic Claude API (Haiku for sentiment, daily analysis)
- **Price Data**: Finnhub API (free tier, 60 req/min)
- **Frontend**: React 19 + Vite 6 + Tailwind CSS 4 + lightweight-charts v5
- **Deploy**: Cloudflare Workers (API) + Cloudflare Pages (Dashboard)
- **Monorepo**: pnpm workspaces + Turborepo

### Architecture

```
apps/worker/     — Cloudflare Worker (API + Cron triggers)
apps/dashboard/  — React SPA (Cloudflare Pages)
```

### Cron Schedules

- `*/5 * * * *` — Price fetch (Finnhub, only during market hours)
- `*/15 * * * *` — News scrape (RSS feeds + sentiment analysis)
- `0 6 * * *` — Daily AI analysis + auto-trade execution
- `0 7 * * 1` — Weekly performance report

### Portfolio Rules

- $5,000 starting capital, max 10 positions
- Max 20% in single stock, min 10% cash reserve
- Stop-loss at -8%, take-profit at +15% (half position)
- Min 70% AI confidence for buy orders

### Key Commands

```bash
pnpm install                    # Install all deps
pnpm --filter worker dev        # Start worker locally
pnpm --filter dashboard dev     # Start dashboard locally
pnpm --filter worker db:generate  # Generate Drizzle migrations
pnpm --filter worker db:migrate:local  # Apply migrations locally
```

### Environment Variables (Worker)

Set via `wrangler secret put` or `.dev.vars`:
- `ANTHROPIC_API_KEY` — Claude API key
- `FINNHUB_API_KEY` — Finnhub API key

### Constraints

- No Node.js APIs in Worker code (Workers runtime)
- XML parsing via fast-xml-parser only
- All financial data is virtual/simulated — NOT financial advice
- Free tier API limits: Finnhub 60 req/min, Alpha Vantage 25 req/day

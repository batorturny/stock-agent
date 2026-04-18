## Project

**Stock Agent — AI-Powered Virtual Stock Portfolio Manager**

Autonomous AI agent that monitors financial and tabloid news, runs sentiment analysis via Claude API, manages a virtual $5,000 portfolio with automated trading rules, and displays everything on a real-time dashboard.

### Stack

- **Backend**: Cloudflare Workers + Hono 4.x
- **Database**: Cloudflare D1 (SQLite via Drizzle ORM)
- **Cache**: Cloudflare KV (price cache, news dedup)
- **AI**: Google Gemini 2.0 Flash (sentiment, daily analysis)
- **Price Data**: Finnhub API (free tier, 60 req/min)
- **News**: RSS feeds + NewsAPI.org (targeted company news)
- **Insider Trading**: Finnhub insider-transactions + insider-sentiment (SEC Form 4)
- **Frontend**: React 19 + Vite 6 + Tailwind CSS 4 + lightweight-charts v5
- **Deploy**: Cloudflare Workers (API) + Cloudflare Pages (Dashboard)
- **Monorepo**: pnpm workspaces + Turborepo

### Architecture

```
apps/worker/     — Cloudflare Worker (API + Cron triggers)
apps/dashboard/  — React SPA (Cloudflare Pages)
```

### Cron Schedules

- `* * * * *` — Price fetch + stop-loss/take-profit + copy trade execution
- `*/15 * * * *` — News scrape (RSS + NewsAPI.org + sentiment)
- `:00` hourly — Politician trades + SEC Form 4 insider filings
- `20:00 UTC` — Daily AI analysis + auto-trade execution
- `07:00 UTC Mon` — Weekly performance report

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
- `GEMINI_API_KEY` — Google Gemini API key
- `FINNHUB_API_KEY` — Finnhub API key
- `NEWSAPI_KEY` — NewsAPI.org API key (in wrangler.toml vars)
- `APP_PASSWORD` — Dashboard login password
- `NTFY_TOPIC` — Push notifications via ntfy.sh
- `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` — Alpaca paper trading (optional)

### API Endpoints

Core:
- `GET /api/portfolio` — Portfolio state
- `GET /api/picks` — Current AI recommendations
- `GET /api/news` — Aggregated news feed
- `GET /api/prices/:ticker` — Price data + 30d history
- `GET /api/history` — Trade history
- `GET /api/performance` — Portfolio vs SPY comparison

Insider Trading:
- `GET /api/insider/buys` — Recent insider purchases
- `GET /api/insider/sells` — Recent insider sales
- `GET /api/insider/signals` — Active cluster buy/sell signals
- `POST /api/trigger/insider-filings` — Manual insider fetch

Triggers:
- `POST /api/trigger/prices` — Manual price fetch
- `POST /api/trigger/news` — Manual news scrape
- `POST /api/trigger/analysis` — Manual daily analysis

### Constraints

- No Node.js APIs in Worker code (Workers runtime)
- XML parsing via fast-xml-parser only
- All financial data is virtual/simulated — NOT financial advice
- Free tier API limits: Finnhub 60 req/min, NewsAPI.org 100 req/day

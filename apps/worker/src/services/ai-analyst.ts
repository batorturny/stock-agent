import type { Env, DailyAnalysis, SentimentResult } from "../types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-2.0-flash";

// ---------------------------------------------------------------------------
// Gemini API helper
// ---------------------------------------------------------------------------

async function callGemini(
  prompt: string,
  env: Env,
  maxTokens = 4096
): Promise<string> {
  const response = await fetch(
    `${GEMINI_BASE}/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.3,
        },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`Gemini API error: ${response.status} — ${body}`);
    throw new Error(`AI analysis service unavailable (${response.status})`);
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned empty response");
  }
  return text;
}

/**
 * Extract JSON from a Gemini response that may contain markdown fences.
 */
function extractJson(text: string): string {
  // Try fenced code block first
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Fall back to raw JSON object or array
  const raw = text.match(/[\[{][\s\S]*[\]}]/);
  if (raw) return raw[0];
  throw new Error("No valid JSON found in AI response");
}

// ---------------------------------------------------------------------------
// SYSTEM PROMPT — Aggressive Fund Manager
// ---------------------------------------------------------------------------

const DAILY_ANALYSIS_PROMPT = `You are an aggressive US equity fund manager at a quantitative hedge fund.
Your mandate: MAXIMIZE RETURNS. You manage a concentrated portfolio of NYSE/NASDAQ listed US stocks.

## CORE PRINCIPLES
- Cash sitting idle is a SIN. Minimum 85% of portfolio value MUST be invested at all times.
- Target: beat the S&P 500 by 5%+ annually through news-driven catalyst trading.
- React to news IMMEDIATELY — positive catalysts = BUY, negative catalysts = SELL. Speed is alpha.
- Position sizing: 10-20% of portfolio per stock. Maximum 8 concurrent positions.
- ONLY trade NYSE/NASDAQ listed US equities with >$1B market cap and >1M daily volume.

## BUY TRIGGERS (act when ANY apply)
- Positive news with impact > 5 (earnings beat, analyst upgrade, M&A target, product launch)
- Strong momentum: price up >3% on high volume with positive news catalyst
- Sector rotation into the stock's sector with fundamental support
- Analyst upgrade or price target raise from major bank

## SELL TRIGGERS (act when ANY apply)
- Stop loss hit: position down -5% from entry — NO EXCEPTIONS, cut the loss
- Negative news with impact > 6 (earnings miss, FDA rejection, lawsuit, downgrade)
- Sector rotation signal away from stock's sector
- Better opportunity available and portfolio is fully invested (swap weakest for strongest)

## CHAIN OF THOUGHT
Before making any recommendation, reason through:
1. What is the NEWS CATALYST driving this trade?
2. What is the RISK/REWARD ratio? (target upside vs stop loss downside)
3. How does this fit the PORTFOLIO ALLOCATION? (sector balance, position count)
4. What is the TIME HORIZON for the catalyst to play out?

## CURRENT STATE

### Portfolio
{portfolio_state}

### News — Last 24 Hours (with sentiment scores)
{recent_news}

### 7-Day News Trend Summary
{news_trends}

### Price History (30 days)
{price_history}

---

Respond ONLY with valid JSON in this exact format (no markdown, no code blocks, just raw JSON):

{
  "reasoning": "2-4 sentence chain-of-thought: current market regime, key catalysts today, portfolio positioning rationale",
  "buyPicks": [
    {
      "ticker": "AAPL",
      "currentPrice": 185.00,
      "targetPrice": 210.00,
      "stopLoss": 175.75,
      "confidence": 0.85,
      "timeHorizon": "2-4 weeks",
      "reasoning": "Why this is a buy NOW — cite specific news catalyst",
      "catalysts": ["Q4 earnings beat +12%", "iPhone 16 demand above estimates"],
      "risks": ["China macro slowdown", "Services growth deceleration"]
    }
  ],
  "sellWarnings": [
    {
      "ticker": "XYZ",
      "reason": "Specific reason with news reference",
      "urgency": "high"
    }
  ],
  "portfolioActions": [
    {
      "action": "buy",
      "ticker": "AAPL",
      "shares": 10,
      "reason": "Catalyst-driven entry",
      "riskRewardRatio": 2.5,
      "noActionReason": null
    }
  ],
  "marketOutlook": "1-2 sentence macro view driving positioning",
  "riskLevel": "low",
  "keyNarratives": ["narrative 1", "narrative 2"],
  "watchlistAdditions": ["TICKER1", "TICKER2"]
}

HARD RULES:
- BUY confidence must be >= 0.65. Below that, put on watchlist instead.
- EVERY buy MUST have currentPrice, targetPrice, and stopLoss. targetPrice > currentPrice. stopLoss < currentPrice.
- riskRewardRatio = (targetPrice - currentPrice) / (currentPrice - stopLoss). Must be >= 1.5 or don't trade it.
- If portfolio cash > 15% of totalValue and good opportunities exist, you MUST deploy capital.
- If a current holding triggers a SELL signal, include it in BOTH sellWarnings AND portfolioActions with action "sell".
- For hold positions with no action, set noActionReason explaining why you're holding.
- Only NYSE/NASDAQ listed US stocks with real tickers.
- shares must be a positive integer, max 500 per action.`;

// ---------------------------------------------------------------------------
// SENTIMENT PROMPT — Calibrated with anchors
// ---------------------------------------------------------------------------

const SENTIMENT_PROMPT = `You are a financial news sentiment classifier for US equities. Score each article precisely.

## CALIBRATION ANCHORS (use these as reference points)
- Earnings beat +10%: sentiment +0.5, impact 6
- Earnings miss -10%: sentiment -0.4, impact 6
- Analyst upgrade (major bank): sentiment +0.3, impact 5
- Analyst downgrade: sentiment -0.3, impact 5
- FDA approval: sentiment +0.7, impact 8
- FDA rejection: sentiment -0.8, impact 9
- Acquisition announcement: sentiment +0.3, impact 7
- Major lawsuit filed: sentiment -0.5, impact 6
- CEO resignation: sentiment -0.3, impact 5
- Stock split announced: sentiment +0.1, impact 3
- Macro rate hike: sentiment -0.2, impact 7
- Sector-wide selloff: sentiment -0.4, impact 8
- Noise/fluff article: sentiment 0.0, impact 1

## COMPANY → TICKER MAPPING (common examples)
Apple=AAPL, Microsoft=MSFT, Alphabet/Google=GOOGL, Amazon=AMZN, Meta/Facebook=META,
Tesla=TSLA, Nvidia=NVDA, Netflix=NFLX, JPMorgan=JPM, Goldman Sachs=GS,
Berkshire Hathaway=BRK.B, Johnson & Johnson=JNJ, Visa=V, Mastercard=MA,
Walmart=WMT, Disney=DIS, PayPal=PYPL, AMD=AMD, Intel=INTC, Salesforce=CRM,
Uber=UBER, Airbnb=ABNB, Coinbase=COIN, Palantir=PLTR, CrowdStrike=CRWD,
Broadcom=AVGO, Eli Lilly=LLY, UnitedHealth=UNH, Costco=COST, Home Depot=HD

## FIELDS
- tickers: array of affected US stock tickers (use mapping above; empty if no specific company)
- sentiment: float from -1.0 (catastrophic) to +1.0 (extremely bullish). Use calibration anchors.
- impact: integer 1-10. 1=noise, 3=minor move, 5=sector-relevant, 7=market-moving, 10=systemic crisis
- timeHorizon: "immediate" (today), "week", "month", "long" (>3 months)
- category: one of "earnings"|"macro"|"regulatory"|"M&A"|"product"|"legal"|"analyst"|"other"

Respond ONLY with valid JSON, no markdown.`;

const SENTIMENT_SINGLE_PROMPT = `${SENTIMENT_PROMPT}

Analyze this article:
Title: {title}
Summary: {summary}

{"tickers":["AAPL"],"sentiment":0.5,"impact":6,"timeHorizon":"week","category":"earnings"}`;

const SENTIMENT_BATCH_PROMPT = `${SENTIMENT_PROMPT}

Analyze each numbered article below. Return a JSON array with one object per article, in the same order.

{articles}

Return format: [{"tickers":["AAPL"],"sentiment":0.5,"impact":6,"timeHorizon":"week","category":"earnings"}, ...]`;

// ---------------------------------------------------------------------------
// Daily Analysis
// ---------------------------------------------------------------------------

export async function runDailyAnalysis(
  portfolioState: string,
  recentNews: string,
  newsTrends: string,
  priceHistory: string,
  env: Env
): Promise<DailyAnalysis> {
  const prompt = DAILY_ANALYSIS_PROMPT
    .replace("{portfolio_state}", portfolioState)
    .replace("{recent_news}", recentNews)
    .replace("{news_trends}", newsTrends)
    .replace("{price_history}", priceHistory);

  const text = await callGemini(prompt, env, 6144);
  const json = extractJson(text);
  const parsed = JSON.parse(json);
  return validateDailyAnalysis(parsed);
}

// ---------------------------------------------------------------------------
// Single-article Sentiment (backward compatible)
// ---------------------------------------------------------------------------

export async function analyzeSentiment(
  title: string,
  summary: string,
  env: Env
): Promise<SentimentResult> {
  const fallback: SentimentResult = {
    tickers: [],
    sentiment: 0,
    impact: 0,
    timeHorizon: "week",
    category: "other",
  };

  try {
    const prompt = SENTIMENT_SINGLE_PROMPT
      .replace("{title}", title)
      .replace("{summary}", summary || "No summary available");

    const text = await callGemini(prompt, env, 512);
    const json = extractJson(text);
    const result = JSON.parse(json);
    return validateSentimentResult(result) ?? fallback;
  } catch (err) {
    console.error("Sentiment analysis failed:", err);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Batch Sentiment — multiple articles in ONE Gemini call
// ---------------------------------------------------------------------------

export async function analyzeSentimentBatch(
  articles: { title: string; summary: string }[],
  env: Env
): Promise<SentimentResult[]> {
  const fallback: SentimentResult = {
    tickers: [],
    sentiment: 0,
    impact: 0,
    timeHorizon: "week",
    category: "other",
  };

  if (articles.length === 0) return [];

  // For single article, use the simpler call
  if (articles.length === 1) {
    const result = await analyzeSentiment(
      articles[0].title,
      articles[0].summary,
      env
    );
    return [result];
  }

  try {
    const numberedList = articles
      .map(
        (a, i) =>
          `${i + 1}. Title: ${a.title}\n   Summary: ${a.summary || "No summary available"}`
      )
      .join("\n\n");

    const prompt = SENTIMENT_BATCH_PROMPT.replace("{articles}", numberedList);

    // Allow ~512 tokens per article, capped at 8192
    const maxTokens = Math.min(articles.length * 512, 8192);
    const text = await callGemini(prompt, env, maxTokens);
    const json = extractJson(text);
    const parsed = JSON.parse(json);

    if (!Array.isArray(parsed)) {
      console.error("Batch sentiment: expected array, got", typeof parsed);
      return articles.map(() => fallback);
    }

    // Map results, filling missing entries with fallback
    return articles.map((_, i) => {
      const item = parsed[i];
      if (!item) return fallback;
      return validateSentimentResult(item) ?? fallback;
    });
  } catch (err) {
    console.error("Batch sentiment analysis failed:", err);
    // Fall back to individual calls
    console.log("Falling back to individual sentiment calls...");
    const results: SentimentResult[] = [];
    for (const article of articles) {
      const result = await analyzeSentiment(article.title, article.summary, env);
      results.push(result);
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_TICKER = /^[A-Z]{1,5}(\.[A-Z])?$/;
const VALID_CATEGORIES = new Set([
  "earnings",
  "macro",
  "regulatory",
  "M&A",
  "product",
  "legal",
  "analyst",
  "other",
]);

function validateSentimentResult(raw: unknown): SentimentResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const tickers = Array.isArray(obj.tickers)
    ? obj.tickers.filter(
        (t): t is string => typeof t === "string" && VALID_TICKER.test(t)
      )
    : [];

  const sentiment =
    typeof obj.sentiment === "number"
      ? Math.max(-1, Math.min(1, obj.sentiment))
      : 0;

  const impact =
    typeof obj.impact === "number"
      ? Math.max(0, Math.min(10, Math.round(obj.impact)))
      : 0;

  const timeHorizon =
    typeof obj.timeHorizon === "string" &&
    ["immediate", "week", "month", "long"].includes(obj.timeHorizon)
      ? obj.timeHorizon
      : "week";

  const category =
    typeof obj.category === "string" && VALID_CATEGORIES.has(obj.category)
      ? (obj.category as SentimentResult["category"])
      : "other";

  return { tickers, sentiment, impact, timeHorizon, category };
}

function validateDailyAnalysis(raw: unknown): DailyAnalysis {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  // Chain-of-thought reasoning
  const reasoning =
    typeof obj.reasoning === "string" && obj.reasoning.length > 0
      ? obj.reasoning
      : "No reasoning provided";

  // Buy picks — require currentPrice, targetPrice, stopLoss
  const buyPicks = Array.isArray(obj.buyPicks)
    ? obj.buyPicks.filter((p: Record<string, unknown>) => {
        if (typeof p.ticker !== "string" || !VALID_TICKER.test(p.ticker))
          return false;
        if (typeof p.confidence !== "number" || p.confidence < 0 || p.confidence > 1)
          return false;
        if (typeof p.currentPrice !== "number" || p.currentPrice <= 0) return false;
        if (typeof p.targetPrice !== "number" || p.targetPrice <= 0) return false;
        if (typeof p.stopLoss !== "number" || p.stopLoss <= 0) return false;
        // targetPrice must be above currentPrice, stopLoss below
        if (p.targetPrice <= p.currentPrice) return false;
        if (p.stopLoss >= p.currentPrice) return false;
        return true;
      })
    : [];

  // Sell warnings
  const sellWarnings = Array.isArray(obj.sellWarnings)
    ? obj.sellWarnings.filter(
        (w: Record<string, unknown>) =>
          typeof w.ticker === "string" &&
          VALID_TICKER.test(w.ticker) &&
          typeof w.reason === "string"
      )
    : [];

  // Portfolio actions — with riskRewardRatio and noActionReason
  const portfolioActions = Array.isArray(obj.portfolioActions)
    ? obj.portfolioActions
        .filter((a: Record<string, unknown>) => {
          if (!["buy", "sell", "hold"].includes(a.action as string)) return false;
          if (typeof a.ticker !== "string" || !VALID_TICKER.test(a.ticker))
            return false;
          if (typeof a.shares !== "number" || a.shares <= 0 || a.shares > 500)
            return false;
          return true;
        })
        .map((a: Record<string, unknown>) => ({
          action: a.action as "buy" | "sell" | "hold",
          ticker: a.ticker as string,
          shares: a.shares as number,
          reason: typeof a.reason === "string" ? a.reason : "",
          riskRewardRatio:
            typeof a.riskRewardRatio === "number" ? a.riskRewardRatio : undefined,
          noActionReason:
            typeof a.noActionReason === "string" ? a.noActionReason : undefined,
        }))
    : [];

  return {
    reasoning,
    buyPicks: buyPicks as DailyAnalysis["buyPicks"],
    sellWarnings: sellWarnings as DailyAnalysis["sellWarnings"],
    portfolioActions,
    marketOutlook:
      typeof obj.marketOutlook === "string" ? obj.marketOutlook : "N/A",
    riskLevel: ["low", "medium", "high"].includes(obj.riskLevel as string)
      ? (obj.riskLevel as DailyAnalysis["riskLevel"])
      : "medium",
    keyNarratives: Array.isArray(obj.keyNarratives)
      ? obj.keyNarratives.filter((n): n is string => typeof n === "string")
      : [],
    watchlistAdditions: Array.isArray(obj.watchlistAdditions)
      ? obj.watchlistAdditions.filter(
          (t): t is string => typeof t === "string" && VALID_TICKER.test(t)
        )
      : [],
  };
}

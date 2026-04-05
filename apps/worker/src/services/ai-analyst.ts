import type { Env, DailyAnalysis } from "../types";

const DAILY_ANALYSIS_PROMPT = `You are a professional stock market analyst AI. Based on the data below, provide detailed analysis and recommendations.

## Current Portfolio
{portfolio_state}

## News from the last 24 hours (with sentiment scores)
{recent_news}

## 7-day news trend
{news_trends}

## Price data (30 days)
{price_history}

---

Respond ONLY with valid JSON in this exact format:

{
  "buyPicks": [
    {
      "ticker": "AAPL",
      "targetPrice": 195.00,
      "confidence": 0.82,
      "timeHorizon": "1-2 months",
      "reasoning": "...",
      "catalysts": ["..."],
      "risks": ["..."]
    }
  ],
  "sellWarnings": [
    {
      "ticker": "XYZ",
      "reason": "...",
      "urgency": "high"
    }
  ],
  "portfolioActions": [
    {
      "action": "buy",
      "ticker": "...",
      "shares": 0,
      "reason": "..."
    }
  ],
  "marketOutlook": "1-2 month summary...",
  "riskLevel": "low",
  "keyNarratives": ["...", "..."],
  "watchlistAdditions": ["..."]
}

RULES:
- Only recommend BUY at 70%+ confidence
- Back every recommendation with specific news/data
- Diversify across sectors
- Flag the biggest risks
- Be realistic, don't hype`;

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

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    console.error(`Anthropic API error: ${response.status}`);
    throw new Error("AI analysis service unavailable");
  }

  const data = (await response.json()) as {
    content: { type: string; text: string }[];
  };
  const text = data.content[0]?.text || "{}";

  // Extract JSON from response (may be wrapped in markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No valid JSON found in AI response");
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return validateDailyAnalysis(parsed);
}

export async function analyzeSentiment(
  title: string,
  summary: string,
  env: Env
): Promise<{
  tickers: string[];
  sentiment: number;
  impact: number;
  timeHorizon: string;
}> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: `Analyze this financial news headline and summary. Return JSON only.

Title: ${title}
Summary: ${summary}

{
  "tickers": ["AAPL"],
  "sentiment": 0.5,
  "impact": 5,
  "timeHorizon": "week"
}

tickers: affected stock tickers (empty array if none). sentiment: -1.0 to 1.0. impact: 0-10. timeHorizon: immediate|week|month|long.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    return { tickers: [], sentiment: 0, impact: 0, timeHorizon: "week" };
  }

  const data = (await response.json()) as {
    content: { type: string; text: string }[];
  };
  const text = data.content[0]?.text || "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { tickers: [], sentiment: 0, impact: 0, timeHorizon: "week" };
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { tickers: [], sentiment: 0, impact: 0, timeHorizon: "week" };
  }
}

const VALID_TICKER = /^[A-Z]{1,5}$/;

function validateDailyAnalysis(raw: unknown): DailyAnalysis {
  const obj = raw as Record<string, unknown>;

  const buyPicks = Array.isArray(obj.buyPicks)
    ? obj.buyPicks.filter(
        (p: Record<string, unknown>) =>
          typeof p.ticker === "string" &&
          VALID_TICKER.test(p.ticker) &&
          typeof p.confidence === "number" &&
          p.confidence >= 0 &&
          p.confidence <= 1
      )
    : [];

  const sellWarnings = Array.isArray(obj.sellWarnings)
    ? obj.sellWarnings.filter(
        (w: Record<string, unknown>) =>
          typeof w.ticker === "string" && typeof w.reason === "string"
      )
    : [];

  const portfolioActions = Array.isArray(obj.portfolioActions)
    ? obj.portfolioActions.filter((a: Record<string, unknown>) => {
        if (!["buy", "sell", "hold"].includes(a.action as string)) return false;
        if (typeof a.ticker !== "string" || !VALID_TICKER.test(a.ticker))
          return false;
        if (typeof a.shares !== "number" || a.shares <= 0 || a.shares > 500)
          return false;
        return true;
      })
    : [];

  return {
    buyPicks: buyPicks as DailyAnalysis["buyPicks"],
    sellWarnings: sellWarnings as DailyAnalysis["sellWarnings"],
    portfolioActions: portfolioActions as DailyAnalysis["portfolioActions"],
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

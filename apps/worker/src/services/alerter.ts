import type { Env } from "../types";

export type AlertLevel = "info" | "warning" | "critical";

// ─── Hungarian alert message templates ───

export const HU_ALERTS = {
  stopLoss: (ticker: string, pct: string) =>
    `🔴 STOP-LOSS: ${ticker} eladva ${pct}-nál! Ne vedd vissza legalább 24 órán belül.`,
  takeProfit: (ticker: string, pct: string) =>
    `🟢 PROFIT: ${ticker} fél pozíció eladva +${pct}-nál. A maradék trailing stop-pal fut.`,
  buy: (shares: number, ticker: string, price: string, reason: string) =>
    `🟢 VÉTEL: ${shares}x ${ticker} @ $${price} — ${reason}`,
  sell: (shares: number, ticker: string, price: string, reason: string) =>
    `🔴 ELADÁS: ${shares}x ${ticker} @ $${price} — ${reason}`,
  holdPeriod: (ticker: string, hoursLeft: number) =>
    `🟡 TARTÁS: ${ticker} még ${Math.ceil(hoursLeft)}h tartási időn belül. Légy türelmes!`,
  highCash: (pct: string) =>
    `⚠️ MAGAS CASH: Portfólió ${pct}%-a készpénzben. Nyomd meg a Frissítés gombot!`,
  newsWarning: (ticker: string, title: string) =>
    `📰 FIGYELEM: Negatív hír a(z) ${ticker}-ről: "${title}". Figyelj rá!`,
  weeklyReport: (pnl: string, spy: string, accuracy: string) =>
    `📊 HETI: Portfólió ${pnl} (SPY: ${spy}). AI pontosság: ${accuracy}.`,
  drawdownHalt: (pct: string) =>
    `🚨 DRAWDOWN: Portfólió ${pct}%-ot esett a csúcstól! Vásárlás leállítva.`,
  circuitBreaker: (ticker: string, pct: string) =>
    `🚨 CIRCUIT BREAKER: ${ticker} ${pct}%-ot esett egy nap alatt! Automatikus eladás felfüggesztve.`,
  rotation: (fromTicker: string, toTicker: string, shares: number, price: string) =>
    `🔄 ROTÁCIÓ: ${fromTicker} → ${shares}x ${toTicker} @ $${price}`,
  limitOrderFilled: (action: string, shares: number, ticker: string, price: string) =>
    `📋 LIMIT ORDER: ${action === "buy" ? "VÉTEL" : "ELADÁS"} ${shares}x ${ticker} @ $${price} — teljesítve!`,
};

export async function sendAlert(
  message: string,
  level: AlertLevel,
  env: Env
): Promise<void> {
  const emoji = level === "critical" ? "🔴" : level === "warning" ? "🟡" : "🟢";
  const formatted = `${emoji} **Stock Agent** — ${message}`;

  // Always store in KV for dashboard display
  const rawAlerts = await env.CACHE.get("alerts");
  const alerts: Array<{ message: string; level: AlertLevel; timestamp: string }> =
    rawAlerts ? JSON.parse(rawAlerts) : [];
  alerts.unshift({ message, level, timestamp: new Date().toISOString() });
  await env.CACHE.put("alerts", JSON.stringify(alerts.slice(0, 50)), {
    expirationTtl: 86400,
  });

  // Send to webhook if configured (Discord/Telegram)
  const webhookUrl = env.ALERT_WEBHOOK;
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: formatted }),
      });
    } catch {
      console.error(`[alerter] Webhook delivery failed for: ${message}`);
    }
  }

  // Send push notification via ntfy.sh
  const ntfyTopic = getNtfyTopic(env);
  if (ntfyTopic) {
    try {
      const priority = level === "critical" ? "5" : level === "warning" ? "3" : "2";
      const tags =
        level === "critical"
          ? "rotating_light"
          : level === "warning"
            ? "warning"
            : "chart_with_upwards_trend";
      await fetch(`https://ntfy.sh/${ntfyTopic}`, {
        method: "POST",
        headers: {
          Title: "Stock Agent",
          Priority: priority,
          Tags: tags,
        },
        body: message,
      });
    } catch {
      console.error(`[alerter] ntfy.sh delivery failed for: ${message}`);
    }
  }
}

/** Derive a stable ntfy topic from env config or Finnhub key hash */
export function getNtfyTopic(env: Env): string | null {
  if (env.NTFY_TOPIC) return env.NTFY_TOPIC;
  // Auto-generate from last 8 chars of Finnhub key for uniqueness
  if (env.FINNHUB_API_KEY && env.FINNHUB_API_KEY.length >= 8) {
    return "stock-agent-" + env.FINNHUB_API_KEY.slice(-8).toLowerCase();
  }
  return null;
}

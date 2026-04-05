import type { Env } from "../types";

export type AlertLevel = "info" | "warning" | "critical";

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
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: formatted }),
    });
  } catch {
    // Webhook failure should not break the flow
    console.error(`[alerter] Webhook delivery failed for: ${message}`);
  }
}

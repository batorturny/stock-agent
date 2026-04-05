export const MANIFEST_JSON = JSON.stringify({
  name: "Stock Agent",
  short_name: "StockAgent",
  description: "AI-powered virtual stock portfolio manager",
  start_url: "/",
  display: "standalone",
  background_color: "#eff6ff",
  theme_color: "#3b82f6",
  orientation: "any",
  icons: [
    {
      src: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'><rect width='512' height='512' rx='96' fill='%233b82f6'/><path d='M260 160h120m0 0v120m0-120L260 280l-60-60-90 90' fill='none' stroke='white' stroke-width='36' stroke-linecap='round' stroke-linejoin='round'/></svg>",
      sizes: "512x512",
      type: "image/svg+xml",
      purpose: "any maskable",
    },
  ],
});

export const SERVICE_WORKER_JS = `
const CACHE_NAME = 'stock-agent-v2';
const ALERT_CHECK_KEY = 'last-alert-check-ts';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clean old caches
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ),
    ])
  );
});

// Handle notification click — open/focus dashboard
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const tradeId = e.notification.data?.tradeId;
  const url = tradeId ? '/?trade=' + tradeId : '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('/') && 'focus' in client) {
          if (tradeId) client.postMessage({ type: 'SHOW_TRADE', tradeId });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

// Background alert polling — runs even when tab is not focused
// NOTE: This only works while the service worker is alive (browser open).
// For true background push when browser is closed, use ntfy.sh app.
async function checkForNewAlerts() {
  try {
    const res = await fetch('/api/alerts');
    if (!res.ok) return;
    const data = await res.json();
    const alerts = data.alerts || [];
    if (alerts.length === 0) return;

    // Get last check timestamp from cache
    const cache = await caches.open(CACHE_NAME);
    const lastCheckRes = await cache.match(ALERT_CHECK_KEY);
    const lastTimestamp = lastCheckRes ? await lastCheckRes.text() : '2000-01-01T00:00:00.000Z';

    // Filter to only new alerts
    const newAlerts = alerts.filter((a) => a.timestamp > lastTimestamp);
    if (newAlerts.length === 0) return;

    // Check if any client (tab) is currently focused
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const hasFocusedClient = clients.some((c) => c.visibilityState === 'visible');

    // Only show SW notifications when no tab is focused (avoid duplicates)
    if (!hasFocusedClient) {
      // Show up to 3 most recent alerts
      for (const alert of newAlerts.slice(0, 3)) {
        const levelIcon = alert.level === 'critical' ? '🔴' : alert.level === 'warning' ? '🟡' : '🟢';
        await self.registration.showNotification('Stock Agent ' + levelIcon, {
          body: alert.message,
          tag: 'alert-' + alert.timestamp.replace(/[:.]/g, '-'),
          data: { url: '/' },
          badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="20" fill="%233b82f6"/></svg>',
          requireInteraction: alert.level === 'critical',
        });
      }
    }

    // Update last check timestamp
    await cache.put(ALERT_CHECK_KEY, new Response(alerts[0].timestamp));
  } catch (e) {
    // Silent fail — background polling should not throw
  }
}

// Poll every 60 seconds while SW is alive
let pollInterval = null;
function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(checkForNewAlerts, 60000);
  // Also check immediately on start
  checkForNewAlerts();
}

// Start polling when SW activates or receives a message
self.addEventListener('activate', () => startPolling());
self.addEventListener('message', (e) => {
  if (e.data?.type === 'START_POLLING') startPolling();
  if (e.data?.type === 'PING') {
    // Keep-alive ping from the dashboard
    e.source?.postMessage({ type: 'PONG' });
  }
});
`;

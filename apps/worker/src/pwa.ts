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
const CACHE_NAME = 'stock-agent-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// Handle notification click — open trade detail
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const tradeId = e.notification.data?.tradeId;
  const url = tradeId ? '/?trade=' + tradeId : '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('/') && 'focus' in client) {
          client.postMessage({ type: 'SHOW_TRADE', tradeId });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
`;

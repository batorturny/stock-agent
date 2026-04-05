export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stock Agent — AI Portfolio</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%233b82f6' stroke-width='2'><path d='M13 7h8m0 0v8m0-8l-8 8-4-4-6 6'/></svg>">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#3b82f6">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Stock Agent">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--blue:#3b82f6;--blue-light:#60a5fa;--blue-dark:#1d4ed8;--blue-bg:#eff6ff;--blue-50:#dbeafe;--green:#16a34a;--red:#dc2626;--gray:#64748b;--gray-light:#f1f5f9;--white:#ffffff;--dark:#0f172a;--card-bg:var(--white);--card-border:#e2e8f0;--card-shadow:rgba(0,0,0,.04);--body-bg:var(--blue-bg);--table-border:#f1f5f9;--header-bg:var(--white);--footer-bg:var(--white);--disclaimer-bg:#fef3c7;--disclaimer-border:#fde68a;--disclaimer-color:#92400e;--modal-bg:var(--white);--modal-shadow:rgba(0,0,0,.2);--warn-bg:#fef2f2;--warn-border:#fecaca;--hover-bg:#f8fafc}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:var(--body-bg);color:var(--dark);min-height:100vh;transition:background .3s,color .3s}
.header{background:var(--header-bg);border-bottom:2px solid var(--blue);padding:1rem 1.5rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;transition:background .3s}
.logo{display:flex;align-items:center;gap:.75rem}
.logo-icon{width:36px;height:36px;background:var(--blue);border-radius:10px;display:flex;align-items:center;justify-content:center;color:white;font-size:1.2rem}
.logo h1{font-size:1.25rem;color:var(--dark)}
.logo .tag{font-size:.6rem;background:var(--blue-50);color:var(--blue);padding:2px 8px;border-radius:99px;font-weight:600}
.header-right{font-size:.8rem;color:var(--gray);display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.last-refresh{font-size:.7rem;color:var(--gray);opacity:.8}
.btn{padding:6px 14px;border-radius:8px;border:none;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .15s}
.btn-blue{background:var(--blue);color:white}.btn-blue:hover{background:var(--blue-dark)}
.btn-outline{background:transparent;border:1px solid var(--card-border);color:var(--gray)}.btn-outline:hover{border-color:var(--blue);color:var(--blue)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.status-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px}
.status-ok{background:var(--green)}.status-loading{background:#f59e0b;animation:pulse 1s infinite}
.container{max-width:1200px;margin:0 auto;padding:1.5rem}
.grid{display:grid;gap:1.25rem}
.grid-4{grid-template-columns:repeat(4,1fr)}
.grid-2{grid-template-columns:1fr 1fr}
.grid-5{grid-template-columns:repeat(5,1fr)}
.card{background:var(--card-bg);border-radius:12px;padding:1.25rem;border:1px solid var(--card-border);box-shadow:0 1px 3px var(--card-shadow);transition:transform .2s,box-shadow .2s,background .3s}
.card:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.08)}
.card-title{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:.75rem;font-weight:600}
.stat-value{font-size:1.75rem;font-weight:700;transition:color .3s}
.stat-label{font-size:.8rem;color:var(--gray);margin-top:.15rem}
.positive{color:var(--green)}.negative{color:var(--red)}
.flash-green{animation:flashGreen .6s ease}
.flash-red{animation:flashRed .6s ease}
@keyframes flashGreen{0%{color:var(--green);text-shadow:0 0 8px rgba(22,163,74,.4)}100%{text-shadow:none}}
@keyframes flashRed{0%{color:var(--red);text-shadow:0 0 8px rgba(220,38,38,.4)}100%{text-shadow:none}}
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.table{width:100%;border-collapse:collapse;font-size:.85rem;min-width:500px}
.table th{text-align:left;padding:.6rem .5rem;border-bottom:2px solid var(--card-border);color:var(--gray);font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.table td{padding:.6rem .5rem;border-bottom:1px solid var(--table-border)}
.table tr:last-child td{border-bottom:none}
.table .mono{font-family:'SF Mono',Consolas,monospace;font-weight:600}
.text-right{text-align:right}
.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:.7rem;font-weight:600}
.badge-buy{background:#dcfce7;color:var(--green)}
.badge-sell{background:#fee2e2;color:var(--red)}
.badge-pos{background:#dcfce7;color:var(--green)}
.badge-neg{background:#fee2e2;color:var(--red)}
.badge-neutral{background:var(--gray-light);color:var(--gray)}
.badge-blue{background:var(--blue-50);color:var(--blue)}
.pick-card{border:1px solid var(--card-border);border-radius:10px;padding:1rem;margin-bottom:.75rem;transition:border-color .15s}
.pick-card:hover{border-color:var(--blue-light)}
.pick-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem}
.pick-ticker{font-family:monospace;font-size:1.1rem;font-weight:700;color:var(--blue-dark)}
.pick-conf{font-size:.75rem}
.pick-reason{font-size:.8rem;color:var(--gray);line-height:1.4}
.pick-meta{display:flex;gap:1rem;margin-top:.5rem;font-size:.7rem;color:var(--gray)}
.news-item{padding:.75rem 0;border-bottom:1px solid var(--table-border)}
.news-item:last-child{border-bottom:none}
.news-item.hidden{display:none}
.news-title{font-size:.85rem;color:var(--dark);text-decoration:none;font-weight:500;line-height:1.3}
.news-title:hover{color:var(--blue)}
.news-meta{display:flex;gap:.75rem;margin-top:.35rem;font-size:.7rem;color:var(--gray);flex-wrap:wrap;align-items:center}
.news-list{max-height:500px;overflow-y:auto}
.news-filter-bar{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:.75rem}
.ticker-filter{padding:2px 8px;border-radius:99px;font-size:.65rem;font-weight:700;font-family:monospace;cursor:pointer;border:1px solid var(--card-border);background:var(--card-bg);color:var(--blue);transition:all .15s;user-select:none}
.ticker-filter:hover,.ticker-filter.active{background:var(--blue);color:white;border-color:var(--blue)}
.outlook-box{background:var(--blue-50);border:1px solid var(--blue);border-radius:10px;padding:1rem;font-size:.85rem;line-height:1.5;color:var(--dark);margin-bottom:1rem}
.warn-item{display:flex;justify-content:space-between;align-items:center;padding:.6rem .75rem;background:var(--warn-bg);border:1px solid var(--warn-border);border-radius:8px;margin-bottom:.5rem;font-size:.85rem}
.empty{text-align:center;padding:2rem;color:var(--gray);font-size:.85rem}
.footer{text-align:center;padding:1.5rem;font-size:.7rem;color:var(--gray);border-top:1px solid var(--card-border);margin-top:1.5rem;background:var(--footer-bg);transition:background .3s}
.disclaimer{background:var(--disclaimer-bg);border:1px solid var(--disclaimer-border);border-radius:8px;padding:.6rem 1rem;font-size:.7rem;color:var(--disclaimer-color);margin-bottom:1.25rem}
.loading{text-align:center;padding:3rem;color:var(--gray)}
.dot-pulse{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--blue);animation:pulse 1s infinite;margin:0 2px}
.dot-pulse:nth-child(2){animation-delay:.2s}
.dot-pulse:nth-child(3){animation-delay:.4s}
@keyframes pulse{0%,80%,100%{opacity:.3}40%{opacity:1}}

/* Chart */
.chart-card{background:var(--card-bg);border-radius:12px;padding:1.25rem;border:1px solid var(--card-border);box-shadow:0 1px 3px var(--card-shadow);margin-bottom:1.25rem;transition:background .3s}
.chart-card .card-title{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:.5rem;font-weight:600}
.chart-svg{width:100%;height:auto}
.chart-label{font-size:10px;fill:var(--gray);font-family:system-ui,sans-serif}
.chart-grid{stroke:var(--card-border);stroke-width:1}
.chart-line{fill:none;stroke:var(--blue);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.chart-area{fill:url(#chartGradient);opacity:.3}
.chart-dot{fill:var(--blue);r:3}
.chart-dot:last-of-type{r:4;stroke:white;stroke-width:2}

/* Trade stats */
.trade-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:.75rem;margin-bottom:1rem}
.trade-stat{background:var(--card-bg);border:1px solid var(--card-border);border-radius:8px;padding:.75rem;text-align:center;transition:background .3s}
.trade-stat-value{font-size:1.1rem;font-weight:700}
.trade-stat-label{font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--gray);margin-top:.2rem}

/* Sparkline */
.sparkline{display:inline-block;vertical-align:middle;margin-left:4px}
.sparkline polyline{fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}

/* Mobile card layout for positions */
.pos-cards{display:none}
.pos-card{background:var(--card-bg);border:1px solid var(--card-border);border-radius:10px;padding:1rem;margin-bottom:.75rem;transition:background .3s}
.pos-card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem}
.pos-card-ticker{font-family:monospace;font-size:1.1rem;font-weight:700;color:var(--blue-dark)}
.pos-card-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;font-size:.8rem}
.pos-card-grid dt{color:var(--gray)}
.pos-card-grid dd{text-align:right;font-weight:600}

/* Responsive */
@media(max-width:768px){
  .container{padding:.75rem}
  .grid-4{grid-template-columns:1fr 1fr;gap:.75rem}
  .grid-2{grid-template-columns:1fr;gap:.75rem}
  .grid-5{grid-template-columns:1fr 1fr;gap:.75rem}
  .trade-stats{grid-template-columns:1fr 1fr;gap:.75rem}
  .trade-stats .trade-stat:last-child{grid-column:span 2}
  .header{flex-direction:column;gap:.5rem;align-items:flex-start;padding:.75rem 1rem}
  .header-right{flex-wrap:wrap;gap:.5rem;font-size:.7rem}
  .card{padding:1rem;border-radius:10px}
  .card-title{font-size:.65rem}
  .stat-value{font-size:1.3rem}
  .pos-table-wrap{display:none}
  .pos-cards{display:block!important}
  .table-wrap{margin:0 -.5rem}
  .table{min-width:400px;font-size:.75rem}
  .table th,.table td{padding:.4rem .3rem}
  .modal{padding:1rem;border-radius:12px;max-height:90vh}
  .pick-card{padding:.75rem}
  .news-list{max-height:400px}
  .pwa-install{bottom:auto;top:.5rem;left:auto;right:.5rem;font-size:.7rem;padding:.4rem .75rem}
  .disclaimer{font-size:.65rem;padding:.5rem .75rem}
  .footer{font-size:.6rem;padding:1rem}
}
@media(max-width:380px){
  .grid-4{grid-template-columns:1fr}
  .stat-value{font-size:1.1rem}
  .header h1{font-size:1rem}
}

/* Modal */
.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:100;display:flex;align-items:center;justify-content:center;padding:1rem;opacity:0;pointer-events:none;transition:opacity .2s}
.modal-overlay.active{opacity:1;pointer-events:all}
.modal{background:var(--modal-bg);border-radius:16px;max-width:600px;width:100%;max-height:85vh;overflow-y:auto;padding:1.5rem;box-shadow:0 20px 60px var(--modal-shadow);transform:translateY(20px);transition:transform .2s,background .3s}
.modal-overlay.active .modal{transform:translateY(0)}
.modal-close{float:right;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--gray);padding:0 .25rem}
.modal-close:hover{color:var(--dark)}
.modal h2{font-size:1.1rem;margin-bottom:1rem;display:flex;align-items:center;gap:.5rem}
.modal-section{margin-bottom:1.25rem}
.modal-section h3{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--gray);margin-bottom:.5rem;font-weight:600}
.modal-reason{background:var(--blue-50);border-radius:8px;padding:.75rem;font-size:.85rem;line-height:1.5;color:var(--dark)}
.modal-news{border:1px solid var(--card-border);border-radius:8px;padding:.6rem .75rem;margin-bottom:.5rem}
.modal-news a{color:var(--blue-dark);font-size:.85rem;font-weight:500;text-decoration:none}
.modal-news a:hover{text-decoration:underline}
.modal-news .meta{font-size:.7rem;color:var(--gray);margin-top:.25rem}
.notif-banner{position:fixed;bottom:1rem;right:1rem;background:var(--card-bg);border:1px solid var(--blue);border-radius:12px;padding:1rem 1.25rem;box-shadow:0 8px 30px rgba(0,0,0,.15);z-index:50;display:none;max-width:360px;cursor:pointer;animation:slideUp .3s ease}
@keyframes slideUp{from{transform:translateY(100px);opacity:0}to{transform:translateY(0);opacity:1}}
.pwa-install{position:fixed;bottom:1rem;left:1rem;background:var(--blue);color:white;border:none;border-radius:10px;padding:.6rem 1rem;font-size:.8rem;font-weight:600;cursor:pointer;z-index:50;display:none;box-shadow:0 4px 12px rgba(59,130,246,.4)}

/* Dark mode */
@media(prefers-color-scheme:dark){
  :root{
    --blue-bg:#0c1222;--blue-50:#1e3a5f;--white:#1a1a2e;--dark:#e2e8f0;--gray:#94a3b8;--gray-light:#1e293b;
    --card-bg:#16213e;--card-border:#2d3a5c;--card-shadow:rgba(0,0,0,.2);--body-bg:#0c1222;
    --table-border:#1e293b;--header-bg:#16213e;--footer-bg:#16213e;
    --disclaimer-bg:#422006;--disclaimer-border:#854d0e;--disclaimer-color:#fbbf24;
    --modal-bg:#16213e;--modal-shadow:rgba(0,0,0,.5);
    --warn-bg:#3b1010;--warn-border:#7f1d1d;--hover-bg:#1e293b
  }
  .news-title{color:var(--dark)}
  .badge-buy{background:#064e3b;color:#34d399}
  .badge-sell{background:#450a0a;color:#fca5a5}
  .badge-pos{background:#064e3b;color:#34d399}
  .badge-neg{background:#450a0a;color:#fca5a5}
  .badge-neutral{background:#1e293b;color:#94a3b8}
  .badge-blue{background:#1e3a5f;color:#60a5fa}
  .ticker-filter{background:var(--card-bg);border-color:var(--card-border);color:var(--blue-light)}
  .ticker-filter:hover,.ticker-filter.active{background:var(--blue);color:white;border-color:var(--blue)}
  .chart-label{fill:var(--gray)}
  .chart-grid{stroke:var(--card-border)}
  .chart-dot:last-of-type{stroke:var(--card-bg)}
}
</style>
</head>
<body>

<div class="header">
  <div class="logo">
    <div class="logo-icon">📈</div>
    <div>
      <h1>Stock Agent</h1>
    </div>
    <span class="tag">AI-Powered</span>
  </div>
  <div class="header-right">
    <span id="status-text"><span class="status-dot status-ok"></span> NYSE Watchlist</span>
    <span class="last-refresh" id="last-refresh"></span>
    <button class="btn btn-blue" id="btn-refresh" onclick="triggerAll()">🔄 Frissítés</button>
    <span>$5,000 Induló Tőke</span>
  </div>
</div>

<div class="container">
  <div class="disclaimer">
    ⚠️ Ez egy szimulációs rendszer — kizárólag oktatási célokat szolgál. NEM pénzügyi tanácsadás. Virtuális portfólió, valós pénz nincs benne.
  </div>

  <!-- Portfolio Value Chart -->
  <div class="chart-card" id="chart-section" style="display:none">
    <div class="card-title">📈 Portfólió Érték Alakulása</div>
    <div id="chart-container"></div>
  </div>

  <!-- Stats -->
  <div id="stats" class="grid grid-4" style="margin-bottom:1.25rem">
    <div class="card"><div class="card-title">Portfólió Értéke</div><div class="stat-value" id="s-total" data-key="total">—</div><div class="stat-label">Összes érték</div></div>
    <div class="card"><div class="card-title">Szabad Tőke</div><div class="stat-value" id="s-cash" data-key="cash">—</div><div class="stat-label">Készpénz egyenleg</div></div>
    <div class="card"><div class="card-title">Nyereség / Veszteség</div><div class="stat-value" id="s-pnl" data-key="pnl">—</div><div class="stat-label" id="s-pnl-pct"></div></div>
    <div class="card"><div class="card-title">Nyitott Pozíciók</div><div class="stat-value" id="s-pos" data-key="pos">—</div><div class="stat-label">Részvények</div></div>
  </div>

  <!-- Positions Table -->
  <div id="positions-section" class="card" style="margin-bottom:1.25rem;display:none">
    <div class="card-title">Nyitott Pozíciók</div>
    <div class="pos-table-wrap">
      <table class="table">
        <thead><tr><th>Ticker</th><th>Trend</th><th class="text-right">Db</th><th class="text-right">Átlagár</th><th class="text-right">Aktuális</th><th class="text-right">P/L</th><th class="text-right">P/L%</th></tr></thead>
        <tbody id="pos-body"></tbody>
      </table>
    </div>
    <div class="pos-cards" id="pos-cards"></div>
  </div>

  <!-- Two column: Picks + News -->
  <div class="grid grid-2" style="margin-bottom:1.25rem">
    <!-- AI Picks -->
    <div class="card">
      <div class="card-title">🤖 AI Ajánlások</div>
      <div id="outlook-box" class="outlook-box" style="display:none"></div>
      <div id="picks-list"></div>
      <div id="warns-list" style="margin-top:1rem"></div>
    </div>
    <!-- News -->
    <div class="card">
      <div class="card-title">📰 Hírek</div>
      <div id="news-filter-bar" class="news-filter-bar" style="display:none"></div>
      <div id="news-list" class="news-list"></div>
    </div>
  </div>

  <!-- Trade History -->
  <div class="card">
    <div class="card-title">📊 Trade Történet</div>
    <div id="trade-stats"></div>
    <div id="trades-section"></div>
  </div>
</div>

<!-- Trade Detail Modal -->
<div class="modal-overlay" id="trade-modal" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <h2 id="modal-title">Trade Részletek</h2>
    <div id="modal-content"></div>
  </div>
</div>

<!-- PWA Install Button -->
<button class="pwa-install" id="pwa-install" onclick="installPwa()">📲 Telepítés</button>

<!-- Trade Notification Banner -->
<div class="notif-banner" id="notif-banner" onclick="openLastTrade()"></div>

<div class="footer">
  Stock Agent v1.0 — AI-powered virtuális részvénykezelő · Cloudflare Workers + Gemini AI
</div>

<script>
const $ = s => document.getElementById(s);
const fmt = n => '$' + n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct = n => (n>=0?'+':'') + n.toFixed(2) + '%';
const cls = n => n >= 0 ? 'positive' : 'negative';
const badgeCls = n => n >= 0 ? 'badge-pos' : 'badge-neg';
const fmtDate = s => { try{return new Date(s).toLocaleDateString('hu-HU',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}catch(e){return s} };

// Track previous values for flash animation
const prevValues = {};
let lastRefreshTime = null;

function animateValue(el, newText, numericValue, key) {
  if (!key) { el.textContent = newText; return; }
  const prev = prevValues[key];
  prevValues[key] = numericValue;
  if (prev !== undefined && prev !== numericValue) {
    el.classList.remove('flash-green', 'flash-red');
    void el.offsetWidth; // reflow
    el.classList.add(numericValue > prev ? 'flash-green' : 'flash-red');
  }
}

function updateRefreshTimer() {
  if (!lastRefreshTime) return;
  const diff = Math.floor((Date.now() - lastRefreshTime) / 60000);
  const el = $('last-refresh');
  if (diff < 1) el.textContent = 'Utolsó frissítés: most';
  else el.textContent = 'Utolsó frissítés: ' + diff + ' perce';
}

// Portfolio chart from trade history
function renderChart(dataPoints) {
  if (!dataPoints || dataPoints.length < 2) { $('chart-section').style.display = 'none'; return; }
  $('chart-section').style.display = 'block';

  const W = 800, H = 200, PAD_L = 55, PAD_R = 15, PAD_T = 15, PAD_B = 30;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const values = dataPoints.map(d => d.value);
  const minV = Math.min(...values) * 0.995;
  const maxV = Math.max(...values) * 1.005;
  const rangeV = maxV - minV || 1;

  const points = dataPoints.map((d, i) => {
    const x = PAD_L + (i / (dataPoints.length - 1)) * chartW;
    const y = PAD_T + chartH - ((d.value - minV) / rangeV) * chartH;
    return x.toFixed(1) + ',' + y.toFixed(1);
  });

  const polyline = points.join(' ');
  const firstX = PAD_L;
  const lastX = PAD_L + chartW;
  const bottomY = PAD_T + chartH;
  const polygon = firstX + ',' + bottomY + ' ' + polyline + ' ' + lastX + ',' + bottomY;

  // Grid lines
  const gridCount = 4;
  let gridLines = '';
  for (let i = 0; i <= gridCount; i++) {
    const y = PAD_T + (i / gridCount) * chartH;
    const val = maxV - (i / gridCount) * rangeV;
    gridLines += '<line x1="'+PAD_L+'" y1="'+y.toFixed(1)+'" x2="'+(W-PAD_R)+'" y2="'+y.toFixed(1)+'" class="chart-grid" stroke-dasharray="4,4"/>';
    gridLines += '<text x="'+(PAD_L-8)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end" class="chart-label">$'+val.toFixed(0)+'</text>';
  }

  // X-axis labels (show ~5)
  let xLabels = '';
  const step = Math.max(1, Math.floor(dataPoints.length / 5));
  for (let i = 0; i < dataPoints.length; i += step) {
    const x = PAD_L + (i / (dataPoints.length - 1)) * chartW;
    xLabels += '<text x="'+x.toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" class="chart-label">'+dataPoints[i].label+'</text>';
  }
  // Always show last label
  if ((dataPoints.length - 1) % step !== 0) {
    const lx = PAD_L + chartW;
    xLabels += '<text x="'+lx.toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" class="chart-label">'+dataPoints[dataPoints.length-1].label+'</text>';
  }

  // Dots
  let dots = '';
  dataPoints.forEach((d, i) => {
    const x = PAD_L + (i / (dataPoints.length - 1)) * chartW;
    const y = PAD_T + chartH - ((d.value - minV) / rangeV) * chartH;
    dots += '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" class="chart-dot"/>';
  });

  $('chart-container').innerHTML = '<svg viewBox="0 0 '+W+' '+H+'" class="chart-svg" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--blue)" stop-opacity="0.4"/><stop offset="100%" stop-color="var(--blue)" stop-opacity="0.02"/></linearGradient></defs>'+gridLines+xLabels+'<polygon points="'+polygon+'" class="chart-area"/><polyline points="'+polyline+'" class="chart-line"/>'+dots+'</svg>';
}

// Sparkline SVG for a ticker
function sparklineSvg(prices, color) {
  if (!prices || prices.length < 2) return '';
  const W = 60, H = 20, pad = 2;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices.map((v, i) => {
    const x = pad + (i / (prices.length - 1)) * (W - pad * 2);
    const y = pad + (H - pad * 2) - ((v - min) / range) * (H - pad * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  const strokeColor = color || (prices[prices.length-1] >= prices[0] ? 'var(--green)' : 'var(--red)');
  return '<svg class="sparkline" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'"><polyline points="'+pts+'" style="stroke:'+strokeColor+'"/></svg>';
}

// News ticker filter
let activeNewsFilter = null;
function filterNews(ticker) {
  if (activeNewsFilter === ticker) {
    activeNewsFilter = null;
    document.querySelectorAll('.ticker-filter').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.news-item').forEach(el => el.classList.remove('hidden'));
    return;
  }
  activeNewsFilter = ticker;
  document.querySelectorAll('.ticker-filter').forEach(b => {
    b.classList.toggle('active', b.dataset.ticker === ticker);
  });
  document.querySelectorAll('.news-item').forEach(el => {
    const tickers = (el.dataset.tickers || '').split(',');
    el.classList.toggle('hidden', !tickers.includes(ticker));
  });
}

// Trade stats calculation
function renderTradeStats(trades) {
  if (!trades || trades.length === 0) { $('trade-stats').innerHTML = ''; return; }

  const total = trades.length;
  // Calculate realized P/L from sell trades
  const sells = trades.filter(t => t.action === 'sell');
  let totalPl = 0;
  let bestTrade = null;
  let worstTrade = null;
  let wins = 0;

  sells.forEach(t => {
    const pl = t.realizedPnl || 0;
    totalPl += pl;
    if (pl > 0) wins++;
    if (!bestTrade || pl > (bestTrade.realizedPnl || 0)) bestTrade = t;
    if (!worstTrade || pl < (worstTrade.realizedPnl || 0)) worstTrade = t;
  });

  const winRate = sells.length > 0 ? ((wins / sells.length) * 100).toFixed(0) : '—';
  const bestPl = bestTrade ? fmt(bestTrade.realizedPnl || 0) : '—';
  const worstPl = worstTrade ? fmt(worstTrade.realizedPnl || 0) : '—';

  $('trade-stats').innerHTML =
    '<div class="trade-stats">' +
    '<div class="trade-stat"><div class="trade-stat-value">' + total + '</div><div class="trade-stat-label">Összes Trade</div></div>' +
    '<div class="trade-stat"><div class="trade-stat-value">' + winRate + (winRate !== '—' ? '%' : '') + '</div><div class="trade-stat-label">Win Rate</div></div>' +
    '<div class="trade-stat"><div class="trade-stat-value ' + cls(totalPl) + '">' + fmt(totalPl) + '</div><div class="trade-stat-label">Realizált P/L</div></div>' +
    '<div class="trade-stat"><div class="trade-stat-value positive">' + bestPl + '</div><div class="trade-stat-label">Legjobb Trade</div></div>' +
    '<div class="trade-stat"><div class="trade-stat-value negative">' + worstPl + '</div><div class="trade-stat-label">Legrosszabb Trade</div></div>' +
    '</div>';
}

async function load(path){
  try{const r=await fetch('/api'+path);if(!r.ok)throw new Error(r.status);return r.json()}catch(e){console.error(path,e);return null}
}

// Sparkline price cache
const sparklineCache = {};

async function fetchSparkline(ticker) {
  if (sparklineCache[ticker]) return sparklineCache[ticker];
  try {
    const r = await fetch('/api/prices/' + ticker);
    if (!r.ok) return null;
    const data = await r.json();
    // Expect array of prices or object with prices array
    const prices = Array.isArray(data) ? data.map(d => d.close || d.price || d) : (data.prices || data.history || []).map(d => d.close || d.price || d);
    const last7 = prices.slice(-7);
    if (last7.length >= 2) { sparklineCache[ticker] = last7; return last7; }
  } catch(e) { console.error('Sparkline fetch error for ' + ticker, e); }
  return null;
}

async function refresh(){
  lastRefreshTime = Date.now();
  updateRefreshTimer();

  // Portfolio
  const p = await load('/portfolio');
  if(p){
    const totalEl = $('s-total');
    totalEl.textContent = fmt(p.totalValue);
    animateValue(totalEl, fmt(p.totalValue), p.totalValue, 'total');

    const cashEl = $('s-cash');
    cashEl.textContent = fmt(p.cash);
    animateValue(cashEl, fmt(p.cash), p.cash, 'cash');

    $('s-pnl').innerHTML = '<span class="'+cls(p.totalPnl)+'">'+fmt(p.totalPnl)+'</span>';
    animateValue($('s-pnl'), '', p.totalPnl, 'pnl');

    $('s-pnl-pct').innerHTML = '<span class="'+cls(p.totalPnlPercent)+'">'+pct(p.totalPnlPercent)+' indulás óta</span>';
    $('s-pos').textContent = p.positions.length;
    animateValue($('s-pos'), p.positions.length, p.positions.length, 'pos');

    if(p.positions.length > 0){
      $('positions-section').style.display='block';

      // Desktop table
      $('pos-body').innerHTML = p.positions.map(pos =>
        '<tr><td class="mono">'+pos.ticker+'</td><td id="spark-'+pos.ticker+'"></td><td class="text-right">'+pos.shares+'</td><td class="text-right">'+fmt(pos.avgPrice)+'</td><td class="text-right">'+(pos.currentPrice?fmt(pos.currentPrice):'—')+'</td><td class="text-right '+cls(pos.pnl||0)+'">'+(pos.pnl!=null?fmt(pos.pnl):'—')+'</td><td class="text-right"><span class="badge '+badgeCls(pos.pnlPercent||0)+'">'+(pos.pnlPercent!=null?pct(pos.pnlPercent):'—')+'</span></td></tr>'
      ).join('');

      // Mobile cards
      $('pos-cards').innerHTML = p.positions.map(pos =>
        '<div class="pos-card"><div class="pos-card-header"><span class="pos-card-ticker">'+pos.ticker+'</span><span class="badge '+badgeCls(pos.pnlPercent||0)+'">'+(pos.pnlPercent!=null?pct(pos.pnlPercent):'—')+'</span></div><dl class="pos-card-grid"><dt>Db</dt><dd>'+pos.shares+'</dd><dt>Átlagár</dt><dd>'+fmt(pos.avgPrice)+'</dd><dt>Aktuális</dt><dd>'+(pos.currentPrice?fmt(pos.currentPrice):'—')+'</dd><dt>P/L</dt><dd class="'+cls(pos.pnl||0)+'">'+(pos.pnl!=null?fmt(pos.pnl):'—')+'</dd></dl></div>'
      ).join('');

      // Fetch sparklines async
      p.positions.forEach(async pos => {
        const prices = await fetchSparkline(pos.ticker);
        const el = document.getElementById('spark-' + pos.ticker);
        if (el && prices) el.innerHTML = sparklineSvg(prices);
      });
    } else {
      $('positions-section').style.display='none';
    }
  }

  // Picks
  const picks = await load('/picks');
  if(picks){
    if(picks.outlook && picks.outlook !== 'No analysis yet'){
      $('outlook-box').style.display='block';
      $('outlook-box').textContent = picks.outlook;
    }
    if(picks.picks && picks.picks.length > 0){
      $('picks-list').innerHTML = picks.picks.map(p =>
        '<div class="pick-card"><div class="pick-header"><span class="pick-ticker">'+p.ticker+'</span><div><span class="badge badge-blue">'+Math.round(p.confidence*100)+'% bizalom</span> <span style="font-size:.8rem;color:#64748b">Cél: '+fmt(p.targetPrice)+'</span></div></div><div class="pick-reason">'+p.reasoning+'</div><div class="pick-meta"><span>⏱ '+p.timeHorizon+'</span>'+(p.catalysts&&p.catalysts.length?'<span>🎯 '+p.catalysts.join(', ')+'</span>':'')+'</div></div>'
      ).join('');
    } else {
      $('picks-list').innerHTML = '<div class="empty">Még nincs AI elemzés. A napi elemzés 06:00 UTC-kor fut.</div>';
    }
    if(picks.warnings && picks.warnings.length > 0){
      $('warns-list').innerHTML = '<div class="card-title" style="color:var(--red)">⚠️ Figyelmeztetések</div>' + picks.warnings.map(w =>
        '<div class="warn-item"><div><span class="mono" style="color:var(--red)">'+w.ticker+'</span> <span style="margin-left:.5rem">'+w.reason+'</span></div><span class="badge badge-neg">'+w.urgency+'</span></div>'
      ).join('');
    }
  }

  // News
  const newsData = await load('/news?limit=30');
  if(newsData && newsData.items.length > 0){
    // Collect all tickers for filter bar
    const allTickers = new Set();
    newsData.items.forEach(n => {
      const tickers = Array.isArray(n.tickers) ? n.tickers : [];
      tickers.forEach(t => allTickers.add(t));
    });
    if (allTickers.size > 0) {
      const filterBar = $('news-filter-bar');
      filterBar.style.display = 'flex';
      filterBar.innerHTML = '<span class="ticker-filter" onclick="filterNews(null)" style="border-style:dashed">Összes</span> ' +
        Array.from(allTickers).sort().map(t =>
          '<span class="ticker-filter'+(activeNewsFilter===t?' active':'')+'" data-ticker="'+t+'" onclick="filterNews(&quot;'+t+'&quot;)">'+t+'</span>'
        ).join('');
    }

    $('news-list').innerHTML = newsData.items.map(n => {
      const sentLabel = n.sentiment > 0.3 ? 'Pozitív' : n.sentiment < -0.3 ? 'Negatív' : 'Semleges';
      const sentCls = n.sentiment > 0.3 ? 'badge-pos' : n.sentiment < -0.3 ? 'badge-neg' : 'badge-neutral';
      const url = n.url && n.url.startsWith('http') ? n.url : '#';
      const tickers = Array.isArray(n.tickers) ? n.tickers : [];
      const tickerStr = tickers.join(',');
      const hidden = activeNewsFilter && !tickers.includes(activeNewsFilter) ? ' hidden' : '';
      return '<div class="news-item'+hidden+'" data-tickers="'+tickerStr+'"><a href="'+url+'" target="_blank" rel="noopener" class="news-title">'+n.title+'</a><div class="news-meta"><span>'+n.source+'</span>'+(n.sentiment!=null?'<span class="badge '+sentCls+'">'+sentLabel+'</span>':'')+(n.impact?'<span>Impact: '+n.impact+'/10</span>':'')+(tickers.length?tickers.map(t=>'<span class="ticker-filter" onclick="filterNews(&quot;'+t+'&quot;)" data-ticker="'+t+'" style="font-size:.65rem">'+t+'</span>').join(' '):'')+'<span>'+fmtDate(n.publishedAt||n.scrapedAt)+'</span></div></div>';
    }).join('');
  } else {
    $('news-list').innerHTML = '<div class="empty">Még nincsenek hírek. A hírgyűjtés 15 percenként fut.</div>';
  }

  // Trades
  const tradeData = await load('/history?limit=50');
  if(tradeData && tradeData.trades.length > 0){
    renderTradeStats(tradeData.trades);

    $('trades-section').innerHTML = '<div class="table-wrap"><table class="table"><thead><tr><th>Típus</th><th>Ticker</th><th class="text-right">Db</th><th class="text-right">Ár</th><th class="text-right">Összeg</th><th>Indok</th></tr></thead><tbody>' + tradeData.trades.map(t =>
      '<tr style="cursor:pointer" onclick="showTradeDetail('+t.id+')"><td><span class="badge '+(t.action==='buy'?'badge-buy':'badge-sell')+'">'+t.action.toUpperCase()+'</span></td><td class="mono">'+t.ticker+'</td><td class="text-right">'+t.shares+'</td><td class="text-right">'+fmt(t.price)+'</td><td class="text-right" style="font-weight:600">'+fmt(t.total)+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--gray);font-size:.8rem">'+(t.reason||'—')+'</td></tr>'
    ).join('') + '</tbody></table></div>';

    // Build chart data from portfolio snapshots (cumulative approach)
    buildChartFromTrades(tradeData.trades, p);
  } else {
    $('trades-section').innerHTML = '<div class="empty">Még nem történt kereskedés.</div>';
    $('trade-stats').innerHTML = '';
  }
}

function buildChartFromTrades(trades, portfolio) {
  // Build chart: show portfolio value at each trade point + current
  const sorted = [...trades].sort((a, b) => new Date(a.executedAt) - new Date(b.executedAt));
  const points = [];
  let runningCash = 5000;
  let holdings = {};

  sorted.forEach(t => {
    if (t.action === 'buy') {
      runningCash -= t.total;
      holdings[t.ticker] = (holdings[t.ticker] || 0) + t.shares;
    } else {
      runningCash += t.total;
      holdings[t.ticker] = (holdings[t.ticker] || 0) - t.shares;
      if (holdings[t.ticker] <= 0) delete holdings[t.ticker];
    }
    // Approximate portfolio value = cash + sum(shares * trade price at that time)
    let holdingsValue = 0;
    for (const [ticker, shares] of Object.entries(holdings)) {
      // Use the trade price as approximation for that point in time
      holdingsValue += shares * t.price;
    }
    const dt = new Date(t.executedAt);
    points.push({
      value: runningCash + holdingsValue,
      label: (dt.getMonth()+1) + '/' + dt.getDate()
    });
  });

  // Add current portfolio value as final point
  if (portfolio) {
    const now = new Date();
    points.push({
      value: portfolio.totalValue,
      label: (now.getMonth()+1) + '/' + now.getDate()
    });
  }

  // Deduplicate by label (keep last value per day)
  const byDay = {};
  points.forEach(p => { byDay[p.label] = p; });
  const dedupedPoints = Object.values(byDay);

  if (dedupedPoints.length >= 2) {
    renderChart(dedupedPoints);
  }
}

async function triggerAll(){
  const btn = $('btn-refresh');
  const st = $('status-text');
  btn.disabled = true;
  btn.textContent = '⏳ Futtatás...';
  st.innerHTML = '<span class="status-dot status-loading"></span> Adatok frissítése...';
  try {
    await fetch('/api/trigger/prices',{method:'POST'});
    st.innerHTML = '<span class="status-dot status-loading"></span> Hírek gyűjtése...';
    await fetch('/api/trigger/news',{method:'POST'});
    st.innerHTML = '<span class="status-dot status-ok"></span> Kész!';
    await refresh();
  } catch(e) {
    st.innerHTML = '<span class="status-dot" style="background:var(--red)"></span> Hiba: ' + e.message;
  }
  btn.disabled = false;
  btn.textContent = '🔄 Frissítés';
}

// === PWA Registration ===
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('pwa-install').style.display = 'block';
});
async function installPwa() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('pwa-install').style.display = 'none';
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'SHOW_TRADE' && e.data.tradeId) showTradeDetail(e.data.tradeId);
  });
}

// === Notification Logic ===
let lastKnownTradeId = 0;
async function checkNewTrades() {
  const data = await load('/history?limit=1');
  if (!data || !data.trades.length) return;
  const latest = data.trades[0];
  if (lastKnownTradeId === 0) { lastKnownTradeId = latest.id; return; }
  if (latest.id > lastKnownTradeId) {
    lastKnownTradeId = latest.id;
    notifyTrade(latest);
  }
}
function notifyTrade(trade) {
  const emoji = trade.action === 'buy' ? '🟢' : '🔴';
  const msg = emoji + ' ' + trade.action.toUpperCase() + ' ' + trade.shares + ' ' + trade.ticker + ' @ ' + fmt(trade.price);

  // In-app banner
  const banner = $('notif-banner');
  banner.innerHTML = '<div style="font-weight:700;margin-bottom:4px">' + msg + '</div><div style="font-size:.75rem;color:var(--gray)">Kattints a részletekért →</div>';
  banner.style.display = 'block';
  banner.dataset.tradeId = trade.id;
  setTimeout(() => { banner.style.display = 'none'; }, 10000);

  // Browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification('Stock Agent — ' + trade.action.toUpperCase(), {
      body: trade.shares + ' ' + trade.ticker + ' @ ' + fmt(trade.price) + '\\n' + (trade.reason || ''),
      icon: '/manifest.json',
      tag: 'trade-' + trade.id,
      data: { tradeId: trade.id },
    });
    n.onclick = () => { window.focus(); showTradeDetail(trade.id); n.close(); };
  }
}
function openLastTrade() {
  const id = $('notif-banner').dataset.tradeId;
  if (id) showTradeDetail(parseInt(id));
  $('notif-banner').style.display = 'none';
}

// Request notification permission
if ('Notification' in window && Notification.permission === 'default') {
  document.addEventListener('click', function askPerm() {
    Notification.requestPermission();
    document.removeEventListener('click', askPerm);
  }, { once: true });
}

// === Trade Detail Modal ===
async function showTradeDetail(tradeId) {
  const modal = $('trade-modal');
  $('modal-title').textContent = 'Betöltés...';
  $('modal-content').innerHTML = '<div class="loading"><span class="dot-pulse"></span><span class="dot-pulse"></span><span class="dot-pulse"></span></div>';
  modal.classList.add('active');

  const data = await load('/trades/' + tradeId);
  if (!data || !data.trade) {
    $('modal-content').innerHTML = '<div class="empty">Trade nem található.</div>';
    return;
  }

  const t = data.trade;
  const emoji = t.action === 'buy' ? '🟢 VÉTEL' : '🔴 ELADÁS';
  $('modal-title').innerHTML = emoji + ' <span class="mono" style="color:var(--blue-dark)">' + t.ticker + '</span>';

  let html = '<div class="modal-section"><h3>Trade Adatok</h3><table class="table"><tbody>';
  html += '<tr><td>Típus</td><td><span class="badge '+(t.action==='buy'?'badge-buy':'badge-sell')+'">' + t.action.toUpperCase() + '</span></td></tr>';
  html += '<tr><td>Mennyiség</td><td><strong>' + t.shares + ' db</strong></td></tr>';
  html += '<tr><td>Ár</td><td>' + fmt(t.price) + '</td></tr>';
  html += '<tr><td>Összeg</td><td><strong>' + fmt(t.total) + '</strong></td></tr>';
  html += '<tr><td>Időpont</td><td>' + fmtDate(t.executedAt) + '</td></tr>';
  html += '</tbody></table></div>';

  // Reasoning
  if (t.reason) {
    html += '<div class="modal-section"><h3>🤖 AI Indoklás</h3><div class="modal-reason">' + t.reason + '</div></div>';
  }

  // AI Outlook
  if (data.analysis?.outlook) {
    html += '<div class="modal-section"><h3>📊 Piaci Kilátás</h3><div class="modal-reason">' + data.analysis.outlook + '</div></div>';
  }

  // Related news
  if (data.relatedNews && data.relatedNews.length > 0) {
    html += '<div class="modal-section"><h3>📰 Kapcsolódó Hírek (' + data.relatedNews.length + ')</h3>';
    for (const n of data.relatedNews.slice(0, 5)) {
      const sentLabel = n.sentiment > 0.3 ? 'Pozitív' : n.sentiment < -0.3 ? 'Negatív' : 'Semleges';
      const sentCls = n.sentiment > 0.3 ? 'badge-pos' : n.sentiment < -0.3 ? 'badge-neg' : 'badge-neutral';
      const url = n.url && n.url.startsWith('http') ? n.url : '#';
      html += '<div class="modal-news"><a href="'+url+'" target="_blank" rel="noopener">' + n.title + '</a>';
      html += '<div class="meta">' + n.source + ' · <span class="badge '+sentCls+'">' + sentLabel + '</span>';
      if (n.impact) html += ' · Impact: ' + n.impact + '/10';
      html += ' · ' + fmtDate(n.publishedAt || n.scrapedAt) + '</div></div>';
    }
    html += '</div>';
  } else {
    html += '<div class="modal-section"><h3>📰 Kapcsolódó Hírek</h3><div class="empty">Nincs közvetlenül kapcsolódó hír ehhez a tickerhez.</div></div>';
  }

  $('modal-content').innerHTML = html;
}
function closeModal() { $('trade-modal').classList.remove('active'); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// Make trade rows clickable
const origRefresh = refresh;
refresh = async function() {
  await origRefresh();
  checkNewTrades();
};

refresh();
// Auto-refresh display every 60s, auto-trigger data fetch every 15 min
setInterval(refresh, 60000);
setInterval(triggerAll, 15 * 60000);
// Update refresh timer every 30s
setInterval(updateRefreshTimer, 30000);
</script>
</body>
</html>`;

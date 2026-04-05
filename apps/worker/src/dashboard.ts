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
:root{--blue:#3b82f6;--blue-light:#60a5fa;--blue-dark:#1d4ed8;--blue-bg:#eff6ff;--blue-50:#dbeafe;--green:#16a34a;--red:#dc2626;--gray:#64748b;--gray-light:#f1f5f9;--white:#ffffff;--dark:#0f172a}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:var(--blue-bg);color:var(--dark);min-height:100vh}
.header{background:var(--white);border-bottom:2px solid var(--blue);padding:1rem 1.5rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}
.logo{display:flex;align-items:center;gap:.75rem}
.logo-icon{width:36px;height:36px;background:var(--blue);border-radius:10px;display:flex;align-items:center;justify-content:center;color:white;font-size:1.2rem}
.logo h1{font-size:1.25rem;color:var(--dark)}
.logo .tag{font-size:.6rem;background:var(--blue-50);color:var(--blue);padding:2px 8px;border-radius:99px;font-weight:600}
.header-right{font-size:.8rem;color:var(--gray);display:flex;align-items:center;gap:1rem}
.btn{padding:6px 14px;border-radius:8px;border:none;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .15s}
.btn-blue{background:var(--blue);color:white}.btn-blue:hover{background:var(--blue-dark)}
.btn-outline{background:transparent;border:1px solid #e2e8f0;color:var(--gray)}.btn-outline:hover{border-color:var(--blue);color:var(--blue)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.status-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px}
.status-ok{background:var(--green)}.status-loading{background:#f59e0b;animation:pulse 1s infinite}
.container{max-width:1200px;margin:0 auto;padding:1.5rem}
.grid{display:grid;gap:1.25rem}
.grid-4{grid-template-columns:repeat(4,1fr)}
.grid-2{grid-template-columns:1fr 1fr}
.card{background:var(--white);border-radius:12px;padding:1.25rem;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.card-title{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--gray);margin-bottom:.75rem;font-weight:600}
.stat-value{font-size:1.75rem;font-weight:700}
.stat-label{font-size:.8rem;color:var(--gray);margin-top:.15rem}
.positive{color:var(--green)}.negative{color:var(--red)}
.table{width:100%;border-collapse:collapse;font-size:.85rem}
.table th{text-align:left;padding:.6rem .5rem;border-bottom:2px solid #e2e8f0;color:var(--gray);font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.table td{padding:.6rem .5rem;border-bottom:1px solid #f1f5f9}
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
.pick-card{border:1px solid #e2e8f0;border-radius:10px;padding:1rem;margin-bottom:.75rem;transition:border-color .15s}
.pick-card:hover{border-color:var(--blue-light)}
.pick-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem}
.pick-ticker{font-family:monospace;font-size:1.1rem;font-weight:700;color:var(--blue-dark)}
.pick-conf{font-size:.75rem}
.pick-reason{font-size:.8rem;color:var(--gray);line-height:1.4}
.pick-meta{display:flex;gap:1rem;margin-top:.5rem;font-size:.7rem;color:var(--gray)}
.news-item{padding:.75rem 0;border-bottom:1px solid #f1f5f9}
.news-item:last-child{border-bottom:none}
.news-title{font-size:.85rem;color:var(--dark);text-decoration:none;font-weight:500;line-height:1.3}
.news-title:hover{color:var(--blue)}
.news-meta{display:flex;gap:.75rem;margin-top:.35rem;font-size:.7rem;color:var(--gray);flex-wrap:wrap;align-items:center}
.news-list{max-height:500px;overflow-y:auto}
.outlook-box{background:var(--blue-50);border:1px solid var(--blue);border-radius:10px;padding:1rem;font-size:.85rem;line-height:1.5;color:var(--dark);margin-bottom:1rem}
.warn-item{display:flex;justify-content:space-between;align-items:center;padding:.6rem .75rem;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin-bottom:.5rem;font-size:.85rem}
.empty{text-align:center;padding:2rem;color:var(--gray);font-size:.85rem}
.footer{text-align:center;padding:1.5rem;font-size:.7rem;color:var(--gray);border-top:1px solid #e2e8f0;margin-top:1.5rem;background:var(--white)}
.disclaimer{background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:.6rem 1rem;font-size:.7rem;color:#92400e;margin-bottom:1.25rem}
.loading{text-align:center;padding:3rem;color:var(--gray)}
.dot-pulse{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--blue);animation:pulse 1s infinite;margin:0 2px}
.dot-pulse:nth-child(2){animation-delay:.2s}
.dot-pulse:nth-child(3){animation-delay:.4s}
@keyframes pulse{0%,80%,100%{opacity:.3}40%{opacity:1}}
@media(max-width:768px){.grid-4{grid-template-columns:repeat(2,1fr)}.grid-2{grid-template-columns:1fr}.header{flex-direction:column;gap:.5rem;align-items:flex-start}}
.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:100;display:flex;align-items:center;justify-content:center;padding:1rem;opacity:0;pointer-events:none;transition:opacity .2s}
.modal-overlay.active{opacity:1;pointer-events:all}
.modal{background:var(--white);border-radius:16px;max-width:600px;width:100%;max-height:85vh;overflow-y:auto;padding:1.5rem;box-shadow:0 20px 60px rgba(0,0,0,.2);transform:translateY(20px);transition:transform .2s}
.modal-overlay.active .modal{transform:translateY(0)}
.modal-close{float:right;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--gray);padding:0 .25rem}
.modal-close:hover{color:var(--dark)}
.modal h2{font-size:1.1rem;margin-bottom:1rem;display:flex;align-items:center;gap:.5rem}
.modal-section{margin-bottom:1.25rem}
.modal-section h3{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--gray);margin-bottom:.5rem;font-weight:600}
.modal-reason{background:var(--blue-50);border-radius:8px;padding:.75rem;font-size:.85rem;line-height:1.5;color:var(--dark)}
.modal-news{border:1px solid #e2e8f0;border-radius:8px;padding:.6rem .75rem;margin-bottom:.5rem}
.modal-news a{color:var(--blue-dark);font-size:.85rem;font-weight:500;text-decoration:none}
.modal-news a:hover{text-decoration:underline}
.modal-news .meta{font-size:.7rem;color:var(--gray);margin-top:.25rem}
.notif-banner{position:fixed;bottom:1rem;right:1rem;background:var(--white);border:1px solid var(--blue);border-radius:12px;padding:1rem 1.25rem;box-shadow:0 8px 30px rgba(0,0,0,.15);z-index:50;display:none;max-width:360px;cursor:pointer;animation:slideUp .3s ease}
@keyframes slideUp{from{transform:translateY(100px);opacity:0}to{transform:translateY(0);opacity:1}}
.pwa-install{position:fixed;bottom:1rem;left:1rem;background:var(--blue);color:white;border:none;border-radius:10px;padding:.6rem 1rem;font-size:.8rem;font-weight:600;cursor:pointer;z-index:50;display:none;box-shadow:0 4px 12px rgba(59,130,246,.4)}
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
    <button class="btn btn-blue" id="btn-refresh" onclick="triggerAll()">🔄 Frissítés</button>
    <span>$5,000 Induló Tőke</span>
  </div>
</div>

<div class="container">
  <div class="disclaimer">
    ⚠️ Ez egy szimulációs rendszer — kizárólag oktatási célokat szolgál. NEM pénzügyi tanácsadás. Virtuális portfólió, valós pénz nincs benne.
  </div>

  <!-- Stats -->
  <div id="stats" class="grid grid-4" style="margin-bottom:1.25rem">
    <div class="card"><div class="card-title">Portfólió Értéke</div><div class="stat-value" id="s-total">—</div><div class="stat-label">Összes érték</div></div>
    <div class="card"><div class="card-title">Szabad Tőke</div><div class="stat-value" id="s-cash">—</div><div class="stat-label">Készpénz egyenleg</div></div>
    <div class="card"><div class="card-title">Nyereség / Veszteség</div><div class="stat-value" id="s-pnl">—</div><div class="stat-label" id="s-pnl-pct"></div></div>
    <div class="card"><div class="card-title">Nyitott Pozíciók</div><div class="stat-value" id="s-pos">—</div><div class="stat-label">Részvények</div></div>
  </div>

  <!-- Positions Table -->
  <div id="positions-section" class="card" style="margin-bottom:1.25rem;display:none">
    <div class="card-title">Nyitott Pozíciók</div>
    <table class="table">
      <thead><tr><th>Ticker</th><th class="text-right">Db</th><th class="text-right">Átlagár</th><th class="text-right">Aktuális</th><th class="text-right">P/L</th><th class="text-right">P/L%</th></tr></thead>
      <tbody id="pos-body"></tbody>
    </table>
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
      <div id="news-list" class="news-list"></div>
    </div>
  </div>

  <!-- Trade History -->
  <div class="card">
    <div class="card-title">📊 Trade Történet</div>
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

async function load(path){
  try{const r=await fetch('/api'+path);if(!r.ok)throw new Error(r.status);return r.json()}catch(e){console.error(path,e);return null}
}

async function refresh(){
  // Portfolio
  const p = await load('/portfolio');
  if(p){
    $('s-total').textContent = fmt(p.totalValue);
    $('s-cash').textContent = fmt(p.cash);
    $('s-pnl').innerHTML = '<span class="'+cls(p.totalPnl)+'">'+fmt(p.totalPnl)+'</span>';
    $('s-pnl-pct').innerHTML = '<span class="'+cls(p.totalPnlPercent)+'">'+pct(p.totalPnlPercent)+' indulás óta</span>';
    $('s-pos').textContent = p.positions.length;

    if(p.positions.length > 0){
      $('positions-section').style.display='block';
      $('pos-body').innerHTML = p.positions.map(pos =>
        '<tr><td class="mono">'+pos.ticker+'</td><td class="text-right">'+pos.shares+'</td><td class="text-right">'+fmt(pos.avgPrice)+'</td><td class="text-right">'+(pos.currentPrice?fmt(pos.currentPrice):'—')+'</td><td class="text-right '+cls(pos.pnl||0)+'">'+(pos.pnl!=null?fmt(pos.pnl):'—')+'</td><td class="text-right"><span class="badge '+badgeCls(pos.pnlPercent||0)+'">'+(pos.pnlPercent!=null?pct(pos.pnlPercent):'—')+'</span></td></tr>'
      ).join('');
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
    $('news-list').innerHTML = newsData.items.map(n => {
      const sentLabel = n.sentiment > 0.3 ? 'Pozitív' : n.sentiment < -0.3 ? 'Negatív' : 'Semleges';
      const sentCls = n.sentiment > 0.3 ? 'badge-pos' : n.sentiment < -0.3 ? 'badge-neg' : 'badge-neutral';
      const url = n.url && n.url.startsWith('http') ? n.url : '#';
      const tickers = Array.isArray(n.tickers) ? n.tickers : [];
      return '<div class="news-item"><a href="'+url+'" target="_blank" rel="noopener" class="news-title">'+n.title+'</a><div class="news-meta"><span>'+n.source+'</span>'+(n.sentiment!=null?'<span class="badge '+sentCls+'">'+sentLabel+'</span>':'')+(n.impact?'<span>Impact: '+n.impact+'/10</span>':'')+(tickers.length?'<span style="color:var(--blue);font-family:monospace;font-weight:600">'+tickers.join(' ')+'</span>':'')+'<span>'+fmtDate(n.publishedAt||n.scrapedAt)+'</span></div></div>';
    }).join('');
  } else {
    $('news-list').innerHTML = '<div class="empty">Még nincsenek hírek. A hírgyűjtés 15 percenként fut.</div>';
  }

  // Trades
  const tradeData = await load('/history?limit=30');
  if(tradeData && tradeData.trades.length > 0){
    $('trades-section').innerHTML = '<table class="table"><thead><tr><th>Dátum</th><th>Típus</th><th>Ticker</th><th class="text-right">Db</th><th class="text-right">Ár</th><th class="text-right">Összeg</th><th>Indok</th></tr></thead><tbody>' + tradeData.trades.map(t =>
      '<tr style="cursor:pointer" onclick="showTradeDetail('+t.id+')"><td>'+fmtDate(t.executedAt)+'</td><td><span class="badge '+(t.action==='buy'?'badge-buy':'badge-sell')+'">'+t.action.toUpperCase()+'</span></td><td class="mono">'+t.ticker+'</td><td class="text-right">'+t.shares+'</td><td class="text-right">'+fmt(t.price)+'</td><td class="text-right" style="font-weight:600">'+fmt(t.total)+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--gray);font-size:.8rem">'+(t.reason||'—')+'</td></tr>'
    ).join('') + '</tbody></table>';
  } else {
    $('trades-section').innerHTML = '<div class="empty">Még nem történt kereskedés.</div>';
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
  // Ask after first interaction
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
  // Make trade table rows clickable
  document.querySelectorAll('#trades-section .table tbody tr').forEach((row) => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      const firstCell = row.querySelector('td');
      if (!firstCell) return;
      // Find trade id from the data
      const dateText = firstCell.textContent;
      // We need trade IDs in the table — fetch from API
    });
  });
  checkNewTrades();
};

refresh();
// Auto-refresh display every 60s, auto-trigger data fetch every 15 min
setInterval(refresh, 60000);
setInterval(triggerAll, 15 * 60000);
</script>
</body>
</html>`;

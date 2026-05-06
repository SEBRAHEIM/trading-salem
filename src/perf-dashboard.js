// ─── Performance Dashboard ────────────────────────────────────────────────────
// Auto-refreshes every 60s + on page focus + manual refresh button
// Updates automatically after TP1 or SL events

let _perfData    = null;
let _pollTimer   = null;
let _lastTradeCount = 0;

async function loadPerformanceDashboard(silent = false) {
  try {
    const r = await fetch('/api/performance?t=' + Date.now()); // cache-bust
    if (!r.ok) return;
    const data = await r.json();
    if (!data) return;

    _perfData = data;

    // Flash the dashboard if a new trade appeared
    if (!silent && data.totalTrades > _lastTradeCount && _lastTradeCount > 0) {
      const dash = document.getElementById('perf-dashboard');
      if (dash) {
        dash.style.transition = 'box-shadow 0.4s';
        dash.style.boxShadow  = '0 0 0 2px #22d3a5';
        setTimeout(() => { dash.style.boxShadow = ''; }, 2000);
      }
    }
    _lastTradeCount = data.totalTrades || 0;

    renderPerformanceDashboard(data);
  } catch (e) { console.warn('[Perf]', e.message); }
}

function renderPerformanceDashboard(d) {
  // ── Core metrics ───────────────────────────────────────────────────────────
  const totalPnl = d.totalPnl ?? 0;
  const pnlPct   = d.totalPnlPct ?? ((totalPnl / (d.startEquity || 150)) * 100);
  const isPos    = pnlPct >= 0;

  const wins   = (d.trades || []).filter(t => t.result === 'TP1' || t.result === 'TP2' || t.result === 'TP1_Secured').length;
  const losses = (d.trades || []).filter(t => t.result === 'SL').length;

  // Return %
  const retEl = document.getElementById('pm-return');
  if (retEl) {
    retEl.textContent = (isPos ? '+' : '') + pnlPct.toFixed(1) + '%';
    retEl.className   = 'perf-metric-value ' + (isPos ? 'green' : 'red');
  }

  // Win rate
  const wrEl = document.getElementById('pm-winrate');
  if (wrEl) {
    wrEl.textContent = (d.winRate ?? 0) + '%';
    wrEl.className   = 'perf-metric-value ' + ((d.winRate ?? 0) >= 45 ? 'green' : 'red');
  }

  // W / L count (from actual trades array, not stale counters)
  const wlEl = document.getElementById('pm-wl');
  if (wlEl) wlEl.textContent = wins + 'W / ' + losses + 'L';

  // Profit factor
  const pfEl = document.getElementById('pm-pf');
  if (pfEl) pfEl.textContent = (d.profitFactor ?? 0) + '×';

  // Max drawdown
  const ddEl = document.getElementById('pm-dd');
  if (ddEl) {
    ddEl.textContent = (d.maxDrawdown ?? 0) + '%';
    ddEl.className   = 'perf-metric-value ' + ((d.maxDrawdown ?? 0) <= 15 ? 'green' : 'red');
  }

  // Avg win / loss
  const awEl = document.getElementById('pm-avgwin');
  if (awEl) awEl.textContent = '$' + (d.avgWin ?? 0).toFixed(2);
  const alEl = document.getElementById('pm-avgloss');
  if (alEl) alEl.textContent = 'Avg Loss: $' + (d.avgLoss ?? 0).toFixed(2);

  // Expectancy
  const expEl = document.getElementById('pm-exp');
  if (expEl) {
    const exp = d.expectancy ?? ((d.avgWin ?? 0) * (d.winRate ?? 0) / 100 - (d.avgLoss ?? 0) * (1 - (d.winRate ?? 0) / 100));
    expEl.textContent = (exp >= 0 ? '+$' : '-$') + Math.abs(exp).toFixed(2);
  }

  // ── Breakdown bars ─────────────────────────────────────────────────────────
  const total = wins + losses;
  if (total > 0) {
    const tp2El  = document.getElementById('pb-tp2');
    const tp2Val = document.getElementById('pb-tp2-val');
    const slEl   = document.getElementById('pb-sl');
    const slVal  = document.getElementById('pb-sl-val');
    if (tp2El)  tp2El.style.width       = ((wins   / total) * 100).toFixed(0) + '%';
    if (tp2Val) tp2Val.textContent      = wins;
    if (slEl)   slEl.style.width        = ((losses / total) * 100).toFixed(0) + '%';
    if (slVal)  slVal.textContent       = losses;
  }

  // ── Equity curve SVG ───────────────────────────────────────────────────────
  const curve = d.equityCurve || [];
  const svgEl = document.getElementById('equity-svg');
  if (svgEl && curve.length >= 2) {
    const eqs  = curve.map(p => p.equity ?? p);
    const base = d.startEquity ?? 150;
    const W = 700, H = 140, pad = 20;
    const mn = Math.min(...eqs), mx = Math.max(...eqs), range = mx - mn || 1;
    const pts = eqs.map((v, i) => {
      const x = pad + (i / (eqs.length - 1)) * (W - pad * 2);
      const y = H - pad - ((v - mn) / range) * (H - pad * 2);
      return `${x},${y}`;
    }).join(' ');
    const col   = eqs[eqs.length - 1] >= base ? '#22d3a5' : '#f4503a';
    const baseY = H - pad - ((base - mn) / range) * (H - pad * 2);

    svgEl.innerHTML = `
      <defs>
        <linearGradient id="eq-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="${col}" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="${col}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polygon points="${pad},${H - pad} ${pts} ${W - pad},${H - pad}" fill="url(#eq-grad)"/>
      <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>
      <line x1="${pad}" y1="${baseY}" x2="${W - pad}" y2="${baseY}" stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="4,4"/>
      <text x="${pad}" y="${H - 6}"  font-size="9" fill="rgba(255,255,255,0.35)">$${mn.toFixed(0)}</text>
      <text x="${pad}" y="${pad + 8}" font-size="9" fill="rgba(255,255,255,0.35)">$${mx.toFixed(0)}</text>
      <text x="${W - pad}" y="${baseY - 5}" font-size="9" fill="rgba(255,255,255,0.25)" text-anchor="end">$${base} start</text>
    `;
  }

  // ── Recent trades list ─────────────────────────────────────────────────────
  // Use full trades array from state (passed through performance API)
  const allTrades = (d.recentTrades || d.trades || []).slice(-8).reverse();
  const tList = document.getElementById('perf-trades-list');
  if (!tList) return;

  if (!allTrades.length) {
    tList.innerHTML = `<div class="perf-loading">
      🤖 Bot is live — scanning for next SMC setup<br>
      <span style="font-size:11px;opacity:0.6">
        55% WR backtest · 5-filter precision · London + NY sessions only
      </span>
    </div>`;
    return;
  }

  tList.innerHTML = allTrades.map(t => {
    const isWin  = t.result === 'TP1' || t.result === 'TP2' || t.result === 'TP1_Secured';
    const resClass = isWin ? 'tp1' : 'sl';
    const icon     = isWin ? '🎯' : '❌';
    const pnlPos   = (t.pnl || 0) >= 0;
    const dir      = (t.direction || t.dir || '').toLowerCase();
    const date     = (t.openTime || '').slice(0, 16).replace('T', ' ');
    const pips     = t.pips ? (t.pips > 0 ? '+' : '') + t.pips.toFixed(1) + 'pts' : '';
    return `<div class="perf-trade-row">
      <span class="perf-trade-date">${date}</span>
      <span class="perf-trade-dir ${dir}">${dir.toUpperCase()}</span>
      <span style="font-size:12px;color:var(--text-muted)">$${(t.entry || 0).toFixed(2)}</span>
      <span class="perf-trade-result ${resClass}">${icon} ${t.result}</span>
      <span class="perf-trade-pnl ${pnlPos ? 'pos' : 'neg'}">${pnlPos ? '+$' : '-$'}${Math.abs(t.pnl || 0).toFixed(2)}</span>
      <span style="font-size:10px;color:#556b8d">${pips}</span>
    </div>`;
  }).join('');

  // ── Last updated timestamp ─────────────────────────────────────────────────
  const tsEl = document.getElementById('perf-last-updated');
  if (tsEl) tsEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
}

// ─── Export init — called by main.js AFTER HTML template is rendered ─────────
export function initPerfDashboard() {
  // Initial load
  loadPerformanceDashboard(true);

  // ── Auto-poll every 60 seconds ─────────────────────────────────────────────
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(() => loadPerformanceDashboard(), 60_000);

  // ── Refresh on page focus (user returns to tab) ────────────────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadPerformanceDashboard();
  });

  // ── Manual refresh button ──────────────────────────────────────────────────
  const btn = document.getElementById('perf-refresh-btn');
  if (btn) btn.addEventListener('click', () => {
    btn.textContent = '⏳';
    loadPerformanceDashboard().then(() => { btn.textContent = '↻'; });
  });
}

// ─── Called by cron-tick when a trade closes — triggers instant refresh ───────
export function triggerPerfRefresh() {
  setTimeout(() => loadPerformanceDashboard(), 2000); // slight delay for state to persist
}

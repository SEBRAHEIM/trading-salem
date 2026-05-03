// ─── Performance Dashboard ────────────────────────────────────────────────────
async function loadPerformanceDashboard() {
  try {
    let data = null;
    try {
      const r = await fetch('/api/performance');
      if (r.ok) data = await r.json();
    } catch {}

    // Fall back to bundled backtest-report.json if no live trade data
    if (!data || data.totalTrades === 0) {
      const r2 = await fetch('/backtest-report.json');
      if (r2.ok) {
        const bt = await r2.json();
        data = {
          totalPnlPct:  bt.performance.totalPct,
          totalPnl:     bt.performance.totalPnl,
          winRate:      bt.performance.winRate,
          winCount:     bt.performance.wins,
          lossCount:    bt.performance.losses,
          profitFactor: bt.performance.profitFactor,
          maxDrawdown:  bt.performance.maxDrawdown,
          avgWin:       bt.performance.avgWin,
          avgLoss:      bt.performance.avgLoss,
          expectancy:   bt.performance.expectancy,
          equityCurve:  bt.equityCurve,
          trades:       bt.trades,
          breakdown:    { tp2: bt.performance.tp2Count, tp1Secured: bt.performance.tp1Count, sl: bt.performance.losses },
          startEquity:  bt.performance.startEquity,
          equity:       bt.performance.endEquity,
        };
      }
    }

    if (!data) return;
    renderPerformanceDashboard(data);
  } catch (e) { console.warn('Perf dashboard:', e.message); }
}

function renderPerformanceDashboard(d) {
  const pnlPct = d.totalPnlPct ?? ((d.totalPnl / (d.startEquity || 10000)) * 100);
  const isPos  = pnlPct >= 0;

  document.getElementById('pm-return').textContent  = (isPos ? '+' : '') + pnlPct.toFixed(1) + '%';
  document.getElementById('pm-return').className    = 'perf-metric-value ' + (isPos ? 'green' : 'red');
  document.getElementById('pm-winrate').textContent = d.winRate + '%';
  document.getElementById('pm-winrate').className   = 'perf-metric-value ' + (d.winRate >= 45 ? 'green' : 'red');
  document.getElementById('pm-wl').textContent      = (d.winCount ?? 0) + 'W / ' + (d.lossCount ?? 0) + 'L';
  document.getElementById('pm-pf').textContent      = d.profitFactor + '\u00d7';
  document.getElementById('pm-dd').textContent      = d.maxDrawdown + '%';
  document.getElementById('pm-dd').className        = 'perf-metric-value ' + (d.maxDrawdown <= 15 ? 'green' : 'red');
  document.getElementById('pm-avgwin').textContent  = '$' + (d.avgWin ?? 0).toFixed(0);
  document.getElementById('pm-avgloss').textContent = 'Avg Loss: $' + (d.avgLoss ?? 0).toFixed(0);
  document.getElementById('pm-exp').textContent     = ((d.expectancy ?? 0) >= 0 ? '+$' : '-$') + Math.abs(d.expectancy ?? 0).toFixed(0);

  // Breakdown bars
  const total = (d.breakdown?.tp2 ?? 0) + (d.breakdown?.tp1Secured ?? 0) + (d.breakdown?.sl ?? 0);
  if (total > 0) {
    const pctOf = n => ((n / total) * 100).toFixed(0) + '%';
    document.getElementById('pb-tp2').style.width   = pctOf(d.breakdown.tp2);
    document.getElementById('pb-tp1').style.width   = pctOf(d.breakdown.tp1Secured);
    document.getElementById('pb-sl').style.width    = pctOf(d.breakdown.sl);
    document.getElementById('pb-tp2-val').textContent = d.breakdown.tp2;
    document.getElementById('pb-tp1-val').textContent = d.breakdown.tp1Secured;
    document.getElementById('pb-sl-val').textContent  = d.breakdown.sl;
  }

  // Equity curve SVG
  const curve = d.equityCurve || [];
  if (curve.length >= 2) {
    const eqs  = curve.map(p => p.equity ?? p);
    const base = d.startEquity ?? 10000;
    const W = 700, H = 140, pad = 20;
    const mn = Math.min(...eqs), mx = Math.max(...eqs), range = mx - mn || 1;
    const pts = eqs.map((v, i) => {
      const x = pad + (i / (eqs.length - 1)) * (W - pad * 2);
      const y = H - pad - ((v - mn) / range) * (H - pad * 2);
      return `${x},${y}`;
    }).join(' ');
    const col   = eqs[eqs.length - 1] >= base ? '#22d3a5' : '#f4503a';
    const baseY = H - pad - ((base - mn) / range) * (H - pad * 2);

    document.getElementById('equity-svg').innerHTML = `
      <defs>
        <linearGradient id="eq-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="${col}" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="${col}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polygon points="${pad},${H - pad} ${pts} ${W - pad},${H - pad}" fill="url(#eq-grad)"/>
      <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>
      <line x1="${pad}" y1="${baseY}" x2="${W - pad}" y2="${baseY}" stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="4,4"/>
      <text x="${pad}" y="${H - 6}" font-size="9" fill="rgba(255,255,255,0.3)">$${mn.toFixed(0)}</text>
      <text x="${pad}" y="${pad + 8}" font-size="9" fill="rgba(255,255,255,0.3)">$${mx.toFixed(0)}</text>
      <text x="${W - pad}" y="${baseY - 5}" font-size="9" fill="rgba(255,255,255,0.25)" text-anchor="end">$${base.toLocaleString()} start</text>
    `;
  }

  // Recent trades table
  const trades = (d.trades || []).slice(-8).reverse();
  const tList  = document.getElementById('perf-trades-list');
  if (!trades.length) {
    tList.innerHTML = '<div class="perf-loading">No trades yet — bot running live</div>';
    return;
  }
  tList.innerHTML = trades.map(t => {
    const res    = t.result === 'TP2' ? 'tp2' : t.result === 'TP1_Secured' ? 'tp1' : 'sl';
    const icon   = t.result === 'TP2' ? '🚀' : t.result === 'TP1_Secured' ? '🟢' : '❌';
    const pnlPos = (t.pnl || 0) >= 0;
    const dir    = (t.dir || t.direction || '').toLowerCase();
    return `<div class="perf-trade-row">
      <span class="perf-trade-date">${(t.openTime || '').slice(0, 16).replace('T', ' ')}</span>
      <span class="perf-trade-dir ${dir}">${(t.dir || t.direction || '').toUpperCase()}</span>
      <span style="font-size:12px;color:var(--text-muted)">$${(t.entry || 0).toFixed(2)}</span>
      <span class="perf-trade-result ${res}">${icon} ${t.result}</span>
      <span class="perf-trade-pnl ${pnlPos ? 'pos' : 'neg'}">${pnlPos ? '+$' : '-$'}${Math.abs(t.pnl || 0).toFixed(2)}</span>
    </div>`;
  }).join('');
}

// ─── Init Performance Dashboard ───────────────────────────────────────────────
loadPerformanceDashboard();
document.getElementById('perf-refresh-btn').addEventListener('click', loadPerformanceDashboard);

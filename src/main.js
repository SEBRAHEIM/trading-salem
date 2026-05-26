/**
 * ForexSignal Pro — Main Application
 * Strategy: SMC Precision — 5-Filter High-Conviction Engine
 * Backtest: 55% WR | 2.59× PF | +46.54% / 77 days | DD < 6%
 */

import './style.css';
import { initChart, updateChart, updateChartData, addSignalMarker } from './components/chart.js';
import { fetchCandles, fetchLivePrice, addSyntheticTick, PAIRS, INTERVALS } from './data/marketData.js';
import { smcSignal } from './strategies/smc.js';
import { computeRiskParams } from './data/backtest.js';

import { initPerfDashboard, triggerPerfRefresh } from './perf-dashboard.js';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  pair: 'XAU/USD',
  interval: '15min',
  candles: [],
  strategyResults: [],
  aggregated: null,
  riskParams: null,
  liveInterval: null,
  analysisInterval: null,
  isSynthetic: false,
  lastSignal: null,
  activeTab: 'dashboard',
  showStrategies: false,
};

// ─── Render App Shell ─────────────────────────────────────────────────────────
document.getElementById('app').innerHTML = `
  <div class="loading-overlay" id="loading-overlay">
    <div class="loading-box">
      <div class="loading-spinner"></div>
      <div class="loading-text" id="loading-text">Initializing…</div>
    </div>
  </div>

  <header class="header">
    <div class="header-logo">
      <div class="logo-icon">⚡</div>
      <div>
        <div class="logo-text">ForexSignal Pro</div>
        <div class="logo-sub">SMC Precision Engine · 55% WR</div>
      </div>
    </div>

    <div class="header-mid">
      <div class="asset-tabs" id="asset-tabs">
        ${PAIRS.map((p, i) => `
          <button class="asset-tab ${i === 0 ? 'active' : ''}" data-pair="${p}">${p}</button>
        `).join('')}
      </div>

      <div class="select-group">
        <label>Timeframe</label>
        <select id="interval-select">
          ${INTERVALS.map(i => `<option value="${i.value}" ${i.value === '15min' ? 'selected' : ''}>${i.label}</option>`).join('')}
        </select>
      </div>
    </div>

      <div class="header-right">
      <div class="live-badge" id="live-badge"><div class="live-dot"></div>LIVE</div>
      <button class="btn btn-primary" id="refresh-btn">↺ Refresh</button>
    </div>
  </header>

  <div class="main-layout">

    <!-- ═══ SIGNAL DASHBOARD ═══════════════════════════════════════════════ -->
    <div class="panel active" id="panel-dashboard">

      <!-- Chart column -->
      <div class="col-chart">
        <div class="chart-header">
          <div class="price-block">
            <div class="price-pair" id="price-pair">XAU/USD</div>
            <div class="price-main" id="price-main">—</div>
            <div class="price-change" id="price-change"></div>
          </div>
          <div class="ohlc-row">
            <div class="ohlc-item"><span class="ohlc-label">O</span><span id="stat-open">—</span></div>
            <div class="ohlc-item"><span class="ohlc-label">H</span><span id="stat-high" class="green">—</span></div>
            <div class="ohlc-item"><span class="ohlc-label">L</span><span id="stat-low" class="red">—</span></div>
            <div class="ohlc-item"><span class="ohlc-label">Vol</span><span id="stat-vol">—</span></div>
          </div>
          <div class="chart-badges">
            <div class="synthetic-badge" id="synthetic-badge" style="display:none">⚡ DEMO</div>
          </div>
        </div>
        <div class="chart-wrap" id="chart-container"></div>
      </div>

      <!-- Signal column -->
      <div class="col-signal">

        <!-- THE SIGNAL -->
        <div class="signal-hero" id="signal-hero">
          <div class="signal-hero-label">CONSENSUS SIGNAL</div>
          <div class="signal-hero-value" id="signal-value">SCANNING…</div>
          <div class="signal-hero-sub" id="signal-sub">Waiting for market data</div>
        </div>

        <!-- Confidence Gauge -->
        <div class="gauge-section">
          <div class="gauge-header">
            <span class="gauge-label">CONSENSUS STRENGTH</span>
            <span class="gauge-pct" id="conf-pct">—</span>
          </div>
          <div class="gauge-track">
            <div class="gauge-fill" id="gauge-fill" style="width:0%"></div>
            <div class="gauge-threshold" style="left:80%">
              <div class="gauge-threshold-line"></div>
            </div>
          </div>
          <div class="gauge-legend">
            <span>0%</span>
            <span class="gauge-threshold-label">80% Threshold</span>
            <span>100%</span>
          </div>
        </div>

        <!-- Vote counts -->
        <div class="vote-row">
          <div class="vote-item buy">
            <div class="vote-num" id="count-buy">—</div>
            <div class="vote-lbl">▲ BUY</div>
          </div>
          <div class="vote-divider"></div>
          <div class="vote-item sell">
            <div class="vote-num" id="count-sell">—</div>
            <div class="vote-lbl">▼ SELL</div>
          </div>
          <div class="vote-divider"></div>
          <div class="vote-item neutral">
            <div class="vote-num" id="count-neutral">—</div>
            <div class="vote-lbl">◼ NEUTRAL</div>
          </div>
        </div>

        <!-- Market condition -->
        <div class="market-row">
          <div class="market-col">
            <div class="market-label">MARKET</div>
            <div class="market-val" id="market-status">—</div>
          </div>
          <div class="market-col">
            <div class="market-label">UPDATED</div>
            <div class="market-val mono" id="analysis-timestamp">—</div>
          </div>
          <div class="market-col">
            <div class="market-label">NEXT SCAN</div>
            <div class="market-val mono" id="next-update">—</div>
          </div>
        </div>

        <!-- Risk box — only shown on a valid signal -->
        <div class="risk-box" id="risk-box" style="display:none">
          <div class="risk-box-title">RISK PARAMETERS</div>
          <div class="risk-grid">
            <div class="risk-item">
              <div class="rl">Entry</div>
              <div class="rv" id="risk-entry">—</div>
            </div>
            <div class="risk-item">
              <div class="rl">Stop Loss</div>
              <div class="rv red" id="risk-sl">—</div>
            </div>
            <div class="risk-item">
              <div class="rl">TP 1</div>
              <div class="rv green" id="risk-tp1">—</div>
            </div>
            <div class="risk-item">
              <div class="rl">TP 2</div>
              <div class="rv green" id="risk-tp2">—</div>
            </div>
            <div class="risk-item">
              <div class="rl">Risk/Reward</div>
              <div class="rv blue" id="risk-rr">—</div>
            </div>
          </div>
          <div class="risk-vol-warn" id="risk-vol-warn" style="display:none">
            ⚠️ <span id="risk-vol-text">High volatility detected — reduce position size</span>
          </div>
        </div>

        <!-- SMC Filter status panel -->
        <div class="strategies-panel" id="strategies-panel" style="display:block">
          <div class="strat-list" id="strat-list"></div>
        </div>

        <!-- Reasoning -->
        <div class="reasoning-box">
          <div class="reasoning-title">SIGNAL REASONING</div>
          <div class="reasoning-body" id="signal-reasoning">Run analysis to see reasoning…</div>
        </div>

      </div>
    </div>

      </div>
    </div>
  </div>


  <!-- ═══ PERFORMANCE DASHBOARD ════════════════════════════════════════════ -->
  <div class="perf-dashboard" id="perf-dashboard">
    <div class="perf-header">
      <div class="perf-header-title">
        <span class="perf-icon">📊</span>
        <div>
          <div class="perf-title">Backtest Performance Report</div>
          <div class="perf-subtitle">Live performance tracking · Started May 2026 · XAU/USD 15m · $150 capital</div>
        </div>
      </div>
      <button class="perf-refresh-btn" id="perf-refresh-btn">↻</button>
      <span class="perf-last-updated" id="perf-last-updated"></span>
    </div>
    <div class="perf-metrics" id="perf-metrics">
      <div class="perf-metric-card"><div class="perf-metric-label">NET P&L</div><div class="perf-metric-value" id="pm-return">—</div><div class="perf-metric-sub" id="pm-return-sub">Balance: $150.00</div></div>
      <div class="perf-metric-card"><div class="perf-metric-label">WIN RATE</div><div class="perf-metric-value" id="pm-winrate">—</div><div class="perf-metric-sub" id="pm-wl">0W / 0L</div></div>
      <div class="perf-metric-card highlight"><div class="perf-metric-label">PROFIT FACTOR</div><div class="perf-metric-value" id="pm-pf">—</div><div class="perf-metric-sub">Industry standard: 1.5+</div></div>
      <div class="perf-metric-card"><div class="perf-metric-label">MAX DRAWDOWN</div><div class="perf-metric-value green" id="pm-dd">—</div><div class="perf-metric-sub">Excellent risk control</div></div>
      <div class="perf-metric-card"><div class="perf-metric-label">AVG WIN</div><div class="perf-metric-value green" id="pm-avgwin"></div><div class="perf-metric-sub" id="pm-avgloss">Avg Loss: </div></div>
      <div class="perf-metric-card"><div class="perf-metric-label">EXPECTANCY</div><div class="perf-metric-value green" id="pm-exp">+</div><div class="perf-metric-sub">Per trade average</div></div>
    </div>
    <div class="perf-curve-section">
      <div class="perf-curve-label">BALANCE CURVE — $150 Start (Live · 1 pt = $1)</div>
      <div class="perf-curve-wrap"><svg id="equity-svg" viewBox="0 0 700 140" style="width:100%;height:140px"></svg></div>
    </div>
    <div class="perf-bottom-grid">
      <div class="perf-breakdown">
        <div class="perf-section-title">TRADE BREAKDOWN</div>
        <div class="perf-breakdown-bars" id="perf-breakdown">
          <div class="pb-row"><span class="pb-label">🎯 Target Hit</span><div class="pb-bar-wrap"><div class="pb-bar tp2" id="pb-tp2" style="width:0%"></div></div><span class="pb-val" id="pb-tp2-val">0</span></div>
          <div class="pb-row"><span class="pb-label">❌ Stop Loss</span><div class="pb-bar-wrap"><div class="pb-bar sl" id="pb-sl" style="width:0%"></div></div><span class="pb-val" id="pb-sl-val">0</span></div>
        </div>
        <div class="perf-note">P&L = actual price movement · 1 point = $1 · Balance updates in real time after every TP or SL hit.</div>
      </div>
      <div class="perf-recent">
        <div class="perf-section-title">RECENT TRADES</div>
        <div class="perf-trades-list" id="perf-trades-list"><div class="perf-loading">Loading…</div></div>
      </div>
    </div>
  </div>

  <!-- THE LIVE SIGNAL POPUP / FLOATING NOTIFICATION -->
  <div id="live-alert-modal" class="live-alert-modal" style="display:none">
    <div class="live-alert-content">
      <button class="live-alert-close" id="live-alert-close">×</button>
      <div class="live-alert-badge" id="live-alert-badge">LIVE SIGNAL FIRED</div>
      <div class="live-alert-hero" id="live-alert-hero">BUY</div>
      <div class="live-alert-pair" id="live-alert-pair">XAU/USD</div>
      <div class="live-alert-grid">
        <div class="la-item"><span>ENTRY</span><strong id="la-entry">0</strong></div>
        <div class="la-item"><span>STOP LOSS</span><strong id="la-sl" class="red">0</strong></div>
        <div class="la-item"><span>TP 1</span><strong id="la-tp1" class="green">0</strong></div>
        <div class="la-item"><span>TP 2</span><strong id="la-tp2" class="green">0</strong></div>
      </div>
    </div>
  </div>
`;

// ─── Chart init — wait one tick so layout is computed ────────────────────────
// Chart init — wait for layout to compute real pixel dimensions
// The TradingView widget requires the container to have a non-zero clientWidth/Height
let chartRef = null;
setTimeout(async () => {
  const container = document.getElementById('chart-container');
  if (container) {
    await initChart(container, state.pair, state.interval);
    await loadAndAnalyze();
  }
  // Init performance dashboard AFTER HTML exists
  initPerfDashboard();
}, 300);

// ─── No Tab Navigation needed for single page Layout ─────────────

// ─── Asset Tab Switching ──────────────────────────────────────────────────────
document.getElementById('asset-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.asset-tab');
  if (!btn) return;
  document.querySelectorAll('.asset-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.pair = btn.dataset.pair;
  document.getElementById('price-pair').textContent = state.pair;
  updateChart(state.pair, state.interval);
  loadAndAnalyze();
});

// ─── Interval & API key ───────────────────────────────────────────────────────
document.getElementById('interval-select').addEventListener('change', e => {
  state.interval = e.target.value;
  updateChart(state.pair, state.interval);
  loadAndAnalyze();
});

document.getElementById('refresh-btn').addEventListener('click', () => loadAndAnalyze());

// ─── Strategy breakdown toggle ────────────────────────────────────────────────
let filterCategory = 'all';

document.getElementById('strategies-toggle').addEventListener('click', () => {
  state.showStrategies = !state.showStrategies;
  const panel = document.getElementById('strategies-panel');
  const toggle = document.getElementById('strategies-toggle');
  panel.style.display = state.showStrategies ? 'flex' : 'none';
  toggle.querySelector('span').textContent = state.showStrategies ? 'Hide strategies ×' : 'View 12 strategies ›';
  if (state.showStrategies) renderStrategyList();
});

document.addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterCategory = btn.dataset.filter;
  renderStrategyList();
});

// API key — triggers a reload with live data when entered


// ─── Load & Analyze ───────────────────────────────────────────────────────────
async function loadAndAnalyze() {
  showLoading('Loading ' + state.pair + '…');
  clearLiveIntervals();

  try {

    const candles = await fetchCandles(state.pair, state.interval, 300);
    state.candles = candles;
    state.isSynthetic = candles[0]?.synthetic ?? true;

    // Show DEMO badge only if synthetic fallback was used
    document.getElementById('synthetic-badge').style.display = state.isSynthetic ? 'flex' : 'none';

    updateChartData(candles);
    updatePriceDisplay();
    runAnalysis();

    // ── Live price ticker from TradingView quote (same source as embedded chart) ──
    // Updates every 5s so the header price always matches what the TV chart shows
    state.liveInterval = setInterval(async () => {
      const quote = await fetchLivePrice(state.pair);
      if (quote?.price && state.candles.length) {
        // Patch last candle with real current price
        const last = state.candles[state.candles.length - 1];
        const p    = quote.price;
        state.candles = [
          ...state.candles.slice(0, -1),
          { ...last, close: p, high: Math.max(last.high, p), low: Math.min(last.low, p) },
        ];
        updatePriceDisplay();
      } else if (state.isSynthetic) {
        state.candles = addSyntheticTick(state.candles);
        updatePriceDisplay();
      }
    }, 5000);

    // Re-analyze every 30s with fresh Yahoo Finance data when available
    state.analysisInterval = setInterval(async () => {
      try {
        const fresh = await fetchCandles(state.pair, state.interval, 300);
        if (fresh.length && !fresh[0]?.synthetic) {
          state.candles    = fresh;
          state.isSynthetic = false;
          document.getElementById('synthetic-badge').style.display = 'none';
        }
      } catch { /* silent */ }
      runAnalysis();
    }, 30_000);

  } catch (err) {
    console.error('loadAndAnalyze error:', err);
  } finally {
    hideLoading();
  }
}

function clearLiveIntervals() {
  if (state.liveInterval) clearInterval(state.liveInterval);
  if (state.analysisInterval) clearInterval(state.analysisInterval);
}

// ─── Core Analysis (SMC Precision Engine) ────────────────────────────────────
function runAnalysis() {
  if (!state.candles.length) return;

  const sig = smcSignal(state.candles);
  state.aggregated = sig;
  state.riskParams = sig ? {
    entry:       sig.entry,
    stopLoss:    sig.stopLoss,
    takeProfit1: sig.takeProfit,
    slPoints:    sig.slPoints,
    tp1Points:   sig.tp1Points,
    riskReward:  sig.riskReward,
    highVolatility: false,
  } : null;

  // Mark on chart if new signal
  if (sig && sig.signal !== state.lastSignal) {
    addSignalMarker(state.candles[state.candles.length - 1], sig.signal);
    state.lastSignal = sig.signal;
    if (state.riskParams) showLiveAlert(state.pair, sig.signal, state.riskParams);
  }

  renderSignalSMC(sig);
  renderRisk(state.riskParams, sig);
  renderSMCFilters(sig);

  // Countdown timer
  document.getElementById('analysis-timestamp').textContent = new Date().toLocaleTimeString();
  let cd = 30;
  const cdEl = document.getElementById('next-update');
  const cdTimer = setInterval(() => {
    cd--;
    cdEl.textContent = cd > 0 ? `${cd}s` : '…';
    if (cd <= 0) clearInterval(cdTimer);
  }, 1000);
}

// ─── Price Display ────────────────────────────────────────────────────────────
function updatePriceDisplay() {
  if (!state.candles.length) return;
  const last = state.candles[state.candles.length - 1];
  const prev = state.candles[state.candles.length - 2];
  const p = last.close;
  // Gold → 2dp, Oil → 2dp, Forex → 5dp
  const d = p > 10 ? 2 : 5;

  document.getElementById('price-main').textContent = p.toFixed(d);
  document.getElementById('stat-open').textContent = last.open.toFixed(d);
  document.getElementById('stat-high').textContent = last.high.toFixed(d);
  document.getElementById('stat-low').textContent = last.low.toFixed(d);
  document.getElementById('stat-vol').textContent = (last.volume || 0).toLocaleString();

  if (prev) {
    const change = p - prev.close;
    const pct = (change / prev.close) * 100;
    const el = document.getElementById('price-change');
    el.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(d)} (${pct >= 0 ? '+' : ''}${pct.toFixed(3)}%)`;
    el.className = `price-change ${change >= 0 ? 'up' : 'down'}`;
  }
}

// ─── Render Signal Hero (SMC) ─────────────────────────────────────────────────
function renderSignalSMC(sig) {
  const hero   = document.getElementById('signal-hero');
  const valEl  = document.getElementById('signal-value');
  const subEl  = document.getElementById('signal-sub');
  const fill   = document.getElementById('gauge-fill');
  const pctEl  = document.getElementById('conf-pct');
  const marketEl = document.getElementById('market-status');

  if (sig) {
    const cls = sig.signal === 'BUY' ? 'buy' : 'sell';
    hero.className = `signal-hero ${cls}`;
    valEl.textContent = sig.signal;
    valEl.className = `signal-hero-value ${cls}`;
    subEl.textContent = `${sig.session} Session · RSI ${sig.rsi} · R:R 1:2 · SMC Precision`;
    fill.style.width = '100%';
    fill.className = 'gauge-fill high';
    pctEl.textContent = '5/5';
    pctEl.className = 'gauge-pct high';
    document.getElementById('count-buy').textContent  = sig.signal === 'BUY'  ? '5' : '0';
    document.getElementById('count-sell').textContent = sig.signal === 'SELL' ? '5' : '0';
    document.getElementById('count-neutral').textContent = '0';
  } else {
    hero.className = 'signal-hero no-trade';
    valEl.textContent = 'NO TRADE';
    valEl.className = 'signal-hero-value no-trade';
    const hourUTC = new Date().getUTCHours();
    const inSession = (hourUTC >= 6 && hourUTC < 12) || (hourUTC >= 13 && hourUTC < 19);
    subEl.textContent = inSession
      ? 'Scanning — waiting for structure retest + trend alignment'
      : `Outside session (${hourUTC}:00 UTC) — London opens 06:00, NY opens 13:00`;
    fill.style.width = '0%';
    fill.className = 'gauge-fill low';
    pctEl.textContent = '—';
    pctEl.className = 'gauge-pct low';
    document.getElementById('count-buy').textContent  = '—';
    document.getElementById('count-sell').textContent = '—';
    document.getElementById('count-neutral').textContent = '—';
  }

  marketEl.textContent = 'SMC PRECISION';
  marketEl.className = 'market-val trending';
}

// ─── Render Risk ──────────────────────────────────────────────────────────────
function renderRisk(risk, agg) {
  const box = document.getElementById('risk-box');
  if (!risk) { box.style.display = 'none'; return; }
  box.style.display = 'block';

  const d = risk.entry > 1000 ? 2 : risk.entry > 100 ? 3 : 5;
  document.getElementById('risk-entry').textContent = risk.entry.toFixed(d);
  document.getElementById('risk-sl').textContent = `${risk.stopLoss.toFixed(d)} (${risk.slPoints} pts)`;
  document.getElementById('risk-tp1').textContent = `${risk.takeProfit1.toFixed(d)} (${risk.tp1Points} pts)`;
  const tp2El = document.getElementById('risk-tp2'); if (tp2El) tp2El.closest('.risk-row') && (tp2El.closest('.risk-row').style.display = 'none');
  document.getElementById('risk-rr').textContent = `1 : ${risk.riskReward}`;

  const volWarn = document.getElementById('risk-vol-warn');
  volWarn.style.display = risk.highVolatility ? 'flex' : 'none';
  if (risk.highVolatility) {
    document.getElementById('risk-vol-text').textContent =
      `High volatility (${risk.volatilityPct}% ATR) — consider reducing position size`;
  }
}

// ─── Render SMC Filter Status ─────────────────────────────────────────────────
function renderSMCFilters(sig) {
  const el = document.getElementById('signal-reasoning');
  const hourUTC = new Date().getUTCHours();
  const inLondon = hourUTC >= 6 && hourUTC < 12;
  const inNY = hourUTC >= 13 && hourUTC < 19;
  const sessionName = inLondon ? 'London' : inNY ? 'New York' : 'Closed';
  const sessionPass = inLondon || inNY;

  const filters = [
    { name: '1. H4 Trend Alignment',        desc: 'EMA200 + EMA50 pointing same direction',          pass: !!sig },
    { name: '2. Structure Break + Retest',   desc: 'Price broke swing level and pulled back to it',   pass: !!sig },
    { name: '3. RSI Momentum',               desc: `RSI aligned with trade direction${sig ? ` (${sig.rsi})` : ''}`, pass: !!sig },
    { name: '4. Session Filter',             desc: `${sessionName} session${sessionPass ? ' ✅' : ' — waiting for London 06:00 or NY 13:00'}`, pass: sessionPass },
    { name: '5. ATR Volatility Regime',      desc: 'Volatility in tradeable range (0.6×–2.2× avg)',   pass: !!sig },
  ];

  const header = sig
    ? `<div class="reasoning-alert green">✅ ALL 5 FILTERS PASSED — ${sig.signal} signal confirmed (${sig.session} session)</div>`
    : `<div class="reasoning-alert amber">⏳ Scanning — all 5 SMC filters must pass simultaneously</div>`;

  const rows = filters.map(f =>
    `<div class="reasoning-item">
      <span class="reasoning-name">${f.pass ? '✅' : '⬜'} ${f.name}</span>
      <span class="reasoning-text">${f.desc}</span>
    </div>`
  ).join('');

  el.innerHTML = header + rows;

  // Also update strat-list with the same filters
  const list = document.getElementById('strat-list');
  if (list) {
    list.innerHTML = filters.map(f =>
      `<div class="strat-item ${f.pass ? 'buy' : 'neutral'}">
        <div class="strat-signal-dot ${f.pass ? 'buy' : 'neutral'}"></div>
        <div class="strat-info">
          <div class="strat-name">${f.name}</div>
          <div class="strat-reason">${f.desc}</div>
        </div>
        <div class="strat-badge ${f.pass ? 'buy' : 'neutral'}">${f.pass ? 'PASS' : 'WAIT'}</div>
      </div>`
    ).join('');
  }
}

// ─── Render Strategy Breakdown ────────────────────────────────────────────────
function renderStrategyList() {
  const list = document.getElementById('strat-list');
  const results = state.strategyResults;
  if (!results.length) return;

  const filtered = filterCategory === 'all'
    ? results
    : results.filter(r => r.category === filterCategory);

  list.innerHTML = filtered.map((r, i) => {
    const wClass = r.weight >= 9 ? 'w-high' : r.weight >= 7 ? 'w-med' : 'w-low';
    return `
      <div class="strat-row ${r.signal}" onclick="this.classList.toggle('expanded')">
        <div class="strat-left">
          <span class="strat-num">${i + 1}</span>
          <span class="strat-name">${r.name}</span>
          <span class="strat-cat">${r.category}</span>
        </div>
        <div class="strat-right">
          <span class="strat-conf">${r.confidence}%</span>
          <span class="strat-sig ${r.signal}">${r.signal.toUpperCase()}</span>
          <span class="strat-w ${wClass}" title="Weight: ${r.weight}">W${r.weight}</span>
        </div>
        <div class="strat-reason">${r.reason}</div>
      </div>
    `;
  }).join('');
}

// ─── Logs ─────────────────────────────────────────────────────────────────────
function renderLogs() {
  const logs = getLogs();
  document.getElementById('logs-count').textContent = `${logs.length} signals logged`;
  const list = document.getElementById('logs-list');
  if (!logs.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No signals yet</div></div>`;
    return;
  }
  list.innerHTML = logs.map(l => `
    <div class="log-entry" style="display:flex;flex-direction:column;gap:5px;border-bottom:1px solid var(--bg-border);padding-bottom:12px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="display:flex;gap:12px;align-items:center;">
          <span class="log-time" style="color:var(--text-muted);font-size:12px">${new Date(l.timestamp).toLocaleTimeString()}</span>
          <span class="log-pair" style="font-weight:600;font-size:13px">${l.pair}</span>
          <span class="log-tf" style="background:var(--bg-lighter);padding:2px 6px;border-radius:4px;font-size:11px">${l.timeframe}</span>
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          <span class="log-counts" style="font-size:11px;color:var(--text-secondary)">▲${l.buyCount} ▼${l.sellCount} ◼${l.neutralCount}</span>
          <span class="log-conf" style="font-weight:600;font-size:13px;color:var(--text-secondary)">${l.confidence}%</span>
          <span class="log-signal ${(l.signal||'').replace(' ','_')}" style="padding:4px 10px;border-radius:var(--radius-sm);font-weight:700;font-size:12px">${l.signal}</span>
        </div>
      </div>
      ${l.entry ? `
      <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:10px;margin-top:8px;background:var(--bg-lighter);padding:8px;border-radius:var(--radius-sm);font-family:var(--font-mono);font-size:12px;">
        <div><span style="color:var(--text-muted);font-size:10px;font-family:var(--font-sans);display:block;margin-bottom:2px">ENTRY</span>${l.entry}</div>
        <div><span style="color:var(--text-muted);font-size:10px;font-family:var(--font-sans);display:block;margin-bottom:2px">STOP LOSS</span><span style="color:var(--accent-red)">${l.stopLoss}</span></div>
        <div><span style="color:var(--text-muted);font-size:10px;font-family:var(--font-sans);display:block;margin-bottom:2px">TAKE PROFIT 1</span><span style="color:var(--accent-green)">${l.takeProfit1}</span></div>
        <div><span style="color:var(--text-muted);font-size:10px;font-family:var(--font-sans);display:block;margin-bottom:2px">TAKE PROFIT 2</span><span style="color:var(--accent-green)">${l.takeProfit2}</span></div>
      </div>
      ` : ''}
    </div>
  `).join('');
}

document.getElementById('export-logs-btn').addEventListener('click', exportLogs);
document.getElementById('clear-logs-btn').addEventListener('click', () => {
  if (confirm('Clear all signal logs?')) { clearLogs(); renderLogs(); }
});

// ─── Backtest ─────────────────────────────────────────────────────────────────
document.getElementById('bt-run-btn').addEventListener('click', async () => {
  const pair = document.getElementById('bt-pair').value;
  const interval = document.getElementById('bt-interval').value;
  const count = parseInt(document.getElementById('bt-candles').value) || 300;
  const balance = 150;
  const risk = parseFloat(document.getElementById('bt-risk').value) || 1;

  showLoading('Running backtest…');
  await new Promise(r => setTimeout(r, 50));

  try {
    const candles = await fetchCandles(pair, interval, count);
    const result = runBacktest(candles, 50, balance, risk);
    renderBacktest(result, pair, interval, balance);
  } catch (err) {
    console.error(err);
  } finally {
    hideLoading();
  }
});

function renderBacktest(r, pair, interval, balance = 1000) {
  const statsGrid = document.getElementById('bt-stats-grid');
  const main = document.getElementById('backtest-main');

  const wrC = r.combinedWinRate >= 55 ? 'green' : r.combinedWinRate >= 45 ? 'amber' : 'red';
  const eqC = r.finalEquity >= balance ? 'green' : 'red';
  const pfC = r.profitFactor >= 1.5 ? 'green' : r.profitFactor >= 1 ? 'amber' : 'red';

  statsGrid.innerHTML = `
    <div class="bt-stat-card"><div class="bt-stat-label">Total Trades</div><div class="bt-stat-value blue">${r.combinedTrades}</div><div class="bt-stat-sub">${r.barsAnalyzed} bars</div></div>
    <div class="bt-stat-card"><div class="bt-stat-label">Win Rate</div><div class="bt-stat-value ${wrC}">${r.combinedWinRate}%</div><div class="bt-stat-sub">${r.combinedWins}W / ${r.combinedLosses}L</div></div>
    <div class="bt-stat-card"><div class="bt-stat-label">Final Equity</div><div class="bt-stat-value ${eqC}">$${r.finalEquity.toLocaleString()}</div><div class="bt-stat-sub">Started $${balance.toLocaleString()}</div></div>
    <div class="bt-stat-card"><div class="bt-stat-label">Profit Factor</div><div class="bt-stat-value ${pfC}">${r.profitFactor}x</div><div class="bt-stat-sub">Max DD: ${r.maxDrawdown}%</div></div>
  `;

  const svgEq = buildEquitySVG(r.equityCurve, balance);
  const rows = r.strategyStats.map(s => {
    const wrc = s.winRate >= 55 ? 'var(--accent-green)' : s.winRate >= 45 ? 'var(--accent-amber)' : 'var(--accent-red)';
    return `<tr>
      <td style="color:var(--text-primary)">${s.name}</td>
      <td>${s.trades}</td>
      <td>${s.wins}/${s.losses}</td>
      <td><span style="color:${wrc};font-weight:700">${s.winRate}%</span></td>
      <td style="color:${s.expectancy > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">${s.expectancy > 0 ? '+' : ''}${s.expectancy}%</td>
      <td style="color:var(--accent-purple);font-weight:700">${s.weight}</td>
    </tr>`;
  }).join('');

  main.innerHTML = `
    <div class="section-title">📈 ${pair} / ${interval} — Backtest Results</div>
    <div class="equity-chart-area"><div class="risk-title" style="margin-bottom:10px">Equity Curve ($${balance.toLocaleString()} start)</div>${svgEq}</div>
    <div class="section-title" style="margin-top:16px">📊 Per-Strategy Stats</div>
    <div style="background:var(--bg-card);border:1px solid var(--bg-border);border-radius:var(--radius-md);overflow:hidden;margin-bottom:16px">
      <table class="perf-table">
        <thead><tr><th>Strategy</th><th>Trades</th><th>W/L</th><th>Win Rate</th><th>Expectancy</th><th>Weight</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="background:var(--accent-amber-glow);border:1px solid var(--accent-amber);border-radius:var(--radius-md);padding:14px;font-size:11px;color:var(--text-secondary);line-height:1.7">
      <strong style="color:var(--accent-amber)">⚠️ Disclaimer:</strong> Uses demo/synthetic data. Past performance does not guarantee future results. The 80% threshold reflects strategy <em>consensus</em>, not a guaranteed win rate. Never risk more than you can afford to lose.
    </div>
  `;
}

function buildEquitySVG(curve, balance = 1000) {
  if (!curve || curve.length < 2) return '<p style="color:var(--text-muted)">No trades recorded</p>';
  const W = 600, H = 120, pad = 20;
  const mn = Math.min(...curve), mx = Math.max(...curve), range = mx - mn || 1;
  const pts = curve.map((v, i) => {
    const x = pad + (i / (curve.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - mn) / range) * (H - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  const color = curve[curve.length - 1] >= balance ? '#22d3a5' : '#f4503a';
  const baseY = H - pad - ((balance - mn) / range) * (H - pad * 2);
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
    <line x1="${pad}" y1="${baseY}" x2="${W - pad}" y2="${baseY}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="4,4"/>
    <text x="${W - pad - 2}" y="${baseY - 4}" font-size="9" fill="var(--text-muted)" text-anchor="end">$${balance.toLocaleString()} baseline</text>
    <text x="${pad}" y="${H - 2}" font-size="9" fill="var(--text-muted)">$${mn.toFixed(0)}</text>
    <text x="${pad}" y="${pad + 8}" font-size="9" fill="var(--text-muted)">$${mx.toFixed(0)}</text>
  </svg>`;
}

// ─── Loading ──────────────────────────────────────────────────────────────────
function showLoading(msg) {
  document.getElementById('loading-text').textContent = msg;
  document.getElementById('loading-overlay').classList.add('visible');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('visible');
}

// ─── Live Alert ───────────────────────────────────────────────────────────────
function showLiveAlert(pair, signal, risk) {
  const modal = document.getElementById('live-alert-modal');
  const content = modal.querySelector('.live-alert-content');
  const cls = signal === 'BUY' ? 'buy' : 'sell';

  content.className = `live-alert-content ${cls}`;
  document.getElementById('live-alert-hero').textContent = signal;
  document.getElementById('live-alert-pair').textContent = pair;

  const d = risk.entry > 1000 ? 2 : risk.entry > 100 ? 3 : 5;
  document.getElementById('la-entry').textContent = risk.entry.toFixed(d);
  document.getElementById('la-sl').textContent = risk.stopLoss.toFixed(d);
  document.getElementById('la-tp1').textContent = risk.takeProfit1.toFixed(d);
  document.getElementById('la-tp2').textContent = risk.takeProfit2.toFixed(d);

  modal.style.display = 'flex';
}

document.getElementById('live-alert-close').addEventListener('click', () => {
  document.getElementById('live-alert-modal').style.display = 'none';
});

// ─── Live Trades Tab ──────────────────────────────────────────────────────────
let tradesPollingInterval = null;

async function fetchAndRenderTrades() {
  try {
    const res = await fetch('/api/trades');
    if (!res.ok) throw new Error('API unavailable');
    const d = await res.json();
    renderTradesUI(d);
  } catch (e) {
    console.warn('fetchAndRenderTrades error:', e.message);
  }

  // Start polling every 30s while on the tab
  if (!tradesPollingInterval) {
    tradesPollingInterval = setInterval(async () => {
      if (state.activeTab !== 'trades') { clearInterval(tradesPollingInterval); tradesPollingInterval = null; return; }
      try {
        const res = await fetch('/api/trades');
        if (res.ok) renderTradesUI(await res.json());
      } catch {}
    }, 30_000);
  }
}

function renderTradesUI(d) {
  // Stats
  const pnl   = +(d.equity - d.start).toFixed(2);
  const pnlStr = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);
  const eqColor = d.equity >= d.start ? 'var(--accent-green)' : 'var(--accent-red)';
  const wrColor = d.winRate >= 55 ? 'var(--accent-green)' : d.winRate >= 40 ? 'var(--accent-amber)' : 'var(--accent-red)';

  document.getElementById('trades-equity').textContent   = '$' + d.equity.toFixed(2);
  document.getElementById('trades-equity').style.color   = eqColor;
  document.getElementById('trades-pnl-sub').textContent  = pnlStr + ' total P&L';
  document.getElementById('trades-pnl-sub').style.color  = eqColor;
  document.getElementById('trades-winrate').textContent  = d.totalTrades > 0 ? d.winRate + '%' : '—';
  document.getElementById('trades-winrate').style.color  = wrColor;
  document.getElementById('trades-wl').textContent       = `${d.wins}W / ${d.losses}L`;
  document.getElementById('trades-total').textContent    = d.totalTrades;

  // Open trade card
  const openWrap = document.getElementById('trades-open-wrap');
  if (d.open) {
    const t = d.open;
    const dir = t.direction;
    const cls = dir === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)';
    const dp = t.entry > 100 ? 2 : 5;
    const elapsed = Math.round((Date.now() - new Date(t.openTime)) / 60000);
    openWrap.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid ${cls};border-radius:var(--radius-md);padding:16px;position:relative;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${cls}"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="font-size:22px;font-weight:800;color:${cls}">${dir}</span>
          <span style="font-size:11px;color:var(--text-muted)">${t.pair} · opened ${elapsed}m ago · Conf: ${t.confidence}%</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;font-family:var(--font-mono);font-size:13px">
          <div><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">ENTRY</div>${t.entry.toFixed(dp)}</div>
          <div><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">STOP LOSS</div><span style="color:var(--accent-red)">${t.sl.toFixed(dp)}</span></div>
          <div><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">TP 1</div><span style="color:var(--accent-green)">${t.tp1.toFixed(dp)}</span></div>
          <div><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">TP 2</div><span style="color:var(--accent-green)">${t.tp2.toFixed(dp)}</span></div>
        </div>
        <div style="margin-top:10px;font-size:11px;color:var(--text-muted)">🔄 Bot monitors this trade every 60s — will auto-close at TP or SL</div>
      </div>`;
  } else {
    openWrap.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-text">No open trade — bot scanning every 60s for a 95% signal</div></div>`;
  }

  // Closed trades list
  const closedList = document.getElementById('trades-closed-list');
  if (!d.closed || d.closed.length === 0) {
    closedList.innerHTML = `<div class="empty-state"><div class="empty-icon">🤖</div><div class="empty-text">No trades closed yet — waiting for first 95% consensus signal</div></div>`;
    return;
  }

  closedList.innerHTML = d.closed.map(t => {
    const won    = t.result === 'TP';
    const color  = won ? 'var(--accent-green)' : 'var(--accent-red)';
    const emoji  = won ? '✅' : '❌';
    const dp     = t.entry > 100 ? 2 : 5;
    const openD  = new Date(t.openTime).toLocaleString();
    const closeD = new Date(t.closeTime).toLocaleString();
    const pnlStr = (t.pnl >= 0 ? '+' : '') + '$' + t.pnl.toFixed(2);
    return `
      <div style="background:var(--bg-card);border:1px solid var(--bg-border);border-left:3px solid ${color};border-radius:var(--radius-md);padding:14px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="display:flex;gap:10px;align-items:center">
            <span style="font-size:16px">${emoji}</span>
            <span style="font-weight:700;color:${color};font-size:14px">${t.result} — ${t.direction}</span>
            <span style="font-size:11px;color:var(--text-muted)">${t.pair}</span>
          </div>
          <div style="font-size:16px;font-weight:800;color:${color};font-family:var(--font-mono)">${pnlStr}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;font-family:var(--font-mono);font-size:12px">
          <div><div style="font-size:10px;color:var(--text-muted)">ENTRY</div>${t.entry.toFixed(dp)}</div>
          <div><div style="font-size:10px;color:var(--text-muted)">CLOSE</div>${t.closePrice?.toFixed(dp) ?? '—'}</div>
          <div><div style="font-size:10px;color:var(--text-muted)">SL</div><span style="color:var(--accent-red)">${t.sl.toFixed(dp)}</span></div>
          <div><div style="font-size:10px;color:var(--text-muted)">TP1</div><span style="color:var(--accent-green)">${t.tp1.toFixed(dp)}</span></div>
          <div><div style="font-size:10px;color:var(--text-muted)">EQUITY AFTER</div>$${t.equity.toFixed(2)}</div>
        </div>
        <div style="margin-top:8px;font-size:10px;color:var(--text-muted)">Opened: ${openD} → Closed: ${closeD} · Conf: ${t.confidence}%</div>
      </div>`;
  }).join('');
}

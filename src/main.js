/**
 * ForexSignal Pro — Main Application
 * Design philosophy: ONE final signal. 20 strategies run silently.
 * A BUY or SELL only fires when 95% consensus is reached.
 */

import './style.css';
import { initChart, updateChart, updateChartData, addSignalMarker } from './components/chart.js';
import { fetchCandles, fetchLivePrice, addSyntheticTick, PAIRS, INTERVALS } from './data/marketData.js';
import { runAllStrategies, aggregateSignals } from './strategies/strategies.js';
import { runBacktest, computeRiskParams } from './data/backtest.js';
import { logSignal, getLogs, clearLogs, exportLogs } from './data/signalLogger.js';

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
        <div class="logo-sub">20-Strategy Consensus Engine</div>
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
      <div class="api-key-wrap" id="api-key-wrap" title="Enter your free Twelve Data API key for live strategy data">
        <span class="api-key-icon">🔑</span>
        <input id="api-key-input" class="api-input" type="text"
          placeholder="Twelve Data key → live signals"
          autocomplete="off" spellcheck="false" />
        <a href="https://twelvedata.com/pricing" target="_blank" class="api-key-link">Free key</a>
      </div>
      <div class="live-badge" id="live-badge"><div class="live-dot"></div>LIVE</div>
      <button class="btn btn-primary" id="refresh-btn">↺ Refresh</button>
    </div>
  </header>

  <div class="tab-bar">
    <button class="tab-btn active" data-tab="dashboard">📡 Signal</button>
    <button class="tab-btn" data-tab="backtest">📈 Backtest</button>
    <button class="tab-btn" data-tab="trades">🤖 Live Trades</button>
    <button class="tab-btn" data-tab="logs">📋 Logs</button>
  </div>

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
            <div class="gauge-threshold" style="left:75%">
              <div class="gauge-threshold-line"></div>
            </div>
          </div>
          <div class="gauge-legend">
            <span>0%</span>
            <span class="gauge-threshold-label">75% Threshold</span>
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

        <!-- Strategy breakdown toggle -->
        <button class="strategies-toggle" id="strategies-toggle">
          <span>View 20 strategies ›</span>
          <span class="strat-counts" id="strat-counts"></span>
        </button>

        <!-- Strategy breakdown (collapsed by default) -->
        <div class="strategies-panel" id="strategies-panel" style="display:none">
          <div class="strat-filter-row">
            <button class="filter-btn active" data-filter="all">All</button>
            <button class="filter-btn" data-filter="Trend">Trend</button>
            <button class="filter-btn" data-filter="Momentum">Momentum</button>
            <button class="filter-btn" data-filter="Volatility">Volatility</button>
            <button class="filter-btn" data-filter="Price Action">Price</button>
            <button class="filter-btn" data-filter="Volume">Volume</button>
          </div>
          <div class="strat-list" id="strat-list"></div>
        </div>

        <!-- Reasoning -->
        <div class="reasoning-box">
          <div class="reasoning-title">SIGNAL REASONING</div>
          <div class="reasoning-body" id="signal-reasoning">Run analysis to see reasoning…</div>
        </div>

      </div>
    </div>

    <!-- ═══ BACKTEST ════════════════════════════════════════════════════════ -->
    <div class="panel" id="panel-backtest">
      <div class="backtest-layout">
        <div class="backtest-sidebar">
          <div class="backtest-controls">
            <h3 class="bt-title">Backtest Configuration</h3>
            <div class="form-group">
              <label class="form-label">Asset</label>
              <select class="form-input" id="bt-pair">
                ${PAIRS.map(p => `<option>${p}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Timeframe</label>
              <select class="form-input" id="bt-interval">
                ${INTERVALS.map(i => `<option value="${i.value}">${i.label}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Candles</label>
              <input class="form-input" id="bt-candles" type="number" value="300" min="100" max="5000" />
            </div>
            <div class="form-group">
              <label class="form-label">Account Balance</label>
              <input class="form-input" type="text" value="$150 USD (Fixed)" disabled style="background:var(--bg-lighter);cursor:not-allowed;color:var(--text-muted);" />
            </div>
            <div class="form-group">
              <label class="form-label">Risk Per Trade (%)</label>
              <input class="form-input" id="bt-risk" type="number" value="1.0" step="0.5" min="0.1" max="100" />
            </div>
            <button class="btn btn-primary" id="bt-run-btn" style="width:100%;justify-content:center;margin-top:4px">▶ Run Backtest</button>
          </div>
          <div class="bt-stats-grid" id="bt-stats-grid">
            <div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">No results yet</div></div>
          </div>
        </div>
        <div class="backtest-main" id="backtest-main">
          <div class="empty-state" style="padding-top:80px">
            <div class="empty-icon">📈</div>
            <div class="empty-text">Configure and run a backtest</div>
            <div class="empty-sub">Results include equity curve, per-strategy stats, and trade log</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ LOGS ════════════════════════════════════════════════════════════ -->
    <div class="panel" id="panel-logs">
      <div class="logs-toolbar">
        <div class="logs-count" id="logs-count">0 signals logged</div>
        <button class="btn" id="export-logs-btn" style="margin-left:auto">⬇ Export CSV</button>
        <button class="btn btn-danger" id="clear-logs-btn">🗑 Clear</button>
      </div>
      <div class="logs-list" id="logs-list">
        <div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No signals yet</div></div>
      </div>
    </div>

    <!-- ═══ LIVE TRADES (24/7 Paper Bot) ════════════════════════════════════ -->
    <div class="panel" id="panel-trades">
      <div style="padding:20px;max-width:900px;margin:0 auto">

        <!-- Stats Row -->
        <div class="bt-stats-grid" id="trades-stats-grid">
          <div class="bt-stat-card"><div class="bt-stat-label">Starting Balance</div><div class="bt-stat-value blue">$150</div><div class="bt-stat-sub">Fixed paper account</div></div>
          <div class="bt-stat-card"><div class="bt-stat-label">Current Equity</div><div class="bt-stat-value green" id="trades-equity">$150</div><div class="bt-stat-sub" id="trades-pnl-sub">+$0.00</div></div>
          <div class="bt-stat-card"><div class="bt-stat-label">Win Rate</div><div class="bt-stat-value" id="trades-winrate">—</div><div class="bt-stat-sub" id="trades-wl">0W / 0L</div></div>
          <div class="bt-stat-card"><div class="bt-stat-label">Total Trades</div><div class="bt-stat-value blue" id="trades-total">0</div><div class="bt-stat-sub">Closed positions</div></div>
        </div>

        <!-- Open Trade -->
        <div class="section-title" style="margin-top:20px">🟢 Currently Open Trade</div>
        <div id="trades-open-wrap">
          <div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-text">No open trade — bot scanning every 60s</div></div>
        </div>

        <!-- Closed Trades -->
        <div class="section-title" style="margin-top:20px">📋 Closed Trade History</div>
        <div id="trades-closed-list">
          <div class="empty-state"><div class="empty-icon">🤖</div><div class="empty-text">No trades closed yet — waiting for 95% signal</div></div>
        </div>

        <div style="margin-top:20px;background:var(--bg-card);border:1px solid var(--bg-border);border-radius:var(--radius-md);padding:14px;font-size:11px;color:var(--text-secondary);line-height:1.7">
          <strong style="color:var(--accent-amber)">⚠️ Paper Trading:</strong> All trades are virtual. No real money is at risk. The bot runs 24/7 in the background and automatically enters/exits positions based on live TradingView data.
        </div>
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
}, 300);

// ─── Tab Navigation ───────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`panel-${tab}`).classList.add('active');
    state.activeTab = tab;
    if (tab === 'logs') renderLogs();
    if (tab === 'trades') fetchAndRenderTrades();
  });
});

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
  toggle.querySelector('span').textContent = state.showStrategies ? 'Hide strategies ×' : 'View 20 strategies ›';
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
const apiKeyEl = document.getElementById('api-key-input');
const savedKey = localStorage.getItem('tdApiKey') || '';
if (savedKey) { apiKeyEl.value = savedKey; state.apiKey = savedKey; }

apiKeyEl.addEventListener('change', () => {
  state.apiKey = apiKeyEl.value.trim();
  localStorage.setItem('tdApiKey', state.apiKey);
  loadAndAnalyze(); // reload with new key
});

// ─── Load & Analyze ───────────────────────────────────────────────────────────
async function loadAndAnalyze() {
  showLoading('Loading ' + state.pair + '…');
  clearLiveIntervals();

  try {
    const candles = await fetchCandles(state.pair, state.interval, 300, state.apiKey || '');
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
      const quote = await fetchLivePrice(state.pair, state.apiKey || '');
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
        const fresh = await fetchCandles(state.pair, state.interval, 300, state.apiKey || '');
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

// ─── Core Analysis ────────────────────────────────────────────────────────────
function runAnalysis() {
  if (!state.candles.length) return;

  const results = runAllStrategies(state.candles);
  const agg = aggregateSignals(results);

  state.strategyResults = results;
  state.aggregated = agg;

  // Risk params only on confirmed signal
  state.riskParams = (agg.thresholdMet && agg.finalSignal !== 'NO TRADE')
    ? computeRiskParams(state.candles, agg.finalSignal, agg.finalConfidence, state.interval)
    : null;

  // Mark signal on chart and FIRE LIVE ALERT
  if (agg.thresholdMet && agg.finalSignal !== 'NO TRADE' && agg.finalSignal !== state.lastSignal) {
    addSignalMarker(state.candles[state.candles.length - 1], agg.finalSignal);
    state.lastSignal = agg.finalSignal;
    
    // FIRE LIVE ALERT NOTIFICATION AND EMAIL
    if (state.riskParams) {
      showLiveAlert(state.pair, agg.finalSignal, state.riskParams);

      // Dispatch native automated email via proxy
      const mailStr = `Forex Signal Fired!\\n\\n` +
        `Action: ${agg.finalSignal}\\n` +
        `Asset: ${state.pair}\\n` +
        `Confidence: ${agg.finalConfidence}% (${agg.riskLevel})\\n\\n` +
        `📈 RISK PARAMETERS:\\n` +
        `Entry: ${state.riskParams.entry}\\n` +
        `Stop Loss: ${state.riskParams.stopLoss}\\n` +
        `Take Profit 1 (1.5R): ${state.riskParams.takeProfit1}\\n` +
        `Take Profit 2: ${state.riskParams.takeProfit2}\\n`;

      fetch('http://localhost:5173/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'salimalnuaimi116@outlook.com',
          subject: `Signal: ${agg.finalSignal} ${state.pair} (${agg.riskLevel})`,
          content: mailStr
        })
      }).catch(e => console.warn("Automated email dispatch failed", e));
    }
  }

  // Log
  logSignal({
    pair: state.pair,
    timeframe: state.interval,
    signal: agg.finalSignal,
    confidence: agg.finalConfidence,
    buyCount: agg.buyCount,
    sellCount: agg.sellCount,
    neutralCount: agg.neutralCount,
    marketStatus: agg.marketStatus,
    ...(state.riskParams || {})
  });

  renderSignal(agg);
  renderRisk(state.riskParams, agg);
  renderReasoning(results, agg);
  if (state.showStrategies) renderStrategyList();

  // Countdown timer
  document.getElementById('analysis-timestamp').textContent = new Date().toLocaleTimeString();
  let cd = 15;
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

// ─── Render Signal Hero ───────────────────────────────────────────────────────
function renderSignal(agg) {
  const hero = document.getElementById('signal-hero');
  const valEl = document.getElementById('signal-value');
  const subEl = document.getElementById('signal-sub');
  const fill = document.getElementById('gauge-fill');
  const pctEl = document.getElementById('conf-pct');
  const marketEl = document.getElementById('market-status');

  const sig = agg.finalSignal;
  const cls = sig === 'BUY' ? 'buy' : sig === 'SELL' ? 'sell' : 'no-trade';

  // hero card
  hero.className = `signal-hero ${cls}`;
  valEl.textContent = sig;
  valEl.className = `signal-hero-value ${cls}`;

  if (sig === 'BUY') subEl.textContent = `${agg.buyCount} of 20 strategies aligned — ${agg.riskLevel}`;
  else if (sig === 'SELL') subEl.textContent = `${agg.sellCount} of 20 strategies aligned — ${agg.riskLevel}`;
  else subEl.textContent = `Only ${Math.max(agg.buyCount, agg.sellCount)} of 20 aligned — 75% threshold not met`;

  // gauge
  const conf = agg.finalConfidence;
  const gClass = conf >= 85 ? 'high' : conf >= 75 ? 'mid' : 'low';
  fill.style.width = `${conf}%`;
  fill.className = `gauge-fill ${gClass}`;
  pctEl.textContent = `${conf}%`;
  pctEl.className = `gauge-pct ${gClass}`;

  // votes
  document.getElementById('count-buy').textContent = agg.buyCount;
  document.getElementById('count-sell').textContent = agg.sellCount;
  document.getElementById('count-neutral').textContent = agg.neutralCount;

  // market status
  marketEl.textContent = agg.marketStatus.toUpperCase();
  marketEl.className = `market-val ${agg.marketStatus}`;

  // strat counts badge
  document.getElementById('strat-counts').textContent =
    `▲${agg.buyCount} ▼${agg.sellCount} ◼${agg.neutralCount}`;
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
  document.getElementById('risk-tp2').textContent = `${risk.takeProfit2.toFixed(d)} (${risk.tp2Points} pts)`;
  document.getElementById('risk-rr').textContent = `1 : ${risk.riskReward}`;

  const volWarn = document.getElementById('risk-vol-warn');
  volWarn.style.display = risk.highVolatility ? 'flex' : 'none';
  if (risk.highVolatility) {
    document.getElementById('risk-vol-text').textContent =
      `High volatility (${risk.volatilityPct}% ATR) — consider reducing position size`;
  }
}

// ─── Render Reasoning ─────────────────────────────────────────────────────────
function renderReasoning(results, agg) {
  const el = document.getElementById('signal-reasoning');
  const sig = agg.finalSignal;
  const direction = sig === 'BUY' ? 'buy' : sig === 'SELL' ? 'sell' : null;

  const supporting = direction
    ? results.filter(r => r.signal === direction).sort((a, b) => b.weight * b.confidence - a.weight * a.confidence).slice(0, 5)
    : results.filter(r => r.signal === 'neutral').slice(0, 3);

  const header = sig === 'NO TRADE'
    ? `<div class="reasoning-alert amber">⚠️ ${agg.finalConfidence}% consensus — below 75% threshold. ${agg.buyCount} strategies bullish vs ${agg.sellCount} bearish. Waiting for stronger alignment.</div>`
    : `<div class="reasoning-alert ${sig === 'BUY' ? 'green' : 'red'}">✅ ${sig} confirmed at ${agg.finalConfidence}% consensus (${agg.riskLevel}). ${direction === 'buy' ? agg.buyCount : agg.sellCount}/20 strategies agree.</div>`;

  const bullets = supporting.map(r =>
    `<div class="reasoning-item"><span class="reasoning-name">${r.name}</span><span class="reasoning-text">${r.reason}</span></div>`
  ).join('');

  el.innerHTML = header + bullets;
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
      <strong style="color:var(--accent-amber)">⚠️ Disclaimer:</strong> Uses demo/synthetic data. Past performance does not guarantee future results. The 75% threshold reflects strategy <em>consensus</em>, not a guaranteed win rate. Never risk more than you can afford to lose.
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

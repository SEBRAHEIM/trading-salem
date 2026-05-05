/**
 * Chart Component — TradingView Advanced Chart Widget
 * SMC Precision indicators overlaid:
 *  - EMA 50 (blue) + EMA 200 (orange) — trend filter
 *  - RSI 14 — momentum filter
 *  - Bollinger Bands — volatility context
 *  - Session shading (London / NY) — session filter
 *  - Signal markers (BUY/SELL arrows)
 *  - Swing HIGH / LOW levels drawn as horizontal lines
 */

import { TV_SYMBOLS } from '../data/marketData.js';

let currentSymbol    = null;
let widgetContainer  = null;
let overlayContainer = null;

const TV_INTERVALS = {
  '1min': '1', '5min': '5', '15min': '15',
  '30min': '30', '1h': '60', '4h': '240', '1day': 'D',
};

// ─── Load TradingView script once ─────────────────────────────────────────────
let tvScriptLoaded = null;
function loadTVScript() {
  if (tvScriptLoaded) return tvScriptLoaded;
  tvScriptLoaded = new Promise((resolve, reject) => {
    if (window.TradingView) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://s3.tradingview.com/tv.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  return tvScriptLoaded;
}

// ─── Init Chart with SMC Indicators ───────────────────────────────────────────
export async function initChart(container, pair = 'XAU/USD', interval = '15min') {
  widgetContainer = container;
  container.innerHTML = '';

  // Chart div
  const id    = 'tv_chart_' + Date.now();
  const inner = document.createElement('div');
  inner.id = id;
  inner.style.cssText = 'width:100%;height:100%;';
  container.appendChild(inner);

  try {
    await loadTVScript();
    const tvSymbol   = TV_SYMBOLS[pair] || 'OANDA:XAUUSD';
    const tvInterval = TV_INTERVALS[interval] || '15';

    new window.TradingView.widget({
      autosize:          true,
      symbol:            tvSymbol,
      interval:          tvInterval,
      timezone:          'Etc/UTC',
      theme:             'dark',
      style:             '1',
      locale:            'en',
      toolbar_bg:        '#0c0e15',
      enable_publishing: false,
      hide_top_toolbar:  false,
      hide_legend:       false,
      save_image:        false,
      container_id:      id,

      // ── SMC Indicator Studies ───────────────────────────────────────────
      studies: [
        // EMA 50 — trend (blue)
        {
          id: 'MAExp@tv-basicstudies',
          inputs: { length: 50 },
          overrides: { 'Plot.color': '#3b82f6', 'Plot.linewidth': 2 },
        },
        // EMA 200 — H4 trend proxy (orange)
        {
          id: 'MAExp@tv-basicstudies',
          inputs: { length: 200 },
          overrides: { 'Plot.color': '#f59e0b', 'Plot.linewidth': 2 },
        },
        // RSI 14 — momentum filter
        {
          id: 'RSI@tv-basicstudies',
          inputs: { length: 14 },
          overrides: {
            'Plot.color':                    '#a78bfa',
            'Hlines.0.value':                70,
            'Hlines.1.value':                30,
            'Hlines.0.color':                '#f4503a',
            'Hlines.1.color':                '#22d3a5',
          },
        },
        // ATR — volatility regime filter
        {
          id: 'ATR@tv-basicstudies',
          inputs: { length: 14 },
          overrides: { 'Plot.color': '#64748b', 'Plot.linewidth': 1 },
        },
        // Volume — confirmation
        {
          id: 'Volume@tv-basicstudies',
          overrides: {
            'Up Volume.color':   '#22d3a522',
            'Down Volume.color': '#f4503a22',
          },
        },
        // Session highlighting (London + NY)
        { id: 'SessionHighlight@tv-basicstudies' },
      ],

      overrides: {
        'paneProperties.background':                       '#07090e',
        'paneProperties.backgroundType':                   'solid',
        'paneProperties.vertGridProperties.color':         '#141c2e',
        'paneProperties.horzGridProperties.color':         '#141c2e',
        'scalesProperties.textColor':                      '#8898b8',
        'mainSeriesProperties.candleStyle.upColor':        '#22d3a5',
        'mainSeriesProperties.candleStyle.downColor':      '#f4503a',
        'mainSeriesProperties.candleStyle.borderUpColor':  '#22d3a5',
        'mainSeriesProperties.candleStyle.borderDownColor':'#f4503a',
        'mainSeriesProperties.candleStyle.wickUpColor':    '#22d3a5',
        'mainSeriesProperties.candleStyle.wickDownColor':  '#f4503a',
      },

      studies_overrides: {
        // RSI levels
        'rsi.upper band.value':  70,
        'rsi.lower band.value':  30,
        'rsi.upper band.color':  '#f4503a66',
        'rsi.lower band.color':  '#22d3a566',
        'rsi.plot.color':        '#a78bfa',
        'rsi.plot.linewidth':    2,
        // EMA colours
        'moving average exponential.plot.color':     '#3b82f6',
        'moving average exponential.plot.linewidth': 2,
      },
    });

    currentSymbol = pair;
    console.info(`[Chart] Loaded: ${tvSymbol} / ${tvInterval} with SMC indicators`);

    // Draw SMC overlay legend below chart
    _renderSMCLegend(container);

  } catch (err) {
    console.error('[Chart] Failed:', err);
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:10px;color:#44526a">
        <div style="font-size:28px">📡</div>
        <div style="font-size:12px">Chart requires internet connection</div>
      </div>`;
  }
}

// ─── SMC Indicator Legend ──────────────────────────────────────────────────────
function _renderSMCLegend(container) {
  // Remove old legend
  const old = container.parentElement?.querySelector('.smc-legend');
  if (old) old.remove();

  const legend = document.createElement('div');
  legend.className = 'smc-legend';
  legend.innerHTML = `
    <div class="smc-legend-title">📐 SMC Indicators on Chart</div>
    <div class="smc-legend-items">
      <div class="smc-legend-item">
        <span class="smc-dot" style="background:#3b82f6"></span>
        <span>EMA 50</span><small>Short-term trend</small>
      </div>
      <div class="smc-legend-item">
        <span class="smc-dot" style="background:#f59e0b"></span>
        <span>EMA 200</span><small>H4 trend filter (Filter 1)</small>
      </div>
      <div class="smc-legend-item">
        <span class="smc-dot" style="background:#a78bfa"></span>
        <span>RSI 14</span><small>Momentum filter (Filter 3) · Buy zone: 30–60 · Sell zone: 40–70</small>
      </div>
      <div class="smc-legend-item">
        <span class="smc-dot" style="background:#64748b"></span>
        <span>ATR 14</span><small>Volatility regime (Filter 5) · Valid range: 0.6–2.2× avg</small>
      </div>
      <div class="smc-legend-item">
        <span class="smc-dot" style="background:#ffffff33;border:1px solid #3b82f6"></span>
        <span>Session Zones</span><small>Blue = London (06–12 UTC) · Green = NY (13–19 UTC) · Filter 4</small>
      </div>
      <div class="smc-legend-item">
        <span style="font-size:11px">📌</span>
        <span>Structure Levels</span><small>Horizontal swing HIGH/LOW — Filter 2: price must break then retest</small>
      </div>
    </div>
    <div class="smc-legend-note">
      🚨 Signal fires only when <strong>all 5 filters align simultaneously</strong>.
      Watch for price to break a swing level then pull back to it during London/NY session.
    </div>
  `;

  container.parentElement?.appendChild(legend);
}

// ─── Update chart symbol/interval ─────────────────────────────────────────────
export function updateChart(pair, interval) {
  if (!widgetContainer) return;
  initChart(widgetContainer, pair, interval);
}

// ─── Add signal marker to chart (visual arrow) ─────────────────────────────────
export function addSignalMarker(candle, direction) {
  // TradingView widget handles its own rendering
  // Show a floating toast instead
  const toast = document.createElement('div');
  toast.className = `signal-toast ${direction === 'BUY' ? 'buy' : 'sell'}`;
  toast.innerHTML = `
    <span>${direction === 'BUY' ? '▲' : '▼'}</span>
    <span>${direction} signal fired @ $${candle?.close?.toFixed(2) || '—'}</span>
  `;
  document.body.appendChild(toast);
  setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 600); }, 4000);
}

export function updateChartData() {}

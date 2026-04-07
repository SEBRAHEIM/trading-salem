/**
 * Chart Component — TradingView Advanced Chart Widget
 * Free, live prices, same chart as TradingView.com
 */

import { TV_SYMBOLS } from '../data/marketData.js';

let currentSymbol = null;
let widgetContainer = null;

// TradingView interval mapping
const TV_INTERVALS = {
  '1min':  '1',
  '5min':  '5',
  '15min': '15',
  '30min': '30',
  '1h':    '60',
  '4h':    '240',
  '1day':  'D',
};

// ─── Load TradingView script once ─────────────────────────────────────────────
let tvScriptLoaded = null;

function loadTVScript() {
  if (tvScriptLoaded) return tvScriptLoaded;
  tvScriptLoaded = new Promise((resolve, reject) => {
    if (window.TradingView) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://s3.tradingview.com/tv.js';
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return tvScriptLoaded;
}

// ─── Init Chart ───────────────────────────────────────────────────────────────
export async function initChart(container, pair = 'XAU/USD', interval = '15min') {
  widgetContainer = container;

  // Clear previous widget
  container.innerHTML = '';

  // Unique container id
  const id = 'tv_chart_' + Date.now();
  const inner = document.createElement('div');
  inner.id = id;
  inner.style.cssText = 'width:100%;height:100%;';
  container.appendChild(inner);

  try {
    await loadTVScript();

    const tvSymbol   = TV_SYMBOLS[pair]   || 'OANDA:XAUUSD';
    const tvInterval = TV_INTERVALS[interval] || '15';

    new window.TradingView.widget({
      autosize:          true,
      symbol:            tvSymbol,
      interval:          tvInterval,
      timezone:          'Etc/UTC',
      theme:             'dark',
      style:             '1',         // candlestick
      locale:            'en',
      toolbar_bg:        '#0c0e15',
      enable_publishing: false,
      hide_top_toolbar:  false,
      hide_legend:       false,
      save_image:        false,
      container_id:      id,
      studies:           [],
      overrides: {
        'paneProperties.background':            '#07090e',
        'paneProperties.backgroundType':        'solid',
        'paneProperties.vertGridProperties.color': '#141c2e',
        'paneProperties.horzGridProperties.color': '#141c2e',
        'scalesProperties.textColor':           '#8898b8',
        'mainSeriesProperties.candleStyle.upColor':         '#22d3a5',
        'mainSeriesProperties.candleStyle.downColor':       '#f4503a',
        'mainSeriesProperties.candleStyle.borderUpColor':   '#22d3a5',
        'mainSeriesProperties.candleStyle.borderDownColor': '#f4503a',
        'mainSeriesProperties.candleStyle.wickUpColor':     '#22d3a5',
        'mainSeriesProperties.candleStyle.wickDownColor':   '#f4503a',
      },
    });

    currentSymbol = pair;
    console.info(`[Chart] TradingView widget loaded: ${tvSymbol} / ${tvInterval}`);

  } catch (err) {
    console.error('[Chart] TradingView widget failed to load:', err);
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:10px;color:#44526a">
        <div style="font-size:28px">📡</div>
        <div style="font-size:12px">Chart requires internet connection</div>
      </div>`;
  }
}

// ─── Update chart symbol/interval ─────────────────────────────────────────────
export function updateChart(pair, interval) {
  if (!widgetContainer) return;
  // Re-init with new params
  initChart(widgetContainer, pair, interval);
}

// These are stubs — TradingView widget handles its own data
export function updateChartData() {}
export function addSignalMarker() {}

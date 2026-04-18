/**
 * Market Data Service
 * - /api/price  → TradingView's public quote (same price as the embedded chart)
 * - /api/candles → Yahoo Finance or Twelve Data OHLCV (server-side, no CORS)
 * When Yahoo Finance is rate-limited, generates synthetic candles anchored
 * to the REAL TradingView quote price so strategies run at the correct level.
 */

// TradingView widget symbols (Spot feeds)
export const TV_SYMBOLS = {
  'XAU/USD': 'OANDA:XAUUSD',
};

// ─── Cache ────────────────────────────────────────────────────────────────────
const cache     = new Map();
const priceCache = new Map();  // current-price cache (10s TTL)

// ─── Fetch current price from TradingView (same source as the TV chart) ───────
export async function fetchLivePrice(pair, apiKey = '') {
  const cached = priceCache.get(pair);
  if (cached && Date.now() - cached.ts < 10_000) return cached.data;

  try {
    const params = new URLSearchParams({ pair });
    if (apiKey) params.set('apikey', apiKey);
    const res  = await fetch(`/api/price?${params}`, { signal: AbortSignal.timeout(6000) });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    priceCache.set(pair, { data: json, ts: Date.now() });
    return json;
  } catch {
    return null;
  }
}

// ─── Fetch OHLCV candles ──────────────────────────────────────────────────────
export async function fetchCandles(pair, interval, count = 300, apiKey = '') {
  const cacheKey = `${pair}-${interval}`;
  const cached   = cache.get(cacheKey);

  // Fresh cache (<60s) — return immediately
  if (cached && Date.now() - cached.ts < 60_000) return cached.data;

  // Build params
  const params = new URLSearchParams({ pair, interval });
  if (apiKey && apiKey.length > 8) params.set('apikey', apiKey);

  try {
    const res  = await fetch(`/api/candles?${params}`, { signal: AbortSignal.timeout(15_000) });
    const json = await res.json();

    if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);

    const candles = json.candles.slice(-count);
    cache.set(cacheKey, { data: candles, ts: Date.now(), real: true });
    console.info(`[MarketData] ✅ LIVE (${json.source}) ${pair} ${interval} — ${candles.length} candles  close: $${candles.at(-1)?.close}`);
    return candles;

  } catch (err) {
    console.warn(`[MarketData] ⚠️ ${err.message}`);
  }

  // STALE-WHILE-REVALIDATE: Prefer old real data over synthetic
  if (cached?.real) {
    console.info('[MarketData] Serving stale real data whilst API recovers…');
    return cached.data;
  }

  // TRUE FALLBACK: Synthetic data — but anchored to REAL current price
  // from TradingView's own quote so at least the price level is correct
  const liveQuote = await fetchLivePrice(pair);
  const basePrice = liveQuote?.price ?? 3300.00;

  console.warn(`[MarketData] Using calibrated synthetic data @ real price $${basePrice}`);
  const synthetic = generateSyntheticCandles(pair, count, interval, basePrice);
  cache.set(cacheKey, { data: synthetic, ts: Date.now(), real: false });
  return synthetic;
}

// ─── Synthetic candles anchored to a given base price ────────────────────────
export function generateSyntheticCandles(pair = 'XAU/USD', count = 300, interval = '15min', basePrice = null) {
  const startPrice  = basePrice ?? 3300.00;

  const tfVolMult   = { '1min':1,'5min':2.2,'15min':4,'30min':6,'1h':9,'4h':18,'1day':35 }[interval] ?? 4;
  const volatility  = (startPrice > 1000 ? 0.8 : 0.18) * tfVolMult;
  const msPerCandle = { '1min':60e3,'5min':300e3,'15min':900e3,'30min':1800e3,'1h':3600e3,'4h':14400e3,'1day':86400e3 }[interval] ?? 900e3;

  // Work backwards from current real price so the LAST candle = real price
  const candles = [];
  let price = startPrice, trend = 0, trendStr = 0;
  const now = Date.now();

  for (let i = count - 1; i >= 0; i--) {
    if (Math.random() < 0.05) { trend = (Math.random() - 0.5) * 2; trendStr = Math.random() * 0.3; }
    const change = (Math.random() - 0.5) * volatility * 2 + trend * trendStr * volatility * 0.5;
    const open   = price;
    const close  = +(open - change).toFixed(2);  // subtract = going backwards in time
    candles.unshift({
      time:   Math.floor((now - i * msPerCandle) / 1000),
      open:   +(open - change).toFixed(2),
      high:   +(Math.max(open - change, open) + Math.abs(change) * Math.random() * 0.4).toFixed(2),
      low:    +(Math.min(open - change, open) - Math.abs(change) * Math.random() * 0.4).toFixed(2),
      close:  close,
      volume:    Math.floor(Math.random() * 5000 + 1000),
      synthetic: true,
    });
    price = open; // go backwards
  }

  // Force last candle close = real current price
  if (candles.length > 0) {
    const last = candles[candles.length - 1];
    candles[candles.length - 1] = {
      ...last,
      close: +startPrice.toFixed(2),
      high:  Math.max(last.high, +startPrice.toFixed(2)),
      low:   Math.min(last.low,  +startPrice.toFixed(2)),
    };
  }
  return candles;
}

// ─── Tick the last candle close slightly (for synthetic live feel) ────────────
export function addSyntheticTick(candles) {
  if (!candles.length) return candles;
  const last = candles[candles.length - 1];
  const p    = last.close;
  const j    = (p > 1000 ? 1.5 : 0.12) * (Math.random() - 0.5) * 2;
  const nc   = +(p + j).toFixed(2);
  return [
    ...candles.slice(0, -1),
    { ...last, close: nc, high: Math.max(last.high, nc), low: Math.min(last.low, nc) },
  ];
}

// ─── Exports ──────────────────────────────────────────────────────────────────
export const PAIRS = ['XAU/USD'];

export const INTERVALS = [
  { value: '1min',  label: '1 Min'  },
  { value: '5min',  label: '5 Min'  },
  { value: '15min', label: '15 Min' },
  { value: '30min', label: '30 Min' },
  { value: '1h',    label: '1 Hour' },
  { value: '4h',    label: '4 Hour' },
  { value: '1day',  label: '1 Day'  },
];

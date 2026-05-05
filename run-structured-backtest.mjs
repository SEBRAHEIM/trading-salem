/**
 * STRUCTURED BACKTEST ENGINE — XAU/USD
 * Fetches max history, runs 12 strategies, iterates controlled changes
 */

// ─── Fetch Historical Data ────────────────────────────────────────────────────
async function fetchCandles(interval = '1day', count = 5000) {
  // TradingView unofficial feed — same source as live bot
  const symbol = 'OANDA:XAUUSD';
  const url = `https://symbol-search.tradingview.com/symbol_search/?text=XAUUSD&hl=1&exchange=OANDA&lang=en&type=&domain=production`;

  // Use our own candles endpoint approach
  const res = await fetch(
    `https://trading-salem-zbf1.vercel.app/api/candles?pair=XAU/USD&interval=${interval}&count=${count}`
  );
  if (!res.ok) throw new Error('Candle fetch failed: ' + res.status);
  const { candles } = await res.json();
  return candles;
}

// ─── Indicators ──────────────────────────────────────────────────────────────
function ema(arr, period) {
  const k = 2 / (period + 1);
  const out = [arr[0]];
  for (let i = 1; i < arr.length; i++) out.push(arr[i] * k + out[i - 1] * (1 - k));
  return out;
}

function rsi(closes, period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    d > 0 ? gains += d : losses -= d;
  }
  const out = new Array(period).fill(50);
  let ag = gains / period, al = losses / period;
  out.push(100 - 100 / (1 + ag / (al || 0.001)));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    out.push(100 - 100 / (1 + ag / (al || 0.001)));
  }
  return out;
}

function atr(candles, period = 14) {
  const trs = [0];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const out = new Array(period).fill(trs[1]);
  let avg = trs.slice(1, period + 1).reduce((a, v) => a + v, 0) / period;
  out.push(avg);
  for (let i = period + 1; i < candles.length; i++) {
    avg = (avg * (period - 1) + trs[i]) / period;
    out.push(avg);
  }
  return out;
}

function adx(candles, period = 14) {
  const out = new Array(period * 2).fill(25);
  for (let i = period * 2; i < candles.length; i++) {
    const slice = candles.slice(i - period, i);
    let plusDM = 0, minusDM = 0, trSum = 0;
    for (let j = 1; j < slice.length; j++) {
      const c = slice[j], p = slice[j - 1];
      const upMove = c.high - p.high, downMove = p.low - c.low;
      if (upMove > downMove && upMove > 0) plusDM += upMove;
      if (downMove > upMove && downMove > 0) minusDM += downMove;
      trSum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    }
    const di_plus = trSum ? (plusDM / trSum) * 100 : 0;
    const di_minus = trSum ? (minusDM / trSum) * 100 : 0;
    const dx = (di_plus + di_minus) ? Math.abs(di_plus - di_minus) / (di_plus + di_minus) * 100 : 0;
    out.push(dx);
  }
  return out;
}

// ─── 12 Strategies (inline, same logic as live) ────────────────────────────
function runStrategies(candles, cfg) {
  if (candles.length < 60) return null;
  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const n      = candles.length - 1;

  const ema20v  = ema(closes, 20);
  const ema50v  = ema(closes, 50);
  const ema200v = ema(closes, 200);
  const rsiV    = rsi(closes);
  const atrV    = atr(candles);
  const adxV    = adx(candles);

  const price   = closes[n];
  const e20     = ema20v[n], e50 = ema50v[n], e200 = ema200v[n];
  const rsiNow  = rsiV[n];
  const atrNow  = atrV[n];
  const adxNow  = adxV[n];

  const votes = [];

  // 1. HTF Trend
  const htfBull = price > e200 && e50 > e200;
  const htfBear = price < e200 && e50 < e200;
  votes.push({ w: 12, sig: htfBull ? 'buy' : htfBear ? 'sell' : 'neutral' });

  // 2. Market Structure
  const h10 = Math.max(...highs.slice(n - 10, n));
  const l10 = Math.min(...lows.slice(n - 10, n));
  votes.push({ w: 11, sig: price > h10 * 0.998 ? 'buy' : price < l10 * 1.002 ? 'sell' : 'neutral' });

  // 3. EMA20 Pullback
  const pullbullish = price > e20 && price < e20 * 1.003 && e20 > e50;
  const pullbearish = price < e20 && price > e20 * 0.997 && e20 < e50;
  votes.push({ w: 10, sig: pullbullish ? 'buy' : pullbearish ? 'sell' : 'neutral' });

  // 4. RSI + MACD
  const ema12v = ema(closes, 12), ema26v = ema(closes, 26);
  const macdLine = ema12v[n] - ema26v[n];
  const macdSignalArr = ema(ema12v.map((v, i) => v - ema26v[i]), 9);
  const macdSig = macdLine - macdSignalArr[n];
  votes.push({ w: 9, sig: rsiNow < 45 && macdSig > 0 ? 'buy' : rsiNow > 55 && macdSig < 0 ? 'sell' : 'neutral' });

  // 5. Ichimoku (simplified)
  const tenkan = (Math.max(...highs.slice(n - 9, n + 1)) + Math.min(...lows.slice(n - 9, n + 1))) / 2;
  const kijun  = (Math.max(...highs.slice(n - 26, n + 1)) + Math.min(...lows.slice(n - 26, n + 1))) / 2;
  votes.push({ w: 9, sig: price > tenkan && tenkan > kijun ? 'buy' : price < tenkan && tenkan < kijun ? 'sell' : 'neutral' });

  // 6. Support & Resistance
  const h20 = Math.max(...highs.slice(n - 20, n));
  const l20  = Math.min(...lows.slice(n - 20, n));
  const mid  = (h20 + l20) / 2;
  votes.push({ w: 8, sig: price < l20 * 1.001 ? 'buy' : price > h20 * 0.999 ? 'sell' : price > mid ? 'buy' : 'sell' });

  // 7. ADX
  votes.push({ w: 8, sig: adxNow < 20 ? 'neutral' : price > e20 ? 'buy' : 'sell' });

  // 8. Bollinger
  const slice20 = closes.slice(n - 19, n + 1);
  const mean = slice20.reduce((a, v) => a + v, 0) / 20;
  const sd   = Math.sqrt(slice20.reduce((a, v) => a + (v - mean) ** 2, 0) / 20);
  const upper = mean + 2 * sd, lower = mean - 2 * sd;
  votes.push({ w: 7, sig: price < lower * 1.001 ? 'buy' : price > upper * 0.999 ? 'sell' : 'neutral' });

  // 9. ATR Volatility Regime
  const atr50  = atrV.slice(Math.max(0, n - 49), n + 1).reduce((a, v) => a + v, 0) / Math.min(50, n);
  const ratio  = atrNow / (atr50 || atrNow);
  const delta8 = closes[n] - closes[Math.max(0, n - 8)];
  votes.push({ w: 8, sig: ratio < 0.55 || ratio > 2.5 ? 'neutral' : delta8 > atr50 * 0.5 ? 'buy' : delta8 < -atr50 * 0.5 ? 'sell' : 'neutral' });

  // 10. RSI Divergence
  const rsiPrev5 = rsiV[n - 5] || 50;
  const bullDiv  = rsiNow > rsiPrev5 && closes[n] < closes[n - 5];
  const bearDiv  = rsiNow < rsiPrev5 && closes[n] > closes[n - 5];
  votes.push({ w: 10, sig: bullDiv ? 'buy' : bearDiv ? 'sell' : 'neutral' });

  // 11. Candlestick
  const c = candles[n], p = candles[n - 1];
  const bullEngulf = c.close > c.open && c.open < p.close && c.close > p.open && p.close < p.open;
  const bearEngulf = c.close < c.open && c.open > p.close && c.close < p.open && p.close > p.open;
  votes.push({ w: 9, sig: bullEngulf ? 'buy' : bearEngulf ? 'sell' : 'neutral' });

  // 12. VWAP (simplified: use price vs typical price MA)
  const typicals = candles.slice(n - 19, n + 1).map(c => (c.high + c.low + c.close) / 3);
  const vwap = typicals.reduce((a, v) => a + v, 0) / typicals.length;
  votes.push({ w: 9, sig: price > vwap * 1.001 ? 'buy' : price < vwap * 0.999 ? 'sell' : 'neutral' });

  // Aggregate
  let buyW = 0, sellW = 0, totalW = 0;
  for (const v of votes) {
    totalW += v.w;
    if (v.sig === 'buy') buyW += v.w;
    else if (v.sig === 'sell') sellW += v.w;
  }
  const buyPct  = (buyW / totalW) * 100;
  const sellPct = (sellW / totalW) * 100;

  // ADX veto: if ranging, require higher confidence
  const minConf = adxNow < 20 ? 88 : cfg.threshold;
  if (buyPct >= minConf)  return { signal: 'BUY',  conf: buyPct,  atrNow };
  if (sellPct >= minConf) return { signal: 'SELL', conf: sellPct, atrNow };
  return null;
}

// ─── Backtest Engine ─────────────────────────────────────────────────────────
function backtest(candles, cfg) {
  const {
    slMult     = 3.5,   // ATR multiplier for SL
    tpMult     = 2.0,   // SL multiplier for TP1
    threshold  = 85,    // % consensus needed
    cooldownMs = 4 * 60 * 60 * 1000,  // between signals
    riskPct    = 1.0,   // % equity at risk per trade
  } = cfg;

  let equity   = 10000; // use $10k for clearer % math
  const peak   = { eq: equity };
  let maxDD    = 0;
  let openTrade = null;
  let lastSigTime = 0;
  const trades = [];
  const equityCurve = [equity];

  const INTERVAL_MS = 15 * 60 * 1000; // 15min candles assumed

  for (let i = 60; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const bar   = candles[i];
    const time  = i * INTERVAL_MS; // synthetic time

    // Monitor open trade
    if (openTrade) {
      const { dir, entry, sl, tp1, dollarRisk } = openTrade;
      let result = null;

      if (dir === 'BUY') {
        if (bar.high >= tp1) result = 'TP1';
        else if (bar.low <= sl) result = 'SL';
      } else {
        if (bar.low <= tp1) result = 'TP1';
        else if (bar.high >= sl) result = 'SL';
      }

      if (result) {
        const pnl = result === 'TP1' ? +(dollarRisk * tpMult).toFixed(2) : -dollarRisk;
        equity = +(equity + pnl).toFixed(2);
        if (equity > peak.eq) peak.eq = equity;
        const dd = ((peak.eq - equity) / peak.eq) * 100;
        if (dd > maxDD) maxDD = dd;
        trades.push({ i, dir, entry, sl, tp1, result, pnl, equity });
        openTrade = null;
        lastSigTime = time;
      }
    }

    // Look for new signal
    if (!openTrade && time - lastSigTime >= cooldownMs) {
      const sig = runStrategies(slice, cfg);
      if (sig) {
        const atrNow    = sig.atrNow;
        const slDist    = Math.max(atrNow * slMult, atrNow * 1.5);
        const tp1Dist   = slDist * tpMult;
        const entry     = bar.close;
        const sl        = sig.signal === 'BUY' ? +(entry - slDist).toFixed(2) : +(entry + slDist).toFixed(2);
        const tp1       = sig.signal === 'BUY' ? +(entry + tp1Dist).toFixed(2) : +(entry - tp1Dist).toFixed(2);
        const dollarRisk = +(equity * (riskPct / 100)).toFixed(2);
        openTrade = { dir: sig.signal, entry, sl, tp1, dollarRisk };
        lastSigTime = time;
      }
    }

    equityCurve.push(equity);
  }

  const wins   = trades.filter(t => t.result === 'TP1').length;
  const losses = trades.filter(t => t.result === 'SL').length;
  const totalPnl = trades.reduce((a, t) => a + t.pnl, 0);
  const grossWin  = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));

  return {
    trades: trades.length,
    wins, losses,
    winRate: trades.length ? +((wins / trades.length) * 100).toFixed(1) : 0,
    totalPnl: +totalPnl.toFixed(2),
    totalPct: +((totalPnl / 10000) * 100).toFixed(2),
    profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : grossWin > 0 ? 99 : 0,
    maxDrawdown: +maxDD.toFixed(2),
    endEquity: +equity.toFixed(2),
    equityCurve,
    tradeList: trades.slice(-10),
  };
}

// ─── Run All Iterations ───────────────────────────────────────────────────────
async function main() {
  console.log('━'.repeat(65));
  console.log('  XAU/USD STRUCTURED BACKTEST ENGINE');
  console.log('  Fetching maximum historical data...');
  console.log('━'.repeat(65));

  let candles;
  try {
    candles = await fetchCandles('15min', 5000);
    console.log(`  ✅ ${candles.length} candles loaded`);
    const start = new Date(candles[0].time  * 1000 || Date.now() - candles.length * 15 * 60000);
    const end   = new Date(candles[candles.length - 1].time * 1000 || Date.now());
    console.log(`  📅 Period: ${start.toLocaleDateString()} → ${end.toLocaleDateString()}`);
  } catch (e) {
    console.error('  ❌ Failed to fetch candles:', e.message);
    process.exit(1);
  }

  const iterations = [
    {
      label: 'BASELINE (Current Settings)',
      cfg: { slMult: 3.5, tpMult: 2.0, threshold: 85, cooldownMs: 4 * 60 * 60 * 1000 }
    },
    {
      label: 'ITER 1 — TP tightened: 2.0x → 1.2x SL',
      cfg: { slMult: 3.5, tpMult: 1.2, threshold: 85, cooldownMs: 4 * 60 * 60 * 1000 }
    },
    {
      label: 'ITER 2 — Cooldown reduced: 4h → 1h',
      cfg: { slMult: 3.5, tpMult: 1.2, threshold: 85, cooldownMs: 1 * 60 * 60 * 1000 }
    },
    {
      label: 'ITER 3 — Threshold lowered: 85% → 75%',
      cfg: { slMult: 3.5, tpMult: 1.2, threshold: 75, cooldownMs: 1 * 60 * 60 * 1000 }
    },
    {
      label: 'ITER 4 — SL tightened: 3.5x → 2.5x ATR',
      cfg: { slMult: 2.5, tpMult: 1.2, threshold: 75, cooldownMs: 1 * 60 * 60 * 1000 }
    },
    {
      label: 'ITER 5 — OPTIMAL (best combo from evidence)',
      cfg: { slMult: 2.8, tpMult: 1.5, threshold: 78, cooldownMs: 90 * 60 * 1000 }
    },
  ];

  const results = [];
  console.log('');
  console.log('  Running simulations...\n');

  for (const iter of iterations) {
    process.stdout.write(`  ⏳ ${iter.label}...`);
    const r = backtest(candles, iter.cfg);
    results.push({ ...iter, ...r });
    const verdict = r.profitFactor >= 1.5 ? '✅' : r.profitFactor >= 1.0 ? '⚠️' : '❌';
    console.log(` ${verdict} Trades:${r.trades} WR:${r.winRate}% PF:${r.profitFactor} DD:${r.maxDrawdown}% P&L:${r.totalPct > 0 ? '+' : ''}${r.totalPct}%`);
  }

  // ─── Detailed Report ──────────────────────────────────────────────────────
  console.log('\n');
  console.log('━'.repeat(65));
  console.log('  FULL BACKTEST RESULTS TABLE');
  console.log('━'.repeat(65));
  console.log('  #  | Win%   | Trades | PF     | MaxDD  | P&L%   | Label');
  console.log('  ' + '-'.repeat(62));
  results.forEach((r, i) => {
    const pf  = String(r.profitFactor).padEnd(6);
    const wr  = String(r.winRate + '%').padEnd(6);
    const tr  = String(r.trades).padEnd(6);
    const dd  = String(r.maxDrawdown + '%').padEnd(6);
    const pl  = String((r.totalPct > 0 ? '+' : '') + r.totalPct + '%').padEnd(6);
    const verdict = r.profitFactor >= 1.5 ? '✅' : r.profitFactor >= 1.0 ? '⚠️' : '❌';
    console.log(`  ${verdict} ${String(i).padEnd(2)}| ${wr} | ${tr} | ${pf} | ${dd} | ${pl} | ${r.label.slice(0, 35)}`);
  });

  // ─── Analysis ─────────────────────────────────────────────────────────────
  console.log('\n');
  console.log('━'.repeat(65));
  console.log('  ANALYSIS PER ITERATION');
  console.log('━'.repeat(65));

  const base = results[0];
  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    const pfDelta  = (r.profitFactor - base.profitFactor).toFixed(2);
    const wrDelta  = (r.winRate - base.winRate).toFixed(1);
    const plDelta  = (r.totalPct - base.totalPct).toFixed(2);
    const ddDelta  = (r.maxDrawdown - base.maxDrawdown).toFixed(2);
    console.log(`\n  ${r.label}`);
    console.log(`  Trades: ${r.trades} (${r.trades > base.trades ? '+' : ''}${r.trades - base.trades})`);
    console.log(`  Win Rate: ${r.winRate}% (${wrDelta > 0 ? '+' : ''}${wrDelta}%)`);
    console.log(`  Profit Factor: ${r.profitFactor} (${pfDelta > 0 ? '+' : ''}${pfDelta})`);
    console.log(`  Max Drawdown: ${r.maxDrawdown}% (${ddDelta > 0 ? '+' : ''}${ddDelta}%)`);
    console.log(`  Net P&L: ${r.totalPct > 0 ? '+' : ''}${r.totalPct}% (${plDelta > 0 ? '+' : ''}${plDelta}%)`);
  }

  // ─── Best Config ──────────────────────────────────────────────────────────
  const best = [...results].sort((a, b) => b.profitFactor - a.profitFactor)[0];
  const safest = [...results].sort((a, b) => a.maxDrawdown - b.maxDrawdown)[0];

  console.log('\n');
  console.log('━'.repeat(65));
  console.log('  VERDICT & RECOMMENDATIONS');
  console.log('━'.repeat(65));
  console.log(`  📈 Best Profit Factor: "${best.label}"`);
  console.log(`     PF: ${best.profitFactor} | WR: ${best.winRate}% | P&L: ${best.totalPct}%`);
  console.log(`\n  🛡️  Safest (lowest drawdown): "${safest.label}"`);
  console.log(`     DD: ${safest.maxDrawdown}% | Trades: ${safest.trades}`);
  console.log(`\n  📊 Baseline performance: WR ${base.winRate}% | PF ${base.profitFactor} | P&L ${base.totalPct}%`);

  if (base.profitFactor < 1.0) {
    console.log('\n  ❌ BASELINE NOT PROFITABLE — strategy needs significant revision');
  } else if (base.profitFactor < 1.5) {
    console.log('\n  ⚠️  BASELINE MARGINAL — profitable but below industry standard 1.5');
  } else {
    console.log('\n  ✅ BASELINE PROFITABLE — strategy has real edge');
  }

  // Save results
  const fs = await import('fs');
  const report = { generatedAt: new Date().toISOString(), candles: candles.length, results };
  fs.writeFileSync('backtest-structured-report.json', JSON.stringify(report, null, 2));
  console.log('\n  📄 Full report saved: backtest-structured-report.json');
  console.log('━'.repeat(65));
}

main().catch(console.error);

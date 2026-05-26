/**
 * Professional XAUUSD Signal Engine — v3
 * 7 core strategies, all must reach 80%+ weighted consensus.
 * Bias-balanced: equal logic for BUY and SELL.
 */

import { Indicators as I } from './indicators.js';

const last  = arr => arr[arr.length - 1];
const prev  = (arr, n = 1) => arr[arr.length - 1 - n];

// ─── Strategy Context ─────────────────────────────────────────────────────────
export const strategyContext = {
  headlines: [],
};


// ─── Helpers ──────────────────────────────────────────────────────────────────
function emaLocal(src, period) {
  if (src.length < period) return new Array(src.length).fill(null);
  const k = 2 / (period + 1);
  let val = src.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = new Array(period - 1).fill(null);
  out.push(val);
  for (let i = period; i < src.length; i++) {
    val = src[i] * k + val * (1 - k);
    out.push(val);
  }
  return out;
}

function aggregateCandles(candles, factor) {
  if (factor <= 1) return candles;
  const out = [];
  for (let i = 0; i + factor <= candles.length; i += factor) {
    const sl = candles.slice(i, i + factor);
    out.push({
      time:   sl[0].time,
      open:   sl[0].open,
      high:   Math.max(...sl.map(c => c.high)),
      low:    Math.min(...sl.map(c => c.low)),
      close:  sl[sl.length - 1].close,
      volume: sl.reduce((a, c) => a + (c.volume || 0), 0),
    });
  }
  return out;
}

function findSwingPoints(candles, lookback = 5) {
  const highs = [], lows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const slice = candles.slice(i - lookback, i + lookback + 1);
    if (candles[i].high === Math.max(...slice.map(c => c.high)))
      highs.push({ i, price: candles[i].high });
    if (candles[i].low === Math.min(...slice.map(c => c.low)))
      lows.push({ i, price: candles[i].low });
  }
  return { highs, lows };
}

// ─── STRATEGIES ───────────────────────────────────────────────────────────────
export const STRATEGIES = [

  // 1. HTF Trend Bias — uses H1 (4×15m=1h) for reliable data, H4 when enough candles
  {
    id: 'htf_trend',
    name: 'H1/H4 Macro Trend',
    category: 'Trend',
    weight: 12,
    analyze(candles) {
      // Prefer H4 (16×15m), fall back to H1 (4×15m) — always actionable
      let agg = aggregateCandles(candles, 16); // H4
      let tfLabel = 'H4';
      if (agg.length < 22) {
        agg = aggregateCandles(candles, 4);   // H1
        tfLabel = 'H1';
      }
      if (agg.length < 22) return { signal: 'neutral', confidence: 0, reason: 'Not enough candle data for HTF analysis' };
      const closes = agg.map(c => c.close);
      const e20 = emaLocal(closes, Math.min(20, closes.length - 2));
      const e50 = emaLocal(closes, Math.min(50, closes.length - 2));
      const price = last(closes);
      const em20 = last(e20), em50 = last(e50);
      const em20p = prev(e20, 2);
      if (!em20 || !em50 || !em20p) return { signal: 'neutral', confidence: 0, reason: 'EMA not ready' };
      const slope = ((em20 - em20p) / em20p) * 100;
      let score = 0;
      if (price > em20)  score += 40; else score -= 40;
      if (em20  > em50)  score += 35; else score -= 35;
      if (slope > 0)     score += 25; else score -= 25;
      const sig  = score > 0 ? 'buy' : score < 0 ? 'sell' : 'neutral';
      const conf = Math.min(95, 50 + Math.abs(score) * 0.48);
      return { signal: sig, confidence: Math.round(conf), reason: `${tfLabel}: price ${price > em20 ? 'above' : 'below'} EMA20 (${em20.toFixed(2)}), EMA20 ${em20 > em50 ? '>' : '<'} EMA50, slope ${slope.toFixed(3)}%` };
    }
  },

  // 2. Market Structure — HH/HL = bull, LH/LL = bear
  {
    id: 'market_structure',
    name: 'Market Structure',
    category: 'Price Action',
    weight: 11,
    analyze(candles) {
      if (candles.length < 60) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      const { highs, lows } = findSwingPoints(candles, 5);
      if (highs.length < 3 || lows.length < 3) return { signal: 'neutral', confidence: 40, reason: 'Not enough swing points' };
      const h = highs.slice(-3), l = lows.slice(-3);
      const hh = h[2].price > h[1].price && h[1].price > h[0].price;
      const hl = l[2].price > l[1].price && l[1].price > l[0].price;
      const lh = h[2].price < h[1].price && h[1].price < h[0].price;
      const ll = l[2].price < l[1].price && l[1].price < l[0].price;
      if (hh && hl) return { signal: 'buy',  confidence: 90, reason: `Bullish structure: HH (${h[2].price.toFixed(2)}) + HL (${l[2].price.toFixed(2)})` };
      if (lh && ll) return { signal: 'sell', confidence: 90, reason: `Bearish structure: LH (${h[2].price.toFixed(2)}) + LL (${l[2].price.toFixed(2)})` };
      if (hh)  return { signal: 'buy',  confidence: 65, reason: `Partial bull: HH confirmed at ${h[2].price.toFixed(2)}, HL forming` };
      if (lh)  return { signal: 'sell', confidence: 65, reason: `Partial bear: LH confirmed at ${h[2].price.toFixed(2)}, LL forming` };
      return { signal: 'neutral', confidence: 40, reason: 'No clear swing structure' };
    }
  },

  // 3. EMA Pullback Entry — price touching 20 EMA in a trend = best entry
  {
    id: 'ema_pullback',
    name: 'EMA20 Pullback',
    category: 'Price Action',
    weight: 10,
    analyze(candles) {
      const closes  = candles.map(c => c.close);
      const e20arr  = emaLocal(closes, 20);
      const e50arr  = emaLocal(closes, 50);
      const atrArr  = I.atr(candles, 14);
      const price   = last(closes);
      const pricePrev = prev(closes);
      const e20     = last(e20arr);
      const e50     = last(e50arr);
      const atr     = last(atrArr) || 1;
      if (!e20 || !e50) return { signal: 'neutral', confidence: 0, reason: 'EMA not ready' };
      const dist    = Math.abs(price - e20);
      const near    = dist < atr * 0.6;
      const bullTrend = price > e50 && e20 > e50;
      const bearTrend = price < e50 && e20 < e50;
      // Ideal pullback: price comes from correct side and touches EMA
      const pullBuy  = bullTrend && near && price >= e20 && pricePrev >= e20;
      const pullSell = bearTrend && near && price <= e20 && pricePrev <= e20;
      // Bounce: price briefly pierced EMA and is recovering
      const bounceBuy  = bullTrend && price > e20 && prev(closes, 1) < prev(e20arr, 1);
      const bounceSell = bearTrend && price < e20 && prev(closes, 1) > prev(e20arr, 1);
      if (pullBuy  || bounceBuy)  return { signal: 'buy',  confidence: pullBuy  ? 83 : 73, reason: `EMA20 pullback in uptrend at ${e20.toFixed(2)} — ${pullBuy ? 'touching' : 'bounce above'} EMA` };
      if (pullSell || bounceSell) return { signal: 'sell', confidence: pullSell ? 83 : 73, reason: `EMA20 pullback in downtrend at ${e20.toFixed(2)} — ${pullSell ? 'touching' : 'bounce below'} EMA` };
      if (dist > atr * 2.5) {
        const extended = price > e20 ? 'buy' : 'sell';
        return { signal: extended, confidence: 42, reason: `Price extended ${(dist/atr).toFixed(1)}× ATR from EMA — wait for pullback` };
      }
      if (bullTrend) return { signal: 'buy',  confidence: 55, reason: `Price above EMA20 (${e20.toFixed(2)}) + EMA50 (${e50.toFixed(2)}) — bullish bias` };
      if (bearTrend) return { signal: 'sell', confidence: 55, reason: `Price below EMA20 (${e20.toFixed(2)}) + EMA50 (${e50.toFixed(2)}) — bearish bias` };
      return { signal: 'neutral', confidence: 38, reason: `Price between EMA20 and EMA50 — no clear directional bias` };
    }
  },

  // 4. RSI + MACD Momentum Confluence — both must agree
  {
    id: 'momentum',
    name: 'RSI + MACD Confluence',
    category: 'Momentum',
    weight: 9,
    analyze(candles) {
      const closes   = candles.map(c => c.close);
      const rsiArr   = I.rsi(closes, 14);
      const { macdLine, signalLine, histogram } = I.macd(closes);
      const rsi      = last(rsiArr), rsiP = prev(rsiArr);
      const hist     = last(histogram), histP = prev(histogram);
      const macd     = last(macdLine), sig = last(signalLine);
      if (rsi === null || macd === null) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      const rsiBull    = rsi > 50, rsiBear = rsi < 50;
      const macdBull   = macd > sig, macdBear = macd < sig;
      const histFlipUp = hist > 0 && histP <= 0;
      const histFlipDn = hist < 0 && histP >= 0;
      const rsiCrossUp = rsi > 50 && rsiP <= 50;
      const rsiCrossDn = rsi < 50 && rsiP >= 50;
      const overbought = rsi > 78, oversold = rsi < 22;
      // Strongest: histogram just flipped AND RSI agrees
      if (histFlipUp && rsiBull && !overbought)  return { signal: 'buy',  confidence: 85, reason: `MACD histogram flipped positive + RSI ${rsi.toFixed(1)} bullish — fresh momentum shift` };
      if (histFlipDn && rsiBear && !oversold)    return { signal: 'sell', confidence: 85, reason: `MACD histogram flipped negative + RSI ${rsi.toFixed(1)} bearish — fresh momentum shift` };
      // RSI crosses 50 with MACD alignment
      if (rsiCrossUp && macdBull) return { signal: 'buy',  confidence: 80, reason: `RSI crossed above 50 (${rsi.toFixed(1)}) + MACD bullish` };
      if (rsiCrossDn && macdBear) return { signal: 'sell', confidence: 80, reason: `RSI crossed below 50 (${rsi.toFixed(1)}) + MACD bearish` };
      // Both agree, sustained
      if (rsiBull && macdBull && !overbought)    return { signal: 'buy',  confidence: 65, reason: `RSI ${rsi.toFixed(1)} + MACD both bullish` };
      if (rsiBear && macdBear && !oversold)      return { signal: 'sell', confidence: 65, reason: `RSI ${rsi.toFixed(1)} + MACD both bearish` };
      // Divergence between RSI and MACD — wait
      if (rsiBull !== macdBull)                  return { signal: 'neutral', confidence: 32, reason: `RSI and MACD diverging — no entry` };
      return { signal: 'neutral', confidence: 42, reason: `RSI ${rsi.toFixed(1)} — no momentum confluence` };
    }
  },

  // 5. Ichimoku Cloud — full system
  {
    id: 'ichimoku',
    name: 'Ichimoku Cloud',
    category: 'Trend',
    weight: 9,
    analyze(candles) {
      const ich = I.ichimoku(candles);
      const curr = last(ich);
      const price = last(candles).close;
      if (!curr.tenkanSen || !curr.kijunSen) return { signal: 'neutral', confidence: 40, reason: 'Insufficient Ichimoku data' };
      const { tenkanSen, kijunSen, senkouA, senkouB } = curr;
      const cloudTop = Math.max(senkouA, senkouB);
      const cloudBot = Math.min(senkouA, senkouB);
      const above = price > cloudTop, below = price < cloudBot;
      const tkBull = tenkanSen > kijunSen;
      const bullCloud = senkouA > senkouB;
      if (!above && !below) return { signal: 'neutral', confidence: 45, reason: 'Price inside cloud — avoid trading' };
      let score = (above ? 40 : -40) + (tkBull ? 30 : -30) + (bullCloud ? 20 : -20);
      const sig  = score > 0 ? 'buy' : 'sell';
      const conf = Math.min(92, 50 + Math.abs(score));
      return { signal: sig, confidence: conf, reason: `${above ? 'Above' : 'Below'} cloud, TK ${tkBull ? 'bull' : 'bear'}, cloud ${bullCloud ? 'bullish' : 'bearish'}` };
    }
  },

  // 6. Support & Resistance — price at key structural levels
  {
    id: 'support_resistance',
    name: 'Support & Resistance',
    category: 'Price Action',
    weight: 8,
    analyze(candles) {
      const { support, resistance } = I.supportResistance(candles, 20);
      const price   = last(candles).close;
      const atrArr  = I.atr(candles, 14);
      const atr     = last(atrArr) || 1;
      const dRes    = resistance - price;
      const dSup    = price - support;
      const atSup   = dSup < atr * 0.5;
      const atRes   = dRes < atr * 0.5;
      if (atSup) return { signal: 'buy',  confidence: 80, reason: `Price at support ${support.toFixed(2)} — bounce zone (${dSup.toFixed(2)} away)` };
      if (atRes) return { signal: 'sell', confidence: 78, reason: `Price at resistance ${resistance.toFixed(2)} — rejection zone (${dRes.toFixed(2)} away)` };
      // Closer to support = bullish bias, closer to resistance = bearish bias
      if (dSup < dRes * 0.4)  return { signal: 'buy',  confidence: 58, reason: `Price closer to support (${support.toFixed(2)}) than resistance (${resistance.toFixed(2)})` };
      if (dRes < dSup * 0.4)  return { signal: 'sell', confidence: 58, reason: `Price closer to resistance (${resistance.toFixed(2)}) than support (${support.toFixed(2)})` };
      return { signal: 'neutral', confidence: 42, reason: `Price mid-range — S:${support.toFixed(2)} R:${resistance.toFixed(2)}` };
    }
  },

  // 7. ADX — only trade when market is actually trending
  {
    id: 'adx',
    name: 'ADX Trend Strength',
    category: 'Trend',
    weight: 8,
    analyze(candles) {
      const adxData = I.adx(candles, 14);
      const curr = last(adxData);
      if (!curr) return { signal: 'neutral', confidence: 0, reason: 'No ADX data' };
      const { adx, diPlus, diMinus } = curr;
      // Below 20 = ranging market, don't trade
      if (adx < 20) return { signal: 'neutral', confidence: 45, reason: `ADX ${adx.toFixed(1)} < 20 — market ranging, signals unreliable` };
      const strong = adx > 35;
      if (diPlus  > diMinus) return { signal: 'buy',  confidence: Math.min(92, 55 + adx * 0.9), reason: `ADX ${adx.toFixed(1)} — ${strong ? 'strong' : 'moderate'} uptrend. DI+${diPlus.toFixed(1)} > DI-${diMinus.toFixed(1)}` };
      return              { signal: 'sell', confidence: Math.min(92, 55 + adx * 0.9), reason: `ADX ${adx.toFixed(1)} — ${strong ? 'strong' : 'moderate'} downtrend. DI-${diMinus.toFixed(1)} > DI+${diPlus.toFixed(1)}` };
    }
  },

  // 8. Bollinger Bands — only at extremes (not mid-line noise)
  {
    id: 'bollinger',
    name: 'Bollinger Extremes',
    category: 'Volatility',
    weight: 7,
    analyze(candles) {
      const closes = candles.map(c => c.close);
      const bb     = I.bollingerBands(closes, 20, 2);
      const rsiArr = I.rsi(closes, 14);
      const curr   = last(bb);
      const rsi    = last(rsiArr);
      const price  = last(closes);
      if (curr.upper === null || rsi === null) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      const { upper, lower, mid, percentB } = curr;
      // Only fire at band extremes WITH RSI confirmation
      if (price <= lower && rsi < 40) return { signal: 'buy',  confidence: Math.min(87, 66 + (40 - rsi) * 0.8), reason: `Price at lower BB (${lower.toFixed(2)}), RSI oversold ${rsi.toFixed(1)}` };
      if (price >= upper && rsi > 60) return { signal: 'sell', confidence: Math.min(87, 66 + (rsi - 60) * 0.8), reason: `Price at upper BB (${upper.toFixed(2)}), RSI overbought ${rsi.toFixed(1)}` };
      // Mid-band: only fire if clearly on one side, not just barely
      if (percentB > 0.7)  return { signal: 'buy',  confidence: 52, reason: `Price in upper half of BB (${(percentB*100).toFixed(0)}%B)` };
      if (percentB < 0.3)  return { signal: 'sell', confidence: 52, reason: `Price in lower half of BB (${(percentB*100).toFixed(0)}%B)` };
      return { signal: 'neutral', confidence: 38, reason: 'Price at BB midzone — no extreme signal' };
    }
  },

  // 9. ATR Volatility Regime Filter
  //    Too quiet (spread kills you) or too explosive (stop hunt risk) -> NEUTRAL
  //    Sweet spot: reads momentum direction from recent candles
  {
    id: 'atr_volatility',
    name: 'ATR Volatility Regime',
    category: 'Volatility',
    weight: 8,
    analyze(candles) {
      if (candles.length < 60) return { signal: 'neutral', confidence: 0, reason: 'Insufficient candles' };

      // Compute ATR(14) for every bar
      const atrVals = [];
      for (let i = 1; i < candles.length; i++) {
        const p = candles[i - 1], c = candles[i];
        atrVals.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
      }
      const atr14 = [];
      for (let i = 13; i < atrVals.length; i++) {
        const s = atrVals.slice(i - 13, i + 1).reduce((a, v) => a + v, 0) / 14;
        atr14.push(s);
      }
      if (atr14.length < 50) return { signal: 'neutral', confidence: 0, reason: 'Not enough ATR history' };

      const curATR  = atr14[atr14.length - 1];
      const avgATR  = atr14.slice(-50).reduce((a, v) => a + v, 0) / 50;
      const ratio   = curATR / avgATR;

      if (ratio < 0.55) return { signal: 'neutral', confidence: 55, reason: 'ATR too quiet (' + ratio.toFixed(2) + 'x) - spread risk' };
      if (ratio > 2.5)  return { signal: 'neutral', confidence: 55, reason: 'ATR too explosive (' + ratio.toFixed(2) + 'x) - stop-hunt risk' };

      const recent   = candles.slice(-8);
      const delta    = recent[recent.length - 1].close - recent[0].close;
      const atr8ago  = atr14[atr14.length - 9] ?? curATR;
      const expanding = curATR > atr8ago * 1.05;
      const conf     = expanding ? 75 : 62;
      const tag      = 'ATR ' + ratio.toFixed(2) + 'x avg (' + (expanding ? 'expanding' : 'flat') + ')';

      if (Math.abs(delta) < avgATR * 0.5) return { signal: 'neutral', confidence: 55, reason: tag + ' - momentum too small' };

      return {
        signal: delta > 0 ? 'buy' : 'sell',
        confidence: conf,
        reason: tag + ' - ' + (delta > 0 ? '+' : '') + delta.toFixed(1) + ' pts momentum'
      };
    }
  },


  // 10. RSI Divergence
  {
    id: 'rsi_divergence',
    name: 'RSI Divergence',
    category: 'Momentum',
    weight: 10,
    analyze(candles) {
      if (candles.length < 30) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      const closes = candles.map(c => c.close);
      const highs  = candles.map(c => c.high);
      const lows   = candles.map(c => c.low);
      const rsiArr = I.rsi(closes, 14);
      const lb = 25;
      const rH = highs.slice(-lb), rL = lows.slice(-lb), rR = rsiArr.slice(-lb);
      const maxPI = rH.indexOf(Math.max(...rH));
      const minPI = rL.indexOf(Math.min(...rL));
      const lastP = closes[closes.length - 1];
      const lastR = rsiArr[rsiArr.length - 1];
      if (lastR === null) return { signal: 'neutral', confidence: 0, reason: 'RSI not ready' };
      const bearDiv = lastP > rH[maxPI] && lastR < (rR[maxPI] || lastR) && lastR > 52;
      const bullDiv = lastP < rL[minPI] && lastR > (rR[minPI] || lastR) && lastR < 48;
      const hidBull = lastP >= rL[minPI] && lastR > (rR[minPI] || lastR) && lastR < 50;
      const hidBear = lastP <= rH[maxPI] && lastR < (rR[maxPI] || lastR) && lastR > 50;
      if (bearDiv) return { signal: 'sell', confidence: 83, reason: `Bearish RSI divergence — price HH but RSI ${lastR.toFixed(1)} weakening` };
      if (bullDiv) return { signal: 'buy',  confidence: 83, reason: `Bullish RSI divergence — price LL but RSI ${lastR.toFixed(1)} recovering` };
      if (hidBull) return { signal: 'buy',  confidence: 62, reason: 'Hidden bullish divergence — uptrend continuation' };
      if (hidBear) return { signal: 'sell', confidence: 62, reason: 'Hidden bearish divergence — downtrend continuation' };
      return { signal: 'neutral', confidence: 40, reason: `No RSI divergence (RSI: ${lastR.toFixed(1)})` };
    }
  },

  // 11. Candlestick Confirmation
  {
    id: 'candle_confirm',
    name: 'Candlestick Confirmation',
    category: 'Price Action',
    weight: 9,
    analyze(candles) {
      if (candles.length < 4) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      const c0 = candles[candles.length - 1];
      const c1 = candles[candles.length - 2];
      const c2 = candles[candles.length - 3];
      const body0 = Math.abs(c0.close - c0.open);
      const range0 = c0.high - c0.low || 0.01;
      const body1 = Math.abs(c1.close - c1.open);
      const upperW = c0.high - Math.max(c0.open, c0.close);
      const lowerW = Math.min(c0.open, c0.close) - c0.low;
      const bull0 = c0.close > c0.open, bear0 = c0.close < c0.open;
      const bull1 = c1.close > c1.open, bear1 = c1.close < c1.open;
      const bullPin   = lowerW >= range0 * 0.6 && body0 <= range0 * 0.3 && lowerW > upperW * 2;
      const bearPin   = upperW >= range0 * 0.6 && body0 <= range0 * 0.3 && upperW > lowerW * 2;
      const bullEngulf = bull0 && bear1 && c0.close > c1.open && c0.open < c1.close && body0 > body1 * 1.1;
      const bearEngulf = bear0 && bull1 && c0.close < c1.open && c0.open > c1.close && body0 > body1 * 1.1;
      const bear2 = c2.close < c2.open, bull2 = c2.close > c2.open;
      const morningStar = bear2 && Math.abs(c2.close-c2.open) > (c2.high-c2.low)*0.5 && bull0 && body0 > range0*0.4;
      const eveningStar = bull2 && Math.abs(c2.close-c2.open) > (c2.high-c2.low)*0.5 && bear0 && body0 > range0*0.4;
      if (bullPin)     return { signal: 'buy',  confidence: 81, reason: `Bullish pin bar — ${(lowerW/range0*100).toFixed(0)}% lower wick rejection` };
      if (bearPin)     return { signal: 'sell', confidence: 81, reason: `Bearish pin bar — ${(upperW/range0*100).toFixed(0)}% upper wick rejection` };
      if (bullEngulf)  return { signal: 'buy',  confidence: 78, reason: 'Bullish engulfing — reversal candle' };
      if (bearEngulf)  return { signal: 'sell', confidence: 78, reason: 'Bearish engulfing — reversal candle' };
      if (morningStar) return { signal: 'buy',  confidence: 74, reason: 'Morning star — 3-candle bullish reversal' };
      if (eveningStar) return { signal: 'sell', confidence: 74, reason: 'Evening star — 3-candle bearish reversal' };
      if (body0 < range0 * 0.1) return { signal: 'neutral', confidence: 55, reason: 'Doji — indecision' };
      if (bull0 && body0 > range0 * 0.6) return { signal: 'buy',  confidence: 57, reason: `Strong bull candle (${(body0/range0*100).toFixed(0)}% body)` };
      if (bear0 && body0 > range0 * 0.6) return { signal: 'sell', confidence: 57, reason: `Strong bear candle (${(body0/range0*100).toFixed(0)}% body)` };
      return { signal: 'neutral', confidence: 40, reason: 'No significant candlestick pattern' };
    }
  },


  // 12. VWAP Strategy — the most important intraday level (used by every pro desk)
  {
    id: 'vwap',
    name: 'VWAP Position',
    category: 'Volume',
    weight: 9,
    analyze(candles) {
      const vwapArr = I.vwap(candles);
      const price   = last(candles).close;
      const vwap    = last(vwapArr);
      const atrArr  = I.atr(candles, 14);
      const atr     = last(atrArr) || 1;
      if (!vwap) return { signal: 'neutral', confidence: 0, reason: 'VWAP not ready' };
      const dist   = price - vwap;
      const distPct = (Math.abs(dist) / vwap) * 100;
      // Price well above VWAP = bullish (institutions buying above VWAP = strength)
      // Price well below VWAP = bearish (selling pressure below VWAP)
      const aboveVwap = price > vwap;
      const nearVwap  = Math.abs(dist) < atr * 0.4; // Within 0.4 ATR = at VWAP
      // Pullback to VWAP in uptrend = best buy entry (institutional support)
      if (nearVwap && aboveVwap)  return { signal: 'buy',  confidence: 76, reason: `Price pulling back to VWAP (${vwap.toFixed(2)}) from above — institutional support zone` };
      if (nearVwap && !aboveVwap) return { signal: 'sell', confidence: 76, reason: `Price bouncing to VWAP (${vwap.toFixed(2)}) from below — institutional resistance zone` };
      // Price strongly above/below VWAP
      if (aboveVwap && distPct > 0.15) return { signal: 'buy',  confidence: 65, reason: `Price ${distPct.toFixed(2)}% above VWAP (${vwap.toFixed(2)}) — bullish momentum` };
      if (!aboveVwap && distPct > 0.15) return { signal: 'sell', confidence: 65, reason: `Price ${distPct.toFixed(2)}% below VWAP (${vwap.toFixed(2)}) — bearish momentum` };
      // Right at VWAP — indecision
      return { signal: 'neutral', confidence: 48, reason: `Price at VWAP (${vwap.toFixed(2)}) — wait for breakout direction` };
    }
  },

];

// ─── Runner ───────────────────────────────────────────────────────────────────
export function runAllStrategies(candles) {
  return STRATEGIES.map(s => {
    try {
      const r = s.analyze(candles);
      return { id: s.id, name: s.name, category: s.category, weight: s.weight, ...r, confidence: Math.round(r.confidence) };
    } catch (e) {
      return { id: s.id, name: s.name, category: s.category, weight: s.weight, signal: 'neutral', confidence: 0, reason: `Error: ${e.message}` };
    }
  });
}

// ─── Aggregation ──────────────────────────────────────────────────────────────
export function aggregateSignals(results, lastSignal = null) {
  const totalWeight = results.reduce((s, r) => s + r.weight, 0);
  let buyScore = 0, sellScore = 0, neutralScore = 0;

  for (const r of results) {
    const wc = (r.weight / totalWeight) * (r.confidence / 100);
    if      (r.signal === 'buy')  buyScore  += wc;
    else if (r.signal === 'sell') sellScore += wc;
    else                          neutralScore += wc;
  }

  const buyCount     = results.filter(r => r.signal === 'buy').length;
  const sellCount    = results.filter(r => r.signal === 'sell').length;
  const neutralCount = results.filter(r => r.signal === 'neutral').length;
  const totalSignals = results.length;

  const topSignal    = buyScore > sellScore ? 'buy' : 'sell';
  const topScore     = Math.max(buyScore, sellScore);
  const totalDir     = buyScore + sellScore;
  const rawConf      = totalDir > 0 ? (topScore / totalDir) * 100 : 50;
  const dirCount     = topSignal === 'buy' ? buyCount : sellCount;
  const countRatio   = dirCount / totalSignals;
  let finalConfidence = Math.round(rawConf * 0.65 + countRatio * 100 * 0.35);

  // ─── THRESHOLD — 85% to open, 78% latch ────────────────────────────────────
  const THRESHOLD = lastSignal === topSignal.toUpperCase() ? 78 : 85;

  // ─── VETO SYSTEM ───────────────────────────────────────────────────────────
  // Core strategies that MUST NOT contradict each other for a valid trade.
  const htf   = results.find(r => r.id === 'htf_trend');
  const ms    = results.find(r => r.id === 'market_structure');
  const adx   = results.find(r => r.id === 'adx');

  let vetoReason = '';

  if (topSignal !== 'neutral') {
    // If H4 trend is clearly opposite to signal — veto
    if (htf && htf.signal !== 'neutral' && htf.signal !== topSignal && htf.confidence >= 70) {
      vetoReason = `VETO: H4 macro trend is ${htf.signal.toUpperCase()} — signal (${topSignal}) is counter-trend. Skipping.`;
    }
    // If market structure clearly opposes — veto
    else if (ms && ms.signal !== 'neutral' && ms.signal !== topSignal && ms.confidence >= 75) {
      vetoReason = `VETO: Market structure is ${ms.signal.toUpperCase()} — cannot trade against the structure.`;
    }
    // If ADX shows ranging market AND confidence is borderline — veto
    else if (adx && adx.signal === 'neutral' && finalConfidence < 88) {
      vetoReason = `VETO: ADX shows ranging market. Needs ≥88% confidence to enter. Current: ${finalConfidence}%.`;
    }
  }

  let finalSignal = 'NO TRADE';
  let riskLevel   = 'None';

  if (finalConfidence >= THRESHOLD && !vetoReason) {
    finalSignal = topSignal.toUpperCase();
    riskLevel   = finalConfidence >= 92 ? 'Low Risk' : finalConfidence >= 87 ? 'Moderate' : 'Caution';
  }

  const marketStatus = neutralCount > totalSignals * 0.5 ? 'sideways'
    : buyScore  > sellScore * 1.1 ? 'bullish'
    : sellScore > buyScore  * 1.1 ? 'bearish'
    : 'sideways';

  return {
    finalSignal, finalConfidence,
    buyCount, sellCount, neutralCount,
    buyScore:  Math.round(buyScore  * 100),
    sellScore: Math.round(sellScore * 100),
    marketStatus, threshold: THRESHOLD,
    thresholdMet: finalConfidence >= THRESHOLD && !vetoReason,
    riskLevel, vetoReason,
    breakdown: `${buyCount} buy / ${sellCount} sell / ${neutralCount} neutral out of ${totalSignals}`,
  };
}

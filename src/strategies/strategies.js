/**
 * 20 Trading Strategies Engine
 * Each strategy receives OHLCV candle data and returns:
 *   { signal: 'buy'|'sell'|'neutral', confidence: 0-100, reason: string, weight: number }
 */

import { Indicators as I } from './indicators.js';

const last = arr => arr[arr.length - 1];
const prev = (arr, n = 1) => arr[arr.length - 1 - n];

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Context — Holds external dynamic data like live news headlines
// ─────────────────────────────────────────────────────────────────────────────
export const strategyContext = {
  headlines: [],
  correlatedAssets: {
    // Expected format: 'DXY': { trend: 'up', value: 104.5 }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Strategy definitions — name, weight, analyzer function
// ─────────────────────────────────────────────────────────────────────────────

export const STRATEGIES = [

  // ─── 1. EMA Crossover (Weight: 8) ────────────────────────────────────────
  {
    id: 'ema_cross',
    name: 'EMA Crossover',
    category: 'Trend',
    weight: 8,
    description: 'Fast EMA(9) vs Slow EMA(21) crossover — classic trend-following signal.',
    analyze(candles) {
      const closes = candles.map(c => c.close);
      const ema9 = I.ema(closes, 9);
      const ema21 = I.ema(closes, 21);
      const currFast = last(ema9), currSlow = last(ema21);
      const prevFast = prev(ema9), prevSlow = prev(ema21);
      if (currFast === null || currSlow === null) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      const spread = ((currFast - currSlow) / currSlow) * 100;
      const justCrossed = (currFast > currSlow && prevFast <= prevSlow) || (currFast < currSlow && prevFast >= prevSlow);
      if (currFast > currSlow) {
        const conf = Math.min(95, 55 + Math.abs(spread) * 100 + (justCrossed ? 20 : 0));
        return { signal: 'buy', confidence: conf, reason: `EMA9 (${currFast.toFixed(4)}) above EMA21 (${currSlow.toFixed(4)})${justCrossed ? ' — fresh crossover' : ''}` };
      } else {
        const conf = Math.min(95, 55 + Math.abs(spread) * 100 + (justCrossed ? 20 : 0));
        return { signal: 'sell', confidence: conf, reason: `EMA9 (${currFast.toFixed(4)}) below EMA21 (${currSlow.toFixed(4)})${justCrossed ? ' — fresh crossover' : ''}` };
      }
    },
  },

  // ─── 2. SMA 50/200 Golden/Death Cross (Weight: 9) ────────────────────────
  {
    id: 'sma_golden_cross',
    name: 'Golden/Death Cross',
    category: 'Trend',
    weight: 9,
    description: 'SMA(50) vs SMA(200) — one of the most widely watched macro signals.',
    analyze(candles) {
      const closes = candles.map(c => c.close);
      const sma50 = I.sma(closes, 50);
      const sma200 = I.sma(closes, 200);
      const s50 = last(sma50), s200 = last(sma200);
      if (s50 === null || s200 === null) {
        // Fallback to 20/50 if not enough data
        const s20 = last(I.sma(closes, 20)), s50b = last(I.sma(closes, 50));
        if (s20 === null || s50b === null) return { signal: 'neutral', confidence: 40, reason: 'Insufficient data for 50/200 SMA, using trend direction' };
        const spread = ((s20 - s50b) / s50b) * 100;
        const signal = s20 > s50b ? 'buy' : 'sell';
        return { signal, confidence: 55 + Math.min(20, Math.abs(spread) * 10), reason: `SMA20/50 used (fallback): spread ${spread.toFixed(3)}%` };
      }
      const spread = ((s50 - s200) / s200) * 100;
      if (s50 > s200) return { signal: 'buy', confidence: Math.min(92, 65 + Math.abs(spread) * 5), reason: `Golden Cross — SMA50 (${s50.toFixed(4)}) above SMA200 (${s200.toFixed(4)})` };
      return { signal: 'sell', confidence: Math.min(92, 65 + Math.abs(spread) * 5), reason: `Death Cross — SMA50 (${s50.toFixed(4)}) below SMA200 (${s200.toFixed(4)})` };
    },
  },

  // ─── 3. RSI Overbought/Oversold (Weight: 7) ──────────────────────────────
  {
    id: 'rsi',
    name: 'RSI Signal',
    category: 'Momentum',
    weight: 7,
    description: 'RSI(14) — identifies overbought (>70) and oversold (<30) conditions.',
    analyze(candles) {
      const closes = candles.map(c => c.close);
      const rsi = I.rsi(closes, 14);
      const r = last(rsi);
      const rPrev = prev(rsi);
      if (r === null) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      if (r < 30) return { signal: 'buy', confidence: Math.min(92, 60 + (30 - r) * 1.5), reason: `RSI oversold at ${r.toFixed(1)} — reversal zone` };
      if (r > 70) return { signal: 'sell', confidence: Math.min(92, 60 + (r - 70) * 1.5), reason: `RSI overbought at ${r.toFixed(1)} — reversal zone` };
      if (r > 50 && rPrev <= 50) return { signal: 'buy', confidence: 58, reason: `RSI crossed above 50 (${r.toFixed(1)}) — bullish momentum` };
      if (r < 50 && rPrev >= 50) return { signal: 'sell', confidence: 58, reason: `RSI crossed below 50 (${r.toFixed(1)}) — bearish momentum` };
      const bias = r > 50 ? 'buy' : 'sell';
      return { signal: bias, confidence: 45+Math.abs(r-50)/2, reason: `RSI neutral at ${r.toFixed(1)}, slight ${bias} bias` };
    },
  },

  // ─── 4. MACD Signal Line Cross (Weight: 8) ────────────────────────────────
  {
    id: 'macd',
    name: 'MACD Crossover',
    category: 'Momentum',
    weight: 8,
    description: 'MACD(12,26,9) line vs signal line crossover with histogram confirmation.',
    analyze(candles) {
      const closes = candles.map(c => c.close);
      const { macdLine, signalLine, histogram } = I.macd(closes);
      const m = last(macdLine), s = last(signalLine), h = last(histogram);
      const mPrev = prev(macdLine), sPrev = prev(signalLine);
      if (m === null || s === null) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      const justCrossed = (m > s && mPrev <= sPrev) || (m < s && mPrev >= sPrev);
      const aboveZero = m > 0;
      if (m > s) {
        const conf = Math.min(90, 55 + (justCrossed ? 20 : 0) + (aboveZero ? 10 : 0) + Math.abs(h || 0) * 1000);
        return { signal: 'buy', confidence: conf, reason: `MACD (${m.toFixed(5)}) above signal (${s.toFixed(5)})${justCrossed ? ' — fresh bullish cross' : ''}${aboveZero ? ', above zero line' : ''}` };
      } else {
        const conf = Math.min(90, 55 + (justCrossed ? 20 : 0) + (!aboveZero ? 10 : 0) + Math.abs(h || 0) * 1000);
        return { signal: 'sell', confidence: conf, reason: `MACD (${m.toFixed(5)}) below signal (${s.toFixed(5)})${justCrossed ? ' — fresh bearish cross' : ''}${!aboveZero ? ', below zero line' : ''}` };
      }
    },
  },

  // ─── 5. Bollinger Bands (Weight: 7) ───────────────────────────────────────
  {
    id: 'bollinger',
    name: 'Bollinger Bands',
    category: 'Volatility',
    weight: 7,
    description: 'Price relative to BB(20,2) — squeeze and band touch signals.',
    analyze(candles) {
      const closes = candles.map(c => c.close);
      const bb = I.bollingerBands(closes, 20, 2);
      const curr = last(bb), prev1 = prev(bb);
      const price = last(closes);
      if (curr.upper === null) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      const { upper, lower, mid, percentB, bandwidth } = curr;
      const squeeze = bandwidth < 0.01;
      if (price <= lower) return { signal: 'buy', confidence: Math.min(88, 62 + (1 - percentB) * 25), reason: `Price at lower BB (${lower.toFixed(4)}) — mean reversion expected${squeeze ? ', low volatility squeeze' : ''}` };
      if (price >= upper) return { signal: 'sell', confidence: Math.min(88, 62 + percentB * 25), reason: `Price at upper BB (${upper.toFixed(4)}) — mean reversion expected${squeeze ? ', low volatility squeeze' : ''}` };
      if (price > mid) return { signal: 'buy', confidence: 52, reason: `Price above BB midline (${mid.toFixed(4)}), bullish bias` };
      return { signal: 'sell', confidence: 52, reason: `Price below BB midline (${mid.toFixed(4)}), bearish bias` };
    },
  },

  // ─── 6. Stochastic Oscillator (Weight: 6) ────────────────────────────────
  {
    id: 'stochastic',
    name: 'Stochastic Oscillator',
    category: 'Momentum',
    weight: 6,
    description: 'Stochastic(14,3) K/D crossover with overbought/oversold zones.',
    analyze(candles) {
      const stoch = I.stochastic(candles, 14, 3);
      const curr = last(stoch), prev1 = prev(stoch);
      if (curr.k === null || curr.d === null) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      const { k, d } = curr;
      const justCrossedUp = k > d && prev1.k <= prev1.d;
      const justCrossedDn = k < d && prev1.k >= prev1.d;
      if (k < 20 && d < 20) return { signal: 'buy', confidence: Math.min(85, 60 + (20 - k) * 1.2 + (justCrossedUp ? 15 : 0)), reason: `Stochastic oversold — K:${k.toFixed(1)}, D:${d.toFixed(1)}${justCrossedUp ? ' — K crossed above D' : ''}` };
      if (k > 80 && d > 80) return { signal: 'sell', confidence: Math.min(85, 60 + (k - 80) * 1.2 + (justCrossedDn ? 15 : 0)), reason: `Stochastic overbought — K:${k.toFixed(1)}, D:${d.toFixed(1)}${justCrossedDn ? ' — K crossed below D' : ''}` };
      if (justCrossedUp) return { signal: 'buy', confidence: 60, reason: `Stochastic K crossed above D at K:${k.toFixed(1)}` };
      if (justCrossedDn) return { signal: 'sell', confidence: 60, reason: `Stochastic K crossed below D at K:${k.toFixed(1)}` };
      return { signal: 'neutral', confidence: 40, reason: `Stochastic neutral — K:${k.toFixed(1)}, D:${d.toFixed(1)}` };
    },
  },

  // ─── 7. Ichimoku Cloud (Weight: 9) ────────────────────────────────────────
  {
    id: 'ichimoku',
    name: 'Ichimoku Cloud',
    category: 'Trend',
    weight: 9,
    description: 'Full Ichimoku system — cloud position, TK cross, and Chikou span.',
    analyze(candles) {
      const ich = I.ichimoku(candles);
      const curr = last(ich);
      const price = last(candles).close;
      if (!curr.tenkanSen || !curr.kijunSen || !curr.senkouA || !curr.senkouB) return { signal: 'neutral', confidence: 40, reason: 'Insufficient Ichimoku data' };
      const { tenkanSen, kijunSen, senkouA, senkouB } = curr;
      const cloudTop = Math.max(senkouA, senkouB);
      const cloudBot = Math.min(senkouA, senkouB);
      const aboveCloud = price > cloudTop;
      const belowCloud = price < cloudBot;
      const inCloud = !aboveCloud && !belowCloud;
      const tkBull = tenkanSen > kijunSen;
      const bullCloud = senkouA > senkouB;
      let score = 0;
      if (aboveCloud) score += 40;
      if (belowCloud) score -= 40;
      if (tkBull) score += 25;
      if (!tkBull) score -= 25;
      if (bullCloud) score += 20;
      if (!bullCloud) score -= 20;
      if (inCloud) {
        return { signal: 'neutral', confidence: 45, reason: `Price inside Ichimoku cloud — indecision zone` };
      }
      if (score > 0) {
        return { signal: 'buy', confidence: Math.min(92, 50 + score), reason: `Price ${aboveCloud ? 'above' : 'near'} cloud, TK ${tkBull ? 'bullish cross' : 'mixed'}, cloud ${bullCloud ? 'bullish (green)' : 'bearish (red)'}` };
      }
      return { signal: 'sell', confidence: Math.min(92, 50 + Math.abs(score)), reason: `Price ${belowCloud ? 'below' : 'near'} cloud, TK ${!tkBull ? 'bearish' : 'mixed'}, cloud ${!bullCloud ? 'bearish (red)' : 'bullish'}` };
    },
  },

  // ─── 8. ADX Trend Strength (Weight: 8) ───────────────────────────────────
  {
    id: 'adx',
    name: 'ADX Trend Strength',
    category: 'Trend',
    weight: 8,
    description: 'ADX(14) with DI+/DI- direction — confirms trend validity.',
    analyze(candles) {
      const adxData = I.adx(candles, 14);
      const curr = last(adxData);
      if (!curr) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      const { adx, diPlus, diMinus } = curr;
      const trending = adx > 25;
      const strongTrend = adx > 40;
      if (!trending) return { signal: 'neutral', confidence: 50, reason: `ADX ${adx.toFixed(1)} < 25 — no trend, market ranging (range trade conditions)` };
      if (diPlus > diMinus) {
        return { signal: 'buy', confidence: Math.min(92, 55 + adx * 0.8), reason: `ADX ${adx.toFixed(1)} — ${strongTrend ? 'strong' : 'moderate'} uptrend. DI+:${diPlus.toFixed(1)} > DI-:${diMinus.toFixed(1)}` };
      }
      return { signal: 'sell', confidence: Math.min(92, 55 + adx * 0.8), reason: `ADX ${adx.toFixed(1)} — ${strongTrend ? 'strong' : 'moderate'} downtrend. DI-:${diMinus.toFixed(1)} > DI+:${diPlus.toFixed(1)}` };
    },
  },

  // ─── 9. ATR Volatility Filter (Weight: 5) ────────────────────────────────
  {
    id: 'atr_volatility',
    name: 'ATR Volatility',
    category: 'Volatility',
    weight: 5,
    description: 'ATR(14) as a volatility context filter — high ATR favors breakout, low ATR favors range.',
    analyze(candles) {
      const atr = I.atr(candles, 14);
      const currATR = last(atr);
      const closes = candles.map(c => c.close);
      const price = last(closes);
      const atrPct = currATR / price;
      const avgATR = atr.slice(-20).filter(Boolean).reduce((a, b) => a + b, 0) / 20;
      const expanding = currATR > avgATR * 1.2;
      const contracting = currATR < avgATR * 0.8;
      const lastClose = last(closes);
      const prevClose = prev(closes);
      const priceDir = lastClose > prevClose ? 'buy' : 'sell';
      if (expanding) return { signal: priceDir, confidence: 65, reason: `ATR expanding (${currATR?.toFixed(5)}) — volatility surge supports ${priceDir} breakout` };
      if (contracting) return { signal: 'neutral', confidence: 55, reason: `ATR contracting (${currATR?.toFixed(5)}) — low volatility, potential squeeze setup` };
      return { signal: priceDir, confidence: 52, reason: `ATR normal (${currATR?.toFixed(5)}) — ${(atrPct * 100).toFixed(3)}% of price` };
    },
  },

  // ─── 10. VWAP (Weight: 7) ─────────────────────────────────────────────────
  {
    id: 'vwap',
    name: 'VWAP Position',
    category: 'Volume',
    weight: 7,
    description: 'Price vs VWAP — institutional reference level, key intraday anchor.',
    analyze(candles) {
      const vwap = I.vwap(candles);
      const currVWAP = last(vwap);
      const price = last(candles).close;
      const diff = ((price - currVWAP) / currVWAP) * 100;
      if (price > currVWAP) {
        return { signal: 'buy', confidence: Math.min(88, 58 + Math.abs(diff) * 5), reason: `Price (${price.toFixed(4)}) above VWAP (${currVWAP.toFixed(4)}) by ${diff.toFixed(3)}% — bullish institutional bias` };
      }
      return { signal: 'sell', confidence: Math.min(88, 58 + Math.abs(diff) * 5), reason: `Price (${price.toFixed(4)}) below VWAP (${currVWAP.toFixed(4)}) by ${Math.abs(diff).toFixed(3)}% — bearish institutional bias` };
    },
  },

  // ─── 11. Support & Resistance (Weight: 8) ────────────────────────────────
  {
    id: 'support_resistance',
    name: 'Support & Resistance',
    category: 'Price Action',
    weight: 8,
    description: 'Dynamic S/R levels from recent swing highs/lows — key reaction zones.',
    analyze(candles) {
      const { support, resistance } = I.supportResistance(candles, 20);
      const price = last(candles).close;
      const distToRes = ((resistance - price) / price) * 100;
      const distToSup = ((price - support) / price) * 100;
      const atResistance = distToRes < 0.15;
      const atSupport = distToSup < 0.15;
      if (atSupport) return { signal: 'buy', confidence: 78, reason: `Price at support level (${support.toFixed(4)}) — bounce zone, ${distToSup.toFixed(3)}% from support` };
      if (atResistance) return { signal: 'sell', confidence: 75, reason: `Price at resistance level (${resistance.toFixed(4)}) — rejection zone, ${distToRes.toFixed(3)}% from resistance` };
      if (distToSup < distToRes * 0.5) return { signal: 'buy', confidence: 60, reason: `Price closer to support (${support.toFixed(4)}) than resistance (${resistance.toFixed(4)})` };
      if (distToRes < distToSup * 0.5) return { signal: 'sell', confidence: 60, reason: `Price closer to resistance (${resistance.toFixed(4)}) than support (${support.toFixed(4)})` };
      return { signal: 'neutral', confidence: 45, reason: `Price mid-range between S:${support.toFixed(4)} and R:${resistance.toFixed(4)}` };
    },
  },

  // ─── 12. Fibonacci Retracement (Weight: 7) ───────────────────────────────
  {
    id: 'fibonacci',
    name: 'Fibonacci Retracement',
    category: 'Price Action',
    weight: 7,
    description: 'Fib levels (23.6%, 38.2%, 50%, 61.8%, 78.6%) from recent swing.',
    analyze(candles) {
      const fib = I.fibonacci(candles, 50);
      const price = last(candles).close;
      const levels = [
        { level: '23.6%', value: fib.r236 },
        { level: '38.2%', value: fib.r382 },
        { level: '50.0%', value: fib.r500 },
        { level: '61.8%', value: fib.r618 },
        { level: '78.6%', value: fib.r786 },
      ];
      for (const { level, value } of levels) {
        const dist = Math.abs((price - value) / value) * 100;
        if (dist < 0.2) {
          const aboveMid = price > fib.r500;
          return {
            signal: aboveMid ? 'sell' : 'buy',
            confidence: 72,
            reason: `Price at Fib ${level} level (${value.toFixed(4)}) — key retracement zone${aboveMid ? ', potential reversal down' : ', potential reversal up'}`,
          };
        }
      }
      const trend = price > fib.r500 ? 'buy' : 'sell';
      return { signal: trend, confidence: 50, reason: `Price ${price > fib.r500 ? 'above' : 'below'} 50% Fib level (${fib.r500.toFixed(4)}) — ${trend === 'buy' ? 'upper' : 'lower'} range` };
    },
  },

  // ─── 13. Candlestick Patterns (Weight: 6) ────────────────────────────────
  {
    id: 'candlestick',
    name: 'Candlestick Patterns',
    category: 'Price Action',
    weight: 6,
    description: 'Identifies key reversal and continuation candle patterns.',
    analyze(candles) {
      const patterns = I.candlestickPatterns(candles);
      const buySignals = patterns.filter(p => p.signal === 'buy');
      const sellSignals = patterns.filter(p => p.signal === 'sell');
      if (buySignals.length > sellSignals.length) {
        return { signal: 'buy', confidence: Math.min(82, 58 + buySignals.length * 15), reason: `${buySignals.map(p => p.name).join(', ')} — bullish reversal pattern(s)` };
      }
      if (sellSignals.length > buySignals.length) {
        return { signal: 'sell', confidence: Math.min(82, 58 + sellSignals.length * 15), reason: `${sellSignals.map(p => p.name).join(', ')} — bearish reversal pattern(s)` };
      }
      return { signal: 'neutral', confidence: 40, reason: `${patterns[0]?.name || 'No clear pattern'} — no directional bias` };
    },
  },

  // ─── 14. Parabolic SAR (Weight: 7) ───────────────────────────────────────
  {
    id: 'parabolic_sar',
    name: 'Parabolic SAR',
    category: 'Trend',
    weight: 7,
    description: 'Parabolic SAR — stop and reverse trailing stop trend indicator.',
    analyze(candles) {
      const sar = I.parabolicSAR(candles);
      const curr = last(sar);
      const sarPrev = prev(sar);
      const price = last(candles).close;
      const justFlipped = curr.bull !== sarPrev.bull;
      if (curr.bull) {
        return { signal: 'buy', confidence: Math.min(88, 62 + (justFlipped ? 18 : 0)), reason: `SAR below price (${curr.sar.toFixed(4)}) — bullish trend${justFlipped ? ' — just flipped bullish' : ''}` };
      }
      return { signal: 'sell', confidence: Math.min(88, 62 + (justFlipped ? 18 : 0)), reason: `SAR above price (${curr.sar.toFixed(4)}) — bearish trend${justFlipped ? ' — just flipped bearish' : ''}` };
    },
  },

  // ─── 15. CCI Commodity Channel Index (Weight: 6) ─────────────────────────
  {
    id: 'cci',
    name: 'CCI Signal',
    category: 'Momentum',
    weight: 6,
    description: 'CCI(20) — identifies overbought (>100) and oversold (<-100) extremes.',
    analyze(candles) {
      const cci = I.cci(candles, 20);
      const c = last(cci), cp = prev(cci);
      if (c === null) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      const justCrossedUp = c > 100 && cp <= 100;
      const justCrossedDn = c < -100 && cp >= -100;
      if (c < -100) return { signal: 'buy', confidence: Math.min(85, 60 + Math.abs(c + 100) * 0.3 + (justCrossedDn ? 15 : 0)), reason: `CCI oversold at ${c.toFixed(1)}${justCrossedDn ? ' — just entered oversold' : ''}` };
      if (c > 100) return { signal: 'sell', confidence: Math.min(85, 60 + (c - 100) * 0.3 + (justCrossedUp ? 15 : 0)), reason: `CCI overbought at ${c.toFixed(1)}${justCrossedUp ? ' — just entered overbought' : ''}` };
      const bias = c > 0 ? 'buy' : 'sell';
      return { signal: bias, confidence: 47, reason: `CCI neutral at ${c.toFixed(1)} — mild ${bias} bias` };
    },
  },

  // ─── 16. Williams %R (Weight: 5) ─────────────────────────────────────────
  {
    id: 'williams_r',
    name: 'Williams %R',
    category: 'Momentum',
    weight: 5,
    description: 'Williams %R(14) — measures overbought/oversold relative to high-low range.',
    analyze(candles) {
      const wr = I.williamsR(candles, 14);
      const r = last(wr), rp = prev(wr);
      if (r === null) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      if (r < -80) return { signal: 'buy', confidence: Math.min(83, 62 + Math.abs(r + 80) * 0.8), reason: `Williams %R oversold at ${r.toFixed(1)}` };
      if (r > -20) return { signal: 'sell', confidence: Math.min(83, 62 + (r + 20) * 0.8), reason: `Williams %R overbought at ${r.toFixed(1)}` };
      const bias = r > -50 ? 'sell' : 'buy';
      return { signal: bias, confidence: 45, reason: `Williams %R neutral at ${r.toFixed(1)}` };
    },
  },

  // ─── 17. Momentum Breakout (Weight: 7) ───────────────────────────────────
  {
    id: 'momentum_breakout',
    name: 'Momentum Breakout',
    category: 'Momentum',
    weight: 7,
    description: 'Price momentum with volume confirmation — captures early breakout moves.',
    analyze(candles) {
      const closes = candles.map(c => c.close);
      const mom = I.momentum(closes, 10);
      const vol = candles.map(c => c.volume || 1);
      const volOsc = I.volumeOscillator(vol, 5, 10);
      const m = last(mom), v = last(volOsc);
      const avgMom = mom.filter(Boolean).slice(-20).reduce((a, b) => a + Math.abs(b), 0) / 20;
      const strongMom = m !== null && Math.abs(m) > avgMom * 1.5;
      const volConf = v !== null && v > 0;
      if (m === null) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      if (m > 0) {
        return { signal: 'buy', confidence: Math.min(87, 53 + (strongMom ? 20 : 0) + (volConf ? 15 : 0)), reason: `Positive momentum (${m.toFixed(4)})${strongMom ? ' — strong surge' : ''}${volConf ? ' with volume confirmation' : ''}` };
      }
      return { signal: 'sell', confidence: Math.min(87, 53 + (strongMom ? 20 : 0) + (volConf ? 15 : 0)), reason: `Negative momentum (${m.toFixed(4)})${strongMom ? ' — strong decline' : ''}${volConf ? ' with volume confirmation' : ''}` };
    },
  },

  // ─── 18. Trendline Breakout (Weight: 7) ──────────────────────────────────
  {
    id: 'trendline_breakout',
    name: 'Trendline Breakout',
    category: 'Price Action',
    weight: 7,
    description: 'Dynamic trendline detection — breakout above resistance or below support.',
    analyze(candles) {
      const result = I.trendlineBreakout(candles, 20);
      const price = last(candles).close;
      if (result === 'breakout_up') return { signal: 'buy', confidence: 80, reason: `Price broke above dynamic resistance trendline — bullish breakout confirmed` };
      if (result === 'breakout_down') return { signal: 'sell', confidence: 80, reason: `Price broke below dynamic support trendline — bearish breakdown confirmed` };
      const ema20 = last(I.ema(candles.map(c => c.close), 20));
      const trend = price > ema20 ? 'buy' : 'sell';
      return { signal: trend, confidence: 50, reason: `No breakout — price in established ${trend === 'buy' ? 'uptrend' : 'downtrend'} channel` };
    },
  },

  // ─── 19. Multi-Timeframe Trend Confirmation (Weight: 9) ──────────────────
  {
    id: 'multi_timeframe',
    name: 'Multi-Timeframe Alignment',
    category: 'Trend',
    weight: 9,
    description: 'EMA trend alignment across M1→M5→M15→H1 aggregations — highest weight signal.',
    analyze(candles) {
      const factors = [1, 5, 15, 60];
      const names = ['M1', 'M5', 'M15', 'H1'];
      let buyCount = 0, sellCount = 0;
      const details = [];
      for (let fi = 0; fi < factors.length; fi++) {
        const agg = factors[fi] === 1 ? candles : I.aggregateToHigherTF(candles, factors[fi]);
        if (agg.length < 21) { details.push(`${names[fi]}: N/A`); continue; }
        const closes = agg.map(c => c.close);
        const ema9 = last(I.ema(closes, 9));
        const ema21 = last(I.ema(closes, 21));
        if (ema9 === null || ema21 === null) { details.push(`${names[fi]}: N/A`); continue; }
        if (ema9 > ema21) { buyCount++; details.push(`${names[fi]}: ▲`); }
        else { sellCount++; details.push(`${names[fi]}: ▼`); }
      }
      const total = buyCount + sellCount;
      if (total === 0) return { signal: 'neutral', confidence: 40, reason: 'Insufficient data across timeframes' };
      const ratio = buyCount / total;
      if (ratio >= 0.75) return { signal: 'buy', confidence: Math.min(95, 60 + ratio * 35), reason: `${buyCount}/${total} timeframes bullish: ${details.join(', ')}` };
      if (ratio <= 0.25) return { signal: 'sell', confidence: Math.min(95, 60 + (1 - ratio) * 35), reason: `${sellCount}/${total} timeframes bearish: ${details.join(', ')}` };
      return { signal: 'neutral', confidence: 45, reason: `Mixed TF signals: ${details.join(', ')}` };
    },
  },

  // ─── 20. Pivot Point Mean Reversion (Weight: 6) ──────────────────────────
  {
    id: 'pivot_points',
    name: 'Pivot Point Levels',
    category: 'Price Action',
    weight: 6,
    description: 'Classic pivot points (R1, R2, S1, S2) — key institutional S/R zones.',
    analyze(candles) {
      const pivots = I.pivotPoints(candles);
      const price = last(candles).close;
      const { pivot, r1, r2, s1, s2 } = pivots;
      const distP = Math.abs(price - pivot) / price;
      const distR1 = Math.abs(price - r1) / price;
      const distS1 = Math.abs(price - s1) / price;
      const near = 0.002;
      if (distR1 < near || (price <= r1 && price > pivot)) return { signal: 'sell', confidence: 70, reason: `Price near R1 pivot (${r1.toFixed(4)}) — classic resistance zone` };
      if (distS1 < near || (price >= s1 && price < pivot)) return { signal: 'buy', confidence: 70, reason: `Price near S1 pivot (${s1.toFixed(4)}) — classic support zone` };
      if (price > r1) return { signal: 'buy', confidence: 65, reason: `Price above R1 (${r1.toFixed(4)}) — bullish breakout of pivot structure` };
      if (price < s1) return { signal: 'sell', confidence: 65, reason: `Price below S1 (${s1.toFixed(4)}) — bearish breakdown of pivot structure` };
      if (price > pivot) return { signal: 'buy', confidence: 55, reason: `Price above daily pivot (${pivot.toFixed(4)}) — bullish bias` };
      return { signal: 'sell', confidence: 55, reason: `Price below daily pivot (${pivot.toFixed(4)}) — bearish bias` };
    },
  },

  // ─── 21. Smart Money / Whale Tracker (Weight: 10) ────────────────────────
  {
    id: 'whale_tracker',
    name: 'Institutional Whale Tracker',
    category: 'Volume',
    weight: 10,
    description: 'Mimics Unusual Whales logic by tracking extreme volume anomalies, liquidity sweeps, and Smart Money accumulation/distribution footprints.',
    analyze(candles) {
      if (candles.length < 30) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      
      const closes = candles.map(c => c.close);
      const volumes = candles.map(c => c.volume || 1);
      
      const lastC = candles[candles.length - 1];
      
      // Calculate average volume over last 20 periods
      const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
      const volAnomaly = lastC.volume > avgVol * 2.5; // 2.5x normal volume
      
      // VSA (Volume Spread Analysis) - Massive volume, small body = Accumulation/Distribution
      const bodySize = Math.abs(lastC.close - lastC.open);
      const totalRange = lastC.high - lastC.low;
      const avgRange = candles.slice(-21, -1).reduce((a, b) => a + (b.high - b.low), 0) / 20;
      
      const smallBody = bodySize < (totalRange * 0.35);
      const liquidityWickUp = (lastC.high - Math.max(lastC.open, lastC.close)) > (totalRange * 0.45);
      const liquidityWickDown = (Math.min(lastC.open, lastC.close) - lastC.low) > (totalRange * 0.45);

      // Expansion / Order Block
      const massiveBody = bodySize > avgRange * 1.5;
      const bullishExpansion = massiveBody && lastC.close > lastC.open && volAnomaly;
      const bearishExpansion = massiveBody && lastC.close < lastC.open && volAnomaly;

      if (volAnomaly) {
        if (liquidityWickDown && smallBody) {
          // Smart money absorbed selling (Accumulation / Liquidity Grab)
          return { signal: 'buy', confidence: 95, reason: `WHALE DETECTED: Massive volume accumulation (x${(lastC.volume/avgVol).toFixed(1)}). Smart Money swept liquidity at lows and absorbed retail selling.` };
        }
        if (liquidityWickUp && smallBody) {
          // Smart money absorbed buying (Distribution / Liquidity Grab)
          return { signal: 'sell', confidence: 95, reason: `WHALE DETECTED: Massive volume distribution (x${(lastC.volume/avgVol).toFixed(1)}). Smart Money swept liquidity at highs and absorbed retail buying.` };
        }
        if (bullishExpansion) {
          return { signal: 'buy', confidence: 92, reason: `WHALE DETECTED: Institutional buying frenzy. Heavy volume expansion breaking upward.` };
        }
        if (bearishExpansion) {
           return { signal: 'sell', confidence: 92, reason: `WHALE DETECTED: Institutional selling frenzy. Heavy volume expansion breaking downward.` };
        }
      }
      
      // If we see declining volume on an uptrend/downtrend (weak retail)
      const uptrend = closes[closes.length-1] > closes[closes.length-5];
      const downtrend = closes[closes.length-1] < closes[closes.length-5];
      const fadingVol = volumes[volumes.length-1] < avgVol * 0.4 && volumes[volumes.length-2] < avgVol * 0.4;
      
      if (uptrend && fadingVol) {
         return { signal: 'sell', confidence: 70, reason: `Retail Trap — uptrend stalling on vanishing volume. No institutional backing.` };
      }
      if (downtrend && fadingVol) {
         return { signal: 'buy', confidence: 70, reason: `Retail Trap — downtrend stalling on vanishing volume. No institutional backing.` };
      }
      
      return { signal: 'neutral', confidence: 50, reason: `No Whale activity detected. Normal volume profile.` };
    },
  },

  // ─── 22. Money Flow Index (Liquidity Tracker) (Weight: 8) ────────────────
  {
    id: 'mfi_liquidity',
    name: 'Money Flow Liquidity',
    category: 'Volume',
    weight: 8,
    description: 'Tracks actual capital flowing into or out of the asset using volume-weighted price (MFI).',
    analyze(candles) {
      const mfiOut = I.mfi(candles, 14);
      const current = last(mfiOut);
      const prev1 = prev(mfiOut);
      
      if (current === null) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      
      if (current > 80) {
        return { signal: 'sell', confidence: Math.min(90, 60 + (current - 80) * 1.5), reason: `Extreme liquidity influx — overbought at MFI ${current.toFixed(1)}. Smart money distribution likely.` };
      }
      if (current < 20) {
        return { signal: 'buy', confidence: Math.min(90, 60 + (20 - current) * 1.5), reason: `Liquidity drain — oversold at MFI ${current.toFixed(1)}. Accumulation zone for smart money.` };
      }
      
      // Trend in liquidity
      if (current > 50 && prev1 <= 50) {
        return { signal: 'buy', confidence: 65, reason: `Liquidity tide turning positive (MFI crossed 50). Capital entering market.` };
      }
      if (current < 50 && prev1 >= 50) {
        return { signal: 'sell', confidence: 65, reason: `Liquidity tide turning negative (MFI crossed 50). Capital exiting market.` };
      }
      
      return { signal: current > 50 ? 'buy' : 'sell', confidence: 45, reason: `Normal liquidity levels (MFI ${current.toFixed(1)}).` };
    }
  },

  // ─── 23. Cross-Asset Correlation (Weight: 7) ───────────────────────────────
  {
    id: 'cross_asset_correlation',
    name: 'Intermarket Correlation',
    category: 'Sentiment',
    weight: 7,
    description: 'Analyzes relationship between indices (e.g. S&P500 falling -> Gold rising) and base currencies (e.g. DXY rising -> assets falling).',
    analyze(candles) {
      const { correlatedAssets } = strategyContext;
      if (!correlatedAssets || Object.keys(correlatedAssets).length === 0) {
        return { signal: 'neutral', confidence: 40, reason: 'No cross-asset correlation data provided.' };
      }
      
      let score = 0;
      let reasons = [];
      
      // Inverse correlation with DXY (Dollar Index)
      if (correlatedAssets['DXY']) {
        if (correlatedAssets['DXY'].trend === 'up') {
          score -= 10;
          reasons.push('Strong DXY dragging non-USD assets down.');
        } else if (correlatedAssets['DXY'].trend === 'down') {
          score += 10;
          reasons.push('Weak DXY pushing non-USD assets up.');
        }
      }
      
      // Example: S&P500 / VIX relationship for Risk-on vs Risk-off
      if (correlatedAssets['SPX']) {
        if (correlatedAssets['SPX'].trend === 'down') {
          score += 10; // Assuming Gold/Safe Haven
          reasons.push('Indices falling; Safe haven capital rotation expected.');
        } else if (correlatedAssets['SPX'].trend === 'up') {
          score -= 5;
          reasons.push('Indices rising; Risk-on environment drawing capital away from safe havens.');
        }
      }
      
      if (score > 0) {
        return { signal: 'buy', confidence: Math.min(85, 60 + score * 2), reason: `Positive correlation tailwinds: ${reasons.join(' ')}` };
      } else if (score < 0) {
        return { signal: 'sell', confidence: Math.min(85, 60 + Math.abs(score) * 2), reason: `Negative correlation headwinds: ${reasons.join(' ')}` };
      }
      
      return { signal: 'neutral', confidence: 50, reason: 'Cross-market correlations are currently mixed or flat.' };
    }
  },

  // ─── 24. AI Macro & News Sentiment (Weight: 9) ─────────────────────────
  {
    id: 'news_sentiment',
    name: 'Macro News & Sentiment AI',
    category: 'Sentiment',
    weight: 9,
    description: 'Scans live headlines for Fed remarks, Geopolitics (Iran/Middle East tension, War), and explicitly tracks Trump verbal interventions & manipulation (Jawboning, Tariffs) to predict panic or euphoria.',
    analyze(candles) {
      const headlines = strategyContext.headlines || [];
      if (!headlines.length) return { signal: 'neutral', confidence: 0, reason: 'Awaiting live news feed data...' };

      let bullScore = 0;
      let bearScore = 0;
      let matchedKeywords = [];
      let trumpManipulation = false;

      // The Master Market Catalyst Dictionary - Covers every systemic market trigger
      const keywords = {
        bullish: [
          // Geopolitical / Conflict (Bullish for Safe Havens like Gold, Bullish for Oil)
          { word: 'war', weight: 5 }, { word: 'escalat', weight: 4 }, { word: 'tension', weight: 4 },
          { word: 'iran', weight: 5 }, { word: 'israel', weight: 4 }, { word: 'middle east', weight: 4 },
          { word: 'sanction', weight: 3 }, { word: 'missile', weight: 5 }, { word: 'strike', weight: 4 },
          { word: 'invasion', weight: 5 }, { word: 'military', weight: 3 }, { word: 'blockade', weight: 5 },
          { word: 'hormuz', weight: 5 }, { word: 'strait', weight: 4 }, { word: 'choke point', weight: 5 }, // Global Oil supply shock triggers
          // Financial Panic / Black Swans
          { word: 'crash', weight: 5 }, { word: 'plunge', weight: 3 }, { word: 'panic', weight: 5 },
          { word: 'crisis', weight: 4 }, { word: 'emergency', weight: 5 }, { word: 'black swan', weight: 5 },
          { word: 'bank run', weight: 5 }, { word: 'contagion', weight: 5 }, { word: 'collapse', weight: 5 },
          { word: 'default', weight: 5 }, { word: 'bankruptcy', weight: 4 }, { word: 'debt ceiling', weight: 4 },
          // Liquidity / Central Banking (Dovish)
          { word: 'cut rate', weight: 4 }, { word: 'dovish', weight: 3 }, { word: 'stimulus', weight: 4 },
          { word: 'liquidity injection', weight: 4 }, { word: 'quantitative easing', weight: 5 }, { word: 'qe', weight: 4 },
          { word: 'bailout', weight: 5 }, { word: 'pivot', weight: 4 }, { word: 'printing money', weight: 4 }
        ],
        bearish: [
          // Resolution / Geopolitics
          { word: 'peace', weight: 5 }, { word: 'truce', weight: 4 }, { word: 'ceasefire', weight: 5 },
          { word: 'de-escalat', weight: 5 }, { word: 'agreement', weight: 4 }, { word: 'reopen', weight: 4 }, // Reopening of blocked straits/trade routes
          // Central Banking (Hawkish / Tightening)
          { word: 'hike rate', weight: 4 }, { word: 'hawkish', weight: 3 }, { word: 'quantitative tightening', weight: 5 },
          { word: 'qt', weight: 4 }, { word: 'strong dollar', weight: 5 },
          // Economic Resilience
          { word: 'recovery', weight: 3 }, { word: 'soft landing', weight: 4 }, { word: 'resilient', weight: 3 },
          { word: 'beat expectations', weight: 3 }
        ],
        figures: [
          'trump', 'putin', 'biden', 'xi jinping', // Politics
          'powell', 'yellen', 'lagarde', 'kuroda', 'ueda', // Central Banks (Fed, Treasury, ECB, BOJ)
          'musk', 'elon', // Tech Manipulation
          'opec', 'fed', 'fomc', 'federal reserve', 'ecb', 'boj' // Organizations
        ],
        systemicEvents: [
          'election', 'poll', 'landslide', 'swing state', // Elections
          'nfp', 'cpi', 'ppi', 'gdp', 'inflation', 'jobs report', 'unemployment rate', 'payrolls' // Data Shocks (Market Movers)
        ]
      };

      const trumpManipulativeRhetoric = ['tariff', 'trade deal', 'great deal', 'fake news', 'tax', 'pump', 'jawbone', 'threaten'];
      const elonManipulativeRhetoric = ['doge', 'crypto', 'bitcoin', 'ai', 'xai', 'grok', 'to the moon', 'sec', 'funding secured'];

      const text = headlines.join(' ').toLowerCase();

      // Check for Trump Manipulation
      if (text.includes('trump') || text.includes('realdonaldtrump')) {
        trumpManipulativeRhetoric.forEach(word => {
          if (text.includes(word)) {
            trumpManipulation = true;
            matchedKeywords.push(`Trump Intervention: ${word}`);
          }
        });
      }

      // Check for Elon Musk Manipulation
      if (text.includes('elon') || text.includes('musk') || text.includes('elonmusk')) {
        elonManipulativeRhetoric.forEach(word => {
          if (text.includes(word)) {
            trumpManipulation = true; // reusing variable to trigger the confidence spike
            matchedKeywords.push(`Elon Intervention: ${word}`);
          }
        });
      }

      // Scan all latest headlines
      for (const k of keywords.bullish) {
        if (text.includes(k.word)) { bullScore += k.weight; matchedKeywords.push(k.word); }
      }
      for (const k of keywords.bearish) {
        if (text.includes(k.word)) { bearScore += k.weight; matchedKeywords.push(k.word); }
      }
      for (const f of keywords.figures) {
        if (text.includes(f)) {
          // If a key figure is mentioned alongside existing momentum, they amplify it
          bullScore = bullScore > 0 ? bullScore + 2 : bullScore;
          bearScore = bearScore > 0 ? bearScore + 2 : bearScore;
          if (!matchedKeywords.includes(f)) matchedKeywords.push(f);
        }
      }

      const total = bullScore + bearScore;
      if (total < 3 && !trumpManipulation) return { signal: 'neutral', confidence: 50, reason: `No extreme macro/sentiment catalysts detected. Minor keywords: [${matchedKeywords.join(', ')}].` };

      // Guaranteed stricter reads
      const isBull = bullScore > bearScore;
      let rawConfidence = 65 + Math.abs(bullScore - bearScore) * 8;
      
      // If Trump is trying to verbally manipulate, it creates extreme short-term volatility.
      // We push confidence heavily if he aligns with a direction, as retail traders will blind-follow.
      if (trumpManipulation) rawConfidence += 15;

      const confidence = Math.min(99, rawConfidence);
      const direction = isBull ? 'buy' : 'sell';
      
      return {
        signal: direction,
        confidence: Math.round(confidence),
        reason: `FULL MARKET READ: ${direction === 'buy' ? 'Heavy Risk-Off (Geopolitics/Fear)' : 'Heavy Risk-On (Peace/Hawkish)'} detected.${trumpManipulation ? ' TRUMP VERBAL INTERVENTION DETECTED.' : ''} Triggers: [${matchedKeywords.join(', ')}].`
      };
    }
  },

  // ─── 24. Unusual Whales Dark Pool (CSV Engine) ────────────────────────
  {
    id: 'unusual_whales_csv',
    name: 'Unusual Whales Dark Pool CSV',
    category: 'Volume',
    weight: 20, // Extreme weight!
    description: 'Reads exact options flow / dark pool levels from your dropped CSV and heavily magnets price action to those whale strike zones.',
    analyze(candles) {
      if (!whaleLevels || !whaleLevels.active) {
        return { signal: 'neutral', confidence: 0, reason: 'No Whale CSV Dropped.' };
      }

      const currentPrice = candles[candles.length - 1].close;
      let whaleScore = 0;
      let whaleReason = `Whale data mapped. No major Dark Pool strikes in immediate proximity of ${currentPrice}.`;
      let whaleSignal = "neutral";
      
      // Check Call Resistance (Whales selling calls, or dealers shorting)
      for (const res of whaleLevels.resistance) {
        if (currentPrice < res && (res - currentPrice) / currentPrice < 0.005) { // 0.5% zone
          whaleSignal = "sell";
          whaleScore = Math.max(whaleScore, 92);
          whaleReason = `Price hitting Heavy Call Resistance (${res}) based on ${whaleLevels.lastUpdated} CSV Flow. Expect rejection.`;
        }
      }
      
      // Check Put Support
      for (const sup of whaleLevels.support) {
        if (currentPrice > sup && (currentPrice - sup) / currentPrice < 0.005) { // 0.5% zone
          // If within put support
          if (whaleSignal !== 'sell' || (currentPrice - sup) < (whaleLevels.resistance[0] - currentPrice)) {
            whaleSignal = "buy";
            whaleScore = Math.max(whaleScore, 92);
            whaleReason = `Price hitting Massive Put Support (${sup}) based on ${whaleLevels.lastUpdated} CSV Flow. Expect aggressive bounce.`;
          }
        }
      }
      
      return {
        signal: whaleSignal,
        confidence: whaleScore || 50,
        reason: whaleReason
      };
    }
  },

  // ─── 25. Independent Smart Money Concepts (FVG / OB) ─────────────────────
  {
    id: 'smc_order_blocks',
    name: 'SMC: Fair Value Gaps & Order Blocks',
    category: 'Volume',
    weight: 18, // Very heavy, practically matches Whales
    description: 'Mathematically calculates independent Institutional Liquidity Voids (FVGs) and Order Blocks (OBs) using raw price-action anomalies.',
    analyze(candles) {
      if (candles.length < 30) return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
      
      const { fvgs, orderBlocks } = I.smartMoneyConcepts(candles, 30);
      const currentPrice = candles[candles.length - 1].close;

      let score = 0;
      let reasons = [];
      let finalSignal = 'neutral';

      // Find the closest active Unmitigated Order Blocks
      const bullishOBs = orderBlocks.filter(ob => ob.type === 'bullish' && currentPrice >= ob.bottom);
      const bearishOBs = orderBlocks.filter(ob => ob.type === 'bearish' && currentPrice <= ob.top);

      if (bullishOBs.length) {
        const closest = bullishOBs.sort((a,b) => (currentPrice - a.top) - (currentPrice - b.top))[0];
        // If price is digging into the bullish order block
        if (currentPrice <= closest.top && currentPrice >= closest.bottom) {
          finalSignal = 'buy';
          score = 92;
          reasons.push(`Price mitigating Bullish Order Block at ${closest.top.toFixed(3)}. Institutional synthetic accumulation detected.`);
        }
      }

      if (bearishOBs.length && finalSignal !== 'buy') {
        const closest = bearishOBs.sort((a,b) => (a.bottom - currentPrice) - (b.bottom - currentPrice))[0];
        if (currentPrice >= closest.bottom && currentPrice <= closest.top) {
          finalSignal = 'sell';
          score = 92;
          reasons.push(`Price hitting Bearish Order Block at ${closest.bottom.toFixed(3)}. Institutional synthetic distribution detected.`);
        }
      }

      // If no OBs active, check FVGs serving as magnets
      if (finalSignal === 'neutral') {
        const bullishFVGs = fvgs.filter(f => f.type === 'bullish');
        if (bullishFVGs.length) {
          const closest = bullishFVGs.sort((a,b) => b.top - a.top)[0];
          if (currentPrice > closest.top && (currentPrice - closest.top)/currentPrice < 0.003) {
            finalSignal = 'buy';
            score = 80;
            reasons.push(`Price approaching synthetic Bullish FVG gap at ${closest.top.toFixed(3)} acting as liquidity support.`);
          }
        }

        const bearishFVGs = fvgs.filter(f => f.type === 'bearish');
        if (bearishFVGs.length && finalSignal === 'neutral') {
          const closest = bearishFVGs.sort((a,b) => a.bottom - b.bottom)[0];
          if (currentPrice < closest.bottom && (closest.bottom - currentPrice)/currentPrice < 0.003) {
            finalSignal = 'sell';
            score = 80;
            reasons.push(`Price approaching synthetic Bearish FVG gap at ${closest.bottom.toFixed(3)} acting as liquidity resistance.`);
          }
        }
      }

      if (reasons.length > 0) {
        return { signal: finalSignal, confidence: score, reason: reasons.join(' ') };
      }

      return { signal: 'neutral', confidence: 50, reason: 'No active synthetic Order Blocks or FVGs detected in immediate range.' };
    }
  }

];

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation Engine
// ─────────────────────────────────────────────────────────────────────────────

export function runAllStrategies(candles) {
  return STRATEGIES.map(strategy => {
    try {
      const result = strategy.analyze(candles);
      return {
        id: strategy.id,
        name: strategy.name,
        category: strategy.category,
        weight: strategy.weight,
        description: strategy.description,
        signal: result.signal,
        confidence: Math.round(result.confidence),
        reason: result.reason,
      };
    } catch (e) {
      return {
        id: strategy.id,
        name: strategy.name,
        category: strategy.category,
        weight: strategy.weight,
        description: strategy.description,
        signal: 'neutral',
        confidence: 0,
        reason: `Error: ${e.message}`,
      };
    }
  });
}

export function aggregateSignals(results, lastSignal = null) {
  const totalWeight = results.reduce((s, r) => s + r.weight, 0);
  let buyScore = 0, sellScore = 0, neutralScore = 0;

  for (const r of results) {
    const wconf = (r.weight / totalWeight) * (r.confidence / 100);
    if (r.signal === 'buy') buyScore += wconf;
    else if (r.signal === 'sell') sellScore += wconf;
    else neutralScore += wconf;
  }

  const buyCount = results.filter(r => r.signal === 'buy').length;
  const sellCount = results.filter(r => r.signal === 'sell').length;
  const neutralCount = results.filter(r => r.signal === 'neutral').length;
  const totalSignals = results.length;

  // Confidence = weighted directional agreement
  const topSignal = buyScore > sellScore ? 'buy' : 'sell';
  const topScore = Math.max(buyScore, sellScore);
  const totalDirectional = buyScore + sellScore;
  const rawConfidence = totalDirectional > 0 ? (topScore / totalDirectional) * 100 : 50;

  // Scale to 0-100 weighted by how many strategies agree
  const dirCount = topSignal === 'buy' ? buyCount : sellCount;
  const countRatio = dirCount / totalSignals;
  let finalConfidence = Math.round((rawConfidence * 0.7 + countRatio * 100 * 0.3));

  // 🐳 WHALE SUPERCHARGE: If the Live Unusual Whales API specifically dictates a massive order block, we let it dominate!
  const uwWhale = results.find(r => r.id === 'unusual_whales_csv');
  if (uwWhale && uwWhale.signal !== 'neutral') {
    if (uwWhale.signal === topSignal) {
      // The Whale entirely agrees with the momentum! Supercharge the signal to guarantee an instant alert dispatch.
      finalConfidence = Math.max(finalConfidence, 95); 
    }
    // If it disagrees, the Veto block below will catch it and kill the trade.
  }

  // HYSTERESIS: Strict 80% to open, but allows buffering down to 75% to prevent signal drops from micro-noise
  let THRESHOLD = 80; 
  if (lastSignal === topSignal.toUpperCase()) {
    THRESHOLD = 75; // Latch mechanism
  }

  let finalSignal = 'NO TRADE';
  let riskLevel = 'None';
  let vetoReason = '';

  // ─── MASTER VETO SYSTEM (Capital Protection) ─────────────────────────────────
  const mtf = results.find(r => r.id === 'multi_timeframe');
  const whale = results.find(r => r.id === 'whale_tracker');
  const smc = results.find(r => r.id === 'smc_order_blocks');
  const adx = results.find(r => r.id === 'adx');

  if (topSignal !== 'neutral') {
    if (mtf && mtf.signal !== 'neutral' && mtf.signal !== topSignal) {
      vetoReason = `VETO: Signal (${topSignal}) contradicts macroscopic Higher Timeframe trend (${mtf.signal}). Trade blocked to prevent chop loss.`;
    } 
    else if (uwWhale && uwWhale.confidence >= 90 && uwWhale.signal !== 'neutral' && uwWhale.signal !== topSignal) {
      vetoReason = `VETO BY UW API: You are trading against an extreme Options Flow wall at ${uwWhale.signal === 'buy' ? 'Support' : 'Resistance'}. Do not trade into a Whale Trap!`;
    }
    else if (smc && smc.confidence >= 90 && smc.signal !== 'neutral' && smc.signal !== topSignal) {
      vetoReason = `VETO BY SMC ENGINE: You are trading blindly into an Institutional Order Block (${smc.signal}). The synthetic engine blocked this trade to prevent instant reversal.`;
    }
    else if (whale && whale.confidence >= 80 && whale.signal !== 'neutral' && whale.signal !== topSignal) {
      vetoReason = `VETO: Signal (${topSignal}) contradicts Institutional Smart Money (${whale.signal}). Do not trade against whales.`;
    }
    else if (adx && adx.signal === 'neutral' && finalConfidence < 80) {
      vetoReason = `VETO: ADX indicates sideways/chop market. Trade blocked unless confidence reaches threshold (80+).`;
    }
  }

  if (finalConfidence >= THRESHOLD && !vetoReason) {
    finalSignal = topSignal.toUpperCase();
    if (finalConfidence >= 92) riskLevel = 'No Risk';
    else if (finalConfidence >= 89) riskLevel = 'Controllable Risk';
    else riskLevel = 'Medium Risk';
  } else if (finalConfidence >= THRESHOLD && vetoReason) {
    finalSignal = 'NO TRADE';
  }

  // Market status
  const marketStatus = neutralCount > totalSignals * 0.5
    ? 'sideways'
    : buyScore > sellScore * 1.1
    ? 'bullish'
    : sellScore > buyScore * 1.1
    ? 'bearish'
    : 'sideways';

  return {
    finalSignal,
    finalConfidence,
    buyCount,
    sellCount,
    neutralCount,
    buyScore: Math.round(buyScore * 100),
    sellScore: Math.round(sellScore * 100),
    marketStatus,
    threshold: THRESHOLD,
    thresholdMet: finalConfidence >= THRESHOLD && !vetoReason,
    riskLevel,
    vetoReason,
    breakdown: `${buyCount} buy / ${sellCount} sell / ${neutralCount} neutral out of ${totalSignals} strategies`,
  };
}


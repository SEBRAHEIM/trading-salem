/**
 * Core Technical Indicators Library
 * All calculations are pure functions operating on OHLCV candle arrays.
 * Each candle: { time, open, high, low, close, volume }
 */

export const Indicators = {

  // ─── Moving Averages ────────────────────────────────────────────────────────

  sma(closes, period) {
    const result = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < period - 1) { result.push(null); continue; }
      const slice = closes.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
    return result;
  },

  ema(closes, period) {
    const result = [];
    const k = 2 / (period + 1);
    let ema = null;
    for (let i = 0; i < closes.length; i++) {
      if (i < period - 1) { result.push(null); continue; }
      if (ema === null) {
        ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
      } else {
        ema = closes[i] * k + ema * (1 - k);
      }
      result.push(ema);
    }
    return result;
  },

  // ─── RSI ────────────────────────────────────────────────────────────────────

  rsi(closes, period = 14) {
    const result = [];
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      if (i <= period) {
        avgGain += gain / period;
        avgLoss += loss / period;
        if (i < period) { result.push(null); continue; }
        result.push(100 - 100 / (1 + avgGain / (avgLoss || 0.0001)));
      } else {
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        result.push(100 - 100 / (1 + avgGain / (avgLoss || 0.0001)));
      }
    }
    return result;
  },

  // ─── MACD ───────────────────────────────────────────────────────────────────

  macd(closes, fast = 12, slow = 26, signal = 9) {
    const emaFast = this.ema(closes, fast);
    const emaSlow = this.ema(closes, slow);
    const macdLine = closes.map((_, i) =>
      emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null
    );
    const validMacd = macdLine.filter(v => v !== null);
    const signalRaw = this.ema(validMacd, signal);
    // Re-align signal to full length
    const offset = macdLine.length - validMacd.length;
    const signalLine = macdLine.map((v, i) => {
      const si = i - offset;
      return si >= 0 && si < signalRaw.length ? signalRaw[si] : null;
    });
    const histogram = macdLine.map((v, i) =>
      v !== null && signalLine[i] !== null ? v - signalLine[i] : null
    );
    return { macdLine, signalLine, histogram };
  },

  // ─── Bollinger Bands ────────────────────────────────────────────────────────

  bollingerBands(closes, period = 20, stdDev = 2) {
    const mid = this.sma(closes, period);
    return closes.map((_, i) => {
      if (mid[i] === null) return { upper: null, mid: null, lower: null, bandwidth: null };
      const slice = closes.slice(i - period + 1, i + 1);
      const mean = mid[i];
      const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
      const sd = Math.sqrt(variance);
      return {
        upper: mean + stdDev * sd,
        mid: mean,
        lower: mean - stdDev * sd,
        bandwidth: (sd * stdDev * 2) / mean,
        percentB: (closes[i] - (mean - stdDev * sd)) / (stdDev * 2 * sd || 0.0001),
      };
    });
  },

  // ─── Stochastic ─────────────────────────────────────────────────────────────

  stochastic(candles, kPeriod = 14, dPeriod = 3) {
    const kRaw = candles.map((c, i) => {
      if (i < kPeriod - 1) return null;
      const slice = candles.slice(i - kPeriod + 1, i + 1);
      const highMax = Math.max(...slice.map(x => x.high));
      const lowMin = Math.min(...slice.map(x => x.low));
      const range = highMax - lowMin;
      return range === 0 ? 50 : ((c.close - lowMin) / range) * 100;
    });
    const kValues = kRaw.filter(v => v !== null);
    const dRaw = this.sma(kValues, dPeriod);
    const offset = kRaw.length - kValues.length;
    return kRaw.map((k, i) => {
      const di = i - offset;
      return { k, d: di >= 0 ? dRaw[di] : null };
    });
  },

  // ─── ATR ────────────────────────────────────────────────────────────────────

  atr(candles, period = 14) {
    const tr = candles.map((c, i) => {
      if (i === 0) return c.high - c.low;
      const prev = candles[i - 1].close;
      return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
    });
    return this.ema(tr, period);
  },

  // ─── ADX ────────────────────────────────────────────────────────────────────

  adx(candles, period = 14) {
    const result = [];
    let smoothDM_plus = 0, smoothDM_minus = 0, smoothTR = 0;
    for (let i = 1; i < candles.length; i++) {
      const curr = candles[i], prev = candles[i - 1];
      const upMove = curr.high - prev.high;
      const downMove = prev.low - curr.low;
      const dmPlus = upMove > downMove && upMove > 0 ? upMove : 0;
      const dmMinus = downMove > upMove && downMove > 0 ? downMove : 0;
      const tr = Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close));
      if (i < period) {
        smoothDM_plus += dmPlus; smoothDM_minus += dmMinus; smoothTR += tr;
        result.push(null); continue;
      }
      if (i === period) {
        smoothDM_plus += dmPlus; smoothDM_minus += dmMinus; smoothTR += tr;
      } else {
        smoothDM_plus = smoothDM_plus - smoothDM_plus / period + dmPlus;
        smoothDM_minus = smoothDM_minus - smoothDM_minus / period + dmMinus;
        smoothTR = smoothTR - smoothTR / period + tr;
      }
      const diPlus = smoothTR ? (smoothDM_plus / smoothTR) * 100 : 0;
      const diMinus = smoothTR ? (smoothDM_minus / smoothTR) * 100 : 0;
      const dx = diPlus + diMinus ? (Math.abs(diPlus - diMinus) / (diPlus + diMinus)) * 100 : 0;
      result.push({ adx: dx, diPlus, diMinus });
    }
    return result;
  },

  // ─── VWAP ───────────────────────────────────────────────────────────────────

  vwap(candles) {
    let cumVolume = 0, cumTP = 0;
    return candles.map(c => {
      const tp = (c.high + c.low + c.close) / 3;
      cumVolume += c.volume || 1;
      cumTP += tp * (c.volume || 1);
      return cumTP / cumVolume;
    });
  },

  // ─── Money Flow Index (MFI) ────────────────────────────────────────────────

  mfi(candles, period = 14) {
    const result = [];
    let posFlow = 0, negFlow = 0;
    const typPrices = candles.map(c => (c.high + c.low + c.close) / 3);
    const rawMoneyFlow = typPrices.map((tp, i) => tp * (candles[i].volume || 1));
    
    for (let i = 1; i < candles.length; i++) {
      const isPos = typPrices[i] > typPrices[i - 1];
      const isNeg = typPrices[i] < typPrices[i - 1];
      const currentFlow = rawMoneyFlow[i];
      
      const pFlow = isPos ? currentFlow : 0;
      const nFlow = isNeg ? currentFlow : 0;
      
      if (i < period) {
        posFlow += pFlow;
        negFlow += nFlow;
        result.push(null);
        continue;
      }
      
      if (i === period) {
        posFlow += pFlow;
        negFlow += nFlow;
      } else {
        const oldIsPos = typPrices[i - period + 1] > typPrices[i - period];
        const oldIsNeg = typPrices[i - period + 1] < typPrices[i - period];
        const oldFlow = rawMoneyFlow[i - period + 1];
        posFlow = posFlow - (oldIsPos ? oldFlow : 0) + pFlow;
        negFlow = negFlow - (oldIsNeg ? oldFlow : 0) + nFlow;
      }
      
      const mfr = posFlow / (negFlow || 0.0001);
      result.push(100 - (100 / (1 + mfr)));
    }
    // Pad start with null
    return [null, ...result];
  },


  // ─── Ichimoku ───────────────────────────────────────────────────────────────

  ichimoku(candles, tenkan = 9, kijun = 26, senkou = 52) {
    const midpoint = (start, len) => {
      if (start < len - 1) return null;
      const slice = candles.slice(start - len + 1, start + 1);
      return (Math.max(...slice.map(c => c.high)) + Math.min(...slice.map(c => c.low))) / 2;
    };
    return candles.map((_, i) => ({
      tenkanSen: midpoint(i, tenkan),
      kijunSen: midpoint(i, kijun),
      senkouA: i >= kijun - 1 ? (midpoint(i, tenkan) !== null && midpoint(i, kijun) !== null ? (midpoint(i, tenkan) + midpoint(i, kijun)) / 2 : null) : null,
      senkouB: midpoint(i, senkou),
      chikouSpan: i >= kijun ? candles[i - kijun].close : null,
    }));
  },

  // ─── Fibonacci ──────────────────────────────────────────────────────────────

  fibonacci(candles, lookback = 50) {
    const recent = candles.slice(-lookback);
    const high = Math.max(...recent.map(c => c.high));
    const low = Math.min(...recent.map(c => c.low));
    const diff = high - low;
    return {
      high, low,
      r236: high - diff * 0.236,
      r382: high - diff * 0.382,
      r500: high - diff * 0.500,
      r618: high - diff * 0.618,
      r786: high - diff * 0.786,
    };
  },

  // ─── Support/Resistance ─────────────────────────────────────────────────────

  supportResistance(candles, lookback = 20) {
    const recent = candles.slice(-lookback);
    const highs = recent.map(c => c.high).sort((a, b) => b - a);
    const lows = recent.map(c => c.low).sort((a, b) => a - b);
    return {
      resistance: highs.slice(0, 3).reduce((a, b) => a + b, 0) / 3,
      support: lows.slice(0, 3).reduce((a, b) => a + b, 0) / 3,
    };
  },

  // ─── Pivot Points ───────────────────────────────────────────────────────────

  pivotPoints(candles) {
    const prev = candles[candles.length - 2] || candles[candles.length - 1];
    const pivot = (prev.high + prev.low + prev.close) / 3;
    return {
      pivot,
      r1: 2 * pivot - prev.low,
      r2: pivot + (prev.high - prev.low),
      s1: 2 * pivot - prev.high,
      s2: pivot - (prev.high - prev.low),
    };
  },

  // ─── Momentum ───────────────────────────────────────────────────────────────

  momentum(closes, period = 10) {
    return closes.map((c, i) => i >= period ? c - closes[i - period] : null);
  },

  // ─── Williams %R ────────────────────────────────────────────────────────────

  williamsR(candles, period = 14) {
    return candles.map((c, i) => {
      if (i < period - 1) return null;
      const slice = candles.slice(i - period + 1, i + 1);
      const highMax = Math.max(...slice.map(x => x.high));
      const lowMin = Math.min(...slice.map(x => x.low));
      const range = highMax - lowMin;
      return range === 0 ? -50 : ((highMax - c.close) / range) * -100;
    });
  },

  // ─── CCI ────────────────────────────────────────────────────────────────────

  cci(candles, period = 20) {
    return candles.map((c, i) => {
      if (i < period - 1) return null;
      const slice = candles.slice(i - period + 1, i + 1);
      const tp = (c.high + c.low + c.close) / 3;
      const tpArr = slice.map(x => (x.high + x.low + x.close) / 3);
      const mean = tpArr.reduce((a, b) => a + b, 0) / period;
      const meanDev = tpArr.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
      return meanDev === 0 ? 0 : (tp - mean) / (0.015 * meanDev);
    });
  },

  // ─── Volume Oscillator ───────────────────────────────────────────────────────

  volumeOscillator(volumes, fast = 5, slow = 10) {
    const emaFast = this.ema(volumes, fast);
    const emaSlow = this.ema(volumes, slow);
    return volumes.map((_, i) =>
      emaFast[i] !== null && emaSlow[i] !== null ? ((emaFast[i] - emaSlow[i]) / (emaSlow[i] || 1)) * 100 : null
    );
  },

  // ─── Parabolic SAR ───────────────────────────────────────────────────────────

  parabolicSAR(candles, initAF = 0.02, maxAF = 0.2) {
    const result = [];
    let bull = true;
    let sar = candles[0].low;
    let ep = candles[0].high;
    let af = initAF;

    for (let i = 0; i < candles.length; i++) {
      if (i === 0) { result.push({ sar, bull }); continue; }
      sar = sar + af * (ep - sar);
      if (bull) {
        sar = Math.min(sar, candles[Math.max(i - 1, 0)].low, candles[Math.max(i - 2, 0)].low);
        if (candles[i].low < sar) {
          bull = false; sar = ep; ep = candles[i].low; af = initAF;
        } else {
          if (candles[i].high > ep) { ep = candles[i].high; af = Math.min(af + initAF, maxAF); }
        }
      } else {
        sar = Math.max(sar, candles[Math.max(i - 1, 0)].high, candles[Math.max(i - 2, 0)].high);
        if (candles[i].high > sar) {
          bull = true; sar = ep; ep = candles[i].high; af = initAF;
        } else {
          if (candles[i].low < ep) { ep = candles[i].low; af = Math.min(af + initAF, maxAF); }
        }
      }
      result.push({ sar, bull });
    }
    return result;
  },

  // ─── Candlestick Patterns ────────────────────────────────────────────────────

  candlestickPatterns(candles) {
    const patterns = [];
    const n = candles.length;
    if (n < 3) return patterns;

    const c = candles[n - 1];
    const p1 = candles[n - 2];
    const p2 = candles[n - 3];
    const bodySize = Math.abs(c.close - c.open);
    const totalSize = c.high - c.low;
    const prevBodySize = Math.abs(p1.close - p1.open);

    // Doji
    if (bodySize / (totalSize || 0.0001) < 0.1) patterns.push({ name: 'Doji', signal: 'neutral' });

    // Hammer
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    if (lowerWick > bodySize * 2 && upperWick < bodySize * 0.3) patterns.push({ name: 'Hammer', signal: 'buy' });

    // Shooting Star
    if (upperWick > bodySize * 2 && lowerWick < bodySize * 0.3) patterns.push({ name: 'Shooting Star', signal: 'sell' });

    // Bullish/Bearish Engulfing
    if (p1.close < p1.open && c.close > c.open && c.open < p1.close && c.close > p1.open)
      patterns.push({ name: 'Bullish Engulfing', signal: 'buy' });
    if (p1.close > p1.open && c.close < c.open && c.open > p1.close && c.close < p1.open)
      patterns.push({ name: 'Bearish Engulfing', signal: 'sell' });

    // Morning/Evening Star
    const p1IsSmall = Math.abs(p1.close - p1.open) < prevBodySize * 0.5;
    if (p2.close < p2.open && p1IsSmall && c.close > c.open && c.close > (p2.open + p2.close) / 2)
      patterns.push({ name: 'Morning Star', signal: 'buy' });
    if (p2.close > p2.open && p1IsSmall && c.close < c.open && c.close < (p2.open + p2.close) / 2)
      patterns.push({ name: 'Evening Star', signal: 'sell' });

    return patterns.length ? patterns : [{ name: 'No Pattern', signal: 'neutral' }];
  },

  // ─── Trendline / Channel Detection ──────────────────────────────────────────

  trendlineBreakout(candles, lookback = 20) {
    const recent = candles.slice(-lookback - 1, -1);
    const highs = recent.map(c => c.high);
    const lows = recent.map(c => c.low);
    const avgHigh = highs.reduce((a, b) => a + b, 0) / highs.length;
    const avgLow = lows.reduce((a, b) => a + b, 0) / lows.length;
    const lastClose = candles[candles.length - 1].close;
    const prevClose = candles[candles.length - 2]?.close || lastClose;

    if (prevClose <= avgHigh && lastClose > avgHigh) return 'breakout_up';
    if (prevClose >= avgLow && lastClose < avgLow) return 'breakout_down';
    return 'none';
  },

  // ─── Multi-Timeframe helper ──────────────────────────────────────────────────

  aggregateToHigherTF(candles, factor) {
    const result = [];
    for (let i = 0; i < candles.length; i += factor) {
      const group = candles.slice(i, i + factor);
      if (!group.length) break;
      result.push({
        time: group[0].time,
        open: group[0].open,
        high: Math.max(...group.map(c => c.high)),
        low: Math.min(...group.map(c => c.low)),
        close: group[group.length - 1].close,
        volume: group.reduce((a, c) => a + (c.volume || 0), 0),
      });
    }
    return result;
  },

};

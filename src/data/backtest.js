/**
 * Backtesting Engine
 * Runs the full 20-strategy system over historical data
 * and produces performance statistics per strategy and combined.
 */

import { STRATEGIES, runAllStrategies, aggregateSignals } from '../strategies/strategies.js';

export function runBacktest(candles, lookback = 50, startBalance = 1000, riskPct = 1.0) {
  const results = [];
  const perStrategy = STRATEGIES.map(s => ({
    id: s.id, name: s.name, category: s.category, weight: s.weight,
    trades: 0, wins: 0, losses: 0, signals: [],
  }));

  let combinedTrades = 0, combinedWins = 0, combinedLosses = 0;
  const equityCurve = [startBalance];
  let equity = startBalance;

  const signals = [];

  for (let i = lookback; i < candles.length - 1; i++) {
    const slice = candles.slice(0, i + 1);
    const stratResults = runAllStrategies(slice);
    const agg = aggregateSignals(stratResults);

    // Per-strategy stats (Fast generic approximation)
    const entryPrice = candles[i].close;
    const futureCandles = candles.slice(i + 1, i + 11);
    const exitPrice = futureCandles[futureCandles.length - 1]?.close || entryPrice;
    const priceReturn = (exitPrice - entryPrice) / entryPrice;

    for (let si = 0; si < stratResults.length; si++) {
      const sr = stratResults[si];
      const ps = perStrategy[si];
      if (sr.signal === 'neutral') continue;
      ps.trades++;
      const won = (sr.signal === 'buy' && priceReturn > 0.0005) ||
                  (sr.signal === 'sell' && priceReturn < -0.0005);
      if (won) ps.wins++; else ps.losses++;
      ps.signals.push({ i, signal: sr.signal, conf: sr.confidence, result: priceReturn });
    }

    // Combined system with Exact Dollar SL/TP
    if (agg.thresholdMet && agg.finalSignal !== 'NO TRADE') {
      const riskParams = computeRiskParams(slice, agg.finalSignal, agg.finalConfidence, '15min');
      const isBuy = agg.finalSignal === 'BUY';
      
      let won = false;
      let hitTP = false;
      let hitSL = false;
      let rawPnl = 0;
      let exitMatched = entryPrice;

      // Realistic dollar risk sizing
      const dollarRisk = equity * (riskPct / 100);

      // Scan forward to see which hits first: SL or TP1
      for (let j = i + 1; j < candles.length; j++) {
        const fc = candles[j];
        if (isBuy) {
          if (fc.low <= riskParams.stopLoss) { hitSL = true; exitMatched = riskParams.stopLoss; break; }
          if (fc.high >= riskParams.takeProfit1) { hitTP = true; exitMatched = riskParams.takeProfit1; break; }
        } else {
          if (fc.high >= riskParams.stopLoss) { hitSL = true; exitMatched = riskParams.stopLoss; break; }
          if (fc.low <= riskParams.takeProfit1) { hitTP = true; exitMatched = riskParams.takeProfit1; break; }
        }
      }

      // If neither hit by end of chart, mark out at current price
      if (!hitTP && !hitSL) {
        exitMatched = candles[candles.length - 1].close;
        const diff = isBuy ? (exitMatched - entryPrice) : (entryPrice - exitMatched);
        won = diff > 0;
        // Approximation of PnL if closed manually
        rawPnl = diff > 0 ? (dollarRisk * 0.5) : (-dollarRisk * 0.5); 
      } else {
        won = hitTP;
        // Exact 1.5R win for TP1, or exactly 1R loss for SL
        rawPnl = won ? (dollarRisk * 1.5) : (-dollarRisk); 
      }

      combinedTrades++;
      if (won) combinedWins++; else combinedLosses++;
      
      equity += rawPnl;
      equityCurve.push(+equity.toFixed(2));

      signals.push({
        index: i,
        time: candles[i].time,
        signal: agg.finalSignal,
        confidence: agg.finalConfidence,
        entry: riskParams.entry,
        sl: riskParams.stopLoss,
        tp: riskParams.takeProfit1,
        pnl: +rawPnl.toFixed(2),
        won,
      });

      // Jump forward so we don't open overlapping trades (optional, but realistic)
      if (hitTP || hitSL) {
         // This is a rough estimation of where we exited to prevent duplicate trades in the same swing
         i += 3;
      }
    }
  }

  // Build stats
  const strategyStats = perStrategy.map(ps => ({
    id: ps.id,
    name: ps.name,
    category: ps.category,
    weight: ps.weight,
    trades: ps.trades,
    wins: ps.wins,
    losses: ps.losses,
    winRate: ps.trades > 0 ? +((ps.wins / ps.trades) * 100).toFixed(1) : 0,
    expectancy: ps.trades > 0 ? +((ps.wins / ps.trades * 1 - ps.losses / ps.trades * 0.5) * 100).toFixed(2) : 0,
  }));

  const maxDrawdown = calculateMaxDrawdown(equityCurve);
  const profitFactor = combinedLosses > 0 ? +(combinedWins / combinedLosses).toFixed(2) : combinedWins > 0 ? 999 : 0;

  return {
    combinedTrades,
    combinedWins,
    combinedLosses,
    combinedWinRate: combinedTrades > 0 ? +((combinedWins / combinedTrades) * 100).toFixed(1) : 0,
    profitFactor,
    finalEquity: +equity.toFixed(2),
    maxDrawdown,
    equityCurve,
    strategyStats,
    signals,
    barsAnalyzed: candles.length - lookback,
  };
}

function calculateMaxDrawdown(equityCurve) {
  let peak = -Infinity, maxDD = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return +((maxDD * 100).toFixed(2));
}

export function computeRiskParams(candles, signal, confidence, interval = '15min') {
  const last = candles[candles.length - 1];
  const atrArr = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    atrArr.push(tr);
  }
  const avgATR = atrArr.slice(-14).reduce((a, b) => a + b, 0) / 14;
  const price = last.close;
  const isBuy = signal === 'BUY';

  // ─── Advanced AI Dynamic Swing/Pivot SL ──────────────────────────────────────
  // Finds the most recent structural support/resistance to tuck the SL behind.
  const recentPeriod = 15;
  const recentCandles = candles.slice(-recentPeriod);
  const highestHigh = Math.max(...recentCandles.map(c => c.high));
  const lowestLow = Math.min(...recentCandles.map(c => c.low));

  let structuralSl = isBuy 
    ? lowestLow - (avgATR * 0.1) // Just below recent swing low
    : highestHigh + (avgATR * 0.1); // Just above recent swing high

  let slDistance = Math.abs(price - structuralSl);

  // AI Strict Capital Preservation limits: If swing is too distant, cap the SL tightly!
  // Prevents the "stop loss is too far" bleed.
  const maxSlMultiplier = confidence >= 95 ? 0.8 : confidence >= 90 ? 1.0 : 1.2;
  const maxAtrSlDistance = avgATR * maxSlMultiplier;

  // Force tighten if too wide
  if (slDistance > maxAtrSlDistance) {
    structuralSl = isBuy ? price - maxAtrSlDistance : price + maxAtrSlDistance;
  }
  // Base minimum breathing room (to avoid instant spread-out)
  else if (slDistance < avgATR * 0.4) {
    structuralSl = isBuy ? price - (avgATR * 0.4) : price + (avgATR * 0.4);
  }

  const stopLoss = structuralSl;
  const actualSlDistance = Math.abs(price - stopLoss);

  // Timeframe multiplier — higher timeframes get proportionally larger take profits
  const tfMult = { '1min': 1.0, '5min': 1.5, '15min': 2.2, '30min': 3.0, '1h': 4.0, '4h': 5.0, '1day': 6.0 }[interval] || 2.2;

  // Take Profits are now highly asymmetric based on the tightened SL
  // (Aiming for 1v1.5 and 1v3.0+ Risk/Reward)
  const takeProfit1 = isBuy ? price + (actualSlDistance * 1.5) : price - (actualSlDistance * 1.5);
  const takeProfit2 = isBuy ? price + (actualSlDistance * Math.max(3.0, tfMult)) : price - (actualSlDistance * Math.max(3.0, tfMult));

  const riskReward = Math.abs(takeProfit2 - price) / actualSlDistance;

  const volatilityPct = (avgATR / price) * 100;
  // XAU/USD: 1 pip = $1.00 price movement (industry standard for spot gold)
  const pipScale = 1;
  const dp = 2;

  return {
    entry:       +price.toFixed(dp),
    stopLoss:    +stopLoss.toFixed(dp),
    takeProfit1: +takeProfit1.toFixed(dp),
    takeProfit2: +takeProfit2.toFixed(dp),
    riskReward:  +riskReward.toFixed(1),
    atr:         +avgATR.toFixed(dp),
    volatilityPct: +volatilityPct.toFixed(3),
    highVolatility: volatilityPct > 0.8,
    slPoints:    +(Math.abs(price - stopLoss) * pipScale).toFixed(1),
    tp1Points:   +(Math.abs(price - takeProfit1) * pipScale).toFixed(1),
    tp2Points:   +(Math.abs(price - takeProfit2) * pipScale).toFixed(1),
    timeframe:   interval,
  };
}


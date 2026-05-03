/**
 * Backtest Engine — Walk-Forward Simulation
 * Runs all 12 strategies on historical XAU/USD 15m candles.
 * No look-ahead bias: at bar N, only candles 0..N are visible.
 *
 * Usage: node run-backtest.mjs
 */

import { fetchHistoricalCandles } from './backtest-fetch.mjs';
import { runAllStrategies, aggregateSignals } from './src/strategies/strategies.js';
import { computeRiskParams } from './src/data/backtest.js';
import fs from 'fs';

// ─── Config ───────────────────────────────────────────────────────────────────
const START_EQUITY    = 10000;
const RISK_PCT        = 1.0;
const MIN_HISTORY     = 150;
const WINDOW          = 300;
const COOLDOWN_BARS   = 10;
const INTERVAL        = '15min';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt  = n  => (n >= 0 ? '+' : '') + n.toFixed(2);
const pct  = n  => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
const pad  = (s, w) => String(s).padEnd(w);
const rpad = (s, w) => String(s).padStart(w);

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log('━'.repeat(65));
console.log('  XAU/USD PRECISION BOT — WALK-FORWARD BACKTEST');
console.log('━'.repeat(65));
console.log(`  Fetching maximum historical candles from TradingView...\n`);

let candles;
try {
  candles = await fetchHistoricalCandles('XAU/USD', INTERVAL, 5000);
} catch (e) {
  console.error('❌ Failed to fetch candles:', e.message);
  process.exit(1);
}

console.log(`  ✅ ${candles.length} candles loaded`);
const startDate = new Date(candles[0].time * 1000).toLocaleDateString();
const endDate   = new Date(candles[candles.length - 1].time * 1000).toLocaleDateString();
console.log(`  📅 Period: ${startDate} → ${endDate}\n`);

if (candles.length < MIN_HISTORY + 50) {
  console.error('❌ Not enough historical candles for a meaningful backtest.');
  process.exit(1);
}

// ─── Walk-Forward Simulation ──────────────────────────────────────────────────
let equity        = START_EQUITY;
let peakEquity    = START_EQUITY;
let maxDrawdown   = 0;
let openTrade     = null;
let lastSignalBar = -COOLDOWN_BARS - 1;
const trades      = [];
const equityCurve = [{ bar: 0, equity: START_EQUITY, time: startDate }];
let processed     = 0;

process.stdout.write('  Running simulation');

for (let i = MIN_HISTORY; i < candles.length; i++) {
  const bar     = candles[i];
  const barTime = new Date(bar.time * 1000).toISOString().slice(0, 16);

  // Progress indicator
  if (i % 100 === 0) process.stdout.write('.');

  // ─── 1. Monitor open trade ────────────────────────────────────────────────
  if (openTrade) {
    const { direction, entry, sl, tp1, tp2, hitTp1, breakevenMoved } = openTrade;
    const isBuy = direction === 'BUY';
    const dollarRisk = equity * (RISK_PCT / 100);
    let closeResult = null;
    let closePrice  = null;

    if (isBuy) {
      // TP2 (full target)
      if (bar.high >= tp2 && hitTp1) {
        closeResult = 'TP2'; closePrice = tp2;
      }
      // TP1 (partial, move SL to breakeven)
      else if (bar.high >= tp1 && !hitTp1) {
        openTrade.hitTp1 = true;
        openTrade.sl = entry; // Breakeven
        openTrade.breakevenMoved = true;
      }
      // SL hit
      if (!closeResult && bar.low <= openTrade.sl) {
        closeResult = openTrade.hitTp1 ? 'TP1_Secured' : 'SL';
        closePrice  = openTrade.sl;
      }
    } else { // SELL
      if (bar.low <= tp2 && hitTp1) {
        closeResult = 'TP2'; closePrice = tp2;
      } else if (bar.low <= tp1 && !hitTp1) {
        openTrade.hitTp1 = true;
        openTrade.sl = entry;
        openTrade.breakevenMoved = true;
      }
      if (!closeResult && bar.high >= openTrade.sl) {
        closeResult = openTrade.hitTp1 ? 'TP1_Secured' : 'SL';
        closePrice  = openTrade.sl;
      }
    }

    if (closeResult) {
      let pnl = 0;
      if (closeResult === 'SL')          pnl = -dollarRisk;
      else if (closeResult === 'TP1_Secured') pnl = +(dollarRisk * 1.5).toFixed(2);
      else if (closeResult === 'TP2')    pnl = +(dollarRisk * 3.0).toFixed(2);

      const pips = isBuy
        ? (closePrice - entry)
        : (entry - closePrice);

      equity = +(equity + pnl).toFixed(2);
      if (equity > peakEquity) peakEquity = equity;
      const dd = (peakEquity - equity) / peakEquity * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;

      trades.push({
        ...openTrade,
        closeBar: i, closeTime: barTime, closePrice,
        result: closeResult, pnl, pips: +pips.toFixed(1), equity
      });

      equityCurve.push({ bar: i, equity, time: barTime });
      openTrade = null;
      processed++;
    }
  }

  // ─── 2. Look for new signal ───────────────────────────────────────────────
  if (!openTrade && (i - lastSignalBar) >= COOLDOWN_BARS) {
    // Use rolling window ending at current bar
    const windowStart = Math.max(0, i - WINDOW + 1);
    const window      = candles.slice(windowStart, i + 1);

    const results = runAllStrategies(window);
    const agg     = aggregateSignals(results, null);

    if (agg.thresholdMet && agg.finalSignal !== 'NO TRADE') {
      const risk = computeRiskParams(window, agg.finalSignal, agg.finalConfidence, INTERVAL);
      if (risk.meetsMinRR) {
        openTrade = {
          direction: agg.finalSignal,
          entry:     risk.entry,
          sl:        risk.stopLoss,
          tp1:       risk.takeProfit1,
          tp2:       risk.takeProfit2,
          rr:        risk.riskReward,
          confidence: agg.finalConfidence,
          openBar:   i,
          openTime:  barTime,
          hitTp1:    false,
          breakevenMoved: false,
          originalSl: risk.stopLoss,
        };
        lastSignalBar = i;
      }
    }
  }
}

// Close any open trade at last bar's close
if (openTrade) {
  const lastBar  = candles[candles.length - 1];
  const isBuy    = openTrade.direction === 'BUY';
  const dollarRisk = equity * (RISK_PCT / 100);
  const pips     = isBuy
    ? lastBar.close - openTrade.entry
    : openTrade.entry - lastBar.close;
  const pnl = pips > 0 ? +(dollarRisk * (pips / Math.abs(openTrade.entry - openTrade.sl))).toFixed(2) : -dollarRisk;
  equity = +(equity + pnl).toFixed(2);
  trades.push({
    ...openTrade, closeBar: candles.length - 1,
    closeTime: endDate, closePrice: lastBar.close,
    result: 'OPEN_CLOSE', pnl, pips: +pips.toFixed(1), equity
  });
}

console.log('\n');

// ─── Statistics ───────────────────────────────────────────────────────────────
const wins    = trades.filter(t => t.result === 'TP2' || t.result === 'TP1_Secured');
const losses  = trades.filter(t => t.result === 'SL');
const tp2s    = trades.filter(t => t.result === 'TP2');
const tp1s    = trades.filter(t => t.result === 'TP1_Secured');
const total   = trades.length;
const winRate = total ? (wins.length / total * 100) : 0;
const totalPnl = equity - START_EQUITY;
const totalPct = (totalPnl / START_EQUITY) * 100;
const grossWin  = wins.reduce((s,t) => s + Math.max(0, t.pnl), 0);
const grossLoss = Math.abs(losses.reduce((s,t) => s + Math.min(0, t.pnl), 0));
const pf    = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0);
const avgW  = wins.length   ? grossWin  / wins.length   : 0;
const avgL  = losses.length ? grossLoss / losses.length : 0;
const expec = wins.length && total ? (winRate/100 * avgW) - ((1-winRate/100) * avgL) : 0;

// Sharpe
const returns = trades.map(t => t.pnl / START_EQUITY * 100);
const avgRet  = returns.length ? returns.reduce((a,b) => a+b, 0) / returns.length : 0;
const stdDev  = returns.length > 1
  ? Math.sqrt(returns.reduce((s,r) => s + Math.pow(r - avgRet, 2), 0) / returns.length)
  : 1;
const sharpe  = stdDev > 0 ? avgRet / stdDev : 0;

// Consecutive
let maxCW = 0, maxCL = 0, cw = 0, cl = 0;
for (const t of trades) {
  if (t.result !== 'SL') { cw++; cl = 0; if (cw > maxCW) maxCW = cw; }
  else { cl++; cw = 0; if (cl > maxCL) maxCL = cl; }
}

// ─── Print Report ─────────────────────────────────────────────────────────────
console.log('━'.repeat(65));
console.log('  BACKTEST RESULTS');
console.log('━'.repeat(65));
console.log(`  Period:         ${startDate} → ${endDate}`);
console.log(`  Candles:        ${candles.length} × 15m bars`);
console.log(`  Start Equity:   $${START_EQUITY.toLocaleString()}`);
console.log(`  End Equity:     $${equity.toLocaleString()} (${pct(totalPct)})`);
console.log(`  Total P&L:      ${fmt(totalPnl)} (${pct(totalPct)})`);
console.log('');
console.log(`  ── Signal Quality ─────────────────────────────────────`);
console.log(`  Total Trades:   ${total}`);
console.log(`  Win Rate:       ${winRate.toFixed(1)}%`);
console.log(`  TP2 Full Win:   ${tp2s.length} (${total ? (tp2s.length/total*100).toFixed(0) : 0}%)`);
console.log(`  TP1 Secured:    ${tp1s.length} (${total ? (tp1s.length/total*100).toFixed(0) : 0}%)`);
console.log(`  Stop Loss:      ${losses.length} (${total ? (losses.length/total*100).toFixed(0) : 0}%)`);
console.log('');
console.log(`  ── Risk Metrics ───────────────────────────────────────`);
console.log(`  Profit Factor:  ${pf.toFixed(2)} ${pf >= 1.5 ? '✅' : pf >= 1.0 ? '⚠️' : '❌'}`);
console.log(`  Sharpe Ratio:   ${sharpe.toFixed(2)} ${sharpe >= 1.0 ? '✅' : sharpe >= 0.5 ? '⚠️' : '❌'}`);
console.log(`  Max Drawdown:   ${maxDrawdown.toFixed(1)}% ${maxDrawdown <= 15 ? '✅' : maxDrawdown <= 25 ? '⚠️' : '❌'}`);
console.log(`  Avg Win:        $${avgW.toFixed(2)}`);
console.log(`  Avg Loss:       $${avgL.toFixed(2)}`);
console.log(`  Expectancy:     $${expec.toFixed(2)} per trade`);
console.log(`  Max Consec Wins: ${maxCW}`);
console.log(`  Max Consec Loss: ${maxCL}`);
console.log('');

// ─── Last 10 Trades Table ─────────────────────────────────────────────────────
console.log('  ── Last 10 Trades ─────────────────────────────────────');
console.log(`  ${'Date'.padEnd(17)} ${'Dir'.padEnd(5)} ${'Entry'.padEnd(9)} ${'TP1'.padEnd(9)} ${'SL'.padEnd(9)} ${'Result'.padEnd(12)} ${'P&L'}`);
console.log('  ' + '─'.repeat(62));
for (const t of trades.slice(-10)) {
  const icon   = t.result === 'SL' ? '❌' : t.result === 'TP2' ? '🚀' : '🟢';
  const dirCol = t.direction === 'BUY' ? '🟢' : '🔴';
  console.log(
    `  ${pad(t.openTime?.slice(0,16), 17)} ${dirCol} ${pad(t.entry, 8)} ${pad(t.tp1?.toFixed(2), 9)} ${pad(t.sl?.toFixed(2), 9)} ${icon} ${pad(t.result, 12)} ${fmt(t.pnl)}`
  );
}
console.log('');

// ─── Verdict ─────────────────────────────────────────────────────────────────
console.log('━'.repeat(65));
console.log('  VERDICT');
console.log('━'.repeat(65));
if (pf >= 1.5 && winRate >= 45 && maxDrawdown <= 20) {
  console.log('  ✅ PROFITABLE — System shows positive edge');
  console.log(`     Profit Factor ${pf.toFixed(2)} > 1.5 = strong edge`);
  console.log(`     Win Rate ${winRate.toFixed(1)}% with R:R 3:1 = consistent profit`);
} else if (pf >= 1.0 && winRate >= 38) {
  console.log('  ⚠️  MARGINALLY PROFITABLE — Needs more optimization');
  console.log(`     Profit Factor ${pf.toFixed(2)} — needs to exceed 1.5`);
} else {
  console.log('  ❌ NOT YET PROFITABLE — Strategy needs tuning');
  console.log(`     Win Rate: ${winRate.toFixed(1)}% | Profit Factor: ${pf.toFixed(2)}`);
  console.log('     Threshold may be too strict — not enough signals generated');
}
console.log('━'.repeat(65));

// ─── Save JSON for dashboard ──────────────────────────────────────────────────
const report = {
  period: { start: startDate, end: endDate, candles: candles.length, interval: INTERVAL },
  performance: {
    startEquity: START_EQUITY, endEquity: equity,
    totalPnl: +totalPnl.toFixed(2), totalPct: +totalPct.toFixed(1),
    winRate: +winRate.toFixed(1), profitFactor: +pf.toFixed(2),
    sharpeRatio: +sharpe.toFixed(2), maxDrawdown: +maxDrawdown.toFixed(1),
    avgWin: +avgW.toFixed(2), avgLoss: +avgL.toFixed(2),
    expectancy: +expec.toFixed(2),
    totalTrades: total, wins: wins.length, losses: losses.length,
    tp2Count: tp2s.length, tp1Count: tp1s.length,
    maxConsecWins: maxCW, maxConsecLoss: maxCL,
  },
  equityCurve,
  trades: trades.map(t => ({
    dir: t.direction, entry: t.entry, sl: t.sl, tp1: t.tp1, tp2: t.tp2,
    result: t.result, pnl: t.pnl, pips: t.pips, equity: t.equity,
    openTime: t.openTime, closeTime: t.closeTime, confidence: t.confidence
  })),
  generatedAt: new Date().toISOString()
};

fs.writeFileSync('./backtest-report.json', JSON.stringify(report, null, 2));
console.log(`\n  📄 Full report saved to: backtest-report.json`);
console.log(`  🌐 View at: https://trading-salem-zbf1.vercel.app (after deploy)\n`);

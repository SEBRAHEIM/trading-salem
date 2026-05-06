/**
 * /api/performance.js
 * Returns real performance statistics from the bot's trade history.
 * Used by the dashboard to show win rate, profit factor, equity curve, etc.
 */

const STATE_URL = 'https://jsonblob.com/api/jsonBlob/019dfddf-9b5f-7150-a371-56ba9a3db2c1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const r = await fetch(STATE_URL, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) return res.status(503).json({ error: 'State unavailable' });
    const state = await r.json();

    const trades = (state.trades || []).filter(t => t.result);
    const openTrade = state.openTrade || null;
    const equity = state.equity || 150;
    const startEquity = state.startEquity || 150;

    if (!trades.length) {
      return res.status(200).json({
        totalTrades: 0, winRate: 0, profitFactor: 0, totalPnl: 0,
        avgWin: 0, avgLoss: 0, maxDrawdown: 0, sharpeRatio: 0,
        equity, startEquity, openTrade,
        equityCurve: [{ time: new Date().toISOString(), equity: startEquity }],
        recentTrades: [], bestTrade: null, worstTrade: null,
        breakdown: { tp2: 0, tp1: 0, sl: 0 }
      });
    }

    const wins   = trades.filter(t => t.result === 'TP1' || t.result === 'TP2' || t.result === 'TP1_Secured');
    const losses = trades.filter(t => t.result === 'SL');
    const tp1s   = trades.filter(t => t.result === 'TP1');
    const tp2s   = trades.filter(t => t.result === 'TP2');

    const totalPnl  = trades.reduce((s, t) => s + (t.pnl || 0), 0);
    const grossWin  = wins.reduce((s, t) => s + Math.max(0, t.pnl || 0), 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + Math.min(0, t.pnl || 0), 0));

    const winRate     = trades.length ? (wins.length / trades.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
    const avgWin      = wins.length   ? grossWin  / wins.length   : 0;
    const avgLoss     = losses.length ? grossLoss / losses.length : 0;

    // Equity curve
    let runningEq = startEquity;
    const equityCurve = [{ time: trades[0]?.openTime || new Date().toISOString(), equity: startEquity }];
    for (const t of trades) {
      runningEq += (t.pnl || 0);
      equityCurve.push({ time: t.closeTime || t.openTime, equity: +runningEq.toFixed(2) });
    }

    // Max drawdown
    let peak = startEquity, maxDD = 0;
    for (const pt of equityCurve) {
      if (pt.equity > peak) peak = pt.equity;
      const dd = (peak - pt.equity) / peak * 100;
      if (dd > maxDD) maxDD = dd;
    }

    // Sharpe ratio (simplified — return/volatility of trade returns)
    const returns = trades.map(t => (t.pnl || 0) / startEquity * 100);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length) || 1;
    const sharpe = avgReturn / stdDev;

    // Consecutive stats
    let maxConsecWins = 0, maxConsecLoss = 0, curW = 0, curL = 0;
    for (const t of trades) {
      if (t.result !== 'SL') { curW++; curL = 0; maxConsecWins = Math.max(maxConsecWins, curW); }
      else { curL++; curW = 0; maxConsecLoss = Math.max(maxConsecLoss, curL); }
    }

    const bestTrade  = [...trades].sort((a, b) => (b.pnl||0) - (a.pnl||0))[0];
    const worstTrade = [...trades].sort((a, b) => (a.pnl||0) - (b.pnl||0))[0];
    const recentTrades = [...trades].slice(-10).reverse();

    return res.status(200).json({
      totalTrades: trades.length,
      winRate:       +winRate.toFixed(1),
      winCount:      wins.length,
      lossCount:     losses.length,
      profitFactor:  +profitFactor.toFixed(2),
      totalPnl:      +totalPnl.toFixed(2),
      totalPnlPct:   +((totalPnl / startEquity) * 100).toFixed(1),
      avgWin:        +avgWin.toFixed(2),
      avgLoss:       +avgLoss.toFixed(2),
      maxDrawdown:   +maxDD.toFixed(1),
      sharpeRatio:   +sharpe.toFixed(2),
      maxConsecWins, maxConsecLoss,
      equity, startEquity, openTrade,
      equityCurve,
      trades,          // full closed trades array
      recentTrades,    // last 10 reversed
      bestTrade, worstTrade,
      breakdown: { tp1: tp1s.length, tp2: tp2s.length, sl: losses.length },
      lastUpdated: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

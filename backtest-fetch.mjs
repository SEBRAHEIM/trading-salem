/**
 * backtest-fetch.mjs — Fetches maximum historical candles from TradingView
 * Uses range: 5000 to get ~52 days of 15m data for the backtest engine.
 */
import TradingView from '@mathieuc/tradingview';

export function fetchHistoricalCandles(pair = 'XAU/USD', interval = '15min', range = 5000) {
  const TV_SYMBOLS   = { 'XAU/USD': 'OANDA:XAUUSD' };
  const TV_INTERVALS = { '1min':'1','5min':'5','15min':'15','30min':'30','1h':'60','4h':'240','1day':'D' };

  return new Promise((resolve, reject) => {
    let handled = false;
    const client = new TradingView.Client();
    const chart  = new client.Session.Chart();

    const timeout = setTimeout(() => {
      if (handled) return;
      handled = true;
      try { client.end(); } catch (e) {}
      reject(new Error('TradingView timeout'));
    }, 25000); // 25s timeout for large range

    chart.setMarket(TV_SYMBOLS[pair] || 'OANDA:XAUUSD', {
      timeframe: TV_INTERVALS[interval] || '15',
      range
    });

    chart.onUpdate(() => {
      if (handled) return;
      if (!chart.periods || chart.periods.length < 50) return;
      handled = true;
      clearTimeout(timeout);

      const candles = chart.periods.map(p => ({
        time:   p.time,
        open:   +parseFloat(p.open).toFixed(2),
        high:   +parseFloat(p.max).toFixed(2),
        low:    +parseFloat(p.min).toFixed(2),
        close:  +parseFloat(p.close).toFixed(2),
        volume: Math.round(p.volume || 0),
      })).reverse();

      try { client.end(); } catch (e) {}
      resolve(candles);
    });

    chart.onError(err => {
      if (handled) return;
      handled = true;
      clearTimeout(timeout);
      try { client.end(); } catch (e) {}
      reject(err);
    });
  });
}

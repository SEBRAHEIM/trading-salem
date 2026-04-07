import TradingView from '@mathieuc/tradingview';

const TV_SYMBOLS = {
  'XAU/USD': 'OANDA:XAUUSD',
  'XTIUSD': 'XTIUSD',
};

const TV_INTERVALS = {
  '1min': '1', '5min': '5', '15min': '15',
  '30min': '30', '1h': '60', '4h': '240', '1day': 'D'
};

export async function fetchTradingViewCandles(pair, interval) {
  return new Promise((resolve, reject) => {
    let handled = false;
    const client = new TradingView.Client();
    const chart = new client.Session.Chart();
    
    // Timeout safeguard for serverless
    const timeout = setTimeout(() => {
      if (handled) return;
      handled = true;
      try { client.end(); } catch (e) {}
      reject(new Error("TradingView socket timeout"));
    }, 8000);

    const tvSymbol = TV_SYMBOLS[pair] || 'OANDA:XAUUSD';
    const tvtf = TV_INTERVALS[interval] || '15';

    chart.setMarket(tvSymbol, { timeframe: tvtf, range: 300 });

    chart.onUpdate(() => {
      if (handled) return;
      if (!chart.periods || chart.periods.length < 10) return;
      
      handled = true;
      clearTimeout(timeout);

      // Extract raw data
      const candles = chart.periods.map(p => ({
        time: p.time,
        open: +parseFloat(p.open).toFixed(2),
        high: +parseFloat(p.max).toFixed(2),
        low: +parseFloat(p.min).toFixed(2),
        close: +parseFloat(p.close).toFixed(2),
        volume: Math.round(p.volume || 0),
        synthetic: false
      })).reverse();

      try { client.end(); } catch (e) {}
      resolve(candles);
    });

    chart.onError((err) => {
      if (handled) return;
      handled = true;
      clearTimeout(timeout);
      try { client.end(); } catch (e) {}
      reject(err);
    });
  });
}

export async function fetchTVPrice(pair) {
  try {
    const candles = await fetchTradingViewCandles(pair, '1min');
    if (candles && candles.length) {
      const last = candles[candles.length - 1];
      return { price: last.close, source: 'tradingview' };
    }
  } catch(e) {}
  return null;
}

import { fetchTradingViewCandles } from './utils.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const pair = req.query.pair || 'XAU/USD';
  const tf = req.query.interval || '15min';

  try {
    const candles = await fetchTradingViewCandles(pair, tf);
    return res.status(200).json({ source: 'tradingview', candles: candles.slice(-300) });
  } catch (err) {
    console.warn('[Serverless] TradingView WebSocket failed:', err.message);
    return res.status(503).json({ error: 'TradingView source unavailable' });
  }
}

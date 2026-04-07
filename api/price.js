import { fetchTVPrice } from './utils.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const pair = req.query.pair || 'XAU/USD';

  try {
    const price = await fetchTVPrice(pair);
    if (!price) throw new Error('Live price unavailable');
    return res.status(200).json({ source: price.source || 'live', ...price });
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }
}

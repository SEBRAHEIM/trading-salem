export default async function handler(req, res) {
  const UW_KEY = process.env.UW_API_KEY || "d9dc6e61-6157-4070-af00-2f868fd5dc27";
  const ticker = "GLD"; 

  const getAPI = async (path) => {
    const res = await fetch(`https://api.unusualwhales.com${path}`, {
      headers: { 'Authorization': `Bearer ${UW_KEY}`, 'UW-CLIENT-API-ID': '100001', 'Accept': 'application/json' }
    });
    if (!res.ok) return null;
    return res.json();
  };

  try {
    // Parallel Fetch All Data — continues feeding the engine silently
    const [flowRes, tideRes, dpRes] = await Promise.all([
      getAPI(`/api/option-trades/flow-alerts?ticker_symbol=${ticker}&limit=100`),
      getAPI('/api/market/market-tide?interval_5m=false'),
      getAPI(`/api/darkpool/${ticker}`)
    ]);

    // 1. Analyze Flow
    let calls = [];
    let puts = [];
    if (flowRes && flowRes.data) {
      flowRes.data.forEach(trade => {
        const strike = parseFloat(trade.strike);
        const prem = parseFloat(trade.total_premium || 0);
        if (trade.type === 'call') calls.push({strike, prem});
        else if (trade.type === 'put') puts.push({strike, prem});
      });
      calls.sort((a, b) => b.prem - a.prem);
      puts.sort((a, b) => b.prem - a.prem);
    }

    // 2. Analyze Dark Pool
    let megaBlock = null;
    if (dpRes && dpRes.data) {
      megaBlock = dpRes.data.sort((a,b) => parseFloat(b.premium) - parseFloat(a.premium))[0];
    }

    // 3. Analyze Market Tide
    let tideSentiment = 'neutral';
    if (tideRes && tideRes.data && tideRes.data.length > 0) {
      const latest = tideRes.data[0];
      const np_c = parseFloat(latest.net_call_premium);
      const np_p = parseFloat(latest.net_put_premium);
      if (np_c > Math.abs(np_p)) tideSentiment = 'bullish';
      else if (Math.abs(np_p) > np_c) tideSentiment = 'bearish';
    }

    // Return data as JSON (NO Telegram spam)
    // The engine reads this data silently to fuel the veto system
    res.status(200).json({
      ok: true,
      silent: true,
      ticker,
      tideSentiment,
      topCalls: calls.slice(0, 5).map(c => ({ strike: c.strike, premium: c.prem })),
      topPuts: puts.slice(0, 5).map(p => ({ strike: p.strike, premium: p.prem })),
      darkPool: megaBlock ? { price: megaBlock.price, premium: megaBlock.premium } : null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Whale Engine Error", error);
    res.status(500).json({ error: error.message });
  }
}


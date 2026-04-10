export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { pair } = req.query;

  const feeds = [];
  if (pair === 'XAU/USD') {
    feeds.push('https://finance.yahoo.com/rss/headline?s=GC=F'); // Gold Futures
    feeds.push('https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=2000&id=10000664'); // Finance News
  } else if (pair === 'XTIUSD') {
    feeds.push('https://finance.yahoo.com/rss/headline?s=CL=F'); // Crude Oil
    feeds.push('https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=2000&id=10000664'); // Finance News
  } else {
    feeds.push('https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=2000&id=10000664');
  }

  // ─── LIVE TWITTER (X) MACRO TRACKER ───────────────────────────────────────
  // Ingests master market-mover tweets directly into the AI's headline queue
  const twitterTargets = ['realDonaldTrump', 'elonmusk', 'unusual_whales', 'zerohedge'];
  
  for (const handle of twitterTargets) {
    feeds.push(`https://rsshub.app/twitter/user/${handle}`);
    feeds.push(`https://nitter.poast.org/${handle}/rss`); // Fallback proxy
  }

  try {
    let allHeadlines = [];
    for (const url of feeds) {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const xml = await resp.text();
      
      // Fast Regex to extract <title> ignoring standard XML parsing overhead
      const matches = xml.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g);
      for (const match of matches) {
        const title = match[1];
        if (title && !title.includes('Yahoo') && !title.includes('CNBC')) {
          allHeadlines.push(title);
        }
      }
    }
    
    // Deduplicate and return last 40 unique headlines
    const unique = [...new Set(allHeadlines)].slice(0, 40);
    return res.status(200).json({ headlines: unique });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

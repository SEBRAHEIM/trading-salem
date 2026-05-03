/**
 * News & Economic Calendar API
 * Returns live headlines + upcoming high-impact events for trade filtering.
 */

// High-impact economic event keywords used as fallback calendar matching
const HIGH_IMPACT_KEYWORDS = ['nfp', 'cpi', 'ppi', 'fomc', 'interest rate', 'gdp', 'nonfarm', 'federal reserve', 'powell', 'inflation'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { pair } = req.query;

  const feeds = [
    // Gold-specific
    'https://finance.yahoo.com/rss/headline?s=GC=F',
    // Global macro / geopolitical
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=2000&id=10000664',
    // Reuters markets RSS
    'https://feeds.reuters.com/reuters/businessNews',
  ];

  // ─── Economic Calendar (ForexFactory-compatible free feed) ─────────────────
  let upcomingEvents = [];
  try {
    const calRes = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      signal: AbortSignal.timeout(5000)
    });
    if (calRes.ok) {
      const calData = await calRes.json();
      const now = Date.now();
      const windowMs = 20 * 60 * 1000; // 20 minute pre-event window

      upcomingEvents = (calData || []).filter(ev => {
        if (!ev.date || ev.impact !== 'High') return false;
        const evTime = new Date(ev.date).getTime();
        // Events within the next 20 minutes
        return evTime >= now && evTime <= now + windowMs;
      }).map(ev => ({ title: ev.title, date: ev.date, currency: ev.currency, impact: ev.impact }));
    }
  } catch (e) {
    console.log('[NEWS] Calendar fetch failed:', e.message);
  }

  // ─── Fetch RSS Headlines ────────────────────────────────────────────────────
  let allHeadlines = [];
  for (const url of feeds) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!resp.ok) continue;
      const xml = await resp.text();
      const matches = xml.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g);
      for (const match of matches) {
        const title = match[1]?.trim();
        if (title && title.length > 10 && !title.includes('Yahoo Finance') && !title.includes('CNBC')) {
          allHeadlines.push(title);
        }
      }
    } catch (e) {
      // Skip failed feeds silently
    }
  }

  const unique = [...new Set(allHeadlines)].slice(0, 50);

  // ─── Determine if high-impact news window is ACTIVE ────────────────────────
  const isHighImpactWindow = upcomingEvents.length > 0;
  const highImpactReason = isHighImpactWindow
    ? upcomingEvents.map(e => `${e.title} (${e.currency}) @ ${new Date(e.date).toUTCString()}`).join(', ')
    : null;

  return res.status(200).json({
    headlines: unique,
    upcomingEvents,
    isHighImpactWindow,
    highImpactReason,
    fetchedAt: new Date().toISOString()
  });
}

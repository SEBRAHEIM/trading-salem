/**
 * Trading Bot Tick — Vercel Serverless
 * Triggered every minute by external cron (cron-job.org) or Vercel cron.
 * State persists via jsonblob.com (free, no auth).
 * Monitors XAU/USD (Gold) only.
 *
 * v2 — Macro-aware upgrade:
 *   - Live news injected into strategy context every tick
 *   - Economic calendar check blocks entries before high-impact events
 *   - Session filter: no new signals during dead zones (00:00–02:30 UTC, 21:00–23:59 UTC)
 *   - Drawdown protection: pause new entries if equity drops >5% from peak
 *   - Whale data remapped from GLD→XAU/USD sentiment (no longer misused as price levels)
 */
const TELEGRAM_BOT_TOKEN = '8643381958:AAGUT_9Q_lSj_29Y2lfPRJNzG9TzlmhqReM';
const TELEGRAM_TARGETS = [
  '6732836566',          // Personal DM
  '-1003752467954'       // Group: @chatbotsallem
];
const UW_API_KEY = "d9dc6e61-6157-4070-af00-2f868fd5dc27";
const PAPER_START = 150;
const PAPER_RISK_PCT = 1.0;
const STATE_URL = 'https://jsonblob.com/api/jsonBlob/019d9ab2-26ea-70d2-bc44-9a788ea20156';

// ─── Session Config ───────────────────────────────────────────────────────────
// Only block during actual forex market closure (Saturday all day,
// Sunday before 21:00 UTC when Sydney opens). All other hours: TRADE.
// Asia session (00-05 UTC), NY session (13-22 UTC) — all valid for gold.

// ─── Drawdown Protection ──────────────────────────────────────────────────────
const MAX_DRAWDOWN_PCT = 5.0; // Pause new entries if equity drops >5% from recorded peak

// ─── State ───────────────────────────────────────────────────────────────────
async function loadState() {
  try {
    const r = await fetch(STATE_URL, { headers: { 'Accept': 'application/json' } });
    if (r.ok) return await r.json();
  } catch (e) { console.log('[STATE] Load error:', e.message); }
  return { equity: PAPER_START, peakEquity: PAPER_START, trades: [], openTrade: null, lastSignal: null, lastSignalTime: null, seenHeadlines: [] };
}

async function saveState(state) {
  try {
    await fetch(STATE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(state)
    });
  } catch (e) { console.error('[STATE] Save error:', e.message); }
}

// ─── Telegram ────────────────────────────────────────────────────────────────
async function sendTG(text) {
  try {
    await Promise.allSettled(
      TELEGRAM_TARGETS.map(chat_id =>
        fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id, text, parse_mode: 'HTML' })
        })
      )
    );
  } catch (e) { console.error('[TG]', e.message); }
}

// ─── News Broadcaster ────────────────────────────────────────────────────────
// Sends Telegram alerts ONLY for headlines not seen before.
// Returns list of new headlines so they can be persisted to state.
async function broadcastNewHeadlines(newsData, seenHeadlines = []) {
  const allHeadlines = newsData.headlines || [];
  const upcomingEvents = newsData.upcomingEvents || [];

  // Find headlines not yet seen (exact match dedup)
  const seenSet = new Set(seenHeadlines);
  const newHeadlines = allHeadlines.filter(h => !seenSet.has(h));

  // ─── 1. High-impact economic event alert (urgent) ─────────────────────────
  if (upcomingEvents.length > 0) {
    const eventLines = upcomingEvents.map(e =>
      `⚡️ <b>${e.title}</b> (${e.currency}) — in ~${Math.round((new Date(e.date) - Date.now()) / 60000)} min`
    ).join('\n');
    await sendTG(
      `🚨 <b>HIGH-IMPACT EVENT INCOMING</b>\n\n${eventLines}\n\n⚠️ Trading paused until event clears.`
    );
  }

  // ─── 2. New market headlines ───────────────────────────────────────────────
  if (newHeadlines.length > 0) {
    // Group into batches of 8 to avoid Telegram message length limits
    const BATCH = 8;
    for (let i = 0; i < newHeadlines.length; i += BATCH) {
      const batch = newHeadlines.slice(i, i + BATCH);
      const lines = batch.map((h, idx) => `${i + idx + 1}. ${h}`).join('\n');
      await sendTG(`📰 <b>MARKET NEWS UPDATE</b>\n\n${lines}\n\n<i>Source: Reuters / Yahoo Finance / CNBC</i>`);
    }
  }

  // Return the merged unique set (capped at 50 to keep state small)
  return [...new Set([...seenHeadlines, ...newHeadlines])].slice(-50);
}

// ─── News Feed ───────────────────────────────────────────────────────────────
async function fetchNews(host, proto) {
  try {
    const r = await fetch(`${proto}://${host}/api/news?pair=XAU/USD`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return { headlines: [], isHighImpactWindow: false, highImpactReason: null };
    return await r.json();
  } catch (e) {
    console.log('[NEWS] Fetch failed:', e.message);
    return { headlines: [], isHighImpactWindow: false, highImpactReason: null };
  }
}

// ─── Whale Data (GLD → Directional Sentiment, NOT price levels) ──────────────
async function fetchWhaleData() {
  try {
    const r = await fetch(`https://api.unusualwhales.com/api/option-trades/flow-alerts?ticker_symbol=GLD&limit=100`, {
      headers: { 'Authorization': `Bearer ${UW_API_KEY}`, 'UW-CLIENT-API-ID': '100001', 'Accept': 'application/json' }
    });
    if (!r.ok) return null;
    const data = await r.json();
    let callPremium = 0, putPremium = 0;
    (data.data || []).forEach(t => {
      const prem = parseFloat(t.total_premium || 0);
      if (t.option_type === 'C' || t.type === 'call') callPremium += prem;
      else if (t.option_type === 'P' || t.type === 'put') putPremium += prem;
    });
    const total = callPremium + putPremium;
    // Return directional SENTIMENT from institutional GLD flow
    const sentiment = total > 0
      ? (callPremium / total > 0.6 ? 'bullish' : putPremium / total > 0.6 ? 'bearish' : 'neutral')
      : 'neutral';
    return { sentiment, callPremium, putPremium, active: true };
  } catch (e) { return null; }
}

// ─── Session & Risk Checks ───────────────────────────────────────────────────
function isInTradingSession() {
  const nowUTC = new Date();
  const hourUTC = nowUTC.getUTCHours();
  const dayUTC  = nowUTC.getUTCDay();
  // Forex markets are CLOSED: all of Saturday + Sunday before 21:00 UTC
  if (dayUTC === 6) return false;                     // Saturday — market closed
  if (dayUTC === 0 && hourUTC < 21) return false;    // Sunday before Sydney open
  return true; // All other times: market is open — trade 24/7
}

function isInDrawdown(state) {
  const peak = state.peakEquity || PAPER_START;
  const drawdownPct = ((peak - state.equity) / peak) * 100;
  return drawdownPct > MAX_DRAWDOWN_PCT;
}

// ─── Main Handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const t0 = Date.now();

  try {
    // 1. Fetch candles
    const host = req.headers.host;
    const proto = host.includes('localhost') ? 'http' : 'https';
    const candleRes = await fetch(`${proto}://${host}/api/candles?pair=XAU/USD&interval=15min`, {
      signal: AbortSignal.timeout(15000)
    });
    if (!candleRes.ok) return res.status(200).json({ ok: false, reason: 'candles unavailable' });
    const { candles } = await candleRes.json();
    if (!candles || candles.length < 50) return res.status(200).json({ ok: false, reason: 'insufficient candles' });

    const lastClose = candles[candles.length - 1].close;

    // 2. Load state + news + whale data in parallel
    const [state, newsData, whaleData] = await Promise.all([
      loadState(),
      fetchNews(host, proto),
      fetchWhaleData()
    ]);

    // 3. Update peak equity for drawdown tracking
    if (state.equity > (state.peakEquity || PAPER_START)) {
      state.peakEquity = state.equity;
    }

    // 4. Import strategy engine
    const { runAllStrategies, aggregateSignals, strategyContext } = await import('../src/strategies/strategies.js');
    const { computeRiskParams } = await import('../src/data/backtest.js');

    // ─── INJECT LIVE NEWS INTO STRATEGY CONTEXT ──────────────────────────────
    strategyContext.headlines = newsData.headlines || [];

    // ─── BROADCAST NEW HEADLINES TO TELEGRAM ─────────────────────────────────
    // Only fires for headlines not seen on a previous tick — no spam.
    let stateChanged = false;
    if (newsData.headlines && newsData.headlines.length > 0) {
      state.seenHeadlines = state.seenHeadlines || [];
      const updatedSeen = await broadcastNewHeadlines(newsData, state.seenHeadlines);
      if (updatedSeen.length !== state.seenHeadlines.length) {
        state.seenHeadlines = updatedSeen;
        stateChanged = true;
      }
    }

    // ─── INJECT WHALE SENTIMENT (directional, not price levels) ──────────────
    if (whaleData && whaleData.active) {
      strategyContext.whaleSentiment = whaleData.sentiment;
      strategyContext.correlatedAssets = strategyContext.correlatedAssets || {};
      // Feed GLD institutional flow as a proxy market signal
      if (whaleData.sentiment === 'bullish') {
        strategyContext.correlatedAssets['GLD_FLOW'] = { trend: 'down', value: 0 }; // Calls dominant = institutions expect Gold rally (XAU up)
      } else if (whaleData.sentiment === 'bearish') {
        strategyContext.correlatedAssets['GLD_FLOW'] = { trend: 'up', value: 0 };
      }
    }

    // 5. Monitor open trade
    if (state.openTrade) {
      const t = state.openTrade;
      const isBuy = t.direction === 'BUY';
      const dollarRisk = state.equity * (PAPER_RISK_PCT / 100);
      let closeResult = null;

      if (isBuy) {
        if (lastClose >= t.tp1 && !t.hitTp1) {
          t.hitTp1 = true; stateChanged = true;
          await sendTG(`🟢 <b>TP1 HIT!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Price:</b> ${lastClose}\n<b>TP1:</b> ${t.tp1}\n<b>Entry:</b> ${t.entry}\n<b>Pips:</b> +${(lastClose - t.entry).toFixed(1)}`);
        }
        if (lastClose >= t.tp2 && !t.hitTp2 && t.hitTp1) {
          t.hitTp2 = true; closeResult = 'TP2';
          await sendTG(`🚀 <b>TP2 CRUSHED!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Price:</b> ${lastClose}\n<b>TP2:</b> ${t.tp2}\n<b>Entry:</b> ${t.entry}\n<b>Pips:</b> +${(lastClose - t.entry).toFixed(1)}`);
        }
        if (lastClose <= t.sl) {
          closeResult = t.hitTp1 ? 'TP1_Secured' : 'SL';
          if (t.hitTp1) await sendTG(`⚠️ <b>Stopped after TP1</b>\nProfit secured.\n<b>Asset:</b> XAU/USD`);
          else await sendTG(`❌ <b>SL HIT!</b>\nWe will be back stronger.\n\n<b>Asset:</b> XAU/USD\n<b>Entry:</b> ${t.entry}\n<b>SL:</b> ${t.sl}`);
        }
      } else { // SELL
        if (lastClose <= t.tp1 && !t.hitTp1) {
          t.hitTp1 = true; stateChanged = true;
          await sendTG(`🟢 <b>TP1 HIT!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Price:</b> ${lastClose}\n<b>TP1:</b> ${t.tp1}\n<b>Entry:</b> ${t.entry}\n<b>Pips:</b> +${(t.entry - lastClose).toFixed(1)}`);
        }
        if (lastClose <= t.tp2 && !t.hitTp2 && t.hitTp1) {
          t.hitTp2 = true; closeResult = 'TP2';
          await sendTG(`🚀 <b>TP2 CRUSHED!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Price:</b> ${lastClose}\n<b>TP2:</b> ${t.tp2}\n<b>Entry:</b> ${t.entry}\n<b>Pips:</b> +${(t.entry - lastClose).toFixed(1)}`);
        }
        if (lastClose >= t.sl) {
          closeResult = t.hitTp1 ? 'TP1_Secured' : 'SL';
          if (t.hitTp1) await sendTG(`⚠️ <b>Stopped after TP1</b>\nProfit secured.\n<b>Asset:</b> XAU/USD`);
          else await sendTG(`❌ <b>SL HIT!</b>\nWe will be back stronger.\n\n<b>Asset:</b> XAU/USD\n<b>Entry:</b> ${t.entry}\n<b>SL:</b> ${t.sl}`);
        }
      }

      if (closeResult) {
        let pnl = 0;
        if (closeResult === 'SL') pnl = -dollarRisk;
        else if (closeResult === 'TP1_Secured') pnl = +(dollarRisk * 1.5).toFixed(2);
        else if (closeResult === 'TP2') pnl = +(dollarRisk * 2.5).toFixed(2);

        const pipScale = 1;
        const rawPips = isBuy ? (lastClose - t.entry) * pipScale : (t.entry - lastClose) * pipScale;

        state.equity = +(state.equity + pnl).toFixed(2);
        state.trades.push({
          ...t, closeTime: new Date().toISOString(), closePrice: lastClose,
          result: closeResult, pnl, pips: +rawPips.toFixed(1), equity: state.equity
        });
        state.openTrade = null;
        state.lastSignalTime = null;
        stateChanged = true;
      } else if (stateChanged) {
        state.openTrade = t;
      }
    }

    // 6. Look for new signal (only if no open trade)
    let skipReason = null;
    if (!state.openTrade) {
      // ─── GATE 1: Market closure (weekends only) ──────────────────────────────
      if (!isInTradingSession()) {
        skipReason = 'Forex market closed (weekend)';
      }

      // ─── GATE 2: High-impact news event window ───────────────────────────────
      else if (newsData.isHighImpactWindow) {
        skipReason = `High-impact news imminent: ${newsData.highImpactReason}`;
        console.log('[CRON] Signal blocked:', skipReason);
      }

      // ─── GATE 3: Drawdown protection ─────────────────────────────────────────
      else if (isInDrawdown(state)) {
        const peak = state.peakEquity || PAPER_START;
        const dd = (((peak - state.equity) / peak) * 100).toFixed(1);
        skipReason = `Drawdown protection active (${dd}% from peak $${peak})`;
        console.log('[CRON] Signal blocked:', skipReason);
      }

      // ─── GATE 4: Cooldown ─────────────────────────────────────────────────────
      else {
        const COOLDOWN_MS = 10 * 60 * 1000;
        const lastTime = state.lastSignalTime ? new Date(state.lastSignalTime).getTime() : 0;
        const inCooldown = Date.now() - lastTime < COOLDOWN_MS;

        if (!inCooldown) {
          const allResults = runAllStrategies(candles);
          const agg = aggregateSignals(allResults, state.lastSignal);

          if (agg.thresholdMet && agg.finalSignal !== 'NO TRADE') {
            const risk = computeRiskParams(candles, agg.finalSignal, agg.finalConfidence, '15min');
            state.openTrade = {
              id: Date.now(), pair: 'XAU/USD', direction: agg.finalSignal,
              confidence: agg.finalConfidence, openTime: new Date().toISOString(),
              entry: risk.entry, sl: risk.stopLoss, tp1: risk.takeProfit1,
              tp2: risk.takeProfit2, riskReward: risk.riskReward,
              newsContext: newsData.headlines.slice(0, 3).join(' | '),
              whaleSentiment: whaleData?.sentiment || 'neutral',
            };
            state.lastSignal = agg.finalSignal;
            state.lastSignalTime = new Date().toISOString();
            stateChanged = true;

            // Build confluence summary for Telegram
            const confluenceLines = newsData.headlines.length > 0
              ? `\n\n📰 <b>News Context:</b> ${newsData.headlines[0]}`
              : '';
            const whaleNote = whaleData?.sentiment && whaleData.sentiment !== 'neutral'
              ? `\n🐳 <b>Institutional Flow:</b> ${whaleData.sentiment.toUpperCase()}`
              : '';

            await sendTG(
              `🚨 <b>${agg.finalSignal} XAU/USD</b>\n` +
              `⚠️ <b>${agg.riskLevel}</b>\n\n` +
              `Entry price: ${risk.entry}\n` +
              `TP1: ${risk.takeProfit1}\n` +
              `TP2: ${risk.takeProfit2}\n` +
              `SL: ${risk.stopLoss}` +
              confluenceLines +
              whaleNote
            );
          }
        }
      }
    }

    // 7. Save state only if changed
    if (stateChanged) await saveState(state);

    return res.status(200).json({
      ok: true, ms: Date.now() - t0, price: lastClose, equity: state.equity,
      open: state.openTrade ? `${state.openTrade.direction} @ ${state.openTrade.entry}` : null,
      trades: state.trades.length,
      skipReason,
      newsHeadlines: newsData.headlines.length,
      isHighImpactWindow: newsData.isHighImpactWindow,
      whaleSentiment: whaleData?.sentiment || 'unavailable',
      session: isInTradingSession(),
      drawdownActive: isInDrawdown(state),
    });
  } catch (err) {
    console.error('[TICK]', err);
    return res.status(500).json({ error: err.message });
  }
}

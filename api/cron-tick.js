/**
 * Trading Bot Tick — Vercel Serverless
 * Triggered every minute by external cron (cron-job.org) or Vercel cron.
 * State persists via jsonblob.com (free, no auth).
 * Monitors XAU/USD (Gold) only.
 *
 * v3 — Clean signal engine:
 *   - NO news fetching, NO news broadcasting
 *   - Session filter: weekends only (market closure)
 *   - Drawdown protection: pause if equity drops >5% from peak
 *   - 4-hour cooldown between trades
 *   - TP1 only exits (1:2 R:R)
 */
const TELEGRAM_BOT_TOKEN = '8643381958:AAGUT_9Q_lSj_29Y2lfPRJNzG9TzlmhqReM';
const TELEGRAM_TARGETS = [
  '6732836566',          // Personal DM
  '-1003752467954'       // Group: @chatbotsallem
];
const UW_API_KEY = "019df1e9-9a6d-7185-8c96-46d0165e0f9a";
const PAPER_START = 150;
const PAPER_RISK_PCT = 1.0;
const STATE_URL = 'https://jsonblob.com/api/jsonBlob/019df1e9-9a6d-7185-8c96-46d0165e0f9a';

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
  return { equity: PAPER_START, peakEquity: PAPER_START, startEquity: PAPER_START, startDate: new Date().toISOString().slice(0,10), trades: [], openTrade: null, lastSignal: null, lastSignalTime: null };
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
    const [state, whaleData] = await Promise.all([
      loadState(),
      fetchWhaleData()
    ]);

    // 3. Update peak equity for drawdown tracking
    if (state.equity > (state.peakEquity || PAPER_START)) {
      state.peakEquity = state.equity;
    }

    // 4. Import strategy engine
    const { runAllStrategies, aggregateSignals, strategyContext } = await import('../src/strategies/strategies.js');
    const { computeRiskParams } = await import('../src/data/backtest.js');

    
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
          // ─── Move SL to breakeven after TP1 hit ────────────────────────────
          if (!t.breakevenMoved) {
            t.sl = t.entry;   // SL → entry = you can never lose this trade now
            t.breakevenMoved = true;
          }
          await sendTG(`🟢 <b>TP1 HIT!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Price:</b> ${lastClose}\n<b>TP1:</b> ${t.tp1}\n<b>Entry:</b> ${t.entry}\n<b>Pips:</b> +${(lastClose - t.entry).toFixed(1)}\n\n🔒 <b>SL moved to breakeven</b> — trade is now risk-free`);
        }
        if (lastClose >= t.tp2 && !t.hitTp2 && t.hitTp1) {
          t.hitTp2 = true; closeResult = 'TP2';
        }
        if (lastClose <= t.sl) {
          closeResult = t.hitTp1 ? 'TP1_Secured' : 'SL';
          if (t.hitTp1) await sendTG(`⚠️ <b>Stopped after TP1</b>\nProfit secured.\n<b>Asset:</b> XAU/USD`);
          else await sendTG(`❌ <b>SL HIT!</b>\nWe will be back stronger.\n\n<b>Asset:</b> XAU/USD\n<b>Entry:</b> ${t.entry}\n<b>SL:</b> ${t.sl}`);
        }
      } else { // SELL
        if (lastClose <= t.tp1 && !t.hitTp1) {
          t.hitTp1 = true; stateChanged = true;
          if (!t.breakevenMoved) {
            t.sl = t.entry;   // SL → entry = risk-free
            t.breakevenMoved = true;
          }
          await sendTG(`🟢 <b>TP1 HIT!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Price:</b> ${lastClose}\n<b>TP1:</b> ${t.tp1}\n<b>Entry:</b> ${t.entry}\n<b>Pips:</b> +${(t.entry - lastClose).toFixed(1)}\n\n🔒 <b>SL moved to breakeven</b> — trade is now risk-free`);
        }
        if (lastClose <= t.tp2 && !t.hitTp2 && t.hitTp1) {
          t.hitTp2 = true; closeResult = 'TP2';
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
        else if (closeResult === 'TP1') pnl = +(dollarRisk * 2.0).toFixed(2);

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

      // ─── GATE 2 (news gate removed)

      // ─── GATE 3: Drawdown protection ─────────────────────────────────────────
      else if (isInDrawdown(state)) {
        const peak = state.peakEquity || PAPER_START;
        const dd = (((peak - state.equity) / peak) * 100).toFixed(1);
        skipReason = `Drawdown protection active (${dd}% from peak $${peak})`;
        console.log('[CRON] Signal blocked:', skipReason);
      }

      // ─── GATE 4: Cooldown ─────────────────────────────────────────────────────
      else {
        const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours — prevents rapid signal chains
        const lastTime = state.lastSignalTime ? new Date(state.lastSignalTime).getTime() : 0;
        const inCooldown = Date.now() - lastTime < COOLDOWN_MS;

        if (!inCooldown) {
          const allResults = runAllStrategies(candles);
          const agg = aggregateSignals(allResults, state.lastSignal);

        if (agg.thresholdMet && agg.finalSignal !== 'NO TRADE') {
            const risk = computeRiskParams(candles, agg.finalSignal, agg.finalConfidence, '15min');

            // ─── R:R Gate: skip if setup doesn't offer minimum 1.5 R:R ──────────
            if (!risk.meetsMinRR) {
              skipReason = `R:R too low (${risk.riskReward}x) — minimum 1.5x required. Skipping.`;
              console.log('[CRON] Trade skipped:', skipReason);
            } else {
            state.openTrade = {
              id: Date.now(), pair: 'XAU/USD', direction: agg.finalSignal,
              confidence: agg.finalConfidence, openTime: new Date().toISOString(),
              entry: risk.entry, sl: risk.stopLoss, tp1: risk.takeProfit1, riskReward: risk.riskReward,
              originalSl: risk.stopLoss,   // ← keep original for reference
              breakevenMoved: false,        // ← tracks if SL moved to breakeven
              newsContext: [];
            state.lastSignal = agg.finalSignal;
            state.lastSignalTime = new Date().toISOString();
            stateChanged = true;

            await sendTG(
              `🚨 <b>${agg.finalSignal} XAU/USD</b>\n` +
              `⚠️ <b>${agg.riskLevel}</b> | Confidence: ${agg.finalConfidence}% | R:R ${risk.riskReward}x\n\n` +
              `🟢 Entry:  ${risk.entry}\n` +
              `🎯 TP1:    ${risk.takeProfit1}\n` +
              `🛑 SL:     ${risk.stopLoss}\n` +
              `📏 SL pts: ${risk.slPoints}pts | TP pts: ${risk.tp1Points}pts`
            );
            } // end meetsMinRR
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
      newsHeadlines: [];
  } catch (err) {
    console.error('[TICK]', err);
    return res.status(500).json({ error: err.message });
  }
}

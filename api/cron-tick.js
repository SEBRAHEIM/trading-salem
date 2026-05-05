/**
 * Trading Bot Tick — Vercel Serverless
 * Triggered every minute by external cron (cron-job.org) or Vercel cron.
 * State persists via jsonblob.com (free, no auth).
 * Monitors XAU/USD (Gold) only.
 *
 * v3 — Clean signal engine:
 *   - NO news fetching, NO news broadcasting (removed permanently)
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
const UW_API_KEY        = 'd9dc6e61-6157-4070-af00-2f868fd5dc27';
const PAPER_START       = 150;
const PAPER_RISK_PCT    = 1.0;
const STATE_URL         = 'https://jsonblob.com/api/jsonBlob/019df75c-6187-7a65-9034-897c1f96a94a';
const MAX_DRAWDOWN_PCT  = 5.0;

// ─── State ───────────────────────────────────────────────────────────────────
async function loadState() {
  try {
    const r = await fetch(STATE_URL, { headers: { 'Accept': 'application/json' } });
    if (r.ok) return await r.json();
  } catch (e) { console.log('[STATE] Load error:', e.message); }
  return {
    equity: PAPER_START, peakEquity: PAPER_START, startEquity: PAPER_START,
    startDate: new Date().toISOString().slice(0, 10),
    trades: [], openTrade: null, lastSignal: null, lastSignalTime: null
  };
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

// ─── Whale Data (GLD → Directional Sentiment) ─────────────────────────────
async function fetchWhaleData() {
  try {
    const r = await fetch(
      `https://api.unusualwhales.com/api/option-trades/flow-alerts?ticker_symbol=GLD&limit=100`,
      { headers: { 'Authorization': `Bearer ${UW_API_KEY}`, 'UW-CLIENT-API-ID': '100001', 'Accept': 'application/json' } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    let callPremium = 0, putPremium = 0;
    (data.data || []).forEach(t => {
      const prem = parseFloat(t.total_premium || 0);
      if (t.option_type === 'C' || t.type === 'call') callPremium += prem;
      else if (t.option_type === 'P' || t.type === 'put') putPremium += prem;
    });
    const total = callPremium + putPremium;
    const sentiment = total > 0
      ? (callPremium / total > 0.6 ? 'bullish' : putPremium / total > 0.6 ? 'bearish' : 'neutral')
      : 'neutral';
    return { sentiment, active: true };
  } catch (e) { return null; }
}

// ─── Session & Risk Checks ───────────────────────────────────────────────────
function isInTradingSession() {
  const now  = new Date();
  const day  = now.getUTCDay();
  const hour = now.getUTCHours();
  if (day === 6) return false;                  // Saturday — closed
  if (day === 0 && hour < 21) return false;     // Sunday before Sydney open
  return true;
}

function isInDrawdown(state) {
  const peak = state.peakEquity || PAPER_START;
  return ((peak - state.equity) / peak) * 100 > MAX_DRAWDOWN_PCT;
}

// ─── Main Handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const t0 = Date.now();

  try {
    // 1. Fetch candles
    const host  = req.headers.host;
    const proto = host.includes('localhost') ? 'http' : 'https';
    const candleRes = await fetch(`${proto}://${host}/api/candles?pair=XAU/USD&interval=15min`, {
      signal: AbortSignal.timeout(15000)
    });
    if (!candleRes.ok) return res.status(200).json({ ok: false, reason: 'candles unavailable' });
    const { candles } = await candleRes.json();
    if (!candles || candles.length < 50) return res.status(200).json({ ok: false, reason: 'insufficient candles' });

    const lastClose = candles[candles.length - 1].close;

    // 2. Load state + whale data in parallel (NO news)
    const [state, whaleData] = await Promise.all([loadState(), fetchWhaleData()]);

    // 3. Update peak equity
    if (state.equity > (state.peakEquity || PAPER_START)) state.peakEquity = state.equity;

    // 4. Import strategy engine
    const { runAllStrategies, aggregateSignals, strategyContext } = await import('../src/strategies/strategies.js');
    const { computeRiskParams } = await import('../src/data/backtest.js');

    // 5. Inject whale sentiment (directional only, not price levels)
    if (whaleData?.active) {
      strategyContext.whaleSentiment = whaleData.sentiment;
      strategyContext.correlatedAssets = strategyContext.correlatedAssets || {};
      if (whaleData.sentiment === 'bullish') {
        strategyContext.correlatedAssets['GLD_FLOW'] = { trend: 'down', value: 0 };
      } else if (whaleData.sentiment === 'bearish') {
        strategyContext.correlatedAssets['GLD_FLOW'] = { trend: 'up', value: 0 };
      }
    }

    let stateChanged = false;

    // 6. Monitor open trade
    if (state.openTrade) {
      const t         = state.openTrade;
      const isBuy     = t.direction === 'BUY';
      const dollarRisk = state.equity * (PAPER_RISK_PCT / 100);
      let closeResult = null;

      if (isBuy) {
        // TP1 hit → close trade in profit
        if (lastClose >= t.tp1 && !t.hitTp1) {
          t.hitTp1 = true; closeResult = 'TP1';
          await sendTG(
            `🎯 <b>TARGET HIT! ✔️</b>\n\n<b>Asset:</b> XAU/USD\n<b>Direction:</b> BUY\n` +
            `<b>Entry:</b> ${t.entry}\n<b>TP1:</b> ${t.tp1}\n<b>Gained:</b> +${(lastClose - t.entry).toFixed(1)} pts\n\n💰 Trade closed in profit.`
          );
        }
        // SL hit
        if (!closeResult && lastClose <= t.sl) {
          closeResult = 'SL';
          await sendTG(
            `❌ <b>SL HIT</b>\nWe move on to the next setup.\n\n<b>Asset:</b> XAU/USD\n` +
            `<b>Entry:</b> ${t.entry}\n<b>SL:</b> ${t.sl}\n<b>Lost:</b> -${(t.entry - lastClose).toFixed(1)} pts`
          );
        }
      } else { // SELL
        // TP1 hit → close trade in profit
        if (lastClose <= t.tp1 && !t.hitTp1) {
          t.hitTp1 = true; closeResult = 'TP1';
          await sendTG(
            `🎯 <b>TARGET HIT! ✔️</b>\n\n<b>Asset:</b> XAU/USD\n<b>Direction:</b> SELL\n` +
            `<b>Entry:</b> ${t.entry}\n<b>TP1:</b> ${t.tp1}\n<b>Gained:</b> +${(t.entry - lastClose).toFixed(1)} pts\n\n💰 Trade closed in profit.`
          );
        }
        // SL hit
        if (!closeResult && lastClose >= t.sl) {
          closeResult = 'SL';
          await sendTG(
            `❌ <b>SL HIT</b>\nWe move on to the next setup.\n\n<b>Asset:</b> XAU/USD\n` +
            `<b>Entry:</b> ${t.entry}\n<b>SL:</b> ${t.sl}\n<b>Lost:</b> -${(lastClose - t.entry).toFixed(1)} pts`
          );
        }
      }

      if (closeResult) {
        const pnl = closeResult === 'SL'
          ? -dollarRisk
          : +(dollarRisk * 2.0).toFixed(2);  // 1:2 R:R on TP1
        const rawPips = isBuy
          ? (lastClose - t.entry)
          : (t.entry - lastClose);

        state.equity = +(state.equity + pnl).toFixed(2);
        state.trades.push({
          ...t, closeTime: new Date().toISOString(), closePrice: lastClose,
          result: closeResult, pnl, pips: +rawPips.toFixed(1), equity: state.equity
        });
        state.openTrade     = null;
        state.lastSignalTime = null;
        stateChanged = true;
      } else if (stateChanged) {
        state.openTrade = t;
      }
    }

    // 7. Look for new signal (only if no open trade)
    let skipReason = null;
    if (!state.openTrade) {

      // GATE 1: Weekend market closure
      if (!isInTradingSession()) {
        skipReason = 'Forex market closed (weekend)';

      // GATE 2: Drawdown protection
      } else if (isInDrawdown(state)) {
        const peak = state.peakEquity || PAPER_START;
        const dd   = (((peak - state.equity) / peak) * 100).toFixed(1);
        skipReason = `Drawdown protection active (${dd}% from peak $${peak})`;

      // GATE 3: 4-hour cooldown
      } else {
        const COOLDOWN_MS = 4 * 60 * 60 * 1000;
        const lastTime    = state.lastSignalTime ? new Date(state.lastSignalTime).getTime() : 0;
        const inCooldown  = Date.now() - lastTime < COOLDOWN_MS;

        if (inCooldown) {
          const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastTime)) / 60000);
          skipReason = `Cooldown active — ${remaining}min remaining`;
        } else {
          const allResults = runAllStrategies(candles);
          const agg        = aggregateSignals(allResults, state.lastSignal);

          if (agg.thresholdMet && agg.finalSignal !== 'NO TRADE') {
            const risk = computeRiskParams(candles, agg.finalSignal, agg.finalConfidence, '15min');

            if (!risk.meetsMinRR) {
              skipReason = `R:R too low (${risk.riskReward}x) — skipping`;
            } else {
              state.openTrade = {
                id: Date.now(), pair: 'XAU/USD', direction: agg.finalSignal,
                confidence: agg.finalConfidence, openTime: new Date().toISOString(),
                entry: risk.entry, sl: risk.stopLoss, tp1: risk.takeProfit1,
                riskReward: risk.riskReward, originalSl: risk.stopLoss,
                breakevenMoved: false, hitTp1: false,
              };
              state.lastSignal     = agg.finalSignal;
              state.lastSignalTime = new Date().toISOString();
              stateChanged = true;

              await sendTG(
                `🚨 <b>${agg.finalSignal} XAU/USD</b>\n` +
                `⚠️ <b>${agg.riskLevel}</b> | Confidence: ${agg.finalConfidence}% | R:R ${risk.riskReward}x\n\n` +
                `🟢 Entry:  ${risk.entry}\n` +
                `🎯 TP1:    ${risk.takeProfit1}\n` +
                `🛑 SL:     ${risk.stopLoss}\n` +
                `📏 SL: ${risk.slPoints}pts | TP: ${risk.tp1Points}pts`
              );
            }
          } else {
            skipReason = agg.vetoReason || `${agg.finalConfidence}% consensus — below threshold`;
          }
        }
      }
    }

    // 8. Save state if changed
    if (stateChanged) await saveState(state);

    return res.status(200).json({
      ok: true, ms: Date.now() - t0, price: lastClose,
      equity: state.equity,
      open: state.openTrade ? `${state.openTrade.direction} @ ${state.openTrade.entry}` : null,
      trades: state.trades.length,
      skipReason,
      session: isInTradingSession(),
      drawdownActive: isInDrawdown(state),
      whaleSentiment: whaleData?.sentiment || 'unavailable',
    });

  } catch (err) {
    console.error('[TICK]', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Trading Bot Tick — Vercel Serverless
 * Triggered every minute by external cron (cron-job.org) or Vercel cron.
 * State persists via jsonblob.com (free, no auth).
 * Monitors XAU/USD (Gold) only.
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

// ─── State ───────────────────────────────────────────────────────────────────
async function loadState() {
  try {
    const r = await fetch(STATE_URL, { headers: { 'Accept': 'application/json' } });
    if (r.ok) return await r.json();
  } catch (e) { console.log('[STATE] Load error:', e.message); }
  return { equity: PAPER_START, trades: [], openTrade: null, lastSignal: null, lastSignalTime: null };
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

// ─── Whale Data ──────────────────────────────────────────────────────────────
async function fetchWhaleData() {
  try {
    const r = await fetch(`https://api.unusualwhales.com/api/option-trades/flow-alerts?ticker_symbol=GLD&limit=100`, {
      headers: { 'Authorization': `Bearer ${UW_API_KEY}`, 'UW-CLIENT-API-ID': '100001', 'Accept': 'application/json' }
    });
    if (!r.ok) return null;
    const data = await r.json();
    let calls = [], puts = [];
    (data.data || []).forEach(t => {
      const strike = parseFloat(t.strike);
      const prem = parseFloat(t.total_premium || 0);
      if (t.option_type === 'C' || t.type === 'call') calls.push({ strike, premium: prem });
      else if (t.option_type === 'P' || t.type === 'put') puts.push({ strike, premium: prem });
    });
    calls.sort((a, b) => b.premium - a.premium);
    puts.sort((a, b) => b.premium - a.premium);
    return { resistance: calls.slice(0, 5).map(c => c.strike), support: puts.slice(0, 5).map(p => p.strike), active: true };
  } catch (e) { return null; }
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

    // 2. Load state + whale data in parallel
    const [state, whaleData] = await Promise.all([loadState(), fetchWhaleData()]);

    // 3. Import strategy engine
    const { runAllStrategies, aggregateSignals } = await import('../src/strategies/strategies.js');
    const { computeRiskParams } = await import('../src/data/backtest.js');
    const { whaleLevels } = await import('../src/data/whales.js');

    if (whaleData) {
      whaleLevels.resistance = whaleData.resistance;
      whaleLevels.support = whaleData.support;
      whaleLevels.active = true;
    }

    // 4. Monitor open trade
    let stateChanged = false;
    if (state.openTrade) {
      const t = state.openTrade;
      const isBuy = t.direction === 'BUY';
      const dollarRisk = state.equity * (PAPER_RISK_PCT / 100);
      let closeResult = null;

      if (isBuy) {
        if (lastClose >= t.tp1 && !t.hitTp1) {
          t.hitTp1 = true; stateChanged = true;
          await sendTG(`🟢 <b>TP1 HIT!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Price:</b> ${lastClose}\n<b>TP1:</b> ${t.tp1}\n<b>Entry:</b> ${t.entry}\n<b>Pips:</b> +${((lastClose - t.entry) * 10).toFixed(1)}`);
        }
        if (lastClose >= t.tp2 && !t.hitTp2 && t.hitTp1) {
          t.hitTp2 = true; closeResult = 'TP2';
          await sendTG(`🚀 <b>TP2 CRUSHED!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Price:</b> ${lastClose}\n<b>TP2:</b> ${t.tp2}\n<b>Entry:</b> ${t.entry}\n<b>Pips:</b> +${((lastClose - t.entry) * 10).toFixed(1)}`);
        }
        if (lastClose <= t.sl) {
          closeResult = t.hitTp1 ? 'TP1_Secured' : 'SL';
          if (t.hitTp1) await sendTG(`⚠️ <b>Stopped after TP1</b>\nProfit secured.\n<b>Asset:</b> XAU/USD`);
          else await sendTG(`❌ <b>SL HIT</b>\n\n<b>Asset:</b> XAU/USD\n<b>Entry:</b> ${t.entry}\n<b>SL:</b> ${t.sl}\n<b>Pips:</b> ${((lastClose - t.entry) * 10).toFixed(1)}`);
        }
      } else { // SELL
        if (lastClose <= t.tp1 && !t.hitTp1) {
          t.hitTp1 = true; stateChanged = true;
          await sendTG(`🟢 <b>TP1 HIT!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Price:</b> ${lastClose}\n<b>TP1:</b> ${t.tp1}\n<b>Entry:</b> ${t.entry}\n<b>Pips:</b> +${((t.entry - lastClose) * 10).toFixed(1)}`);
        }
        if (lastClose <= t.tp2 && !t.hitTp2 && t.hitTp1) {
          t.hitTp2 = true; closeResult = 'TP2';
          await sendTG(`🚀 <b>TP2 CRUSHED!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Price:</b> ${lastClose}\n<b>TP2:</b> ${t.tp2}\n<b>Entry:</b> ${t.entry}\n<b>Pips:</b> +${((t.entry - lastClose) * 10).toFixed(1)}`);
        }
        if (lastClose >= t.sl) {
          closeResult = t.hitTp1 ? 'TP1_Secured' : 'SL';
          if (t.hitTp1) await sendTG(`⚠️ <b>Stopped after TP1</b>\nProfit secured.\n<b>Asset:</b> XAU/USD`);
          else await sendTG(`❌ <b>SL HIT</b>\n\n<b>Asset:</b> XAU/USD\n<b>Entry:</b> ${t.entry}\n<b>SL:</b> ${t.sl}\n<b>Pips:</b> ${((t.entry - lastClose) * 10).toFixed(1)}`);
        }
      }

      if (closeResult) {
        let pnl = 0;
        if (closeResult === 'SL') pnl = -dollarRisk;
        else if (closeResult === 'TP1_Secured') pnl = +(dollarRisk * 1.5).toFixed(2);
        else if (closeResult === 'TP2') pnl = +(dollarRisk * 2.5).toFixed(2);

        const pipScale = t.entry > 1000 ? 10 : 10000;
        const rawPips = isBuy ? (lastClose - t.entry) * pipScale : (t.entry - lastClose) * pipScale;

        state.equity = +(state.equity + pnl).toFixed(2);
        state.trades.push({
          ...t, closeTime: new Date().toISOString(), closePrice: lastClose,
          result: closeResult, pnl, pips: +rawPips.toFixed(1), equity: state.equity
        });
        state.openTrade = null;
        state.lastSignalTime = null; // Reset cooldown after trade closes
        stateChanged = true;
      } else if (stateChanged) {
        state.openTrade = t;
      }
    }

    // 5. Look for new signal (only if no open trade)
    if (!state.openTrade) {
      // COOLDOWN: prevent duplicate signals within 5 minutes
      const COOLDOWN_MS = 5 * 60 * 1000;
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
          };
          state.lastSignal = agg.finalSignal;
          state.lastSignalTime = new Date().toISOString();
          stateChanged = true;

          await sendTG(
            `🚨 <b>${agg.finalSignal} XAU/USD</b>\n` +
            `⚠️ <b>${agg.riskLevel}</b>\n\n` +
            `Entry price: ${risk.entry}\n` +
            `TP1: ${risk.takeProfit1}\n` +
            `TP2: ${risk.takeProfit2}\n` +
            `SL: ${risk.stopLoss}`
          );
        }
      }
    }

    // 6. Save state only if changed
    if (stateChanged) await saveState(state);

    return res.status(200).json({
      ok: true, ms: Date.now() - t0, price: lastClose, equity: state.equity,
      open: state.openTrade ? `${state.openTrade.direction} @ ${state.openTrade.entry}` : null,
      trades: state.trades.length
    });
  } catch (err) {
    console.error('[TICK]', err);
    return res.status(500).json({ error: err.message });
  }
}

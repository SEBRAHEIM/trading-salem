/**
 * Trading Bot Tick — Vercel Serverless
 * Triggered every minute by external cron (cron-job.org) or Vercel cron.
 * State persists via jsonblob.com (free, no auth).
 * Monitors BOTH XAU/USD (Gold) and XTIUSD (Oil).
 */
const TELEGRAM_BOT_TOKEN = '8643381958:AAGUT_9Q_lSj_29Y2lfPRJNzG9TzlmhqReM';
const TELEGRAM_TARGETS = [
  '6732836566',          // Personal DM
  '-1003752467954'       // Group: @chatbotsallem
];
const UW_API_KEY = "d9dc6e61-6157-4070-af00-2f868fd5dc27";
const PAPER_START = 150;
const PAPER_RISK_PCT = 1.0;
const STATE_URL = 'https://jsonblob.com/api/jsonBlob/019d91f2-8310-70ef-ac09-0414cd963daf';

const PAIRS = ['XAU/USD', 'XTIUSD'];
const WHALE_TICKERS = { 'XAU/USD': 'GLD', 'XTIUSD': 'USO' };

// ─── State ───────────────────────────────────────────────────────────────────
async function loadState() {
  try {
    const r = await fetch(STATE_URL, { headers: { 'Accept': 'application/json' } });
    if (r.ok) {
      const raw = await r.json();
      // Migrate old single-pair format → multi-pair
      if (!raw.pairs) {
        return {
          equity: raw.equity ?? PAPER_START,
          trades: raw.trades ?? [],
          pairs: {
            'XAU/USD': { openTrade: raw.openTrade || null, lastSignal: raw.lastSignal || null },
            'XTIUSD': { openTrade: null, lastSignal: null }
          }
        };
      }
      // Ensure all pairs exist
      for (const p of PAIRS) {
        if (!raw.pairs[p]) raw.pairs[p] = { openTrade: null, lastSignal: null };
      }
      return raw;
    }
  } catch (e) { console.log('[STATE] Load error:', e.message); }
  return {
    equity: PAPER_START, trades: [],
    pairs: {
      'XAU/USD': { openTrade: null, lastSignal: null },
      'XTIUSD': { openTrade: null, lastSignal: null }
    }
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

// ─── Whale Data ──────────────────────────────────────────────────────────────
async function fetchWhaleData(ticker) {
  try {
    const r = await fetch(`https://api.unusualwhales.com/api/option-trades/flow-alerts?ticker_symbol=${ticker}&limit=100`, {
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

// ─── Process a single pair ───────────────────────────────────────────────────
async function processPair(pair, candles, state, whaleData) {
  const { runAllStrategies, aggregateSignals } = await import('../src/strategies/strategies.js');
  const { computeRiskParams } = await import('../src/data/backtest.js');
  const { whaleLevels } = await import('../src/data/whales.js');

  // Set whale data for this pair
  if (whaleData) {
    whaleLevels.resistance = whaleData.resistance;
    whaleLevels.support = whaleData.support;
    whaleLevels.active = true;
  } else {
    whaleLevels.active = false;
  }

  const lastClose = candles[candles.length - 1].close;
  const pairState = state.pairs[pair];
  let stateChanged = false;

  // ── Monitor open trade ──
  if (pairState.openTrade) {
    const t = pairState.openTrade;
    const isBuy = t.direction === 'BUY';
    const dollarRisk = state.equity * (PAPER_RISK_PCT / 100);
    let closeResult = null;

    if (isBuy) {
      if (lastClose >= t.tp1 && !t.hitTp1) {
        t.hitTp1 = true; stateChanged = true;
        await sendTG(`🟢 <b>TP1 HIT!</b>\n\n<b>Asset:</b> ${pair}\n<b>Price:</b> ${lastClose}\n<b>TP1:</b> ${t.tp1}\n<b>Entry:</b> ${t.entry}\n<b>Pips:</b> +${((lastClose - t.entry) * 10).toFixed(1)}`);
      }
      if (lastClose >= t.tp2 && !t.hitTp2 && t.hitTp1) {
        t.hitTp2 = true; closeResult = 'TP2';
        await sendTG(`🚀 <b>TP2 CRUSHED!</b>\n\n<b>Asset:</b> ${pair}\n<b>Price:</b> ${lastClose}\n<b>TP2:</b> ${t.tp2}\n<b>Entry:</b> ${t.entry}\n<b>Pips:</b> +${((lastClose - t.entry) * 10).toFixed(1)}`);
      }
      if (lastClose <= t.sl) {
        closeResult = t.hitTp1 ? 'TP1_Secured' : 'SL';
        if (t.hitTp1) await sendTG(`⚠️ <b>Stopped after TP1</b>\nProfit secured.\n<b>Asset:</b> ${pair}`);
        else await sendTG(`❌ <b>SL HIT</b>\n\n<b>Asset:</b> ${pair}\n<b>Entry:</b> ${t.entry}\n<b>SL:</b> ${t.sl}\n<b>Pips:</b> ${((lastClose - t.entry) * 10).toFixed(1)}`);
      }
    } else { // SELL
      if (lastClose <= t.tp1 && !t.hitTp1) {
        t.hitTp1 = true; stateChanged = true;
        await sendTG(`🟢 <b>TP1 HIT!</b>\n\n<b>Asset:</b> ${pair}\n<b>Price:</b> ${lastClose}\n<b>TP1:</b> ${t.tp1}\n<b>Entry:</b> ${t.entry}\n<b>Pips:</b> +${((t.entry - lastClose) * 10).toFixed(1)}`);
      }
      if (lastClose <= t.tp2 && !t.hitTp2 && t.hitTp1) {
        t.hitTp2 = true; closeResult = 'TP2';
        await sendTG(`🚀 <b>TP2 CRUSHED!</b>\n\n<b>Asset:</b> ${pair}\n<b>Price:</b> ${lastClose}\n<b>TP2:</b> ${t.tp2}\n<b>Entry:</b> ${t.entry}\n<b>Pips:</b> +${((t.entry - lastClose) * 10).toFixed(1)}`);
      }
      if (lastClose >= t.sl) {
        closeResult = t.hitTp1 ? 'TP1_Secured' : 'SL';
        if (t.hitTp1) await sendTG(`⚠️ <b>Stopped after TP1</b>\nProfit secured.\n<b>Asset:</b> ${pair}`);
        else await sendTG(`❌ <b>SL HIT</b>\n\n<b>Asset:</b> ${pair}\n<b>Entry:</b> ${t.entry}\n<b>SL:</b> ${t.sl}\n<b>Pips:</b> ${((t.entry - lastClose) * 10).toFixed(1)}`);
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
      pairState.openTrade = null;
      stateChanged = true;
    } else if (stateChanged) {
      pairState.openTrade = t;
    }
  }

  // ── Look for new signal ──
  if (!pairState.openTrade) {
    // COOLDOWN: Skip if we sent a signal for this pair within the last 5 minutes
    const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
    const lastTime = pairState.lastSignalTime ? new Date(pairState.lastSignalTime).getTime() : 0;
    if (Date.now() - lastTime < COOLDOWN_MS) {
      return { stateChanged, lastClose }; // Still in cooldown, skip
    }

    const allResults = runAllStrategies(candles);
    const agg = aggregateSignals(allResults, pairState.lastSignal);

    if (agg.thresholdMet && agg.finalSignal !== 'NO TRADE') {
      const risk = computeRiskParams(candles, agg.finalSignal, agg.finalConfidence, '15min');
      pairState.openTrade = {
        id: Date.now(), pair, direction: agg.finalSignal,
        confidence: agg.finalConfidence, openTime: new Date().toISOString(),
        entry: risk.entry, sl: risk.stopLoss, tp1: risk.takeProfit1,
        tp2: risk.takeProfit2, riskReward: risk.riskReward,
      };
      pairState.lastSignal = agg.finalSignal;
      pairState.lastSignalTime = new Date().toISOString(); // Track when signal was sent
      stateChanged = true;

      await sendTG(
        `🚨 <b>${agg.finalSignal} ${pair}</b>\n` +
        `⚠️ <b>${agg.riskLevel}</b>\n\n` +
        `Entry price: ${risk.entry}\n` +
        `TP1: ${risk.takeProfit1}\n` +
        `TP2: ${risk.takeProfit2}\n` +
        `SL: ${risk.stopLoss}`
      );
    }
  }

  return { stateChanged, lastClose };
}

// ─── Main Handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const t0 = Date.now();

  try {
    const host = req.headers.host;
    const proto = host.includes('localhost') ? 'http' : 'https';

    // 1. Fetch candles for ALL pairs in parallel
    const candleResults = await Promise.allSettled(
      PAIRS.map(pair =>
        fetch(`${proto}://${host}/api/candles?pair=${encodeURIComponent(pair)}&interval=15min`, {
          signal: AbortSignal.timeout(15000)
        }).then(r => r.ok ? r.json() : null)
      )
    );

    // 2. Load state + whale data in parallel
    const [state, ...whaleResults] = await Promise.all([
      loadState(),
      ...PAIRS.map(pair => fetchWhaleData(WHALE_TICKERS[pair] || 'GLD'))
    ]);

    // 3. Process each pair
    const results = {};
    let anyChanged = false;

    for (let i = 0; i < PAIRS.length; i++) {
      const pair = PAIRS[i];
      const candleResult = candleResults[i];

      if (candleResult.status !== 'fulfilled' || !candleResult.value?.candles) {
        results[pair] = { ok: false, reason: 'candles unavailable' };
        continue;
      }

      const candles = candleResult.value.candles;
      if (candles.length < 50) {
        results[pair] = { ok: false, reason: 'insufficient candles' };
        continue;
      }

      const { stateChanged, lastClose } = await processPair(pair, candles, state, whaleResults[i]);
      if (stateChanged) anyChanged = true;

      results[pair] = {
        ok: true, price: lastClose,
        open: state.pairs[pair].openTrade
          ? `${state.pairs[pair].openTrade.direction} @ ${state.pairs[pair].openTrade.entry}`
          : null
      };
    }

    // 4. Save state only if changed
    if (anyChanged) await saveState(state);

    return res.status(200).json({
      ok: true, ms: Date.now() - t0,
      equity: state.equity,
      trades: state.trades.length,
      pairs: results
    });
  } catch (err) {
    console.error('[TICK]', err);
    return res.status(500).json({ error: err.message });
  }
}

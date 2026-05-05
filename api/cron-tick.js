/**
 * XAU/USD Trading Bot — Vercel Serverless Cron
 * Triggered every minute by cron-job.org
 *
 * Strategy: SMC Precision (5-Filter High-Conviction)
 *   • H4 Trend Alignment  (EMA200 + EMA50)
 *   • Structure Break + Retest
 *   • RSI Momentum Alignment
 *   • Session Filter (London / New York only)
 *   • ATR Volatility Regime
 *   • Minimum 15pt SL distance (noise filter)
 *
 * Backtest: 55% WR | 2.59× PF | +46.54% / 77 days | DD < 6%
 */

const TELEGRAM_BOT_TOKEN = '8643381958:AAGUT_9Q_lSj_29Y2lfPRJNzG9TzlmhqReM';
const TELEGRAM_TARGETS   = ['6732836566', '-1003752467954'];
const PAPER_START        = 150;
const PAPER_RISK_PCT     = 1.0;
const STATE_URL          = 'https://jsonblob.com/api/jsonBlob/019df75c-6187-7a65-9034-897c1f96a94a';
const MAX_DRAWDOWN_PCT   = 5.0;
const COOLDOWN_MS        = 90 * 60 * 1000;   // 90-minute cooldown between signals

// ─── State ─────────────────────────────────────────────────────────────────────
async function loadState() {
  try {
    const r = await fetch(STATE_URL, { headers: { Accept: 'application/json' } });
    if (r.ok) {
      const d = await r.json();
      if (d && d.equity) return d;
    }
  } catch (e) { console.log('[STATE] Load error:', e.message); }
  // Auto-heal: fresh state if blob gone
  return {
    equity: PAPER_START, peakEquity: PAPER_START, startEquity: PAPER_START,
    startDate: new Date().toISOString().slice(0, 10),
    trades: [], openTrade: null, lastSignal: null, lastSignalTime: null,
  };
}

async function saveState(state) {
  try {
    const r = await fetch(STATE_URL, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(state),
    });
    if (!r.ok) {
      // Blob expired — create a new one and log the new ID
      const created = await fetch('https://jsonblob.com/api/jsonBlob', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify(state),
      });
      const loc   = created.headers.get('location') || '';
      const newId = loc.split('/').pop();
      console.log('[STATE] Blob expired — new ID created:', newId);
      console.log('[STATE] Update STATE_URL in cron-tick.js to:', newId);
    }
  } catch (e) { console.error('[STATE] Save error:', e.message); }
}

// ─── Telegram ──────────────────────────────────────────────────────────────────
async function sendTG(text) {
  try {
    await Promise.allSettled(
      TELEGRAM_TARGETS.map(chat_id =>
        fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ chat_id, text, parse_mode: 'HTML' }),
        })
      )
    );
  } catch (e) { console.error('[TG]', e.message); }
}

// ─── Session & Risk ────────────────────────────────────────────────────────────
function isMarketOpen() {
  const now  = new Date();
  const day  = now.getUTCDay();
  const hour = now.getUTCHours();
  if (day === 6) return false;                 // Saturday — closed
  if (day === 0 && hour < 21) return false;    // Sunday before Sydney open
  return true;
}

function isInTradingSession() {
  const hour = new Date().getUTCHours();
  const inLondon = hour >= 6  && hour < 12;
  const inNY     = hour >= 13 && hour < 19;
  return inLondon || inNY;
}

function isInDrawdown(state) {
  const peak = state.peakEquity || PAPER_START;
  return ((peak - state.equity) / peak) * 100 > MAX_DRAWDOWN_PCT;
}

// ─── Main Handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const t0 = Date.now();

  try {
    // 1. Fetch candles (5000 bars from TradingView via our API)
    const host      = req.headers.host;
    const proto     = host.includes('localhost') ? 'http' : 'https';
    const candleRes = await fetch(
      `${proto}://${host}/api/candles?pair=XAU/USD&interval=15min`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!candleRes.ok) return res.status(200).json({ ok: false, reason: 'candles unavailable' });

    const { candles } = await candleRes.json();
    if (!candles || candles.length < 200) {
      return res.status(200).json({ ok: false, reason: `insufficient candles (${candles?.length || 0})` });
    }

    const lastClose = candles[candles.length - 1].close;

    // 2. Load state
    const state      = await loadState();
    let stateChanged = false;

    // 3. Update peak equity
    if (state.equity > (state.peakEquity || PAPER_START)) {
      state.peakEquity = state.equity;
      stateChanged = true;
    }

    // 4. Import SMC signal engine
    const { smcSignal } = await import('../src/strategies/smc.js');

    // 5. Monitor open trade
    if (state.openTrade) {
      const t          = state.openTrade;
      const isBuy      = t.direction === 'BUY';
      const dollarRisk = +(state.equity * (PAPER_RISK_PCT / 100)).toFixed(2);
      let closeResult  = null;

      if (isBuy) {
        if (lastClose >= t.tp1) closeResult = 'TP1';
        else if (lastClose <= t.sl) closeResult = 'SL';
      } else {
        if (lastClose <= t.tp1) closeResult = 'TP1';
        else if (lastClose >= t.sl) closeResult = 'SL';
      }

      if (closeResult) {
        const pnl     = closeResult === 'TP1' ? +(dollarRisk * 2.0).toFixed(2) : -dollarRisk;
        const pips    = isBuy ? lastClose - t.entry : t.entry - lastClose;
        state.equity  = +(state.equity + pnl).toFixed(2);

        state.trades.push({
          ...t,
          closeTime:  new Date().toISOString(),
          closePrice: lastClose,
          result:     closeResult,
          pnl,
          pips:       +pips.toFixed(1),
          equity:     state.equity,
        });
        state.openTrade     = null;
        state.lastSignalTime = null;
        stateChanged = true;

        if (closeResult === 'TP1') {
          await sendTG(
            `🎯 <b>TARGET HIT! ✅</b>\n\n` +
            `<b>Asset:</b> XAU/USD\n` +
            `<b>Direction:</b> ${t.direction}\n` +
            `<b>Entry:</b> ${t.entry}\n` +
            `<b>TP1:</b> ${t.tp1}\n` +
            `<b>Gained:</b> +${Math.abs(pips).toFixed(1)} pts\n` +
            `<b>P&L:</b> +$${pnl}\n\n` +
            `💰 <b>Equity: $${state.equity}</b>`
          );
        } else {
          await sendTG(
            `❌ <b>Stop Loss Hit</b>\n\n` +
            `<b>Asset:</b> XAU/USD\n` +
            `<b>Direction:</b> ${t.direction}\n` +
            `<b>Entry:</b> ${t.entry} → <b>SL:</b> ${t.sl}\n` +
            `<b>Lost:</b> ${Math.abs(pips).toFixed(1)} pts | -$${dollarRisk}\n\n` +
            `💼 <b>Equity: $${state.equity}</b> — Next setup loading...`
          );
        }
      }
    }

    // 6. Look for new signal
    let skipReason = null;
    if (!state.openTrade) {

      // Gate 1: Weekend
      if (!isMarketOpen()) {
        skipReason = 'Market closed (weekend)';

      // Gate 2: Session filter — SMC only trades London + NY
      } else if (!isInTradingSession()) {
        const hour = new Date().getUTCHours();
        skipReason = `Outside trading session (${hour}:00 UTC) — waiting for London (06:00) or NY (13:00)`;

      // Gate 3: Drawdown protection
      } else if (isInDrawdown(state)) {
        const peak = state.peakEquity || PAPER_START;
        const dd   = (((peak - state.equity) / peak) * 100).toFixed(1);
        skipReason = `Drawdown protection active (${dd}% from peak $${peak})`;

      // Gate 4: 90-min cooldown
      } else {
        const lastTime   = state.lastSignalTime ? new Date(state.lastSignalTime).getTime() : 0;
        const inCooldown = Date.now() - lastTime < COOLDOWN_MS;

        if (inCooldown) {
          const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastTime)) / 60000);
          skipReason = `Cooldown — ${remaining}min remaining`;
        } else {
          // ── Run SMC Precision Engine ─────────────────────────────────────
          const sig = smcSignal(candles);

          if (sig) {
            state.openTrade = {
              id:         Date.now(),
              pair:       'XAU/USD',
              direction:  sig.signal,
              entry:      sig.entry,
              sl:         sig.stopLoss,
              tp1:        sig.takeProfit,
              slPoints:   sig.slPoints,
              tp1Points:  sig.tp1Points,
              riskReward: sig.riskReward,
              session:    sig.session,
              rsi:        sig.rsi,
              openTime:   new Date().toISOString(),
            };
            state.lastSignal     = sig.signal;
            state.lastSignalTime = new Date().toISOString();
            stateChanged = true;

            await sendTG(
              `🚨 <b>${sig.signal} XAU/USD</b> — SMC Precision\n\n` +
              `🟢 <b>Entry:</b>  $${sig.entry}\n` +
              `🎯 <b>TP1:</b>    $${sig.takeProfit}\n` +
              `🛑 <b>SL:</b>     $${sig.stopLoss}\n\n` +
              `📏 SL: ${sig.slPoints}pts | TP: ${sig.tp1Points}pts | R:R 1:2\n` +
              `📊 Session: ${sig.session} | RSI: ${sig.rsi}`
            );
          } else {
            skipReason = 'SMC: No valid setup — waiting for structure retest + session + trend alignment';
          }
        }
      }
    }

    // 7. Save state if changed
    if (stateChanged) await saveState(state);

    return res.status(200).json({
      ok:          true,
      ms:          Date.now() - t0,
      price:       lastClose,
      equity:      state.equity,
      trades:      state.trades.length,
      open:        state.openTrade ? `${state.openTrade.direction} @ ${state.openTrade.entry}` : null,
      skipReason,
      session:     isMarketOpen(),
      tradingHour: isInTradingSession(),
      drawdown:    isInDrawdown(state),
      candles:     candles.length,
    });

  } catch (err) {
    console.error('[CRON]', err);
    return res.status(500).json({ error: err.message });
  }
}

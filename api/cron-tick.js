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
 *
 * State: Stored permanently in GitHub Gist (never expires)
 *   Env vars required: GITHUB_TOKEN, STATE_GIST_ID
 */

import { loadState, saveState } from './stateStore.js';

const TELEGRAM_BOT_TOKEN = '8643381958:AAGUT_9Q_lSj_29Y2lfPRJNzG9TzlmhqReM';
const TELEGRAM_TARGETS   = ['6732836566', '765993766']; // DM + @Eem09
const PAPER_START        = 150;
const PAPER_RISK_PCT     = 1.0;
const MAX_DRAWDOWN_PCT   = 35.0;
const COOLDOWN_MS        = 90 * 60 * 1000;   // 90-minute cooldown between signals

// ─── Telegram ──────────────────────────────────────────────────────────────────
async function sendTG(text) {
  const results = await Promise.allSettled(
    TELEGRAM_TARGETS.map(async (chat_id) => {
      const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chat_id, text, parse_mode: 'HTML' }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        console.error(`[TG] Failed for chat_id=${chat_id}: ${r.status} — ${body?.description || 'unknown error'}`);
      }
      return r;
    })
  );
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) console.error(`[TG] ${failed}/${results.length} sends failed`);
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
      const t     = state.openTrade;
      const isBuy = t.direction === 'BUY';
      let closeResult = null;

      if (isBuy) {
        if (lastClose >= t.tp1) closeResult = 'TP1';
        else if (lastClose <= t.sl) closeResult = 'SL';
      } else {
        if (lastClose <= t.tp1) closeResult = 'TP1';
        else if (lastClose >= t.sl) closeResult = 'SL';
      }

      if (closeResult) {
        // P&L = actual price movement (1 point = $1)
        const closePrice = closeResult === 'TP1' ? t.tp1 : t.sl;
        const pips       = isBuy ? closePrice - t.entry : t.entry - closePrice;
        const pnl        = +pips.toFixed(2);
        state.equity     = +(state.equity + pnl).toFixed(2);
        if (state.equity > (state.peakEquity || PAPER_START)) state.peakEquity = state.equity;

        state.trades.push({
          ...t,
          closeTime:  new Date().toISOString(),
          closePrice,
          result:     closeResult,
          pnl,
          pips:       +pips.toFixed(2),
          equity:     state.equity,
        });
        state.openTrade      = null;
        state.lastSignalTime = null;
        stateChanged = true;

        if (closeResult === 'TP1') {
          await sendTG(
            `🎯 <b>TARGET HIT! ✅</b>\n\n` +
            `<b>Asset:</b> XAU/USD\n` +
            `<b>Direction:</b> ${t.direction}\n` +
            `<b>Entry:</b> ${t.entry} → <b>TP:</b> ${closePrice}\n` +
            `<b>Profit:</b> +${pips.toFixed(2)} pts = <b>+$${pnl}</b>\n\n` +
            `💰 <b>Balance: $${state.equity}</b>`
          );
        } else {
          await sendTG(
            `❌ <b>Stop Loss Hit</b>\n\n` +
            `<b>Asset:</b> XAU/USD\n` +
            `<b>Direction:</b> ${t.direction}\n` +
            `<b>Entry:</b> ${t.entry} → <b>SL:</b> ${closePrice}\n` +
            `<b>Loss:</b> ${Math.abs(pips).toFixed(2)} pts = <b>-$${Math.abs(pnl)}</b>\n\n` +
            `💼 <b>Balance: $${state.equity}</b> — Next setup loading...`
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

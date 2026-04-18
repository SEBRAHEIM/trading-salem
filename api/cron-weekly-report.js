/**
 * Weekly Performance Report — Vercel Cron
 * Fires every Friday at 10:00 PM UTC (after Forex market close)
 *
 * Sends a comprehensive Telegram report to BOTH personal DM and group:
 * - Every trade listed individually (entry, exit, result, pips)
 * - This week's summary
 * - Monthly running total (profits, losses, SL breakdown)
 * - Whether the week was successful or not
 */

const BOT_TOKEN    = "8643381958:AAGUT_9Q_lSj_29Y2lfPRJNzG9TzlmhqReM";
const TG_TARGETS   = ["6732836566", "-1003752467954"]; // DM + Group @chatbotsallem
const STATE_URL    = 'https://jsonblob.com/api/jsonBlob/019d9ab2-26ea-70d2-bc44-9a788ea20156';
const PAPER_START  = 150;

// ─── Send to ALL targets ──────────────────────────────────────────────────────
async function sendTG(text) {
  await Promise.allSettled(
    TG_TARGETS.map(chat_id =>
      fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text, parse_mode: 'HTML' })
      })
    )
  );
}

export default async function handler(req, res) {
  try {
    // ── Load trade state from jsonblob ──────────────────────────────────
    let state = null;
    try {
      const r = await fetch(STATE_URL, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (r.ok) state = await r.json();
    } catch (e) {
      console.log("[WEEKLY] Could not load state:", e.message);
    }

    // If no trades at all, send a short notice and exit
    if (!state || !state.trades || state.trades.length === 0) {
      await sendTG(`📊 <b>WEEKLY REPORT</b>\n\n⚠️ No trades recorded this week.\nThe bot is running — waiting for a valid signal above 80% consensus.`);
      return res.status(200).json({ ok: true, fallback: true });
    }

    const equity  = state.equity  ?? PAPER_START;
    const allTrades = state.trades ?? [];
    const now     = new Date();

    // ── Filter this week's trades (last 7 days) ─────────────────────────
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    const weekTrades = allTrades.filter(t => t.closeTime && new Date(t.closeTime) >= weekStart);

    // ── Filter this month's trades ───────────────────────────────────────
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthTrades = allTrades.filter(t => t.closeTime && new Date(t.closeTime) >= monthStart);

    // ── Build per-trade list for the week ───────────────────────────────
    let tradeLines = '';
    if (weekTrades.length === 0) {
      tradeLines = '🔇 No closed trades this week.\n';
    } else {
      weekTrades.forEach((t, i) => {
        const emoji  = t.result === 'SL' ? '❌' : t.result === 'TP2' ? '🚀' : '🟢';
        const dir    = t.direction || '?';
        const entry  = t.entry    ?? '?';
        const close  = t.closePrice ?? '?';
        const pips   = t.pips !== undefined ? `${t.pips >= 0 ? '+' : ''}${t.pips}` : '?';
        const pnl    = t.pnl  !== undefined ? `${t.pnl  >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}` : '?';
        const day    = t.closeTime
          ? new Date(t.closeTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          : '';
        const label = t.result === 'SL' ? '🔴 Stop Loss Hit' : t.result === 'TP2' ? '🟢 Target Hit + Bonus TP2 🎁' : '🟢 Target Hit';
        tradeLines += `${emoji} #${i + 1} <b>${dir}</b> @ ${entry} | ${pips} pips | ${label} — ${day}\n`;
      });
    }

    // ── Week stats (TP1 = win, TP2 = bonus) ────────────────────────────
    const wTP1     = weekTrades.filter(t => t.result === 'TP1_Secured').length;
    const wTP2     = weekTrades.filter(t => t.result === 'TP2').length; // bonus
    const wSL      = weekTrades.filter(t => t.result === 'SL').length;
    const wWins    = wTP1 + wTP2; // both TP1 and TP2 are wins (TP2 includes TP1)
    const wPnl     = weekTrades.reduce((s, t) => s + (t.pnl  || 0), 0);
    const wPips    = weekTrades.reduce((s, t) => s + (t.pips || 0), 0);
    const wTotal   = weekTrades.length;
    const wWinRate = wTotal > 0 ? ((wWins / wTotal) * 100).toFixed(0) : '0';

    // ── Month stats ──────────────────────────────────────────────────────
    const mTP1     = monthTrades.filter(t => t.result === 'TP1_Secured').length;
    const mTP2     = monthTrades.filter(t => t.result === 'TP2').length; // bonus
    const mSL      = monthTrades.filter(t => t.result === 'SL').length;
    const mWins    = mTP1 + mTP2;
    const mPnl     = monthTrades.reduce((s, t) => s + (t.pnl  || 0), 0);
    const mPips    = monthTrades.reduce((s, t) => s + (t.pips || 0), 0);
    const mTotal   = monthTrades.length;
    const mWinRate = mTotal > 0 ? ((mWins / mTotal) * 100).toFixed(0) : '0';
    const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // ── Week verdict ─────────────────────────────────────────────────────
    let verdict = '';
    if (wTotal === 0) {
      verdict = '📭 No trades — market had no valid entry signal this week.';
    } else if (wPnl > 0 && parseInt(wWinRate) >= 60) {
      verdict = `🏆 SUCCESSFUL WEEK! ${wWins}W / ${wSL}L — Engine performing well.`;
    } else if (wPnl >= 0) {
      verdict = `⚖️ BREAK-EVEN WEEK. ${wWins}W / ${wSL}L — Flat performance.`;
    } else {
      verdict = `📉 DIFFICULT WEEK. ${wWins}W / ${wSL}L — Will tighten filters.`;
    }

    // ── SL Analysis ──────────────────────────────────────────────────────
    const slTrades = weekTrades.filter(t => t.result === 'SL');
    let slSection = '';
    if (slTrades.length === 0) {
      slSection = '✅ Zero SL hits this week!\n';
    } else {
      const totalSlLoss = slTrades.reduce((s, t) => s + Math.abs(t.pnl || 0), 0);
      const avgSlPips   = slTrades.reduce((s, t) => s + Math.abs(t.pips || 0), 0) / slTrades.length;
      slSection += `SL hits: ${slTrades.length} | Total loss: -$${totalSlLoss.toFixed(2)} | Avg: ${avgSlPips.toFixed(1)} pips/SL\n`;
      slTrades.forEach(t => {
        const day = t.closeTime
          ? new Date(t.closeTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          : '';
        slSection += `  ❌ ${t.direction} @ ${t.entry} → SL hit @ ${t.closePrice} | ${t.pips} pips | ${day}\n`;
      });
    }

    // ── Equity summary ───────────────────────────────────────────────────
    const eqChange = +(equity - PAPER_START).toFixed(2);
    const eqPct    = ((eqChange / PAPER_START) * 100).toFixed(1);
    const eqEmoji  = eqChange >= 0 ? '📈' : '📉';

    // ── Compose message ──────────────────────────────────────────────────
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const msg = `📊 <b>WEEKLY REPORT — XAU/USD</b>
<b>${dateStr}</b>

━━━ 📋 <b>THIS WEEK'S TRADES (${wTotal})</b> ━━━
${tradeLines}
<b>WEEK SUMMARY:</b>
🟢 Target Hit: ${wWins}${wTP2 > 0 ? ` (+${wTP2} also hit TP2 bonus 🎁)` : ''}
🔴 Stop Loss Hit: ${wSL}
📊 Win Rate: ${wWinRate}%
📍 Total Pips: ${wPips >= 0 ? '+' : ''}${wPips.toFixed(1)}

${verdict}

━━━ 🔍 <b>SL ANALYSIS</b> ━━━
${slSection}
━━━ 📅 <b>${monthName} TOTAL</b> ━━━
Trades: ${mTotal} | 🟢 Target Hit: ${mWins}${mTP2 > 0 ? ` (+${mTP2} TP2 🎁)` : ''} | 🔴 SL: ${mSL}
Win Rate: ${mWinRate}% | Pips: ${mPips >= 0 ? '+' : ''}${mPips.toFixed(1)}



<i>🐳 Whale engine monitoring 24/7. Next report: Friday.</i>`.trim();

    // ── Send (split if >4000 chars) ──────────────────────────────────────
    if (msg.length <= 4000) {
      await sendTG(msg);
    } else {
      const splitIdx = msg.indexOf('━━━ 🔍');
      await sendTG(msg.substring(0, splitIdx).trim());
      await sendTG(msg.substring(splitIdx).trim());
    }

    return res.status(200).json({ ok: true, weekTrades: wTotal, monthTrades: mTotal });
  } catch (err) {
    console.error("[WEEKLY] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}

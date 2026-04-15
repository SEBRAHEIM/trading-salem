/**
 * Weekly Performance Report — Vercel Cron
 * Fires every Friday at 10:00 PM UTC (after Forex market close)
 * 
 * Sends a comprehensive Telegram report:
 * - Every trade listed individually (entry, exit, result, pips)
 * - This week's summary
 * - Monthly running total (profits, losses, SL breakdown)
 * - SL analysis — what went wrong on losing trades
 */
export default async function handler(req, res) {
  const BOT_TOKEN = "8643381958:AAGUT_9Q_lSj_29Y2lfPRJNzG9TzlmhqReM";
  const CHAT_ID = "6732836566";

  try {
    // Load trade state from persistent store (jsonblob.com)
    const STATE_URL = 'https://jsonblob.com/api/jsonBlob/019d91f2-8310-70ef-ac09-0414cd963daf';
    let state = null;
    try {
      const r = await fetch(STATE_URL, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (r.ok) state = await r.json();
    } catch(e) {
      console.log("Could not load state:", e.message);
    }

    if (!state || !state.trades) {
      await tg(BOT_TOKEN, CHAT_ID, 
        `📊 <b>WEEKLY REPORT</b>\n\n⚠️ No trade data available yet. Report will retry next week.`
      );
      return res.status(200).json({ ok: true, fallback: true });
    }

    const equity = state.equity || 150;
    const start = 150;
    const closed = state.trades || [];
    const now = new Date();

    // ── This Week's Trades ─────────────────────────────────────────────
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    const weekTrades = closed.filter(t => new Date(t.closeTime) >= weekStart);

    // ── This Month's Trades ────────────────────────────────────────────
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthTrades = closed.filter(t => new Date(t.closeTime) >= monthStart);

    // ── Build trade-by-trade list for this week ────────────────────────
    let tradeList = '';
    if (weekTrades.length === 0) {
      tradeList = '🔇 No trades this week.\n';
    } else {
      weekTrades.forEach((t, i) => {
        const emoji = t.result === 'SL' ? '❌' : t.result === 'TP2' ? '🚀' : '🟢';
        const dir = t.direction || '?';
        const entry = t.entry || '?';
        const close = t.closePrice || '?';
        const pips = t.pips !== undefined ? `${t.pips >= 0 ? '+' : ''}${t.pips}` : '?';
        const pnl = t.pnl !== undefined ? `${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}` : '?';
        const time = t.closeTime ? new Date(t.closeTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
        tradeList += `${emoji} ${dir} @ ${entry} → ${close} | ${pips} pips | ${pnl} (${t.result}) ${time}\n`;
      });
    }

    // ── Week stats ─────────────────────────────────────────────────────
    const wTP1 = weekTrades.filter(t => t.result === 'TP1_Secured').length;
    const wTP2 = weekTrades.filter(t => t.result === 'TP2').length;
    const wSL = weekTrades.filter(t => t.result === 'SL').length;
    const wWins = wTP1 + wTP2;
    const wPnl = weekTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    const wPips = weekTrades.reduce((s, t) => s + (t.pips || 0), 0);
    const wWinRate = weekTrades.length > 0 ? ((wWins / weekTrades.length) * 100).toFixed(0) : '0';

    // ── Month stats ────────────────────────────────────────────────────
    const mTP1 = monthTrades.filter(t => t.result === 'TP1_Secured').length;
    const mTP2 = monthTrades.filter(t => t.result === 'TP2').length;
    const mSL = monthTrades.filter(t => t.result === 'SL').length;
    const mWins = mTP1 + mTP2;
    const mPnl = monthTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    const mPips = monthTrades.reduce((s, t) => s + (t.pips || 0), 0);
    const mWinRate = monthTrades.length > 0 ? ((mWins / monthTrades.length) * 100).toFixed(0) : '0';
    const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // ── SL Analysis — What went wrong ──────────────────────────────────
    const slTrades = monthTrades.filter(t => t.result === 'SL');
    let slAnalysis = '';
    if (slTrades.length === 0) {
      slAnalysis = '✅ Zero SL hits this month — perfect execution!\n';
    } else {
      const totalSlLoss = slTrades.reduce((s, t) => s + Math.abs(t.pnl || 0), 0);
      const avgSlPips = slTrades.reduce((s, t) => s + Math.abs(t.pips || 0), 0) / slTrades.length;
      slAnalysis += `Total SL losses: -$${totalSlLoss.toFixed(2)}\n`;
      slAnalysis += `Avg pips per SL: ${avgSlPips.toFixed(1)} pips\n`;
      slTrades.forEach(t => {
        const time = t.closeTime ? new Date(t.closeTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        slAnalysis += `  ❌ ${t.direction} @ ${t.entry} → SL ${t.sl} (${t.pips} pips) ${time}\n`;
      });
    }

    // ── Equity ──────────────────────────────────────────────────────────
    const eqChange = equity - start;
    const eqPct = ((eqChange / start) * 100).toFixed(1);

    // ── Compose the message ────────────────────────────────────────────
    const message = `
📊 <b>WEEKLY REPORT</b> 📊
<b>${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</b>

━━━ 📋 <b>TRADES THIS WEEK</b> ━━━
${tradeList}
<b>Week Summary:</b>
✅ Wins: ${wWins} (TP1: ${wTP1}, TP2: ${wTP2})
❌ SL: ${wSL}
Win Rate: ${wWinRate}%
Pips: ${wPips >= 0 ? '+' : ''}${wPips.toFixed(1)}
P&L: ${wPnl >= 0 ? '+' : ''}$${wPnl.toFixed(2)}

━━━ 📅 <b>${monthName} TOTAL</b> ━━━
Trades: ${monthTrades.length}
✅ Wins: ${mWins} (TP1: ${mTP1}, TP2: ${mTP2})
❌ SL: ${mSL}
Win Rate: ${mWinRate}%
Pips: ${mPips >= 0 ? '+' : ''}${mPips.toFixed(1)}
P&L: ${mPnl >= 0 ? '+' : ''}$${mPnl.toFixed(2)}

━━━ 🔍 <b>SL ANALYSIS</b> ━━━
${slAnalysis}
━━━ 💰 <b>EQUITY</b> ━━━
Start: $${start} → Now: $${equity}
Change: ${eqChange >= 0 ? '+' : ''}$${eqChange.toFixed(2)} (${eqPct}%)

<i>🐳 Whale engine running silently 24/7.
Next report: Next Friday.</i>
    `.trim();

    // Telegram has a 4096 char limit — split if needed
    if (message.length <= 4000) {
      await tg(BOT_TOKEN, CHAT_ID, message);
    } else {
      // Split into two messages
      const half = message.indexOf('━━━ 📅');
      await tg(BOT_TOKEN, CHAT_ID, message.substring(0, half).trim());
      await tg(BOT_TOKEN, CHAT_ID, message.substring(half).trim());
    }

    res.status(200).json({ ok: true, weekTrades: weekTrades.length, monthTrades: monthTrades.length });
  } catch (error) {
    console.error("Weekly Report Error:", error);
    res.status(500).json({ error: error.message });
  }
}

async function tg(botToken, chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
  const data = await r.json();
  if (!data.ok) console.error("Telegram error:", data);
}

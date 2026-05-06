/**
 * /api/cron-daily-health.js
 * Runs every 24 hours (scheduled via vercel.json)
 * - Checks all systems
 * - Auto-fixes broken state (new blob if expired)
 * - Sends report to owner DM ONLY (not @Eem09)
 */

const TOKEN      = '8643381958:AAGUT_9Q_lSj_29Y2lfPRJNzG9TzlmhqReM';
const OWNER_DM   = '6732836566';   // owner only — never @Eem09
const STATE_URL  = 'https://jsonblob.com/api/jsonBlob/019dfddf-9b5f-7150-a371-56ba9a3db2c1';
const BASE_URL   = 'https://trading-salem-zbf1.vercel.app';

async function sendDM(text) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: OWNER_DM, text, parse_mode: 'HTML' }),
  });
}

export default async function handler(req, res) {
  const t0 = Date.now();
  const now = new Date().toUTCString().slice(0, 25);
  const checks = [];
  const fixes  = [];

  const check = async (name, fn) => {
    try {
      const val = await fn();
      checks.push({ ok: true, name, val });
    } catch (e) {
      checks.push({ ok: false, name, val: e.message });
    }
  };

  // ── 1. Backend cron engine ────────────────────────────────────────────────
  let price = null;
  await check('Backend engine', async () => {
    const d = await fetch(`${BASE_URL}/api/cron-tick`, { signal: AbortSignal.timeout(20000) }).then(r => r.json());
    if (!d.ok) throw new Error(d.error || d.reason || 'failed');
    price = d.price;
    return `Gold $${d.price} | ${d.candles} candles`;
  });

  // ── 2. Candles API ────────────────────────────────────────────────────────
  await check('Candles API', async () => {
    const d = await fetch(`${BASE_URL}/api/candles?pair=XAU/USD&interval=15min`, { signal: AbortSignal.timeout(15000) }).then(r => r.json());
    if (!d.candles?.length) throw new Error('no candles');
    return `${d.candles.length} bars`;
  });

  // ── 3. State (JSONBlob) — auto-fix if expired ─────────────────────────────
  let stateOk = false;
  await check('State (JSONBlob)', async () => {
    const r = await fetch(STATE_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      // AUTO-FIX: create new blob
      fixes.push('State blob expired — creating new one');
      const newBlob = await fetch('https://jsonblob.com/api/jsonBlob', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify({ equity: 150, peakEquity: 150, startEquity: 150, startDate: new Date().toISOString().slice(0,10), trades: [], openTrade: null, lastSignal: null, lastSignalTime: null }),
      });
      const newId = (newBlob.headers.get('location') || '').split('/').pop();
      fixes.push(`⚠️ NEW BLOB ID: ${newId} — update STATE_URL in cron-tick.js and performance.js`);
      await sendDM(`🚨 <b>AUTO-FIX: Blob Expired</b>\n\nNew blob created:\n<code>${newId}</code>\n\nUpdate STATE_URL in cron-tick.js and performance.js then redeploy.`);
      throw new Error(`blob expired — new ID: ${newId}`);
    }
    const state = await r.json();
    if (!state?.equity) throw new Error('malformed state');
    stateOk = true;
    return `Equity $${state.equity} | Trades: ${state.trades?.length || 0} | Open: ${state.openTrade?.direction || 'none'}`;
  });

  // ── 4. Performance API ────────────────────────────────────────────────────
  await check('Performance API', async () => {
    const d = await fetch(`${BASE_URL}/api/performance`, { signal: AbortSignal.timeout(8000) }).then(r => r.json());
    if (d.error) throw new Error(d.error);
    return `${d.totalTrades} trades | WR ${d.winRate}% | Eq $${d.equity}`;
  });

  // ── 5. Website ────────────────────────────────────────────────────────────
  await check('Website (Vercel)', async () => {
    const r = await fetch(BASE_URL, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return `Online (${r.status})`;
  });

  // ── 6. Telegram delivery test ─────────────────────────────────────────────
  await check('Telegram delivery', async () => {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/getMe`).then(r => r.json());
    if (!r.ok) throw new Error('bot unreachable');
    return `@${r.result.username} active`;
  });

  // ── Build report ──────────────────────────────────────────────────────────
  const elapsed    = Date.now() - t0;
  const passCount  = checks.filter(c => c.ok).length;
  const allOk      = passCount === checks.length;
  const statusIcon = allOk ? '✅' : '⚠️';

  const hour = new Date().getUTCHours();
  const session = (hour >= 6 && hour < 12) ? 'London' : (hour >= 13 && hour < 19) ? 'New York' : 'Closed';

  const msg =
`${statusIcon} <b>Daily Health Check</b>
<i>${now} · ${elapsed}ms</i>

${checks.map(c => `${c.ok ? '✅' : '❌'} ${c.name}\n    <code>${c.val}</code>`).join('\n\n')}

💰 <b>Gold:</b> $${price || '—'}
🏙️ <b>Session:</b> ${session}
${fixes.length ? '\n🔧 <b>Auto-fixes applied:</b>\n' + fixes.map(f => `    • ${f}`).join('\n') : ''}
${allOk ? '\n🟢 All systems normal — no action needed.' : '\n🔴 Issues detected — check above.'}`;

  await sendDM(msg);

  return res.status(200).json({
    ok: true, passed: passCount, total: checks.length,
    allOk, elapsed, fixes, checks, now,
  });
}

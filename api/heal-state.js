/**
 * /api/heal-state.js
 * One-shot emergency healer — call this endpoint to:
 *   1. Create a fresh state blob on JSONBlob
 *   2. Update the pointer blob with the new URL
 *   3. Notify owner via Telegram with the new blob URL
 *
 * Usage: GET https://trading-salem-zbf1.vercel.app/api/heal-state?secret=salem2026
 */

const TOKEN       = '8643381958:AAGUT_9Q_lSj_29Y2lfPRJNzG9TzlmhqReM';
const OWNER_DM    = '6732836566';
const POINTER_URL = 'https://jsonblob.com/api/jsonBlob/019e056f-5f10-717e-9162-a86e051fadf8';
const PAPER_START = 150;
const SECRET      = 'salem2026';

async function sendDM(text) {
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: OWNER_DM, text, parse_mode: 'HTML' }),
    });
  } catch (e) { console.error('[HEAL] TG send error:', e.message); }
}

export default async function handler(req, res) {
  // Simple secret guard
  const secret = req.query?.secret || req.headers?.['x-heal-secret'];
  if (secret !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const steps = [];

  try {
    // ── Step 1: Check if existing pointer blob is alive ──────────────────────
    let existingState = null;
    let pointerAlive  = false;
    try {
      const pr = await fetch(POINTER_URL, {
        headers: { Accept: 'application/json' },
        signal:  AbortSignal.timeout(6000),
      });
      if (pr.ok) {
        const pd = await pr.json();
        pointerAlive = true;
        steps.push('✅ Pointer blob is alive');

        // If pointer has _stateUrl, check if state blob is alive
        if (pd._stateUrl) {
          const sr = await fetch(pd._stateUrl, {
            headers: { Accept: 'application/json' },
            signal:  AbortSignal.timeout(6000),
          }).catch(() => null);
          if (sr?.ok) {
            existingState = await sr.json();
            steps.push(`✅ State blob alive at _stateUrl — Equity: $${existingState.equity}`);
          } else {
            steps.push('⚠️ State blob at _stateUrl is dead — will recreate');
          }
        } else if (pd.equity) {
          existingState = pd;
          steps.push(`✅ Pointer IS the state blob — Equity: $${pd.equity}`);
        }
      }
    } catch (e) {
      steps.push(`⚠️ Pointer blob unreachable: ${e.message}`);
    }

    // ── Step 2: Build fresh state (preserve history if we have it) ───────────
    const freshState = existingState && existingState.equity
      ? existingState
      : {
          equity:      PAPER_START,
          peakEquity:  PAPER_START,
          startEquity: PAPER_START,
          startDate:   new Date().toISOString().slice(0, 10),
          trades:      [],
          openTrade:   null,
          lastSignal:  null,
          lastSignalTime: null,
        };

    // ── Step 3: Create a new state blob ──────────────────────────────────────
    const createRes = await fetch('https://jsonblob.com/api/jsonBlob', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(freshState),
      signal:  AbortSignal.timeout(10000),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return res.status(502).json({ error: 'Failed to create new state blob', detail: errText, steps });
    }

    const location = createRes.headers.get('location') || '';
    const newStateUrl = location.startsWith('http')
      ? location
      : `https://jsonblob.com${location}`;

    steps.push(`✅ New state blob created: ${newStateUrl}`);

    // ── Step 4: Update the pointer blob with { _stateUrl: newStateUrl, ...state } ──
    const pointerPayload = { ...freshState, _stateUrl: newStateUrl };

    // Try PUT to existing pointer blob
    let pointerUpdated = false;
    if (pointerAlive) {
      try {
        const pr = await fetch(POINTER_URL, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body:    JSON.stringify(pointerPayload),
          signal:  AbortSignal.timeout(8000),
        });
        if (pr.ok) {
          pointerUpdated = true;
          steps.push('✅ Pointer blob updated with new _stateUrl');
        }
      } catch (e) {
        steps.push(`⚠️ Pointer PUT failed: ${e.message}`);
      }
    }

    // If pointer is also dead, create a new pointer blob
    let newPointerUrl = POINTER_URL;
    if (!pointerUpdated) {
      try {
        const newPointerRes = await fetch('https://jsonblob.com/api/jsonBlob', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body:    JSON.stringify(pointerPayload),
          signal:  AbortSignal.timeout(10000),
        });
        if (newPointerRes.ok) {
          const pLoc = newPointerRes.headers.get('location') || '';
          newPointerUrl = pLoc.startsWith('http') ? pLoc : `https://jsonblob.com${pLoc}`;
          steps.push(`⚠️ Pointer blob was dead — NEW POINTER created: ${newPointerUrl}`);
          steps.push(`🚨 ACTION REQUIRED: Update POINTER_URL in cron-tick.js, performance.js, and cron-daily-health.js`);
        }
      } catch (e) {
        steps.push(`❌ Failed to create new pointer blob: ${e.message}`);
      }
    }

    // ── Step 5: Notify via Telegram ──────────────────────────────────────────
    const needsCodeUpdate = !pointerUpdated;
    const tgMsg = needsCodeUpdate
      ? `🔧 <b>State Healed — ACTION NEEDED</b>\n\n` +
        `New state URL:\n<code>${newStateUrl}</code>\n\n` +
        `<b>⚠️ Pointer blob was also dead!</b>\nNew pointer URL:\n<code>${newPointerUrl}</code>\n\n` +
        `Update <b>POINTER_URL</b> in:\n• cron-tick.js\n• performance.js\n• cron-daily-health.js\n• heal-state.js\n\nEquity preserved: <b>$${freshState.equity}</b> | Trades: <b>${freshState.trades?.length || 0}</b>`
      : `🔧 <b>State Healed ✅</b>\n\nNew state blob:\n<code>${newStateUrl}</code>\n\nPointer blob updated — no code changes needed.\nEquity: <b>$${freshState.equity}</b> | Trades: <b>${freshState.trades?.length || 0}</b>\n\nSystem is self-healing — next cron-tick will use the new blob automatically.`;

    await sendDM(tgMsg);
    steps.push('✅ Telegram notification sent');

    return res.status(200).json({
      ok: true,
      newStateUrl,
      newPointerUrl: pointerUpdated ? POINTER_URL : newPointerUrl,
      pointerUpdated,
      needsCodeUpdate,
      equity: freshState.equity,
      trades: freshState.trades?.length || 0,
      steps,
    });

  } catch (err) {
    console.error('[HEAL]', err);
    await sendDM(`❌ <b>Heal-state failed</b>\n\n${err.message}`);
    return res.status(500).json({ error: err.message, steps });
  }
}

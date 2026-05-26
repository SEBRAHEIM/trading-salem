/**
 * stateStore.js — Permanent State Storage via GitHub Gist
 *
 * Why Gist?
 *   • Never expires (GitHub has been running since 2008)
 *   • Free forever
 *   • No new accounts — you already have GitHub
 *   • Simple REST API
 *   • Private gist = only accessible with your token
 *
 * Setup (one-time):
 *   1. Create token: github.com/settings/tokens/new → check "gist" → no expiration
 *   2. Add to Vercel env vars:
 *        GITHUB_TOKEN = ghp_xxxxxxxxxxxx
 *        STATE_GIST_ID = (leave blank first time — code creates it and sends via Telegram)
 *
 * How it works:
 *   • loadState()  → GET  /gists/:id  → parse state.json file inside the gist
 *   • saveState()  → PATCH /gists/:id → overwrite state.json with new state
 *   • First run without GIST_ID: creates a new gist, notifies owner via Telegram
 */

const PAPER_START       = 150;
const GIST_FILE         = 'trading-salem-state.json';
const TELEGRAM_TOKEN    = '8643381958:AAGUT_9Q_lSj_29Y2lfPRJNzG9TzlmhqReM';
const OWNER_DM          = '6732836566';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN env var not set — see stateStore.js setup instructions');
  return {
    'Authorization': `token ${token}`,
    'Accept':        'application/vnd.github.v3+json',
    'Content-Type':  'application/json',
    'User-Agent':    'trading-salem-bot',
  };
}

async function notifyTelegram(text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: OWNER_DM, text, parse_mode: 'HTML' }),
    });
  } catch (e) { console.error('[STORE] TG notify error:', e.message); }
}

// ─── Fresh state template ─────────────────────────────────────────────────────

function freshState() {
  return {
    equity:        PAPER_START,
    peakEquity:    PAPER_START,
    startEquity:   PAPER_START,
    startDate:     new Date().toISOString().slice(0, 10),
    trades:        [],
    openTrade:     null,
    lastSignal:    null,
    lastSignalTime: null,
  };
}

// ─── Create a new Gist (first-time setup) ─────────────────────────────────────

async function createGist(initialState) {
  const r = await fetch('https://api.github.com/gists', {
    method:  'POST',
    headers: githubHeaders(),
    body: JSON.stringify({
      description: 'Trading Salem — Bot State (DO NOT DELETE)',
      public:      false,
      files: {
        [GIST_FILE]: { content: JSON.stringify(initialState, null, 2) },
      },
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Failed to create gist: ${r.status} — ${err}`);
  }

  const data = await r.json();
  const gistId = data.id;

  console.log('[STORE] New gist created:', gistId);

  await notifyTelegram(
    `🎉 <b>State Storage Initialized</b>\n\n` +
    `GitHub Gist created successfully!\n\n` +
    `<b>ACTION REQUIRED — Add to Vercel env vars:</b>\n` +
    `<code>STATE_GIST_ID = ${gistId}</code>\n\n` +
    `Go to:\nVercel → trading-salem → Settings → Environment Variables\n\n` +
    `This is a one-time setup. State will never expire.`
  );

  return gistId;
}

// ─── Load State ───────────────────────────────────────────────────────────────

export async function loadState() {
  const gistId = process.env.STATE_GIST_ID;

  if (!gistId) {
    // First ever run — no gist exists yet
    console.log('[STORE] No STATE_GIST_ID — returning fresh state (will create gist on first save)');
    return freshState();
  }

  try {
    const r = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: githubHeaders(),
      signal:  AbortSignal.timeout(10000),
    });

    if (!r.ok) throw new Error(`Gist fetch failed: ${r.status}`);

    const data    = await r.json();
    const file    = data.files?.[GIST_FILE];
    if (!file?.content) throw new Error('State file missing from gist');

    const state = JSON.parse(file.content);
    console.log(`[STORE] Loaded state — equity=$${state.equity}, trades=${state.trades?.length || 0}`);
    return state;

  } catch (e) {
    console.error('[STORE] Load error:', e.message);
    // Return fresh state — DO NOT crash. Next saveState will repair the gist.
    return freshState();
  }
}

// ─── Save State ───────────────────────────────────────────────────────────────

export async function saveState(state) {
  let gistId = process.env.STATE_GIST_ID;

  // First ever save — create the gist and notify owner
  if (!gistId) {
    try {
      gistId = await createGist(state);
      // We can't set env vars at runtime, but the gist is created.
      // Owner will add STATE_GIST_ID to Vercel. Meanwhile state is saved.
      console.log('[STORE] First save — gist created:', gistId);
      return;
    } catch (e) {
      console.error('[STORE] Failed to create gist:', e.message);
      return;
    }
  }

  // Normal save — PATCH the existing gist
  try {
    const r = await fetch(`https://api.github.com/gists/${gistId}`, {
      method:  'PATCH',
      headers: githubHeaders(),
      body: JSON.stringify({
        files: {
          [GIST_FILE]: { content: JSON.stringify(state, null, 2) },
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!r.ok) {
      const err = await r.text();
      throw new Error(`Gist PATCH failed: ${r.status} — ${err}`);
    }

    console.log(`[STORE] Saved state — equity=$${state.equity}, trades=${state.trades?.length || 0}`);

  } catch (e) {
    console.error('[STORE] Save error:', e.message);
    // If gist is gone (deleted), recreate it
    if (e.message.includes('404') || e.message.includes('Not Found')) {
      console.log('[STORE] Gist not found — recreating...');
      try {
        const newId = await createGist(state);
        console.log('[STORE] Recreated gist:', newId);
      } catch (e2) {
        console.error('[STORE] Recreate failed:', e2.message);
      }
    }
  }
}

// ─── Read state for APIs (no caching needed — gist is fast) ──────────────────

export async function readStateForAPI() {
  try {
    return await loadState();
  } catch (e) {
    console.error('[STORE] readStateForAPI error:', e.message);
    return null;
  }
}

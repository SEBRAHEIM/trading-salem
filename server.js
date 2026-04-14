/**
 * ForexSignal Pro — Production Server
 * Serves the built frontend + runs the 24/7 paper trading bot.
 * Deploy this to Railway: https://railway.app
 */

import express from 'express';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync, exec } from 'child_process';
import TradingView from '@mathieuc/tradingview';
import { runAllStrategies, aggregateSignals } from './src/strategies/strategies.js';
import { computeRiskParams } from './src/data/backtest.js';
import { whaleLevels } from './src/data/whales.js';

// ─── Correlation Tracker ──────────────────────────────────────────────────────
const correlationStats = {
  totalChecks: 0,
  overlapCount: 0,
  syntheticSaves: 0
};

async function updateWhaleLevelsServer() {
  const UW_API_KEY = "d9dc6e61-6157-4070-af00-2f868fd5dc27";
  try {
    const res = await fetch(`https://api.unusualwhales.com/api/option-trades/flow-alerts?ticker_symbol=GLD&limit=100`, {
       headers: { "Authorization": `Bearer ${UW_API_KEY}`, "UW-CLIENT-API-ID": "100001", "Accept": "application/json" }
    });
    if (!res.ok) return;
    const data = await res.json();
    let calls = [], puts = [];
    data.data.forEach(t => {
       const strike = parseFloat(t.strike);
       const prem = parseFloat(t.total_premium || 0);
       if (t.option_type === 'C' || t.type === 'call') calls.push({strike, premium: prem});
       else if (t.option_type === 'P' || t.type === 'put') puts.push({strike, premium: prem});
    });
    calls.sort((a,b)=>b.premium-a.premium); puts.sort((a,b)=>b.premium-a.premium);
    whaleLevels.resistance = calls.slice(0,5).map(c=>c.strike);
    whaleLevels.support = puts.slice(0,5).map(p=>p.strike);
    whaleLevels.active = true;
  } catch(e) {}
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// ─── Shared helper ────────────────────────────────────────────────────────────
const TV_SYMBOLS  = { 'XAU/USD': 'OANDA:XAUUSD', 'XTIUSD': 'XTIUSD' };
const TV_INTERVALS = { '1min':'1','5min':'5','15min':'15','30min':'30','1h':'60','4h':'240','1day':'D' };

function fetchTVCandles(pair, interval) {
  return new Promise((resolve, reject) => {
    let handled = false;
    const client = new TradingView.Client();
    const chart  = new client.Session.Chart();
    const timeout = setTimeout(() => {
      if (handled) return; handled = true;
      try { client.end(); } catch {}
      reject(new Error('TV timeout'));
    }, 12000);

    chart.setMarket(TV_SYMBOLS[pair] || 'OANDA:XAUUSD', {
      timeframe: TV_INTERVALS[interval] || '15', range: 300
    });
    chart.onUpdate(() => {
      if (handled) return;
      if (!chart.periods || chart.periods.length < 10) return;
      handled = true; clearTimeout(timeout);
      const candles = chart.periods.map(p => ({
        time:   p.time,
        open:   +parseFloat(p.open).toFixed(2),
        high:   +parseFloat(p.max).toFixed(2),
        low:    +parseFloat(p.min).toFixed(2),
        close:  +parseFloat(p.close).toFixed(2),
        volume: Math.round(p.volume || 0),
      })).reverse();
      try { client.end(); } catch {}
      resolve(candles);
    });
    chart.onError(err => {
      if (handled) return; handled = true; clearTimeout(timeout);
      try { client.end(); } catch {}
      reject(err);
    });
  });
}

// ─── Paper Trading State ──────────────────────────────────────────────────────
const PAPER_START    = 150;
const PAPER_RISK_PCT = 1.0;
const TRADES_LOG_FILE = path.join(__dirname, 'trades-log.json');

// Load persisted trades from disk on startup
function loadTradesLog() {
  try {
    if (fs.existsSync(TRADES_LOG_FILE)) {
      const data = JSON.parse(fs.readFileSync(TRADES_LOG_FILE, 'utf-8'));
      console.log(`[BOT] Loaded ${data.trades.length} trades from persistent log.`);
      return data;
    }
  } catch (e) {
    console.error('[BOT] Failed to load trades log:', e.message);
  }
  return { equity: PAPER_START, trades: [], openTrade: null };
}

function saveTradesLog() {
  try {
    fs.writeFileSync(TRADES_LOG_FILE, JSON.stringify({
      equity: paperState.equity,
      trades: paperState.trades,
      openTrade: paperState.openTrade,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (e) {
    console.error('[BOT] Failed to save trades log:', e.message);
  }
}

const savedState = loadTradesLog();
const paperState = {
  equity: savedState.equity,
  trades: savedState.trades,
  openTrade: savedState.openTrade
};

function sendTelegram(htmlContent) {
  const TELEGRAM_BOT_TOKEN = '8643381958:AAGUT_9Q_lSj_29Y2lfPRJNzG9TzlmhqReM';
  const TELEGRAM_CHAT_ID = '6732836566';
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: htmlContent,
      parse_mode: 'HTML'
    })
  }).catch(err => console.error('[BOT] Telegram fetch error:', err.message));
}

// Bot tick every 60s
setInterval(async () => {
  try {
    const candles   = await fetchTVCandles('XAU/USD', '15min');
    if (!candles || candles.length < 50) return;
    const lastClose = candles[candles.length - 1].close;

    // Refresh backend Dark Pool data
    await updateWhaleLevelsServer();

    // Monitor open trade
    if (paperState.openTrade) {
      const t = paperState.openTrade;
      const isBuy = t.direction === 'BUY';
      const dollarRisk = paperState.equity * (PAPER_RISK_PCT / 100);
      let closeTradeResult = null;

      if (isBuy) {
        if (lastClose >= t.tp1 && !t.hitTp1) {
          t.hitTp1 = true;
          sendTelegram(`🟢 <b>TP1 DESTROYED!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Price:</b> ${lastClose}\n<b>Target 1:</b> ${t.tp1}`);
        }
        if (lastClose >= t.tp2 && !t.hitTp2 && t.hitTp1) {
          t.hitTp2 = true;
          sendTelegram(`🚀 <b>TP2 CRUSHED!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Price:</b> ${lastClose}\n<b>Target 2:</b> ${t.tp2}`);
          closeTradeResult = 'TP2';
        }
        if (lastClose <= t.sl) {
          if (t.hitTp1) {
             sendTelegram(`⚠️ <b>Stopped out after hitting TP1!</b>\nIt doesn't matter, we already took our profit.\n\n<b>Asset:</b> XAU/USD`);
             closeTradeResult = 'TP1_Secured';
          } else {
             sendTelegram(`❌ <b>SL HIT!</b>\nWe will be back stronger.\n\n<b>Asset:</b> XAU/USD\n<b>Entry:</b> ${t.entry}\n<b>SL:</b> ${t.sl}`);
             closeTradeResult = 'SL';
          }
        }
      } else { // SELL
        if (lastClose <= t.tp1 && !t.hitTp1) {
          t.hitTp1 = true;
          sendTelegram(`🟢 <b>TP1 DESTROYED!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Price:</b> ${lastClose}\n<b>Target 1:</b> ${t.tp1}`);
        }
        if (lastClose <= t.tp2 && !t.hitTp2 && t.hitTp1) {
          t.hitTp2 = true;
          sendTelegram(`🚀 <b>TP2 CRUSHED!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Price:</b> ${lastClose}\n<b>Target 2:</b> ${t.tp2}`);
          closeTradeResult = 'TP2';
        }
        if (lastClose >= t.sl) {
          if (t.hitTp1) {
             sendTelegram(`⚠️ <b>Stopped out after hitting TP1!</b>\nIt doesn't matter, we already took our profit.\n\n<b>Asset:</b> XAU/USD`);
             closeTradeResult = 'TP1_Secured';
          } else {
             sendTelegram(`❌ <b>SL HIT!</b>\nWe will be back stronger.\n\n<b>Asset:</b> XAU/USD\n<b>Entry:</b> ${t.entry}\n<b>SL:</b> ${t.sl}`);
             closeTradeResult = 'SL';
          }
        }
      }

      if (closeTradeResult) {
        let pnl = 0;
        if (closeTradeResult === 'SL') pnl = -dollarRisk;
        else if (closeTradeResult === 'TP1_Secured') pnl = +(dollarRisk * 1.5).toFixed(2);
        else if (closeTradeResult === 'TP2') pnl = +(dollarRisk * 2.5).toFixed(2);

        // Calculate pips for this trade (Gold: 1 pip = $0.1, so multiply diff by 10)
        const pipScale = t.entry > 1000 ? 10 : t.entry > 10 ? 10 : 10000;
        const rawPips = t.direction === 'BUY'
          ? (lastClose - t.entry) * pipScale
          : (t.entry - lastClose) * pipScale;

        paperState.equity = +(paperState.equity + pnl).toFixed(2);
        paperState.trades.push({
          ...t,
          closeTime: new Date().toISOString(),
          closePrice: lastClose,
          result: closeTradeResult,
          pnl,
          pips: +rawPips.toFixed(1),
          equity: paperState.equity
        });
        paperState.openTrade = null;
        saveTradesLog();
        console.log(`[BOT] Trade Closed: ${closeTradeResult} | PnL $${pnl} | Pips ${rawPips.toFixed(1)} | Equity $${paperState.equity}`);
      }
    }

    // Look for new signal
    if (!paperState.openTrade) {
      const allResults = runAllStrategies(candles);

      // --- CORRELATION TRACKER EVALUATION ---
      const synthetic = allResults.find(r => r.id === 'whale_tracker');
      const apiLive = allResults.find(r => r.id === 'unusual_whales_csv');
      if (synthetic && apiLive) {
        correlationStats.totalChecks++;
        // We only care if at least one of them detects something
        if (synthetic.signal !== 'neutral' || apiLive.signal !== 'neutral') {
          if (synthetic.signal === apiLive.signal) {
            correlationStats.overlapCount++;
            const msg = `[CORRELATION] 🟢 PERFECT ALIGNMENT: Both Synthetic & API fired ${synthetic.signal.toUpperCase()}`;
            console.log(msg);
            sendTelegram(`🧪 <b>TRACKER UPDATE: 🟢 PERFECT ALIGNMENT</b>\nThe Synthetic Native Engine and the Live Whale API both independently triggered a <b>${synthetic.signal.toUpperCase()}</b> signal.\n<i>Mathematical compatibility holding strong.</i>`);
          } else if (synthetic.signal !== 'neutral' && apiLive.signal === 'neutral') {
            correlationStats.syntheticSaves++;
            const msg = `[CORRELATION] 🟣 SYNTHETIC EARLY DETECT: VSA fired ${synthetic.signal.toUpperCase()} before API wall built.`;
            console.log(msg);
            sendTelegram(`🧪 <b>TRACKER UPDATE: 🟣 SYNTHETIC WIN</b>\nOur Native VSA Engine front-ran the API! It autonomously triggered a <b>${synthetic.signal.toUpperCase()}</b> based on raw volume footprint before the API updated its premium walls.`);
          } else {
            const msg = `[CORRELATION] 🟡 API DETECTED: API fired ${apiLive.signal.toUpperCase()}, Synthetic remained Neutral.`;
            console.log(msg);
            // Optionally we can keep this off Telegram to avoid spam, but we log it for tracking
          }
        }
      }

      const agg = aggregateSignals(allResults);
      if (agg.thresholdMet && agg.finalSignal !== 'NO TRADE') {
        const risk = computeRiskParams(candles, agg.finalSignal, agg.finalConfidence, '15min');
        paperState.openTrade = {
          id: Date.now(), pair: 'XAU/USD', direction: agg.finalSignal,
          confidence: agg.finalConfidence, openTime: new Date().toISOString(),
          entry: risk.entry, sl: risk.stopLoss, tp1: risk.takeProfit1,
          tp2: risk.takeProfit2, riskReward: risk.riskReward,
        };
        console.log(`[BOT] TRADE OPENED ${agg.finalSignal} @ ${risk.entry}`);
        saveTradesLog();
        sendTelegram(
          `🚨 <b>${agg.finalSignal} XAU/USD</b>\n⚠️ <b>${agg.riskLevel}</b>\n\nEntry price: ${risk.entry}\nTP1: ${risk.takeProfit1}\nTP2: ${risk.takeProfit2}\nSL: ${risk.stopLoss}`
        );
      }
    }
  } catch (err) { console.error('[BOT] Tick error:', err.message); }
}, 60_000);

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get('/api/price', async (req, res) => {
  try {
    const candles = await fetchTVCandles(req.query.pair || 'XAU/USD', '1min');
    const last    = candles[candles.length - 1];
    res.json({ price: last.close, source: 'tradingview' });
  } catch (e) { res.status(503).json({ error: e.message }); }
});

app.get('/api/candles', async (req, res) => {
  try {
    const candles = await fetchTVCandles(req.query.pair || 'XAU/USD', req.query.interval || '15min');
    res.json({ source: 'tradingview', candles: candles.slice(-300) });
  } catch (e) { res.status(503).json({ error: e.message }); }
});

app.get('/api/trades', (req, res) => {
  const tp1Hits  = paperState.trades.filter(t => t.result === 'TP1_Secured').length;
  const tp2Hits  = paperState.trades.filter(t => t.result === 'TP2').length;
  const slHits   = paperState.trades.filter(t => t.result === 'SL').length;
  const wins     = tp1Hits + tp2Hits;
  const totalPnl = paperState.trades.reduce((s, t) => s + t.pnl, 0);
  const totalPips = paperState.trades.reduce((s, t) => s + (t.pips || 0), 0);
  res.json({
    equity: paperState.equity, start: PAPER_START,
    open: paperState.openTrade,
    closed: paperState.trades.slice(-100).reverse(),
    wins, losses: slHits,
    tp1Hits, tp2Hits, slHits,
    totalTrades: paperState.trades.length,
    totalPnl: +totalPnl.toFixed(2),
    totalPips: +totalPips.toFixed(1),
    winRate: paperState.trades.length > 0 ? +((wins / paperState.trades.length) * 100).toFixed(1) : 0,
  });
});

app.post('/api/email', (req, res) => {
  const { subject, content } = req.body || {};
  if (!subject || !content) return res.status(400).json({ error: 'Missing subject or content' });
  sendEmail(subject, content);
  res.json({ ok: true });
});

// Fallback — serve React/Vite SPA
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

app.listen(PORT, () => console.log(`ForexSignal Pro running on port ${PORT}`));

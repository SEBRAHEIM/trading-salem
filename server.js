/**
 * ForexSignal Pro — Production Server
 * Serves the built frontend + runs the 24/7 paper trading bot.
 * Deploy this to Railway: https://railway.app
 */

import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, exec } from 'child_process';
import TradingView from '@mathieuc/tradingview';
import { runAllStrategies, aggregateSignals } from './src/strategies/strategies.js';
import { computeRiskParams } from './src/data/backtest.js';

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
const paperState     = { equity: PAPER_START, trades: [], openTrade: null };

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

    // Monitor open trade
    if (paperState.openTrade) {
      const t    = paperState.openTrade;
      const isBuy = t.direction === 'BUY';
      let result = null;
      if (isBuy  && lastClose <= t.sl)  result = 'SL';
      if (isBuy  && lastClose >= t.tp1) result = 'TP';
      if (!isBuy && lastClose >= t.sl)  result = 'SL';
      if (!isBuy && lastClose <= t.tp1) result = 'TP';

      if (result) {
        const dollarRisk = paperState.equity * (PAPER_RISK_PCT / 100);
        const pnl        = result === 'TP' ? +(dollarRisk * 1.5).toFixed(2) : +(-dollarRisk).toFixed(2);
        paperState.equity = +(paperState.equity + pnl).toFixed(2);
        paperState.trades.push({ ...t, closeTime: new Date().toISOString(), closePrice: lastClose, result, pnl, equity: paperState.equity });
        paperState.openTrade = null;
        console.log(`[BOT] ${result} | PnL $${pnl} | Equity $${paperState.equity}`);
        sendTelegram(
          `🚨 <b>Trade Closed!</b>\n\n<b>Asset:</b> XAU/USD\n<b>Result:</b> ${result}\n\n<b>Entry:</b> ${t.entry}\n<b>Close Price:</b> ${lastClose}\n\n<b>P&L:</b> $${pnl}\n<b>Equity:</b> $${paperState.equity}`
        );
      }
    }

    // Look for new signal
    if (!paperState.openTrade) {
      const agg = aggregateSignals(runAllStrategies(candles));
      if (agg.thresholdMet && agg.finalSignal !== 'NO TRADE') {
        const risk = computeRiskParams(candles, agg.finalSignal, agg.finalConfidence, '15min');
        paperState.openTrade = {
          id: Date.now(), pair: 'XAU/USD', direction: agg.finalSignal,
          confidence: agg.finalConfidence, openTime: new Date().toISOString(),
          entry: risk.entry, sl: risk.stopLoss, tp1: risk.takeProfit1,
          tp2: risk.takeProfit2, riskReward: risk.riskReward,
        };
        console.log(`[BOT] TRADE OPENED ${agg.finalSignal} @ ${risk.entry}`);
        sendTelegram(
          `🚨 <b>${agg.finalSignal} XAU/USD</b>\n⚠️ <b>Trade Opened</b>\n\nEntry price: ${risk.entry}\nTP1: ${risk.takeProfit1}\nTP2: ${risk.takeProfit2}\nSL: ${risk.stopLoss}`
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
  const wins     = paperState.trades.filter(t => t.result === 'TP').length;
  const losses   = paperState.trades.filter(t => t.result === 'SL').length;
  const totalPnl = paperState.trades.reduce((s, t) => s + t.pnl, 0);
  res.json({
    equity: paperState.equity, start: PAPER_START,
    open: paperState.openTrade,
    closed: paperState.trades.slice(-50).reverse(),
    wins, losses,
    totalTrades: paperState.trades.length,
    totalPnl: +totalPnl.toFixed(2),
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

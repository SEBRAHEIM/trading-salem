import { defineConfig } from 'vite';
import TradingView from '@mathieuc/tradingview';
import { runAllStrategies, aggregateSignals } from './src/strategies/strategies.js';
import { computeRiskParams } from './src/data/backtest.js';

// ─── TradingView Native Data Engine ───────────────────────────────────────────
const TV_SYMBOLS = {
  'XAU/USD': 'OANDA:XAUUSD',
  'XTIUSD': 'XTIUSD',
};

const TV_INTERVALS = {
  '1min': '1', '5min': '5', '15min': '15',
  '30min': '30', '1h': '60', '4h': '240', '1day': 'D'
};

async function fetchTradingViewCandles(pair, interval) {
  return new Promise((resolve, reject) => {
    let handled = false;
    const client = new TradingView.Client();
    const chart = new client.Session.Chart();
    
    // Timeout safeguard
    const timeout = setTimeout(() => {
      if (handled) return;
      handled = true;
      try { client.end(); } catch (e) {}
      reject(new Error("TradingView socket timeout"));
    }, 10000);

    const tvSymbol = TV_SYMBOLS[pair] || 'OANDA:XAUUSD';
    const tvtf = TV_INTERVALS[interval] || '15';

    chart.setMarket(tvSymbol, { timeframe: tvtf, range: 300 });

    chart.onUpdate(() => {
      if (handled) return;
      if (!chart.periods || chart.periods.length < 10) return;
      
      handled = true;
      clearTimeout(timeout);

      // TradingView provides latest candle at [0]. Engine needs oldest first.
      const candles = chart.periods.map(p => ({
        time: p.time,
        open: +parseFloat(p.open).toFixed(2),
        high: +parseFloat(p.max).toFixed(2),
        low: +parseFloat(p.min).toFixed(2),
        close: +parseFloat(p.close).toFixed(2),
        volume: Math.round(p.volume || 0),
        synthetic: false
      })).reverse();

      try { client.end(); } catch (e) {}
      resolve(candles);
    });

    chart.onError((err) => {
      if (handled) return;
      handled = true;
      clearTimeout(timeout);
      try { client.end(); } catch (e) {}
      reject(err);
    });
  });
}

// ─── Fast Price Ticker (Header) ───────────────────────────────────────────────
async function fetchTVPrice(pair) {
  try {
    const candles = await fetchTradingViewCandles(pair, '1min');
    if (candles && candles.length) {
      const last = candles[candles.length - 1];
      return { price: last.close, source: 'tradingview' };
    }
} catch(e) {}
  return null;
}


// ─── 24/7 Live Paper Trading Engine ──────────────────────────────────────────
// All trades are virtual (paper). $150 starting account. Risk: 1% per trade.
const PAPER_BALANCE_START = 150;
const PAPER_RISK_PCT      = 1.0; // 1% of current equity risked per trade

const paperState = {
  equity: PAPER_BALANCE_START,
  trades: [],       // all completed trades
  openTrade: null,  // currently open virtual trade (one at a time)
};

function sendEmail(subject, content) {
  const to = 'salimalnuaimi116@outlook.com';
  const cleanSubj = subject.replace(/"/g, '\\"');
  const cleanBody = content.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const script = `
    tell application "Mail"
      set theMessage to make new outgoing message with properties {subject:"${cleanSubj}", content:"${cleanBody}", visible:false}
      tell theMessage
        make new to recipient at end of to recipients with properties {address:"${to}"}
        send
      end tell
    end tell
  `;
  require('child_process').exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
    if (err) console.error('[BOT] Email failed:', err.message);
    else console.log(`[BOT] Email sent: ${subject}`);
  });
}

// Main bot tick — runs every 60 seconds
// WRAPPED IN AN IF STATEMENT to prevent the Vercel build from hanging forever!
if (!process.argv.includes('build')) {
setInterval(async () => {
  const pair     = 'XAU/USD';
  const interval = '15min';
  try {
    const candles = await fetchTradingViewCandles(pair, interval);
    if (!candles || candles.length < 50) return;

    const lastCandle  = candles[candles.length - 1];
    const currentPrice = lastCandle.close;

    // ── 1. Monitor open trade first ────────────────────────────────────────
    if (paperState.openTrade) {
      const t = paperState.openTrade;
      const isBuy = t.direction === 'BUY';
      let closed = false;
      let result = null;

      // Check if SL hit
      if (isBuy  && currentPrice <= t.sl) { result = 'SL'; closed = true; }
      if (!isBuy && currentPrice >= t.sl) { result = 'SL'; closed = true; }
      // Check if TP1 hit
      if (isBuy  && currentPrice >= t.tp1) { result = 'TP'; closed = true; }
      if (!isBuy && currentPrice <= t.tp1) { result = 'TP'; closed = true; }

      if (closed) {
        const dollarRisk = paperState.equity * (PAPER_RISK_PCT / 100);
        const pnl = result === 'TP' ? +(dollarRisk * 1.5).toFixed(2) : +(-dollarRisk).toFixed(2);
        paperState.equity = +(paperState.equity + pnl).toFixed(2);

        const closed_trade = {
          ...t,
          closeTime:  new Date().toISOString(),
          closePrice: currentPrice,
          result,
          pnl,
          equity:     paperState.equity,
        };
        paperState.trades.push(closed_trade);
        paperState.openTrade = null;

        const won = result === 'TP';
        const emoji = won ? '✅' : '❌';
        console.log(`[BOT] Trade CLOSED — ${result} | PnL: $${pnl} | Equity: $${paperState.equity}`);

        // Email on trade close
        sendEmail(
          `${emoji} Trade Closed: ${result} | ${t.direction} ${pair} | PnL: $${pnl}`,
          `Trade Closed!\n\nDirection: ${t.direction}\nAsset: ${pair}\nResult: ${result}\n\nEntry: ${t.entry}\nClose Price: ${currentPrice}\nStop Loss: ${t.sl}\nTake Profit 1: ${t.tp1}\n\nP&L: $${pnl}\nEquity: $${paperState.equity}\n\n${won ? 'Great trade! TP hit.' : 'Stop Loss hit. Moving on.'}`
        );
      }
    }

    // ── 2. Look for new signal (only if no open trade) ─────────────────────
    if (!paperState.openTrade) {
      const results = runAllStrategies(candles);
      const agg     = aggregateSignals(results);

      if (agg.thresholdMet && agg.finalSignal !== 'NO TRADE') {
        const risk = computeRiskParams(candles, agg.finalSignal, agg.finalConfidence, interval);

        const trade = {
          id:         Date.now(),
          pair,
          direction:  agg.finalSignal,
          confidence: agg.finalConfidence,
          openTime:   new Date().toISOString(),
          entry:      risk.entry,
          sl:         risk.stopLoss,
          tp1:        risk.takeProfit1,
          tp2:        risk.takeProfit2,
          riskReward: risk.riskReward,
        };

        paperState.openTrade = trade;
        console.log(`[BOT] NEW TRADE OPENED — ${agg.finalSignal} @ ${risk.entry} | SL: ${risk.stopLoss} | TP: ${risk.takeProfit1}`);

        // Email on trade open
        sendEmail(
          `🚨 NEW SIGNAL: ${agg.finalSignal} ${pair} @ ${risk.entry}`,
          `New Trade Entered!\n\nDirection: ${agg.finalSignal}\nAsset: ${pair}\nConfidence: ${agg.finalConfidence}%\n\n📈 TRADE LEVELS:\nEntry: ${risk.entry}\nStop Loss: ${risk.stopLoss}\nTake Profit 1 (1.5R): ${risk.takeProfit1}\nTake Profit 2: ${risk.takeProfit2}\nR/R: ${risk.riskReward}\n\nCurrent Equity: $${paperState.equity}`
        );
      }
    }

  } catch (err) {
    console.error('[BOT] Tick error:', err.message);
  }
}, 60 * 1000); // Every 60 seconds
} // End if !build


export default defineConfig({
  plugins: [{
    name: 'market-data-server',
    configureServer(server) {

      function json(res, status, body) {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(body));
      }

      // ── /api/price — real-time price from TradingView ────
      server.middlewares.use('/api/price', async (req, res) => {
        const url  = new URL(req.url, 'http://localhost');
        const pair = url.searchParams.get('pair') || 'XAU/USD';
        try {
          const price = await fetchTVPrice(pair);
          if (!price) throw new Error('Live price unavailable');
          json(res, 200, { source: price.source || 'live', ...price });
        } catch (err) {
          json(res, 503, { error: err.message });
        }
      });

      // ── /api/candles — OHLCV history ─────────────────────────────────────
      server.middlewares.use('/api/candles', async (req, res) => {
        const url  = new URL(req.url, 'http://localhost');
        const pair = url.searchParams.get('pair')     || 'XAU/USD';
        const tf   = url.searchParams.get('interval') || '15min';

        try {
          const candles = await fetchTradingViewCandles(pair, tf);
          return json(res, 200, { source: 'tradingview', candles: candles.slice(-300) });
        } catch (err) {
          console.warn('[Server] TradingView WebSocket failed:', err.message);
        }

        // Fallback — tell client to use synthetic
        json(res, 503, { error: 'TradingView source unavailable' });
      });

      // ── /api/email — native Mac email dispatcher ────────
      server.middlewares.use('/api/email', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
          try {
            const { to = 'salimalnuaimi116@outlook.com', subject, content } = JSON.parse(body);
            // Securely construct AppleScript strings escaping inner quotes
            const cleanSubj = subject.replace(/"/g, '\\"');
            const cleanBody = content.replace(/"/g, '\\"').replace(/\n/g, '\\n');
            const script = `
              tell application "Mail"
                set theMessage to make new outgoing message with properties {subject:"${cleanSubj}", content:"${cleanBody}", visible:false}
                tell theMessage
                  make new to recipient at end of to recipients with properties {address:"${to}"}
                  send
                end tell
              end tell
            `;
            require('child_process').exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
              if (err) return json(res, 500, { error: err.message });
              json(res, 200, { ok: true, msg: 'Email dispatched natively' });
            });
          } catch(err) {
            json(res, 400, { error: 'Invalid body' });
          }
        });
      });

      // ── /api/trades — expose live paper trading state ────
      server.middlewares.use('/api/trades', (req, res) => {
        const wins   = paperState.trades.filter(t => t.result === 'TP').length;
        const losses = paperState.trades.filter(t => t.result === 'SL').length;
        const totalPnl = paperState.trades.reduce((s, t) => s + t.pnl, 0);
        json(res, 200, {
          equity:    paperState.equity,
          start:     PAPER_BALANCE_START,
          open:      paperState.openTrade,
          closed:    paperState.trades.slice(-50).reverse(), // last 50, newest first
          wins,
          losses,
          totalTrades: paperState.trades.length,
          totalPnl:  +totalPnl.toFixed(2),
          winRate:   paperState.trades.length > 0 ? +((wins / paperState.trades.length) * 100).toFixed(1) : 0,
        });
      });

    },
  }],
});

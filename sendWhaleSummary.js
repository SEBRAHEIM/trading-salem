import https from 'https';

const UW_KEY = "d9dc6e61-6157-4070-af00-2f868fd5dc27";
const BOT_TOKEN = "8643381958:AAGUT_9Q_lSj_29Y2lfPRJNzG9TzlmhqReM";
const CHAT_ID = "6732836566";
const ticker = "GLD"; // Gold proxy

// 1. Fetch from UW
const uwOptions = {
  hostname: 'api.unusualwhales.com',
  path: `/api/option-trades/flow-alerts?ticker_symbol=${ticker}&limit=100`,
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${UW_KEY}`,
    'UW-CLIENT-API-ID': '100001',
    'Accept': 'application/json'
  }
};

console.log("Fetching Unusual Whales data...");
const req = https.request(uwOptions, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      if (!parsed.data) throw new Error("Invalid UW API Response");
      
      let calls = [];
      let puts = [];

      parsed.data.forEach(trade => {
        const strike = parseFloat(trade.strike);
        // Using raw premium sum
        const prem = parseFloat(trade.total_premium || 0);
        if (trade.type === 'call') calls.push({strike, prem});
        else if (trade.type === 'put') puts.push({strike, prem});
      });

      calls.sort((a, b) => b.prem - a.prem);
      puts.sort((a, b) => b.prem - a.prem);

      // Aggregate tops
      const topCalls = calls.slice(0, 3).map(c => `$${c.strike} (${(c.prem/1000).toFixed(1)}k premium)`).join('\n');
      const topPuts = puts.slice(0, 3).map(p => `$${p.strike} (${(p.prem/1000).toFixed(1)}k premium)`).join('\n');

      const message = `
🐳 <b>UNUSUAL WHALES FLOW REPORT</b> 🐳
<b>Asset Proxy:</b> ${ticker} (Gold Correlation)

📈 <b>Massive Call Resistance (Ceiling):</b>
${topCalls || "None Detected"}

📉 <b>Massive Put Support (Floor):</b>
${topPuts || "None Detected"}

<i>Data injected directly into Master Veto engine.</i>
      `.trim();

      sendTelegram(message);
    } catch(e) { console.error(e); }
  });
});
req.on('error', e => console.error(e));
req.end();

function sendTelegram(text) {
  const data = JSON.stringify({
    chat_id: CHAT_ID,
    text: text,
    parse_mode: 'HTML'
  });

  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  const tgReq = https.request(options, (tgRes) => {
    tgRes.on('data', () => {});
    tgRes.on('end', () => console.log("✅ Successfully pinged Telegram with Whale Data!"));
  });
  tgReq.on('error', e => console.error(e));
  tgReq.write(data);
  tgReq.end();
}

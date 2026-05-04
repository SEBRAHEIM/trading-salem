const TOKEN = '8643381958:AAGUT_9Q_lSj_29Y2lfPRJNzG9TzlmhqReM';
const TARGETS = ['6732836566', '-1003752467954'];

const msg = `⚠️ <b>System Notice — Our Apology</b>

We sincerely apologize. Earlier signal messages incorrectly included news headlines. This was a system error and should never have been sent.

All news references have been permanently removed from the system.

From now on, signals contain only:
🟢 Entry price
🎯 Target (TP1)
🛑 Stop Loss
📏 Points distance

Clean signals. No noise. Thank you for your patience.`;

async function send(chatId) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' })
  });
  const d = await r.json();
  console.log(`Chat ${chatId}: ${d.ok ? '✅ Sent' : '❌ ' + d.description}`);
}

for (const t of TARGETS) await send(t);
console.log('Done.');

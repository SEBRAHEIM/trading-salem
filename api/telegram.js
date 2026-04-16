export default async function handler(req, res) {
  // Allow cross-origin requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text content' });

  const TELEGRAM_BOT_TOKEN = '8643381958:AAGUT_9Q_lSj_29Y2lfPRJNzG9TzlmhqReM';
  const TELEGRAM_TARGETS = [
    '6732836566',          // Personal DM
    '-1003752467954'       // Group: @chatbotsallem
  ];
  
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  try {
    const results = await Promise.allSettled(
      TELEGRAM_TARGETS.map(chat_id =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id, text, parse_mode: 'HTML' })
        })
      )
    );
    
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length === results.length) {
      return res.status(500).json({ error: 'Failed to send to all Telegram targets.' });
    }
    
    return res.status(200).json({ ok: true, msg: `Sent to ${results.length - failed.length}/${results.length} targets` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

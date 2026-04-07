/**
 * Signal Logger
 * Persists all generated signals to localStorage with timestamps.
 */

const STORAGE_KEY = 'forex_signal_logs';
const MAX_LOGS = 500;

export function logSignal(entry) {
  const logs = getLogs();
  logs.unshift({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch (e) {
    console.warn('Log storage full');
  }
}

export function getLogs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function clearLogs() {
  localStorage.removeItem(STORAGE_KEY);
}

export function exportLogs() {
  const logs = getLogs();
  const csv = [
    'Timestamp,Pair,Timeframe,Signal,Confidence,Entry,StopLoss,TP1,TP2,RiskReward,Buy Count,Sell Count,Neutral Count,Market Status',
    ...logs.map(l => [
      l.timestamp, l.pair, l.timeframe, l.signal, l.confidence,
      l.entry || '', l.stopLoss || '', l.takeProfit1 || '', l.takeProfit2 || '', l.riskReward || '',
      l.buyCount, l.sellCount, l.neutralCount, l.marketStatus,
    ].join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `forex_signals_${Date.now()}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

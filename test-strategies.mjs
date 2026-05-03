/**
 * Live strategy test — runs all 9 strategies against real TradingView data
 * Usage: node test-strategies.mjs
 */
import { fetchTradingViewCandles } from './api/utils.js';
import { runAllStrategies, aggregateSignals } from './src/strategies/strategies.js';

console.log('🔍 Fetching live XAU/USD candles from TradingView...\n');

try {
  const candles = await fetchTradingViewCandles('XAU/USD', '15min');
  if (!candles || candles.length < 50) {
    console.error('❌ Not enough candles:', candles?.length);
    process.exit(1);
  }

  const price = candles[candles.length - 1].close;
  console.log(`✅ Got ${candles.length} candles | Current price: $${price}\n`);
  console.log('─'.repeat(70));
  console.log('STRATEGY RESULTS:');
  console.log('─'.repeat(70));

  const results = runAllStrategies(candles);

  let allOk = true;
  for (const r of results) {
    const icon = r.signal === 'buy' ? '🟢' : r.signal === 'sell' ? '🔴' : '⚪';
    const errFlag = r.confidence === 0 && r.reason?.startsWith('Error') ? ' ⚠️ ERROR' : '';
    if (errFlag) allOk = false;
    console.log(`${icon} [${r.id.padEnd(22)}] weight:${String(r.weight).padEnd(3)} | ${r.signal.toUpperCase().padEnd(7)} ${r.confidence}% | ${r.reason?.slice(0, 80)}${errFlag}`);
  }

  console.log('─'.repeat(70));
  const agg = aggregateSignals(results, null);
  console.log(`\n📊 AGGREGATION:`);
  console.log(`   Signal    : ${agg.finalSignal}`);
  console.log(`   Confidence: ${agg.finalConfidence}%  (threshold: ${agg.threshold}%)`);
  console.log(`   Breakdown : ${agg.breakdown}`);
  console.log(`   Buy score : ${agg.buyScore}  |  Sell score: ${agg.sellScore}`);
  console.log(`   Market    : ${agg.marketStatus}`);
  if (agg.vetoReason) console.log(`   ⛔ VETO   : ${agg.vetoReason}`);
  console.log(`\n${allOk ? '✅ All strategies executed without errors' : '⚠️  Some strategies threw errors — check above'}`);

} catch (err) {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
}

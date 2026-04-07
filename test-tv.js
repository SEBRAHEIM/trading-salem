import TradingView from '@mathieuc/tradingview';

async function test() {
  try {
    const client = new TradingView.Client();
    const chart = new client.Session.Chart();
    
    chart.setMarket('OANDA:XAUUSD', { 
      timeframe: '15',
      range: 300 
    });

    chart.onUpdate(() => {
      if (!chart.periods[0]) return;
      console.log("Latest Candle:", chart.periods[0]);
      console.log("Total Candles Loaded:", chart.periods.length);
      process.exit(0);
    });
  } catch (err) {
    console.error(err);
  }
}

test();

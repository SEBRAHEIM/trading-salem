async function test() {
  try {
    const res = await fetch("https://scanner.tradingview.com/forex/scan", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: '{"filter":[{"left":"name","operation":"match","right":"XAUUSD"}],"options":{"lang":"en"},"markets":["forex"],"symbols":{"query":{"types":["forex","cfd"]},"tickers":["OANDA:XAUUSD"]},"columns":["close","RSI","MACD.macd","MACD.signal","EMA20","SMA50"]}'
    });
    console.log(await res.text());
  } catch(e) { console.error("ERROR:", e.message); }
}
test();

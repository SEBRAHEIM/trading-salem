async function test() {
  try {
    const res = await fetch("https://scanner.tradingview.com/forex/scan", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: '{"symbols":{"tickers":["OANDA:XAUUSD","TVC:USOIL"],"query":{"types":[]}},"columns":["close"]}'
    });
    console.log(await res.text());
  } catch(e) { console.error(e.message); }
}
test();

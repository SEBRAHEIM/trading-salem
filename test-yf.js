async function test() {
  try {
    const res = await fetch("https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=XAUT-USDT");
    const json = await res.json();
    console.log("XAUT-USDT:", json.data.price);
  } catch(e) { console.error("ERROR:", e.message); }
}
test();

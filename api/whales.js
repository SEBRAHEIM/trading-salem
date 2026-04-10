export default async function handler(req, res) {
  // Using the provided user's API key
  const UW_API_KEY = process.env.UW_API_KEY || "d9dc6e61-6157-4070-af00-2f868fd5dc27";
  
  // Clean up the ticker name because forex pairs like XAU/USD don't exactly exist on options markets.
  // We'll map XAU/USD to GLD, XTIUSD to USO for proxy options flow, or accept raw ticker.
  let rawTicker = req.query.ticker || "SPY";
  let ticker = rawTicker;
  if(rawTicker.includes("XAU")) ticker = "GLD";
  if(rawTicker.includes("XTI")) ticker = "USO";
  if(rawTicker.includes("EURUSD")) ticker = "FXE";

  try {
    const url = `https://api.unusualwhales.com/api/option-trades/flow-alerts?ticker_symbol=${ticker}&limit=100`;
    
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${UW_API_KEY}`,
        "UW-CLIENT-API-ID": "100001",
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`UW API Error: ${response.statusText}`);
    }

    const json = await response.json();
    return res.status(200).json(json);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

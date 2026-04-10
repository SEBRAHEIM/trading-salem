export let whaleLevels = {
  support: [],
  resistance: [],
  active: false,
  lastUpdated: null
};

/**
 * Parses Unusual Whales Options Flow / Dark Pool CSV Export
 * Expects headers similar to: Ticker, Strike, C/P, Premium, Spot, Volume
 */
export function parseWhalesCSV(csvText) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return;

  const headers = lines[0].toLowerCase().split(',');
  
  // Find column indices
  let strikeIdx = -1, typeIdx = -1, premIdx = -1;
  headers.forEach((h, i) => {
    if (h.includes('strike')) strikeIdx = i;
    if (h === 'c/p' || h.includes('type')) typeIdx = i;
    if (h.includes('prem')) premIdx = i;
  });

  if (strikeIdx === -1) {
    alert("Could not detect 'Strike' column in the CSV. Make sure it's an Unusual Whales flow export.");
    return;
  }

  let calls = [];
  let puts = [];

  for (let i = 1; i < lines.length; i++) {
    // Basic CSV split that respects quotes (simplified)
    const cols = lines[i].split(',');
    
    let strike = parseFloat(cols[strikeIdx]);
    let type = typeIdx !== -1 ? cols[typeIdx].toUpperCase() : '';
    let premium = premIdx !== -1 ? parseFloat(cols[premIdx].replace(/[^0-9.-]+/g,"")) : 100000; // default large if unknown

    if (isNaN(strike)) continue;

    // Categorize heavy levels
    if (type.includes('C')) {
      calls.push({ strike, premium });
    } else if (type.includes('P')) {
      puts.push({ strike, premium });
    } else {
      // Dark pool prints or unknown
      calls.push({ strike, premium });
      puts.push({ strike, premium });
    }
  }

  // Sort by heaviest premium to find the absolute Whale walls
  calls.sort((a, b) => b.premium - a.premium);
  puts.sort((a, b) => b.premium - a.premium);

  // Calls act as heavy resistance (people selling calls, or dealers hedging)
  whaleLevels.resistance = calls.slice(0, 5).map(c => c.strike);
  // Puts act as heavy support 
  whaleLevels.support = puts.slice(0, 5).map(p => p.strike);
  whaleLevels.active = true;
  whaleLevels.lastUpdated = new Date().toLocaleTimeString();

  console.log("🐳 Unusual Whales Levels Imported!", whaleLevels);
  return whaleLevels;
}

export async function fetchLiveWhalesAPI(ticker) {
  try {
    const res = await fetch(`/api/whales?ticker=${ticker}`);
    if (!res.ok) return;
    const data = await res.json();
    
    let calls = [];
    let puts = [];
    
    if (data && data.data) {
      data.data.forEach(trade => {
        const strike = parseFloat(trade.strike);
        const prem = parseFloat(trade.total_premium || 0);
        if (trade.option_type === 'C') {
          calls.push({ strike, premium: prem });
        } else if (trade.option_type === 'P') {
          puts.push({ strike, premium: prem });
        }
      });
      
      calls.sort((a, b) => b.premium - a.premium);
      puts.sort((a, b) => b.premium - a.premium);
      
      // Because options might be priced differently (GLD vs XAU/USD), we use it primarily as general sentiment if prices don't perfectly align
      whaleLevels.resistance = calls.slice(0, 5).map(c => c.strike);
      whaleLevels.support = puts.slice(0, 5).map(p => p.strike);
      whaleLevels.active = true;
      whaleLevels.lastUpdated = new Date().toLocaleTimeString();
      console.log(`📡 LIVE API Whale Levels Intercepted!`, whaleLevels);
    }
    return whaleLevels;
  } catch (err) {
    console.error("Whale API Error", err);
  }
}


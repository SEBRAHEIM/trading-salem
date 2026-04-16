import https from 'https';

const UW_KEY = "d9dc6e61-6157-4070-af00-2f868fd5dc27";

function fetchUW(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.unusualwhales.com',
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UW_KEY}`,
        'UW-CLIENT-API-ID': '100001',
        'Accept': 'application/json'
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log("Probing UW API Structure...");
  const tide = await fetchUW('/api/market/market-tide');
  const halts = await fetchUW('/api/market/halts');
  const congress = await fetchUW('/api/congress/trades');
  const institutions = await fetchUW('/api/institutions/holdings?ticker=GLD');
  
  console.log("Market Tide Available:", tide ? "YES" : "NO");
  console.log("Halts Data Available:", halts ? "YES" : "NO");
  console.log("Congress Data Available:", congress ? "YES" : "NO");
  console.log("Institutions Data Available:", institutions ? "YES" : "NO");
}
run();

import https from 'https';
import fs from 'fs';

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
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  try {
    const tide = await fetchUW('/api/market/market-tide?interval_5m=false');
    const dp = await fetchUW('/api/darkpool/GLD');
    
    fs.writeFileSync('uw-tide.json', JSON.stringify(tide, null, 2));
    fs.writeFileSync('uw-dp.json', JSON.stringify(dp, null, 2));
    console.log("Done fetching Tide and Darkpool!");
  } catch(e) {
    console.error(e);
  }
}
run();

import fs from 'fs';
import https from 'https';

const API_KEY = "d9dc6e61-6157-4070-af00-2f868fd5dc27";
const ticker = "GLD";

const options = {
  hostname: 'api.unusualwhales.com',
  path: `/api/option-trades/flow-alerts?ticker_symbol=${ticker}&limit=5`,
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'UW-CLIENT-API-ID': '100001',
    'Accept': 'application/json'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log("SUCCESS:", parsed.data && parsed.data.length ? "Got Data!" : "No data length?");
      fs.writeFileSync('uw-dump.json', JSON.stringify(parsed, null, 2));
    } catch(e) {
      console.log("PARSE ERR", data);
    }
  });
});

req.on('error', (e) => {
  console.error("NET ERR", e);
});

req.end();

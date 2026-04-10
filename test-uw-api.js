import https from 'https';

const API_KEY = "d9dc6e61-6157-4070-af00-2f868fd5dc27";
const ticker = "GLD"; // Gold proxy for Forex

const options = {
  hostname: 'api.unusualwhales.com',
  path: `/api/option-trades/flow-alerts?ticker_symbol=${ticker}&limit=10`,
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
      console.log(JSON.stringify(parsed, null, 2));
    } catch(e) {
      console.log(data);
    }
  });
});

req.on('error', (e) => {
  console.error(e);
});

req.end();

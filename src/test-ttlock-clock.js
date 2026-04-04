require('dotenv').config();
const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');

const CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const HOST = 'euapi.ttlock.com';

function post(path, params) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify(params);
    const req = https.request({
      hostname: HOST, port: 443, path, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

const toVienna = (ms) => new Date(ms).toLocaleString('de-AT', { timeZone: 'Europe/Vienna' });

async function run() {
  const md5Pass = crypto.createHash('md5').update('Sitzenberg-20').digest('hex');
  const auth = await post('/oauth2/token', {
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    username: 'pizzaandginlover@gmail.com', password: md5Pass,
  });
  if (!auth.access_token) { console.log('❌ Auth:', auth.errmsg); return; }

  console.log('Aktuelle Wien-Zeit:', toVienna(Date.now()));
  console.log('');

  const locks = [
    { id: 3321320, name: 'Haupteingang' },
    { id: 2720148, name: 'Zimmer 8' },
    { id: 2720122, name: 'Zimmer 1' },
  ];

  for (const lock of locks) {
    // Lock Detail abfragen — enthält Zeitinfo
    const detail = await post('/v3/lock/detail', {
      clientId: CLIENT_ID, accessToken: auth.access_token,
      lockId: lock.id, date: Date.now(),
    });

    console.log(`── ${lock.name} (${lock.id}) ──`);
    if (detail.date) console.log('  Schloss-Zeit:', toVienna(detail.date));
    if (detail.lockData) console.log('  lockData vorhanden');
    console.log('  Batterie:', detail.electricQuantity != null ? detail.electricQuantity + '%' : '—');
    console.log('  Online:', detail.hasGateway === 1 ? 'Ja (Gateway)' : detail.hasGateway === 2 ? 'Ja (WiFi)' : 'Nein/Offline');
    if (detail.timezoneRawOffset != null) console.log('  Timezone Offset:', detail.timezoneRawOffset / 3600000, 'h');
    console.log('');
  }
}

run().catch(e => console.error('Error:', e.message));

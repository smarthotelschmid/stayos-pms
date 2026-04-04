require('dotenv').config();
const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');

const CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const HOST = 'euapi.ttlock.com';

const LOCKS = [
  { id: 3321320, name: 'Haupteingang' },
  { id: 2720122, name: 'Zimmer 1' },
  { id: 2720112, name: 'Zimmer 2' },
  { id: 2521990, name: 'Zimmer 3' },
  { id: 2522158, name: 'Zimmer 4' },
  { id: 2720132, name: 'Zimmer 5' },
  { id: 2720138, name: 'Zimmer 6' },
  { id: 2720152, name: 'Zimmer 7' },
  { id: 2720148, name: 'Zimmer 8' },
  { id: 2720144, name: 'Zimmer 9' },
  { id: 2720136, name: 'Zimmer 10' },
  { id: 2720126, name: 'Zimmer 11' },
  { id: 3653352, name: 'App. links' },
  { id: 3653284, name: 'App. rechts' },
];

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
  const token = auth.access_token;

  console.log('=== TTLock Zeitsynchronisierung — alle 14 Schlösser ===');
  console.log('Aktuelle Wien-Zeit:', toVienna(Date.now()));
  console.log('');

  let ok = 0, fail = 0;
  for (const lock of LOCKS) {
    const result = await post('/v3/lock/updateDate', {
      clientId: CLIENT_ID,
      accessToken: token,
      lockId: lock.id,
      date: Date.now(),
    });

    if (result.errcode === 0 || result.errcode === undefined) {
      console.log(`✅ ${lock.name} — Zeit synchronisiert`);
      ok++;
    } else {
      console.log(`❌ ${lock.name} — ${result.errmsg || JSON.stringify(result)}`);
      fail++;
    }
  }

  console.log(`\n=== ${ok} OK, ${fail} fehlgeschlagen ===`);

  // Verifizierung: 3 Schlösser nochmal prüfen
  console.log('\n--- Verifizierung ---');
  for (const lock of [LOCKS[0], LOCKS[8], LOCKS[1]]) {
    const detail = await post('/v3/lock/detail', {
      clientId: CLIENT_ID, accessToken: token,
      lockId: lock.id, date: Date.now(),
    });
    console.log(`${lock.name}: ${detail.date ? toVienna(detail.date) : 'keine Antwort'} | TZ Offset: ${detail.timezoneRawOffset ? detail.timezoneRawOffset / 3600000 + 'h' : '—'}`);
  }
}

run().catch(e => console.error('Error:', e.message));

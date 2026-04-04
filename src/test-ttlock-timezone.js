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

const toVienna = (ms) => ms ? new Date(ms).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'short', timeStyle: 'short' }) : '—';

async function run() {
  const md5Pass = crypto.createHash('md5').update('Sitzenberg-20').digest('hex');
  console.log('=== TTLock Timezone Audit — alle 14 Schlösser ===');
  console.log('Aktuelle Zeit Vienna:', new Date().toLocaleString('de-AT', { timeZone: 'Europe/Vienna' }));
  console.log('');

  const auth = await post('/oauth2/token', {
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    username: 'pizzaandginlover@gmail.com', password: md5Pass,
  });
  if (!auth.access_token) { console.log('❌ Auth fehlgeschlagen:', auth.errmsg); return; }
  const token = auth.access_token;

  let totalCodes = 0;
  for (const lock of LOCKS) {
    const codes = await post('/v3/lock/listKeyboardPwd', {
      clientId: CLIENT_ID, accessToken: token,
      lockId: lock.id, pageNo: 1, pageSize: 50, date: Date.now(),
    });

    const list = codes.list || [];
    const active = list.filter(c => !c.endDate || c.endDate > Date.now());
    console.log(`── ${lock.name} (${lock.id}) — ${active.length} aktiv / ${list.length} total ──`);

    if (list.length === 0) {
      console.log('  (keine Codes)');
    } else {
      list.forEach(c => {
        const now = Date.now();
        const isActive = (!c.endDate || c.endDate > now) && (!c.startDate || c.startDate <= now);
        const isFuture = c.startDate && c.startDate > now;
        const isExpired = c.endDate && c.endDate <= now;
        const tag = isActive ? '🟢' : isFuture ? '🔵' : isExpired ? '⚫' : '⚪';
        console.log(`  ${tag} PIN: ${c.keyboardPwd} | ${toVienna(c.startDate)} → ${toVienna(c.endDate)} | ${c.keyboardPwdName || '—'}`);
      });
    }
    totalCodes += list.length;
    console.log('');
  }

  console.log(`=== Total: ${totalCodes} Codes auf ${LOCKS.length} Schlössern ===`);
}

run().catch(e => console.error('Error:', e.message));

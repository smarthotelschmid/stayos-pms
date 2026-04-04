require('dotenv').config();
const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');

const CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const HOST = 'euapi.ttlock.com';
const LOCK_ID = 2720148; // Zimmer 8

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

function get(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOST, port: 443, path, method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    req.end();
  });
}

// Vienna Zeit: new Date() mit explizitem Datum erstellen (lokale Zeit = Vienna auf diesem Rechner)
function viennaMs(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = timeStr.split(':').map(Number);
  // Erstelle Datum in lokaler Zeitzone (Windows ist auf Europe/Vienna eingestellt)
  return new Date(y, m - 1, d, h, min, 0).getTime();
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function fmtMs(ms) {
  const d = new Date(ms);
  return d.toLocaleString('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'medium', timeStyle: 'short' });
}

async function run() {
  const password = 'Sitzenberg-20';
  const md5Pass = crypto.createHash('md5').update(password).digest('hex');

  console.log('=== TTLock Timezone Test — Zimmer 8 ===\n');

  // Auth
  const auth = await post('/oauth2/token', {
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    username: 'pizzaandginlover@gmail.com', password: md5Pass,
  });
  if (!auth.access_token) { console.log('❌ Auth fehlgeschlagen:', auth.errmsg); return; }
  console.log('✅ Auth OK\n');
  const token = auth.access_token;

  // Zeiten berechnen
  const today = new Date();
  const todayStr = fmtDate(today);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = fmtDate(tomorrow);

  const startMs = viennaMs(todayStr, '15:00');
  const endMs = viennaMs(tomorrowStr, '11:00');

  console.log('--- Zeiten ---');
  console.log('Start (Vienna):', fmtMs(startMs));
  console.log('Start (Unix ms):', startMs);
  console.log('Ende (Vienna):', fmtMs(endMs));
  console.log('Ende (Unix ms):', endMs);
  console.log('System TZ offset:', new Date().getTimezoneOffset(), 'min');
  console.log('');

  // Code generieren
  console.log('--- Code generieren für Zimmer 8 ---');
  const result = await post('/v3/keyboardPwd/get', {
    clientId: CLIENT_ID,
    accessToken: token,
    lockId: LOCK_ID,
    keyboardPwdType: 2,
    startDate: startMs.toString(),
    endDate: endMs.toString(),
    keyboardPwdName: 'STAYOS Timezone Test',
    date: Date.now(),
  });

  if (result.keyboardPwd) {
    console.log('✅ Code generiert:', result.keyboardPwd);
    console.log('   keyboardPwdId:', result.keyboardPwdId);
  } else {
    console.log('❌ Fehler:', result.errmsg || JSON.stringify(result));
  }
  console.log('');

  // Aktive Codes abfragen
  console.log('--- Aktive Codes auf Zimmer 8 ---');
  const codes = await post('/v3/lock/listKeyboardPwd', {
    clientId: CLIENT_ID,
    accessToken: token,
    lockId: LOCK_ID,
    pageNo: 1,
    pageSize: 20,
    date: Date.now(),
  });

  if (codes.list && codes.list.length > 0) {
    codes.list.forEach(c => {
      const start = c.startDate ? fmtMs(c.startDate) : '—';
      const end = c.endDate ? fmtMs(c.endDate) : '—';
      const status = c.senderUsername ? 'aktiv' : 'unbekannt';
      console.log(`  PIN: ${c.keyboardPwd} | ${start} → ${end} | Name: ${c.keyboardPwdName || '—'} | ID: ${c.keyboardPwdId}`);
    });
    console.log(`\nTotal: ${codes.list.length} Codes`);
  } else {
    console.log('  Keine Codes gefunden');
    if (codes.errmsg) console.log('  Fehler:', codes.errmsg);
  }
}

run().catch(e => console.error('Error:', e.message));

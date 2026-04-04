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

async function run() {
  const password = 'Sitzenberg-20';
  const md5Pass = crypto.createHash('md5').update(password).digest('hex');

  const usernames = ['pizzaandginlover@gmail.com', '+4367762035873', '4367762035873'];

  for (const username of usernames) {
    console.log(`\n--- Auth: "${username}" / Sitzenberg-20 ---`);
    const auth = await post('/oauth2/token', {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      username,
      password: md5Pass,
    });

    if (auth.access_token) {
      console.log('✅ ERFOLG! Token:', auth.access_token.substring(0, 20) + '...');
      const locks = await post('/v3/lock/list', {
        clientId: CLIENT_ID,
        accessToken: auth.access_token,
        pageNo: 1, pageSize: 100, date: Date.now(),
      });
      console.log('Locks:', locks.total || 0, 'gefunden');
      if (locks.list?.length) locks.list.forEach(l => console.log(' -', l.lockAlias || l.lockName, '| ID:', l.lockId, '| Batterie:', l.electricQuantity + '%'));
      return;
    }
    console.log('❌', auth.errmsg);
  }
}

run().catch(e => console.error('Error:', e.message));

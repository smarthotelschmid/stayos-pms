const Settings = require('../models/Settings');

const TTLOCK_API = 'https://euapi.ttlock.com';
const CLIENT_ID = process.env.TTLOCK_CLIENT_ID;
const CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TENANT_ID = '507f1f77bcf86cd799439011';

// TTLock Token holen (aus DB, mit Auto-Refresh)
async function getToken() {
  const settings = await Settings.findOne({ tenantId: TENANT_ID });
  if (!settings?.ttlock?.accessToken) throw new Error('TTLock nicht verbunden');

  if (settings.ttlock.tokenExpiry && new Date() > settings.ttlock.tokenExpiry) {
    const params = new URLSearchParams({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: settings.ttlock.refreshToken,
    });
    const res = await fetch(`${TTLOCK_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await res.json();
    if (data.errcode) throw new Error(`TTLock Refresh fehlgeschlagen: ${data.errmsg}`);
    await Settings.updateOne({ tenantId: TENANT_ID }, {
      $set: {
        'ttlock.accessToken': data.access_token,
        'ttlock.refreshToken': data.refresh_token,
        'ttlock.tokenExpiry': new Date(Date.now() + (data.expires_in || 7776000) * 1000),
      }
    });
    return data.access_token;
  }
  return settings.ttlock.accessToken;
}

// TTLock API POST Call
async function ttlockPost(path, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(`${TTLOCK_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return res.json();
}

module.exports = { getToken, ttlockPost, TTLOCK_API, CLIENT_ID, CLIENT_SECRET, TENANT_ID };

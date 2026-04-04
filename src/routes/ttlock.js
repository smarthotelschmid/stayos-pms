const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { getToken, ttlockPost, TTLOCK_API, CLIENT_ID, CLIENT_SECRET, TENANT_ID } = require('../services/ttlockHelper');
const { generateDoorCodes } = require('../services/ttlockService');

// ── POST /api/ttlock/auth ──────────────────────────────
// Login bei TTLock mit username/password
router.post('/auth', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, error: 'Username und Passwort erforderlich' });
    if (!CLIENT_ID || !CLIENT_SECRET) return res.json({ success: false, error: 'TTLock Client ID/Secret nicht konfiguriert in .env' });

    // MD5 Hash des Passworts (TTLock erfordert das)
    const crypto = require('crypto');
    const md5Pass = crypto.createHash('md5').update(password).digest('hex');

    const params = new URLSearchParams({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      username,
      password: md5Pass,
    });

    const response = await fetch(`${TTLOCK_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await response.json();

    if (data.errcode) {
      return res.json({ success: false, error: `TTLock Login fehlgeschlagen: ${data.errmsg || data.errcode}` });
    }

    // Token in Settings speichern
    await Settings.findOneAndUpdate(
      { tenantId: TENANT_ID },
      { $set: {
        'ttlock.accessToken': data.access_token,
        'ttlock.refreshToken': data.refresh_token,
        'ttlock.tokenExpiry': new Date(Date.now() + (data.expires_in || 7776000) * 1000),
        'ttlock.username': username,
      }},
      { upsert: true }
    );

    res.json({ success: true, message: `TTLock verbunden als ${username}` });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── GET /api/ttlock/locks ──────────────────────────────
// Alle Schlösser des Accounts laden
router.get('/locks', async (req, res) => {
  try {
    const token = await getToken();
    const params = new URLSearchParams({
      clientId: CLIENT_ID,
      accessToken: token,
      pageNo: 1,
      pageSize: 100,
      date: Date.now(),
    });

    const response = await fetch(`${TTLOCK_API}/v3/lock/list?${params.toString()}`);
    const data = await response.json();

    if (data.errcode) {
      return res.json({ success: false, error: `TTLock Fehler: ${data.errmsg || data.errcode}` });
    }

    // Gespeicherte Zuordnungen laden
    const settings = await Settings.findOne({ tenantId: TENANT_ID });
    const savedLocks = settings?.ttlock?.locks || [];
    const lockMap = {};
    savedLocks.forEach(l => { lockMap[l.lockId] = l.roomId; });

    const locks = (data.list || []).map(l => ({
      lockId: l.lockId,
      lockName: l.lockAlias || l.lockName,
      battery: l.electricQuantity,
      roomId: lockMap[l.lockId] || null,
    }));

    res.json({ success: true, data: locks });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── POST /api/ttlock/locks/:lockId/assign ──────────────
// Schloss einem Zimmer zuordnen
// ── POST /api/ttlock/locks/:lockId/delete-code ─────────
router.post('/locks/:lockId/delete-code', async (req, res) => {
  try {
    const { keyboardPwdId } = req.body;
    if (!keyboardPwdId) return res.json({ success: false, error: 'keyboardPwdId required' });
    const token = await getToken();
    const lockId = parseInt(req.params.lockId);
    const result = await ttlockPost('/v3/keyboardPwd/delete', {
      clientId: CLIENT_ID, accessToken: token, lockId, keyboardPwdId, date: Date.now(),
    });
    // Auch Haupteingang löschen
    const ENTRANCE = 3321320;
    if (lockId !== ENTRANCE) {
      await ttlockPost('/v3/keyboardPwd/delete', {
        clientId: CLIENT_ID, accessToken: token, lockId: ENTRANCE, keyboardPwdId, date: Date.now(),
      });
    }
    if (result.errcode) return res.json({ success: false, error: result.errmsg });
    res.json({ success: true, message: 'Code gelöscht' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── POST /api/ttlock/locks/:lockId/unlock ──────────────
router.post('/locks/:lockId/unlock', async (req, res) => {
  try {
    const token = await getToken();
    const lockId = parseInt(req.params.lockId);
    const params = new URLSearchParams({
      clientId: CLIENT_ID,
      accessToken: token,
      lockId,
      date: Date.now(),
    });
    const response = await fetch(`${TTLOCK_API}/v3/lock/unlock?${params.toString()}`);
    const data = await response.json();
    if (data.errcode) return res.json({ success: false, error: data.errmsg || `Fehler ${data.errcode}` });
    res.json({ success: true, message: 'Tür geöffnet' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.post('/locks/:lockId/assign', async (req, res) => {
  try {
    const { roomId } = req.body;
    const lockId = parseInt(req.params.lockId);

    const settings = await Settings.findOne({ tenantId: TENANT_ID });
    const locks = settings?.ttlock?.locks || [];

    // Bestehendes Lock updaten oder neues hinzufügen
    const idx = locks.findIndex(l => l.lockId === lockId);
    if (idx >= 0) {
      locks[idx].roomId = roomId || null;
    } else {
      locks.push({ lockId, lockName: req.body.lockName || '', roomId: roomId || null });
    }

    await Settings.updateOne({ tenantId: TENANT_ID }, { $set: { 'ttlock.locks': locks } });
    res.json({ success: true, message: 'Zuordnung gespeichert' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── POST /api/ttlock/locks/:lockId/code ────────────────
// Temporären Passcode generieren
router.post('/locks/:lockId/code', async (req, res) => {
  try {
    const { startDate, endDate, name } = req.body;
    const lockId = parseInt(req.params.lockId);
    const token = await getToken();

    const params = new URLSearchParams({
      clientId: CLIENT_ID,
      accessToken: token,
      lockId,
      keyboardPwdType: 2, // Custom time range
      startDate: startDate.toString(),
      endDate: endDate.toString(),
      keyboardPwdName: name || 'STAYOS Guest',
      date: Date.now(),
    });

    const response = await fetch(`${TTLOCK_API}/v3/keyboardPwd/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await response.json();

    if (data.errcode) {
      return res.json({ success: false, error: `TTLock Fehler: ${data.errmsg || data.errcode}` });
    }

    res.json({
      success: true,
      data: {
        code: data.keyboardPwdId ? data.keyboardPwd : data.keyboardPwd,
        keyboardPwdId: data.keyboardPwdId,
        startDate, endDate,
      }
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── GET /api/ttlock/status ─────────────────────────────
// ── POST /api/ttlock/cron/run ───��────────────────────��──
router.post('/cron/run', async (req, res) => {
  try {
    const result = await generateDoorCodes();
    res.json({ success: true, ...result });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Verbindungsstatus prüfen
router.get('/status', async (req, res) => {
  try {
    const settings = await Settings.findOne({ tenantId: TENANT_ID });
    const connected = !!settings?.ttlock?.accessToken;
    res.json({
      success: true,
      data: {
        connected,
        username: settings?.ttlock?.username || null,
        locksCount: settings?.ttlock?.locks?.length || 0,
      }
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;

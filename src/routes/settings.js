const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const nodemailer = require('nodemailer');

const TENANT_ID = '507f1f77bcf86cd799439011';
const PASS_MASK = '••••••••';

// ── GET /api/settings ──────────────────────────────────
router.get('/', async (req, res) => {
  try {
    let settings = await Settings.findOne({ tenantId: TENANT_ID });
    if (!settings) {
      settings = await Settings.create({ tenantId: TENANT_ID });
    }
    const obj = settings.toObject();
    // SMTP Passwort nie ans Frontend senden
    if (obj.smtp?.pass) obj.smtp.pass = PASS_MASK;
    res.json({ success: true, data: obj });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /api/settings ──────────────────────────────────
router.put('/', async (req, res) => {
  try {
    const body = { ...req.body };
    // Wenn Passwort maskiert → altes behalten
    // Flatten nested objects to dot-notation $set — prevents overwriting sibling fields
    const update = {};
    for (const [key, val] of Object.entries(body)) {
      if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
        for (const [subKey, subVal] of Object.entries(val)) {
          if (key === 'smtp' && subKey === 'pass' && (!subVal || subVal === PASS_MASK)) {
            // Keep existing password — skip empty and masked
          } else if (key === 'smtp' && ['host', 'user', 'fromName'].includes(subKey) && !subVal) {
            // Skip empty smtp fields — don't overwrite with ''
          } else {
            update[`${key}.${subKey}`] = subVal;
          }
        }
      } else {
        update[key] = val;
      }
    }
    const settings = await Settings.findOneAndUpdate(
      { tenantId: TENANT_ID },
      { $set: update },
      { new: true, upsert: true }
    );
    const obj = settings.toObject();
    if (obj.smtp?.pass) obj.smtp.pass = PASS_MASK;
    res.json({ success: true, data: obj });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Erstellt Transporter mit Fallback: erst Port 465/secure, dann 587/starttls
async function createTransporter(smtp) {
  const configs = [
    { port: 465, secure: true },
    { port: 587, secure: false, tls: { ciphers: 'SSLv3' } },
    { port: 25, secure: false },
  ];
  let lastErr;
  for (const config of configs) {
    try {
      const t = nodemailer.createTransport({
        host: smtp.host, ...config,
        auth: { user: smtp.user, pass: smtp.pass },
        connectionTimeout: 20000, greetingTimeout: 15000, socketTimeout: 20000,
      });
      await t.verify();
      return { transporter: t, port: config.port };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ── POST /api/settings/email/verify ────────────────────
router.post('/email/verify', async (req, res) => {
  try {
    const settings = await Settings.findOne({ tenantId: TENANT_ID });
    if (!settings?.smtp?.host) return res.json({ success: false, error: 'SMTP nicht konfiguriert' });
    const { port } = await createTransporter(settings.smtp);
    res.json({ success: true, message: `SMTP Verbindung OK (Port ${port})` });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── POST /api/settings/email/test ──────────────────────
router.post('/email/test', async (req, res) => {
  try {
    const { to } = req.body;
    const settings = await Settings.findOne({ tenantId: TENANT_ID });
    if (!settings?.smtp?.host) return res.json({ success: false, error: 'SMTP nicht konfiguriert' });
    const { transporter, port } = await createTransporter(settings.smtp);
    await transporter.sendMail({
      from: `"${settings.smtp.fromName || 'STAYOS'}" <${settings.smtp.user}>`,
      to: to || settings.smtp.user,
      subject: 'STAYOS Test-Email',
      html: '<h2>STAYOS Email-Test</h2><p>Wenn du diese Email siehst, funktioniert dein SMTP korrekt.</p><p><small>Port: ' + port + '</small></p>',
    });
    res.json({ success: true, message: `Test-Email gesendet an ${to || settings.smtp.user} (Port ${port})` });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;

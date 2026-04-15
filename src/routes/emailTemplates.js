const express = require('express');
const router = express.Router();
const EmailTemplate = require('../models/EmailTemplate');
const Settings = require('../models/Settings');
const { sendEmail } = require('../services/emailService');
const Anthropic = require('@anthropic-ai/sdk');

const TENANT_ID = '507f1f77bcf86cd799439011';
const DAILY_LIMIT = 10;

// Rate limit collection
let TranslationLog;
try {
  const mongoose = require('mongoose');
  const schema = new mongoose.Schema({
    tenantId: String, date: String, count: { type: Number, default: 0 },
  });
  TranslationLog = mongoose.models.TranslationLog || mongoose.model('TranslationLog', schema);
} catch {}

// POST /api/email-templates/test
router.post('/test', async (req, res) => {
  try {
    const { to, subject, html, bcc } = req.body;
    if (!to) return res.json({ success: false, error: 'Empfänger fehlt' });
    await sendEmail({
      tenantId: TENANT_ID, to, subject: subject || 'STAYOS Test',
      html: html || '<p>Test</p>', ...(bcc ? { bcc } : {}),
    });
    res.json({ success: true, message: `Test gesendet an ${to}` });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// POST /api/email-templates/translate
router.post('/translate', async (req, res) => {
  try {
    const { text, subject } = req.body;
    if (!text && !subject) return res.json({ success: false, error: 'Nichts zu übersetzen' });
    if (!process.env.ANTHROPIC_API_KEY) return res.json({ success: false, error: 'ANTHROPIC_API_KEY nicht konfiguriert' });

    // Rate limit
    const today = new Date().toISOString().slice(0, 10);
    if (TranslationLog) {
      const log = await TranslationLog.findOneAndUpdate(
        { tenantId: TENANT_ID, date: today },
        { $inc: { count: 1 } },
        { upsert: true, new: true }
      );
      if (log.count > DAILY_LIMIT) {
        return res.json({ success: false, error: `Tageslimit erreicht (${DAILY_LIMIT}/${DAILY_LIMIT})`, remaining: 0 });
      }
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const parts = [];
    if (subject) parts.push(`BETREFF: ${subject}`);
    if (text) parts.push(`INHALT:\n${text}`);

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: 'Übersetze diesen Hotel-Email-Text professionell ins Englische. Variablen in {{}} niemals übersetzen — sie müssen exakt so bleiben wie im Original. Ton: freundlich, professionell. Antworte NUR mit der Übersetzung, keine Erklärungen. Wenn BETREFF und INHALT getrennt sind, trenne die Antwort gleich.',
      messages: [{ role: 'user', content: parts.join('\n\n') }],
    });

    const result = msg.content[0]?.text || '';
    let translatedSubject = '', translatedText = '';
    if (subject && text) {
      const m = result.match(/BETREFF:\s*(.*?)(?:\n\nINHALT:\s*|\nINHALT:\s*)([\s\S]*)/i) || result.match(/SUBJECT:\s*(.*?)(?:\n\nCONTENT:\s*|\nCONTENT:\s*)([\s\S]*)/i);
      if (m) { translatedSubject = m[1].trim(); translatedText = m[2].trim(); }
      else { const lines = result.split('\n'); translatedSubject = lines[0]; translatedText = lines.slice(2).join('\n'); }
    } else if (subject) { translatedSubject = result.trim(); }
    else { translatedText = result.trim(); }

    const log2 = TranslationLog ? await TranslationLog.findOne({ tenantId: TENANT_ID, date: today }) : null;
    res.json({ success: true, subject: translatedSubject, text: translatedText, remaining: DAILY_LIMIT - (log2?.count || 0) });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// GET /api/email-templates/hotel
router.get('/hotel', async (req, res) => {
  try {
    const settings = await Settings.findOne({ tenantId: TENANT_ID });
    res.json({ success: true, data: {
      name: settings?.hotelName || '',
      address: settings?.location || '',
      phone: settings?.hotelPhone || '',
      email: settings?.hotelEmail || '',
      checkInTime: settings?.checkInTime || '',
      checkOutTime: settings?.checkOutTime || '',
    }});
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// GET /api/email-templates/:type
router.get('/:type', async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({ tenantId: TENANT_ID, type: req.params.type });
    res.json({
      success: true,
      data: template || {
        type: req.params.type,
        subject: {}, contentJson: {}, contentHtml: {}, contentText: {},
        generateTime: '00:00',
        sendTime: '06:00',
        daysBefore: 1,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/email-templates/:type
router.post('/:type', async (req, res) => {
  try {
    const { lang, subject, contentJson, contentHtml, contentText, generateTime, sendTime, daysBefore } = req.body;
    const l = lang || 'de';
    const update = {};

    // Sprachabhängige Felder
    if (subject !== undefined)     update[`subject.${l}`]     = subject;
    if (contentJson !== undefined) update[`contentJson.${l}`] = contentJson;
    if (contentHtml !== undefined) update[`contentHtml.${l}`] = contentHtml;
    if (contentText !== undefined) update[`contentText.${l}`] = contentText;

    // Timing-Felder — sprachunabhängig, nur setzen wenn explizit übergeben
    if (generateTime !== undefined) update.generateTime = generateTime;
    if (sendTime !== undefined)     update.sendTime     = sendTime;
    if (daysBefore !== undefined)   update.daysBefore   = Number(daysBefore);

    const template = await EmailTemplate.findOneAndUpdate(
      { tenantId: TENANT_ID, type: req.params.type },
      { $set: update },
      { upsert: true, new: true }
    );

    // Email-Cron neustarten wenn Timing geändert wurde
    // (Code-Generierung hat keinen eigenen Cron mehr — erfolgt im Sync bei Buchungseingang)
    if (req.params.type === 'doorcode' && (sendTime !== undefined || daysBefore !== undefined)) {
      try {
        const restartEmailCron = req.app.get('restartEmailCron');
        if (restartEmailCron) await restartEmailCron();
      } catch (e) { console.log('[EmailTemplates] Cron-Restart:', e.message); }
    }

    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

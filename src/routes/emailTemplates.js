const express = require('express');
const router = express.Router();
const EmailTemplate = require('../models/EmailTemplate');
const Settings = require('../models/Settings');
const Booking = require('../models/Booking');
const { sendEmail } = require('../services/emailService');
const { loadContext, buildVars } = require('../services/bookingEmailService');
const { wrapHtml } = require('../utils/emailLayout');
const Anthropic = require('@anthropic-ai/sdk');

function replaceVars(text, vars) {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    return (v === undefined || v === null || v === '') ? '' : String(v);
  });
}

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
// Body: { to, subject, html, text?, bcc? }
// html/subject duerfen {{var}} Platzhalter enthalten. Wir laden die Test-
// Buchung (oder irgendeine Buchung als Fallback), bauen Vars wie im
// Produktivpfad, ersetzen Platzhalter, wrappen body mit Shell.
router.post('/test', async (req, res) => {
  try {
    const { to, subject, html, text, bcc } = req.body;
    if (!to) return res.json({ success: false, error: 'Empfänger fehlt' });

    // Naechste bevorstehende bestaetigte Buchung mit Tuercode.
    // checkIn >= heute 00:00, status confirmed, stayosCode vorhanden,
    // sortiert nach checkIn aufsteigend. Fallback: irgendeine confirmed.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let booking = await Booking.findOne({
      tenantId: TENANT_ID,
      status: 'confirmed',
      checkIn: { $gte: today },
      'doorAccess.stayosCode': { $exists: true, $ne: null },
    }).sort({ checkIn: 1 });
    if (!booking) {
      booking = await Booking.findOne({ tenantId: TENANT_ID, status: 'confirmed' }).sort({ checkIn: 1 });
    }

    let vars = {};
    if (booking) {
      const ctx = await loadContext(booking._id);
      if (ctx) vars = await buildVars(ctx.booking, ctx.guest, ctx.settings, ctx.property);
    }

    const resolvedSubject = replaceVars(subject || 'STAYOS Test', vars);
    const bodyHtml = replaceVars(html || '<p>Test</p>', vars);
    const wrappedHtml = wrapHtml(bodyHtml, vars);
    const resolvedText = text ? replaceVars(text, vars) : undefined;

    await sendEmail({
      tenantId: TENANT_ID, to,
      subject: resolvedSubject,
      html: wrappedHtml,
      ...(resolvedText ? { text: resolvedText } : {}),
      ...(bcc ? { bcc } : {}),
    });
    res.json({ success: true, message: `Test gesendet an ${to}`, usedBooking: booking?.bookingNumber || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/email-templates/preview-booking — liefert Test-Buchung + gebaute Vars
// fuer Frontend-Preview im Template-Editor
router.get('/preview-booking', async (req, res) => {
  try {
    // Naechste bevorstehende bestaetigte Buchung mit Tuercode
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let booking = await Booking.findOne({
      tenantId: TENANT_ID,
      status: 'confirmed',
      checkIn: { $gte: today },
      'doorAccess.stayosCode': { $exists: true, $ne: null },
    }).sort({ checkIn: 1 });
    if (!booking) {
      booking = await Booking.findOne({ tenantId: TENANT_ID, status: 'confirmed' }).sort({ checkIn: 1 });
    }
    if (!booking) return res.json({ success: false, error: 'Keine Preview-Buchung verfügbar' });

    const ctx = await loadContext(booking._id);
    const vars = ctx ? await buildVars(ctx.booking, ctx.guest, ctx.settings, ctx.property) : {};
    res.json({ success: true, data: { bookingNumber: booking.bookingNumber, vars } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
// GET /api/email-templates/whatsapp/render?bookingId=...
router.get('/whatsapp/render', async (req, res) => {
  try {
    const { bookingId } = req.query;
    if (!bookingId) return res.status(400).json({ success: false, error: 'bookingId fehlt' });

    const { loadContext, buildVars } = require('../services/bookingEmailService');
    const { buildGuestPortalUrl } = require('../utils/guestPortalUrl');
    const ctx = await loadContext(bookingId);
    if (!ctx) return res.status(404).json({ success: false, error: 'Buchung nicht gefunden' });

    const { booking, guest, settings, property } = ctx;
    const template = await EmailTemplate.findOne({ tenantId: TENANT_ID, type: 'whatsapp' });
    const vars = await buildVars(booking, guest, settings, property);

    let text = template?.data?.de?.welcomeText || template?.contentText?.de || '';
    if (!text) {
      // Fallback
      text = 'Hallo {{guestFirstName}}, hier ist Ihr Gäste-Portal: {{guestPortalLink}}';
    }
    text = replaceVars(text, vars);

    // Gast-Telefon für WhatsApp URL
    const phone = (ctx.guest?.phone || booking.contactPhone || '').replace(/[^0-9]/g, '');
    const waUrl = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);

    res.json({ success: true, text, waUrl, phone });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:type', async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({ tenantId: TENANT_ID, type: req.params.type });
    res.json({
      success: true,
      data: template || {
        type: req.params.type,
        subject: {}, contentJson: {}, contentHtml: {}, contentText: {}, data: {},
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
    const { lang, subject, contentJson, contentHtml, contentText, data, generateTime, sendTime, daysBefore } = req.body;
    const l = lang || 'de';
    const update = {};

    // Sprachabhängige Felder
    if (subject !== undefined)     update[`subject.${l}`]     = subject;
    if (contentJson !== undefined) update[`contentJson.${l}`] = contentJson;
    if (contentHtml !== undefined) update[`contentHtml.${l}`] = contentHtml;
    if (contentText !== undefined) update[`contentText.${l}`] = contentText;
    // Strukturierte Daten (v.a. type='portal' mit welcomeText/checkInHint/houseRules)
    if (data !== undefined)        update[`data.${l}`]        = data;

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


// Test-Send: rendert das komplette Backend-Template und sendet an BCC-Adresse
router.post('/:type/test-send', async (req, res) => {
  try {
    const { type } = req.params;
    const { to } = req.body;
    if (!to) return res.status(400).json({ success: false, error: 'to fehlt' });

    if (type === 'confirmation') {
      const { sendConfirmationEmail } = require('../services/bookingEmailService');
      const Booking = require('../models/Booking');
      const booking = await Booking.findOne({ tenantId: TENANT_ID, status: { $in: ['confirmed', 'checked-in'] } }).sort({ createdAt: -1 }).lean();
      if (!booking) return res.status(404).json({ success: false, error: 'Keine Buchung gefunden' });
      // HTML Version
      await sendConfirmationEmail(booking._id, { overrideEmail: to });
      // Plain Text Version
      await sendConfirmationEmail(booking._id, { overrideEmail: to, forceFormat: 'text' });
    }

    if (type === 'doorcode') {
      const { sendDoorCodeEmail } = require('../services/doorCodeEmailService');
      const doorCodeBuildVars = require('../services/doorCodeEmailService');
      const { wrapHtml } = require('../utils/emailLayout');
      const Booking = require('../models/Booking');
      // Finde eine Buchung mit stayosCode
      const booking = await Booking.findOne({ tenantId: TENANT_ID, 'doorAccess.stayosCode': { $exists: true, $ne: null }, status: { $in: ['confirmed', 'checked-in'] } }).sort({ createdAt: -1 });
      if (!booking) return res.status(404).json({ success: false, error: 'Keine Buchung mit Türcode gefunden' });
      // HTML: Guard zurücksetzen, senden, Guard wieder setzen
      await Booking.updateOne({ _id: booking._id }, { $set: { 'communication.doorCodeSent': false } });
      await sendDoorCodeEmail(booking._id, { overrideEmail: to });
      // Plain Text: nochmal mit forceFormat
      await Booking.updateOne({ _id: booking._id }, { $set: { 'communication.doorCodeSent': false } });
      await sendDoorCodeEmail(booking._id, { overrideEmail: to, forceFormat: 'text' });
    }

    if (type === 'cancellation') {
      const { sendCancellationEmail } = require('../services/bookingEmailService');
      const Booking = require('../models/Booking');
      // Letzte stornierte Buchung als Referenz
      const booking = await Booking.findOne({ tenantId: TENANT_ID, status: 'cancelled' }).sort({ cancelledAt: -1, updatedAt: -1 }).lean();
      if (!booking) return res.status(404).json({ success: false, error: 'Keine stornierte Buchung gefunden' });
      // HTML Version
      await sendCancellationEmail(booking._id, { overrideEmail: to });
      // Plain Text Version
      await sendCancellationEmail(booking._id, { overrideEmail: to, forceFormat: 'text' });
    }

    if (type === 'review') {
      const { sendReviewEmail } = require('../services/reviewEmailService');
      const Booking = require('../models/Booking');
      // Letzte ausgecheckte Buchung als Referenz
      const today = new Date(); today.setHours(23, 59, 59, 999);
      const booking = await Booking.findOne({ tenantId: TENANT_ID, status: { $in: ['checked-out', 'confirmed'] }, checkOut: { $lte: today } }).sort({ checkOut: -1 }).lean();
      if (!booking) return res.status(404).json({ success: false, error: 'Keine Buchung gefunden' });
      // HTML Version
      await sendReviewEmail(booking._id, { overrideEmail: to });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[EmailTemplate Test]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

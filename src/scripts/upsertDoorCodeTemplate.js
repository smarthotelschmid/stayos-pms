require('dotenv').config();
const mongoose = require('mongoose');

const TENANT_ID = '507f1f77bcf86cd799439011';

const subjectDE = 'Ihr Zugangscode – {{hotelName}}';
const subjectEN = 'Your Access Code – {{hotelName}}';

const htmlDE = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
<tr><td style="padding:40px 36px">

<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#333">Guten Tag {{guestFirstName}},</p>
<p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#555">wir freuen uns auf Ihren Aufenthalt und haben alles für Sie vorbereitet.</p>

<div style="text-align:center;padding:32px 0">
<p style="margin:0 0 8px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:2px">Ihr Zugangscode</p>
<p style="margin:0;font-size:64px;font-weight:700;letter-spacing:12px;color:#1a1a1a;font-family:monospace;line-height:1">{{doorCodePin}}</p>
<p style="margin:12px 0 0;font-size:13px;color:#888">Bitte tippen Sie den Code und bestätigen Sie mit <strong>#</strong></p>
</div>

<p style="margin:0 0 8px;font-size:13px;color:#888;text-align:center">Dieser Code öffnet sowohl Ihr Zimmer als auch den Haupteingang.</p>

<table cellpadding="0" cellspacing="0" style="margin:28px auto"><tr>
<td style="background:#2860b0;border-radius:8px;padding:14px 32px">
<a href="{{guestPortalLink}}" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;display:inline-block">Zum Gästeportal →</a>
</td></tr></table>

<hr style="border:none;border-top:1px solid #eee;margin:32px 0">

<p style="margin:0 0 4px;font-size:13px;color:#888;text-align:center">Fragen? WhatsApp <a href="https://wa.me/{{hotelPhoneWhatsapp}}" style="color:#2860b0;text-decoration:none">{{hotelPhone}}</a></p>
<p style="margin:0;font-size:13px;color:#888;text-align:center">Täglich {{receptionHours}}</p>

<hr style="border:none;border-top:1px solid #eee;margin:24px 0">

<p style="margin:0;font-size:11px;color:#bbb;text-align:center">{{hotelName}} · {{hotelAddress}}</p>

</td></tr></table>
</td></tr></table>
</body></html>`;

const htmlEN = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
<tr><td style="padding:40px 36px">

<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#333">Dear {{guestFirstName}},</p>
<p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#555">We look forward to your stay and have prepared everything for you.</p>

<div style="text-align:center;padding:32px 0">
<p style="margin:0 0 8px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:2px">Your access code</p>
<p style="margin:0;font-size:64px;font-weight:700;letter-spacing:12px;color:#1a1a1a;font-family:monospace;line-height:1">{{doorCodePin}}</p>
<p style="margin:12px 0 0;font-size:13px;color:#888">Please enter the code and confirm with <strong>#</strong></p>
</div>

<p style="margin:0 0 8px;font-size:13px;color:#888;text-align:center">This code opens both your room and the main entrance.</p>

<table cellpadding="0" cellspacing="0" style="margin:28px auto"><tr>
<td style="background:#2860b0;border-radius:8px;padding:14px 32px">
<a href="{{guestPortalLink}}" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;display:inline-block">Go to Guest Portal →</a>
</td></tr></table>

<hr style="border:none;border-top:1px solid #eee;margin:32px 0">

<p style="margin:0 0 4px;font-size:13px;color:#888;text-align:center">Questions? WhatsApp <a href="https://wa.me/{{hotelPhoneWhatsapp}}" style="color:#2860b0;text-decoration:none">{{hotelPhone}}</a></p>
<p style="margin:0;font-size:13px;color:#888;text-align:center">Daily {{receptionHours}}</p>

<hr style="border:none;border-top:1px solid #eee;margin:24px 0">

<p style="margin:0;font-size:11px;color:#bbb;text-align:center">{{hotelName}} · {{hotelAddress}}</p>

</td></tr></table>
</td></tr></table>
</body></html>`;

// JSON blocks für den Block Editor (optional, für Kompatibilität)
const blocksDE = [
  { type: 'text', content: 'Guten Tag {{guestFirstName}},\n\nwir freuen uns auf Ihren Aufenthalt und haben alles für Sie vorbereitet.' },
  { type: 'highlight', label: 'Ihr Zugangscode', content: '{{doorCodePin}}', color: '#2860b0' },
  { type: 'text', content: 'Bitte tippen Sie den Code und bestätigen Sie mit #\nDieser Code öffnet sowohl Ihr Zimmer als auch den Haupteingang.', align: 'center', size: 'small' },
  { type: 'button', content: 'Zum Gästeportal →', url: '{{guestPortalLink}}', color: '#2860b0', align: 'center' },
  { type: 'divider' },
  { type: 'text', content: 'Fragen? WhatsApp {{hotelPhone}}, täglich {{receptionHours}}', align: 'center', size: 'small' },
  { type: 'divider' },
  { type: 'text', content: '{{hotelName}} · {{hotelAddress}}', align: 'center', size: 'small' },
];

const blocksEN = [
  { type: 'text', content: 'Dear {{guestFirstName}},\n\nWe look forward to your stay and have prepared everything for you.' },
  { type: 'highlight', label: 'Your access code', content: '{{doorCodePin}}', color: '#2860b0' },
  { type: 'text', content: 'Please enter the code and confirm with #\nThis code opens both your room and the main entrance.', align: 'center', size: 'small' },
  { type: 'button', content: 'Go to Guest Portal →', url: '{{guestPortalLink}}', color: '#2860b0', align: 'center' },
  { type: 'divider' },
  { type: 'text', content: 'Questions? WhatsApp {{hotelPhone}}, daily {{receptionHours}}', align: 'center', size: 'small' },
  { type: 'divider' },
  { type: 'text', content: '{{hotelName}} · {{hotelAddress}}', align: 'center', size: 'small' },
];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const EmailTemplate = require('../models/EmailTemplate');

  const result = await EmailTemplate.findOneAndUpdate(
    { tenantId: TENANT_ID, type: 'doorcode' },
    { $set: {
      'subject.de': subjectDE,
      'subject.en': subjectEN,
      'contentHtml.de': htmlDE,
      'contentHtml.en': htmlEN,
      'contentJson.de': blocksDE,
      'contentJson.en': blocksEN,
    }},
    { upsert: true, new: true }
  );

  console.log('Doorcode Template upserted:', result._id.toString());
  console.log('Subject DE:', result.subject.de);
  console.log('Subject EN:', result.subject.en);
  console.log('HTML DE:', result.contentHtml.de.length, 'chars');
  console.log('HTML EN:', result.contentHtml.en.length, 'chars');
  mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });

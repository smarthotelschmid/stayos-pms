require('dotenv').config();
const mongoose = require('mongoose');

const TENANT_ID = '507f1f77bcf86cd799439011';

const subjectDE = 'Ihr Gästeportal – {{hotelName}}';
const subjectEN = 'Your Guest Portal – {{hotelName}}';

const htmlDE = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

<!-- Header -->
<tr><td style="background:#3d4fbc;padding:28px 36px;border-radius:12px 12px 0 0;text-align:center">
<p style="margin:0;font-size:14px;font-weight:700;letter-spacing:3px;color:#ffffff;text-transform:uppercase">{{hotelName}}</p>
<p style="margin:6px 0 0;font-size:12px;color:#b8c0f0">{{tagline}}</p>
</td></tr>

<!-- Body -->
<tr><td style="background:#ffffff;padding:40px 36px;border-radius:0 0 12px 12px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">

<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1a1f3c">Guten Tag {{guestFirstName}},</p>

<p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#1a1f3c">alles ist für Ihren Aufenthalt vorbereitet. Ihren persönlichen Zugangscode und alle Details finden Sie in Ihrem Gästeportal.</p>

<!-- Button -->
<table cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:8px 0 32px">
<table cellpadding="0" cellspacing="0"><tr>
<td style="background:#3d4fbc;border-radius:8px;padding:16px 40px">
<a href="{{guestPortalLink}}" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;display:inline-block">Zum Gästeportal →</a>
</td></tr></table>
</td></tr></table>

<!-- Buchungsinfo -->
<div style="background:#f5f6ff;border-radius:8px;padding:16px 20px;text-align:center;margin:0 0 28px">
<p style="margin:0;font-size:13px;color:#5c6dd4;font-weight:500">{{checkIn}} – {{checkOut}} · {{roomName}}</p>
</div>

<hr style="border:none;border-top:1px solid #eaedf8;margin:0 0 24px">

<p style="margin:0 0 4px;font-size:13px;color:#5c6dd4;text-align:center">Fragen? WhatsApp <a href="https://wa.me/{{hotelPhoneWhatsapp}}" style="color:#3d4fbc;text-decoration:none;font-weight:500">{{hotelPhone}}</a></p>
<p style="margin:0;font-size:13px;color:#5c6dd4;text-align:center">Täglich {{receptionHours}}</p>

<hr style="border:none;border-top:1px solid #eaedf8;margin:24px 0">

<p style="margin:0;font-size:11px;color:#b0b8d4;text-align:center">{{hotelName}} · {{hotelAddress}}</p>

</td></tr>
</table>
</td></tr></table>
</body></html>`;

const htmlEN = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

<!-- Header -->
<tr><td style="background:#3d4fbc;padding:28px 36px;border-radius:12px 12px 0 0;text-align:center">
<p style="margin:0;font-size:14px;font-weight:700;letter-spacing:3px;color:#ffffff;text-transform:uppercase">{{hotelName}}</p>
<p style="margin:6px 0 0;font-size:12px;color:#b8c0f0">{{tagline}}</p>
</td></tr>

<!-- Body -->
<tr><td style="background:#ffffff;padding:40px 36px;border-radius:0 0 12px 12px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">

<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#1a1f3c">Dear {{guestFirstName}},</p>

<p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#1a1f3c">everything is ready for your stay. You can find your personal access code and all details in your guest portal.</p>

<!-- Button -->
<table cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:8px 0 32px">
<table cellpadding="0" cellspacing="0"><tr>
<td style="background:#3d4fbc;border-radius:8px;padding:16px 40px">
<a href="{{guestPortalLink}}" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;display:inline-block">Go to Guest Portal →</a>
</td></tr></table>
</td></tr></table>

<!-- Booking info -->
<div style="background:#f5f6ff;border-radius:8px;padding:16px 20px;text-align:center;margin:0 0 28px">
<p style="margin:0;font-size:13px;color:#5c6dd4;font-weight:500">{{checkIn}} – {{checkOut}} · {{roomName}}</p>
</div>

<hr style="border:none;border-top:1px solid #eaedf8;margin:0 0 24px">

<p style="margin:0 0 4px;font-size:13px;color:#5c6dd4;text-align:center">Questions? WhatsApp <a href="https://wa.me/{{hotelPhoneWhatsapp}}" style="color:#3d4fbc;text-decoration:none;font-weight:500">{{hotelPhone}}</a></p>
<p style="margin:0;font-size:13px;color:#5c6dd4;text-align:center">Daily {{receptionHours}}</p>

<hr style="border:none;border-top:1px solid #eaedf8;margin:24px 0">

<p style="margin:0;font-size:11px;color:#b0b8d4;text-align:center">{{hotelName}} · {{hotelAddress}}</p>

</td></tr>
</table>
</td></tr></table>
</body></html>`;

const blocksDE = [
  { type: 'text', content: 'Guten Tag {{guestFirstName}},\n\nalles ist für Ihren Aufenthalt vorbereitet. Ihren persönlichen Zugangscode und alle Details finden Sie in Ihrem Gästeportal.' },
  { type: 'button', content: 'Zum Gästeportal →', url: '{{guestPortalLink}}', color: '#3d4fbc', align: 'center' },
  { type: 'text', content: '{{checkIn}} – {{checkOut}} · {{roomName}}', align: 'center', size: 'small' },
  { type: 'divider' },
  { type: 'text', content: 'Fragen? WhatsApp {{hotelPhone}}, täglich {{receptionHours}}', align: 'center', size: 'small' },
  { type: 'divider' },
  { type: 'text', content: '{{hotelName}} · {{hotelAddress}}', align: 'center', size: 'small' },
];

const blocksEN = [
  { type: 'text', content: 'Dear {{guestFirstName}},\n\neverything is ready for your stay. You can find your personal access code and all details in your guest portal.' },
  { type: 'button', content: 'Go to Guest Portal →', url: '{{guestPortalLink}}', color: '#3d4fbc', align: 'center' },
  { type: 'text', content: '{{checkIn}} – {{checkOut}} · {{roomName}}', align: 'center', size: 'small' },
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

  console.log('Template upserted:', result._id.toString());
  console.log('Subject DE:', result.subject.de);
  console.log('Subject EN:', result.subject.en);
  console.log('HTML DE:', result.contentHtml.de.length, 'chars');
  console.log('HTML EN:', result.contentHtml.en.length, 'chars');
  mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });

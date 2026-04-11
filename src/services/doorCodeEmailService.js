const Booking = require('../models/Booking');
const Guest = require('../models/Guest');
const EmailTemplate = require('../models/EmailTemplate');
const Settings = require('../models/Settings');
const Property = require('../models/Property');
const { sendEmail } = require('./emailService');
const { formatAddress } = require('../utils/formatAddress');

const TENANT_ID = '507f1f77bcf86cd799439011';

function renderBlocksToHtml(blocks, vars) {
  const rv = (s) => Object.entries(vars).reduce((t, [k, v]) => t.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v || ''), s || '');
  const accent = vars.primaryColor || '#3d4fbc';
  const logo = vars.logoUrl || 'https://smarthotel-schmid.at/wp-content/uploads/2022/12/Logo-Smarthotel-SW-2-1.png';

  let body = '';
  for (const b of blocks) {
    if (b.type === 'text') {
      const size = b.size === 'small' ? 'font-size:13px;color:#8890a5;' : 'font-size:15px;color:#4a5067;line-height:1.65;';
      const align = b.align ? `text-align:${b.align};` : '';
      body += `<p style="${size}${align}margin:0 0 16px">${rv(b.content).replace(/\n/g, '<br>')}</p>`;
    } else if (b.type === 'button') {
      const color = b.color || accent;
      body += `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="${b.align || 'center'}" style="padding:8px 0 24px"><a href="${rv(b.url)}" style="display:inline-block;background:${color};color:#fff;padding:16px 40px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px">${rv(b.content)}</a></td></tr></table>`;
    } else if (b.type === 'columns') {
      body += '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6ff;border-radius:10px;margin:16px 0"><tr>';
      for (const col of (b.cols || [])) {
        body += `<td style="padding:16px 12px;text-align:center;vertical-align:top"><div style="font-size:22px;margin-bottom:4px">${col.icon || ''}</div><div style="font-size:10px;color:#8890a5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:2px">${rv(col.label)}</div><div style="font-size:14px;font-weight:600;color:#1a1f3c">${rv(col.value)}</div></td>`;
      }
      body += '</tr></table>';
    } else if (b.type === 'divider') {
      body += '<hr style="border:none;height:1px;background:#e8eaf5;margin:24px 0">';
    } else if (b.type === 'image' && b.url) {
      body += `<img src="${rv(b.url)}" alt="" style="width:100%;border-radius:8px;margin:16px 0">`;
    }
  }

  // Wrap mit Header + Footer
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6ff;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
<tr><td style="background:${accent};padding:28px 36px;text-align:center;border-radius:12px 12px 0 0">
<img src="${logo}" alt="${vars.hotelName || ''}" height="55" style="height:55px;filter:brightness(0) invert(1);-webkit-filter:brightness(0) invert(1)">
</td></tr>
<tr><td style="background:#ffffff;padding:40px 36px;border-radius:0 0 12px 12px">
${body}
<hr style="border:none;height:1px;background:#e8eaf5;margin:24px 0 16px">
<p style="font-size:13px;color:#8890a5;text-align:center;line-height:1.6;margin:0 0 12px">${vars.hotelName || ''}<br><a href="${vars.googleMapsUrl || `https://maps.google.com/?q=${encodeURIComponent(vars.address || '')}`}" style="color:#8890a5;text-decoration:none">${vars.address || ''}</a></p>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<a href="https://wa.me/${(vars.hotelPhone || '').replace(/[^0-9]/g, '')}" style="display:inline-block;padding:10px 24px;border-radius:8px;background:#25D366;color:#fff;text-decoration:none;font-size:13px;font-weight:600">&#128172; WhatsApp</a>
</td></tr></table>
</td></tr></table>
</td></tr></table></body></html>`;
}

function buildFallbackHtml(v) {
  const accent = v.primaryColor || '#3d4fbc';
  const logo = v.logoUrl || 'https://smarthotel-schmid.at/wp-content/uploads/2022/12/Logo-Smarthotel-SW-2-1.png';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6ff;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

<!-- HEADER -->
<tr><td style="background:${accent};padding:28px 36px;text-align:center;border-radius:12px 12px 0 0">
<img src="${logo}" alt="${v.hotelName || ''}" height="55" style="height:55px;filter:brightness(0) invert(1);-webkit-filter:brightness(0) invert(1)">
</td></tr>

<!-- BODY -->
<tr><td style="background:#ffffff;padding:40px 36px;border-radius:0 0 12px 12px">

<!-- Greeting -->
<p style="font-size:22px;font-weight:700;color:#1a1f3c;margin:0 0 8px">Guten Tag ${v.guestFirstName || 'Gast'},</p>
<p style="font-size:15px;color:#4a5067;line-height:1.65;margin:0 0 28px">alles ist f&uuml;r Ihren Aufenthalt vorbereitet. Ihren pers&ouml;nlichen Zugangscode und alle wichtigen Informationen finden Sie in Ihrem G&auml;steportal.</p>

<!-- CTA Button -->
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 0 32px">
<a href="${v.guestPortalLink || '#'}" style="display:inline-block;background:${accent};color:#ffffff;padding:16px 40px;border-radius:10px;text-decoration:none;font-size:16px;font-weight:600;letter-spacing:0.3px">Zum G&auml;steportal &rarr;</a>
</td></tr></table>

<!-- Info Box -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6ff;border-radius:10px;margin-bottom:28px"><tr>
<td width="33%" style="padding:20px 12px;text-align:center;vertical-align:top">
<div style="font-size:24px;margin-bottom:6px">&#128197;</div>
<div style="font-size:10px;color:#8890a5;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px">Check-in</div>
<div style="font-size:14px;font-weight:600;color:#1a1f3c">${v.checkIn || ''}</div>
<div style="font-size:12px;color:#8890a5">ab ${v.effectiveCheckInTime || '15:00'}</div>
</td>
<td width="33%" style="padding:20px 12px;text-align:center;vertical-align:top;border-left:1px solid #e8eaf5;border-right:1px solid #e8eaf5">
<div style="font-size:24px;margin-bottom:6px">&#128228;</div>
<div style="font-size:10px;color:#8890a5;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px">Check-out</div>
<div style="font-size:14px;font-weight:600;color:#1a1f3c">${v.checkOut || ''}</div>
<div style="font-size:12px;color:#8890a5">bis ${v.effectiveCheckOutTime || '11:00'}</div>
</td>
<td width="33%" style="padding:20px 12px;text-align:center;vertical-align:top">
<div style="font-size:24px;margin-bottom:6px">&#128716;</div>
<div style="font-size:10px;color:#8890a5;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px">Zimmer</div>
<div style="font-size:14px;font-weight:600;color:#1a1f3c">${v.roomName || ''}</div>
<div style="font-size:12px;color:#8890a5">${v.nights || ''} N&auml;chte</div>
</td>
</tr></table>

<!-- Divider -->
<hr style="border:none;height:1px;background:#e8eaf5;margin:0 0 24px">

<!-- Footer -->
<p style="font-size:13px;color:#8890a5;text-align:center;line-height:1.6;margin:0 0 12px">
${v.hotelName || 'smarthotel'}<br>
<a href="${v.googleMapsUrl || `https://maps.google.com/?q=${encodeURIComponent(v.address || '')}`}" style="color:#8890a5;text-decoration:none">${v.address || ''}</a>
</p>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<a href="https://wa.me/${(v.hotelPhone || '').replace(/[^0-9]/g, '')}" style="display:inline-block;padding:10px 24px;border-radius:8px;background:#25D366;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600">&#128172; WhatsApp</a>
</td></tr></table>

</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// Variablen im Template ersetzen
function replaceVars(text, vars) {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '');
}

function fmtDateDE(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.getDate()}.${dt.getMonth() + 1}.${dt.getFullYear()}`;
}

async function buildVars(booking, guest, settings) {
  return {
    guestName: booking.guestName || `${guest?.firstName || ''} ${guest?.lastName || ''}`.trim() || 'Gast',
    guestFirstName: guest?.firstName || '',
    guestEmail: guest?.email || booking.contactEmail || '',
    guestPhone: guest?.phone || booking.contactPhone || '',
    guestLanguage: guest?.preferredLanguage || 'de',
    doorCode: booking.doorAccess?.stayosCode || booking.doorAccess?.code || '',
    doorCodePin: booking.doorAccess?.stayosCode || booking.doorAccess?.code || '',
    checkIn: fmtDateDE(booking.checkIn),
    checkOut: fmtDateDE(booking.checkOut),
    roomName: booking.roomName || '',
    nights: String(booking.nights || ''),
    bookingNumber: booking.bookingNumber || '',
    totalPrice: booking.totalPrice ? `€ ${booking.totalPrice}` : '',
    mealPlan: booking.mealPlan || '',
    arrivalTime: settings?.checkInTime || '15:00',
    hotelName: settings?.hotelName || 'smarthotel schmid',
    hotelAddress: formatAddress(settings) || settings?.location || '',
    address: formatAddress(settings) || settings?.location || '',
    googleMapsUrl: settings?.googleMapsUrl || '',
    hotelPhone: settings?.hotelPhone || '',
    hotelPhoneWhatsapp: (settings?.hotelPhone || '').replace(/\D/g, ''),
    hotelEmail: settings?.hotelEmail || settings?.smtp?.user || '',
    hotelWebsite: settings?.hotelWebsite || '',
    receptionHours: settings?.receptionHours || '08:00 – 22:00',
    effectiveCheckInTime: booking.earlyCheckIn || settings?.checkInTime || '15:00',
    effectiveCheckOutTime: booking.lateCheckOut || settings?.checkOutTime || '11:00',
    primaryColor: '#b5a160', // wird unten von Property überschrieben
    logoUrl: '',
    tagline: '',
    emailFooter: '',
    emailSignature: '',
    guestPortalLink: booking.guestPortalToken ? `https://${settings?.customDomainVerified && settings?.customDomain ? settings.customDomain : settings?.slug ? settings.slug + '.stayos.at' : 'stayos.at'}/portal/${booking.guestPortalToken}` : '',
  };
}

// Einzelne Türcode-Email senden
async function sendDoorCodeEmail(bookingId) {
  const booking = await Booking.findById(bookingId);
  if (!booking || !booking.doorAccess?.stayosCode) return;

  const guest = booking.guestId ? await Guest.findById(booking.guestId).lean() : null;

  // Email-Empfänger: contactEmail → Gast-Email (auch Relay) → Firmen-Email
  let to = booking.contactEmail || guest?.email;
  if (!to) {
    // Fallback auf Firmen-Email wenn companyId vorhanden
    if (booking.companyId) {
      const Company = require('../models/Company');
      const company = await Company.findById(booking.companyId, 'contactEmail').lean();
      to = company?.contactEmail;
    }
    if (!to) return;
  }

  const settings = await Settings.findOne({ tenantId: TENANT_ID });
  const lang = guest?.preferredLanguage || 'de';
  const template = await EmailTemplate.findOne({ tenantId: TENANT_ID, type: 'doorcode' });

  const vars = await buildVars(booking, guest, settings);

  // CI-Variablen aus Property überschreiben
  const property = booking.propertyId ? await Property.findById(booking.propertyId, 'ci name').lean() : null;
  if (property?.ci) {
    vars.primaryColor = property.ci.primaryColor || vars.primaryColor;
    vars.logoUrl = property.ci.logoUrl || vars.logoUrl;
    vars.tagline = property.ci.tagline || vars.tagline;
    vars.emailFooter = property.ci.emailFooter || vars.emailFooter;
    vars.emailSignature = property.ci.emailSignature || vars.emailSignature;
  }

  let subject = replaceVars(template?.subject?.[lang] || template?.subject?.de || 'Ihr Türcode — {{hotelName}}', vars);
  let html = template?.contentHtml?.[lang] || template?.contentHtml?.de || '';
  // Fallback: contentJson Blocks zu HTML rendern wenn contentHtml leer
  if (!html) {
    const blocks = template?.contentJson?.[lang] || template?.contentJson?.de || [];
    if (blocks.length > 0) {
      html = renderBlocksToHtml(blocks, vars);
    }
  }
  // Letzter Fallback: professionelles HTML Template
  if (!html) {
    html = buildFallbackHtml(vars);
  }
  html = replaceVars(html, vars);

  if (!html) return;

  await sendEmail({ tenantId: TENANT_ID, to, subject, html });
  await Booking.updateOne({ _id: bookingId }, { $set: { 'communication.doorCodeSent': true } });
  console.log(`[DoorCodeEmail] Gesendet an ${to} (${booking.bookingNumber})`);
}

// Batch: alle heutigen Buchungen mit Code aber ohne gesendete Email
async function sendDoorCodeEmailsForToday() {
  const template = await EmailTemplate.findOne({ tenantId: TENANT_ID, type: 'doorcode' });
  const daysBefore = template?.daysBefore !== undefined ? template.daysBefore : 1;

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysBefore);
  const start = new Date(targetDate); start.setHours(0, 0, 0, 0);
  const end = new Date(targetDate); end.setHours(23, 59, 59, 999);

  const bookings = await Booking.find({
    tenantId: TENANT_ID,
    checkIn: { $gte: start, $lte: end },
    status: { $in: ['confirmed', 'checked-in'] },
    'doorAccess.stayosCode': { $exists: true, $ne: null },
    'communication.doorCodeSent': { $ne: true },
  });

  if (bookings.length === 0) {
    console.log('[DoorCodeEmail] Keine Emails zu senden');
    return { sent: 0 };
  }

  let sent = 0;
  for (const booking of bookings) {
    try {
      await sendDoorCodeEmail(booking._id);
      sent++;
    } catch (e) {
      console.error(`[DoorCodeEmail] Fehler ${booking.bookingNumber}:`, e.message);
    }
  }
  console.log(`[DoorCodeEmail] ${sent}/${bookings.length} Emails gesendet`);
  return { sent, total: bookings.length };
}

module.exports = { sendDoorCodeEmail, sendDoorCodeEmailsForToday };

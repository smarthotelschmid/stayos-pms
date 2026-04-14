const Booking = require('../models/Booking');
const Guest = require('../models/Guest');
const Company = require('../models/Company');
const Settings = require('../models/Settings');
const Property = require('../models/Property');
const EmailTemplate = require('../models/EmailTemplate');
const { sendEmail } = require('./emailService');
const { formatAddress } = require('../utils/formatAddress');

const TENANT_ID = '507f1f77bcf86cd799439011';

function fmtDateDE(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.getDate()}.${dt.getMonth() + 1}.${dt.getFullYear()}`;
}

function replaceVars(text, vars) {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    return (v === undefined || v === null || v === '') ? '' : String(v);
  });
}

async function resolveRecipient(booking, guest) {
  let to = booking.contactEmail || guest?.email;
  if (!to && booking.companyId) {
    const company = await Company.findById(booking.companyId, 'contactEmail').lean();
    to = company?.contactEmail;
  }
  return to || null;
}

async function buildVars(booking, guest, settings, property) {
  const doorCode = booking.doorAccess?.stayosCode || booking.doorAccess?.code || '';
  return {
    guestName: booking.guestName || `${guest?.firstName || ''} ${guest?.lastName || ''}`.trim() || 'Gast',
    guestFirstName: guest?.firstName || '',
    guestLastName: guest?.lastName || '',
    guestEmail: guest?.email || booking.contactEmail || '',
    guestPhone: guest?.phone || booking.contactPhone || '',
    checkIn: fmtDateDE(booking.checkIn),
    checkOut: fmtDateDE(booking.checkOut),
    roomName: booking.roomName || '',
    nights: String(booking.nights || ''),
    bookingNumber: booking.bookingNumber || '',
    doorCode: doorCode || 'wird separat zugestellt',
    totalPrice: booking.pricing?.total ? `€ ${booking.pricing.total}` : '',
    mealPlan: booking.mealPlan || '',
    hotelName: settings?.hotelName || 'smarthotel schmid',
    hotelAddress: formatAddress(settings) || settings?.location || '',
    address: formatAddress(settings) || settings?.location || '',
    hotelPhone: settings?.hotelPhone || '',
    hotelEmail: settings?.hotelEmail || settings?.smtp?.user || 'booking@smarthotel-schmid.at',
    hotelWebsite: settings?.hotelWebsite || '',
    googleMapsUrl: settings?.googleMapsUrl || '',
    effectiveCheckInTime: booking.earlyCheckIn || settings?.checkInTime || '15:00',
    effectiveCheckOutTime: booking.lateCheckOut || settings?.checkOutTime || '11:00',
    primaryColor: property?.ci?.primaryColor || '#3d4fbc',
    logoUrl: property?.ci?.logoUrl || 'https://smarthotel-schmid.at/wp-content/uploads/2022/12/Logo-Smarthotel-SW-2-1.png',
  };
}

// ─── HTML Fallback Templates ─────────────────────────────────────────────────

function wrapHtml(bodyHtml, v) {
  const accent = v.primaryColor || '#3d4fbc';
  const logo = v.logoUrl;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6ff;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
<tr><td style="background:${accent};padding:28px 36px;text-align:center;border-radius:12px 12px 0 0">
<img src="${logo}" alt="${v.hotelName || ''}" height="55" style="height:55px;filter:brightness(0) invert(1);-webkit-filter:brightness(0) invert(1)">
</td></tr>
<tr><td style="background:#ffffff;padding:40px 36px;border-radius:0 0 12px 12px">
${bodyHtml}
<hr style="border:none;height:1px;background:#e8eaf5;margin:24px 0 16px">
<p style="font-size:13px;color:#8890a5;text-align:center;line-height:1.6;margin:0 0 12px">${v.hotelName || ''}<br><a href="${v.googleMapsUrl || `https://maps.google.com/?q=${encodeURIComponent(v.address || '')}`}" style="color:#8890a5;text-decoration:none">${v.address || ''}</a></p>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<a href="https://wa.me/${(v.hotelPhone || '').replace(/[^0-9]/g, '')}" style="display:inline-block;padding:10px 24px;border-radius:8px;background:#25D366;color:#fff;text-decoration:none;font-size:13px;font-weight:600">&#128172; WhatsApp</a>
</td></tr></table>
</td></tr></table>
</td></tr></table></body></html>`;
}

function buildConfirmationHtml(v) {
  const accent = v.primaryColor || '#3d4fbc';
  const body = `
<p style="font-size:22px;font-weight:700;color:#1a1f3c;margin:0 0 8px">Guten Tag ${v.guestFirstName || v.guestName || 'Gast'},</p>
<p style="font-size:15px;color:#4a5067;line-height:1.65;margin:0 0 20px">vielen Dank f&uuml;r Ihre Buchung bei ${v.hotelName}! Wir freuen uns auf Ihren Besuch.</p>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6ff;border-radius:10px;margin:8px 0 24px"><tr>
<td width="33%" style="padding:20px 12px;text-align:center;vertical-align:top">
<div style="font-size:24px;margin-bottom:6px">&#128197;</div>
<div style="font-size:10px;color:#8890a5;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px">Check-in</div>
<div style="font-size:14px;font-weight:600;color:#1a1f3c">${v.checkIn}</div>
<div style="font-size:12px;color:#8890a5">ab ${v.effectiveCheckInTime}</div>
</td>
<td width="33%" style="padding:20px 12px;text-align:center;vertical-align:top;border-left:1px solid #e8eaf5;border-right:1px solid #e8eaf5">
<div style="font-size:24px;margin-bottom:6px">&#128228;</div>
<div style="font-size:10px;color:#8890a5;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px">Check-out</div>
<div style="font-size:14px;font-weight:600;color:#1a1f3c">${v.checkOut}</div>
<div style="font-size:12px;color:#8890a5">bis ${v.effectiveCheckOutTime}</div>
</td>
<td width="33%" style="padding:20px 12px;text-align:center;vertical-align:top">
<div style="font-size:24px;margin-bottom:6px">&#128716;</div>
<div style="font-size:10px;color:#8890a5;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px">Zimmer</div>
<div style="font-size:14px;font-weight:600;color:#1a1f3c">${v.roomName}</div>
<div style="font-size:12px;color:#8890a5">${v.nights} N&auml;chte</div>
</td>
</tr></table>

<p style="font-size:13px;color:#8890a5;text-align:center;margin:0 0 8px">Buchungsnummer</p>
<p style="font-size:18px;font-weight:700;color:${accent};text-align:center;letter-spacing:1px;margin:0 0 24px">${v.bookingNumber}</p>

<p style="font-size:14px;color:#4a5067;line-height:1.65;margin:0 0 8px">Ihren pers&ouml;nlichen T&uuml;rcode senden wir Ihnen rechtzeitig vor Ihrer Anreise in einer separaten E-Mail.</p>`;
  return wrapHtml(body, v);
}

function buildConfirmationText(v) {
  return [
    `Guten Tag ${v.guestFirstName || v.guestName || 'Gast'},`,
    ``,
    `vielen Dank fuer Ihre Buchung bei ${v.hotelName}!`,
    `Wir freuen uns auf Ihren Besuch.`,
    ``,
    `Ihre Buchung:`,
    `* Check-in:  ${v.checkIn} ab ${v.effectiveCheckInTime}`,
    `* Check-out: ${v.checkOut} bis ${v.effectiveCheckOutTime}`,
    `* Zimmer:    ${v.roomName}`,
    `* Naechte:   ${v.nights}`,
    `* Nummer:    ${v.bookingNumber}`,
    ``,
    `Ihren Tuercode senden wir Ihnen rechtzeitig vor Anreise separat zu.`,
    ``,
    `Adresse:`,
    `${v.hotelName}`,
    `${v.address}`,
    v.googleMapsUrl ? v.googleMapsUrl : `https://maps.google.com/?q=${encodeURIComponent(v.address || '')}`,
    ``,
    `Bei Fragen erreichen Sie uns unter:`,
    `* Telefon: ${v.hotelPhone}`,
    `* E-Mail:  ${v.hotelEmail}`,
    v.hotelWebsite ? `* Web:     ${v.hotelWebsite}` : null,
    ``,
    `Herzliche Gruesse`,
    `${v.hotelName}`,
  ].filter(l => l !== null).join('\n');
}

function buildCancellationHtml(v) {
  const accent = v.primaryColor || '#3d4fbc';
  const body = `
<p style="font-size:22px;font-weight:700;color:#1a1f3c;margin:0 0 8px">Guten Tag ${v.guestFirstName || v.guestName || 'Gast'},</p>
<p style="font-size:15px;color:#4a5067;line-height:1.65;margin:0 0 20px">hiermit best&auml;tigen wir die Stornierung Ihrer Buchung bei ${v.hotelName}.</p>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6ff;border-radius:10px;margin:8px 0 24px"><tr>
<td width="33%" style="padding:20px 12px;text-align:center;vertical-align:top">
<div style="font-size:24px;margin-bottom:6px">&#128197;</div>
<div style="font-size:10px;color:#8890a5;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px">Check-in</div>
<div style="font-size:14px;font-weight:600;color:#1a1f3c">${v.checkIn}</div>
</td>
<td width="33%" style="padding:20px 12px;text-align:center;vertical-align:top;border-left:1px solid #e8eaf5;border-right:1px solid #e8eaf5">
<div style="font-size:24px;margin-bottom:6px">&#128228;</div>
<div style="font-size:10px;color:#8890a5;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px">Check-out</div>
<div style="font-size:14px;font-weight:600;color:#1a1f3c">${v.checkOut}</div>
</td>
<td width="33%" style="padding:20px 12px;text-align:center;vertical-align:top">
<div style="font-size:24px;margin-bottom:6px">&#128716;</div>
<div style="font-size:10px;color:#8890a5;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px">Zimmer</div>
<div style="font-size:14px;font-weight:600;color:#1a1f3c">${v.roomName}</div>
</td>
</tr></table>

<p style="font-size:13px;color:#8890a5;text-align:center;margin:0 0 8px">Buchungsnummer</p>
<p style="font-size:18px;font-weight:700;color:${accent};text-align:center;letter-spacing:1px;margin:0 0 24px">${v.bookingNumber}</p>

<p style="font-size:14px;color:#4a5067;line-height:1.65;margin:0 0 8px">Sollte die Stornierung irrt&uuml;mlich erfolgt sein, melden Sie sich bitte umgehend bei uns. Wir w&uuml;rden uns freuen, Sie zu einem sp&auml;teren Zeitpunkt bei uns begr&uuml;&szlig;en zu d&uuml;rfen.</p>`;
  return wrapHtml(body, v);
}

function buildCancellationText(v) {
  return [
    `Guten Tag ${v.guestFirstName || v.guestName || 'Gast'},`,
    ``,
    `hiermit bestaetigen wir die Stornierung Ihrer Buchung bei ${v.hotelName}.`,
    ``,
    `Stornierte Buchung:`,
    `* Check-in:  ${v.checkIn}`,
    `* Check-out: ${v.checkOut}`,
    `* Zimmer:    ${v.roomName}`,
    `* Nummer:    ${v.bookingNumber}`,
    ``,
    `Sollte die Stornierung irrtuemlich erfolgt sein, melden Sie sich bitte`,
    `umgehend bei uns. Wir wuerden uns freuen, Sie zu einem spaeteren Zeitpunkt`,
    `bei uns begruessen zu duerfen.`,
    ``,
    `Bei Fragen erreichen Sie uns unter:`,
    `* Telefon: ${v.hotelPhone}`,
    `* E-Mail:  ${v.hotelEmail}`,
    ``,
    `Herzliche Gruesse`,
    `${v.hotelName}`,
  ].join('\n');
}

// ─── Send-Funktionen ─────────────────────────────────────────────────────────

async function loadContext(bookingId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) return null;
  const guest = booking.guestId ? await Guest.findById(booking.guestId).lean() : null;
  const settings = await Settings.findOne({ tenantId: TENANT_ID });
  const property = booking.propertyId ? await Property.findById(booking.propertyId, 'ci name').lean() : null;
  return { booking, guest, settings, property };
}

async function sendConfirmationEmail(bookingId) {
  const ctx = await loadContext(bookingId);
  if (!ctx) return;
  const { booking, guest, settings, property } = ctx;

  if (booking.communication?.confirmationSent) {
    console.log(`[ConfirmationEmail] Übersprungen (bereits gesendet): ${booking.bookingNumber}`);
    return;
  }

  const to = await resolveRecipient(booking, guest);
  if (!to) {
    console.log(`[ConfirmationEmail] Keine Empfängeradresse: ${booking.bookingNumber}`);
    return;
  }

  const lang = guest?.preferredLanguage || 'de';
  const template = await EmailTemplate.findOne({ tenantId: TENANT_ID, type: 'confirmation' });
  const vars = await buildVars(booking, guest, settings, property);

  const subject = replaceVars(
    template?.subject?.[lang] || template?.subject?.de || 'Buchungsbestätigung — {{hotelName}}',
    vars
  );
  const htmlTpl = template?.contentHtml?.[lang] || template?.contentHtml?.de || '';
  const textTpl = template?.contentText?.[lang] || template?.contentText?.de || '';
  const html = replaceVars(htmlTpl || buildConfirmationHtml(vars), vars);
  const text = replaceVars(textTpl || buildConfirmationText(vars), vars);

  await sendEmail({ tenantId: TENANT_ID, to, subject, html, text });
  await Booking.updateOne({ _id: bookingId }, { $set: { 'communication.confirmationSent': true } });
  console.log(`[ConfirmationEmail] Gesendet an ${to} (${booking.bookingNumber})`);
}

async function sendCancellationEmail(bookingId) {
  const ctx = await loadContext(bookingId);
  if (!ctx) return;
  const { booking, guest, settings, property } = ctx;

  if (booking.communication?.cancellationSent) {
    console.log(`[CancellationEmail] Übersprungen (bereits gesendet): ${booking.bookingNumber}`);
    return;
  }

  const to = await resolveRecipient(booking, guest);
  if (!to) {
    console.log(`[CancellationEmail] Keine Empfängeradresse: ${booking.bookingNumber}`);
    return;
  }

  const lang = guest?.preferredLanguage || 'de';
  const template = await EmailTemplate.findOne({ tenantId: TENANT_ID, type: 'cancellation' });
  const vars = await buildVars(booking, guest, settings, property);

  const subject = replaceVars(
    template?.subject?.[lang] || template?.subject?.de || 'Stornierungsbestätigung — {{hotelName}}',
    vars
  );
  const htmlTpl = template?.contentHtml?.[lang] || template?.contentHtml?.de || '';
  const textTpl = template?.contentText?.[lang] || template?.contentText?.de || '';
  const html = replaceVars(htmlTpl || buildCancellationHtml(vars), vars);
  const text = replaceVars(textTpl || buildCancellationText(vars), vars);

  await sendEmail({ tenantId: TENANT_ID, to, subject, html, text });
  await Booking.updateOne({ _id: bookingId }, { $set: { 'communication.cancellationSent': true } });
  console.log(`[CancellationEmail] Gesendet an ${to} (${booking.bookingNumber})`);
}

module.exports = {
  sendConfirmationEmail,
  sendCancellationEmail,
  buildConfirmationHtml,
  buildConfirmationText,
  buildCancellationHtml,
  buildCancellationText,
};

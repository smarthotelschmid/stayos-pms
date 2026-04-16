const Booking = require('../models/Booking');
const Guest = require('../models/Guest');
const Company = require('../models/Company');
const Settings = require('../models/Settings');
const Property = require('../models/Property');
const EmailTemplate = require('../models/EmailTemplate');
const { sendEmail } = require('./emailService');
const { formatAddress } = require('../utils/formatAddress');
const { titleCase } = require('../utils/formatName');
const { wrapHtml } = require('../utils/emailLayout');
const { buildGuestPortalUrl } = require('../utils/guestPortalUrl');

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
    const company = await Company.findOne({ _id: booking.companyId, tenantId: TENANT_ID }, 'contactEmail').lean();
    to = company?.contactEmail;
  }
  return to || null;
}

async function buildVars(booking, guest, settings, property) {
  const doorCode = booking.doorAccess?.stayosCode || booking.doorAccess?.code || '';
  // Kontaktdaten: Property Vorrang, Settings Tenant-Default, sonst leer
  const propAddress = property ? formatAddress(property) : '';
  const setAddress  = formatAddress(settings);
  const hotelAddress = propAddress || setAddress || '';
  return {
    guestName: titleCase(booking.guestName || `${guest?.firstName || ''} ${guest?.lastName || ''}`.trim()) || 'Gast',
    guestFirstName: titleCase(guest?.firstName || ''),
    guestLastName: titleCase(guest?.lastName || ''),
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
    hotelName: property?.name || settings?.hotelName || '',
    hotelAddress,
    address: hotelAddress,
    hotelPhone: property?.hotelPhone || settings?.hotelPhone || '',
    hotelEmail: property?.hotelEmail || settings?.hotelEmail || '',
    hotelWebsite: property?.hotelWebsite || settings?.hotelWebsite || '',
    receptionHours: property?.receptionHours || settings?.receptionHours || '',
    googleMapsUrl: property?.googleMapsUrl || settings?.googleMapsUrl || '',
    effectiveCheckInTime: booking.earlyCheckIn || property?.checkInTime || settings?.checkInTime || '',
    effectiveCheckOutTime: booking.lateCheckOut || property?.checkOutTime || settings?.checkOutTime || '',
    primaryColor: property?.ci?.primaryColor || '',
    logoUrl: property?.ci?.logoUrl || property?.logoUrl || '',
    guestPortalUrl: buildGuestPortalUrl(booking.guestPortalToken, settings),
    // Alias — Legacy-Templates nutzen {{guestPortalLink}} (doorcode-Pfad)
    guestPortalLink: buildGuestPortalUrl(booking.guestPortalToken, settings),
  };
}

// ─── HTML Fallback Templates ─────────────────────────────────────────────────
// Body-Only — Shell (Header/Footer) kommt aus emailLayout.wrapHtml.
// Die Sender-Funktionen rufen wrapHtml(body, vars) konsistent nach dem
// Variablen-Replace, egal ob body aus DB-Template oder aus Fallback kommt.

function buildConfirmationBody(v) {
  const accent = v.primaryColor || '#3d4fbc';
  return `
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
}

function buildConfirmationText(v) {
  const lines = (v.greetingText || '').split('\n').map(l => l.trim()).filter(Boolean);
  const closingLine = lines.find(l => l.startsWith('Wir ') || l.startsWith('We ')) || '';
  const introLines = lines.filter(l => l !== closingLine).join('\n');
  const portalLine = v.guestPortalLink ? `Zum Gästeportal: ${v.guestPortalLink}` : '';
  const intro = introLines || `Guten Tag ${v.guestFirstName || v.guestName || 'Gast'},\n\nvielen Dank für Ihre Buchung bei ${v.hotelName}! Wir freuen uns auf Ihren Besuch.`;
  const closing = closingLine || `Wir freuen uns auf Ihren Besuch im ${v.hotelName}.`;
  return [intro, portalLine, closing].filter(Boolean).join('\n\n');
}

function buildCancellationBody(v) {
  const accent = v.primaryColor || '#3d4fbc';
  return `
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
}

function buildCancellationText(v) {
  const lines = (v.greetingText || '').split('\n').map(l => l.trim()).filter(Boolean);
  const closingLine = lines.find(l => l.startsWith('Wir ') || l.startsWith('We ') || l.startsWith('Sollte')) || '';
  const introLines = lines.filter(l => l !== closingLine).join('\n');
  const intro = introLines || `Guten Tag ${v.guestFirstName || v.guestName || 'Gast'},\n\nhiermit bestätigen wir die Stornierung Ihrer Buchung bei ${v.hotelName}.`;
  const closing = closingLine || `Wir würden uns freuen, Sie zu einem späteren Zeitpunkt bei uns begrüßen zu dürfen.`;
  return [intro, closing].filter(Boolean).join('\n\n');
}

// ─── Send-Funktionen ─────────────────────────────────────────────────────────

async function loadContext(bookingId) {
  const booking = await Booking.findOne({ _id: bookingId, tenantId: TENANT_ID });
  if (!booking) return null;
  const guest = booking.guestId ? await Guest.findOne({ _id: booking.guestId, tenantId: TENANT_ID }).lean() : null;
  const settings = await Settings.findOne({ tenantId: TENANT_ID });
  // Property: primär aus booking.propertyId, sonst erste aktive Property des Tenants
  // (damit Direktbuchungen ohne explizite Property-Verknüpfung trotzdem Logo+CI bekommen)
  let property = booking.propertyId
    ? await Property.findOne({ _id: booking.propertyId, tenantId: TENANT_ID }).lean()
    : null;
  if (!property) {
    property = await Property.findOne({ tenantId: TENANT_ID, active: { $ne: false } }).sort({ createdAt: 1 }).lean();
  }
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
  const greetingBlocks = template?.contentJson?.[lang] || template?.contentJson?.de || [];
  const greetingBlock = Array.isArray(greetingBlocks) ? greetingBlocks.find(b => b?.type === 'text' && b?.content) : null;
  vars.greetingText = greetingBlock?.content || '';

  const subject = replaceVars(
    template?.subject?.[lang] || template?.subject?.de || 'Buchungsbestätigung — {{hotelName}}',
    vars
  );
  const htmlTpl = template?.contentHtml?.[lang] || template?.contentHtml?.de || '';
  const textTpl = template?.contentText?.[lang] || template?.contentText?.de || '';
  const bodyHtml = replaceVars(htmlTpl || buildConfirmationBody(vars), vars);
  const html = wrapHtml(bodyHtml, vars);
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
  const greetingBlocks = template?.contentJson?.[lang] || template?.contentJson?.de || [];
  const greetingBlock = Array.isArray(greetingBlocks) ? greetingBlocks.find(b => b?.type === 'text' && b?.content) : null;
  vars.greetingText = greetingBlock?.content || '';

  const subject = replaceVars(
    template?.subject?.[lang] || template?.subject?.de || 'Stornierungsbestätigung — {{hotelName}}',
    vars
  );
  const htmlTpl = template?.contentHtml?.[lang] || template?.contentHtml?.de || '';
  const textTpl = template?.contentText?.[lang] || template?.contentText?.de || '';
  const bodyHtml = replaceVars(htmlTpl || buildCancellationBody(vars), vars);
  const html = wrapHtml(bodyHtml, vars);
  const text = replaceVars(textTpl || buildCancellationText(vars), vars);

  await sendEmail({ tenantId: TENANT_ID, to, subject, html, text });
  await Booking.updateOne({ _id: bookingId }, { $set: { 'communication.cancellationSent': true } });
  console.log(`[CancellationEmail] Gesendet an ${to} (${booking.bookingNumber})`);
}

module.exports = {
  sendConfirmationEmail,
  sendCancellationEmail,
  buildConfirmationBody,
  buildConfirmationText,
  buildCancellationBody,
  buildCancellationText,
  buildVars,
  loadContext,
};

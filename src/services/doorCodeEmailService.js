const Booking = require('../models/Booking');
const Guest = require('../models/Guest');
const EmailTemplate = require('../models/EmailTemplate');
const Settings = require('../models/Settings');
const Property = require('../models/Property');
const { sendEmail } = require('./emailService');
const { formatAddress } = require('../utils/formatAddress');
const { titleCase } = require('../utils/formatName');
const { wrapHtml } = require('../utils/emailLayout');
const { buildGuestPortalUrl } = require('../utils/guestPortalUrl');

const TENANT_ID = '507f1f77bcf86cd799439011';

// ─── Body-Renderer ────────────────────────────────────────────────────────────
// Kein eigenes HTML-Shell mehr — Header/Footer kommen via wrapHtml().

// Rendert contentJson Blocks (Visual Block Editor) zu reinem Body-HTML.
function renderBlocksBody(blocks, vars) {
  const rv = (s) => Object.entries(vars).reduce((t, [k, v]) => t.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v || ''), s || '');
  const accent = vars.primaryColor || '#3d4fbc';
  let body = '';
  for (const b of blocks) {
    if (b.type === 'text') {
      const tc = vars.textColor || '#1a1f3c'; const size = b.size === 'small' ? 'font-size:13px;color:#8890a5;' : 'font-size:15px;color:' + tc + ';line-height:1.65;';
      const align = b.align ? `text-align:${b.align};` : '';
      body += `<p style="${size}${align}margin:0 0 16px">${rv(b.content).replace(/\n/g, '<br>')}</p>`;
    } else if (b.type === 'button') {
      const color = b.color || accent;
      body += `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="${b.align || 'center'}" style="padding:8px 0 24px"><a href="${rv(b.url)}" style="display:inline-block;background:${color};color:#fff;padding:16px 40px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px">${rv(b.content)}</a></td></tr></table>`;
    } else if (b.type === 'columns') {
      body += '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6ff;border-radius:10px;margin:16px 0"><tr>';
      for (const col of (b.cols || [])) {
        body += `<td style="padding:16px 12px;text-align:center;vertical-align:top"><div style="font-size:22px;margin-bottom:4px">${col.icon || ''}</div><div style="font-size:10px;color:#8890a5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:2px">${rv(col.label)}</div><div style="font-size:14px;font-weight:600;color:${vars.textColor || '#1a1f3c'}">${rv(col.value)}</div></td>`;
      }
      body += '</tr></table>';
    } else if (b.type === 'divider') {
      body += '<hr style="border:none;height:1px;background:#e8eaf5;margin:24px 0">';
    } else if (b.type === 'image' && b.url) {
      body += `<img src="${rv(b.url)}" alt="" style="width:100%;border-radius:8px;margin:16px 0">`;
    }
  }
  return body;
}

// Fallback-Body für Türcode-Mail (Greeting + CTA + Info-Box).
function buildFallbackBody(v) {
  const accent = v.primaryColor || '#3d4fbc';
  const textColor = v.textColor || '#1a1f3c';
  const greetingHtml = v.greetingText
    ? v.greetingText.split('\n').filter(Boolean).map(line =>
        '<p style="font-size:15px;color:' + textColor + ';line-height:1.65;margin:0 0 12px">' + line + '</p>'
      ).join('')
    : '<p style="font-size:15px;color:' + textColor + ';line-height:1.65;margin:0 0 20px">alles ist f&uuml;r Ihren Aufenthalt vorbereitet. Ihren pers&ouml;nlichen Zugangscode und alle wichtigen Informationen finden Sie in Ihrem G&auml;steportal.</p>';

  const portalButton = v.guestPortalLink
    ? '<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td align="center"><a href="' + v.guestPortalLink + '" style="display:inline-block;background:' + accent + ';color:#ffffff;padding:16px 40px;border-radius:10px;text-decoration:none;font-size:16px;font-weight:600;letter-spacing:0.3px">Zum G&auml;steportal &rarr;</a></td></tr></table>'
    : '';

  return greetingHtml + portalButton;
}

// Plain-Text-Fallback — baut den Text ausschliesslich aus Template-Feldern:
//   1. template.subject[lang]        (als Einleitungszeile)
//   2. erster text-Block aus template.contentJson[lang] (der Begruessungstext
//      aus dem Visual Editor)
// Gibt '' zurueck wenn Template leer ist; emailService strippt dann notfalls
// das HTML als Text-Alternative. Kein hardcoded String.
function buildFallbackText(template, lang, vars = {}) {
  const blocks = template?.contentJson?.[lang] || template?.contentJson?.de || [];
  const firstText = blocks.find(b => b?.type === 'text' && b?.content);
  const greetingText = firstText?.content || '';

  // Letzten Satz (Wir wünschen...) vom Begrüßungstext trennen
  const textLines = greetingText.split('\n').map(l => l.trim()).filter(Boolean);
  const closingLine = textLines.find(l => l.startsWith('Wir ') || l.startsWith('We ')) || '';
  const introLines = textLines.filter(l => l !== closingLine).join('\n');

  const portalLine = vars.guestPortalLink
    ? `Zum Gästeportal: ${vars.guestPortalLink}`
    : '';

  return [introLines, portalLine, closingLine].filter(Boolean).join('\n\n');
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

// Kontaktdaten: Property hat Vorrang, Settings als Tenant-weiter Default.
// Fehlt ein Feld in beiden → leer.
async function buildVars(booking, guest, settings, property) {
  const propAddress = property ? formatAddress(property) : '';
  const setAddress  = formatAddress(settings);
  const hotelAddress = propAddress || setAddress || '';
  const hotelPhone   = property?.hotelPhone || settings?.hotelPhone || '';
  return {
    guestName: titleCase(booking.guestName || `${guest?.firstName || ''} ${guest?.lastName || ''}`.trim()) || 'Gast',
    guestFirstName: titleCase(guest?.firstName || ''),
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
    arrivalTime: property?.checkInTime || settings?.checkInTime || '',
    hotelName: property?.name || settings?.hotelName || '',
    hotelAddress,
    address: hotelAddress,
    googleMapsUrl: property?.googleMapsUrl || settings?.googleMapsUrl || '',
    hotelPhone,
    hotelPhoneWhatsapp: hotelPhone.replace(/\D/g, ''),
    hotelEmail: property?.hotelEmail || settings?.hotelEmail || '',
    hotelWebsite: property?.hotelWebsite || settings?.hotelWebsite || '',
    receptionHours: property?.receptionHours || settings?.receptionHours || '',
    effectiveCheckInTime: booking.earlyCheckIn || property?.checkInTime || settings?.checkInTime || '',
    effectiveCheckOutTime: booking.lateCheckOut || property?.checkOutTime || settings?.checkOutTime || '',
    primaryColor: property?.ci?.primaryColor || '',
    textColor: property?.ci?.textColor || '',
    logoUrl: property?.ci?.logoUrl || property?.logoUrl || '',
    tagline: property?.ci?.tagline || '',
    emailFooter: property?.ci?.emailFooter || '',
    emailSignature: property?.ci?.emailSignature || '',
    guestPortalLink: buildGuestPortalUrl(booking.guestPortalToken, settings),
    // Alias — bookingEmailService-Templates nutzen {{guestPortalUrl}}
    guestPortalUrl: buildGuestPortalUrl(booking.guestPortalToken, settings),
  };
}

// Einzelne Türcode-Email senden.
// Opts:
//   overrideEmail — Empfänger überschreiben (Test-Mode). Bei gesetzter
//                   overrideEmail wird der doorCodeSent-Guard und das
//                   Setzen des Flags übersprungen.
//   forceFormat   — 'html' | 'text' — Auto-Wahl in sendEmail überschreiben.
async function sendDoorCodeEmail(bookingId, { overrideEmail, forceFormat } = {}) {
  const booking = await Booking.findOne({ _id: bookingId, tenantId: TENANT_ID });
  if (!booking || !booking.doorAccess?.stayosCode) return;

  const isTestMode = !!overrideEmail;
  if (!isTestMode && booking.communication?.doorCodeSent) {
    console.log(`[DoorCodeEmail] Übersprungen (bereits gesendet): ${booking.bookingNumber}`);
    return;
  }

  const guest = (booking.guestId || booking.bookedBy) ? await Guest.findOne({ _id: (booking.guestId || booking.bookedBy), tenantId: TENANT_ID }).lean() : null;

  // Empfänger: overrideEmail > contactEmail > Gast-Email > Firmen-Email
  let to = overrideEmail || booking.contactEmail || guest?.email || guest?.emailRelay;
  if (!to) {
    if (booking.companyId) {
      const Company = require('../models/Company');
      const company = await Company.findOne({ _id: booking.companyId, tenantId: TENANT_ID }, 'contactEmail').lean();
      to = company?.contactEmail;
    }
    if (!to) return;
  }

  const settings = await Settings.findOne({ tenantId: TENANT_ID });
  const lang = guest?.preferredLanguage || 'de';
  const template = await EmailTemplate.findOne({ tenantId: TENANT_ID, type: 'doorcode' });
  let property = booking.propertyId
    ? await Property.findOne({ _id: booking.propertyId, tenantId: TENANT_ID }).lean()
    : null;
  if (!property) {
    property = await Property.findOne({ tenantId: TENANT_ID, active: { $ne: false } }).sort({ createdAt: 1 }).lean();
  }

  const vars = await buildVars(booking, guest, settings, property);

  // greetingText aus DB-Template laden
  const greetingBlocks = template?.contentJson?.[lang] || template?.contentJson?.de || [];
  const greetingBlock = Array.isArray(greetingBlocks) ? greetingBlocks.find(b => b?.type === 'text' && b?.content) : null;
  vars.greetingText = greetingBlock?.content || '';

  const subject = replaceVars(template?.subject?.[lang] || template?.subject?.de || 'Ihr Türcode — {{hotelName}}', vars);

  // Body: immer buildFallbackBody (Begrüßungstext + Portal-Button)
  const body = replaceVars(buildFallbackBody(vars), vars);

  const html = wrapHtml(body, vars);

  // Plain Text: DB-Template zuerst, sonst aus subject + contentJson Block bauen
  let text = template?.contentText?.[lang] || template?.contentText?.de || '';
  if (!text) text = buildFallbackText(template, lang, vars);
  text = replaceVars(text, vars);

  await sendEmail({ tenantId: TENANT_ID, to, subject, html, text, forceFormat });

  if (!isTestMode) {
    await Booking.updateOne({ _id: bookingId, tenantId: TENANT_ID }, { $set: { 'communication.doorCodeSent': true } });
  }
  console.log(`[DoorCodeEmail] Gesendet an ${to} (${booking.bookingNumber})${isTestMode ? ' [TEST]' : ''}`);
}

// Batch: alle heutigen Buchungen mit Code aber ohne gesendete Email
async function sendDoorCodeEmailsForToday() {
  const template = await EmailTemplate.findOne({ tenantId: TENANT_ID, type: 'doorcode' });
  const daysBefore = template?.daysBefore !== undefined ? template.daysBefore : 0;

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

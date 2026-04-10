const Booking = require('../models/Booking');
const Guest = require('../models/Guest');
const EmailTemplate = require('../models/EmailTemplate');
const Settings = require('../models/Settings');
const Property = require('../models/Property');
const { sendEmail } = require('./emailService');
const { formatAddress } = require('../utils/formatAddress');

const TENANT_ID = '507f1f77bcf86cd799439011';

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
  // Fallback: wenn HTML leer, einfaches Template generieren
  if (!html) {
    html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px"><h2>${vars.hotelName}</h2><p>Guten Tag ${vars.guestFirstName},</p><p>alles ist für Ihren Aufenthalt vorbereitet.</p><p><a href="${vars.guestPortalLink}" style="background:#3d4fbc;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600">Zum Gästeportal →</a></p><p style="color:#888;font-size:13px">${vars.checkIn} – ${vars.checkOut} · ${vars.roomName}</p></div>`;
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

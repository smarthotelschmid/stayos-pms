const Booking = require('../models/Booking');
const Guest = require('../models/Guest');
const Company = require('../models/Company');
const Settings = require('../models/Settings');
const Property = require('../models/Property');
const EmailTemplate = require('../models/EmailTemplate');
const { sendEmail } = require('./emailService');
const { isEmailFake } = require('./dataTransformer');
const { formatAddress } = require('../utils/formatAddress');
const { titleCase } = require('../utils/formatName');
const { wrapHtml } = require('../utils/emailLayout');

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
  const propAddress = property ? formatAddress(property) : '';
  const setAddress = formatAddress(settings);
  const hotelAddress = propAddress || setAddress || '';
  const hotelPhone = property?.hotelPhone || settings?.hotelPhone || '';
  return {
    guestName: titleCase(booking.guestName || `${guest?.firstName || ''} ${guest?.lastName || ''}`.trim()) || 'Gast',
    guestFirstName: titleCase(guest?.firstName || ''),
    guestLastName: titleCase(guest?.lastName || ''),
    checkIn: fmtDateDE(booking.checkIn),
    checkOut: fmtDateDE(booking.checkOut),
    roomName: booking.roomName || '',
    nights: String(booking.nights || ''),
    bookingNumber: booking.bookingNumber || '',
    hotelName: property?.name || settings?.hotelName || '',
    hotelAddress,
    hotelPhone,
    hotelEmail: property?.hotelEmail || settings?.hotelEmail || '',
    googleMapsUrl: property?.googleMapsUrl || settings?.googleMapsUrl || '',
    reviewLink: property?.googleMapsReviewUrl || settings?.googleMapsReviewUrl || property?.googleMapsUrl || settings?.googleMapsUrl || '',
    primaryColor: property?.ci?.primaryColor || '',
    textColor: property?.ci?.textColor || '',
    logoUrl: property?.ci?.logoUrl || property?.logoUrl || '',
  };
}

function buildReviewBody(v) {
  const accent = v.primaryColor || '#3d4fbc';
  const textColor = v.textColor || '#1a1f3c';
  const greetingHtml = v.greetingText
    ? v.greetingText.split('\n').filter(Boolean).map(line =>
        '<p style="font-size:15px;color:' + textColor + ';line-height:1.65;margin:0 0 12px">' + line + '</p>'
      ).join('')
    : '<p style="font-size:15px;color:' + textColor + ';line-height:1.65;margin:0 0 20px">vielen Dank f&uuml;r Ihren Aufenthalt bei ' + (v.hotelName || '') + '! Wir w&uuml;rden uns sehr &uuml;ber eine Bewertung freuen.</p>';

  const reviewButton = v.reviewLink
    ? '<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td align="center"><a href="' + v.reviewLink + '" style="display:inline-block;background:' + accent + ';color:#ffffff;padding:16px 40px;border-radius:10px;text-decoration:none;font-size:16px;font-weight:600;letter-spacing:0.3px">Bewertung abgeben &rarr;</a></td></tr></table>'
    : '';

  return greetingHtml + reviewButton;
}

function buildReviewText(v) {
  const text = v.greetingText || 'Guten Tag ' + (v.guestFirstName || v.guestName || 'Gast') + ',\n\nvielen Dank für Ihren Aufenthalt bei ' + v.hotelName + '! Wir würden uns sehr über eine Bewertung freuen.';
  const reviewLine = v.reviewLink ? 'Bewertung abgeben: ' + v.reviewLink : '';
  return [text, reviewLine].filter(Boolean).join('\n\n');
}

async function loadContext(bookingId) {
  const booking = await Booking.findOne({ _id: bookingId, tenantId: TENANT_ID });
  if (!booking) return null;
  const guest = booking.guestId ? await Guest.findOne({ _id: booking.guestId, tenantId: TENANT_ID }).lean() : null;
  const settings = await Settings.findOne({ tenantId: TENANT_ID });
  let property = booking.propertyId
    ? await Property.findOne({ _id: booking.propertyId, tenantId: TENANT_ID }).lean()
    : null;
  if (!property) {
    property = await Property.findOne({ tenantId: TENANT_ID, active: { $ne: false } }).sort({ createdAt: 1 }).lean();
  }
  return { booking, guest, settings, property };
}

async function sendReviewEmail(bookingId, { overrideEmail, forceFormat } = {}) {
  const ctx = await loadContext(bookingId);
  if (!ctx) return;
  const { booking, guest, settings, property } = ctx;

  const isTestMode = !!overrideEmail;
  if (!isTestMode && booking.communication?.reviewRequestSent) {
    console.log(`[ReviewEmail] Übersprungen (bereits gesendet): ${booking.bookingNumber}`);
    return;
  }

  const to = overrideEmail || await resolveRecipient(booking, guest);
  if (!to) {
    console.log(`[ReviewEmail] Keine Empfängeradresse: ${booking.bookingNumber}`);
    return;
  }

  // Keine Bewertungsanfrage an OTA-Relay-Adressen
  if (!isTestMode && isEmailFake(to)) {
    console.log(`[ReviewEmail] Übersprungen (Relay-Adresse): ${booking.bookingNumber} → ${to}`);
    return;
  }

  const lang = guest?.preferredLanguage || 'de';
  const template = await EmailTemplate.findOne({ tenantId: TENANT_ID, type: 'review' });
  const vars = await buildVars(booking, guest, settings, property);
  const greetingBlocks = template?.contentJson?.[lang] || template?.contentJson?.de || [];
  const greetingBlock = Array.isArray(greetingBlocks) ? greetingBlocks.find(b => b?.type === 'text' && b?.content) : null;
  vars.greetingText = greetingBlock?.content || '';

  const subject = replaceVars(
    template?.subject?.[lang] || template?.subject?.de || 'Wie war Ihr Aufenthalt? — {{hotelName}}',
    vars
  );
  const bodyHtml = replaceVars(buildReviewBody(vars), vars);
  const html = wrapHtml(bodyHtml, vars);
  const text = replaceVars(buildReviewText(vars), vars);

  await sendEmail({ tenantId: TENANT_ID, to, subject, html, text, forceFormat });
  if (!isTestMode) {
    await Booking.updateOne({ _id: bookingId, tenantId: TENANT_ID }, { $set: { 'communication.reviewRequestSent': true } });
  }
  console.log(`[ReviewEmail] Gesendet an ${to} (${booking.bookingNumber})${isTestMode ? ' [TEST]' : ''}`);
}

module.exports = { sendReviewEmail };

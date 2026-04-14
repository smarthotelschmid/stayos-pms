const nodemailer = require('nodemailer');
const Settings = require('../models/Settings');
const { isBookingcomFakeEmail } = require('./dataTransformer');

async function getTransporter(tenantId) {
  const settings = await Settings.findOne({ tenantId });
  if (!settings?.smtp?.host) throw new Error('SMTP nicht konfiguriert');
  return { transporter: nodemailer.createTransport({
    host: settings.smtp.host,
    port: settings.smtp.port || 465,
    secure: settings.smtp.secure !== false,
    auth: { user: settings.smtp.user, pass: settings.smtp.pass },
  }), settings };
}

// Auto-Format: OTA-Relay-Adressen → Plain Text (HTML wird im Relay zerstört).
// Echte Empfänger → HTML. `forceFormat` ('html' | 'text') überschreibt die Auto-Wahl.
async function sendEmail({ tenantId, to, subject, html, text, bcc, forceFormat }) {
  const { transporter, settings } = await getTransporter(tenantId);
  const globalBcc = settings.smtp?.bccEnabled && settings.smtp?.bccAddress ? settings.smtp.bccAddress : null;
  const allBcc = [bcc, globalBcc].filter(Boolean).join(', ') || undefined;

  const isFake = isBookingcomFakeEmail(to);
  const useText = forceFormat === 'text' || (forceFormat !== 'html' && isFake);

  const mail = {
    from: `"${settings.smtp.fromName || 'STAYOS'}" <${settings.smtp.user}>`,
    to, subject,
    ...(allBcc ? { bcc: allBcc } : {}),
  };
  if (useText) {
    mail.text = text || (html ? html.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim() : '');
  } else {
    mail.html = html;
    if (text) mail.text = text;
  }

  return transporter.sendMail(mail);
}

module.exports = { sendEmail, getTransporter };

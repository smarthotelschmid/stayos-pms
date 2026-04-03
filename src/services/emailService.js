const nodemailer = require('nodemailer');
const Settings = require('../models/Settings');

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

async function sendEmail({ tenantId, to, subject, html }) {
  const { transporter, settings } = await getTransporter(tenantId);
  return transporter.sendMail({
    from: `"${settings.smtp.fromName || 'STAYOS'}" <${settings.smtp.user}>`,
    to, subject, html,
  });
}

module.exports = { sendEmail, getTransporter };

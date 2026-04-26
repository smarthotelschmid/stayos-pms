const Settings = require('../models/Settings');
const { sendEmail } = require('./emailService');
const { wrapHtml } = require('../utils/emailLayout');

const LABELS = {
  de: {
    subject: 'Dein Check-in ist bereit',
    greeting: 'Hallo,',
    body: (bookerName) => `${bookerName} hat ein Zimmer für dich gebucht.`,
    cta: 'Klicke auf den Link um deinen Check-in vorzubereiten — dauert ca. 3 Minuten:',
    signoff: 'Bis bald!',
  },
  en: {
    subject: 'Your check-in is ready',
    greeting: 'Hello,',
    body: (bookerName) => `${bookerName} has booked a room for you.`,
    cta: 'Click the link to prepare your check-in — takes about 3 minutes:',
    signoff: 'See you soon!',
  },
};

async function sendInvite({ toEmail, language, subPortalToken, bookerName, tenantId }) {
  // 1. FRONTEND_URL prüfen — kein Fallback (Lesson aus Session 17)
  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl) {
    throw new Error('FRONTEND_URL environment variable is required for sub-portal invite emails');
  }
  const subPortalUrl = `${frontendUrl}/portal/${subPortalToken}`;

  // 2. Settings laden (SMTP + Layout-Vars)
  const settings = await Settings.findOne(
    { tenantId },
    'smtp hotelName googleMapsUrl hotelPhone hotelAddress address logoUrl'
  ).lean();
  if (!settings?.smtp?.host) throw new Error('subPortalInviteEmail: SMTP not configured for tenant');

  // 3. Sprache bestimmen — Fallback 'de'
  const resolvedLang = (language && LABELS[language]) ? language : 'de';
  const L = LABELS[resolvedLang];

  const subject = L.subject;
  const greeting = L.greeting;
  const bodyLine = L.body(bookerName || '');
  const cta = L.cta;
  const signoff = L.signoff;

  // 4. HTML aufbauen (gleicher Stil wie magicLinkEmailService)
  const bodyHtml = `
<p style="font-size:15px;color:#1a1f3c;line-height:1.65;margin:0 0 16px">${greeting}</p>
<p style="font-size:15px;color:#1a1f3c;line-height:1.65;margin:0 0 16px">${bodyLine}</p>
<p style="font-size:15px;color:#1a1f3c;line-height:1.65;margin:0 0 24px">${cta}</p>
<p style="margin:0 0 24px"><a href="${subPortalUrl}" style="font-size:15px;color:#1a56db;word-break:break-all">${subPortalUrl}</a></p>
<p style="font-size:15px;color:#1a1f3c;line-height:1.65;margin:0">${signoff}</p>
`.trim();

  const vars = {
    hotelName: settings.hotelName || '',
    hotelAddress: settings.hotelAddress || settings.address || '',
    address: settings.hotelAddress || settings.address || '',
    hotelPhone: settings.hotelPhone || '',
    googleMapsUrl: settings.googleMapsUrl || '',
    logoUrl: settings.logoUrl || '',
  };

  const html = wrapHtml(bodyHtml, vars);

  // 5. Plain-text fallback
  const text = [
    greeting,
    '',
    bodyLine,
    '',
    cta,
    '',
    subPortalUrl,
    '',
    signoff,
  ].join('\n');

  // 6. sendEmail() aufrufen — BCC wird automatisch via smtp.bccEnabled/bccAddress in emailService gehandhabt
  await sendEmail({
    tenantId,
    to: toEmail,
    subject,
    html,
    text,
  });

  console.log(`[SubPortalInviteEmail] Gesendet an ${toEmail} (subPortalToken=${subPortalToken})`);
}

module.exports = { sendInvite };

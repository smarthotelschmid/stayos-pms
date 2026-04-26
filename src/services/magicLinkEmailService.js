const Settings = require('../models/Settings');
const { sendEmail } = require('./emailService');
const { wrapHtml } = require('../utils/emailLayout');

const LABELS = {
  de: { subject: 'Dein Check-in bei {{hotelName}}', greeting: 'Hallo {{firstName}},', body: 'Du hast einen Check-in bei {{hotelName}} begonnen. Klicke auf den Button um fortzufahren.', button: 'Check-in fortsetzen', expiry: 'Der Link ist 30 Minuten gültig und kann nur einmal verwendet werden.', fallback: 'Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:' },
  en: { subject: 'Your check-in at {{hotelName}}', greeting: 'Hello {{firstName}},', body: 'You started a check-in at {{hotelName}}. Click the button to continue.', button: 'Continue check-in', expiry: 'The link is valid for 30 minutes and can only be used once.', fallback: 'If the button doesn\'t work, copy this link into your browser:' },
  nl: { subject: 'Je check-in bij {{hotelName}}', greeting: 'Hallo {{firstName}},', body: 'Je bent begonnen met inchecken bij {{hotelName}}. Klik op de knop om door te gaan.', button: 'Verder met check-in', expiry: 'De link is 30 minuten geldig en kan slechts één keer worden gebruikt.', fallback: 'Als de knop niet werkt, kopieer dan deze link naar je browser:' },
  fr: { subject: 'Votre check-in à {{hotelName}}', greeting: 'Bonjour {{firstName}},', body: 'Vous avez commencé un enregistrement à {{hotelName}}. Cliquez sur le bouton pour continuer.', button: 'Continuer le check-in', expiry: 'Le lien est valide pendant 30 minutes et ne peut être utilisé qu\'une seule fois.', fallback: 'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur:' },
  it: { subject: 'Il tuo check-in a {{hotelName}}', greeting: 'Ciao {{firstName}},', body: 'Hai iniziato un check-in a {{hotelName}}. Clicca sul pulsante per continuare.', button: 'Continua il check-in', expiry: 'Il link è valido per 30 minuti e può essere utilizzato solo una volta.', fallback: 'Se il pulsante non funziona, copia questo link nel tuo browser:' },
  es: { subject: 'Tu check-in en {{hotelName}}', greeting: 'Hola {{firstName}},', body: 'Has iniciado un check-in en {{hotelName}}. Haz clic en el botón para continuar.', button: 'Continuar check-in', expiry: 'El enlace es válido durante 30 minutos y solo puede usarse una vez.', fallback: 'Si el botón no funciona, copia este enlace en tu navegador:' },
  pl: { subject: 'Twój check-in w {{hotelName}}', greeting: 'Cześć {{firstName}},', body: 'Rozpocząłeś/aś check-in w {{hotelName}}. Kliknij przycisk, aby kontynuować.', button: 'Kontynuuj check-in', expiry: 'Link jest ważny przez 30 minut i może być użyty tylko raz.', fallback: 'Jeśli przycisk nie działa, skopiuj ten link do przeglądarki:' },
  cs: { subject: 'Váš check-in v {{hotelName}}', greeting: 'Dobrý den {{firstName}},', body: 'Zahájili jste check-in v {{hotelName}}. Klikněte na tlačítko pro pokračování.', button: 'Pokračovat v check-inu', expiry: 'Odkaz je platný 30 minut a lze ho použít pouze jednou.', fallback: 'Pokud tlačítko nefunguje, zkopírujte tento odkaz do prohlížeče:' },
  sk: { subject: 'Váš check-in v {{hotelName}}', greeting: 'Dobrý deň {{firstName}},', body: 'Začali ste check-in v {{hotelName}}. Kliknite na tlačidlo pre pokračovanie.', button: 'Pokračovať v check-ine', expiry: 'Odkaz je platný 30 minút a môže byť použitý iba raz.', fallback: 'Ak tlačidlo nefunguje, skopírujte tento odkaz do prehliadača:' },
  hu: { subject: 'A check-in a {{hotelName}} szállodában', greeting: 'Szia {{firstName}},', body: 'Elindítottad a bejelentkezést a {{hotelName}} szállodában. Kattints a gombra a folytatáshoz.', button: 'Check-in folytatása', expiry: 'A link 30 percig érvényes és csak egyszer használható.', fallback: 'Ha a gomb nem működik, másold be ezt a linket a böngészőbe:' },
  ro: { subject: 'Check-in-ul tău la {{hotelName}}', greeting: 'Bună {{firstName}},', body: 'Ai început un check-in la {{hotelName}}. Apasă butonul pentru a continua.', button: 'Continuă check-in', expiry: 'Link-ul este valabil 30 de minute și poate fi folosit o singură dată.', fallback: 'Dacă butonul nu funcționează, copiază acest link în browser:' },
  hr: { subject: 'Vaš check-in u {{hotelName}}', greeting: 'Pozdrav {{firstName}},', body: 'Pokrenuli ste prijavu u {{hotelName}}. Kliknite gumb za nastavak.', button: 'Nastavi prijavu', expiry: 'Veza je valjana 30 minuta i može se koristiti samo jednom.', fallback: 'Ako gumb ne funkcionira, kopirajte ovu vezu u preglednik:' },
  sl: { subject: 'Vaš check-in v {{hotelName}}', greeting: 'Pozdravljeni {{firstName}},', body: 'Začeli ste prijavo v {{hotelName}}. Kliknite gumb za nadaljevanje.', button: 'Nadaljuj prijavo', expiry: 'Povezava velja 30 minut in se lahko uporabi samo enkrat.', fallback: 'Če gumb ne deluje, kopirajte to povezavo v brskalnik:' },
};

function replacePlaceholders(str, firstName, hotelName) {
  return str
    .replace(/\{\{firstName\}\}/g, firstName || '')
    .replace(/\{\{hotelName\}\}/g, hotelName || '');
}

async function sendMagicLinkEmail({ tenantId, guestId, bookingToken, magicToken, hotelName, lang }) {
  // 1. Guest-Daten laden (firstName für Anrede)
  const mongoose = require('mongoose');
  const guestCol = mongoose.connection.db.collection('guests');
  const guest = await guestCol.findOne(
    { _id: guestId },
    { projection: { firstName: 1, email: 1 } }
  );
  if (!guest || !guest.email) throw new Error('magicLinkEmail: Guest not found: ' + guestId);

  // 2. Settings laden (SMTP, hotelName-Fallback)
  const settings = await Settings.findOne(
    { tenantId },
    'smtp hotelName googleMapsUrl hotelPhone hotelAddress address logoUrl'
  ).lean();
  if (!settings?.smtp?.host) throw new Error('magicLinkEmail: SMTP not configured for tenant');

  const resolvedHotelName = hotelName || settings.hotelName || '';

  // 3. Sprache bestimmen (lang-Parameter → Fallback 'de')
  const resolvedLang = (lang && LABELS[lang]) ? lang : 'de';
  const L = LABELS[resolvedLang];

  // 4. Magic-Link-URL aufbauen
  const frontendUrl = process.env.FRONTEND_URL || 'https://portal.smarthotel-schmid.at';
  const magicLinkUrl = `${frontendUrl}/portal/${bookingToken}?magic=${magicToken}`;

  const firstName = guest.firstName || '';
  const subject = replacePlaceholders(L.subject, firstName, resolvedHotelName);
  const greeting = replacePlaceholders(L.greeting, firstName, resolvedHotelName);
  const bodyText = replacePlaceholders(L.body, firstName, resolvedHotelName);
  const buttonLabel = L.button;
  const expiryNote = L.expiry;
  const fallbackNote = L.fallback;

  // 5. HTML aufbauen
  const BUTTON_COLOR = '#1a56db';
  const bodyHtml = `
<p style="font-size:15px;color:#1a1f3c;line-height:1.65;margin:0 0 16px">${greeting}</p>
<p style="font-size:15px;color:#1a1f3c;line-height:1.65;margin:0 0 24px">${bodyText}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr><td align="center">
  <a href="${magicLinkUrl}" style="display:inline-block;background:${BUTTON_COLOR};color:#ffffff;padding:16px 40px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px">${buttonLabel}</a>
</td></tr></table>
<p style="font-size:13px;color:#8890a5;line-height:1.6;margin:0 0 8px">${expiryNote}</p>
<p style="font-size:13px;color:#8890a5;line-height:1.6;margin:0 0 4px">${fallbackNote}</p>
<p style="font-size:12px;color:#8890a5;word-break:break-all;margin:0"><a href="${magicLinkUrl}" style="color:#8890a5">${magicLinkUrl}</a></p>
`.trim();

  const vars = {
    hotelName: resolvedHotelName,
    hotelAddress: settings.hotelAddress || settings.address || '',
    address: settings.hotelAddress || settings.address || '',
    hotelPhone: settings.hotelPhone || '',
    googleMapsUrl: settings.googleMapsUrl || '',
    logoUrl: settings.logoUrl || '',
  };

  const html = wrapHtml(bodyHtml, vars);

  // Plain-text fallback
  const text = [
    greeting,
    '',
    bodyText,
    '',
    magicLinkUrl,
    '',
    expiryNote,
  ].join('\n');

  // 6. sendEmail() aufrufen
  await sendEmail({
    tenantId,
    to: guest.email,
    subject,
    html,
    text,
  });

  console.log(`[MagicLinkEmail] Gesendet an ${guest.email} (bookingToken=${bookingToken})`);
}

module.exports = { sendMagicLinkEmail };

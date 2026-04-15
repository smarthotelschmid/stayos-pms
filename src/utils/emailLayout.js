// STAYOS Email-Layout — einziges Shell für alle Transaktions-Mails.
// Body-HTML wird von den Services gebaut; wrapHtml übernimmt Header
// (Logo oder Hotelname + CI-Farbe) und Footer (Adresse, WhatsApp).
//
// Erwartete Variablen in `v` (der Caller resolved sie aus Property/Settings):
//   primaryColor  — CI-Farbe, Fallback: neutrales Blau
//   logoUrl       — Property.ci.logoUrl ∥ Property.logoUrl; wenn leer,
//                   wird stattdessen der Hotelname als Text-Header gerendert
//   hotelName, hotelAddress (oder address), hotelPhone

const DEFAULT_ACCENT = '#3d4fbc';

function wrapHtml(bodyHtml, v = {}) {
  const accent = v.primaryColor || DEFAULT_ACCENT;
  const logo = v.logoUrl || '';
  const hotelName = v.hotelName || '';
  const address = v.hotelAddress || v.address || '';
  const waDigits = (v.hotelPhone || '').replace(/[^0-9]/g, '');

  const headerInner = logo
    ? `<img src="${logo}" alt="${hotelName}" height="55" style="height:55px;filter:brightness(0) invert(1);-webkit-filter:brightness(0) invert(1)">`
    : `<div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:1px">${hotelName}</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6ff;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
<tr><td style="background:${accent};padding:28px 36px;text-align:center;border-radius:12px 12px 0 0">
${headerInner}
</td></tr>
<tr><td style="background:#ffffff;padding:40px 36px;border-radius:0 0 12px 12px">
${bodyHtml}
<hr style="border:none;height:1px;background:#e8eaf5;margin:24px 0 16px">
<p style="font-size:13px;color:#8890a5;text-align:center;line-height:1.6;margin:0 0 12px">${hotelName}<br>${address.replace(/\n/g, '<br>')}</p>
${waDigits ? `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<a href="https://wa.me/${waDigits}" style="display:inline-block;padding:10px 24px;border-radius:8px;background:#25D366;color:#fff;text-decoration:none;font-size:13px;font-weight:600">&#128172; WhatsApp</a>
</td></tr></table>` : ''}
</td></tr></table>
</td></tr></table></body></html>`;
}

module.exports = { wrapHtml };

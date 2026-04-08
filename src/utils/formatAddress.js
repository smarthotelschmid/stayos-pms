const COUNTRIES = [
  { code: 'AT', name: 'Österreich' },
  { code: 'DE', name: 'Deutschland' },
  { code: 'CH', name: 'Schweiz' },
  { code: 'IT', name: 'Italien' },
  { code: 'FR', name: 'Frankreich' },
  { code: 'ES', name: 'Spanien' },
  { code: 'NL', name: 'Niederlande' },
  { code: 'BE', name: 'Belgien' },
  { code: 'PL', name: 'Polen' },
  { code: 'CZ', name: 'Tschechien' },
  { code: 'HU', name: 'Ungarn' },
  { code: 'HR', name: 'Kroatien' },
  { code: 'SI', name: 'Slowenien' },
  { code: 'SK', name: 'Slowakei' },
  { code: 'DK', name: 'Dänemark' },
  { code: 'NO', name: 'Norwegen' },
  { code: 'SE', name: 'Schweden' },
  { code: 'FI', name: 'Finnland' },
];

function formatLine2(country, zip, city) {
  const prefix = country && zip ? `${country}-${zip}` : zip || '';
  return [prefix, city].filter(Boolean).join(' ');
}

// Hotel-Adresse (aus Settings)
function formatAddress(s) {
  if (!s) return '';
  const line1 = [s.hotelStreet, s.hotelStreetNo].filter(Boolean).join(' ');
  const line2 = formatLine2(s.hotelCountry, s.hotelZip, s.hotelCity);
  return [line1, line2].filter(Boolean).join('\n');
}

// Gast-Adresse
function formatGuestAddress(g) {
  if (!g) return '';
  const a = g.address || g;
  const line1 = [a.street, a.streetNo].filter(Boolean).join(' ');
  const line2 = formatLine2(a.country, a.zip, a.city);
  return [line1, line2].filter(Boolean).join('\n');
}

// Firma/Billing-Adresse
function formatCompanyAddress(c) {
  if (!c) return '';
  const a = c.address || c;
  const line1 = [a.street, a.streetNo].filter(Boolean).join(' ');
  const line2 = formatLine2(a.country, a.zip, a.city);
  return [c.name, line1, line2, c.vatId ? `UID: ${c.vatId}` : ''].filter(Boolean).join('\n');
}

module.exports = { formatAddress, formatGuestAddress, formatCompanyAddress, COUNTRIES };

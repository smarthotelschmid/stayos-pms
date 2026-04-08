function formatAddress(s) {
  if (!s) return '';
  const line1 = [s.hotelStreet, s.hotelStreetNo].filter(Boolean).join(' ');
  const line2 = [s.hotelCountry ? `${s.hotelCountry}-${s.hotelZip}` : s.hotelZip, s.hotelCity].filter(Boolean).join(' ');
  return [line1, line2].filter(Boolean).join('\n');
}

module.exports = { formatAddress };

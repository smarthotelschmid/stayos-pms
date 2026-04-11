/**
 * getHotelDatum — gibt das aktuelle Hotel-Geschäftsdatum zurück.
 * Vor geschaeftstagEndeUhr (z.B. 04:00) zählt noch als "gestern".
 *
 * @param {Date|string|number} timestamp — Zeitpunkt (default: jetzt)
 * @param {number} geschaeftstagEndeUhr — Stunde an der der neue Tag beginnt (default: 4)
 * @returns {string} Datum im Format YYYY-MM-DD (Vienna Timezone)
 */
function getHotelDatum(timestamp, geschaeftstagEndeUhr = 4) {
  const now = timestamp ? new Date(timestamp) : new Date();

  // Vienna Stunde ermitteln
  const viennaStr = now.toLocaleString('en-CA', { timeZone: 'Europe/Vienna', hour12: false });
  // Format: "2026-04-12, 02:30:00" oder "2026-04-12 02:30:00"
  const hourMatch = viennaStr.match(/(\d{1,2}):\d{2}:\d{2}/);
  const viennaHour = hourMatch ? parseInt(hourMatch[1]) : now.getHours();

  // Vienna Datum als Date
  const viennaDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
  const [y, m, d] = viennaDateStr.split('-').map(Number);

  if (viennaHour < geschaeftstagEndeUhr) {
    // Vor Ende → gestern ist der Hoteltag
    const gestern = new Date(y, m - 1, d - 1);
    const gy = gestern.getFullYear();
    const gm = String(gestern.getMonth() + 1).padStart(2, '0');
    const gd = String(gestern.getDate()).padStart(2, '0');
    return `${gy}-${gm}-${gd}`;
  }

  return viennaDateStr;
}

/**
 * getViennaHour — aktuelle Stunde in Wien
 */
function getViennaHour(timestamp) {
  const now = timestamp ? new Date(timestamp) : new Date();
  return parseInt(now.toLocaleString('en-US', { timeZone: 'Europe/Vienna', hour: 'numeric', hour12: false }));
}

module.exports = { getHotelDatum, getViennaHour };

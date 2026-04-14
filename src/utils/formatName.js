// Kapitalisiert jedes Wort eines Namens — "mathias schmid" / "MATHIAS SCHMID"
// → "Mathias Schmid". Gemischte Schreibweisen (z.B. "McDonald", "van der Berg"
// wenn schon mit Großbuchstaben drin) bleiben unverändert.
function titleCase(name) {
  if (!name) return '';
  const s = String(name);
  // Pure lower- oder pure upper-case → normalisieren. Sonst: User-Input respektieren.
  const isPureLower = s === s.toLowerCase();
  const isPureUpper = s === s.toUpperCase();
  if (!isPureLower && !isPureUpper) return s;
  return s.toLowerCase().split(/(\s+|-)/).map(part => {
    if (/^\s+$|^-$/.test(part) || !part) return part;
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join('');
}

module.exports = { titleCase };

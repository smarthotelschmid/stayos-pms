const mongoose = require('mongoose');

// Gästeprofil — wird einmal angelegt und bei jeder Buchung wiederverwendet
// So sehen wir ob jemand zum 3. Mal kommt und können ihn persönlich begrüßen
const guestSchema = new mongoose.Schema({

  // ── MANDANT ───────────────────────────────────────────
  
  // Welchem Hotel gehört dieser Gast?
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },

  // ── PERSÖNLICHE DATEN ─────────────────────────────────
  
  firstName:   { type: String, required: true },
  lastName:    { type: String, required: true },
  email:       { type: String, required: true },
  phone:       { type: String },
  
  // Geburtsdatum — wichtig für Kurtaxe (Kinder unter 14 befreit)
  birthDate:   { type: Date },
  
  nationality: { type: String },
  language:    { type: String, enum: ['de', 'en', 'fr', 'it', 'hr', 'hu', 'cs'], default: 'de' },

  // ── EMAIL VALIDIERUNG ─────────────────────────────────
  
  // Ist die E-Mail eine Fake-Adresse von Booking.com oder Airbnb?
  // @guest.booking.com oder @m.airbnb.com sind unbrauchbar
  emailIsFake:      { type: Boolean, default: false },
  // Die echte E-Mail wenn der Gast sie nachgeliefert hat
  emailVerified:    { type: String },

  // ── AUSWEISDATEN ──────────────────────────────────────
  
  // Für das Meldewesen (Feratel etc.)
  documentType:   { type: String, enum: ['passport', 'id_card', 'driving_license'] },
  documentNumber: { type: String },

  // ── ADRESSE ───────────────────────────────────────────
  
  address: {
    street:  { type: String },
    zip:     { type: String },
    city:    { type: String },
    country: { type: String },
  },

  // ── STATISTIK ─────────────────────────────────────────
  
  // Wie oft war dieser Gast schon hier?
  // Wird automatisch erhöht bei jedem Check-out
  totalStays:   { type: Number, default: 0 },
  totalSpent:   { type: Number, default: 0 },
  
  // Wann war der letzte Aufenthalt?
  lastStayAt:   { type: Date },
  
  // VIP-Status für besondere Gäste
  isVip:        { type: Boolean, default: false },
  
  // Interne Notizen z.B. "mag keine Federn", "Allergiker"
  notes:        { type: String },

  // ── MARKETING ─────────────────────────────────────────
  
  // Darf der Gast für zukünftige Angebote kontaktiert werden?
  // DSGVO-konform — nur mit ausdrücklicher Zustimmung
  marketingConsent: { type: Boolean, default: false },
  consentDate:      { type: Date },

}, { timestamps: true });

// Hilfsfunktion: Fake-E-Mail automatisch erkennen beim Speichern
guestSchema.pre('save', function(next) {
  const fakePatterns = [
    '@guest.booking.com',
    '@m.airbnb.com', 
    '@airbnb.com',
    '@guest.expedia.com',
  ];
  // Prüft ob die E-Mail eines der Fake-Muster enthält
  this.emailIsFake = fakePatterns.some(pattern => 
    this.email?.toLowerCase().includes(pattern)
  );
  next();
});

module.exports = mongoose.model('Guest', guestSchema);
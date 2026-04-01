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
  email:       { type: String },
  phone:       { type: String },
  
  // Geburtsdatum — wichtig für Kurtaxe (Kinder unter 14 befreit)
  birthDate:   { type: Date },
  
  nationality:  { type: String },
  country:      { type: String },
  countryName:  { type: String },
  dateOfBirth:  { type: Date },
  gender:       { type: String, enum: ['m', 'f', 'd'] },
  language:     { type: String, default: 'de' },
  preferredLanguage: { type: String },

  // ── EMAIL VALIDIERUNG ─────────────────────────────────
  emailIsFake:      { type: Boolean, default: false },
  emailVerified:    { type: String },

  // ── AUSWEISDATEN (Meldezettel AT) ────────────────────
  documentType:   { type: String, enum: ['passport', 'id_card', 'driving_license'] },
  documentNumber: { type: String },
  passportNumber: { type: String },
  passportExpiry: { type: Date },

  // ── ADRESSE ───────────────────────────────────────────
  address: {
    street:  { type: String },
    zip:     { type: String },
    city:    { type: String },
    country: { type: String },
  },

  // ── BUSINESS GAST ───────────────────────────────────
  businessGuest: { type: Boolean, default: false },
  companyName:   { type: String },
  companyId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  directBookingPotential: { type: Boolean, default: false },
  segment:       { type: String, enum: ['standard', 'vip', 'regular', 'problem', 'one_time'], default: 'standard' },
  specialNeeds:  [{ type: String, enum: ['allergiker', 'haustier', 'spaete_anreise', 'fruehes_checkout', 'rollstuhl'] }],
  vatId:         { type: String },

  // ── CHECK-IN DETAILS ────────────────────────────────
  doorCode:    { type: String },
  arrivalTime: { type: String },
  mealPlan:    { type: String, enum: ['RO', 'BB', 'HB', 'FB'] },

  // ── STATISTIK ─────────────────────────────────────────
  totalStays:    { type: Number, default: 0 },
  totalSpent:    { type: Number, default: 0 },
  totalRevenue:  { type: Number, default: 0 },
  lastStayAt:    { type: Date },
  lastStay:      { type: Date },
  isVip:         { type: Boolean, default: false },
  tags:          [{ type: String }],
  notes:         { type: String },
  bookings:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }],

  // ── EXTERNE REFERENZ ────────────────────────────────
  source:         { type: String },
  beds24GuestId:  { type: String, index: true },

  // ── DSGVO / MARKETING ───────────────────────────────
  gdprConsent:      { type: Boolean, default: false },
  gdprConsentDate:  { type: Date },
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

// Text-Index für performante Gästesuche
guestSchema.index({ firstName: 'text', lastName: 'text', email: 'text', companyName: 'text' });

module.exports = mongoose.model('Guest', guestSchema);
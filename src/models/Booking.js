// Mongoose für die Datenbankverbindung
const mongoose = require('mongoose');

// Das Herzstück des gesamten PMS
// Jede Buchung — egal ob Booking.com, Airbnb oder Direktbuchung
// landet als ein Dokument in dieser Collection
const bookingSchema = new mongoose.Schema({

  // ── MANDANT & IDENTIFIKATION ──────────────────────────
  
  // Welches Hotel? (Multi-Tenant — Hotel A sieht nie Buchungen von Hotel B)
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  
  // Unsere interne Buchungsnummer z.B. "HTL-2026-0042"
  bookingNumber: { type: String, required: true, unique: true },
  
  // Woher kommt die Buchung?
  source: {
    type: String,
    enum: ['direct', 'booking.com', 'airbnb', 'expedia', 'manual', 'booking', 'beds24'],
    required: true
  },

  // Die externe ID von Booking.com, Airbnb oder Beds24
  // Damit können wir Stornierungen vom OTA zuordnen
  externalId: { type: String },

  // Beds24 spezifische Felder
  beds24BookingId: { type: Number, index: true },
  beds24RoomId: { type: Number },
  beds24UnitId: { type: Number },
  beds24PropertyId: { type: Number },
  guestName: { type: String },
  channel: { type: String },
  roomName: { type: String },
  roomType: { type: String },
  hasBalcony: { type: Boolean },

  // Gruppen-ID für Multi-Zimmer Buchungen
  // z.B. GRP-2026-0001 — alle Zimmer einer Reisegruppe
  groupId: { type: String },
  
  // Rate Plan Referenz
  ratePlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'RatePlan' },

  // Firma & Rechnung
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  invoiceRecipient: { type: String, enum: ['guest', 'company'], default: 'guest' },

  // ── STATUS ────────────────────────────────────────────
  
  // Der aktuelle Zustand der Buchung
  // confirmed → checked-in → checked-out (normaler Ablauf)
  // cancelled oder no-show bei Problemen
  status: { 
    type: String, 
    enum: ['confirmed', 'checked-in', 'checked-out', 'cancelled', 'no-show'],
    default: 'confirmed'
  },

  // ── GAST & ZIMMER ─────────────────────────────────────
  
  // Verweis auf den Gast in der guests Collection
  guestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guest' },
  
  // Anzahl der Personen
  adults:   { type: Number, default: 1 },
  children: { type: Number, default: 0 },
  
  // Verweis auf das Zimmer
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
  propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property' },

  // ── ZEITRAUM ──────────────────────────────────────────
  
  // Check-in und Check-out Datum
  // Wir speichern immer UTC — Anzeige wird dann in Ortszeit umgewandelt
  checkIn:  { type: Date, required: true },
  checkOut: { type: Date, required: true },
  
  // Wie viele Nächte? Wird automatisch berechnet
  nights: { type: Number },

  // ── FRÜHSTÜCK ─────────────────────────────────────────
  
  breakfast: {
    included: { type: Boolean, default: false },
    // Preis pro Person pro Nacht
    pricePerPersonPerNight: { type: Number, default: 0 },
  },

  mealPlan:         { type: String },
  guestNotes:       { type: String },
  rateDescription:  { type: String },

  // ── EXTRAS ────────────────────────────────────────────
  
  // Array von gebuchten Extras
  // z.B. [{ name: "Zustellbett", price: 15, quantity: 1 }]
  extras: [{
    name:     { type: String },
    price:    { type: Number },
    quantity: { type: Number, default: 1 },
    per:      { type: String, enum: ['night', 'stay', 'person'] },
  }],

  // ── BEGLEITPERSONEN ──────────────────────────────────
  companions: [{
    guestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guest' },
    role: { type: String, enum: ['companion', 'child', 'infant'] },
    age: { type: Number },
  }],

  // ── PREISE ────────────────────────────────────────────
  
  pricing: {
    // Zimmerpreis gesamt (Nächte × Preis pro Nacht)
    roomTotal:      { type: Number, default: 0 },
    // Frühstück gesamt
    breakfastTotal: { type: Number, default: 0 },
    // Alle Extras zusammen
    extrasTotal:    { type: Number, default: 0 },
    // Kurtaxe — wird automatisch berechnet
    touristTax:     { type: Number, default: 0 },
    // MwSt
    vat:            { type: Number, default: 0 },
    // Gesamtbetrag
    total:          { type: Number, default: 0 },
  },

  // ── ZAHLUNG ───────────────────────────────────────────
  
  payment: {
    status:   { type: String, enum: ['pending', 'paid', 'refunded'], default: 'pending' },
    method:   { type: String, enum: ['card', 'transfer', 'cash', 'ota'] },
    paidAt:   { type: Date },
    // Stripe Payment Intent ID für Online-Zahlungen
    stripeId: { type: String },
  },

  // ── TÜRCODE ───────────────────────────────────────────
  
  doorAccess: {
    lockId:    { type: String },
    code:      { type: String },
    stayosCode: { type: String },
    roomLockId: { type: Number },
    entranceLockId: { type: Number },
    roomKeyboardPwdId: { type: Number },
    entranceKeyboardPwdId: { type: Number },
    generatedAt: { type: Date },
    validFrom: { type: Date },
    validTo:   { type: Date },
    sentAt:    { type: Date },
    deletedAt: { type: Date },
    revoked:   { type: Boolean, default: false },
  },

  // ── KOMMUNIKATION ─────────────────────────────────────
  
  communication: {
    // Wurde die Buchungsbestätigung gesendet?
    confirmationSent: { type: Boolean, default: false },
    // Wurde der Türcode gesendet?
    doorCodeSent:     { type: Boolean, default: false },
    // Wurde die Rechnung gesendet?
    invoiceSent:      { type: Boolean, default: false },
    // Wurde die Bewertungsanfrage gesendet?
    reviewRequestSent:{ type: Boolean, default: false },
    // Bevorzugter Kanal des Gastes
    channel:          { type: String, enum: ['email', 'whatsapp'], default: 'email' },
    // Sprache des Gastes für alle Kommunikation
    language:         { type: String, enum: ['de', 'en', 'fr', 'it'], default: 'de' },
  },

  // ── KURTAXE ───────────────────────────────────────────
  
  touristTax: {
    // Welche Regel wurde angewendet? (aus unserem Kurtaxe-Assistenten)
    ruleId:    { type: String },
    // Satz zum Zeitpunkt der Buchung — bleibt fix auch wenn Satz sich ändert
    rateApplied: { type: Number },
    // Gesamtbetrag
    total:     { type: Number, default: 0 },
    // Bereits bezahlt?
    paid:      { type: Boolean, default: false },
  },

  // ── GREEN STAY ────────────────────────────────────────
  
  greenStay: {
    // Hat der Gast Green Stay gewählt?
    optedIn:     { type: Boolean, default: false },
    // Wie viele Tage wurde die Reinigung ausgelassen?
    daysSkipped: { type: Number, default: 0 },
    // Gutschein-Code der generiert wurde
    voucherCode: { type: String },
    // Gutschein-Wert in Euro
    voucherValue: { type: Number, default: 0 },
  },

  // ── NOTIZEN ───────────────────────────────────────────
  
  // Interne Notizen für den Hotelier (Gast sieht das nicht)
  internalNotes: { type: String },
  
  // Spezialwünsche des Gastes
  guestRequests: { type: String },

  // Manuell überschrieben — Sync darf diese Buchung nicht mehr ändern
  manualOverride: { type: Boolean, default: false },

  // Self Check-in
  checkInToken: { type: String },
  checkInTokenExpiry: { type: Date },
  checkInCompleted: { type: Boolean, default: false },
  checkedInAt: { type: Date },
  portalOpenedAt: { type: Date },
  portalOpenCount: { type: Number, default: 0 },
  checkedOutAt: { type: Date },

  // Kontaktdaten (kann von Gast-Email abweichen, z.B. Firmen-Email)
  contactEmail: { type: String },
  contactPhone: { type: String },

  // Buchung verwalten / Stornieren Tokens
  manageBookingToken: { type: String },
  manageBookingTokenExpiry: { type: Date },
  cancelToken: { type: String },
  cancelTokenExpiry: { type: Date },
  guestPortalToken: { type: String },
  guestPortalTokenExpiry: { type: Date },
  earlyCheckIn: { type: String },
  lateCheckOut: { type: String },

// timestamps fügt createdAt und updatedAt automatisch hinzu
}, { timestamps: true });

// Hilfsfunktion: Anzahl Nächte automatisch berechnen vor dem Speichern
bookingSchema.pre('save', function(next) {
  if (this.checkIn && this.checkOut) {
    const diff = this.checkOut - this.checkIn;
    // Millisekunden in Tage umrechnen
    this.nights = Math.round(diff / (1000 * 60 * 60 * 24));
  }
  next();
});

module.exports = mongoose.model('Booking', bookingSchema);
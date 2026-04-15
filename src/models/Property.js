const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
  tenantId:      { type: mongoose.Schema.Types.ObjectId, required: true },
  name:          { type: String, required: true },
  slug:          { type: String },
  logoUrl:       { type: String },
  active:        { type: Boolean, default: true },

  // Standort
  hotelCountry:  { type: String, default: 'AT' },
  hotelStreet:   { type: String },
  hotelStreetNo: { type: String },
  hotelZip:      { type: String },
  hotelCity:     { type: String },

  // Betrieb
  checkInTime:   { type: String, default: '15:00' },
  checkOutTime:  { type: String, default: '11:00' },
  // Bandbreiten — frueheste Early-Check-in-Zeit und spaeteste Late-Check-out-Zeit
  // die der Hotelier anbietet. Nur als Policy/UI-Grenzen gedacht.
  earliestCheckInTime: { type: String },
  latestCheckOutTime:  { type: String },
  whatsapp:      { type: String },
  hotelPhone:    { type: String },
  hotelEmail:    { type: String },
  hotelWebsite:  { type: String },
  receptionHours:{ type: String },
  googleMapsUrl: { type: String },
  houseRules:    [{ icon: String, text: String }],

  // Steuern & Abgaben
  mwstZimmer:      { type: Number, default: 10 },
  mwstFruehstueck: { type: Number, default: 10 },
  kurtaxe:         { type: Number, default: 0 },
  kurtaxeMinAge:   { type: Number, default: 14 },

  // Integrationen
  bookingComHotelId: { type: String },

  // Rechnungsstellung (flach)
  billingName:    { type: String },
  billingStreet:  { type: String },
  billingStreetNo:{ type: String },
  billingZip:     { type: String },
  billingCity:    { type: String },
  billingCountry: { type: String, default: 'AT' },
  vatId:          { type: String },
  iban:           { type: String },
  bic:            { type: String },
  billingEmail:   { type: String },

  // Corporate Identity
  ci: {
    primaryColor:    { type: String, default: '#b5a160' },
    backgroundColor: { type: String, default: '#f5f5f3' },
    textColor:       { type: String, default: '#1a1a1a' },
    fontFamily:      { type: String, default: 'Inter, sans-serif' },
    logoUrl:         { type: String },
    tagline:         { type: String },
    emailSignature:  { type: String },
    emailFooter:     { type: String },
  },
}, { timestamps: true });

propertySchema.index({ tenantId: 1 });
propertySchema.index({ slug: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Property', propertySchema);

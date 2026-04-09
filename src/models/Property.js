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
  whatsapp:      { type: String },
  hotelPhone:    { type: String },
  hotelEmail:    { type: String },
  houseRules:    [{ icon: String, text: String }],

  // Steuern & Abgaben (standortabhängig)
  kurtaxe:       { type: Number, default: 0 },
  kurtaxeMinAge: { type: Number, default: 14 },

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
}, { timestamps: true });

propertySchema.index({ tenantId: 1 });
propertySchema.index({ slug: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Property', propertySchema);

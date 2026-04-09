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

  // Rechnungsstellung
  billingEntity: {
    companyName: { type: String },
    street:      { type: String },
    streetNo:    { type: String },
    zip:         { type: String },
    city:        { type: String },
    country:     { type: String, default: 'AT' },
    vatId:       { type: String },
    taxId:       { type: String },
    bankIban:    { type: String },
    bankBic:     { type: String },
    email:       { type: String },
  },
}, { timestamps: true });

propertySchema.index({ tenantId: 1 });
propertySchema.index({ slug: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Property', propertySchema);

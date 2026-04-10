const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  hotelName: { type: String, default: 'smarthotel schmid.at' },
  slug: { type: String, unique: true, sparse: true },
  customDomain: { type: String },
  customDomainVerified: { type: Boolean, default: false },
  companyName: { type: String },
  companyVatId: { type: String },
  companyRegNumber: { type: String },
  companyIban: { type: String },
  companyBic: { type: String },
  billingEmail: { type: String },

  // Portal Config
  adminIps: [{ type: String }],

  portalConfig: {
    welcomeText: { type: String, default: 'alles ist für Ihren Aufenthalt vorbereitet. Ihren persönlichen Zugangscode und alle Details finden Sie in Ihrem Gästeportal.' },
    checkInHint: { type: String, default: 'Bitte Code am Schloss eingeben und mit # bestätigen.' },
  },
  location: { type: String, default: 'Sitzenberg, NÖ' },
  checkInTime: { type: String, default: '15:00' },
  checkOutTime: { type: String, default: '11:00' },
  hotelCountry: { type: String, default: 'AT' },
  hotelStreet: { type: String },
  hotelStreetNo: { type: String },
  hotelZip: { type: String },
  hotelCity: { type: String },
  hotelPhone: { type: String, default: '+43 677 62035873' },
  hotelEmail: { type: String, default: 'booking@smarthotel-schmid.at' },
  hotelWebsite: { type: String, default: 'https://smarthotel-schmid.at' },
  bookingComHotelId: { type: String },
  googleMapsUrl: { type: String, default: 'https://maps.app.goo.gl/o8LVXqhRZ69DHDYV9' },
  whatsapp: { type: String, default: '+436776203587' },
  receptionHours: { type: String, default: '08:00 – 22:00' },
  houseRules: { type: [{ icon: String, text: String }], default: [
    { icon: '🌙', text: 'Ruhezeit 22:00 – 08:00 Uhr' },
    { icon: '🚭', text: 'Rauchen im gesamten Gebäude verboten' },
    { icon: '🐾', text: 'Haustiere auf Anfrage' },
  ]},
  doorCodeSendTime: { type: String, default: '10:00' },
  doorCodeDaysBefore: { type: Number, default: 1 },
  doorCodeSendEnabled: { type: Boolean, default: true },
  kurtaxe: { type: Number, default: 2.50 },
  kurtaxeMinAge: { type: Number, default: 14 },
  mwstZimmer: { type: Number, default: 10 },
  mwstFruehstueck: { type: Number, default: 10 },

  // SMTP Email-Einstellungen
  smtp: {
    host: { type: String },
    port: { type: Number, default: 465 },
    user: { type: String },
    pass: { type: String },
    fromName: { type: String },
    bccAddress: { type: String },
    bccEnabled: { type: Boolean, default: false },
    secure: { type: Boolean, default: true },
  },

  // Email Templates
  emailTemplates: {
    bookingConfirmation: { subject: { type: String }, body: { type: String } },
    doorCode: { subject: { type: String }, body: { type: String } },
    checkout: { subject: { type: String }, body: { type: String } },
  },

  // TTLock Integration
  ttlock: {
    accessToken: { type: String },
    refreshToken: { type: String },
    tokenExpiry: { type: Date },
    username: { type: String },
    locks: [{
      lockId: { type: Number },
      lockName: { type: String },
      roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
    }],
  },

  // Aktive Sprachen
  languages: {
    active: { type: [String], default: ['de'] },
  },
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);
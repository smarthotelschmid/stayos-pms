const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  hotelName: { type: String, default: 'smarthotel schmid.at' },
  location: { type: String, default: 'Sitzenberg, NÖ' },
  checkInTime: { type: String, default: '15:00' },
  checkOutTime: { type: String, default: '11:00' },
  address: { type: String, default: 'Schlossbergstraße 22, 3454 Sitzenberg-Reidling' },
  whatsapp: { type: String, default: '+436776203587' },
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
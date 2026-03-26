const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  hotelName: { type: String, default: 'smarthotel schmid.at' },
  location: { type: String, default: 'Sitzenberg, NÖ' },
  checkInTime: { type: String, default: '15:00' },
  checkOutTime: { type: String, default: '11:00' },
  kurtaxe: { type: Number, default: 2.50 },
  kurtaxeMinAge: { type: Number, default: 14 },
  mwstZimmer: { type: Number, default: 10 },
  mwstFruehstueck: { type: Number, default: 10 },
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);
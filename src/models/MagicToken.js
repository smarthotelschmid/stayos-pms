const mongoose = require('mongoose');

const magicTokenSchema = new mongoose.Schema({
  token:     { type: String, required: true, unique: true },
  guestId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Guest', required: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
  tenantId:  { type: mongoose.Schema.Types.ObjectId, required: true },
  expiresAt: { type: Date, required: true },  // TTL-Index: automatisch nach Ablauf gelöscht
  usedAt:    { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

// TTL-Index: Dokument wird automatisch aus DB gelöscht wenn expiresAt abgelaufen
magicTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
magicTokenSchema.index({ token: 1 }, { unique: true });

module.exports = mongoose.model('MagicToken', magicTokenSchema);

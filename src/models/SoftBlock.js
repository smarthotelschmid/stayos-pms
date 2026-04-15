const mongoose = require('mongoose');

// Soft Block — temporäre Zimmer-Reservierung während des Buchungs-Flows.
// Verhindert Doppelbuchungen zwischen Dashboard-Usern, Booking-Engine und
// Beds24-Sync. Single Source of Truth für "gerade im Flow".
//
// Lifecycle:
//   1. User klickt im Kalender auf freie Zelle → POST /api/soft-blocks
//   2. NewBooking-Modal öffnet → zeigt Block als gestrichelter Rahmen
//   3a. Modal geschlossen → DELETE /api/soft-blocks/:id
//   3b. Buchung gespeichert → Block wird via fromBlockId gelöscht
//   4. TTL-Index löscht nach Ablauf automatisch (10 Min Default)
const softBlockSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  roomId:   { type: mongoose.Schema.Types.ObjectId, required: true },
  checkIn:  { type: Date, required: true },
  checkOut: { type: Date, required: true },
  source: {
    type: String,
    enum: ['dashboard', 'booking-engine'],
    default: 'dashboard',
    required: true,
  },
  createdBy: { type: String, required: true }, // userId or sessionId
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ['pending'], default: 'pending' },
}, { timestamps: true });

// TTL-Index: MongoDB löscht das Dokument automatisch, sobald expiresAt erreicht ist.
// expireAfterSeconds: 0 → Löschung genau am expiresAt-Zeitpunkt.
softBlockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Query-Performance
softBlockSchema.index({ tenantId: 1, roomId: 1, checkIn: 1, checkOut: 1 });

module.exports = mongoose.model('SoftBlock', softBlockSchema);

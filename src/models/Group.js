const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  tenantId: { type: String, required: true },
  groupId: { type: String, required: true, unique: true },
  name: { type: String },
  type: { type: String, enum: ['private', 'corporate'], default: 'private' },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  bookings: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }],
  notes: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Group', groupSchema);

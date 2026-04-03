const mongoose = require('mongoose');

const InternalMessageSchema = new mongoose.Schema({
  tenantId: { type: String, required: true },
  text: { type: String, required: true },
  author: { type: String, required: true },
  authorId: { type: String },
  mentions: [{ guestName: String, bookingId: String }],
  createdAt: { type: Date, default: Date.now },
});

InternalMessageSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('InternalMessage', InternalMessageSchema);

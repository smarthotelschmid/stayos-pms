const mongoose = require('mongoose');

const idempotencyKeySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  scope: { type: String },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 },
});

module.exports = mongoose.model('IdempotencyKey', idempotencyKeySchema, 'idempotencyKeys');

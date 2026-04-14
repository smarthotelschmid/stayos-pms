const mongoose = require('mongoose');

const processedWebhookIdSchema = new mongoose.Schema({
  webhookId: { type: String, required: true, unique: true },
  source: { type: String },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
});

module.exports = mongoose.model('ProcessedWebhookId', processedWebhookIdSchema, 'processedWebhookIds');

const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema({
  tenantId: { type: String, required: true },
  type: { type: String, enum: ['doorcode', 'confirmation', 'review'], required: true },
  subject: { type: String, default: '' },
  contentJson: { type: mongoose.Schema.Types.Mixed },
  contentHtml: { type: String, default: '' },
}, { timestamps: true });

emailTemplateSchema.index({ tenantId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);

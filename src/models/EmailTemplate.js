const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema({
  tenantId: { type: String, required: true },
  type: { type: String, enum: ['doorcode', 'confirmation', 'review', 'whatsapp'], required: true },
  subject: {
    de: { type: String, default: '' },
    en: { type: String, default: '' },
  },
  contentJson: {
    de: { type: mongoose.Schema.Types.Mixed },
    en: { type: mongoose.Schema.Types.Mixed },
  },
  contentHtml: {
    de: { type: String, default: '' },
    en: { type: String, default: '' },
  },
  contentText: {
    de: { type: String, default: '' },
    en: { type: String, default: '' },
  },
}, { timestamps: true });

emailTemplateSchema.index({ tenantId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);

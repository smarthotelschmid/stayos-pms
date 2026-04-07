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

  // Versand-Timing — pro Template-Typ, nicht pro Sprache
  // generateTime: wann TTLock Code generiert wird (HH:MM, Vortag)
  // sendTime:     wann Email versendet wird (HH:MM, Anreisetag)
  // daysBefore:   wie viele Tage vor Check-in (0 = am Anreisetag, 1 = Vortag)
  generateTime: { type: String, default: '00:00' },
  sendTime:     { type: String, default: '06:00' },
  daysBefore:   { type: Number, default: 1 },

}, { timestamps: true });

emailTemplateSchema.index({ tenantId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);

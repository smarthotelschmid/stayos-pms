const mongoose = require('mongoose');

const RatePlanSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  
  // Basis
  name: { type: String, required: true },        // "Flex B&B"
  code: { type: String, required: true },        // "FLEX-BB"
  description: { type: String },
  isActive: { type: Boolean, default: true },

  // Mahlzeiten
  mealPlan: {
    type: String,
    enum: ['room_only', 'breakfast', 'half_board', 'full_board'],
    default: 'room_only'
  },
  breakfastPrice: { type: Number, default: 0 },  // €15 pro Person/Nacht

  // Stornierung
  cancellation: {
    type: { type: String, enum: ['free', 'non_refundable', 'deadline'], default: 'free' },
    deadlineDays: { type: Number, default: 7 },  // X Tage vor Anreise kostenlos
    penaltyPercent: { type: Number, default: 100 } // % Strafe nach Deadline
  },

  // Preis
  priceModifier: { type: Number, default: 0 },    // % Aufschlag/Rabatt auf Basispreis
  // z.B. -10 = 10% günstiger als Basispreis

  // Saison (optional — später für automatische Zuweisung)
  seasons: [{
    name: String,
    from: String,  // "11-01" (1. November)
    to: String,    // "03-31" (31. März)
  }],

}, { timestamps: true });

module.exports = mongoose.model('RatePlan', RatePlanSchema);
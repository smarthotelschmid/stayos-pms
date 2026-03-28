const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  tenantId: { type: String, required: true },

  name: { type: String, required: true },
  type: { type: String, enum: ['corporate', 'travel_agency', 'event', 'other'], default: 'corporate' },

  contactPerson: { type: String },
  contactEmail: { type: String },
  contactPhone: { type: String },

  address: {
    street: { type: String },
    zip: { type: String },
    city: { type: String },
    country: { type: String }
  },

  vatId: { type: String },
  paymentTerms: { type: Number, default: 14 },
  invoiceEmail: { type: String },

  totalBookings: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  lastBookingAt: { type: Date },

  seasonal: { type: Boolean, default: false },
  seasonStart: { type: String },
  seasonEnd: { type: String },

  notes: { type: String },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Company', companySchema);

const express = require('express');
const router = express.Router();
const Company = require('../models/Company');
const Guest = require('../models/Guest');
const Booking = require('../models/Booking');

const TENANT_ID = '507f1f77bcf86cd799439011';

// GET /api/companies/search?q=
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ success: true, count: 0, data: [] });
    const regex = new RegExp(q, 'i');
    const companies = await Company.find({
      tenantId: TENANT_ID,
      $or: [{ name: regex }, { vatId: regex }, { contactPerson: regex }],
      isActive: true
    }).limit(10);
    res.json({ success: true, count: companies.length, data: companies });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/companies
router.get('/', async (req, res) => {
  try {
    const companies = await Company.find({ tenantId: TENANT_ID, isActive: true }).sort({ name: 1 });
    res.json({ success: true, count: companies.length, data: companies });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/companies/:id
router.get('/:id', async (req, res) => {
  try {
    const company = await Company.findOne({ _id: req.params.id, tenantId: TENANT_ID });
    if (!company) return res.status(404).json({ success: false, error: 'Firma nicht gefunden' });
    res.json({ success: true, data: company });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/companies/:id/guests
router.get('/:id/guests', async (req, res) => {
  try {
    const guests = await Guest.find({ tenantId: TENANT_ID, companyId: req.params.id });
    res.json({ success: true, count: guests.length, data: guests });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/companies/:id/bookings
router.get('/:id/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find({ tenantId: TENANT_ID, companyId: req.params.id }).sort({ checkIn: -1 });
    res.json({ success: true, count: bookings.length, data: bookings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/companies
router.post('/', async (req, res) => {
  try {
    const company = await Company.create({ tenantId: TENANT_ID, ...req.body });
    res.status(201).json({ success: true, data: company });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PUT /api/companies/:id
router.put('/:id', async (req, res) => {
  try {
    const company = await Company.findOneAndUpdate(
      { _id: req.params.id, tenantId: TENANT_ID },
      req.body,
      { new: true, runValidators: true }
    );
    if (!company) return res.status(404).json({ success: false, error: 'Firma nicht gefunden' });
    res.json({ success: true, data: company });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /api/companies/:id (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const company = await Company.findOneAndUpdate(
      { _id: req.params.id, tenantId: TENANT_ID },
      { isActive: false },
      { new: true }
    );
    if (!company) return res.status(404).json({ success: false, error: 'Firma nicht gefunden' });
    res.json({ success: true, message: 'Firma deaktiviert' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

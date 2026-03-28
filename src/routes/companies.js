const express = require('express');
const router = express.Router();
const Company = require('../models/Company');
const Guest = require('../models/Guest');
const Booking = require('../models/Booking');

// GET /api/companies/search?q=
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ success: true, count: 0, data: [] });
    const regex = new RegExp(q, 'i');
    const companies = await Company.find({
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
    const companies = await Company.find({ isActive: true }).sort({ name: 1 });
    res.json({ success: true, count: companies.length, data: companies });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/companies/:id
router.get('/:id', async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ success: false, error: 'Firma nicht gefunden' });
    res.json({ success: true, data: company });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/companies/:id/guests
router.get('/:id/guests', async (req, res) => {
  try {
    const guests = await Guest.find({ companyId: req.params.id });
    res.json({ success: true, count: guests.length, data: guests });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/companies/:id/bookings
router.get('/:id/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find({ companyId: req.params.id }).sort({ checkIn: -1 });
    res.json({ success: true, count: bookings.length, data: bookings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/companies
router.post('/', async (req, res) => {
  try {
    const company = await Company.create(req.body);
    res.status(201).json({ success: true, data: company });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PUT /api/companies/:id
router.put('/:id', async (req, res) => {
  try {
    const company = await Company.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!company) return res.status(404).json({ success: false, error: 'Firma nicht gefunden' });
    res.json({ success: true, data: company });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /api/companies/:id (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const company = await Company.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!company) return res.status(404).json({ success: false, error: 'Firma nicht gefunden' });
    res.json({ success: true, message: 'Firma deaktiviert' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

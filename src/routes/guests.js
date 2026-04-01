const express = require('express');
const router = express.Router();
const Guest = require('../models/Guest');
const { ObjectId } = require('mongodb');

// ── GET /api/guests/search?q= ────────────────────────
// MUST be before /:id to avoid "search" matching as id
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ success: true, count: 0, data: [] });

    // $text Index-Suche (schnell, auch bei 50.000+ Datensätzen)
    let guests;
    try {
      guests = await Guest.find({
        tenantId: '507f1f77bcf86cd799439011',
        $text: { $search: q }
      }).limit(20);
    } catch {
      // Regex-Fallback falls Text-Index noch nicht existiert
      const regex = new RegExp(q, 'i');
      guests = await Guest.find({
        tenantId: '507f1f77bcf86cd799439011',
        $or: [{ firstName: regex }, { lastName: regex }, { email: regex }, { companyName: regex }]
      }).limit(20);
    }

    res.json({ success: true, count: guests.length, data: guests });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/guests ────────────────────────────────────
// Dedupliziert: gruppiert nach Name, behält Eintrag mit meisten Buchungen
router.get('/', async (req, res) => {
  try {
    // Batch-Lookup by IDs
    if (req.query.ids) {
      const idList = req.query.ids.split(',').map(id => id.trim()).filter(Boolean);
      const objectIds = idList.map(id => { try { return new ObjectId(id); } catch { return id; } });
      const guests = await Guest.find({ _id: { $in: objectIds } });
      return res.json({ success: true, count: guests.length, data: guests });
    }

    const guests = await Guest.aggregate([
      {
        $addFields: {
          bookingCount: { $size: { $ifNull: ['$bookings', []] } },
          groupKey: {
            $cond: {
              if: { $and: [{ $ne: ['$email', null] }, { $ne: ['$email', ''] }, { $ne: ['$emailIsFake', true] }] },
              then: '$email',
              else: { $concat: [{ $ifNull: ['$firstName', ''] }, '|', { $ifNull: ['$lastName', ''] }] }
            }
          }
        }
      },
      { $sort: { bookingCount: -1 } },
      {
        $group: {
          _id: '$groupKey',
          doc: { $first: '$$ROOT' }
        }
      },
      { $replaceRoot: { newRoot: '$doc' } },
      { $sort: { lastName: 1, firstName: 1 } }
    ]);
    res.json({ success: true, count: guests.length, data: guests });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/guests ───────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const guest = await Guest.create(req.body);
    const warning = guest.emailIsFake
      ? 'Fake-E-Mail erkannt — bitte echte E-Mail nachfragen'
      : null;
    res.status(201).json({ success: true, data: guest, warning });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── GET /api/guests/:id ────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const guest = await Guest.findById(req.params.id);
    if (!guest) return res.status(404).json({ success: false, error: 'Gast nicht gefunden' });
    res.json({ success: true, data: guest });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /api/guests/:id ────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const guest = await Guest.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });
    if (!guest) return res.status(404).json({ success: false, error: 'Gast nicht gefunden' });
    res.json({ success: true, data: guest });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/guests/:id ────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const guest = await Guest.findByIdAndDelete(req.params.id);
    if (!guest) return res.status(404).json({ success: false, error: 'Gast nicht gefunden' });
    res.json({ success: true, message: 'Gast gelöscht' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

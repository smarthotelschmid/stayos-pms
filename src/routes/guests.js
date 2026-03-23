const express = require('express');
const router = express.Router();
const Guest = require('../models/Guest');

// ── GET /api/guests ────────────────────────────────────
// Alle Gäste abrufen
router.get('/', async (req, res) => {
  try {
    const guests = await Guest.find();
    res.json({ success: true, count: guests.length, data: guests });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/guests ───────────────────────────────────
// Neuen Gast anlegen — prüft automatisch ob E-Mail fake ist
router.post('/', async (req, res) => {
  try {
    const guest = await Guest.create(req.body);
    // Warnung ausgeben wenn Fake-E-Mail erkannt
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
// Gast aktualisieren z.B. echte E-Mail nachtragen
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

module.exports = router;
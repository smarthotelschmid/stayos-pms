const express = require('express');
const router = express.Router();
const Room = require('../models/Room');

// ── GET /api/rooms ─────────────────────────────────────
// Alle Zimmer eines Hotels abrufen
// Später wird tenantId aus dem Login-Token gelesen
// Jetzt noch als Query-Parameter für den Test
router.get('/', async (req, res) => {
  try {
    const rooms = await Room.find();
    res.json({ 
      success: true, 
      count: rooms.length,
      data: rooms 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/rooms ────────────────────────────────────
// Neues Zimmer anlegen
router.post('/', async (req, res) => {
  try {
    const room = await Room.create(req.body);
    res.status(201).json({ 
      success: true, 
      data: room 
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── GET /api/rooms/available ───────────────────────────
// Freie Zimmer für einen Zeitraum zurückgeben
router.get('/available', async (req, res) => {
  try {
    const { checkIn, checkOut, tenantId } = req.query;
    if (!checkIn || !checkOut) {
      return res.status(400).json({ success: false, error: 'checkIn und checkOut erforderlich' });
    }
    const Booking = require('../models/Booking');
    // Alle belegten Zimmer im Zeitraum finden
    const busyBookings = await Booking.find({
      status: { $nin: ['cancelled', 'no-show'] },
      checkIn: { $lt: new Date(checkOut) },
      checkOut: { $gt: new Date(checkIn) }
    }).select('roomId');
    const busyRoomIds = busyBookings.map(b => b.roomId.toString());
    // Alle Zimmer außer den belegten
    const rooms = await Room.find({
      _id: { $nin: busyRoomIds }
    });
    res.json({ success: true, count: rooms.length, data: rooms });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/rooms/:id ─────────────────────────────────
// Ein einzelnes Zimmer abrufen
router.get('/:id', async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Zimmer nicht gefunden' });
    }
    res.json({ success: true, data: room });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /api/rooms/:id ─────────────────────────────────
// Zimmer aktualisieren
router.put('/:id', async (req, res) => {
  try {
    const room = await Room.findByIdAndUpdate(req.params.id, req.body, { 
      new: true,        // gibt das aktualisierte Dokument zurück
      runValidators: true // prüft ob die neuen Daten dem Schema entsprechen
    });
    if (!room) {
      return res.status(404).json({ success: false, error: 'Zimmer nicht gefunden' });
    }
    res.json({ success: true, data: room });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/rooms/:id/housekeeping ──────────────────
// Housekeeping Status aktualisieren
router.patch('/:id/housekeeping', async (req, res) => {
  try {
    const { housekeepingStatus, housekeepingNote } = req.body;
    const room = await Room.findByIdAndUpdate(
      req.params.id,
      { housekeepingStatus, housekeepingNote },
      { new: true }
    );
    if (!room) {
      return res.status(404).json({ success: false, error: 'Zimmer nicht gefunden' });
    }
    res.json({ success: true, data: room });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
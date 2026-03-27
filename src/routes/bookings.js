const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');

// ── GET /api/bookings ──────────────────────────────────
// Alle Buchungen abrufen — später mit Filter nach Datum, Status etc.
router.get('/', async (req, res) => {
  try {
    const bookings = await Booking.find()
      // populate holt die echten Daten aus den verknüpften Collections
      // statt nur der ID sehen wir dann den ganzen Gast und das ganze Zimmer
      .populate('guestId', 'firstName lastName email phone')
      .populate('roomId', 'number name type pricePerNight floor maxGuests amenities')
      .sort({ checkIn: -1 }); // neueste zuerst
    res.json({ success: true, count: bookings.length, data: bookings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/bookings ─────────────────────────────────
// Neue Buchung anlegen
router.post('/', async (req, res) => {
  try {
    const { roomId, checkIn, checkOut, tenantId } = req.body;

    // Verfügbarkeitsprüfung — doppelte Buchung verhindern
    const conflict = await Booking.findOne({
      tenantId,
      roomId,
      status: { $nin: ['cancelled', 'no-show'] },
      $or: [
        // Neue Buchung beginnt während bestehender Buchung
        { checkIn: { $lt: new Date(checkOut) }, checkOut: { $gt: new Date(checkIn) } }
      ]
    });

    if (conflict) {
      return res.status(409).json({
        success: false,
        error: 'Zimmerkollision',
        message: `Zimmer ist von ${new Date(conflict.checkIn).toLocaleDateString('de-AT')} bis ${new Date(conflict.checkOut).toLocaleDateString('de-AT')} bereits belegt (${conflict.bookingNumber})`,
        conflict: {
          bookingNumber: conflict.bookingNumber,
          checkIn: conflict.checkIn,
          checkOut: conflict.checkOut,
          status: conflict.status
        }
      });
    }

    // Buchungsnummer automatisch generieren: HTL-2026-0001
    const year = new Date().getFullYear();
    const count = await Booking.countDocuments();
    const bookingNumber = `HTL-${year}-${String(count + 1).padStart(4, '0')}`;

    const booking = await Booking.create({
      ...req.body,
      bookingNumber
    });

    res.status(201).json({ success: true, data: booking });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── GET /api/bookings/search?q= ──────────────────────────
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ success: true, count: 0, data: [] });
    const regex = new RegExp(q, 'i');
    const bookings = await Booking.find({
      $or: [{ guestName: regex }, { bookingNumber: regex }, { otaBookingId: regex }, { beds24BookingId: regex }],
      checkOut: { $gte: new Date() }
    }).sort({ checkIn: 1 }).limit(5);
    res.json({ success: true, count: bookings.length, data: bookings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/bookings/:id ──────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('guestId', 'firstName lastName email phone')
      .populate('roomId', 'number name type pricePerNight floor maxGuests amenities');
    if (!booking) return res.status(404).json({ success: false, error: 'Buchung nicht gefunden' });
    res.json({ success: true, data: booking });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /api/bookings/:id ──────────────────────────────
// Buchung aktualisieren z.B. Status ändern
router.put('/:id', async (req, res) => {
  try {
    const booking = await Booking.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });
    if (!booking) return res.status(404).json({ success: false, error: 'Buchung nicht gefunden' });
    res.json({ success: true, data: booking });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/bookings/:id/status ────────────────────
// Nur den Status ändern z.B. confirmed → checked-in
// Wird später vom Self Check-in Flow aufgerufen
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const booking = await Booking.findByIdAndUpdate(
      req.params.id, 
      { status },
      { new: true, runValidators: true }
    );
    if (!booking) return res.status(404).json({ success: false, error: 'Buchung nicht gefunden' });
    res.json({ success: true, data: booking });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const SoftBlock = require('../models/SoftBlock');

const TENANT_ID = '507f1f77bcf86cd799439011';
const DEFAULT_TTL_MIN = 10; // Block gültig 10 Minuten

// GET /api/soft-blocks — alle aktiven (nicht abgelaufenen) Blocks
router.get('/', async (req, res) => {
  try {
    const blocks = await SoftBlock.find({
      tenantId: TENANT_ID,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, count: blocks.length, data: blocks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/soft-blocks — neuen Block anlegen
// Body: { roomId, checkIn, checkOut, createdBy, source?, ttlMinutes? }
router.post('/', async (req, res) => {
  try {
    const { roomId, checkIn, checkOut, createdBy, source, ttlMinutes } = req.body;
    if (!roomId || !checkIn || !checkOut || !createdBy) {
      return res.status(400).json({ success: false, error: 'roomId, checkIn, checkOut, createdBy erforderlich' });
    }

    const ci = new Date(checkIn);
    const co = new Date(checkOut);
    if (isNaN(ci) || isNaN(co) || ci >= co) {
      return res.status(400).json({ success: false, error: 'Ungültige Daten' });
    }

    // Prüfen ob bereits ein aktiver Block für denselben Slot existiert
    const conflict = await SoftBlock.findOne({
      tenantId: TENANT_ID,
      roomId,
      expiresAt: { $gt: new Date() },
      checkIn: { $lt: co },
      checkOut: { $gt: ci },
    }).lean();
    if (conflict) {
      return res.status(409).json({ success: false, error: 'Slot ist bereits blockiert', conflict });
    }

    // Auch gegen echte Buchungen prüfen
    const Booking = require('../models/Booking');
    const bookingConflict = await Booking.findOne({
      tenantId: TENANT_ID,
      roomId,
      status: { $nin: ['cancelled', 'deleted', 'no-show', 'checked-out'] },
      checkIn: { $lt: co },
      checkOut: { $gt: ci },
    }).lean();
    if (bookingConflict) {
      return res.status(409).json({ success: false, error: 'Slot ist bereits gebucht', conflict: bookingConflict });
    }

    const ttl = Math.max(1, Math.min(60, parseInt(ttlMinutes) || DEFAULT_TTL_MIN));
    const block = await SoftBlock.create({
      tenantId: TENANT_ID,
      roomId,
      checkIn: ci,
      checkOut: co,
      source: source || 'dashboard',
      createdBy,
      expiresAt: new Date(Date.now() + ttl * 60 * 1000),
      status: 'pending',
    });

    res.status(201).json({ success: true, data: block });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/soft-blocks/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await SoftBlock.findOneAndDelete({
      _id: req.params.id,
      tenantId: TENANT_ID,
    });
    if (!result) return res.status(404).json({ success: false, error: 'Block nicht gefunden' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/soft-blocks/cleanup — manueller Cleanup (Backup zum TTL-Index)
router.post('/cleanup', async (req, res) => {
  try {
    const result = await SoftBlock.deleteMany({
      tenantId: TENANT_ID,
      expiresAt: { $lte: new Date() },
    });
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

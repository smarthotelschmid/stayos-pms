const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Settings = require('../models/Settings');
const { getToken, ttlockPost, CLIENT_ID, TENANT_ID } = require('../services/ttlockHelper');

const ENTRANCE_LOCK_ID = 3321320;

// TTLock Code generieren für eine Buchung
async function generateCode(booking) {
  const settings = await Settings.findOne({ tenantId: TENANT_ID });
  const roomId = (booking.roomId?._id || booking.roomId)?.toString();
  const lockEntry = (settings?.ttlock?.locks || []).find(l => l.roomId?.toString() === roomId);
  if (!lockEntry || !settings?.ttlock?.accessToken) return null;

  const token = await getToken();
  const checkInTime = settings.checkInTime || '15:00';
  const checkOutTime = settings.checkOutTime || '11:00';

  const ci = booking.checkIn instanceof Date ? booking.checkIn : new Date(booking.checkIn);
  const co = booking.checkOut instanceof Date ? booking.checkOut : new Date(booking.checkOut);
  const [ciH, ciMin] = checkInTime.split(':').map(Number);
  const [coH, coMin] = checkOutTime.split(':').map(Number);
  const startDate = new Date(ci.getFullYear(), ci.getMonth(), ci.getDate(), ciH, ciMin).getTime();
  const endDate = new Date(co.getFullYear(), co.getMonth(), co.getDate(), coH, coMin).getTime();

  const guestName = booking.guestName || booking.bookingNumber || 'Gast';
  const pwdParams = {
    clientId: CLIENT_ID, accessToken: token, keyboardPwdType: 2,
    startDate: startDate.toString(), endDate: endDate.toString(),
    keyboardPwdName: `${guestName} ${booking.bookingNumber || ''}`.trim(),
    date: Date.now(),
  };

  const roomResult = await ttlockPost('/v3/keyboardPwd/get', { ...pwdParams, lockId: lockEntry.lockId });
  if (!roomResult.keyboardPwd) return null;

  const entranceResult = await ttlockPost('/v3/keyboardPwd/get', { ...pwdParams, lockId: ENTRANCE_LOCK_ID });

  const doorAccess = {
    stayosCode: roomResult.keyboardPwd,
    roomKeyboardPwdId: roomResult.keyboardPwdId,
    entranceKeyboardPwdId: entranceResult.keyboardPwdId || null,
    roomLockId: lockEntry.lockId,
    entranceLockId: ENTRANCE_LOCK_ID,
    generatedAt: new Date(),
    validFrom: new Date(startDate),
    validTo: new Date(endDate),
  };

  await Booking.updateOne({ _id: booking._id }, { $set: { doorAccess } });
  console.log(`[TTLock] Code generiert: ${booking.roomName || roomId} → ${roomResult.keyboardPwd} (${guestName})`);
  return doorAccess;
}

// TTLock Code löschen
async function deleteCode(booking) {
  if (!booking.doorAccess?.roomKeyboardPwdId) return;
  try {
    const token = await getToken();
    const params = { clientId: CLIENT_ID, accessToken: token, date: Date.now() };
    if (booking.doorAccess.roomLockId) {
      await ttlockPost('/v3/keyboardPwd/delete', { ...params, lockId: booking.doorAccess.roomLockId, keyboardPwdId: booking.doorAccess.roomKeyboardPwdId });
    }
    if (booking.doorAccess.entranceKeyboardPwdId) {
      await ttlockPost('/v3/keyboardPwd/delete', { ...params, lockId: ENTRANCE_LOCK_ID, keyboardPwdId: booking.doorAccess.entranceKeyboardPwdId });
    }
    await Booking.updateOne({ _id: booking._id }, { $set: { 'doorAccess.stayosCode': null, 'doorAccess.deletedAt': new Date() } });
    console.log(`[TTLock] Code gelöscht: ${booking.guestName || booking.bookingNumber} (${booking.roomName})`);
  } catch (e) {
    console.log(`[TTLock] Code löschen Fehler: ${e.message}`);
  }
}

// ── GET /api/bookings ──────────────────────────────────
// Query-Parameter: from, to, status, limit, page
router.get('/', async (req, res) => {
  try {
    const { from, to, status, includeDeleted, limit: limitParam, page: pageParam } = req.query;
    const filter = {};

    // Datum-Filter: from → checkOut >= from, to → checkIn <= to
    if (from) filter.checkOut = { $gte: new Date(from) };
    if (to) filter.checkIn = { ...(filter.checkIn || {}), $lte: new Date(to) };

    // Status-Filter: kommagetrennt, z.B. status=confirmed,checked-in
    if (status) filter.status = { $in: status.split(',') };

    // Gelöschte Buchungen standardmäßig ausblenden
    if (includeDeleted !== 'true' && !status) {
      filter.status = { ...filter.status, $ne: 'deleted' };
    }

    // Pagination
    const limit = Math.min(parseInt(limitParam) || 500, 1000);
    const page = Math.max(parseInt(pageParam) || 1, 1);
    const skip = (page - 1) * limit;

    const bookings = await Booking.find(filter)
      .populate('guestId', 'firstName lastName email phone')
      .populate('roomId', 'number name type pricePerNight floor maxGuests amenities')
      .sort({ checkIn: -1 })
      .skip(skip)
      .limit(limit);
    res.json({ success: true, count: bookings.length, page, limit, data: bookings });
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

    // Bei confirmed: TTLock Code sofort generieren
    try {
      if (req.body.status === 'confirmed' || !req.body.status) {
        const da = await generateCode(booking);
        if (da) booking.doorAccess = da;
      }
    } catch (e) {
      console.log(`[TTLock] Code-Generierung Fehler: ${e.message}`);
    }

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
    const orConditions = [
      { guestName: regex },
      { bookingNumber: regex },
      { otaBookingId: regex },
      { roomName: regex },
      { channel: regex },
    ];
    // beds24BookingId is Number — match as string via regex on bookingNumber or exact number
    if (!isNaN(q)) orConditions.push({ beds24BookingId: Number(q) });
    else orConditions.push({ externalId: regex });

    const bookings = await Booking.find({
      $or: orConditions
    }).sort({ checkIn: -1 }).limit(10).populate('guestId', 'firstName lastName');
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
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );
    if (!booking) return res.status(404).json({ success: false, error: 'Buchung nicht gefunden' });

    try {
      if (status === 'confirmed' && !booking.doorAccess?.stayosCode) {
        await generateCode(booking);
      }
      if (status === 'cancelled' || status === 'checked-out') {
        await deleteCode(booking);
      }
    } catch (e) {
      console.log(`[TTLock] Status-Change Code Fehler: ${e.message}`);
    }

    res.json({ success: true, data: booking });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const { getToken, ttlockPost, CLIENT_ID } = require('../services/ttlockHelper');

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

    // Same-day Buchung → TTLock Code sofort generieren
    try {
      const today = new Date(); today.setHours(0,0,0,0);
      const ciDate = new Date(checkIn); ciDate.setHours(0,0,0,0);
      if (ciDate.getTime() === today.getTime()) {
        const Settings = require('../models/Settings');
        const settings = await Settings.findOne({ tenantId });
        const lockEntry = (settings?.ttlock?.locks || []).find(l => l.roomId?.toString() === roomId);
        if (lockEntry && settings?.ttlock?.accessToken) {
          const token = await getToken();
          const ENTRANCE_LOCK_ID = 3321320;
          const checkInTime = settings.checkInTime || '15:00';
          const checkOutTime = settings.checkOutTime || '11:00';

          const [ciY,ciM,ciD] = checkIn.slice(0,10).split('-').map(Number);
          const [coY,coM,coD] = checkOut.slice(0,10).split('-').map(Number);
          const [ciH,ciMin] = checkInTime.split(':').map(Number);
          const [coH,coMin] = checkOutTime.split(':').map(Number);
          const startDate = new Date(ciY, ciM-1, ciD, ciH, ciMin).getTime();
          const endDate = new Date(coY, coM-1, coD, coH, coMin).getTime();

          const guestName = req.body.guestName || booking.bookingNumber;
          const pwdParams = {
            clientId: CLIENT_ID,
            accessToken: token,
            keyboardPwdType: 2,
            startDate: startDate.toString(),
            endDate: endDate.toString(),
            keyboardPwdName: `${guestName} ${bookingNumber}`.trim(),
            date: Date.now(),
          };

          const roomResult = await ttlockPost('/v3/keyboardPwd/get', { ...pwdParams, lockId: lockEntry.lockId });
          const entranceResult = await ttlockPost('/v3/keyboardPwd/get', { ...pwdParams, lockId: ENTRANCE_LOCK_ID });

          if (roomResult.keyboardPwd) {
            await Booking.updateOne({ _id: booking._id }, { $set: {
              'doorAccess.code': roomResult.keyboardPwd,
              'doorAccess.roomKeyboardPwdId': roomResult.keyboardPwdId,
              'doorAccess.entranceKeyboardPwdId': entranceResult.keyboardPwdId || null,
              'doorAccess.roomLockId': lockEntry.lockId,
              'doorAccess.entranceLockId': ENTRANCE_LOCK_ID,
              'doorAccess.generatedAt': new Date(),
              'doorAccess.validFrom': new Date(startDate),
              'doorAccess.validTo': new Date(endDate),
            }});
            booking.doorAccess = { code: roomResult.keyboardPwd, roomLockId: lockEntry.lockId, entranceLockId: ENTRANCE_LOCK_ID };
            console.log(`[TTLock] Same-day Buchung — Code sofort generiert: ${booking.roomName || roomId} → ${roomResult.keyboardPwd}`);
          }
        }
      }
    } catch (e) {
      console.log(`[TTLock] Same-day Code Fehler: ${e.message}`);
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

    // Bei Check-out: TTLock Codes löschen
    if (status === 'checked-out' && booking.doorAccess?.code) {
      try {
        const token = await getToken();
        const deleteParams = { clientId: CLIENT_ID, accessToken: token, date: Date.now() };

        // Zimmer-Schloss Code löschen
        if (booking.doorAccess.roomKeyboardPwdId && booking.doorAccess.roomLockId) {
          const r1 = await ttlockPost('/v3/keyboardPwd/delete', {
            ...deleteParams,
            lockId: booking.doorAccess.roomLockId,
            keyboardPwdId: booking.doorAccess.roomKeyboardPwdId,
          });
          console.log(`[TTLock Checkout] Zimmer ${booking.roomName}: ${r1.errcode ? r1.errmsg : 'gelöscht'}`);
        }

        // Haupteingang Code löschen
        if (booking.doorAccess.entranceKeyboardPwdId && booking.doorAccess.entranceLockId) {
          const r2 = await ttlockPost('/v3/keyboardPwd/delete', {
            ...deleteParams,
            lockId: booking.doorAccess.entranceLockId,
            keyboardPwdId: booking.doorAccess.entranceKeyboardPwdId,
          });
          console.log(`[TTLock Checkout] Haupteingang: ${r2.errcode ? r2.errmsg : 'gelöscht'}`);
        }

        await Booking.updateOne({ _id: booking._id }, {
          $set: { 'doorAccess.code': null, 'doorAccess.deletedAt': new Date() }
        });
        console.log(`[TTLock Checkout] Code gelöscht für ${booking.guestName || booking.bookingNumber} (${booking.roomName})`);
      } catch (e) {
        console.log(`[TTLock Checkout] Fehler: ${e.message}`);
      }
    }

    res.json({ success: true, data: booking });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
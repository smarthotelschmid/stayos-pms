const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Settings = require('../models/Settings');
const { getToken, ttlockPost, CLIENT_ID, TENANT_ID } = require('../services/ttlockHelper');

const ENTRANCE_LOCK_ID = 3321320;

// TTLock Code generieren für eine Buchung
async function findLockForBooking(booking, settings) {
  const Room = require('../models/Room');
  const roomId = (booking.roomId?._id || booking.roomId)?.toString();
  let lockEntry = (settings?.ttlock?.locks || []).find(l => l.roomId?.toString() === roomId);
  if (!lockEntry && booking.roomName) {
    const room = await Room.findOne({ tenantId: TENANT_ID, name: booking.roomName });
    if (room) lockEntry = (settings?.ttlock?.locks || []).find(l => l.roomId?.toString() === room._id.toString());
  }
  return lockEntry;
}

async function generateCode(booking) {
  const settings = await Settings.findOne({ tenantId: TENANT_ID });
  const lockEntry = await findLockForBooking(booking, settings);
  if (!lockEntry || !settings?.ttlock?.accessToken) return null;

  const token = await getToken();
  const checkInTime = settings.checkInTime || '15:00';
  const checkOutTime = settings.checkOutTime || '11:00';

  // Vienna Timezone korrekt — TTLock erwartet UTC-Timestamp, wir berechnen Vienna → UTC
  const toViennaMs = (dateStr, timeStr) => {
    const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
    const [h, min] = timeStr.split(':').map(Number);
    const utcMs = Date.UTC(y, m - 1, d, h, min);
    const viennaStr = new Date(utcMs).toLocaleString('en', { timeZone: 'Europe/Vienna', timeZoneName: 'shortOffset' });
    const match = viennaStr.match(/GMT([+-]\d+)/);
    const offsetH = match ? parseInt(match[1]) : 2;
    return utcMs - offsetH * 3600000;
  };
  const ciStr = (booking.checkIn instanceof Date ? booking.checkIn.toISOString() : booking.checkIn).slice(0, 10);
  const coStr = (booking.checkOut instanceof Date ? booking.checkOut.toISOString() : booking.checkOut).slice(0, 10);
  const startDate = toViennaMs(ciStr, checkInTime);
  const endDate = toViennaMs(coStr, checkOutTime);

  const guestName = booking.guestName || booking.bookingNumber || 'Gast';
  // PIN aus Telefonnummer (letzte 4 Ziffern) oder zufällig
  function gen4Pin(phone) {
    if (phone) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length >= 4) {
        const last4 = digits.slice(-4);
        const d = last4.split('').map(Number);
        const seq = d.every((v, i) => i === 0 || v === d[i-1] + 1) || d.every((v, i) => i === 0 || v === d[i-1] - 1);
        const rep = d.every(v => v === d[0]);
        if (!seq && !rep) return last4;
      }
    }
    for (let i = 0; i < 100; i++) {
      const pin = String(1000 + Math.floor(Math.random() * 9000));
      const d = pin.split('').map(Number);
      const seq = d.every((v, i) => i === 0 || v === d[i-1] + 1) || d.every((v, i) => i === 0 || v === d[i-1] - 1);
      const rep = d.every(v => v === d[0]);
      if (!seq && !rep) return pin;
    }
    return '3947';
  }
  // Gast-Telefonnummer laden
  const Guest = require('../models/Guest');
  const guestId = (booking.guestId?._id || booking.guestId)?.toString();
  let phone = null;
  if (guestId && guestId !== '507f1f77bcf86cd799439011') {
    const guest = await Guest.findById(guestId, 'phone').lean();
    phone = guest?.phone;
  }
  const customCode = gen4Pin(phone);
  const pwdName = `${guestName} ${booking.bookingNumber || ''}`.trim();
  const pwdParams = {
    clientId: CLIENT_ID, accessToken: token,
    keyboardPwdType: 3, keyboardPwd: customCode, addType: 2,
    startDate: startDate.toString(), endDate: endDate.toString(),
    keyboardPwdName: pwdName, date: Date.now(),
  };

  const roomResult = await ttlockPost('/v3/keyboardPwd/add', { ...pwdParams, lockId: lockEntry.lockId });
  if (!roomResult.keyboardPwdId) return null;

  const entranceResult = await ttlockPost('/v3/keyboardPwd/add', { ...pwdParams, lockId: ENTRANCE_LOCK_ID });

  const doorAccess = {
    stayosCode: customCode,
    roomKeyboardPwdId: roomResult.keyboardPwdId,
    entranceKeyboardPwdId: entranceResult.keyboardPwdId || null,
    roomLockId: lockEntry.lockId,
    entranceLockId: ENTRANCE_LOCK_ID,
    generatedAt: new Date(),
    validFrom: new Date(startDate),
    validTo: new Date(endDate),
  };

  await Booking.updateOne({ _id: booking._id }, { $set: { doorAccess } });
  console.log(`[TTLock] Code generiert: ${booking.roomName || roomId} → ${customCode} (${guestName})`);
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
      .populate('companyId', 'name aliases')
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

    // Gast automatisch anlegen wenn guestName vorhanden aber kein echter guestId
    const Guest = require('../models/Guest');
    let guestId = req.body.guestId;
    if (req.body.guestName && (!guestId || guestId === '507f1f77bcf86cd799439011')) {
      const nameParts = req.body.guestName.trim().split(/\s+/);
      const firstName = nameParts.slice(0, -1).join(' ') || nameParts[0];
      const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
      // Bestehenden Gast suchen oder neuen anlegen
      let guest = await Guest.findOne({
        tenantId, firstName, lastName,
      });
      if (!guest) {
        guest = await Guest.create({
          tenantId,
          firstName,
          lastName,
          email: req.body.guestEmail || null,
          phone: req.body.guestPhone || null,
          companyName: req.body.guestCompany || null,
          source: 'direct',
        });
        console.log(`[Guest] Neu angelegt: ${firstName} ${lastName}`);
      }
      guestId = guest._id;
    }

    // Buchungsnummer automatisch generieren: SCH-XXXXXX
    const year = new Date().getFullYear();
    const count = await Booking.countDocuments();
    const bookingNumber = `SCH-${String(count + 1).padStart(6, '0')}`;

    const booking = await Booking.create({
      ...req.body,
      guestId,
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
      .select('-checkInToken -checkInTokenExpiry')
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

    // Booking nochmal laden damit doorAccess aktuell ist
    const updated = await Booking.findById(booking._id);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
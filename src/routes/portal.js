const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Settings = require('../models/Settings');
const { getToken, ttlockPost, CLIENT_ID } = require('../services/ttlockHelper');

const TENANT_ID = '507f1f77bcf86cd799439011';
const ENTRANCE_LOCK_ID = 3321320;

// Rate limiting: max 10 unlocks pro Token pro Tag
const unlockCounts = new Map();
function checkRateLimit(token) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${token}:${today}`;
  const count = unlockCounts.get(key) || 0;
  if (count >= 10) return false;
  unlockCounts.set(key, count + 1);
  // Cleanup alte Einträge
  for (const [k] of unlockCounts) {
    if (!k.endsWith(today)) unlockCounts.delete(k);
  }
  return true;
}

// GET /api/portal/:token — Buchungsdaten für Gast-Portal
router.get('/:token', async (req, res) => {
  try {
    const booking = await Booking.findOne({
      tenantId: TENANT_ID,
      guestPortalToken: req.params.token,
    });
    if (!booking) return res.json({ success: false, error: 'not_found' });

    // Expired: checkOut + 24h überschritten
    const checkOutDate = new Date(booking.checkOut);
    checkOutDate.setHours(checkOutDate.getHours() + 24);
    if (new Date() > checkOutDate) {
      return res.json({ success: false, error: 'expired' });
    }

    const settings = await Settings.findOne(
      { tenantId: TENANT_ID },
      'hotelName address whatsapp houseRules checkInTime checkOutTime'
    ).lean();

    // Nächte berechnen
    const msPerDay = 86400000;
    const ci = new Date(booking.checkIn);
    const co = new Date(booking.checkOut);
    const nights = Math.round((co - ci) / msPerDay);

    // Gastname splitten
    const nameParts = (booking.guestName || '').trim().split(/\s+/);
    const guestFirstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : nameParts[0] || '';

    res.json({
      success: true,
      data: {
        bookingNumber: booking.bookingNumber,
        guestName: booking.guestName,
        guestFirstName,
        roomName: booking.roomName,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        nights,
        doorCode: booking.doorAccess?.stayosCode || null,
        status: booking.status,
        roomLockId: booking.doorAccess?.roomLockId || null,
        hotelName: settings?.hotelName || 'smarthotel schmid',
        address: settings?.address || 'Schlossbergstraße 22, 3454 Sitzenberg-Reidling',
        whatsapp: settings?.whatsapp || '+436776203587',
        houseRules: settings?.houseRules || [],
        checkInTime: settings?.checkInTime || '15:00',
        checkOutTime: settings?.checkOutTime || '11:00',
        effectiveCheckInTime: booking.earlyCheckIn || settings?.checkInTime || '15:00',
        effectiveCheckOutTime: booking.lateCheckOut || settings?.checkOutTime || '11:00',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/portal/:token/unlock — Tür öffnen
router.post('/:token/unlock', async (req, res) => {
  try {
    const { target } = req.body;
    if (!['room', 'entrance'].includes(target)) {
      return res.json({ success: false, error: 'target muss room oder entrance sein' });
    }

    const booking = await Booking.findOne({
      tenantId: TENANT_ID,
      guestPortalToken: req.params.token,
    });
    if (!booking) return res.json({ success: false, error: 'not_found' });

    // Zeitfenster: checkIn <= jetzt <= checkOut + 2h
    const now = new Date();
    const checkIn = new Date(booking.checkIn);
    checkIn.setHours(0, 0, 0, 0);
    const checkOutPlus2h = new Date(booking.checkOut);
    checkOutPlus2h.setHours(checkOutPlus2h.getHours() + 14); // checkOut ist Datum, +11h (checkout time) +2h buffer
    if (now < checkIn || now > checkOutPlus2h) {
      return res.json({ success: false, error: 'Unlock nur während des Aufenthalts möglich' });
    }

    // Rate limit
    if (!checkRateLimit(req.params.token)) {
      return res.json({ success: false, error: 'Tageslimit erreicht (max 10 Unlocks)' });
    }

    const lockId = target === 'room' ? booking.doorAccess?.roomLockId : ENTRANCE_LOCK_ID;
    if (!lockId) return res.json({ success: false, error: 'Kein Schloss zugeordnet' });

    const token = await getToken();
    const result = await ttlockPost('/v3/lock/unlock', {
      clientId: CLIENT_ID,
      accessToken: token,
      lockId,
      date: Date.now(),
    });

    if (result.errcode) {
      return res.json({ success: false, error: result.errmsg || `Fehler ${result.errcode}` });
    }

    res.json({ success: true, message: target === 'room' ? 'Zimmer geöffnet' : 'Haupteingang geöffnet' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;

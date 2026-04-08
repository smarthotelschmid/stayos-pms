const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Settings = require('../models/Settings');
const { getToken, ttlockPost, CLIENT_ID } = require('../services/ttlockHelper');
const { formatAddress } = require('../utils/formatAddress');

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
      'hotelName hotelStreet hotelStreetNo hotelZip hotelCity hotelCountry hotelPhone hotelEmail hotelWebsite whatsapp receptionHours houseRules checkInTime checkOutTime googleMapsUrl'
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
        doorCode: booking.doorAccess?.stayosCode || booking.doorAccess?.code || null,
        status: booking.status,
        roomLockId: booking.doorAccess?.roomLockId || null,
        hotelName: settings?.hotelName || '',
        address: formatAddress(settings),
        googleMapsUrl: settings?.googleMapsUrl || '',
        whatsapp: settings?.whatsapp || '',
        hotelPhone: settings?.hotelPhone || '',
        hotelEmail: settings?.hotelEmail || '',
        receptionHours: settings?.receptionHours || '',
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

    // Zeitfenster: checkIn-Tag ab effectiveCheckInTime <= jetzt <= checkOut-Tag + checkOutTime + 2h
    const now = new Date();
    const settings = await Settings.findOne({ tenantId: TENANT_ID }, 'checkInTime checkOutTime').lean();
    const ciTime = booking.earlyCheckIn || settings?.checkInTime || '15:00';
    const coTime = settings?.checkOutTime || '11:00';
    const [ciH, ciM] = ciTime.split(':').map(Number);
    const [coH, coM] = coTime.split(':').map(Number);
    const checkInStart = new Date(booking.checkIn);
    checkInStart.setHours(ciH, ciM || 0, 0, 0);
    const checkOutEnd = new Date(booking.checkOut);
    checkOutEnd.setHours(coH + 2, coM || 0, 0, 0);
    if (now < checkInStart || now > checkOutEnd) {
      return res.json({ success: false, error: `Unlock erst ab ${ciTime} am Anreisetag möglich` });
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

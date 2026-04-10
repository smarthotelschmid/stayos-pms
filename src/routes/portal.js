const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Settings = require('../models/Settings');
const Property = require('../models/Property');
const { getToken, ttlockPost, CLIENT_ID } = require('../services/ttlockHelper');
const { formatAddress } = require('../utils/formatAddress');

function formatPropertyAddress(p) {
  if (!p) return '';
  const line1 = [p.hotelStreet, p.hotelStreetNo].filter(Boolean).join(' ');
  const line2 = [p.hotelCountry ? `${p.hotelCountry}-${p.hotelZip}` : p.hotelZip, p.hotelCity].filter(Boolean).join(' ');
  return [line1, line2].filter(Boolean).join('\n');
}

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

    // Portal-Öffnung tracken (nur Gäste, nicht Admin)
    const isAdmin = !!req.headers.authorization;
    if (!isAdmin) {
      await Booking.updateOne({ _id: booking._id }, { $set: { portalOpenedAt: new Date() }, $inc: { portalOpenCount: 1 } });
    }

    // Storniert oder gelöscht
    if (['cancelled', 'deleted'].includes(booking.status)) {
      return res.json({ success: false, error: 'cancelled' });
    }

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

    // Property laden (Vorrang vor Settings)
    const property = booking.propertyId
      ? await Property.findById(booking.propertyId).lean()
      : null;

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
        roomUnlockSupported: true,
        hotelName: property?.name || settings?.hotelName || '',
        address: property ? formatPropertyAddress(property) : formatAddress(settings),
        googleMapsUrl: settings?.googleMapsUrl || '',
        whatsapp: property?.whatsapp || settings?.whatsapp || '',
        hotelPhone: property?.hotelPhone || settings?.hotelPhone || '',
        hotelEmail: settings?.hotelEmail || '',
        receptionHours: settings?.receptionHours || '',
        houseRules: property?.houseRules?.length ? property.houseRules : settings?.houseRules || [],
        checkInTime: property?.checkInTime || settings?.checkInTime || '15:00',
        checkOutTime: property?.checkOutTime || settings?.checkOutTime || '11:00',
        effectiveCheckInTime: booking.earlyCheckIn || property?.checkInTime || settings?.checkInTime || '15:00',
        effectiveCheckOutTime: booking.lateCheckOut || property?.checkOutTime || settings?.checkOutTime || '11:00',
        ci: property?.ci || null,
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

    // Zeitfenster: checkIn-Tag ab effectiveCheckInTime (Vienna) <= jetzt <= checkOut-Tag + checkOutTime + 2h
    const now = new Date();
    const settings = await Settings.findOne({ tenantId: TENANT_ID }, 'checkInTime checkOutTime').lean();
    const ciTime = booking.earlyCheckIn || settings?.checkInTime || '15:00';
    const coTime = settings?.checkOutTime || '11:00';
    // Vienna Timezone korrekt: checkIn kann UTC-shifted sein (22:00 UTC = 00:00 Vienna)
    const { timeToUnix } = require('../services/ttlockService');
    const toViennaDate = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
    const ciStr = toViennaDate(booking.checkIn);
    const coStr = toViennaDate(booking.checkOut);
    const checkInStartMs = timeToUnix(ciStr, ciTime);
    const checkOutEndMs = timeToUnix(coStr, coTime) + 2 * 3600000; // +2h Buffer
    if (now.getTime() < checkInStartMs) {
      return res.json({ success: false, error: 'too_early', message: `Türöffnung ab ${ciTime} Uhr am Anreisetag möglich` });
    }
    if (now.getTime() > checkOutEndMs) {
      return res.json({ success: false, error: 'too_late', message: 'Aufenthalt beendet — Türöffnung nicht mehr möglich' });
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

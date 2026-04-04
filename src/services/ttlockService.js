const cron = require('node-cron');
const Settings = require('../models/Settings');
const Booking = require('../models/Booking');
const { getToken, ttlockPost, CLIENT_ID, TENANT_ID } = require('./ttlockHelper');

// Zeitstring "15:00" + Datum → Unix Timestamp in ms
function timeToUnix(dateStr, timeStr) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const [h, min] = (timeStr || '15:00').split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0).getTime();
}

// Datum als YYYY-MM-DD
function fmtDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function generateDoorCodes() {
  try {
    const settings = await Settings.findOne({ tenantId: TENANT_ID });
    if (!settings?.doorCodeSendEnabled) {
      console.log('[TTLock Cron] Türcode-Versand deaktiviert');
      return;
    }

    const daysBefore = settings.doorCodeDaysBefore || 1;
    const checkInTime = settings.checkInTime || '15:00';
    const checkOutTime = settings.checkOutTime || '11:00';

    // Ziel-Datum: heute + daysBefore
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysBefore);
    const targetStr = fmtDate(targetDate);

    // Buchungen finden: checkIn am Ziel-Datum, kein doorAccess.code
    const targetStart = new Date(targetDate); targetStart.setHours(0, 0, 0, 0);
    const targetEnd = new Date(targetDate); targetEnd.setHours(23, 59, 59, 999);

    const bookings = await Booking.find({
      tenantId: TENANT_ID,
      checkIn: { $gte: targetStart, $lte: targetEnd },
      status: { $in: ['confirmed', 'checked-in'] },
      'doorAccess.code': { $exists: false },
    });

    if (bookings.length === 0) {
      console.log(`[TTLock Cron] Keine Buchungen ohne Türcode für ${targetStr}`);
      return;
    }

    // TTLock Schlösser-Zuordnung laden
    const lockMap = {};
    (settings.ttlock?.locks || []).forEach(l => {
      if (l.roomId) lockMap[l.roomId.toString()] = l.lockId;
    });

    let token;
    try {
      token = await getToken();
    } catch (e) {
      console.log('[TTLock Cron] Kein Token:', e.message);
      return;
    }

    let generated = 0;
    for (const booking of bookings) {
      const roomId = (booking.roomId?._id || booking.roomId)?.toString();
      const lockId = lockMap[roomId];
      if (!lockId) {
        console.log(`[TTLock Cron] Kein Schloss für Zimmer ${booking.roomName || roomId}`);
        continue;
      }

      const checkIn = booking.checkIn instanceof Date ? fmtDate(booking.checkIn) : booking.checkIn.slice(0, 10);
      const checkOut = booking.checkOut instanceof Date ? fmtDate(booking.checkOut) : booking.checkOut.slice(0, 10);
      const startDate = timeToUnix(checkIn, checkInTime);
      const endDate = timeToUnix(checkOut, checkOutTime);

      const guestName = booking.guestName || booking.bookingNumber || 'Gast';

      const ENTRANCE_LOCK_ID = 3321320;
      try {
        const pwdName = `${guestName} ${booking.bookingNumber || ''}`.trim();
        const pwdParams = {
          clientId: CLIENT_ID,
          accessToken: token,
          keyboardPwdType: 2,
          startDate: startDate.toString(),
          endDate: endDate.toString(),
          keyboardPwdName: pwdName,
          date: Date.now(),
        };

        // PIN für Zimmer-Schloss generieren
        const roomResult = await ttlockPost('/v3/keyboardPwd/get', { ...pwdParams, lockId });
        if (!roomResult.keyboardPwd) {
          console.log(`[TTLock Cron] Fehler Zimmer ${booking.roomName}: ${roomResult.errmsg || JSON.stringify(roomResult)}`);
          continue;
        }

        // Gleichen PIN auch für Haupteingang generieren
        const entranceResult = await ttlockPost('/v3/keyboardPwd/get', { ...pwdParams, lockId: ENTRANCE_LOCK_ID });
        if (!entranceResult.keyboardPwd) {
          console.log(`[TTLock Cron] Warnung: Haupteingang-PIN fehlgeschlagen: ${entranceResult.errmsg}`);
        }

        await Booking.updateOne({ _id: booking._id }, {
          $set: {
            'doorAccess.code': roomResult.keyboardPwd,
            'doorAccess.roomLockId': lockId,
            'doorAccess.entranceLockId': ENTRANCE_LOCK_ID,
            'doorAccess.generatedAt': new Date(),
            'doorAccess.validFrom': new Date(startDate),
            'doorAccess.validTo': new Date(endDate),
          }
        });
        generated++;
        console.log(`[TTLock Cron] PIN generiert: ${booking.roomName} + Haupteingang → ${roomResult.keyboardPwd} (${guestName})`);

      } catch (e) {
        console.log(`[TTLock Cron] Fehler für ${booking.roomName}: ${e.message}`);
      }
    }

    console.log(`[TTLock Cron] ${generated}/${bookings.length} Türcodes generiert für ${targetStr}`);
    return { generated, total: bookings.length, date: targetStr };
  } catch (err) {
    console.error('[TTLock Cron] Fehler:', err.message);
    return { generated: 0, total: 0, error: err.message };
  }
}

function startTTLockCron() {
  // Täglich um 09:00
  cron.schedule('0 9 * * *', () => {
    console.log('[TTLock Cron] Starte tägliche Türcode-Generierung...');
    generateDoorCodes();
  });
  console.log('[TTLock Cron] Gestartet — täglich um 09:00');
}

module.exports = { startTTLockCron, generateDoorCodes };

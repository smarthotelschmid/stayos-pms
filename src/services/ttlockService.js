const cron = require('node-cron');
const Settings = require('../models/Settings');
const Booking = require('../models/Booking');
const { getToken, ttlockPost, CLIENT_ID, TENANT_ID } = require('./ttlockHelper');

// Zeitstring "15:00" + Datum → Unix Timestamp in ms
// TTLock addiert den CEST-Offset — wir senden Lokalzeit
function timeToUnix(dateStr, timeStr) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const [h, min] = (timeStr || '15:00').split(':').map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
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
        const Guest = require('../models/Guest');
        const guestId = (booking.guestId?._id || booking.guestId)?.toString();
        let phone = null;
        if (guestId) { const g = await Guest.findById(guestId, 'phone').lean(); phone = g?.phone; }
        const customCode = gen4Pin(phone);
        const pwdParams = {
          clientId: CLIENT_ID,
          accessToken: token,
          keyboardPwdType: 3, keyboardPwd: customCode, addType: 2,
          startDate: startDate.toString(),
          endDate: endDate.toString(),
          keyboardPwdName: pwdName,
          date: Date.now(),
        };

        // PIN für Zimmer-Schloss
        const roomResult = await ttlockPost('/v3/keyboardPwd/add', { ...pwdParams, lockId });
        if (!roomResult.keyboardPwdId) {
          console.log(`[TTLock Cron] Fehler Zimmer ${booking.roomName}: ${roomResult.errmsg || JSON.stringify(roomResult)}`);
          continue;
        }

        // Gleichen PIN auch für Haupteingang
        const entranceResult = await ttlockPost('/v3/keyboardPwd/add', { ...pwdParams, lockId: ENTRANCE_LOCK_ID });
        if (!entranceResult.keyboardPwdId) {
          console.log(`[TTLock Cron] Warnung: Haupteingang-PIN fehlgeschlagen: ${entranceResult.errmsg}`);
        }

        await Booking.updateOne({ _id: booking._id }, {
          $set: {
            'doorAccess.stayosCode': customCode,
            'doorAccess.roomKeyboardPwdId': roomResult.keyboardPwdId,
            'doorAccess.entranceKeyboardPwdId': entranceResult.keyboardPwdId || null,
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

const ALL_LOCKS = [
  3321320, 2720122, 2720112, 2521990, 2522158, 2720132, 2720138,
  2720152, 2720148, 2720144, 2720136, 2720126, 3653352, 3653284,
];

async function syncLockTime() {
  try {
    const token = await getToken();
    let ok = 0, fail = 0;
    for (const lockId of ALL_LOCKS) {
      try {
        const result = await ttlockPost('/v3/lock/updateDate', {
          clientId: CLIENT_ID, accessToken: token, lockId, date: Date.now(),
        });
        if (result.date && !result.errcode) { ok++; }
        else {
          // Retry einmal nach 3s
          await new Promise(r => setTimeout(r, 3000));
          const retry = await ttlockPost('/v3/lock/updateDate', {
            clientId: CLIENT_ID, accessToken: token, lockId, date: Date.now(),
          });
          if (retry.date && !retry.errcode) ok++; else fail++;
        }
      } catch { fail++; }
    }
    console.log(`[TTLock TimeSync] ${ok}/${ALL_LOCKS.length} Schlösser synchronisiert${fail ? `, ${fail} fehlgeschlagen` : ''}`);
  } catch (err) {
    console.error('[TTLock TimeSync] Fehler:', err.message);
  }
}

function startTTLockCron() {
  // Täglich um 03:00 — Zeitsynchronisierung
  cron.schedule('0 3 * * *', () => {
    console.log('[TTLock TimeSync] Starte tägliche Zeitsynchronisierung...');
    syncLockTime();
  });
  // Täglich um 09:00 — Türcodes generieren
  cron.schedule('0 9 * * *', () => {
    console.log('[TTLock Cron] Starte tägliche Türcode-Generierung...');
    generateDoorCodes();
  });
  console.log('[TTLock Cron] Gestartet — TimeSync 03:00, Türcodes 09:00');
}

module.exports = { startTTLockCron, generateDoorCodes, syncLockTime };

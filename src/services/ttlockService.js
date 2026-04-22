const cron = require('node-cron');
const { getToken, ttlockPost, CLIENT_ID, TENANT_ID } = require('./ttlockHelper');

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function timeToUnix(dateStr, timeStr) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const [h, min] = (timeStr || '15:00').split(':').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, h, min);
  const viennaStr = new Date(utcMs).toLocaleString('en', { timeZone: 'Europe/Vienna', timeZoneName: 'shortOffset' });
  const match = viennaStr.match(/GMT([+-]\d+)/);
  const offsetH = match ? parseInt(match[1]) : 2;
  return utcMs - offsetH * 3600000;
}

function timeToCron(timeStr) {
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  return `${m || 0} ${h || 0} * * *`;
}

// Vienna Mitternacht als Date-Objekt
function todayVienna() {
  const now = new Date();
  const vStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' }); // YYYY-MM-DD
  const [y, m, d] = vStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ─── Template-Timing aus DB laden ────────────────────────────────────────────

async function getDoorcodeTemplate() {
  try {
    const EmailTemplate = require('../models/EmailTemplate');
    const tpl = await EmailTemplate.findOne(
      { tenantId: TENANT_ID, type: 'doorcode' },
      'sendTime daysBefore'
    ).lean();
    return {
      sendTime:   tpl?.sendTime || '06:00',
      daysBefore: tpl?.daysBefore !== undefined ? tpl.daysBefore : 0,
    };
  } catch {
    return { sendTime: '06:00', daysBefore: 0 };
  }
}

// ─── Zeitsynchronisierung ─────────────────────────────────────────────────────

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

// ─── Code-Generierung für eine Buchung ───────────────────────────────────────

async function generateCodeForBooking(booking, token) {
  const Booking = require('../models/Booking');
  const IdempotencyKey = require('../models/IdempotencyKey');

  if (!booking.doorAccess?.roomLockId) {
    console.log(`[TTLock] ${booking.bookingNumber}: kein lockId — übersprungen`);
    return;
  }

  const checkInStr = booking.checkIn?.toISOString?.().slice(0, 10) || booking.checkIn;
  const roomKey = `ttlock-${booking._id}-${booking.doorAccess?.roomLockId}-${checkInStr}`;
  const entranceKey = `ttlock-${booking._id}-3321320-${checkInStr}`;

  // Idempotenz-Check
  try {
    await IdempotencyKey.create({ key: roomKey, tenantId: TENANT_ID });
  } catch (e) {
    if (e.code === 11000) {
      console.log(`[TTLock] ${booking.bookingNumber}: Code bereits generiert — übersprungen`);
      return;
    }
    throw e;
  }

  const pin = booking.doorAccess?.code;
  if (!pin) {
    console.log(`[TTLock] ${booking.bookingNumber}: kein PIN — übersprungen`);
    return;
  }

  const startMs  = timeToUnix(checkInStr, '15:00');
  const checkOutStr = booking.checkOut?.toISOString?.().slice(0, 10) || booking.checkOut;
  const endMs    = timeToUnix(checkOutStr, '11:00');

  let roomOk = false;
  try {
    const res = await ttlockPost('/v3/keyboardPwd/add', {
      clientId: CLIENT_ID, accessToken: token,
      lockId: booking.doorAccess?.roomLockId,
      keyboardPwdName: `${booking.bookingNumber}`,
      keyboardPwd: pin,
      startDate: startMs,
      endDate: endMs,
      addType: 2,
    });
    if (!res.errcode) {
      roomOk = true;
      await Booking.findOneAndUpdate(
        { _id: booking._id, tenantId: TENANT_ID },
        { 'doorAccess.lockKeyboardPwdId': res.keyboardPwdId }
      );
      console.log(`[TTLock] ${booking.bookingNumber}: Zimmer-Code gesetzt ✓`);
    } else {
      console.error(`[TTLock] ${booking.bookingNumber}: Zimmer-Code Fehler ${res.errcode}: ${res.errmsg}`);
    }
  } catch (err) {
    console.error(`[TTLock] ${booking.bookingNumber}: Zimmer-Code Exception:`, err.message);
  }

  if (!roomOk) return;

  // Haupteingang
  try {
    await IdempotencyKey.create({ key: entranceKey, tenantId: TENANT_ID });
  } catch (e) {
    if (e.code !== 11000) throw e;
  }

  await new Promise(r => setTimeout(r, 1000));

  try {
    const resE = await ttlockPost('/v3/keyboardPwd/add', {
      clientId: CLIENT_ID, accessToken: token,
      lockId: 3321320,
      keyboardPwdName: `${booking.bookingNumber}-entrance`,
      keyboardPwd: pin,
      startDate: startMs,
      endDate: endMs,
      addType: 2,
    });
    if (!resE.errcode) {
      await Booking.findOneAndUpdate(
        { _id: booking._id, tenantId: TENANT_ID },
        { 'doorAccess.entranceLockKeyboardPwdId': resE.keyboardPwdId }
      );
      console.log(`[TTLock] ${booking.bookingNumber}: Eingang-Code gesetzt ✓`);
    } else {
      console.error(`[TTLock] ${booking.bookingNumber}: Eingang-Code Fehler ${res.errcode}: ${res.errmsg}`);
    }
  } catch (err) {
    console.error(`[TTLock] ${booking.bookingNumber}: Eingang-Code Exception:`, err.message);
  }
}

// ─── Cron: Codes für heute + morgen generieren (06:00) ───────────────────────

async function generateUpcomingCodes() {
  console.log('[TTLock Cron] Starte Code-Generierung für heute + morgen...');
  try {
    const Booking = require('../models/Booking');
    const token = await getToken();
    const today = todayVienna();
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(today.getDate() + 2);

    const bookings = await Booking.find({
      tenantId: TENANT_ID,
      status: { $in: ['confirmed', 'checked-in'] },
      checkIn: { $gte: today, $lt: dayAfterTomorrow },
      'doorAccess.lockKeyboardPwdId': { $exists: false },
    }).lean();

    console.log(`[TTLock Cron] ${bookings.length} Buchungen ohne Code für heute/morgen`);

    for (const booking of bookings) {
      await generateCodeForBooking(booking, token);
      await new Promise(r => setTimeout(r, 1500));
    }

    console.log('[TTLock Cron] Code-Generierung abgeschlossen');
  } catch (err) {
    console.error('[TTLock Cron] Fehler bei Code-Generierung:', err.message);
  }
}

// ─── Cron: Abgelaufene Codes löschen (00:30) ─────────────────────────────────

async function cleanupExpiredCodes() {
  console.log('[TTLock Cleanup] Starte Bereinigung abgelaufener Codes...');
  try {
    const Booking = require('../models/Booking');
    const token = await getToken();
    const today = todayVienna();

    // Buchungen mit gestern oder früher als Checkout, die noch Codes haben
    const bookings = await Booking.find({
      tenantId: TENANT_ID,
      checkOut: { $lt: today },
      $or: [
        { 'doorAccess.lockKeyboardPwdId': { $exists: true, $ne: null } },
        { 'doorAccess.entranceLockKeyboardPwdId': { $exists: true, $ne: null } },
      ],
    }).lean();

    console.log(`[TTLock Cleanup] ${bookings.length} Buchungen mit abgelaufenen Codes`);
    let deleted = 0;

    for (const booking of bookings) {
      const updates = {};

      // Zimmer-Code löschen
      if (booking.doorAccess?.lockKeyboardPwdId) {
        try {
          const res = await ttlockPost('/v3/keyboardPwd/delete', {
            clientId: CLIENT_ID, accessToken: token,
            lockId: booking.doorAccess?.roomLockId,
            keyboardPwdId: booking.doorAccess.lockKeyboardPwdId,
            deleteType: 2,
          });
          if (!res.errcode) {
            updates['doorAccess.lockKeyboardPwdId'] = null;
            deleted++;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 1500));
      }

      // Eingang-Code löschen
      if (booking.doorAccess?.entranceLockKeyboardPwdId) {
        try {
          const res = await ttlockPost('/v3/keyboardPwd/delete', {
            clientId: CLIENT_ID, accessToken: token,
            lockId: 3321320,
            keyboardPwdId: booking.doorAccess.entranceLockKeyboardPwdId,
            deleteType: 2,
          });
          if (!res.errcode) {
            updates['doorAccess.entranceLockKeyboardPwdId'] = null;
            deleted++;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 1500));
      }

      if (Object.keys(updates).length > 0) {
        await Booking.findOneAndUpdate(
          { _id: booking._id, tenantId: TENANT_ID },
          { $set: updates }
        );
      }
    }

    console.log(`[TTLock Cleanup] ${deleted} Codes gelöscht`);
  } catch (err) {
    console.error('[TTLock Cleanup] Fehler:', err.message);
  }
}

// ─── Sofort-Generierung bei Buchungseingang (für syncService) ─────────────────
// Nur aufrufen wenn checkIn <= heute + 1 Tag

async function generateCodeIfImminent(booking) {
  const today = todayVienna();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const checkIn = new Date(booking.checkIn);
  const checkInDay = new Date(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate());

  // Nur generieren wenn checkIn heute oder morgen
  if (checkInDay > tomorrow) {
    console.log(`[TTLock] ${booking.bookingNumber}: checkIn > morgen — Code wird per Cron generiert`);
    return;
  }

  try {
    const token = await getToken();
    await generateCodeForBooking(booking, token);
  } catch (err) {
    console.error(`[TTLock] generateCodeIfImminent Fehler:`, err.message);
  }
}

// ─── Cron-Start ───────────────────────────────────────────────────────────────

async function startTTLockCron() {
  // Zeitsynchronisierung: täglich 03:00
  cron.schedule('0 3 * * *', () => {
    console.log('[TTLock TimeSync] Starte Zeitsynchronisierung...');
    syncLockTime();
  }, { timezone: 'Europe/Vienna' });

  // Code-Generierung für heute + morgen: täglich 06:00
  cron.schedule('0 6 * * *', () => {
    generateUpcomingCodes();
  }, { timezone: 'Europe/Vienna' });

  // Abgelaufene Codes löschen: täglich 00:30
  cron.schedule('30 0 * * *', () => {
    cleanupExpiredCodes();
  }, { timezone: 'Europe/Vienna' });

  console.log('[TTLock Cron] Gestartet — TimeSync 03:00 · Code-Gen 06:00 · Cleanup 00:30');
  console.log('[TTLock Cron] Sofort-Generierung nur für checkIn heute/morgen (via generateCodeIfImminent)');
}

module.exports = {
  startTTLockCron,
  syncLockTime,
  timeToCron,
  getDoorcodeTemplate,
  timeToUnix,
  generateCodeIfImminent,   // ← export für syncService
  generateUpcomingCodes,    // ← export für manuellen Trigger
  cleanupExpiredCodes,      // ← export für manuellen Trigger
};
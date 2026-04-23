const crypto = require('crypto');
const Booking = require('../models/Booking');
const Guest = require('../models/Guest');
const beds24 = require('./beds24Service');
const { BEDS24_ROOM_MAPPING: ROOM_MAPPING, UNIT_TO_ROOM } = require('./roomMapping');
const Company = require('../models/Company');
const Room = require('../models/Room');
const Settings = require('../models/Settings');
const { transformBeds24Booking, transformBeds24Guest, transformBeds24Company, isEmailFake } = require('./dataTransformer');
const { getToken, ttlockPost, CLIENT_ID } = require('./ttlockHelper');
const { timeToUnix, generateCodeIfImminent } = require('./ttlockService');
const { sendDoorCodeEmail } = require('./doorCodeEmailService');
const { sendConfirmationEmail, sendCancellationEmail } = require('./bookingEmailService');
const mongoose = require('mongoose');
const ENTRANCE_LOCK_ID = 3321320;

const SYNC_INTERVAL = 1 * 60 * 1000; // 1 Minute — Webhook zusätzlich, Polling ist primär
const FLOW_START = new Date('2099-01-01T00:00:00+02:00'); // Check-in Flow deaktiviert // Check-in Flow ab diesem Datum
const TENANT_ID = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');

// ── Sync-Mutex + Fresh-Age-Filter für Orphan-Check ──
// Verhindert Race Conditions:
// 1. _isSyncing Lock: nur ein Sync-Run gleichzeitig (Webhook + Cron können
//    sonst parallel laufen, wobei einer eine stale Beds24-Response hat und
//    gerade erst angelegte Buchungen als Orphans wegdeletet).
// 2. ORPHAN_SKIP_RECENT_MS: Buchungen, die innerhalb der letzten 2 Minuten
//    upserted wurden, werden vom Orphan-Check AUSGENOMMEN. Defense-in-Depth
//    falls der Lock mal umgangen wird.
let _isSyncing = false;
const ORPHAN_SKIP_RECENT_MS = 2 * 60 * 1000;

async function syncBookings(source = 'cron') {
  if (_isSyncing) {
    console.log(`[Beds24 Sync] Skip (${source}) — anderer Sync läuft bereits`);
    return { skipped: true, reason: 'locked' };
  }
  _isSyncing = true;
  try {
    const today = new Date();
    const future = new Date(today);
    future.setDate(future.getDate() + 365);
    const fromDate = '2025-01-01';
    const toDate = future.toISOString().split('T')[0];

    let allBookings = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const result = await beds24.getBookings(fromDate, toDate, page);
      if (result.data && result.data.length > 0) {
        allBookings = allBookings.concat(result.data);
      }
      hasMore = result.pages?.nextPageExists || false;
      page++;
    }

    let created = 0;
    let updated = 0;
    let guestsCreated = 0;

    // DEBUG: Alle Beds24 Statuswerte loggen
    const statusCounts = {};
    allBookings.forEach(b => { statusCounts[b.status || 'undefined'] = (statusCounts[b.status || 'undefined'] || 0) + 1; });
    console.log(`[Beds24 Debug] Status-Verteilung:`, JSON.stringify(statusCounts));

    for (const b of allBookings) {
      // Company upsert — prüfe aliases zuerst
      let companyId = null;
      if (b.company) {
        const companyData = transformBeds24Company(b);
        if (companyData) {
          // Erst nach Name oder Alias suchen
          let existing = await Company.findOne({
            tenantId: TENANT_ID,
            $or: [
              { name: companyData.name },
              { aliases: { $regex: new RegExp(`^${companyData.name}$`, 'i') } },
            ]
          });
          if (existing) {
            companyId = existing._id;
          } else {
            const companyResult = await Company.findOneAndUpdate(
              { name: companyData.name, tenantId: TENANT_ID },
              { $set: companyData },
              { upsert: true, new: true }
            );
            companyId = companyResult._id;
          }
        }
      }

      // Guest upsert — check guests[0] as fallback for company bookings
      let guestId = null;
      const g0 = b.guests?.[0];
      const hasGuestData = b.firstName || b.lastName || b.email || g0?.firstName || g0?.lastName || b.company;
      if (hasGuestData) {
        const guestData = transformBeds24Guest(b);

        // For company bookings with individual guests: match by guest ID only
        const isCompanyWithGuest = g0?.id && !b.firstName && !b.lastName;
        if (isCompanyWithGuest) {
          guestData.beds24GuestId = `beds24-guest-${g0.id}`;
          guestData.email = g0.email || null;
          guestData.emailIsFake = false;
        }

        const email = guestData.email;
        const isFake = guestData.emailIsFake;

        // Match-Kette:
        //   1. beds24GuestId (primaer)
        //   2. email (wenn nicht fake)
        //   3. normNameKey (lowercase + Diakritika gestrippt — Mueller/Müller/muller gleiche Person)
        const matchQuery = isCompanyWithGuest
          ? { tenantId: TENANT_ID, beds24GuestId: guestData.beds24GuestId }
          : email && !isFake
            ? { tenantId: TENANT_ID, $or: [
                { beds24GuestId: guestData.beds24GuestId },
                { email },
                ...(guestData.normNameKey ? [{ normNameKey: guestData.normNameKey }] : []),
              ] }
            : { tenantId: TENANT_ID, $or: [
                { beds24GuestId: guestData.beds24GuestId },
                ...(guestData.normNameKey ? [{ normNameKey: guestData.normNameKey }] : []),
              ] };

        const guestResult = await Guest.findOneAndUpdate(
          matchQuery,
          { $set: guestData },
          { upsert: true, new: true, includeResultMetadata: true }
        );
        guestId = guestResult.value?._id || guestResult._id;
        if (!guestResult.lastErrorObject?.updatedExisting) guestsCreated++;

        // Link company to guest + directBookingPotential
        if (companyId && guestId) {
          const companyDoc = await Company.findOne({ _id: companyId, tenantId: TENANT_ID }, 'type').lean();
          const hasContact = (guestData.email && !guestData.emailIsFake) || !!guestData.phone;
          const dbp = companyDoc?.type === 'travel_agency' && hasContact;
          await Guest.updateOne({ _id: guestId, tenantId: TENANT_ID }, { $set: { companyId, ...(dbp ? { directBookingPotential: true } : {}) } });
        }
      }

      // Booking upsert — soft-deleted und manuell überschriebene Buchungen nicht anfassen
      const existing = await Booking.findOne({ tenantId: TENANT_ID, beds24BookingId: b.id });
      if (existing?.status === 'deleted') continue;
      if (existing?.manualOverride === true) continue;

      const bookingData = transformBeds24Booking(b, ROOM_MAPPING, UNIT_TO_ROOM);
      bookingData.guestId = guestId;
      bookingData.companyId = companyId;
      // doorAccess nicht komplett überschreiben — nur code aktualisieren
      if (bookingData.doorAccess?.code) {
        bookingData['doorAccess.code'] = bookingData.doorAccess.code;
      }
      delete bookingData.doorAccess;
      const { bookingNumber, ...updateData } = bookingData;

      const result = await Booking.findOneAndUpdate(
        { tenantId: TENANT_ID, beds24BookingId: b.id },
        { $set: updateData, $setOnInsert: { bookingNumber, guestPortalToken: crypto.randomBytes(32).toString('hex'), guestPortalTokenExpiry: new Date(new Date(bookingData.checkOut).getTime() + 24 * 60 * 60 * 1000), 'checkInForm.completed': new Date(bookingData.checkIn) < FLOW_START } },
        { upsert: true, new: true, includeResultMetadata: true }
      );

      // roomId + roomLockId zuweisen/aktualisieren wenn roomName vorhanden
      const savedBooking = result.value;
      if (savedBooking?.roomName && (!savedBooking.roomId || (existing && existing.roomName !== savedBooking.roomName))) {
        // 1. Exakter Match in Room Collection
        let room = await Room.findOne({ name: savedBooking.roomName, tenantId: TENANT_ID }).lean();
        // 2. Fallback: Unit-Mapping aus Beds24 (z.B. "Deluxe" → roomId 546888, unitId → "Zimmer 1")
        if (!room && savedBooking.beds24RoomId && savedBooking.beds24UnitId && savedBooking.beds24UnitId > 0) {
          const unitName = UNIT_TO_ROOM[`${savedBooking.beds24RoomId}-${savedBooking.beds24UnitId}`];
          if (unitName) room = await Room.findOne({ name: unitName, tenantId: TENANT_ID }).lean();
        }
        // 3. Auto-Assign bei Pool-Buchung (unitId=0/null): waehle ein freies Zimmer
        //    des passenden Room-Types aus ROOM_MAPPING[...].stayosRooms.
        //    Kollisionscheck: keine ueberlappende Buchung auf demselben Zimmer.
        let autoAssigned = false;
        if (!room && savedBooking.beds24RoomId && (!savedBooking.beds24UnitId || savedBooking.beds24UnitId < 1)) {
          const typeInfo = ROOM_MAPPING[String(savedBooking.beds24RoomId)];
          if (typeInfo?.stayosRooms?.length) {
            const candidateNames = typeInfo.stayosRooms.map(s => /^\d+$/.test(s) ? `Zimmer ${s}` : s);
            const candidates = await Room.find({ tenantId: TENANT_ID, name: { $in: candidateNames } }).lean();
            const ci = new Date(savedBooking.checkIn);
            const co = new Date(savedBooking.checkOut);
            for (const cand of candidates) {
              const conflict = await Booking.findOne({
                tenantId: TENANT_ID,
                _id: { $ne: savedBooking._id },
                roomId: cand._id,
                status: { $nin: ['cancelled', 'deleted', 'no-show', 'checked-out'] },
                checkIn: { $lt: co },
                checkOut: { $gt: ci },
              }).lean();
              if (!conflict) { room = cand; autoAssigned = true; break; }
            }
            if (!room) {
              console.log(`[Beds24 Sync] Auto-Assign fehlgeschlagen fuer ${savedBooking.bookingNumber}: kein freies ${typeInfo.name}-Zimmer im Zeitraum`);
            }
          }
        }
        if (room) {
          const roomUpdate = { roomId: room._id };
          // Bei Auto-Assign auch roomName auf den konkreten Zimmer-Namen setzen
          if (autoAssigned && savedBooking.roomName !== room.name) {
            roomUpdate.roomName = room.name;
            console.log(`[Beds24 Sync] Auto-Assign: ${savedBooking.bookingNumber} → ${room.name} (Pool-Buchung aus ${savedBooking.roomName})`);
          }
          const settings = await Settings.findOne({ tenantId: TENANT_ID }, 'ttlock.locks checkInTime checkOutTime').lean();
          const lock = (settings?.ttlock?.locks || []).find(l => l.roomId?.toString() === room._id.toString());
          if (lock) roomUpdate['doorAccess.roomLockId'] = lock.lockId;
          await Booking.updateOne({ _id: savedBooking._id }, { $set: roomUpdate });

          // Zimmerwechsel? Altes Lock ≠ neues Lock + STAYOS-Code vorhanden → Code migrieren
          const oldLockId = existing?.doorAccess?.roomLockId;
          const newLockId = lock?.lockId;
          if (oldLockId && newLockId && oldLockId !== newLockId && existing?.doorAccess?.stayosCode) {
            try {
              const token = await getToken();
              const params = { clientId: CLIENT_ID, accessToken: token, date: Date.now() };
              // Alten Code löschen
              if (existing.doorAccess.roomKeyboardPwdId) {
                await ttlockPost('/v3/keyboardPwd/delete', { ...params, lockId: oldLockId, keyboardPwdId: existing.doorAccess.roomKeyboardPwdId });
              }
              // Neuen Code auf neuem Lock generieren (gleicher PIN, korrekte Vienna TZ)
              const ciStr = savedBooking.checkIn instanceof Date ? savedBooking.checkIn.toISOString().slice(0,10) : String(savedBooking.checkIn).slice(0,10);
              const coStr = savedBooking.checkOut instanceof Date ? savedBooking.checkOut.toISOString().slice(0,10) : String(savedBooking.checkOut).slice(0,10);
              const startMs = timeToUnix(ciStr, settings.checkInTime || '15:00');
              const endMs = timeToUnix(coStr, settings.checkOutTime || '11:00');
              const pwdParams = {
                clientId: CLIENT_ID, accessToken: token,
                keyboardPwdType: 3, keyboardPwd: existing.doorAccess.stayosCode, addType: 2,
                startDate: startMs.toString(), endDate: endMs.toString(),
                keyboardPwdName: `${savedBooking.guestName || ''} ${savedBooking.bookingNumber || ''}`.trim(),
                date: Date.now(),
              };
              const roomResult = await ttlockPost('/v3/keyboardPwd/add', { ...pwdParams, lockId: newLockId });
              if (roomResult.keyboardPwdId) {
                await Booking.updateOne({ _id: savedBooking._id }, { $set: {
                  'doorAccess.roomKeyboardPwdId': roomResult.keyboardPwdId,
                  'doorAccess.roomLockId': newLockId,
                }});
                console.log(`[Beds24 Sync] Zimmerwechsel TTLock: ${existing.roomName} → ${savedBooking.roomName}, Code ${existing.doorAccess.stayosCode} migriert`);

                // Email an Gast wenn checkIn === heute (Vienna TZ)
                const viennaToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
                if (ciStr === viennaToday && !savedBooking.communication?.doorCodeSent) {
                  sendDoorCodeEmail(savedBooking._id).catch(e =>
                    console.log(`[Beds24 Sync] Zimmerwechsel Email Fehler: ${e.message}`)
                  );
                }
              }
            } catch (e) {
              console.log(`[Beds24 Sync] TTLock Zimmerwechsel Fehler: ${e.message}`);
            }
          }
        }
      }

      // Code generieren — nur wenn checkIn heute oder morgen (Cron übernimmt den Rest)
      const freshBooking = await Booking.findOne({ _id: result.value?._id, tenantId: TENANT_ID }).lean();
      if (freshBooking && freshBooking.status === 'confirmed' && !freshBooking.doorAccess?.stayosCode && freshBooking.doorAccess?.roomLockId) {
        generateCodeIfImminent(freshBooking).catch(e =>
          console.log(`[Beds24 Sync] generateCodeIfImminent Fehler: ${e.message}`)
        );
      }

      // Link booking to guest
      if (guestId && result.value?._id) {
        await Guest.updateOne(
          { _id: guestId },
          { $addToSet: { bookings: result.value._id } }
        );
      }

      const wasCreated = !result.lastErrorObject?.updatedExisting;
      if (wasCreated) {
        created++;
        // Neue Buchung mit Status confirmed → Bestätigungs-Email (fire-and-forget, Guard intern)
        if (result.value?.status === 'confirmed') {
          sendConfirmationEmail(result.value._id).catch(e =>
            console.log(`[Beds24 Sync] Confirmation Email Fehler: ${e.message}`)
          );
        }
      } else {
        updated++;
      }
    }

    // Stornierung: Buchungen die in Beds24 nicht mehr existieren → cancelled
    // Zukünftige: soft-delete. Aktive (checkIn <= heute): cancelled (nicht deleted)
    const beds24Ids = allBookings.map(b => b.id);
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    // Fresh-Age: kürzlich upserted Buchungen nicht als Orphan behandeln
    const staleThreshold = new Date(now.getTime() - ORPHAN_SKIP_RECENT_MS);

    // Zukünftige Buchungen → deleted (wie bisher)
    const orphanedFuture = await Booking.updateMany(
      {
        beds24BookingId: { $nin: beds24Ids },
        tenantId: TENANT_ID,
        source: 'beds24',
        status: { $nin: ['deleted', 'cancelled', 'checked-out', 'no-show'] },
        manualOverride: { $ne: true },
        checkIn: { $gt: tomorrow },
        updatedAt: { $lt: staleThreshold }, // Fresh-Age-Filter
      },
      {
        $set: {
          status: 'deleted',
          deletedAt: now,
          deletedBy: 'beds24-sync',
          deleteReason: 'In Beds24 nicht mehr vorhanden'
        }
      }
    );
    const removedFuture = orphanedFuture.modifiedCount || 0;
    if (removedFuture > 0) console.log(`[Beds24 Sync] ${removedFuture} zukünftige Buchungen soft-deleted`);

    // Aktive Buchungen mit Check-in HEUTE ODER ZUKUNFT die nicht mehr in Beds24 sind → cancelled
    // Vergangene (check-out bereits vorbei) ignorieren — die sind einfach abgereist
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
    const todayDate = new Date(todayStr + 'T00:00:00Z');
    const toCancelFilter = {
      beds24BookingId: { $nin: beds24Ids },
      tenantId: TENANT_ID,
      source: 'beds24',
      status: { $in: ['confirmed'] },
      manualOverride: { $ne: true },
      checkIn: { $gte: todayDate },
      updatedAt: { $lt: staleThreshold }, // Fresh-Age-Filter
    };
    // IDs vorher holen, damit wir nach dem updateMany pro Buchung die Storno-Email feuern können
    const toCancelIds = await Booking.find(toCancelFilter, '_id').lean();
    const orphanedActive = await Booking.updateMany(
      toCancelFilter,
      {
        $set: {
          status: 'cancelled',
          cancelledAt: now,
          deleteReason: 'In Beds24 storniert/entfernt'
        }
      }
    );
    const cancelledCount = orphanedActive.modifiedCount || 0;
    if (cancelledCount > 0) console.log(`[Beds24 Sync] ${cancelledCount} aktive Buchungen → cancelled (in Beds24 nicht mehr vorhanden)`);
    for (const { _id } of toCancelIds) {
      sendCancellationEmail(_id).catch(e =>
        console.log(`[Beds24 Sync] Cancellation Email Fehler: ${e.message}`)
      );
    }

    const removed = removedFuture + cancelledCount;

    const summary = {
      synced: allBookings.length,
      created, updated, guestsCreated, removed,
      timestamp: new Date().toISOString()
    };
    console.log(`[QUELLE: ${source}] ${summary.synced} Buchungen (${created} neu, ${updated} aktualisiert, ${removed} soft-deleted), ${guestsCreated} neue Gäste`);
    return summary;
  } catch (err) {
    console.error('[Beds24 Sync] Fehler:', err.message, '\n', err.stack);
    throw err;
  } finally {
    _isSyncing = false;
  }
}

function startSync() {
  setTimeout(async () => {
    try {
      await syncBookings();
    } catch (err) {
      console.error('[Beds24 Sync] Initialer Sync fehlgeschlagen:', err.message);
    }
  }, 5000);

  setInterval(async () => {
    try {
      await syncBookings();
    } catch (err) {
      console.error('[Beds24 Sync] Periodischer Sync fehlgeschlagen:', err.message);
    }
  }, SYNC_INTERVAL);

  console.log('[Beds24 Sync] Gestartet — Intervall: 1 Minute');
}

module.exports = { syncBookings, startSync };

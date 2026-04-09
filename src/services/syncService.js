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
const { timeToUnix } = require('./ttlockService');
const { sendDoorCodeEmail } = require('./doorCodeEmailService');
const ENTRANCE_LOCK_ID = 3321320;

const SYNC_INTERVAL = 6 * 60 * 60 * 1000; // 6 Stunden Fallback (Webhook ist primär)
const TENANT_ID = '507f1f77bcf86cd799439011';

async function syncBookings() {
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

        const matchQuery = isCompanyWithGuest
          ? { beds24GuestId: guestData.beds24GuestId }
          : email && !isFake
            ? { $or: [{ beds24GuestId: guestData.beds24GuestId }, { email, tenantId: TENANT_ID }] }
            : { $or: [
                { beds24GuestId: guestData.beds24GuestId },
                ...(guestData.firstName && guestData.lastName ? [{ firstName: guestData.firstName, lastName: guestData.lastName, tenantId: TENANT_ID }] : [])
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
          const companyDoc = await Company.findById(companyId, 'type').lean();
          const hasContact = (guestData.email && !guestData.emailIsFake) || !!guestData.phone;
          const dbp = companyDoc?.type === 'travel_agency' && hasContact;
          await Guest.updateOne({ _id: guestId }, { $set: { companyId, ...(dbp ? { directBookingPotential: true } : {}) } });
        }
      }

      // Booking upsert — soft-deleted und manuell überschriebene Buchungen nicht anfassen
      const existing = await Booking.findOne({ beds24BookingId: b.id });
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
        { beds24BookingId: b.id },
        { $set: updateData, $setOnInsert: { bookingNumber, guestPortalToken: crypto.randomBytes(32).toString('hex') } },
        { upsert: true, new: true, includeResultMetadata: true }
      );

      // roomId + roomLockId zuweisen/aktualisieren wenn roomName vorhanden
      const savedBooking = result.value;
      if (savedBooking?.roomName && (!savedBooking.roomId || (existing && existing.roomName !== savedBooking.roomName))) {
        // 1. Exakter Match in Room Collection
        let room = await Room.findOne({ name: savedBooking.roomName, tenantId: TENANT_ID }).lean();
        // 2. Fallback: Unit-Mapping aus Beds24 (z.B. "Deluxe" → roomId 546888, unitId → "Zimmer 1")
        if (!room && savedBooking.beds24RoomId && savedBooking.beds24UnitId) {
          const unitName = UNIT_TO_ROOM[`${savedBooking.beds24RoomId}-${savedBooking.beds24UnitId}`];
          if (unitName) room = await Room.findOne({ name: unitName, tenantId: TENANT_ID }).lean();
        }
        if (room) {
          const roomUpdate = { roomId: room._id };
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

      // Code generieren wenn Buchung confirmed + kein STAYOS-Code + roomLockId vorhanden
      const freshBooking = await Booking.findById(result.value?._id).lean();
      if (freshBooking && freshBooking.status === 'confirmed' && !freshBooking.doorAccess?.stayosCode && freshBooking.doorAccess?.roomLockId) {
        try {
          const settings2 = await Settings.findOne({ tenantId: TENANT_ID }).lean();
          const lockEntry = (settings2?.ttlock?.locks || []).find(l => l.lockId === freshBooking.doorAccess.roomLockId);
          if (lockEntry && settings2?.ttlock?.accessToken) {
            const token = await getToken();
            const checkInTime = settings2.checkInTime || '15:00';
            const checkOutTime = settings2.checkOutTime || '11:00';
            const ciStr2 = new Date(freshBooking.checkIn).toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
            const coStr2 = new Date(freshBooking.checkOut).toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
            const startMs2 = timeToUnix(ciStr2, checkInTime);
            const endMs2 = timeToUnix(coStr2, checkOutTime);
            const pin = String(1000 + Math.floor(Math.random() * 9000));
            const pwdParams = {
              clientId: CLIENT_ID, accessToken: token,
              keyboardPwdType: 3, keyboardPwd: pin, addType: 2,
              startDate: startMs2.toString(), endDate: endMs2.toString(),
              keyboardPwdName: `${freshBooking.guestName || ''} ${freshBooking.bookingNumber || ''}`.trim(),
              date: Date.now(),
            };
            const roomResult = await ttlockPost('/v3/keyboardPwd/add', { ...pwdParams, lockId: lockEntry.lockId });
            const entranceResult = await ttlockPost('/v3/keyboardPwd/add', { ...pwdParams, lockId: ENTRANCE_LOCK_ID });
            if (roomResult.keyboardPwdId) {
              await Booking.updateOne({ _id: freshBooking._id }, { $set: {
                'doorAccess.stayosCode': pin,
                'doorAccess.roomKeyboardPwdId': roomResult.keyboardPwdId,
                'doorAccess.entranceKeyboardPwdId': entranceResult.keyboardPwdId || null,
                'doorAccess.roomLockId': lockEntry.lockId,
                'doorAccess.entranceLockId': ENTRANCE_LOCK_ID,
                'doorAccess.generatedAt': new Date(),
                'doorAccess.validFrom': new Date(startMs2),
                'doorAccess.validTo': new Date(endMs2),
              }});
              console.log(`[Beds24 Sync] Code generiert: ${freshBooking.roomName} → ${pin} (${freshBooking.guestName})`);

              // Check-in heute? Email sofort
              const todayVienna = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
              if (ciStr2 === todayVienna) {
                sendDoorCodeEmail(freshBooking._id).catch(e => console.log(`[Beds24 Sync] Email Fehler: ${e.message}`));
              }
            }
          }
        } catch (e) {
          console.log(`[Beds24 Sync] Code-Generierung Fehler: ${e.message}`);
        }
      }

      // Link booking to guest
      if (guestId && result.value?._id) {
        await Guest.updateOne(
          { _id: guestId },
          { $addToSet: { bookings: result.value._id } }
        );
      }

      if (result.lastErrorObject?.updatedExisting) {
        updated++;
      } else {
        created++;
      }
    }

    // Soft Delete: nur ZUKÜNFTIGE Buchungen die in Beds24 nicht mehr existieren
    // CheckOut muss mindestens 48h in der Zukunft liegen — verhindert Löschung
    // von Buchungen die gerade ausgecheckt wurden und aus der Beds24 API verschwinden
    const beds24Ids = allBookings.map(b => b.id);
    const now = new Date();
    const safeCutoff = new Date(now.getTime() + 48 * 60 * 60 * 1000); // +48h
    const orphaned = await Booking.updateMany(
      {
        beds24BookingId: { $nin: beds24Ids },
        source: 'beds24',
        status: { $nin: ['deleted', 'cancelled', 'checked-out', 'no-show'] },
        manualOverride: { $ne: true },
        checkOut: { $gte: safeCutoff }
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
    const removed = orphaned.modifiedCount || 0;
    if (removed > 0) console.log(`[Beds24 Sync] ${removed} Buchungen soft-deleted`);

    const summary = {
      synced: allBookings.length,
      created, updated, guestsCreated, removed,
      timestamp: new Date().toISOString()
    };
    console.log(`[Beds24 Sync] ${summary.synced} Buchungen (${created} neu, ${updated} aktualisiert, ${removed} soft-deleted), ${guestsCreated} neue Gäste`);
    return summary;
  } catch (err) {
    console.error('[Beds24 Sync] Fehler:', err.message);
    throw err;
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

  console.log('[Beds24 Sync] Gestartet — Intervall: 30 Minuten');
}

module.exports = { syncBookings, startSync };

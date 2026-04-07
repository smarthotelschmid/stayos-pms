const Booking = require('../models/Booking');
const Guest = require('../models/Guest');
const beds24 = require('./beds24Service');
const { BEDS24_ROOM_MAPPING: ROOM_MAPPING, UNIT_TO_ROOM } = require('./roomMapping');
const Company = require('../models/Company');
const { transformBeds24Booking, transformBeds24Guest, transformBeds24Company, isEmailFake } = require('./dataTransformer');

const SYNC_INTERVAL = 30 * 60 * 1000; // 30 Minuten
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

        // Link company to guest
        if (companyId && guestId) {
          await Guest.updateOne({ _id: guestId }, { $set: { companyId } });
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
        { $set: updateData, $setOnInsert: { bookingNumber } },
        { upsert: true, new: true, includeResultMetadata: true }
      );

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

    // Soft Delete: nur VERGANGENE Buchungen die in Beds24 nicht mehr existieren
    // Aktive Buchungen (checkOut in Zukunft) nie automatisch löschen
    // TODO: ersetzt durch Webhook-Logik wenn Self-built Channel Manager live
    const beds24Ids = allBookings.map(b => b.id);
    const now = new Date();
    const orphaned = await Booking.updateMany(
      {
        beds24BookingId: { $nin: beds24Ids },
        source: 'beds24',
        status: { $nin: ['deleted', 'checked-out', 'no-show'] },
        manualOverride: { $ne: true },
        checkOut: { $gte: now }
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

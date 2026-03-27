const Booking = require('../models/Booking');
const Guest = require('../models/Guest');
const beds24 = require('./beds24Service');
const ROOM_MAPPING = require('./roomMapping');
const { transformBeds24Booking, transformBeds24Guest, isEmailFake } = require('./dataTransformer');

const SYNC_INTERVAL = 30 * 60 * 1000; // 30 Minuten
const TENANT_ID = '507f1f77bcf86cd799439011';

async function syncBookings() {
  try {
    const today = new Date();
    const past = new Date(today);
    past.setDate(past.getDate() - 180);
    const future = new Date(today);
    future.setDate(future.getDate() + 365);
    const fromDate = past.toISOString().split('T')[0];
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
      // Guest upsert
      let guestId = null;
      if (b.firstName || b.lastName || b.email) {
        const guestData = transformBeds24Guest(b);
        const email = guestData.email;
        const isFake = guestData.emailIsFake;

        const matchQuery = email && !isFake
          ? { $or: [{ beds24GuestId: guestData.beds24GuestId }, { email, tenantId: TENANT_ID }] }
          : { beds24GuestId: guestData.beds24GuestId };

        const guestResult = await Guest.findOneAndUpdate(
          matchQuery,
          { $set: guestData },
          { upsert: true, new: true, includeResultMetadata: true }
        );
        guestId = guestResult.value?._id || guestResult._id;
        if (!guestResult.lastErrorObject?.updatedExisting) guestsCreated++;
      }

      // Booking upsert
      const bookingData = transformBeds24Booking(b, ROOM_MAPPING);
      bookingData.guestId = guestId;

      const result = await Booking.findOneAndUpdate(
        { beds24BookingId: b.id },
        { $set: bookingData },
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

    const summary = {
      synced: allBookings.length,
      created, updated, guestsCreated,
      timestamp: new Date().toISOString()
    };
    console.log(`[Beds24 Sync] ${summary.synced} Buchungen (${created} neu, ${updated} aktualisiert), ${guestsCreated} neue Gäste`);
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

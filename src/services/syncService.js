const Booking = require('../models/Booking');
const beds24 = require('./beds24Service');
const ROOM_MAPPING = require('./roomMapping');

const SYNC_INTERVAL = 30 * 60 * 1000; // 30 Minuten
const TENANT_ID = '507f1f77bcf86cd799439011';

function mapStatus(beds24Status) {
  if (beds24Status === 'confirmed') return 'confirmed';
  if (beds24Status === 'cancelled') return 'cancelled';
  if (beds24Status === 'checked-in' || beds24Status === 'checkedin') return 'checked-in';
  if (beds24Status === 'checked-out' || beds24Status === 'checkedout') return 'checked-out';
  if (beds24Status === 'no-show' || beds24Status === 'noshow') return 'no-show';
  return 'confirmed';
}

function mapSource(apiSource, channel) {
  const src = (apiSource || '').toLowerCase();
  if (src === 'booking.com') return 'booking';
  if (src === 'airbnb') return 'airbnb';
  if (src === 'expedia') return 'expedia';
  return 'beds24';
}

async function syncBookings() {
  try {
    const today = new Date();
    const future = new Date(today);
    future.setDate(future.getDate() + 365);
    const fromDate = today.toISOString().split('T')[0];
    const toDate = future.toISOString().split('T')[0];

    let allBookings = [];
    let page = 1;
    let hasMore = true;

    // Alle Seiten holen
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

    for (const b of allBookings) {
      const mapped = ROOM_MAPPING[String(b.roomId)] || null;
      const bookingData = {
        tenantId: TENANT_ID,
        bookingNumber: `B24-${b.id}`,
        source: mapSource(b.apiSource, b.channel),
        beds24BookingId: b.id,
        beds24RoomId: b.roomId,
        beds24PropertyId: b.propertyId,
        guestName: `${b.firstName || ''} ${b.lastName || ''}`.trim() || null,
        channel: b.apiSource || b.channel || 'direct',
        status: mapStatus(b.status),
        adults: b.numAdult || 1,
        children: b.numChild || 0,
        checkIn: new Date(b.arrival),
        checkOut: new Date(b.departure),
        nights: Math.round((new Date(b.departure) - new Date(b.arrival)) / 86400000),
        pricing: { total: b.price || 0 },
        externalId: String(b.id),
        internalNotes: b.notes || undefined,
        roomName: mapped ? mapped.name : 'Unbekannt',
        roomType: mapped ? mapped.type : 'unknown',
        hasBalcony: mapped ? mapped.hasBalcony : false,
      };

      const result = await Booking.findOneAndUpdate(
        { beds24BookingId: b.id },
        { $set: bookingData },
        { upsert: true, new: true, includeResultMetadata: true }
      );

      if (result.lastErrorObject?.updatedExisting) {
        updated++;
      } else {
        created++;
      }
    }

    const summary = { synced: allBookings.length, created, updated, timestamp: new Date().toISOString() };
    console.log(`[Beds24 Sync] ${summary.synced} Buchungen synchronisiert (${created} neu, ${updated} aktualisiert)`);
    return summary;
  } catch (err) {
    console.error('[Beds24 Sync] Fehler:', err.message);
    throw err;
  }
}

function startSync() {
  // Einmalig beim Start (5s Delay damit MongoDB connected ist)
  setTimeout(async () => {
    try {
      await syncBookings();
    } catch (err) {
      console.error('[Beds24 Sync] Initialer Sync fehlgeschlagen:', err.message);
    }
  }, 5000);

  // Dann alle 30 Minuten
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

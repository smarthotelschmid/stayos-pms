const crypto = require('crypto');
const Guest = require('../models/Guest');
const Booking = require('../models/Booking');
const Room = require('../models/Room');
const Property = require('../models/Property');

const TENANT_ID = '507f1f77bcf86cd799439011';

async function createTestGuest() {
  const exists = await Guest.findOne({ tenantId: TENANT_ID, isTestGuest: true });
  if (exists) return exists;
  const g = await Guest.create({
    tenantId: TENANT_ID,
    firstName: 'Max',
    lastName: 'Mustermann',
    email: 'test@stayos.at',
    phone: '+43 677 12345678',
    preferredLanguage: 'de',
    isTestGuest: true,
    source: 'system',
  });
  console.log('[Seed] Testgast Max Mustermann angelegt');
  return g;
}

async function createTestBooking() {
  // Idempotent: wenn schon eine Test-Buchung existiert, Termine aktualisieren
  // (morgen/übermorgen), sonst nichts zu tun ausser update.
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);

  const existing = await Booking.findOne({ tenantId: TENANT_ID, isTest: true });
  if (existing) {
    await Booking.updateOne(
      { _id: existing._id, tenantId: TENANT_ID },
      { $set: { checkIn: tomorrow, checkOut: dayAfter } }
    );
    return existing;
  }

  const guest = await createTestGuest();
  const room = await Room.findOne({ tenantId: TENANT_ID, name: 'Zimmer 1' }).lean();
  if (!room) {
    console.log('[Seed] Zimmer 1 nicht gefunden — Test-Buchung übersprungen');
    return null;
  }
  const property = await Property.findOne({ tenantId: TENANT_ID }).sort({ createdAt: 1 }).lean();

  const b = await Booking.create({
    tenantId: TENANT_ID,
    bookingNumber: 'SCH-TEST00',
    source: 'manual',
    status: 'confirmed',
    guestId: guest._id,
    guestName: `${guest.firstName} ${guest.lastName}`,
    roomId: room._id,
    roomName: room.name,
    propertyId: property?._id || undefined,
    adults: 2,
    children: 0,
    checkIn: tomorrow,
    checkOut: dayAfter,
    nights: 1,
    pricing: { total: 120, roomTotal: 120, breakfastTotal: 0, extrasTotal: 0, touristTax: 0, vat: 0 },
    contactEmail: guest.email,
    isTest: true,
    guestPortalToken: crypto.randomBytes(32).toString('hex'),
    communication: { confirmationSent: false, doorCodeSent: false, cancellationSent: false, language: 'de', channel: 'email' },
  });
  console.log(`[Seed] Test-Buchung angelegt: ${b.bookingNumber} (Zimmer 1, morgen→übermorgen)`);
  return b;
}

module.exports = { createTestGuest, createTestBooking };

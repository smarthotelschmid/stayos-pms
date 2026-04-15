const crypto = require('crypto');
const Guest = require('../models/Guest');
const Booking = require('../models/Booking');
const Room = require('../models/Room');
const Property = require('../models/Property');
const Settings = require('../models/Settings');
const EmailTemplate = require('../models/EmailTemplate');

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

// Einmalige Migration: settings.portalConfig + house rules → EmailTemplate(portal).data.de
// Idempotent: laeuft nur, solange das Portal-Template noch keine data.de hat.
async function migratePortalTemplate() {
  const existing = await EmailTemplate.findOne({ tenantId: TENANT_ID, type: 'portal' }).lean();
  if (existing?.data?.de?.welcomeText !== undefined || existing?.data?.de?.houseRules !== undefined) {
    return; // schon migriert
  }

  const settings = await Settings.findOne({ tenantId: TENANT_ID }).lean();
  const property = await Property.findOne({ tenantId: TENANT_ID }).sort({ createdAt: 1 }).lean();

  const welcomeText = settings?.portalConfig?.welcomeText || '';
  const checkInHint = settings?.portalConfig?.checkInHint || '';
  const houseRules = (property?.houseRules?.length ? property.houseRules : settings?.houseRules || [])
    .map(r => ({ icon: r.icon || '', text: r.text || '' }));

  await EmailTemplate.findOneAndUpdate(
    { tenantId: TENANT_ID, type: 'portal' },
    { $set: { 'data.de': { welcomeText, checkInHint, houseRules } } },
    { upsert: true, new: true }
  );
  console.log(`[Seed] Portal-Template migriert: welcomeText=${welcomeText.length} chars, ${houseRules.length} Hausregeln`);
}

// Einmalige Migration: Bestehende deleted-Buchungen ohne Metadaten
// mit deletedAt=updatedAt, deletedBy='beds24-sync', deleteReason
// nachziehen. Idempotent: laeuft nur fuer Dokumente ohne deletedAt.
async function migrateDeletedBookingMeta() {
  const missing = await Booking.find({
    tenantId: TENANT_ID,
    status: 'deleted',
    $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
  }).select('_id updatedAt').lean();
  if (!missing.length) return;
  for (const b of missing) {
    await Booking.updateOne(
      { _id: b._id, tenantId: TENANT_ID },
      { $set: {
        deletedAt: b.updatedAt || new Date(),
        deletedBy: 'beds24-sync',
        deleteReason: 'In Beds24 nicht mehr vorhanden',
      }}
    );
  }
  console.log(`[Seed] deleted-Buchungen Meta nachgetragen: ${missing.length}`);
}

// Einmalige Migration: normNameKey fuer bestehende Gaeste berechnen,
// wenn noch nicht gesetzt. Idempotent.
async function migrateGuestNormNameKeys() {
  const { normalizeNameKey } = require('./dataTransformer');
  const guests = await Guest.find({
    tenantId: TENANT_ID,
    $or: [{ normNameKey: { $exists: false } }, { normNameKey: null }, { normNameKey: '' }],
  }).select('_id firstName lastName').lean();
  if (!guests.length) return;
  let migrated = 0;
  for (const g of guests) {
    const key = normalizeNameKey(g.firstName, g.lastName);
    if (!key) continue;
    await Guest.updateOne({ _id: g._id, tenantId: TENANT_ID }, { $set: { normNameKey: key } });
    migrated++;
  }
  console.log(`[Seed] normNameKey fuer ${migrated}/${guests.length} Gaeste migriert`);
}

// Einmalige Migration: Property.logoUrl → Settings.logoUrl, wenn Settings
// noch keins hat. Idempotent.
async function migrateSettingsLogo() {
  const s = await Settings.findOne({ tenantId: TENANT_ID }).lean();
  if (s?.logoUrl) return; // schon gesetzt
  const p = await Property.findOne({ tenantId: TENANT_ID }).sort({ createdAt: 1 }).lean();
  const logo = p?.ci?.logoUrl || p?.logoUrl;
  if (!logo) return;
  await Settings.updateOne({ tenantId: TENANT_ID }, { $set: { logoUrl: logo } });
  console.log(`[Seed] Settings.logoUrl von Property migriert: ${logo}`);
}

module.exports = { createTestGuest, createTestBooking, migratePortalTemplate, migrateSettingsLogo, migrateGuestNormNameKeys, migrateDeletedBookingMeta };

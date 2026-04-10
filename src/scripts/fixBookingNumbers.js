require('dotenv').config();
const mongoose = require('mongoose');
const Booking = require('../models/Booking');

const TENANT_ID = '507f1f77bcf86cd799439011';
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateSCH() {
  const code = Array.from({ length: 6 }, () =>
    CHARS[Math.floor(Math.random() * CHARS.length)]
  ).join('');
  return `SCH-${code}`;
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const bookings = await Booking.find({
    tenantId: TENANT_ID,
    bookingNumber: { $regex: '^B24-' },
  }, '_id bookingNumber guestName').lean();

  console.log(`${bookings.length} Buchungen mit B24- Nummer gefunden`);

  // Bestehende SCH-Nummern laden um Duplikate zu vermeiden
  const existing = new Set(
    (await Booking.find({ tenantId: TENANT_ID, bookingNumber: { $regex: '^SCH-' } }, 'bookingNumber').lean())
      .map(b => b.bookingNumber)
  );

  let migrated = 0;
  for (const b of bookings) {
    let newNum;
    do { newNum = generateSCH(); } while (existing.has(newNum));
    existing.add(newNum);

    await Booking.updateOne({ _id: b._id }, { $set: { bookingNumber: newNum } });
    console.log(`  ${b.bookingNumber} → ${newNum}  (${b.guestName || '—'})`);
    migrated++;
  }

  console.log(`\n${migrated} Buchungsnummern migriert`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });

const crypto = require('crypto');
const mongoose = require('mongoose');
require('dotenv').config();

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Booking = require('../models/Booking');
  const bookings = await Booking.find({ guestPortalToken: { $exists: false } });
  console.log(`${bookings.length} Buchungen ohne Token gefunden`);
  for (const b of bookings) {
    await Booking.updateOne({ _id: b._id }, { $set: { guestPortalToken: crypto.randomBytes(32).toString('hex') } });
  }
  console.log('Migration abgeschlossen');
  process.exit();
}

migrate().catch(e => { console.error(e); process.exit(1); });

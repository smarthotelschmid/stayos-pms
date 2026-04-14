require('dotenv').config();
const mongoose = require('mongoose');
const Booking = require('../src/models/Booking');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const nums = ['SCH-Z3FQ53', 'SCH-GRECZJ'];
  for (const n of nums) {
    const b = await Booking.findOne({ bookingNumber: n }).lean();
    console.log('---', n, '---');
    if (!b) { console.log('NOT FOUND'); continue; }
    console.log({
      status: b.status,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      roomName: b.roomName,
      beds24BookingId: b.beds24BookingId,
      doorAccess: b.doorAccess,
      source: b.source,
    });
  }
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });

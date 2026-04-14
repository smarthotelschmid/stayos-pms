require('dotenv').config();
const mongoose = require('mongoose');
const Booking = require('../src/models/Booking');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const res = await Booking.updateOne(
    { bookingNumber: 'SCH-GRECZJ' },
    { $set: {
        status: 'deleted',
        deletedAt: new Date(),
        deletedBy: 'system',
        deleteReason: 'Duplikat von SCH-Z3FQ53 (beds24BookingId 85086893)',
    } }
  );
  console.log(res);
  const b = await Booking.findOne({ bookingNumber: 'SCH-GRECZJ' })
    .select('bookingNumber status deletedAt deletedBy deleteReason').lean();
  console.log(b);
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });

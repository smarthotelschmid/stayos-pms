require('dotenv').config();
const mongoose = require('mongoose');
const Booking = require('../src/models/Booking');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ DB verbunden');

  // Steffi-Buchung finden
  const booking = await Booking.findOne({
    guestName: { $regex: /steffi|stephanie/i },
    status: { $ne: 'deleted' }
  });

  if (!booking) {
    console.log('❌ Keine Buchung mit "Steffi" oder "Stephanie" gefunden.');
    process.exit(0);
  }

  console.log('\n📋 Gefundene Buchung:');
  console.log('  _id:           ', booking._id.toString());
  console.log('  bookingNumber: ', booking.bookingNumber);
  console.log('  guestName:     ', booking.guestName);
  console.log('  roomName:      ', booking.roomName);
  console.log('  checkIn:       ', booking.checkIn);
  console.log('  checkOut:      ', booking.checkOut);
  console.log('  status:        ', booking.status);
  console.log('  source:        ', booking.source);
  console.log('  adults:        ', booking.adults);
  console.log('  internalNotes: ', booking.internalNotes || '—');

  // --- Soft Delete ---
  if (process.argv.includes('--execute')) {
    const result = await Booking.updateOne(
      { _id: booking._id },
      {
        $set: {
          status: 'deleted',
          deletedAt: new Date(),
          deletedBy: 'admin',
          deleteReason: 'Direktbuchung — Gast konnte nicht kommen, keine Rechnung ausgestellt'
        }
      }
    );
    console.log('\n✅ Soft Delete durchgeführt:', result.modifiedCount, 'Dokument(e) aktualisiert');
  } else {
    console.log('\n⚠️  Dry-Run — kein Update. Starte mit --execute um den Soft Delete auszuführen.');
  }

  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });

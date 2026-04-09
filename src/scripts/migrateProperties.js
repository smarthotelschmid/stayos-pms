require('dotenv').config();
const mongoose = require('mongoose');

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Property = require('../models/Property');
  const Room = require('../models/Room');
  const Booking = require('../models/Booking');
  const TENANT = '507f1f77bcf86cd799439011';

  // Check ob schon migriert
  const existing = await Property.countDocuments({ tenantId: TENANT });
  if (existing > 0) { console.log('Properties existieren bereits:', existing); process.exit(); }

  const p1 = await Property.create({
    tenantId: TENANT,
    name: 'Smarthotel Schmid',
    slug: 'smarthotel-schmid',
    hotelCountry: 'AT',
    hotelStreet: 'Schlossbergstraße',
    hotelStreetNo: '20',
    hotelZip: '3454',
    hotelCity: 'Sitzenberg-Reidling',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    billingEntity: {
      companyName: 'Schmid 1954 GmbH',
      street: 'Schlossbergstraße',
      streetNo: '20',
      zip: '3454',
      city: 'Sitzenberg-Reidling',
      country: 'AT',
    }
  });

  const p2 = await Property.create({
    tenantId: TENANT,
    name: 'Suiten Schmid',
    slug: 'suiten-schmid',
    hotelCountry: 'AT',
    hotelStreet: 'Schlossbergstraße',
    hotelStreetNo: '22',
    hotelZip: '3454',
    hotelCity: 'Sitzenberg-Reidling',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    billingEntity: {
      companyName: 'Schmid 1954 GmbH',
    }
  });

  // Suite 1 + Suite 2 → Property 2
  const r2 = await Room.updateMany(
    { tenantId: TENANT, name: { $in: ['Suite 1', 'Suite 2'] } },
    { $set: { propertyId: p2._id } }
  );
  console.log('Suiten → Property 2:', r2.modifiedCount);

  // Alle anderen → Property 1
  const r1 = await Room.updateMany(
    { tenantId: TENANT, propertyId: { $exists: false } },
    { $set: { propertyId: p1._id } }
  );
  console.log('Zimmer → Property 1:', r1.modifiedCount);

  // Bookings erben propertyId von Room
  const rooms = await Room.find({ tenantId: TENANT }, '_id propertyId').lean();
  let updated = 0;
  for (const room of rooms) {
    if (room.propertyId) {
      const r = await Booking.updateMany(
        { roomId: room._id, propertyId: { $exists: false } },
        { $set: { propertyId: room.propertyId } }
      );
      updated += r.modifiedCount;
    }
  }
  console.log('Bookings aktualisiert:', updated);

  console.log('Property 1:', p1._id.toString(), p1.name);
  console.log('Property 2:', p2._id.toString(), p2.name);
  process.exit();
}

migrate().catch(e => { console.error(e); process.exit(1); });

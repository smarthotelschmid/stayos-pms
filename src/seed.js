const mongoose = require('mongoose');
const Room = require('./models/Room');
require('dotenv').config();

const tenantId = '507f1f77bcf86cd799439011';

const rooms = [
  { number: '1', name: 'Zimmer 1', type: 'double', floor: 1, maxGuests: 2, pricePerNight: 99, status: 'available', amenities: ['WiFi', 'Dusche', 'TV'], tenantId },
  { number: '2', name: 'Zimmer 2', type: 'double', floor: 1, maxGuests: 2, pricePerNight: 99, status: 'available', amenities: ['WiFi', 'Dusche', 'TV'], tenantId },
  { number: '3', name: 'Zimmer 3', type: 'double', floor: 1, maxGuests: 2, pricePerNight: 99, status: 'available', amenities: ['WiFi', 'Dusche', 'TV'], tenantId },
  { number: '4', name: 'Zimmer 4', type: 'single', floor: 1, maxGuests: 1, pricePerNight: 69, status: 'available', amenities: ['WiFi', 'Dusche', 'TV'], tenantId },
  { number: '5', name: 'Zimmer 5', type: 'single', floor: 1, maxGuests: 1, pricePerNight: 69, status: 'available', amenities: ['WiFi', 'Dusche', 'TV'], tenantId },
  { number: '6', name: 'Zimmer 6', type: 'single', floor: 1, maxGuests: 1, pricePerNight: 69, status: 'available', amenities: ['WiFi', 'Dusche', 'TV'], tenantId },
  { number: '7', name: 'Zimmer 7', type: 'double', floor: 1, maxGuests: 2, pricePerNight: 99, status: 'available', amenities: ['WiFi', 'Dusche', 'TV'], tenantId },
  { number: '9', name: 'Zimmer 9', type: 'double', floor: 2, maxGuests: 2, pricePerNight: 109, status: 'available', amenities: ['WiFi', 'Dusche', 'TV', 'Balkon'], tenantId },
  { number: '10', name: 'Zimmer 10', type: 'double', floor: 2, maxGuests: 2, pricePerNight: 109, status: 'available', amenities: ['WiFi', 'Dusche', 'TV', 'Balkon'], tenantId },
  { number: '11', name: 'Zimmer 11', type: 'single', floor: 2, maxGuests: 1, pricePerNight: 79, status: 'available', amenities: ['WiFi', 'Dusche', 'TV', 'Balkon'], tenantId },
  { number: 'APL', name: 'Appartement Links', type: 'apartment', floor: 2, maxGuests: 4, pricePerNight: 159, status: 'available', amenities: ['WiFi', 'Kueche', 'Badewanne', 'TV', 'Balkon'], tenantId },
  { number: 'APR', name: 'Appartement Rechts', type: 'apartment', floor: 2, maxGuests: 4, pricePerNight: 159, status: 'available', amenities: ['WiFi', 'Kueche', 'Badewanne', 'TV', 'Balkon'], tenantId },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB verbunden');
    await Room.deleteMany({});
    console.log('Alte Zimmer geloescht');
    await Room.insertMany(rooms);
    console.log(rooms.length + ' Zimmer angelegt');
    rooms.forEach(function(r) {
      console.log(r.number + ' - ' + r.name + ' - EUR ' + r.pricePerNight);
    });
    mongoose.connection.close();
    console.log('Fertig!');
  } catch (err) {
    console.error('Fehler:', err.message);
    process.exit(1);
  }
}

seed();

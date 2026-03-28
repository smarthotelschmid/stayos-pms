// STAYOS — Historischer Import MongoDB
// Führe aus in C:\stayos-pms: node import_to_mongodb.js
// Voraussetzung: historical_bookings.json im gleichen Ordner

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI fehlt in .env'); process.exit(1); }

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ MongoDB verbunden');

  const col = mongoose.connection.db.collection('bookings');
  const bookings = JSON.parse(fs.readFileSync('historical_bookings.json', 'utf-8'));

  console.log(`📦 ${bookings.length} Buchungen werden importiert...`);

  let inserted = 0;
  let skipped = 0;

  for (const b of bookings) {
    // Duplikat-Erkennung: mehrere Merkmale
    const orConditions = [
      // Gleicher Zeitraum + Zimmer (egal welche source)
      { checkIn: b.checkIn, checkOut: b.checkOut, roomName: b.roomName },
    ];
    // Gleicher Gast + Zimmer + Anreise (wenn Name vorhanden)
    if (b.guestName) {
      orConditions.push({ checkIn: b.checkIn, roomName: b.roomName, guestName: b.guestName });
    }

    const exists = await col.findOne({ $or: orConditions });

    if (exists) {
      skipped++;
      continue;
    }

    await col.insertOne(b);
    inserted++;
  }

  // Statistik
  const total = await col.countDocuments({ tenantId: '507f1f77bcf86cd799439011' });
  const historical = await col.countDocuments({ source: 'beds24_csv' });
  const live = await col.countDocuments({ source: 'beds24' });

  console.log(`\n✅ Import abgeschlossen:`);
  console.log(`   Neu eingefügt: ${inserted}`);
  console.log(`   Übersprungen (bereits vorhanden): ${skipped}`);
  console.log(`\n📊 MongoDB Gesamt:`);
  console.log(`   Alle Buchungen: ${total}`);
  console.log(`   Live (Beds24 API): ${live}`);
  console.log(`   Historisch (CSV): ${historical}`);

  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });

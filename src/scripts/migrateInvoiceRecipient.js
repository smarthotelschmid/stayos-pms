const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection('bookings');

  const r1 = await col.updateMany(
    { invoiceRecipient: 'guest' },
    { $set: { invoiceRecipient: { type: 'private' } } }
  );
  console.log('guest → private:', r1.modifiedCount);

  const r2 = await col.updateMany(
    { invoiceRecipient: 'company' },
    { $set: { invoiceRecipient: { type: 'company' } } }
  );
  console.log('company → company:', r2.modifiedCount);

  await mongoose.disconnect();
  console.log('Migration done');
}
migrate().catch(e => { console.error(e); process.exit(1); });

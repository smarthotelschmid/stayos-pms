const Guest = require('../models/Guest');
const TENANT_ID = '507f1f77bcf86cd799439011';

async function createTestGuest() {
  const exists = await Guest.findOne({ tenantId: TENANT_ID, isTestGuest: true });
  if (exists) return;
  await Guest.create({
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
}

module.exports = { createTestGuest };

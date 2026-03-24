const mongoose = require('mongoose');
const RatePlan = require('./models/RatePlan');
require('dotenv').config();

const TENANT_ID = '507f1f77bcf86cd799439011';

const ratePlans = [
  {
    tenantId: TENANT_ID,
    name: 'Flex B&B',
    code: 'FLEX-BB',
    description: 'Flexibel mit Frühstück — kostenlos stornierbar bis 7 Tage vor Anreise',
    mealPlan: 'breakfast',
    breakfastPrice: 15,
    cancellation: { type: 'deadline', deadlineDays: 7, penaltyPercent: 100 },
    priceModifier: 0,
    isActive: true,
  },
  {
    tenantId: TENANT_ID,
    name: 'Flex Room Only',
    code: 'FLEX-RO',
    description: 'Flexibel ohne Frühstück — kostenlos stornierbar bis 7 Tage vor Anreise',
    mealPlan: 'room_only',
    breakfastPrice: 0,
    cancellation: { type: 'deadline', deadlineDays: 7, penaltyPercent: 100 },
    priceModifier: 0,
    isActive: true,
    seasons: [{ name: 'Herbst/Winter', from: '10-01', to: '03-31' }],
  },
  {
    tenantId: TENANT_ID,
    name: 'Non-Ref B&B',
    code: 'NR-BB',
    description: 'Nicht stornierbar mit Frühstück — günstigste Flex Rate',
    mealPlan: 'breakfast',
    breakfastPrice: 15,
    cancellation: { type: 'non_refundable', deadlineDays: 0, penaltyPercent: 100 },
    priceModifier: -10,
    isActive: true,
  },
  {
    tenantId: TENANT_ID,
    name: 'Non-Ref Room Only',
    code: 'NR-RO',
    description: 'Nicht stornierbar ohne Frühstück — günstigste Rate Herbst/Winter',
    mealPlan: 'room_only',
    breakfastPrice: 0,
    cancellation: { type: 'non_refundable', deadlineDays: 0, penaltyPercent: 100 },
    priceModifier: -10,
    isActive: true,
    seasons: [{ name: 'Herbst/Winter', from: '10-01', to: '03-31' }],
  },
];

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✓ MongoDB verbunden');
    await RatePlan.deleteMany({ tenantId: TENANT_ID });
    const result = await RatePlan.insertMany(ratePlans);
    console.log(`✓ ${result.length} Rate Plans angelegt:`);
    result.forEach(r => console.log(`  → ${r.name} (${r.code})`));
    mongoose.disconnect();
  })
  .catch(err => {
    console.error('✗ Fehler:', err.message);
    process.exit(1);
  });
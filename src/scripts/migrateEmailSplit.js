require("dotenv").config();
const mongoose = require("mongoose");

const RELAY_PATTERNS = [
  /@guest\.booking\.com$/i,
  /@m\.airbnb\.com$/i,
  /@airbnb\.com$/i,
  /@guest\.expedia\.com$/i,
  /@reply\.airbnb\.com$/i,
];

function isRelay(email) {
  return email && RELAY_PATTERNS.some(p => p.test(email));
}

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const col = mongoose.connection.db.collection("guests");
  const guests = await col.find({ email: { $ne: null } }, { projection: { email: 1, emailIsReal: 1, emailRelay: 1 } }).toArray();
  
  let relayCount = 0, realCount = 0, skipCount = 0;
  
  for (const g of guests) {
    // Skip if already migrated
    if (g.emailIsReal !== undefined && g.emailIsReal !== null && g.emailRelay !== undefined) { skipCount++; continue; }
    
    if (isRelay(g.email)) {
      await col.updateOne({ _id: g._id }, { $set: { emailRelay: g.email, email: null, emailIsReal: false, emailIsFake: true } });
      relayCount++;
    } else {
      await col.updateOne({ _id: g._id }, { $set: { emailIsReal: true, emailIsFake: false } });
      realCount++;
    }
  }
  
  console.log(`Migration done: ${relayCount} relay, ${realCount} real, ${skipCount} skipped`);
  mongoose.disconnect();
});

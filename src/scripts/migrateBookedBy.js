require("dotenv").config();
const mongoose = require("mongoose");

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const col = mongoose.connection.db.collection("bookings");

  // 1. Alle Buchungen mit guestId aber noch nicht eingecheckt
  //    → bookedBy = guestId, guestId = null
  const result = await col.updateMany(
    { guestId: { $ne: null }, checkInCompleted: { $ne: true } },
    [{ $set: { bookedBy: "$guestId", guestId: null } }]
  );
  console.log("Nicht-eingecheckt migriert:", result.modifiedCount, "Buchungen");

  // 2. Bereits eingecheckte Buchungen: bookedBy = guestId, guestId bleibt
  const result2 = await col.updateMany(
    { guestId: { $ne: null }, checkInCompleted: true, bookedBy: null },
    [{ $set: { bookedBy: "$guestId" } }]
  );
  console.log("Eingecheckte kopiert:", result2.modifiedCount);

  mongoose.disconnect();
});

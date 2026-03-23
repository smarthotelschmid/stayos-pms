// Mongoose ist unser "Übersetzer" zwischen JavaScript und MongoDB
const mongoose = require('mongoose');

// Ein Schema ist wie ein Formular — es definiert welche Felder
// ein Zimmer haben darf und welche Pflichtfelder sind
const roomSchema = new mongoose.Schema({
  
  // Jedes Zimmer gehört zu einem Hotel (tenantId = Mandant)
  // So trennen wir später Hotel A von Hotel B — Multi-Tenant
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  
  // Zimmernummer z.B. "101" oder "Appartement Alpin"
  number: { type: String, required: true },
  
  // Optionaler Name z.B. "Panorama Suite"
  name: { type: String },
  
  // Zimmertyp — nur diese 4 Werte sind erlaubt (enum)
  type: { type: String, enum: ['single', 'double', 'suite', 'apartment'] },
  
  // Stockwerk
  floor: { type: Number },
  
  // Maximale Gästeanzahl — Standard ist 2
  maxGuests: { type: Number, default: 2 },
  
  // Preis pro Nacht in Euro
  pricePerNight: { type: Number, required: true },
  
  // Die ID des Schlosses (TTLock, Assa Abloy etc.)
  lockId: { type: String },
  
  // Aktueller Status — ist das Zimmer frei, belegt oder in Wartung?
  status: { type: String, enum: ['available', 'occupied', 'maintenance'], default: 'available' },
  
  // Ausstattung als Liste z.B. ["WiFi", "Balkon", "Badewanne"]
  amenities: [String],
  
  // Beschreibung für die Buchungsseite
  description: { type: String },

// timestamps: true fügt automatisch createdAt und updatedAt hinzu
// MongoDB trackt damit wann ein Zimmer angelegt oder geändert wurde
}, { timestamps: true });

// Dieses Schema als "Room" Model exportieren
// Ab jetzt kann jede andere Datei mit Room.find(), Room.create() etc. arbeiten
module.exports = mongoose.model('Room', roomSchema);
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// Routen einbinden
const roomsRouter = require('./routes/rooms');
const guestsRouter = require('./routes/guests');
const bookingsRouter = require('./routes/bookings');
const ratePlansRouter = require('./routes/rateplans');
const settingsRouter = require('./routes/settings');

app.use('/api/rooms', roomsRouter);
app.use('/api/guests', guestsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/rateplans', ratePlansRouter);
app.use('/api/settings', settingsRouter);

// Test Route
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'STAYOS API läuft',
    version: '1.1.0'
  });
});

// MongoDB verbinden
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB verbunden');
    app.listen(process.env.PORT, () => {
      console.log(`✅ Server läuft auf Port ${process.env.PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB Fehler:', err.message);
  });
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
const beds24Router = require('./routes/beds24');
const companiesRouter = require('./routes/companies');
const messagesRouter = require('./routes/messages');
const ttlockRouter = require('./routes/ttlock');
const emailTemplatesRouter = require('./routes/emailTemplates');
const { startSync } = require('./services/syncService');
const { startTTLockCron } = require('./services/ttlockService');

app.use('/api/rooms', roomsRouter);
app.use('/api/guests', guestsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/rateplans', ratePlansRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/ttlock', ttlockRouter);
app.use('/api/email-templates', emailTemplatesRouter);
app.use('/api', beds24Router);

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
    startSync();
    startTTLockCron();
    app.listen(process.env.PORT, () => {
      console.log(`✅ Server läuft auf Port ${process.env.PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB Fehler:', err.message);
  });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// Routen einbinden
const roomsRouter          = require('./routes/rooms');
const guestsRouter         = require('./routes/guests');
const bookingsRouter       = require('./routes/bookings');
const ratePlansRouter      = require('./routes/rateplans');
const settingsRouter       = require('./routes/settings');
const beds24Router         = require('./routes/beds24');
const companiesRouter      = require('./routes/companies');
const messagesRouter       = require('./routes/messages');
const ttlockRouter         = require('./routes/ttlock');
const emailTemplatesRouter = require('./routes/emailTemplates');

const { startSync }                                    = require('./services/syncService');
const { startTTLockCron, getDoorcodeTemplate, timeToCron } = require('./services/ttlockService');
const { sendDoorCodeEmailsForToday }                   = require('./services/doorCodeEmailService');
const { createTestGuest }                              = require('./services/seedService');

app.use('/api/rooms',           roomsRouter);
app.use('/api/guests',          guestsRouter);
app.use('/api/bookings',        bookingsRouter);
app.use('/api/rateplans',       ratePlansRouter);
app.use('/api/settings',        settingsRouter);
app.use('/api/companies',       companiesRouter);
app.use('/api/messages',        messagesRouter);
app.use('/api/ttlock',          ttlockRouter);
app.use('/api/email-templates', emailTemplatesRouter);
app.use('/api',                 beds24Router);

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'STAYOS API läuft', version: '1.1.0' });
});

// ─── Email-Cron: sendTime aus DB laden ───────────────────────────────────────
let _emailCronTask = null;

async function startEmailCron() {
  const { sendTime } = await getDoorcodeTemplate();
  const expr = timeToCron(sendTime);

  if (_emailCronTask) { _emailCronTask.stop(); _emailCronTask = null; }

  _emailCronTask = cron.schedule(expr, () => {
    console.log(`[EmailCron] Türcode-Emails für heute (${sendTime})...`);
    sendDoorCodeEmailsForToday().catch(e =>
      console.error('[EmailCron] Fehler:', e.message)
    );
  }, { timezone: 'Europe/Vienna' });

  console.log(`[EmailCron] Gestartet → Versand ${sendTime}`);
  return { sendTime };
}

// Öffentliche Funktion damit emailTemplates-Route nach Save neu starten kann
async function restartEmailCron() {
  return startEmailCron();
}

// Exportieren damit Route darauf zugreifen kann
app.set('restartEmailCron', restartEmailCron);

// ─── MongoDB + Server starten ─────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB verbunden');
    startSync();
    await startTTLockCron();
    await startEmailCron();
    createTestGuest().catch(() => {});

    app.listen(process.env.PORT, () => {
      console.log(`✅ Server läuft auf Port ${process.env.PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB Fehler:', err.message);
  });

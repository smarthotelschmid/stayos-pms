const express = require('express');
const router = express.Router();
const beds24 = require('../services/beds24Service');

// POST /api/beds24/auth — Beds24 Authentifizierung mit Invite Code
router.post('/beds24/auth', async (req, res) => {
  try {
    const { inviteCode } = req.body;
    if (!inviteCode) return res.status(400).json({ error: 'inviteCode fehlt' });
    const result = await beds24.authenticate(inviteCode);
    res.json({ status: 'ok', message: 'Beds24 verbunden', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/beds24/test — Token-Test
router.get('/beds24/test', async (req, res) => {
  try {
    const token = await beds24.getToken();
    res.json({ status: 'ok', token: token.slice(0, 10) + '...' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/beds24/bookings — Buchungen der nächsten 90 Tage
router.get('/beds24/bookings', async (req, res) => {
  try {
    const today = new Date();
    const future = new Date(today);
    future.setDate(future.getDate() + 90);
    const fromDate = today.toISOString().split('T')[0];
    const toDate = future.toISOString().split('T')[0];
    const bookings = await beds24.getBookings(fromDate, toDate);
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/beds24/calendar/:roomId — Kalender für ein Zimmer
router.get('/beds24/calendar/:roomId', async (req, res) => {
  try {
    const today = new Date();
    const future = new Date(today);
    future.setDate(future.getDate() + 90);
    const fromDate = today.toISOString().split('T')[0];
    const toDate = future.toISOString().split('T')[0];
    const calendar = await beds24.getCalendar(req.params.roomId, fromDate, toDate);
    res.json(calendar);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/beds24/sync — Manueller Sync-Trigger
router.get('/beds24/sync', async (req, res) => {
  try {
    const { syncBookings } = require('../services/syncService');
    const result = await syncBookings();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webhooks/beds24 — Webhook Empfang
router.post('/webhooks/beds24', (req, res) => {
  console.log('[Beds24 Webhook]', JSON.stringify(req.body, null, 2));
  res.status(200).json({ status: 'ok' });
});

module.exports = router;

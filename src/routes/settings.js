const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');

const TENANT_ID = '507f1f77bcf86cd799439011';

// ── GET /api/settings ──────────────────────────────────
router.get('/', async (req, res) => {
  try {
    let settings = await Settings.findOne({ tenantId: TENANT_ID });
    if (!settings) {
      settings = await Settings.create({ tenantId: TENANT_ID });
    }
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /api/settings ──────────────────────────────────
router.put('/', async (req, res) => {
  try {
    const settings = await Settings.findOneAndUpdate(
      { tenantId: TENANT_ID },
      req.body,
      { new: true, upsert: true }
    );
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
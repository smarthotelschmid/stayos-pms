const express = require('express');
const router = express.Router();
const EmailTemplate = require('../models/EmailTemplate');

const TENANT_ID = '507f1f77bcf86cd799439011';

// GET /api/email-templates/:type
router.get('/:type', async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({ tenantId: TENANT_ID, type: req.params.type });
    res.json({ success: true, data: template || { type: req.params.type, subject: '', contentJson: null, contentHtml: '' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/email-templates/:type
router.post('/:type', async (req, res) => {
  try {
    const { subject, contentJson, contentHtml } = req.body;
    const template = await EmailTemplate.findOneAndUpdate(
      { tenantId: TENANT_ID, type: req.params.type },
      { $set: { subject, contentJson, contentHtml } },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

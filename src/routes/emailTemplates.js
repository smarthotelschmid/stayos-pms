const express = require('express');
const router = express.Router();
const EmailTemplate = require('../models/EmailTemplate');

const TENANT_ID = '507f1f77bcf86cd799439011';

// GET /api/email-templates/:type
router.get('/:type', async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({ tenantId: TENANT_ID, type: req.params.type });
    res.json({ success: true, data: template || { type: req.params.type, subject: {}, contentJson: {}, contentHtml: {}, contentText: {} } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/email-templates/:type
router.post('/:type', async (req, res) => {
  try {
    const { lang, subject, contentJson, contentHtml, contentText } = req.body;
    const l = lang || 'de';
    const update = {};
    if (subject !== undefined) update[`subject.${l}`] = subject;
    if (contentJson !== undefined) update[`contentJson.${l}`] = contentJson;
    if (contentHtml !== undefined) update[`contentHtml.${l}`] = contentHtml;
    if (contentText !== undefined) update[`contentText.${l}`] = contentText;

    const template = await EmailTemplate.findOneAndUpdate(
      { tenantId: TENANT_ID, type: req.params.type },
      { $set: update },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

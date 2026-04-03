const express = require('express');
const router = express.Router();
const InternalMessage = require('../models/InternalMessage');

// GET /api/messages?limit=20&tenantId=...
router.get('/', async (req, res) => {
  try {
    const { tenantId, limit: limitParam } = req.query;
    if (!tenantId) return res.status(400).json({ success: false, error: 'tenantId required' });
    const limit = Math.min(parseInt(limitParam) || 20, 100);
    const messages = await InternalMessage.find({ tenantId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ success: true, data: messages.reverse() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/messages
router.post('/', async (req, res) => {
  try {
    const { text, author, authorId, mentions, tenantId } = req.body;
    if (!text || !author || !tenantId) {
      return res.status(400).json({ success: false, error: 'text, author, tenantId required' });
    }
    const msg = await InternalMessage.create({ text, author, authorId, mentions, tenantId });
    res.json({ success: true, data: msg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

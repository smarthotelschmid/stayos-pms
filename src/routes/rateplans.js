const express = require('express');
const router = express.Router();
const RatePlan = require('../models/RatePlan');

// GET /api/rateplans — alle Rate Plans
router.get('/', async (req, res) => {
  try {
    const ratePlans = await RatePlan.find({ isActive: true }).sort({ priceModifier: 1 });
    res.json({ success: true, count: ratePlans.length, data: ratePlans });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
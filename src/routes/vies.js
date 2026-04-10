const express = require('express');
const router = express.Router();
const { checkVIES } = require('../utils/vies');

// GET /api/vies?uid=ATU12345678
router.get('/', async (req, res) => {
  try {
    const uid = (req.query.uid || '').trim().replace(/\s/g, '');
    if (uid.length < 4) return res.json({ valid: false, error: 'too_short' });

    const countryCode = uid.substring(0, 2).toUpperCase();
    const vatNumber = uid.substring(2);

    const result = await checkVIES(countryCode, vatNumber);
    if (!result) return res.json({ valid: false, error: 'not_found' });

    res.json(result);
  } catch (err) {
    res.json({ valid: false, error: err.message });
  }
});

module.exports = router;

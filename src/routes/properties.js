const express = require('express');
const router = express.Router();
const Property = require('../models/Property');
const Room = require('../models/Room');

const TENANT_ID = '507f1f77bcf86cd799439011';

// GET /api/properties
router.get('/', async (req, res) => {
  try {
    const properties = await Property.find({ tenantId: TENANT_ID }).sort({ name: 1 });
    res.json({ success: true, data: properties });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/properties/:id
router.get('/:id', async (req, res) => {
  try {
    const property = await Property.findOne({ _id: req.params.id, tenantId: TENANT_ID });
    if (!property) return res.status(404).json({ success: false, error: 'Betrieb nicht gefunden' });
    res.json({ success: true, data: property });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/properties
router.post('/', async (req, res) => {
  try {
    if (!req.body.name?.trim() || req.body.name === 'Neue Property' || req.body.name === 'Neuer Betrieb') {
      return res.status(400).json({ success: false, error: 'Name erforderlich' });
    }
    const property = await Property.create({ ...req.body, tenantId: TENANT_ID });
    res.status(201).json({ success: true, data: property });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PUT /api/properties/:id
router.put('/:id', async (req, res) => {
  try {
    const property = await Property.findOneAndUpdate(
      { _id: req.params.id, tenantId: TENANT_ID },
      req.body,
      { new: true, runValidators: true }
    );
    if (!property) return res.status(404).json({ success: false, error: 'Betrieb nicht gefunden' });
    res.json({ success: true, data: property });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /api/properties/:id
router.delete('/:id', async (req, res) => {
  try {
    const property = await Property.findOne({ _id: req.params.id, tenantId: TENANT_ID });
    if (!property) return res.status(404).json({ success: false, error: 'Betrieb nicht gefunden' });
    await Room.updateMany({ propertyId: property._id }, { $unset: { propertyId: 1 } });
    await property.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

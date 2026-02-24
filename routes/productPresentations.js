const express = require('express');
const { ProductPresentation, Product } = require('../models');
const { requireRole } = require('./adminAuth');

const router = express.Router();

// GET / - List presentations for a tenant
router.get('/', async (req, res) => {
  try {
    const tenantId = req.query.tenantId || 1;
    const presentations = await ProductPresentation.findAll({
      where: { tenantId },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    });
    res.json({ presentations });
  } catch (error) {
    console.error('Error listing presentations:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// POST / - Create presentation (admin)
router.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const { tenantId = 1, name, unitsPerSale = 1, sortOrder = 0 } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required', code: 'NAME_REQUIRED' });
    }
    if (!unitsPerSale || parseFloat(unitsPerSale) <= 0) {
      return res.status(400).json({ error: 'Units per sale must be > 0', code: 'INVALID_UNITS' });
    }
    const presentation = await ProductPresentation.create({
      tenantId,
      name: name.trim(),
      unitsPerSale: parseFloat(unitsPerSale),
      sortOrder
    });
    res.status(201).json(presentation);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Presentation already exists', code: 'DUPLICATE' });
    }
    console.error('Error creating presentation:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// PUT /:id - Update presentation (admin)
router.put('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId = 1, name, unitsPerSale, sortOrder } = req.body;
    const presentation = await ProductPresentation.findOne({ where: { id, tenantId } });
    if (!presentation) {
      return res.status(404).json({ error: 'Presentation not found', code: 'NOT_FOUND' });
    }
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (unitsPerSale !== undefined) updates.unitsPerSale = parseFloat(unitsPerSale);
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    await presentation.update(updates);
    res.json(presentation);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Presentation name already exists', code: 'DUPLICATE' });
    }
    console.error('Error updating presentation:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// DELETE /:id - Delete presentation (admin)
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.query;
    const presentation = await ProductPresentation.findOne({ where: { id, tenantId: tenantId || 1 } });
    if (!presentation) {
      return res.status(404).json({ error: 'Presentation not found', code: 'NOT_FOUND' });
    }
    await Product.update({ presentationId: null }, { where: { presentationId: id } });
    await presentation.destroy();
    res.json({ message: 'Presentation deleted' });
  } catch (error) {
    console.error('Error deleting presentation:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;

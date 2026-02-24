const express = require('express');
const { ProductCategory, Product } = require('../models');
const { requireRole } = require('./adminAuth');

const router = express.Router();

// GET / - List categories for a tenant
router.get('/', async (req, res) => {
  try {
    const tenantId = req.query.tenantId || 1;
    const categories = await ProductCategory.findAll({
      where: { tenantId },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    });
    res.json({ categories });
  } catch (error) {
    console.error('Error listing categories:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// POST / - Create category (admin)
router.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const { tenantId = 1, name, sortOrder = 0 } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required', code: 'NAME_REQUIRED' });
    }
    const category = await ProductCategory.create({
      tenantId,
      name: name.trim(),
      sortOrder
    });
    res.status(201).json(category);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Category already exists for this tenant', code: 'DUPLICATE_CATEGORY' });
    }
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// PUT /:id - Update category (admin)
router.put('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId = 1, name, sortOrder } = req.body;
    const category = await ProductCategory.findOne({ where: { id, tenantId } });
    if (!category) {
      return res.status(404).json({ error: 'Category not found', code: 'CATEGORY_NOT_FOUND' });
    }
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    await category.update(updates);
    res.json(category);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Category name already exists', code: 'DUPLICATE_CATEGORY' });
    }
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// DELETE /:id - Delete category (admin)
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.query;
    const category = await ProductCategory.findOne({ where: { id, tenantId: tenantId || 1 } });
    if (!category) {
      return res.status(404).json({ error: 'Category not found', code: 'CATEGORY_NOT_FOUND' });
    }
    await Product.update({ categoryId: null }, { where: { categoryId: id } });
    await category.destroy();
    res.json({ message: 'Category deleted' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;

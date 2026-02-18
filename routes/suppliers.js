const express = require('express');
const { Supplier, SupplierPrice, Product } = require('../models');
const { Op } = require('sequelize');
const { requireRole } = require('./adminAuth');

const router = express.Router();

// GET /suppliers - List suppliers
router.get('/', async (req, res) => {
  try {
    const {
      tenantId = 1,
      isActive,
      search,
      page = 1,
      limit = 50
    } = req.query;

    const whereClause = { tenantId };
    
    if (isActive !== undefined) {
      whereClause.isActive = isActive === 'true';
    }

    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { contactName: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows } = await Supplier.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset,
      order: [['name', 'ASC']]
    });

    res.json({
      suppliers: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error listing suppliers:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /suppliers/:id - Get supplier by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId = 1 } = req.query;

    const supplier = await Supplier.findOne({
      where: { id, tenantId },
      include: [{
        association: 'prices',
        include: [{
          association: 'product'
        }],
        order: [['effectiveDate', 'DESC']],
        limit: 10
      }]
    });

    if (!supplier) {
      return res.status(404).json({
        error: 'Supplier not found',
        code: 'SUPPLIER_NOT_FOUND'
      });
    }

    res.json(supplier);
  } catch (error) {
    console.error('Error getting supplier:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /suppliers - Create supplier - ADMIN only
router.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const {
      tenantId = 1,
      name,
      contactName,
      email,
      phone,
      address,
      isActive = true
    } = req.body;

    if (!name) {
      return res.status(400).json({
        error: 'Name is required',
        code: 'MISSING_NAME'
      });
    }

    const supplier = await Supplier.create({
      tenantId,
      name,
      contactName,
      email,
      phone,
      address,
      isActive
    });

    res.status(201).json(supplier);
  } catch (error) {
    console.error('Error creating supplier:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// PUT /suppliers/:id - Update supplier - ADMIN only
router.put('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      tenantId = 1,
      name,
      contactName,
      email,
      phone,
      address,
      isActive
    } = req.body;

    const supplier = await Supplier.findOne({
      where: { id, tenantId }
    });

    if (!supplier) {
      return res.status(404).json({
        error: 'Supplier not found',
        code: 'SUPPLIER_NOT_FOUND'
      });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (contactName !== undefined) updates.contactName = contactName;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (address !== undefined) updates.address = address;
    if (isActive !== undefined) updates.isActive = isActive;

    await supplier.update(updates);

    res.json(supplier);
  } catch (error) {
    console.error('Error updating supplier:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// DELETE /suppliers/:id - Delete supplier (soft delete) - ADMIN only
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId = 1 } = req.query;

    const supplier = await Supplier.findOne({
      where: { id, tenantId }
    });

    if (!supplier) {
      return res.status(404).json({
        error: 'Supplier not found',
        code: 'SUPPLIER_NOT_FOUND'
      });
    }

    await supplier.update({ isActive: false });

    res.json({ message: 'Supplier deactivated successfully' });
  } catch (error) {
    console.error('Error deleting supplier:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;

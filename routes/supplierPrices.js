const express = require('express');
const { SupplierPrice, Supplier, Product } = require('../models');
const { Op } = require('sequelize');
const { requireRole } = require('./adminAuth');

const router = express.Router();

// GET /supplier-prices - List supplier prices
router.get('/', async (req, res) => {
  try {
    const {
      tenantId = 1,
      supplierId,
      productId,
      page = 1,
      limit = 50
    } = req.query;

    const whereClause = { tenantId };
    
    if (supplierId) whereClause.supplierId = supplierId;
    if (productId) whereClause.productId = productId;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows } = await SupplierPrice.findAndCountAll({
      where: whereClause,
      include: [
        {
          association: 'supplier'
        },
        {
          association: 'product'
        }
      ],
      limit: parseInt(limit),
      offset,
      order: [['effectiveDate', 'DESC']]
    });

    res.json({
      prices: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error listing supplier prices:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /supplier-prices/current/:supplierId/:productId - Get current price
router.get('/current/:supplierId/:productId', async (req, res) => {
  try {
    const { supplierId, productId } = req.params;
    const { tenantId = 1 } = req.query;

    const currentPrice = await SupplierPrice.findOne({
      where: {
        tenantId,
        supplierId,
        productId,
        effectiveDate: { [Op.lte]: new Date() }
      },
      include: [
        {
          association: 'supplier'
        },
        {
          association: 'product'
        }
      ],
      order: [['effectiveDate', 'DESC']]
    });

    if (!currentPrice) {
      return res.status(404).json({
        error: 'No price found for this supplier and product',
        code: 'PRICE_NOT_FOUND'
      });
    }

    res.json(currentPrice);
  } catch (error) {
    console.error('Error getting current price:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /supplier-prices - Create supplier price - ADMIN only
router.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const {
      tenantId = 1,
      supplierId,
      productId,
      price,
      effectiveDate,
      notes
    } = req.body;

    if (!supplierId || !productId || !price || !effectiveDate) {
      return res.status(400).json({
        error: 'supplierId, productId, price, and effectiveDate are required',
        code: 'MISSING_FIELDS'
      });
    }

    if (price <= 0) {
      return res.status(400).json({
        error: 'Price must be greater than 0',
        code: 'INVALID_PRICE'
      });
    }

    // Verify supplier and product exist
    const supplier = await Supplier.findOne({
      where: { id: supplierId, tenantId }
    });

    if (!supplier) {
      return res.status(404).json({
        error: 'Supplier not found',
        code: 'SUPPLIER_NOT_FOUND'
      });
    }

    const product = await Product.findOne({
      where: { id: productId, tenantId }
    });

    if (!product) {
      return res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    const supplierPrice = await SupplierPrice.create({
      tenantId,
      supplierId,
      productId,
      price,
      effectiveDate,
      notes
    });

    // Fetch with associations
    const createdPrice = await SupplierPrice.findByPk(supplierPrice.id, {
      include: [
        {
          association: 'supplier'
        },
        {
          association: 'product'
        }
      ]
    });

    res.status(201).json(createdPrice);
  } catch (error) {
    console.error('Error creating supplier price:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// PUT /supplier-prices/:id - Update supplier price - ADMIN only
router.put('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      tenantId = 1,
      price,
      effectiveDate,
      notes
    } = req.body;

    const supplierPrice = await SupplierPrice.findOne({
      where: { id, tenantId }
    });

    if (!supplierPrice) {
      return res.status(404).json({
        error: 'Supplier price not found',
        code: 'PRICE_NOT_FOUND'
      });
    }

    const updates = {};
    if (price !== undefined) {
      if (price <= 0) {
        return res.status(400).json({
          error: 'Price must be greater than 0',
          code: 'INVALID_PRICE'
        });
      }
      updates.price = price;
    }
    if (effectiveDate !== undefined) updates.effectiveDate = effectiveDate;
    if (notes !== undefined) updates.notes = notes;

    await supplierPrice.update(updates);

    // Fetch with associations
    const updatedPrice = await SupplierPrice.findByPk(id, {
      include: [
        {
          association: 'supplier'
        },
        {
          association: 'product'
        }
      ]
    });

    res.json(updatedPrice);
  } catch (error) {
    console.error('Error updating supplier price:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// DELETE /supplier-prices/:id - Delete supplier price - ADMIN only
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId = 1 } = req.query;

    const supplierPrice = await SupplierPrice.findOne({
      where: { id, tenantId }
    });

    if (!supplierPrice) {
      return res.status(404).json({
        error: 'Supplier price not found',
        code: 'PRICE_NOT_FOUND'
      });
    }

    await supplierPrice.destroy();

    res.json({ message: 'Supplier price deleted successfully' });
  } catch (error) {
    console.error('Error deleting supplier price:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;

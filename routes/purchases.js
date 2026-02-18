const express = require('express');
const { Product, InventoryMovement } = require('../models');
const { sequelize } = require('../models');

const router = express.Router();

// POST /purchases - Create a purchase (creates inventory movements)
router.post('/', async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const {
      tenantId,
      provider,
      purchaseDate,
      invoiceNumber,
      items,
      notes
    } = req.body;

    // Validate required fields
    if (!tenantId || !items || !Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'Tenant ID and items array are required',
        code: 'INVALID_REQUEST'
      });
    }

    // Validate each item
    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity <= 0) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'Each item must have productId and quantity > 0',
          code: 'INVALID_ITEM'
        });
      }
    }

    // Get all products and validate they exist and are SIMPLE
    const productIds = items.map(item => item.productId);
    const products = await Product.findAll({
      where: {
        id: { [require('sequelize').Op.in]: productIds },
        tenantId,
        productType: 'SIMPLE',
        isActive: true
      },
      transaction
    });

    if (products.length !== productIds.length) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'One or more products not found, inactive, or not SIMPLE type',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    // Create inventory movements for each item
    const movements = [];
    for (const item of items) {
      const movement = await InventoryMovement.create({
        tenantId,
        productId: item.productId,
        movementType: 'IN',
        reason: 'PURCHASE',
        qty: item.quantity,
        unitCost: item.unitCost || null,
        refType: 'PURCHASE',
        refId: null, // Could store purchase ID if we create a Purchase model
        createdAt: purchaseDate ? new Date(purchaseDate) : new Date()
      }, { transaction });
      
      movements.push(movement);
    }

    await transaction.commit();

    res.status(201).json({
      message: 'Purchase created successfully',
      movements: movements.length,
      items: items.length
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error creating purchase:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /purchases - List purchases (returns inventory movements with reason PURCHASE)
router.get('/', async (req, res) => {
  try {
    const {
      tenantId,
      startDate,
      endDate,
      page = 1,
      limit = 50
    } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        error: 'Tenant ID is required',
        code: 'TENANT_REQUIRED'
      });
    }

    const whereClause = {
      tenantId,
      reason: 'PURCHASE'
    };

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt[require('sequelize').Op.gte] = startDate;
      if (endDate) whereClause.createdAt[require('sequelize').Op.lte] = endDate;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows } = await InventoryMovement.findAndCountAll({
      where: whereClause,
      include: [{
        association: 'product'
      }],
      limit: parseInt(limit),
      offset,
      order: [['createdAt', 'DESC']]
    });

    // Group by date for better display
    const groupedPurchases = {};
    rows.forEach(movement => {
      const dateKey = new Date(movement.createdAt).toISOString().split('T')[0];
      if (!groupedPurchases[dateKey]) {
        groupedPurchases[dateKey] = {
          date: dateKey,
          items: [],
          total: 0
        };
      }
      const itemTotal = parseFloat(movement.qty) * parseFloat(movement.unitCost || 0);
      groupedPurchases[dateKey].items.push({
        product: movement.product,
        quantity: movement.qty,
        unitCost: movement.unitCost,
        total: itemTotal
      });
      groupedPurchases[dateKey].total += itemTotal;
    });

    res.json({
      purchases: Object.values(groupedPurchases),
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error listing purchases:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;

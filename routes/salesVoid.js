const express = require('express');
const { Sale, SaleItem, Product, InventoryMovement } = require('../models');
const ComboService = require('../services/ComboService');
const { sequelize } = require('../models');
const { requireRole } = require('./adminAuth');

const router = express.Router();

// POST /sales/:id/void - Void a sale (reverse inventory movements) - ADMIN only
router.post('/:id/void', requireRole('ADMIN'), async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { id } = req.params;
    const { tenantId, reason } = req.body;

    // Find the sale
    const sale = await Sale.findOne({
      where: { id, tenantId },
      include: [
        {
          association: 'items',
          include: [{
            association: 'product'
          }]
        }
      ],
      transaction
    });

    if (!sale) {
      await transaction.rollback();
      return res.status(404).json({
        error: 'Sale not found',
        code: 'SALE_NOT_FOUND'
      });
    }

    // Check if sale is already voided
    if (sale.status === 'VOIDED') {
      await transaction.rollback();
      return res.status(400).json({
        error: 'Sale is already voided',
        code: 'SALE_ALREADY_VOIDED'
      });
    }

    // Create inventory reversal movements for each item
    const reversalPromises = sale.items.map(async (saleItem) => {
      const product = saleItem.product;
      
      if (product.productType === 'SIMPLE') {
        // Simple product: single IN movement
        await InventoryMovement.create({
          tenantId,
          productId: saleItem.productId,
          movementType: 'IN',
          reason: 'VOID',
          qty: saleItem.quantity,
          unitCost: await InventoryMovement.getUnitCost(
            tenantId,
            saleItem.productId,
            saleItem.quantity,
            transaction
          ),
          refType: 'SALE',
          refId: sale.id
        }, { transaction });
      } else {
        // Combo product: IN movements for each component
        await ComboService.createComboVoidMovements(
          tenantId,
          saleItem.productId,
          saleItem.quantity,
          sale.id,
          transaction
        );
      }
    });

    await Promise.all(reversalPromises);

    // Update sale status
    await sale.update({
      status: 'VOIDED',
      voidReason: reason || 'Sale voided',
      voidedAt: new Date()
    }, { transaction });

    await transaction.commit();

    // Fetch updated sale
    const voidedSale = await Sale.findByPk(id, {
      include: [
        {
          association: 'items',
          include: [{
            association: 'product'
          }]
        }
      ]
    });

    res.json(voidedSale);
  } catch (error) {
    await transaction.rollback();
    console.error('Error voiding sale:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /sales/:id/inventory-movements - Get inventory movements for a sale
router.get('/:id/inventory-movements', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.query;

    // Verify sale exists
    const sale = await Sale.findOne({
      where: { id, tenantId }
    });

    if (!sale) {
      return res.status(404).json({
        error: 'Sale not found',
        code: 'SALE_NOT_FOUND'
      });
    }

    // Get inventory movements for this sale
    const movements = await InventoryMovement.findAll({
      where: {
        tenantId,
        refType: 'SALE',
        refId: id
      },
      include: [{
        association: 'product'
      }],
      order: [['createdAt', 'ASC']]
    });

    res.json({
      saleId: id,
      movements
    });
  } catch (error) {
    console.error('Error getting sale inventory movements:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;
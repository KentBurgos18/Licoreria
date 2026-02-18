const express = require('express');
const { Product, InventoryMovement } = require('../models');
const ComboService = require('../services/ComboService');

const router = express.Router();

// GET /products/:id/availability - Get product availability
router.get('/:id/availability', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.query;

    // Find the product
    const product = await Product.findOne({
      where: { id, tenantId }
    });

    if (!product) {
      return res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    let availability;

    if (product.productType === 'SIMPLE') {
      // For simple products, get current stock
      const currentStock = await InventoryMovement.getCurrentStock(tenantId, id);
      
      availability = {
        productId: id,
        productType: 'SIMPLE',
        productName: product.name,
        productSku: product.sku,
        currentStock,
        stockMin: product.stockMin,
        isBelowMin: product.stockMin !== null && currentStock < product.stockMin,
        availableForSale: currentStock > 0
      };
    } else {
      // For combo products, calculate availability based on components
      availability = await ComboService.getComboAvailability(tenantId, id);
      availability.availableForSale = availability.availableStock > 0;
    }

    res.json(availability);
  } catch (error) {
    console.error('Error getting product availability:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /products/:id/validate - Validate sale quantity
router.post('/:id/validate', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId, quantity } = req.body;

    if (!quantity || quantity <= 0) {
      return res.status(400).json({
        error: 'Quantity must be greater than 0',
        code: 'INVALID_QUANTITY'
      });
    }

    // Find the product
    const product = await Product.findOne({
      where: { id, tenantId }
    });

    if (!product) {
      return res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    let validation;

    if (product.productType === 'SIMPLE') {
      // For simple products, check stock
      const currentStock = await InventoryMovement.getCurrentStock(tenantId, id);
      
      validation = {
        productId: id,
        productType: 'SIMPLE',
        productName: product.name,
        requestedQty: quantity,
        currentStock,
        canSell: currentStock >= quantity,
        missingQty: Math.max(0, quantity - currentStock)
      };
    } else {
      // For combo products, validate component availability
      validation = await ComboService.validateComboSale(tenantId, id, quantity);
    }

    res.json(validation);
  } catch (error) {
    console.error('Error validating product sale:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /products/availability/bulk - Get availability for multiple products
router.post('/availability/bulk', async (req, res) => {
  try {
    const { tenantId: bodyTenantId, productIds } = req.body;

    // Be lenient with tenantId: fall back to 1 if not provided
    const tenantId = bodyTenantId || 1;

    // If no products are provided, just return empty list instead of 400
    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.json({ products: [] });
    }

    // Find all products
    const dbProducts = await Product.findAll({
      where: {
        id: { [require('sequelize').Op.in]: productIds },
        tenantId
      }
    });

    const availabilityPromises = dbProducts.map(async (product) => {
      if (product.productType === 'SIMPLE') {
        const currentStock = await InventoryMovement.getCurrentStock(tenantId, product.id);
        
        return {
          productId: product.id,
          productType: 'SIMPLE',
          productName: product.name,
          productSku: product.sku,
          currentStock,
          stockMin: product.stockMin,
          isBelowMin: product.stockMin !== null && currentStock < product.stockMin,
          availableForSale: currentStock > 0
        };
      } else {
        const comboAvailability = await ComboService.getComboAvailability(tenantId, product.id);
        return {
          ...comboAvailability,
          availableForSale: comboAvailability.availableStock > 0
        };
      }
    });

    const availabilityResults = await Promise.all(availabilityPromises);

    res.json({
      products: availabilityResults
    });
  } catch (error) {
    console.error('Error getting bulk product availability:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;
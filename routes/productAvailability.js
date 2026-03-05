const express = require('express');
const { Product } = require('../models');
const ComboService = require('../services/ComboService');
const { getSimpleProductAvailability, validateSimpleSaleQuantity } = require('../services/InventoryPoolHelper');
const { getCartAwareAvailability } = require('../services/CartAvailabilityHelper');

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
      const av = await getSimpleProductAvailability(tenantId, product);
      availability = {
        productId: id,
        productType: 'SIMPLE',
        productName: product.name,
        productSku: product.sku,
        currentStock: av.currentStock,
        baseStock: av.baseStock,
        unitsPerSale: av.unitsPerSale,
        baseProductId: av.baseProductId,
        stockMin: av.stockMin,
        isBelowMin: av.isBelowMin,
        availableForSale: av.availableForSale
      };
    } else {
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
      const v = await validateSimpleSaleQuantity(tenantId, product, quantity);
      const unitsPerSale = parseFloat(product.unitsPerSale) || 1;
      const currentStockPresentation = Math.floor(v.currentStock / unitsPerSale);
      validation = {
        productId: id,
        productType: 'SIMPLE',
        productName: product.name,
        requestedQty: quantity,
        currentStock: currentStockPresentation,
        unitsPerSale,
        canSell: v.canSell,
        missingQty: Math.max(0, quantity - currentStockPresentation)
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

// Parse cartItems from body (array or JSON string)
function parseCartItems(body) {
  const items = body.cartItems;
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (typeof items === 'string') {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {}
  }
  return [];
}

// POST /products/availability/bulk - Get availability for multiple products
// Accepts optional cartItems for cart-aware availability (combo+individual, presentaciones caja/six)
router.post('/availability/bulk', async (req, res) => {
  try {
    const { tenantId: bodyTenantId, productIds, cartItems: bodyCartItems } = req.body;

    // Be lenient with tenantId: fall back to 1 if not provided
    const tenantId = bodyTenantId || 1;
    const cartItems = parseCartItems(req.body);

    // If no products are provided, just return empty list instead of 400
    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.json({ products: [] });
    }

    // Find all products (include components for cart-aware combo logic)
    const { Op } = require('sequelize');
    const dbProducts = await Product.findAll({
      where: { id: { [Op.in]: productIds }, tenantId },
      include: [
        { association: 'components', include: [{ association: 'component' }], required: false }
      ]
    });

    // Cart-aware: combo+individual, presentaciones (caja/six) comparten pool
    if (cartItems.length > 0) {
      const availabilityMap = await getCartAwareAvailability(tenantId, cartItems, dbProducts);
      const products = dbProducts.map((product) => {
        const av = availabilityMap[product.id] || { currentStock: 0, availableForSale: false };
        return {
          productId: product.id,
          productType: product.productType || 'SIMPLE',
          productName: product.name,
          productSku: product.sku,
          currentStock: av.currentStock ?? 0,
          availableStock: av.currentStock ?? 0,
          availableForSale: av.availableForSale ?? false
        };
      });
      return res.json({ products });
    }

    // Sin carrito: disponibilidad estándar
    const availabilityPromises = dbProducts.map(async (product) => {
      if (product.productType === 'SIMPLE') {
        const av = await getSimpleProductAvailability(tenantId, product);
        return {
          productId: product.id,
          productType: 'SIMPLE',
          productName: product.name,
          productSku: product.sku,
          currentStock: av.currentStock,
          baseStock: av.baseStock,
          unitsPerSale: av.unitsPerSale,
          baseProductId: av.baseProductId,
          stockMin: av.stockMin,
          isBelowMin: av.isBelowMin,
          availableForSale: av.availableForSale
        };
      } else {
        const comboAvailability = await ComboService.getComboAvailability(tenantId, product.id);
        return {
          productId: product.id,
          productType: 'COMBO',
          productName: product.name,
          productSku: product.sku,
          currentStock: comboAvailability.availableStock,
          availableStock: comboAvailability.availableStock,
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
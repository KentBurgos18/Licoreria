const { Product, InventoryMovement } = require('../models');

/**
 * Resolves the effective product_id and quantity for inventory movements.
 * If a product has a base_product_id (shared pool), movements go to the base
 * product with qty multiplied by units_per_sale.
 */
function resolveMovement(product, quantity) {
  const unitsPerSale = parseFloat(product.unitsPerSale) || 1;
  if (product.baseProductId) {
    return {
      productId: product.baseProductId,
      qty: quantity * unitsPerSale
    };
  }
  return {
    productId: product.id,
    qty: quantity
  };
}

/**
 * Gets available stock for a product, accounting for pool logic.
 * Single source of truth for SIMPLE product stock (presentations / pool).
 * Returns { baseUnits, availableQty, canSell }.
 */
async function getPoolStock(tenantId, product) {
  const unitsPerSale = parseFloat(product.unitsPerSale) || 1;
  const stockProductId = product.baseProductId || product.id;
  const baseUnits = await InventoryMovement.getCurrentStock(tenantId, stockProductId);
  const availableQty = Math.floor((baseUnits || 0) / unitsPerSale);
  return {
    baseUnits: baseUnits || 0,
    availableQty,
    canSell: availableQty > 0
  };
}

/**
 * Full availability for a SIMPLE product (dashboard, customer catalog, bulk).
 * Use this everywhere instead of duplicating getCurrentStock + unitsPerSale logic.
 */
async function getSimpleProductAvailability(tenantId, product) {
  const pool = await getPoolStock(tenantId, product);
  const unitsPerSale = parseFloat(product.unitsPerSale) || 1;
  const stockMin = product.stockMin != null ? parseFloat(product.stockMin) : null;
  const isBelowMin = stockMin !== null && pool.availableQty < stockMin;
  return {
    currentStock: pool.availableQty,
    baseStock: pool.baseUnits,
    availableForSale: pool.availableQty > 0,
    unitsPerSale,
    baseProductId: product.baseProductId || null,
    stockMin: product.stockMin ?? null,
    isBelowMin
  };
}

/**
 * Validates if a given quantity can be sold for a SIMPLE product (sales flow).
 */
async function validateSimpleSaleQuantity(tenantId, product, quantity) {
  const unitsPerSale = parseFloat(product.unitsPerSale) || 1;
  const pool = await getPoolStock(tenantId, product);
  const requiredUnits = quantity * unitsPerSale;
  const canSell = pool.baseUnits >= requiredUnits;
  return {
    canSell,
    currentStock: pool.baseUnits,
    requestedQty: quantity,
    requiredUnits,
    missingQty: Math.max(0, requiredUnits - pool.baseUnits)
  };
}

/**
 * Loads a product with its pool info and returns resolved data.
 */
async function loadProductForMovement(productId) {
  return Product.findByPk(productId, {
    attributes: ['id', 'baseProductId', 'unitsPerSale', 'productType', 'tenantId', 'name']
  });
}

module.exports = {
  resolveMovement,
  getPoolStock,
  loadProductForMovement,
  getSimpleProductAvailability,
  validateSimpleSaleQuantity
};

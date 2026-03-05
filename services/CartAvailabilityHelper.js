/**
 * Calcula disponibilidad de productos considerando el carrito del cliente.
 * Inventario compartido:
 * - Combo/producto simple: si Cola está en combo y como individual, al agregar uno el otro refleja stock 0.
 * - Presentaciones (caja, six, unidad): comparten pool de unidades base; al agregar 1 unidad se restan
 *   six y caja disponibles (ej. 24 uds base → 1 caja, 4 six; si agarro 1 ud → 0 cajas, 3 six).
 */
const { Product, ProductComponent, InventoryMovement } = require('../models');
const ComboService = require('./ComboService');

/**
 * Obtiene el pool key (producto que físicamente tiene el stock) y unitsPerSale para un producto.
 */
function getPoolInfo(product) {
  const baseProductId = product.baseProductId || null;
  const unitsPerSale = parseFloat(product.unitsPerSale) || 1;
  const poolKey = baseProductId || product.id;
  return { poolKey, unitsPerSale };
}

/**
 * @param {number} tenantId
 * @param {Array<{productId: number, quantity: number}>} cartItems - Items del carrito
 * @param {Array} products - Productos con productType, id, baseProductId, unitsPerSale, components
 * @returns {Promise<Object>} Map { productId: { currentStock, availableForSale } }
 */
async function getCartAwareAvailability(tenantId, cartItems, products) {
  const cart = Array.isArray(cartItems) ? cartItems : [];
  const cartByProduct = {};
  cart.forEach(item => {
    const pid = parseInt(item.productId, 10);
    if (!isNaN(pid)) {
      cartByProduct[pid] = (cartByProduct[pid] || 0) + (parseFloat(item.quantity) || 0);
    }
  });

  const productMap = {};
  products.forEach(p => { productMap[p.id] = p; });
  // Incluir componentes de combos (pueden no estar en products si filtran por categoría)
  products.filter(p => p.productType === 'COMBO' && p.components).forEach(p => {
    (p.components || []).forEach(pc => {
      if (pc.component) productMap[pc.componentProductId] = pc.component;
    });
  });

  const comboIds = products.filter(p => p.productType === 'COMBO').map(p => p.id);
  const allComponents = [];
  if (comboIds.length > 0) {
    for (const comboId of comboIds) {
      const comps = await ProductComponent.findAll({
        where: { comboProductId: comboId, tenantId },
        attributes: ['componentProductId', 'qty']
      });
      allComponents.push(...comps.map(c => ({
        comboProductId: comboId,
        componentProductId: c.componentProductId,
        qty: parseFloat(c.qty) || 1
      })));
    }
  }

  // 1. Recolectar todos los pool keys (productos que tienen stock físico)
  const poolKeys = new Set();
  for (const p of products) {
    if (p.productType === 'SIMPLE') {
      poolKeys.add(getPoolInfo(p).poolKey);
    }
  }
  const missingCompIds = [...new Set(allComponents.map(c => c.componentProductId).filter(id => !productMap[id]))];
  if (missingCompIds.length > 0) {
    const missing = await Product.findAll({ where: { id: missingCompIds }, attributes: ['id', 'baseProductId', 'unitsPerSale', 'productType'] });
    missing.forEach(p => { productMap[p.id] = p; });
  }
  for (const ac of allComponents) {
    const comp = productMap[ac.componentProductId];
    if (comp && comp.productType === 'SIMPLE') {
      poolKeys.add(getPoolInfo(comp).poolKey);
    }
  }

  // 2. Stock físico en unidades base por pool
  const physicalBaseByPool = {};
  for (const pk of poolKeys) {
    const s = await InventoryMovement.getCurrentStock(tenantId, pk);
    physicalBaseByPool[pk] = s || 0;
  }

  // 3. Consumo en unidades base por pool (carrito + combos)
  const consumedBaseByPool = {};
  for (const pk of poolKeys) consumedBaseByPool[pk] = 0;

  for (const item of cart) {
    const p = productMap[item.productId];
    if (!p || p.productType !== 'SIMPLE') continue;
    const { poolKey, unitsPerSale } = getPoolInfo(p);
    consumedBaseByPool[poolKey] = (consumedBaseByPool[poolKey] || 0) + (item.quantity || 0) * unitsPerSale;
  }

  for (const ac of allComponents) {
    const comboQty = cartByProduct[ac.comboProductId] || 0;
    if (comboQty <= 0) continue;
    const comp = productMap[ac.componentProductId];
    if (!comp || comp.productType !== 'SIMPLE') continue;
    const { poolKey, unitsPerSale } = getPoolInfo(comp);
    consumedBaseByPool[poolKey] = (consumedBaseByPool[poolKey] || 0) + comboQty * ac.qty * unitsPerSale;
  }

  // 4. Unidades base efectivas por pool
  const effectiveBaseByPool = {};
  for (const pk of poolKeys) {
    effectiveBaseByPool[pk] = Math.max(0, (physicalBaseByPool[pk] || 0) - (consumedBaseByPool[pk] || 0));
  }

  // 5. Disponibilidad por presentación: floor(effectiveBase / unitsPerSale)
  const result = {};
  for (const product of products) {
    if (product.productType === 'SIMPLE') {
      const { poolKey, unitsPerSale } = getPoolInfo(product);
      const effectiveBase = effectiveBaseByPool[poolKey] ?? 0;
      const availableQty = Math.floor(effectiveBase / unitsPerSale);
      result[product.id] = {
        currentStock: availableQty,
        availableForSale: availableQty > 0
      };
    } else {
      const comps = allComponents.filter(c => c.comboProductId === product.id);
      if (comps.length === 0) {
        const av = await ComboService.getComboAvailability(tenantId, product.id);
        result[product.id] = {
          currentStock: av.availableStock || 0,
          availableForSale: (av.availableStock || 0) > 0
        };
      } else {
        let minStock = Infinity;
        for (const c of comps) {
          const comp = productMap[c.componentProductId];
          if (!comp || comp.productType !== 'SIMPLE') continue;
          const { poolKey, unitsPerSale } = getPoolInfo(comp);
          const effectiveBase = effectiveBaseByPool[poolKey] ?? 0;
          const compAvailable = Math.floor(effectiveBase / unitsPerSale);
          const maxFromComp = Math.floor(compAvailable / c.qty);
          minStock = Math.min(minStock, maxFromComp);
        }
        const available = minStock === Infinity ? 0 : minStock;
        result[product.id] = {
          currentStock: available,
          availableForSale: available > 0
        };
      }
    }
  }
  return result;
}

module.exports = { getCartAwareAvailability };

const { Product, ProductComponent, InventoryMovement } = require('../models');

class ComboService {
  /**
   * Calculate available stock for a combo product
   * Formula: floor(min_i(stock_component_i / qty_i))
   */
  static async calculateComboStock(tenantId, comboProductId) {
    const components = await ProductComponent.findByCombo(comboProductId, {
      include: [{
        association: 'component',
        where: { tenantId }
      }]
    });

    if (components.length === 0) {
      return 0;
    }

    let minStock = Infinity;

    for (const component of components) {
      const currentStock = await InventoryMovement.getCurrentStock(
        tenantId,
        component.componentProductId
      );
      
      const maxCombosFromComponent = Math.floor(currentStock / component.qty);
      minStock = Math.min(minStock, maxCombosFromComponent);
    }

    return minStock === Infinity ? 0 : minStock;
  }

  /**
   * Get detailed availability for a combo
   * Returns stock calculation and component details
   */
  static async getComboAvailability(tenantId, comboProductId) {
    const combo = await Product.findOne({
      where: { id: comboProductId, tenantId, productType: 'COMBO' }
    });

    if (!combo) {
      throw new Error('Combo product not found');
    }

    const components = await ProductComponent.findByCombo(comboProductId, {
      include: [{
        association: 'component',
        where: { tenantId }
      }]
    });

    const componentDetails = [];
    let minStock = Infinity;

    for (const component of components) {
      const currentStock = await InventoryMovement.getCurrentStock(
        tenantId,
        component.componentProductId
      );
      
      const maxCombosFromComponent = Math.floor(currentStock / component.qty);
      minStock = Math.min(minStock, maxCombosFromComponent);

      componentDetails.push({
        componentId: component.componentProductId,
        componentName: component.component.name,
        componentSku: component.component.sku,
        requiredQty: component.qty,
        currentStock,
        maxCombosFromComponent,
        isLimiting: maxCombosFromComponent === minStock
      });
    }

    return {
      comboId: comboProductId,
      comboName: combo.name,
      comboSku: combo.sku,
      availableStock: minStock === Infinity ? 0 : minStock,
      components: componentDetails
    };
  }

  /**
   * Validate if combo can be sold with given quantity
   * Returns validation result and missing components if any
   */
  static async validateComboSale(tenantId, comboProductId, quantity) {
    const availability = await this.getComboAvailability(tenantId, comboProductId);
    
    const canSell = availability.availableStock >= quantity;
    const missingComponents = [];

    if (!canSell) {
      for (const component of availability.components) {
        const requiredStock = component.requiredQty * quantity;
        if (component.currentStock < requiredStock) {
          missingComponents.push({
            componentId: component.componentId,
            componentName: component.componentName,
            currentStock: component.currentStock,
            requiredStock,
            missingQty: requiredStock - component.currentStock
          });
        }
      }
    }

    return {
      canSell,
      availableStock: availability.availableStock,
      requestedQty: quantity,
      missingComponents
    };
  }

  /**
   * Create inventory movements for combo sale
   * Creates OUT movements for each component
   */
  static async createComboSaleMovements(tenantId, comboProductId, quantity, saleId, transaction) {
    const components = await ProductComponent.findByCombo(comboProductId, {
      include: [{
        association: 'component',
        where: { tenantId }
      }]
    });

    const movements = [];

    for (const component of components) {
      const movementQty = component.qty * quantity;
      
      const movement = await InventoryMovement.create({
        tenantId,
        productId: component.componentProductId,
        movementType: 'OUT',
        reason: 'SALE',
        qty: movementQty,
        unitCost: await InventoryMovement.getUnitCost(
          tenantId,
          component.componentProductId,
          movementQty,
          transaction
        ),
        refType: 'SALE',
        refId: saleId
      }, { transaction });

      movements.push(movement);
    }

    return movements;
  }

  /**
   * Create inventory movements for combo void
   * Creates IN movements for each component (reversal)
   */
  static async createComboVoidMovements(tenantId, comboProductId, quantity, saleId, transaction) {
    const components = await ProductComponent.findByCombo(comboProductId, {
      include: [{
        association: 'component',
        where: { tenantId }
      }]
    });

    const movements = [];

    for (const component of components) {
      const movementQty = component.qty * quantity;
      
      const movement = await InventoryMovement.create({
        tenantId,
        productId: component.componentProductId,
        movementType: 'IN',
        reason: 'VOID',
        qty: movementQty,
        unitCost: await InventoryMovement.getUnitCost(
          tenantId,
          component.componentProductId,
          movementQty,
          transaction
        ),
        refType: 'SALE',
        refId: saleId
      }, { transaction });

      movements.push(movement);
    }

    return movements;
  }

  /**
   * Calculate combo cost and margin
   */
  static async calculateComboCost(tenantId, comboProductId) {
    const components = await ProductComponent.findByCombo(comboProductId, {
      include: [{
        association: 'component',
        where: { tenantId }
      }]
    });

    let totalCost = 0;
    let totalPriceSum = 0;

    for (const component of components) {
      const avgCost = await InventoryMovement.getAverageCost(
        tenantId,
        component.componentProductId
      );
      
      totalCost += avgCost * component.qty;
      totalPriceSum += component.component.salePrice * component.qty;
    }

    const combo = await Product.findOne({
      where: { id: comboProductId, tenantId }
    });

    return {
      comboCost: totalCost,
      componentPriceSum: totalPriceSum,
      comboSalePrice: combo.salePrice,
      impliedDiscount: totalPriceSum - combo.salePrice,
      comboMargin: combo.salePrice - totalCost,
      marginPercentage: totalCost > 0 ? ((combo.salePrice - totalCost) / combo.salePrice) * 100 : 0
    };
  }
}

module.exports = ComboService;
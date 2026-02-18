const express = require('express');
const { Sale, SaleItem, Product, InventoryMovement, Setting, CustomerCredit, Customer, Notification } = require('../models');
const ComboService = require('../services/ComboService');
const { sequelize } = require('../models');

const router = express.Router();

// POST /sales - Create sale with combo support
router.post('/', async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const {
      tenantId,
      customerId,
      items,
      paymentMethod,
      totalAmount,
      transferReference,
      notes,
      creditDueDate,
      creditInterestRate,
      customerName
    } = req.body;

    // Validate basic required fields
    if (!tenantId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Tenant ID and items array are required',
        code: 'INVALID_REQUEST'
      });
    }

    // Validate each item
    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({
          error: 'Each item must have productId and quantity > 0',
          code: 'INVALID_ITEM'
        });
      }
    }

    // Get all products and validate availability
    const productIds = items.map(item => item.productId);
    const products = await Product.findAll({
      where: {
        id: { [require('sequelize').Op.in]: productIds },
        tenantId,
        isActive: true
      }
    });

    if (products.length !== productIds.length) {
      return res.status(400).json({
        error: 'One or more products not found or inactive',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    // Create product map for easy lookup
    const productMap = products.reduce((map, product) => {
      map[product.id] = product;
      return map;
    }, {});

    // Validate stock availability for all items
    const validationPromises = items.map(async (item) => {
      const product = productMap[item.productId];
      
      if (product.productType === 'SIMPLE') {
        const currentStock = await InventoryMovement.getCurrentStock(tenantId, item.productId);
        return {
          productId: item.productId,
          productType: 'SIMPLE',
          canSell: currentStock >= item.quantity,
          currentStock,
          requestedQty: item.quantity,
          missingQty: Math.max(0, item.quantity - currentStock)
        };
      } else {
        return await ComboService.validateComboSale(tenantId, item.productId, item.quantity);
      }
    });

    const validations = await Promise.all(validationPromises);
    const failedValidations = validations.filter(v => !v.canSell);

    if (failedValidations.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'Insufficient stock for one or more items',
        code: 'INSUFFICIENT_STOCK',
        details: failedValidations
      });
    }

    // Calculate subtotal from items
    const subtotal = items.reduce((sum, item) => {
      const product = productMap[item.productId];
      const unitPrice = item.unitPrice || product.salePrice;
      return sum + (unitPrice * item.quantity);
    }, 0);

    const taxRateRaw = await Setting.getSetting(tenantId, 'tax_rate');
    const taxRate = taxRateRaw != null ? parseFloat(taxRateRaw) : NaN;
    if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'El IVA no está configurado. Configure el IVA en Configuración.',
        code: 'TAX_RATE_NOT_CONFIGURED'
      });
    }
    const taxAmount = subtotal * (taxRate / 100);
    const calculatedTotal = subtotal + taxAmount;

    // Use provided totalAmount or calculated total
    const finalTotal = totalAmount || calculatedTotal;

    // Determine sale status: PENDING for transfers, COMPLETED for cash/card/credit
    const saleStatus = paymentMethod === 'TRANSFER' ? 'PENDING' : 'COMPLETED';
    
    // For credit sales, customerId is required
    let finalCustomerId = customerId;
    if (paymentMethod === 'CREDIT') {
      if (!customerId) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'customerId is required for credit sales',
          code: 'MISSING_CUSTOMER_ID'
        });
      }
      
      // Verify customer exists and is active
      const customer = await Customer.findOne({
        where: {
          id: customerId,
          tenantId,
          isActive: true
        },
        transaction
      });
      
      if (!customer) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'Customer not found or inactive',
          code: 'CUSTOMER_NOT_FOUND'
        });
      }
      
      finalCustomerId = customerId;
    } else if (!customerId && customerName) {
      // For other payment methods, try to find or create customer by name (optional)
      const existingCustomer = await Customer.findOne({
        where: {
          tenantId,
          name: customerName.trim(),
          isActive: true
        },
        transaction
      });
      
      if (existingCustomer) {
        finalCustomerId = existingCustomer.id;
      }
      // Don't create new customer for non-credit sales if not found
    }

    // Create the sale with historical tax information
    const sale = await Sale.create({
      tenantId,
      customerId: finalCustomerId,
      status: saleStatus,
      totalAmount: finalTotal,
      taxRate: taxRate,
      taxAmount: taxAmount,
      paymentMethod,
      transferReference: paymentMethod === 'TRANSFER' ? transferReference : null,
      notes,
      createdAt: new Date()
    }, { transaction });

    // Create sale items
    const saleItemsPromises = items.map(async (item) => {
      const product = productMap[item.productId];
      const unitPrice = item.unitPrice || product.salePrice;
      const totalPrice = unitPrice * item.quantity;

      // Create sale item
      const saleItem = await SaleItem.create({
        saleId: sale.id,
        tenantId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        productType: product.productType
      }, { transaction });

      // Create inventory movements
      if (product.productType === 'SIMPLE') {
        // Simple product: single OUT movement
        await InventoryMovement.create({
          tenantId,
          productId: item.productId,
          movementType: 'OUT',
          reason: 'SALE',
          qty: item.quantity,
          unitCost: await InventoryMovement.getUnitCost(
            tenantId,
            item.productId,
            item.quantity,
            transaction
          ),
          refType: 'SALE',
          refId: sale.id
        }, { transaction });
      } else {
        // Combo product: OUT movements for each component
        await ComboService.createComboSaleMovements(
          tenantId,
          item.productId,
          item.quantity,
          sale.id,
          transaction
        );
      }

      return saleItem;
    });

    const saleItems = await Promise.all(saleItemsPromises);

    // Only create inventory movements if sale is COMPLETED (not PENDING transfer)
    if (saleStatus === 'COMPLETED') {
      const inventoryMovementsPromises = items.map(async (item) => {
        const product = productMap[item.productId];
        
        if (product.productType === 'SIMPLE') {
          // Simple product: single OUT movement
          await InventoryMovement.create({
            tenantId,
            productId: item.productId,
            movementType: 'OUT',
            reason: 'SALE',
            qty: item.quantity,
            unitCost: await InventoryMovement.getUnitCost(
              tenantId,
              item.productId,
              item.quantity,
              transaction
            ),
            refType: 'SALE',
            refId: sale.id
          }, { transaction });
        } else {
          // Combo product: OUT movements for each component
          await ComboService.createComboSaleMovements(
            tenantId,
            item.productId,
            item.quantity,
            sale.id,
            transaction
          );
        }
      });

      await Promise.all(inventoryMovementsPromises);
    }

    // Create customer credit if payment method is CREDIT
    if (paymentMethod === 'CREDIT' && finalCustomerId) {
      if (!creditDueDate) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'creditDueDate is required for credit sales',
          code: 'MISSING_CREDIT_DUE_DATE'
        });
      }

      // Validate due date is not in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueDate = new Date(creditDueDate);
      if (dueDate < today) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'Credit due date cannot be in the past',
          code: 'INVALID_DUE_DATE'
        });
      }

      // Create customer credit
      const interestRate = creditInterestRate ? parseFloat(creditInterestRate) / 100 : 0.01; // Convert percentage to decimal
      await CustomerCredit.create({
        tenantId,
        customerId: finalCustomerId,
        groupPurchaseParticipantId: null,
        initialAmount: finalTotal,
        currentBalance: finalTotal,
        interestRate: interestRate,
        dueDate: creditDueDate,
        status: 'ACTIVE',
        lastInterestCalculationDate: new Date().toISOString().split('T')[0]
      }, { transaction });
    }

    await transaction.commit();

    // Fetch complete sale with associations
    const completeSale = await Sale.findByPk(sale.id, {
      include: [
        {
          association: 'items',
          include: [{
            association: 'product'
          }]
        }
      ]
    });

    res.status(201).json(completeSale);
  } catch (error) {
    await transaction.rollback();
    console.error('Error creating sale:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /sales - List sales
router.get('/', async (req, res) => {
  try {
    const {
      tenantId,
      status,
      customerId,
      startDate,
      endDate,
      page = 1,
      limit = 50
    } = req.query;

    const whereClause = {};
    if (tenantId) whereClause.tenantId = tenantId;
    if (status) whereClause.status = status;
    if (customerId) whereClause.customerId = customerId;

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt[require('sequelize').Op.gte] = startDate;
      if (endDate) whereClause.createdAt[require('sequelize').Op.lte] = endDate;
    }

    const offset = (page - 1) * limit;

    const { count, rows } = await Sale.findAndCountAll({
      where: whereClause,
      include: [
        {
          association: 'items',
          include: [{
            association: 'product'
          }]
        }
      ],
      limit: parseInt(limit),
      offset,
      order: [['createdAt', 'DESC']]
    });

    res.json({
      sales: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error listing sales:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /sales/stats/monthly-total - Total ventas del mes actual (dashboard)
router.get('/stats/monthly-total', async (req, res) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId) {
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'TENANT_REQUIRED'
      });
    }
    const Op = require('sequelize').Op;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const result = await Sale.sum('totalAmount', {
      where: {
        tenantId: parseInt(tenantId),
        status: 'COMPLETED',
        createdAt: {
          [Op.gte]: startOfMonth,
          [Op.lte]: endOfMonth
        }
      }
    });

    const total = result != null ? parseFloat(result) : 0;
    res.json({ total });
  } catch (error) {
    console.error('Error getting monthly sales total:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /sales/:id - Get sale by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.query;

    const sale = await Sale.findOne({
      where: { id, tenantId },
      include: [
        {
          association: 'items',
          include: [{
            association: 'product'
          }]
        }
      ]
    });

    if (!sale) {
      return res.status(404).json({
        error: 'Sale not found',
        code: 'SALE_NOT_FOUND'
      });
    }

    res.json(sale);
  } catch (error) {
    console.error('Error getting sale:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// PATCH /sales/:id/confirm-transfer - Confirm transfer payment
router.patch('/:id/confirm-transfer', async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { id } = req.params;
    const { tenantId } = req.body;

    if (!tenantId) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'MISSING_TENANT_ID'
      });
    }

    // Find the sale
    const sale = await Sale.findOne({
      where: { id, tenantId, status: 'PENDING', paymentMethod: 'TRANSFER' },
      include: [
        {
          association: 'items',
          include: [{ association: 'product' }]
        }
      ],
      transaction
    });

    if (!sale) {
      await transaction.rollback();
      return res.status(404).json({
        error: 'Pending transfer sale not found',
        code: 'SALE_NOT_FOUND'
      });
    }

    // Update sale status to COMPLETED
    sale.status = 'COMPLETED';
    await sale.save({ transaction });

    // Create inventory movements now that payment is confirmed
    const inventoryMovementsPromises = sale.items.map(async (item) => {
      const product = item.product;
      
      if (product.productType === 'SIMPLE') {
        // Simple product: single OUT movement
        await InventoryMovement.create({
          tenantId,
          productId: item.productId,
          movementType: 'OUT',
          reason: 'SALE',
          qty: item.quantity,
          unitCost: await InventoryMovement.getUnitCost(
            tenantId,
            item.productId,
            item.quantity,
            transaction
          ),
          refType: 'SALE',
          refId: sale.id
        }, { transaction });
      } else {
        // Combo product: OUT movements for each component
        await ComboService.createComboSaleMovements(
          tenantId,
          item.productId,
          item.quantity,
          sale.id,
          transaction
        );
      }
    });

    await Promise.all(inventoryMovementsPromises);

    await transaction.commit();

    // Fetch complete sale with associations
    const completeSale = await Sale.findByPk(sale.id, {
      include: [
        {
          association: 'items',
          include: [{
            association: 'product'
          }]
        }
      ]
    });

    res.json(completeSale);
  } catch (error) {
    await transaction.rollback();
    console.error('Error confirming transfer:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /sales/:id/confirm-cash - Confirm cash payment (customer web order, pending staff confirmation)
router.post('/:id/confirm-cash', async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;
    const tenantId = req.tenantId || req.body.tenantId;

    if (!tenantId) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'MISSING_TENANT_ID'
      });
    }

    const sale = await Sale.findOne({
      where: { id: parseInt(id, 10), tenantId, status: 'PENDING', paymentMethod: 'CASH' },
      include: [
        {
          association: 'items',
          include: [{ association: 'product' }]
        }
      ],
      transaction
    });

    if (!sale) {
      await transaction.rollback();
      return res.status(404).json({
        error: 'Pending cash sale not found',
        code: 'SALE_NOT_FOUND'
      });
    }

    sale.status = 'COMPLETED';
    await sale.save({ transaction });

    const inventoryMovementsPromises = sale.items.map(async (item) => {
      const product = item.product;
      if (product.productType === 'SIMPLE') {
        await InventoryMovement.create({
          tenantId,
          productId: item.productId,
          movementType: 'OUT',
          reason: 'SALE',
          qty: item.quantity,
          unitCost: await InventoryMovement.getUnitCost(
            tenantId,
            item.productId,
            item.quantity,
            transaction
          ),
          refType: 'SALE',
          refId: sale.id
        }, { transaction });
      } else {
        await ComboService.createComboSaleMovements(
          tenantId,
          item.productId,
          item.quantity,
          sale.id,
          transaction
        );
      }
    });

    await Promise.all(inventoryMovementsPromises);

    // Remove notifications for this sale so they disappear for all staff
    await Notification.destroy({
      where: { saleId: sale.id },
      transaction
    });

    await transaction.commit();

    const io = req.app.get('io');
    if (io) {
      io.to(`sale:${sale.id}`).emit('sale-confirmed', { saleId: sale.id });
    }

    const completeSale = await Sale.findByPk(sale.id, {
      include: [
        {
          association: 'items',
          include: [{ association: 'product' }]
        }
      ]
    });

    res.json(completeSale);
  } catch (error) {
    await transaction.rollback();
    console.error('Error confirming cash:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;
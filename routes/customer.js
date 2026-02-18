const express = require('express');
const { Product, InventoryMovement, Sale, SaleItem, Customer, GroupPurchase, GroupPurchaseParticipant, Setting, User, Notification, PayphonePendingPayment } = require('../models');
const ComboService = require('../services/ComboService');
const WebPushService = require('../services/WebPushService');
const { sequelize } = require('../models');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware to verify JWT token
const authenticateCustomer = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || 
                req.body.token || 
                req.query.token;

  if (!token) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'NO_TOKEN'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.customerId == null) {
      return res.status(401).json({
        error: 'Token de cliente requerido',
        code: 'INVALID_TOKEN'
      });
    }
    req.customerId = decoded.customerId;
    req.tenantId = decoded.tenantId || 1;
    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN'
    });
  }
};

const router = express.Router();

// GET /customer/products - Get available products for customers
router.get('/products', async (req, res) => {
  try {
    const { tenantId = 1, search, productType } = req.query;

    const whereClause = {
      tenantId,
      isActive: true
    };

    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { sku: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (productType) {
      whereClause.productType = productType;
    }

    const products = await Product.findAll({
      where: whereClause,
      include: [
        {
          association: 'components',
          include: [{
            association: 'component'
          }],
          required: false
        }
      ],
      order: [['name', 'ASC']],
      limit: 100
    });

    // Get availability for all products
    const productIds = products.map(p => p.id);
    const availabilityMap = {};

    if (productIds.length > 0) {
      const availabilityPromises = products.map(async (product) => {
        if (product.productType === 'SIMPLE') {
          const currentStock = await InventoryMovement.getCurrentStock(tenantId, product.id);
          return {
            productId: product.id,
            currentStock: currentStock || 0,
            availableForSale: currentStock > 0
          };
        } else {
          const availability = await ComboService.getComboAvailability(tenantId, product.id);
          return {
            productId: product.id,
            currentStock: availability.availableStock || 0,
            availableForSale: availability.availableStock > 0
          };
        }
      });

      const availabilityResults = await Promise.all(availabilityPromises);
      availabilityResults.forEach(av => {
        availabilityMap[av.productId] = av;
      });
    }

    // Merge availability into products
    const productsWithStock = products.map(product => {
      const availability = availabilityMap[product.id];
      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        productType: product.productType,
        salePrice: parseFloat(product.salePrice),
        imageUrl: product.imageUrl,
        currentStock: availability?.currentStock || 0,
        availableForSale: availability?.availableForSale || false,
        components: product.components || []
      };
    }).filter(p => p.availableForSale); // Only show available products

    res.json({ products: productsWithStock });
  } catch (error) {
    console.error('Error getting customer products:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /customer/products/:id - Get single product details
router.get('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId = 1 } = req.query;

    const product = await Product.findOne({
      where: { id, tenantId, isActive: true },
      include: [
        {
          association: 'components',
          include: [{
            association: 'component'
          }],
          required: false
        }
      ]
    });

    if (!product) {
      return res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    // Get availability
    let availability;
    if (product.productType === 'SIMPLE') {
      const currentStock = await InventoryMovement.getCurrentStock(tenantId, id);
      availability = {
        currentStock: currentStock || 0,
        availableForSale: currentStock > 0
      };
    } else {
      const comboAvailability = await ComboService.getComboAvailability(tenantId, id);
      availability = {
        currentStock: comboAvailability.availableStock || 0,
        availableForSale: comboAvailability.availableStock > 0
      };
    }

    res.json({
      id: product.id,
      name: product.name,
      sku: product.sku,
      productType: product.productType,
      salePrice: parseFloat(product.salePrice),
      imageUrl: product.imageUrl,
      ...availability,
      components: product.components || []
    });
  } catch (error) {
    console.error('Error getting product details:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /customer/cart/validate - Validate cart items before checkout
router.post('/cart/validate', authenticateCustomer, async (req, res) => {
  try {
    const { items } = req.body;
    const { tenantId } = req;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Cart items are required',
        code: 'INVALID_CART'
      });
    }

    const validations = [];
    const productIds = items.map(item => item.productId);
    const products = await Product.findAll({
      where: {
        id: { [Op.in]: productIds },
        tenantId,
        isActive: true
      }
    });

    const productMap = products.reduce((map, product) => {
      map[product.id] = product;
      return map;
    }, {});

    for (const item of items) {
      const product = productMap[item.productId];
      if (!product) {
        validations.push({
          productId: item.productId,
          valid: false,
          error: 'Product not found'
        });
        continue;
      }

      let availableStock = 0;
      if (product.productType === 'SIMPLE') {
        availableStock = await InventoryMovement.getCurrentStock(tenantId, item.productId);
      } else {
        const availability = await ComboService.getComboAvailability(tenantId, item.productId);
        availableStock = availability.availableStock || 0;
      }

      validations.push({
        productId: item.productId,
        productName: product.name,
        requestedQty: item.quantity,
        availableStock,
        valid: availableStock >= item.quantity
      });
    }

    const allValid = validations.every(v => v.valid);

    res.json({
      valid: allValid,
      validations
    });
  } catch (error) {
    console.error('Error validating cart:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /customer/payphone-config - Credenciales para la Cajita (solo cliente autenticado)
router.get('/payphone-config', authenticateCustomer, (req, res) => {
  const token = process.env.PAYPHONE_TOKEN;
  const storeId = process.env.PAYPHONE_STORE_ID;
  if (!token || !storeId) {
    return res.status(503).json({
      error: 'Pago con tarjeta no configurado. Contacte al administrador.',
      code: 'PAYPHONE_NOT_CONFIGURED'
    });
  }
  res.json({ token, storeId });
});

// POST /customer/checkout/prepare-payphone - Prepara pago con tarjeta (Cajita)
router.post('/checkout/prepare-payphone', authenticateCustomer, async (req, res) => {
  try {
    const { items, notes } = req.body;
    const { tenantId, customerId } = req;

    const token = process.env.PAYPHONE_TOKEN;
    const storeId = process.env.PAYPHONE_STORE_ID;
    if (!token || !storeId) {
      return res.status(503).json({
        error: 'Pago con tarjeta no configurado. Contacte al administrador.',
        code: 'PAYPHONE_NOT_CONFIGURED'
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Items are required',
        code: 'INVALID_ORDER'
      });
    }

    const productIds = items.map(item => item.productId);
    const products = await Product.findAll({
      where: {
        id: { [Op.in]: productIds },
        tenantId,
        isActive: true
      }
    });

    if (products.length !== productIds.length) {
      return res.status(400).json({
        error: 'One or more products not found',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    const productMap = products.reduce((map, product) => {
      map[product.id] = product;
      return map;
    }, {});

    const validationPromises = items.map(async (item) => {
      const product = productMap[item.productId];
      if (product.productType === 'SIMPLE') {
        const currentStock = await InventoryMovement.getCurrentStock(tenantId, item.productId);
        return {
          productId: item.productId,
          canSell: currentStock >= item.quantity,
          currentStock,
          requestedQty: item.quantity
        };
      } else {
        return await ComboService.validateComboSale(tenantId, item.productId, item.quantity);
      }
    });

    const validations = await Promise.all(validationPromises);
    const failedValidations = validations.filter(v => !v.canSell);
    if (failedValidations.length > 0) {
      return res.status(400).json({
        error: 'Insufficient stock for one or more items',
        code: 'INSUFFICIENT_STOCK',
        details: failedValidations
      });
    }

    let subtotal = 0;
    items.forEach(item => {
      const product = productMap[item.productId];
      subtotal += parseFloat(product.salePrice) * item.quantity;
    });

    const taxRateRaw = await Setting.getSetting(tenantId, 'tax_rate');
    const taxRate = taxRateRaw != null ? parseFloat(taxRateRaw) : NaN;
    if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
      return res.status(400).json({
        error: 'El IVA no está configurado. El administrador debe configurarlo en Configuración.',
        code: 'TAX_RATE_NOT_CONFIGURED'
      });
    }

    const taxAmount = subtotal * (taxRate / 100);
    const totalAmount = subtotal + taxAmount;

    const clientTransactionId = `sale-${Date.now()}-${customerId}`;
    const itemsWithProductInfo = items.map(item => {
      const product = productMap[item.productId];
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: parseFloat(product.salePrice),
        productType: product.productType
      };
    });

    await PayphonePendingPayment.create({
      clientTransactionId,
      tenantId,
      customerId,
      itemsJson: itemsWithProductInfo,
      subtotal,
      taxAmount,
      totalAmount,
      taxRate,
      notes: notes || null
    });

    const amountCents = Math.round(totalAmount * 100);
    const subtotalCents = Math.round(subtotal * 100);
    const taxCents = Math.round(taxAmount * 100);

    // Payphone requiere: amount = amountWithTax + amountWithoutTax + tax
    // Si hay impuesto (taxRate > 0):
    //   amountWithTax = subtotal (base gravable), tax = impuesto, amountWithoutTax = 0
    // Si NO hay impuesto (taxRate == 0):
    //   amountWithoutTax = subtotal, amountWithTax = 0, tax = 0
    const hasRealTax = taxRate > 0 && taxCents > 0;
    res.json({
      clientTransactionId,
      token,
      storeId,
      amount: amountCents,
      amountWithoutTax: hasRealTax ? 0 : subtotalCents,
      amountWithTax: hasRealTax ? subtotalCents : 0,
      tax: taxCents,
      currency: 'USD',
      reference: `Venta LOCOBAR ${clientTransactionId}`
    });
  } catch (error) {
    console.error('Error preparing PayPhone payment:', error);
    res.status(500).json({
      error: 'Error al preparar el pago',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /customer/checkout/confirm-payphone - Confirma pago tras redirección de PayPhone
router.post('/checkout/confirm-payphone', authenticateCustomer, async (req, res) => {
  try {
    const { id, clientTransactionId } = req.body;
    const { tenantId, customerId } = req;

    if (!id || !clientTransactionId) {
      return res.status(400).json({
        error: 'Faltan parámetros id o clientTransactionId',
        code: 'MISSING_PARAMS'
      });
    }

    const token = process.env.PAYPHONE_TOKEN;
    if (!token) {
      return res.status(503).json({
        error: 'Pago con tarjeta no configurado.',
        code: 'PAYPHONE_NOT_CONFIGURED'
      });
    }

    // Intentar confirmar con Payphone (hasta 2 intentos)
    let payphoneResult = null;
    let confirmError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch('https://pay.payphonetodoesposible.com/api/button/V2/Confirm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            id: parseInt(id, 10),
            clientTxId: clientTransactionId
          })
        });

        const responseText = await response.text();
        try {
          payphoneResult = JSON.parse(responseText);
          break; // Respuesta JSON válida, salir del retry
        } catch (parseError) {
          console.error(`PayPhone Confirm intento ${attempt}: respuesta no JSON, status:`, response.status);
          confirmError = `Status ${response.status} - respuesta no JSON`;
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 2000)); // Esperar 2s antes de reintentar
          }
        }
      } catch (fetchError) {
        console.error(`PayPhone Confirm intento ${attempt}: error de red:`, fetchError.message);
        confirmError = fetchError.message;
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    // Si Payphone respondió JSON y el pago NO fue aprobado, rechazar
    if (payphoneResult && payphoneResult.statusCode !== 3) {
      return res.status(400).json({
        error: payphoneResult.message || 'Pago no aprobado',
        code: 'PAYMENT_NOT_APPROVED',
        statusCode: payphoneResult.statusCode
      });
    }

    // Si no se pudo confirmar con Payphone pero el pago sí llegó (tenemos id de Payphone),
    // registrar la venta de todas formas. Payphone ya procesó el cobro.
    if (!payphoneResult) {
      console.warn('PayPhone Confirm falló pero se procede con la venta. Error:', confirmError, 'payphone_id:', id, 'clientTxId:', clientTransactionId);
    }

    const pending = await PayphonePendingPayment.findOne({
      where: {
        clientTransactionId,
        tenantId,
        customerId
      }
    });

    if (!pending) {
      return res.status(404).json({
        error: 'No se encontró el pago pendiente',
        code: 'PENDING_NOT_FOUND'
      });
    }

    const transaction = await sequelize.transaction();
    try {
      const items = pending.itemsJson;
      const productIds = items.map(i => i.productId);
      const products = await Product.findAll({
        where: { id: { [Op.in]: productIds }, tenantId }
      }, { transaction });
      const productMap = products.reduce((map, p) => { map[p.id] = p; return map; }, {});

      const sale = await Sale.create({
        tenantId,
        customerId,
        status: 'COMPLETED',
        totalAmount: parseFloat(pending.totalAmount),
        taxRate: parseFloat(pending.taxRate),
        taxAmount: parseFloat(pending.taxAmount),
        paymentMethod: 'CARD',
        notes: pending.notes,
        createdAt: new Date()
      }, { transaction });

      for (const item of items) {
        const product = productMap[item.productId];
        const unitPrice = item.unitPrice;
        const totalPrice = unitPrice * item.quantity;
        await SaleItem.create({
          saleId: sale.id,
          tenantId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice,
          totalPrice,
          productType: product.productType
        }, { transaction });

        if (product.productType === 'SIMPLE') {
          await InventoryMovement.create({
            tenantId,
            productId: item.productId,
            movementType: 'OUT',
            reason: 'SALE',
            qty: item.quantity,
            unitCost: await InventoryMovement.getUnitCost(tenantId, item.productId, item.quantity, transaction),
            refType: 'SALE',
            refId: sale.id
          }, { transaction });
        } else {
          await ComboService.createComboSaleMovements(tenantId, item.productId, item.quantity, sale.id, transaction);
        }
      }

      await PayphonePendingPayment.destroy({
        where: { id: pending.id }
      }, { transaction });
      await transaction.commit();

      res.json({
        success: true,
        saleId: sale.id,
        message: 'Pago confirmado correctamente'
      });
    } catch (txError) {
      await transaction.rollback();
      throw txError;
    }
  } catch (error) {
    console.error('Error confirming PayPhone payment:', error);
    res.status(500).json({
      error: error.message || 'Error al confirmar el pago',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /customer/checkout - Process customer order
router.post('/checkout', authenticateCustomer, async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { items, paymentMethod, notes } = req.body;
    const { tenantId, customerId } = req;

    if (!items || !Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'Items are required',
        code: 'INVALID_ORDER'
      });
    }

    if (!paymentMethod) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'Payment method is required',
        code: 'PAYMENT_METHOD_REQUIRED'
      });
    }

    // Get all products and validate availability
    const productIds = items.map(item => item.productId);
    const products = await Product.findAll({
      where: {
        id: { [Op.in]: productIds },
        tenantId,
        isActive: true
      }
    }, { transaction });

    if (products.length !== productIds.length) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'One or more products not found',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    const productMap = products.reduce((map, product) => {
      map[product.id] = product;
      return map;
    }, {});

    // Validate stock availability
    const validationPromises = items.map(async (item) => {
      const product = productMap[item.productId];
      
      if (product.productType === 'SIMPLE') {
        const currentStock = await InventoryMovement.getCurrentStock(tenantId, item.productId);
        return {
          productId: item.productId,
          canSell: currentStock >= item.quantity,
          currentStock,
          requestedQty: item.quantity
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

    // Calculate subtotal
    let subtotal = 0;
    items.forEach(item => {
      const product = productMap[item.productId];
      subtotal += parseFloat(product.salePrice) * item.quantity;
    });

    const taxRateRaw = await Setting.getSetting(tenantId, 'tax_rate');
    const taxRate = taxRateRaw != null ? parseFloat(taxRateRaw) : NaN;
    if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'El IVA no está configurado. El administrador debe configurarlo en Configuración.',
        code: 'TAX_RATE_NOT_CONFIGURED'
      });
    }
    const taxAmount = subtotal * (taxRate / 100);
    const totalAmount = subtotal + taxAmount;

    if (paymentMethod === 'CASH') {
      // Cash from customer web: create PENDING sale, no inventory movements, notify staff
      const sale = await Sale.create({
        tenantId,
        customerId,
        status: 'PENDING',
        totalAmount,
        taxRate: taxRate,
        taxAmount: taxAmount,
        paymentMethod: 'CASH',
        notes,
        createdAt: new Date()
      }, { transaction });

      for (const item of items) {
        const product = productMap[item.productId];
        const unitPrice = product.salePrice;
        const totalPrice = unitPrice * item.quantity;
        await SaleItem.create({
          saleId: sale.id,
          tenantId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice,
          totalPrice,
          productType: product.productType
        }, { transaction });
      }

      await transaction.commit();

      let customerName = null;
      try {
        const customerRow = await Customer.findByPk(customerId, { attributes: ['name'] });
        customerName = customerRow ? customerRow.name : null;
        const staffUsers = await User.findAll({
          where: {
            tenantId,
            isActive: true,
            role: { [Op.in]: ['ADMIN', 'MANAGER', 'CASHIER'] }
          },
          attributes: ['id']
        });
        const title = 'Cliente espera confirmación de pago en efectivo';
        const body = `Venta #${sale.id} - $${parseFloat(totalAmount).toFixed(2)}${customerName ? ` - ${customerName}` : ''}`;
        for (const u of staffUsers) {
          await Notification.create({
            tenantId,
            userId: u.id,
            type: 'CASH_CONFIRMATION',
            saleId: sale.id,
            title,
            body
          });
        }
        const io = req.app.get('io');
        if (io) {
          io.to('staff').emit('cash-pending', {
            saleId: sale.id,
            customerName,
            totalAmount: parseFloat(totalAmount)
          });
        }
        // Web Push a dispositivos suscritos del personal
        const staffIds = staffUsers.map(u => u.id);
        WebPushService.sendToUsers(
          staffIds,
          title,
          body,
          { saleId: sale.id, url: '/dashboard', tag: 'cash-pending-' + sale.id }
        ).catch(err => console.warn('Web Push:', err.message));
      } catch (notifErr) {
        console.error('Checkout CASH: error creating notifications (sale already saved):', notifErr.message);
      }

      return res.status(201).json({
        saleId: sale.id,
        status: 'PENDING',
        message: 'Esperando confirmación de pago en efectivo'
      });
    }

    // Non-cash: create COMPLETED sale and inventory movements
    const sale = await Sale.create({
      tenantId,
      customerId,
      status: 'COMPLETED',
      totalAmount,
      taxRate: taxRate,
      taxAmount: taxAmount,
      paymentMethod,
      notes,
      createdAt: new Date()
    }, { transaction });

    const saleItemsPromises = items.map(async (item) => {
      const product = productMap[item.productId];
      const unitPrice = product.salePrice;
      const totalPrice = unitPrice * item.quantity;

      await SaleItem.create({
        saleId: sale.id,
        tenantId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        productType: product.productType
      }, { transaction });

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

    await Promise.all(saleItemsPromises);
    await transaction.commit();

    const completeSale = await Sale.findByPk(sale.id, {
      include: [
        {
          association: 'items',
          include: [{ association: 'product' }]
        }
      ]
    });

    res.status(201).json({
      message: 'Order placed successfully',
      sale: completeSale
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing checkout:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /customer/sales/:id/status - Get sale status (for cash pending confirmation polling)
router.get('/sales/:id/status', authenticateCustomer, async (req, res) => {
  try {
    const { id } = req.params;
    const { customerId, tenantId } = req;

    const sale = await Sale.findOne({
      where: { id: parseInt(id, 10), customerId, tenantId },
      attributes: ['id', 'status']
    });

    if (!sale) {
      return res.status(404).json({
        error: 'Sale not found',
        code: 'SALE_NOT_FOUND'
      });
    }

    res.json({ status: sale.status });
  } catch (error) {
    console.error('Error getting sale status:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /customer/orders - Get customer order history
router.get('/orders', authenticateCustomer, async (req, res) => {
  try {
    const { customerId, tenantId } = req;

    const sales = await Sale.findAll({
      where: { customerId, tenantId },
      include: [
        {
          association: 'items',
          include: [{
            association: 'product'
          }]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: 50
    });

    res.json({ orders: sales });
  } catch (error) {
    console.error('Error getting customer orders:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;

const express = require('express');
const { Product, ProductCategory, ProductPresentation, InventoryMovement, Sale, SaleItem, Customer, GroupPurchase, GroupPurchaseParticipant, Setting, User, Notification, PayphonePendingPayment, CustomerCredit, CustomerPayment, CreditPaymentRequest } = require('../models');
const CreditService = require('../services/CreditService');
const ComboService = require('../services/ComboService');
const WebPushService = require('../services/WebPushService');
const { getSimpleProductAvailability, validateSimpleSaleQuantity, resolveMovement } = require('../services/InventoryPoolHelper');
const { getCartAwareAvailability } = require('../services/CartAvailabilityHelper');
const { sequelize } = require('../models');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const https = require('https');

// Helper: llamar al Confirm de PayPhone usando https nativo (fetch de Node/Undici
// dispara 500 "Runtime Error" en el servidor IIS de PayPhone, probablemente por
// diferencias en headers/HTTP2. El módulo https nativo se comporta como curl.)
function callPayphoneConfirm(token, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: 'pay.payphonetodoesposible.com',
      path: '/api/button/V2/Confirm',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(bodyStr)
      },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Request timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('⛔ FATAL: JWT_SECRET no está definido en las variables de entorno');
  process.exit(1);
}

// Middleware to verify JWT token
const authenticateCustomer = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '') ||
                req.body.token;

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

// Parse cartItems from query: JSON array or "productId:qty,productId:qty"
function parseCartItems(cartItemsParam) {
  if (!cartItemsParam) return [];
  if (typeof cartItemsParam === 'string') {
    try {
      const parsed = JSON.parse(cartItemsParam);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
    const items = [];
    cartItemsParam.split(',').forEach(pair => {
      const [pid, qty] = pair.split(':');
      const p = parseInt(pid, 10);
      const q = parseFloat(qty) || 1;
      if (!isNaN(p) && q > 0) items.push({ productId: p, quantity: q });
    });
    return items;
  }
  return Array.isArray(cartItemsParam) ? cartItemsParam : [];
}

// GET /customer/products - Get available products for customers
router.get('/products', async (req, res) => {
  try {
    const { search, productType, categoryId, presentationId, cartItems } = req.query;
    const tenantId = req.tenantId || 1;

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

    if (categoryId) {
      whereClause.categoryId = categoryId;
    }

    if (presentationId) {
      whereClause.presentationId = presentationId;
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
        },
        {
          association: 'category',
          required: false
        },
        {
          association: 'presentation',
          required: false
        }
      ],
      order: [['name', 'ASC']],
      limit: 100
    });

    const cartItemsParsed = parseCartItems(cartItems);
    let availabilityMap = {};

    if (products.length > 0) {
      if (cartItemsParsed.length > 0) {
        availabilityMap = await getCartAwareAvailability(tenantId, cartItemsParsed, products);
      } else {
        const availabilityPromises = products.map(async (product) => {
          if (product.productType === 'SIMPLE') {
            const av = await getSimpleProductAvailability(tenantId, product);
            return {
              productId: product.id,
              currentStock: av.currentStock,
              availableForSale: av.availableForSale
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
    }

    // Merge availability into products (incluir productos con stock 0 cuando hay carrito, para mostrar "Sin stock")
    const productsWithStock = products.map(product => {
      const availability = availabilityMap[product.id];
      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        productType: product.productType,
        salePrice: parseFloat(product.salePrice) || 0,
        imageUrl: product.imageUrl,
        categoryId: product.categoryId || null,
        categoryName: product.category ? product.category.name : null,
        presentationId: product.presentationId || null,
        presentationName: product.presentation ? product.presentation.name : null,
        taxApplies: product.taxApplies !== false,
        isReturnable: product.isReturnable === true,
        currentStock: availability?.currentStock ?? 0,
        availableForSale: availability?.availableForSale ?? false,
        components: product.components || []
      };
    });

    const inCartIds = new Set(cartItemsParsed.map(item => parseInt(item.productId, 10)));
    const hasActiveFilter = !!(search || productType || categoryId || presentationId);

    const filtered = productsWithStock.filter(p =>
      p.availableForSale ||
      inCartIds.has(p.id) ||
      hasActiveFilter
    );

    res.json({ products: filtered });
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
    const tenantId = req.tenantId || 1;

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
      const av = await getSimpleProductAvailability(tenantId, product);
      availability = {
        currentStock: av.currentStock,
        availableForSale: av.availableForSale
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
        const av = await getSimpleProductAvailability(tenantId, product);
        availableStock = av.currentStock;
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

// Helper: obtener credenciales PayPhone desde BD (o fallback a .env)
async function getPayphoneCredentials(tenantId = 1) {
  const tokenFromDB = await Setting.getSetting(tenantId, 'payphone_token', null);
  const storeIdFromDB = await Setting.getSetting(tenantId, 'payphone_store_id', null);
  const token = tokenFromDB || process.env.PAYPHONE_TOKEN;
  const storeId = storeIdFromDB || process.env.PAYPHONE_STORE_ID;
  return { token, storeId };
}

// GET /customer/payphone-config - Credenciales para la Cajita (solo cliente autenticado)
router.get('/payphone-config', authenticateCustomer, async (req, res) => {
  const { token, storeId } = await getPayphoneCredentials(req.tenantId);
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

    const { token, storeId } = await getPayphoneCredentials(tenantId);
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

    const validItems = items.filter(item => item.productId && !isNaN(parseInt(item.productId, 10)));
    if (validItems.length === 0) {
      return res.status(400).json({
        error: 'Carrito inválido. Vuelva al catálogo y agregue los productos nuevamente.',
        code: 'INVALID_ORDER'
      });
    }
    const uniqueProductIds = [...new Set(validItems.map(item => parseInt(item.productId, 10)))];
    const products = await Product.findAll({
      where: {
        id: { [Op.in]: uniqueProductIds },
        tenantId,
        isActive: true
      }
    });

    if (products.length !== uniqueProductIds.length) {
      return res.status(400).json({
        error: 'Uno o más productos ya no están disponibles. Actualice el carrito.',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    const productMap = products.reduce((map, product) => {
      map[product.id] = product;
      return map;
    }, {});

    const validationPromises = validItems.map(async (item) => {
      const product = productMap[item.productId];
      if (product.productType === 'SIMPLE') {
        const v = await validateSimpleSaleQuantity(tenantId, product, item.quantity);
        const unitsPerSale = parseFloat(product.unitsPerSale) || 1;
        return {
          productId: item.productId,
          canSell: v.canSell,
          currentStock: Math.floor(v.currentStock / unitsPerSale),
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
        error: 'Stock insuficiente para uno o más productos.',
        code: 'INSUFFICIENT_STOCK',
        details: failedValidations
      });
    }

    let subtotal = 0;
    validItems.forEach(item => {
      const product = productMap[item.productId];
      const lineTotal = parseFloat(product.salePrice) * item.quantity;
      subtotal += lineTotal;
    });

    const taxEnabledRaw = await Setting.getSetting(tenantId, 'tax_enabled', 'true');
    const isTaxEnabled = taxEnabledRaw === 'true' || taxEnabledRaw === true;
    let taxRate = 0;
    let taxAmount = 0;

    if (isTaxEnabled) {
      const taxRateRaw = await Setting.getSetting(tenantId, 'tax_rate');
      taxRate = taxRateRaw != null ? parseFloat(taxRateRaw) : NaN;
      if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
        return res.status(400).json({
          error: 'El IVA no está configurado. El administrador debe configurarlo en Configuración.',
          code: 'TAX_RATE_NOT_CONFIGURED'
        });
      }
      taxAmount = subtotal * (taxRate / 100);
    }

    const totalBase = subtotal + taxAmount;

    // Comisión PayPhone: se cobra al cliente, PayPhone se la queda
    const commRateRaw = await Setting.getSetting(tenantId, 'payphone_commission_rate');
    const commRate = (commRateRaw != null && !isNaN(parseFloat(commRateRaw))) ? parseFloat(commRateRaw) : 5.75;
    const commission = commRate > 0 ? Math.round((totalBase / (1 - commRate / 100) - totalBase) * 100) / 100 : 0;
    const totalWithCommission = Math.round((totalBase + commission) * 100) / 100;

    const clientTransactionId = `s${Date.now() % 10000000000}-${customerId}`.substring(0, 15);
    const itemsWithProductInfo = validItems.map(item => {
      const product = productMap[item.productId];
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: parseFloat(product.salePrice),
        productType: product.productType
      };
    });

    // totalAmount = precio base (sin comisión) — es lo que se registra como venta
    await PayphonePendingPayment.create({
      clientTransactionId,
      tenantId,
      customerId,
      itemsJson: itemsWithProductInfo,
      subtotal,
      taxAmount,
      totalAmount: totalBase,
      taxRate,
      notes: notes || null
    });

    // A PayPhone se le envía el monto CON comisión (el cliente paga esto)
    const amountCents = Math.round(totalWithCommission * 100);
    const subtotalCents = Math.round(subtotal * 100);
    const taxCents = Math.round(taxAmount * 100);
    const commissionCents = amountCents - subtotalCents - taxCents;

    // Payphone requiere: amount = amountWithTax + amountWithoutTax + tax
    const hasRealTax = taxRate > 0 && taxCents > 0;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      clientTransactionId,
      token,
      storeId,
      amount: amountCents,
      amountWithoutTax: hasRealTax ? commissionCents : (subtotalCents + commissionCents),
      amountWithTax: hasRealTax ? subtotalCents : 0,
      tax: taxCents,
      currency: 'USD',
      reference: `Venta LOCOBAR ${clientTransactionId}`,
      returnUrl: `${baseUrl}/customer/checkout/resultado`
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

    const { token } = await getPayphoneCredentials(req.tenantId);
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
        const response = await callPayphoneConfirm(token, {
          id: parseInt(id, 10),
          clientTxId: clientTransactionId,
          clientTransactionId: clientTransactionId
        });
        const responseText = response.body;
        console.log(`[PayPhone Sale Confirm] intento=${attempt} status=${response.status} body=${responseText.substring(0, 300)}`);
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
      console.warn('PayPhone Confirm falló pero se procede con la venta. Error:', confirmError, 'payphone_id:', id, 'clientTransactionId:', clientTransactionId);
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
      const uniqueProductIds = [...new Set(items.map(i => parseInt(i.productId, 10)).filter(id => !isNaN(id)))];

      // Lock product rows (SELECT FOR UPDATE) to serialize concurrent card payments
      const products = await Product.findAll({
        where: { id: { [Op.in]: uniqueProductIds }, tenantId },
        lock: true,
        transaction
      });
      const productMap = products.reduce((map, p) => { map[p.id] = p; return map; }, {});

      // Validate stock before creating inventory movements
      const stockChecks = await Promise.all(items.map(async (item) => {
        const product = productMap[item.productId];
        if (!product) return { productId: item.productId, productName: 'Desconocido', canSell: false };
        if (product.productType === 'SIMPLE') {
          const v = await validateSimpleSaleQuantity(tenantId, product, item.quantity);
          return { productId: item.productId, productName: product.name, canSell: v.canSell };
        } else {
          return await ComboService.validateComboSale(tenantId, item.productId, item.quantity);
        }
      }));
      const failedStock = stockChecks.filter(s => !s.canSell);
      if (failedStock.length > 0) {
        await transaction.rollback();
        const names = failedStock.map(s => s.productName || `#${s.productId}`).join(', ');
        return res.status(400).json({
          error: `Stock insuficiente para: ${names}. No se pudo completar el pago.`,
          code: 'INSUFFICIENT_STOCK'
        });
      }

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
          const { productId: mvProductId, qty: mvQty } = resolveMovement(product, item.quantity);
          await InventoryMovement.create({
            tenantId,
            productId: mvProductId,
            movementType: 'OUT',
            reason: 'SALE',
            qty: mvQty,
            unitCost: await InventoryMovement.getUnitCost(tenantId, mvProductId, mvQty, transaction),
            refType: 'SALE',
            refId: sale.id
          }, { transaction });
        } else {
          await ComboService.createComboSaleMovements(tenantId, item.productId, item.quantity, sale.id, transaction);
        }
      }

      await PayphonePendingPayment.destroy({
        where: { id: pending.id },
        transaction
      });
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
    const { items, paymentMethod, notes, transferAccountIndex, transferAccountInfo } = req.body;
    const { tenantId, customerId } = req;

    if (paymentMethod === 'TRANSFER') {
      if (transferAccountIndex == null || transferAccountIndex === '' || isNaN(parseInt(transferAccountIndex, 10))) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'Debe seleccionar la cuenta bancaria a la que realizará la transferencia',
          code: 'TRANSFER_ACCOUNT_REQUIRED'
        });
      }
    }

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

    // Filter and deduplicate product IDs
    const validItems = items.filter(item => item.productId && !isNaN(parseInt(item.productId, 10)));
    if (validItems.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'Carrito inválido. Vuelva al catálogo y agregue los productos nuevamente.',
        code: 'INVALID_ORDER'
      });
    }
    const uniqueProductIds = [...new Set(validItems.map(item => parseInt(item.productId, 10)))];

    // Lock product rows (SELECT FOR UPDATE) to serialize concurrent orders
    const products = await Product.findAll({
      where: {
        id: { [Op.in]: uniqueProductIds },
        tenantId,
        isActive: true
      },
      lock: true,
      transaction
    });

    if (products.length !== uniqueProductIds.length) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'Uno o más productos no están disponibles. Actualice el carrito.',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    const productMap = products.reduce((map, product) => {
      map[product.id] = product;
      return map;
    }, {});

    // Validate stock availability (reads committed data after acquiring lock)
    const validationPromises = validItems.map(async (item) => {
      const product = productMap[item.productId];
      if (product.productType === 'SIMPLE') {
        const v = await validateSimpleSaleQuantity(tenantId, product, item.quantity);
        const unitsPerSale = parseFloat(product.unitsPerSale) || 1;
        return {
          productId: item.productId,
          productName: product.name,
          canSell: v.canSell,
          currentStock: Math.floor(v.currentStock / unitsPerSale),
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
      const names = failedValidations.map(v => v.productName || `#${v.productId}`).join(', ');
      return res.status(400).json({
        error: `Stock insuficiente para: ${names}. Ajuste las cantidades en el carrito.`,
        code: 'INSUFFICIENT_STOCK',
        details: failedValidations
      });
    }

    let subtotal = 0;
    validItems.forEach(item => {
      const product = productMap[item.productId];
      const lineTotal = parseFloat(product.salePrice) * item.quantity;
      subtotal += lineTotal;
    });

    const taxEnabledRaw2 = await Setting.getSetting(tenantId, 'tax_enabled', 'true');
    const isTaxEnabled2 = taxEnabledRaw2 === 'true' || taxEnabledRaw2 === true;
    let taxRate = 0;
    let taxAmount = 0;

    if (isTaxEnabled2) {
      const taxRateRaw = await Setting.getSetting(tenantId, 'tax_rate');
      taxRate = taxRateRaw != null ? parseFloat(taxRateRaw) : NaN;
      if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'El IVA no está configurado. El administrador debe configurarlo en Configuración.',
          code: 'TAX_RATE_NOT_CONFIGURED'
        });
      }
      taxAmount = subtotal * (taxRate / 100);
    }

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

      for (const item of validItems) {
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
          { saleId: sale.id, url: '/dashboard', tag: 'cash-pending-' + sale.id, staffOnly: true }
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

    if (paymentMethod === 'TRANSFER') {
      // Transfer from customer web: create PENDING sale, no inventory movements, notify staff
      const sale = await Sale.create({
        tenantId,
        customerId,
        status: 'PENDING',
        totalAmount,
        taxRate: taxRate,
        taxAmount: taxAmount,
        paymentMethod: 'TRANSFER',
        notes,
        transferAccountIndex: parseInt(transferAccountIndex, 10),
        transferAccountInfo: transferAccountInfo || null,
        createdAt: new Date()
      }, { transaction });

      for (const item of validItems) {
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
        const title = 'Cliente espera confirmación de transferencia';
        const body = `Venta #${sale.id} - $${parseFloat(totalAmount).toFixed(2)}${customerName ? ` - ${customerName}` : ''}`;
        for (const u of staffUsers) {
          await Notification.create({
            tenantId,
            userId: u.id,
            type: 'TRANSFER_CONFIRMATION',
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
        const staffIds = staffUsers.map(u => u.id);
        WebPushService.sendToUsers(
          staffIds,
          title,
          body,
          { saleId: sale.id, url: '/dashboard', tag: 'transfer-pending-' + sale.id, staffOnly: true }
        ).catch(err => console.warn('Web Push:', err.message));
      } catch (notifErr) {
        console.error('Checkout TRANSFER: error creating notifications (sale already saved):', notifErr.message);
      }

      return res.status(201).json({
        saleId: sale.id,
        status: 'PENDING',
        message: 'Esperando confirmación de transferencia'
      });
    }

    // Non-cash (CARD, etc.): create COMPLETED sale and inventory movements
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

    const saleItemsPromises = validItems.map(async (item) => {
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
        const { productId: mvProductId, qty: mvQty } = resolveMovement(product, item.quantity);
        await InventoryMovement.create({
          tenantId,
          productId: mvProductId,
          movementType: 'OUT',
          reason: 'SALE',
          qty: mvQty,
          unitCost: await InventoryMovement.getUnitCost(
            tenantId,
            mvProductId,
            mvQty,
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

// ── COMPRAS GRUPALES DEL CLIENTE ──────────────────────────────────

// GET /customer/group-purchase-participations — participaciones del cliente autenticado
router.get('/group-purchase-participations', authenticateCustomer, async (req, res) => {
  try {
    const customerId = parseInt(req.customerId, 10);
    const tenantId = parseInt(req.tenantId, 10);

    console.log('[group-participations] customerId:', customerId, 'tenantId:', tenantId);

    const participations = await GroupPurchaseParticipant.findAll({
      where: { customerId },
      include: [
        {
          association: 'groupPurchase',
          required: true,
          where: { tenantId },
          include: [
            { association: 'product', attributes: ['id', 'name'] }
          ]
        },
        {
          association: 'credit',
          required: false,
          attributes: ['id', 'currentBalance', 'status', 'dueDate']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    console.log('[group-participations] found:', participations.length);

    // Obtener conteo total de participantes por compra grupal en query separada
    const groupPurchaseIds = [...new Set(participations.map(p => p.groupPurchaseId))];
    let countsByGroupId = {};
    if (groupPurchaseIds.length > 0) {
      const counts = await GroupPurchaseParticipant.findAll({
        where: { groupPurchaseId: { [Op.in]: groupPurchaseIds } },
        attributes: ['groupPurchaseId', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
        group: ['groupPurchaseId'],
        raw: true
      });
      counts.forEach(c => { countsByGroupId[c.groupPurchaseId] = parseInt(c.cnt, 10); });
    }

    const result = participations.map(p => {
      const plain = p.toJSON();
      if (plain.groupPurchase) {
        plain.groupPurchase.participantCount = countsByGroupId[p.groupPurchaseId] || 1;
      }
      return plain;
    });

    res.json({ participations: result });
  } catch (error) {
    console.error('Error getting group purchase participations:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// ── CRÉDITOS DEL CLIENTE ──────────────────────────────────────────

// GET /customer/credits  — lista los créditos del cliente autenticado
router.get('/credits', authenticateCustomer, async (req, res) => {
  try {
    const { customerId, tenantId } = req;
    const { status } = req.query;

    const where = { customerId, tenantId };
    if (status) where.status = status;

    const credits = await CustomerCredit.findAll({
      where,
      include: [
        {
          association: 'groupPurchaseParticipant',
          include: [
            {
              association: 'groupPurchase',
              include: [
                { association: 'product' },
                { association: 'sale', include: [{ association: 'items', include: [{ association: 'product' }] }] }
              ]
            }
          ]
        }
      ],
      order: [['dueDate', 'ASC'], ['createdAt', 'DESC']]
    });

    // Para créditos individuales (saleId sin participante grupal), obtener artículos de la venta
    const creditsJson = credits.map(c => c.toJSON());
    for (var i = 0; i < creditsJson.length; i++) {
      var cr = creditsJson[i];
      if (cr.saleId && !cr.groupPurchaseParticipantId) {
        const saleData = await Sale.findOne({
          where: { id: cr.saleId },
          include: [{ association: 'items', include: [{ association: 'product' }] }]
        });
        if (saleData) cr.saleData = saleData.toJSON();
      }
    }

    res.json({ credits: creditsJson });
  } catch (error) {
    console.error('Error listing customer credits:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// GET /customer/credits/summary  — resumen de créditos del cliente autenticado
router.get('/credits/summary', authenticateCustomer, async (req, res) => {
  try {
    const { customerId, tenantId } = req;
    const { includeInterest = 'true' } = req.query;

    const summary = await CreditService.getCustomerCreditSummary(
      tenantId,
      customerId,
      includeInterest === 'true'
    );

    res.json(summary);
  } catch (error) {
    console.error('Error getting credit summary:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// GET /customer/credits/:id  — detalle de un crédito (solo si pertenece al cliente)
router.get('/credits/:id', authenticateCustomer, async (req, res) => {
  try {
    const { customerId, tenantId } = req;
    const { id } = req.params;

    const credit = await CustomerCredit.findOne({
      where: { id, customerId, tenantId },
      include: [
        {
          association: 'groupPurchaseParticipant',
          include: [
            {
              association: 'groupPurchase',
              include: [{ association: 'product', attributes: ['id', 'name'] }]
            },
            { association: 'payments' }
          ]
        }
      ]
    });

    if (!credit) {
      return res.status(404).json({ error: 'Crédito no encontrado', code: 'NOT_FOUND' });
    }

    res.json(credit);
  } catch (error) {
    console.error('Error getting credit:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// POST /customer/credits/:id/prepare-payphone — prepara pago con tarjeta para un crédito
router.post('/credits/:id/prepare-payphone', authenticateCustomer, async (req, res) => {
  try {
    const { customerId, tenantId } = req;
    const { id } = req.params;

    const credit = await CustomerCredit.findOne({ where: { id, customerId, tenantId } });
    if (!credit) return res.status(404).json({ error: 'Crédito no encontrado', code: 'NOT_FOUND' });
    if (credit.status !== 'ACTIVE') return res.status(400).json({ error: 'Crédito no activo', code: 'CREDIT_NOT_ACTIVE' });

    const balance = parseFloat(credit.currentBalance);
    if (balance <= 0.01) return res.status(400).json({ error: 'Sin saldo pendiente', code: 'NO_BALANCE' });

    const { token, storeId } = await getPayphoneCredentials(tenantId);
    if (!token || !storeId) {
      return res.status(503).json({ error: 'Pago con tarjeta no configurado. Contacte al administrador.', code: 'PAYPHONE_NOT_CONFIGURED' });
    }

    // Comisión PayPhone
    const commRateRaw = await Setting.getSetting(tenantId, 'payphone_commission_rate');
    const commRate = (commRateRaw != null && !isNaN(parseFloat(commRateRaw))) ? parseFloat(commRateRaw) : 5.75;
    const commission = commRate > 0 ? Math.round((balance / (1 - commRate / 100) - balance) * 100) / 100 : 0;
    const totalWithCommission = Math.round((balance + commission) * 100) / 100;

    const clientTransactionId = `c${Date.now()}`.slice(0, 15);

    // totalAmount = monto base del crédito (sin comisión)
    await PayphonePendingPayment.create({
      clientTransactionId,
      tenantId,
      customerId,
      itemsJson: [{ type: 'credit', creditId: parseInt(id, 10) }],
      subtotal: balance,
      taxAmount: 0,
      totalAmount: balance,
      taxRate: 0,
      notes: null
    });

    // A PayPhone se le envía el monto CON comisión
    const amountCents = Math.round(totalWithCommission * 100);
    const balanceCents = Math.round(balance * 100);
    const commissionCents = amountCents - balanceCents;
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    res.json({
      clientTransactionId,
      token,
      storeId,
      amount: amountCents,
      amountWithoutTax: amountCents,
      amountWithTax: 0,
      tax: 0,
      currency: 'USD',
      reference: `Crédito CR-${String(id).padStart(4, '0')}`,
      returnUrl: `${baseUrl}/customer/checkout/resultado`
    });
  } catch (error) {
    console.error('Error preparing PayPhone credit payment:', error);
    res.status(500).json({ error: 'Error al preparar el pago', code: 'INTERNAL_ERROR' });
  }
});

// POST /customer/credits/prepare-payphone-all — prepara pago con tarjeta para TODOS los créditos activos
router.post('/credits/prepare-payphone-all', authenticateCustomer, async (req, res) => {
  try {
    const { customerId, tenantId } = req;

    const credits = await CustomerCredit.findAll({
      where: { customerId, tenantId, status: 'ACTIVE' }
    });
    const activeCredits = credits.filter(c => parseFloat(c.currentBalance) > 0.01);
    if (activeCredits.length === 0) return res.status(400).json({ error: 'No tienes créditos activos pendientes', code: 'NO_CREDITS' });

    const { token, storeId } = await getPayphoneCredentials(tenantId);
    if (!token || !storeId) return res.status(503).json({ error: 'Pago con tarjeta no configurado.', code: 'PAYPHONE_NOT_CONFIGURED' });

    const commRateRaw = await Setting.getSetting(tenantId, 'payphone_commission_rate');
    const commRate = (commRateRaw != null && !isNaN(parseFloat(commRateRaw))) ? parseFloat(commRateRaw) : 5.75;

    // Sumar balances truncados individualmente (consistente con lo que se muestra en pantalla)
    const totalBalance = Math.round(activeCredits.reduce((sum, c) => {
      return sum + Math.floor(parseFloat(c.currentBalance) * 100) / 100;
    }, 0) * 100) / 100;

    const commission = commRate > 0 ? Math.round((totalBalance / (1 - commRate / 100) - totalBalance) * 100) / 100 : 0;
    const totalWithCommission = Math.round((totalBalance + commission) * 100) / 100;

    const clientTransactionId = `c${Date.now()}`.slice(0, 15);

    await PayphonePendingPayment.create({
      clientTransactionId,
      tenantId,
      customerId,
      itemsJson: activeCredits.map(c => ({ type: 'credit', creditId: c.id, balance: Math.floor(parseFloat(c.currentBalance) * 100) / 100 })),
      subtotal: totalBalance,
      taxAmount: 0,
      totalAmount: totalBalance,
      taxRate: 0,
      notes: null
    });

    const amountCents = Math.round(totalWithCommission * 100);
    const balanceCents = Math.round(totalBalance * 100);
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    res.json({
      clientTransactionId,
      token,
      storeId,
      amount: amountCents,
      amountWithoutTax: amountCents,
      amountWithTax: 0,
      tax: 0,
      currency: 'USD',
      reference: `Créditos LOCOBAR (${activeCredits.length})`,
      returnUrl: `${baseUrl}/customer/checkout/resultado`
    });
  } catch (error) {
    console.error('Error preparing PayPhone all-credits payment:', error);
    res.status(500).json({ error: 'Error al preparar el pago', code: 'INTERNAL_ERROR' });
  }
});

// POST /customer/credits/confirm-payphone — confirma pago con tarjeta para un crédito
router.post('/credits/confirm-payphone', authenticateCustomer, async (req, res) => {
  try {
    const { id, clientTransactionId } = req.body;
    const { tenantId, customerId } = req;

    if (!id || !clientTransactionId) {
      return res.status(400).json({ error: 'Faltan parámetros id o clientTransactionId', code: 'MISSING_PARAMS' });
    }

    const { token } = await getPayphoneCredentials(tenantId);
    if (!token) {
      return res.status(503).json({ error: 'Pago con tarjeta no configurado.', code: 'PAYPHONE_NOT_CONFIGURED' });
    }

    let payphoneResult = null;
    let confirmError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await callPayphoneConfirm(token, {
          id: parseInt(id, 10),
          clientTxId: clientTransactionId,
          clientTransactionId: clientTransactionId
        });
        const responseText = response.body;
        console.log(`[PayPhone Credit Confirm] intento=${attempt} status=${response.status} body=${responseText.substring(0, 300)}`);
        try {
          payphoneResult = JSON.parse(responseText);
          break;
        } catch {
          confirmError = `Status ${response.status} - respuesta no JSON: ${responseText.substring(0, 200)}`;
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
        }
      } catch (fetchError) {
        confirmError = fetchError.message;
        if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (payphoneResult && payphoneResult.statusCode !== 3) {
      console.warn(`[PayPhone Credit Confirm] rechazado statusCode=${payphoneResult.statusCode} msg=${payphoneResult.message}`);
      return res.status(400).json({ error: payphoneResult.message || 'Pago no aprobado', code: 'PAYMENT_NOT_APPROVED' });
    }

    // Para pagos de crédito, si PayPhone no confirmó, NO registrar el pago.
    // A diferencia del checkout (inventario ya comprometido), el crédito no tiene
    // efectos secundarios irreversibles, por lo que es más seguro rechazar.
    if (!payphoneResult) {
      console.warn('PayPhone credit confirm falló. Error:', confirmError, 'payphone_id:', id, 'clientTransactionId:', clientTransactionId);
      return res.status(502).json({
        error: 'No se pudo confirmar el pago con PayPhone. Tu tarjeta NO fue cobrada. Por favor intenta nuevamente.',
        code: 'PAYPHONE_CONFIRM_FAILED'
      });
    }

    const pending = await PayphonePendingPayment.findOne({ where: { clientTransactionId, tenantId, customerId } });
    if (!pending) return res.status(404).json({ error: 'No se encontró el pago pendiente', code: 'PENDING_NOT_FOUND' });

    const creditItems = (pending.itemsJson || []).filter(i => i.type === 'credit');
    if (creditItems.length === 0) return res.status(400).json({ error: 'Tipo de pago inválido', code: 'INVALID_TYPE' });

    const transaction = await sequelize.transaction();
    try {
      const today = new Date().toISOString().split('T')[0];

      if (creditItems.length === 1) {
        // Pago individual — comportamiento original
        const credit = await CustomerCredit.findOne({ where: { id: creditItems[0].creditId, customerId, tenantId } });
        if (!credit) throw new Error('Crédito no encontrado');
        const payAmt = parseFloat(pending.totalAmount);

        await CustomerPayment.create({
          tenantId, customerId,
          groupPurchaseParticipantId: credit.groupPurchaseParticipantId || null,
          amount: payAmt, paymentMethod: 'CARD', paymentDate: today,
          notes: `Pago con tarjeta - PayPhone TX: ${id}`
        }, { transaction });
        await CreditService.applyPayment(credit.id, payAmt, transaction);
      } else {
        // Pago de todos los créditos — aplicar a cada uno según su balance registrado
        for (const item of creditItems) {
          const credit = await CustomerCredit.findOne({ where: { id: item.creditId, customerId, tenantId } });
          if (!credit) continue;
          const payAmt = item.balance || Math.floor(parseFloat(credit.currentBalance) * 100) / 100;

          await CustomerPayment.create({
            tenantId, customerId,
            groupPurchaseParticipantId: credit.groupPurchaseParticipantId || null,
            amount: payAmt, paymentMethod: 'CARD', paymentDate: today,
            notes: `Pago con tarjeta (total) - PayPhone TX: ${id}`
          }, { transaction });
          await CreditService.applyPayment(credit.id, payAmt, transaction);
        }
      }

      await pending.destroy({ transaction });
      await transaction.commit();

      res.json({ ok: true, creditCount: creditItems.length });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (error) {
    console.error('Error confirming PayPhone credit payment:', error);
    res.status(500).json({ error: 'Error al confirmar el pago', code: 'INTERNAL_ERROR' });
  }
});

// POST /customer/credits/:id/payment — registrar pago de un crédito
router.post('/credits/:id/payment', authenticateCustomer, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { customerId, tenantId } = req;
    const { id } = req.params;
    const { amount, paymentMethod, paymentDate, notes } = req.body;

    if (!amount || amount <= 0 || !paymentMethod || !paymentDate) {
      await transaction.rollback();
      return res.status(400).json({ error: 'amount, paymentMethod y paymentDate son requeridos', code: 'MISSING_FIELDS' });
    }

    const validMethods = ['CASH', 'CARD', 'TRANSFER'];
    if (!validMethods.includes(paymentMethod)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Método de pago inválido', code: 'INVALID_PAYMENT_METHOD' });
    }

    // Verificar que el crédito pertenece al cliente autenticado
    const credit = await CustomerCredit.findOne({ where: { id, customerId, tenantId } });
    if (!credit) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Crédito no encontrado', code: 'NOT_FOUND' });
    }
    if (credit.status !== 'ACTIVE') {
      await transaction.rollback();
      return res.status(400).json({ error: 'Este crédito ya está pagado o cancelado', code: 'CREDIT_NOT_ACTIVE' });
    }

    const payAmt = parseFloat(amount);
    if (payAmt > parseFloat(credit.currentBalance)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'El monto supera el saldo actual del crédito', code: 'AMOUNT_EXCEEDS_BALANCE' });
    }

    // Registrar pago en customer_payments
    const payment = await CustomerPayment.create({
      tenantId,
      customerId,
      groupPurchaseParticipantId: credit.groupPurchaseParticipantId || null,
      amount: payAmt,
      paymentMethod,
      paymentDate,
      notes: notes || null
    }, { transaction });

    // Aplicar pago al crédito (actualiza saldo e intereses; también actualiza participante si aplica)
    await CreditService.applyPayment(credit.id, payAmt, transaction);

    await transaction.commit();

    res.status(201).json({ ok: true, paymentId: payment.id });
  } catch (error) {
    await transaction.rollback();
    console.error('Error registering credit payment:', error);
    res.status(500).json({ error: error.message || 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// POST /customer/credits/:id/payment-request — solicitar pago (efectivo/transferencia, requiere confirmación admin)
router.post('/credits/:id/payment-request', authenticateCustomer, async (req, res) => {
  try {
    const { customerId, tenantId } = req;
    const { id } = req.params;
    const { amount, paymentMethod, notes } = req.body;

    if (!amount || amount <= 0 || !paymentMethod) {
      return res.status(400).json({ error: 'amount y paymentMethod son requeridos', code: 'MISSING_FIELDS' });
    }
    if (!['CASH', 'TRANSFER'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'Método de pago inválido para solicitud', code: 'INVALID_PAYMENT_METHOD' });
    }

    const credit = await CustomerCredit.findOne({ where: { id, customerId, tenantId } });
    if (!credit) return res.status(404).json({ error: 'Crédito no encontrado', code: 'NOT_FOUND' });
    if (credit.status !== 'ACTIVE') return res.status(400).json({ error: 'Este crédito ya está pagado o cancelado', code: 'CREDIT_NOT_ACTIVE' });

    const payAmt = parseFloat(amount);
    if (payAmt > parseFloat(credit.currentBalance) + 0.01) {
      return res.status(400).json({ error: 'El monto supera el saldo actual del crédito', code: 'AMOUNT_EXCEEDS_BALANCE' });
    }

    // Verificar que no haya una solicitud pendiente ya existente para este crédito
    const existing = await CreditPaymentRequest.findOne({ where: { creditId: id, customerId, tenantId, status: 'PENDING' } });
    if (existing) {
      return res.status(409).json({ error: 'Ya tienes una solicitud de pago pendiente para este crédito', code: 'REQUEST_ALREADY_PENDING' });
    }

    const request = await CreditPaymentRequest.create({
      tenantId,
      customerId,
      creditId: parseInt(id),
      amount: payAmt,
      paymentMethod,
      notes: notes || null,
      status: 'PENDING'
    });

    res.status(201).json({ ok: true, requestId: request.id });
  } catch (error) {
    console.error('Error creating credit payment request:', error);
    res.status(500).json({ error: error.message || 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;

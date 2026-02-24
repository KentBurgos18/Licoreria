const express = require('express');
const { GroupPurchase, GroupPurchaseParticipant, Sale, SaleItem, Product, Customer, InventoryMovement, CustomerCredit, Setting } = require('../models');
const GroupPurchaseService = require('../services/GroupPurchaseService');
const ComboService = require('../services/ComboService');
const { validateSimpleSaleQuantity, resolveMovement } = require('../services/InventoryPoolHelper');
const { sequelize } = require('../models');
const { Op } = require('sequelize');
const { requireRole } = require('./adminAuth');

const router = express.Router();

// Todas las rutas de compras grupales requieren rol ADMIN
router.use(requireRole('ADMIN'));

// POST /group-purchases - Create group purchase
router.post('/', async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const {
      tenantId,
      productId,
      quantity,
      participants,
      paymentMethod,
      notes
    } = req.body;

    if (!tenantId || !productId || !quantity || !participants) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'tenantId, productId, quantity, and participants are required',
        code: 'MISSING_FIELDS'
      });
    }

    // Validate participants structure
    if (!Array.isArray(participants) || participants.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'participants must be a non-empty array',
        code: 'INVALID_PARTICIPANTS'
      });
    }

    for (const participant of participants) {
      if (!participant.customerId || !participant.amountDue) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'Each participant must have customerId and amountDue',
          code: 'INVALID_PARTICIPANT'
        });
      }
    }

    const groupPurchase = await GroupPurchaseService.createGroupPurchase({
      tenantId,
      productId,
      quantity,
      participants,
      paymentMethod: paymentMethod || 'CASH',
      notes
    }, transaction);

    await transaction.commit();

    res.status(201).json(groupPurchase);
  } catch (error) {
    await transaction.rollback();
    console.error('Error creating group purchase:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /group-purchases/from-cart - Create group purchase from a full POS cart
// Each participant may use a different payment method (CASH/TRANSFER = paid now; CREDIT = adeudo)
router.post('/from-cart', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { tenantId, items, participants, notes } = req.body;

    if (!tenantId) {
      await transaction.rollback();
      return res.status(400).json({ error: 'tenantId es requerido', code: 'MISSING_FIELDS' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'items debe ser un arreglo con al menos un producto', code: 'MISSING_FIELDS' });
    }
    if (!participants || !Array.isArray(participants) || participants.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'participants debe ser un arreglo con al menos un participante', code: 'MISSING_FIELDS' });
    }

    // Validate participants
    for (const p of participants) {
      if (!p.customerId || p.amountDue == null || parseFloat(p.amountDue) < 0) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Cada participante requiere customerId y amountDue >= 0', code: 'INVALID_PARTICIPANT' });
      }
      const validMethods = ['CASH', 'TRANSFER', 'CREDIT'];
      if (p.paymentMethod && !validMethods.includes(p.paymentMethod)) {
        await transaction.rollback();
        return res.status(400).json({ error: `Método de pago inválido: ${p.paymentMethod}`, code: 'INVALID_PAYMENT_METHOD' });
      }
    }

    // Load all products and validate they exist
    const productIds = [...new Set(items.map(i => parseInt(i.productId, 10)).filter(id => !isNaN(id)))];
    const products = await Product.findAll({
      where: { id: { [Op.in]: productIds }, tenantId, isActive: true },
      lock: true,
      transaction
    });
    if (products.length !== productIds.length) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Uno o más productos no están disponibles', code: 'PRODUCT_NOT_FOUND' });
    }
    const productMap = products.reduce((m, p) => { m[p.id] = p; return m; }, {});

    // Validate stock for each item
    for (const item of items) {
      const product = productMap[parseInt(item.productId, 10)];
      if (!product) continue;
      if (product.productType === 'SIMPLE') {
        const v = await validateSimpleSaleQuantity(tenantId, product, parseFloat(item.quantity));
        if (!v.canSell) {
          await transaction.rollback();
          return res.status(400).json({
            error: `Stock insuficiente para "${product.name}". Disponible: ${Math.floor(v.currentStock / (parseFloat(product.unitsPerSale) || 1))}`,
            code: 'INSUFFICIENT_STOCK'
          });
        }
      } else {
        const av = await ComboService.calculateComboStock(tenantId, parseInt(item.productId, 10));
        if (av < parseFloat(item.quantity)) {
          await transaction.rollback();
          return res.status(400).json({
            error: `Stock insuficiente para el combo "${product.name}"`,
            code: 'INSUFFICIENT_STOCK'
          });
        }
      }
    }

    // Compute subtotals and total (prices come from product.salePrice; unitPrice from item is used for overrides)
    let subtotal = 0;
    let taxableSubtotal = 0;
    for (const item of items) {
      const product = productMap[parseInt(item.productId, 10)];
      const unitPrice = item.unitPrice != null ? parseFloat(item.unitPrice) : parseFloat(product.salePrice);
      const lineTotal = unitPrice * parseFloat(item.quantity);
      subtotal += lineTotal;
      if (product.taxApplies !== false) taxableSubtotal += lineTotal;
    }

    // IVA
    const taxEnabledRaw = await Setting.getSetting(tenantId, 'tax_enabled', 'true');
    const isTaxEnabled = taxEnabledRaw === 'true' || taxEnabledRaw === true;
    let taxRate = 0;
    let taxAmount = 0;
    if (isTaxEnabled) {
      const taxRateRaw = await Setting.getSetting(tenantId, 'tax_rate');
      taxRate = taxRateRaw != null ? parseFloat(taxRateRaw) : NaN;
      if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
        await transaction.rollback();
        return res.status(400).json({ error: 'El IVA no está configurado. Configúrelo en Ajustes.', code: 'TAX_RATE_NOT_CONFIGURED' });
      }
      taxAmount = taxableSubtotal * (taxRate / 100);
    }
    const totalAmount = subtotal + taxAmount;

    // Validate participant amounts sum = totalAmount (±0.02 tolerance)
    const participantsSum = participants.reduce((s, p) => s + parseFloat(p.amountDue), 0);
    if (Math.abs(participantsSum - totalAmount) > 0.02) {
      await transaction.rollback();
      return res.status(400).json({
        error: `La suma de montos de participantes ($${participantsSum.toFixed(2)}) no coincide con el total ($${totalAmount.toFixed(2)})`,
        code: 'AMOUNT_MISMATCH'
      });
    }

    // Determine overall sale paymentMethod from participants
    const methods = participants.map(p => p.paymentMethod || 'CREDIT');
    const allCash = methods.every(m => m === 'CASH');
    const allTransfer = methods.every(m => m === 'TRANSFER');
    const salePaymentMethod = allCash ? 'CASH' : allTransfer ? 'TRANSFER' : 'CREDIT';

    // Create Sale
    const sale = await Sale.create({
      tenantId,
      customerId: null,
      status: 'COMPLETED',
      totalAmount,
      taxRate,
      taxAmount,
      paymentMethod: salePaymentMethod,
      notes: notes || `Venta grupal - ${participants.length} participantes`
    }, { transaction });

    // Create SaleItems + InventoryMovements
    for (const item of items) {
      const product = productMap[parseInt(item.productId, 10)];
      const unitPrice = item.unitPrice != null ? parseFloat(item.unitPrice) : parseFloat(product.salePrice);
      const qty = parseFloat(item.quantity);
      const totalPrice = unitPrice * qty;

      await SaleItem.create({
        saleId: sale.id,
        tenantId,
        productId: product.id,
        productType: product.productType,
        quantity: qty,
        unitPrice,
        totalPrice
      }, { transaction });

      if (product.productType === 'SIMPLE') {
        const { productId: mvProductId, qty: mvQty } = resolveMovement(product, qty);
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
        await ComboService.createComboSaleMovements(tenantId, product.id, qty, sale.id, transaction);
      }
    }

    // Create GroupPurchase (productId = null → multi-product group sale)
    const groupPurchase = await GroupPurchase.create({
      tenantId,
      saleId: sale.id,
      productId: null,
      quantity: 1,
      totalAmount,
      status: 'PENDING'
    }, { transaction });

    // Create GroupPurchaseParticipants
    const createdParticipants = [];
    for (const pData of participants) {
      const payMethod = pData.paymentMethod || 'CREDIT';
      // CASH/TRANSFER = paid upfront; CREDIT = adeudo
      const amountDue = parseFloat(pData.amountDue);
      const amountPaid = (payMethod === 'CASH' || payMethod === 'TRANSFER') ? amountDue : 0;

      const participant = await GroupPurchaseParticipant.create({
        groupPurchaseId: groupPurchase.id,
        customerId: pData.customerId,
        amountDue,
        amountPaid,
        paymentMethod: payMethod,
        status: amountPaid >= amountDue ? 'PAID' : 'PENDING',
        dueDate: pData.dueDate || null,
        interestRate: pData.interestRate || 0,
        interestAmount: 0,
        paidAt: amountPaid >= amountDue ? new Date() : null
      }, { transaction });

      // Create CustomerCredit only for CREDIT participants
      if (payMethod === 'CREDIT' && amountDue > 0) {
        await CustomerCredit.create({
          tenantId,
          customerId: pData.customerId,
          groupPurchaseParticipantId: participant.id,
          initialAmount: amountDue,
          currentBalance: amountDue,
          interestRate: pData.interestRate || 0,
          dueDate: pData.dueDate || null,
          status: 'ACTIVE',
          lastInterestCalculationDate: new Date().toISOString().split('T')[0]
        }, { transaction });
      }

      createdParticipants.push(participant);
    }

    // Update GroupPurchase status
    await GroupPurchaseService.updateGroupPurchaseStatus(groupPurchase.id, transaction);

    await transaction.commit();

    res.status(201).json({
      id: groupPurchase.id,
      saleId: sale.id,
      totalAmount,
      participants: createdParticipants.length,
      message: 'Venta grupal creada exitosamente'
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error creating group sale from cart:', error);
    res.status(500).json({ error: error.message || 'Error interno', code: 'INTERNAL_ERROR' });
  }
});

// GET /group-purchases - List group purchases
router.get('/', async (req, res) => {
  try {
    const {
      tenantId,
      status,
      productId,
      startDate,
      endDate,
      page = 1,
      limit = 50,
      customerId // For filtering by customer (used by customers)
    } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'TENANT_REQUIRED'
      });
    }

    const whereClause = { tenantId };
    
    // If customerId is provided, filter by participants
    let includeParticipants = {
      association: 'participants',
      include: [
        { association: 'customer' },
        { association: 'credit' }
      ]
    };
    
    if (customerId) {
      includeParticipants.where = { customerId };
    }

    if (status) {
      whereClause.status = status;
    }

    if (productId) {
      whereClause.productId = productId;
    }

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt[Op.gte] = startDate;
      if (endDate) whereClause.createdAt[Op.lte] = endDate;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows } = await GroupPurchase.findAndCountAll({
      where: whereClause,
      include: [
        { association: 'sale', include: [{ association: 'items' }] },
        { association: 'product' },
        includeParticipants
      ],
      limit: parseInt(limit),
      offset,
      order: [['createdAt', 'DESC']]
    });

    res.json({
      groupPurchases: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error listing group purchases:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /group-purchases/:id - Get group purchase by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'TENANT_REQUIRED'
      });
    }

    const groupPurchase = await GroupPurchase.findOne({
      where: { id, tenantId },
      include: [
        { association: 'sale', include: [{ association: 'items' }] },
        { association: 'product' },
        {
          association: 'participants',
          include: [
            { association: 'customer' },
            { association: 'credit' },
            { association: 'payments' }
          ]
        }
      ]
    });

    if (!groupPurchase) {
      return res.status(404).json({
        error: 'Group purchase not found',
        code: 'GROUP_PURCHASE_NOT_FOUND'
      });
    }

    res.json(groupPurchase);
  } catch (error) {
    console.error('Error getting group purchase:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// PUT /group-purchases/:id - Update group purchase
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId, status } = req.body;

    if (!tenantId) {
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'TENANT_REQUIRED'
      });
    }

    const groupPurchase = await GroupPurchase.findOne({
      where: { id, tenantId }
    });

    if (!groupPurchase) {
      return res.status(404).json({
        error: 'Group purchase not found',
        code: 'GROUP_PURCHASE_NOT_FOUND'
      });
    }

    if (status && ['PENDING', 'PARTIAL', 'COMPLETED', 'CANCELLED'].includes(status)) {
      groupPurchase.status = status;
      if (status === 'COMPLETED' && !groupPurchase.completedAt) {
        groupPurchase.completedAt = new Date();
      }
      await groupPurchase.save();
    }

    const updated = await GroupPurchase.findByPk(id, {
      include: [
        { association: 'sale' },
        { association: 'product' },
        { association: 'participants', include: [{ association: 'customer' }] }
      ]
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating group purchase:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /group-purchases/:id/cancel - Cancel group purchase
router.post('/:id/cancel', async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { id } = req.params;
    const { tenantId, reason } = req.body;

    if (!tenantId) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'TENANT_REQUIRED'
      });
    }

    const groupPurchase = await GroupPurchaseService.cancelGroupPurchase(
      id,
      reason || 'Group purchase cancelled',
      transaction
    );

    // Verify tenant matches
    if (groupPurchase.tenantId != tenantId) {
      await transaction.rollback();
      return res.status(403).json({
        error: 'Access denied',
        code: 'ACCESS_DENIED'
      });
    }

    await transaction.commit();

    const cancelled = await GroupPurchase.findByPk(id, {
      include: [
        { association: 'sale' },
        { association: 'product' },
        { association: 'participants', include: [{ association: 'customer' }] }
      ]
    });

    res.json(cancelled);
  } catch (error) {
    await transaction.rollback();
    console.error('Error cancelling group purchase:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /group-purchases/:id/participants - Get participants of a group purchase
router.get('/:id/participants', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'TENANT_REQUIRED'
      });
    }

    const groupPurchase = await GroupPurchase.findOne({
      where: { id, tenantId }
    });

    if (!groupPurchase) {
      return res.status(404).json({
        error: 'Group purchase not found',
        code: 'GROUP_PURCHASE_NOT_FOUND'
      });
    }

    const participants = await GroupPurchaseParticipant.findAll({
      where: { groupPurchaseId: id },
      include: [
        { association: 'customer' },
        { association: 'credit' },
        { association: 'payments' }
      ],
      order: [['createdAt', 'ASC']]
    });

    res.json({ participants });
  } catch (error) {
    console.error('Error getting participants:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;

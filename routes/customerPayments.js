const express = require('express');
const { CustomerPayment, GroupPurchaseParticipant, Customer } = require('../models');
const PaymentService = require('../services/PaymentService');
const { sequelize } = require('../models');
const { Op } = require('sequelize');
const { requireRole } = require('./adminAuth');

const router = express.Router();

// Todas las rutas de pagos de clientes requieren rol ADMIN
router.use(requireRole('ADMIN'));

// POST /customer-payments - Register payment
router.post('/', async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const {
      tenantId,
      customerId,
      amount,
      paymentMethod,
      paymentDate,
      groupPurchaseParticipantId,
      notes
    } = req.body;

    if (!tenantId || !customerId || !amount || !paymentMethod) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'tenantId, customerId, amount, and paymentMethod are required',
        code: 'MISSING_FIELDS'
      });
    }

    if (amount <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'amount must be greater than 0',
        code: 'INVALID_AMOUNT'
      });
    }

    const validPaymentMethods = ['CASH', 'CARD', 'TRANSFER'];
    if (!validPaymentMethods.includes(paymentMethod)) {
      await transaction.rollback();
      return res.status(400).json({
        error: `paymentMethod must be one of: ${validPaymentMethods.join(', ')}`,
        code: 'INVALID_PAYMENT_METHOD'
      });
    }

    const payment = await PaymentService.processPayment({
      tenantId,
      customerId,
      amount,
      paymentMethod,
      paymentDate,
      groupPurchaseParticipantId,
      notes
    }, transaction);

    await transaction.commit();

    res.status(201).json(payment);
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing payment:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /customer-payments - List payments
router.get('/', async (req, res) => {
  try {
    const {
      tenantId,
      customerId,
      groupPurchaseParticipantId,
      startDate,
      endDate,
      page = 1,
      limit = 50
    } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'TENANT_REQUIRED'
      });
    }

    const whereClause = { tenantId };

    if (customerId) {
      whereClause.customerId = customerId;
    }

    if (groupPurchaseParticipantId) {
      whereClause.groupPurchaseParticipantId = groupPurchaseParticipantId;
    }

    if (startDate || endDate) {
      whereClause.paymentDate = {};
      if (startDate) whereClause.paymentDate[Op.gte] = startDate;
      if (endDate) whereClause.paymentDate[Op.lte] = endDate;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows } = await CustomerPayment.findAndCountAll({
      where: whereClause,
      include: [
        { association: 'customer' },
        {
          association: 'groupPurchaseParticipant',
          include: [{ association: 'groupPurchase', include: [{ association: 'product' }] }]
        }
      ],
      limit: parseInt(limit),
      offset,
      order: [['paymentDate', 'DESC'], ['createdAt', 'DESC']]
    });

    res.json({
      payments: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error listing payments:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /customer-payments/:id - Get payment by ID
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

    const payment = await CustomerPayment.findOne({
      where: { id, tenantId },
      include: [
        { association: 'customer' },
        {
          association: 'groupPurchaseParticipant',
          include: [
            { association: 'groupPurchase', include: [{ association: 'product' }] },
            { association: 'customer' }
          ]
        }
      ]
    });

    if (!payment) {
      return res.status(404).json({
        error: 'Payment not found',
        code: 'PAYMENT_NOT_FOUND'
      });
    }

    res.json(payment);
  } catch (error) {
    console.error('Error getting payment:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /customer-payments/apply-to-credit - Apply payment to specific credit
router.post('/apply-to-credit', async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const {
      tenantId,
      customerId,
      groupPurchaseParticipantId,
      amount,
      paymentMethod,
      paymentDate,
      notes
    } = req.body;

    if (!tenantId || !customerId || !groupPurchaseParticipantId || !amount || !paymentMethod) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'tenantId, customerId, groupPurchaseParticipantId, amount, and paymentMethod are required',
        code: 'MISSING_FIELDS'
      });
    }

    // Verify participant belongs to customer
    const participant = await GroupPurchaseParticipant.findOne({
      where: {
        id: groupPurchaseParticipantId,
        customerId
      },
      include: [{ association: 'groupPurchase' }]
    });

    if (!participant) {
      await transaction.rollback();
      return res.status(404).json({
        error: 'Participant not found for this customer',
        code: 'PARTICIPANT_NOT_FOUND'
      });
    }

    // Create payment and apply to credit
    const payment = await PaymentService.processPayment({
      tenantId,
      customerId,
      amount,
      paymentMethod,
      paymentDate,
      groupPurchaseParticipantId,
      notes
    }, transaction);

    await transaction.commit();

    // Reload participant with updated data
    const updatedParticipant = await GroupPurchaseParticipant.findByPk(groupPurchaseParticipantId, {
      include: [
        { association: 'customer' },
        { association: 'credit' },
        { association: 'groupPurchase', include: [{ association: 'product' }] },
        { association: 'payments' }
      ]
    });

    res.json({
      payment,
      participant: updatedParticipant
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error applying payment to credit:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;

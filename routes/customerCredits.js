const express = require('express');
const { CustomerCredit, GroupPurchaseParticipant, Customer } = require('../models');
const CreditService = require('../services/CreditService');
const { Op } = require('sequelize');
const { requireRole } = require('./adminAuth');

const router = express.Router();

// Todas las rutas de créditos requieren rol ADMIN
router.use(requireRole('ADMIN'));

// GET /customer-credits - List credits (all or for a specific customer)
router.get('/', async (req, res) => {
  try {
    const {
      tenantId,
      customerId,
      status,
      includeOverdue,
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

    // customerId is optional - if not provided, returns all credits (admin view)
    if (customerId) {
      whereClause.customerId = customerId;
    }

    if (status) {
      whereClause.status = status;
    } else if (includeOverdue === 'true') {
      // Include overdue credits
      whereClause[Op.or] = [
        { status: 'ACTIVE' },
        { status: 'ACTIVE', dueDate: { [Op.lt]: new Date() } }
      ];
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows } = await CustomerCredit.findAndCountAll({
      where: whereClause,
      include: [
        { association: 'customer' },
        {
          association: 'groupPurchaseParticipant',
          include: [
            { association: 'groupPurchase', include: [{ association: 'product' }] }
          ]
        }
      ],
      limit: parseInt(limit),
      offset,
      order: [['dueDate', 'ASC'], ['createdAt', 'DESC']]
    });

    // Update balances with interest for active credits
    for (const credit of rows) {
      if (credit.status === 'ACTIVE') {
        await CreditService.updateCreditBalance(credit.id);
        await credit.reload({ include: credit.constructor.associations });
      }
    }

    res.json({
      credits: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error listing credits:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /customer-credits/:id - Get credit by ID
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

    const credit = await CustomerCredit.findOne({
      where: { id, tenantId },
      include: [
        { association: 'customer', attributes: ['id', 'name', 'email'] },
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
      return res.status(404).json({
        error: 'Credit not found',
        code: 'CREDIT_NOT_FOUND'
      });
    }

    // Update balance with interest if active
    if (credit.status === 'ACTIVE') {
      await CreditService.updateCreditBalance(credit.id);
      await credit.reload();
    }

    res.json(credit);
  } catch (error) {
    console.error('Error getting credit:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /customer-credits/:id/calculate-interest - Calculate interest for a credit
router.post('/:id/calculate-interest', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId, asOfDate } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'TENANT_REQUIRED'
      });
    }

    const credit = await CustomerCredit.findOne({
      where: { id, tenantId }
    });

    if (!credit) {
      return res.status(404).json({
        error: 'Credit not found',
        code: 'CREDIT_NOT_FOUND'
      });
    }

    const calculationDate = asOfDate ? new Date(asOfDate) : new Date();
    const updatedCredit = await CreditService.updateCreditBalance(credit.id, calculationDate);

    res.json({
      credit: updatedCredit,
      interestCalculated: CreditService.calculateInterest(credit, calculationDate)
    });
  } catch (error) {
    console.error('Error calculating interest:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /customer-credits/summary/:customerId - Get credit summary for a customer
router.get('/summary/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { tenantId, includeInterest = 'true' } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'TENANT_REQUIRED'
      });
    }

    const summary = await CreditService.getCustomerCreditSummary(
      tenantId,
      customerId,
      includeInterest === 'true'
    );

    res.json(summary);
  } catch (error) {
    console.error('Error getting credit summary:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;

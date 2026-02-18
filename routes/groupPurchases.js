const express = require('express');
const { GroupPurchase, GroupPurchaseParticipant, Sale, Product, Customer } = require('../models');
const GroupPurchaseService = require('../services/GroupPurchaseService');
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

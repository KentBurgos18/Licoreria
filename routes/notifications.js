const express = require('express');
const { Notification, PushSubscription } = require('../models');

const router = express.Router();

// POST /api/notifications/push-subscribe - Registrar suscripción Web Push del usuario actual
router.post('/push-subscribe', async (req, res) => {
  try {
    const { userId, tenantId } = req;
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
      return res.status(400).json({
        error: 'subscription con endpoint y keys (p256dh, auth) son requeridos',
        code: 'INVALID_SUBSCRIPTION'
      });
    }
    const userAgent = req.headers['user-agent'] || null;
    const [sub, created] = await PushSubscription.findOrCreate({
      where: { userId, endpoint: subscription.endpoint },
      defaults: {
        userId,
        tenantId: tenantId || 1,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent
      }
    });
    if (!created) {
      await sub.update({ p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, userAgent });
    }
    res.json({ ok: true, id: sub.id });
  } catch (error) {
    console.error('Error registering push subscription:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /api/notifications - List notifications for current user (staff)
router.get('/', async (req, res) => {
  try {
    const { userId, tenantId } = req;
    const { unreadOnly } = req.query;

    const whereClause = {
      userId,
      tenantId
    };

    if (unreadOnly === 'true' || unreadOnly === true) {
      whereClause.readAt = null;
    }

    const notifications = await Notification.findAll({
      where: whereClause,
      include: [
        {
          association: 'sale',
          attributes: ['id', 'totalAmount', 'status', 'paymentMethod', 'createdAt'],
          include: [{
            association: 'customer',
            attributes: ['id', 'name', 'email']
          }]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: 50
    });

    res.json({ notifications });
  } catch (error) {
    console.error('Error listing notifications:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// PATCH /api/notifications/:id/read - Mark notification as read
router.patch('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req;

    const notification = await Notification.findOne({
      where: { id, userId }
    });

    if (!notification) {
      return res.status(404).json({
        error: 'Notification not found',
        code: 'NOT_FOUND'
      });
    }

    await notification.update({ readAt: new Date() });
    res.json({ notification });
  } catch (error) {
    console.error('Error marking notification read:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;

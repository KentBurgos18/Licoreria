'use strict';
const express = require('express');
const router  = express.Router();
const { sequelize } = require('../models');

// GET /api/audit — query audit logs with filters + pagination
router.get('/', async (req, res) => {
  try {
    const {
      userId,
      entity,
      action,
      dateFrom,
      dateTo,
      page  = 1,
      limit = 50
    } = req.query;

    const tenantId = req.tenantId || 1;
    const offset   = (Math.max(parseInt(page) || 1, 1) - 1) * Math.min(parseInt(limit) || 50, 200);
    const pageSize = Math.min(parseInt(limit) || 50, 200);

    // Build dynamic WHERE
    const conditions = ['tenant_id = :tenantId'];
    const replacements = { tenantId, offset, pageSize };

    if (userId)   { conditions.push('user_id = :userId');         replacements.userId   = parseInt(userId); }
    if (entity)   { conditions.push('entity = :entity');          replacements.entity   = entity; }
    if (action)   { conditions.push('action = :action');          replacements.action   = action.toUpperCase(); }
    if (dateFrom) { conditions.push('created_at >= :dateFrom');   replacements.dateFrom = dateFrom; }
    if (dateTo)   { conditions.push('created_at <= :dateTo');     replacements.dateTo   = dateTo + ' 23:59:59'; }

    const where = conditions.join(' AND ');

    const [[{ total }]] = await sequelize.query(
      `SELECT COUNT(*)::int AS total FROM audit_logs WHERE ${where}`,
      { replacements }
    );

    const logs = await sequelize.query(
      `SELECT id, user_id, user_name, user_email, action, entity, entity_id,
              description, metadata, ip_address, created_at
       FROM audit_logs
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT :pageSize OFFSET :offset`,
      { replacements, type: sequelize.QueryTypes.SELECT }
    );

    res.json({
      logs,
      total,
      page:       parseInt(page) || 1,
      limit:      pageSize,
      totalPages: Math.ceil(total / pageSize)
    });
  } catch (err) {
    console.error('GET /api/audit:', err);
    res.status(500).json({ error: 'Error al obtener registros de auditoría' });
  }
});

// GET /api/audit/users — distinct users who appear in audit logs (for filter dropdown)
router.get('/users', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const users = await sequelize.query(
      `SELECT DISTINCT user_id AS id, user_name AS name, user_email AS email
       FROM audit_logs
       WHERE tenant_id = :tenantId AND user_id IS NOT NULL
       ORDER BY user_name ASC`,
      { replacements: { tenantId }, type: sequelize.QueryTypes.SELECT }
    );
    res.json({ users });
  } catch (err) {
    console.error('GET /api/audit/users:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

module.exports = router;

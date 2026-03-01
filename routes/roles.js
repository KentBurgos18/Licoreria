'use strict';
const express = require('express');
const router  = express.Router();
const { sequelize } = require('../models');
const RoleModel = require('../models/Role');
const Role = RoleModel(sequelize);

const { requireRole } = require('./adminAuth');

const SECTIONS = [
  'dashboard','products','suppliers','purchases','sell',
  'sales','group-purchases','credits','customers','expenses','users','settings'
];
const LEVELS = ['none', 'read', 'full'];

function validatePermissions(perms) {
  if (typeof perms !== 'object' || Array.isArray(perms)) return false;
  for (const [k, v] of Object.entries(perms)) {
    if (!SECTIONS.includes(k)) return false;
    if (!LEVELS.includes(v))   return false;
  }
  return true;
}

// GET /api/roles — listar roles del tenant con conteo de usuarios
router.get('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const [roles] = await sequelize.query(`
      SELECT r.id, r.name, r.permissions, r.created_at,
             COUNT(u.id)::int AS user_count
      FROM roles r
      LEFT JOIN users u ON u.custom_role_id = r.id AND u.tenant_id = r.tenant_id
      WHERE r.tenant_id = :tenantId
      GROUP BY r.id
      ORDER BY r.created_at ASC
    `, { replacements: { tenantId } });
    res.json({ roles });
  } catch (err) {
    console.error('GET /api/roles:', err);
    res.status(500).json({ error: 'Error al obtener roles' });
  }
});

// POST /api/roles — crear rol
router.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const { name, permissions = {} } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
    if (!validatePermissions(permissions))
      return res.status(400).json({ error: 'Permisos inválidos' });

    const role = await Role.create({ tenantId, name: name.trim(), permissions });
    res.status(201).json({ role });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
    console.error('POST /api/roles:', err);
    res.status(500).json({ error: 'Error al crear rol' });
  }
});

// PUT /api/roles/:id — editar rol
router.put('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const { name, permissions } = req.body;
    const role = await Role.findOne({ where: { id: req.params.id, tenantId } });
    if (!role) return res.status(404).json({ error: 'Rol no encontrado' });

    if (name !== undefined && !name.trim())
      return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    if (permissions !== undefined && !validatePermissions(permissions))
      return res.status(400).json({ error: 'Permisos inválidos' });

    if (name)        role.name        = name.trim();
    if (permissions) role.permissions = permissions;
    await role.save();
    res.json({ role });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
    console.error('PUT /api/roles/:id:', err);
    res.status(500).json({ error: 'Error al actualizar rol' });
  }
});

// DELETE /api/roles/:id — eliminar (solo si no tiene usuarios asignados)
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const role = await Role.findOne({ where: { id: req.params.id, tenantId } });
    if (!role) return res.status(404).json({ error: 'Rol no encontrado' });

    const [[{ count }]] = await sequelize.query(
      'SELECT COUNT(*)::int AS count FROM users WHERE custom_role_id = :id',
      { replacements: { id: req.params.id } }
    );
    if (count > 0)
      return res.status(409).json({ error: `No se puede eliminar: ${count} usuario(s) tienen este rol` });

    await role.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/roles/:id:', err);
    res.status(500).json({ error: 'Error al eliminar rol' });
  }
});

module.exports = router;

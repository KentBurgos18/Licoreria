const express = require('express');
const bcrypt = require('bcrypt');
const { User } = require('../models');
const { Op } = require('sequelize');
const { requireRole } = require('./adminAuth');

const router = express.Router();

// Todas las rutas de usuarios requieren rol ADMIN
router.use(requireRole('ADMIN'));

// Mapear rol del formulario (USER/ADMIN) al rol en BD (CASHIER/ADMIN/MANAGER)
function roleToDb(role) {
  if (!role) return 'CASHIER';
  if (role === 'ADMIN') return 'ADMIN';
  if (role === 'MANAGER') return 'MANAGER';
  return 'CASHIER'; // USER o cualquier otro -> Empleado
}

// Formatear usuario para respuesta (sin password, lastLogin como lastAccess)
function toResponse(user) {
  const u = user.get ? user.get({ plain: true }) : user;
  const { password, lastLogin, ...rest } = u;
  return { ...rest, lastAccess: lastLogin || null };
}

// GET /users - List users (desde base de datos)
router.get('/', async (req, res) => {
  try {
    const { tenantId = 1, search, isActive, page = 1, limit = 50 } = req.query;

    const whereClause = { tenantId: Number(tenantId) };
    if (isActive !== undefined) {
      whereClause.isActive = isActive === 'true';
    }
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereClause[Op.or] = [
        { name: { [Op.iLike]: term } },
        { email: { [Op.iLike]: term } }
      ];
    }

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const { count, rows } = await User.findAndCountAll({
      where: whereClause,
      attributes: ['id', 'tenantId', 'name', 'email', 'role', 'isActive', 'lastLogin', 'createdAt'],
      limit: Math.min(parseInt(limit, 10) || 50, 100),
      offset,
      order: [['name', 'ASC']]
    });

    const users = rows.map(u => toResponse(u));

    res.json({
      users,
      pagination: {
        total: count,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(count / (parseInt(limit, 10) || 50))
      }
    });
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /users/:id - Get user by ID (desde base de datos)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId = 1 } = req.query;

    const user = await User.findOne({
      where: { id: Number(id), tenantId: Number(tenantId) },
      attributes: ['id', 'tenantId', 'name', 'email', 'role', 'isActive', 'lastLogin', 'createdAt']
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    res.json(toResponse(user));
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /users - Create user (en base de datos; así puede iniciar sesión y usar "Olvidé contraseña")
router.post('/', async (req, res) => {
  try {
    const { tenantId = 1, name, email, password, role = 'USER', isActive = true } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        error: 'Name, email and password are required',
        code: 'MISSING_FIELDS'
      });
    }

    const emailTrimmed = String(email).trim().toLowerCase();
    const existingUser = await User.findOne({
      where: { email: emailTrimmed, tenantId: Number(tenantId) }
    });

    if (existingUser) {
      return res.status(400).json({
        error: 'Email already registered',
        code: 'EMAIL_EXISTS'
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const dbRole = roleToDb(role);

    const newUser = await User.create({
      tenantId: Number(tenantId),
      name: String(name).trim(),
      email: emailTrimmed,
      password: passwordHash,
      role: dbRole,
      isActive: isActive !== false
    });

    res.status(201).json(toResponse(newUser));
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// PUT /users/:id - Update user (en base de datos)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId = 1, name, email, password, role, isActive } = req.body;

    const user = await User.findOne({
      where: { id: Number(id), tenantId: Number(tenantId) }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    if (email && String(email).trim().toLowerCase() !== user.email) {
      const existingUser = await User.findOne({
        where: {
          email: String(email).trim().toLowerCase(),
          tenantId: Number(tenantId)
        }
      });
      if (existingUser) {
        return res.status(400).json({
          error: 'Email already registered',
          code: 'EMAIL_EXISTS'
        });
      }
    }

    const updates = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (email !== undefined) updates.email = String(email).trim().toLowerCase();
    if (role !== undefined) updates.role = roleToDb(role);
    if (isActive !== undefined) updates.isActive = isActive !== false;
    if (password && String(password).length > 0) {
      updates.password = await bcrypt.hash(password, 10);
    }

    await user.update(updates);

    res.json(toResponse(user));
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// DELETE /users/:id - Delete user (en base de datos)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId = 1 } = req.query;

    const user = await User.findOne({
      where: { id: Number(id), tenantId: Number(tenantId) }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // No permitir eliminar el primer admin (id 1) si es ADMIN
    if (user.role === 'ADMIN' && user.id === 1) {
      return res.status(400).json({
        error: 'Cannot delete admin user',
        code: 'CANNOT_DELETE_ADMIN'
      });
    }

    await user.destroy();

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;

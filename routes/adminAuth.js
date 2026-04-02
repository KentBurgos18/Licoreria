const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User, sequelize } = require('../models');
const RoleModel = require('../models/Role');
const Role = RoleModel(sequelize);
const AuditService = require('../services/AuditService');

async function fetchPermissions(user) {
  if (user.role === 'ADMIN') return null;
  if (!user.customRoleId) return {};
  const role = await Role.findByPk(user.customRoleId);
  return role ? role.permissions : {};
}

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('⛔ FATAL: JWT_SECRET no está definido en las variables de entorno');
  process.exit(1);
}

// POST /admin/auth/login - Login administrador/empleado
router.post('/login', async (req, res) => {
  try {
    const { email, password, tenantId = 1 } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email y contraseña son requeridos',
        code: 'MISSING_FIELDS'
      });
    }

    // Buscar usuario
    const user = await User.findOne({
      where: { email, tenantId, isActive: true }
    });

    if (!user) {
      return res.status(401).json({
        error: 'Credenciales inválidas',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Verificar contraseña
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Credenciales inválidas',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Actualizar último login
    await user.update({ lastLogin: new Date() });

    // Obtener permisos del rol personalizado
    const permissions = await fetchPermissions(user);

    // Generar JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        role: user.role,
        type: 'admin' // Indica que es un usuario admin/empleado
      },
      JWT_SECRET,
      { expiresIn: '7d' } // Token válido por 7 días
    );

    // Log de auditoría: login exitoso
    AuditService.log({
      tenantId: user.tenantId, userId: user.id,
      userName: user.name, userEmail: user.email,
      action: 'LOGIN', entity: 'login', entityId: String(user.id),
      description: `Inició sesión`,
      metadata: { role: user.role },
      ip: req.ip
    });

    res.json({
      message: 'Login exitoso',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        customRoleId: user.customRoleId || null,
        permissions
      },
      token
    });
  } catch (error) {
    console.error('Error en login de admin:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /admin/auth/me - Obtener info del usuario actual
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        error: 'Token no proporcionado',
        code: 'NO_TOKEN'
      });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Verificar que sea un token de admin
      if (decoded.type !== 'admin') {
        return res.status(403).json({
          error: 'Acceso denegado. Se requiere cuenta de administrador.',
          code: 'ACCESS_DENIED'
        });
      }

      const user = await User.findByPk(decoded.userId, {
        attributes: ['id', 'name', 'email', 'role', 'customRoleId', 'lastLogin', 'dashboardConfig']
      });

      if (!user) {
        return res.status(404).json({
          error: 'Usuario no encontrado',
          code: 'USER_NOT_FOUND'
        });
      }

      const permissions = await fetchPermissions(user);

      res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          customRoleId: user.customRoleId || null,
          lastLogin: user.lastLogin,
          permissions,
          dashboardConfig: user.dashboardConfig || {}
        }
      });
    } catch (jwtError) {
      return res.status(401).json({
        error: 'Token inválido o expirado',
        code: 'INVALID_TOKEN'
      });
    }
  } catch (error) {
    console.error('Error obteniendo info del usuario:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /admin/auth/refresh — renovar token silenciosamente (sin re-login)
router.post('/refresh', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Token no proporcionado', code: 'NO_TOKEN' });

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Token inválido o expirado', code: 'INVALID_TOKEN' });
    }

    if (decoded.type !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado', code: 'ACCESS_DENIED' });
    }

    // Verificar que el usuario sigue activo en la BD
    const user = await User.findOne({ where: { id: decoded.userId, tenantId: decoded.tenantId } });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Usuario inactivo o no encontrado', code: 'USER_INACTIVE' });
    }

    // Emitir token nuevo con otros 8 horas
    const newToken = jwt.sign(
      { userId: user.id, tenantId: user.tenantId, email: user.email, name: user.name, role: user.role, type: 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token: newToken });
  } catch (error) {
    console.error('Error renovando token:', error);
    res.status(500).json({ error: 'Error interno del servidor', code: 'INTERNAL_ERROR' });
  }
});

// POST /admin/auth/change-password - Cambiar contraseña
router.post('/change-password', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const { currentPassword, newPassword } = req.body;

    if (!token) {
      return res.status(401).json({
        error: 'Token no proporcionado',
        code: 'NO_TOKEN'
      });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Contraseña actual y nueva son requeridas',
        code: 'MISSING_FIELDS'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        error: 'La nueva contraseña debe tener al menos 6 caracteres',
        code: 'WEAK_PASSWORD'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findByPk(decoded.userId);

    if (!user) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
        code: 'USER_NOT_FOUND'
      });
    }

    // Verificar contraseña actual
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Contraseña actual incorrecta',
        code: 'INVALID_PASSWORD'
      });
    }

    // Hash nueva contraseña
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await user.update({ password: passwordHash });

    res.json({ message: 'Contraseña actualizada exitosamente' });
  } catch (error) {
    console.error('Error cambiando contraseña:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

// PUT /admin/auth/dashboard-config - Guardar configuración del dashboard
router.put('/dashboard-config', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Token no proporcionado' });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
    const { config } = req.body;
    if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Config inválida' });
    await User.update({ dashboardConfig: config }, { where: { id: decoded.userId } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error guardando dashboard config:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Middleware para verificar token de admin
const authenticateAdmin = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || 
                req.body.token || 
                req.query.token;

  if (!token) {
    return res.status(401).json({
      error: 'Autenticación requerida',
      code: 'NO_TOKEN'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verificar que sea token de admin
    if (decoded.type !== 'admin') {
      return res.status(403).json({
        error: 'Acceso denegado',
        code: 'ACCESS_DENIED'
      });
    }
    
    req.userId    = decoded.userId;
    req.tenantId  = decoded.tenantId;
    req.userRole  = decoded.role;
    req.userEmail = decoded.email;
    req.userName  = decoded.name || decoded.email;
    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Token inválido o expirado',
      code: 'INVALID_TOKEN'
    });
  }
};

// Middleware para verificar rol específico
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({
        error: 'No tienes permisos para esta acción',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }
    next();
  };
};

// Cache de permisos por customRoleId (TTL 5 min)
const _rolePermCache = new Map();
const ROLE_PERM_CACHE_TTL = 5 * 60 * 1000;
const LEVEL_ORDER = { none: 0, read: 1, full: 2 };

// Middleware granular: verifica permiso de sección (para roles personalizados)
// ADMIN siempre pasa. Otros usuarios necesitan permissions[section] >= requiredLevel.
const checkPermission = (section, requiredLevel = 'full') => {
  return async (req, res, next) => {
    try {
      if (req.userRole === 'ADMIN') return next();
      const { User } = require('../models');
      const user = await User.findByPk(req.userId, { attributes: ['customRoleId'] });
      if (!user || !user.customRoleId) {
        return res.status(403).json({ error: 'No tienes permisos para esta acción', code: 'INSUFFICIENT_PERMISSIONS' });
      }
      const roleId = user.customRoleId;
      const cached = _rolePermCache.get(roleId);
      let permissions;
      if (cached && (Date.now() - cached.cachedAt) < ROLE_PERM_CACHE_TTL) {
        permissions = cached.permissions;
      } else {
        const role = await Role.findByPk(roleId);
        permissions = role ? (role.permissions || {}) : {};
        _rolePermCache.set(roleId, { permissions, cachedAt: Date.now() });
      }
      const userLevel = permissions[section] || 'none';
      if ((LEVEL_ORDER[userLevel] || 0) >= (LEVEL_ORDER[requiredLevel] || 0)) {
        return next();
      }
      return res.status(403).json({ error: 'No tienes permisos para esta acción', code: 'INSUFFICIENT_PERMISSIONS' });
    } catch (err) {
      return res.status(403).json({ error: 'Error verificando permisos', code: 'PERMISSION_ERROR' });
    }
  };
};

// Invalida cache cuando se modifica un rol
const invalidateRolePermCache = (roleId) => _rolePermCache.delete(roleId);

module.exports = { router, authenticateAdmin, requireRole, checkPermission, invalidateRolePermCache };

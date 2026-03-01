const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User, sequelize } = require('../models');
const RoleModel = require('../models/Role');
const Role = RoleModel(sequelize);

async function fetchPermissions(user) {
  if (user.role === 'ADMIN') return null;
  if (!user.customRoleId) return {};
  const role = await Role.findByPk(user.customRoleId);
  return role ? role.permissions : {};
}

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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
        role: user.role,
        type: 'admin' // Indica que es un usuario admin/empleado
      },
      JWT_SECRET,
      { expiresIn: '8h' } // Token válido por 8 horas (jornada laboral)
    );

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
        attributes: ['id', 'name', 'email', 'role', 'customRoleId', 'lastLogin']
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
          permissions
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
    
    req.userId = decoded.userId;
    req.tenantId = decoded.tenantId;
    req.userRole = decoded.role;
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

module.exports = { router, authenticateAdmin, requireRole };

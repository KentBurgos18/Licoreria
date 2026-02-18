const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const { Customer, User } = require('../models');
const { Op } = require('sequelize');
const EmailService = require('../services/EmailService');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Almacenamiento temporal para códigos y claves temporales de recuperación de contraseña
// Estructura: { [email]: { code, codeExpires, tempPassword, tempPasswordExpires, attempts } }
const passwordResetStore = {};

// Almacenamiento temporal para códigos de verificación de registro
// Estructura: { [email]: { code, codeExpires, customerId } }
const registrationVerificationStore = {};

// Limpiar entradas expiradas cada 5 minutos
setInterval(() => {
  const now = Date.now();
  Object.keys(passwordResetStore).forEach(email => {
    const entry = passwordResetStore[email];
    if (entry.codeExpires && entry.codeExpires < now) {
      delete entry.code;
      delete entry.codeExpires;
    }
    if (entry.tempPasswordExpires && entry.tempPasswordExpires < now) {
      delete entry.tempPassword;
      delete entry.tempPasswordExpires;
    }
    // Eliminar entrada si no tiene datos activos
    if (!entry.code && !entry.tempPassword) {
      delete passwordResetStore[email];
    }
  });
  
  // Limpiar códigos de verificación de registro expirados
  Object.keys(registrationVerificationStore).forEach(email => {
    const entry = registrationVerificationStore[email];
    if (entry.codeExpires && entry.codeExpires < now) {
      delete registrationVerificationStore[email];
    }
  });
}, 5 * 60 * 1000); // Cada 5 minutos

// GET /auth/debug-emails - Ruta temporal para verificar correos en la base de datos
router.get('/debug-emails', async (req, res) => {
  try {
    const { searchEmail = 'rogerburgos208@gmail.com' } = req.query;
    const searchEmailTrimmed = searchEmail.trim();
    
    const result = {
      searchEmail,
      searchEmailTrimmed,
      customers: [],
      users: [],
      foundInCustomers: false,
      foundInUsers: false,
      details: {}
    };
    
    // Buscar todos los clientes
    const customers = await Customer.unscoped().findAll({
      attributes: ['id', 'name', 'email', 'cedula', 'isActive', 'tenantId'],
      order: [['email', 'ASC']]
    });
    
    result.customers = customers.map(c => ({
      id: c.id,
      name: c.name,
      email: c.email || '(sin correo)',
      emailLength: c.email ? c.email.length : 0,
      hasSpaces: c.email ? c.email !== c.email.trim() : false,
      emailTrimmed: c.email ? c.email.trim() : null,
      cedula: c.cedula,
      isActive: c.isActive,
      tenantId: c.tenantId,
      exactMatch: c.email === searchEmailTrimmed,
      trimmedMatch: c.email && c.email.trim() === searchEmailTrimmed,
      caseInsensitiveMatch: c.email && c.email.toLowerCase() === searchEmailTrimmed.toLowerCase()
    }));
    
    // Buscar todos los usuarios
    const users = await User.findAll({
      attributes: ['id', 'name', 'email', 'role', 'isActive', 'tenantId'],
      order: [['email', 'ASC']]
    });
    
    result.users = users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email || '(sin correo)',
      emailLength: u.email ? u.email.length : 0,
      hasSpaces: u.email ? u.email !== u.email.trim() : false,
      emailTrimmed: u.email ? u.email.trim() : null,
      role: u.role,
      isActive: u.isActive,
      tenantId: u.tenantId,
      exactMatch: u.email === searchEmailTrimmed,
      trimmedMatch: u.email && u.email.trim() === searchEmailTrimmed,
      caseInsensitiveMatch: u.email && u.email.toLowerCase() === searchEmailTrimmed.toLowerCase()
    }));
    
    // Buscar específicamente el correo
    const customerExact = await Customer.unscoped().findOne({
      where: { email: searchEmailTrimmed, tenantId: 1, isActive: true }
    });
    
    const customerCaseInsensitive = await Customer.unscoped().findOne({
      where: { 
        email: { [Op.iLike]: searchEmailTrimmed },
        tenantId: 1,
        isActive: true
      }
    });
    
    const userExact = await User.findOne({
      where: { email: searchEmailTrimmed, tenantId: 1, isActive: true }
    });
    
    result.foundInCustomers = !!(customerExact || customerCaseInsensitive);
    result.foundInUsers = !!userExact;
    
    result.details = {
      customerExact: customerExact ? {
        id: customerExact.id,
        name: customerExact.name,
        email: customerExact.email
      } : null,
      customerCaseInsensitive: customerCaseInsensitive ? {
        id: customerCaseInsensitive.id,
        name: customerCaseInsensitive.name,
        email: customerCaseInsensitive.email
      } : null,
      userExact: userExact ? {
        id: userExact.id,
        name: userExact.name,
        email: userExact.email
      } : null
    };
    
    res.json(result);
  } catch (error) {
    console.error('Error in debug-emails:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// GET /auth/check-email - Verificar si un email ya existe
router.get('/check-email', async (req, res) => {
  try {
    const { email, tenantId = 1 } = req.query;

    if (!email) {
      return res.status(400).json({
        error: 'Email es requerido',
        code: 'MISSING_EMAIL'
      });
    }

    // Verificar en ambas tablas (igual que en login y register)
    // PASO 1: Buscar primero en usuarios (administradores/empleados)
    const existingUser = await User.findOne({
      where: { email: email.trim(), tenantId, isActive: true }
    });

    if (existingUser) {
      return res.json({
        exists: true,
        message: 'Este correo electrónico ya está registrado en el sistema',
        type: 'user'
      });
    }

    // PASO 2: Buscar en clientes (con trim y unscoped)
    const existingCustomer = await Customer.unscoped().findOne({
      where: { email: email.trim(), tenantId, isActive: true }
    });

    if (existingCustomer) {
      return res.json({
        exists: true,
        message: 'Este correo electrónico ya está registrado en el sistema',
        type: 'customer'
      });
    }

    // Email disponible
    return res.json({
      exists: false,
      message: 'Este correo electrónico está disponible'
    });
  } catch (error) {
    console.error('Error checking email:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /auth/register - Register new customer
router.post('/register', async (req, res) => {
  try {
    const { tenantId = 1, name, cedula, email, phone, address, latitude, longitude, password } = req.body;

    // Validate required fields
    if (!name || !email || !password || !cedula) {
      return res.status(400).json({
        error: 'Name, cédula, email and password are required',
        code: 'MISSING_FIELDS'
      });
    }

    // Validate cédula format (alphanumeric, no spaces)
    const cedulaRegex = /^[A-Za-z0-9-]+$/;
    if (!cedulaRegex.test(cedula.trim())) {
      return res.status(400).json({
        error: 'Cédula must contain only letters, numbers and hyphens',
        code: 'INVALID_CEDULA_FORMAT'
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters',
        code: 'WEAK_PASSWORD'
      });
    }

    // Check if cédula already exists
    const existingCedula = await Customer.findOne({
      where: { cedula: cedula.trim(), tenantId }
    });

    if (existingCedula) {
      return res.status(400).json({
        error: 'Esta cédula ya está registrada',
        code: 'CEDULA_EXISTS'
      });
    }

    // Check if email already exists (verificar en Customer y User, igual que en login)
    // PASO 1: Buscar primero en usuarios (administradores/empleados)
    const existingUser = await User.findOne({
      where: { email: email.trim(), tenantId, isActive: true }
    });

    if (existingUser) {
      return res.status(400).json({
        error: 'Este correo electrónico ya está registrado en el sistema',
        code: 'EMAIL_EXISTS'
      });
    }

    // PASO 2: Buscar en clientes (con trim y unscoped para evitar problemas con scopes)
    const existingCustomer = await Customer.unscoped().findOne({
      where: { email: email.trim(), tenantId, isActive: true }
    });

    if (existingCustomer) {
      return res.status(400).json({
        error: 'Este correo electrónico ya está registrado en el sistema',
        code: 'EMAIL_EXISTS'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Build address string with coordinates if provided
    let fullAddress = address || '';
    if (latitude && longitude) {
      fullAddress += fullAddress ? ` | Coordenadas: ${latitude}, ${longitude}` : `Coordenadas: ${latitude}, ${longitude}`;
    }

    // Create customer
    const customer = await Customer.create({
      tenantId,
      name,
      cedula: cedula.trim(),
      email: email.trim(), // Guardar email con trim para consistencia
      phone,
      address: fullAddress || null,
      password: passwordHash,
      isActive: true
    });

    // Generate verification code (6 digits)
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const codeExpires = Date.now() + (15 * 60 * 1000); // 15 minutos

    // Guardar código de verificación en almacenamiento temporal
    registrationVerificationStore[email.trim()] = {
      code: verificationCode,
      codeExpires,
      customerId: customer.id
    };

    // Send verification code via email (async, don't wait)
    EmailService.initialize(tenantId).then(() => {
      EmailService.sendVerificationCode(email, verificationCode, tenantId).catch(err => {
        console.warn('Could not send verification code email:', err.message);
      });
    }).catch(err => {
      console.warn('Email service not configured:', err.message);
    });

    // NO generar token todavía - esperar verificación del código
    // El token se generará después de verificar el código

    res.status(201).json({
      message: 'Registro exitoso. Por favor verifica tu correo electrónico e ingresa el código de verificación.',
      requiresVerification: true,
      customer: {
        id: customer.id,
        name: customer.name,
        cedula: customer.cedula,
        email: customer.email,
        phone: customer.phone
      },
      // NO enviar token todavía
      verificationCode // Solo para desarrollo - remover en producción
    });
  } catch (error) {
    console.error('Error registering customer:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /auth/login - Login unificado (Admin/Empleado o Cliente)
router.post('/login', async (req, res) => {
  try {
    const { email, password, tenantId = 1 } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email y contraseña son requeridos',
        code: 'MISSING_FIELDS'
      });
    }

    // Normalizar email con trim para búsqueda consistente
    const emailNormalized = email.trim();
    
    // PASO 1: Buscar primero en usuarios (administradores/empleados)
    const user = await User.findOne({
      where: { email: emailNormalized, tenantId, isActive: true }
    });

    if (user) {
      // Verificar contraseña del admin
      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        return res.status(401).json({
          error: 'Credenciales inválidas',
          code: 'INVALID_CREDENTIALS'
        });
      }

      // Actualizar último login
      await user.update({ lastLogin: new Date() });

      // Generar JWT token para admin
      const token = jwt.sign(
        { 
          userId: user.id, 
          tenantId: user.tenantId,
          email: user.email,
          role: user.role,
          type: 'admin'
        },
        JWT_SECRET,
        { expiresIn: '8h' }
      );

      return res.json({
        message: 'Login exitoso',
        userType: 'admin',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        },
        token,
        redirectTo: '/dashboard'
      });
    }

    // PASO 2: Si no es admin, buscar en clientes (usar unscoped para evitar problemas con scopes)
    const customer = await Customer.unscoped().findOne({
      where: { email: emailNormalized, tenantId, isActive: true }
    });

    if (!customer) {
      return res.status(401).json({
        error: 'Credenciales inválidas',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Verificar que el cliente tenga contraseña
    if (!customer.password) {
      return res.status(401).json({
        error: 'Cuenta no configurada. Por favor regístrate primero.',
        code: 'NO_PASSWORD'
      });
    }

    // Verificar contraseña del cliente
    const isValidPassword = await bcrypt.compare(password, customer.password);

    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Credenciales inválidas',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Generar JWT token para cliente
    const token = jwt.sign(
      { 
        customerId: customer.id, 
        tenantId: customer.tenantId,
        email: customer.email,
        type: 'customer'
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      message: 'Login exitoso',
      userType: 'customer',
      user: {
        id: customer.id,
        name: customer.name,
        cedula: customer.cedula,
        email: customer.email,
        phone: customer.phone
      },
      token,
      redirectTo: '/customer/catalog'
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /auth/me - Get current customer info
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        error: 'No token provided',
        code: 'NO_TOKEN'
      });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const customer = await Customer.findByPk(decoded.customerId, {
        attributes: ['id', 'name', 'email', 'phone', 'address']
      });

      if (!customer) {
        return res.status(404).json({
          error: 'Customer not found',
          code: 'CUSTOMER_NOT_FOUND'
        });
      }

      res.json({ customer });
    } catch (jwtError) {
      return res.status(401).json({
        error: 'Invalid or expired token',
        code: 'INVALID_TOKEN'
      });
    }
  } catch (error) {
    console.error('Error getting customer info:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Middleware to verify JWT token
const authenticateCustomer = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || 
                req.body.token || 
                req.query.token;

  if (!token) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'NO_TOKEN'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.customerId = decoded.customerId;
    req.tenantId = decoded.tenantId;
    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN'
    });
  }
};

// ============================================
// OAuth Routes
// ============================================

// Helper function to handle OAuth callback
const handleOAuthCallback = (req, res) => {
  if (req.user && req.user.token) {
    // Redirect to frontend with token
    const redirectUrl = `/customer/oauth-callback?token=${req.user.token}&name=${encodeURIComponent(req.user.customer.name || '')}&email=${encodeURIComponent(req.user.customer.email || '')}`;
    res.redirect(redirectUrl);
  } else {
    res.redirect('/customer/login?error=oauth_failed');
  }
};

// Google OAuth
router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(501).json({ error: 'Google OAuth not configured' });
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/customer/login?error=google_auth_failed' }),
  handleOAuthCallback
);

// Get OAuth providers status (which are configured)
router.get('/oauth/providers', (req, res) => {
  res.json({
    google: !!process.env.GOOGLE_CLIENT_ID
  });
});

// POST /auth/forgot-password - Solicitar código de recuperación
router.post('/forgot-password', async (req, res) => {
  try {
    const { email, tenantId = 1 } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email es requerido',
        code: 'MISSING_EMAIL'
      });
    }

    // Buscar usuario en User o Customer (EXACTA lógica que login)
    // Normalizar email con trim para búsqueda consistente
    const emailNormalized = email.trim();
    
    // PASO 1: Buscar primero en usuarios (aplicar trim para consistencia)
    const user = await User.findOne({
      where: { email: emailNormalized, tenantId, isActive: true }
    });

    // PASO 2: Si no es admin, buscar en clientes (con trim y unscoped)
    const customer = !user ? await Customer.unscoped().findOne({
      where: { email: emailNormalized, tenantId, isActive: true }
    }) : null;
    
    // Debug: Log para verificar búsqueda
    console.log('Password reset search:', { 
      inputEmail: email,
      emailNormalized: emailNormalized,
      tenantId,
      foundUser: !!user, 
      foundCustomer: !!customer,
      userEmail: user?.email,
      customerEmail: customer?.email,
      userActive: user?.isActive,
      customerActive: customer?.isActive
    });

    // Si no existe ninguno, retornar error
    if (!user && !customer) {
      console.log('Password reset - Email not found:', {
        inputEmail: email,
        emailNormalized: emailNormalized,
        tenantId: tenantId,
        userTable: 'checked',
        customerTable: 'checked (unscoped)'
      });
      return res.status(404).json({
        error: 'No se encontró una cuenta con este correo electrónico',
        code: 'EMAIL_NOT_FOUND'
      });
    }

    // Rate limiting: máximo 3 intentos cada 15 minutos
    // Usar email normalizado como clave para consistencia
    const storeEntry = passwordResetStore[emailNormalized] || {};
    if (storeEntry.attempts && storeEntry.attempts >= 3) {
      const timeSinceLastAttempt = Date.now() - (storeEntry.lastAttempt || 0);
      if (timeSinceLastAttempt < 15 * 60 * 1000) {
        return res.status(429).json({
          error: 'Demasiados intentos. Por favor espera 15 minutos antes de intentar nuevamente.',
          code: 'RATE_LIMIT_EXCEEDED'
        });
      }
      // Resetear intentos si pasaron 15 minutos
      storeEntry.attempts = 0;
    }

    // Generar código de verificación de 6 dígitos
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeExpires = Date.now() + (15 * 60 * 1000); // 15 minutos

    // Guardar código en almacenamiento temporal (usar email normalizado)
    passwordResetStore[emailNormalized] = {
      ...storeEntry,
      code,
      codeExpires,
      attempts: (storeEntry.attempts || 0) + 1,
      lastAttempt: Date.now(),
      originalEmail: emailNormalized // Guardar email normalizado
    };

    // Enviar código por email (usar email normalizado)
    try {
      await EmailService.initialize(tenantId);
      await EmailService.sendPasswordResetCode(emailNormalized, code, tenantId);
    } catch (emailError) {
      console.error('Error sending password reset code:', emailError);
      // No fallar la petición si el email falla (por seguridad)
    }

    res.json({
      success: true,
      message: 'Si el email existe, recibirás un código de verificación'
    });
  } catch (error) {
    console.error('Error in forgot-password:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /auth/verify-reset-code - Validar código y enviar clave temporal
router.post('/verify-reset-code', async (req, res) => {
  try {
    const { email, code, tenantId = 1 } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        error: 'Email y código son requeridos',
        code: 'MISSING_FIELDS'
      });
    }

    // Normalizar email con trim para consistencia
    const emailNormalized = email.trim();

    // Buscar en store usando email normalizado
    const storeEntry = passwordResetStore[emailNormalized];

    if (!storeEntry || !storeEntry.code) {
      return res.status(400).json({
        error: 'Código inválido o expirado',
        code: 'INVALID_CODE'
      });
    }

    // Verificar expiración
    if (storeEntry.codeExpires < Date.now()) {
      delete passwordResetStore[emailNormalized].code;
      delete passwordResetStore[emailNormalized].codeExpires;
      return res.status(400).json({
        error: 'Código expirado. Por favor solicita uno nuevo.',
        code: 'CODE_EXPIRED'
      });
    }

    // Verificar código
    if (storeEntry.code !== code) {
      return res.status(400).json({
        error: 'Código incorrecto',
        code: 'INVALID_CODE'
      });
    }

    // Generar clave temporal (8-10 caracteres alfanuméricos)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let tempPassword = '';
    for (let i = 0; i < 10; i++) {
      tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const tempPasswordExpires = Date.now() + (5 * 60 * 1000); // 5 minutos
    
    // Guardar clave temporal (usar email normalizado como clave)
    passwordResetStore[emailNormalized] = {
      ...storeEntry,
      tempPassword,
      tempPasswordExpires,
      codeVerified: true,
      originalEmail: emailNormalized // Mantener email normalizado
    };
    try {
      await EmailService.initialize(tenantId);
      await EmailService.sendTemporaryPassword(emailNormalized, tempPassword, tenantId);
    } catch (emailError) {
      console.error('Error sending temporary password:', emailError);
      return res.status(500).json({
        error: 'Error al enviar clave temporal. Por favor intenta nuevamente.',
        code: 'EMAIL_ERROR'
      });
    }

    res.json({
      success: true,
      message: 'Clave temporal enviada a tu correo electrónico'
    });
  } catch (error) {
    console.error('Error in verify-reset-code:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /auth/verify-registration-code - Verificar código de registro
router.post('/verify-registration-code', async (req, res) => {
  try {
    const { email, code, tenantId = 1 } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        error: 'Email y código son requeridos',
        code: 'MISSING_FIELDS'
      });
    }

    // Normalizar email con trim
    const emailNormalized = email.trim();

    // Buscar código en almacenamiento
    const storeEntry = registrationVerificationStore[emailNormalized];

    if (!storeEntry || !storeEntry.code) {
      return res.status(400).json({
        error: 'Código inválido o expirado',
        code: 'INVALID_CODE'
      });
    }

    // Verificar expiración
    if (storeEntry.codeExpires < Date.now()) {
      delete registrationVerificationStore[emailNormalized];
      return res.status(400).json({
        error: 'Código expirado. Por favor solicita uno nuevo.',
        code: 'CODE_EXPIRED'
      });
    }

    // Verificar código
    if (storeEntry.code !== code) {
      return res.status(400).json({
        error: 'Código incorrecto',
        code: 'INVALID_CODE'
      });
    }

    // Código verificado correctamente - obtener cliente
    const customer = await Customer.unscoped().findByPk(storeEntry.customerId);

    if (!customer) {
      return res.status(404).json({
        error: 'Cliente no encontrado',
        code: 'CUSTOMER_NOT_FOUND'
      });
    }

    // Generar JWT token ahora que el código está verificado
    const token = jwt.sign(
      { 
        customerId: customer.id, 
        tenantId: customer.tenantId,
        email: customer.email 
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Limpiar código de verificación
    delete registrationVerificationStore[emailNormalized];

    res.json({
      success: true,
      message: 'Código verificado exitosamente',
      customer: {
        id: customer.id,
        name: customer.name,
        cedula: customer.cedula,
        email: customer.email,
        phone: customer.phone
      },
      token
    });
  } catch (error) {
    console.error('Error in verify-registration-code:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /auth/reset-password - Cambiar contraseña con clave temporal
router.post('/reset-password', async (req, res) => {
  try {
    const { email, tempPassword, newPassword, confirmPassword, tenantId = 1 } = req.body;

    if (!email || !tempPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        error: 'Todos los campos son requeridos',
        code: 'MISSING_FIELDS'
      });
    }

    // Validar que las contraseñas coincidan
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: 'Las contraseñas no coinciden',
        code: 'PASSWORD_MISMATCH'
      });
    }

    // Validar longitud mínima
    if (newPassword.length < 6) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 6 caracteres',
        code: 'WEAK_PASSWORD'
      });
    }

    // Normalizar email con trim para consistencia
    const emailNormalized = email.trim();

    // Buscar en store usando email normalizado
    const storeEntry = passwordResetStore[emailNormalized];

    if (!storeEntry || !storeEntry.tempPassword) {
      return res.status(400).json({
        error: 'Clave temporal inválida o expirada',
        code: 'INVALID_TEMP_PASSWORD'
      });
    }

    // Verificar expiración
    if (storeEntry.tempPasswordExpires < Date.now()) {
      delete passwordResetStore[emailNormalized].tempPassword;
      delete passwordResetStore[emailNormalized].tempPasswordExpires;
      return res.status(400).json({
        error: 'Clave temporal expirada. Por favor solicita un nuevo código.',
        code: 'TEMP_PASSWORD_EXPIRED'
      });
    }

    // Verificar clave temporal
    if (storeEntry.tempPassword !== tempPassword) {
      return res.status(400).json({
        error: 'Clave temporal incorrecta',
        code: 'INVALID_TEMP_PASSWORD'
      });
    }

    // Buscar usuario (User o Customer) - EXACTA lógica que login
    // PASO 1: Buscar primero en usuarios (con email normalizado)
    const user = await User.findOne({
      where: { email: emailNormalized, tenantId, isActive: true }
    });

    // PASO 2: Si no es admin, buscar en clientes (con email normalizado y unscoped)
    const customer = !user ? await Customer.unscoped().findOne({
      where: { email: emailNormalized, tenantId, isActive: true }
    }) : null;

    if (!user && !customer) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
        code: 'USER_NOT_FOUND'
      });
    }

    // Hashear nueva contraseña
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Actualizar contraseña
    if (user) {
      await user.update({ password: passwordHash });
    } else {
      await customer.update({ password: passwordHash });
    }

    // Limpiar datos temporales (usar email normalizado)
    delete passwordResetStore[emailNormalized];

    res.json({
      success: true,
      message: 'Contraseña actualizada exitosamente'
    });
  } catch (error) {
    console.error('Error in reset-password:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = { router, authenticateCustomer };

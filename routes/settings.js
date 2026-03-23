const express = require('express');
const { Setting } = require('../models');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { requireRole } = require('./adminAuth');
const { processBrandImage, regeneratePwaIcons } = require('../services/ImageProcessor');

// Mapeo tipo → nombre de archivo en /public/img/
const BRAND_IMG_MAP = {
  logo:    'icono-LB.png',
  favicon: 'pestana-LB.png'
};
const PUBLIC_IMG_DIR = path.join(__dirname, '..', 'public', 'img');

const uploadBrandImg = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename:    (req, file, cb) => cb(null, 'brand-' + Date.now() + path.extname(file.originalname))
  }),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Solo se permiten imágenes'));
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

const router = express.Router();

// GET (lectura) permitido para todos los autenticados (empleado necesita leer IVA, etc.)
// POST/PUT (escritura) solo ADMIN

// Función para encriptar/desencriptar (simple, para producción usar algo más robusto)
// Genera una clave consistente usando SHA-256
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.createHash('sha256').update(process.env.JWT_SECRET || 'change-me').digest('hex');
const ALGORITHM = 'aes-256-cbc';

function encrypt(text) {
  if (!text) return null;
  try {
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex'); // 64 hex = 32 bytes
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    console.error('Encryption error:', error);
    return text; // Fallback: guardar sin encriptar
  }
}

function decrypt(text) {
  if (!text) return null;
  if (!text.includes(':')) return text; // No está encriptado
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex'); // 64 hex = 32 bytes
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return text; // Fallback: devolver tal cual
  }
}

// GET /settings - Get all settings
router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;

    const settings = await Setting.findAll({
      where: { tenantId },
      order: [['settingKey', 'ASC']]
    });

    // Claves sensibles que se enmascaran en la respuesta del listado general
    const SENSITIVE_KEYS = ['smtp_password', 'payphone_token', 'vapid_private_key'];

    const decryptedSettings = settings.map(setting => {
      const settingData = setting.toJSON();
      const key = settingData.settingKey || '';
      // Enmascarar valores sensibles (mostrar solo últimos 4 caracteres)
      if (SENSITIVE_KEYS.some(sk => key.includes(sk))) {
        const raw = decrypt(settingData.settingValue) || settingData.settingValue || '';
        settingData.settingValue = raw.length > 4 ? '••••' + raw.slice(-4) : '••••';
        settingData._masked = true;
      } else if (key.includes('password')) {
        settingData.settingValue = '••••';
        settingData._masked = true;
      }
      return settingData;
    });

    res.json({ settings: decryptedSettings });
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /settings/:key - Get specific setting
router.get('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const tenantId = req.tenantId || 1;

    const value = await Setting.getSetting(tenantId, key);

    res.json({ key, value });
  } catch (error) {
    console.error('Error getting setting:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /settings - Create or update setting (solo ADMIN)
router.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const {
      tenantId = 1,
      key,
      value,
      type = 'string',
      description
    } = req.body;

    if (!key) {
      return res.status(400).json({
        error: 'Setting key is required',
        code: 'MISSING_KEY'
      });
    }

    // Encriptar valores sensibles
    let finalValue = value;
    if (key.includes('smtp_password') || key.includes('password')) {
      finalValue = encrypt(value);
    }

    const setting = await Setting.setSetting(tenantId, key, finalValue, type, description);

    res.json(setting);
  } catch (error) {
    console.error('Error saving setting:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// PUT /settings/:key - Update setting (solo ADMIN)
router.put('/:key', requireRole('ADMIN'), async (req, res) => {
  try {
    const { key } = req.params;
    const {
      tenantId = 1,
      value,
      type,
      description
    } = req.body;

    // Encriptar valores sensibles
    let finalValue = value;
    if (key.includes('smtp_password') || key.includes('password')) {
      finalValue = encrypt(value);
    }

    const setting = await Setting.setSetting(tenantId, key, finalValue, type, description);

    res.json(setting);
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /settings/bulk - Update multiple settings (solo ADMIN)
router.post('/bulk', requireRole('ADMIN'), async (req, res) => {
  try {
    const { tenantId = 1, settings } = req.body;

    if (!Array.isArray(settings)) {
      return res.status(400).json({
        error: 'Settings must be an array',
        code: 'INVALID_FORMAT'
      });
    }

    const results = [];
    for (const setting of settings) {
      const { key, value, type = 'string', description } = setting;
      
      // Encriptar valores sensibles
      let finalValue = value;
      if (key.includes('smtp_password') || key.includes('password')) {
        finalValue = encrypt(value);
      }

      const saved = await Setting.setSetting(tenantId, key, finalValue, type, description);
      results.push(saved);
    }

    res.json({ settings: results });
  } catch (error) {
    console.error('Error saving bulk settings:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /settings/upload-brand-image?type=logo|favicon|banner|login_bg
router.post('/upload-brand-image', requireRole('ADMIN'), uploadBrandImg.single('image'), async (req, res) => {
  const { type } = req.query;
  const filename = BRAND_IMG_MAP[type];
  if (!filename) {
    return res.status(400).json({ error: 'Tipo inválido. Usa: logo, favicon, banner, login_bg' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No se proporcionó imagen' });
  }
  const destPath = path.join(PUBLIC_IMG_DIR, filename);
  try {
    await processBrandImage(req.file.path, destPath, type);
    // Al subir el logo principal, regenerar íconos PWA (192 y 512)
    if (type === 'logo') {
      await regeneratePwaIcons(destPath);
    }
    const url = '/public/img/' + filename + '?v=' + Date.now();
    res.json({ ok: true, url });
  } catch (err) {
    console.error('upload-brand-image:', err);
    res.status(500).json({ error: 'Error al guardar imagen' });
  }
});

module.exports = router;

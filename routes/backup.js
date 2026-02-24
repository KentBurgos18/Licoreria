const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { requireRole } = require('./adminAuth');

const DB_HOST = process.env.DB_HOST || 'postgres';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_USER = process.env.DB_USER || 'licoreria_user';
const DB_NAME = process.env.DB_NAME || 'licoreria';
const DB_PASSWORD = process.env.DB_PASSWORD || 'licoreria_password';

const pgEnv = () => ({ ...process.env, PGPASSWORD: DB_PASSWORD });

// GET /api/backup/download — genera backup en archivo temporal y lo descarga
router.get('/download', requireRole('ADMIN'), async (req, res) => {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `licoreria_backup_${timestamp}.sql`;
  const tmpFile = path.join(os.tmpdir(), filename);

  try {
    // 1. Ejecutar pg_dump a un archivo temporal
    await new Promise((resolve, reject) => {
      const pgDump = spawn('pg_dump', [
        '-h', DB_HOST,
        '-p', DB_PORT,
        '-U', DB_USER,
        '-d', DB_NAME,
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-acl',
        '-f', tmpFile,
      ], { env: pgEnv() });

      let stderrOutput = '';
      pgDump.stderr.on('data', (d) => {
        stderrOutput += d.toString();
        console.error('[backup] pg_dump stderr:', d.toString().trim());
      });
      pgDump.on('error', (err) => reject(new Error('No se pudo ejecutar pg_dump: ' + err.message)));
      pgDump.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pg_dump falló (código ${code}): ${stderrOutput.slice(0, 300)}`));
        }
      });
    });

    // 2. Enviar el archivo — si falla, el JSON de error llega limpio al cliente
    res.download(tmpFile, filename, (err) => {
      fs.unlink(tmpFile, () => {});
      if (err && !res.headersSent) {
        console.error('[backup] Error enviando archivo:', err);
      }
    });

  } catch (error) {
    fs.unlink(tmpFile, () => {});
    console.error('[backup] Error generando backup:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/backup/restore — recibe archivo .sql y lo restaura con psql
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.sql')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se aceptan archivos .sql'));
    }
  }
});

router.post('/restore', requireRole('ADMIN'), upload.single('backup'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se proporcionó archivo de backup (.sql)' });
  }

  const filePath = req.file.path;

  try {
    const stderr = await new Promise((resolve, reject) => {
      const psql = spawn('psql', [
        '-h', DB_HOST,
        '-p', DB_PORT,
        '-U', DB_USER,
        '-d', DB_NAME,
        '-f', filePath,
      ], { env: pgEnv() });

      let stderrBuf = '';
      psql.stdout.on('data', (d) => process.stdout.write(d));
      psql.stderr.on('data', (d) => {
        stderrBuf += d.toString();
        process.stderr.write(d);
      });
      psql.on('error', reject);
      psql.on('close', (code) => {
        if (code === 0 || code === 3) {
          resolve(stderrBuf);
        } else {
          reject(new Error(`psql salió con código ${code}. Detalles: ${stderrBuf.slice(0, 400)}`));
        }
      });
    });

    const warnings = stderr.split('\n').filter(l => l.includes('ERROR')).length;
    res.json({
      message: 'Base de datos restaurada exitosamente',
      warnings: warnings > 0 ? `${warnings} advertencia(s) en el log (normal en restauración completa)` : null
    });
  } catch (error) {
    console.error('[backup] Restore error:', error);
    res.status(500).json({ error: 'Error al restaurar: ' + error.message });
  } finally {
    fs.unlink(filePath, () => {});
  }
});

module.exports = router;

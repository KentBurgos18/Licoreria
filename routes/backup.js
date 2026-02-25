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
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const pgEnv = () => ({ ...process.env, PGPASSWORD: DB_PASSWORD });

function spawnPromise(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, opts);
    let stderr = '';
    if (proc.stderr) proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => reject(new Error(`No se pudo ejecutar ${cmd}: ${err.message}`)));
    proc.on('close', code => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`${cmd} salió con código ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}

// GET /api/backup/download — genera .tar.gz con BD + imágenes y lo descarga
router.get('/download', requireRole('ADMIN'), async (req, res) => {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `licoreria_backup_${timestamp}.tar.gz`;
  const tmpDir = path.join(os.tmpdir(), `backup_${Date.now()}`);
  const sqlFile = path.join(tmpDir, 'database.sql');
  const tarFile = path.join(os.tmpdir(), filename);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    // 1. Volcar la base de datos
    await spawnPromise('pg_dump', [
      '-h', DB_HOST,
      '-p', String(DB_PORT),
      '-U', DB_USER,
      '-d', DB_NAME,
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-acl',
      '-f', sqlFile,
    ], { env: pgEnv() });

    // 2. Construir el .tar.gz: database.sql + uploads/ (si existe)
    const tarArgs = ['-czf', tarFile, '-C', tmpDir, 'database.sql'];
    const uploadsExists = fs.existsSync(UPLOADS_DIR) && fs.readdirSync(UPLOADS_DIR).length > 0;
    if (uploadsExists) {
      tarArgs.push('-C', path.join(__dirname, '..'), 'uploads');
    }
    await spawnPromise('tar', tarArgs);

    // 3. Enviar archivo al cliente
    res.download(tarFile, filename, (err) => {
      fs.rm(tmpDir, { recursive: true, force: true }, () => {});
      fs.unlink(tarFile, () => {});
      if (err && !res.headersSent) {
        console.error('[backup] Error enviando archivo:', err);
      }
    });

  } catch (error) {
    fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    fs.unlink(tarFile, () => {});
    console.error('[backup] Error generando backup:', error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

// POST /api/backup/restore — acepta .tar.gz (BD + imágenes) o .sql (solo BD)
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.tar.gz') || file.originalname.endsWith('.sql')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se aceptan archivos .tar.gz o .sql'));
    }
  }
});

router.post('/restore', requireRole('ADMIN'), upload.single('backup'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se proporcionó archivo de backup' });
  }

  const filePath = req.file.path;
  const isTarGz = req.file.originalname.endsWith('.tar.gz');
  const extractDir = path.join(os.tmpdir(), `restore_${Date.now()}`);

  try {
    let sqlFile = filePath;
    let uploadsRestored = 0;

    if (isTarGz) {
      // Extraer el .tar.gz a un directorio temporal
      fs.mkdirSync(extractDir, { recursive: true });
      await spawnPromise('tar', ['-xzf', filePath, '-C', extractDir]);

      const extractedSql = path.join(extractDir, 'database.sql');
      if (!fs.existsSync(extractedSql)) {
        throw new Error('El archivo .tar.gz no contiene database.sql');
      }
      sqlFile = extractedSql;

      // Restaurar imágenes si vienen en el backup
      const extractedUploads = path.join(extractDir, 'uploads');
      if (fs.existsSync(extractedUploads)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        await spawnPromise('cp', ['-rp', extractedUploads + '/.', UPLOADS_DIR]);
        uploadsRestored = fs.readdirSync(UPLOADS_DIR).filter(f => {
          try { return fs.statSync(path.join(UPLOADS_DIR, f)).isFile(); } catch { return false; }
        }).length;
      }
    }

    // Restaurar base de datos
    const stderr = await new Promise((resolve, reject) => {
      const psql = spawn('psql', [
        '-h', DB_HOST,
        '-p', String(DB_PORT),
        '-U', DB_USER,
        '-d', DB_NAME,
        '-f', sqlFile,
      ], { env: pgEnv() });

      let stderrBuf = '';
      psql.stdout.on('data', d => process.stdout.write(d));
      psql.stderr.on('data', d => { stderrBuf += d.toString(); process.stderr.write(d); });
      psql.on('error', reject);
      psql.on('close', code => {
        if (code === 0 || code === 3) resolve(stderrBuf);
        else reject(new Error(`psql salió con código ${code}: ${stderrBuf.slice(0, 400)}`));
      });
    });

    const warnings = stderr.split('\n').filter(l => l.includes('ERROR')).length;

    res.json({
      message: 'Backup restaurado exitosamente',
      warnings: warnings > 0 ? `${warnings} advertencia(s) en el log (normal en restauración completa)` : null,
      uploadsRestored: uploadsRestored > 0 ? `${uploadsRestored} imagen(es) restaurada(s)` : null,
    });

  } catch (error) {
    console.error('[backup] Restore error:', error);
    res.status(500).json({ error: 'Error al restaurar: ' + error.message });
  } finally {
    fs.unlink(filePath, () => {});
    fs.rm(extractDir, { recursive: true, force: true }, () => {});
  }
});

module.exports = router;

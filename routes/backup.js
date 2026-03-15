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

// GET /api/backup/download — genera .tar.gz con BD (formato custom) + imágenes
router.get('/download', requireRole('ADMIN'), async (req, res) => {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `licoreria_backup_${timestamp}.tar.gz`;
  const tmpDir = path.join(os.tmpdir(), `backup_${Date.now()}`);
  const dumpFile = path.join(tmpDir, 'database.dump');
  const tarFile = path.join(os.tmpdir(), filename);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    // 1. Volcar la BD en formato custom (-Fc): maneja dependencias FK correctamente
    await spawnPromise('pg_dump', [
      '-h', DB_HOST,
      '-p', String(DB_PORT),
      '-U', DB_USER,
      '-d', DB_NAME,
      '-Fc',            // formato custom (binario, pg_restore lo usa)
      '--no-owner',
      '--no-acl',
      '-f', dumpFile,
    ], { env: pgEnv() });

    if (!fs.existsSync(dumpFile) || fs.statSync(dumpFile).size === 0) {
      throw new Error('pg_dump no generó datos. Verifica la conexión a la BD.');
    }

    // 2. Construir el .tar.gz usando cwd=tmpDir
    const uploadsExists = fs.existsSync(UPLOADS_DIR) && fs.readdirSync(UPLOADS_DIR).length > 0;
    const filesToInclude = ['database.dump'];
    if (uploadsExists) {
      try {
        await spawnPromise('cp', ['-rp', UPLOADS_DIR, path.join(tmpDir, 'uploads')]);
        filesToInclude.push('uploads');
      } catch (e) {
        console.warn('[backup] No se pudieron incluir uploads (se omiten):', e.message);
      }
    }
    await spawnPromise('tar', ['-czf', tarFile, ...filesToInclude], { cwd: tmpDir });

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

// POST /api/backup/restore — acepta .tar.gz (BD + imágenes) o .sql (solo BD, legacy)
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
    let uploadsRestored = 0;

    if (isTarGz) {
      fs.mkdirSync(extractDir, { recursive: true });
      await spawnPromise('tar', ['-xzf', filePath, '-C', extractDir]);

      // Restaurar imágenes si vienen en el backup
      const extractedUploads = path.join(extractDir, 'uploads');
      if (fs.existsSync(extractedUploads)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        await spawnPromise('cp', ['-rp', extractedUploads + '/.', UPLOADS_DIR]);
        uploadsRestored = fs.readdirSync(UPLOADS_DIR).filter(f => {
          try { return fs.statSync(path.join(UPLOADS_DIR, f)).isFile(); } catch { return false; }
        }).length;
      }

      // Detectar formato: nuevo (.dump) o legacy (.sql)
      const dumpFile = path.join(extractDir, 'database.dump');
      const sqlFile = path.join(extractDir, 'database.sql');

      if (fs.existsSync(dumpFile)) {
        // Limpiar el schema completo con CASCADE para evitar errores de FK
        await spawnPromise('psql', [
          '-h', DB_HOST,
          '-p', String(DB_PORT),
          '-U', DB_USER,
          '-d', DB_NAME,
          '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
        ], { env: pgEnv() });

        // pg_restore sin --clean (ya limpiamos arriba)
        await spawnPromise('pg_restore', [
          '-h', DB_HOST,
          '-p', String(DB_PORT),
          '-U', DB_USER,
          '-d', DB_NAME,
          '--no-owner',
          '--no-acl',
          '--exit-on-error',
          dumpFile,
        ], { env: pgEnv() });
      } else if (fs.existsSync(sqlFile)) {
        // Formato legacy .sql — desactivar FK checks para evitar errores de dependencias
        await spawnPromise('psql', [
          '-h', DB_HOST,
          '-p', String(DB_PORT),
          '-U', DB_USER,
          '-d', DB_NAME,
          '-c', 'SET session_replication_role = replica',
          '-f', sqlFile,
          '-c', 'SET session_replication_role = DEFAULT',
        ], { env: pgEnv() });
      } else {
        throw new Error('El archivo .tar.gz no contiene database.dump ni database.sql');
      }

    } else {
      // .sql legacy directo
      await spawnPromise('psql', [
        '-h', DB_HOST,
        '-p', String(DB_PORT),
        '-U', DB_USER,
        '-d', DB_NAME,
        '-f', filePath,
      ], { env: pgEnv() });
    }

    res.json({
      message: 'Backup restaurado exitosamente',
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

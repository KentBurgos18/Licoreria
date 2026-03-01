/**
 * ImageProcessor — compresión y recorte inteligente de imágenes con sharp.
 *
 * Flujo para cada imagen:
 *  1. Lee metadatos (dimensiones + tamaño en disco)
 *  2. Si supera el umbral de tamaño O dimensiones → procesa
 *  3. Redimensiona con recorte inteligente (attention) si aplica
 *  4. Comprime a JPEG (productos) o PNG (marca)
 *  5. Reemplaza el archivo original
 */

const sharp  = require('sharp');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

// ─── Umbrales ────────────────────────────────────────────────
const PRODUCT_MAX_PX    = 900;       // px máximos en el lado más largo
const PRODUCT_QUALITY   = 82;        // calidad JPEG 0-100
const PRODUCT_SIZE_LIMIT = 300 * 1024; // 300 KB — si es menor y pequeña, se omite

const LOGO_MAX_PX       = 500;       // px máximos ancho
const LOGO_QUALITY      = 88;        // calidad PNG

const FAVICON_PX        = 128;       // favicon siempre 128x128
// ─────────────────────────────────────────────────────────────

/**
 * Procesa imagen de producto:
 *  - Redimensiona a máx 900×900 con recorte inteligente (attention)
 *  - Convierte a JPEG calidad 82
 *  - Solo actúa si la imagen supera 300 KB O alguna dimensión > 900px
 *
 * @param {string} filePath  Ruta del archivo subido (se reemplaza in-place)
 */
async function processProductImage(filePath) {
  try {
    const meta  = await sharp(filePath).metadata();
    const stats = fs.statSync(filePath);

    const needsResize   = (meta.width > PRODUCT_MAX_PX) || (meta.height > PRODUCT_MAX_PX);
    const needsCompress = stats.size > PRODUCT_SIZE_LIMIT;

    if (!needsResize && !needsCompress) return; // ya está bien

    const tmpPath = path.join(os.tmpdir(), 'lb-img-' + Date.now() + '.jpg');

    await sharp(filePath)
      .rotate()                    // corrige orientación EXIF automáticamente
      .resize(PRODUCT_MAX_PX, PRODUCT_MAX_PX, {
        fit:               'cover',
        position:          'attention', // recorte inteligente centrado en el objeto
        withoutEnlargement: true
      })
      .jpeg({ quality: PRODUCT_QUALITY, mozjpeg: true })
      .toFile(tmpPath);

    fs.renameSync(tmpPath, filePath);

    const newStats = fs.statSync(filePath);
    const reduction = Math.round((1 - newStats.size / stats.size) * 100);
    console.log(`[ImageProcessor] producto procesado: ${path.basename(filePath)} — reducción ${reduction}% (${(stats.size/1024).toFixed(0)}KB → ${(newStats.size/1024).toFixed(0)}KB)`);
  } catch (err) {
    console.warn('[ImageProcessor] error procesando imagen de producto:', err.message);
    // No lanzar — si falla sharp el archivo original sigue disponible
  }
}

/**
 * Procesa imagen de marca (logo o favicon):
 *  - logo:    redimensiona a máx 500px de ancho, mantiene proporción, PNG calidad 88
 *  - favicon: recorta a 128×128 con attention, PNG
 *
 * @param {string} srcPath   Ruta del archivo temporal (input)
 * @param {string} destPath  Ruta destino definitiva (output)
 * @param {'logo'|'favicon'} type
 */
async function processBrandImage(srcPath, destPath, type) {
  try {
    const stats = fs.statSync(srcPath);
    const tmpPath = path.join(os.tmpdir(), 'lb-brand-' + Date.now() + '.png');

    let pipeline = sharp(srcPath).rotate();

    if (type === 'favicon') {
      pipeline = pipeline.resize(FAVICON_PX, FAVICON_PX, {
        fit:      'cover',
        position: 'attention'
      });
    } else {
      // logo — conserva proporción, no recorta
      pipeline = pipeline.resize(LOGO_MAX_PX, null, {
        fit:               'inside',
        withoutEnlargement: true
      });
    }

    await pipeline
      .png({ quality: LOGO_QUALITY, compressionLevel: 8 })
      .toFile(tmpPath);

    fs.renameSync(tmpPath, destPath);

    const newStats = fs.statSync(destPath);
    const reduction = Math.round((1 - newStats.size / stats.size) * 100);
    console.log(`[ImageProcessor] marca (${type}) procesada: reducción ${reduction}% (${(stats.size/1024).toFixed(0)}KB → ${(newStats.size/1024).toFixed(0)}KB)`);
  } catch (err) {
    console.warn('[ImageProcessor] error procesando imagen de marca:', err.message);
    // Fallback: copiar sin procesar
    fs.copyFileSync(srcPath, destPath);
  }
}

module.exports = { processProductImage, processBrandImage };

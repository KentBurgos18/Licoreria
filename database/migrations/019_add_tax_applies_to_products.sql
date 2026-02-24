-- Migration 019: Agregar columna tax_applies a products
-- Permite marcar por producto si aplica IVA o no (default: true para compatibilidad)
ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_applies BOOLEAN NOT NULL DEFAULT true;

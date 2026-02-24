-- Migration 022: Add RUC, supplier_code, credit_days and notes to suppliers table
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS ruc VARCHAR(20),
  ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(30),
  ADD COLUMN IF NOT EXISTS credit_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Unique index on supplier_code per tenant (only when supplier_code is set)
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_code
  ON suppliers(tenant_id, supplier_code)
  WHERE supplier_code IS NOT NULL;

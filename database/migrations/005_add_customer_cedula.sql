-- Add cedula field to customers table
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS cedula VARCHAR(50) NOT NULL DEFAULT '';

-- Create unique index for cedula per tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_cedula 
ON customers(tenant_id, cedula);

-- Update existing records to have a temporary cedula if they don't have one
-- This is a safety measure, but ideally all customers should have a cedula
UPDATE customers 
SET cedula = 'TEMP-' || id::text 
WHERE cedula IS NULL OR cedula = '';

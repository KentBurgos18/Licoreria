-- Add password field to customers table for authentication
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Make email unique per tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_email 
ON customers(tenant_id, email) 
WHERE email IS NOT NULL;

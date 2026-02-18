-- Add product_type field to products table
ALTER TABLE products 
ADD COLUMN product_type VARCHAR(10) NOT NULL DEFAULT 'SIMPLE' 
CHECK (product_type IN ('SIMPLE', 'COMBO'));

-- Add comment for clarity
COMMENT ON COLUMN products.product_type IS 'Product type: SIMPLE for regular products, COMBO for virtual combos';
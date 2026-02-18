-- Add image_url column to products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);

-- Add comment for clarity
COMMENT ON COLUMN products.image_url IS 'URL path to product image file';

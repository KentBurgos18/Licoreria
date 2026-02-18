-- Add constraint to ensure inventory movements only reference SIMPLE products
ALTER TABLE inventory_movements 
ADD CONSTRAINT chk_inventory_movements_simple_product 
CHECK (product_id IN (
    SELECT id FROM products WHERE product_type = 'SIMPLE'
));

-- Add comment for clarity
COMMENT ON CONSTRAINT chk_inventory_movements_simple_product ON inventory_movements IS 
'Ensures inventory movements are only created for SIMPLE products, not COMBOs';
-- Create product_components table for combo BOM
CREATE TABLE product_components (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    combo_product_id BIGINT NOT NULL,
    component_product_id BIGINT NOT NULL,
    qty NUMERIC(12,3) NOT NULL CHECK (qty > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_product_components_combo 
        FOREIGN KEY (combo_product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_product_components_component 
        FOREIGN KEY (component_product_id) REFERENCES products(id) ON DELETE RESTRICT,
    CONSTRAINT uq_product_components 
        UNIQUE (tenant_id, combo_product_id, component_product_id)
);

-- Create indexes for performance
CREATE INDEX idx_product_components_tenant ON product_components(tenant_id);
CREATE INDEX idx_product_components_combo ON product_components(combo_product_id);
CREATE INDEX idx_product_components_component ON product_components(component_product_id);

-- Add comments
COMMENT ON TABLE product_components IS 'Bill of materials for combo products';
COMMENT ON COLUMN product_components.combo_product_id IS 'The combo product (product_type=COMBO)';
COMMENT ON COLUMN product_components.component_product_id IS 'Component product (must be SIMPLE)';
COMMENT ON COLUMN product_components.qty IS 'Quantity of component needed for one combo';
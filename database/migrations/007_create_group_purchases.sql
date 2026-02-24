-- Create group_purchases table
CREATE TABLE IF NOT EXISTS group_purchases (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    sale_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    quantity DECIMAL(12, 3) NOT NULL DEFAULT 1,
    total_amount DECIMAL(12, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PARTIAL', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT fk_group_purchases_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
    CONSTRAINT fk_group_purchases_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_group_purchases_tenant ON group_purchases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_group_purchases_sale ON group_purchases(sale_id);
CREATE INDEX IF NOT EXISTS idx_group_purchases_product ON group_purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_group_purchases_status ON group_purchases(status);

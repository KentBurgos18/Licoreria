-- Presentaciones de producto configurables (Individual, Six Pack, Caja, Cajetilla, etc.)
-- Permite inventario compartido: varios productos comparten stock de un producto base.

CREATE TABLE IF NOT EXISTS product_presentations (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL DEFAULT 1,
    name VARCHAR(100) NOT NULL,
    units_per_sale DECIMAL(12, 3) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_presentations_tenant ON product_presentations(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_presentations_tenant_name ON product_presentations(tenant_id, LOWER(TRIM(name)));

ALTER TABLE products ADD COLUMN IF NOT EXISTS base_product_id BIGINT REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS presentation_id BIGINT REFERENCES product_presentations(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS units_per_sale DECIMAL(12, 3) NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_products_base_product ON products(base_product_id);
CREATE INDEX IF NOT EXISTS idx_products_presentation ON products(presentation_id);

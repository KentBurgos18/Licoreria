-- Categorías de producto configurables (Cerveza, Vino, Ron, etc.)
-- No modifica product_type (SIMPLE/COMBO) que sigue siendo la lógica de negocio.

CREATE TABLE IF NOT EXISTS product_categories (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL DEFAULT 1,
    name VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_categories_tenant ON product_categories(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_categories_tenant_name ON product_categories(tenant_id, LOWER(TRIM(name)));

ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id BIGINT REFERENCES product_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

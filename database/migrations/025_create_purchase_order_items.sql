-- Tabla de ítems de orden de compra: guarda la cantidad original ingresada por el usuario
-- separada de inventory_movements (que convierte a unidades base según el pool)
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id            BIGSERIAL PRIMARY KEY,
    purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id    BIGINT NOT NULL,
    quantity      DECIMAL(12, 3) NOT NULL,
    unit_cost     DECIMAL(12, 2) NOT NULL DEFAULT 0,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_poi_order    ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_poi_product  ON purchase_order_items(product_id);

-- Migration 024: Link inventory_movements to purchase_orders when reason = 'PURCHASE'
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS purchase_order_id BIGINT
    REFERENCES purchase_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_purchase_order
  ON inventory_movements(purchase_order_id);

-- Migration 021: Allow product_id to be NULL in group_purchases
-- Required for POS group sales that include multiple products (no single productId).
-- Existing single-product group purchases (from admin API) are unaffected.

ALTER TABLE group_purchases
  ALTER COLUMN product_id DROP NOT NULL;

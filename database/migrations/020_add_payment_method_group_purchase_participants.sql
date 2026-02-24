-- Migration 020: Add payment_method to group_purchase_participants
-- Tracks how each participant paid at the time of the group sale:
--   CASH     = paid in cash on the spot (amountPaid set to amountDue, no credit)
--   TRANSFER = paid via transfer on the spot (amountPaid set to amountDue, no credit)
--   CREDIT   = amount is owed / adeudo (amountPaid = 0, CustomerCredit created)

ALTER TABLE group_purchase_participants
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'CREDIT'
    CONSTRAINT chk_gpp_payment_method CHECK (payment_method IN ('CASH', 'TRANSFER', 'CREDIT'));

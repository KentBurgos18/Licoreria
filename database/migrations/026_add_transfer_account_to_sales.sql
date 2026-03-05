-- Cuenta bancaria seleccionada en transferencias (para filtrar en admin)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS transfer_account_index INTEGER;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS transfer_account_info VARCHAR(150);

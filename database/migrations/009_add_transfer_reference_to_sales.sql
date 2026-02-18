-- Migración: Agregar campo transfer_reference a la tabla sales
-- Fecha: 2026-01-27

-- Agregar columna transfer_reference si no existe
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'sales' 
        AND column_name = 'transfer_reference'
    ) THEN
        ALTER TABLE sales ADD COLUMN transfer_reference VARCHAR(100);
    END IF;
END $$;

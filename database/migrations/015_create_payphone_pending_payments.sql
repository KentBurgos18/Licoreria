-- Migración: Tabla para pagos pendientes de PayPhone (Cajita)
-- Fecha: 2026-02-10

CREATE TABLE IF NOT EXISTS payphone_pending_payments (
    id BIGSERIAL PRIMARY KEY,
    client_transaction_id VARCHAR(50) NOT NULL UNIQUE,
    tenant_id BIGINT NOT NULL,
    customer_id BIGINT NOT NULL,
    items_json JSONB NOT NULL,
    subtotal DECIMAL(12, 2) NOT NULL,
    tax_amount DECIMAL(12, 2) NOT NULL,
    total_amount DECIMAL(12, 2) NOT NULL,
    tax_rate DECIMAL(5, 2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payphone_pending_client_tx ON payphone_pending_payments(client_transaction_id);
CREATE INDEX IF NOT EXISTS idx_payphone_pending_tenant ON payphone_pending_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payphone_pending_created ON payphone_pending_payments(created_at);

-- Create customer_payments table
CREATE TABLE IF NOT EXISTS customer_payments (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    customer_id BIGINT NOT NULL,
    group_purchase_participant_id BIGINT,
    amount DECIMAL(12, 2) NOT NULL,
    payment_method VARCHAR(20) NOT NULL
        CHECK (payment_method IN ('CASH', 'CARD', 'TRANSFER')),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_customer_payments_customer 
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_customer_payments_group_purchase_participant 
        FOREIGN KEY (group_purchase_participant_id) 
        REFERENCES group_purchase_participants(id) ON DELETE SET NULL,
    CONSTRAINT chk_amount_positive CHECK (amount > 0)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_customer_payments_tenant ON customer_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_participant 
    ON customer_payments(group_purchase_participant_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_date ON customer_payments(payment_date);

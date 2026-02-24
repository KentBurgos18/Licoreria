-- Create customer_credits table
CREATE TABLE IF NOT EXISTS customer_credits (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    customer_id BIGINT NOT NULL,
    group_purchase_participant_id BIGINT,
    initial_amount DECIMAL(12, 2) NOT NULL,
    current_balance DECIMAL(12, 2) NOT NULL,
    interest_rate DECIMAL(5, 4) NOT NULL DEFAULT 0,
    due_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'PAID', 'CANCELLED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP WITH TIME ZONE,
    last_interest_calculation_date DATE,
    
    CONSTRAINT fk_customer_credits_customer 
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_customer_credits_group_purchase_participant 
        FOREIGN KEY (group_purchase_participant_id) 
        REFERENCES group_purchase_participants(id) ON DELETE SET NULL,
    CONSTRAINT chk_initial_amount_positive CHECK (initial_amount > 0),
    CONSTRAINT chk_current_balance_not_negative CHECK (current_balance >= 0)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_customer_credits_tenant ON customer_credits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_credits_customer ON customer_credits(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_credits_participant 
    ON customer_credits(group_purchase_participant_id);
CREATE INDEX IF NOT EXISTS idx_customer_credits_status ON customer_credits(status);
CREATE INDEX IF NOT EXISTS idx_customer_credits_due_date ON customer_credits(due_date);
CREATE INDEX IF NOT EXISTS idx_customer_credits_active 
    ON customer_credits(tenant_id, customer_id, status) 
    WHERE status = 'ACTIVE';

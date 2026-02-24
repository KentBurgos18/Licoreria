-- Create group_purchase_participants table
CREATE TABLE IF NOT EXISTS group_purchase_participants (
    id BIGSERIAL PRIMARY KEY,
    group_purchase_id BIGINT NOT NULL,
    customer_id BIGINT NOT NULL,
    amount_due DECIMAL(12, 2) NOT NULL,
    amount_paid DECIMAL(12, 2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE')),
    due_date DATE,
    interest_rate DECIMAL(5, 4) NOT NULL DEFAULT 0,
    interest_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT fk_group_purchase_participants_group_purchase 
        FOREIGN KEY (group_purchase_id) REFERENCES group_purchases(id) ON DELETE CASCADE,
    CONSTRAINT fk_group_purchase_participants_customer 
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    CONSTRAINT chk_amount_paid_not_negative CHECK (amount_paid >= 0),
    CONSTRAINT chk_amount_paid_not_exceed_due CHECK (amount_paid <= amount_due + interest_amount)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_group_purchase_participants_group_purchase 
    ON group_purchase_participants(group_purchase_id);
CREATE INDEX IF NOT EXISTS idx_group_purchase_participants_customer 
    ON group_purchase_participants(customer_id);
CREATE INDEX IF NOT EXISTS idx_group_purchase_participants_status 
    ON group_purchase_participants(status);
CREATE INDEX IF NOT EXISTS idx_group_purchase_participants_due_date 
    ON group_purchase_participants(due_date);

-- Migration: Add OAuth support to customers table
-- Date: 2026-01-23

-- Add OAuth columns to customers table
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(50) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS oauth_id VARCHAR(255) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(500) DEFAULT NULL;

-- Create index for OAuth lookups
CREATE INDEX IF NOT EXISTS idx_customers_oauth ON customers(oauth_provider, oauth_id);

-- Make password nullable for OAuth users (they don't need a password)
ALTER TABLE customers ALTER COLUMN password DROP NOT NULL;

-- Add comment to explain the columns
COMMENT ON COLUMN customers.oauth_provider IS 'OAuth provider: google, microsoft, apple, or null for traditional auth';
COMMENT ON COLUMN customers.oauth_id IS 'Unique ID from OAuth provider';
COMMENT ON COLUMN customers.profile_picture IS 'URL to profile picture from OAuth provider';

-- Add Salesforce account ID column to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS salesforce_account_id TEXT DEFAULT '';

-- Index for fast lookups during sync matching
CREATE INDEX IF NOT EXISTS idx_customers_salesforce_id ON customers(salesforce_account_id) WHERE salesforce_account_id != '';

-- Expand platform CHECK constraint to include salesforce
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_platform_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_platform_check CHECK (platform IN ('stripe', 'hubspot', 'salesforce'));

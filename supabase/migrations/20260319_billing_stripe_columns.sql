-- Add Stripe billing columns to clients table (iQcadence's own subscriptions)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='stripe_customer_id') THEN
    ALTER TABLE clients ADD COLUMN stripe_customer_id TEXT DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='stripe_subscription_id') THEN
    ALTER TABLE clients ADD COLUMN stripe_subscription_id TEXT DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='subscription_status') THEN
    ALTER TABLE clients ADD COLUMN subscription_status TEXT DEFAULT 'none'
      CHECK (subscription_status IN ('none','active','past_due','canceled','incomplete'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='billing_period_end') THEN
    ALTER TABLE clients ADD COLUMN billing_period_end TIMESTAMPTZ DEFAULT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_stripe_cust ON clients(stripe_customer_id) WHERE stripe_customer_id != '';

-- Set all clients to growth tier
UPDATE clients SET plan_tier = 'growth';

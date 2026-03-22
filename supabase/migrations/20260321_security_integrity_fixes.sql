-- ═══════════════════════════════════════════════════════════════
-- Security & Data Integrity Fixes (2026-03-21)
-- Fixes: unique compound index, FKs, compound indexes, RLS
-- Safe to re-run — all statements are idempotent.
-- ═══════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────
-- 1. UNIQUE compound index on (client_id, external_id)
--    Prevents duplicate external_id within the same client.
--    Replaces the non-unique single-column idx_customers_ext_id.
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='client_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='external_id') THEN
    DROP INDEX IF EXISTS idx_customers_ext_id;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_client_external
      ON customers(client_id, external_id)
      WHERE external_id IS NOT NULL AND external_id != '' AND deleted_at IS NULL;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 2. Foreign keys on audit_logs and webhook_events
--    ON DELETE SET NULL so we don't block customer deletion.
--    First clean up orphaned references to deleted customers.
-- ─────────────────────────────────────────────────────────────

-- Null out orphaned customer_ids before adding FK constraints.
-- Uses DO block which runs as superuser, bypassing RLS.
DO $$
BEGIN
  -- Clean orphaned refs in audit_logs
  UPDATE audit_logs SET customer_id = NULL
    WHERE customer_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM customers WHERE customers.id = audit_logs.customer_id);

  -- Clean orphaned refs in webhook_events
  UPDATE webhook_events SET customer_id = NULL
    WHERE customer_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM customers WHERE customers.id = webhook_events.customer_id);

  -- Add FK on audit_logs
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_audit_logs_customer'
      AND table_name = 'audit_logs'
  ) THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT fk_audit_logs_customer
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
  END IF;

  -- Add FK on webhook_events
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_webhook_events_customer'
      AND table_name = 'webhook_events'
  ) THEN
    ALTER TABLE webhook_events
      ADD CONSTRAINT fk_webhook_events_customer
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 3. Compound indexes for common query patterns
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  -- API upsert: lookup by client_id + name
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='client_id') THEN
    CREATE INDEX IF NOT EXISTS idx_customers_client_name ON customers(client_id, lower(name)) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_customers_client_status ON customers(client_id, status) WHERE deleted_at IS NULL;
  END IF;

  -- Audit log queries: filter by client_id + time
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_logs' AND column_name='client_id') THEN
    CREATE INDEX IF NOT EXISTS idx_audit_logs_client_time ON audit_logs(client_id, created_at DESC);
  END IF;

  -- Webhook events: filter by user_id + time
  CREATE INDEX IF NOT EXISTS idx_webhook_events_user_time ON webhook_events(user_id, created_at DESC);
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4. Fix RLS policy on settings table
--    Split the combined OR policy into two separate policies
--    so admin access is cleanly isolated from client member access.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'settings'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON settings', pol.policyname);
  END LOOP;
END;
$$;

-- Client members can access their own client's settings
CREATE POLICY "settings_client_member" ON settings
  FOR ALL
  USING (
    client_id IN (SELECT client_id FROM user_profiles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    client_id IN (SELECT client_id FROM user_profiles WHERE user_id = auth.uid())
  );

-- Admins can access all settings
CREATE POLICY "settings_admin" ON settings
  FOR ALL
  USING      (public.is_jwt_admin())
  WITH CHECK (public.is_jwt_admin());


-- ─────────────────────────────────────────────────────────────
-- 5. Add HMAC secret column to api_keys for webhook signing
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_keys' AND column_name = 'hmac_secret'
  ) THEN
    ALTER TABLE api_keys ADD COLUMN hmac_secret TEXT DEFAULT '';
  END IF;
END $$;

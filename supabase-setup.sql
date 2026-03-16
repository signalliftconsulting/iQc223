-- ═══════════════════════════════════════════════════════════════════
-- IQcadence — Supabase Database Setup Script
-- Run this in Supabase → SQL Editor (run all at once)
-- Safe to re-run on an existing database.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
-- STEP 0: NUKE ALL EXISTING POLICIES ON user_profiles
-- This removes the broken recursive policy regardless of its name.
-- ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON user_profiles', pol.policyname);
  END LOOP;
END;
$$;

-- Also nuke all policies on customers and settings so we start clean
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('customers','settings','clients')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
  END LOOP;
END;
$$;


-- ─────────────────────────────────────────────────────────────────
-- 1. CLIENTS TABLE
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  notes       TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Add plan_tier column (safe to re-run)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='plan_tier') THEN
    ALTER TABLE clients ADD COLUMN plan_tier TEXT DEFAULT 'solo';
  END IF;
END $$;

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_owner" ON clients
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "clients_admin" ON clients
  FOR ALL
  USING      ((auth.jwt() ->> 'email') = ANY(ARRAY['signalliftconsulting@gmail.com', 'ian@iqcadence.com']))
  WITH CHECK ((auth.jwt() ->> 'email') = ANY(ARRAY['signalliftconsulting@gmail.com', 'ian@iqcadence.com']));

-- Allow users to READ their own client record (needed for plan tier resolution)
CREATE POLICY "clients_member_read" ON clients
  FOR SELECT
  USING (
    id IN (
      SELECT client_id FROM user_profiles WHERE user_id = auth.uid()
    )
  );


-- ─────────────────────────────────────────────────────────────────
-- 2. USER_PROFILES TABLE
--
-- !! CRITICAL !!
-- RLS policies on this table must NEVER query user_profiles themselves.
-- Doing so causes: "infinite recursion detected in policy for relation user_profiles"
-- Use ONLY auth.uid() and auth.jwt() — never a subquery on this table.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT,
  business_name TEXT DEFAULT '',
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Each user can SELECT their own row
CREATE POLICY "profiles_self_select" ON user_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

-- Each user can INSERT their own row
CREATE POLICY "profiles_self_insert" ON user_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Each user can UPDATE their own row
CREATE POLICY "profiles_self_update" ON user_profiles
  FOR UPDATE
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admin can do everything — identified by JWT email, NOT a table lookup
CREATE POLICY "profiles_admin_all" ON user_profiles
  FOR ALL
  USING      ((auth.jwt() ->> 'email') = ANY(ARRAY['signalliftconsulting@gmail.com', 'ian@iqcadence.com']))
  WITH CHECK ((auth.jwt() ->> 'email') = ANY(ARRAY['signalliftconsulting@gmail.com', 'ian@iqcadence.com']));

-- Prevent non-admins from escalating their own role
-- Only admin JWT emails can set role = 'admin'
CREATE OR REPLACE FUNCTION protect_role_column()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT ((current_setting('request.jwt.claims', true)::json ->> 'email')
            = ANY(ARRAY['signalliftconsulting@gmail.com', 'ian@iqcadence.com'])) THEN
      NEW.role := OLD.role;  -- silently revert role change for non-admins
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_role ON user_profiles;
CREATE TRIGGER trg_protect_role
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION protect_role_column();


-- ─────────────────────────────────────────────────────────────────
-- 3. CUSTOMERS TABLE
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  score           INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'healthy',
  mrr             NUMERIC DEFAULT 0,
  arr             NUMERIC DEFAULT 0,
  since           TEXT DEFAULT '',
  tier            TEXT DEFAULT 'mid',
  lifecycle       TEXT DEFAULT 'active',
  logins          INTEGER DEFAULT 0,
  adoption        INTEGER DEFAULT 0,
  tickets         INTEGER DEFAULT 0,
  nps             TEXT DEFAULT 'unknown',
  days            INTEGER DEFAULT 0,
  renewal         INTEGER DEFAULT 0,
  renewal_date    TEXT DEFAULT '',
  growth          TEXT DEFAULT 'none',
  tags            TEXT DEFAULT '',
  notes           TEXT DEFAULT '[]',
  history         TEXT DEFAULT '[]',
  sentiment       TEXT DEFAULT '[]',
  manager         TEXT DEFAULT '',
  scoring_profile TEXT DEFAULT '',
  deleted_at      TIMESTAMPTZ DEFAULT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  next_touch        TEXT DEFAULT '',
  playbook_checks   TEXT DEFAULT '{}',
  last_contact_date TEXT DEFAULT '',
  external_id       TEXT DEFAULT '',
  stripe_customer_id TEXT DEFAULT '',
  hubspot_company_id TEXT DEFAULT '',
  billing_interval   TEXT DEFAULT ''
);

-- Add last_contact_date column (safe to re-run)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='last_contact_date') THEN
    ALTER TABLE customers ADD COLUMN last_contact_date TEXT DEFAULT '';
  END IF;
END $$;

-- Add touch_history column (safe to re-run)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='touch_history') THEN
    ALTER TABLE customers ADD COLUMN touch_history TEXT DEFAULT '[]';
  END IF;
END $$;

-- Add next_touch_time column (safe to re-run)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='next_touch_time') THEN
    ALTER TABLE customers ADD COLUMN next_touch_time TEXT DEFAULT '';
  END IF;
END $$;

-- Add client_id column (safe to re-run) — customers now belong to a client, not a single user
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='client_id') THEN
    ALTER TABLE customers ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Make user_id nullable (now just an audit/created_by field)
ALTER TABLE customers ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Helper function: returns current user's client_id for RLS
-- SECURITY DEFINER so it can read user_profiles without triggering recursive RLS
CREATE OR REPLACE FUNCTION get_my_client_id()
RETURNS UUID AS $$
  SELECT client_id FROM public.user_profiles WHERE user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Users see all customers in their client
CREATE POLICY "customers_client_member" ON customers
  FOR ALL
  USING  (client_id = get_my_client_id())
  WITH CHECK (client_id = get_my_client_id());

-- Admin can read/write all customers
CREATE POLICY "customers_admin" ON customers
  FOR ALL
  USING      ((auth.jwt() ->> 'email') = ANY(ARRAY['signalliftconsulting@gmail.com', 'ian@iqcadence.com']))
  WITH CHECK ((auth.jwt() ->> 'email') = ANY(ARRAY['signalliftconsulting@gmail.com', 'ian@iqcadence.com']));


-- ─────────────────────────────────────────────────────────────────
-- 4. SETTINGS TABLE
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  client_id   UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- last editor
  weights     TEXT DEFAULT '{}',
  thresholds  TEXT DEFAULT '{}',
  profiles    TEXT DEFAULT '[]',
  automations TEXT DEFAULT '{}',
  signal_model TEXT DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settings_client_access" ON settings
  FOR ALL
  USING (
    client_id IN (SELECT client_id FROM user_profiles WHERE user_id = auth.uid())
    OR auth.jwt() ->> 'email' = ANY(ARRAY['ian@iqcadence.com'])
  );


-- ─────────────────────────────────────────────────────────────────
-- 5. AUDIT LOG TABLE
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL, -- client scope
  action        TEXT NOT NULL,           -- e.g. 'customer_created', 'customer_deleted', 'settings_changed'
  customer_id   UUID DEFAULT NULL,       -- optional: which customer was affected
  customer_name TEXT DEFAULT '',         -- denormalized for readability
  details       TEXT DEFAULT '{}',       -- JSON with change details
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Nuke existing policies on audit_logs
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_logs'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON audit_logs', pol.policyname); END LOOP;
END;
$$;

-- Each user sees only their own audit logs
CREATE POLICY "audit_logs_owner" ON audit_logs
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admin can see all audit logs
CREATE POLICY "audit_logs_admin" ON audit_logs
  FOR ALL
  USING      ((auth.jwt() ->> 'email') = ANY(ARRAY['signalliftconsulting@gmail.com', 'ian@iqcadence.com']))
  WITH CHECK ((auth.jwt() ->> 'email') = ANY(ARRAY['signalliftconsulting@gmail.com', 'ian@iqcadence.com']));


-- ─────────────────────────────────────────────────────────────────
-- 6. ADD AUTOMATIONS COLUMN TO SETTINGS
-- ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='settings' AND column_name='automations'
  ) THEN
    ALTER TABLE settings ADD COLUMN automations TEXT DEFAULT '{}';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='settings' AND column_name='signal_model'
  ) THEN
    ALTER TABLE settings ADD COLUMN signal_model TEXT DEFAULT '{}';
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────
-- 7. WEBHOOK EVENTS TABLE (automation event log)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL DEFAULT 'outbound',   -- 'outbound' | 'inbound'
  event_type    TEXT NOT NULL,                       -- e.g. 'health_below_threshold', 'upsert_account'
  payload       TEXT DEFAULT '{}',                   -- JSON payload sent or received
  status        TEXT DEFAULT 'pending',              -- 'success' | 'failed'
  status_code   INTEGER DEFAULT NULL,                -- HTTP response status code
  error_msg     TEXT DEFAULT '',
  customer_id   UUID DEFAULT NULL,
  customer_name TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Nuke existing policies on webhook_events
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'webhook_events'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON webhook_events', pol.policyname); END LOOP;
END;
$$;

CREATE POLICY "webhook_events_owner" ON webhook_events
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "webhook_events_admin" ON webhook_events
  FOR ALL
  USING      ((auth.jwt() ->> 'email') = ANY(ARRAY['signalliftconsulting@gmail.com', 'ian@iqcadence.com']))
  WITH CHECK ((auth.jwt() ->> 'email') = ANY(ARRAY['signalliftconsulting@gmail.com', 'ian@iqcadence.com']));


-- ─────────────────────────────────────────────────────────────────
-- 8. API KEYS TABLE (inbound webhook authentication)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL,          -- SHA-256 hash of actual key
  key_prefix  TEXT NOT NULL,          -- first 8 chars for display (e.g. "iqc_ab12")
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Nuke existing policies on api_keys
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'api_keys'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON api_keys', pol.policyname); END LOOP;
END;
$$;

CREATE POLICY "api_keys_owner" ON api_keys
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────
-- 9. INTEGRATION ID COLUMNS (safe to re-run)
-- ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='external_id') THEN
    ALTER TABLE customers ADD COLUMN external_id TEXT DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='stripe_customer_id') THEN
    ALTER TABLE customers ADD COLUMN stripe_customer_id TEXT DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='hubspot_company_id') THEN
    ALTER TABLE customers ADD COLUMN hubspot_company_id TEXT DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='billing_interval') THEN
    ALTER TABLE customers ADD COLUMN billing_interval TEXT DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='renewal_date') THEN
    ALTER TABLE customers ADD COLUMN renewal_date TEXT DEFAULT '';
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────
-- 10. INTEGRATIONS TABLE (native Stripe/HubSpot connections)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL CHECK (platform IN ('stripe', 'hubspot')),
  vault_secret_id   UUID DEFAULT NULL,
  config            JSONB DEFAULT '{}'::jsonb,
  status            TEXT DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
  last_sync_at      TIMESTAMPTZ DEFAULT NULL,
  last_sync_status  TEXT DEFAULT NULL,
  last_sync_message TEXT DEFAULT '',
  sync_stats        JSONB DEFAULT '{}'::jsonb,
  webhook_secret_id UUID DEFAULT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, platform)
);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

-- Nuke existing policies on integrations
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integrations'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON integrations', pol.policyname); END LOOP;
END;
$$;

CREATE POLICY "integrations_client_member" ON integrations
  FOR ALL
  USING  (client_id = get_my_client_id())
  WITH CHECK (client_id = get_my_client_id());

CREATE POLICY "integrations_admin" ON integrations
  FOR ALL
  USING      ((auth.jwt() ->> 'email') = ANY(ARRAY['signalliftconsulting@gmail.com', 'ian@iqcadence.com']))
  WITH CHECK ((auth.jwt() ->> 'email') = ANY(ARRAY['signalliftconsulting@gmail.com', 'ian@iqcadence.com']));


-- ─────────────────────────────────────────────────────────────────
-- 11. INDEXES
-- ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_customers_user_id    ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_client_id  ON customers(client_id);
CREATE INDEX IF NOT EXISTS idx_customers_deleted    ON customers(deleted_at);
CREATE INDEX IF NOT EXISTS idx_user_profiles_client ON user_profiles(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id   ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created   ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_user  ON webhook_events(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_date  ON webhook_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash        ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_integrations_client   ON integrations(client_id);
CREATE INDEX IF NOT EXISTS idx_customers_ext_id      ON customers(external_id)        WHERE external_id != '';
CREATE INDEX IF NOT EXISTS idx_customers_stripe_id   ON customers(stripe_customer_id)  WHERE stripe_customer_id != '';
CREATE INDEX IF NOT EXISTS idx_customers_hubspot_id  ON customers(hubspot_company_id)  WHERE hubspot_company_id != '';


-- ─────────────────────────────────────────────────────────────────
-- 12. BACKFILL: Populate client_id on existing customer rows
-- Run this ONCE after deploying the schema changes above.
-- ─────────────────────────────────────────────────────────────────
UPDATE customers c
SET client_id = (
  SELECT up.client_id FROM user_profiles up WHERE up.user_id = c.user_id
)
WHERE c.client_id IS NULL AND c.user_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────
-- VERIFY — run this after to confirm all policies are clean:
--
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
-- ─────────────────────────────────────────────────────────────────

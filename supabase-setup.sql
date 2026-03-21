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
-- ADMIN HELPER: checks if the current JWT user has role='admin'
-- SECURITY DEFINER avoids recursive RLS on user_profiles
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_jwt_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
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

-- Stripe billing columns (iQcadence's own subscriptions, NOT customer data sync)
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

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_owner" ON clients
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "clients_admin" ON clients
  FOR ALL
  USING      (public.is_jwt_admin())
  WITH CHECK (public.is_jwt_admin());

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
  USING      (public.is_jwt_admin())
  WITH CHECK (public.is_jwt_admin());

-- Prevent non-admins from escalating their own role
-- Only admin JWT emails can set role = 'admin'
CREATE OR REPLACE FUNCTION protect_role_column()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT public.is_jwt_admin() THEN
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

-- ── CHECK constraints: enforce valid signal ranges at DB level ──
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_score;
ALTER TABLE customers ADD CONSTRAINT chk_score CHECK (score IS NULL OR (score >= 0 AND score <= 100));
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_logins;
ALTER TABLE customers ADD CONSTRAINT chk_logins CHECK (logins IS NULL OR (logins >= 0 AND logins <= 999));
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_adoption;
ALTER TABLE customers ADD CONSTRAINT chk_adoption CHECK (adoption IS NULL OR (adoption >= 0 AND adoption <= 100));
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_tickets;
ALTER TABLE customers ADD CONSTRAINT chk_tickets CHECK (tickets IS NULL OR (tickets >= 0 AND tickets <= 999));
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_days;
ALTER TABLE customers ADD CONSTRAINT chk_days CHECK (days IS NULL OR (days >= 0 AND days <= 9999));
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_renewal;
ALTER TABLE customers ADD CONSTRAINT chk_renewal CHECK (renewal IS NULL OR (renewal >= 0 AND renewal <= 120));
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_mrr;
ALTER TABLE customers ADD CONSTRAINT chk_mrr CHECK (mrr IS NULL OR mrr >= 0);
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_arr;
ALTER TABLE customers ADD CONSTRAINT chk_arr CHECK (arr IS NULL OR arr >= 0);
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_status;
ALTER TABLE customers ADD CONSTRAINT chk_status CHECK (status IS NULL OR status IN ('critical','risk','watch','healthy','expand'));
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_tier;
ALTER TABLE customers ADD CONSTRAINT chk_tier CHECK (tier IS NULL OR tier IN ('smb','mid','enterprise'));
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_lifecycle;
ALTER TABLE customers ADD CONSTRAINT chk_lifecycle CHECK (lifecycle IS NULL OR lifecycle IN ('onboarding','active','atrisk','won','churned'));

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
  USING      (public.is_jwt_admin())
  WITH CHECK (public.is_jwt_admin());


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
    OR public.is_jwt_admin()
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
  USING      (public.is_jwt_admin())
  WITH CHECK (public.is_jwt_admin());


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
  USING      (public.is_jwt_admin())
  WITH CHECK (public.is_jwt_admin());


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
  platform          TEXT NOT NULL CHECK (platform IN ('stripe', 'hubspot', 'salesforce', 'anthropic')),
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
  USING      (public.is_jwt_admin())
  WITH CHECK (public.is_jwt_admin());


-- ─────────────────────────────────────────────────────────────────
-- 10b. API RATE LIMITING
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_rate_limits (
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_type   TEXT NOT NULL CHECK (window_type IN ('minute', 'hour')),
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, window_type)
);

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_id UUID,
  p_window_type TEXT,
  p_window_seconds INTEGER,
  p_max_requests INTEGER
) RETURNS TABLE(allowed BOOLEAN, current_count INTEGER, retry_after INTEGER) AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  INSERT INTO api_rate_limits (user_id, window_type, window_start, request_count)
  VALUES (p_user_id, p_window_type, v_now, 1)
  ON CONFLICT (user_id, window_type) DO UPDATE SET
    window_start = CASE
      WHEN api_rate_limits.window_start + (p_window_seconds || ' seconds')::INTERVAL <= v_now
      THEN v_now
      ELSE api_rate_limits.window_start
    END,
    request_count = CASE
      WHEN api_rate_limits.window_start + (p_window_seconds || ' seconds')::INTERVAL <= v_now
      THEN 1
      ELSE api_rate_limits.request_count + 1
    END
  RETURNING api_rate_limits.window_start, api_rate_limits.request_count
  INTO v_window_start, v_count;

  allowed := v_count <= p_max_requests;
  current_count := v_count;
  retry_after := GREATEST(0, EXTRACT(EPOCH FROM (v_window_start + (p_window_seconds || ' seconds')::INTERVAL - v_now))::INTEGER);
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─────────────────────────────────────────────────────────────────
-- 10c. SERVER-SIDE PLAN ENFORCEMENT
-- Prevents bypassing plan limits via browser console or API.
-- Enforces: account limits, user limits per plan tier.
-- ─────────────────────────────────────────────────────────────────

-- Helper: get plan tier for a client_id
CREATE OR REPLACE FUNCTION get_client_plan_tier(p_client_id UUID)
RETURNS TEXT AS $$
  SELECT COALESCE(plan_tier, 'starter') FROM clients WHERE id = p_client_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: get plan tier for current user's client
CREATE OR REPLACE FUNCTION get_my_plan_tier()
RETURNS TEXT AS $$
  SELECT COALESCE(c.plan_tier, 'starter')
  FROM clients c
  JOIN user_profiles up ON up.client_id = c.id
  WHERE up.user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Account limit per plan tier
CREATE OR REPLACE FUNCTION enforce_account_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_tier TEXT;
  v_max INTEGER;
  v_count INTEGER;
  v_is_admin BOOLEAN;
BEGIN
  -- Skip for admins
  v_is_admin := public.is_jwt_admin();
  IF v_is_admin THEN RETURN NEW; END IF;

  -- Skip if no client_id (legacy data)
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;

  -- Get plan tier and account limit
  v_tier := get_client_plan_tier(NEW.client_id);
  v_max := CASE v_tier
    WHEN 'core'       THEN 200
    WHEN 'growth'     THEN 1000
    WHEN 'custom'     THEN 999999
    -- Legacy tier names (pre-migration)
    WHEN 'pulse'      THEN 200
    WHEN 'signal'     THEN 1000
    WHEN 'command'    THEN 999999
    WHEN 'starter'    THEN 200
    WHEN 'team'       THEN 1000
    WHEN 'pro'        THEN 999999
    WHEN 'enterprise' THEN 999999
    ELSE 200
  END;

  -- Count existing non-deleted accounts for this client
  SELECT COUNT(*) INTO v_count
  FROM customers
  WHERE client_id = NEW.client_id AND deleted_at IS NULL;

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Account limit reached (% on % plan). Upgrade your plan to add more accounts.', v_max, v_tier;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_account_limit ON customers;
CREATE TRIGGER trg_enforce_account_limit
  BEFORE INSERT ON customers
  FOR EACH ROW EXECUTE FUNCTION enforce_account_limit();

-- User limit per plan tier
CREATE OR REPLACE FUNCTION enforce_user_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_tier TEXT;
  v_max INTEGER;
  v_count INTEGER;
  v_is_admin BOOLEAN;
BEGIN
  -- Skip for admins
  v_is_admin := public.is_jwt_admin();
  IF v_is_admin THEN RETURN NEW; END IF;

  -- Skip if no client_id
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;

  -- Get plan tier and user limit
  v_tier := get_client_plan_tier(NEW.client_id);
  v_max := CASE v_tier
    WHEN 'core'       THEN 3
    WHEN 'growth'     THEN 10
    WHEN 'custom'     THEN 999999
    -- Legacy tier names (pre-migration)
    WHEN 'pulse'      THEN 3
    WHEN 'starter'    THEN 3
    WHEN 'signal'     THEN 10
    WHEN 'team'       THEN 10
    WHEN 'pro'        THEN 999999
    WHEN 'command'    THEN 999999
    WHEN 'enterprise' THEN 999999
    ELSE 3
  END;

  -- Count existing users in this client
  SELECT COUNT(*) INTO v_count
  FROM user_profiles
  WHERE client_id = NEW.client_id;

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'User limit reached (% on % plan). Upgrade your plan to add more users.', v_max, v_tier;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_user_limit ON user_profiles;
CREATE TRIGGER trg_enforce_user_limit
  BEFORE INSERT ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_user_limit();


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
-- 13. Set all clients to Growth tier
-- Safe to re-run — idempotent.
-- ─────────────────────────────────────────────────────────────────
UPDATE clients SET plan_tier = 'growth';

CREATE INDEX IF NOT EXISTS idx_clients_stripe_cust ON clients(stripe_customer_id) WHERE stripe_customer_id != '';


-- ─────────────────────────────────────────────────────────────────
-- VERIFY — run this after to confirm all policies are clean:
--
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
-- ─────────────────────────────────────────────────────────────────

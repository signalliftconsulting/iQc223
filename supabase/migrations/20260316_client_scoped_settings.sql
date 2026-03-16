-- ============================================================
-- Migration: Re-key settings by client_id (multi-tenant)
-- Also adds client_id to audit_logs for per-client audit trails
-- ============================================================

-- 1. Add client_id column to settings
ALTER TABLE settings ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE;

-- 2. Backfill client_id from user_profiles
UPDATE settings s SET client_id = (
  SELECT up.client_id FROM user_profiles up WHERE up.user_id = s.user_id
) WHERE s.client_id IS NULL;

-- 3. Re-key: drop old PK (user_id), add new PK (client_id)
ALTER TABLE settings DROP CONSTRAINT settings_pkey;
ALTER TABLE settings ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE settings ADD CONSTRAINT settings_pkey PRIMARY KEY (client_id);

-- 4. Update RLS on settings to be client-scoped
DROP POLICY IF EXISTS settings_owner ON settings;
CREATE POLICY settings_client_access ON settings FOR ALL USING (
  client_id IN (SELECT client_id FROM user_profiles WHERE user_id = auth.uid())
  OR auth.jwt() ->> 'email' = ANY(ARRAY['ian@iqcadence.com'])
);

-- 5. Add client_id column to audit_logs
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

-- 6. Backfill audit_logs client_id from user_profiles
UPDATE audit_logs al SET client_id = (
  SELECT up.client_id FROM user_profiles up WHERE up.user_id = al.user_id
) WHERE al.client_id IS NULL;

-- 7. Add index for client-scoped audit queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_client_id ON audit_logs(client_id);

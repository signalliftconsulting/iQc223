-- ═══════════════════════════════════════════════════════════════
-- Migration: Add updated_at to customers table
-- Required for Zapier polling triggers (updated_since filter)
-- Run once via Supabase SQL Editor or CLI migration
-- ═══════════════════════════════════════════════════════════════

-- 1. Add column (defaults to now() for existing rows)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Backfill existing rows: use created_at as initial updated_at
UPDATE customers SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;

-- 3. Auto-update trigger: set updated_at = now() on every UPDATE
CREATE OR REPLACE FUNCTION update_customers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customers_updated_at ON customers;
CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION update_customers_updated_at();

-- 4. Index for efficient polling queries
CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON customers(updated_at DESC);

-- ============================================================
-- Migration: Add CHECK constraints to customers table
-- Prevents invalid signal values at the database level.
-- ============================================================

-- Score: 0-100
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_score;
ALTER TABLE customers ADD CONSTRAINT chk_score CHECK (score IS NULL OR (score >= 0 AND score <= 100));

-- Logins: 0-999
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_logins;
ALTER TABLE customers ADD CONSTRAINT chk_logins CHECK (logins IS NULL OR (logins >= 0 AND logins <= 999));

-- Adoption: 0-100
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_adoption;
ALTER TABLE customers ADD CONSTRAINT chk_adoption CHECK (adoption IS NULL OR (adoption >= 0 AND adoption <= 100));

-- Tickets: 0-999
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_tickets;
ALTER TABLE customers ADD CONSTRAINT chk_tickets CHECK (tickets IS NULL OR (tickets >= 0 AND tickets <= 999));

-- Days since contact: 0-9999
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_days;
ALTER TABLE customers ADD CONSTRAINT chk_days CHECK (days IS NULL OR (days >= 0 AND days <= 9999));

-- Renewal months: 0-120
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_renewal;
ALTER TABLE customers ADD CONSTRAINT chk_renewal CHECK (renewal IS NULL OR (renewal >= 0 AND renewal <= 120));

-- MRR: >= 0
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_mrr;
ALTER TABLE customers ADD CONSTRAINT chk_mrr CHECK (mrr IS NULL OR mrr >= 0);

-- ARR: >= 0
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_arr;
ALTER TABLE customers ADD CONSTRAINT chk_arr CHECK (arr IS NULL OR arr >= 0);

-- Status: valid values only
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_status;
ALTER TABLE customers ADD CONSTRAINT chk_status CHECK (status IS NULL OR status IN ('critical','risk','watch','healthy','expand'));

-- Tier: valid values only
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_tier;
ALTER TABLE customers ADD CONSTRAINT chk_tier CHECK (tier IS NULL OR tier IN ('smb','mid','enterprise'));

-- Lifecycle: valid values only
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_lifecycle;
ALTER TABLE customers ADD CONSTRAINT chk_lifecycle CHECK (lifecycle IS NULL OR lifecycle IN ('onboarding','active','atrisk','won','churned'));

-- ═══════════════════════════════════════════════════════════════════
-- pg_cron Setup — Scheduled Report Emails
-- Run this in Supabase → SQL Editor after deploying the
-- scheduled-reports edge function.
--
-- PREREQUISITES:
--   1. Deploy the edge function:
--      supabase functions deploy scheduled-reports
--
--   2. Set the CRON_SECRET environment variable:
--      supabase secrets set CRON_SECRET=<your-secret-here>
--
--   3. Ensure RESEND_API_KEY is already set (used by send-webhook too)
--
-- HOW IT WORKS:
--   pg_cron runs every 15 minutes and calls the scheduled-reports
--   edge function via pg_net. The edge function checks each user's
--   report_schedules config, builds HTML for due reports, sends
--   them via Resend, and updates last_sent timestamps.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
-- STEP 1: Enable pg_cron and pg_net extensions
-- (pg_net is pre-enabled on most Supabase projects)
-- ─────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;


-- ─────────────────────────────────────────────────────────────────
-- STEP 2: Create the cron job
--
-- *** IMPORTANT: Replace the values below ***
--   - YOUR_PROJECT_REF: Your Supabase project reference (e.g., abcdefghijkl)
--     Find it in: Supabase Dashboard → Settings → General → Reference ID
--   - YOUR_CRON_SECRET: The secret you set in step 2 above
-- ─────────────────────────────────────────────────────────────────

SELECT cron.schedule(
  'send-scheduled-reports',           -- job name
  '*/15 * * * *',                     -- every 15 minutes
  $$
  SELECT net.http_post(
    url    := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/scheduled-reports',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_CRON_SECRET',
      'Content-Type',  'application/json'
    ),
    body   := '{}'::jsonb
  );
  $$
);


-- ─────────────────────────────────────────────────────────────────
-- USEFUL COMMANDS
-- ─────────────────────────────────────────────────────────────────

-- View all cron jobs:
--   SELECT * FROM cron.job;

-- View recent cron job runs:
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- Disable the job temporarily:
--   SELECT cron.unschedule('send-scheduled-reports');

-- Re-enable with different schedule (e.g., hourly):
--   SELECT cron.schedule(
--     'send-scheduled-reports',
--     '0 * * * *',
--     $$ ... same body ... $$
--   );

-- Change to run every 5 minutes (more frequent):
--   SELECT cron.schedule(
--     'send-scheduled-reports',
--     '*/5 * * * *',
--     $$ ... same body ... $$
--   );

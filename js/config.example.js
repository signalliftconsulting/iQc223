/**
 * IQcadence — Runtime config (copy this file to config.js and set your values).
 * config.js is gitignored so real keys never go in the repo.
 *
 * 1. Copy: cp js/config.example.js js/config.js
 * 2. Set SUPABASE_URL and SUPABASE_ANON from your Supabase project (Settings → API).
 * 3. Optionally set ADMIN_EMAILS (emails that get admin access in the app).
 */
window.__IQCADENCE_CONFIG__ = {
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_ANON: 'your-anon-key',
  ADMIN_EMAILS: ['admin@example.com']
};

# IQcadence — CS Health Score

Customer success health scoring app with Supabase (auth, database, Edge Functions).

## Setup

1. **Supabase**  
   Create a project at [supabase.com](https://supabase.com). Run `supabase-setup.sql` in the SQL Editor (Dashboard → SQL Editor).

2. **Config**  
   Copy the example config and set your keys:
   ```bash
   cp js/config.example.js js/config.js
   ```
   Edit `js/config.js`:
   - `SUPABASE_URL` — from Supabase → Settings → API → Project URL  
   - `SUPABASE_ANON` — from Settings → API → anon public key  
   - `ADMIN_EMAILS` — array of emails that get admin access (optional; defaults in code)

   **Important:** `js/config.js` is gitignored so real keys are never committed.

3. **Run locally**  
   Serve the folder (e.g. `npx serve -l 9200` or use the built-in launch config). Open the app and sign in with a user created in Supabase Auth.

## Deployment

- **Static host:** Upload the repo (without `node_modules`, without `js/config.js`). On the server, create `js/config.js` from the example and set `SUPABASE_URL` and `SUPABASE_ANON` for that environment.
- **Supabase Edge Functions:** Deploy `supabase/functions` (e.g. `supabase functions deploy`). Set secrets (e.g. `RESEND_API_KEY`) in the Supabase dashboard.
- **RLS:** Admin emails in the database are still in `supabase-setup.sql` (policies). To change admins without editing SQL, add an `admin_emails` table and update policies to use it.

## Optional: Extract CSS

The main styles live in a large `<style>` block in `index.html`. To move them into a file for caching and clarity:

1. Create `css/app.css` and move the contents of the `<style>…</style>` block into it.
2. In `index.html` replace that block with:  
   `<link rel="stylesheet" href="css/app.css"/>`

A full copy of the CSS has been written to `css/app.css`; you can delete the inline block in `index.html` and keep the link that’s already in the head.

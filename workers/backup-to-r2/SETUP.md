# iQcadence Backup Worker

Daily automated backup of all Supabase data to Cloudflare R2.

## Setup (5 min)

### 1. Create R2 bucket
```bash
npx wrangler r2 bucket create iqcadence-backups
```

### 2. Set secrets
```bash
cd workers/backup-to-r2
npx wrangler secret put SUPABASE_URL
# Paste: https://your-project.supabase.co

npx wrangler secret put SUPABASE_SERVICE_KEY
# Paste: your service_role key (from Supabase > Settings > API)
```

### 3. Deploy
```bash
npx wrangler deploy
```

That's it. Backups run daily at 3 AM UTC automatically.

## How it works

- Cron trigger fires daily at 3 AM UTC
- Worker queries Supabase REST API with service_role key (bypasses RLS)
- Backs up: customers, clients, user_profiles, settings, webhook_events
- Stores as JSON in R2 under `backups/YYYY-MM-DD/timestamp.json`
- Auto-cleans backups older than 30 days

## Manual backup

```bash
curl https://iqcadence-backup.your-account.workers.dev/backup \
  -H "X-Backup-Key: your-service-role-key"
```

## List backups

```bash
curl https://iqcadence-backup.your-account.workers.dev/list \
  -H "X-Backup-Key: your-service-role-key"
```

## Restore from backup

1. Download the backup JSON from R2 (via Cloudflare dashboard or wrangler)
2. Parse the JSON - each key is a table name, value is array of rows
3. Use Supabase dashboard or API to re-import the data

## Cost

Free tier covers this easily:
- R2: 10 GB storage free, 1M Class B reads/month free
- Workers: 100K requests/day free, cron triggers free
- A typical backup is ~1-5 MB, so 30 days = ~30-150 MB

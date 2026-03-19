// Cloudflare Worker: Daily backup of iQcadence data to R2
// Runs on cron schedule (daily 3 AM UTC) or manually via HTTP
//
// Setup:
// 1. Create R2 bucket: wrangler r2 bucket create iqcadence-backups
// 2. Set secrets:
//    wrangler secret put SUPABASE_URL
//    wrangler secret put SUPABASE_SERVICE_KEY
// 3. Deploy: wrangler deploy
// 4. (Optional) Set BACKUP_RETENTION_DAYS secret (default: 30)

export default {
  // HTTP trigger - manual backup or status check
  async fetch(request, env) {
    const url = new URL(request.url);

    // Auth check - require a secret header for manual triggers
    const authHeader = request.headers.get('X-Backup-Key');
    if (authHeader !== env.SUPABASE_SERVICE_KEY) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (url.pathname === '/backup') {
      const result = await runBackup(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/list') {
      const list = await listBackups(env);
      return new Response(JSON.stringify(list, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/status') {
      return new Response(JSON.stringify({ status: 'ok', time: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('iQcadence Backup Worker\n\nEndpoints:\n  /backup - trigger manual backup\n  /list - list recent backups\n  /status - health check\n\nRequires X-Backup-Key header.', { status: 200 });
  },

  // Cron trigger - automatic daily backup
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBackup(env));
  }
};

async function runBackup(env) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dateStr = timestamp.slice(0, 10);
  const results = { timestamp, tables: {}, errors: [], durationMs: 0 };

  try {
    // Tables to back up with their key fields
    const tables = [
      { name: 'customers', orderBy: 'created_at' },
      { name: 'clients', orderBy: 'created_at' },
      { name: 'user_profiles', orderBy: 'created_at' },
      { name: 'settings', orderBy: 'updated_at' },
      { name: 'webhook_events', orderBy: 'created_at', limit: 10000 },
    ];

    const backup = {};

    for (const table of tables) {
      try {
        const data = await fetchTable(env, table.name, table.orderBy, table.limit);
        backup[table.name] = data;
        results.tables[table.name] = { rows: data.length, status: 'ok' };
      } catch (err) {
        results.tables[table.name] = { rows: 0, status: 'error', error: err.message };
        results.errors.push(`${table.name}: ${err.message}`);
        backup[table.name] = [];
      }
    }

    // Write backup to R2
    const key = `backups/${dateStr}/${timestamp}.json`;
    const body = JSON.stringify(backup);
    const sizeKB = Math.round(body.length / 1024);

    await env.BACKUP_BUCKET.put(key, body, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        timestamp: new Date().toISOString(),
        tables: Object.keys(backup).join(','),
        totalRows: String(Object.values(backup).reduce((s, t) => s + t.length, 0)),
        sizeKB: String(sizeKB)
      }
    });

    results.key = key;
    results.sizeKB = sizeKB;
    results.status = results.errors.length ? 'partial' : 'ok';

    // Clean up old backups (default 30 days retention)
    const retentionDays = parseInt(env.BACKUP_RETENTION_DAYS || '30', 10);
    const cleaned = await cleanOldBackups(env, retentionDays);
    results.cleanedFiles = cleaned;

  } catch (err) {
    results.status = 'failed';
    results.errors.push(err.message);
  }

  results.durationMs = Date.now() - startTime;
  return results;
}

async function fetchTable(env, tableName, orderBy, limit) {
  // Supabase REST API with service_role key (bypasses RLS)
  const pageSize = 1000;
  let allRows = [];
  let offset = 0;
  const maxRows = limit || 100000;

  while (offset < maxRows) {
    const url = `${env.SUPABASE_URL}/rest/v1/${tableName}?order=${orderBy}.desc&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'count=exact'
      }
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const rows = await res.json();
    allRows = allRows.concat(rows);

    // If we got fewer rows than page size, we've reached the end
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return allRows;
}

async function listBackups(env) {
  const listed = await env.BACKUP_BUCKET.list({ prefix: 'backups/', limit: 50 });
  return (listed.objects || []).map(obj => ({
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded,
    metadata: obj.customMetadata || {}
  })).sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
}

async function cleanOldBackups(env, retentionDays) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  let cleaned = 0;

  const listed = await env.BACKUP_BUCKET.list({ prefix: 'backups/', limit: 500 });
  for (const obj of (listed.objects || [])) {
    if (new Date(obj.uploaded) < cutoff) {
      await env.BACKUP_BUCKET.delete(obj.key);
      cleaned++;
    }
  }

  return cleaned;
}

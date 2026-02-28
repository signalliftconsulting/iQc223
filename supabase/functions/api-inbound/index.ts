// ═══════════════════════════════════════════════════════════════
// api-inbound — Supabase Edge Function
// Receives inbound API calls from Zapier (or any HTTP client)
// Authenticates via x-api-key header → SHA-256 hash lookup
// Supports: upsert_account, update_health
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  'https://iqcadence.pages.dev',
  'https://iqcadence.com',
  'https://www.iqcadence.com',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  // Allow Cloudflare preview deployments (hex.iqcadence.pages.dev)
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-f0-9]+\.iqcadence\.pages\.dev$/.test(origin);
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  };
}

// Replicate client-side getStatus logic with default thresholds
function getStatusFromScore(score: number): string {
  if (score < 25) return 'critical';
  if (score < 50) return 'risk';
  if (score < 65) return 'watch';
  if (score < 80) return 'healthy';
  return 'expand';
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let userId: string | null = null;

  try {
    // ── Authenticate via API key ──
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) throw new Error('Missing x-api-key header');

    // Hash the provided key and look it up
    const encoder = new TextEncoder();
    const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(apiKey));
    const hashHex = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    const { data: keyRow, error: keyErr } = await serviceClient
      .from('api_keys')
      .select('user_id')
      .eq('key_hash', hashHex)
      .single();

    if (keyErr || !keyRow) throw new Error('Invalid API key');
    userId = keyRow.user_id;

    // ── Parse request body ──
    const body = await req.json();
    const { action, data } = body;
    if (!action || !data) throw new Error('Missing action or data in request body');

    let result: Record<string, any> = {};
    let customerName = data.name || '';

    // ════════════════════════════════════════════════════════
    // ACTION: upsert_account
    // ════════════════════════════════════════════════════════
    if (action === 'upsert_account') {
      if (!data.name) throw new Error('Account name is required');

      // Check if customer exists by name (case-insensitive)
      const { data: existing } = await serviceClient
        .from('customers')
        .select('*')
        .eq('user_id', userId)
        .ilike('name', data.name)
        .is('deleted_at', null)
        .limit(1);

      // Build row with only the provided fields
      const row: Record<string, any> = {
        user_id: userId,
        name: data.name,
      };
      if (data.mrr != null)        row.mrr = data.mrr;
      if (data.arr != null)        row.arr = data.arr;
      if (data.score != null)      { row.score = Number(data.score); row.status = getStatusFromScore(Number(data.score)); }
      if (data.tier)               row.tier = data.tier;
      if (data.lifecycle)          row.lifecycle = data.lifecycle;
      if (data.manager)            row.manager = data.manager;
      if (data.tags)               row.tags = data.tags;
      if (data.nps)                row.nps = data.nps;
      if (data.logins != null)     row.logins = Number(data.logins);
      if (data.adoption != null)   row.adoption = Number(data.adoption);
      if (data.tickets != null)    row.tickets = Number(data.tickets);
      if (data.days != null)       row.days = Number(data.days);
      if (data.renewal_date)       row.renewal_date = data.renewal_date;
      if (data.growth)             row.growth = data.growth;
      if (data.since)              row.since = data.since;
      if (data.next_touch)         row.next_touch = data.next_touch;

      if (existing && existing.length > 0) {
        // Update existing customer
        const { error } = await serviceClient
          .from('customers')
          .update(row)
          .eq('id', existing[0].id);
        if (error) throw error;
        result = { action: 'updated', id: existing[0].id, name: data.name };
      } else {
        // Create new customer
        row.id = crypto.randomUUID();
        row.created_at = new Date().toISOString();
        if (!row.score) { row.score = 0; row.status = 'healthy'; }
        const { error } = await serviceClient.from('customers').insert(row);
        if (error) throw error;
        result = { action: 'created', id: row.id, name: data.name };
      }

    // ════════════════════════════════════════════════════════
    // ACTION: update_health
    // ════════════════════════════════════════════════════════
    } else if (action === 'update_health') {
      if (!data.name || !data.field) throw new Error('name and field are required');

      const allowedFields = [
        'score', 'nps', 'logins', 'adoption', 'tickets', 'days',
        'renewal_date', 'growth', 'mrr', 'arr', 'tier', 'lifecycle',
        'manager', 'next_touch'
      ];
      if (!allowedFields.includes(data.field)) {
        throw new Error('Invalid field: ' + data.field + '. Allowed: ' + allowedFields.join(', '));
      }

      // Find customer by name
      const { data: existing } = await serviceClient
        .from('customers')
        .select('id, score')
        .eq('user_id', userId)
        .ilike('name', data.name)
        .is('deleted_at', null)
        .limit(1);

      if (!existing || !existing.length) throw new Error('Account not found: ' + data.name);

      const update: Record<string, any> = { [data.field]: data.value };
      // If updating score, also update derived status
      if (data.field === 'score') {
        update.status = getStatusFromScore(Number(data.value));
      }

      const { error } = await serviceClient
        .from('customers')
        .update(update)
        .eq('id', existing[0].id);
      if (error) throw error;
      result = { action: 'updated', id: existing[0].id, field: data.field, value: data.value };

    } else {
      throw new Error('Unknown action: ' + action + '. Supported: upsert_account, update_health');
    }

    // ── Log the inbound event ──
    await serviceClient.from('webhook_events').insert({
      user_id:       userId,
      direction:     'inbound',
      event_type:    action,
      payload:       JSON.stringify(body),
      status:        'success',
      status_code:   200,
      customer_name: customerName
    });

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    // Log failed attempt if we have a userId
    if (userId) {
      try {
        await serviceClient.from('webhook_events').insert({
          user_id:    userId,
          direction:  'inbound',
          event_type: 'error',
          payload:    '{}',
          status:     'failed',
          error_msg:  err.message || 'Unknown error'
        });
      } catch { /* best-effort logging */ }
    }

    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});

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

// ── Input validation helpers ──
function validateNumber(val: unknown, min: number, max: number | null, name: string): number {
  const n = Number(val);
  if (isNaN(n)) throw new Error(`${name} must be a valid number`);
  if (n < min) throw new Error(`${name} must be >= ${min}`);
  if (max !== null && n > max) throw new Error(`${name} must be <= ${max}`);
  return n;
}

function validateString(val: unknown, maxLen: number, name: string): string {
  if (typeof val !== 'string') throw new Error(`${name} must be a string`);
  if (val.length > maxLen) throw new Error(`${name} must be ${maxLen} characters or fewer`);
  return val;
}

function validateDate(val: unknown, name: string): string {
  if (typeof val !== 'string') throw new Error(`${name} must be a date string`);
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(val)) {
    throw new Error(`${name} must be a valid date (YYYY-MM-DD or ISO 8601)`);
  }
  if (isNaN(Date.parse(val))) throw new Error(`${name} is not a valid date`);
  return val;
}

function validateTags(val: unknown): string[] {
  if (typeof val === 'string') return val.split(',').map(t => t.trim()).filter(Boolean);
  if (Array.isArray(val)) {
    if (!val.every(v => typeof v === 'string')) throw new Error('tags must be strings');
    return val;
  }
  throw new Error('tags must be an array of strings or comma-separated string');
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

      // Build row with only the provided fields (validated)
      const row: Record<string, any> = {
        user_id: userId,
        name: validateString(data.name, 255, 'name'),
      };
      if (data.mrr != null)        row.mrr = validateNumber(data.mrr, 0, null, 'mrr');
      if (data.arr != null)        row.arr = validateNumber(data.arr, 0, null, 'arr');
      if (data.score != null)      { row.score = validateNumber(data.score, 0, 100, 'score'); row.status = getStatusFromScore(row.score); }
      if (data.tier)               row.tier = validateString(data.tier, 50, 'tier');
      if (data.lifecycle)          row.lifecycle = validateString(data.lifecycle, 50, 'lifecycle');
      if (data.manager)            row.manager = validateString(data.manager, 100, 'manager');
      if (data.tags)               row.tags = validateTags(data.tags);
      if (data.nps != null)        row.nps = validateNumber(data.nps, -100, 100, 'nps');
      if (data.logins != null)     row.logins = validateNumber(data.logins, 0, null, 'logins');
      if (data.adoption != null)   row.adoption = validateNumber(data.adoption, 0, 100, 'adoption');
      if (data.tickets != null)    row.tickets = validateNumber(data.tickets, 0, null, 'tickets');
      if (data.days != null)       row.days = validateNumber(data.days, 0, null, 'days');
      if (data.renewal_date)       row.renewal_date = validateDate(data.renewal_date, 'renewal_date');
      if (data.growth)             row.growth = validateString(data.growth, 50, 'growth');
      if (data.since)              row.since = validateDate(data.since, 'since');
      if (data.next_touch)         row.next_touch = validateDate(data.next_touch, 'next_touch');

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

      // Validate value matches expected type for the field
      const numericFieldLimits: Record<string, [number, number | null]> = {
        score: [0, 100], nps: [-100, 100], logins: [0, null],
        adoption: [0, 100], tickets: [0, null], days: [0, null],
        mrr: [0, null], arr: [0, null]
      };
      const stringFieldLimits: Record<string, number> = {
        tier: 50, lifecycle: 50, manager: 100, growth: 50
      };
      const dateFieldNames = ['renewal_date', 'next_touch'];

      let validatedValue: any = data.value;
      if (numericFieldLimits[data.field]) {
        const [min, max] = numericFieldLimits[data.field];
        validatedValue = validateNumber(data.value, min, max, data.field);
      } else if (stringFieldLimits[data.field]) {
        validatedValue = validateString(data.value, stringFieldLimits[data.field], data.field);
      } else if (dateFieldNames.includes(data.field)) {
        validatedValue = validateDate(data.value, data.field);
      }

      const update: Record<string, any> = { [data.field]: validatedValue };
      // If updating score, also update derived status
      if (data.field === 'score') {
        update.status = getStatusFromScore(validatedValue);
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

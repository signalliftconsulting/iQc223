// ═══════════════════════════════════════════════════════════════
// api-inbound — Supabase Edge Function
// Receives inbound API calls from Zapier (or any HTTP client)
// Authenticates via x-api-key header → SHA-256 hash lookup
// Supports: upsert_account, update_health, list_customers,
//           get_customer, delete_customer, score_customer
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  'https://iqcadence.pages.dev',
  'https://iqcadence.com',
  'https://www.iqcadence.com',
  'https://iqc223.com',
  'https://www.iqc223.com',
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

// ── Status from score (replicate client-side getStatus) ──
function getStatusFromScore(score: number, thresholds?: Record<string, number>): string {
  const t = thresholds || { critical: 25, risk: 50, watch: 65, healthy: 80 };
  if (score < t.critical) return 'critical';
  if (score < t.risk)     return 'risk';
  if (score < t.watch)    return 'watch';
  if (score < t.healthy)  return 'healthy';
  return 'expand';
}

// ── Server-side scoring engine (replicates client-side calcScore) ──
const DEFAULT_WEIGHTS: Record<string, number> = {
  logins: 25, adoption: 25, tickets: 20, nps: 10, csat: 5, days: 10, growth: 5
};

function npsNormalized(score: number | null): number {
  if (score == null) return 50;
  return Math.round((score / 10) * 100);
}
function csatNormalized(score: number | null): number {
  if (score == null) return 50;
  return Math.round(((score - 1) / 4) * 100);
}

function calcScoreServer(
  customer: Record<string, any>,
  w: Record<string, number>
): { score: number; status: string; signals: Record<string, number> } {
  const logins_n   = customer.logins   != null ? Math.min(customer.logins / 30, 1) * 100 : 50;
  const adoption_n = customer.adoption != null ? Math.min(customer.adoption, 100) : 50;
  const tickets_n  = customer.tickets  != null ? Math.max(0, 100 - customer.tickets * 20) : 50;
  const nps_n      = npsNormalized(customer.nps);
  const csat_n     = csatNormalized(customer.csat);
  const days_n     = customer.days     != null ? Math.max(0, 100 - (customer.days / 180) * 100) : 50;
  const growth_n   = ({ none: 25, mild: 65, strong: 100 } as Record<string, number>)[customer.growth] || 25;

  const total = (w.logins + w.adoption + w.tickets + (w.nps || 0) + (w.csat || 0) + w.days + w.growth) || 100;
  const raw = (
    logins_n   * (w.logins   / total) +
    adoption_n * (w.adoption / total) +
    tickets_n  * (w.tickets  / total) +
    nps_n      * ((w.nps || 0) / total) +
    csat_n     * ((w.csat || 0) / total) +
    days_n     * (w.days     / total) +
    growth_n   * (w.growth   / total)
  );
  const score = Math.round(Math.max(0, Math.min(100, raw)));
  return { score, status: getStatusFromScore(score), signals: { logins_n, adoption_n, tickets_n, nps_n, csat_n, days_n, growth_n } };
}

// ── Signal fields that affect scoring ──
const SIGNAL_FIELDS = ['logins', 'adoption', 'tickets', 'nps', 'csat', 'days', 'growth'];

// ── Fetch user's scoring weights + profiles (shared helper) ──
async function getUserScoringConfig(
  serviceClient: any, userId: string, scoringProfile?: string
): Promise<{ weights: Record<string, number>; thresholds: Record<string, number> }> {
  const { data: settingsRow } = await serviceClient
    .from('settings')
    .select('weights, thresholds, profiles')
    .eq('user_id', userId)
    .single();

  const baseWeights = settingsRow?.weights
    ? { ...DEFAULT_WEIGHTS, ...JSON.parse(settingsRow.weights) }
    : { ...DEFAULT_WEIGHTS };
  const thresholds = settingsRow?.thresholds
    ? { critical: 25, risk: 50, watch: 65, healthy: 80, ...JSON.parse(settingsRow.thresholds) }
    : { critical: 25, risk: 50, watch: 65, healthy: 80 };

  // Check for scoring profile override
  let weights = baseWeights;
  if (scoringProfile && settingsRow?.profiles) {
    try {
      const profiles = JSON.parse(settingsRow.profiles);
      const match = profiles.find((p: any) => p.name === scoringProfile);
      if (match?.weights) weights = { ...DEFAULT_WEIGHTS, ...match.weights };
    } catch { /* use base weights */ }
  }

  return { weights, thresholds };
}

// ── Auto-rescore a customer and return the update fields ──
function buildRescoreUpdate(
  cust: Record<string, any>,
  weights: Record<string, number>
): Record<string, any> {
  const { score, status } = calcScoreServer(cust, weights);
  const update: Record<string, any> = { score, status };

  // Apply auto-stage lifecycle transition
  const custCopy = { ...cust, score, status };
  if (applyAutoStage(custCopy)) {
    update.lifecycle = custCopy.lifecycle;
  }

  // Append history entry
  let history: any[] = [];
  try { history = typeof cust.history === 'string' ? JSON.parse(cust.history) : (cust.history || []); } catch { history = []; }
  history.push({
    score,
    date: new Date().toISOString(),
    signals: {
      logins:    cust.logins    ?? null,
      adoption:  cust.adoption  ?? null,
      tickets:   cust.tickets   ?? null,
      nps:       cust.nps       ?? null,
      csat:      cust.csat      ?? null,
      days:      cust.days      ?? null,
      growth:    cust.growth    ?? null,
      lifecycle: custCopy.lifecycle ?? null,
      mrr:       cust.mrr       ?? null,
      arr:       cust.arr       ?? null,
    }
  });
  update.history = JSON.stringify(history);

  return update;
}

// ── Auto-stage: move lifecycle based on status ──
function applyAutoStage(customer: Record<string, any>): boolean {
  const lc = customer.lifecycle || 'active';
  if (lc === 'onboarding' || lc === 'won' || lc === 'churned') return false;
  const st = customer.status || 'healthy';
  if ((st === 'critical' || st === 'risk') && lc !== 'atrisk') {
    customer.lifecycle = 'atrisk';
    return true;
  }
  if (st !== 'critical' && st !== 'risk' && lc === 'atrisk') {
    customer.lifecycle = 'active';
    return true;
  }
  return false;
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

    // Resolve user's client_id for customer ownership
    const { data: userProfile } = await serviceClient
      .from('user_profiles')
      .select('client_id')
      .eq('user_id', userId)
      .single();
    const clientId = userProfile?.client_id || null;

    // ── Rate limiting ──
    const RATE_LIMITS: Record<string, { seconds: number; max: number }> = {
      minute: { seconds: 60, max: 60 },
      hour:   { seconds: 3600, max: 1000 },
    };

    for (const [windowType, cfg] of Object.entries(RATE_LIMITS)) {
      const { data: rl, error: rlErr } = await serviceClient.rpc('check_rate_limit', {
        p_user_id: userId,
        p_window_type: windowType,
        p_window_seconds: cfg.seconds,
        p_max_requests: cfg.max,
      });

      if (rlErr) {
        console.error('Rate limit check failed:', rlErr.message);
        continue; // Fail open: allow the request if rate-limit check errors
      }

      const check = Array.isArray(rl) ? rl[0] : rl;
      if (check && !check.allowed) {
        // Log the rate-limited attempt
        try {
          await serviceClient.from('webhook_events').insert({
            user_id:    userId,
            direction:  'inbound',
            event_type: 'rate_limited',
            payload:    JSON.stringify({ window: windowType, count: check.current_count, limit: cfg.max }),
            status:     'failed',
            error_msg:  `Rate limit exceeded: ${check.current_count}/${cfg.max} per ${windowType}`,
          });
        } catch { /* best-effort logging */ }

        return new Response(
          JSON.stringify({
            error: `Rate limit exceeded. You have made ${check.current_count} requests in the current ${windowType}. Limit: ${cfg.max} per ${windowType}.`,
            limit: cfg.max,
            window: windowType,
            retry_after: check.retry_after,
          }),
          {
            status: 429,
            headers: {
              ...getCorsHeaders(req),
              'Content-Type': 'application/json',
              'Retry-After': String(check.retry_after),
              'X-RateLimit-Limit': String(cfg.max),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + check.retry_after),
            },
          }
        );
      }
    }

    // ── Parse request: GET uses query params, POST uses JSON body ──
    let action: string;
    let data: Record<string, any>;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      action = url.searchParams.get('action') || '';
      data = Object.fromEntries(url.searchParams.entries());
      delete data.action; // action is separate
    } else {
      const body = await req.json();
      action = body.action || '';
      data = body.data || {};
    }

    if (!action) throw new Error('Missing action parameter');

    let result: Record<string, any> = {};
    let customerName = data.name || '';

    // ════════════════════════════════════════════════════════
    // ACTION: list_customers (GET/POST)
    // Paginated list with filters — ideal for Zapier polling
    // ════════════════════════════════════════════════════════
    if (action === 'list_customers') {
      const limit  = Math.min(validateNumber(data.limit  || 100, 1, 500, 'limit'),  500);
      const offset = validateNumber(data.offset || 0, 0, null, 'offset');
      const sortField = data.sort || 'updated_at';
      const sortOrder = data.order === 'asc' ? true : false; // false = desc (default)

      // Allowed sort fields
      const allowedSorts = ['updated_at', 'created_at', 'name', 'score', 'status', 'mrr', 'arr'];
      if (!allowedSorts.includes(sortField)) {
        throw new Error('Invalid sort field: ' + sortField + '. Allowed: ' + allowedSorts.join(', '));
      }

      // Build query
      let query = serviceClient
        .from('customers')
        .select('*', { count: 'exact' })
        .eq('client_id', clientId)
        .is('deleted_at', null);

      // Apply filters
      if (data.status)    query = query.eq('status', data.status);
      if (data.lifecycle) query = query.eq('lifecycle', data.lifecycle);
      if (data.tier)      query = query.eq('tier', data.tier);
      if (data.manager)   query = query.ilike('manager', data.manager);
      if (data.tag)       query = query.contains('tags', [data.tag]);

      // updated_since filter — key for Zapier polling triggers
      if (data.updated_since) {
        const since = validateDate(data.updated_since, 'updated_since');
        query = query.gte('updated_at', since);
      }

      // Sort + paginate
      query = query.order(sortField, { ascending: sortOrder })
                   .range(offset, offset + limit - 1);

      const { data: rows, error, count } = await query;
      if (error) throw error;

      result = {
        action: 'list_customers',
        customers: rows || [],
        total: count || 0,
        limit,
        offset
      };

    // ════════════════════════════════════════════════════════
    // ACTION: get_customer (GET/POST)
    // Single customer by ID or name
    // ════════════════════════════════════════════════════════
    } else if (action === 'get_customer') {
      if (!data.id && !data.name && !data.external_id) throw new Error('id, name, or external_id is required');

      let query = serviceClient
        .from('customers')
        .select('*')
        .eq('client_id', clientId)
        .is('deleted_at', null);

      if (data.id) {
        query = query.eq('id', data.id);
      } else if (data.external_id) {
        query = query.eq('external_id', data.external_id);
      } else {
        query = query.ilike('name', data.name);
      }

      const { data: rows, error } = await query.limit(1);
      if (error) throw error;
      if (!rows || !rows.length) throw new Error('Customer not found');

      customerName = rows[0].name;
      result = { action: 'get_customer', customer: rows[0] };

    // ════════════════════════════════════════════════════════
    // ACTION: upsert_account (POST)
    // ════════════════════════════════════════════════════════
    } else if (action === 'upsert_account') {
      if (!data.name && !data.external_id) throw new Error('Account name or external_id is required');

      // Match cascade: external_id → name (case-insensitive)
      let existing: any[] | null = null;
      if (data.external_id) {
        const { data: byExtId } = await serviceClient
          .from('customers')
          .select('*')
          .eq('client_id', clientId)
          .eq('external_id', data.external_id)
          .is('deleted_at', null)
          .limit(1);
        if (byExtId?.length) existing = byExtId;
      }
      if (!existing?.length && data.name) {
        const { data: byName } = await serviceClient
          .from('customers')
          .select('*')
          .eq('client_id', clientId)
          .ilike('name', data.name)
          .is('deleted_at', null)
          .limit(1);
        if (byName?.length) existing = byName;
      }

      // Build row with only the provided fields (validated)
      const row: Record<string, any> = {
        user_id: userId,
        client_id: clientId,
      };
      if (data.name) row.name = validateString(data.name, 255, 'name');
      if (data.external_id)        row.external_id = validateString(data.external_id, 255, 'external_id');
      if (data.stripe_customer_id) row.stripe_customer_id = validateString(data.stripe_customer_id, 255, 'stripe_customer_id');
      if (data.hubspot_company_id) row.hubspot_company_id = validateString(data.hubspot_company_id, 255, 'hubspot_company_id');
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

      // Check if any signal fields were provided (triggers auto-rescore)
      const hasSignalChange = SIGNAL_FIELDS.some(f => row[f] !== undefined);

      if (existing && existing.length > 0) {
        // Update existing customer — auto-rescore if signals changed
        if (hasSignalChange && data.score == null) {
          const merged = { ...existing[0], ...row };
          const { weights } = await getUserScoringConfig(serviceClient, userId!, merged.scoring_profile);
          const rescoreFields = buildRescoreUpdate(merged, weights);
          Object.assign(row, rescoreFields);
        }
        const { error } = await serviceClient
          .from('customers')
          .update(row)
          .eq('id', existing[0].id);
        if (error) throw error;
        result = { action: 'updated', id: existing[0].id, name: row.name || existing[0].name, score: row.score, status: row.status };
      } else {
        // Create new customer — name is required for new records
        if (!row.name) throw new Error('Account name is required when creating a new customer');
        row.id = crypto.randomUUID();
        row.created_at = new Date().toISOString();
        if (data.score == null) {
          if (hasSignalChange) {
            const { weights } = await getUserScoringConfig(serviceClient, userId!);
            const { score, status } = calcScoreServer(row, weights);
            row.score = score;
            row.status = status;
          } else {
            row.score = 0;
            row.status = 'healthy';
          }
        }
        const { error } = await serviceClient.from('customers').insert(row);
        if (error) throw error;
        result = { action: 'created', id: row.id, name: data.name, score: row.score, status: row.status };
      }

    // ════════════════════════════════════════════════════════
    // ACTION: update_health (POST)
    // ════════════════════════════════════════════════════════
    } else if (action === 'update_health') {
      if ((!data.name && !data.external_id) || !data.field) throw new Error('(name or external_id) and field are required');

      const allowedFields = [
        'score', 'nps', 'logins', 'adoption', 'tickets', 'days',
        'renewal_date', 'growth', 'mrr', 'arr', 'tier', 'lifecycle',
        'manager', 'next_touch', 'external_id', 'stripe_customer_id', 'hubspot_company_id'
      ];
      if (!allowedFields.includes(data.field)) {
        throw new Error('Invalid field: ' + data.field + '. Allowed: ' + allowedFields.join(', '));
      }

      // Find customer: external_id → name (cascade)
      let existing: any[] | null = null;
      if (data.external_id) {
        const { data: byExtId } = await serviceClient
          .from('customers')
          .select('*')
          .eq('client_id', clientId)
          .eq('external_id', data.external_id)
          .is('deleted_at', null)
          .limit(1);
        if (byExtId?.length) existing = byExtId;
      }
      if (!existing?.length && data.name) {
        const { data: byName } = await serviceClient
          .from('customers')
          .select('*')
          .eq('client_id', clientId)
          .ilike('name', data.name)
          .is('deleted_at', null)
          .limit(1);
        if (byName?.length) existing = byName;
      }

      if (!existing || !existing.length) throw new Error('Account not found: ' + (data.external_id || data.name));

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

      // If updating score directly, just update derived status
      if (data.field === 'score') {
        update.status = getStatusFromScore(validatedValue);
      }
      // If updating a signal field, auto-rescore the customer
      else if (SIGNAL_FIELDS.includes(data.field)) {
        const merged = { ...existing[0], [data.field]: validatedValue };
        const { weights } = await getUserScoringConfig(serviceClient, userId!, merged.scoring_profile);
        const rescoreFields = buildRescoreUpdate(merged, weights);
        Object.assign(update, rescoreFields);
      }

      const { error } = await serviceClient
        .from('customers')
        .update(update)
        .eq('id', existing[0].id);
      if (error) throw error;
      result = {
        action: 'updated', id: existing[0].id, field: data.field, value: data.value,
        score: update.score ?? existing[0].score, status: update.status ?? existing[0].status
      };

    // ════════════════════════════════════════════════════════
    // ACTION: delete_customer (POST)
    // Soft-delete: sets deleted_at timestamp
    // ════════════════════════════════════════════════════════
    } else if (action === 'delete_customer') {
      if (!data.id && !data.name) throw new Error('id or name is required');

      // Find customer
      let query = serviceClient
        .from('customers')
        .select('id, name')
        .eq('client_id', clientId)
        .is('deleted_at', null);

      if (data.id) {
        query = query.eq('id', data.id);
      } else {
        query = query.ilike('name', data.name);
      }

      const { data: existing } = await query.limit(1);
      if (!existing || !existing.length) throw new Error('Customer not found');

      const target = existing[0];
      customerName = target.name;

      // Soft-delete
      const { error } = await serviceClient
        .from('customers')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', target.id);
      if (error) throw error;

      result = { action: 'deleted', id: target.id, name: target.name };

    // ════════════════════════════════════════════════════════
    // ACTION: score_customer (POST)
    // Re-score using server-side weights, update status + history
    // ════════════════════════════════════════════════════════
    } else if (action === 'score_customer') {
      if (!data.id && !data.name) throw new Error('id or name is required');

      // Find customer (full row needed for scoring)
      let query = serviceClient
        .from('customers')
        .select('*')
        .eq('client_id', clientId)
        .is('deleted_at', null);

      if (data.id) {
        query = query.eq('id', data.id);
      } else {
        query = query.ilike('name', data.name);
      }

      const { data: existing } = await query.limit(1);
      if (!existing || !existing.length) throw new Error('Customer not found');

      const cust = existing[0];
      customerName = cust.name;
      const previousScore = cust.score;

      // Fetch user's scoring config (weights + profiles)
      const { weights } = await getUserScoringConfig(serviceClient, userId!, cust.scoring_profile);

      // Run scoring engine + build update with history
      const { score, status, signals } = calcScoreServer(cust, weights);
      const update = buildRescoreUpdate(cust, weights);

      // Persist
      const { error } = await serviceClient
        .from('customers')
        .update(update)
        .eq('id', cust.id);
      if (error) throw error;

      result = {
        action: 'scored',
        id: cust.id,
        name: cust.name,
        score,
        status,
        previous_score: previousScore,
        lifecycle: update.lifecycle || cust.lifecycle,
        signals
      };

    } else {
      throw new Error(
        'Unknown action: ' + action +
        '. Supported: list_customers, get_customer, upsert_account, update_health, delete_customer, score_customer'
      );
    }

    // ── Log the inbound event ──
    await serviceClient.from('webhook_events').insert({
      user_id:       userId,
      direction:     'inbound',
      event_type:    action,
      payload:       JSON.stringify(req.method === 'GET' ? { action, ...data } : { action, data }),
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

    // Sanitize error: only return known safe messages, never internal details
    const safeMessages = ['Invalid API key', 'Missing x-api-key header', 'Missing action', 'Unknown action', 'Customer not found', 'Name is required'];
    const msg = safeMessages.find(m => err.message?.includes(m)) || 'Request failed. Check your parameters and try again.';
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});

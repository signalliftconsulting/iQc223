// ═══════════════════════════════════════════════════════════════
// stripe-history — Supabase Edge Function
// Pulls historical Stripe data (customers, subscriptions, invoices, events)
// and builds daily signal snapshots per customer
// Called by: sb.functions.invoke('stripe-history', { body: { lookback: '90d' } })
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
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-f0-9]+\.iqcadence\.pages\.dev$/.test(origin);
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

// ── Lookback period calculation ──

function parseLookback(lookback: string): number {
  switch (lookback) {
    case '30d': return 30;
    case '90d': return 90;
    case '6mo': return 180;
    case '1yr': return 365;
    default: return 90;
  }
}

function getStartDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Stripe API helpers (same pattern as stripe-sync) ──

async function getStripeKey(serviceClient: any, integration: any): Promise<string> {
  if (integration.vault_secret_id) {
    const { data, error } = await serviceClient
      .rpc('vault_read_secret', { secret_id: integration.vault_secret_id });
    if (!error && data) return data;
  }
  if (integration.config?._credential) return integration.config._credential;
  throw new Error('No Stripe API key found. Please reconnect your Stripe integration.');
}

// Helper: fetch with timeout
function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function stripeFetchAll(stripeKey: string, path: string, params: Record<string, string> = {}): Promise<any[]> {
  const all: any[] = [];
  let hasMore = true;
  let startingAfter: string | null = null;

  while (hasMore) {
    const searchParams = new URLSearchParams({ limit: '100', ...params });
    if (startingAfter) searchParams.set('starting_after', startingAfter);
    const url = `https://api.stripe.com/v1/${path}?${searchParams.toString()}`;

    const resp = await fetchWithTimeout(url, {
      headers: { 'Authorization': `Bearer ${stripeKey}` }
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(`Stripe API error (${path}): ${body?.error?.message || resp.status}`);
    }
    const data = await resp.json();
    all.push(...(data.data || []));
    hasMore = data.has_more || false;
    if (data.data?.length) startingAfter = data.data[data.data.length - 1].id;
  }
  return all;
}

// ── Snapshot types ──

interface Snapshot {
  date: string;
  score: number | null;
  signals: {
    mrr: number | null;
    tickets: number | null;
    nps: number | null;
    csat: number | null;
    logins: number | null;
    adoption: number | null;
    days: number | null;
    growth: string | null;
    lifecycle: string | null;
  };
}

// ── Subscription timeline helpers ──

interface SubPeriod {
  customerId: string;
  subscriptionId: string;
  status: string;
  mrrCents: number; // monthly amount in cents
  interval: string;
  startTs: number; // unix seconds
  endTs: number | null; // unix seconds, null = still active
}

/**
 * Calculate MRR in dollars from subscription items
 */
function calculateSubMrrCents(sub: any): number {
  if (!sub?.items?.data) return 0;
  return sub.items.data.reduce((sum: number, item: any) => {
    const price = item.price;
    if (!price?.recurring) return sum;
    const unitAmount = price.unit_amount || 0;
    const quantity = item.quantity || 1;
    const interval = price.recurring.interval;
    const intervalCount = price.recurring.interval_count || 1;
    let monthly = unitAmount * quantity;
    if (interval === 'year') monthly = monthly / (12 * intervalCount);
    else if (interval === 'week') monthly = monthly * (52 / 12) / intervalCount;
    else if (interval === 'day') monthly = monthly * (365.25 / 12) / intervalCount;
    else monthly = monthly / intervalCount;
    return sum + Math.round(monthly);
  }, 0);
}

function getSubInterval(sub: any): string {
  const firstItem = sub?.items?.data?.[0]?.price?.recurring;
  if (!firstItem) return '';
  const interval = firstItem.interval || '';
  const count = firstItem.interval_count || 1;
  if (interval === 'month' && count === 1) return 'monthly';
  if (interval === 'month' && count === 3) return 'quarterly';
  if (interval === 'year') return 'annual';
  if (interval === 'week') return 'weekly';
  return interval ? `${count}-${interval}` : '';
}

function buildCustomerSnapshots(
  customerId: string,
  subscriptions: any[],
  events: any[],
  startDate: Date,
  endDate: Date
): Snapshot[] {
  // Build a timeline of subscription states for this customer
  const custSubs = subscriptions.filter(s => {
    const cid = typeof s.customer === 'string' ? s.customer : s.customer?.id;
    return cid === customerId;
  });
  const custEvents = events.filter(e => {
    const cid = e.data?.object?.customer;
    return cid === customerId;
  });

  // Sort events by created timestamp
  custEvents.sort((a, b) => a.created - b.created);

  let prevSnapshot: string | null = null;
  const snapshots: Snapshot[] = [];

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dayStr = d.toISOString().split('T')[0];
    const dayTs = Math.floor(d.getTime() / 1000); // unix seconds

    // Calculate MRR on this day: sum of active subscriptions at this point
    let totalMrrCents = 0;
    let hasActiveSub = false;
    let hasCanceledSub = false;
    let hasPastDueSub = false;
    let billingInterval = '';

    for (const sub of custSubs) {
      const startTs = sub.start_date || sub.created;
      if (startTs > dayTs) continue; // subscription hadn't started yet

      // Determine subscription status on this day
      let statusOnDay = sub.status;

      // Check if subscription was canceled before this day
      if (sub.canceled_at && sub.canceled_at <= dayTs) {
        // If cancel_at_period_end, sub may still be active until period end
        if (sub.cancel_at_period_end && sub.current_period_end && sub.current_period_end > dayTs) {
          statusOnDay = 'active'; // still active until period end
        } else {
          statusOnDay = 'canceled';
        }
      }

      // Check ended_at
      if (sub.ended_at && sub.ended_at <= dayTs) {
        statusOnDay = 'canceled';
      }

      if (statusOnDay === 'active' || statusOnDay === 'trialing') {
        totalMrrCents += calculateSubMrrCents(sub);
        hasActiveSub = true;
        if (!billingInterval) billingInterval = getSubInterval(sub);
      } else if (statusOnDay === 'past_due') {
        totalMrrCents += calculateSubMrrCents(sub);
        hasPastDueSub = true;
      } else if (statusOnDay === 'canceled') {
        hasCanceledSub = true;
      }
    }

    const mrr = totalMrrCents > 0 ? Math.round(totalMrrCents / 100) : null;

    // Lifecycle from subscription status
    let lifecycle: string = 'churned';
    if (hasActiveSub) lifecycle = 'active';
    else if (hasPastDueSub) lifecycle = 'atrisk';
    else if (hasCanceledSub) lifecycle = 'churned';

    // Growth: check events in a 30-day window ending on this day
    let growth: string = 'none';
    const windowStartTs = dayTs - 30 * 24 * 60 * 60;
    for (const event of custEvents) {
      if (event.created < windowStartTs || event.created > dayTs) continue;
      const eventType = event.type || '';
      if (eventType === 'customer.subscription.updated') {
        // Check if it's an upgrade (amount increased)
        const prevAttrs = event.data?.previous_attributes;
        if (prevAttrs?.items || prevAttrs?.plan) {
          growth = 'strong'; // subscription changed — treat as upgrade signal
          break;
        }
      } else if (eventType === 'customer.subscription.created') {
        if (growth !== 'strong') growth = 'mild';
      }
    }

    // Only emit if customer has any subscription data
    const hasData = mrr !== null || hasActiveSub || hasCanceledSub || hasPastDueSub;
    if (!hasData) continue;

    const snapshotKey = `${mrr}|${lifecycle}|${growth}`;

    if (snapshotKey !== prevSnapshot) {
      snapshots.push({
        date: dayStr + 'T00:00:00Z',
        score: null,
        signals: {
          mrr,
          tickets: null,
          nps: null,
          csat: null,
          logins: null,
          adoption: null,
          days: null,
          growth,
          lifecycle,
        },
      });
      prevSnapshot = snapshotKey;
    }
  }

  return snapshots;
}

// ── Main handler ──

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    console.log('[stripe-history] Starting...');

    // ── Verify JWT ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');
    console.log('[stripe-history] User:', user.id);

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Resolve client_id
    const { data: profile } = await serviceClient
      .from('user_profiles')
      .select('client_id')
      .eq('user_id', user.id)
      .single();
    if (!profile?.client_id) throw new Error('No client found for user');
    const clientId = profile.client_id;
    console.log('[stripe-history] Client:', clientId);

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const lookback = body.lookback || '90d';
    const lookbackDays = parseLookback(lookback);
    const startDate = getStartDate(lookbackDays);
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    const startTimestamp = Math.floor(startDate.getTime() / 1000);
    console.log('[stripe-history] Lookback:', lookback, '→', lookbackDays, 'days, range:', startDateStr, 'to', endDateStr);

    // Load Stripe integration
    let integration: any = null;
    const { data: integ1 } = await serviceClient
      .from('integrations')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', 'stripe')
      .single();
    integration = integ1;

    if (!integration || integration.status !== 'connected') {
      console.log('[stripe-history] client_id lookup missed, trying RLS fallback...');
      const { data: integ2 } = await supabase
        .from('integrations')
        .select('*')
        .eq('platform', 'stripe')
        .eq('status', 'connected')
        .single();
      if (integ2) {
        integration = integ2;
        if (integ2.client_id !== clientId) {
          await serviceClient.from('integrations').update({ client_id: clientId }).eq('id', integ2.id);
          console.log('[stripe-history] Fixed client_id mismatch');
        }
      }
    }

    if (!integration || integration.status !== 'connected') {
      throw new Error('Stripe is not connected. Go to Settings → API & Integrations to connect.');
    }

    const stripeKey = await getStripeKey(serviceClient, integration);
    console.log('[stripe-history] API key retrieved');

    // ── Fetch Stripe data ──
    const errors: string[] = [];
    let customers: any[] = [];
    let subscriptions: any[] = [];
    let events: any[] = [];

    try {
      customers = await stripeFetchAll(stripeKey, 'customers');
      console.log('[stripe-history] Customers:', customers.length);
    } catch (e) { errors.push(`Customers: ${e.message}`); }

    try {
      // Fetch all subscriptions (including canceled) — we need the full history
      // Use status=all to get canceled/past_due subs too
      subscriptions = await stripeFetchAll(stripeKey, 'subscriptions', {
        status: 'all',
        'expand[]': 'data.items.data.price',
      });
      console.log('[stripe-history] Subscriptions:', subscriptions.length);
    } catch (e) {
      // Fallback: try without expand if the API version doesn't support it in list
      try {
        subscriptions = await stripeFetchAll(stripeKey, 'subscriptions', { status: 'all' });
        console.log('[stripe-history] Subscriptions (no expand):', subscriptions.length);
      } catch (e2) { errors.push(`Subscriptions: ${e2.message}`); }
    }

    try {
      events = await stripeFetchAll(stripeKey, 'events', {
        'created[gte]': String(startTimestamp),
        type: 'customer.subscription.created',
      });
      // Also fetch subscription update events
      const updateEvents = await stripeFetchAll(stripeKey, 'events', {
        'created[gte]': String(startTimestamp),
        type: 'customer.subscription.updated',
      });
      // Also fetch subscription deletion events
      const deleteEvents = await stripeFetchAll(stripeKey, 'events', {
        'created[gte]': String(startTimestamp),
        type: 'customer.subscription.deleted',
      });
      events = [...events, ...updateEvents, ...deleteEvents];
      console.log('[stripe-history] Events:', events.length);
    } catch (e) { errors.push(`Events: ${e.message}`); }

    if (errors.length) console.warn('[stripe-history] Partial fetch errors:', errors.join('; '));

    // Build a set of customer IDs that have subscriptions
    const customerIdsWithSubs = new Set<string>();
    for (const sub of subscriptions) {
      const cid = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
      if (cid) customerIdsWithSubs.add(cid);
    }

    // Also include customers referenced in events
    for (const event of events) {
      const cid = event.data?.object?.customer;
      if (cid) customerIdsWithSubs.add(cid);
    }

    // Build customer name map
    const customerMap = new Map<string, any>();
    for (const cust of customers) {
      customerMap.set(cust.id, cust);
    }

    console.log('[stripe-history] Customers with subscription data:', customerIdsWithSubs.size);

    // ── Build snapshots per customer ──
    const result: any[] = [];
    let totalSnapshots = 0;

    for (const customerId of customerIdsWithSubs) {
      const cust = customerMap.get(customerId);
      const name = cust?.name || cust?.email || customerId;

      const snapshots = buildCustomerSnapshots(
        customerId,
        subscriptions,
        events,
        startDate,
        endDate
      );

      if (snapshots.length === 0) continue;

      result.push({
        name,
        external_id: customerId,
        history: snapshots,
      });
      totalSnapshots += snapshots.length;
    }

    console.log('[stripe-history] Built snapshots for', result.length, 'customers,', totalSnapshots, 'total snapshots');

    return new Response(JSON.stringify({
      customers: result,
      stats: {
        customers: result.length,
        snapshots: totalSnapshots,
        dateRange: { from: startDateStr, to: endDateStr },
      },
    }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[stripe-history] ERROR:', err.message, err.stack);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 200,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});

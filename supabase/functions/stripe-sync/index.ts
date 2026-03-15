// ═══════════════════════════════════════════════════════════════
// stripe-sync — Supabase Edge Function
// On-demand sync: pulls Stripe subscriptions, matches to existing
// customers, updates MRR/tier/growth signals
// Called by: sb.functions.invoke('stripe-sync', { body: {} })
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

// Calculate MRR from Stripe subscription items
function calculateMRR(subscription: any): number {
  if (!subscription?.items?.data) return 0;
  return subscription.items.data.reduce((sum: number, item: any) => {
    const price = item.price;
    if (!price?.recurring) return sum;
    const unitAmount = (price.unit_amount || 0) / 100; // cents → dollars
    const quantity = item.quantity || 1;
    const interval = price.recurring.interval;
    const intervalCount = price.recurring.interval_count || 1;
    // Normalize to monthly
    let monthly = unitAmount * quantity;
    if (interval === 'year') monthly = monthly / (12 * intervalCount);
    else if (interval === 'week') monthly = monthly * (52 / 12) / intervalCount;
    else if (interval === 'day') monthly = monthly * (365.25 / 12) / intervalCount;
    else monthly = monthly / intervalCount; // month
    return sum + Math.round(monthly * 100) / 100;
  }, 0);
}

// Detect tier from Stripe price nickname or product name
function detectTier(subscription: any, productsMap: Map<string, any>): string | null {
  for (const item of (subscription?.items?.data || [])) {
    const price = item.price;
    if (!price) continue;
    // Check price nickname (always available)
    const nickname = (price.nickname || '').toLowerCase();
    if (nickname.includes('enterprise')) return 'enterprise';
    if (nickname.includes('mid') || nickname.includes('business') || nickname.includes('professional') || nickname.includes('pro')) return 'mid';
    if (nickname.includes('starter') || nickname.includes('basic') || nickname.includes('smb')) return 'smb';
    // Look up product from pre-fetched products map
    const productId = typeof price.product === 'string' ? price.product : price.product?.id;
    const product = productId ? productsMap.get(productId) : null;
    if (product) {
      const metaTier = (product.metadata?.tier || '').toLowerCase();
      if (['enterprise', 'mid', 'smb'].includes(metaTier)) return metaTier;
      const name = (product.name || '').toLowerCase();
      if (name.includes('enterprise')) return 'enterprise';
      if (name.includes('mid') || name.includes('business') || name.includes('professional') || name.includes('pro')) return 'mid';
      if (name.includes('starter') || name.includes('basic') || name.includes('smb')) return 'smb';
    }
  }
  return null;
}

// Detect growth signal by comparing MRR
function detectGrowth(newMrr: number, oldMrr: number): string {
  if (oldMrr === 0 && newMrr > 0) return 'strong'; // revenue appeared (new or restored)
  if (oldMrr === 0) return 'none';
  const pctChange = ((newMrr - oldMrr) / oldMrr) * 100;
  if (pctChange >= 10) return 'strong';
  if (pctChange >= 1) return 'mild';
  if (pctChange <= -10) return 'none';
  return 'none';
}

// Retrieve Stripe API key from Vault or config fallback
async function getStripeKey(serviceClient: any, integration: any): Promise<string> {
  if (integration.vault_secret_id) {
    const { data, error } = await serviceClient
      .rpc('vault_read_secret', { secret_id: integration.vault_secret_id });
    if (!error && data) return data;
  }
  // Fallback: stored directly in config (if Vault wasn't available)
  if (integration.config?._credential) return integration.config._credential;
  throw new Error('No Stripe API key found. Please reconnect your Stripe integration.');
}

// Fetch all active subscriptions from Stripe (with pagination)
async function fetchAllSubscriptions(stripeKey: string): Promise<any[]> {
  const all: any[] = [];
  let hasMore = true;
  let startingAfter: string | null = null;

  while (hasMore) {
    let url = 'https://api.stripe.com/v1/subscriptions?status=active&limit=100';
    url += '&expand[]=data.customer&expand[]=data.items.data.price';
    if (startingAfter) url += `&starting_after=${startingAfter}`;

    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${stripeKey}` }
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(`Stripe API error: ${body?.error?.message || resp.status}`);
    }
    const data = await resp.json();
    all.push(...(data.data || []));
    hasMore = data.has_more || false;
    if (data.data?.length) startingAfter = data.data[data.data.length - 1].id;
  }
  return all;
}

// Fetch all products from Stripe (for tier detection by product name)
async function fetchAllProducts(stripeKey: string): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  let hasMore = true;
  let startingAfter: string | null = null;

  while (hasMore) {
    let url = 'https://api.stripe.com/v1/products?limit=100&active=true';
    if (startingAfter) url += `&starting_after=${startingAfter}`;

    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${stripeKey}` }
    });
    if (!resp.ok) break; // Non-critical — tier detection falls back to nickname
    const data = await resp.json();
    for (const p of (data.data || [])) map.set(p.id, p);
    hasMore = data.has_more || false;
    if (data.data?.length) startingAfter = data.data[data.data.length - 1].id;
  }
  return map;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
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

    // Load Stripe integration (try by client_id first, fall back to RLS-scoped query)
    let integration: any = null;
    const { data: integ1 } = await serviceClient
      .from('integrations')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', 'stripe')
      .single();
    integration = integ1;

    if (!integration || integration.status !== 'connected') {
      console.log('[stripe-sync] client_id lookup missed, trying RLS fallback...');
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
          console.log('[stripe-sync] Fixed client_id mismatch');
        }
      }
    }

    if (!integration || integration.status !== 'connected') {
      throw new Error('Stripe is not connected. Go to Settings → API & Integrations to connect.');
    }

    // Get Stripe API key
    const stripeKey = await getStripeKey(serviceClient, integration);

    // Fetch all active subscriptions + products (for tier detection)
    const subscriptions = await fetchAllSubscriptions(stripeKey);
    const productsMap = await fetchAllProducts(stripeKey);

    // Load all existing customers for this client
    const { data: customers } = await serviceClient
      .from('customers')
      .select('id, name, mrr, arr, tier, growth, billing_interval, stripe_customer_id, external_id, renewal_date, renewal')
      .eq('client_id', clientId)
      .is('deleted_at', null);

    if (!customers) throw new Error('Failed to load customers');

    // Build lookup maps
    const byStripeId = new Map<string, any>();
    const byExtId = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const c of customers) {
      if (c.stripe_customer_id) byStripeId.set(c.stripe_customer_id, c);
      if (c.external_id) byExtId.set(c.external_id.toLowerCase(), c);
      byName.set(c.name.toLowerCase().trim(), c);
    }

    const stats = { total: subscriptions.length, matched: 0, updated: 0, skipped: 0, customers_matched: 0 };
    const updates: any[] = [];

    // ── Phase 1: Group subscriptions by matched customer ──
    // A customer may have multiple Stripe subscriptions — we need to
    // aggregate MRR, pick the best tier, and the latest renewal date
    const grouped = new Map<string, { customer: any; subs: any[]; stripeCustomerId: string }>();

    for (const sub of subscriptions) {
      const stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
      const stripeCustomerName = (typeof sub.customer === 'object' ? sub.customer?.name : '') || '';
      const stripeCustomerEmail = (typeof sub.customer === 'object' ? sub.customer?.email : '') || '';

      // Match cascade: stripe_customer_id → external_id → name
      let match = byStripeId.get(stripeCustomerId);
      if (!match && stripeCustomerEmail) match = byExtId.get(stripeCustomerEmail.toLowerCase());
      if (!match && stripeCustomerName) match = byName.get(stripeCustomerName.toLowerCase().trim());

      if (!match) {
        stats.skipped++;
        continue;
      }

      stats.matched++;

      const key = match.id;
      if (!grouped.has(key)) {
        grouped.set(key, { customer: match, subs: [], stripeCustomerId: stripeCustomerId || '' });
      }
      grouped.get(key)!.subs.push(sub);
      // Keep the stripe customer ID if we have one
      if (stripeCustomerId) grouped.get(key)!.stripeCustomerId = stripeCustomerId;
    }

    stats.customers_matched = grouped.size;

    // ── Phase 2: Aggregate per customer and build updates ──
    // Respect metric toggles from integration config (default: sync everything)
    const syncMetrics = integration.config?.sync_metrics || {};
    const shouldSync = (metric: string) => syncMetrics[metric] !== false;
    const TIER_RANK: Record<string, number> = { enterprise: 3, mid: 2, smb: 1 };

    for (const [, group] of grouped) {
      const match = group.customer;

      // Sum MRR across all subscriptions
      let totalMrr = 0;
      let bestTier: string | null = null;
      let latestRenewal = '';
      const billingIntervals = new Set<string>();

      for (const sub of group.subs) {
        totalMrr += calculateMRR(sub);

        // Detect tier — keep the highest-ranked one
        const tier = detectTier(sub, productsMap);
        if (tier && (!bestTier || (TIER_RANK[tier] || 0) > (TIER_RANK[bestTier] || 0))) {
          bestTier = tier;
        }

        // Renewal date — calculate next billing date
        // Newer Stripe API versions don't include current_period_end on subscriptions
        // Use billing_cycle_anchor + interval to calculate next renewal
        const firstItem = sub.items?.data?.[0]?.price?.recurring;
        const interval = firstItem?.interval || '';
        const intervalCount = firstItem?.interval_count || 1;

        let nextRenewal = '';
        if (sub.current_period_end) {
          // Legacy API: use current_period_end directly
          nextRenewal = new Date(sub.current_period_end * 1000).toISOString().split('T')[0];
        } else if (sub.billing_cycle_anchor && interval) {
          // New API: calculate from billing_cycle_anchor + interval
          const anchor = new Date(sub.billing_cycle_anchor * 1000);
          const now = new Date();
          // Advance the anchor by intervals until it's in the future
          while (anchor <= now) {
            if (interval === 'month') anchor.setMonth(anchor.getMonth() + intervalCount);
            else if (interval === 'year') anchor.setFullYear(anchor.getFullYear() + intervalCount);
            else if (interval === 'week') anchor.setDate(anchor.getDate() + 7 * intervalCount);
            else if (interval === 'day') anchor.setDate(anchor.getDate() + intervalCount);
            else break;
          }
          nextRenewal = anchor.toISOString().split('T')[0];
        }
        if (nextRenewal && (!latestRenewal || nextRenewal > latestRenewal)) {
          latestRenewal = nextRenewal;
        }
        // Detect billing interval
        if (interval === 'month' && intervalCount === 1) billingIntervals.add('monthly');
        else if (interval === 'month' && intervalCount === 3) billingIntervals.add('quarterly');
        else if (interval === 'year') billingIntervals.add('annual');
        else if (interval === 'week') billingIntervals.add('weekly');
        else if (interval) billingIntervals.add(`${intervalCount}-${interval}`);
      }

      const newMrr = Math.round(totalMrr);
      const newArr = newMrr * 12;
      const newGrowth = detectGrowth(newMrr, match.mrr || 0);

      // Only update if something changed AND metric toggle is enabled
      const changes: any = {};
      if (shouldSync('mrr') && newMrr !== (match.mrr || 0)) changes.mrr = newMrr;
      if (shouldSync('mrr') && newArr !== (match.arr || 0)) changes.arr = newArr;
      if (shouldSync('tier') && bestTier && bestTier !== match.tier) changes.tier = bestTier;
      if (shouldSync('growth') && newGrowth !== match.growth) changes.growth = newGrowth;
      if (shouldSync('renewal') && latestRenewal) {
        changes.renewal_date = latestRenewal;
        const msToRenewal = new Date(latestRenewal).getTime() - Date.now();
        changes.renewal = Math.max(0, Math.round(msToRenewal / (1000 * 60 * 60 * 24 * 30.44)));
      }

      // Set billing interval field
      if (shouldSync('billing') && billingIntervals.size > 0) {
        const newInterval = [...billingIntervals].sort().join(',');
        if (newInterval !== (match.billing_interval || '')) changes.billing_interval = newInterval;
      }

      if (group.stripeCustomerId && group.stripeCustomerId !== match.stripe_customer_id) {
        changes.stripe_customer_id = group.stripeCustomerId;
      }

      if (Object.keys(changes).length > 0) {
        const prev: any = {};
        for (const k of Object.keys(changes)) prev[k] = match[k] ?? null;
        updates.push({ id: match.id, name: match.name, changes, prev });
        stats.updated++;
      }
    }

    // Apply updates
    for (const upd of updates) {
      await serviceClient
        .from('customers')
        .update(upd.changes)
        .eq('id', upd.id);
    }

    // Update integration status
    await serviceClient
      .from('integrations')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'success',
        last_sync_message: `${stats.customers_matched} customers matched (${stats.total} subscriptions), ${stats.updated} updated`,
        sync_stats: stats,
        updated_at: new Date().toISOString()
      })
      .eq('client_id', clientId)
      .eq('platform', 'stripe');

    // Log event
    try { await serviceClient.from('webhook_events').insert({
      user_id: user.id,
      direction: 'inbound',
      event_type: 'stripe_sync',
      payload: JSON.stringify({ stats, updates: updates.map(u => ({ name: u.name, ...u.changes })) }),
      status: 'success',
      status_code: 200
    }); } catch(_) {}

    return new Response(JSON.stringify({
      success: true,
      action: 'stripe_sync',
      stats,
      updates: updates.map(u => ({ name: u.name, _action: 'updated', _prev: u.prev || {}, ...u.changes })),
      created: [],
    }), { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});

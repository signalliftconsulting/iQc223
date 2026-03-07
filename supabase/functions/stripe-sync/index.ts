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

// Detect tier from Stripe price nickname or product name (if product is expanded)
function detectTier(subscription: any): string | null {
  for (const item of (subscription?.items?.data || [])) {
    const price = item.price;
    if (!price) continue;
    // Check price nickname (always available)
    const nickname = (price.nickname || '').toLowerCase();
    if (nickname.includes('enterprise')) return 'enterprise';
    if (nickname.includes('mid') || nickname.includes('business') || nickname.includes('professional') || nickname.includes('pro')) return 'mid';
    if (nickname.includes('starter') || nickname.includes('basic') || nickname.includes('smb')) return 'smb';
    // Check product if it's an expanded object (not just a string ID)
    const product = price.product;
    if (product && typeof product === 'object') {
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
  if (oldMrr === 0) return 'none';
  const pctChange = ((newMrr - oldMrr) / oldMrr) * 100;
  if (pctChange >= 10) return 'strong';
  if (pctChange >= 1) return 'moderate';
  if (pctChange <= -10) return 'none'; // downgrade — could be flagged differently
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

    // Load Stripe integration
    const { data: integration } = await serviceClient
      .from('integrations')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', 'stripe')
      .single();

    if (!integration || integration.status !== 'connected') {
      throw new Error('Stripe is not connected. Go to Settings → API & Integrations to connect.');
    }

    // Get Stripe API key
    const stripeKey = await getStripeKey(serviceClient, integration);

    // Fetch all active subscriptions
    const subscriptions = await fetchAllSubscriptions(stripeKey);

    // Load all existing customers for this client
    const { data: customers } = await serviceClient
      .from('customers')
      .select('id, name, mrr, arr, tier, growth, tags, stripe_customer_id, external_id, renewal_date, renewal')
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

    const stats = { total: subscriptions.length, matched: 0, updated: 0, skipped: 0 };
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

    // ── Phase 2: Aggregate per customer and build updates ──
    const TIER_RANK: Record<string, number> = { enterprise: 3, mid: 2, smb: 1 };

    for (const [, group] of grouped) {
      const match = group.customer;

      // Sum MRR across all subscriptions
      let totalMrr = 0;
      let bestTier: string | null = null;
      let latestRenewal = '';
      const billingTags = new Set<string>();

      for (const sub of group.subs) {
        totalMrr += calculateMRR(sub);

        // Detect tier — keep the highest-ranked one
        const tier = detectTier(sub);
        if (tier && (!bestTier || (TIER_RANK[tier] || 0) > (TIER_RANK[bestTier] || 0))) {
          bestTier = tier;
        }

        // Renewal date — keep the latest (furthest in the future)
        const periodEnd = sub.current_period_end;
        if (periodEnd) {
          const rd = new Date(periodEnd * 1000).toISOString().split('T')[0];
          if (!latestRenewal || rd > latestRenewal) latestRenewal = rd;
        }

        // Billing interval tag
        const firstItem = sub.items?.data?.[0]?.price?.recurring;
        const interval = firstItem?.interval || '';
        const intervalCount = firstItem?.interval_count || 1;
        if (interval === 'month' && intervalCount === 1) billingTags.add('monthly');
        else if (interval === 'month' && intervalCount === 3) billingTags.add('quarterly');
        else if (interval === 'year') billingTags.add('annual');
        else if (interval === 'week') billingTags.add('weekly');
        else if (interval) billingTags.add(`${intervalCount}-${interval}`);
      }

      const newMrr = Math.round(totalMrr);
      const newArr = newMrr * 12;
      const newGrowth = detectGrowth(newMrr, match.mrr || 0);

      // Only update if something changed
      const changes: any = {};
      if (newMrr !== (match.mrr || 0)) changes.mrr = newMrr;
      if (newArr !== (match.arr || 0)) changes.arr = newArr;
      if (bestTier && bestTier !== match.tier) changes.tier = bestTier;
      if (newGrowth !== match.growth) changes.growth = newGrowth;
      if (latestRenewal && latestRenewal !== (match.renewal_date || '')) {
        changes.renewal_date = latestRenewal;
        const msToRenewal = new Date(latestRenewal).getTime() - Date.now();
        changes.renewal = Math.max(0, Math.round(msToRenewal / (1000 * 60 * 60 * 24 * 30.44)));
      }

      // Add billing interval tags
      if (billingTags.size > 0) {
        const existingTags = (match.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean);
        const allBillingTags = ['monthly', 'quarterly', 'annual', 'weekly'];
        const cleaned = existingTags.filter((t: string) => !allBillingTags.includes(t.toLowerCase()));
        for (const bt of billingTags) cleaned.push(bt);
        const newTagStr = cleaned.join(',');
        if (newTagStr !== (match.tags || '')) changes.tags = newTagStr;
      }

      if (group.stripeCustomerId && group.stripeCustomerId !== match.stripe_customer_id) {
        changes.stripe_customer_id = group.stripeCustomerId;
      }

      // Build debug breakdown for this customer
      const subBreakdown = group.subs.map(sub => ({
        sub_id: sub.id,
        stripe_customer: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
        mrr: Math.round(calculateMRR(sub) * 100) / 100,
        period_end: sub.current_period_end,
        period_end_date: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString().split('T')[0] : null,
        items: (sub.items?.data || []).map((it: any) => ({
          amount: (it.price?.unit_amount || 0) / 100,
          qty: it.quantity || 1,
          interval: it.price?.recurring?.interval,
          interval_count: it.price?.recurring?.interval_count
        }))
      }));

      if (Object.keys(changes).length > 0) {
        updates.push({ id: match.id, name: match.name, changes, _debug: { totalMrr, latestRenewal, subCount: group.subs.length, subs: subBreakdown } });
        stats.updated++;
      } else {
        // Even if no changes, include in debug for visibility
        updates.push({ id: match.id, name: match.name, changes: {}, _debug: { totalMrr, latestRenewal, subCount: group.subs.length, subs: subBreakdown, noChanges: true } });
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
        last_sync_message: `Synced ${stats.matched} of ${stats.total} subscriptions, ${stats.updated} updated`,
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
      updates: updates.map(u => ({ name: u.name, ...u.changes }))
    }), { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});

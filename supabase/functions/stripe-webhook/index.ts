// ═══════════════════════════════════════════════════════════════
// stripe-webhook — Supabase Edge Function
// Receives Stripe webhook events for real-time subscription updates
// Verifies Stripe signature, updates matched customers
// Called by: Stripe → POST /functions/v1/stripe-webhook?client_id=xxx
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Stripe signature verification (HMAC-SHA256) ──
async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
  toleranceSec = 300
): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const pair of sigHeader.split(',')) {
    const [k, v] = pair.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (!timestamp || !signature) return false;

  // Reject if older than tolerance
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > toleranceSec) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const computed = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === signature;
}

// Calculate MRR from subscription items
function calculateMRR(subscription: any): number {
  if (!subscription?.items?.data) return 0;
  return subscription.items.data.reduce((sum: number, item: any) => {
    const price = item.price;
    if (!price?.recurring) return sum;
    const unitAmount = (price.unit_amount || 0) / 100;
    const quantity = item.quantity || 1;
    const interval = price.recurring.interval;
    const intervalCount = price.recurring.interval_count || 1;
    let monthly = unitAmount * quantity;
    if (interval === 'year') monthly = monthly / (12 * intervalCount);
    else if (interval === 'week') monthly = monthly * (52 / 12) / intervalCount;
    else if (interval === 'day') monthly = monthly * (365.25 / 12) / intervalCount;
    else monthly = monthly / intervalCount;
    return sum + Math.round(monthly * 100) / 100;
  }, 0);
}

// Detect tier from product metadata or name
function detectTier(subscription: any): string | null {
  for (const item of (subscription?.items?.data || [])) {
    const product = item.price?.product;
    if (!product) continue;
    const metaTier = (product.metadata?.tier || '').toLowerCase();
    if (['enterprise', 'mid', 'smb'].includes(metaTier)) return metaTier;
    const name = (product.name || '').toLowerCase();
    if (name.includes('enterprise')) return 'enterprise';
    if (name.includes('mid') || name.includes('business') || name.includes('professional') || name.includes('pro')) return 'mid';
    if (name.includes('starter') || name.includes('basic') || name.includes('smb')) return 'smb';
  }
  return null;
}

serve(async (req) => {
  // Stripe webhooks are POST only, no CORS needed (no origin list needed here)
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // Get client_id from query param
    const url = new URL(req.url);
    const clientId = url.searchParams.get('client_id');
    if (!clientId) throw new Error('Missing client_id parameter');

    // Read raw body for signature verification
    const rawBody = await req.text();
    const sigHeader = req.headers.get('stripe-signature') || '';

    // Load integration to get webhook signing secret
    const { data: integration } = await serviceClient
      .from('integrations')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', 'stripe')
      .single();

    if (!integration || integration.status !== 'connected') {
      throw new Error('Stripe integration not found or disconnected');
    }

    // Verify signature — required, reject if no secret is configured
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || integration.config?.webhook_secret || '';
    if (!webhookSecret) {
      return new Response(JSON.stringify({ error: 'Webhook secret not configured. Set STRIPE_WEBHOOK_SECRET or configure in integration settings.' }), { status: 500 });
    }
    const valid = await verifyStripeSignature(rawBody, sigHeader, webhookSecret);
    if (!valid) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
    }

    // Parse event
    const event = JSON.parse(rawBody);
    const eventType = event.type;

    // Only handle subscription events
    const HANDLED_EVENTS = [
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted'
    ];

    if (!HANDLED_EVENTS.includes(eventType)) {
      // Acknowledge but ignore unhandled events
      return new Response(JSON.stringify({ received: true, handled: false }), { status: 200 });
    }

    const subscription = event.data?.object;
    if (!subscription) throw new Error('No subscription data in event');

    const stripeCustomerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id;

    // Find matching customer
    let customer = null;

    // Try by stripe_customer_id first
    if (stripeCustomerId) {
      const { data } = await serviceClient
        .from('customers')
        .select('id, name, mrr, tier, growth, stripe_customer_id')
        .eq('client_id', clientId)
        .eq('stripe_customer_id', stripeCustomerId)
        .is('deleted_at', null)
        .limit(1);
      if (data?.length) customer = data[0];
    }

    // Fallback: try name match from Stripe customer object
    if (!customer && typeof subscription.customer === 'object' && subscription.customer?.name) {
      const stripeName = subscription.customer.name;
      const { data } = await serviceClient
        .from('customers')
        .select('id, name, mrr, tier, growth, stripe_customer_id')
        .eq('client_id', clientId)
        .ilike('name', stripeName)
        .is('deleted_at', null)
        .limit(1);
      if (data?.length) customer = data[0];
    }

    if (!customer) {
      // Log skipped event
      try { await serviceClient.from('webhook_events').insert({
        user_id: integration.config?.user_id || '00000000-0000-0000-0000-000000000000',
        direction: 'inbound',
        event_type: `stripe_webhook_${eventType}`,
        payload: JSON.stringify({ stripe_customer_id: stripeCustomerId, event_type: eventType, skipped: true }),
        status: 'success',
        status_code: 200,
        customer_name: 'unmatched'
      }); } catch(_) {}

      return new Response(JSON.stringify({ received: true, matched: false }), { status: 200 });
    }

    // Build update
    const changes: any = {};

    if (eventType === 'customer.subscription.deleted') {
      // Subscription cancelled — zero out MRR, flag growth
      changes.mrr = 0;
      changes.growth = 'none';
    } else {
      // Created or updated
      const newMrr = Math.round(calculateMRR(subscription));
      if (newMrr !== (customer.mrr || 0)) changes.mrr = newMrr;

      const newTier = detectTier(subscription);
      if (newTier && newTier !== customer.tier) changes.tier = newTier;

      // Detect growth
      const oldMrr = customer.mrr || 0;
      if (oldMrr > 0 && newMrr > oldMrr) {
        const pctChange = ((newMrr - oldMrr) / oldMrr) * 100;
        changes.growth = pctChange >= 10 ? 'strong' : 'moderate';
      }

      if (stripeCustomerId && stripeCustomerId !== customer.stripe_customer_id) {
        changes.stripe_customer_id = stripeCustomerId;
      }
    }

    // Apply update
    if (Object.keys(changes).length > 0) {
      await serviceClient
        .from('customers')
        .update(changes)
        .eq('id', customer.id);
    }

    // Log event
    try { await serviceClient.from('webhook_events').insert({
      user_id: integration.config?.user_id || '00000000-0000-0000-0000-000000000000',
      direction: 'inbound',
      event_type: `stripe_webhook_${eventType}`,
      payload: JSON.stringify({ customer_name: customer.name, changes, stripe_customer_id: stripeCustomerId }),
      status: 'success',
      status_code: 200,
      customer_id: customer.id,
      customer_name: customer.name
    }); } catch(_) {}

    return new Response(JSON.stringify({
      received: true,
      matched: true,
      customer: customer.name,
      changes
    }), { status: 200 });

  } catch (err) {
    // Log error
    try { await serviceClient.from('webhook_events').insert({
      user_id: '00000000-0000-0000-0000-000000000000',
      direction: 'inbound',
      event_type: 'stripe_webhook_error',
      payload: JSON.stringify({ error: err.message }),
      status: 'failed',
      error_msg: err.message
    }); } catch(_) {}

    return new Response(JSON.stringify({ error: err.message }), { status: 400 });
  }
});

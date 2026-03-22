// ═══════════════════════════════════════════════════════════════
// billing-webhook — Supabase Edge Function
// Handles Stripe webhook events for iQcadence billing (plan subscriptions)
// SEPARATE from stripe-webhook (which syncs customer data)
// Called by: Stripe → POST /functions/v1/billing-webhook
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

// Map Stripe product metadata.tier → iQcadence plan tier
function detectBillingTier(product: any): string {
  const metaTier = (product?.metadata?.tier || '').toLowerCase();
  if (['core', 'pulse', 'starter', 'basic'].includes(metaTier)) return 'core';
  if (['growth', 'signal', 'team', 'pro'].includes(metaTier)) return 'growth';
  if (['custom', 'command', 'enterprise'].includes(metaTier)) return 'custom';
  // Fallback: check product name
  const name = (product?.name || '').toLowerCase();
  if (name.includes('custom') || name.includes('command') || name.includes('enterprise')) return 'custom';
  if (name.includes('growth') || name.includes('signal') || name.includes('team') || name.includes('pro')) return 'growth';
  return 'core';
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const rawBody = await req.text();
    const sigHeader = req.headers.get('stripe-signature') || '';

    // Verify webhook signature
    const webhookSecret = Deno.env.get('STRIPE_BILLING_WEBHOOK_SECRET');
    if (!webhookSecret) throw new Error('Webhook secret not configured');

    const valid = await verifyStripeSignature(rawBody, sigHeader, webhookSecret);
    if (!valid) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
    }

    const event = JSON.parse(rawBody);
    const stripeKey = Deno.env.get('STRIPE_BILLING_SECRET_KEY')!;

    console.log(`[billing-webhook] Event: ${event.type}, ID: ${event.id}`);

    // ── checkout.session.completed ──
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const clientId = session.metadata?.client_id;
      const subscriptionId = session.subscription;

      if (!clientId || !subscriptionId) {
        console.log('[billing-webhook] Skipping: no client_id or subscription in session');
        return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
      }

      // Fetch subscription details to get the product/tier
      const subCtrl = new AbortController();
      const subTimeout = setTimeout(() => subCtrl.abort(), 15000);
      const subResp = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}?expand[]=items.data.price.product`, {
        headers: { 'Authorization': `Bearer ${stripeKey}` },
        signal: subCtrl.signal,
      });
      clearTimeout(subTimeout);
      const subscription = await subResp.json();

      const product = subscription.items?.data?.[0]?.price?.product;
      const tier = detectBillingTier(product);

      await serviceClient
        .from('clients')
        .update({
          stripe_subscription_id: subscriptionId,
          subscription_status: 'active',
          plan_tier: tier,
          billing_period_end: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : null,
        })
        .eq('id', clientId);

      console.log(`[billing-webhook] Checkout complete: client=${clientId}, tier=${tier}`);
    }

    // ── customer.subscription.updated ──
    else if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const clientId = subscription.metadata?.client_id;

      if (!clientId) {
        // Try to find by stripe_subscription_id
        const { data: clients } = await serviceClient
          .from('clients')
          .select('id')
          .eq('stripe_subscription_id', subscription.id)
          .limit(1);
        if (!clients?.length) {
          console.log('[billing-webhook] No matching client for subscription update');
          return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
        }
        const matchedClientId = clients[0].id;

        // Fetch product for tier detection
        const product = subscription.items?.data?.[0]?.price?.product;
        let tier = 'core';
        if (typeof product === 'string') {
          const prodResp = await fetch(`https://api.stripe.com/v1/products/${product}`, {
            headers: { 'Authorization': `Bearer ${stripeKey}` },
          });
          tier = detectBillingTier(await prodResp.json());
        } else {
          tier = detectBillingTier(product);
        }

        const status = subscription.status === 'active' || subscription.status === 'trialing'
          ? 'active'
          : subscription.status === 'past_due' ? 'past_due'
          : subscription.status === 'canceled' || subscription.status === 'unpaid' ? 'canceled'
          : 'incomplete';

        await serviceClient
          .from('clients')
          .update({
            plan_tier: tier,
            subscription_status: status,
            billing_period_end: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : null,
          })
          .eq('id', matchedClientId);

        console.log(`[billing-webhook] Subscription updated: client=${matchedClientId}, tier=${tier}, status=${status}`);
      } else {
        // Has client_id in metadata
        const product = subscription.items?.data?.[0]?.price?.product;
        let tier = 'core';
        if (typeof product === 'string') {
          const prodResp = await fetch(`https://api.stripe.com/v1/products/${product}`, {
            headers: { 'Authorization': `Bearer ${stripeKey}` },
          });
          tier = detectBillingTier(await prodResp.json());
        } else {
          tier = detectBillingTier(product);
        }

        const status = subscription.status === 'active' || subscription.status === 'trialing'
          ? 'active'
          : subscription.status === 'past_due' ? 'past_due'
          : subscription.status === 'canceled' || subscription.status === 'unpaid' ? 'canceled'
          : 'incomplete';

        await serviceClient
          .from('clients')
          .update({
            plan_tier: tier,
            subscription_status: status,
            billing_period_end: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : null,
          })
          .eq('id', clientId);

        console.log(`[billing-webhook] Subscription updated: client=${clientId}, tier=${tier}, status=${status}`);
      }
    }

    // ── customer.subscription.deleted ──
    else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;

      // Find client by subscription ID
      const { data: clients } = await serviceClient
        .from('clients')
        .select('id')
        .eq('stripe_subscription_id', subscription.id)
        .limit(1);

      if (clients?.length) {
        await serviceClient
          .from('clients')
          .update({
            subscription_status: 'canceled',
            plan_tier: 'core',
            stripe_subscription_id: '',
          })
          .eq('id', clients[0].id);

        console.log(`[billing-webhook] Subscription deleted: client=${clients[0].id}, downgraded to core`);
      }
    }

    // ── invoice.payment_failed ──
    else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const stripeCustomerId = invoice.customer;

      if (stripeCustomerId) {
        const { data: clients } = await serviceClient
          .from('clients')
          .select('id')
          .eq('stripe_customer_id', stripeCustomerId)
          .limit(1);

        if (clients?.length) {
          await serviceClient
            .from('clients')
            .update({ subscription_status: 'past_due' })
            .eq('id', clients[0].id);

          console.log(`[billing-webhook] Payment failed: client=${clients[0].id}, status=past_due`);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('[billing-webhook] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

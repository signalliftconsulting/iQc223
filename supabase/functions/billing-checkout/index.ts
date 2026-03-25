// ═══════════════════════════════════════════════════════════════
// billing-checkout — Supabase Edge Function
// Creates a Stripe Checkout Session for iQcadence plan subscriptions
// Called by: sb.functions.invoke('billing-checkout', { body: {...} })
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

async function stripeAPI(method: string, path: string, key: string, body?: Record<string, string>) {
  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
  if (body) opts.body = new URLSearchParams(body).toString();
  const resp = await fetch(`https://api.stripe.com/v1${path}`, opts);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || `Stripe ${resp.status}`);
  return data;
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

    // ── Parse request ──
    const { price_id, success_url, cancel_url } = await req.json();
    if (!price_id) throw new Error('Missing price_id');

    const stripeKey = Deno.env.get('STRIPE_BILLING_SECRET_KEY');
    if (!stripeKey) throw new Error('Stripe billing not configured');

    // Load client to check for existing stripe_customer_id
    const { data: client } = await serviceClient
      .from('clients')
      .select('stripe_customer_id, name, stripe_subscription_id')
      .eq('id', clientId)
      .single();

    // If already has an active subscription, redirect to portal instead
    if (client?.stripe_subscription_id) {
      throw new Error('Active subscription exists. Use the billing portal to change plans.');
    }

    // Create or reuse Stripe Customer
    let stripeCustomerId = client?.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await stripeAPI('POST', '/customers', stripeKey, {
        email: user.email || '',
        name: client?.name || '',
        'metadata[client_id]': clientId,
        'metadata[iqcadence]': 'true',
      });
      stripeCustomerId = customer.id;

      // Save to clients table
      await serviceClient
        .from('clients')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', clientId);
    }

    // Create Checkout Session
    const session = await stripeAPI('POST', '/checkout/sessions', stripeKey, {
      customer: stripeCustomerId,
      mode: 'subscription',
      'line_items[0][price]': price_id,
      'line_items[0][quantity]': '1',
      success_url: success_url || 'https://iqc223.com/?billing=success',
      cancel_url: cancel_url || 'https://iqc223.com/?billing=canceled',
      'subscription_data[metadata][client_id]': clientId,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});

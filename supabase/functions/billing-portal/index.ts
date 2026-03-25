// ═══════════════════════════════════════════════════════════════
// billing-portal — Supabase Edge Function
// Creates a Stripe Customer Portal session for subscription management
// Called by: sb.functions.invoke('billing-portal', { body: {...} })
// ═══════════════════════════════════════════════════════════════

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

Deno.serve(async (req) => {
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

    // Load client's stripe_customer_id
    const { data: client } = await serviceClient
      .from('clients')
      .select('stripe_customer_id')
      .eq('id', profile.client_id)
      .single();

    if (!client?.stripe_customer_id) {
      throw new Error('No billing account found. Please subscribe to a plan first.');
    }

    const stripeKey = Deno.env.get('STRIPE_BILLING_SECRET_KEY');
    if (!stripeKey) throw new Error('Stripe billing not configured');

    const { return_url } = await req.json();

    // Create portal session
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer: client.stripe_customer_id,
        return_url: return_url || 'https://iqc223.com/',
      }).toString(),
    });

    clearTimeout(timeoutId);
    const session = await resp.json();
    if (!resp.ok) throw new Error(session?.error?.message || `Stripe ${resp.status}`);

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

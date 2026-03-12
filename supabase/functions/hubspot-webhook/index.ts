// ═══════════════════════════════════════════════════════════════
// hubspot-webhook — Supabase Edge Function
// Receives real-time webhook events from HubSpot subscriptions
// Handles: company.propertyChange, deal changes, ticket changes
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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hubspot-signature-v3',
  };
}

// Verify HubSpot webhook signature (v3)
async function verifySignature(req: Request, body: string, clientSecret: string): Promise<boolean> {
  const signature = req.headers.get('X-HubSpot-Signature-v3');
  const timestamp = req.headers.get('X-HubSpot-Request-Timestamp');
  if (!signature || !timestamp) return false;

  // Reject if timestamp is older than 5 minutes
  const age = Date.now() - parseInt(timestamp, 10);
  if (age > 5 * 60 * 1000) return false;

  const message = `${req.method}${req.url}${body}${timestamp}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(clientSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return expected === signature;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const bodyText = await req.text();
    const events = JSON.parse(bodyText);

    if (!Array.isArray(events) || events.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No events' }), {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    // HubSpot sends portalId in each event — use it to find the integration
    const portalId = events[0]?.portalId?.toString();

    // Find integration by matching portalId in config
    const { data: integrations } = await serviceClient
      .from('integrations')
      .select('*')
      .eq('platform', 'hubspot')
      .eq('status', 'connected');

    if (!integrations?.length) {
      // Log and return 200 (don't cause HubSpot to retry)
      console.warn('No connected HubSpot integrations found');
      return new Response(JSON.stringify({ success: true, message: 'No matching integration' }), {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    // Try to verify signature if webhook secret is available
    let integration = integrations[0]; // default to first
    for (const intg of integrations) {
      if (intg.config?.portal_id === portalId) {
        integration = intg;
        break;
      }
    }

    // Verify signature if we have a webhook secret
    if (integration.webhook_secret_id) {
      try {
        const { data: secret } = await serviceClient
          .rpc('vault_read_secret', { secret_id: integration.webhook_secret_id });
        if (secret) {
          const valid = await verifySignature(req, bodyText, secret);
          if (!valid) {
            console.warn('HubSpot webhook signature verification failed');
            return new Response(JSON.stringify({ success: false, error: 'Invalid signature' }), {
              status: 401,
              headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
            });
          }
        }
      } catch (_) { /* Vault unavailable — skip verification */ }
    }

    const clientId = integration.client_id;
    const syncMetrics = integration.config?.sync_metrics || {};
    const shouldSync = (metric: string) => syncMetrics[metric] !== false;

    let processed = 0;

    for (const event of events) {
      const { subscriptionType, objectId, propertyName, propertyValue } = event;

      if (subscriptionType === 'company.propertyChange') {
        // Find customer by hubspot_company_id
        const { data: customer } = await serviceClient
          .from('customers')
          .select('id, lifecycle, tier, tickets, days')
          .eq('client_id', clientId)
          .eq('hubspot_company_id', objectId.toString())
          .is('deleted_at', null)
          .single();

        if (!customer) continue;

        const changes: any = {};

        if (propertyName === 'lifecyclestage' && shouldSync('lifecycle')) {
          const mapped = mapLifecycleStage(propertyValue);
          if (mapped && mapped !== customer.lifecycle) changes.lifecycle = mapped;
        }

        if (propertyName === 'annualrevenue' && shouldSync('tier')) {
          const rev = parseFloat(propertyValue || '0');
          let tier = null;
          if (rev >= 500000) tier = 'enterprise';
          else if (rev >= 50000) tier = 'mid';
          else if (rev > 0) tier = 'smb';
          if (tier && tier !== customer.tier) changes.tier = tier;
        }

        if (Object.keys(changes).length > 0) {
          await serviceClient.from('customers').update(changes).eq('id', customer.id);
          processed++;
        }
      }

      // Could handle deal.propertyChange, ticket.creation, etc. here
      // For now, incremental updates are handled by the company.propertyChange
      // and periodic full syncs handle deal/ticket aggregations
    }

    // Log webhook event
    try { await serviceClient.from('webhook_events').insert({
      direction: 'inbound',
      event_type: 'hubspot_webhook',
      payload: JSON.stringify({ event_count: events.length, processed, portal_id: portalId }),
      status: 'success',
      status_code: 200
    }); } catch(_) {}

    return new Response(JSON.stringify({
      success: true,
      events_received: events.length,
      processed
    }), { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });

  } catch (err) {
    // Always return 200 to HubSpot to prevent retries on our errors
    console.error('HubSpot webhook error:', err.message);
    try { await serviceClient.from('webhook_events').insert({
      direction: 'inbound',
      event_type: 'hubspot_webhook',
      payload: JSON.stringify({ error: err.message }),
      status: 'error',
      status_code: 500
    }); } catch(_) {}

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});

function mapLifecycleStage(stage: string | null): string | null {
  if (!stage) return null;
  const s = stage.toLowerCase();
  if (s === 'customer') return 'active';
  if (s === 'subscriber' || s === 'lead' || s === 'marketingqualifiedlead' || s === 'salesqualifiedlead') return 'onboarding';
  if (s === 'opportunity') return 'onboarding';
  if (s === 'evangelist') return 'won';
  return 'active';
}

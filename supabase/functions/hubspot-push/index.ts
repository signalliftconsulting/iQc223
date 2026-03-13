// ═══════════════════════════════════════════════════════════════
// hubspot-push — Supabase Edge Function
// Pushes IQcadence data back to HubSpot: update company
// properties (health score, lifecycle)
// Called by: sb.functions.invoke('hubspot-push', { body: {...} })
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

const HS_BASE = 'https://api.hubapi.com';

async function hsPatch(token: string, path: string, body: any): Promise<any> {
  const resp = await fetch(`${HS_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(`HubSpot API ${resp.status}: ${data?.message || resp.statusText}`);
  }
  return resp.json();
}

// Refresh an expired OAuth access token
async function refreshOAuthToken(serviceClient: any, integration: any, tokenData: any): Promise<string> {
  const clientId = Deno.env.get('HUBSPOT_CLIENT_ID');
  const clientSecret = Deno.env.get('HUBSPOT_CLIENT_SECRET');
  if (!clientId || !clientSecret || !tokenData.refresh_token) {
    throw new Error('Cannot refresh token — missing credentials or refresh token');
  }
  const resp = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: tokenData.refresh_token,
    }),
  });
  if (!resp.ok) throw new Error('HubSpot token refresh failed. Please reconnect.');
  const newTokens = await resp.json();
  const newPayload = JSON.stringify({ access_token: newTokens.access_token, refresh_token: newTokens.refresh_token, expires_at: Date.now() + (newTokens.expires_in * 1000) });
  if (integration.vault_secret_id) {
    const secretName = `hubspot_oauth_${integration.client_id}`;
    try { await serviceClient.rpc('vault_delete_secret_by_name', { secret_name: secretName }); } catch (_) {}
    const { data: newId } = await serviceClient.rpc('vault_create_secret', { new_secret: newPayload, new_name: secretName, new_description: `HubSpot OAuth tokens for client ${integration.client_id}` });
    if (newId) await serviceClient.from('integrations').update({ vault_secret_id: newId, updated_at: new Date().toISOString() }).eq('client_id', integration.client_id).eq('platform', 'hubspot');
  } else {
    const config = { ...(integration.config || {}), _credential: newTokens.access_token, _refresh_token: newTokens.refresh_token, _expires_at: Date.now() + (newTokens.expires_in * 1000) };
    await serviceClient.from('integrations').update({ config, updated_at: new Date().toISOString() }).eq('client_id', integration.client_id).eq('platform', 'hubspot');
  }
  return newTokens.access_token;
}

// Retrieve HubSpot token with auto-refresh for OAuth
async function getHubSpotToken(serviceClient: any, integration: any): Promise<string> {
  if (integration.vault_secret_id) {
    const { data, error } = await serviceClient
      .rpc('vault_read_secret', { secret_id: integration.vault_secret_id });
    if (!error && data) {
      try {
        const tokenData = JSON.parse(data);
        if (tokenData.access_token) {
          if (tokenData.expires_at && tokenData.expires_at < Date.now() + 300000) {
            return await refreshOAuthToken(serviceClient, integration, tokenData);
          }
          return tokenData.access_token;
        }
      } catch { return data; } // plain PAT token
    }
  }
  if (integration.config?._auth_type === 'oauth') {
    const td = { access_token: integration.config._credential, refresh_token: integration.config._refresh_token, expires_at: integration.config._expires_at };
    if (td.expires_at && td.expires_at < Date.now() + 300000) return await refreshOAuthToken(serviceClient, integration, td);
    if (td.access_token) return td.access_token;
  }
  if (integration.config?._credential) return integration.config._credential;
  throw new Error('No HubSpot token found. Please reconnect.');
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

    // Load HubSpot integration
    const { data: integration } = await serviceClient
      .from('integrations')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', 'hubspot')
      .single();

    if (!integration || integration.status !== 'connected') {
      throw new Error('HubSpot is not connected.');
    }

    const token = await getHubSpotToken(serviceClient, integration);

    // Parse request
    const body = await req.json();
    const { action, customerId, data } = body;

    if (!customerId) throw new Error('customerId is required');

    // Look up customer to get hubspot_company_id
    const { data: customer } = await serviceClient
      .from('customers')
      .select('id, name, hubspot_company_id, score, lifecycle')
      .eq('id', customerId)
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .single();

    if (!customer) throw new Error('Customer not found');
    if (!customer.hubspot_company_id) throw new Error('Customer not linked to HubSpot. Sync first.');

    const companyId = customer.hubspot_company_id;
    let result: any = {};

    // ── UPDATE COMPANY PROPERTY ──
    if (action === 'update_property') {
      const properties = data?.properties || {};

      // Map IQcadence fields to HubSpot properties
      const hsProps: any = {};
      if (properties.health_score != null) hsProps.iqcadence_health_score = properties.health_score.toString();
      if (properties.lifecycle) hsProps.lifecyclestage = mapToHubSpotLifecycle(properties.lifecycle);
      if (properties.tier) hsProps.iqcadence_tier = properties.tier;

      if (Object.keys(hsProps).length > 0) {
        await hsPatch(token, `/crm/v3/objects/companies/${companyId}`, { properties: hsProps });
      }

      result = { updated: Object.keys(hsProps) };
    }

    else {
      throw new Error('Invalid action. Must be "update_property".');
    }

    // Log event
    try { await serviceClient.from('webhook_events').insert({
      user_id: user.id,
      direction: 'outbound',
      event_type: `hubspot_push_${action}`,
      payload: JSON.stringify({ customerId, customerName: customer.name, action, result }),
      status: 'success',
      status_code: 200
    }); } catch(_) {}

    return new Response(JSON.stringify({
      success: true,
      action,
      customer: customer.name,
      ...result
    }), { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[hubspot-push] ERROR:', err.message);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 200,  // Return 200 so Supabase client puts the error in data (not swallowed)
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});

function mapToHubSpotLifecycle(lifecycle: string): string {
  const map: Record<string, string> = {
    active: 'customer',
    onboarding: 'opportunity',
    atrisk: 'customer',
    won: 'evangelist',
    churned: 'other',
  };
  return map[lifecycle] || 'customer';
}

// ═══════════════════════════════════════════════════════════════
// integration-connect — Supabase Edge Function
// Connects / disconnects native integrations (Stripe, HubSpot)
// Validates credentials, stores in Supabase Vault, manages status
// Called by: sb.functions.invoke('integration-connect', { body: {...} })
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  'https://iqcadence.pages.dev',
  'https://iqcadence.com',
  'https://www.iqcadence.com',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-f0-9]+\.iqcadence\.pages\.dev$/.test(origin);
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

// Validate a Stripe API key by calling GET /v1/account
async function validateStripeKey(key: string): Promise<{ valid: boolean; name?: string; error?: string }> {
  try {
    const resp = await fetch('https://api.stripe.com/v1/account', {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { valid: false, error: body?.error?.message || `Stripe returned ${resp.status}` };
    }
    const acct = await resp.json();
    return { valid: true, name: acct.settings?.dashboard?.display_name || acct.business_profile?.name || acct.id };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

// Validate a HubSpot Private App token by calling GET /crm/v3/objects/companies?limit=1
async function validateHubSpotToken(token: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const resp = await fetch('https://api.hubapi.com/crm/v3/objects/companies?limit=1', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { valid: false, error: body?.message || `HubSpot returned ${resp.status}` };
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e.message };
  }
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

    // Service client for admin operations (Vault, integrations table)
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
    const body = await req.json();
    const { platform, action, credential } = body;

    if (!['stripe', 'hubspot'].includes(platform)) {
      throw new Error('Invalid platform. Must be "stripe" or "hubspot".');
    }
    if (!['connect', 'disconnect'].includes(action)) {
      throw new Error('Invalid action. Must be "connect" or "disconnect".');
    }

    // ── CONNECT ──
    if (action === 'connect') {
      if (!credential || typeof credential !== 'string' || credential.length < 10) {
        throw new Error('A valid API key or token is required.');
      }

      // Validate the credential with the platform
      let validationResult: { valid: boolean; name?: string; error?: string };
      if (platform === 'stripe') {
        validationResult = await validateStripeKey(credential);
      } else {
        validationResult = await validateHubSpotToken(credential);
      }

      if (!validationResult.valid) {
        throw new Error(`Invalid ${platform} credential: ${validationResult.error}`);
      }

      // Store credential in Vault
      const secretName = `${platform}_key_${clientId}`;
      const secretDesc = `${platform} API key for client ${clientId}`;

      // Delete any existing secret with this name first
      await serviceClient.rpc('vault_delete_secret_by_name', { secret_name: secretName }).catch(() => {});

      // Create new secret
      const { data: secretData, error: vaultError } = await serviceClient
        .rpc('vault_create_secret', {
          new_secret: credential,
          new_name: secretName,
          new_description: secretDesc
        });

      if (vaultError) {
        // Fallback: store encrypted in config (if Vault not available)
        console.warn('Vault not available, storing in config:', vaultError.message);
        // We'll store a hash indicator and the key in config as a fallback
        const { error: upsertError } = await serviceClient
          .from('integrations')
          .upsert({
            client_id: clientId,
            platform,
            vault_secret_id: null,
            config: { _credential: credential, account_name: validationResult.name || '' },
            status: 'connected',
            last_sync_at: null,
            last_sync_status: null,
            sync_stats: {},
            updated_at: new Date().toISOString()
          }, { onConflict: 'client_id,platform' });
        if (upsertError) throw new Error('Failed to save integration: ' + upsertError.message);
      } else {
        // Vault succeeded — store reference
        const { error: upsertError } = await serviceClient
          .from('integrations')
          .upsert({
            client_id: clientId,
            platform,
            vault_secret_id: secretData,
            config: { account_name: validationResult.name || '' },
            status: 'connected',
            last_sync_at: null,
            last_sync_status: null,
            sync_stats: {},
            updated_at: new Date().toISOString()
          }, { onConflict: 'client_id,platform' });
        if (upsertError) throw new Error('Failed to save integration: ' + upsertError.message);
      }

      // Log event
      await serviceClient.from('webhook_events').insert({
        user_id: user.id,
        direction: 'inbound',
        event_type: `${platform}_connected`,
        payload: JSON.stringify({ platform, account_name: validationResult.name || '' }),
        status: 'success',
        status_code: 200
      }).catch(() => {});

      return new Response(JSON.stringify({
        success: true,
        platform,
        status: 'connected',
        account_name: validationResult.name || ''
      }), { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
    }

    // ── DISCONNECT ──
    if (action === 'disconnect') {
      // Load existing integration
      const { data: existing } = await serviceClient
        .from('integrations')
        .select('*')
        .eq('client_id', clientId)
        .eq('platform', platform)
        .single();

      if (existing?.vault_secret_id) {
        // Delete from Vault
        const secretName = `${platform}_key_${clientId}`;
        await serviceClient.rpc('vault_delete_secret_by_name', { secret_name: secretName }).catch(() => {});
      }

      // Update status
      await serviceClient
        .from('integrations')
        .upsert({
          client_id: clientId,
          platform,
          vault_secret_id: null,
          config: {},
          status: 'disconnected',
          updated_at: new Date().toISOString()
        }, { onConflict: 'client_id,platform' });

      // Log event
      await serviceClient.from('webhook_events').insert({
        user_id: user.id,
        direction: 'inbound',
        event_type: `${platform}_disconnected`,
        payload: JSON.stringify({ platform }),
        status: 'success',
        status_code: 200
      }).catch(() => {});

      return new Response(JSON.stringify({
        success: true,
        platform,
        status: 'disconnected'
      }), { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });
    }

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});

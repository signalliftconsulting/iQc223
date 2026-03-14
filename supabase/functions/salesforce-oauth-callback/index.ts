// ═══════════════════════════════════════════════════════════════
// salesforce-oauth-callback — Supabase Edge Function
// Handles Salesforce OAuth redirect: exchanges code for tokens,
// stores access_token + refresh_token in Vault, creates/updates
// integration record, then redirects user back to IQcadence.
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

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state'); // contains client_id + user_id + return_url + code_verifier

    if (!code || !state) {
      return new Response('Missing code or state parameter', { status: 400 });
    }

    // Decode state
    let stateData: { client_id: string; user_id: string; return_url: string; code_verifier?: string };
    try {
      stateData = JSON.parse(atob(state));
    } catch {
      return new Response('Invalid state parameter', { status: 400 });
    }

    const { client_id, user_id, return_url, code_verifier } = stateData;
    if (!client_id || !user_id) {
      return new Response('Invalid state: missing client_id or user_id', { status: 400 });
    }

    // Exchange code for tokens (OAuth 2.1 + PKCE)
    const clientId = Deno.env.get('SALESFORCE_CLIENT_ID')!;
    const clientSecret = Deno.env.get('SALESFORCE_CLIENT_SECRET')!;
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/salesforce-oauth-callback`;

    // Build token exchange params
    const tokenParams: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    };
    if (code_verifier) {
      tokenParams.code_verifier = code_verifier;
    }

    console.log('Token exchange params:', JSON.stringify({ ...tokenParams, code: code.substring(0, 8) + '...' }));

    const tokenResp = await fetch('https://orgfarm-3966efd483-dev-ed.develop.my.salesforce.com/services/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(tokenParams),
    });

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      console.error('Salesforce token exchange failed:', tokenResp.status, err);
      const failUrl = return_url + (return_url.includes('?') ? '&' : '?') + 'salesforce_error=' + encodeURIComponent(`Token exchange failed (${tokenResp.status}): ${err}`);
      return Response.redirect(failUrl, 302);
    }

    const tokens = await tokenResp.json();
    // tokens: { access_token, refresh_token, instance_url, id, issued_at, token_type }

    // Fetch org info to display account name
    let orgName = 'Salesforce Org';
    try {
      const orgResp = await fetch(
        `${tokens.instance_url}/services/data/v59.0/query?q=SELECT+Name+FROM+Organization`,
        { headers: { 'Authorization': `Bearer ${tokens.access_token}` } }
      );
      if (orgResp.ok) {
        const orgData = await orgResp.json();
        if (orgData.records?.[0]?.Name) {
          orgName = orgData.records[0].Name;
        }
      }
    } catch (_) {}

    // Service client for admin operations
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Store tokens in Vault
    const secretName = `salesforce_oauth_${client_id}`;
    const secretPayload = JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      instance_url: tokens.instance_url,
      expires_at: Date.now() + 7200000,
    });

    // Delete any existing secret first
    try { await serviceClient.rpc('vault_delete_secret_by_name', { secret_name: secretName }); } catch (_) {}

    // Also delete old key-style secret if exists
    try { await serviceClient.rpc('vault_delete_secret_by_name', { secret_name: `salesforce_key_${client_id}` }); } catch (_) {}

    const { data: secretData, error: vaultError } = await serviceClient
      .rpc('vault_create_secret', {
        new_secret: secretPayload,
        new_name: secretName,
        new_description: `Salesforce OAuth tokens for client ${client_id}`,
      });

    const DEFAULT_SYNC_METRICS = { mrr: true, tier: true, renewal: true, tickets: true, days: true, contact: true, lifecycle: true };

    if (vaultError) {
      console.warn('Vault not available, storing in config:', vaultError.message);
      await serviceClient.from('integrations').upsert({
        client_id,
        platform: 'salesforce',
        vault_secret_id: null,
        config: {
          _credential: tokens.access_token,
          _refresh_token: tokens.refresh_token,
          _expires_at: Date.now() + 7200000,
          _auth_type: 'oauth',
          account_name: orgName,
          instance_url: tokens.instance_url,
          sync_metrics: DEFAULT_SYNC_METRICS,
        },
        status: 'connected',
        last_sync_at: null,
        last_sync_status: null,
        sync_stats: {},
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id,platform' });
    } else {
      await serviceClient.from('integrations').upsert({
        client_id,
        platform: 'salesforce',
        vault_secret_id: secretData,
        config: {
          _auth_type: 'oauth',
          account_name: orgName,
          instance_url: tokens.instance_url,
          sync_metrics: DEFAULT_SYNC_METRICS,
        },
        status: 'connected',
        last_sync_at: null,
        last_sync_status: null,
        sync_stats: {},
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id,platform' });
    }

    // Log event
    try {
      await serviceClient.from('webhook_events').insert({
        user_id,
        direction: 'inbound',
        event_type: 'salesforce_oauth_connected',
        payload: JSON.stringify({ org_name: orgName, instance_url: tokens.instance_url }),
        status: 'success',
        status_code: 200,
      });
    } catch (_) {}

    // Redirect back to IQcadence with success flag
    const successUrl = return_url + (return_url.includes('?') ? '&' : '?') + 'salesforce_connected=1';
    return Response.redirect(successUrl, 302);

  } catch (err) {
    console.error('OAuth callback error:', err);
    return new Response('OAuth callback failed: ' + err.message, { status: 500 });
  }
});

// ═══════════════════════════════════════════════════════════════
// hubspot-oauth-callback — Supabase Edge Function
// Handles HubSpot OAuth redirect: exchanges code for tokens,
// stores access_token + refresh_token in Vault, creates/updates
// integration record, then redirects user back to IQcadence.
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state'); // contains client_id + user_id + return_url

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
    const clientId = Deno.env.get('HUBSPOT_CLIENT_ID')!;
    const clientSecret = Deno.env.get('HUBSPOT_CLIENT_SECRET')!;
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/hubspot-oauth-callback`;

    // Build token exchange params — include client_secret as form param
    const tokenParams: Record<string, string> = {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    };
    if (code_verifier) {
      tokenParams.code_verifier = code_verifier;
    }

    console.log('Token exchange params:', JSON.stringify({ ...tokenParams, code: code.substring(0, 8) + '...' }));

    const basicAuth = btoa(`${clientId}:${clientSecret}`);
    const tokenResp = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: new URLSearchParams(tokenParams),
    });

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      console.error('HubSpot token exchange failed:', tokenResp.status, err);
      const failUrl = return_url + (return_url.includes('?') ? '&' : '?') + 'hubspot_error=' + encodeURIComponent(`Token exchange failed (${tokenResp.status}): ${err}`);
      return Response.redirect(failUrl, 302);
    }

    const tokens = await tokenResp.json();
    // tokens: { access_token, refresh_token, expires_in, token_type }

    // Get portal info to display account name
    let portalName = '';
    let portalId = '';
    try {
      const infoResp = await fetch('https://api.hubapi.com/account-info/v3/details', {
        headers: { 'Authorization': `Bearer ${tokens.access_token}` },
      });
      if (infoResp.ok) {
        const info = await infoResp.json();
        portalName = info.portalId ? `Portal ${info.portalId}` : '';
        portalId = String(info.portalId || '');
        if (info.companyCurrency || info.accountType) {
          portalName = info.companyCurrency ? `HubSpot (${info.portalId})` : portalName;
        }
      }
    } catch (_) {}

    // Also try to get the hub name from access token info
    try {
      const tokenInfoResp = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${tokens.access_token}`);
      if (tokenInfoResp.ok) {
        const tokenInfo = await tokenInfoResp.json();
        if (tokenInfo.hub_domain) portalName = tokenInfo.hub_domain;
        if (tokenInfo.hub_id) portalId = String(tokenInfo.hub_id);
      }
    } catch (_) {}

    // Service client for admin operations
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Store tokens in Vault
    const secretName = `hubspot_oauth_${client_id}`;
    const secretPayload = JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in * 1000),
    });

    // Delete any existing secret first
    try { await serviceClient.rpc('vault_delete_secret_by_name', { secret_name: secretName }); } catch (_) {}

    // Also delete old pat-style secret if exists
    try { await serviceClient.rpc('vault_delete_secret_by_name', { secret_name: `hubspot_key_${client_id}` }); } catch (_) {}

    const { data: secretData, error: vaultError } = await serviceClient
      .rpc('vault_create_secret', {
        new_secret: secretPayload,
        new_name: secretName,
        new_description: `HubSpot OAuth tokens for client ${client_id}`,
      });

    const DEFAULT_SYNC_METRICS = { tickets: true, days: true, contact: true, nps: true, csat: true, lifecycle: true };

    if (vaultError) {
      console.warn('Vault not available, storing in config:', vaultError.message);
      await serviceClient.from('integrations').upsert({
        client_id,
        platform: 'hubspot',
        vault_secret_id: null,
        config: {
          _credential: tokens.access_token,
          _refresh_token: tokens.refresh_token,
          _expires_at: Date.now() + (tokens.expires_in * 1000),
          _auth_type: 'oauth',
          account_name: portalName,
          portal_id: portalId,
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
        platform: 'hubspot',
        vault_secret_id: secretData,
        config: {
          _auth_type: 'oauth',
          account_name: portalName,
          portal_id: portalId,
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
        event_type: 'hubspot_oauth_connected',
        payload: JSON.stringify({ portal_id: portalId, portal_name: portalName }),
        status: 'success',
        status_code: 200,
      });
    } catch (_) {}

    // Redirect back to IQcadence with success flag
    const successUrl = return_url + (return_url.includes('?') ? '&' : '?') + 'hubspot_connected=1';
    return Response.redirect(successUrl, 302);

  } catch (err) {
    console.error('OAuth callback error:', err);
    return new Response('OAuth callback failed: ' + err.message, { status: 500 });
  }
});

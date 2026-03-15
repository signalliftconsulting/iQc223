// ═══════════════════════════════════════════════════════════════
// salesforce-sync — Supabase Edge Function
// On-demand sync: pulls Salesforce accounts, opportunities,
// cases, contacts and maps them to IQcadence customers
// Called by: sb.functions.invoke('salesforce-sync', { body: {} })
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

// ── Salesforce API helpers ──

/**
 * Execute a SOQL query against the Salesforce REST API.
 * Handles pagination via nextRecordsUrl.
 * Throws 'TOKEN_EXPIRED' on 401 so caller can refresh and retry.
 */
async function sfQuery(token: string, instanceUrl: string, soql: string): Promise<any[]> {
  const allRecords: any[] = [];
  let url = `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`;

  while (url) {
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (resp.status === 401) {
      throw new Error('TOKEN_EXPIRED');
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Salesforce API ${resp.status}: ${body || resp.statusText}`);
    }

    const data = await resp.json();
    allRecords.push(...(data.records || []));

    if (data.done === false && data.nextRecordsUrl) {
      // nextRecordsUrl is a relative path like /services/data/v59.0/query/01gxx...
      url = `${instanceUrl}${data.nextRecordsUrl}`;
    } else {
      url = '';
    }
  }

  return allRecords;
}

/**
 * Refresh an expired Salesforce OAuth access token using the refresh token.
 * Stores new tokens in Vault (or config fallback).
 */
async function refreshSalesforceToken(
  serviceClient: any,
  integration: any,
  tokenData: any
): Promise<string> {
  const clientId = Deno.env.get('SALESFORCE_CLIENT_ID');
  const clientSecret = Deno.env.get('SALESFORCE_CLIENT_SECRET');
  if (!clientId || !clientSecret || !tokenData.refresh_token) {
    throw new Error('Cannot refresh token — missing Salesforce client credentials or refresh token');
  }

  console.log('[salesforce-sync] Refreshing expired access token...');

  // Use the stored instance_url so token refresh works for any Salesforce org
  const baseUrl = tokenData.instance_url || 'https://login.salesforce.com';
  const resp = await fetch(`${baseUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenData.refresh_token,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error('[salesforce-sync] Token refresh failed:', err);
    throw new Error('Salesforce token refresh failed. Please reconnect.');
  }

  const newTokens = await resp.json();
  const newAccessToken = newTokens.access_token;
  const newInstanceUrl = newTokens.instance_url || tokenData.instance_url;

  const newPayload = JSON.stringify({
    access_token: newAccessToken,
    refresh_token: newTokens.refresh_token || tokenData.refresh_token,
    instance_url: newInstanceUrl,
    expires_at: Date.now() + (newTokens.issued_at ? 7200000 : 7200000), // SF tokens typically valid ~2h
  });

  // Update Vault
  if (integration.vault_secret_id) {
    const secretName = `salesforce_oauth_${integration.client_id}`;
    try { await serviceClient.rpc('vault_delete_secret_by_name', { secret_name: secretName }); } catch (_) {}
    const { data: newSecretId } = await serviceClient.rpc('vault_create_secret', {
      new_secret: newPayload,
      new_name: secretName,
      new_description: `Salesforce OAuth tokens for client ${integration.client_id}`,
    });
    if (newSecretId) {
      await serviceClient.from('integrations').update({
        vault_secret_id: newSecretId,
        updated_at: new Date().toISOString(),
      }).eq('client_id', integration.client_id).eq('platform', 'salesforce');
    }
  } else {
    // Fallback: update config
    const config = {
      ...(integration.config || {}),
      _credential: newAccessToken,
      _refresh_token: newTokens.refresh_token || tokenData.refresh_token,
      _instance_url: newInstanceUrl,
      _expires_at: Date.now() + 7200000,
    };
    await serviceClient.from('integrations').update({
      config,
      updated_at: new Date().toISOString(),
    }).eq('client_id', integration.client_id).eq('platform', 'salesforce');
  }

  console.log('[salesforce-sync] Token refreshed successfully');
  return newAccessToken;
}

/**
 * Retrieve Salesforce token from Vault or config fallback, with auto-refresh if expired.
 * Returns { token, instanceUrl }.
 */
async function getSalesforceToken(
  serviceClient: any,
  integration: any
): Promise<{ token: string; instanceUrl: string }> {
  // Try Vault first
  if (integration.vault_secret_id) {
    console.log('[salesforce-sync] Reading vault secret:', integration.vault_secret_id);
    const { data, error } = await serviceClient
      .rpc('vault_read_secret', { secret_id: integration.vault_secret_id });
    console.log('[salesforce-sync] Vault result - error:', error, 'data type:', typeof data, 'data:', typeof data === 'string' ? data.substring(0, 80) : JSON.stringify(data)?.substring(0, 80));
    if (!error && data) {
      try {
        const raw = typeof data === 'string' ? data : (Array.isArray(data) ? data[0]?.secret : data.secret || JSON.stringify(data));
        const tokenData = JSON.parse(raw);
        if (tokenData.access_token && tokenData.instance_url) {
          // Check if expired (with 5 min buffer)
          if (tokenData.expires_at && tokenData.expires_at < Date.now() + 300000) {
            const newToken = await refreshSalesforceToken(serviceClient, integration, tokenData);
            return { token: newToken, instanceUrl: tokenData.instance_url };
          }
          return { token: tokenData.access_token, instanceUrl: tokenData.instance_url };
        }
      } catch {
        // Not JSON — unexpected for Salesforce
        console.warn('[salesforce-sync] Vault secret is not valid JSON');
      }
    }
  }

  // Config fallback
  if (integration.config?._credential && (integration.config?._instance_url || integration.config?.instance_url)) {
    const tokenData = {
      access_token: integration.config._credential,
      refresh_token: integration.config._refresh_token,
      instance_url: integration.config._instance_url || integration.config.instance_url,
      expires_at: integration.config._expires_at,
    };
    if (tokenData.expires_at && tokenData.expires_at < Date.now() + 300000) {
      const newToken = await refreshSalesforceToken(serviceClient, integration, tokenData);
      return { token: newToken, instanceUrl: tokenData.instance_url };
    }
    return { token: tokenData.access_token, instanceUrl: tokenData.instance_url };
  }

  throw new Error('No Salesforce token found. Please reconnect your Salesforce integration.');
}

// ── Aggregation helpers ──

function detectTier(account: any): string {
  const rev = parseFloat(account.AnnualRevenue) || 0;
  const emp = parseInt(account.NumberOfEmployees) || 0;
  if (rev >= 500000 || emp >= 500) return 'enterprise';
  if (rev >= 50000 || emp >= 50) return 'mid';
  if (rev > 0 || emp > 0) return 'smb';
  return 'mid';
}

function mapLifecycle(type: string): string {
  if (!type) return 'active';
  const t = type.toLowerCase();
  if (t.includes('customer') || t === 'customer - direct' || t === 'customer - channel') return 'active';
  if (t.includes('prospect') || t.includes('lead')) return 'onboarding';
  if (t.includes('partner') || t.includes('reseller')) return 'active';
  if (t.includes('competitor') || t.includes('other')) return 'churned';
  if (t.includes('analyst') || t.includes('press')) return 'active';
  return 'active';
}

// ── Main handler ──

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    console.log('[salesforce-sync] Starting...');

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
    console.log('[salesforce-sync] User:', user.id);

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
    console.log('[salesforce-sync] Client:', clientId);

    // Load Salesforce integration (try by client_id first, fall back to RLS-scoped query)
    let integration: any = null;
    const { data: integ1 } = await serviceClient
      .from('integrations')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', 'salesforce')
      .single();
    integration = integ1;

    if (!integration || integration.status !== 'connected') {
      // Fallback: query via user-scoped client (RLS) in case client_id mismatch
      console.log('[salesforce-sync] client_id lookup missed, trying RLS fallback...');
      const { data: integ2 } = await supabase
        .from('integrations')
        .select('*')
        .eq('platform', 'salesforce')
        .eq('status', 'connected')
        .single();
      if (integ2) {
        integration = integ2;
        console.log('[salesforce-sync] Found via RLS, integration client_id:', integ2.client_id, 'vs profile client_id:', clientId);
        // Fix the mismatch for future syncs
        if (integ2.client_id !== clientId) {
          await serviceClient.from('integrations').update({ client_id: clientId }).eq('id', integ2.id);
          console.log('[salesforce-sync] Fixed client_id mismatch');
        }
      }
    }

    if (!integration || integration.status !== 'connected') {
      throw new Error('Salesforce is not connected. Go to Settings → API & Integrations to connect.');
    }
    console.log('[salesforce-sync] Integration found, vault_secret_id:', integration.vault_secret_id ? 'yes' : 'no');

    let { token, instanceUrl } = await getSalesforceToken(serviceClient, integration);
    console.log('[salesforce-sync] Token retrieved, instanceUrl:', instanceUrl);

    // ── Fetch Salesforce data (parallel) ──
    const syncMetrics = integration.config?.sync_metrics || {};
    const allowCreates = integration.config?.sync_creates !== false;
    const dealAmountIsMonthly = integration.config?.deal_amount_frequency === 'monthly';
    const shouldSync = (m: string) => syncMetrics[m] !== false;

    async function fetchAllData(t: string, url: string) {
      const [accounts, opportunities, cases, contacts] = await Promise.all([
        sfQuery(t, url, "SELECT Id, Name, Website, AnnualRevenue, NumberOfEmployees, Industry, LastActivityDate, Type FROM Account"),
        sfQuery(t, url, "SELECT Id, AccountId, Name, StageName, Amount, CloseDate, IsClosed, IsWon FROM Opportunity WHERE IsClosed = false OR IsWon = true"),
        sfQuery(t, url, "SELECT Id, AccountId, Status, Priority, CreatedDate FROM Case WHERE IsClosed = false"),
        sfQuery(t, url, "SELECT Id, AccountId, FirstName, LastName, Email, Title, LastModifiedDate FROM Contact"),
      ]);
      return { accounts, opportunities, cases, contacts };
    }

    let data: { accounts: any[]; opportunities: any[]; cases: any[]; contacts: any[] };

    try {
      data = await fetchAllData(token, instanceUrl);
    } catch (err) {
      if (err.message === 'TOKEN_EXPIRED') {
        console.log('[salesforce-sync] Token expired, refreshing and retrying...');
        // Read current token data for refresh
        let tokenData: any = {};
        if (integration.vault_secret_id) {
          const { data: vaultData } = await serviceClient
            .rpc('vault_read_secret', { secret_id: integration.vault_secret_id });
          if (vaultData) tokenData = JSON.parse(vaultData);
        } else {
          tokenData = {
            access_token: integration.config?._credential,
            refresh_token: integration.config?._refresh_token,
            instance_url: integration.config?._instance_url,
          };
        }
        token = await refreshSalesforceToken(serviceClient, integration, tokenData);
        data = await fetchAllData(token, instanceUrl);
      } else {
        throw err;
      }
    }

    const { accounts, opportunities, cases, contacts } = data;
    console.log('[salesforce-sync] Data fetched — accounts:', accounts.length,
      'opportunities:', opportunities.length, 'cases:', cases.length, 'contacts:', contacts.length);

    // ── Aggregate opportunities → per-account MRR / renewal ──
    const accountDeals = new Map<string, { mrr: number; renewalDate: string | null }>();

    for (const opp of opportunities) {
      const accountId = opp.AccountId;
      if (!accountId) continue;

      const existing = accountDeals.get(accountId) || { mrr: 0, renewalDate: null };
      const amount = parseFloat(opp.Amount) || 0;

      if (opp.IsWon) {
        // Won opportunities — sum as MRR (normalize annual → monthly)
        existing.mrr += amount > 0 ? Math.round(dealAmountIsMonthly ? amount : amount / 12) : 0;
      }

      if (!opp.IsClosed && opp.CloseDate) {
        // Open opportunities — find closest future CloseDate as renewal
        const closeDate = opp.CloseDate.split('T')[0];
        const today = new Date().toISOString().split('T')[0];
        if (closeDate > today) {
          if (!existing.renewalDate || closeDate < existing.renewalDate) {
            existing.renewalDate = closeDate;
          }
        }
      }

      accountDeals.set(accountId, existing);
    }
    console.log('[salesforce-sync] Opportunity aggregation: deals for', accountDeals.size, 'accounts');

    // ── Aggregate cases → per-account open ticket count ──
    const accountTickets = new Map<string, number>();

    for (const c of cases) {
      const accountId = c.AccountId;
      if (!accountId) continue;
      accountTickets.set(accountId, (accountTickets.get(accountId) || 0) + 1);
    }
    console.log('[salesforce-sync] Case aggregation: tickets for', accountTickets.size, 'accounts');

    // ── Aggregate contacts → primary contact per account (most recently modified) ──
    const accountContact = new Map<string, { name: string; email: string; modifiedAt: number }>();

    for (const contact of contacts) {
      const accountId = contact.AccountId;
      if (!accountId) continue;
      const email = (contact.Email || '').trim();
      if (!email) continue;

      const name = [contact.FirstName, contact.LastName].filter(Boolean).join(' ').trim();
      const modifiedAt = new Date(contact.LastModifiedDate || 0).getTime();

      const existing = accountContact.get(accountId);
      if (!existing || modifiedAt > existing.modifiedAt) {
        accountContact.set(accountId, { name, email, modifiedAt });
      }
    }
    console.log('[salesforce-sync] Contact aggregation: primary contacts for', accountContact.size, 'accounts');

    // ── Load existing customers ──
    console.log('[salesforce-sync] Loading customers for client:', clientId);

    const { data: existingCustomers, error: custError } = await serviceClient
      .from('customers')
      .select('*')
      .eq('client_id', clientId)
      .is('deleted_at', null);

    if (custError) {
      console.error('[salesforce-sync] Customer load error:', custError.message);
      throw new Error('Failed to load customers: ' + custError.message);
    }

    const bysfId = new Map<string, any>(); // salesforce_account_id → customer
    const byExtId = new Map<string, any>(); // external_id (domain) → customer
    const byName = new Map<string, any>(); // name.toLowerCase() → customer
    for (const c of existingCustomers || []) {
      if (c.salesforce_account_id) bysfId.set(c.salesforce_account_id, c);
      if (c.external_id) byExtId.set(c.external_id.toLowerCase(), c);
      byName.set(c.name.toLowerCase(), c);
    }
    console.log('[salesforce-sync] Existing customers loaded:',
      (existingCustomers || []).length, '(sf:', bysfId.size, 'ext:', byExtId.size, 'name:', byName.size, ')');

    // Track deleted customer names to avoid recreating them
    const { data: deletedCustomers } = await serviceClient
      .from('customers')
      .select('name')
      .eq('client_id', clientId)
      .not('deleted_at', 'is', null);
    const deletedNames = new Set((deletedCustomers || []).map((c: any) => c.name.toLowerCase()));
    console.log('[salesforce-sync] Deleted customer names tracked:', deletedNames.size);

    // ── Match & sync phase ──
    const now = Date.now();
    const stats = { total: accounts.length, matched: 0, created: 0, updated: 0, skipped: 0 };
    const updates: any[] = [];
    const creates: any[] = [];

    for (const account of accounts) {
      const sfId = account.Id;
      const name = (account.Name || '').trim();
      if (!name) { stats.skipped++; continue; }

      // Extract domain from Website
      let domain = '';
      if (account.Website) {
        try {
          domain = new URL('https://' + account.Website.replace(/^https?:\/\//, '')).hostname.replace(/^www\./, '');
        } catch {
          // Invalid URL, skip domain matching
        }
      }

      // Match cascade: SF ID → domain → name
      let match = bysfId.get(sfId);
      if (!match && domain) match = byExtId.get(domain.toLowerCase());
      if (!match) match = byName.get(name.toLowerCase());

      if (match) {
        // ── Update existing customer ──
        stats.matched++;
        const changes: any = {};

        // Always link salesforce_account_id
        if (sfId !== match.salesforce_account_id) changes.salesforce_account_id = sfId;

        // Sync name if changed
        if (name && name !== match.name) changes.name = name;

        // MRR from opportunities + growth detection
        const dealData = accountDeals.get(sfId);
        if (shouldSync('mrr') && dealData?.mrr && dealData.mrr !== (match.mrr || 0)) {
          const oldMrr = match.mrr || 0;
          changes.mrr = dealData.mrr;
          changes.arr = dealData.mrr * 12;
          // Detect growth signal from MRR change
          if (shouldSync('growth')) {
            let newGrowth = 'none';
            if (oldMrr === 0 && dealData.mrr > 0) newGrowth = 'strong';
            else if (oldMrr > 0) {
              const pct = ((dealData.mrr - oldMrr) / oldMrr) * 100;
              if (pct >= 10) newGrowth = 'strong';
              else if (pct >= 1) newGrowth = 'mild';
            }
            if (newGrowth !== (match.growth || 'none')) changes.growth = newGrowth;
          }
        }

        // Tier
        if (shouldSync('tier')) {
          const newTier = detectTier(account);
          if (newTier && newTier !== match.tier) changes.tier = newTier;
        }

        // Lifecycle
        if (shouldSync('lifecycle')) {
          const newLc = mapLifecycle(account.Type);
          if (newLc && newLc !== match.lifecycle) changes.lifecycle = newLc;
        }

        // Tickets
        if (shouldSync('tickets')) {
          const ticketCount = accountTickets.get(sfId) || 0;
          if (ticketCount !== (match.tickets || 0)) changes.tickets = ticketCount;
        }

        // Days since activity
        if (shouldSync('days')) {
          if (account.LastActivityDate) {
            const activityTs = new Date(account.LastActivityDate).getTime();
            const days = Math.floor((now - activityTs) / (1000 * 60 * 60 * 24));
            if (days !== (match.days || 0)) changes.days = days;
            const contactDate = account.LastActivityDate.split('T')[0];
            if (contactDate !== match.last_contact_date) changes.last_contact_date = contactDate;
          }
          // If no LastActivityDate in Salesforce, don't overwrite existing days data
        }

        // Renewal date from opportunities
        if (shouldSync('renewal') && dealData?.renewalDate) {
          if (dealData.renewalDate !== match.renewal_date) {
            changes.renewal_date = dealData.renewalDate;
            const msToRenewal = new Date(dealData.renewalDate).getTime() - now;
            changes.renewal = Math.max(0, Math.round(msToRenewal / (1000 * 60 * 60 * 24 * 30.44)));
          }
        }

        // Primary contact
        if (shouldSync('contact')) {
          const contact = accountContact.get(sfId);
          if (contact) {
            if (contact.email && contact.email !== (match.contact_email || '')) changes.contact_email = contact.email;
            if (contact.name && contact.name !== (match.contact_name || '')) changes.contact_name = contact.name;
          }
        }

        // External ID (domain)
        if (domain && domain !== (match.external_id || '')) changes.external_id = domain;

        if (Object.keys(changes).length > 0) {
          const prev: any = {};
          for (const k of Object.keys(changes)) prev[k] = match[k] ?? null;
          updates.push({ id: match.id, name: match.name, changes, prev });
          stats.updated++;
        }
      } else if (allowCreates) {
        // ── Create new customer (if not previously deleted) ──
        if (deletedNames.has(name.toLowerCase())) {
          stats.skipped++;
          continue;
        }

        const dealData = accountDeals.get(sfId);
        let days = 999;
        let lastContactDate: string | null = null;
        if (account.LastActivityDate) {
          const activityTs = new Date(account.LastActivityDate).getTime();
          days = Math.floor((now - activityTs) / (1000 * 60 * 60 * 24));
          lastContactDate = account.LastActivityDate.split('T')[0];
        }

        const newCustomer: any = {
          client_id: clientId,
          user_id: user.id,
          name,
          salesforce_account_id: sfId,
          external_id: domain || null,
          lifecycle: mapLifecycle(account.Type),
          mrr: dealData?.mrr || 0,
          arr: (dealData?.mrr || 0) * 12,
          tier: detectTier(account),
          tickets: accountTickets.get(sfId) || 0,
          days,
          last_contact_date: lastContactDate,
          contact_email: accountContact.get(sfId)?.email || '',
          contact_name: accountContact.get(sfId)?.name || '',
          tags: account.Industry || '',
          logins: 0,
          adoption: 0,
          nps: 'unknown',
          csat: null,
          growth: 'none',
          history: JSON.stringify([]),
          sentiment: JSON.stringify([]),
          notes: JSON.stringify([]),
          touch_history: JSON.stringify([]),
          playbook_checks: JSON.stringify({}),
        };

        if (dealData?.renewalDate) {
          newCustomer.renewal_date = dealData.renewalDate;
          const msToRenewal = new Date(dealData.renewalDate).getTime() - now;
          newCustomer.renewal = Math.max(0, Math.round(msToRenewal / (1000 * 60 * 60 * 24 * 30.44)));
        }

        creates.push(newCustomer);
        stats.created++;
      }
    }

    console.log('[salesforce-sync] Match phase complete — matched:', stats.matched,
      'updated:', stats.updated, 'created:', stats.created, 'skipped:', stats.skipped);

    // ── Apply updates ──
    for (const upd of updates) {
      console.log(`[salesforce-sync] Updating "${upd.name}":`, Object.keys(upd.changes).join(', '));
      const { error: updErr } = await serviceClient
        .from('customers')
        .update(upd.changes)
        .eq('id', upd.id);
      if (updErr) console.error(`[salesforce-sync] UPDATE FAILED for "${upd.name}":`, updErr.message);
    }

    // ── Insert new customers (batch of 50) ──
    if (creates.length) {
      console.log('[salesforce-sync] Inserting', creates.length, 'new customers...');
      for (let i = 0; i < creates.length; i += 50) {
        const batch = creates.slice(i, i + 50);
        const { error } = await serviceClient.from('customers').insert(batch);
        if (error) console.warn('[salesforce-sync] Insert batch error:', error.message);
        else console.log(`[salesforce-sync] Inserted batch ${Math.floor(i / 50) + 1} (${batch.length} records)`);
      }
    }

    // ── Update integration status ──
    await serviceClient
      .from('integrations')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'success',
        last_sync_message: `${stats.matched} matched, ${stats.created} created, ${stats.updated} updated (${stats.total} accounts)`,
        sync_stats: stats,
        updated_at: new Date().toISOString(),
      })
      .eq('client_id', clientId)
      .eq('platform', 'salesforce');

    // Log event
    try {
      await serviceClient.from('webhook_events').insert({
        user_id: user.id,
        direction: 'inbound',
        event_type: 'salesforce_sync',
        payload: JSON.stringify({
          stats,
          updates: updates.map(u => ({ name: u.name, ...u.changes })),
        }),
        status: 'success',
        status_code: 200,
      });
    } catch (_) {}

    console.log('[salesforce-sync] Complete —', JSON.stringify(stats));

    return new Response(JSON.stringify({
      success: true,
      action: 'salesforce_sync',
      stats,
      updates: updates.map(u => ({ name: u.name, _action: 'updated', _prev: u.prev || {}, ...u.changes })),
      created: creates.map(c => ({ name: c.name, _action: 'created', mrr: c.mrr, tier: c.tier, lifecycle: c.lifecycle, tickets: c.tickets, days: c.days, renewal_date: c.renewal_date || null, contact_email: c.contact_email || '', contact_name: c.contact_name || '' })),
    }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[salesforce-sync] ERROR:', err.message, err.stack);
    // Return 200 so Supabase client doesn't swallow the error
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 200,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});

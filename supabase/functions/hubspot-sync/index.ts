// ═══════════════════════════════════════════════════════════════
// hubspot-sync — Supabase Edge Function
// On-demand sync: pulls HubSpot companies, deals, tickets,
// engagements and maps them to IQcadence customers
// Called by: sb.functions.invoke('hubspot-sync', { body: {} })
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

// ── HubSpot API helpers ──

const HS_BASE = 'https://api.hubapi.com';

async function hsGet(token: string, path: string): Promise<any> {
  const resp = await fetch(`${HS_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`HubSpot API ${resp.status}: ${body?.message || resp.statusText}`);
  }
  return resp.json();
}

// Paginate through a HubSpot CRM search/list endpoint
async function hsFetchAll(token: string, path: string, properties: string[], limit = 100): Promise<any[]> {
  const all: any[] = [];
  let after: string | undefined;

  while (true) {
    let url = `${path}?limit=${limit}&properties=${properties.join(',')}`;
    if (after) url += `&after=${after}`;
    const data = await hsGet(token, url);
    all.push(...(data.results || []));
    after = data.paging?.next?.after;
    if (!after) break;
  }
  return all;
}

// Fetch companies with all needed properties
async function fetchCompanies(token: string): Promise<any[]> {
  return hsFetchAll(token, '/crm/v3/objects/companies', [
    'name', 'domain', 'hubspot_owner_id', 'hs_lastmodifieddate',
    'lifecyclestage', 'industry', 'annualrevenue', 'numberofemployees',
    'hs_lead_status', 'notes_last_updated'
  ]);
}

// Fetch deals associated with companies
async function fetchDeals(token: string): Promise<any[]> {
  return hsFetchAll(token, '/crm/v3/objects/deals', [
    'dealname', 'amount', 'closedate', 'dealstage', 'pipeline',
    'hs_is_closed_won', 'hs_is_closed', 'recurring_revenue_amount',
    'associations.company'
  ]);
}

// Fetch deal-to-company associations
async function fetchDealAssociations(token: string, dealIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>(); // dealId → [companyIds]
  // Batch in groups of 100
  for (let i = 0; i < dealIds.length; i += 100) {
    const batch = dealIds.slice(i, i + 100);
    try {
      const resp = await fetch(`${HS_BASE}/crm/v3/associations/deals/companies/batch/read`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: batch.map(id => ({ id })) })
      });
      if (resp.ok) {
        const data = await resp.json();
        for (const result of (data.results || [])) {
          const dealId = result.from?.id;
          const companyIds = (result.to || []).map((t: any) => t.id);
          if (dealId && companyIds.length) map.set(dealId, companyIds);
        }
      }
    } catch (_) { /* continue */ }
  }
  return map;
}

// Fetch open tickets with company associations
async function fetchTickets(token: string): Promise<any[]> {
  return hsFetchAll(token, '/crm/v3/objects/tickets', [
    'subject', 'hs_pipeline_stage', 'hs_ticket_priority',
    'createdate', 'hs_lastmodifieddate'
  ]);
}

// Fetch ticket-to-company associations
async function fetchTicketAssociations(token: string, ticketIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (let i = 0; i < ticketIds.length; i += 100) {
    const batch = ticketIds.slice(i, i + 100);
    try {
      const resp = await fetch(`${HS_BASE}/crm/v3/associations/tickets/companies/batch/read`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: batch.map(id => ({ id })) })
      });
      if (resp.ok) {
        const data = await resp.json();
        for (const result of (data.results || [])) {
          const ticketId = result.from?.id;
          const companyIds = (result.to || []).map((t: any) => t.id);
          if (ticketId && companyIds.length) map.set(ticketId, companyIds);
        }
      }
    } catch (_) { /* continue */ }
  }
  return map;
}

// Fetch recent engagements (emails, calls, meetings) for "days since contact"
async function fetchEngagements(token: string): Promise<Map<string, number>> {
  // Returns companyId → days since last engagement
  const companyLastContact = new Map<string, number>(); // companyId → timestamp ms
  const now = Date.now();

  // Fetch recent emails
  for (const objType of ['emails', 'calls', 'meetings']) {
    try {
      const items = await hsFetchAll(token, `/crm/v3/objects/${objType}`, [
        'hs_timestamp', 'hs_createdate'
      ], 100);

      // Get associations to companies
      const ids = items.map(i => i.id);
      if (!ids.length) continue;

      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        try {
          const resp = await fetch(`${HS_BASE}/crm/v3/associations/${objType}/companies/batch/read`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputs: batch.map(id => ({ id })) })
          });
          if (resp.ok) {
            const data = await resp.json();
            for (const result of (data.results || [])) {
              const engId = result.from?.id;
              const eng = items.find(e => e.id === engId);
              if (!eng) continue;
              const ts = new Date(eng.properties?.hs_timestamp || eng.properties?.hs_createdate || 0).getTime();
              for (const to of (result.to || [])) {
                const existing = companyLastContact.get(to.id) || 0;
                if (ts > existing) companyLastContact.set(to.id, ts);
              }
            }
          }
        } catch (_) { /* continue */ }
      }
    } catch (_) { /* continue — engagement type may not be available */ }
  }

  // Convert timestamps to days
  const result = new Map<string, number>();
  for (const [companyId, lastTs] of companyLastContact) {
    if (lastTs > 0) {
      result.set(companyId, Math.floor((now - lastTs) / (1000 * 60 * 60 * 24)));
    }
  }
  return result;
}

// Detect lifecycle from HubSpot lifecycle stage
function mapLifecycle(hsStage: string | null): string | null {
  if (!hsStage) return null;
  const s = hsStage.toLowerCase();
  if (s === 'customer') return 'active';
  if (s === 'subscriber' || s === 'lead' || s === 'marketingqualifiedlead' || s === 'salesqualifiedlead') return 'onboarding';
  if (s === 'opportunity') return 'onboarding';
  if (s === 'evangelist') return 'won';
  if (s === 'other') return 'active';
  return 'active';
}

// Detect tier from annual revenue or employee count
function detectTierFromCompany(props: any): string | null {
  const revenue = parseFloat(props.annualrevenue || '0');
  if (revenue >= 500000) return 'enterprise';
  if (revenue >= 50000) return 'mid';
  if (revenue > 0) return 'smb';

  const employees = parseInt(props.numberofemployees || '0', 10);
  if (employees >= 500) return 'enterprise';
  if (employees >= 50) return 'mid';
  if (employees > 0) return 'smb';

  return null;
}

// Refresh an expired OAuth access token using the refresh token
async function refreshOAuthToken(serviceClient: any, integration: any, tokenData: any): Promise<string> {
  const clientId = Deno.env.get('HUBSPOT_CLIENT_ID');
  const clientSecret = Deno.env.get('HUBSPOT_CLIENT_SECRET');
  if (!clientId || !clientSecret || !tokenData.refresh_token) {
    throw new Error('Cannot refresh token — missing client credentials or refresh token');
  }

  const resp = await fetch('https://api.hubapi.com/oauth/v1/token', {
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
    console.error('Token refresh failed:', err);
    throw new Error('HubSpot token refresh failed. Please reconnect.');
  }

  const newTokens = await resp.json();
  const newPayload = JSON.stringify({
    access_token: newTokens.access_token,
    refresh_token: newTokens.refresh_token,
    expires_at: Date.now() + (newTokens.expires_in * 1000),
  });

  // Update Vault
  if (integration.vault_secret_id) {
    const secretName = `hubspot_oauth_${integration.client_id}`;
    try { await serviceClient.rpc('vault_delete_secret_by_name', { secret_name: secretName }); } catch (_) {}
    const { data: newSecretId } = await serviceClient.rpc('vault_create_secret', {
      new_secret: newPayload,
      new_name: secretName,
      new_description: `HubSpot OAuth tokens for client ${integration.client_id}`,
    });
    if (newSecretId) {
      await serviceClient.from('integrations').update({
        vault_secret_id: newSecretId,
        updated_at: new Date().toISOString(),
      }).eq('client_id', integration.client_id).eq('platform', 'hubspot');
    }
  } else {
    // Fallback: update config
    const config = { ...(integration.config || {}), _credential: newTokens.access_token, _refresh_token: newTokens.refresh_token, _expires_at: Date.now() + (newTokens.expires_in * 1000) };
    await serviceClient.from('integrations').update({ config, updated_at: new Date().toISOString() }).eq('client_id', integration.client_id).eq('platform', 'hubspot');
  }

  return newTokens.access_token;
}

// Retrieve HubSpot token from Vault or config fallback, with auto-refresh for OAuth
async function getHubSpotToken(serviceClient: any, integration: any): Promise<string> {
  // Try Vault first
  if (integration.vault_secret_id) {
    const { data, error } = await serviceClient
      .rpc('vault_read_secret', { secret_id: integration.vault_secret_id });
    if (!error && data) {
      // Check if this is an OAuth JSON payload
      try {
        const tokenData = JSON.parse(data);
        if (tokenData.access_token) {
          // Check if expired (with 5 min buffer)
          if (tokenData.expires_at && tokenData.expires_at < Date.now() + 300000) {
            return await refreshOAuthToken(serviceClient, integration, tokenData);
          }
          return tokenData.access_token;
        }
      } catch {
        // Not JSON — it's a plain PAT token
        return data;
      }
    }
  }
  // Config fallback
  if (integration.config?._auth_type === 'oauth') {
    const tokenData = {
      access_token: integration.config._credential,
      refresh_token: integration.config._refresh_token,
      expires_at: integration.config._expires_at,
    };
    if (tokenData.expires_at && tokenData.expires_at < Date.now() + 300000) {
      return await refreshOAuthToken(serviceClient, integration, tokenData);
    }
    if (tokenData.access_token) return tokenData.access_token;
  }
  if (integration.config?._credential) return integration.config._credential;
  throw new Error('No HubSpot token found. Please reconnect your HubSpot integration.');
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
      throw new Error('HubSpot is not connected. Go to Settings → API & Integrations to connect.');
    }

    const token = await getHubSpotToken(serviceClient, integration);

    // ── Fetch HubSpot data (parallel where possible) ──
    const [companies, deals, tickets] = await Promise.all([
      fetchCompanies(token),
      fetchDeals(token),
      fetchTickets(token),
    ]);

    // Fetch associations + engagements
    const dealIds = deals.map(d => d.id);
    const ticketIds = tickets.map(t => t.id);

    const [dealAssoc, ticketAssoc, engagementDays] = await Promise.all([
      dealIds.length ? fetchDealAssociations(token, dealIds) : Promise.resolve(new Map()),
      ticketIds.length ? fetchTicketAssociations(token, ticketIds) : Promise.resolve(new Map()),
      fetchEngagements(token),
    ]);

    // ── Aggregate deal data per company ──
    const companyDeals = new Map<string, { mrr: number; renewalDate: string }>(); // companyId → aggregated

    for (const deal of deals) {
      const assocCompanyIds = dealAssoc.get(deal.id) || [];
      const props = deal.properties || {};
      const isClosed = props.hs_is_closed === 'true';
      const isWon = props.hs_is_closed_won === 'true';

      // Only count open or closed-won deals
      if (isClosed && !isWon) continue;

      const amount = parseFloat(props.recurring_revenue_amount || props.amount || '0');
      const closeDate = props.closedate ? props.closedate.split('T')[0] : '';

      for (const companyId of assocCompanyIds) {
        const existing = companyDeals.get(companyId) || { mrr: 0, renewalDate: '' };
        existing.mrr += amount > 0 ? Math.round(amount / 12) : 0; // annual → monthly
        // Use closest future close date as renewal
        if (closeDate && closeDate > new Date().toISOString().split('T')[0]) {
          if (!existing.renewalDate || closeDate < existing.renewalDate) {
            existing.renewalDate = closeDate;
          }
        }
        companyDeals.set(companyId, existing);
      }
    }

    // ── Aggregate ticket counts per company ──
    const companyTickets = new Map<string, number>(); // companyId → open ticket count

    for (const ticket of tickets) {
      const assocCompanyIds = ticketAssoc.get(ticket.id) || [];
      const stage = (ticket.properties?.hs_pipeline_stage || '').toLowerCase();
      // Count as open if not in a "closed" stage
      const isOpen = !stage.includes('closed') && !stage.includes('done') && !stage.includes('resolved');
      if (!isOpen) continue;

      for (const companyId of assocCompanyIds) {
        companyTickets.set(companyId, (companyTickets.get(companyId) || 0) + 1);
      }
    }

    // ── Load existing customers ──
    const { data: customers } = await serviceClient
      .from('customers')
      .select('id, name, mrr, arr, tier, lifecycle, tickets, days, nps, csat, hubspot_company_id, external_id, renewal_date, renewal, contact_name, contact_email')
      .eq('client_id', clientId)
      .is('deleted_at', null);

    if (!customers) throw new Error('Failed to load customers');

    // Build lookup maps
    const byHubSpotId = new Map<string, any>();
    const byExtId = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const c of customers) {
      if (c.hubspot_company_id) byHubSpotId.set(c.hubspot_company_id, c);
      if (c.external_id) byExtId.set(c.external_id.toLowerCase(), c);
      byName.set(c.name.toLowerCase().trim(), c);
    }

    // ── Match & update ──
    const syncMetrics = integration.config?.sync_metrics || {};
    const shouldSync = (metric: string) => syncMetrics[metric] !== false;

    const stats = { total: companies.length, matched: 0, created: 0, updated: 0, skipped: 0 };
    const updates: any[] = [];
    const creates: any[] = [];

    for (const company of companies) {
      const hsId = company.id;
      const props = company.properties || {};
      const companyName = (props.name || '').trim();
      if (!companyName) { stats.skipped++; continue; }

      // Match cascade
      let match = byHubSpotId.get(hsId);
      if (!match && props.domain) match = byExtId.get(props.domain.toLowerCase());
      if (!match) match = byName.get(companyName.toLowerCase());

      if (match) {
        // ── Update existing customer ──
        stats.matched++;
        const changes: any = {};

        // Always link hubspot_company_id
        if (hsId !== match.hubspot_company_id) changes.hubspot_company_id = hsId;

        // MRR from deals
        const dealData = companyDeals.get(hsId);
        if (shouldSync('mrr') && dealData?.mrr && dealData.mrr !== (match.mrr || 0)) {
          changes.mrr = dealData.mrr;
          changes.arr = dealData.mrr * 12;
        }

        // Tier
        if (shouldSync('tier')) {
          const newTier = detectTierFromCompany(props);
          if (newTier && newTier !== match.tier) changes.tier = newTier;
        }

        // Lifecycle
        if (shouldSync('lifecycle')) {
          const newLc = mapLifecycle(props.lifecyclestage);
          if (newLc && newLc !== match.lifecycle) changes.lifecycle = newLc;
        }

        // Tickets
        if (shouldSync('tickets')) {
          const ticketCount = companyTickets.get(hsId) || 0;
          if (ticketCount !== (match.tickets || 0)) changes.tickets = ticketCount;
        }

        // Days since contact
        if (shouldSync('days')) {
          const days = engagementDays.get(hsId);
          if (days != null && days !== (match.days || 0)) changes.days = days;
        }

        // Renewal date from deals
        if (shouldSync('renewal') && dealData?.renewalDate) {
          if (dealData.renewalDate !== match.renewal_date) {
            changes.renewal_date = dealData.renewalDate;
            const msToRenewal = new Date(dealData.renewalDate).getTime() - Date.now();
            changes.renewal = Math.max(0, Math.round(msToRenewal / (1000 * 60 * 60 * 24 * 30.44)));
          }
        }

        if (Object.keys(changes).length > 0) {
          updates.push({ id: match.id, name: match.name, changes });
          stats.updated++;
        }
      } else {
        // ── Create new customer ──
        const dealData = companyDeals.get(hsId);
        const newCustomer: any = {
          client_id: clientId,
          user_id: user.id,
          name: companyName,
          hubspot_company_id: hsId,
          external_id: props.domain || null,
          lifecycle: mapLifecycle(props.lifecyclestage) || 'active',
          mrr: dealData?.mrr || 0,
          arr: (dealData?.mrr || 0) * 12,
          tier: detectTierFromCompany(props) || 'smb',
          tickets: companyTickets.get(hsId) || 0,
          days: engagementDays.get(hsId) ?? 0,
          tags: props.industry || '',
          logins: 0,
          adoption: 0,
          nps: '',
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
          const msToRenewal = new Date(dealData.renewalDate).getTime() - Date.now();
          newCustomer.renewal = Math.max(0, Math.round(msToRenewal / (1000 * 60 * 60 * 24 * 30.44)));
        }

        creates.push(newCustomer);
        stats.created++;
      }
    }

    // ── Apply updates ──
    for (const upd of updates) {
      await serviceClient
        .from('customers')
        .update(upd.changes)
        .eq('id', upd.id);
    }

    // ── Insert new customers ──
    if (creates.length) {
      // Batch insert in groups of 50
      for (let i = 0; i < creates.length; i += 50) {
        const batch = creates.slice(i, i + 50);
        const { error } = await serviceClient.from('customers').insert(batch);
        if (error) console.warn('Insert batch error:', error.message);
      }
    }

    // ── Update integration status ──
    await serviceClient
      .from('integrations')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'success',
        last_sync_message: `${stats.matched} matched, ${stats.created} created, ${stats.updated} updated (${stats.total} companies)`,
        sync_stats: stats,
        updated_at: new Date().toISOString()
      })
      .eq('client_id', clientId)
      .eq('platform', 'hubspot');

    // Log event
    try { await serviceClient.from('webhook_events').insert({
      user_id: user.id,
      direction: 'inbound',
      event_type: 'hubspot_sync',
      payload: JSON.stringify({ stats, updates: updates.map(u => ({ name: u.name, ...u.changes })) }),
      status: 'success',
      status_code: 200
    }); } catch(_) {}

    return new Response(JSON.stringify({
      success: true,
      action: 'hubspot_sync',
      stats,
      updates: updates.map(u => ({ name: u.name, ...u.changes }))
    }), { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// hubspot-history — Supabase Edge Function
// Pulls historical HubSpot data (companies, deals, tickets)
// and builds daily signal snapshots per company
// Called by: sb.functions.invoke('hubspot-history', { body: { lookback: '90d' } })
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

// ── Lookback period calculation ──

function parseLookback(lookback: string): number {
  switch (lookback) {
    case '30d': return 30;
    case '90d': return 90;
    case '6mo': return 180;
    case '1yr': return 365;
    default: return 90;
  }
}

function getStartDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── HubSpot API helpers (same pattern as hubspot-sync) ──

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

async function hsFetchAll(token: string, path: string, properties: string[], limit = 100, associations?: string[]): Promise<any[]> {
  const all: any[] = [];
  let after: string | undefined;

  while (true) {
    let url = `${path}?limit=${limit}&properties=${properties.join(',')}`;
    if (associations?.length) url += `&associations=${associations.join(',')}`;
    if (after) url += `&after=${after}`;
    const data = await hsGet(token, url);
    all.push(...(data.results || []));
    after = data.paging?.next?.after;
    if (!after) break;
  }
  return all;
}

// Refresh an expired OAuth access token using the refresh token
async function refreshOAuthToken(serviceClient: any, integration: any, tokenData: any): Promise<string> {
  const clientId = Deno.env.get('HUBSPOT_CLIENT_ID');
  const clientSecret = Deno.env.get('HUBSPOT_CLIENT_SECRET');
  if (!clientId || !clientSecret || !tokenData.refresh_token) {
    throw new Error('Cannot refresh token — missing client credentials or refresh token');
  }

  console.log('[hubspot-history] Refreshing expired access token...');

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
    console.error('[hubspot-history] Token refresh failed:', err);
    throw new Error('HubSpot token refresh failed. Please reconnect.');
  }

  const newTokens = await resp.json();
  const newPayload = JSON.stringify({
    access_token: newTokens.access_token,
    refresh_token: newTokens.refresh_token,
    expires_at: Date.now() + (newTokens.expires_in * 1000),
  });

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
    const config = { ...(integration.config || {}), _credential: newTokens.access_token, _refresh_token: newTokens.refresh_token, _expires_at: Date.now() + (newTokens.expires_in * 1000) };
    await serviceClient.from('integrations').update({ config, updated_at: new Date().toISOString() }).eq('client_id', integration.client_id).eq('platform', 'hubspot');
  }

  console.log('[hubspot-history] Token refreshed successfully');
  return newTokens.access_token;
}

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
      } catch {
        // Not JSON — it's a plain PAT token
        return data;
      }
    }
  }
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

// ── Lifecycle mapping ──

function mapLifecycle(hsStage: string | null): string {
  if (!hsStage) return 'active';
  const s = hsStage.toLowerCase();
  if (s === 'customer') return 'active';
  if (s === 'subscriber' || s === 'lead' || s === 'marketingqualifiedlead' || s === 'salesqualifiedlead') return 'onboarding';
  if (s === 'opportunity') return 'onboarding';
  if (s === 'evangelist') return 'won';
  if (s === 'other') return 'active';
  return 'active';
}

// ── Snapshot builder ──

interface Snapshot {
  date: string;
  score: number | null;
  signals: {
    mrr: number | null;
    tickets: number | null;
    nps: number | null;
    csat: number | null;
    logins: number | null;
    adoption: number | null;
    days: number | null;
    growth: string | null;
    lifecycle: string | null;
  };
}

function buildCompanySnapshots(
  companyId: string,
  lifecycleStage: string | null,
  deals: any[],
  tickets: any[],
  dealAssoc: Map<string, string[]>,
  ticketAssoc: Map<string, string[]>,
  engagementDates: number[], // sorted timestamps of engagements for this company
  startDate: Date,
  endDate: Date,
  dealAmountIsMonthly: boolean
): Snapshot[] {
  // Filter deals and tickets for this company
  const companyDealIds = new Set<string>();
  for (const [dealId, companyIds] of dealAssoc) {
    if (companyIds.includes(companyId)) companyDealIds.add(dealId);
  }
  const companyDeals = deals.filter(d => companyDealIds.has(d.id));

  const companyTicketIds = new Set<string>();
  for (const [ticketId, companyIds] of ticketAssoc) {
    if (companyIds.includes(companyId)) companyTicketIds.add(ticketId);
  }
  const companyTickets = tickets.filter(t => companyTicketIds.has(t.id));

  const lifecycle = mapLifecycle(lifecycleStage);
  let prevSnapshot: string | null = null;
  const snapshots: Snapshot[] = [];

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dayStr = d.toISOString().split('T')[0];
    const dayTs = d.getTime();

    // MRR: cumulative closed-won deal amounts up to this day
    let cumulativeAmount = 0;
    for (const deal of companyDeals) {
      const props = deal.properties || {};
      const isWon = props.hs_is_closed_won === 'true';
      const closeDate = (props.closedate || '').split('T')[0];
      if (isWon && closeDate && closeDate <= dayStr) {
        const amount = parseFloat(props.recurring_revenue_amount || props.amount || '0');
        cumulativeAmount += dealAmountIsMonthly ? amount : amount / 12;
      }
    }
    const mrr = Math.round(cumulativeAmount) || null;

    // Tickets: open on this day
    let openTickets = 0;
    for (const ticket of companyTickets) {
      const props = ticket.properties || {};
      const createdDate = (props.createdate || '').split('T')[0];
      if (createdDate > dayStr) continue;
      const stage = (props.hs_pipeline_stage || '').toLowerCase();
      const isClosed = stage.includes('closed') || stage.includes('done') || stage.includes('resolved');
      // For historical view, we approximate: if ticket is currently closed and was modified before this day, skip
      // Otherwise count it as open (HubSpot doesn't expose close date directly on tickets)
      if (isClosed) {
        const modifiedDate = (props.hs_lastmodifieddate || '').split('T')[0];
        if (modifiedDate && modifiedDate <= dayStr) continue; // was already closed by this day
      }
      openTickets++;
    }
    const tickets_count = openTickets || null;

    // Days since contact
    let daysSinceContact: number | null = null;
    // Find most recent engagement before this day
    for (let i = engagementDates.length - 1; i >= 0; i--) {
      if (engagementDates[i] <= dayTs) {
        daysSinceContact = Math.floor((dayTs - engagementDates[i]) / (1000 * 60 * 60 * 24));
        break;
      }
    }

    // Growth: check 30-day window for deal activity
    let growth: string = 'none';
    const windowStartTs = dayTs - 30 * 24 * 60 * 60 * 1000;
    const windowStartStr = new Date(windowStartTs).toISOString().split('T')[0];
    for (const deal of companyDeals) {
      const props = deal.properties || {};
      const closeDate = (props.closedate || '').split('T')[0];
      if (closeDate >= windowStartStr && closeDate <= dayStr) {
        if (props.hs_is_closed_won === 'true') {
          growth = 'strong';
          break;
        } else if (props.hs_is_closed !== 'true') {
          growth = 'mild';
        }
      }
    }

    const snapshotKey = `${mrr}|${tickets_count}|${daysSinceContact}|${growth}`;
    const hasData = mrr !== null || tickets_count !== null || daysSinceContact !== null || growth !== 'none';

    if (hasData && snapshotKey !== prevSnapshot) {
      snapshots.push({
        date: dayStr + 'T00:00:00Z',
        score: null,
        signals: {
          mrr,
          tickets: tickets_count,
          nps: null,
          csat: null,
          logins: null,
          adoption: null,
          days: daysSinceContact,
          growth,
          lifecycle,
        },
      });
      prevSnapshot = snapshotKey;
    }
  }

  return snapshots;
}

// ── Main handler ──

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    console.log('[hubspot-history] Starting...');

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
    console.log('[hubspot-history] User:', user.id);

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
    console.log('[hubspot-history] Client:', clientId);

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const lookback = body.lookback || '90d';
    const lookbackDays = parseLookback(lookback);
    const startDate = getStartDate(lookbackDays);
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    console.log('[hubspot-history] Lookback:', lookback, '→', lookbackDays, 'days, range:', startDateStr, 'to', endDateStr);

    // Load HubSpot integration
    let integration: any = null;
    const { data: integ1 } = await serviceClient
      .from('integrations')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', 'hubspot')
      .single();
    integration = integ1;

    if (!integration || integration.status !== 'connected') {
      console.log('[hubspot-history] client_id lookup missed, trying RLS fallback...');
      const { data: integ2 } = await supabase
        .from('integrations')
        .select('*')
        .eq('platform', 'hubspot')
        .eq('status', 'connected')
        .single();
      if (integ2) {
        integration = integ2;
        if (integ2.client_id !== clientId) {
          await serviceClient.from('integrations').update({ client_id: clientId }).eq('id', integ2.id);
          console.log('[hubspot-history] Fixed client_id mismatch');
        }
      }
    }

    if (!integration || integration.status !== 'connected') {
      throw new Error('HubSpot is not connected. Go to Settings → API & Integrations to connect.');
    }

    const token = await getHubSpotToken(serviceClient, integration);
    const dealAmountIsMonthly = integration.config?.deal_amount_frequency === 'monthly';
    console.log('[hubspot-history] Token retrieved');

    // ── Fetch HubSpot data ──
    const errors: string[] = [];
    let companies: any[] = [];
    let deals: any[] = [];
    let allTickets: any[] = [];

    try {
      companies = await hsFetchAll(token, '/crm/v3/objects/companies', [
        'name', 'domain', 'hs_object_id', 'lifecyclestage'
      ]);
    } catch (e) { errors.push(`Companies: ${e.message}`); }

    try {
      deals = await hsFetchAll(token, '/crm/v3/objects/deals', [
        'dealname', 'amount', 'closedate', 'dealstage', 'pipeline',
        'hs_is_closed_won', 'hs_is_closed', 'recurring_revenue_amount'
      ], 100, ['companies']);
    } catch (e) { errors.push(`Deals: ${e.message}`); }

    try {
      allTickets = await hsFetchAll(token, '/crm/v3/objects/tickets', [
        'subject', 'hs_pipeline_stage', 'hs_ticket_priority',
        'createdate', 'hs_lastmodifieddate'
      ], 100, ['companies']);
    } catch (e) { errors.push(`Tickets: ${e.message}`); }

    if (errors.length) console.warn('[hubspot-history] Partial fetch errors:', errors.join('; '));
    console.log('[hubspot-history] Data fetched — companies:', companies.length, 'deals:', deals.length, 'tickets:', allTickets.length);

    // Build association maps
    const dealAssoc = new Map<string, string[]>();
    for (const deal of deals) {
      const companyAssocs = deal.associations?.companies?.results || [];
      const companyIds = [...new Set(companyAssocs.map((a: any) => String(a.id)).filter(Boolean))];
      if (companyIds.length) dealAssoc.set(deal.id, companyIds);
    }

    const ticketAssoc = new Map<string, string[]>();
    for (const ticket of allTickets) {
      const companyAssocs = ticket.associations?.companies?.results || [];
      const companyIds = [...new Set(companyAssocs.map((a: any) => String(a.id)).filter(Boolean))];
      if (companyIds.length) ticketAssoc.set(ticket.id, companyIds);
    }

    // Fetch engagements for days-since-contact
    const companyEngagementDates = new Map<string, number[]>(); // companyId -> sorted timestamps
    for (const objType of ['emails', 'calls', 'meetings']) {
      try {
        const items = await hsFetchAll(token, `/crm/v3/objects/${objType}`, [
          'hs_timestamp', 'hs_createdate'
        ], 100, ['companies']);
        console.log(`[hubspot-history] ${objType}: ${items.length} items`);

        for (const eng of items) {
          const ts = new Date(eng.properties?.hs_timestamp || eng.properties?.hs_createdate || 0).getTime();
          if (ts < startDate.getTime()) continue; // skip engagements before our window (for efficiency)
          const companyAssocs = eng.associations?.companies?.results || [];
          for (const assoc of companyAssocs) {
            const companyId = String(assoc.id);
            if (!companyEngagementDates.has(companyId)) companyEngagementDates.set(companyId, []);
            companyEngagementDates.get(companyId)!.push(ts);
          }
        }
      } catch (e) {
        console.warn(`[hubspot-history] Engagement fetch (${objType}) skipped:`, e.message);
      }
    }
    // Sort engagement dates per company
    for (const [, dates] of companyEngagementDates) {
      dates.sort((a, b) => a - b);
    }

    // Filter deals and tickets by date client-side
    const filteredDeals = deals.filter(d => {
      const closeDate = (d.properties?.closedate || '').split('T')[0];
      return closeDate >= startDateStr || !closeDate; // include deals without close date
    });

    const filteredTickets = allTickets.filter(t => {
      const createDate = (t.properties?.createdate || '').split('T')[0];
      return createDate >= startDateStr || !createDate;
    });

    console.log('[hubspot-history] After date filter — deals:', filteredDeals.length, 'tickets:', filteredTickets.length);

    // ── Build snapshots per company ──
    const customers: any[] = [];
    let totalSnapshots = 0;

    for (const company of companies) {
      const props = company.properties || {};
      const name = (props.name || '').trim();
      if (!name) continue;

      const companyId = company.id;
      const engDates = companyEngagementDates.get(companyId) || [];

      const snapshots = buildCompanySnapshots(
        companyId,
        props.lifecyclestage,
        filteredDeals,
        filteredTickets,
        dealAssoc,
        ticketAssoc,
        engDates,
        startDate,
        endDate,
        dealAmountIsMonthly
      );

      if (snapshots.length === 0) continue;

      customers.push({
        name,
        external_id: props.hs_object_id || companyId,
        history: snapshots,
      });
      totalSnapshots += snapshots.length;
    }

    console.log('[hubspot-history] Built snapshots for', customers.length, 'companies,', totalSnapshots, 'total snapshots');

    return new Response(JSON.stringify({
      customers,
      stats: {
        customers: customers.length,
        snapshots: totalSnapshots,
        dateRange: { from: startDateStr, to: endDateStr },
      },
    }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[hubspot-history] ERROR:', err.message, err.stack);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 200,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});

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

// Fetch companies with all needed properties
async function fetchCompanies(token: string): Promise<any[]> {
  return hsFetchAll(token, '/crm/v3/objects/companies', [
    'name', 'domain', 'hubspot_owner_id', 'hs_lastmodifieddate',
    'lifecyclestage', 'industry', 'annualrevenue', 'numberofemployees',
    'hs_lead_status', 'notes_last_updated', 'notes_last_contacted'
  ]);
}

// Fetch deals with inline company associations
async function fetchDeals(token: string): Promise<any[]> {
  return hsFetchAll(token, '/crm/v3/objects/deals', [
    'dealname', 'amount', 'closedate', 'dealstage', 'pipeline',
    'hs_is_closed_won', 'hs_is_closed', 'recurring_revenue_amount'
  ], 100, ['companies']);
}

// Fetch contacts with company associations (for primary email/name)
async function fetchContacts(token: string): Promise<any[]> {
  return hsFetchAll(token, '/crm/v3/objects/contacts', [
    'firstname', 'lastname', 'email', 'jobtitle', 'hs_lead_status',
    'lastmodifieddate'
  ], 100, ['companies']);
}

// Fetch open tickets with company associations inline
async function fetchTickets(token: string): Promise<any[]> {
  return hsFetchAll(token, '/crm/v3/objects/tickets', [
    'subject', 'hs_pipeline_stage', 'hs_ticket_priority',
    'createdate', 'hs_lastmodifieddate'
  ], 100, ['companies']);
}

// Extract ticket-to-company associations from inline associations data
function extractTicketAssociations(tickets: any[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const ticket of tickets) {
    const companyAssocs = ticket.associations?.companies?.results || [];
    const companyIds = [...new Set(companyAssocs.map((a: any) => String(a.id)).filter(Boolean))];
    if (companyIds.length) {
      map.set(ticket.id, companyIds);
    }
  }
  return map;
}

// Fetch recent engagements (emails, calls, meetings) for "days since contact"
async function fetchEngagements(token: string): Promise<Map<string, number>> {
  // Returns companyId → days since last engagement
  const companyLastContact = new Map<string, number>(); // companyId → timestamp ms
  const now = Date.now();

  // Fetch engagements with inline company associations (avoids batch assoc 403)
  for (const objType of ['emails', 'calls', 'meetings']) {
    try {
      const items = await hsFetchAll(token, `/crm/v3/objects/${objType}`, [
        'hs_timestamp', 'hs_createdate'
      ], 100, ['companies']);
      console.log(`[hubspot-sync] ${objType}: ${items.length} items`);

      for (const eng of items) {
        const ts = new Date(eng.properties?.hs_timestamp || eng.properties?.hs_createdate || 0).getTime();
        const companyAssocs = eng.associations?.companies?.results || [];
        for (const assoc of companyAssocs) {
          const companyId = String(assoc.id);
          const existing = companyLastContact.get(companyId) || 0;
          if (ts > existing) companyLastContact.set(companyId, ts);
        }
      }
    } catch (e) {
      console.warn(`[hubspot-sync] Engagement fetch (${objType}) skipped:`, e.message);
    }
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

// Fetch tasks/notes for specific companies via Associations + batch read
// Strategy: get task/note IDs associated to each company, then batch-read details
// This avoids the restricted list endpoints by using associations + individual reads
async function fetchActivitiesViaAssociations(
  token: string,
  companyIds: string[],
  objectType: 'tasks' | 'notes'
): Promise<any[]> {
  const results: any[] = [];
  const allObjectIds = new Map<string, Set<string>>(); // objectId → set of companyIds

  // Step 1: Get associated task/note IDs for each company
  for (const companyId of companyIds) {
    try {
      const data = await hsGet(token, `/crm/v4/objects/companies/${companyId}/associations/${objectType}`);
      for (const assoc of (data.results || [])) {
        const objId = String(assoc.toObjectId);
        if (!allObjectIds.has(objId)) allObjectIds.set(objId, new Set());
        allObjectIds.get(objId)!.add(companyId);
      }
    } catch (e) {
      // If associations API fails, skip this company
      if (companyIds.indexOf(companyId) === 0) {
        console.warn(`[hubspot-sync] ${objectType} associations skipped:`, e.message);
        return []; // If first company fails, the endpoint itself is blocked
      }
    }
  }

  if (allObjectIds.size === 0) return [];
  console.log(`[hubspot-sync] Found ${allObjectIds.size} ${objectType} via associations`);

  // Step 2: Batch read the object details
  const ids = [...allObjectIds.keys()];
  const properties = objectType === 'tasks'
    ? ['hs_task_subject', 'hs_task_body', 'hs_task_status', 'hs_task_priority', 'hs_timestamp', 'hs_task_due_date']
    : ['hs_note_body', 'hs_timestamp', 'hs_lastmodifieddate'];

  // Batch read in chunks of 100
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    try {
      const resp = await fetch(`${HS_BASE}/crm/v3/objects/${objectType}/batch/read`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: batch.map(id => ({ id })),
          properties,
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(`HubSpot batch read ${resp.status}: ${body?.message || resp.statusText}`);
      }
      const data = await resp.json();
      for (const item of (data.results || [])) {
        const props = item.properties || {};
        const objId = String(item.id);
        const compIds = [...(allObjectIds.get(objId) || [])];

        if (objectType === 'tasks') {
          results.push({
            id: objId,
            type: 'task',
            subject: props.hs_task_subject || '',
            body: props.hs_task_body || '',
            status: props.hs_task_status || 'NOT_STARTED',
            priority: props.hs_task_priority || 'NONE',
            date: props.hs_timestamp || '',
            due_date: props.hs_task_due_date || '',
            companyIds: compIds,
            contactIds: [],
          });
        } else {
          results.push({
            id: objId,
            type: 'note',
            body: props.hs_note_body || '',
            date: props.hs_timestamp || props.hs_lastmodifieddate || '',
            companyIds: compIds,
            contactIds: [],
          });
        }
      }
    } catch (e) {
      console.warn(`[hubspot-sync] ${objectType} batch read failed:`, e.message);
    }
  }

  console.log(`[hubspot-sync] ${objectType} via associations: ${results.length} fetched`);
  return results;
}

// Group v1 engagement tasks/notes by company ID into activity entries
// v1 engagements have companyIds and contactIds directly (not nested associations)
function buildActivities(tasks: any[], notes: any[], contactToCompanies: Map<string, string[]>): Map<string, any[]> {
  const companyActivities = new Map<string, any[]>();

  function resolveCompanyIds(item: any): string[] {
    const ids = new Set<string>();
    for (const cid of (item.companyIds || [])) ids.add(String(cid));
    for (const contactId of (item.contactIds || [])) {
      const mapped = contactToCompanies.get(String(contactId)) || [];
      for (const cid of mapped) ids.add(cid);
    }
    return [...ids].filter(Boolean);
  }

  for (const task of tasks) {
    const companyIds = resolveCompanyIds(task);
    const entry = {
      type: 'task',
      hs_id: task.id,
      subject: task.subject || '',
      body: task.body || '',
      status: task.status || 'NOT_STARTED',
      priority: task.priority || 'NONE',
      date: task.date || '',
      due_date: task.due_date || '',
      source: 'hubspot',
    };
    for (const cid of companyIds) {
      if (!companyActivities.has(cid)) companyActivities.set(cid, []);
      companyActivities.get(cid)!.push(entry);
    }
  }

  for (const note of notes) {
    const companyIds = resolveCompanyIds(note);
    const entry = {
      type: 'note',
      hs_id: note.id,
      body: note.body || '',
      date: note.date || '',
      source: 'hubspot',
    };
    for (const cid of companyIds) {
      if (!companyActivities.has(cid)) companyActivities.set(cid, []);
      companyActivities.get(cid)!.push(entry);
    }
  }

  // Sort each company's activities by date descending
  for (const [cid, acts] of companyActivities) {
    acts.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  console.log(`[hubspot-sync] buildActivities: ${tasks.length} tasks, ${notes.length} notes → ${companyActivities.size} companies with activities`);
  return companyActivities;
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
    console.log('[hubspot-sync] Starting...');
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
    console.log('[hubspot-sync] User:', user.id);

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
    console.log('[hubspot-sync] Client:', clientId);

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
    console.log('[hubspot-sync] Integration found, auth_type:', integration.config?._auth_type);

    const token = await getHubSpotToken(serviceClient, integration);
    console.log('[hubspot-sync] Token retrieved, length:', token?.length);

    // ── Fetch HubSpot data (parallel where possible) ──
    const syncMetrics = integration.config?.sync_metrics || {};
    const shouldSync = (metric: string) => syncMetrics[metric] !== false;
    const pullTasks = shouldSync('pull_tasks');
    const pullNotes = shouldSync('pull_notes');

    const [companies, deals, tickets, contacts] = await Promise.all([
      fetchCompanies(token),
      fetchDeals(token),
      fetchTickets(token),
      fetchContacts(token).catch(e => { console.warn('[hubspot-sync] Contacts fetch skipped:', e.message); return []; }),
    ]);

    // Fetch tasks + notes via Associations API (company → tasks/notes)
    // The list endpoints are blocked for public OAuth apps, but associations + batch read work
    const companyIds = companies.map((c: any) => String(c.id));
    let hsTasks: any[] = [];
    let hsNotes: any[] = [];
    if ((pullTasks || pullNotes) && companyIds.length > 0) {
      const [fetchedTasks, fetchedNotes] = await Promise.all([
        pullTasks ? fetchActivitiesViaAssociations(token, companyIds, 'tasks') : Promise.resolve([]),
        pullNotes ? fetchActivitiesViaAssociations(token, companyIds, 'notes') : Promise.resolve([]),
      ]);
      hsTasks = fetchedTasks;
      hsNotes = fetchedNotes;
    }
    console.log('[hubspot-sync] Tasks:', hsTasks.length, 'Notes:', hsNotes.length, '(pull_tasks:', pullTasks, 'pull_notes:', pullNotes, ')');

    // Extract associations from inline data (no separate batch API calls needed)
    const ticketAssoc = extractTicketAssociations(tickets);

    // Extract deal associations inline too
    const dealAssoc = new Map<string, string[]>();
    for (const deal of deals) {
      const companyAssocs = deal.associations?.companies?.results || [];
      const companyIds = [...new Set(companyAssocs.map((a: any) => String(a.id)).filter(Boolean))];
      if (companyIds.length) dealAssoc.set(deal.id, companyIds);
    }
    console.log('[hubspot-sync] Deal associations extracted:', dealAssoc.size, 'of', deals.length, 'deals');

    // Build primary contact per company — use most recently modified contact
    const companyContact = new Map<string, { name: string; email: string; modifiedAt: number }>(); // companyId → best contact
    for (const contact of contacts) {
      const props = contact.properties || {};
      const email = (props.email || '').trim();
      if (!email) continue;
      const name = [props.firstname, props.lastname].filter(Boolean).join(' ').trim();
      const modifiedAt = new Date(props.lastmodifieddate || 0).getTime();
      const assocCompanies = contact.associations?.companies?.results || [];
      for (const assoc of assocCompanies) {
        const companyId = String(assoc.id);
        const existing = companyContact.get(companyId);
        if (!existing || modifiedAt > existing.modifiedAt) {
          companyContact.set(companyId, { name, email, modifiedAt });
        }
      }
    }
    console.log('[hubspot-sync] Contacts mapped:', companyContact.size, 'companies with primary contact');

    // Build contact → company mapping (for resolving task/note associations via contacts)
    const contactToCompanies = new Map<string, string[]>();
    for (const contact of contacts) {
      const assocCompanies = contact.associations?.companies?.results || [];
      if (assocCompanies.length) {
        const compIds = [...new Set(assocCompanies.map((a: any) => String(a.id)).filter(Boolean))];
        contactToCompanies.set(String(contact.id), compIds);
      }
    }
    console.log('[hubspot-sync] Contact→Company mapping:', contactToCompanies.size, 'contacts mapped');

    const engagementDays = await fetchEngagements(token);

    // Fallback: use company-level notes_last_contacted for days since contact
    // when engagement API scopes aren't available
    const now = Date.now();
    for (const company of companies) {
      const hsId = company.id;
      if (engagementDays.has(hsId)) continue; // engagement data already found
      const lastContacted = company.properties?.notes_last_contacted || company.properties?.notes_last_updated;
      if (lastContacted) {
        const ts = new Date(lastContacted).getTime();
        if (ts > 0) {
          engagementDays.set(hsId, Math.floor((now - ts) / (1000 * 60 * 60 * 24)));
        }
      }
    }

    console.log('[hubspot-sync] Data fetched — companies:', companies.length, 'deals:', deals.length, 'tickets:', tickets.length);
    console.log('[hubspot-sync] Associations — deals:', dealAssoc.size, 'tickets:', ticketAssoc.size, 'engagements:', engagementDays.size);

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

    // ── Aggregate ticket counts per company (deduplicated by ticket ID) ──
    const companyTicketSets = new Map<string, Set<string>>(); // companyId → Set of ticket IDs

    for (const ticket of tickets) {
      const assocCompanyIds = ticketAssoc.get(ticket.id) || [];
      const stage = (ticket.properties?.hs_pipeline_stage || '').toLowerCase();
      // Count as open if not in a "closed" stage
      const isOpen = !stage.includes('closed') && !stage.includes('done') && !stage.includes('resolved');
      if (!isOpen) continue;

      for (const companyId of assocCompanyIds) {
        if (!companyTicketSets.has(companyId)) companyTicketSets.set(companyId, new Set());
        companyTicketSets.get(companyId)!.add(ticket.id);
      }
    }
    // Convert sets to counts
    const companyTickets = new Map<string, number>();
    for (const [companyId, ticketSet] of companyTicketSets) {
      companyTickets.set(companyId, ticketSet.size);
    }

    // ── Load existing customers ──
    console.log('[hubspot-sync] Loading customers for client:', clientId);
    const { data: customers, error: custError } = await serviceClient
      .from('customers')
      .select('*')
      .eq('client_id', clientId);

    if (custError) {
      console.error('[hubspot-sync] Customer load error:', custError.message);
      throw new Error('Failed to load customers: ' + custError.message);
    }
    if (!customers) throw new Error('Failed to load customers (null result)');
    // Filter out soft-deleted for updates, but keep all for matching (prevent re-creation)
    const activeCustomers = customers.filter((c: any) => !c.deleted_at);
    const activeHsIds = new Set(activeCustomers.filter((c: any) => c.hubspot_company_id).map((c: any) => c.hubspot_company_id));
    // Only skip deleted IDs that DON'T also belong to an active customer
    const deletedHsIds = new Set(
      customers.filter((c: any) => c.deleted_at && c.hubspot_company_id && !activeHsIds.has(c.hubspot_company_id))
        .map((c: any) => c.hubspot_company_id)
    );

    // Build lookup maps (active customers only)
    const byHubSpotId = new Map<string, any>();
    const byExtId = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const c of activeCustomers) {
      if (c.hubspot_company_id) byHubSpotId.set(c.hubspot_company_id, c);
      if (c.external_id) byExtId.set(c.external_id.toLowerCase(), c);
      byName.set(c.name.toLowerCase().trim(), c);
    }

    // ── Build activities map (tasks + notes per company) ──
    const companyActivities = buildActivities(hsTasks, hsNotes, contactToCompanies);
    console.log('[hubspot-sync] Activities mapped for', companyActivities.size, 'companies');

    // ── Match & update ──
    const stats = { total: companies.length, matched: 0, created: 0, updated: 0, skipped: 0 };
    const updates: any[] = [];
    const creates: any[] = [];

    for (const company of companies) {
      const hsId = company.id;
      const props = company.properties || {};
      const companyName = (props.name || '').trim();
      if (!companyName) { stats.skipped++; continue; }

      // Skip if this HubSpot company was previously deleted in IQcadence
      if (deletedHsIds.has(hsId)) { stats.skipped++; continue; }

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

        // Sync company name if changed in HubSpot
        if (companyName && companyName !== match.name) changes.name = companyName;

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
          if (days != null) {
            if (days !== (match.days || 0)) changes.days = days;
            // Also set last_contact_date so the UI displays the actual date
            const contactDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
            if (contactDate !== match.last_contact_date) changes.last_contact_date = contactDate;
          }
        }

        // Renewal date from deals
        if (shouldSync('renewal') && dealData?.renewalDate) {
          if (dealData.renewalDate !== match.renewal_date) {
            changes.renewal_date = dealData.renewalDate;
            const msToRenewal = new Date(dealData.renewalDate).getTime() - Date.now();
            changes.renewal = Math.max(0, Math.round(msToRenewal / (1000 * 60 * 60 * 24 * 30.44)));
          }
        }

        // Primary contact email/name
        const contact = companyContact.get(hsId);
        if (contact) {
          if (contact.email && contact.email !== (match.contact_email || '')) changes.contact_email = contact.email;
          if (contact.name && contact.name !== (match.contact_name || '')) changes.contact_name = contact.name;
        }

        // HubSpot activities (tasks + notes)
        if (pullTasks || pullNotes) {
          const activities = companyActivities.get(hsId) || [];
          // Merge with existing local activities (preserve IQcadence-sourced entries)
          let existing: any[] = [];
          try { existing = JSON.parse(match.hubspot_activities || '[]'); } catch(_) {}
          const localEntries = existing.filter((e: any) => e.source === 'iqcadence');
          const merged = [...activities, ...localEntries];
          merged.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
          const mergedJson = JSON.stringify(merged);
          if (mergedJson !== (match.hubspot_activities || '[]')) {
            changes.hubspot_activities = mergedJson;
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
          last_contact_date: engagementDays.has(hsId) ? new Date(Date.now() - (engagementDays.get(hsId)! * 86400000)).toISOString().split('T')[0] : null,
          contact_email: companyContact.get(hsId)?.email || '',
          contact_name: companyContact.get(hsId)?.name || '',
          hubspot_activities: JSON.stringify(companyActivities.get(hsId) || []),
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
      console.log(`[hubspot-sync] Updating "${upd.name}":`, Object.keys(upd.changes).join(', '));
      const { error: updErr } = await serviceClient
        .from('customers')
        .update(upd.changes)
        .eq('id', upd.id);
      if (updErr) console.error(`[hubspot-sync] UPDATE FAILED for "${upd.name}":`, updErr.message);
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
    console.error('[hubspot-sync] ERROR:', err.message, err.stack);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});

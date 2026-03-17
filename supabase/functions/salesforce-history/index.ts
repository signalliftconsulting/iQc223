// ═══════════════════════════════════════════════════════════════
// salesforce-history — Supabase Edge Function
// Pulls historical Salesforce data (opportunities, cases, tasks)
// and builds daily signal snapshots per account
// Called by: sb.functions.invoke('salesforce-history', { body: { lookback: '90d' } })
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

function getStartDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

// ── Salesforce API helpers (same pattern as salesforce-sync) ──

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
      url = `${instanceUrl}${data.nextRecordsUrl}`;
    } else {
      url = '';
    }
  }

  return allRecords;
}

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

  console.log('[salesforce-history] Refreshing expired access token...');

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
    console.error('[salesforce-history] Token refresh failed:', err);
    throw new Error('Salesforce token refresh failed. Please reconnect.');
  }

  const newTokens = await resp.json();
  const newAccessToken = newTokens.access_token;
  const newInstanceUrl = newTokens.instance_url || tokenData.instance_url;

  const newPayload = JSON.stringify({
    access_token: newAccessToken,
    refresh_token: newTokens.refresh_token || tokenData.refresh_token,
    instance_url: newInstanceUrl,
    expires_at: Date.now() + 7200000,
  });

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

  console.log('[salesforce-history] Token refreshed successfully');
  return newAccessToken;
}

async function getSalesforceToken(
  serviceClient: any,
  integration: any
): Promise<{ token: string; instanceUrl: string }> {
  if (integration.vault_secret_id) {
    console.log('[salesforce-history] Reading vault secret:', integration.vault_secret_id);
    const { data, error } = await serviceClient
      .rpc('vault_read_secret', { secret_id: integration.vault_secret_id });
    if (!error && data) {
      try {
        const raw = typeof data === 'string' ? data : (Array.isArray(data) ? data[0]?.secret : data.secret || JSON.stringify(data));
        const tokenData = JSON.parse(raw);
        if (tokenData.access_token && tokenData.instance_url) {
          if (tokenData.expires_at && tokenData.expires_at < Date.now() + 300000) {
            const newToken = await refreshSalesforceToken(serviceClient, integration, tokenData);
            return { token: newToken, instanceUrl: tokenData.instance_url };
          }
          return { token: tokenData.access_token, instanceUrl: tokenData.instance_url };
        }
      } catch {
        console.warn('[salesforce-history] Vault secret is not valid JSON');
      }
    }
  }

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

// ── Lifecycle mapping ──

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

function buildAccountSnapshots(
  accountId: string,
  accountType: string,
  opportunities: any[],
  cases: any[],
  tasks: any[],
  startDate: string,
  endDate: string,
  dealAmountIsMonthly: boolean
): Snapshot[] {
  // Data is already filtered per-account by caller
  const start = new Date(startDate);
  const end = new Date(endDate);
  const lifecycle = mapLifecycle(accountType);

  // Pre-sort tasks by date for efficient lookups
  const taskDates = tasks
    .map(t => t.ActivityDate)
    .filter(Boolean)
    .sort();

  // Track previous snapshot to detect changes
  let prevSnapshot: string | null = null;
  const snapshots: Snapshot[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayStr = d.toISOString().split('T')[0];
    const dayEnd = dayStr + 'T23:59:59Z';

    // MRR: cumulative won opp amounts up to this day
    let cumulativeAmount = 0;
    for (const opp of opportunities) {
      if (opp.IsWon && opp.CloseDate && opp.CloseDate.split('T')[0] <= dayStr) {
        const amount = parseFloat(opp.Amount) || 0;
        cumulativeAmount += dealAmountIsMonthly ? amount : amount / 12;
      }
    }
    const mrr = Math.round(cumulativeAmount) || null;

    // Tickets: cases open on this day (created <= day AND (not closed OR closed after day))
    let openTickets = 0;
    for (const c of cases) {
      const createdDate = (c.CreatedDate || '').split('T')[0];
      if (createdDate > dayStr) continue; // not yet created
      if (c.IsClosed) {
        const closedDate = (c.ClosedDate || '').split('T')[0];
        if (closedDate && closedDate <= dayStr) continue; // already closed
      }
      openTickets++;
    }
    const tickets = openTickets || null;

    // Days since contact: days since most recent Task activity before this date
    let daysSinceContact: number | null = null;
    let lastTaskDate: string | null = null;
    for (let i = taskDates.length - 1; i >= 0; i--) {
      if (taskDates[i] <= dayStr) {
        lastTaskDate = taskDates[i];
        break;
      }
    }
    if (lastTaskDate) {
      const diff = (d.getTime() - new Date(lastTaskDate).getTime()) / (1000 * 60 * 60 * 24);
      daysSinceContact = Math.floor(diff);
    }

    // Growth: check for opp activity in a rolling 30-day window ending on this day
    let growth: string = 'none';
    const windowStart = new Date(d);
    windowStart.setDate(windowStart.getDate() - 30);
    const windowStartStr = windowStart.toISOString().split('T')[0];

    for (const opp of opportunities) {
      const closeDate = (opp.CloseDate || '').split('T')[0];
      if (closeDate >= windowStartStr && closeDate <= dayStr) {
        if (opp.IsWon) {
          growth = 'strong';
          break;
        } else {
          growth = 'mild';
        }
      }
    }

    // Build the snapshot key to detect changes
    const snapshotKey = `${mrr}|${tickets}|${daysSinceContact}|${growth}`;

    // Only emit if something has data and something changed
    const hasData = mrr !== null || tickets !== null || daysSinceContact !== null || growth !== 'none';
    if (hasData && snapshotKey !== prevSnapshot) {
      snapshots.push({
        date: dayStr + 'T00:00:00Z',
        score: null,
        signals: {
          mrr: mrr,
          tickets: tickets,
          nps: null,
          csat: null,
          logins: null,
          adoption: null,
          days: daysSinceContact,
          growth: growth,
          lifecycle: lifecycle,
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
    console.log('[salesforce-history] Starting...');

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
    console.log('[salesforce-history] User:', user.id);

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
    console.log('[salesforce-history] Client:', clientId);

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const lookback = body.lookback || '90d';
    const lookbackDays = parseLookback(lookback);
    const startDate = getStartDate(lookbackDays);
    const endDate = new Date().toISOString().split('T')[0];
    console.log('[salesforce-history] Lookback:', lookback, '→', lookbackDays, 'days, range:', startDate, 'to', endDate);

    // Load Salesforce integration
    let integration: any = null;
    const { data: integ1 } = await serviceClient
      .from('integrations')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', 'salesforce')
      .single();
    integration = integ1;

    if (!integration || integration.status !== 'connected') {
      console.log('[salesforce-history] client_id lookup missed, trying RLS fallback...');
      const { data: integ2 } = await supabase
        .from('integrations')
        .select('*')
        .eq('platform', 'salesforce')
        .eq('status', 'connected')
        .single();
      if (integ2) {
        integration = integ2;
        if (integ2.client_id !== clientId) {
          await serviceClient.from('integrations').update({ client_id: clientId }).eq('id', integ2.id);
          console.log('[salesforce-history] Fixed client_id mismatch');
        }
      }
    }

    if (!integration || integration.status !== 'connected') {
      throw new Error('Salesforce is not connected. Go to Settings → API & Integrations to connect.');
    }

    let { token, instanceUrl } = await getSalesforceToken(serviceClient, integration);
    const dealAmountIsMonthly = integration.config?.deal_amount_frequency === 'monthly';

    // ── Fetch Salesforce data with date filters ──
    async function fetchAllData(t: string, url: string) {
      const errors: string[] = [];
      let accounts: any[] = [];
      let opportunities: any[] = [];
      let cases: any[] = [];
      let tasks: any[] = [];

      try {
        accounts = await sfQuery(t, url, "SELECT Id, Name, Type, LastActivityDate FROM Account");
      } catch (e) { errors.push(`Accounts: ${e.message}`); }

      try {
        opportunities = await sfQuery(t, url,
          `SELECT Id, AccountId, Amount, CloseDate, StageName, IsWon FROM Opportunity WHERE CloseDate >= ${startDate}`);
      } catch (e) { errors.push(`Opportunities: ${e.message}`); }

      try {
        cases = await sfQuery(t, url,
          `SELECT Id, AccountId, CreatedDate, Status, IsClosed, ClosedDate FROM Case WHERE CreatedDate >= ${startDate}`);
      } catch (e) { errors.push(`Cases: ${e.message}`); }

      try {
        tasks = await sfQuery(t, url,
          `SELECT Id, AccountId, ActivityDate FROM Task WHERE ActivityDate >= ${startDate}`);
      } catch (e) { errors.push(`Tasks: ${e.message}`); }

      if (errors.length) console.warn('[salesforce-history] Partial fetch errors:', errors.join('; '));
      return { accounts, opportunities, cases, tasks, errors };
    }

    let data: { accounts: any[]; opportunities: any[]; cases: any[]; tasks: any[]; errors: string[] };

    try {
      data = await fetchAllData(token, instanceUrl);
    } catch (err) {
      if (err.message === 'TOKEN_EXPIRED') {
        console.log('[salesforce-history] Token expired, refreshing and retrying...');
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

    const { accounts, opportunities, cases, tasks } = data;
    console.log('[salesforce-history] Data fetched — accounts:', accounts.length,
      'opportunities:', opportunities.length, 'cases:', cases.length, 'tasks:', tasks.length);

    // ── Index data by AccountId for fast lookups ──
    const oppsByAcct = new Map<string, any[]>();
    for (const o of opportunities) {
      if (!o.AccountId) continue;
      if (!oppsByAcct.has(o.AccountId)) oppsByAcct.set(o.AccountId, []);
      oppsByAcct.get(o.AccountId)!.push(o);
    }
    const casesByAcct = new Map<string, any[]>();
    for (const c of cases) {
      if (!c.AccountId) continue;
      if (!casesByAcct.has(c.AccountId)) casesByAcct.set(c.AccountId, []);
      casesByAcct.get(c.AccountId)!.push(c);
    }
    const tasksByAcct = new Map<string, any[]>();
    for (const t of tasks) {
      if (!t.AccountId) continue;
      if (!tasksByAcct.has(t.AccountId)) tasksByAcct.set(t.AccountId, []);
      tasksByAcct.get(t.AccountId)!.push(t);
    }

    // ── Build snapshots per account (skip those with zero related records) ──
    const customers: any[] = [];
    let totalSnapshots = 0;

    for (const account of accounts) {
      const name = (account.Name || '').trim();
      if (!name) continue;

      const id = account.Id;
      // Skip accounts with no data at all
      if (!oppsByAcct.has(id) && !casesByAcct.has(id) && !tasksByAcct.has(id)) continue;

      const snapshots = buildAccountSnapshots(
        id,
        account.Type || '',
        oppsByAcct.get(id) || [],
        casesByAcct.get(id) || [],
        tasksByAcct.get(id) || [],
        startDate,
        endDate,
        dealAmountIsMonthly
      );

      if (snapshots.length === 0) continue;

      customers.push({
        name,
        external_id: id,
        history: snapshots,
      });
      totalSnapshots += snapshots.length;
    }

    console.log('[salesforce-history] Built snapshots for', customers.length, 'accounts,', totalSnapshots, 'total snapshots');

    return new Response(JSON.stringify({
      customers,
      stats: {
        customers: customers.length,
        snapshots: totalSnapshots,
        dateRange: { from: startDate, to: endDate },
      },
    }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[salesforce-history] ERROR:', err.message, err.stack);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 200,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});

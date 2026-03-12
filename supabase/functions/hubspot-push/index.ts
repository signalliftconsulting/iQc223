// ═══════════════════════════════════════════════════════════════
// hubspot-push — Supabase Edge Function
// Pushes IQcadence data back to HubSpot: create tasks, notes,
// or update company properties (health score, lifecycle)
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

async function hsPost(token: string, path: string, body: any): Promise<any> {
  const resp = await fetch(`${HS_BASE}${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(`HubSpot API ${resp.status}: ${data?.message || resp.statusText}`);
  }
  return resp.json();
}

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

// Retrieve HubSpot token
async function getHubSpotToken(serviceClient: any, integration: any): Promise<string> {
  if (integration.vault_secret_id) {
    const { data, error } = await serviceClient
      .rpc('vault_read_secret', { secret_id: integration.vault_secret_id });
    if (!error && data) return data;
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

    // ── CREATE TASK ──
    if (action === 'create_task') {
      const taskBody = data?.body || `IQcadence alert for ${customer.name}`;
      const subject = data?.subject || `[IQcadence] Action needed: ${customer.name}`;
      const priority = data?.priority || 'MEDIUM'; // LOW, MEDIUM, HIGH

      // Create task
      const task = await hsPost(token, '/crm/v3/objects/tasks', {
        properties: {
          hs_task_subject: subject,
          hs_task_body: taskBody,
          hs_task_status: 'NOT_STARTED',
          hs_task_priority: priority,
          hs_timestamp: new Date().toISOString()
        }
      });

      // Associate task with company
      if (task?.id) {
        try {
          await hsPost(token, `/crm/v3/objects/tasks/${task.id}/associations/companies/${companyId}/task_to_company`, {});
        } catch (e) {
          // Try v4 association format
          try {
            await fetch(`${HS_BASE}/crm/v4/objects/tasks/${task.id}/associations/companies/${companyId}`, {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify([{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 204 }])
            });
          } catch (_) { /* association failed — task still created */ }
        }
      }

      result = { taskId: task?.id, subject };
    }

    // ── CREATE NOTE ──
    else if (action === 'create_note') {
      const noteBody = data?.body || `Health score: ${customer.score} | Status: ${customer.lifecycle}`;

      const note = await hsPost(token, '/crm/v3/objects/notes', {
        properties: {
          hs_note_body: noteBody,
          hs_timestamp: new Date().toISOString()
        }
      });

      // Associate note with company
      if (note?.id) {
        try {
          await fetch(`${HS_BASE}/crm/v4/objects/notes/${note.id}/associations/companies/${companyId}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify([{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }])
          });
        } catch (_) { /* association failed */ }
      }

      result = { noteId: note?.id };
    }

    // ── UPDATE COMPANY PROPERTY ──
    else if (action === 'update_property') {
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
      throw new Error('Invalid action. Must be "create_task", "create_note", or "update_property".');
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
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
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

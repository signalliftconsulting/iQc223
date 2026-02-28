// ═══════════════════════════════════════════════════════════════
// send-webhook — Supabase Edge Function
// Proxies outbound webhook POSTs (browser can't do this due to CORS)
// Also handles email alerts via Resend API (mode: 'email')
// Called by: sb.functions.invoke('send-webhook', { body: {...} })
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

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    // ── Verify JWT from the calling client ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    // ── Parse request ──
    const body = await req.json();
    const { mode, event_type, customer_id, customer_name } = body;

    // Service client for logging (bypasses RLS)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ════════════════════════════════════════════════════════
    // MODE: email — Send via Resend API
    // ════════════════════════════════════════════════════════
    if (mode === 'email') {
      const { recipients, subject, html_body } = body;
      if (!recipients) throw new Error('Missing email recipients');
      if (!html_body) throw new Error('Missing email HTML body');

      const resendKey = Deno.env.get('RESEND_API_KEY');
      if (!resendKey) throw new Error('RESEND_API_KEY not configured. Set it with: supabase secrets set RESEND_API_KEY=re_xxxx');

      // Split comma-separated recipients and trim
      const toList = recipients.split(',').map((e: string) => e.trim()).filter(Boolean);
      if (!toList.length) throw new Error('No valid email recipients');

      // Determine sender — use verified domain or Resend test domain
      const fromDomain = Deno.env.get('RESEND_FROM_DOMAIN') || 'onboarding@resend.dev';
      const fromName = Deno.env.get('RESEND_FROM_NAME') || 'iQcadence Alerts';
      const from = fromDomain.includes('@') ? `${fromName} <${fromDomain}>` : `${fromName} <alerts@${fromDomain}>`;

      let status = 'success';
      let status_code = 0;
      let error_msg = '';

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from,
            to: toList,
            subject: subject || '[iQcadence Alert]',
            html: html_body
          }),
          signal: controller.signal
        });

        clearTimeout(timeout);
        status_code = resp.status;

        if (!resp.ok) {
          status = 'failed';
          const errBody = await resp.text();
          error_msg = `HTTP ${resp.status}: ${errBody}`;
        }
      } catch (fetchErr: any) {
        status = 'failed';
        error_msg = fetchErr.message || 'Email send failed';
      }

      // Log the email event
      await serviceClient.from('webhook_events').insert({
        user_id:       user.id,
        direction:     'outbound',
        event_type:    event_type || 'email',
        payload:       JSON.stringify({ recipients, subject }),
        status,
        status_code,
        error_msg,
        customer_id:   customer_id || null,
        customer_name: customer_name || ''
      });

      return new Response(JSON.stringify({ success: status === 'success', status_code, error_msg }), {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    // ════════════════════════════════════════════════════════
    // DEFAULT MODE: Webhook POST
    // ════════════════════════════════════════════════════════
    const { url, payload, test } = body;
    if (!url) throw new Error('Missing webhook URL');

    // ── POST to webhook URL with timeout ──
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    let status_code = 0;
    let status = 'success';
    let error_msg = '';

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      status_code = resp.status;
      if (!resp.ok) {
        status = 'failed';
        error_msg = `HTTP ${resp.status}: ${resp.statusText}`;
      }
    } catch (fetchErr: any) {
      status = 'failed';
      error_msg = fetchErr.message || 'Connection failed';
    } finally {
      clearTimeout(timeout);
    }

    // ── Log the event ──
    await serviceClient.from('webhook_events').insert({
      user_id:       user.id,
      direction:     'outbound',
      event_type:    event_type || 'unknown',
      payload:       JSON.stringify(payload),
      status,
      status_code,
      error_msg,
      customer_id:   customer_id || null,
      customer_name: customer_name || ''
    });

    return new Response(JSON.stringify({ success: status === 'success', status_code, error_msg }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});

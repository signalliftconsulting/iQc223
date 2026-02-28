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

// ── SSRF protection: validate webhook URLs before fetching ──
function validateWebhookUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid webhook URL');
  }

  // Only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use http or https protocol');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block known dangerous hostnames
  if (['localhost', 'metadata.google.internal'].includes(hostname)) {
    throw new Error('Webhook URL hostname is not allowed');
  }
  if (hostname.endsWith('.local')) {
    throw new Error('Webhook URL hostname is not allowed');
  }

  // Block private/reserved IPv4 ranges
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    if (
      first === 0 ||                                     // 0.0.0.0/8
      first === 10 ||                                    // 10.0.0.0/8
      first === 127 ||                                   // 127.0.0.0/8
      (first === 169 && second === 254) ||               // 169.254.0.0/16
      (first === 172 && second >= 16 && second <= 31) || // 172.16.0.0/12
      (first === 192 && second === 168)                  // 192.168.0.0/16
    ) {
      throw new Error('Webhook URL must not target private/reserved IP addresses');
    }
  }

  // Block IPv6 loopback and private ranges
  if (hostname === '[::1]' || hostname === '::1') {
    throw new Error('Webhook URL must not target loopback addresses');
  }
  if (/^\[?f[cd]/i.test(hostname) || /^\[?fe80:/i.test(hostname)) {
    throw new Error('Webhook URL must not target private IPv6 addresses');
  }

  return parsed.href;
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

    // ── SSRF protection: validate webhook target ──
    const validatedUrl = validateWebhookUrl(url);

    // ── POST to webhook URL with timeout ──
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    let status_code = 0;
    let status = 'success';
    let error_msg = '';

    try {
      const resp = await fetch(validatedUrl, {
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

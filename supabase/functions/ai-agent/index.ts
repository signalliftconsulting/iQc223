// ═══════════════════════════════════════════════════════════════
// ai-agent — Supabase Edge Function
// Proxies OpenAI API calls for AI-powered customer insights
// Supports: detail_insights, meeting_prep, daily_focus, save_playbook
// Called by: sb.functions.invoke('ai-agent', { body: {...} })
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

// ── Build a plain-text summary of a customer for the AI prompt ──
function buildCustomerSummary(c: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`Customer: ${c.name}`);
  lines.push(`Health Score: ${c.score}/100 (Status: ${c.status})`);
  if (c.tier) lines.push(`Tier: ${c.tier}`);
  if (c.lifecycle) lines.push(`Lifecycle: ${c.lifecycle}`);
  if (c.mrr) lines.push(`MRR: $${c.mrr}, ARR: $${c.arr || (c.mrr as number) * 12}`);
  if (c.manager) lines.push(`CSM: ${c.manager}`);
  if (c.contact_name) lines.push(`Primary Contact: ${c.contact_name}`);

  lines.push('--- Signals ---');
  if (c.logins != null) lines.push(`Logins (30d): ${c.logins}`);
  if (c.adoption != null) lines.push(`Feature Adoption: ${c.adoption}%`);
  if (c.tickets != null) lines.push(`Open Tickets: ${c.tickets}`);
  if (c.nps != null) lines.push(`NPS: ${c.nps}/10`);
  if (c.csat != null) lines.push(`CSAT: ${c.csat}/5`);
  if (c.days != null) lines.push(`Days Since Contact: ${c.days}`);
  if (c.growth) lines.push(`Growth Signal: ${c.growth}`);

  if (c.renewal_date) lines.push(`Renewal Date: ${c.renewal_date}`);
  if (c.billing_interval) lines.push(`Billing: ${c.billing_interval}`);
  if (c.tags && (c.tags as string[]).length) lines.push(`Tags: ${(c.tags as string[]).join(', ')}`);

  const history = c.history as Array<{ score: number; date: string }> | undefined;
  if (history?.length) {
    lines.push('--- Score History (recent) ---');
    history.slice(-10).forEach(h => lines.push(`  ${h.date}: ${h.score}`));
  }

  const notes = c.notes as Array<{ text: string; date: string }> | undefined;
  if (notes?.length) {
    lines.push('--- Recent Notes ---');
    notes.slice(-5).forEach(n => lines.push(`  [${n.date}] ${n.text}`));
  }

  const sentiment = c.sentiment as Array<{ val: string; note?: string; date: string }> | undefined;
  if (sentiment?.length) {
    lines.push('--- Sentiment Log ---');
    sentiment.slice(-5).forEach(s => lines.push(`  [${s.date}] ${s.val}${s.note ? ': ' + s.note : ''}`));
  }

  return lines.join('\n');
}

// ── System prompt shared across all prompt types ──
const SYSTEM_PROMPT = `You are an expert Customer Success analyst for iQcadence CS Health Score.
You analyze customer health data and provide actionable insights for Customer Success Managers (CSMs).

You MUST respond ONLY with valid JSON matching the requested schema. No markdown fences, no explanation outside JSON.

Health score ranges: 0-24 = Critical, 25-49 = At Risk, 50-64 = Watch, 65-79 = Healthy, 80-100 = Expand.
Lifecycle stages: onboarding, active, won (post-expansion), churned.
Growth signals: none (flat/declining), mild (moderate growth), strong (significant growth).
NPS: 0-6 = Detractor, 7-8 = Passive, 9-10 = Promoter.
CSAT: 1-2 = Poor, 3 = Neutral, 4-5 = Good.
Signals use null when the metric is not tracked for this customer.`;

// ── Build the user prompt based on prompt_type ──
function buildUserPrompt(promptType: string, data: Record<string, unknown>): string {
  if (promptType === 'detail_insights') {
    const summary = buildCustomerSummary(data.customer as Record<string, unknown>);
    return `Analyze this customer and respond with JSON:
${summary}

Response schema:
{"risk_factors":[{"title":"short label","detail":"1-2 sentence explanation","severity":"red|amber|green"}],"actions":[{"title":"short label","detail":"1-2 sentence with specific next step","priority":"high|medium|low"}],"summary":"2-3 sentence health narrative"}

Rules:
- 2-4 risk factors, ordered by severity (red first)
- 2-4 recommended actions, ordered by priority (high first)
- Summary should be conversational and reference specific data points
- If signals are null/missing, note the data gap as a risk factor
- Be specific — mention actual numbers, dates, and thresholds`;
  }

  if (promptType === 'meeting_prep') {
    const summary = buildCustomerSummary(data.customer as Record<string, unknown>);
    return `Prepare a customer meeting briefing:
${summary}

Response schema:
{"briefing":"3-4 sentence executive summary","talking_points":[{"topic":"short label","detail":"what to say/ask","tone":"positive|neutral|cautious"}],"risks_to_address":[{"risk":"the issue","suggested_approach":"how to bring it up"}],"trends":[{"observation":"what changed","implication":"what it means"}]}

Rules:
- 3-5 talking points covering engagement, satisfaction, and value
- 1-3 risks (empty array if genuinely healthy)
- 1-3 trends based on score history and signal changes
- Tone should be professional — these are talking points for a real meeting
- Include specific conversation starters the CSM can use verbatim`;
  }

  if (promptType === 'daily_focus') {
    const customers = data.customers as Array<Record<string, unknown>>;
    const summaries = customers.map((c, i) =>
      `[${i + 1}] ${c.name} — Score: ${c.score} (${c.status}), MRR: $${c.mrr || 0}, Days Since Contact: ${c.days ?? '?'}, Renewal: ${c.renewal_date || 'N/A'}, Trend: ${c.trend || 'stable'}`
    ).join('\n');
    return `Here are the customers that need attention today. Pick the 5 most urgent and explain why:
${summaries}

Response schema:
{"focus_accounts":[{"name":"exact customer name from list","reason":"why this account needs attention today","action":"specific first step to take","urgency":"high|medium"}],"portfolio_note":"1-2 sentence overall observation about this portfolio"}

Rules:
- Exactly 5 accounts, ordered by urgency (high first)
- Reasons should reference specific signals and thresholds
- Actions should be concrete and achievable today
- Portfolio note should identify a pattern or theme across the accounts`;
  }

  if (promptType === 'save_playbook') {
    const summary = buildCustomerSummary(data.customer as Record<string, unknown>);
    return `This customer is at risk. Create a 4-week save plan:
${summary}

Response schema:
{"diagnosis":"2-3 sentence root cause analysis of why this account is at risk","weeks":[{"week":1,"theme":"week theme","actions":[{"task":"action item","detail":"how to do it","owner":"csm|support|exec"}]}],"success_criteria":"how to measure if the save plan is working after 4 weeks"}

Rules:
- Diagnosis should identify the 1-2 root causes, not just list symptoms
- 4 weeks, each with a clear theme and 2-3 actions
- Actions should escalate: week 1 = assess/connect, week 2 = address issues, week 3 = demonstrate value, week 4 = secure commitment
- Owner: "csm" for CSM tasks, "support" for technical/support tasks, "exec" for executive sponsor involvement
- Success criteria should be measurable (score target, engagement metric, etc.)`;
  }

  throw new Error(`Unknown prompt_type: ${promptType}`);
}

// ── Get max_tokens for each prompt type ──
function getMaxTokens(promptType: string): number {
  if (promptType === 'save_playbook') return 1500;
  if (promptType === 'daily_focus') return 1200;
  if (promptType === 'meeting_prep') return 1024;
  return 512; // detail_insights (compact)
}

// ── Pick model ──
function getModel(_promptType: string, configModel?: string): string {
  return configModel || 'gpt-4o-mini';
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

    // Service client for Vault + integrations
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

    // ── Load AI integration (openai or anthropic) ──
    const { data: integration } = await serviceClient
      .from('integrations')
      .select('*')
      .eq('client_id', clientId)
      .in('platform', ['openai', 'anthropic'])
      .eq('status', 'connected')
      .limit(1)
      .single();

    if (!integration) {
      throw new Error('AI not configured. Add your OpenAI API key in Settings → Integrations.');
    }

    // Read API key from Vault
    let apiKey = '';
    if (integration.vault_secret_id) {
      try {
        const { data, error } = await serviceClient
          .rpc('vault_read_secret', { secret_id: integration.vault_secret_id });
        if (!error && data) apiKey = data;
      } catch (_) { /* Vault unavailable */ }
    }
    // Fallback to config credential
    if (!apiKey && integration.config?._credential) {
      apiKey = integration.config._credential;
    }
    if (!apiKey) throw new Error('AI API key not found');

    // ── Parse request ──
    const body = await req.json();
    const { prompt_type } = body;

    if (!['detail_insights', 'meeting_prep', 'daily_focus', 'save_playbook'].includes(prompt_type)) {
      throw new Error('Invalid prompt_type. Must be detail_insights, meeting_prep, daily_focus, or save_playbook.');
    }

    // Build prompt
    const userPrompt = buildUserPrompt(prompt_type, body);
    const maxTokens = getMaxTokens(prompt_type);

    // ── Call OpenAI API ──
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const aiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getModel(prompt_type, integration.config?.model),
        max_tokens: maxTokens,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!aiResp.ok) {
      const errBody = await aiResp.text();
      console.error(`OpenAI API error (${aiResp.status}):`, errBody.substring(0, 500));
      if (aiResp.status === 401) throw new Error('Invalid OpenAI API key. Please reconnect in Settings → Integrations.');
      if (aiResp.status === 429) throw new Error('AI rate limit exceeded. Please try again in a moment.');
      throw new Error(`AI service error (${aiResp.status})`);
    }

    const aiData = await aiResp.json();
    const rawText = aiData.choices?.[0]?.message?.content || '';

    // Parse JSON — handle possible markdown fences
    let parsed;
    try {
      const jsonStr = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error('Failed to parse AI response:', rawText.substring(0, 500));
      throw new Error('AI returned an unexpected response format. Please try again.');
    }

    return new Response(JSON.stringify({ success: true, data: parsed, prompt_type }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('ai-agent error:', message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});

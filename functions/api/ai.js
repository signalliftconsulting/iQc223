// Cloudflare Pages Function — /api/ai
// Proxies OpenAI API calls, keeps API key server-side
// Near-zero cold start vs Supabase edge functions

const ALLOWED_ORIGINS = [
  'https://iqcadence.pages.dev',
  'https://iqcadence.com',
  'https://www.iqcadence.com',
  'https://iqc223.com',
  'https://www.iqc223.com',
];

function getCorsOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin)
    || /^https:\/\/[a-f0-9]+\.iqcadence\.pages\.dev$/.test(origin)
    || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return isAllowed ? origin : ALLOWED_ORIGINS[0];
}

const SYSTEM_PROMPT = `You are an expert Customer Success analyst for iQcadence CS Health Score.
You analyze customer health data and provide actionable insights for Customer Success Managers (CSMs).

You MUST respond ONLY with valid JSON matching the requested schema. No markdown fences, no explanation outside JSON.

Health score ranges: 0-24 = Critical, 25-49 = At Risk, 50-64 = Watch, 65-79 = Healthy, 80-100 = Expand.
Lifecycle stages: onboarding, active, won (post-expansion), churned.
Growth signals: none (flat/declining), mild (moderate growth), strong (significant growth).
NPS: 0-6 = Detractor, 7-8 = Passive, 9-10 = Promoter.
CSAT: 1-2 = Poor, 3 = Neutral, 4-5 = Good.
Signals use null when the metric is not tracked for this customer.`;

function buildCustomerSummary(c) {
  const lines = [];
  lines.push(`Customer: ${c.name}`);
  lines.push(`Health Score: ${c.score}/100 (Status: ${c.status})`);
  if (c.tier) lines.push(`Tier: ${c.tier}`);
  if (c.lifecycle) lines.push(`Lifecycle: ${c.lifecycle}`);
  if (c.mrr) lines.push(`MRR: $${c.mrr}, ARR: $${c.arr || c.mrr * 12}`);
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
  if (c.tags && c.tags.length) lines.push(`Tags: ${c.tags.join(', ')}`);
  if (c.history && c.history.length) {
    lines.push('--- Score History (recent) ---');
    c.history.slice(-10).forEach(h => lines.push(`  ${h.date}: ${h.score}`));
  }
  if (c.notes && c.notes.length) {
    lines.push('--- Recent Notes ---');
    c.notes.slice(-5).forEach(n => lines.push(`  [${n.date}] ${n.text}`));
  }
  if (c.sentiment && c.sentiment.length) {
    lines.push('--- Sentiment Log ---');
    c.sentiment.slice(-5).forEach(s => lines.push(`  [${s.date}] ${s.val}${s.note ? ': ' + s.note : ''}`));
  }
  return lines.join('\n');
}

function buildUserPrompt(promptType, data) {
  if (promptType === 'detail_insights') {
    return `Analyze this customer and respond with JSON:
${buildCustomerSummary(data.customer)}

Response schema:
{"risk_factors":[{"title":"short label","detail":"1-2 sentence explanation","severity":"red|amber|green"}],"actions":[{"title":"short label","detail":"1-2 sentence with specific next step","priority":"high|medium|low"}],"summary":"2-3 sentence health narrative"}

Rules:
- 2-4 risk factors, ordered by severity (red first)
- 2-4 recommended actions, ordered by priority (high first)
- Summary should be conversational and reference specific data points
- If signals are null/missing, note the data gap as a risk factor
- Be specific — mention actual numbers, dates, and thresholds
- IMPORTANT: If renewal date is within 90 days, this MUST be mentioned in the summary and should appear as a risk factor (amber if healthy, red if at-risk). Upcoming renewals are always relevant context.`;
  }

  if (promptType === 'meeting_prep') {
    return `Prepare a customer meeting briefing:
${buildCustomerSummary(data.customer)}

Response schema:
{"briefing":"3-4 sentence executive summary","talking_points":[{"topic":"short label","detail":"what to say/ask","tone":"positive|neutral|cautious"}],"risks_to_address":[{"risk":"the issue","suggested_approach":"how to bring it up"}],"trends":[{"observation":"what changed","implication":"what it means"}]}

Rules:
- 3-5 talking points covering engagement, satisfaction, and value
- 1-3 risks (empty array if genuinely healthy)
- 1-3 trends based on score history and signal changes
- Tone should be professional — these are talking points for a real meeting
- Include specific conversation starters the CSM can use verbatim
- CRITICAL: Never reference internal metrics directly in talking points (no NPS scores, CSAT numbers, login counts, adoption percentages, health scores, or ticket counts). These are internal signals — the CSM knows them, but should never quote them to the customer. Instead, frame observations naturally: "We noticed your team's usage has dipped recently" not "Your logins were 7 this month." Use the data to inform the conversation, not to recite numbers.
- Risks and trends sections ARE internal-facing (CSM eyes only) — those CAN reference specific metrics and numbers`;
  }

  if (promptType === 'daily_focus') {
    const summaries = data.customers.map((c, i) =>
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

  if (promptType === 'portfolio_overview') {
    const stats = data.stats || {};
    return `Analyze this CS portfolio and write a concise 2-4 sentence executive briefing. Be specific — reference actual numbers, patterns, and risks.

Portfolio Stats:
- Total accounts: ${stats.total || 0}
- Health distribution: ${stats.critical || 0} Critical, ${stats.risk || 0} Risk, ${stats.watch || 0} Watch, ${stats.healthy || 0} Healthy, ${stats.expand || 0} Expand
- Average score: ${stats.avgScore || 0}
- Score trend (${stats.periodDays || 7}d): ${stats.avgDelta > 0 ? '+' : ''}${stats.avgDelta || 0} pts
- Improving accounts: ${stats.improving || 0}, Declining: ${stats.declining || 0}, Stable: ${stats.stable || 0}
- MRR at risk: $${stats.atRiskMRR || 0}
- Total MRR: $${stats.totalMRR || 0}
- Renewals in 30 days: ${stats.renewals30 || 0} ($${stats.renewalMRR || 0} MRR)
- At-risk renewals: ${stats.renewalsAtRisk || 0}
- Silent decliners (previously healthy, now declining): ${stats.silentDecliners || 0} ($${stats.silentDeclinerMRR || 0} MRR)
- Overnight drops (5+ pts): ${stats.overnightDrops || 0}
${stats.weakestSignal ? '- Weakest signal in at-risk accounts: ' + stats.weakestSignal : ''}
${stats.tierDivergence ? '- Tier divergence: ' + stats.tierDivergence : ''}
${stats.contactImpact ? '- Contact impact: ' + stats.contactImpact : ''}

Response schema:
{"overview":"2-4 sentence portfolio briefing highlighting the most important patterns and risks","action_items":[{"text":"verb-first action item with specific numbers and account details","tone":"red|amber|green"}]}

Rules for overview:
- Read like a daily briefing from a VP of CS - strategic, specific, and actionable
- Do NOT restate numbers without context - explain what they mean
- Highlight the most surprising or actionable pattern first
- If the portfolio is mostly healthy, lead with what could go wrong next, not what's going well

Rules for action items (CRITICAL - these must be specific and distinct):
- Exactly 3 action items, each addressing a DIFFERENT aspect of the portfolio
- Use ONLY the numbers from the Portfolio Stats above. Do NOT invent or estimate numbers that are not in the data.
- Each item MUST be a concrete next step, not generic advice
- BAD examples (too vague): "Investigate adoption issues in at-risk accounts", "Monitor upcoming renewals closely", "Review strategies for engaging expanding accounts"
- GOOD pattern: Start with a verb, reference the actual count and MRR from the stats, and give a specific action for THIS week
- The 3 items MUST cover 3 different topics from this list: at-risk accounts, upcoming renewals, declining accounts, silent decliners, uncontacted accounts, expansion opportunities, overnight drops
- Tone: red = urgent/needs action today, amber = important/this week, green = opportunity to capture
- Do NOT repeat the same accounts or themes across items
- NEVER fabricate per-account MRR breakdowns or percentages that are not in the stats`;
  }

  if (promptType === 'save_playbook') {
    const isWatch = data.customer && data.customer.status === 'watch';
    const planType = isWatch ? 'prevention' : 'recovery';
    const planDesc = isWatch
      ? 'Create a tailored 4-week prevention plan to stop this Watch account from declining further. Focus on early intervention — the goal is to move them back to Healthy, not recover from crisis.'
      : 'Create a tailored 4-week recovery plan for this at-risk customer based on their SPECIFIC situation.';
    return `${planDesc}
${buildCustomerSummary(data.customer)}

Response schema:
{"diagnosis":"2-3 sentence root cause analysis — what is SPECIFICALLY wrong with THIS customer based on their signals","weeks":[{"week":1,"theme":"week theme","actions":[{"task":"action item","detail":"how to do it — reference specific metrics/signals from this customer","owner":"csm|support|exec"}]}],"success_criteria":"measurable targets tied to this customer's specific weak signals"}

Rules:
- Diagnosis MUST reference specific signals from the data (e.g. "adoption at 15% with 8 open tickets suggests onboarding failure" not "the customer is at risk")
- Each week's theme must be different and specific to what's wrong — do NOT use generic themes like "assess" or "demonstrate value"
- Actions must be concrete and reference this customer's actual numbers. "Schedule training on underused features" is better than "demonstrate value"
- If logins are low, actions should address WHY (onboarding gaps, champion loss, competing tool)
- If NPS/CSAT is low but usage is high, focus on frustration sources (bugs, support gaps, missing features)
- If days since contact is high, week 1 should prioritize re-engagement with a specific reason to reach out
- If renewal is upcoming, escalate urgency and involve exec sponsor earlier
- Owner: "csm" for relationship/engagement tasks, "support" for technical/product issues, "exec" for executive alignment or escalation
- Success criteria should name specific metric targets for THIS customer (e.g. "adoption above 40%" not just "improved engagement")
- Do NOT produce generic playbooks — every plan should feel unique to the customer's data`;
  }

  return null;
}

function getMaxTokens(promptType) {
  if (promptType === 'portfolio_overview') return 600;
  if (promptType === 'save_playbook') return 1500;
  if (promptType === 'daily_focus') return 1200;
  if (promptType === 'meeting_prep') return 1024;
  return 512;
}

// ─── Server-side rate limiting via Supabase ─────────────────
const PLAN_AI_LIMITS = { core: 500, growth: 5000, custom: Infinity };

async function checkRateLimit(env, clientId) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey || !clientId) return { allowed: true };

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Count AI calls this month + get plan tier in parallel
  const [countRes, clientRes] = await Promise.all([
    fetch(
      `${supabaseUrl}/rest/v1/webhook_events?select=id&event_type=eq.ai_call&client_id=eq.${clientId}&created_at=gte.${monthStart}`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Prefer': 'count=exact', 'Range': '0-0' } }
    ),
    fetch(
      `${supabaseUrl}/rest/v1/clients?select=plan_tier&id=eq.${clientId}`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    )
  ]);

  const count = parseInt(countRes.headers.get('content-range')?.split('/')[1] || '0');
  const client = await clientRes.json();
  const tier = client?.[0]?.plan_tier || 'core';
  const limit = PLAN_AI_LIMITS[tier] ?? 500;

  return { allowed: count < limit, count, limit, tier };
}

async function logAICall(env, clientId, promptType) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  await fetch(`${supabaseUrl}/rest/v1/webhook_events`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      direction: 'outbound',
      event_type: 'ai_call',
      client_id: clientId,
      payload: { prompt_type: promptType },
      status: 'sent'
    })
  });
}

export async function onRequestPost(context) {
  const { env, request } = context;

  // CORS — validate origin against whitelist
  const corsHeaders = {
    'Access-Control-Allow-Origin': getCorsOrigin(request),
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json',
  };

  try {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

    const body = await request.json();
    const { prompt_type, client_id } = body;

    // Server-side rate limiting
    if (client_id) {
      const rl = await checkRateLimit(env, client_id);
      if (!rl.allowed) {
        return new Response(JSON.stringify({
          success: false,
          error: `AI call limit reached (${rl.count}/${rl.limit} this month on ${rl.tier} plan). Upgrade for more.`
        }), { status: 429, headers: corsHeaders });
      }
    }

    const userPrompt = buildUserPrompt(prompt_type, body);
    if (!userPrompt) throw new Error('Invalid prompt_type');

    const maxTokens = getMaxTokens(prompt_type);

    const aiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: maxTokens,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      const errBody = await aiResp.text();
      if (aiResp.status === 429) throw new Error('AI rate limit exceeded. Try again in a moment.');
      throw new Error(`AI service error (${aiResp.status})`);
    }

    const aiData = await aiResp.json();
    const rawText = aiData.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim());

    // Log successful AI call for rate tracking
    if (client_id) logAICall(env, client_id, prompt_type).catch(() => {});

    return new Response(JSON.stringify({ success: true, data: parsed, prompt_type }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: err.message?.includes('limit reached') ? 429 : 400,
      headers: corsHeaders,
    });
  }
}

export async function onRequestOptions(context) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': getCorsOrigin(context.request),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
    },
  });
}

// ─── Standalone Worker compatibility ─────────────────────────
// Allows deploying this file as a Cloudflare Worker (not just Pages Function)
export default {
  async fetch(request, env) {
    const context = { request, env };
    if (request.method === 'OPTIONS') return onRequestOptions(context);
    if (request.method === 'POST') return onRequestPost(context);
    return new Response('Method not allowed', { status: 405 });
  }
};

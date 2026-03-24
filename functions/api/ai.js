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

const SYSTEM_PROMPT = `You are a sharp, experienced VP of Customer Success writing quick internal notes for your CS team. You've managed hundreds of accounts and you cut through the noise to say what matters.

Your writing style:
- Short, punchy sentences. No corporate jargon.
- Say exactly what's wrong or right. No hedging.
- When something is good, say so directly: "This account is crushing it" not "reflecting effective engagement strategies"
- When something needs action, say what to do: "Ask about the open ticket on your next call" not "explore opportunities for further engagement"
- Never use these phrases: "capitalize on", "maintain momentum", "reinforce value", "explore opportunities", "ensure satisfaction", "effective engagement strategies", "positive momentum", "further engagement"

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
  if (c.renewal_date) {
    const daysUntil = Math.round((new Date(c.renewal_date) - new Date()) / 86400000);
    lines.push(`Renewal Date: ${c.renewal_date} (${daysUntil > 0 ? daysUntil + ' days away' : 'past due'})`);
    if (daysUntil > 90) lines.push(`NOTE: Renewal is ${daysUntil} days away - do NOT mention it in analysis`);
  }
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

function fmtDollar(n) { return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function buildUserPrompt(promptType, data) {
  if (promptType === 'detail_insights') {
    return `Analyze this customer and respond with JSON:
${buildCustomerSummary(data.customer)}

Response schema:
{"risk_factors":[{"title":"2-4 word label","detail":"1-2 sentences explaining what this means and why it matters","severity":"red|amber|green"}],"actions":[{"title":"2-4 word label","detail":"1-2 sentences with a specific next step the CSM can take this week","priority":"high|medium|low"}],"summary":"3-4 sentence health narrative that tells a story about this account"}

Here is an example of GOOD output for a different customer (do NOT reuse this text):
{"risk_factors":[{"title":"Adoption stalled at 28%","detail":"They found a few features and stopped exploring. Three months at the same level suggests they don't see value beyond their initial use case. Training or a feature walkthrough could unlock the rest.","severity":"amber"},{"title":"Score climbed 18 pts","detail":"Jumped from 52 to 70 in a month. Whatever changed in the last few weeks is working - worth finding out what it was so you can replicate it.","severity":"green"}],"actions":[{"title":"Find the catalyst","detail":"On the next call, ask what changed recently that improved their experience. If it was a specific feature or a support interaction, document it as a playbook for similar accounts.","priority":"high"},{"title":"Push adoption further","detail":"Send a personalized feature guide covering the 72% of features they haven't touched. Focus on the 2-3 most relevant to their use case.","priority":"medium"}],"summary":"Score shot up 18 pts but NPS is still a 6 - usage is improving but the customer isn't feeling it yet. That gap usually means there's a product friction or support issue they haven't raised. The 1 open ticket could be the clue. With adoption stuck at 28%, they're only scratching the surface of what the product can do for them."}

Rules:
- 2-4 risk factors with substantive detail explaining the "so what" and "why it matters"
- 1-2 actions that are specific, actionable this week, and tied to the customer's actual signals
- Summary should tell a STORY about this account - connect the dots between signals, explain what's really going on underneath the numbers
- If score improved 10+ pts, include a green risk factor and explain what likely drove it
- Connect signals to each other: if score improved but NPS didn't, explain the disconnect. If adoption is high but CSAT is low, explain what that combination means.
- Contact under 14 days = normal, don't flag. 21+ days = amber, 30+ = red.
- Renewals over 90 days away = ignore completely
- No "we/our/us". No corporate buzzwords like "positive engagement", "maintaining momentum", "reinforcing value", "capitalize on", "ensure satisfaction"
- Write in third person. Be direct and specific, but give enough detail to be useful.
- Format dates readably (e.g. "April 8, 2026" not "2026-04-08")`;
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
    const avgDeltaStr = stats.avgDelta > 0 ? '+' + stats.avgDelta : String(stats.avgDelta || 0);

    // Build a narrative summary of what matters most
    const highlights = [];
    if (stats.overnightDrops > 0) highlights.push(`${stats.overnightDrops} accounts dropped 5+ points overnight`);
    if (stats.silentDecliners > 0) highlights.push(`${stats.silentDecliners} previously healthy accounts are now declining ($${fmtDollar(stats.silentDeclinerMRR)} MRR)`);
    if (stats.renewalsAtRisk > 0) highlights.push(`${stats.renewalsAtRisk} at-risk renewal${stats.renewalsAtRisk > 1 ? 's' : ''} coming up ($${fmtDollar(stats.renewalAtRiskMRR)} MRR)`);
    if (stats.declining > stats.improving) highlights.push(`More accounts declining (${stats.declining}) than improving (${stats.improving})`);
    if (stats.improving > stats.declining) highlights.push(`${stats.improving} accounts improving vs ${stats.declining} declining - positive momentum`);

    return `You are a senior CS analyst writing a daily portfolio briefing. Write exactly 3 sentences.

Data:
- ${stats.total} accounts: ${stats.critical} Critical, ${stats.risk} Risk, ${stats.watch} Watch, ${stats.healthy} Healthy, ${stats.expand} Expand
- Avg score: ${stats.avgScore}, trending ${avgDeltaStr} pts over ${stats.periodDays || 7}d
- ${stats.declining} declining ($${fmtDollar(stats.decliningMRR)} MRR), ${stats.improving} improving
- $${fmtDollar(stats.atRiskMRR)} MRR at risk, $${fmtDollar(stats.totalMRR)} total
- ${stats.renewals30 || 0} renewals in 30d ($${fmtDollar(stats.renewalMRR)}), ${stats.renewalsAtRisk || 0} at risk
${highlights.length ? '- Key signals: ' + highlights.join('; ') : ''}
${stats.weakestSignal ? '- Weakest signal: ' + stats.weakestSignal : ''}
${stats.contactImpact ? '- Contact impact: ' + stats.contactImpact : ''}

Response: JSON only, no markdown
{"overview":"exactly 3 sentences"}

Sentence 1: The single most important thing happening in this portfolio right now. Lead with the biggest risk or most notable change. Be specific with numbers.
Sentence 2: The second most important signal or pattern. Connect it to revenue impact if possible.
Sentence 3: One positive signal or opportunity worth noting - what's going right.

Rules:
- Never use "we", "our", "us". Use "the portfolio", "your team", or name segments directly.
- Never use filler phrases: "it's crucial", "it's important", "proactive engagement", "maintaining momentum", "capitalize on"
- Every sentence must contain at least one number from the data
- Do NOT just list stats - explain what they MEAN for the business
- Write like a sharp analyst, not a corporate memo`;
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
        temperature: 0.5,
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

// Cloudflare Pages Function — /api/ai
// Proxies OpenAI API calls, keeps API key server-side
// Near-zero cold start vs Supabase edge functions

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
- Be specific — mention actual numbers, dates, and thresholds`;
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
- Include specific conversation starters the CSM can use verbatim`;
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

  if (promptType === 'save_playbook') {
    return `This customer is at risk. Create a 4-week save plan:
${buildCustomerSummary(data.customer)}

Response schema:
{"diagnosis":"2-3 sentence root cause analysis of why this account is at risk","weeks":[{"week":1,"theme":"week theme","actions":[{"task":"action item","detail":"how to do it","owner":"csm|support|exec"}]}],"success_criteria":"how to measure if the save plan is working after 4 weeks"}

Rules:
- Diagnosis should identify the 1-2 root causes, not just list symptoms
- 4 weeks, each with a clear theme and 2-3 actions
- Actions should escalate: week 1 = assess/connect, week 2 = address issues, week 3 = demonstrate value, week 4 = secure commitment
- Owner: "csm" for CSM tasks, "support" for technical/support tasks, "exec" for executive sponsor involvement
- Success criteria should be measurable (score target, engagement metric, etc.)`;
  }

  return null;
}

function getMaxTokens(promptType) {
  if (promptType === 'save_playbook') return 1500;
  if (promptType === 'daily_focus') return 1200;
  if (promptType === 'meeting_prep') return 1024;
  return 512;
}

export async function onRequestPost(context) {
  const { env, request } = context;

  // CORS
  const origin = request.headers.get('Origin') || '';
  const corsHeaders = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json',
  };

  try {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

    const body = await request.json();
    const { prompt_type } = body;

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

    return new Response(JSON.stringify({ success: true, data: parsed, prompt_type }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: corsHeaders,
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
    },
  });
}

// ─── HOME BASE ──────────────────────────────────────────────
// Strategic overview with AI-generated analytical insights.
// Different from Alerts (reactive threshold) and Dashboard (data display).
// Home Base = "Here's what the data is telling you" (narrative, pattern-based).

let _hbPeriodDays = 7; // comparison period: 7, 14, or 30
var _hbInsightActions = []; // stores insight card action functions for click delegation

// Global delegated click handler for homebase interactive elements
document.addEventListener('click', function(e) {
  if (!e.target || !e.target.closest) return;

  // Insight card action buttons
  var insBtn = e.target.closest('[data-insight-action]');
  if (insBtn) {
    e.stopPropagation();
    var idx = parseInt(insBtn.getAttribute('data-insight-action'));
    var action = _hbInsightActions[idx];
    if (action && typeof action === 'function') {
      try { action(); } catch(err) { console.warn('Insight action error:', err); }
    }
    return;
  }

  // Hardcoded/fallback action items
  var actCard = e.target.closest('[data-hb-action]');
  if (actCard) {
    var idx = parseInt(actCard.getAttribute('data-hb-action'));
    var item = window._hbActionItems && window._hbActionItems[idx];
    if (item && typeof item.actionFn === 'function') {
      try { item.actionFn(); } catch(e2) { console.warn('Action error:', e2); }
    } else if (item && item.ids && item.ids.length) {
      setInsightFilter(item.text.substring(0, 40), item.ids);
    }
    return;
  }

  // AI action items
  var aiCard = e.target.closest('[data-ai-action]');
  if (aiCard) {
    var idx = parseInt(aiCard.getAttribute('data-ai-action'));
    var f = _aiActionFilters[idx];
    if (f && f.ids && f.ids.length) setInsightFilter(f.label, f.ids);
    return;
  }

  // KPI card filters (Revenue at Risk, Upcoming Renewals)
  var kpiCard = e.target.closest('[data-kpi-filter]');
  if (kpiCard) {
    var key = kpiCard.getAttribute('data-kpi-filter');
    var kf = window._hbKpiFilters && window._hbKpiFilters[key];
    if (kf && kf.ids && kf.ids.length) setInsightFilter(kf.label, kf.ids);
    return;
  }
});

function setInsightFilter(label, ids) {
  if (!ids || !ids.length) return;
  insightFilter = { label: label, ids: new Set(ids) };
  mrrExposureFilter = null;
  _filterTier = null;
  _filterStage = null;
  _filterManager = null;
  filterMode = 'all';
  columnFilters = {};
  nav('customers');
  const _m = document.querySelector('main.main'); if (_m) _m.scrollTop = 0; else window.scrollTo(0, 0);
}
function clearInsightFilter() {
  insightFilter = null;
  renderCustomers();
}

// ── SVG Icon Library ──
const _hbSvg = {
  // Pulse KPI icons (18x18, white stroke for gradient cards)
  pulse: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  alertTri: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  dollar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  calendar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  // Insight category icons (16x16)
  trend: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  trendDown: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>',
  risk: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  renewal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  workload: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  opportunity: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>',
  engagement: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  // Empty states
  chartEmpty: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
};

// Category → icon key mapping
const _hbCatIcon = {
  'Trend': 'trend', 'Risk': 'risk', 'Renewal': 'renewal',
  'Workload': 'workload', 'Opportunity': 'opportunity', 'Engagement': 'engagement'
};

// Category → CSS class suffix
const _hbCatClass = {
  'Trend': 'trend', 'Risk': 'risk', 'Renewal': 'renewal',
  'Workload': 'workload', 'Opportunity': 'opportunity', 'Engagement': 'engagement'
};

function renderHomeBase() { try { _renderHomeBase(); } catch(e) { console.error('renderHomeBase error:', e); } }

async function _loadDemoFromCard() {
  if (!currentUser) { toast('Please sign in first', 'warn'); return; }
  const cid = getEffectiveClientId();
  if (!cid) { toast('No client found - contact support', 'error'); return; }
  if (!confirm('This will load 75 demo customers into your account. Any existing customers will be replaced. Continue?')) return;
  toast('Loading demo data…', 'default');
  try {
    const COUNT = 75;

    // 1. Delete existing customers for this client
    console.log('[demo] Deleting existing customers for client ' + cid);
    const { error: delErr } = await sb.from('customers').delete().eq('client_id', cid);
    if (delErr) throw new Error('Delete failed: ' + delErr.message);

    // 2. Generate demo customers in memory
    console.log('[demo] Generating ' + COUNT + ' demo customers…');
    initDemo(COUNT);

    // 3. Push to Supabase
    console.log('[demo] Pushing to Supabase…');
    const rows = customers.map(c => {
      const row = toRow(c);
      row.user_id = currentUser.id;
      row.client_id = cid;
      return row;
    });

    // Auto-strip missing columns
    let badCols = new Set();
    let testRow = { ...rows[0] };
    for (let attempt = 0; attempt < 8; attempt++) {
      const { error: testErr } = await sb.from('customers').upsert([testRow], { onConflict: 'id' });
      if (!testErr) break;
      const colMatch = testErr.message.match(/Could not find the '(\w+)' column/);
      if (colMatch) { badCols.add(colMatch[1]); delete testRow[colMatch[1]]; }
      else throw new Error('Insert error: ' + testErr.message);
    }
    if (badCols.size) rows.forEach(r => badCols.forEach(col => delete r[col]));

    // Bulk upsert in chunks
    for (let i = 0; i < rows.length; i += 25) {
      const chunk = rows.slice(i, i + 25);
      const { error } = await sb.from('customers').upsert(chunk, { onConflict: 'id' });
      if (error) throw new Error('Insert error at row ' + i + ': ' + error.message);
    }

    // 4. Reload from Supabase
    if (typeof activeClientId !== 'undefined' && activeClientId && activeClientId !== '__own__') {
      await loadClientCustomers(activeClientId);
    } else {
      await loadCustomersFromSupabase();
    }
    rescoreAll();
    if (typeof refreshMgrDropdown === 'function') refreshMgrDropdown();

    // 5. Seed demo alert rules, custom rules, and scoring profiles
    _seedDemoAutomations();
    _seedDemoProfiles();
    // Re-score after profiles are assigned so Non-SaaS customers use correct weights
    rescoreAll();

    // 6. Reset all guide banners so new users see them
    if (typeof resetAllGuides === 'function') resetAllGuides();

    // 7. Clear audit log for a fresh demo experience
    try {
      // Delete by user_id (matches RLS owner policy)
      const { error: delErr } = await sb.from('audit_logs').delete().eq('user_id', currentUser.id);
      if (delErr) console.warn('Audit log clear failed:', delErr.message);
    } catch(e) { console.warn('Audit log clear:', e.message); }
    auditLogs = [];
    auditOffset = 0;

    renderHomeBase();
    nav('homebase');
    toast('Demo data loaded - ' + COUNT + ' customers ready to explore!', 'success');
    if (typeof _wtInit === 'function') _wtInit();
  } catch(e) {
    console.error('Demo seed error:', e);
    toast('Failed to load demo data: ' + e.message, 'error');
  }
}

function _seedDemoAutomations() {
  // Seed sample alert rules and custom rules for demo experience
  // Always re-seed on demo load to ensure they're present
  if (!automationsCfg) automationsCfg = {};

  // Alert rules (pre-built alerts) - use correct ALERT_TYPES keys
  automationsCfg.alert_rules = [
    {
      id: 'demo-ar-1', name: 'Critical Score Drop', enabled: true,
      alert_types: ['health_below_threshold', 'rapid_score_drop'],
      settings: { health_below_threshold: { threshold: 40 }, rapid_score_drop: { points: 15 } },
      channels: { slack: false, teams: false, email: true },
      schedule: { mode: 'realtime' },
      manager_scope: { mode: 'all', managers: [] },
      created_at: new Date(Date.now() - 30 * 86400000).toISOString()
    },
    {
      id: 'demo-ar-2', name: 'Renewal Risk Watch', enabled: true,
      alert_types: ['renewal_approaching', 'account_at_risk'],
      settings: { renewal_approaching: { days: 60 } },
      channels: { slack: true, teams: false, email: false },
      schedule: { mode: 'daily', daily_time: '9:00 AM' },
      manager_scope: { mode: 'all', managers: [] },
      created_at: new Date(Date.now() - 14 * 86400000).toISOString()
    },
    {
      id: 'demo-ar-3', name: 'Silent Account Monitor', enabled: true,
      alert_types: ['no_contact', 'nps_detractor'],
      settings: { no_contact: { max_days: 21 } },
      channels: { slack: false, teams: true, email: false },
      schedule: { mode: 'weekly', weekly_day: 'monday', weekly_time: '9:00 AM' },
      manager_scope: { mode: 'selected', managers: ['Sarah Mitchell', 'David Kim'] },
      created_at: new Date(Date.now() - 7 * 86400000).toISOString()
    }
  ];

  // Custom rules (condition-based)
  automationsCfg.custom_rules = [
    {
      id: 'demo-cr-1', name: 'Enterprise accounts going silent',
      enabled: true,
      groups: [{ conditions: [
        { field: 'tier', op: 'eq', value: 'enterprise' },
        { field: 'days', op: 'gt', value: 21 }
      ]}],
      channels: { slack: false, teams: false, email: true },
      created_at: new Date(Date.now() - 20 * 86400000).toISOString()
    },
    {
      id: 'demo-cr-2', name: 'At-risk accounts needing attention',
      enabled: true,
      groups: [
        { conditions: [
          { field: 'adoption', op: 'lt', value: 25 },
          { field: 'renewal', op: 'lte', value: 3 }
        ]},
        { conditions: [
          { field: 'score', op: 'lt', value: 30 },
          { field: 'lifecycle', op: 'eq', value: 'atrisk' }
        ]}
      ],
      channels: { slack: true, teams: false, email: false },
      created_at: new Date(Date.now() - 10 * 86400000).toISOString()
    },
    {
      id: 'demo-cr-3', name: 'High-value accounts dropping fast',
      enabled: true,
      groups: [{ conditions: [
        { field: 'mrr', op: 'gte', value: 5000 },
        { field: 'score', op: 'lt', value: 40 }
      ]}],
      channels: { slack: false, teams: true, email: false },
      created_at: new Date(Date.now() - 5 * 86400000).toISOString()
    }
  ];

  if (typeof saveAutomationsCfg === 'function') {
    saveAutomationsCfg();
    // Also save to localStorage as backup in case Supabase upsert fails
    try { localStorage.setItem('iqc_automations', JSON.stringify(automationsCfg)); } catch(e) {}
    console.log('[demo] Seeded ' + automationsCfg.alert_rules.length + ' alert rules + ' + automationsCfg.custom_rules.length + ' custom rules');
  }
}

function _seedDemoProfiles() {
  // Add Non-SaaS scoring profile if it doesn't exist
  var nonSaasProfile = { name: 'Non-SaaS', weights: { logins: 0, adoption: 0, tickets: 30, nps: 25, csat: 15, days: 20, growth: 10 } };
  var exists = profiles.some(function(p) { return p.name === 'Non-SaaS'; });
  if (!exists) {
    profiles.push(nonSaasProfile);
  } else {
    // Update existing
    var p = profiles.find(function(p) { return p.name === 'Non-SaaS'; });
    if (p) p.weights = nonSaasProfile.weights;
  }

  // Assign ~15% of customers to Non-SaaS profile (consulting, services, non-tech accounts)
  var assigned = 0;
  customers.forEach(function(c, i) {
    // Pick every ~7th customer, prefer mid-market tier
    if (i % 7 === 3 || (c.tier === 'mid' && i % 5 === 2)) {
      c.scoring_profile = 'Non-SaaS';
      // Zero out logins and adoption since they're not tracked for Non-SaaS
      c.logins = null;
      c.adoption = null;
      assigned++;
    }
  });

  // Save profiles to settings
  if (typeof saveSettings === 'function') saveSettings();
  console.log('[demo] Added Non-SaaS scoring profile, assigned to ' + assigned + ' customers');
}

function _gsStepIcon(n) { return `<div style="width:22px;height:22px;border-radius:50%;background:var(--teal);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:var(--fs-xs);flex-shrink:0">${n}</div>`; }

function _gettingStartedHTML() {
  const si = _gsStepIcon;
  const card = (icon, bg, title, sub, steps, buttons) => `
    <div class="card" style="margin-bottom:8px;cursor:pointer" onclick="this.querySelector('.gs-detail').style.display=this.querySelector('.gs-detail').style.display==='none'?'block':'none'">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px">
        <div style="width:30px;height:30px;border-radius:8px;background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0">${icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:var(--fs-sm);color:var(--text)">${title}</div>
          <div style="font-size:var(--fs-xs);color:var(--muted);line-height:1.3">${sub}</div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="gs-detail" style="display:none;padding:0 14px 12px;border-top:1px solid var(--border);padding-top:10px">
        ${steps.map((s, i) => `<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px">${si(i+1)}<div style="font-size:var(--fs-sm);line-height:1.4"><strong>${s.title}</strong> - <span style="color:var(--muted)">${s.desc}</span></div></div>`).join('')}
        <div style="display:flex;gap:6px;margin-top:2px">${buttons}</div>
      </div>
    </div>`;

  const linkIco = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
  const pplIco = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
  const fileIco = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;

  return card(linkIco, 'linear-gradient(135deg,#14b8a6,#0d9488)',
    'I have a CRM or tool to connect',
    'Pull customers and data directly from HubSpot, Salesforce, Stripe, or other integrations',
    [
      { title:'Connect your integration', desc:'Go to <a href="#" onclick="event.stopPropagation();nav(\'settings\')" style="color:var(--teal);font-weight:600">Settings → Integrations</a> and connect your CRM or billing tool. Enable the <strong>Import new customers</strong> toggle so new accounts are pulled in automatically, then select which metrics to sync.' },
      { title:'Run your first sync', desc:'Once connected, hit Sync to pull your full customer list and their data into IQcadence. Customers will appear in the Customers tab automatically.' },
      { title:'Configure scoring weights', desc:'Head to <a href="#" onclick="event.stopPropagation();nav(\'settings\')" style="color:var(--teal);font-weight:600">Settings → Scoring</a> to adjust signal weights. Each customer will be scored automatically.' }
    ],
    '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();nav(\'settings\')">Go to Settings →</button>'
  ) + card(pplIco, 'linear-gradient(135deg,#6366f1,#4f46e5)',
    'I want to add a selected customer list first, then connect an integration',
    'Only the accounts you add in IQc will be tracked - the integration won\'t pull in everything, just enrich your selected customers',
    [
      { title:'Add your selected customers', desc:'Go to <a href="#" onclick="event.stopPropagation();nav(\'customers\')" style="color:var(--teal);font-weight:600">Customers</a> and add them one at a time, or use <a href="#" onclick="event.stopPropagation();nav(\'csv\')" style="color:var(--teal);font-weight:600">CSV Import</a> to bulk upload just the accounts you want to track.' },
      { title:'Connect your integration', desc:'Go to <a href="#" onclick="event.stopPropagation();nav(\'settings\')" style="color:var(--teal);font-weight:600">Settings → Integrations</a> and connect your tool. Make sure "Import new accounts" is turned off - the integration will only update the customers you already added, not create new ones from your CRM.' },
      { title:'Sync to enrich data', desc:'Run a sync to pull in metrics like MRR, tickets, NPS, and more for your existing customers. Their scores will update automatically.' }
    ],
    '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();nav(\'csv\')">Import Customers →</button>'
  ) + card(fileIco, 'linear-gradient(135deg,#f59e0b,#d97706)',
    "I want to upload customers but don't have an integration to connect",
    'Add customers and data manually using CSV import or the scoring form',
    [
      { title:'Prepare your spreadsheet', desc:'Create a CSV with your customer data. At minimum include a <strong>Name</strong> column. You can also add columns for MRR, ARR, NPS, CSAT, Logins, Tickets, and more.' },
      { title:'Import via CSV', desc:'Go to <a href="#" onclick="event.stopPropagation();nav(\'csv\')" style="color:var(--teal);font-weight:600">CSV Import</a>, upload your file, map the columns, and import. All customers will be scored automatically.' },
      { title:'Adjust weights and review', desc:'Fine-tune your <a href="#" onclick="event.stopPropagation();nav(\'settings\')" style="color:var(--teal);font-weight:600">scoring weights</a> to match what matters for your business. Check your dashboard to see health scores and insights.' }
    ],
    '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();nav(\'csv\')">Import CSV →</button><button class="btn btn-outline btn-sm" onclick="event.stopPropagation();nav(\'score\')">+ Score Manually</button>'
  ) + card(
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    'linear-gradient(135deg,#8b5cf6,#7c3aed)',
    'No data yet? Try a demo',
    'Load 75 realistic demo customers with 2+ years of history so you can explore every feature',
    [
      { title:'One-click demo data', desc:'Click <strong>Load Demo Data</strong> below to generate 75 sample customers with realistic health scores, MRR, signals, score history, and trends.' },
      { title:'Explore the platform', desc:'Browse <a href="#" onclick="event.stopPropagation();nav(\'alerts\')" style="color:var(--teal);font-weight:600">Alerts</a>, <a href="#" onclick="event.stopPropagation();nav(\'trends\')" style="color:var(--teal);font-weight:600">Trends</a>, <a href="#" onclick="event.stopPropagation();nav(\'segments\')" style="color:var(--teal);font-weight:600">Segments</a>, and <a href="#" onclick="event.stopPropagation();nav(\'csmperf\')" style="color:var(--teal);font-weight:600">CSM Performance</a> to see what IQcadence looks like with a full portfolio.' },
      { title:'Replace with your own data anytime', desc:'When you\'re ready, delete the demo accounts and import your real customers via CSV or integration. Your settings and configuration will be preserved.' }
    ],
    '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();_loadDemoFromCard()">Load Demo Data →</button>'
  );
}

function _renderGettingStarted(wrap) {
  wrap.innerHTML = `
  <div style="max-width:600px;margin:0 auto;padding:20px 0">
    <div style="text-align:center;margin-bottom:24px">
      <h1 style="font-size:1.25rem;font-weight:800;color:var(--text);margin-bottom:4px">Welcome to iQcadence</h1>
      <p style="color:var(--muted);font-size:var(--fs-sm)">Get started by adding your customers. Choose the path that fits your setup.</p>
    </div>
    <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);border-radius:12px;padding:24px;text-align:center;margin-bottom:20px;color:#fff;box-shadow:0 4px 16px rgba(124,58,237,.25)">
      <div style="width:48px;height:48px;background:rgba(255,255,255,.15);border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      </div>
      <h2 style="font-size:18px;font-weight:700;margin:0 0 6px">Try it now with demo data</h2>
      <p style="font-size:14px;opacity:.85;margin:0 0 16px;line-height:1.5">Load 75 customers with 2+ years of history, health scores, insights, and trends. Explore every feature instantly.</p>
      <button class="btn" onclick="event.stopPropagation();_loadDemoFromCard()" style="background:#fff;color:#7c3aed;font-weight:700;padding:10px 28px;border-radius:8px;font-size:14px;border:none;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.1)">Load Demo Data →</button>
    </div>
    <div style="text-align:center;margin-bottom:16px;font-size:var(--fs-sm);color:var(--muted)">— or add your own customers —</div>
    ${_gettingStartedHTML()}
  </div>`;
}

function _gsCardHTML() {
  const dismissed = false;
  try { if (localStorage.getItem('iqc_gs_dismissed') === '1') return ''; } catch(e) { console.warn('ls:', e.message); }
  return `<div class="card" id="gs-banner" style="margin-bottom:10px;border-left:3px solid var(--teal)">
    <div style="padding:10px 14px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:8px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span style="font-weight:700;font-size:var(--fs-sm);color:var(--text)">Getting Started</span>
          <button onclick="var b=document.getElementById('gs-banner-body');var open=b.style.display!=='none';b.style.display=open?'none':'block';this.textContent=open?'Show ↓':'Hide ↑'" class="btn btn-outline btn-xs" style="font-size:var(--fs-xs);padding:2px 8px;margin-left:4px">Show ↓</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="display:flex;align-items:center;gap:4px;font-size:var(--fs-xs);color:var(--muted);cursor:pointer;user-select:none">
            <input type="checkbox" onchange="dismissGettingStarted(this.checked)"> Don't show again
          </label>
          <button onclick="document.getElementById('gs-banner').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;line-height:1;padding:0" title="Close">×</button>
        </div>
      </div>
      <div id="gs-banner-body" style="display:none;margin-top:10px">${_gettingStartedHTML()}</div>
    </div>
  </div>`;
}

function dismissGettingStarted(checked) {
  try { if (checked) localStorage.setItem('iqc_gs_dismissed', '1'); else localStorage.removeItem('iqc_gs_dismissed'); } catch(e) { console.warn('ls:', e.message); }
  if (checked) { const b = document.getElementById('gs-banner'); if (b) b.remove(); }
}

function showGettingStarted() {
  try { localStorage.removeItem('iqc_gs_dismissed'); } catch(e) { console.warn('ls:', e.message); }
  renderHomeBase();
  nav('homebase');
}

function _renderHomeBase() {
  const wrap = el('homebase-wrap');
  if (!wrap) return;

  // Show getting started guide if no customers (or all churned)
  const _anyActive = customers.some(c => c.lifecycle !== 'churned');
  if (!customers.length || !_anyActive) { _renderGettingStarted(wrap); return; }

  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const now = new Date();

  // ── Compute pulse KPIs ──
  const total     = active.length;
  const avgScore  = total ? Math.round(active.reduce((s,c) => s + c.score, 0) / total) : 0;
  const critical  = active.filter(c => c.status === 'critical');
  const risk      = active.filter(c => c.status === 'risk');
  const atRisk    = [...critical, ...risk];
  const atRiskMRR = atRisk.reduce((s,c) => s + (c.mrr || 0), 0);

  // Renewals in next 30 days
  const renewals30 = active.filter(c => {
    if (c.renewal_date) {
      const rd = new Date(c.renewal_date);
      const diff = (rd - now) / 86400000;
      return diff >= 0 && diff <= 30;
    }
    return c.renewal != null && c.renewal >= 0 && c.renewal <= 1;
  });
  const renewalsAtRisk = renewals30.filter(c => c.status === 'critical' || c.status === 'risk');

  // ── Historical comparison (period-based) ──
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - _hbPeriodDays);

  function getScoreAtCutoff(c) {
    const hist = (c.history || []).filter(h => h.date).sort((a,b) => new Date(a.date) - new Date(b.date));
    if (!hist.length) return null;
    let best = null;
    for (const h of hist) {
      if (new Date(h.date) <= cutoff) best = h;
    }
    return best ? best.score : hist[0].score;
  }

  function getDeltaPeriod(c) {
    const prev = getScoreAtCutoff(c);
    if (prev === null) return 0;
    return c.score - prev;
  }

  const withHist = active.filter(c => (c.history || []).length >= 1);
  const prevAvg = withHist.length
    ? Math.round(withHist.reduce((s,c) => s + (getScoreAtCutoff(c) || c.score), 0) / withHist.length)
    : avgScore;
  const avgDelta = avgScore - prevAvg;

  const prevAtRiskCount = withHist.filter(c => {
    const prev = getScoreAtCutoff(c);
    if (prev === null) return false;
    return prev < (thresholds?.risk || 50);
  }).length;
  const atRiskDelta = atRisk.length - prevAtRiskCount;

  const prevAtRiskMRR = withHist.filter(c => {
    const prev = getScoreAtCutoff(c);
    return prev !== null && prev < (thresholds?.risk || 50);
  }).reduce((s,c) => s + (c.mrr || 0), 0);
  const mrrDelta = atRiskMRR - prevAtRiskMRR;

  // ── Delta formatters for gradient cards (white text) ──
  const deltaArrow = (val, invert) => {
    if (val === 0) return '<span style="opacity:.5"> -</span>';
    const good = invert ? val < 0 : val > 0;
    const arrow = val > 0 ? '▲' : '▼';
    return `<span class="${good ? 'up' : 'down'}">${arrow} ${Math.abs(val)}</span>`;
  };
  const deltaArrowMRR = (val) => {
    if (val === 0) return '<span style="opacity:.5"> -</span>';
    const good = val < 0;
    const arrow = val > 0 ? '▲' : '▼';
    return `<span class="${good ? 'up' : 'down'}">${arrow} $${fmtNum(Math.abs(val))}</span>`;
  };

  // ── Generate insights ──
  const insights = _generateInsights(active, now, cutoff);

  // ── Extra KPI values ──
  const watch   = active.filter(c => c.status === 'watch');
  const healthy = active.filter(c => c.status === 'healthy');
  const expand  = active.filter(c => c.status === 'expand');
  const totalMRR = active.reduce((s,c) => s + (c.mrr || 0), 0);
  const renewMRR = renewals30.reduce((s,c) => s + (c.mrr || 0), 0);
  const expMRR   = expand.reduce((s,c) => s + (c.mrr || 0), 0);

  // ── Render ──
  let html = '';

  // Welcome banner
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const userName = currentUser?.email ? currentUser.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const healthyCount = active.filter(c => c.status === 'healthy' || c.status === 'expand').length;
  const healthyPct = total ? Math.round(healthyCount / total * 100) : 0;
  const improving = withHist.filter(c => getDeltaPeriod(c) > 2).length;
  const declining = withHist.filter(c => getDeltaPeriod(c) < -2).length;
  const mgrLabel = mgrFilterAll ? '' : (activeManagers.size === 1 ? ` for ${[...activeManagers][0]}` : ` across ${activeManagers.size} managers`);

  // ── Deep-signal analysis for briefing ──
  // Silent decliners: were healthy/expand, now dropping fast
  const silentDecliners = withHist.filter(c => {
    const prev = getScoreAtCutoff(c);
    return prev !== null && prev >= (thresholds?.healthy || 65) && getDeltaPeriod(c) < -5;
  });
  // Contact gaps: no contact in 30+ days
  const contactGap = active.filter(c => (c.days || 0) >= 30);
  const contactGapHighVal = contactGap.filter(c => (c.mrr || 0) >= 5000);
  // Biggest single at-risk account
  const biggestRisk = atRisk.length ? atRisk.reduce((a, b) => (b.mrr || 0) > (a.mrr || 0) ? b : a) : null;

  // ── Day-over-day / short-term trend analysis for briefing ──
  // Uses same approach as _insightDayOverDay: compare last two history entries per account
  const _dodBriefing = (() => {
    const dodPairs = [];
    active.forEach(c => {
      const hist = (c.history || []).filter(h => h.date)
        .sort((a,b) => new Date(b.date) - new Date(a.date)); // newest first
      if (hist.length < 2) return;
      const latest = hist[0];
      const prev   = hist[1];
      // Normalize to calendar days (timezone-safe: both shifted same way)
      const d1 = new Date(latest.date); d1.setHours(0,0,0,0);
      const d2 = new Date(prev.date);   d2.setHours(0,0,0,0);
      const dayGap = Math.round((d1 - d2) / 86400000);
      if (dayGap < 1 || dayGap > 3) return;
      const delta = latest.score - prev.score;
      dodPairs.push({ c, delta, from: prev.score, to: latest.score, prevSignals: prev.signals, currSignals: latest.signals, dayGap });
    });

    if (!dodPairs.length) return null;

    const avgDelta = Math.round(dodPairs.reduce((s,p) => s + p.delta, 0) / dodPairs.length * 10) / 10;
    const droppers = dodPairs.filter(p => p.delta <= -5).sort((a,b) => a.delta - b.delta);

    // Aggregate signal changes across droppers to explain WHY
    const signalChanges = { logins: 0, adoption: 0, tickets: 0, nps: 0, csat: 0, days: 0 };
    const signalCounts  = { logins: 0, adoption: 0, tickets: 0, nps: 0, csat: 0, days: 0 };
    droppers.slice(0, 10).forEach(p => {
      const curr = p.currSignals || {}, prev = p.prevSignals || {};
      if (curr.logins != null && prev.logins != null)     { signalChanges.logins   += curr.logins - prev.logins;     signalCounts.logins++; }
      if (curr.adoption != null && prev.adoption != null) { signalChanges.adoption += curr.adoption - prev.adoption; signalCounts.adoption++; }
      if (curr.tickets != null && prev.tickets != null)   { signalChanges.tickets  += curr.tickets - prev.tickets;   signalCounts.tickets++; }
      if (curr.nps != null && prev.nps != null)           { signalChanges.nps      += curr.nps - prev.nps;           signalCounts.nps++; }
      if (curr.csat != null && prev.csat != null)         { signalChanges.csat     += curr.csat - prev.csat;         signalCounts.csat++; }
      if (curr.days != null && prev.days != null)         { signalChanges.days     += curr.days - prev.days;         signalCounts.days++; }
    });
    const reasons = [];
    if (signalCounts.logins && signalChanges.logins / signalCounts.logins < -2)    reasons.push(`logins dropped avg ${Math.abs(Math.round(signalChanges.logins / signalCounts.logins * 10) / 10)}/mo`);
    if (signalCounts.adoption && signalChanges.adoption / signalCounts.adoption < -3) reasons.push(`adoption fell avg ${Math.abs(Math.round(signalChanges.adoption / signalCounts.adoption))}%`);
    if (signalCounts.tickets && signalChanges.tickets / signalCounts.tickets > 0.5)  reasons.push(`tickets rose avg +${(signalChanges.tickets / signalCounts.tickets).toFixed(1)}`);
    if (signalCounts.nps && signalChanges.nps / signalCounts.nps < -0.5)            reasons.push(`NPS declined avg ${(signalChanges.nps / signalCounts.nps).toFixed(1)}`);
    if (signalCounts.csat && signalChanges.csat / signalCounts.csat < -0.2)         reasons.push(`CSAT dropped avg ${Math.abs((signalChanges.csat / signalCounts.csat).toFixed(1))}`);
    if (signalCounts.days && signalChanges.days / signalCounts.days > 3)            reasons.push(`contact gaps widened avg +${Math.round(signalChanges.days / signalCounts.days)}d`);

    return { avgDelta, droppers: droppers.length, topDroppers: droppers.slice(0, 3), reasons, total: dodPairs.length };
  })();

  // ── Portfolio overview blurb + deduplicated action items ──
  const _ids = arr => JSON.stringify(arr.map(c => c.id));

  // Build portfolio overview - insight-driven briefing (not widget restatement)
  const _overviewCandidates = [];

  // 1. Weakest signal across at-risk accounts
  if (atRisk.length >= 2) {
    const sigWeak = { logins: 0, adoption: 0, tickets: 0, nps: 0, csat: 0, days: 0 };
    const sigLbl  = { logins:'login activity', adoption:'adoption', tickets:'ticket volume', nps:'NPS', csat:'CSAT', days:'contact recency' };
    atRisk.forEach(c => {
      if (c.logins != null && c.logins < 5)     sigWeak.logins++;
      if (c.adoption != null && c.adoption < 30) sigWeak.adoption++;
      if (c.tickets != null && c.tickets >= 5)   sigWeak.tickets++;
      if (npsIsDetractor(c.nps))                 sigWeak.nps++;
      if (c.csat != null && c.csat < 3)          sigWeak.csat++;
      if (c.days != null && c.days >= 30)        sigWeak.days++;
    });
    const sorted = Object.entries(sigWeak).filter(([,v]) => v >= 2).sort((a,b) => b[1] - a[1]);
    if (sorted.length > 0) {
      const [topSig, topCnt] = sorted[0];
      const pct = Math.round(topCnt / atRisk.length * 100);
      if (pct >= 40) {
        const desc = topSig === 'tickets' ? 'elevated tickets' : topSig === 'days' ? 'no recent contact' : 'low ' + sigLbl[topSig];
        _overviewCandidates.push({ score: pct + topCnt * 2, text: `${sigLbl[topSig].charAt(0).toUpperCase() + sigLbl[topSig].slice(1)} is the weakest signal across your at-risk accounts \u2014 ${pct}% have ${desc}.` });
      }
    }
  }

  // 2. Tier divergence
  {
    const tierMap = {};
    active.forEach(c => {
      const t = c.tier || 'Unknown';
      if (!tierMap[t]) tierMap[t] = { scores: [], risk: 0, n: 0 };
      tierMap[t].scores.push(c.score); tierMap[t].n++;
      if (c.status === 'critical' || c.status === 'risk') tierMap[t].risk++;
    });
    const tiers = Object.entries(tierMap).filter(([,v]) => v.n >= 3);
    if (tiers.length >= 2) {
      tiers.forEach(([,v]) => { v.avg = Math.round(v.scores.reduce((s,x) => s + x, 0) / v.scores.length); });
      tiers.sort((a,b) => b[1].avg - a[1].avg);
      const best = tiers[0], worst = tiers[tiers.length - 1];
      const gap = best[1].avg - worst[1].avg;
      if (gap >= 10) {
        _overviewCandidates.push({ score: gap + 10, text: `Your ${best[0]} tier is outperforming ${worst[0]} by ${gap} pts on average. ${worst[1].risk} of ${worst[1].n} ${worst[0]} accounts are at risk.` });
      }
    }
  }

  // 3. Common pattern among declining accounts
  if (declining >= 3) {
    const declAccts = withHist.filter(c => getDeltaPeriod(c) < -2);
    if (declAccts.length >= 3) {
      const pat = { lowLogins: 0, lowAdopt: 0, highTix: 0, npsDetr: 0, noContact: 0 };
      declAccts.forEach(c => {
        if (c.logins != null && c.logins < 5)     pat.lowLogins++;
        if (c.adoption != null && c.adoption < 30) pat.lowAdopt++;
        if (c.tickets != null && c.tickets >= 5)   pat.highTix++;
        if (npsIsDetractor(c.nps))                 pat.npsDetr++;
        if (c.days != null && c.days >= 30)        pat.noContact++;
      });
      const patLbl = { lowLogins:'low logins', lowAdopt:'low adoption', highTix:'rising tickets', npsDetr:'NPS detractors', noContact:'no recent contact' };
      const common = Object.entries(pat).filter(([,v]) => v >= Math.ceil(declAccts.length * 0.5)).sort((a,b) => b[1] - a[1]).slice(0,2);
      if (common.length >= 2) {
        const matchCnt = Math.min(...common.map(([,v]) => v));
        _overviewCandidates.push({ score: matchCnt * 15 + common.length * 10, text: `${matchCnt} of your ${declAccts.length} declining accounts share a common pattern: ${common.map(([k]) => patLbl[k]).join(' + ')}.` });
      }
    }
  }

  // 4. Contact impact - are contacted accounts trending differently?
  {
    const withDays = active.filter(c => c.days != null && (c.history || []).length >= 1);
    const contacted   = withDays.filter(c => c.days <= 14);
    const uncontacted = withDays.filter(c => c.days > 14);
    if (contacted.length >= 3 && uncontacted.length >= 3) {
      const cDelta  = Math.round(contacted.reduce((s,c) => s + getDeltaPeriod(c), 0) / contacted.length * 10) / 10;
      const uDelta  = Math.round(uncontacted.reduce((s,c) => s + getDeltaPeriod(c), 0) / uncontacted.length * 10) / 10;
      const gap = cDelta - uDelta;
      if (Math.abs(gap) >= 3) {
        if (gap > 0) {
          _overviewCandidates.push({ score: Math.abs(gap) * 5 + 15, text: `Recent outreach is making a difference \u2014 contacted accounts are trending ${cDelta > 0 ? '+' : ''}${cDelta} pts vs ${uDelta > 0 ? '+' : ''}${uDelta} for uncontacted.` });
        } else {
          _overviewCandidates.push({ score: Math.abs(gap) * 5 + 10, text: `Uncontacted accounts are actually outperforming contacted ones by ${Math.abs(gap)} pts \u2014 outreach may be focused on the wrong accounts.` });
        }
      }
    }
  }

  // 5. Silent decliners alert
  if (silentDecliners.length >= 2) {
    const sdMRR = silentDecliners.reduce((s,c) => s + (c.mrr || 0), 0);
    _overviewCandidates.push({ score: silentDecliners.length * 12 + (sdMRR >= 10000 ? 20 : 0), text: `${silentDecliners.length} previously healthy accounts are now declining, with $${fmtNum(sdMRR)} MRR at stake. These were off the radar until now.` });
  }

  // 6. Renewal cohort health vs portfolio average
  if (renewals30.length >= 2) {
    const renewAvg = Math.round(renewals30.reduce((s,c) => s + c.score, 0) / renewals30.length);
    const gap = Math.round(avgScore) - renewAvg;
    if (gap >= 8) {
      const renewMRR = renewals30.reduce((s,c) => s + (c.mrr || 0), 0);
      _overviewCandidates.push({ score: gap * 3 + renewalsAtRisk.length * 10, text: `Accounts renewing in the next 30 days are scoring ${gap} pts below your portfolio average. $${fmtNum(renewMRR)} MRR needs attention before those renewals hit.` });
    } else if (gap <= -5) {
      _overviewCandidates.push({ score: Math.abs(gap) * 2, text: `Good news: your upcoming renewals are healthier than your portfolio average by ${Math.abs(gap)} pts.` });
    }
  }

  // 7. Overnight anomaly
  if (_dodBriefing && _dodBriefing.droppers >= 2) {
    const d = _dodBriefing;
    const reasonStr = d.reasons.length ? `, driven by ${d.reasons.slice(0,2).join(' and ')}` : '';
    _overviewCandidates.push({ score: d.droppers * 10 + Math.abs(d.avgDelta) * 5, text: `${d.droppers} accounts dropped 5+ pts overnight${reasonStr}. This is unusual and worth investigating.` });
  }

  // Select top 2-3 insights, fallback if none are interesting
  _overviewCandidates.sort((a,b) => b.score - a.score);
  const _topInsights = _overviewCandidates.slice(0, 3);
  let _portfolioBlurb;
  if (_topInsights.length === 0) {
    if (healthyPct >= 80) _portfolioBlurb = 'Your portfolio is stable with no standout patterns this period. A good time to focus on expansion opportunities and proactive check-ins.';
    else if (atRisk.length > 0) _portfolioBlurb = `No strong patterns detected this period. Keep an eye on your ${atRisk.length} at-risk account${atRisk.length !== 1 ? 's' : ''} and prioritize by MRR exposure.`;
    else _portfolioBlurb = 'Portfolio looks steady. Focus on maintaining momentum and deepening engagement with your key accounts.';
  } else {
    _portfolioBlurb = _topInsights.map(i => i.text).join(' ');
  }

  // Build urgency-scored, verb-first action items (max 4)
  const _actionPool = [];
  const _mentioned = new Set();

  // 1. Overnight drops → Investigate
  if (_dodBriefing && _dodBriefing.avgDelta <= -2) {
    const d = _dodBriefing;
    const reasonHint = d.reasons.length ? ` \u2014 ${d.reasons.slice(0,2).join(' and ')}` : '';
    _actionPool.push({ urgency: 90 + Math.abs(d.avgDelta) * 2, tone: 'red', text: `Investigate the overnight score drop across ${d.total} accounts${reasonHint}.`, actionFn: function() { setTrendRange('3d'); nav('trends'); }, ids: [] });
  }

  // 2. Renewal + no contact → Schedule EBR
  if (contactGapHighVal.length > 0) {
    const gapRenewal = contactGapHighVal.filter(c => c.renewal != null && c.renewal <= 3);
    if (gapRenewal.length > 0) {
      const gapMRR = gapRenewal.reduce((s,c) => s + (c.mrr||0), 0);
      if (gapRenewal.length === 1) {
        const c = gapRenewal[0];
        const rd = c.renewal_date ? Math.max(1, Math.round((new Date(c.renewal_date) - now) / 86400000)) : Math.round((c.renewal || 1) * 30);
        _actionPool.push({ urgency: 85 + (c.mrr||0) / 1000, tone: 'amber', text: `Schedule an EBR with ${c.name} ($${fmtNum(c.mrr||0)}/mo) \u2014 renewal in ${rd} days with no contact in 30+.`, actionFn: function() { openDetail(c.id); }, ids: [c.id] });
      } else {
        const gapIds = gapRenewal.map(c => c.id);
        _actionPool.push({ urgency: 85 + gapMRR / 1000, tone: 'amber', text: `Schedule EBRs for ${gapRenewal.length} accounts ($${fmtNum(gapMRR)} MRR) renewing soon with no contact in 30+ days.`, actionFn: function() { setInsightFilter('Renewal + no contact', gapIds); }, ids: gapIds });
      }
    }
  }

  // 3. High-value no contact (no upcoming renewal) → Reach out
  {
    const unreached = contactGapHighVal.filter(c => !(c.renewal != null && c.renewal <= 3));
    if (unreached.length > 0) {
      const gapMRR = unreached.reduce((s,c) => s + (c.mrr||0), 0);
      if (unreached.length === 1) {
        _actionPool.push({ urgency: 60 + (unreached[0].mrr||0) / 1000, tone: 'amber', text: `Reach out to ${unreached[0].name} ($${fmtNum(unreached[0].mrr||0)}/mo) \u2014 no contact in ${unreached[0].days || '30+'} days.`, actionFn: function() { openDetail(unreached[0].id); }, ids: [unreached[0].id] });
      } else {
        const unrIds = unreached.map(c => c.id);
        _actionPool.push({ urgency: 60 + gapMRR / 2000, tone: 'amber', text: `Reach out to ${unreached.length} high-value accounts ($${fmtNum(gapMRR)} MRR) with no contact in 30+ days.`, actionFn: function() { setInsightFilter('No contact 30d+', unrIds); }, ids: unrIds });
      }
    }
  }

  // 4. Biggest at-risk account → Call today
  if (biggestRisk && biggestRisk.mrr >= 5000) {
    const brDelta = getDelta7d(biggestRisk);
    const isDetr  = npsIsDetractor(biggestRisk.nps);
    const renewSn = biggestRisk.renewal != null && biggestRisk.renewal <= 2;
    let ctx, boost = 5;
    if (isDetr && renewSn) {
      const rd = biggestRisk.renewal_date ? Math.max(1, Math.round((new Date(biggestRisk.renewal_date) - now) / 86400000)) : Math.round((biggestRisk.renewal || 1) * 30);
      ctx = `NPS detractor with renewal in ${rd} days`; boost = 30;
    } else if (brDelta < -5) {
      ctx = `down ${Math.abs(brDelta)} pts this week`; boost = 15;
    } else if (biggestRisk.days != null && biggestRisk.days >= 14) {
      ctx = `no contact in ${biggestRisk.days} days`; boost = 10;
    } else {
      ctx = `at-risk with $${fmtNum(biggestRisk.mrr)}/mo`;
    }
    _actionPool.push({ urgency: 70 + (biggestRisk.mrr||0) / 1000 + boost, tone: 'red', text: `Call ${biggestRisk.name} today \u2014 ${ctx} and $${fmtNum(biggestRisk.mrr)}/mo at stake.`, actionFn: function() { openDetail(biggestRisk.id); }, ids: [biggestRisk.id] });
  }

  // 5. Silent decliners → Review
  {
    const sd = silentDecliners;
    if (sd.length >= 2) {
      const sdMRR = sd.reduce((s,c) => s + (c.mrr||0), 0);
      const sdIds = sd.map(c => c.id);
      _actionPool.push({ urgency: 65 + sdMRR / 1000 + sd.length * 3, tone: 'red', text: `Review ${sd.length} accounts that were healthy but started declining \u2014 $${fmtNum(sdMRR)} MRR at risk before they escalate.`, actionFn: function() { setInsightFilter('Declining from healthy', sdIds); }, ids: sdIds });
    } else if (sd.length === 1) {
      _actionPool.push({ urgency: 55 + (sd[0].mrr||0) / 1000, tone: 'amber', text: `Check in with ${sd[0].name} \u2014 was healthy but now declining. Early intervention prevents escalation.`, actionFn: function() { openDetail(sd[0].id); }, ids: [sd[0].id] });
    }
  }

  // 6. Tier-specific decline → Investigate
  {
    const tierDec = {};
    active.forEach(c => {
      const t = c.tier || 'Unknown';
      if (!tierDec[t]) tierDec[t] = { dec: 0, n: 0 };
      tierDec[t].n++;
      if (withHist.includes(c) && getDeltaPeriod(c) < -2) tierDec[t].dec++;
    });
    const worstTier = Object.entries(tierDec).filter(([,v]) => v.n >= 3 && v.dec >= 2).sort((a,b) => (b[1].dec / b[1].n) - (a[1].dec / a[1].n))[0];
    if (worstTier) {
      const [tName, tVal] = worstTier;
      const pct = Math.round(tVal.dec / tVal.n * 100);
      if (pct >= 40) {
        const tierDecAccts = active.filter(c => (c.tier || 'Unknown') === tName && withHist.includes(c) && getDeltaPeriod(c) < -2);
        const tdIds = tierDecAccts.map(c => c.id);
        _actionPool.push({ urgency: 50 + tVal.dec * 5, tone: 'red', text: `Investigate the decline across your ${tName} accounts \u2014 ${tVal.dec} of ${tVal.n} dropped this period.`, actionFn: function() { setInsightFilter('Declining ' + tName, tdIds); }, ids: tdIds });
      }
    }
  }

  // 7. Expansion opportunity → Ask for referral / upsell
  if (expand.length >= 1) {
    const topExp = expand.filter(c => c.score >= 80 && (c.mrr||0) >= 3000).sort((a,b) => (b.mrr||0) - (a.mrr||0));
    if (topExp.length >= 1) {
      const t = topExp[0];
      _actionPool.push({ urgency: 30 + (t.mrr||0) / 1000, tone: 'green', text: `Explore expansion with ${t.name} \u2014 score of ${t.score} with $${fmtNum(t.mrr)}/mo and strong engagement.`, actionFn: function() { openDetail(t.id); }, ids: [t.id] });
    }
  }

  // Sort by urgency, deduplicate, take top 4
  _actionPool.sort((a,b) => b.urgency - a.urgency);
  const _actionItems = [];
  for (const item of _actionPool) {
    if (_actionItems.length >= 3) break;
    if (item.ids.length > 0 && item.ids.every(id => _mentioned.has(id))) continue;
    item.ids.forEach(id => _mentioned.add(id));
    _actionItems.push({ text: item.text, action: item.action, tone: item.tone || 'amber' });
  }

  // Portfolio health score (avg across all accounts)
  const _portfolioScore = total ? Math.round(active.reduce((s,c) => s + (c.score || 0), 0) / total) : 0;
  const _portfolioStatus = getStatus(_portfolioScore);
  const _portfolioColor = STATUS_COLOR[_portfolioStatus] || '#16a34a';
  const _ringCirc = 2 * Math.PI * 40;
  const _ringOffset = _ringCirc - (_portfolioScore / 100) * _ringCirc;

  const _welcomeVars = 'background:#fff';
  html += `<div class="hb-welcome" style="${_welcomeVars}">`;
  html += '<div class="hb-welcome-grid">';

  // Left column: portfolio health ring + quick stats
  html += '<div class="hb-welcome-left">';
  html += `<div class="hb-greeting">${greeting}${userName ? ', ' + escHtml(userName) : ''}</div>`;
  html += `<div class="hb-date">${dateStr}</div>`;
  html += '<div style="display:flex;align-items:center;gap:32px;margin-top:16px">';
  html += `<div class="hb-pulse-ring">
    <svg viewBox="0 0 100 100" width="110" height="110">
      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--border)" stroke-width="7" opacity=".3"/>
      <circle cx="50" cy="50" r="40" fill="none" stroke="${_portfolioColor}" stroke-width="7"
        stroke-dasharray="${_ringCirc}" stroke-dashoffset="${_ringOffset}"
        stroke-linecap="round" style="transform:rotate(-90deg);transform-origin:50% 50%;transition:stroke-dashoffset .8s cubic-bezier(.4,0,.2,1)"/>
    </svg>
    <div class="hb-pulse-center">
      <div class="hb-pulse-num">${_portfolioScore}</div>
      <div class="hb-pulse-lbl">Portfolio</div>
      <div class="hb-pulse-delta" style="color:${avgDelta > 0 ? 'var(--green)' : avgDelta < 0 ? 'var(--red)' : 'var(--muted)'}">${avgDelta > 0 ? '\u25B2 ' + Math.abs(avgDelta) : avgDelta < 0 ? '\u25BC ' + Math.abs(avgDelta) : ' - Flat'}</div>
    </div>
  </div>`;
  html += '<div class="hb-quick-stats">';
  html += `<div class="hb-qs"><span class="hb-qs-num" style="color:var(--green)">${healthyPct}%</span><span class="hb-qs-lbl">Healthy</span></div>`;
  html += `<div class="hb-qs"><span class="hb-qs-num" style="color:var(--red)">${atRisk.length}</span><span class="hb-qs-lbl">At Risk</span></div>`;
  html += `<div class="hb-qs"><span class="hb-qs-num" style="color:var(--green)">${improving}</span><span class="hb-qs-lbl">\u2191 Up</span></div>`;
  html += `<div class="hb-qs"><span class="hb-qs-num" style="color:var(--red)">${declining}</span><span class="hb-qs-lbl">\u2193 Down</span></div>`;
  html += '</div>';
  html += '</div>'; // close flex row
  html += '</div>';

  // Right column: AI portfolio overview + action items
  html += '<div class="hb-welcome-right">';
  html += `<div style="display:flex;align-items:center;gap:6px;font-size:var(--fs-sm);font-weight:800;text-transform:uppercase;letter-spacing:.10em;color:#0f766e;margin-bottom:6px">${appIcon('sparkle', 13)} Portfolio Overview</div>`;

  // If AI is available and no cache yet, show skeleton; otherwise show cached AI or fallback
  const _aiHasCache = _aiPortfolioCache && (Date.now() - _aiPortfolioCacheTime) < AI_FOCUS_CACHE_TTL;
  const _aiSkeleton = '<div style="display:flex;flex-direction:column;gap:6px"><div style="height:14px;background:var(--border);border-radius:4px;width:95%;animation:pulse 1.5s infinite"></div><div style="height:14px;background:var(--border);border-radius:4px;width:80%;animation:pulse 1.5s infinite"></div><div style="height:14px;background:var(--border);border-radius:4px;width:60%;animation:pulse 1.5s infinite"></div></div>';
  const _actionSkeleton = '<div style="display:flex;flex-direction:column;gap:4px"><div style="height:36px;background:var(--border);border-radius:8px;width:100%;animation:pulse 1.5s infinite"></div><div style="height:36px;background:var(--border);border-radius:8px;width:90%;animation:pulse 1.5s infinite"></div><div style="height:36px;background:var(--border);border-radius:8px;width:95%;animation:pulse 1.5s infinite"></div></div>';

  if (_aiHasCache) {
    html += `<div id="hb-portfolio-blurb" style="font-size:var(--fs-base);color:var(--fg);line-height:1.55;margin-bottom:10px">${escHtml(_aiPortfolioCache.overview || '')}</div>`;
  } else if (_aiIntegrationConnected) {
    html += `<div id="hb-portfolio-blurb" style="font-size:var(--fs-base);color:var(--fg);line-height:1.55;margin-bottom:10px" data-fallback="${escHtml(_portfolioBlurb)}">${_aiSkeleton}</div>`;
  } else {
    html += `<div id="hb-portfolio-blurb" style="font-size:var(--fs-base);color:var(--fg);line-height:1.55;margin-bottom:10px">${_portfolioBlurb}</div>`;
  }

  html += `<div style="font-size:var(--fs-sm);font-weight:800;text-transform:uppercase;letter-spacing:.10em;color:#0f766e;margin-bottom:6px">Action Items</div>`;
  html += '<div id="hb-portfolio-actions">';

  if (_aiHasCache && _aiPortfolioCache.action_items) {
    // Render cached AI action items (will have click handlers attached after innerHTML set)
    window._hbActionItems = [];
    _aiPortfolioCache.action_items.slice(0, 4).forEach(function(a, idx) {
      var filter = _aiActionToFilter(a.text);
      window._hbActionItems.push(filter ? { text: a.text, ids: filter.ids, action: null, tone: a.tone } : { text: a.text, action: null, tone: a.tone });
    });
    // Will be rendered by _renderAIActionItems after innerHTML
  } else if (_aiIntegrationConnected) {
    html += _actionSkeleton;
    window._hbActionItems = _actionItems.slice(0, 3);
  } else {
    // No AI — show hardcoded action items
    window._hbActionItems = _actionItems.slice(0, 3);
    if (_actionItems.length) {
      const _toneColors = { red: { bg:'rgba(239,68,68,.07)', border:'var(--red)' }, amber: { bg:'rgba(245,158,11,.07)', border:'var(--amber)' }, green: { bg:'rgba(22,163,74,.07)', border:'var(--green)' } };
      _actionItems.slice(0, 3).forEach((a, idx) => {
        const tc = _toneColors[a.tone] || _toneColors.amber;
        html += `<div class="hb-brief-card" data-hb-action="${idx}" style="padding:8px 10px;margin-bottom:2px;background:${tc.bg};border-left:3px solid ${tc.border};cursor:pointer">
          <div class="hb-brief-text" style="font-size:var(--fs-sm)">${escHtml(a.text)}</div>
          <svg class="hb-brief-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>`;
      });
    }
  }
  html += '</div>';
  html += '</div>';

  html += '</div>'; // close grid
  html += '</div>'; // close welcome

  // ── 5 KPI Cards Row (from Dashboard) ──
  const _kpiIcon = (svg) => `<div class="dash-kpi-icon">${svg}</div>`;
  const _kpiSvg = {
    people: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    alert:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    cal:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    trend:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
    dollar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'
  };

  // Health bar segment widths
  const hbPct = (arr) => total ? (arr.length / total * 100).toFixed(1) + '%' : '0%';

  // Dynamic number colors (headers stay static)
  const _hbRiskValColor = atRiskMRR > 0 ? '#dc2626' : '#16a34a';
  const _hbRenewValColor = renewals30.length >= 10 ? '#dc2626' : renewals30.length >= 5 ? '#d97706' : '';
  const _hbExpValColor = expand.length > 0 ? '#16a34a' : '';
  const _hbScoreValColor = avgScore >= 65 ? '#16a34a' : avgScore >= 50 ? '#d97706' : '#dc2626';

  html += '<div class="dash-kpi-row">';

  // Card 1: Book Health
  html += `<div class="dash-kpi-card dash-kpi-blue" onclick="nav('customers');setFilter('all')">
    <div class="dash-kpi-hd">${_kpiIcon(_kpiSvg.people)}<span class="dash-kpi-label">Book Health <span class="info-tip tip-below" data-tip="Total active accounts and health distribution. Click to view all customers.">\u24d8</span></span></div>
    <div class="dash-kpi-body">
      <div class="dash-kpi-num">${total}</div>
      <div class="dash-kpi-sub">Total active accounts</div>
      <div class="dash-health-bar">
        <div class="dash-health-seg" style="background:#dc2626;width:${hbPct(critical)}" title="Critical"></div>
        <div class="dash-health-seg" style="background:#ea580c;width:${hbPct(risk)}" title="At Risk"></div>
        <div class="dash-health-seg" style="background:#d97706;width:${hbPct(watch)}" title="Watch"></div>
        <div class="dash-health-seg" style="background:#16a34a;width:${hbPct(healthy)}" title="Healthy"></div>
        <div class="dash-health-seg" style="background:#0891b2;width:${hbPct(expand)}" title="Expansion"></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        <span class="dash-kpi-pill red">${atRisk.length} At Risk</span>
        <span class="dash-kpi-pill amber">${watch.length} Watch</span>
        <span class="dash-kpi-pill green">${healthy.length} Healthy</span>
        <span class="dash-kpi-pill teal">${expand.length} Exp.</span>
      </div>
    </div>
  </div>`;

  // Card 2: Revenue at Risk
  window._hbKpiFilters = window._hbKpiFilters || {};
  window._hbKpiFilters.atRisk = { label: atRisk.length + ' at-risk accounts (Critical + Risk)', ids: atRisk.map(c => c.id) };
  html += `<div class="dash-kpi-card dash-kpi-red" data-kpi-filter="atRisk">
    <div class="dash-kpi-hd">${_kpiIcon(_kpiSvg.alert)}<span class="dash-kpi-label">Revenue at Risk <span class="info-tip tip-below" data-tip="Monthly recurring revenue in Critical and Risk accounts. Click to view at-risk accounts.">\u24d8</span></span></div>
    <div class="dash-kpi-body">
      <div class="dash-kpi-num" style="color:${_hbRiskValColor}">$${fmtNum(atRiskMRR)}</div>
      <div class="dash-kpi-sub">MRR in At Risk accounts</div>
      <div style="margin-top:10px"><span class="dash-kpi-pill red">${atRisk.length} account${atRisk.length !== 1 ? 's' : ''}</span></div>
    </div>
  </div>`;

  // Card 3: Upcoming Renewals
  window._hbKpiFilters.renewals = { label: renewals30.length + ' upcoming renewals (30 days)', ids: renewals30.map(c => c.id) };
  html += `<div class="dash-kpi-card dash-kpi-teal" data-kpi-filter="renewals">
    <div class="dash-kpi-hd">${_kpiIcon(_kpiSvg.cal)}<span class="dash-kpi-label">Upcoming Renewals <span class="info-tip tip-below" data-tip="Customer contracts renewing within the next 30 days. Click to view upcoming renewals.">\u24d8</span></span></div>
    <div class="dash-kpi-body">
      <div class="dash-kpi-num"${_hbRenewValColor ? ` style="color:${_hbRenewValColor}"` : ''}>${renewals30.length}</div>
      <div class="dash-kpi-sub">Due in next 30 days</div>
      <div style="margin-top:10px"><span class="dash-kpi-pill teal">${renewMRR ? '$' + fmtNum(renewMRR) + ' at stake' : 'None due'}</span></div>
    </div>
  </div>`;

  // Card 4: Expansion Opportunity
  const expEst = expansionConfig.mode === 'flat'
    ? expand.length * expansionConfig.flat
    : Math.round(expMRR * (expansionConfig.pct / 100));
  const expSub = expansionConfig.mode === 'flat'
    ? `Est. upsell potential ($${fmtNum(expansionConfig.flat)}/acct)`
    : `Est. upsell potential (${expansionConfig.pct}%)`;
  html += `<div class="dash-kpi-card dash-kpi-green" onclick="nav('customers');setFilter('expand')">
    <div class="dash-kpi-hd">${_kpiIcon(_kpiSvg.trend)}<span class="dash-kpi-label">Expansion Opportunity <span class="info-tip tip-below" data-tip="Estimated upsell potential from expansion-ready accounts. Click to view expansion candidates.">\u24d8</span></span></div>
    <div class="dash-kpi-body">
      <div class="dash-kpi-num"${_hbExpValColor ? ` style="color:${_hbExpValColor}"` : ''}>$${fmtNum(expEst)}</div>
      <div class="dash-kpi-sub">${expSub}</div>
      <div style="margin-top:10px"><span class="dash-kpi-pill green">${expand.length} account${expand.length !== 1 ? 's' : ''} ready</span></div>
    </div>
  </div>`;

  // Card 5: Total MRR
  html += `<div class="dash-kpi-card dash-kpi-purple" onclick="nav('customers');setFilter('all')">
    <div class="dash-kpi-hd">${_kpiIcon(_kpiSvg.dollar)}<span class="dash-kpi-label">Total MRR <span class="info-tip tip-below" data-tip="Total monthly recurring revenue across all active accounts. Click to view all customers.">\u24d8</span></span></div>
    <div class="dash-kpi-body">
      <div class="dash-kpi-num">$${fmtNum(totalMRR)}</div>
      <div class="dash-kpi-sub">All active accounts</div>
      <div style="margin-top:10px"><span class="dash-kpi-pill blue">Avg score <span style="color:${_hbScoreValColor}">${avgScore}</span></span></div>
    </div>
  </div>`;

  html += '</div>';

  // ── Renewal Pipeline (moved from Dashboard) ──
  html += '<div class="card" style="margin-bottom:20px">';
  html += '<div class="card-hd-bar"><span class="card-hd-bar__title">Renewal Pipeline <span class="info-tip tip-below" data-tip="Upcoming renewals grouped by time horizon. Prioritize at-risk renewals first.">\u24d8</span></span></div>';
  html += '<div class="card-body" id="renewal-pipeline-wrap"></div>';
  html += '</div>';

  // ── AI Focus List card (hidden until loaded) ──
  html += '<div class="card" id="hb-ai-focus" style="display:none;margin-bottom:16px">';
  html += '<div class="card-hd-bar" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)"><span class="card-hd-bar__title">' + appIcon('sparkle', 14) + ' Accounts to Focus On · Today</span></div>';
  html += '<div class="card-body" id="hb-ai-focus-body" style="padding:12px"></div>';
  html += '</div>';

  // ── Insights section ──
  html += '<div class="hb-section hb-section-tinted" style="margin-bottom:16px;padding-bottom:8px">';
  html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">';
  html += '<div class="hb-section-hd" style="margin-bottom:0">Insights' + (insights.length ? ` <span class="hb-count">(${insights.length})</span>` : '') + '</div>';
  html += '<div style="display:flex;align-items:center;gap:8px">';
  html += `<select class="form-input" style="width:auto;padding:4px 10px;font-size:var(--fs-sm)" onchange="_hbPeriodDays=+this.value;renderHomeBase()">
    <option value="7"${_hbPeriodDays===7?' selected':''}>7 days</option>
    <option value="14"${_hbPeriodDays===14?' selected':''}>14 days</option>
    <option value="30"${_hbPeriodDays===30?' selected':''}>30 days</option>
  </select>`;
  html += '</div></div>';

  _hbInsightActions = [];
  if (!insights.length) {
    html += `<div class="hb-empty">${_hbSvg.chartEmpty}<p>Portfolio data is building - insights will appear as you score more customers and history accumulates.</p></div>`;
  } else {
    html += '<div class="hb-insights-wrap">';
    insights.forEach(ins => {
      html += _renderInsightCard(ins);
    });
    html += '</div>';
  }
  html += '</div>';

  // ── Most Improved / Biggest Drops (moved from Dashboard) ──
  html += '<div class="hb-movers-grid">';
  html += '<div class="card"><div class="card-hd-bar" style="background:#16a34a"><span class="card-hd-bar__title">Most Improved <span class="info-tip tip-below" data-tip="Accounts with the biggest health score gains over the past 7 days.">\u24d8</span></span><span class="card-hd-bar__badge">7d</span></div><div class="card-body" id="wins-wrap"></div></div>';
  html += '<div class="card"><div class="card-hd-bar" style="background:#dc2626"><span class="card-hd-bar__title">Biggest Drops <span class="info-tip tip-below" data-tip="Accounts with the steepest health score drops over the past 7 days.">\u24d8</span></span><span class="card-hd-bar__badge">7d</span></div><div class="card-body" id="drops-wrap"></div></div>';
  html += '</div>';

  // ── Signal Heatmap (moved from Dashboard) ──
  html += '<div class="card">';
  html += '<div class="card-hd-bar"><span class="card-hd-bar__title">Signal Heatmap <span class="info-tip tip-below" data-tip="Health signals for each customer across key metrics. Click column headers to sort.">\u24d8</span></span></div>';
  html += '<div class="card-body heatmap" id="heatmap-wrap"></div>';
  html += '</div>';

  wrap.innerHTML = _gsCardHTML() + html;

  // Click handlers are delegated via the global homebase click listener below

  // ── Render moved Dashboard widgets into their containers ──
  if (typeof renderRenewalPipeline === 'function') {
    if (typeof hasFeature === 'function' && hasFeature('renewal_pipeline')) renderRenewalPipeline(active);
    else if (el('renewal-pipeline-wrap')) el('renewal-pipeline-wrap').innerHTML = typeof upgradeHTML === 'function' ? upgradeHTML('renewal_pipeline') : '';
  }
  if (typeof renderWins === 'function') renderWins(active);
  if (typeof renderDrops === 'function') renderDrops(active);
  if (typeof renderHeatmap === 'function') renderHeatmap(active);
  // Load AI Focus List (async, non-blocking)
  _loadAIFocusList(active);
  // Load AI Portfolio Overview (async, non-blocking)
  {
    const sdMRR = silentDecliners.reduce((s,c) => s + (c.mrr || 0), 0);
    const _weakSig = (() => {
      if (atRisk.length < 2) return '';
      const sw = { logins:0, adoption:0, tickets:0, nps:0, csat:0, days:0 };
      const sl = { logins:'login activity', adoption:'adoption', tickets:'ticket volume', nps:'NPS', csat:'CSAT', days:'contact recency' };
      atRisk.forEach(c => {
        if (c.logins != null && c.logins < 5) sw.logins++;
        if (c.adoption != null && c.adoption < 30) sw.adoption++;
        if (c.tickets != null && c.tickets >= 5) sw.tickets++;
        if (c.nps != null && c.nps <= 6) sw.nps++;
        if (c.csat != null && c.csat < 3) sw.csat++;
        if (c.days != null && c.days >= 30) sw.days++;
      });
      const top = Object.entries(sw).sort((a,b) => b[1] - a[1])[0];
      return top[1] >= 2 ? sl[top[0]] + ' (' + Math.round(top[1] / atRisk.length * 100) + '% of at-risk)' : '';
    })();
    _loadAIPortfolioOverview({
      total, critical: critical.length, risk: risk.length, watch: watch.length,
      healthy: healthy.length, expand: expand.length,
      avgScore, avgDelta, periodDays: _hbPeriodDays,
      improving, declining, stable: total - improving - declining,
      atRiskMRR, totalMRR,
      renewals30: renewals30.length, renewalMRR: renewMRR,
      renewalsAtRisk: renewalsAtRisk.length,
      silentDecliners: silentDecliners.length, silentDeclinerMRR: sdMRR,
      overnightDrops: _dodBriefing ? _dodBriefing.droppers : 0,
      weakestSignal: _weakSig
    });
  }
  // Inject tour button for homebase
  if (typeof _wtInjectHomebaseTourButton === 'function') _wtInjectHomebaseTourButton();
}

// ── AI Focus List ──
function _loadAIFocusList(active) {
  if (!_aiIntegrationConnected) return;
  var card = el('hb-ai-focus');
  var body = el('hb-ai-focus-body');
  if (!card || !body) return;

  // Check session cache
  if (_aiFocusCache && (Date.now() - _aiFocusCacheTime) < AI_FOCUS_CACHE_TTL) {
    card.style.display = '';
    body.innerHTML = _renderAIFocusHTML(_aiFocusCache);
    return;
  }

  // Build candidate list: sort by score asc, filter critical/risk/watch, max 10
  var candidates = active.slice().filter(function(c) {
    return c.status === 'critical' || c.status === 'risk' || c.status === 'watch';
  }).sort(function(a, b) {
    // Prefer those with renewal coming up
    var aRen = a.renewal_date ? Math.max(0, Math.round((new Date(a.renewal_date) - new Date()) / 86400000)) : 999;
    var bRen = b.renewal_date ? Math.max(0, Math.round((new Date(b.renewal_date) - new Date()) / 86400000)) : 999;
    if (a.score !== b.score) return a.score - b.score; // worst first
    return aRen - bRen; // then nearest renewal
  }).slice(0, 10);

  if (candidates.length < 3) return; // not enough data

  if (!checkAILimit()) return;

  card.style.display = '';
  body.innerHTML = _aiSkeletonHTML(5);

  _trackAICall();
  var miniSummaries = candidates.map(function(c) {
    var trend = 'stable';
    if (c.history && c.history.length >= 2) {
      var recent = c.history[c.history.length - 1].score;
      var prev = c.history[Math.max(0, c.history.length - 4)].score;
      trend = recent > prev ? 'improving' : recent < prev ? 'declining' : 'stable';
    }
    return { name: c.name, score: c.score, status: c.status, mrr: c.mrr || 0, days: c.days, renewal_date: c.renewal_date || '', trend: trend };
  });

  _aiCall({ prompt_type: 'daily_focus', customers: miniSummaries }).then(function(data) {
    if (!data.success) throw new Error(data.error || 'AI returned an error');
    _aiFocusCache = data.data;
    _aiFocusCacheTime = Date.now();
    if (el('hb-ai-focus-body')) el('hb-ai-focus-body').innerHTML = _renderAIFocusHTML(data.data);
  }).catch(function(err) {
    console.warn('AI Focus List error:', err);
    if (el('hb-ai-focus-body')) {
      el('hb-ai-focus-body').innerHTML = '<div style="font-size:var(--fs-sm);color:var(--muted);padding:8px 0">Focus list unavailable. <a href="#" onclick="event.preventDefault();_aiFocusCache=null;_loadAIFocusList(customers.filter(function(c){return c.lifecycle!==\'churned\'}))" style="color:var(--blue)">Retry</a></div>';
    }
  });
}

function _renderAIFocusHTML(data) {
  var html = '';
  if (data.focus_accounts && data.focus_accounts.length) {
    html += '<div style="display:flex;flex-direction:column;gap:6px">';
    data.focus_accounts.forEach(function(fa, idx) {
      var cust = customers.find(function(c) { return c.name === fa.name; });
      var clickAttr = cust ? ' onclick="openDetail(\'' + cust.id + '\')"' : '';
      var isHigh = fa.urgency === 'high';
      var borderCol = isHigh ? 'var(--red)' : 'var(--amber)';
      var rankBg = isHigh ? 'var(--red)' : 'var(--amber)';
      // Customer info
      var scoreStr = cust ? '<span style="font-size:11px;font-weight:700;color:var(--muted);background:var(--bg);padding:1px 6px;border-radius:3px;border:1px solid var(--border)">' + cust.score + '</span>' : '';
      var mrrStr = cust && cust.mrr ? '<span style="font-size:11px;color:var(--muted)">$' + fmtNum(cust.mrr) + '</span>' : '';
      html += '<div style="display:flex;align-items:stretch;border-radius:8px;border:1px solid var(--border);overflow:hidden;cursor:pointer;transition:box-shadow .15s,border-color .15s" onmouseenter="this.style.boxShadow=\'0 2px 8px rgba(0,0,0,.08)\';this.style.borderColor=\'' + borderCol + '44\'" onmouseleave="this.style.boxShadow=\'none\';this.style.borderColor=\'var(--border)\'"' + clickAttr + '>';
      // Rank number
      html += '<div style="width:32px;min-height:100%;display:flex;align-items:center;justify-content:center;background:' + rankBg + ';color:#fff;font-weight:800;font-size:15px;flex-shrink:0">' + (idx + 1) + '</div>';
      // Content
      html += '<div style="flex:1;padding:10px 14px;min-width:0">';
      // Row 1: name + badges
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">';
      html += '<span style="font-weight:700;font-size:var(--fs-base);color:var(--text)">' + escHtml(fa.name) + '</span>';
      html += scoreStr + ' ' + mrrStr;
      html += '</div>';
      // Row 2: reason
      html += '<div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.4;margin-bottom:4px">' + escHtml(fa.reason) + '</div>';
      // Row 3: action
      html += '<div style="font-size:var(--fs-sm);font-weight:600;color:var(--blue);display:flex;align-items:center;gap:4px">' + appIcon('bolt', 12) + ' ' + escHtml(fa.action) + '</div>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
  }
  if (data.portfolio_note) {
    html += '<div style="display:flex;align-items:flex-start;gap:6px;font-size:var(--fs-sm);color:var(--muted);padding:10px 0 2px;border-top:1px solid var(--border);margin-top:6px;line-height:1.4">' + appIcon('sparkle', 13) + ' ' + escHtml(data.portfolio_note) + '</div>';
  }
  return html;
}

// ── AI Portfolio Overview ──
function _loadAIPortfolioOverview(stats) {
  if (!_aiIntegrationConnected) return;
  var blurbEl = el('hb-portfolio-blurb');
  var actionsEl = el('hb-portfolio-actions');
  if (!blurbEl) return;

  // Check session cache — already rendered from cache in HTML build
  if (_aiPortfolioCache && (Date.now() - _aiPortfolioCacheTime) < AI_FOCUS_CACHE_TTL) {
    if (actionsEl && _aiPortfolioCache.action_items) _renderAIActionItems(actionsEl, _aiPortfolioCache.action_items);
    return;
  }

  if (!checkAILimit()) {
    // Can't call AI — show fallback
    var fb = blurbEl.getAttribute('data-fallback');
    if (fb) blurbEl.innerHTML = fb;
    _renderFallbackActions(actionsEl);
    return;
  }

  // Skeleton is already showing from HTML build — just fire the AI call
  _trackAICall();
  _aiCall({ prompt_type: 'portfolio_overview', stats: stats }).then(function(data) {
    if (!data.success) throw new Error(data.error || 'AI returned an error');
    _aiPortfolioCache = data.data;
    _aiPortfolioCacheTime = Date.now();
    if (el('hb-portfolio-blurb')) {
      el('hb-portfolio-blurb').innerHTML = escHtml(data.data.overview || '');
    }
    if (el('hb-portfolio-actions') && data.data.action_items) {
      _renderAIActionItems(el('hb-portfolio-actions'), data.data.action_items);
    }
  }).catch(function(err) {
    console.warn('AI Portfolio Overview error:', err);
    // Restore fallback text since skeleton is showing
    var blurb = el('hb-portfolio-blurb');
    if (blurb) {
      var fb = blurb.getAttribute('data-fallback');
      blurb.innerHTML = fb || 'Portfolio overview unavailable.';
    }
    _renderFallbackActions(el('hb-portfolio-actions'));
  });
}

function _renderFallbackActions(container) {
  if (!container || !window._hbActionItems || !window._hbActionItems.length) return;
  var _toneColors = { red: { bg:'rgba(239,68,68,.07)', border:'var(--red)' }, amber: { bg:'rgba(245,158,11,.07)', border:'var(--amber)' }, green: { bg:'rgba(22,163,74,.07)', border:'var(--green)' } };
  var html = '';
  window._hbActionItems.forEach(function(a, idx) {
    var tc = _toneColors[a.tone] || _toneColors.amber;
    html += '<div class="hb-brief-card" data-hb-action="' + idx + '" style="padding:8px 10px;margin-bottom:2px;background:' + tc.bg + ';border-left:3px solid ' + tc.border + ';cursor:pointer">';
    html += '<div class="hb-brief-text" style="font-size:var(--fs-sm)">' + escHtml(a.text) + '</div>';
    html += '<svg class="hb-brief-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    html += '</div>';
  });
  container.innerHTML = html;
  // Click handling delegated via global homebase click listener
}

function _aiActionToFilter(text) {
  var t = (text || '').toLowerCase();
  var active = customers.filter(function(c) { return c.lifecycle !== 'churned'; });
  // Match keywords to customer filters
  if (t.match(/at.risk|critical/)) {
    var ids = active.filter(function(c) { return c.status === 'critical' || c.status === 'risk'; }).map(function(c) { return c.id; });
    if (ids.length) return { label: 'At-Risk Accounts', ids: ids };
  }
  if (t.match(/silent.declin|previously.healthy|off.the.radar/)) {
    var withHist = active.filter(function(c) { return c.history && c.history.length >= 2; });
    var ids = withHist.filter(function(c) {
      var prev = c.history[Math.max(0, c.history.length - 8)];
      var cur = c.history[c.history.length - 1];
      return prev && prev.score >= 65 && cur.score < prev.score - 5;
    }).map(function(c) { return c.id; });
    if (ids.length) return { label: 'Silent Decliners', ids: ids };
  }
  if (t.match(/renewal|renew/)) {
    var now = new Date();
    var ids = active.filter(function(c) {
      if (!c.renewal_date) return c.renewal != null && c.renewal >= 0 && c.renewal <= 2;
      var diff = (new Date(c.renewal_date) - now) / 86400000;
      return diff >= 0 && diff <= 60;
    }).map(function(c) { return c.id; });
    if (ids.length) return { label: 'Upcoming Renewals', ids: ids };
  }
  if (t.match(/adoption/)) {
    var ids = active.filter(function(c) { return c.adoption != null && c.adoption < 30; }).map(function(c) { return c.id; });
    if (ids.length) return { label: 'Low Adoption', ids: ids };
  }
  if (t.match(/contact|outreach|reach out|engage/)) {
    var ids = active.filter(function(c) { return c.days != null && c.days >= 30; }).map(function(c) { return c.id; });
    if (ids.length) return { label: 'No Recent Contact', ids: ids };
  }
  if (t.match(/declin|drop|falling/)) {
    var withHist = active.filter(function(c) { return c.history && c.history.length >= 2; });
    var ids = withHist.filter(function(c) {
      var recent = c.history[c.history.length - 1].score;
      var prev = c.history[Math.max(0, c.history.length - 4)].score;
      return recent < prev - 2;
    }).map(function(c) { return c.id; });
    if (ids.length) return { label: 'Declining Accounts', ids: ids };
  }
  if (t.match(/expan|upsell|growth/)) {
    var ids = active.filter(function(c) { return c.status === 'expand'; }).map(function(c) { return c.id; });
    if (ids.length) return { label: 'Expansion Opportunities', ids: ids };
  }
  if (t.match(/ticket|support/)) {
    var ids = active.filter(function(c) { return c.tickets != null && c.tickets >= 5; }).map(function(c) { return c.id; });
    if (ids.length) return { label: 'High Ticket Volume', ids: ids };
  }
  if (t.match(/nps|detract/)) {
    var ids = active.filter(function(c) { return c.nps != null && c.nps <= 6; }).map(function(c) { return c.id; });
    if (ids.length) return { label: 'NPS Detractors', ids: ids };
  }
  return null;
}

// Store AI action filters for click handling
var _aiActionFilters = [];

function _renderAIActionItems(container, items) {
  if (!items || !items.length) return;
  _aiActionFilters = [];
  var _toneColors = { red: { bg:'rgba(239,68,68,.07)', border:'var(--red)' }, amber: { bg:'rgba(245,158,11,.07)', border:'var(--amber)' }, green: { bg:'rgba(22,163,74,.07)', border:'var(--green)' } };
  var html = '';
  items.slice(0, 4).forEach(function(a, idx) {
    var tc = _toneColors[a.tone] || _toneColors.amber;
    var filter = _aiActionToFilter(a.text);
    _aiActionFilters.push(filter);
    var clickable = !!filter;
    html += '<div class="hb-brief-card" data-ai-action="' + idx + '" style="padding:8px 10px;margin-bottom:2px;background:' + tc.bg + ';border-left:3px solid ' + tc.border + (clickable ? ';cursor:pointer' : '') + '">';
    html += '<div class="hb-brief-text" style="font-size:var(--fs-sm)">' + escHtml(a.text) + '</div>';
    if (clickable) {
      html += '<svg class="hb-brief-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    }
    html += '</div>';
  });
  container.innerHTML = html;
  // Click handling delegated via global homebase click listener
}

// ── Pulse KPI Card (gradient) ──
function _pulseCard(svgIcon, label, value, delta, sub, colorClass) {
  return `<div class="hb-pulse-card ${colorClass}">
    <div class="hb-pulse-top">
      <div class="hb-pulse-icon">${svgIcon}</div>
      <span class="hb-pulse-label">${label}</span>
    </div>
    <div class="hb-pulse-value">${value}</div>
    <div class="hb-pulse-bottom">
      <span class="hb-pulse-delta">${delta}</span>
      <span class="hb-pulse-sub">${sub}</span>
    </div>
  </div>`;
}

function _statusColor(status) {
  const map = { critical:'var(--red)', risk:'var(--red)', watch:'var(--amber)', healthy:'var(--green)', expand:'var(--blue)' };
  return map[status] || 'var(--muted)';
}

// ═══════════════════════════════════════════════════════════════
// INSIGHT ENGINE - ~15 generators producing strategic observations
// ═══════════════════════════════════════════════════════════════

function _generateInsights(active, now, cutoff) {
  const insights = [];
  const generators = [
    _insightDayOverDay,
    _insightTierDivergence,
    _insightRiskConcentration,
    _insightEmergingRisk,
    _insightQuietAccounts,
    _insightMrrAtRiskDelta,
    _insightRenewalReadiness,
    _insightRenewalVelocity,
    _insightContactImpact,
    _insightSignalDivergence,
    _insightAdoptionCorrelation,
    _insightRenewalClustering
  ];

  generators.forEach(gen => {
    try {
      const result = gen(active, now, cutoff);
      if (result) insights.push(result);
    } catch(e) { /* skip broken generators */ }
  });

  insights.sort((a,b) => a.priority - b.priority);
  return insights.slice(0, 6);
}

// ── Helper: get delta for configurable period ──
function _getDeltaPeriod(c, cutoff) {
  const hist = (c.history || []).filter(h => h.date).sort((a,b) => new Date(a.date) - new Date(b.date));
  if (!hist.length) return 0;
  let best = null;
  for (const h of hist) {
    if (new Date(h.date) <= cutoff) best = h;
  }
  const prev = best ? best.score : hist[0].score;
  return c.score - prev;
}

function _getScoreNDaysAgo(c, daysAgo) {
  const target = new Date();
  target.setDate(target.getDate() - daysAgo);
  const hist = (c.history || []).filter(h => h.date).sort((a,b) => new Date(a.date) - new Date(b.date));
  if (!hist.length) return null;
  let best = null;
  for (const h of hist) {
    if (new Date(h.date) <= target) best = h;
  }
  return best ? best.score : null;
}


// ── INSIGHT: Tier Divergence ──
function _insightTierDivergence(active) {
  const tiers = {};
  active.forEach(c => {
    const t = (c.tier || 'Unknown').toLowerCase();
    if (!tiers[t]) tiers[t] = { total: 0, atRisk: 0, label: c.tier || 'Unknown' };
    tiers[t].total++;
    if (c.status === 'critical' || c.status === 'risk') tiers[t].atRisk++;
  });

  const tierList = Object.values(tiers).filter(t => t.total >= 3);
  if (tierList.length < 2) return null;

  tierList.forEach(t => t.riskPct = Math.round(t.atRisk / t.total * 100));
  tierList.sort((a,b) => b.riskPct - a.riskPct);

  const worst = tierList[0];
  const best  = tierList[tierList.length - 1];
  const gap   = worst.riskPct - best.riskPct;

  if (gap < 15) return null;

  return {
    category: 'Risk',
    priority: 2,
    title: `${worst.label} tier underperforming at ${worst.riskPct}% at-risk`,
    detail: `${worst.label} has ${worst.riskPct}% at-risk accounts vs ${best.riskPct}% for ${best.label} - a ${gap}pt gap. Consider a tier-specific engagement strategy.`,
    action: { label: 'View Segments', fn: function() { nav('segments'); } }
  };
}

// ── INSIGHT: Risk Concentration (by CSM) ──
function _insightRiskConcentration(active) {
  const atRisk = active.filter(c => c.status === 'critical' || c.status === 'risk');
  if (atRisk.length < 3) return null;

  const byMgr = {};
  atRisk.forEach(c => {
    const m = c.manager || 'Unassigned';
    if (!byMgr[m]) byMgr[m] = { count: 0, mrr: 0 };
    byMgr[m].count++;
    byMgr[m].mrr += (c.mrr || 0);
  });

  const managers = Object.entries(byMgr).sort((a,b) => b[1].mrr - a[1].mrr);
  const totalRiskMRR = atRisk.reduce((s,c) => s + (c.mrr || 0), 0);
  const totalMgrs = new Set(active.map(c => c.manager || 'Unassigned')).size;

  if (managers.length < 2 || totalRiskMRR < 1000) return null;

  const topMgrMRR = managers.slice(0, 2).reduce((s,m) => s + m[1].mrr, 0);
  const topPct = Math.round(topMgrMRR / totalRiskMRR * 100);

  if (topPct < 55 || totalMgrs < 3) return null;

  const topNames = managers.slice(0, 2).map(m => m[0]).join(' and ');
  return {
    category: 'Workload',
    priority: 2,
    title: `At-risk MRR concentrated with ${managers.slice(0,2).length} CSMs`,
    detail: `${topPct}% of at-risk MRR ($${fmtNum(topMgrMRR)}) sits with ${topNames}. Consider rebalancing or targeted support.`,
    action: { label: 'View CSM Performance', fn: function() { nav('csmperf'); } }
  };
}

// ── INSIGHT: Emerging Risk (healthy but weak signals) ──
function _insightEmergingRisk(active) {
  const healthyAccts = active.filter(c => c.status === 'healthy' || c.status === 'expand');
  if (healthyAccts.length < 3) return null;

  const earlyWarning = healthyAccts.filter(c => {
    const weakSignals = [
      c.logins != null && c.logins < 5,
      c.adoption != null && c.adoption < 30,
      c.tickets != null && c.tickets >= 5,
      npsIsDetractor(c.nps),
      c.days != null && c.days > 30
    ].filter(Boolean).length;
    return weakSignals >= 2;
  });

  if (earlyWarning.length < 2) return null;
  const ewIdArr = earlyWarning.map(c => c.id);

  return {
    category: 'Risk',
    priority: 2,
    title: `${earlyWarning.length} healthy accounts showing early warning signals`,
    detail: `These accounts are scored healthy but have 2+ concerning metrics (low logins, low adoption, high tickets, or NPS detractor). They may be at risk of decline.`,
    action: { label: 'View Customers', fn: function() { setInsightFilter(earlyWarning.length + ' accounts with early warnings', ewIdArr); } }
  };
}

// ── INSIGHT: MRR at Risk Delta ──
function _insightMrrAtRiskDelta(active, now, cutoff) {
  const atRisk = active.filter(c => c.status === 'critical' || c.status === 'risk');
  const currentMRR = atRisk.reduce((s,c) => s + (c.mrr || 0), 0);

  const withHist = active.filter(c => (c.history || []).length >= 1);
  if (withHist.length < 5) return null;

  const prevAtRisk = withHist.filter(c => {
    const prev = _getScoreNDaysAgo(c, _hbPeriodDays);
    if (prev === null) return false;
    return prev < (thresholds?.risk || 50);
  });
  const prevMRR = prevAtRisk.reduce((s,c) => s + (c.mrr || 0), 0);
  const delta = currentMRR - prevMRR;

  if (Math.abs(delta) < 1000) return null;

  const increased = delta > 0;
  const arIdArr = atRisk.map(c => c.id);
  return {
    category: 'Risk',
    priority: increased ? 1 : 4,
    title: increased
      ? `At-risk MRR increased $${fmtNum(Math.abs(delta))} this period`
      : `At-risk MRR decreased $${fmtNum(Math.abs(delta))} this period`,
    detail: increased
      ? `Revenue exposure grew from $${fmtNum(prevMRR)} to $${fmtNum(currentMRR)}. New accounts entered the risk zone - review before they escalate.`
      : `Revenue exposure shrank from $${fmtNum(prevMRR)} to $${fmtNum(currentMRR)}. Recovery efforts are paying off.`,
    action: { label: 'View Customers', fn: function() { setInsightFilter(atRisk.length + ' at-risk accounts', arIdArr); } }
  };
}

// ── INSIGHT: Renewal Readiness ──
function _insightRenewalReadiness(active, now) {
  const next30 = active.filter(c => {
    if (!c.renewal_date) return c.renewal != null && c.renewal >= 0 && c.renewal <= 1;
    const diff = (new Date(c.renewal_date) - now) / 86400000;
    return diff >= 0 && diff <= 30;
  });
  if (next30.length < 2) return null;

  const avgRenewScore = Math.round(next30.reduce((s,c) => s+c.score, 0) / next30.length);
  const overallAvg = active.length ? Math.round(active.reduce((s,c) => s+c.score, 0) / active.length) : 0;
  const gap = overallAvg - avgRenewScore;

  if (gap < 5) return null;
  const rrIdArr = next30.map(c => c.id);

  return {
    category: 'Renewal',
    priority: gap > 15 ? 1 : 2,
    title: `Upcoming renewals score ${avgRenewScore} vs portfolio avg ${overallAvg}`,
    detail: `${next30.length} accounts renewing in the next 30 days have an average score ${gap} points below your portfolio average. Proactive outreach recommended.`,
    action: { label: 'View Customers', fn: function() { setInsightFilter(next30.length + ' upcoming renewals', rrIdArr); } }
  };
}

// ── INSIGHT: Renewal Velocity (are renewal accounts declining faster than portfolio?) ──
function _insightRenewalVelocity(active, now, cutoff) {
  const next60 = active.filter(c => {
    if (c.renewal_date) {
      const diff = (new Date(c.renewal_date) - now) / 86400000;
      return diff >= 0 && diff <= 60;
    }
    return c.renewal != null && c.renewal >= 0 && c.renewal <= 2;
  });
  if (next60.length < 3) return null;

  const withHist = active.filter(c => (c.history || []).length >= 1);
  if (withHist.length < 5) return null;

  // Avg delta for renewal cohort vs rest of portfolio
  const renewWithHist = next60.filter(c => (c.history || []).length >= 1);
  if (renewWithHist.length < 2) return null;

  const renewAvgDelta = Math.round(renewWithHist.reduce((s,c) => s + _getDeltaPeriod(c, cutoff), 0) / renewWithHist.length * 10) / 10;
  const nonRenew = withHist.filter(c => !next60.includes(c));
  const portfolioAvgDelta = nonRenew.length
    ? Math.round(nonRenew.reduce((s,c) => s + _getDeltaPeriod(c, cutoff), 0) / nonRenew.length * 10) / 10
    : 0;

  const gap = portfolioAvgDelta - renewAvgDelta; // positive = renewals declining faster
  if (gap < 3) return null;

  const renewMRR = next60.reduce((s,c) => s + (c.mrr || 0), 0);
  const decliningRenewals = renewWithHist.filter(c => _getDeltaPeriod(c, cutoff) < -2);

  return {
    category: 'Renewal',
    priority: gap > 8 ? 1 : 2,
    title: `Renewal cohort declining ${Math.abs(renewAvgDelta)} pts vs portfolio ${portfolioAvgDelta > 0 ? '+' : ''}${portfolioAvgDelta}`,
    detail: `${next60.length} accounts renewing in the next 60 days are losing health ${gap} pts faster than your portfolio average. ${decliningRenewals.length} are actively declining - $${fmtNum(renewMRR)} MRR at stake. Set up alerts to catch further drops early.`,
    action: { label: 'Review Alerts', fn: function() { nav('alerts'); } }
  };
}

// ── INSIGHT: Contact Impact (does outreach correlate with better outcomes?) ──
function _insightContactImpact(active, now, cutoff) {
  const withDays = active.filter(c => c.days != null && (c.history || []).length >= 1);
  if (withDays.length < 6) return null;

  // Split into recently contacted (≤14 days) vs not contacted (>14 days)
  const contacted   = withDays.filter(c => c.days <= 14);
  const uncontacted = withDays.filter(c => c.days > 14);
  if (contacted.length < 2 || uncontacted.length < 2) return null;

  const contactedDelta   = Math.round(contacted.reduce((s,c) => s + _getDeltaPeriod(c, cutoff), 0) / contacted.length * 10) / 10;
  const uncontactedDelta = Math.round(uncontacted.reduce((s,c) => s + _getDeltaPeriod(c, cutoff), 0) / uncontacted.length * 10) / 10;

  const gap = Math.round((contactedDelta - uncontactedDelta) * 10) / 10; // positive = contacted are doing better
  if (Math.abs(gap) < 2) return null;

  const outreachHelps = gap > 0;

  // Find uncontacted accounts that are declining - prime outreach candidates
  const neglectedDecliners = uncontacted
    .filter(c => _getDeltaPeriod(c, cutoff) < -2)
    .sort((a,b) => (b.mrr || 0) - (a.mrr || 0));
  const ndIdArr = neglectedDecliners.map(c => c.id);

  if (outreachHelps) {
    return {
      category: 'Engagement',
      priority: neglectedDecliners.length >= 3 ? 2 : 3,
      title: `Contacted accounts trending ${contactedDelta > 0 ? '+' : ''}${contactedDelta} pts vs ${uncontactedDelta > 0 ? '+' : ''}${uncontactedDelta} for uncontacted`,
      detail: `Accounts with recent CSM contact (≤14 days) are outperforming uncontacted ones by ${gap} pts this period. ${neglectedDecliners.length} uncontacted account${neglectedDecliners.length !== 1 ? 's are' : ' is'} actively declining - outreach could reverse the trend.`,
      action: neglectedDecliners.length
        ? { label: 'View Declining Uncontacted', fn: function() { setInsightFilter(neglectedDecliners.length + ' declining uncontacted', ndIdArr); } }
        : { label: 'View Customers', fn: function() { nav('customers'); } }
    };
  } else {
    // Unusual: uncontacted are doing better - maybe over-contact or wrong accounts contacted
    return {
      category: 'Engagement',
      priority: 3,
      title: `Uncontacted accounts outperforming contacted ones by ${Math.abs(gap)} pts`,
      detail: `Contacted accounts averaged ${contactedDelta > 0 ? '+' : ''}${contactedDelta} pts vs ${uncontactedDelta > 0 ? '+' : ''}${uncontactedDelta} for uncontacted. This may indicate outreach is focused on the wrong accounts or low-touch accounts are self-sufficient.`,
      action: { label: 'Review Book', fn: function() { nav('customers'); } }
    };
  }
}

// ── INSIGHT: Signal Divergence (usage vs sentiment moving in opposite directions) ──
function _insightSignalDivergence(active) {
  // Find accounts where usage signals and sentiment signals are moving in opposite directions
  // This is a classic early warning: high usage + dropping sentiment = frustration
  // Or: low usage + good sentiment = disengagement risk (they like it but don't use it)

  const divergent = active.filter(c => {
    const highUsage = (c.logins != null && c.logins >= 10) || (c.adoption != null && c.adoption >= 50);
    const lowSentiment = npsIsDetractor(c.nps) || (c.csat != null && c.csat < 3) || (c.tickets != null && c.tickets >= 5);
    const lowUsage = (c.logins != null && c.logins < 3) || (c.adoption != null && c.adoption < 20);
    const highSentiment = npsIsPromoter(c.nps) || (c.csat != null && c.csat >= 4);

    // Must have data on both dimensions
    const hasUsage = c.logins != null || c.adoption != null;
    const hasSentiment = c.nps != null || c.csat != null || c.tickets != null;
    if (!hasUsage || !hasSentiment) return false;

    // Flag 1: Using the product a lot but unhappy (frustration pattern)
    if (highUsage && lowSentiment) { c._divergeType = 'frustration'; return true; }
    // Flag 2: Not using it much but say they like it (disengagement risk)
    if (lowUsage && highSentiment) { c._divergeType = 'disengaging'; return true; }
    return false;
  });

  if (divergent.length < 2) return null;

  const frustrated = divergent.filter(c => c._divergeType === 'frustration');
  const disengaging = divergent.filter(c => c._divergeType === 'disengaging');
  const frustratedMRR = frustrated.reduce((s,c) => s + (c.mrr || 0), 0);
  const divIdArr = divergent.map(c => c.id);

  // Clean up temp property
  divergent.forEach(c => delete c._divergeType);

  let title, detail;
  if (frustrated.length >= 2 && frustrated.length >= disengaging.length) {
    title = `${frustrated.length} high-usage accounts showing negative sentiment`;
    detail = `These accounts are actively using the product but showing frustration signals (low NPS, high tickets, or low CSAT). $${fmtNum(frustratedMRR)} MRR. When usage is high but sentiment is low, churn often follows once an alternative appears.`;
  } else if (disengaging.length >= 2) {
    title = `${disengaging.length} accounts show positive sentiment but low engagement`;
    detail = `These accounts report satisfaction but have low login/adoption numbers. Positive sentiment without active usage often precedes quiet churn - they like the idea but aren't embedded in it.`;
  } else {
    title = `${divergent.length} accounts have usage-sentiment divergence`;
    detail = `${frustrated.length} show high usage with negative sentiment (frustration risk), ${disengaging.length} show low usage with positive sentiment (disengagement risk). Both patterns warrant investigation.`;
  }

  return {
    category: 'Risk',
    priority: frustrated.length >= 2 ? 2 : 3,
    title,
    detail,
    action: { label: 'View Divergent Accounts', fn: function() { setInsightFilter(divergent.length + ' signal-divergent accounts', divIdArr); } }
  };
}

// ── INSIGHT: Adoption Correlation ──
function _insightAdoptionCorrelation(active) {
  const withAdoption = active.filter(c => c.adoption != null);
  if (withAdoption.length < 5) return null;

  const lowAdoption = withAdoption.filter(c => c.adoption < 30);
  const lowAdoptionAtRisk = lowAdoption.filter(c => c.status === 'critical' || c.status === 'risk');

  if (lowAdoption.length < 3) return null;

  const riskRate = Math.round(lowAdoptionAtRisk.length / lowAdoption.length * 100);
  const overallRiskRate = Math.round(active.filter(c => c.status === 'critical' || c.status === 'risk').length / active.length * 100);

  if (riskRate <= overallRiskRate + 10) return null;

  const multiplier = (riskRate / Math.max(overallRiskRate, 1)).toFixed(1);
  const laIdArr = lowAdoption.map(c => c.id);

  return {
    category: 'Engagement',
    priority: 3,
    title: `Low adoption accounts are ${multiplier}x more likely to be at-risk`,
    detail: `${lowAdoption.length} accounts with <30% adoption have a ${riskRate}% at-risk rate vs ${overallRiskRate}% overall. Driving adoption could prevent future churn.`,
    action: { label: 'View Customers', fn: function() { setInsightFilter(lowAdoption.length + ' low-adoption accounts', laIdArr); } }
  };
}

// ── INSIGHT: Renewal Clustering (are renewals bunched, creating workload risk?) ──
function _insightRenewalClustering(active, now) {
  // Analyze renewal date distribution over next 90 days
  // Detect if renewals cluster in narrow windows - creating attention-dilution risk
  const withRenewal = active.filter(c => {
    if (c.renewal_date) {
      const diff = (new Date(c.renewal_date) - now) / 86400000;
      return diff >= 0 && diff <= 90;
    }
    return c.renewal != null && c.renewal >= 0 && c.renewal <= 3;
  });
  if (withRenewal.length < 5) return null;

  // Bucket into 2-week windows (6 buckets for 90 days)
  const buckets = [0,0,0,0,0,0];
  const bucketMRR = [0,0,0,0,0,0];
  const bucketAccts = [[],[],[],[],[],[]];
  withRenewal.forEach(c => {
    let days;
    if (c.renewal_date) {
      days = Math.max(0, Math.round((new Date(c.renewal_date) - now) / 86400000));
    } else {
      days = Math.max(0, Math.round((c.renewal || 0) * 30));
    }
    const bucket = Math.min(Math.floor(days / 15), 5);
    buckets[bucket]++;
    bucketMRR[bucket] += (c.mrr || 0);
    bucketAccts[bucket].push(c);
  });

  // Find the peak bucket
  let peakIdx = 0;
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i] > buckets[peakIdx]) peakIdx = i;
  }

  const peakCount = buckets[peakIdx];
  const peakPct = Math.round(peakCount / withRenewal.length * 100);
  const peakMRR = bucketMRR[peakIdx];

  // Only fire if meaningful concentration (>40% in one window)
  if (peakPct < 40 || peakCount < 3) return null;

  // Also check if consecutive windows are heavy (clustering across 4 weeks)
  const adjacentIdx = peakIdx < 5 ? peakIdx + 1 : peakIdx - 1;
  const clusterCount = peakCount + (buckets[adjacentIdx] || 0);
  const clusterPct = Math.round(clusterCount / withRenewal.length * 100);
  const clusterMRR = peakMRR + (bucketMRR[adjacentIdx] || 0);

  const windowStart = peakIdx * 15;
  const windowEnd = windowStart + 14;
  const dtFmt = { month: 'short', day: 'numeric' };
  const startDate = new Date(now.getTime() + windowStart * 86400000);
  const endDate = new Date(now.getTime() + windowEnd * 86400000);
  const windowLabel = windowStart === 0
    ? `next 2 weeks (${startDate.toLocaleDateString('en-US', dtFmt)} – ${endDate.toLocaleDateString('en-US', dtFmt)})`
    : `${startDate.toLocaleDateString('en-US', dtFmt)} – ${endDate.toLocaleDateString('en-US', dtFmt)}`;

  return {
    category: 'Renewal',
    priority: peakPct >= 50 ? 2 : 3,
    title: `${peakPct}% of renewals clustered in ${windowLabel}`,
    detail: `${peakCount} of ${withRenewal.length} upcoming renewals ($${fmtNum(peakMRR)} MRR) fall in a single 2-week window. ${clusterPct > peakPct ? `Including the adjacent window, ${clusterPct}% ($${fmtNum(clusterMRR)} MRR) land in a 4-week span. ` : ''}Clustering creates attention-dilution risk - plan outreach cadence now.`,
    action: { label: 'View Calendar', fn: function() { nav('calendar'); } }
  };
}

// ── INSIGHT: Day-over-Day Drop Detection ──
function _insightDayOverDay(active) {
  const dodDroppers = [];
  const dodAll = [];

  active.forEach(c => {
    const hist = (c.history || []).filter(h => h.date)
      .sort((a,b) => new Date(b.date) - new Date(a.date)); // newest first
    if (hist.length < 2) return;

    const latest = hist[0];
    const prev   = hist[1];
    // Only compare if the two most recent entries are on different calendar days
    const d1 = new Date(latest.date); d1.setHours(0,0,0,0);
    const d2 = new Date(prev.date);   d2.setHours(0,0,0,0);
    const dayGap = Math.round((d1 - d2) / 86400000);
    if (dayGap < 1 || dayGap > 3) return; // adjacent days only (allow weekend gap)

    const delta = latest.score - prev.score;
    dodAll.push({ c, delta, from: prev.score, to: latest.score });
    if (delta <= -8) dodDroppers.push({ c, delta, from: prev.score, to: latest.score });
  });

  if (!dodAll.length) return null;

  const avgDoD = Math.round(dodAll.reduce((s,d) => s + d.delta, 0) / dodAll.length * 10) / 10;

  // Only fire if significant: portfolio avg drop ≥ 3 OR ≥ 2 accounts dropped ≥ 8
  if (avgDoD > -3 && dodDroppers.length < 2) return null;

  // Sort droppers by biggest drop
  dodDroppers.sort((a,b) => a.delta - b.delta);
  const top3 = dodDroppers.slice(0, 3);
  const detailParts = top3.map(d =>
    `${d.c.name} fell ${Math.abs(d.delta)} pts (${d.from}\u2009→\u2009${d.to})`
  );

  const title = dodDroppers.length >= 2
    ? `Significant overnight drop \u2014 ${dodDroppers.length} account${dodDroppers.length !== 1 ? 's' : ''} fell 8+ pts`
    : `Portfolio dropped ${Math.abs(avgDoD)} pts day-over-day`;

  const detail = detailParts.length
    ? detailParts.join(', ') + '. Review signal changes to understand the cause.'
    : `Average portfolio score fell ${Math.abs(avgDoD)} pts from the prior day. Check for broad signal changes.`;

  const ids = dodDroppers.map(d => d.c.id);

  return {
    category: 'Trend',
    icon: 'trendDown',
    priority: 1,
    title,
    detail,
    action: ids.length
      ? { label: 'View Affected Accounts', fn: function() { setInsightFilter('DoD significant drops', ids); } }
      : { label: 'View 1-Day Trend', fn: function() { setTrendRange('3d'); nav('trends'); } }
  };
}

// ── INSIGHT: Quiet Accounts (zero activity across all signals) ──
function _insightQuietAccounts(active) {
  const quiet = active.filter(c => isQuietAccount(c));
  if (quiet.length < 1) return null;
  const sorted = [...quiet].sort((a, b) => (b.mrr || 0) - (a.mrr || 0));
  const totalMRR = sorted.reduce((s, c) => s + (c.mrr || 0), 0);
  const top3 = sorted.slice(0, 3);
  const topNames = top3.map(c => c.name).join(', ');
  const moreCount = quiet.length - top3.length;
  const moreStr = moreCount > 0 ? ` +${moreCount} more` : '';
  const quietIds = quiet.map(c => c.id);
  return {
    category: 'Risk',
    priority: quiet.length >= 3 ? 1 : 2,
    title: `${quiet.length} account${quiet.length !== 1 ? 's' : ''} have gone completely quiet`,
    detail: `Zero logins, zero tickets, and no CSM contact for ${QUIET_THRESHOLD_DAYS}+ days. Total MRR at risk: $${fmtNum(totalMRR)}. Top: ${topNames}${moreStr}.`,
    action: { label: 'View Quiet Accounts', fn: function() { setInsightFilter(quiet.length + ' quiet accounts', quietIds); } }
  };
}

// ── Render a single insight card ──
function _renderInsightCard(ins) {
  const catColors = {
    'Trend':       { bg: 'var(--blue-l)',   border: 'var(--blue-m)',   text: 'var(--blue)' },
    'Risk':        { bg: 'var(--red-l)',     border: 'var(--red-m)',    text: 'var(--red)' },
    'Renewal':     { bg: 'var(--purple-l)',  border: 'var(--purple-m)', text: 'var(--purple)' },
    'Workload':    { bg: 'var(--amber-l)',   border: 'var(--amber-m)',  text: 'var(--amber)' },
    'Opportunity': { bg: 'var(--green-l)',   border: 'var(--green-m)',  text: 'var(--green)' },
    'Engagement':  { bg: 'var(--teal-l)',    border: 'var(--teal-m)',   text: 'var(--teal)' },
  };
  const c = catColors[ins.category] || catColors['Trend'];
  const catClass = _hbCatClass[ins.category] || 'trend';
  const iconKey = ins.icon || _hbCatIcon[ins.category] || 'trend';
  const iconSvg = _hbSvg[iconKey] || _hbSvg.trend;

  // Priority class for background tinting
  const pClass = ins.priority <= 1 ? ' hb-p1' : ins.priority <= 2 ? ' hb-p2' : '';

  let actionBtn = '';
  if (ins.action) {
    const actionIdx = _hbInsightActions.length;
    _hbInsightActions.push(ins.action.fn);
    actionBtn = `<button class="hb-insight-action" data-insight-action="${actionIdx}">${escHtml(ins.action.label)} →</button>`;
  }

  return `<div class="hb-insight-card hb-cat-${catClass}${pClass}">
    <div class="hb-insight-icon ic-${catClass}">${iconSvg}</div>
    <div class="hb-insight-body">
      <div class="hb-insight-top">
        <span class="hb-insight-cat" style="background:${c.bg};color:${c.text};border:1px solid ${c.border}">${ins.category}</span>
        <span class="hb-insight-title">${escHtml(ins.title)}</span>
      </div>
      <div class="hb-insight-detail">${escHtml(ins.detail)}</div>
      ${actionBtn}
    </div>
  </div>`;
}

// ─── HOME BASE WIDGETS ──────────────────────────────────────
// Signal heatmap, wins/drops, renewal pipeline - all called by renderHomeBase()

// ─── SIGNAL HEATMAP ─────────────────────────────────────────
let _heatSearch = '';
const HEAT_COLS = [
  { key:'name',     label:'Customer',  ftype:'text',   sortFn:"dashHeatSortBy('name')" },
  { key:'score',    label:'Score',     ftype:'number', sortFn:"dashHeatSortBy('score')" },
  { key:'logins',   label:'Logins',    ftype:'number', sortFn:"dashHeatSortBy('logins')" },
  { key:'adoption', label:'Adoption',  ftype:'number', sortFn:"dashHeatSortBy('adoption')" },
  { key:'tickets',  label:'Tickets',   ftype:'number', sortFn:"dashHeatSortBy('tickets')" },
  { key:'nps',      label:'NPS',       ftype:'number', sortFn:"dashHeatSortBy('nps')" },
  { key:'csat',     label:'CSAT',      ftype:'number', sortFn:"dashHeatSortBy('csat')" },
  { key:'days',     label:'Last Cont.',ftype:'number', sortFn:"dashHeatSortBy('days')" },
  { key:'growth',   label:'Growth',    ftype:'enum',   sortFn:"dashHeatSortBy('growth')", enumVals:['none','mild','strong'] },
  { key:'created_at', label:'Date Added', ftype:'text', sortFn:"dashHeatSortBy('created_at')" },
];
const _heatCF = makeColFilters('heat', 'hb-filter-portal', HEAT_COLS, function() {
  renderHeatmap(customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c)));
});
function _heatVal(c, key) {
  if (key === 'name') return (c.name || '').toLowerCase();
  if (key === 'score') return c.score || 0;
  if (key === 'logins') return c.logins != null ? c.logins : -1;
  if (key === 'adoption') return c.adoption != null ? c.adoption : -1;
  if (key === 'tickets') return c.tickets != null ? c.tickets : -1;
  if (key === 'nps') return npsNormalized(c.nps);
  if (key === 'csat') return csatNormalized(c.csat);
  if (key === 'days') return c.days != null ? c.days : -1;
  if (key === 'growth') return c.growth || 'none';
  if (key === 'created_at') return c.created_at || '';
  return 0;
}
function dashHeatSortBy(key) {
  if (dashHeatSort.key === key) dashHeatSort.dir *= -1;
  else { dashHeatSort.key = key; dashHeatSort.dir = key === 'name' ? 1 : -1; }
  renderHeatmap(customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c)));
}
function heatSearchFilter(val) {
  _heatSearch = (val || '').toLowerCase();
  renderHeatmap(customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c)));
}

function renderHeatmap(active) {
  const wrap = el('heatmap-wrap');
  if (!wrap) return;
  if (!active.length) {
    wrap.innerHTML = '<div style="color:var(--subtle);font-size:var(--fs-base);padding:16px 0;text-align:center">No customers yet</div>';
    return;
  }

  // Filter by search
  const heatFiltered = _heatSearch ? active.filter(c => c.name.toLowerCase().includes(_heatSearch) || (c.manager||'').toLowerCase().includes(_heatSearch)) : active;

  // Sort - NPS/CSAT sort uses normalized 0-100
  const growOrder = { strong:2, mild:1, none:0 };
  const sorted = [...heatFiltered].sort((a, b) => {
    let av, bv;
    switch (dashHeatSort.key) {
      case 'name':    av = a.name;     bv = b.name;     break;
      case 'score':   av = a.score;    bv = b.score;    break;
      case 'logins':  av = a.logins != null ? a.logins : -1;   bv = b.logins != null ? b.logins : -1;   break;
      case 'adoption':av = a.adoption != null ? a.adoption : -1; bv = b.adoption != null ? b.adoption : -1; break;
      case 'tickets': av = a.tickets != null ? a.tickets : -1;  bv = b.tickets != null ? b.tickets : -1;  break;
      case 'nps':     av = npsNormalized(a.nps); bv = npsNormalized(b.nps); break;
      case 'csat':    av = csatNormalized(a.csat); bv = csatNormalized(b.csat); break;
      case 'days':    av = a.days != null ? a.days : -1;     bv = b.days != null ? b.days : -1;     break;
      case 'growth':  av = growOrder[a.growth]||0; bv = growOrder[b.growth]||0; break;
      case 'created_at': av = a.created_at||''; bv = b.created_at||''; break;
      default:        av = a.score;    bv = b.score;
    }
    if (typeof av === 'string') return av.localeCompare(bv) * dashHeatSort.dir;
    return (av - bv) * dashHeatSort.dir;
  });

  const hmColor = (v, inv) => {
    const n = inv ? 100 - v : v;
    if (n < 50) return 'hm-r';
    if (n < 80) return 'hm-y';
    return 'hm-g';
  };

  // Apply column filters
  const heatFinal = cfApplyFilters('heat', sorted, _heatVal);

  // Build column headers with sort + funnel
  const thCols = HEAT_COLS.map(col => cfBuildTh('heat', col, dashHeatSort.key, dashHeatSort.dir)).join('');

  wrap.innerHTML = `<div style="margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><input type="text" placeholder="Search customers..." value="${escHtml(_heatSearch)}" oninput="heatSearchFilter(this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:var(--fs-base);width:220px"/><span style="font-size:var(--fs-sm);color:var(--muted)">${heatFinal.length} customer${heatFinal.length!==1?'s':''}</span></div>
    ${cfRenderPills('heat')}
    <div style="max-height:480px;overflow-y:auto">
    <table class="ct heatmap-tbl">
    <thead><tr>${thCols}</tr></thead>
    <tbody>${heatFinal.map(c => {
      const loginPct  = c.logins != null ? Math.round((c.logins/30)*100) : 50;
      const ticketPct = c.tickets != null ? Math.max(0,100-c.tickets*20) : 50;
      const npsPct    = npsNormalized(c.nps);
      const csatPct   = csatNormalized(c.csat);
      const daysPct   = c.days != null ? Math.max(0,100-(c.days/180)*100) : 50;
      const growPct   = {none:25,mild:65,strong:100}[c.growth]||25;
      return `<tr style="cursor:pointer" onclick="openDetail('${escHtml(c.id)}')">
        <td style="font-weight:600;color:var(--text)">${escHtml(c.name)}</td>
        <td class="${hmColor(c.score,false)}">${c.score}</td>
        <td class="${hmColor(loginPct,false)}">${c.logins != null ? c.logins+'d' : '<span style="color:var(--subtle)">N/A</span>'}</td>
        <td class="${hmColor(c.adoption != null ? c.adoption : 50,false)}">${c.adoption != null ? c.adoption+'%' : '<span style="color:var(--subtle)">N/A</span>'}</td>
        <td class="${hmColor(ticketPct,false)}">${c.tickets != null ? c.tickets : '<span style="color:var(--subtle)">N/A</span>'}</td>
        <td class="${hmColor(npsPct,false)}">${npsDisplay(c.nps)}</td>
        <td class="${hmColor(csatPct,false)}">${csatDisplay(c.csat)}</td>
        <td class="${hmColor(daysPct,false)}">${c.days != null ? c.days+'d' : '<span style="color:var(--subtle)">N/A</span>'}</td>
        <td class="${hmColor(growPct,false)}">${c.growth}</td>
        <td style="color:var(--muted);white-space:nowrap">${c.created_at ? new Date(c.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '<span style="color:var(--subtle)">N/A</span>'}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

// ─── THIS WEEK'S WINS ────────────────────────────────────────
function renderWins(active) {
  const wrap = el('wins-wrap');
  if (!wrap) return;

  // Use getDelta7d() as single source of truth (matches detail panel & customers table)
  const wins = [];
  active.forEach(c => {
    if (!c.history || c.history.length < 2) return;
    const delta = getDelta7d(c);
    if (delta > 0) wins.push({ c, delta, newScore: c.score });
  });

  if (!wins.length) {
    wrap.innerHTML = '<div style="font-size:var(--fs-base);color:var(--muted);padding:6px 0;text-align:center">No score improvements this week yet</div>';
    return;
  }

  // Sort by biggest improvement, show top 3 with "See all" link
  wins.sort((a,b) => b.delta - a.delta);
  const winsTotal = wins.length;
  const top = wins.slice(0, 3);
  const winsSeeAll = winsTotal > 3
    ? `<div class="widget-see-all" onclick="showAllDelta('up')">See all ${winsTotal} →</div>`
    : '';

  wrap.innerHTML = top.map(({ c, delta, newScore }) => {
    const st = getStatus(newScore);
    const badgeColor = STATUS_COLOR[st] || '#16a34a';
    const badgeBg    = { critical:'#fef2f2', risk:'#fff7ed', watch:'#fffbeb', healthy:'#f0fdf4', expand:'#ecfeff' }[st] || '#f0fdf4';
    return `
    <div class="win-item" onclick="openDetail('${escHtml(c.id)}')">
      <div style="width:32px;height:32px;border-radius:50%;background:${badgeBg};border:2px solid ${badgeColor};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span style="font-size:var(--fs-sm);font-weight:800;color:${badgeColor}">${newScore}</span>
      </div>
      <div style="flex:1;min-width:0">
        <div class="win-name">${escHtml(c.name)}</div>
        <div style="font-size:var(--fs-xs);color:var(--muted)">${STATUS_LABEL[st]}</div>
      </div>
      <span class="win-delta" style="display:flex;align-items:center;gap:3px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>+${delta}</span>
    </div>`;
  }).join('') + winsSeeAll;
}

// ─── BIGGEST DROPS ───────────────────────────────────────────
function renderDrops(active) {
  const wrap = el('drops-wrap');
  if (!wrap) return;

  // Use getDelta7d() as single source of truth (matches detail panel & customers table)
  const drops = [];
  active.forEach(c => {
    if (!c.history || c.history.length < 2) return;
    const delta = getDelta7d(c);
    if (delta < 0) drops.push({ c, delta, newScore: c.score });
  });

  if (!drops.length) {
    wrap.innerHTML = '<div style="font-size:var(--fs-base);color:var(--muted);padding:6px 0;text-align:center">No score drops this week</div>';
    return;
  }

  // Sort by biggest drop (most negative first), show top 3 with "See all" link
  drops.sort((a,b) => a.delta - b.delta);
  const dropsTotal = drops.length;
  const topDrops   = drops.slice(0, 3);
  const dropsSeeAll = dropsTotal > 3
    ? `<div class="widget-see-all" onclick="showAllDelta('down')">See all ${dropsTotal} →</div>`
    : '';

  const statusBg = { critical:'#fef2f2', risk:'#fff7ed', watch:'#fffbeb', healthy:'#f0fdf4', expand:'#ecfeff' };

  wrap.innerHTML = topDrops.map(({ c, delta, newScore }) => {
    const st         = getStatus(newScore);
    const badgeColor = STATUS_COLOR[st] || '#ea580c';
    const badgeBg    = statusBg[st] || '#fff7ed';
    return `
    <div class="win-item" onclick="openDetail('${escHtml(c.id)}')">
      <div style="width:32px;height:32px;border-radius:50%;background:${badgeBg};border:2px solid ${badgeColor};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span style="font-size:var(--fs-sm);font-weight:800;color:${badgeColor}">${newScore}</span>
      </div>
      <div style="flex:1;min-width:0">
        <div class="win-name">${escHtml(c.name)}</div>
        <div style="font-size:var(--fs-xs);color:var(--muted)">${STATUS_LABEL[st]}</div>
      </div>
      <span style="font-size:var(--fs-sm);font-weight:800;color:#dc2626;white-space:nowrap;display:flex;align-items:center;gap:3px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>-${Math.abs(delta)}</span>
    </div>`;
  }).join('') + dropsSeeAll;
}

// Compute a customer's 7-day score delta (used for See All filtering + sorting)
function getDelta7d(c) {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const hist = c.history || [];
  const recent = hist.filter(h => new Date(h.date) >= weekAgo)
                     .sort((a,b) => new Date(b.date) - new Date(a.date));
  if (!recent.length) return 0;
  const before = hist.filter(h => new Date(h.date) < weekAgo)
                     .sort((a,b) => new Date(b.date) - new Date(a.date));
  const prev = before.length ? before[0].score : hist[0].score;
  return recent[0].score - prev;
}

// ─── RENEWAL PIPELINE WIDGET ─────────────────────────────────
function renderRenewalPipeline(active) {
  const wrap = el('renewal-pipeline-wrap');
  if (!wrap) return;
  const now = new Date(); now.setHours(0,0,0,0);
  const buckets = [
    { label:'0–30 days',  color:'#dc2626', bg:'#fef2f2', min:0,  max:30  },
    { label:'31–60 days', color:'#ea580c', bg:'#fff7ed', min:31, max:60  },
    { label:'61–90 days', color:'#d97706', bg:'#fffbeb', min:61, max:90  },
  ];
  const withDate = active.filter(c => c.renewal_date);
  if (!withDate.length) {
    wrap.innerHTML = '<div style="color:var(--subtle);font-size:var(--fs-base);padding:8px 0;text-align:center">No accounts have a renewal date set. Add renewal dates when editing a customer.</div>';
    return;
  }
  const rows = buckets.map(b => {
    const grp = withDate.filter(c => {
      const days = Math.round((new Date(c.renewal_date) - now) / 86400000);
      return days >= b.min && days <= b.max;
    });
    const mrr    = grp.reduce((s,c)=>s+(c.mrr||0),0);
    const atRisk = grp.filter(c=>c.status==='critical'||c.status==='risk').length;
    return { ...b, count:grp.length, mrr, atRisk, ids: grp.map(c=>c.id) };
  });
  wrap.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
    ${rows.map(r => {
      const riskBadge = r.atRisk ? `<span style="color:${r.color};font-size:var(--fs-xs);font-weight:700">${appIcon('warning',11)} ${r.atRisk} at risk</span>` : '';
      const countText = r.count ? `${r.count} acct${r.count!==1?'s':''}` : `<span style="color:var(--subtle)"> -</span>`;
      const clickable = r.count > 0;
      const _rIds = escHtml(JSON.stringify(r.ids));
      return `<div style="border-left:3px solid ${r.color};background:${r.bg};border-radius:6px;padding:9px 12px;${clickable?'cursor:pointer;transition:transform .15s,box-shadow .15s':''}" ${clickable?`onclick="filterRenewalBucket('Renewal ${escHtml(r.label)}',${_rIds})" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 12px rgba(0,0,0,.1)'" onmouseout="this.style.transform='';this.style.boxShadow=''"`:''}>
        <div style="font-size:var(--fs-xs);font-weight:700;color:${r.color};text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">${r.label}</div>
        <div style="font-size:1.05rem;font-weight:800;color:#1e293b;margin-bottom:2px">${r.mrr ? '$'+fmtNum(r.mrr) : ' -'}</div>
        <div style="font-size:var(--fs-sm);color:var(--muted);display:flex;gap:5px;align-items:center;flex-wrap:wrap">${countText}${r.atRisk?' · ':''}${riskBadge}</div>
      </div>`;
    }).join('')}
  </div>`;
}

// Navigate to customers tab filtered to a renewal pipeline bucket
function filterRenewalBucket(label, ids) {
  if (!ids || !ids.length) return;
  sortKey = 'renewal';
  sortDir = 1;
  setInsightFilter(label, ids);
}

// Navigate to customers page pre-filtered to all improvers or all decliners this week
function showAllDelta(direction) {
  filterMode = 'all';
  columnFilters = {};
  columnFilters['_delta'] = { type: direction }; // 'up' or 'down'
  sortKey = '_delta';
  sortDir = direction === 'up' ? -1 : 1; // improvements desc, drops asc
  nav('customers');
}

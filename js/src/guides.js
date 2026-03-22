// ─── PAGE GUIDE SYSTEM ──────────────────────────────────────
// Guide content shown in a modal popup via Guide button in page headers.

// All guide definitions: id → storageKey mapping (for badge management)
const _GUIDE_DEFS = [
  { id: 'alerts-guide',      key: 'iqc_alerts_guide_dismissed' },
  { id: 'customers-guide',   key: 'iqc_customers_guide_dismissed' },
  { id: 'segments-guide',    key: 'iqc_segments_guide_dismissed' },
  { id: 'trends-guide',      key: 'iqc_trends_guide_dismissed' },
  { id: 'csmperf-guide',     key: 'iqc_csmperf_guide_dismissed' },
  { id: 'calendar-guide',    key: 'iqc_calendar_guide_dismissed' },
  { id: 'reports-guide',     key: 'iqc_reports_guide_dismissed' },
  { id: 'score-guide',       key: 'iqc_score_guide_dismissed' },
  { id: 'users-guide',       key: 'iqc_users_guide_dismissed' },
  { id: 'auditlog-guide',    key: 'iqc_auditlog_guide_dismissed' },
  { id: 'automations-guide', key: 'iqc_automations_guide_dismissed' },
  { id: 'csv-guide',         key: 'iqc_csv_guide_dismissed' },
  { id: 'settings-guide',    key: 'iqc_settings_guide_dismissed' },
];

// One-time migration: reset all guide dismissals so users see the new v480 guides.
// Bump the version key when you want to force-show guides again.
(function _migrateGuides() {
  var VER = 'iqc_guides_v3';
  try {
    if (localStorage.getItem(VER)) return; // already migrated
    _GUIDE_DEFS.forEach(function(g) { localStorage.removeItem(g.key); });
    localStorage.setItem(VER, '1');
  } catch(e) { console.warn('ls:', e.message); }
})();

// Guide badges removed from nav — no badges to manage
const _ACTIVE_GUIDES = new Set();

// Show/hide all guide badges based on localStorage state. Called on boot.
function _updateAllGuideBadges() {
  _GUIDE_DEFS.forEach(function(g) {
    var badge = document.getElementById(g.id + '-badge');
    if (!badge) return;
    if (!_ACTIVE_GUIDES.has(g.id)) { badge.style.display = 'none'; return; }
    try { badge.style.display = localStorage.getItem(g.key) === '1' ? 'none' : ''; } catch(e) { badge.style.display = 'none'; }
  });
}

function _renderGuide(id, storageKey, html) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  try { if (localStorage.getItem(storageKey) === '1') { wrap.style.display = 'none'; return; } } catch(e) { console.warn('ls:', e.message); }
  wrap.style.display = '';
  wrap.innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-start;padding:12px 14px;background:color-mix(in srgb, var(--teal) 8%, var(--surface));border:1px solid color-mix(in srgb, var(--teal) 25%, var(--border));border-radius:var(--r);margin-bottom:14px">
      <div style="width:28px;height:28px;border-radius:7px;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
      </div>
      <div style="flex:1;font-size:var(--fs-sm);color:var(--text);line-height:1.5">
        ${html}
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
        <label style="display:flex;align-items:center;gap:4px;font-size:var(--fs-xs);color:var(--muted);cursor:pointer;user-select:none;white-space:nowrap">
          <input type="checkbox" id="${id}-dsa" onchange="_guideToggleDsa('${storageKey}',this.checked)"> Don't show again
        </label>
        <button onclick="_dismissGuide('${id}','${storageKey}')" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;line-height:1;padding:0;flex-shrink:0" title="Dismiss">&times;</button>
      </div>
    </div>`;
}

function _guideToggleDsa(storageKey, checked) {
  try { if (checked) localStorage.setItem(storageKey, '1'); else localStorage.removeItem(storageKey); } catch(e) { console.warn('ls:', e.message); }
}

// Reset all guide dismissals (called when loading demo data)
function resetAllGuides() {
  _GUIDE_DEFS.forEach(function(g) {
    try { localStorage.removeItem(g.key); } catch(e) {}
  });
  _updateAllGuideBadges();
}

function _dismissGuide(id, storageKey) {
  // If "Don't show again" is checked, persist to localStorage; hide badge permanently
  const cb = document.getElementById(id + '-dsa');
  if (cb && cb.checked) {
    try { localStorage.setItem(storageKey, '1'); } catch(e) { console.warn('ls:', e.message); }
  }
  // Always hide the guide banner
  const w = document.getElementById(id); if (w) w.style.display = 'none';
  // Always hide the nav badge when dismissed (whether permanent or not)
  const badge = document.getElementById(id + '-badge');
  if (badge) badge.style.display = 'none';
}

// ─── GUIDE CONTENT PER PAGE ─────────────────────────────────

// ─── GUIDE MODAL POPUP ──────────────────────────────────────
const _GUIDE_CONTENT = {
  alerts:
    '<strong>Your early-warning system.</strong> Alerts auto-detect health drops, renewal windows, support spikes, engagement dips, sentiment changes, expansion signals, and more — 20+ alert types in total.<br><br>' +
    '<strong>Switch views:</strong> Use the <strong>Briefing</strong> view for a prioritized summary by severity, or switch to <strong>Category</strong>, <strong>Priority</strong>, <strong>Customer</strong>, or <strong>Table</strong> view to slice alerts the way you need.<br><br>' +
    '<strong>Take action:</strong> Click any alert to open the customer detail. Select multiple alerts with <strong>Shift-click</strong> to bulk snooze, dismiss, tag, or change lifecycle stage.<br><br>' +
    '<strong>Tip:</strong> Control which alerts fire and where they\'re routed (Slack, Teams, email) in Automations.',
  customers:
    '<strong>Your full customer portfolio</strong> with health scores, MRR, signals, and lifecycle stage. Click any row to open the detail view where you can edit signals, view score history, manage touches, and add notes.<br><br>' +
    '<strong>Sort &amp; filter:</strong> Click any column header to sort. Use the <strong>Manager</strong> and <strong>Lifecycle</strong> dropdowns to narrow by CSM or stage. Use the search bar to find customers by name.<br><br>' +
    '<strong>Bulk actions:</strong> <strong>Shift-click</strong> to select multiple rows, then apply bulk tag, lifecycle change, or delete.<br><br>' +
    '<strong>Tip:</strong> Every column — score, MRR, delta, renewal, tickets, NPS — is sortable, so you can quickly find your most at-risk or highest-value accounts.',
  segments:
    '<strong>Compare customer groups side-by-side.</strong> Switch between <strong>Segments</strong> (by tag), <strong>Tiers</strong> (SMB / Mid / Enterprise), and <strong>Lifecycle</strong> views to analyze health, MRR, risk, and trends across cohorts.<br><br>' +
    '<strong>KPI cards</strong> at the top show total segments, accounts, MRR, your highest-risk segment, and your fastest-growing segment.<br><br>' +
    '<strong>Trend chart:</strong> Select segments to overlay on the health trend chart — toggle 7d, 30d, 90d, 6m, 1y, 2y, or YTD ranges. Click any row to drill into that segment\'s customers.<br><br>' +
    '<strong>Tip:</strong> Segments are built from tags — add tags in the Score form or detail view and they\'ll automatically appear here.',
  trends:
    '<strong>Track how your portfolio is changing over time.</strong> The chart shows your overall trend line, and you can overlay a <strong>CSM\'s book</strong> or <strong>individual customers</strong> for comparison.<br><br>' +
    '<strong>Metrics:</strong> Switch between Health Score, Logins, Adoption, Tickets, NPS, CSAT, MRR, ARR, and more. Add a second metric for dual-axis analysis.<br><br>' +
    '<strong>Score Movers table</strong> below the chart lists every customer with their current score, 7-day change, status, and signals — fully sortable and filterable.<br><br>' +
    '<strong>Tip:</strong> Use the range bar (3d → 2y / YTD) to zoom in on recent changes or see the long-term picture.',
  forecast:
    '<strong>See where your revenue is heading.</strong> The forecast classifies every account as Expand, Retain, Contract, or Churn based on health scores and signal trajectories.<br><br>' +
    '<strong>NRR Waterfall</strong> shows the flow from current MRR through expansion, contraction, and churn to projected MRR.<br><br>' +
    '<strong>Tabs:</strong> Switch between All Customers, By CSM, By Tier, or By Renewal to see breakdowns from different angles.<br><br>' +
    '<strong>Tip:</strong> Adjust expansion estimates in Settings > Scoring under Expansion Estimate.',
  csmperf:
    '<strong>Evaluate each CSM\'s book of business.</strong> The leaderboard ranks managers by performance index, health score, MRR managed, at-risk exposure, contact cadence, and upcoming renewals.<br><br>' +
    '<strong>Click a CSM name</strong> to jump to Customers filtered to their accounts. Click <strong>Expand</strong> to see their per-account breakdown inline.<br><br>' +
    '<strong>Below the leaderboard:</strong> Workload Balance, Focus Areas, Score Movement, and Activity sections give you the full picture.<br><br>' +
    '<strong>Tip:</strong> Use this for 1:1s, resource rebalancing, and identifying coaching opportunities.',
  calendar:
    '<strong>See all upcoming renewals, scheduled touches, completed calls, and overdue contacts on one calendar.</strong> The Today\'s Schedule banner shows what needs attention right now.<br><br>' +
    '<strong>Click any day</strong> to see its events, log a sentiment, mark a call completed or missed, or schedule a new touch directly.<br><br>' +
    '<strong>Filter by customer</strong> using the dropdown to focus on one account\'s timeline.<br><br>' +
    '<strong>Tip:</strong> Set the Next Scheduled Touch date in any customer\'s score form and it appears here automatically.',
  reports:
    '<strong>Generate ready-to-share reports</strong> for leadership, board meetings, and your own analysis. Choose a template, then print, save as PDF, export CSV, or email directly.<br><br>' +
    '<strong>Templates:</strong> Portfolio Health Summary, Weekly Review, Trend Report, At-Risk Report, Churn Risk, Renewal Forecast, Segment Analysis, CSM Performance, and more.<br><br>' +
    '<strong>Email delivery:</strong> Send any report to stakeholders as a one-time email.<br><br>' +
    '<strong>Tip:</strong> The Weekly Review includes charts and narrative — ideal for recurring leadership updates.',
  score:
    '<strong>Add a new customer or re-score an existing one.</strong> Fill in account details and health signals, then click Calculate Health Score to see the result with a full signal breakdown and recommended playbook.<br><br>' +
    '<strong>Signals:</strong> Enter logins, adoption %, open tickets, NPS, CSAT, days since contact, and growth signal. Check N/A next to any signal you don\'t track — its weight redistributes automatically.<br><br>' +
    '<strong>Scoring profiles:</strong> Assign a profile to apply custom weights per customer or segment.<br><br>' +
    '<strong>Tip:</strong> Bulk-import via CSV Import if you have many accounts to add.',
  csv:
    '<strong>Import customers from a CSV file</strong> or sync from your CRM. Map your columns to IQcadence fields, preview the data, then import.<br><br>' +
    '<strong>Column mapping:</strong> The importer auto-detects common column names. For custom headers, use the dropdown to map each column.<br><br>' +
    '<strong>CRM sync:</strong> Connect HubSpot or Salesforce in Settings > Integrations for automatic bidirectional sync.',
  automations:
    '<strong>Route alerts to Slack, Microsoft Teams, or email</strong> so your team never misses a critical change. Toggle built-in rules on/off, or create custom rules with flexible if/then logic.<br><br>' +
    '<strong>Built-in triggers:</strong> Health drops, churn risk, renewal approaching, NPS change, support spikes, rapid score decline, and more.<br><br>' +
    '<strong>Custom rules:</strong> Define any condition combination and route notifications to the right channel using the 3-step wizard.<br><br>' +
    '<strong>Tip:</strong> Connect your channels in the Advanced tab first (Slack webhook, Teams workflow, or email via Resend).',
  auditlog:
    '<strong>A complete record of everything that\'s happened in your account.</strong> Use it for accountability, debugging, and compliance.<br><br>' +
    '<strong>Activity Log:</strong> Every customer-facing change — score updates, stage transitions, edits, and bulk re-scores — is logged with who made the change and when.<br><br>' +
    '<strong>Config History:</strong> All settings changes — weight adjustments, threshold edits, profile updates, CSM changes.<br><br>' +
    '<strong>Tip:</strong> Use the search bar and action filter to quickly find specific changes.',
  users:
    '<strong>Manage who has access to your IQcadence account.</strong> Add team members so they can view customers, track health scores, and take action on alerts.<br><br>' +
    '<strong>Create a user:</strong> Click + Create User. They\'ll share the same customer data, settings, and scoring profiles.<br><br>' +
    '<strong>Remove a user:</strong> Click delete on their row. Their data stays — only their login access is revoked.',
  settings:
    '<strong>Configure your health scoring engine.</strong> Adjust signal weights, set alert thresholds, create scoring profiles, and manage your account.<br><br>' +
    '<strong>Scoring:</strong> Set signal weights, status thresholds, scoring profiles, and expansion estimate settings.<br><br>' +
    '<strong>Account:</strong> Manage your password, CSM list, data health, and backups.<br><br>' +
    '<strong>Integrations:</strong> Connect HubSpot, Salesforce, and Stripe for automatic data sync. AI features are included with your plan.<br><br>' +
    '<strong>Plan & Billing:</strong> View your subscription, plan tier, usage limits, and manage billing.',
};

const _GUIDE_TITLES = {
  alerts: 'Alerts', customers: 'Customers', segments: 'Segments', trends: 'Trends',
  forecast: 'Forecast', csmperf: 'CSM Performance', calendar: 'Calendar', reports: 'Reports',
  score: 'Score a Customer', csv: 'CSV Import', automations: 'Automations', auditlog: 'Audit Log',
  users: 'Users', settings: 'Settings'
};

function openGuideModal(page) {
  var content = _GUIDE_CONTENT[page];
  if (!content) return;
  var title = _GUIDE_TITLES[page] || page;
  // Reuse or create guide modal
  var m = document.getElementById('guide-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'guide-modal';
    m.className = 'modal-backdrop';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:10000;align-items:center;justify-content:center;background:rgba(15,23,42,.5);backdrop-filter:blur(3px);padding:16px';
    m.addEventListener('click', function(e) { if (e.target === m) m.style.display = 'none'; });
    document.body.appendChild(m);
  }
  m.innerHTML = '<div class="modal" style="max-width:560px;max-height:80vh;overflow-y:auto">' +
    '<div class="modal-hd" style="gap:10px">' +
    '<div style="display:flex;align-items:center;gap:10px">' +
    '<div style="width:32px;height:32px;border-radius:8px;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>' +
    '</div>' +
    '<h2 style="margin:0;font-size:1rem">' + escHtml(title) + ' Guide</h2>' +
    '</div>' +
    '<button style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:20px;line-height:1;padding:4px" onclick="document.getElementById(\'guide-modal\').style.display=\'none\'">&times;</button></div>' +
    '<div class="modal-bd" style="font-size:var(--fs-sm);line-height:1.7;color:var(--text)">' + content + '</div></div>';
  m.style.display = 'flex';
}

function renderAlertsGuide() {
  _renderGuide('alerts-guide', 'iqc_alerts_guide_dismissed',
    '<strong>What you can do here</strong>  - Your early-warning system. Alerts auto-detect health drops, renewal windows, support spikes, engagement dips, sentiment changes, expansion signals, and more  - 20+ alert types in total.<br>' +
    '<strong>Switch views:</strong> Use the <strong>Briefing</strong> view for a prioritized summary by severity, or switch to <strong>Category</strong>, <strong>Priority</strong>, <strong>Customer</strong>, or <strong>Table</strong> view to slice alerts the way you need.<br>' +
    '<strong>Take action:</strong> Click any alert to open the customer detail. Select multiple alerts with <strong>Shift-click</strong> to bulk snooze, dismiss, tag, or change lifecycle stage.<br>' +
    '<strong>Tip:</strong> Control which alerts fire and where they\'re routed (Slack, Teams, email) in <a href="#" onclick="event.stopPropagation();nav(\'automations\')" style="color:var(--teal);font-weight:600">Automations</a>.');
}

function renderCustomersGuide() {
  _renderGuide('customers-guide', 'iqc_customers_guide_dismissed',
    '<strong>What you can do here</strong>  - Your full customer portfolio with health scores, MRR, signals, and lifecycle stage. Click any row to open the detail view where you can edit signals, view score history, manage touches, and add notes.<br>' +
    '<strong>Sort &amp; filter:</strong> Click any column header to sort. Use the <strong>Manager</strong> and <strong>Lifecycle</strong> dropdowns to narrow by CSM or stage. Use the search bar to find customers by name.<br>' +
    '<strong>Bulk actions:</strong> <strong>Shift-click</strong> to select multiple rows, then apply bulk tag, lifecycle change, or delete.<br>' +
    '<strong>Tip:</strong> Every column  - score, MRR, delta, renewal, tickets, NPS  - is sortable, so you can quickly find your most at-risk or highest-value accounts.');
}

function renderSegmentsGuide() {
  _renderGuide('segments-guide', 'iqc_segments_guide_dismissed',
    '<strong>What you can do here</strong>  - Compare customer groups side-by-side. Switch between <strong>Segments</strong> (by tag), <strong>Tiers</strong> (SMB / Mid / Enterprise), and <strong>Lifecycle</strong> views to analyze health, MRR, risk, and trends across cohorts.<br>' +
    '<strong>KPI cards</strong> at the top show total segments, accounts, MRR, your highest-risk segment, and your fastest-growing segment at a glance.<br>' +
    '<strong>Trend chart:</strong> Select segments to overlay on the health trend chart  - toggle 7d, 30d, 90d, 6m, 1y, 2y, or YTD ranges. Click any row to drill into that segment\'s customers.<br>' +
    '<strong>Tip:</strong> Segments are built from tags  - add tags in the Score form or detail view and they\'ll automatically appear here. Great for QBRs and board decks.');
}

function renderTrendsGuide() {
  _renderGuide('trends-guide', 'iqc_trends_guide_dismissed',
    '<strong>What you can do here</strong>  - Track how your portfolio is changing over time. The chart shows your overall trend line, and you can overlay a <strong>CSM\'s book</strong> or <strong>individual customers</strong> for comparison.<br>' +
    '<strong>Metrics:</strong> Switch between Health Score, Logins, Adoption, Tickets, NPS, CSAT, MRR, ARR, and more. Add a second metric for dual-axis analysis.<br>' +
    '<strong>Score Movers table</strong> below the chart lists every customer with their current score, 7-day change, status, and signals  - fully sortable and filterable so you can spot who\'s moving and why.<br>' +
    '<strong>Tip:</strong> Use the range bar (3d → 2y / YTD) to zoom in on recent changes or see the long-term picture. The prior-period comparison line shows whether things are improving.');
}

function renderForecastGuide() {
  _renderGuide('forecast-guide', 'iqc_forecast_guide_dismissed',
    '<strong>What you can do here</strong> - See where your revenue is heading. The forecast classifies every account as Expand, Retain, Contract, or Churn based on health scores and signal trajectories.<br>' +
    '<strong>NRR Waterfall</strong> shows the flow from current MRR through expansion, contraction, and churn to projected MRR.<br>' +
    '<strong>Tabs:</strong> Switch between All Customers, By CSM, By Tier, or By Renewal to see breakdowns from different angles.<br>' +
    '<strong>Tip:</strong> Adjust expansion estimates in Settings > Scoring under Expansion Estimate.');
}

function renderCsmperfGuide() {
  _renderGuide('csmperf-guide', 'iqc_csmperf_guide_dismissed',
    '<strong>What you can do here</strong>  - Evaluate each CSM\'s book of business. The leaderboard ranks managers by performance index, health score, MRR managed, at-risk exposure, contact cadence, and upcoming renewals.<br>' +
    '<strong>Click a CSM name</strong> to jump to Customers filtered to their accounts. Click <strong>Expand</strong> to see their per-account breakdown inline.<br>' +
    '<strong>Below the leaderboard:</strong> <strong>Workload Balance</strong> shows account and MRR distribution by tier. <strong>Focus Areas</strong> flags who needs attention. <strong>Score Movement</strong> tracks which CSMs are improving or declining. <strong>Activity</strong> shows contact recency.<br>' +
    '<strong>Tip:</strong> Use this for 1:1s, resource rebalancing, and identifying coaching opportunities. Everything is sortable by clicking column headers.');
}

function renderCalendarGuide() {
  _renderGuide('calendar-guide', 'iqc_calendar_guide_dismissed',
    '<strong>What you can do here</strong>  - See all upcoming renewals, scheduled touches, completed calls, and overdue contacts on one calendar. The <strong>Today\'s Schedule</strong> banner shows what needs attention right now.<br>' +
    '<strong>Click any day</strong> to see its events, log a sentiment (positive / neutral / negative), mark a call completed or missed, or schedule a new touch directly.<br>' +
    '<strong>Filter by customer</strong> using the dropdown to focus on one account\'s timeline. The context bar shows their last call, next scheduled touch, and renewal date.<br>' +
    '<strong>Tip:</strong> Set the <strong>Next Scheduled Touch</strong> date in any customer\'s score form and it appears here automatically. Renewal dates are pulled from the customer record.');
}

function renderReportsGuide() {
  _renderGuide('reports-guide', 'iqc_reports_guide_dismissed',
    '<strong>What you can do here</strong>  - Generate ready-to-share reports for leadership, board meetings, and your own analysis. Choose a template, then print, save as PDF, export CSV, or email directly.<br>' +
    '<strong>Templates:</strong> Portfolio Health Summary, Weekly Review, Trend Report, At-Risk Report, Churn Risk, Renewal Forecast, Segment Analysis, CSM Performance, and full Customer Health Export.<br>' +
    '<strong>Email delivery:</strong> Send any report to stakeholders as a one-time email  - great for weekly updates or ad-hoc reviews.<br>' +
    '<strong>Tip:</strong> The Weekly Review includes charts and narrative, making it ideal for recurring leadership updates. Score History Export gives you the raw data for your own analysis.');
}

function renderScoreGuide() {
  _renderGuide('score-guide', 'iqc_score_guide_dismissed',
    '<strong>What you can do here</strong>  - Add a new customer or re-score an existing one. Fill in account details and health signals, then click <strong>Calculate Health Score</strong> to see the result with a full signal breakdown and recommended playbook.<br>' +
    '<strong>Signals:</strong> Enter logins, adoption %, open tickets, NPS, CSAT, days since contact, and growth signal. Check <strong>N/A</strong> next to any signal you don\'t track  - its weight redistributes automatically.<br>' +
    '<strong>After scoring:</strong> You\'ll see a health assessment, color-coded signal bars, and an action playbook (Urgent, Engage, Coach, Adopt, Support, Expand, Renew) tailored to that customer\'s signals.<br>' +
    '<strong>Tip:</strong> Assign a <strong>Scoring Profile</strong> to apply custom weights per customer or segment. Bulk-import via <a href="#" onclick="event.stopPropagation();nav(\'csv\')" style="color:var(--teal);font-weight:600">CSV Import</a> if you have many accounts to add.');
}

function renderUsersGuide() {
  _renderGuide('users-guide', 'iqc_users_guide_dismissed',
    '<strong>What you can do here</strong>  - Manage who has access to your IQcadence account. Add team members so they can view customers, track health scores, and take action on alerts.<br>' +
    '<strong>Create a user:</strong> Click <strong>+ Create User</strong> above. They\'ll receive a login and share the same customer data, settings, and scoring profiles as your organization.<br>' +
    '<strong>Remove a user:</strong> Click the delete button on their row. Their data stays  - only their login access is revoked.<br>' +
    '<strong>Tip:</strong> Each user sees the same portfolio, so changes made by one team member (scoring, notes, stage changes) are visible to everyone.');
}

function renderAuditlogGuide() {
  _renderGuide('auditlog-guide', 'iqc_auditlog_guide_dismissed',
    '<strong>What you can do here</strong>  - The Audit Log gives you a complete record of everything that\'s happened in your account. Use it for accountability, debugging, and compliance.<br>' +
    '<strong>Activity Log:</strong> Every customer-facing change  - score updates, stage transitions, edits, and bulk re-scores  - is logged here with who made the change and when.<br>' +
    '<strong>Config History:</strong> All settings changes  - weight adjustments, threshold edits, profile updates, CSM changes  - so you can see exactly what was configured and when.<br>' +
    '<strong>Tip:</strong> Use the search bar and action filter to quickly find specific changes. You can also export the full log as CSV.');
}

function renderAutomationsGuide() {
  _renderGuide('automations-guide', 'iqc_automations_guide_dismissed',
    '<strong>What you can do here</strong>  - Route alerts to <strong>Slack</strong>, <strong>Microsoft Teams</strong>, or <strong>email</strong> so your team never misses a critical change. Toggle built-in rules on/off, or create custom rules with flexible if/then logic.<br>' +
    '<strong>Built-in triggers:</strong> Health drops, churn risk, renewal approaching, NPS change, support spikes, rapid score decline, and more  - each configurable with its own threshold and delivery channel.<br>' +
    '<strong>Custom rules:</strong> Define any condition combination and route notifications to the right channel. Use the 3-step wizard: choose trigger → set conditions → pick delivery.<br>' +
    '<strong>Tip:</strong> Connect your channels in the <strong>Advanced</strong> tab first (Slack webhook, Teams workflow, or email via Resend), then build rules that reference them.');
}

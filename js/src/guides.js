// ─── PAGE GUIDE BANNERS ─────────────────────────────────────
// Shared helper for rendering dismissable guide banners on every page.

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
  } catch(e) {}
})();

// Only settings guide badge is shown; all others are disabled
const _ACTIVE_GUIDES = new Set(['settings-guide']);

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
  try { if (localStorage.getItem(storageKey) === '1') { wrap.style.display = 'none'; return; } } catch(e) {}
  wrap.style.display = '';
  wrap.innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-start;padding:12px 14px;background:color-mix(in srgb, var(--teal) 8%, var(--surface));border:1px solid color-mix(in srgb, var(--teal) 25%, var(--border));border-radius:var(--r);margin-bottom:14px">
      <div style="width:22px;height:22px;border-radius:50%;background:var(--teal);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:var(--fs-xs);flex-shrink:0">1</div>
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
  try { if (checked) localStorage.setItem(storageKey, '1'); else localStorage.removeItem(storageKey); } catch(e) {}
}

function _dismissGuide(id, storageKey) {
  // If "Don't show again" is checked, persist to localStorage; hide badge permanently
  const cb = document.getElementById(id + '-dsa');
  if (cb && cb.checked) {
    try { localStorage.setItem(storageKey, '1'); } catch(e) {}
  }
  // Always hide the guide banner
  const w = document.getElementById(id); if (w) w.style.display = 'none';
  // Always hide the nav badge when dismissed (whether permanent or not)
  const badge = document.getElementById(id + '-badge');
  if (badge) badge.style.display = 'none';
}

// ─── GUIDE CONTENT PER PAGE ─────────────────────────────────

function renderAlertsGuide() {
  return; // Guide banners removed except Settings
  _renderGuide('alerts-guide', 'iqc_alerts_guide_dismissed',
    '<strong>What you can do here</strong>  - Your early-warning system. Alerts auto-detect health drops, renewal windows, support spikes, engagement dips, sentiment changes, expansion signals, and more  - 20+ alert types in total.<br>' +
    '<strong>Switch views:</strong> Use the <strong>Briefing</strong> view for a prioritized summary by severity, or switch to <strong>Category</strong>, <strong>Priority</strong>, <strong>Customer</strong>, or <strong>Table</strong> view to slice alerts the way you need.<br>' +
    '<strong>Take action:</strong> Click any alert to open the customer detail. Select multiple alerts with <strong>Shift-click</strong> to bulk snooze, dismiss, tag, or change lifecycle stage.<br>' +
    '<strong>Tip:</strong> Control which alerts fire and where they\'re routed (Slack, Teams, email) in <a href="#" onclick="event.stopPropagation();nav(\'automations\')" style="color:var(--teal);font-weight:600">Automations</a>.');
}

function renderCustomersGuide() {
  return;
  _renderGuide('customers-guide', 'iqc_customers_guide_dismissed',
    '<strong>What you can do here</strong>  - Your full customer portfolio with health scores, MRR, signals, and lifecycle stage. Click any row to open the detail view where you can edit signals, view score history, manage touches, and add notes.<br>' +
    '<strong>Sort &amp; filter:</strong> Click any column header to sort. Use the <strong>Manager</strong> and <strong>Lifecycle</strong> dropdowns to narrow by CSM or stage. Use the search bar to find customers by name.<br>' +
    '<strong>Bulk actions:</strong> <strong>Shift-click</strong> to select multiple rows, then apply bulk tag, lifecycle change, or delete.<br>' +
    '<strong>Tip:</strong> Every column  - score, MRR, delta, renewal, tickets, NPS  - is sortable, so you can quickly find your most at-risk or highest-value accounts.');
}

function renderSegmentsGuide() {
  return;
  _renderGuide('segments-guide', 'iqc_segments_guide_dismissed',
    '<strong>What you can do here</strong>  - Compare customer groups side-by-side. Switch between <strong>Segments</strong> (by tag), <strong>Tiers</strong> (SMB / Mid / Enterprise), and <strong>Lifecycle</strong> views to analyze health, MRR, risk, and trends across cohorts.<br>' +
    '<strong>KPI cards</strong> at the top show total segments, accounts, MRR, your highest-risk segment, and your fastest-growing segment at a glance.<br>' +
    '<strong>Trend chart:</strong> Select segments to overlay on the health trend chart  - toggle 7d, 30d, 90d, 6m, 1y, 2y, or YTD ranges. Click any row to drill into that segment\'s customers.<br>' +
    '<strong>Tip:</strong> Segments are built from tags  - add tags in the Score form or detail view and they\'ll automatically appear here. Great for QBRs and board decks.');
}

function renderTrendsGuide() {
  return;
  _renderGuide('trends-guide', 'iqc_trends_guide_dismissed',
    '<strong>What you can do here</strong>  - Track how your portfolio is changing over time. The chart shows your overall trend line, and you can overlay a <strong>CSM\'s book</strong> or <strong>individual customers</strong> for comparison.<br>' +
    '<strong>Metrics:</strong> Switch between Health Score, Logins, Adoption, Tickets, NPS, CSAT, MRR, ARR, and more. Add a second metric for dual-axis analysis.<br>' +
    '<strong>Score Movers table</strong> below the chart lists every customer with their current score, 7-day change, status, and signals  - fully sortable and filterable so you can spot who\'s moving and why.<br>' +
    '<strong>Tip:</strong> Use the range bar (3d → 2y / YTD) to zoom in on recent changes or see the long-term picture. The prior-period comparison line shows whether things are improving.');
}

function renderCsmperfGuide() {
  return;
  _renderGuide('csmperf-guide', 'iqc_csmperf_guide_dismissed',
    '<strong>What you can do here</strong>  - Evaluate each CSM\'s book of business. The leaderboard ranks managers by performance index, health score, MRR managed, at-risk exposure, contact cadence, and upcoming renewals.<br>' +
    '<strong>Click a CSM name</strong> to jump to Customers filtered to their accounts. Click <strong>Expand</strong> to see their per-account breakdown inline.<br>' +
    '<strong>Below the leaderboard:</strong> <strong>Workload Balance</strong> shows account and MRR distribution by tier. <strong>Focus Areas</strong> flags who needs attention. <strong>Score Movement</strong> tracks which CSMs are improving or declining. <strong>Activity</strong> shows contact recency.<br>' +
    '<strong>Tip:</strong> Use this for 1:1s, resource rebalancing, and identifying coaching opportunities. Everything is sortable by clicking column headers.');
}

function renderCalendarGuide() {
  return;
  _renderGuide('calendar-guide', 'iqc_calendar_guide_dismissed',
    '<strong>What you can do here</strong>  - See all upcoming renewals, scheduled touches, completed calls, and overdue contacts on one calendar. The <strong>Today\'s Schedule</strong> banner shows what needs attention right now.<br>' +
    '<strong>Click any day</strong> to see its events, log a sentiment (positive / neutral / negative), mark a call completed or missed, or schedule a new touch directly.<br>' +
    '<strong>Filter by customer</strong> using the dropdown to focus on one account\'s timeline. The context bar shows their last call, next scheduled touch, and renewal date.<br>' +
    '<strong>Tip:</strong> Set the <strong>Next Scheduled Touch</strong> date in any customer\'s score form and it appears here automatically. Renewal dates are pulled from the customer record.');
}

function renderReportsGuide() {
  return;
  _renderGuide('reports-guide', 'iqc_reports_guide_dismissed',
    '<strong>What you can do here</strong>  - Generate ready-to-share reports for leadership, board meetings, and your own analysis. Choose a template, then print, save as PDF, export CSV, or email directly.<br>' +
    '<strong>Templates:</strong> Portfolio Health Summary, Weekly Review, Trend Report, At-Risk Report, Churn Risk, Renewal Forecast, Segment Analysis, CSM Performance, and full Customer Health Export.<br>' +
    '<strong>Email delivery:</strong> Send any report to stakeholders as a one-time email  - great for weekly updates or ad-hoc reviews.<br>' +
    '<strong>Tip:</strong> The Weekly Review includes charts and narrative, making it ideal for recurring leadership updates. Score History Export gives you the raw data for your own analysis.');
}

function renderScoreGuide() {
  return;
  _renderGuide('score-guide', 'iqc_score_guide_dismissed',
    '<strong>What you can do here</strong>  - Add a new customer or re-score an existing one. Fill in account details and health signals, then click <strong>Calculate Health Score</strong> to see the result with a full signal breakdown and recommended playbook.<br>' +
    '<strong>Signals:</strong> Enter logins, adoption %, open tickets, NPS, CSAT, days since contact, and growth signal. Check <strong>N/A</strong> next to any signal you don\'t track  - its weight redistributes automatically.<br>' +
    '<strong>After scoring:</strong> You\'ll see a health assessment, color-coded signal bars, and an action playbook (Urgent, Engage, Coach, Adopt, Support, Expand, Renew) tailored to that customer\'s signals.<br>' +
    '<strong>Tip:</strong> Assign a <strong>Scoring Profile</strong> to apply custom weights per customer or segment. Bulk-import via <a href="#" onclick="event.stopPropagation();nav(\'csv\')" style="color:var(--teal);font-weight:600">CSV Import</a> if you have many accounts to add.');
}

function renderUsersGuide() {
  return;
  _renderGuide('users-guide', 'iqc_users_guide_dismissed',
    '<strong>What you can do here</strong>  - Manage who has access to your IQcadence account. Add team members so they can view customers, track health scores, and take action on alerts.<br>' +
    '<strong>Create a user:</strong> Click <strong>+ Create User</strong> above. They\'ll receive a login and share the same customer data, settings, and scoring profiles as your organization.<br>' +
    '<strong>Remove a user:</strong> Click the delete button on their row. Their data stays  - only their login access is revoked.<br>' +
    '<strong>Tip:</strong> Each user sees the same portfolio, so changes made by one team member (scoring, notes, stage changes) are visible to everyone.');
}

function renderAuditlogGuide() {
  return;
  _renderGuide('auditlog-guide', 'iqc_auditlog_guide_dismissed',
    '<strong>What you can do here</strong>  - The Audit Log gives you a complete record of everything that\'s happened in your account. Use it for accountability, debugging, and compliance.<br>' +
    '<strong>Activity Log:</strong> Every customer-facing change  - score updates, stage transitions, edits, and bulk re-scores  - is logged here with who made the change and when.<br>' +
    '<strong>Config History:</strong> All settings changes  - weight adjustments, threshold edits, profile updates, CSM changes  - so you can see exactly what was configured and when.<br>' +
    '<strong>Tip:</strong> Use the search bar and action filter to quickly find specific changes. You can also export the full log as CSV.');
}

function renderAutomationsGuide() {
  return;
  _renderGuide('automations-guide', 'iqc_automations_guide_dismissed',
    '<strong>What you can do here</strong>  - Route alerts to <strong>Slack</strong>, <strong>Microsoft Teams</strong>, or <strong>email</strong> so your team never misses a critical change. Toggle built-in rules on/off, or create custom rules with flexible if/then logic.<br>' +
    '<strong>Built-in triggers:</strong> Health drops, churn risk, renewal approaching, NPS change, support spikes, rapid score decline, and more  - each configurable with its own threshold and delivery channel.<br>' +
    '<strong>Custom rules:</strong> Define any condition combination and route notifications to the right channel. Use the 3-step wizard: choose trigger → set conditions → pick delivery.<br>' +
    '<strong>Tip:</strong> Connect your channels in the <strong>Advanced</strong> tab first (Slack webhook, Teams workflow, or email via Resend), then build rules that reference them.');
}

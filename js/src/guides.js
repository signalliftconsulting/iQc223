// ─── PAGE GUIDE BANNERS ─────────────────────────────────────
// Shared helper for rendering dismissable guide banners on every page.

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
  // If "Don't show again" is checked, persist; otherwise just hide for this session
  const cb = document.getElementById(id + '-dsa');
  if (cb && cb.checked) { try { localStorage.setItem(storageKey, '1'); } catch(e) {} }
  const w = document.getElementById(id); if (w) w.style.display = 'none';
}

// ─── GUIDE CONTENT PER PAGE ─────────────────────────────────

function renderAlertsGuide() {
  _renderGuide('alerts-guide', 'iqc_alerts_guide_dismissed',
    '<strong>What you can do here</strong> — This is your early-warning system. Alerts automatically flag customers when something changes — a score drops, a renewal is approaching, or a risk signal fires.<br>' +
    '<strong>Click any alert card</strong> to open the customer\'s full detail view and take action.<br>' +
    '<strong>Scroll down</strong> to the <strong>Alert Feed</strong> for a filterable history of all alerts — you can snooze alerts you\'re already handling or dismiss ones that aren\'t relevant.<br>' +
    '<strong>Tip:</strong> Configure which alerts fire and where they\'re sent (Slack, Teams, email) in <a href="#" onclick="event.stopPropagation();nav(\'automations\')" style="color:var(--teal);font-weight:600">Automations</a>.');
}

function renderCustomersGuide() {
  _renderGuide('customers-guide', 'iqc_customers_guide_dismissed',
    '<strong>What you can do here</strong> — This is your full customer portfolio. Click any row to open that customer\'s detail view where you can edit signals, view history, and add notes.<br>' +
    '<strong>Sort &amp; filter:</strong> Click any column header to sort. Click the small funnel icon next to a column name to filter by specific values. Use the <strong>health band chips</strong> above to quickly isolate Critical, At Risk, or Watch accounts.<br>' +
    '<strong>Bulk actions:</strong> <strong>Shift-click</strong> multiple rows to select them, then use bulk actions like stage change or export.<br>' +
    '<strong>Tip:</strong> The first two columns (name &amp; score) stay frozen when you scroll right, so you never lose context. You can also save filter combinations as <strong>Presets</strong> for quick access.');
}

function renderSegmentsGuide() {
  _renderGuide('segments-guide', 'iqc_segments_guide_dismissed',
    '<strong>What you can do here</strong> — Segments let you compare groups of customers side-by-side. Each segment is based on a <strong>tag</strong> you assign to customers (e.g. "Enterprise", "APAC", "Q1 Cohort").<br>' +
    '<strong>How to create segments:</strong> Add tags to customers in the Score form or detail view — they\'ll automatically appear here as segment cards.<br>' +
    '<strong>Each card shows:</strong> health distribution, average score, total MRR, and customer count so you can spot which cohorts are healthy and which need attention.<br>' +
    '<strong>Tip:</strong> Use the date range selector to see how segment health has changed over time — great for QBRs and board decks.');
}

function renderTrendsGuide() {
  _renderGuide('trends-guide', 'iqc_trends_guide_dismissed',
    '<strong>What you can do here</strong> — Trends shows how your portfolio health is changing over time. Use this to spot patterns, measure the impact of your CS efforts, and prepare for leadership reviews.<br>' +
    '<strong>Range bar:</strong> Switch between 3d, 7d, 14d, 30d, and 90d views to zoom in on recent changes or see the bigger picture.<br>' +
    '<strong>Filter by manager:</strong> Use the CSM dropdown to isolate a specific manager\'s book and track their portfolio trend independently.<br>' +
    '<strong>Tip:</strong> The KPI cards at the top give you a quick snapshot — overall health score, MRR at risk, and trend direction.');
}

function renderCsmperfGuide() {
  _renderGuide('csmperf-guide', 'iqc_csmperf_guide_dismissed',
    '<strong>What you can do here</strong> — Compare how each Customer Success Manager is performing across their book of business. Use this for 1:1s, resource planning, and identifying coaching opportunities.<br>' +
    '<strong>Each CSM row shows:</strong> number of accounts, average health score, at-risk MRR, and whether they\'re meeting contact cadence targets.<br>' +
    '<strong>Click any CSM</strong> to expand and see their individual customer breakdown with per-account health scores.<br>' +
    '<strong>Tip:</strong> Set contact cadence targets in <a href="#" onclick="event.stopPropagation();nav(\'settings\')" style="color:var(--teal);font-weight:600">Settings → Config</a> to track whether CSMs are touching accounts on schedule.');
}

function renderCalendarGuide() {
  _renderGuide('calendar-guide', 'iqc_calendar_guide_dismissed',
    '<strong>What you can do here</strong> — The Calendar gives you a timeline of upcoming renewals, scheduled customer touches, and overdue contacts so nothing slips through the cracks.<br>' +
    '<strong>Color coding:</strong> <strong style="color:var(--red)">Red</strong> = overdue (needs immediate attention), <strong style="color:var(--amber)">Amber</strong> = due soon, <strong style="color:var(--green)">Green</strong> = upcoming and on track.<br>' +
    '<strong>How to schedule:</strong> Set the <strong>Next Scheduled Touch</strong> date in any customer\'s score form — it will automatically appear here.<br>' +
    '<strong>Tip:</strong> Renewal dates are pulled from the customer record. Set renewal windows in <a href="#" onclick="event.stopPropagation();nav(\'settings\')" style="color:var(--teal);font-weight:600">Settings</a> to control when renewal alerts fire (e.g. 30, 60, 90 days out).');
}

function renderReportsGuide() {
  _renderGuide('reports-guide', 'iqc_reports_guide_dismissed',
    '<strong>What you can do here</strong> — Generate polished reports for leadership, board meetings, or your own analysis. Export data or print directly from the browser.<br>' +
    '<strong>Report Templates:</strong> Choose from Executive Summary, Risk Report, Renewal Forecast, and more. Click any template to preview it, then print or save as PDF.<br>' +
    '<strong>Scheduled Reports:</strong> Set up automatic email delivery — daily, weekly, or monthly — so stakeholders get reports without you having to remember.<br>' +
    '<strong>Tip:</strong> Reports use your current filters and date range, so apply the view you want before generating.');
}

function renderScoreGuide() {
  _renderGuide('score-guide', 'iqc_score_guide_dismissed',
    '<strong>What you can do here</strong> — Add a new customer to your portfolio or re-score an existing one. Fill in account details and health signals to calculate a health score.<br>' +
    '<strong>How it works:</strong> Enter signals like login frequency, feature adoption, NPS, and open tickets. Click <strong>Calculate Health Score</strong> to see the result, then <strong>Save</strong> to add them.<br>' +
    '<strong>N/A signals:</strong> Check the N/A box next to any signal you don\'t track — its weight automatically redistributes to the other signals so your score stays accurate.<br>' +
    '<strong>Tip:</strong> If you have an integration connected, many signals (MRR, tickets, NPS) can sync automatically — you only need to enter what isn\'t covered. You can also bulk-import via <a href="#" onclick="event.stopPropagation();nav(\'csv\')" style="color:var(--teal);font-weight:600">CSV Import</a>.');
}

function renderUsersGuide() {
  _renderGuide('users-guide', 'iqc_users_guide_dismissed',
    '<strong>What you can do here</strong> — Manage who has access to your IQcadence account. Add team members so they can view customers, track health scores, and take action on alerts.<br>' +
    '<strong>Create a user:</strong> Click <strong>+ Create User</strong> above. They\'ll receive a login and share the same customer data, settings, and scoring profiles as your organization.<br>' +
    '<strong>Remove a user:</strong> Click the delete button on their row. Their data stays — only their login access is revoked.<br>' +
    '<strong>Tip:</strong> Each user sees the same portfolio, so changes made by one team member (scoring, notes, stage changes) are visible to everyone.');
}

function renderAuditlogGuide() {
  _renderGuide('auditlog-guide', 'iqc_auditlog_guide_dismissed',
    '<strong>What you can do here</strong> — The Audit Log gives you a complete record of everything that\'s happened in your account. Use it for accountability, debugging, and compliance.<br>' +
    '<strong>Activity Log:</strong> Every customer-facing change — score updates, stage transitions, edits, and bulk re-scores — is logged here with who made the change and when.<br>' +
    '<strong>Config History:</strong> All settings changes — weight adjustments, threshold edits, profile updates, CSM changes — so you can see exactly what was configured and when.<br>' +
    '<strong>Tip:</strong> Use the search bar and action filter to quickly find specific changes. You can also export the full log as CSV.');
}

function renderAutomationsGuide() {
  _renderGuide('automations-guide', 'iqc_automations_guide_dismissed',
    '<strong>What you can do here</strong> — Set up automated notifications so you never miss a critical customer change. Alerts can be sent to Slack, Microsoft Teams, or email.<br>' +
    '<strong>Alert Rules:</strong> Pre-built triggers for common scenarios — score drops below threshold, churn risk detected, renewal approaching, NPS change, and more. Toggle them on/off and choose where they\'re sent.<br>' +
    '<strong>Custom Rules:</strong> Build your own rules with flexible if/then logic. Define any condition combination and route notifications to the right channel.<br>' +
    '<strong>Tip:</strong> Start with the built-in Alert Rules — they cover most use cases. You can always add Custom Rules later for more specific workflows. Use the 3-step wizard: choose trigger → set conditions → pick delivery.');
}

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
          <input type="checkbox" onchange="_dismissGuide('${id}','${storageKey}',this.checked)"> Don't show again
        </label>
        <button onclick="_dismissGuide('${id}','${storageKey}',true)" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;line-height:1;padding:0;flex-shrink:0" title="Dismiss">&times;</button>
      </div>
    </div>`;
}

function _dismissGuide(id, storageKey, persist) {
  if (persist) { try { localStorage.setItem(storageKey, '1'); } catch(e) {} }
  const w = document.getElementById(id); if (w) w.style.display = 'none';
}

// ─── GUIDE CONTENT PER PAGE ─────────────────────────────────

function renderAlertsGuide() {
  _renderGuide('alerts-guide', 'iqc_alerts_guide_dismissed',
    '<strong>Quick overview</strong> — Alerts surface customers that need attention based on health score changes, risk signals, and thresholds you configure. ' +
    'Each alert shows the trigger, affected customer, and recommended action. ' +
    'Click any alert to jump to that customer\'s detail view. Switch to the <strong>Alert Feed</strong> tab to filter by type, snooze, or dismiss individual alerts.');
}

function renderCustomersGuide() {
  _renderGuide('customers-guide', 'iqc_customers_guide_dismissed',
    '<strong>Quick overview</strong> — Your full customer portfolio. ' +
    'Click any column header to <strong>sort</strong>, or use the filter icon to narrow by value. ' +
    '<strong>Shift-click</strong> rows to select multiple customers for bulk actions. ' +
    'The first two columns (name & score) stay frozen when scrolling. ' +
    'Use the <strong>filter chips</strong> above the table to quickly view by health band, or search by name.');
}

function renderSegmentsGuide() {
  _renderGuide('segments-guide', 'iqc_segments_guide_dismissed',
    '<strong>Quick overview</strong> — Segments group your customers by tag so you can compare cohorts side-by-side. ' +
    'Each segment card shows health distribution, average score, MRR, and trends. ' +
    'Add tags to customers in the Score form or detail view, then they\'ll appear here automatically. ' +
    'Use the date range selector to see how segments have changed over time.');
}

function renderTrendsGuide() {
  _renderGuide('trends-guide', 'iqc_trends_guide_dismissed',
    '<strong>Quick overview</strong> — Trends tracks your portfolio health over time. ' +
    'The charts show how scores, health bands, and risk signals evolve across your customer base. ' +
    'Use the <strong>range bar</strong> (3d, 7d, 14d, 30d, 90d) to zoom into different time windows. ' +
    'Filter by manager or segment to see specific cohort trends.');
}

function renderCsmperfGuide() {
  _renderGuide('csmperf-guide', 'iqc_csmperf_guide_dismissed',
    '<strong>Quick overview</strong> — CSM Performance ranks your Customer Success Managers by portfolio health, response times, and account outcomes. ' +
    'Each CSM card shows their account count, average health score, at-risk MRR, and contact cadence compliance. ' +
    'Click a CSM row to expand and see their individual customer breakdown.');
}

function renderCalendarGuide() {
  _renderGuide('calendar-guide', 'iqc_calendar_guide_dismissed',
    '<strong>Quick overview</strong> — The Calendar shows upcoming renewals, scheduled customer touches, and overdue contacts in a timeline view. ' +
    'Events are color-coded: <strong style="color:var(--red)">red</strong> for overdue, <strong style="color:var(--amber)">amber</strong> for due soon, <strong style="color:var(--green)">green</strong> for upcoming. ' +
    'Schedule a touch by setting the <strong>Next Scheduled Touch</strong> date in a customer\'s score form.');
}

function renderReportsGuide() {
  _renderGuide('reports-guide', 'iqc_reports_guide_dismissed',
    '<strong>Quick overview</strong> — Generate and export portfolio reports. ' +
    '<strong>Report Templates</strong> include Executive Summary, Risk Report, Renewal Forecast, and more — click any to preview and print. ' +
    '<strong>Scheduled Reports</strong> let you email reports automatically on a daily, weekly, or monthly cadence to your team.');
}

function renderScoreGuide() {
  _renderGuide('score-guide', 'iqc_score_guide_dismissed',
    '<strong>Quick overview</strong> — Add a new customer or re-score an existing one. ' +
    'Fill in account details (name, MRR, tier) and health signals (logins, adoption, NPS, tickets). ' +
    'Click <strong>Calculate Health Score</strong> to see the result, then <strong>Save</strong> to add them to your portfolio. ' +
    'Signals marked <strong>N/A</strong> are excluded from the score and their weight redistributes to other signals.');
}

function renderUsersGuide() {
  _renderGuide('users-guide', 'iqc_users_guide_dismissed',
    '<strong>Quick overview</strong> — Manage who has access to your IQcadence account. ' +
    'Create new users with the <strong>+ Create User</strong> button above. ' +
    'Each user gets their own login but shares the same customer data, settings, and scoring profiles within your organization. ' +
    'Remove users by clicking the delete button on their row.');
}

function renderAuditlogGuide() {
  _renderGuide('auditlog-guide', 'iqc_auditlog_guide_dismissed',
    '<strong>Quick overview</strong> — The Audit Log tracks all changes across your account. ' +
    '<strong>Activity Log</strong> records customer-facing actions like score changes, edits, and stage transitions. ' +
    '<strong>Config History</strong> tracks settings changes like weight updates, threshold edits, profile changes, and CSM modifications. ' +
    'Use the action filter and search to find specific entries.');
}

function renderAutomationsGuide() {
  _renderGuide('automations-guide', 'iqc_automations_guide_dismissed',
    '<strong>Quick overview</strong> — Set up automated alerts and custom rules to stay on top of customer changes. ' +
    '<strong>Alert Rules</strong> are pre-built triggers (score drops, churn risk, renewal upcoming) that notify you via Slack, Teams, or email. ' +
    '<strong>Custom Rules</strong> let you build your own conditions with flexible if/then logic. ' +
    'Use the 3-step wizard to create a new rule: choose trigger, set conditions, pick delivery channel.');
}

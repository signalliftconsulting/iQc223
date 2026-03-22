// -- PER-PAGE SPOTLIGHT TOURS -------------------------------------------------
// Each major page has its own guided tour. A "Tour" button in each page header
// starts that page's tour. The spotlight engine is shared across all pages.

var _WT_KEY = 'iqc_walkthrough';

// -- Per-page tour definitions ------------------------------------------------
var _WT_TOURS = {
  homebase: {
    label: 'Home Base',
    steps: [
      {
        target: '#mgr-filter-wrap',
        title: 'Manager Filter',
        body: 'Filter the entire dashboard by CSM. Select one or more managers to see only their accounts across every page - KPIs, alerts, trends, and more all update instantly.'
      },
      {
        target: '.hb-welcome',
        title: 'Your Daily Briefing',
        body: 'This is your starting point every morning. The health ring gives you an instant read on your portfolio, the quick stats show how many accounts are trending up or down, and the overview on the right calls out the single most important pattern to watch today.'
      },
      {
        target: '.dash-kpi-row',
        title: 'Portfolio KPIs',
        body: 'Four numbers that matter most: at-risk MRR, critical accounts, upcoming renewals, and expansion opportunities. Click any card to jump straight to the matching accounts on the Customers page.'
      },
      {
        target: '.hb-insights-wrap',
        title: 'Smart Insights',
        body: 'iQcadence analyzes your portfolio and surfaces the most urgent actions - declining accounts, overdue renewals, quiet customers, and more. Each insight links directly to the corresponding page or accounts so you can act immediately.'
      },
      {
        target: '#heatmap-wrap',
        title: 'Signal Heatmap',
        body: 'A bird\'s-eye view of every signal across all customers. Red cells flag weak spots, green cells show strength. Click any column header to sort and spot patterns fast - like which accounts have the worst NPS or lowest adoption.'
      }
    ]
  },
  alerts: {
    label: 'Alerts',
    steps: [
      {
        target: '#alert-kpi-row',
        title: 'Alert Overview',
        body: 'A real-time count of active alerts grouped by severity. Alerts fire automatically when accounts cross risk thresholds - score drops, engagement declines, renewals approaching with poor health, and 20+ other trigger types.'
      },
      {
        target: '#alert-insights-row',
        title: 'Pulse Studio',
        body: 'Pulse Studio surfaces the most actionable patterns across your portfolio - highest MRR at risk, accounts with multiple red flags, engagement drops, and more. Click any card to see the affected accounts and take action.'
      },
      {
        target: '.aw-detail-row',
        title: 'MRR Exposure and Stages',
        body: 'This section breaks down your total MRR at risk by alert category and shows how alerts distribute across lifecycle stages (onboarding, active, renewal, etc.). Use it to understand where your revenue is most exposed.'
      },
      {
        target: '#alert-sticky-bar',
        title: 'Alert Feed',
        body: 'Browse alerts in five different views - Briefing, Category, Priority, Customer, and Table - depending on how you like to work. Use the search bar to find specific accounts, and select multiple alerts to snooze or dismiss in bulk.'
      }
    ]
  },
  customers: {
    label: 'Customers',
    steps: [
      {
        target: '.list-toolbar',
        title: 'Search and Filter',
        body: 'Use the search bar to find customers by name, or click the status chips to filter by Critical, At Risk, Watch, Healthy, Expansion, or Churned. The Trash chip shows soft-deleted customers you can restore.'
      },
      {
        target: '#cust-table',
        title: 'Customer Table',
        body: 'Your full customer list showing health scores, momentum trends, MRR, renewal timelines, signals, and more. Click any column header to sort. Click a customer name to open a deep-dive with the full signal breakdown, notes, and history.'
      },
      {
        target: '#filter-pill-bar',
        title: 'Active Filters',
        body: 'When you click values in the table to filter (like a specific lifecycle stage or risk tier), filter pills appear here. For example, clicking "Active" in the Stage column filters to only active accounts - a pill like "Stage: Active" shows up here. Remove individual filters or stack multiple to build targeted views.',
        fallback: '.list-toolbar'
      },
      {
        target: '.page-hd',
        title: 'Toolbar and Actions',
        body: 'Export your data as CSV or Bulksheet, save filter presets for quick access, re-score all accounts, or add a new customer. Select multiple rows in the table below for bulk tagging, lifecycle changes, or deletion.',
        container: '#view-customers'
      }
    ]
  },
  settings: {
    label: 'Settings',
    steps: [
      {
        target: '#cfg-sm-section',
        title: 'iQcadence Signal Model',
        body: 'The Signal Model layers 26 factors on top of your base scores to detect hidden risks and expansion signals that raw numbers miss. Toggle it on and choose a sensitivity level to control how aggressively it flags accounts.',
        tab: "cfgTab('config')"
      },
      {
        target: '#weight-rows',
        title: 'Scoring Weights',
        body: 'Control how much each signal contributes to the health score - logins, adoption, tickets, NPS, CSAT, and contact recency. Drag the sliders to match what matters most for your business. Changes recalculate every account score automatically.',
        tab: "cfgTab('config')"
      },
      {
        target: '#cfg-score-dist',
        title: 'Score Distribution and Thresholds',
        body: 'See how your accounts spread across health bands and adjust the boundaries that define Critical, At Risk, Watch, Healthy, and Expansion tiers. These thresholds drive alerts, color coding, and KPI cards across every page in iQcadence.',
        tab: "cfgTab('config')"
      },
      {
        target: '#cfg-acct-ops',
        title: 'Account Operations',
        body: 'Configure how iQcadence manages customer accounts day-to-day. Set contact cadence thresholds per tier (when follow-ups become overdue), renewal alert windows, and how expansion revenue is estimated across your book of business.',
        tab: "cfgTab('config')"
      },
      {
        target: '#cfg-tab-account',
        title: 'Account Tab',
        body: 'The Account tab holds your data health overview, bulk actions, CSM management, and account settings. Let\'s take a look inside.',
        tab: "cfgTab('account')"
      },
      {
        target: '#cfg-data-health-card',
        title: 'Data Health',
        body: 'A real-time quality check on your customer data - how many accounts have complete signal coverage, which ones are stale or missing key fields, and an overall data health score. Poor data quality directly impacts scoring accuracy.',
        tab: "cfgTab('account')"
      },
      {
        target: '#cfg-quick-actions',
        title: 'Quick Actions',
        body: 'One-click tools for common admin tasks: recalculate all health scores, export a full backup of your settings and weights, import a previously saved backup, or reset everything to factory defaults.',
        tab: "cfgTab('account')"
      },
      {
        target: '#cfg-csm-list-card',
        title: 'Manage CSMs',
        body: 'View all Customer Success Managers currently assigned to accounts. Remove a CSM to unassign them from their entire portfolio, or use this list to audit workload distribution before making changes on the CSM Performance page.',
        tab: "cfgTab('account')"
      },
      {
        target: '#cfg-tab-api',
        title: 'Integrations Tab',
        body: 'The Integrations tab connects iQcadence to your existing tools. Let\'s walk through what\'s available.',
        tab: "cfgTab('api')"
      },
      {
        target: '#integrations-section',
        title: 'Native Integrations',
        body: 'Connect to popular platforms like Salesforce, HubSpot, Intercom, Zendesk, Stripe, and more with one-click setup. Each integration syncs customer data automatically to keep your health scores up to date.',
        tab: "cfgTab('api');apiSubTab('integrations')"
      },
      {
        target: '#api-tab-devtools',
        title: 'API and Webhooks',
        body: 'In the API & Webhooks sub-tab, set up custom webhook URLs for Zapier or other automation platforms, manage your API key for inbound requests, browse available REST endpoints, and monitor the event log.',
        tab: "cfgTab('api');apiSubTab('devtools')"
      }
    ]
  },
  segments: {
    label: 'Segments',
    steps: [
      {
        target: '#seg-kpi-row',
        title: 'Segment Summary',
        body: 'Top-level KPIs for your segmented portfolio. See how health scores, MRR, and account counts break down across your business segments at a glance.'
      },
      {
        target: '#seg-view-toggle',
        title: 'View Modes',
        body: 'Switch between Segments (custom tags), Tiers (SMB, Mid-Market, Enterprise), and Lifecycle Stages to analyze your portfolio from different angles. Each view recalculates the chart and table below.',
        fallback: '.page-hd'
      },
      {
        target: '#seg-chart-card',
        title: 'Segment Trend Chart',
        body: 'Track how each segment\'s health changes over time. Toggle segment pills on or off to compare specific groups. Use the date range buttons above to zoom in or out.',
        fallback: '.page-hd'
      },
      {
        target: '#seg-insights-wrap',
        title: 'Cross-Segment Analysis',
        body: 'AI-generated insights that compare segments against each other - which segment is improving fastest, where MRR concentration risk is highest, and momentum shifts that span multiple segments.',
        fallback: '#seg-chart-card'
      },
      {
        target: '#seg-table-wrap',
        title: 'Segment Breakdown Table',
        body: 'A detailed comparison of every segment showing account count, average score, MRR, and trend direction. Click any row to drill into that segment\'s accounts.',
        fallback: '.page-hd'
      }
    ]
  },
  trends: {
    label: 'Trends',
    steps: [
      {
        target: '#trend-kpi-row',
        title: 'Trend Summary',
        body: 'Key metrics showing how your portfolio has changed over the selected time window - average health score, total MRR at risk, and the number of accounts moving up or down.'
      },
      {
        target: '#trend-metric-1',
        title: 'Metric Comparison',
        body: 'Pick a primary metric to chart (health score, MRR, NPS, adoption, etc.), and optionally overlay a second metric to spot correlations. Add a CSM or client filter to narrow the view.',
        fallback: '.page-hd'
      },
      {
        target: '#trend-chart-wrap',
        title: 'Portfolio Trend Chart',
        body: 'Your portfolio health plotted over time. Hover over any point to see the exact value. When two metrics are selected, both lines appear so you can compare movement side by side.',
        fallback: '.page-hd'
      },
      {
        target: '#trend-analysis-wrap',
        title: 'Trend Analysis',
        body: 'AI-powered analysis of your portfolio trends - detecting acceleration or deceleration patterns, correlations between metrics, seasonal effects, and early warning signals that might not be obvious from the chart alone.',
        fallback: '#trend-chart-wrap'
      },
      {
        target: '#trend-movers-wrap',
        title: 'Score Movers',
        body: 'A ranked list of which accounts changed the most during the selected period. Sort by biggest gains or biggest drops to quickly find accounts that need attention or recognition.',
        fallback: '.page-hd'
      }
    ]
  },
  forecast: {
    label: 'Forecast',
    steps: [
      {
        target: '#fc-kpi-row',
        title: 'Revenue KPIs',
        body: 'Four key projections for your portfolio. Projected NRR shows whether revenue is growing or shrinking. Expansion, Contraction, and Churn Risk break down the drivers behind that number.'
      },
      {
        target: '#fc-waterfall-wrap',
        title: 'NRR Waterfall',
        body: 'Visual flow from your current MRR through each revenue impact. Green bars add revenue (expansion), amber and red bars subtract it (contraction and churn). The final bar shows where you land.'
      },
      {
        target: '#fc-analysis-wrap',
        title: 'Forecast Analysis',
        body: 'Key takeaways from the forecast - which accounts drive the most risk, where the biggest expansion opportunities are, and borderline accounts where a touchpoint could change the outcome.'
      },
      {
        target: '#fc-table-wrap',
        title: 'Forecast Detail',
        body: 'Every account classified as Expand, Retain, Contract, or Churn based on health score, trajectory, and growth signals. Sort by impact to see the biggest movers. Switch tabs to view breakdowns by CSM, tier, or renewal timeline.'
      }
    ]
  },
  csmperf: {
    label: 'CSM Performance',
    steps: [
      {
        target: '#csmperf-stats',
        title: 'Team Overview',
        body: 'High-level metrics for your entire CS team - total accounts, average health score, combined MRR, and overall trend. Use this to gauge team-wide performance at a glance.'
      },
      {
        target: '#csmperf-wrap',
        title: 'CSM Leaderboard',
        body: 'Each CSM ranked by a composite index that factors in portfolio health, account count, MRR coverage, and recent trends. Click any CSM to expand their detailed stats.'
      },
      {
        target: '#csm-workload-wrap',
        title: 'Workload Balance',
        body: 'A visual breakdown of how accounts and MRR are distributed across CSMs. Red highlights flag CSMs carrying more than 140% of the average load - a signal to rebalance assignments.',
        fallback: '#csmperf-wrap'
      },
      {
        target: '#csm-focus-wrap',
        title: 'Suggested Focus Areas',
        body: 'AI-generated action items that highlight which CSMs have at-risk accounts needing immediate attention, overdue contacts, or upcoming renewals that require prep.',
        fallback: '#csmperf-wrap'
      },
      {
        target: '#csm-movement-wrap',
        title: 'Portfolio Movement',
        body: 'Track health score changes across your entire portfolio over the past 7 days - how many accounts upgraded, downgraded, or were newly added. Spot team-wide momentum at a glance.',
        fallback: '#csmperf-wrap'
      },
      {
        target: '#csm-activity-wrap',
        title: 'CSM Activity Feed',
        body: 'A live feed of recent scoring events and customer touchpoints logged by each CSM. Use it to verify that your team is actively engaging their accounts and keeping data fresh.',
        fallback: '#csmperf-wrap'
      }
    ]
  },
  reports: {
    label: 'Reports',
    steps: [
      {
        target: '#rpt-pane-templates',
        title: 'Report Templates',
        body: 'Browse ready-made report templates - portfolio summary, executive review, renewal forecast, and more. Click any template to generate a printable report with your latest data.',
        tab: "reportsTab('templates')"
      },
      {
        target: '#rpt-tab-schedules',
        title: 'Scheduled Reports Tab',
        body: 'The Scheduled Reports tab lets you set up recurring reports that auto-generate and send to your inbox.',
        tab: "reportsTab('schedules')"
      },
      {
        target: '#scheduled-reports-container',
        title: 'Scheduled Report List',
        body: 'View and manage all your scheduled reports here. Each entry shows the report type, delivery cadence (daily, weekly, monthly), recipients, and next run time. Pause, edit, or delete any schedule with one click.',
        tab: "reportsTab('schedules')",
        fallback: '#rpt-tab-schedules'
      }
    ]
  },
  score: {
    label: 'Score a Customer',
    steps: [
      {
        target: '#score-form',
        title: 'Customer Scoring Form',
        body: 'This is where you score individual customers. The form is split into three sections: account details at the top, health signals in the middle, and an optional note at the bottom. Let\'s walk through each.',
        scroll: 'top'
      },
      {
        target: '#f-name',
        title: 'Account Details',
        body: 'Start with the basics - company name, contact info, assigned CSM, MRR, tier, and lifecycle stage. These fields set the context for how the health score is calculated and where the account shows up in filters and segments.',
        scroll: 'top'
      },
      {
        target: '#score-signals-grid',
        title: 'Health Signals',
        body: 'The core inputs that drive the health score. Use sliders for login frequency, feature adoption, NPS, and CSAT. Enter discrete values for support tickets and growth signals. Toggle N/A for any signal you don\'t track - it will be excluded from the calculation.',
        scroll: 'bottom'
      },
      {
        target: '#calc-score-btn',
        title: 'Score Preview',
        body: 'Click this button to calculate the health score. The result appears below with a color-coded ring, status badge, signal-by-signal breakdown, and playbook recommendations. Let me show you an example...',
        fallback: '#result-placeholder',
        action: '_wtDemoScore',
        scroll: 'bottom'
      },
      {
        target: '#result-card',
        title: 'Score Result',
        body: 'Here\'s what a scored customer looks like - the health ring shows the overall score, the badge indicates the status tier, and below you\'ll see exactly how each signal contributed. The playbook section gives tailored recommendations based on the score profile.',
        fallback: '#result-placeholder',
        scroll: 'bottom'
      }
    ]
  },
  csv: {
    label: 'Import / Export',
    steps: [
      {
        target: '#drop-zone',
        title: 'Upload CSV',
        body: 'Drag and drop a CSV file here, or click to browse. iQcadence will auto-detect your columns and let you map them to the right fields before importing.'
      },
      {
        target: '#col-map-rows',
        title: 'Column Mapping',
        body: 'After uploading, map each column in your CSV to the matching iQcadence field (name, MRR, score, etc.). Unmapped columns are skipped. The preview table below shows exactly what will be imported.',
        fallback: '#drop-zone'
      }
    ]
  },
  automations: {
    label: 'Automations',
    steps: [
      {
        target: '#active-alerts-container',
        title: 'Alert Rules',
        body: 'View and manage your active alert rules. Each rule defines a trigger condition (score drop, renewal approaching, engagement decline) and where notifications are sent - Slack, Teams, email, or in-app.',
        tab: "autoTab('active')",
        fallback: '.page-hd'
      },
      {
        target: '#auto-tab-rules',
        title: 'Custom Rules Tab',
        body: 'The Custom Rules tab lets you build advanced automation rules with multiple conditions and actions.',
        tab: "autoTab('rules')"
      },
      {
        target: '#custom-rules-list',
        title: 'Rule Builder',
        body: 'Create rules that combine multiple triggers - for example: "If score drops below 40 AND renewal is within 60 days, send a Slack alert to the assigned CSM and tag the account as critical." Click + New Rule to open the visual rule builder.',
        tab: "autoTab('rules')",
        fallback: '#auto-tab-rules'
      }
    ]
  },
  auditlog: {
    label: 'Audit Log',
    steps: [
      {
        target: '#audit-table',
        title: 'Activity Log',
        body: 'A chronological record of every change made in iQcadence - customer edits, score recalculations, setting changes, imports, and more. Filter by action type or search for specific entries.',
        tab: "auditTab('activity')",
        fallback: '.page-hd'
      },
      {
        target: '#audit-tab-config',
        title: 'Config History Tab',
        body: 'The Config History tab shows a timeline of all configuration changes.',
        tab: "auditTab('config')"
      },
      {
        target: '#cfg-change-history',
        title: 'Configuration Timeline',
        body: 'Every scoring weight change, threshold adjustment, and profile update is logged here with timestamps and before/after values. Use this to understand when and why scoring behavior changed, and to troubleshoot unexpected score shifts across your portfolio.',
        tab: "auditTab('config')",
        fallback: '#audit-tab-config'
      }
    ]
  },
  calendar: {
    label: 'Calendar',
    steps: [
      {
        target: '#calendar-wrap',
        title: 'Renewal Calendar',
        body: 'A visual calendar showing upcoming renewals, scheduled customer touches, and overdue contacts. Click any event to open the customer detail. Use the refresh button to sync the latest data.'
      }
    ]
  }
};

// -- State management ---------------------------------------------------------
function _wtGetPageState(page) {
  try {
    var raw = localStorage.getItem(_WT_KEY);
    if (raw) {
      var all = JSON.parse(raw);
      return all[page] || null;
    }
  } catch(e) { console.warn('ls:', e.message); }
  return null;
}

function _wtSavePageState(page, state) {
  try {
    var raw = localStorage.getItem(_WT_KEY);
    var all = raw ? JSON.parse(raw) : {};
    all[page] = state;
    localStorage.setItem(_WT_KEY, JSON.stringify(all));
  } catch(e) { console.warn('ls:', e.message); }
}

function _wtClearPage(page) {
  try {
    var raw = localStorage.getItem(_WT_KEY);
    if (raw) {
      var all = JSON.parse(raw);
      delete all[page];
      localStorage.setItem(_WT_KEY, JSON.stringify(all));
    }
  } catch(e) { console.warn('ls:', e.message); }
}

// -- CSS injection ------------------------------------------------------------
var _wtStylesInjected = false;
function _wtInjectStyles() {
  if (_wtStylesInjected) return;
  _wtStylesInjected = true;
  var s = document.createElement('style');
  s.textContent =
    '#wt-overlay{position:fixed;inset:0;z-index:10000;pointer-events:auto;transition:opacity .3s}' +
    '#wt-overlay-bg{position:fixed;transition:all .3s ease;border-radius:12px;z-index:10000}' +
    '@keyframes wtPulseRing{0%{border-color:#2563eb}50%{border-color:#4f7ff7;box-shadow:0 0 0 9999px rgba(0,0,0,.55),0 0 30px 4px rgba(37,99,235,.3)}100%{border-color:#2563eb}}' +
    '#wt-overlay-bg{animation:wtPulseRing 2s ease-in-out infinite}' +
    '.wt-spotlight{position:relative;z-index:10001!important}' + /* kept for cleanup compat */
    '#wt-tooltip{position:fixed;z-index:10002;width:380px;background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.18);font-family:var(--font,Inter,sans-serif);overflow:hidden;transition:opacity .25s,transform .25s;opacity:0;transform:translateY(8px)}' +
    '#wt-tooltip.wt-visible{opacity:1;transform:translateY(0)}' +
    '#wt-tooltip .wt-header{padding:16px 20px 0;display:flex;align-items:center;justify-content:space-between}' +
    '#wt-tooltip .wt-step-count{font-size:12px;font-weight:600;color:var(--muted,#64748b);background:var(--bg,#f1f5f9);padding:3px 10px;border-radius:20px}' +
    '#wt-tooltip .wt-title{font-size:17px;font-weight:700;color:var(--text,#0f172a);padding:10px 20px 0;line-height:1.3}' +
    '#wt-tooltip .wt-body{font-size:13.5px;color:var(--muted,#64748b);padding:8px 20px 0;line-height:1.55}' +
    '#wt-tooltip .wt-dots{display:flex;gap:5px;justify-content:center;padding:14px 20px 0}' +
    '#wt-tooltip .wt-dot{width:8px;height:8px;border-radius:50%;background:var(--border,#e2e8f0);transition:background .2s}' +
    '#wt-tooltip .wt-dot.active{background:#2563eb}' +
    '#wt-tooltip .wt-dot.done{background:#16a34a}' +
    '#wt-tooltip .wt-actions{display:flex;align-items:center;justify-content:space-between;padding:14px 20px 16px}' +
    '#wt-tooltip .wt-skip{background:none;border:none;color:var(--muted,#64748b);font-size:13px;cursor:pointer;padding:6px 0;font-family:inherit}' +
    '#wt-tooltip .wt-skip:hover{color:var(--text,#0f172a)}' +
    '#wt-tooltip .wt-next{background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;border:none;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity .15s}' +
    '#wt-tooltip .wt-next:hover{opacity:.9}' +
    '.wt-tour-btn{display:inline-flex;align-items:center;gap:5px;background:linear-gradient(135deg,#ede9fe,#e0e7ff);border:1px solid #c4b5fd;color:#6d28d9;padding:5px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font,Inter,sans-serif);transition:all .15s}' +
    '.wt-tour-btn:hover{background:linear-gradient(135deg,#ddd6fe,#c7d2fe);border-color:#8b5cf6;color:#5b21b6;box-shadow:0 2px 8px rgba(109,40,217,.15)}' +
    '.wt-tour-btn svg{width:14px;height:14px;flex-shrink:0}';
  document.head.appendChild(s);
}

// -- Tour button creation -----------------------------------------------------
function _wtMakeTourButton(page) {
  var btn = document.createElement('button');
  btn.className = 'wt-tour-btn';
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>' +
    '</svg>Tour';
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    _wtStartPageTour(page);
  });
  return btn;
}

// -- Guide button creation ----------------------------------------------------
function _wtMakeGuideButton(page) {
  if (!_GUIDE_CONTENT || !_GUIDE_CONTENT[page]) return null;
  var btn = document.createElement('button');
  btn.className = 'wt-tour-btn';
  btn.style.cssText = 'background:#ecfeff;border:1px solid #a5f3fc;color:#0e7490';
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' +
    '</svg>Guide';
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    openGuideModal(page);
  });
  btn.addEventListener('mouseover', function() { btn.style.background = '#cffafe'; btn.style.borderColor = '#67e8f9'; });
  btn.addEventListener('mouseout', function() { btn.style.background = '#ecfeff'; btn.style.borderColor = '#a5f3fc'; });
  return btn;
}

// -- Inject tour buttons into page headers ------------------------------------
function _wtInjectTourButtons() {
  _wtInjectStyles();

  // Alerts has a special header class
  var alertsHd = document.querySelector('#view-alerts .aw-page-hd');
  if (alertsHd && !alertsHd.querySelector('.wt-tour-btn')) {
    alertsHd.style.display = 'flex';
    alertsHd.style.alignItems = 'center';
    alertsHd.style.justifyContent = 'space-between';
    alertsHd.appendChild(_wtMakeTourButton('alerts'));
  }

  // Customers has a right-side button group
  var custHd = document.querySelector('#view-customers > .page-hd');
  if (custHd && !custHd.querySelector('.wt-tour-btn')) {
    var custRight = custHd.querySelector('div:last-child');
    if (custRight) {
      custRight.insertBefore(_wtMakeTourButton('customers'), custRight.firstChild);
    }
  }

  // All other pages with standard .page-hd headers
  var standardPages = ['settings', 'segments', 'trends', 'forecast', 'csmperf', 'reports', 'score', 'csv', 'automations', 'auditlog', 'calendar'];
  standardPages.forEach(function(page) {
    if (!_WT_TOURS[page]) return;
    var hd = document.querySelector('#view-' + page + ' > .page-hd');
    if (!hd || hd.querySelector('.wt-tour-btn')) return;
    // Check if header already has a right-side div with buttons
    var rightDiv = hd.querySelector('div:last-child');
    if (rightDiv && rightDiv !== hd.querySelector('div:first-child') && rightDiv.querySelector('button, .dropdown')) {
      rightDiv.insertBefore(_wtMakeTourButton(page), rightDiv.firstChild);
    } else {
      hd.style.display = 'flex';
      hd.style.alignItems = 'center';
      hd.style.justifyContent = 'space-between';
      hd.appendChild(_wtMakeTourButton(page));
    }
  });
}

// Homebase tour button injected via renderHomeBase hook
function _wtInjectHomebaseTourButton() {
  var wrap = document.getElementById('homebase-wrap');
  if (!wrap) return;
  // Find the welcome section and inject before it
  var welcome = wrap.querySelector('.hb-welcome');
  if (!welcome) return;
  // Check if already injected
  if (wrap.querySelector('.wt-tour-btn')) return;
  // Create a small bar above the welcome with Tour + Scoring buttons
  var bar = document.createElement('div');
  bar.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px';
  // Scoring button
  var scoreBtn = document.createElement('button');
  var _shimmerDismissed = localStorage.getItem('iqc_score_settings_clicked');
  var _scoreBtnNormal = 'background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:1px solid #6ee7b7;color:#047857;padding:5px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px';
  var _scoreBtnHighlight = 'background:#0d9488;border:1px solid #0f766e;color:#fff;padding:5px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px';
  scoreBtn.onclick = function() { localStorage.setItem('iqc_score_settings_clicked','1'); scoreBtn.classList.remove('btn-shimmer'); scoreBtn.style.cssText = _scoreBtnNormal; goToScoringConfig(); };
  scoreBtn.className = 'wt-tour-btn' + (_shimmerDismissed ? '' : ' btn-shimmer');
  scoreBtn.style.cssText = _shimmerDismissed ? _scoreBtnNormal : _scoreBtnHighlight;
  scoreBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>Score Settings';
  bar.appendChild(scoreBtn);
  bar.appendChild(_wtMakeTourButton('homebase'));
  welcome.parentNode.insertBefore(bar, welcome);
}

// -- Start tour for a specific page -------------------------------------------
var _wtActiveTour = null;
var _wtActiveStep = 0;
var _wtGen = 0; // generation counter to cancel stale timeouts

function _wtStartPageTour(page) {
  var tour = _WT_TOURS[page];
  if (!tour) return;
  _wtInjectStyles();
  _wtCleanup();
  _wtActiveTour = page;
  _wtActiveStep = 0;
  _wtShowPageStep(page, 0);
}

function _wtStartCurrentPageTour() {
  var view = _wtGetCurrentView();
  if (_WT_TOURS[view]) {
    _wtStartPageTour(view);
  }
}

// -- Show a step within a page tour -------------------------------------------
function _wtShowPageStep(page, idx) {
  var tour = _WT_TOURS[page];
  if (!tour || idx < 0 || idx >= tour.steps.length) return;

  _wtActiveTour = page;
  _wtActiveStep = idx;
  _wtCleanup();
  _wtGen++;

  var gen = _wtGen;
  setTimeout(function() {
    if (_wtGen !== gen) return; // stale - a new tour/step started
    _wtSpotlightPage(page, idx, gen);
  }, 100);
}

// Walk up from target to the nearest card/section wrapper so the whole widget is highlighted
function _wtFindCard(el) {
  // If the element itself is already a card or large container, return it
  var cardSelectors = ['.card', '.cfg-section', '.chart-card', '.aw-card', '.dash-kpi-row', '.aw-kpi-row', '.aw-insights-row', '.aw-detail-row', '.hb-welcome', '.hb-insights-wrap', '.dtab-pane', '.list-toolbar'];
  for (var i = 0; i < cardSelectors.length; i++) {
    if (el.matches(cardSelectors[i])) return el;
  }
  // Walk up to find nearest card parent (max 5 levels, stop at view boundary)
  var p = el.parentElement;
  var depth = 0;
  while (p && depth < 5) {
    if (p.id && p.id.indexOf('view-') === 0) break; // stop at page view
    if (p.classList.contains('dtab-pane')) break; // stop at tab pane
    for (var j = 0; j < cardSelectors.length; j++) {
      if (p.matches(cardSelectors[j])) return p;
    }
    p = p.parentElement;
    depth++;
  }
  return el; // no card found, use original
}

function _wtSpotlightPage(page, idx, gen) {
  if (gen !== undefined && _wtGen !== gen) return;
  var tour = _WT_TOURS[page];
  var step = tour.steps[idx];

  // Switch to the correct tab if this step specifies one
  if (step.tab) {
    try { eval(step.tab); } catch(e) { console.warn('Walkthrough tab switch failed:', e); }
  }

  // Run a custom action if this step specifies one (e.g. triggering a demo score)
  if (step.action) {
    try { eval(step.action + '()'); } catch(e) { console.warn('Walkthrough action failed:', e); }
  }

  // After tab switch, wait for browser to paint newly-visible pane before measuring
  if (step.tab) {
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        if (gen !== undefined && _wtGen !== gen) return;
        setTimeout(function() {
          if (gen !== undefined && _wtGen !== gen) return;
          _wtSpotlightTarget(page, idx, step, tour, gen);
        }, 100);
      });
    });
    return;
  }

  _wtSpotlightTarget(page, idx, step, tour, gen);
}

function _wtSpotlightTarget(page, idx, step, tour, gen) {
  if (gen !== undefined && _wtGen !== gen) return;

  var target = document.querySelector(step.target);

  // If target not found, try fallback selector
  if (!target && step.fallback) {
    target = document.querySelector(step.fallback);
  }

  // If still not found, skip this step
  if (!target) {
    if (idx + 1 < tour.steps.length) {
      _wtShowPageStep(page, idx + 1);
    } else {
      _wtFinishPageTour(page);
    }
    return;
  }

  // For steps with a container scope, only match within that container
  if (step.container) {
    var scoped = document.querySelector(step.container + ' ' + step.target);
    if (scoped) target = scoped;
  }

  // Walk up to nearest card/section container so we highlight the whole widget
  target = _wtFindCard(target);

  // Scroll into view - use instant so rect measurement is accurate
  // step.scroll: 'top' scrolls to top of page, 'bottom' scrolls target into view
  var mainScroll = document.querySelector('.main');
  if (step.scroll === 'top') {
    if (mainScroll) mainScroll.scrollTop = 0;
    window.scrollTo(0, 0);
  } else {
    target.scrollIntoView({ behavior: 'instant', block: 'center' });
  }

  setTimeout(function() {
    if (gen !== undefined && _wtGen !== gen) return; // stale

    // Measure target after scroll is complete
    var r = target.getBoundingClientRect();

    // Safety: if target has zero rect (hidden pane not yet painted), retry once
    if (r.width === 0 && r.height === 0 && !step._retried) {
      step._retried = true;
      setTimeout(function() {
        if (gen !== undefined && _wtGen !== gen) return;
        _wtSpotlightTarget(page, idx, step, tour, gen);
      }, 300);
      return;
    }

    // Create overlay with cutout hole around target
    var overlay = document.createElement('div');
    overlay.id = 'wt-overlay';

    // Hole exactly matches the card rect; border-box keeps border inside the dimensions
    var hole = document.createElement('div');
    hole.id = 'wt-overlay-bg';
    var br = getComputedStyle(target).borderRadius || '12px';
    hole.style.cssText =
      'position:fixed;box-sizing:border-box;' +
      'border-radius:' + br + ';' +
      'top:' + r.top + 'px;' +
      'left:' + r.left + 'px;' +
      'width:' + r.width + 'px;' +
      'height:' + r.height + 'px;' +
      'border:3px solid #2563eb;' +
      'box-shadow:0 0 0 9999px rgba(0,0,0,.55);' +
      'pointer-events:none';

    overlay.appendChild(hole);
    overlay.addEventListener('click', function(e) {
      // Click on dim area - do nothing (user must use buttons)
    });
    document.body.appendChild(overlay);

    // Create tooltip
    var tooltip = document.createElement('div');
    tooltip.id = 'wt-tooltip';

    var total = tour.steps.length;
    var dotsHTML = '';
    for (var i = 0; i < total; i++) {
      var cls = i < idx ? 'wt-dot done' : i === idx ? 'wt-dot active' : 'wt-dot';
      dotsHTML += '<div class="' + cls + '"></div>';
    }

    var isLast = idx === total - 1;

    tooltip.innerHTML =
      '<div class="wt-header">' +
        '<span class="wt-step-count">' + (idx + 1) + ' of ' + total + '</span>' +
      '</div>' +
      '<div class="wt-title">' + step.title + '</div>' +
      '<div class="wt-body">' + step.body + '</div>' +
      '<div class="wt-dots">' + dotsHTML + '</div>' +
      '<div class="wt-actions" style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        (idx > 0 ? '<button class="wt-skip" onclick="_wtPrevPageStep()">&larr; Back</button>' : '<div style="width:60px"></div>') +
        '<button class="wt-skip" onclick="_wtEndPageTour()">End tour</button>' +
        '<button class="wt-next" onclick="_wtNextPageStep()">' + (isLast ? 'Done' : 'Next') + ' &rarr;</button>' +
      '</div>';
    document.body.appendChild(tooltip);

    // Position tooltip
    _wtPositionTooltip(target, tooltip);

    // Animate in
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        tooltip.classList.add('wt-visible');
      });
    });
  }, 250);
}

// -- Navigation ---------------------------------------------------------------
function _wtNextPageStep() {
  if (!_wtActiveTour) return;
  var tour = _WT_TOURS[_wtActiveTour];
  if (!tour) return;
  var next = _wtActiveStep + 1;
  if (next >= tour.steps.length) {
    _wtFinishPageTour(_wtActiveTour);
    return;
  }
  _wtShowPageStep(_wtActiveTour, next);
}

function _wtPrevPageStep() {
  if (!_wtActiveTour) return;
  var prev = _wtActiveStep - 1;
  if (prev < 0) prev = 0;
  _wtShowPageStep(_wtActiveTour, prev);
}

function _wtEndPageTour() {
  _wtGen++;
  _wtCleanup();
  _wtActiveTour = null;
  _wtActiveStep = 0;
}

function _wtFinishPageTour(page) {
  _wtCleanup();
  _wtActiveTour = null;
  _wtActiveStep = 0;
}

// -- Position tooltip near target ---------------------------------------------
function _wtPositionTooltip(target, tooltip) {
  var rect = target.getBoundingClientRect();
  var tw = 380;
  var gap = 16;

  var top = rect.bottom + gap;
  var left = rect.left + (rect.width / 2) - (tw / 2);

  var th = tooltip.offsetHeight || 280;
  if (top + th > window.innerHeight - 20) {
    top = rect.top - th - gap;
  }

  if (left < 16) left = 16;
  if (left + tw > window.innerWidth - 16) left = window.innerWidth - tw - 16;

  // If target is very tall (like a table), place to the right
  if (rect.height > window.innerHeight * 0.6) {
    top = Math.max(80, rect.top);
    left = Math.min(rect.right + gap, window.innerWidth - tw - 16);
    if (left + tw > window.innerWidth - 16) {
      left = rect.left - tw - gap;
    }
  }

  if (top < 16) top = 16;

  tooltip.style.top = top + 'px';
  tooltip.style.left = left + 'px';
}

// -- Cleanup ------------------------------------------------------------------
function _wtCleanup() {
  var overlay = document.getElementById('wt-overlay');
  if (overlay) overlay.remove();
  var tooltip = document.getElementById('wt-tooltip');
  if (tooltip) tooltip.remove();
  var spots = document.querySelectorAll('.wt-spotlight');
  for (var i = 0; i < spots.length; i++) {
    spots[i].classList.remove('wt-spotlight');
  }
}

// -- Get current view ---------------------------------------------------------
function _wtGetCurrentView() {
  if (typeof _navHistory !== 'undefined' && typeof _navIdx !== 'undefined') {
    return _navHistory[_navIdx] || '';
  }
  return '';
}

// -- Init (called after demo data loads) --------------------------------------
// Auto-starts the homebase tour for first-time users
function _wtInit() {
  _wtInjectStyles();
  setTimeout(function() {
    _wtInjectTourButtons();
    _wtInjectHomebaseTourButton();
    _wtStartPageTour('homebase');
  }, 800);
}

// -- Resume (called on page reload) -------------------------------------------
function _wtResume() {
  _wtInjectStyles();
  setTimeout(function() {
    _wtInjectTourButtons();
    _wtInjectHomebaseTourButton();
  }, 600);
}

// -- Nav hook (called from nav.js) - inject tour buttons after view switch -----
function _wtCheckNav(view) {
  setTimeout(function() {
    _wtInjectTourButtons();
    if (view === 'homebase') _wtInjectHomebaseTourButton();
  }, 300);
}

// -- Demo score for tour: fill in sample data and submit ----------------------
function _wtDemoScore() {
  try {
    // Only fill if the form is empty (don't overwrite user data)
    var nameField = document.getElementById('f-name');
    if (nameField && !nameField.value) {
      nameField.value = 'Acme Corp (Demo)';
      var mrr = document.getElementById('f-mrr');
      if (mrr) mrr.value = '8500';
      var logins = document.getElementById('f-logins');
      if (logins) { logins.value = '18'; if (typeof rv === 'function') rv('logins', '18 days'); }
      var adoption = document.getElementById('f-adoption');
      if (adoption) { adoption.value = '65'; if (typeof rv === 'function') rv('adoption', '65%'); }
      var nps = document.getElementById('f-nps');
      if (nps) { nps.value = '7'; if (typeof rv === 'function') rv('nps-label', typeof npsDisplay === 'function' ? npsDisplay(7) : '7'); }
      var tickets = document.getElementById('f-tickets');
      if (tickets) tickets.value = '2';
      var growth = document.getElementById('f-growth');
      if (growth) growth.value = 'mild';
    }
    // Submit the form to generate a result
    if (typeof submitForm === 'function') {
      var form = document.getElementById('score-form');
      if (form) submitForm({ preventDefault: function(){}, target: form });
    }
  } catch(e) { console.warn('ls:', e.message); }
}

// -- Compatibility stubs for old hooks ----------------------------------------
function _wtCompleteIfActive(stepId) {}
function _wtHighlightQBRButton() {}
function _wtDismiss() { _wtEndPageTour(); }
function _wtReset() {
  try { localStorage.removeItem(_WT_KEY); } catch(e) { console.warn('ls:', e.message); }
  _wtInit();
}

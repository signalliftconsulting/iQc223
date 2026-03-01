// ─── AUTOMATIONS (Zapier Webhook Integration) ──────────────

function saveAutomationsCfg() {
  // Auto-sync selected_alerts to all enabled channels
  const selected = automationsCfg.selected_alerts || [];
  if (automationsCfg.channels) {
    ['slack', 'teams', 'email'].forEach(chKey => {
      if (automationsCfg.channels[chKey]?.enabled) {
        automationsCfg.channels[chKey].alerts = [...selected];
      }
    });
  }
  localStorage.setItem('iqc_automations', JSON.stringify(automationsCfg));
  if (currentUser) {
    sb.from('settings').upsert({
      user_id:     currentUser.id,
      automations: JSON.stringify(automationsCfg),
      updated_at:  new Date().toISOString()
    }, { onConflict: 'user_id' }).then(({ error }) => {
      if (error) console.warn('Automations config sync failed:', error.message);
    });
  }
}

function migrateAutomationsCfg() {
  // Migrate old channel_threshold → alert_settings
  if (automationsCfg.channel_threshold !== undefined && !automationsCfg.alert_settings) {
    automationsCfg.alert_settings = { health_below_threshold: { threshold: automationsCfg.channel_threshold } };
    delete automationsCfg.channel_threshold;
  }
  // Ensure alert_settings exists with defaults
  if (!automationsCfg.alert_settings) automationsCfg.alert_settings = {};
  ALERT_TYPES.forEach(at => {
    if (!automationsCfg.alert_settings[at.key]) automationsCfg.alert_settings[at.key] = {};
    at.configFields.forEach(f => {
      if (automationsCfg.alert_settings[at.key][f.name] === undefined)
        automationsCfg.alert_settings[at.key][f.name] = f.default;
    });
  });
  // Ensure each channel has an alerts array — if missing, subscribe to all
  if (automationsCfg.channels) {
    ['slack', 'teams', 'email'].forEach(chKey => {
      if (automationsCfg.channels[chKey] && !automationsCfg.channels[chKey].alerts) {
        automationsCfg.channels[chKey].alerts = ALERT_TYPES.map(a => a.key);
      }
    });
  }
  // Ensure selected_alerts exists — derive from channel subscriptions or default to all
  if (!automationsCfg.selected_alerts) {
    const union = new Set();
    if (automationsCfg.channels) {
      ['slack', 'teams', 'email'].forEach(chKey => {
        (automationsCfg.channels[chKey]?.alerts || []).forEach(a => union.add(a));
      });
    }
    automationsCfg.selected_alerts = union.size > 0 ? [...union] : ALERT_TYPES.map(a => a.key);
  }
  // Ensure schedule exists with defaults
  if (!automationsCfg.schedule) {
    automationsCfg.schedule = { mode: 'realtime', daily_time: '09:00', weekly_day: 'monday', weekly_time: '09:00' };
  }
  // Ensure manager_scope exists with defaults
  if (!automationsCfg.manager_scope) {
    automationsCfg.manager_scope = { mode: 'all', managers: [] };
  }
}

// ── Help search ──
function helpSearch() {
  var q = (el('help-search').value || '').trim().toLowerCase();
  var panes = document.querySelectorAll('#view-help .dtab-pane');
  var tabs = el('help-tab-row');
  if (!q) {
    tabs.style.display = '';
    panes.forEach(function(p){ p.style.display = ''; p.classList.remove('active'); });
    var activeBtn = document.querySelector('#view-help .dtab.active');
    if (!activeBtn) activeBtn = document.querySelector('#view-help .dtab');
    if (activeBtn) activeBtn.click();
    document.querySelectorAll('#view-help .help-section').forEach(function(s){ s.style.display = ''; });
    return;
  }
  tabs.style.display = 'none';
  panes.forEach(function(p){ p.style.display = 'block'; p.classList.add('active'); });
  document.querySelectorAll('#view-help .help-section').forEach(function(s){
    var text = s.textContent.toLowerCase();
    s.style.display = text.indexOf(q) !== -1 ? '' : 'none';
  });
}

// ── Help tab switching ──
function helpTab(t) {
  document.querySelectorAll('#view-help .dtab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#view-help .dtab-pane').forEach(p => p.classList.remove('active'));
  const btn = [...document.querySelectorAll('#view-help .dtab')].find(b => b.textContent.trim().toLowerCase().includes(t));
  if (btn) btn.classList.add('active');
  const pane = document.getElementById('help-pane-' + t);
  if (pane) pane.classList.add('active');
}

// ── Tab switching ──
function autoTab(which) {
  ['active','create','advanced'].forEach(t => {
    el('auto-tab-'+t)?.classList.toggle('active', t === which);
    el('auto-pane-'+t)?.classList.toggle('active', t === which);
  });
  if (which === 'active') renderActiveAlerts();
  if (which === 'create') { wizardGoToStep(_wizardStep); renderWizardNav(); }
  if (which === 'advanced') {
    // Pro+ only — show upgrade wall if not available
    if (!hasFeature('api_webhooks')) {
      const pane = el('auto-pane-advanced');
      if (pane) pane.innerHTML = upgradeHTML('api_webhooks');
      return;
    }
    renderWebhookConfig();
    renderApiSection();
    loadWebhookLog();
  }
}

// ── Main render ──
function renderAutomations() {
  // Hide Advanced tab button for users without api_webhooks (Pro+)
  const advBtn = el('auto-tab-advanced');
  if (advBtn) advBtn.style.display = hasFeature('api_webhooks') ? '' : 'none';
  autoTab('active');
  renderWebhookConfig();
  renderApiSection();
}

// ── Automations SVG icons (no emoji) ──
const _aico   = (p) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const _aicoSm = (p) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const _aicoLg = (p) => `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

const AUTO_ICONS = {
  health_below_threshold: '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  account_at_risk:  '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  renewal_approaching: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  no_contact:       '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="11" x2="23" y2="6"/><line x1="23" y1="11" x2="18" y2="6"/>',
  nps_detractor:    '<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>',
  lifecycle_change: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  rapid_score_drop: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  slack:  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  teams:  '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  email:  '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/>',
  realtime: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  daily:    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  weekly:   '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="8" y="14" width="3" height="3" rx=".5"/>',
  allMgrs:  '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  selMgrs:  '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>',
  bell:  '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  edit:  '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  x:     '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  scope: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
};

// ── Alert Types (all 7 trigger conditions) ──

const ALERT_TYPES = [
  { key: 'health_below_threshold', label: 'Health Below Threshold', shortLabel: 'Health Score Alert', icon: _aico(AUTO_ICONS.health_below_threshold),
    desc: 'Fires when a customer\'s health score drops below the configured threshold.',
    configFields: [{ name: 'threshold', type: 'number', label: 'Score Threshold', default: 50, min: 1, max: 99, hint: 'Fire when score drops below this value' }] },
  { key: 'account_at_risk', label: 'Account At-Risk', shortLabel: 'At-Risk Alert', icon: _aico(AUTO_ICONS.account_at_risk),
    desc: 'Fires when an account\'s status transitions to "risk" or "critical".',
    configFields: [] },
  { key: 'renewal_approaching', label: 'Renewal Approaching', shortLabel: 'Renewal Alert', icon: _aico(AUTO_ICONS.renewal_approaching),
    desc: 'Fires when a customer\'s renewal date is within the configured number of days.',
    configFields: [{ name: 'days', type: 'number', label: 'Days Before Renewal', default: 30, min: 1, max: 365, hint: 'Alert this many days before renewal' }] },
  { key: 'no_contact', label: 'No Contact Alert', shortLabel: 'No Contact', icon: _aico(AUTO_ICONS.no_contact),
    desc: 'Fires when days since last contact exceeds the configured maximum.',
    configFields: [{ name: 'max_days', type: 'number', label: 'Max Days Without Contact', default: 14, min: 1, max: 365, hint: 'Alert if no contact for this many days' }] },
  { key: 'nps_detractor', label: 'NPS Detractor', shortLabel: 'NPS Alert', icon: _aico(AUTO_ICONS.nps_detractor),
    desc: 'Fires when a customer\'s NPS changes to "detractor".',
    configFields: [] },
  { key: 'lifecycle_change', label: 'Lifecycle Change', shortLabel: 'Lifecycle Alert', icon: _aico(AUTO_ICONS.lifecycle_change),
    desc: 'Fires when a customer\'s lifecycle transitions to "At Risk" or "Churned".',
    configFields: [] },
  { key: 'rapid_score_drop', label: 'Rapid Score Drop', shortLabel: 'Rapid Drop', icon: _aico(AUTO_ICONS.rapid_score_drop),
    desc: 'Fires when a customer\'s score drops by more than the configured points in a single update.',
    configFields: [{ name: 'points', type: 'number', label: 'Point Drop Threshold', default: 15, min: 5, max: 50, hint: 'Alert if score drops more than this at once' }] }
];

// ── Direct Channels (Slack, Teams, Email) ──

const CHANNELS = [
  {
    key: 'slack', label: 'Slack', icon: _aico(AUTO_ICONS.slack),
    desc: 'Post alerts to a Slack channel via Incoming Webhook.',
    inputType: 'url', placeholder: 'https://hooks.slack.com/services/T.../B.../xxxx',
    setup: `<ol style="margin:6px 0 0 18px;font-size:.76rem;line-height:1.6;color:var(--muted)">
      <li>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener" style="color:var(--blue)">api.slack.com/apps</a> → <strong>Create New App</strong> → From Scratch</li>
      <li>Under <strong>Incoming Webhooks</strong>, toggle it <strong>On</strong></li>
      <li>Click <strong>Add New Webhook to Workspace</strong> → pick a channel → <strong>Allow</strong></li>
      <li>Copy the <strong>Webhook URL</strong> and paste it above</li>
    </ol>`
  },
  {
    key: 'teams', label: 'Microsoft Teams', icon: _aico(AUTO_ICONS.teams),
    desc: 'Post alerts to a Teams channel via Workflow webhook.',
    inputType: 'url', placeholder: 'https://prod-xx.westus.logic.azure.com:443/workflows/...',
    setup: `<ol style="margin:6px 0 0 18px;font-size:.76rem;line-height:1.6;color:var(--muted)">
      <li>In Teams, go to the channel → <strong>Manage Channel</strong> → <strong>Connectors</strong> (or use <strong>Workflows</strong>)</li>
      <li>Search for <strong>"Incoming Webhook"</strong> → <strong>Configure</strong></li>
      <li>Give it a name (e.g. "iQcadence Alerts") → <strong>Create</strong></li>
      <li>Copy the <strong>Webhook URL</strong> and paste it above</li>
    </ol>`
  },
  {
    key: 'email', label: 'Email', icon: _aico(AUTO_ICONS.email),
    desc: 'Send HTML email alerts to one or more recipients.',
    inputType: 'email', placeholder: 'alerts@yourcompany.com, csm-team@company.com',
    setup: `<p style="margin:6px 0 0;font-size:.76rem;line-height:1.6;color:var(--muted)">
      Enter one or more email addresses separated by commas. Requires Resend API key configured in Supabase secrets.
    </p>`
  }
];

let _wizardStep = 1;
let _inlineEditKey = null;
let _alertSortKey = 'label';
let _alertSortDir = 1;
let _alertFilters = {};
let _openAlertFilterKey = null;

const ALERT_COL_DEFS = [
  { key: 'label',     label: 'Alert',      ftype: 'text' },
  { key: 'condition', label: 'Condition',   ftype: 'text' },
  { key: 'sentTo',    label: 'Sent To',     ftype: 'enum', enumVals: ['Slack', 'Teams', 'Email'] },
  { key: 'timing',    label: 'Timing',      ftype: 'enum', enumVals: ['Real-time', 'Daily', 'Weekly'] },
  { key: 'scope',     label: 'Scope',       ftype: 'text' },
  { key: 'creator',   label: 'Created By',  ftype: 'text' },
];

// ── Active Alerts (Tab 1) ──

function truncateUrl(url, maxLen) {
  let s = (url || '').replace(/^https?:\/\//, '');
  return s.length > maxLen ? escHtml(s.slice(0, maxLen) + '…') : escHtml(s);
}

function sentToHtml() {
  const ch = automationsCfg.channels || {};
  const parts = [];
  if (ch.slack?.enabled) parts.push('<span class="dest-tag" title="' + escHtml(ch.slack.url || 'No URL configured') + '">' + _aicoSm(AUTO_ICONS.slack) + ' Slack</span>');
  if (ch.teams?.enabled) parts.push('<span class="dest-tag" title="' + escHtml(ch.teams.url || 'No URL configured') + '">' + _aicoSm(AUTO_ICONS.teams) + ' Teams</span>');
  if (ch.email?.enabled) parts.push('<span class="dest-tag" title="' + escHtml(ch.email.recipients || 'No recipients configured') + '">' + _aicoSm(AUTO_ICONS.email) + ' Email</span>');
  return parts.length
    ? parts.join(' ')
    : '<span style="color:var(--muted);font-size:.78rem">' + _aicoSm(AUTO_ICONS.warning) + ' None</span>';
}

function scheduleText() {
  const s = automationsCfg.schedule || { mode: 'realtime' };
  if (s.mode === 'daily') return _aicoSm(AUTO_ICONS.daily) + ' Daily at ' + (s.daily_time || '9:00 AM');
  if (s.mode === 'weekly') {
    const d = (s.weekly_day || 'monday');
    return _aicoSm(AUTO_ICONS.weekly) + ' ' + d.charAt(0).toUpperCase() + d.slice(1) + ' at ' + (s.weekly_time || '9:00 AM');
  }
  return _aicoSm(AUTO_ICONS.realtime) + ' Real-time';
}

function renderActiveAlerts() {
  const container = el('active-alerts-container');
  if (!container) return;

  const selected = automationsCfg.selected_alerts || [];
  const channels = automationsCfg.channels || {};
  const settings = automationsCfg.alert_settings || {};
  const schedule = automationsCfg.schedule || { mode: 'realtime' };
  let activeAlerts = ALERT_TYPES.filter(at => selected.includes(at.key));
  const hasAnyChannel = ['slack', 'teams', 'email'].some(k => channels[k]?.enabled);

  if (!activeAlerts.length) {
    container.innerHTML = '<div class="active-alerts-empty">' +
      '<div class="empty-icon">' + _aicoLg(AUTO_ICONS.bell) + '</div>' +
      '<h3 style="margin-bottom:6px">No alerts configured yet</h3>' +
      '<p style="font-size:.85rem;margin-bottom:16px">Create your first alert to start monitoring customer health.</p>' +
      '<button class="btn btn-sm btn-primary" onclick="autoTab(\'create\')">+ Create Alert</button>' +
    '</div>';
    return;
  }

  // ── Shared display values (config-level, not per-alert) ──
  const mgrScope = automationsCfg.manager_scope || { mode: 'all', managers: [] };
  const scopeDisplay = mgrScope.mode === 'selected' && mgrScope.managers.length > 0
    ? mgrScope.managers.map(m => escHtml(m)).join(', ')
    : 'All';
  const creatorDisplay = currentUser?.email || '\u2014';
  const sentToNames = ['slack','teams','email'].filter(k => channels[k]?.enabled).map(k => k === 'teams' ? 'Teams' : k.charAt(0).toUpperCase()+k.slice(1)).join(', ') || 'None';
  const timingLabel = schedule.mode === 'daily' ? 'Daily' : schedule.mode === 'weekly' ? 'Weekly' : 'Real-time';

  function conditionText(at) {
    const s = settings[at.key] || {};
    switch (at.key) {
      case 'health_below_threshold': return 'Score drops below ' + (s.threshold || 50);
      case 'account_at_risk': return 'Status changes to risk or critical';
      case 'renewal_approaching': return 'Renewal within ' + (s.days || 30) + ' days';
      case 'no_contact': return 'No contact for ' + (s.max_days || 14) + '+ days';
      case 'nps_detractor': return 'NPS changes to detractor';
      case 'lifecycle_change': return 'Lifecycle transitions to at-risk or churned';
      case 'rapid_score_drop': return 'Score drops ' + (s.points || 15) + '+ points at once';
      default: return '\u2014';
    }
  }

  // ── Column value extractor for sort/filter ──
  function alertColValue(at, key) {
    switch (key) {
      case 'label':     return at.label;
      case 'condition': return conditionText(at);
      case 'sentTo':    return sentToNames;
      case 'timing':    return timingLabel;
      case 'scope':     return scopeDisplay;
      case 'creator':   return creatorDisplay;
      default:          return '';
    }
  }

  // ── Apply filters ──
  const fKeys = Object.keys(_alertFilters);
  if (fKeys.length) {
    activeAlerts = activeAlerts.filter(at => {
      for (const key of fKeys) {
        const f = _alertFilters[key];
        if (!f) continue;
        const v = alertColValue(at, key).toLowerCase();
        if (f.type === 'text' && !v.includes(f.q)) return false;
        if (f.type === 'enum') {
          // For sentTo, check if any enabled channel matches
          if (key === 'sentTo') {
            const enabledNames = ['slack','teams','email'].filter(k => channels[k]?.enabled).map(k => k === 'teams' ? 'Teams' : k.charAt(0).toUpperCase()+k.slice(1));
            if (!enabledNames.some(n => f.vals.has(n))) return false;
          } else {
            if (!f.vals.has(alertColValue(at, key))) return false;
          }
        }
      }
      return true;
    });
  }

  // ── Sort ──
  activeAlerts.sort((a, b) => {
    const av = alertColValue(a, _alertSortKey).toLowerCase();
    const bv = alertColValue(b, _alertSortKey).toLowerCase();
    return av.localeCompare(bv) * _alertSortDir;
  });

  // ── Build sortable/filterable <thead> ──
  const funnelSVG = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';
  const theadCols = ALERT_COL_DEFS.map(col => {
    const isActiveSort = _alertSortKey === col.key;
    const filterActive = col.key in _alertFilters;
    const arrow = '<span class="col-sort-arrow' + (isActiveSort ? '' : ' idle') + '">' + (_alertSortDir === -1 ? '\u25BC' : '\u25B2') + '</span>';
    const filterBtn = col.ftype
      ? '<button class="col-filter-btn' + (filterActive ? ' active' : '') + '" onclick="event.stopPropagation();openAlertFilter(\'' + col.key + '\',this)" title="Filter ' + col.label + '">' + funnelSVG + '</button>'
      : '';
    return '<th><div class="col-th-inner"><button class="col-sort-label" onclick="alertSortBy(\'' + col.key + '\')">' + col.label + '</button>' + arrow + filterBtn + '</div></th>';
  }).join('') + '<th style="width:80px">Actions</th>';

  // ── Build rows ──
  const rows = activeAlerts.map(at => {
    const isEditing = _inlineEditKey === at.key;

    // Build inline edit panel if this row is expanded
    let inlineEditHtml = '';
    if (isEditing) {
      // Thresholds
      let thresholdFields = '';
      if (at.configFields.length > 0) {
        thresholdFields = '<div style="margin-bottom:12px">' +
          '<div style="font-size:.78rem;font-weight:700;margin-bottom:8px;color:var(--text)">Thresholds</div>' +
          at.configFields.map(f => {
            const val = (settings[at.key] || {})[f.name] ?? f.default;
            return '<div class="inline-field">' +
              '<label>' + escHtml(f.label) + '</label>' +
              '<input type="' + f.type + '" min="' + f.min + '" max="' + f.max + '" value="' + val + '"' +
              ' onblur="updateAlertSetting(\'' + at.key + '\', \'' + f.name + '\', +this.value)"' +
              ' style="width:80px;padding:6px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:.82rem;font-family:var(--font);color:var(--text);background:var(--surface);text-align:center"/>' +
              '<span style="font-size:.72rem;color:var(--muted)">' + escHtml(f.hint) + '</span>' +
            '</div>';
          }).join('') +
        '</div>';
      }

      // Channel toggles
      const channelToggles = CHANNELS.map(ch => {
        const isOn = !!channels[ch.key]?.enabled;
        return '<label>' +
          '<input type="checkbox" ' + (isOn ? 'checked' : '') +
          ' onchange="toggleChannelInline(\'' + ch.key + '\', this.checked)"/>' +
          ' ' + ch.icon + ' ' + escHtml(ch.label) +
        '</label>';
      }).join('');

      // Email recipients (conditional)
      let emailRecipientsHtml = '';
      if (channels.email?.enabled) {
        emailRecipientsHtml = '<div style="margin-top:12px">' +
          '<div style="font-size:.78rem;font-weight:700;margin-bottom:6px;color:var(--text)">Email Recipients</div>' +
          '<input type="email" multiple value="' + escHtml(channels.email?.recipients || '') + '"' +
          ' placeholder="alerts@company.com, team@company.com"' +
          ' onblur="updateChannelValue(\'email\', this.value)"' +
          ' style="width:100%;max-width:400px;padding:6px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:.82rem;font-family:var(--font);color:var(--text);background:var(--surface)"/>' +
          '<div style="font-size:.72rem;color:var(--muted);margin-top:3px">Comma-separated addresses</div>' +
        '</div>';
      }

      // Manager scope
      const allManagers = [...new Set(customers.map(c => c.manager || '').filter(Boolean))].sort();
      const inlineMgrScope = automationsCfg.manager_scope || { mode: 'all', managers: [] };
      const mgrScopeHtml = '<div style="margin-top:12px">' +
        '<div style="font-size:.78rem;font-weight:700;margin-bottom:6px;color:var(--text)">Manager Scope</div>' +
        '<div style="display:flex;gap:16px;align-items:center;margin-bottom:6px">' +
          '<label style="display:flex;align-items:center;gap:4px;font-size:.78rem;cursor:pointer">' +
            '<input type="radio" name="inline-mgr-scope" value="all"' + (inlineMgrScope.mode === 'all' ? ' checked' : '') + ' onchange="setManagerScopeMode(\'all\')"/> All Managers' +
          '</label>' +
          '<label style="display:flex;align-items:center;gap:4px;font-size:.78rem;cursor:pointer">' +
            '<input type="radio" name="inline-mgr-scope" value="selected"' + (inlineMgrScope.mode === 'selected' ? ' checked' : '') + ' onchange="setManagerScopeMode(\'selected\')"/> Selected Managers' +
          '</label>' +
        '</div>' +
        (inlineMgrScope.mode === 'selected' ? '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
          allManagers.map(m => {
            const checked = (inlineMgrScope.managers || []).includes(m);
            return '<label style="display:flex;align-items:center;gap:4px;font-size:.78rem;cursor:pointer">' +
              '<input type="checkbox"' + (checked ? ' checked' : '') + ' onchange="toggleManagerScope(\'' + escHtml(m).replace(/'/g, "\\'") + '\', this.checked)"/> ' + escHtml(m) +
            '</label>';
          }).join('') +
        '</div>' : '') +
      '</div>';

      inlineEditHtml = '<tr><td colspan="7" style="padding:0 12px 10px">' +
        '<div class="summary-inline-edit">' +
          thresholdFields +
          '<div>' +
            '<div style="font-size:.78rem;font-weight:700;margin-bottom:8px;color:var(--text)">Channels</div>' +
            '<div class="summary-inline-channels">' + channelToggles + '</div>' +
          '</div>' +
          emailRecipientsHtml +
          mgrScopeHtml +
          '<div style="margin-top:12px;text-align:right">' +
            '<button class="btn btn-xs btn-ghost" onclick="closeInlineEdit()" style="color:var(--blue)">Done</button>' +
          '</div>' +
        '</div>' +
      '</td></tr>';
    }

    return '<tr class="' + (isEditing ? 'editing' : '') + '">' +
      '<td><span style="margin-right:6px;display:inline-flex;vertical-align:middle;color:var(--blue)">' + _aicoSm(AUTO_ICONS[at.key]) + '</span>' + escHtml(at.label) + '</td>' +
      '<td style="color:var(--muted);font-size:.82rem">' + conditionText(at) + '</td>' +
      '<td>' + sentToHtml() + '</td>' +
      '<td style="font-size:.78rem;white-space:nowrap">' + scheduleText() + '</td>' +
      '<td style="font-size:.78rem;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis" title="' + escHtml(scopeDisplay) + '">' + scopeDisplay + '</td>' +
      '<td style="font-size:.78rem;color:var(--muted)">' + escHtml(creatorDisplay) + '</td>' +
      '<td>' +
        '<button class="btn btn-xs btn-ghost" onclick="toggleInlineEdit(\'' + at.key + '\')" title="' + (isEditing ? 'Close' : 'Edit') + '">' + (isEditing ? _aicoSm(AUTO_ICONS.check) : _aicoSm(AUTO_ICONS.edit)) + '</button> ' +
        '<button class="btn btn-xs btn-ghost" style="color:var(--red)" onclick="wizardRemoveAlert(\'' + at.key + '\')" title="Remove">' + _aicoSm(AUTO_ICONS.x) + '</button>' +
      '</td></tr>' +
      inlineEditHtml;
  }).join('');

  // ── Filter pills bar ──
  let pillsHtml = '';
  const pillKeys = Object.keys(_alertFilters);
  if (pillKeys.length) {
    pillsHtml = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;align-items:center">' +
      pillKeys.map(key => {
        const f = _alertFilters[key];
        const def = ALERT_COL_DEFS.find(d => d.key === key);
        const label = def ? def.label : key;
        let summary = '';
        if (f.type === 'text') summary = '"' + (f.q || '').slice(0, 20) + '"';
        else if (f.type === 'enum') {
          const arr = [...(f.vals || [])];
          summary = arr.length <= 3 ? arr.join(', ') : arr.slice(0, 3).join(', ') + ' +' + (arr.length - 3);
        }
        return '<span class="filter-pill">' + escHtml(label) + ': ' + escHtml(summary) +
          '<button class="filter-pill-x" onclick="event.stopPropagation();clearAlertFilter(\'' + key + '\')" title="Remove filter">' + _aicoSm(AUTO_ICONS.x) + '</button></span>';
      }).join('') +
      '<button class="btn btn-xs btn-ghost" onclick="clearAllAlertFilters()" style="font-size:.72rem;color:var(--muted)">Clear all</button>' +
    '</div>';
  }

  container.innerHTML = pillsHtml + '<table class="alert-summary-table">' +
    '<thead><tr>' + theadCols + '</tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';
}

// ── Thin wrapper — keeps existing callers working ──
function renderAlertSummary() { renderActiveAlerts(); }

// ── Inline Edit Helpers ──

function toggleInlineEdit(alertKey) {
  _inlineEditKey = (_inlineEditKey === alertKey) ? null : alertKey;
  renderAlertSummary();
}

function closeInlineEdit() {
  _inlineEditKey = null;
  renderAlertSummary();
}

function toggleChannelInline(channelKey, enabled) {
  if (!automationsCfg.channels) automationsCfg.channels = {};
  if (!automationsCfg.channels[channelKey]) automationsCfg.channels[channelKey] = {};
  automationsCfg.channels[channelKey].enabled = enabled;
  if (enabled && !automationsCfg.channels[channelKey].alerts) {
    automationsCfg.channels[channelKey].alerts = [...(automationsCfg.selected_alerts || ALERT_TYPES.map(a => a.key))];
  }
  saveAutomationsCfg();
  renderAlertSummary();
  if (_wizardStep === 3) renderWizardStep3();
}

function wizardRemoveAlert(key) {
  automationsCfg.selected_alerts = (automationsCfg.selected_alerts || []).filter(a => a !== key);
  if (_inlineEditKey === key) _inlineEditKey = null;
  saveAutomationsCfg();
  renderAlertSummary();
  renderWizardStep(_wizardStep);
  const label = ALERT_TYPES.find(a => a.key === key)?.label || key;
  toast(label + ' removed', 'success');
}

// ── Alert Table Sort & Filter Functions ──

function alertSortBy(key) {
  if (_alertSortKey === key) _alertSortDir *= -1;
  else { _alertSortKey = key; _alertSortDir = 1; }
  renderAlertSummary();
}

function openAlertFilter(key, btnEl) {
  if (_openAlertFilterKey === key) { closeAlertFilter(); return; }
  closeAlertFilter();
  _openAlertFilterKey = key;
  const col  = ALERT_COL_DEFS.find(c => c.key === key);
  const menu = document.getElementById('alert-filter-portal');
  menu.innerHTML = buildAlertFilterMenu(col);
  menu.classList.add('open');
  const rect = (btnEl.closest('th') || btnEl).getBoundingClientRect();
  menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  menu.style.left = (rect.left   + window.scrollX)      + 'px';
  requestAnimationFrame(() => {
    const mr = menu.getBoundingClientRect();
    if (mr.right > window.innerWidth - 8)
      menu.style.left = (window.innerWidth - mr.width - 8 + window.scrollX) + 'px';
  });
  populateAlertFilterUI(key, col);
  setTimeout(() => menu.querySelector('input')?.focus(), 30);
}

function closeAlertFilter() {
  const menu = document.getElementById('alert-filter-portal');
  if (menu) { menu.classList.remove('open'); menu.innerHTML = ''; }
  _openAlertFilterKey = null;
}

function buildAlertFilterMenu(col) {
  let body = '';
  if (col.ftype === 'enum') {
    const vals = col.enumVals || [];
    body = '<div class="cff-enum-list">' + vals.map(v =>
      '<label class="cff-check-item">' +
        '<input type="checkbox" value="' + escHtml(v) + '" class="af-enum-cb" onchange="applyAlertFilterLive()"> ' +
        escHtml(v) +
      '</label>'
    ).join('') + '</div>';
  } else if (col.ftype === 'text') {
    body = '<input class="cff-text-input" id="af-text" type="text" placeholder="Search ' + col.label.toLowerCase() + '…" oninput="applyAlertFilterLive()" autocomplete="off">';
  }
  return '<div class="col-filter-hd">' +
      '<span class="col-filter-title">Filter: ' + col.label + '</span>' +
      '<button class="col-filter-clear" onclick="clearAlertFilter(\'' + col.key + '\')">Clear</button>' +
    '</div>' +
    '<div class="col-filter-body">' + body + '</div>';
}

function populateAlertFilterUI(key, col) {
  const f = _alertFilters[key];
  if (!f) return;
  if (col.ftype === 'enum') {
    document.querySelectorAll('.af-enum-cb').forEach(cb => { cb.checked = f.vals.has(cb.value); });
  } else if (col.ftype === 'text') {
    const inp = document.getElementById('af-text');
    if (inp) inp.value = f.q || '';
  }
}

function applyAlertFilterLive() {
  const key = _openAlertFilterKey;
  if (!key) return;
  const col = ALERT_COL_DEFS.find(c => c.key === key);
  if (!col) return;
  if (col.ftype === 'enum') {
    const checked = [...document.querySelectorAll('.af-enum-cb:checked')].map(cb => cb.value);
    if (checked.length) _alertFilters[key] = { type: 'enum', vals: new Set(checked) };
    else delete _alertFilters[key];
  } else if (col.ftype === 'text') {
    const q = (document.getElementById('af-text')?.value || '').trim().toLowerCase();
    if (q) _alertFilters[key] = { type: 'text', q };
    else delete _alertFilters[key];
  }
  renderAlertSummary();
}

function clearAlertFilter(key) {
  delete _alertFilters[key];
  closeAlertFilter();
  renderAlertSummary();
}

function clearAllAlertFilters() {
  _alertFilters = {};
  closeAlertFilter();
  renderAlertSummary();
}

// ── Wizard Navigation (clickable stepper, animated transitions) ──

function wizardGoToStep(step) {
  // Validate current step before advancing
  if (step > _wizardStep) {
    if (_wizardStep === 1) {
      const mgrScope = automationsCfg.manager_scope || { mode: 'all', managers: [] };
      if (mgrScope.mode === 'selected' && (!mgrScope.managers || mgrScope.managers.length === 0)) {
        toast('Please select at least one manager, or choose "All Managers"', 'error');
        return;
      }
    }
  }
  _wizardStep = step;
  // Update stepper UI
  document.querySelectorAll('.wizard-step').forEach(stepEl => {
    const s = parseInt(stepEl.dataset.step);
    stepEl.classList.toggle('active', s === step);
    stepEl.classList.toggle('completed', s < step);
  });
  // Update connecting lines
  document.querySelectorAll('.wizard-step__line').forEach((line, i) => {
    line.classList.toggle('completed', (i + 1) < step);
  });
  // Animated pane transition: remove all active, then add on next frame for fade-in
  for (let i = 1; i <= 3; i++) {
    const pane = el('wizard-pane-' + i);
    if (pane) pane.classList.remove('active');
  }
  requestAnimationFrame(() => {
    const targetPane = el('wizard-pane-' + step);
    if (targetPane) targetPane.classList.add('active');
  });
  // Render step content
  renderWizardStep(step);
  renderWizardNav();
}

function renderWizardStep(step) {
  if (step === 1) renderWizardStep1();
  else if (step === 2) renderWizardStep2();
  else if (step === 3) renderWizardStep3();
}

// ── Wizard Nav (Back / Next / Save & Finish) ──

function renderWizardNav() {
  const nav = el('wizard-nav-bar');
  if (!nav) return;
  const backBtn = _wizardStep > 1
    ? '<button class="btn btn-sm btn-ghost" onclick="wizardGoToStep(' + (_wizardStep - 1) + ')">← Back</button>'
    : '<span></span>';
  const nextBtn = _wizardStep < 3
    ? '<button class="btn btn-sm btn-primary" onclick="wizardGoToStep(' + (_wizardStep + 1) + ')">Next →</button>'
    : '<button class="btn btn-sm btn-primary" onclick="wizardSaveAndFinish()">Save & Finish ' + _aicoSm(AUTO_ICONS.check) + '</button>';
  nav.innerHTML = backBtn + nextBtn;
}

function wizardSaveAndFinish() {
  saveAutomationsCfg();
  _wizardStep = 1;
  autoTab('active');
  toast('Alerts saved!', 'success');
}

// ── Step 1: Choose Your Alerts (2-column grid) ──

function renderWizardStep1() {
  const pane = el('wizard-pane-1');
  if (!pane) return;
  const selected = automationsCfg.selected_alerts || [];

  const cards = ALERT_TYPES.map(at => {
    const isSel = selected.includes(at.key);
    return '<div class="wizard-alert-card ' + (isSel ? 'selected' : '') + '" onclick="wizardToggleAlert(\'' + at.key + '\')" data-alert-key="' + at.key + '">' +
      '<div class="wizard-alert-card__check">' + (isSel ? _aicoSm(AUTO_ICONS.check) : '') + '</div>' +
      '<span style="flex-shrink:0;display:flex;align-items:center;color:var(--blue)">' + at.icon + '</span>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:600;font-size:.85rem">' + escHtml(at.label) + '</div>' +
        '<div style="font-size:.75rem;color:var(--muted);margin-top:2px">' + escHtml(at.desc) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  // Build manager scope section (moved from Step 3)
  const mgrScope = automationsCfg.manager_scope || { mode: 'all', managers: [] };
  const allManagers = [...new Set(customers.map(c => c.manager || '').filter(Boolean))].sort();
  const mgrScopeHtml = '<div style="margin-top:24px;margin-bottom:14px">' +
    '<h3 style="margin:0;font-size:1rem">Who should alerts cover?</h3>' +
    '<p style="font-size:.78rem;color:var(--muted);margin:4px 0 0">Scope alerts to specific managers or monitor all accounts.</p>' +
  '</div>' +
  '<div class="wizard-schedule-option ' + (mgrScope.mode === 'all' ? 'active' : '') + '" onclick="setManagerScopeMode(\'all\')">' +
    '<input type="radio" name="mgr-scope-mode" value="all"' + (mgrScope.mode === 'all' ? ' checked' : '') + ' onclick="event.stopPropagation();setManagerScopeMode(\'all\')"/>' +
    '<div style="flex:1"><div style="font-weight:600;font-size:.85rem;display:flex;align-items:center;gap:6px">' + _aico(AUTO_ICONS.allMgrs) + ' All Managers</div>' +
    '<div style="font-size:.75rem;color:var(--muted);margin-top:2px">Alerts fire for every customer regardless of manager</div></div>' +
  '</div>' +
  '<div class="wizard-schedule-option ' + (mgrScope.mode === 'selected' ? 'active' : '') + '" onclick="setManagerScopeMode(\'selected\')">' +
    '<input type="radio" name="mgr-scope-mode" value="selected"' + (mgrScope.mode === 'selected' ? ' checked' : '') + ' onclick="event.stopPropagation();setManagerScopeMode(\'selected\')"/>' +
    '<div style="flex:1"><div style="font-weight:600;font-size:.85rem;display:flex;align-items:center;gap:6px">' + _aico(AUTO_ICONS.selMgrs) + ' Selected Managers</div>' +
    '<div style="font-size:.75rem;color:var(--muted);margin-top:2px">Only fire alerts for accounts owned by chosen managers</div>' +
    (mgrScope.mode === 'selected' ? '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">' +
      allManagers.map(m => {
        const checked = (mgrScope.managers || []).includes(m);
        return '<label onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:4px;font-size:.78rem;cursor:pointer">' +
          '<input type="checkbox"' + (checked ? ' checked' : '') + ' onchange="event.stopPropagation();toggleManagerScope(\'' + escHtml(m).replace(/'/g, "\\'") + '\', this.checked)"/> ' + escHtml(m) +
        '</label>';
      }).join('') +
    '</div>' : '') +
    '</div>' +
  '</div>';

  pane.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
    '<div>' +
      '<h3 style="margin:0;font-size:1rem">Which alerts do you want?</h3>' +
      '<p style="font-size:.78rem;color:var(--muted);margin:4px 0 0">Select the conditions that should trigger notifications.</p>' +
    '</div>' +
    '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-xs btn-ghost" onclick="wizardSelectAll()" style="font-size:.75rem">Select All</button>' +
      '<button class="btn btn-xs btn-ghost" onclick="wizardClearAll()" style="font-size:.75rem;color:var(--muted)">Clear</button>' +
    '</div>' +
  '</div>' +
  '<div class="wizard-alert-grid">' + cards + '</div>' +
  mgrScopeHtml;
}

function wizardToggleAlert(key) {
  if (!automationsCfg.selected_alerts) automationsCfg.selected_alerts = [];
  const idx = automationsCfg.selected_alerts.indexOf(key);
  if (idx >= 0) automationsCfg.selected_alerts.splice(idx, 1);
  else automationsCfg.selected_alerts.push(key);
  saveAutomationsCfg();
  renderWizardStep1();
  renderAlertSummary();
}

function wizardSelectAll() {
  automationsCfg.selected_alerts = ALERT_TYPES.map(a => a.key);
  saveAutomationsCfg();
  renderWizardStep1();
  renderAlertSummary();
}

function wizardClearAll() {
  automationsCfg.selected_alerts = [];
  saveAutomationsCfg();
  renderWizardStep1();
  renderAlertSummary();
}

// ── Step 2: Configure Thresholds ──

function renderWizardStep2() {
  const pane = el('wizard-pane-2');
  if (!pane) return;
  const selected = automationsCfg.selected_alerts || [];
  const settings = automationsCfg.alert_settings || {};

  // Only show alerts that are selected AND have configurable fields
  const configurable = ALERT_TYPES.filter(at => selected.includes(at.key) && at.configFields.length > 0);

  if (!configurable.length) {
    pane.innerHTML = '<div style="text-align:center;padding:40px 20px">' +
      '<div style="font-size:2rem;margin-bottom:12px;color:var(--green)">' + _aicoLg(AUTO_ICONS.checkCircle) + '</div>' +
      '<h3 style="margin:0;font-size:1rem">No thresholds to configure</h3>' +
      '<p style="font-size:.82rem;color:var(--muted);margin-top:6px">Your selected alerts use automatic detection \u2014 no thresholds needed.</p>' +
    '</div>';
    return;
  }

  const cards = configurable.map(at => {
    const atSettings = settings[at.key] || {};
    const fields = at.configFields.map(f => {
      const val = atSettings[f.name] ?? f.default;
      return '<div style="display:flex;align-items:center;gap:10px;margin-top:10px">' +
        '<label style="font-size:.8rem;font-weight:600;white-space:nowrap;min-width:160px">' + escHtml(f.label) + '</label>' +
        '<input type="' + f.type + '" min="' + f.min + '" max="' + f.max + '" value="' + val + '"' +
        ' onchange="updateAlertSetting(\'' + at.key + '\', \'' + f.name + '\', +this.value)"' +
        ' style="width:90px;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;font-family:var(--font);color:var(--text);background:var(--surface);text-align:center"/>' +
        '<span style="font-size:.75rem;color:var(--muted)">' + escHtml(f.hint) + '</span>' +
      '</div>';
    }).join('');

    return '<div class="wizard-threshold-card">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<span style="flex-shrink:0;display:flex;align-items:center;color:var(--blue)">' + at.icon + '</span>' +
        '<div style="font-weight:600;font-size:.88rem">' + escHtml(at.label) + '</div>' +
      '</div>' +
      fields +
    '</div>';
  }).join('');

  pane.innerHTML = '<div style="margin-bottom:16px">' +
    '<h3 style="margin:0;font-size:1rem">Set your thresholds</h3>' +
    '<p style="font-size:.78rem;color:var(--muted);margin:4px 0 0">Configure when each alert should fire. Only alerts with adjustable thresholds are shown.</p>' +
  '</div>' + cards;
}

function updateAlertSetting(alertKey, fieldName, value) {
  if (!automationsCfg.alert_settings) automationsCfg.alert_settings = {};
  if (!automationsCfg.alert_settings[alertKey]) automationsCfg.alert_settings[alertKey] = {};
  automationsCfg.alert_settings[alertKey][fieldName] = value;
  saveAutomationsCfg();
  renderAlertSummary();
}

// ── Step 3: Delivery & Schedule ──

function renderWizardStep3() {
  const pane = el('wizard-pane-3');
  if (!pane) return;
  const channels = automationsCfg.channels || {};
  const schedule = automationsCfg.schedule || { mode: 'realtime' };

  // Build channel rows
  const channelRows = CHANNELS.map(ch => {
    const cfg = channels[ch.key] || { enabled: false };
    const value = ch.key === 'email' ? (cfg.recipients || '') : (cfg.url || '');
    const isEmail = ch.key === 'email';

    let configInputs = '';
    if (cfg.enabled) {
      configInputs = '<div style="margin-top:10px">' +
        '<div class="field" style="margin-bottom:8px">' +
          '<label style="font-size:.76rem;font-weight:600;margin-bottom:3px;display:block">' + (isEmail ? 'Recipients' : 'Webhook URL') + '</label>' +
          '<input type="' + ch.inputType + '" id="ch-val-' + ch.key + '"' +
            ' placeholder="' + escHtml(ch.placeholder) + '"' +
            ' value="' + escHtml(value) + '"' +
            ' onchange="updateChannelValue(\'' + ch.key + '\', this.value)"' +
            ' style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:.82rem;font-family:var(--font);color:var(--text);background:var(--surface)"/>' +
        '</div>' +
        (isEmail ? '<div class="field" style="margin-bottom:8px;display:flex;align-items:center;gap:8px">' +
          '<label style="font-size:.76rem;font-weight:600;white-space:nowrap">Subject Prefix</label>' +
          '<input type="text" id="ch-subject-' + ch.key + '"' +
            ' placeholder="[iQcadence Alert]"' +
            ' value="' + escHtml(cfg.subject_prefix || '[iQcadence Alert]') + '"' +
            ' onchange="updateChannelMeta(\'' + ch.key + '\', \'subject_prefix\', this.value)"' +
            ' style="width:200px;padding:6px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:.82rem;font-family:var(--font);color:var(--text);background:var(--surface)"/>' +
        '</div>' : '') +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<button class="btn btn-xs btn-outline" onclick="testChannel(\'' + ch.key + '\')"' +
            (!value ? ' disabled title="Enter a ' + (isEmail ? 'recipient' : 'URL') + ' first"' : '') + '>' +
            _aicoSm(AUTO_ICONS.realtime) + ' Send Test</button>' +
          '<span id="ch-test-status-' + ch.key + '" style="font-size:.76rem;color:var(--muted)"></span>' +
        '</div>' +
        '<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--blue);font-size:.74rem;font-weight:600">Setup Instructions</summary>' + ch.setup + '</details>' +
      '</div>';
    }

    return '<div class="wizard-channel-row">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<span style="flex-shrink:0;display:flex;align-items:center;color:var(--blue)">' + ch.icon + '</span>' +
          '<div>' +
            '<div style="font-weight:600;font-size:.85rem">' + escHtml(ch.label) + '</div>' +
            '<div style="font-size:.73rem;color:var(--muted)">' + escHtml(ch.desc) + '</div>' +
          '</div>' +
        '</div>' +
        '<label class="toggle-switch">' +
          '<input type="checkbox" ' + (cfg.enabled ? 'checked' : '') +
            ' onchange="toggleChannel(\'' + ch.key + '\', this.checked)"/>' +
          '<span class="toggle-slider"></span>' +
        '</label>' +
      '</div>' +
      configInputs +
    '</div>';
  }).join('');

  // Build schedule options
  const scheduleOptions = [
    { mode: 'realtime', label: 'Real-time', desc: 'Send alerts immediately when triggered', icon: _aico(AUTO_ICONS.realtime) },
    { mode: 'daily', label: 'Daily Digest', desc: 'Bundle alerts into a daily summary', icon: _aico(AUTO_ICONS.daily) },
    { mode: 'weekly', label: 'Weekly Digest', desc: 'Bundle alerts into a weekly summary', icon: _aico(AUTO_ICONS.weekly) }
  ];

  const scheduleHtml = scheduleOptions.map(opt => {
    const isActive = schedule.mode === opt.mode;
    let extra = '';
    if (opt.mode === 'daily' && isActive) {
      extra = '<div style="margin-top:8px;display:flex;align-items:center;gap:8px">' +
        '<label style="font-size:.76rem;font-weight:600">Time</label>' +
        '<input type="time" value="' + (schedule.daily_time || '09:00') + '"' +
        ' onchange="updateSchedule(\'daily_time\', this.value)"' +
        ' style="padding:5px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:.82rem;font-family:var(--font);color:var(--text);background:var(--surface)"/>' +
      '</div>';
    }
    if (opt.mode === 'weekly' && isActive) {
      extra = '<div style="margin-top:8px;display:flex;align-items:center;gap:12px">' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<label style="font-size:.76rem;font-weight:600">Day</label>' +
          '<select onchange="updateSchedule(\'weekly_day\', this.value)"' +
          ' style="padding:5px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:.82rem;font-family:var(--font);color:var(--text);background:var(--surface)">' +
            ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d =>
              '<option value="' + d + '"' + (schedule.weekly_day === d ? ' selected' : '') + '>' + d.charAt(0).toUpperCase() + d.slice(1) + '</option>'
            ).join('') +
          '</select>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<label style="font-size:.76rem;font-weight:600">Time</label>' +
          '<input type="time" value="' + (schedule.weekly_time || '09:00') + '"' +
          ' onchange="updateSchedule(\'weekly_time\', this.value)"' +
          ' style="padding:5px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:.82rem;font-family:var(--font);color:var(--text);background:var(--surface)"/>' +
        '</div>' +
      '</div>';
    }
    return '<div class="wizard-schedule-option ' + (isActive ? 'active' : '') + '" onclick="setScheduleMode(\'' + opt.mode + '\')">' +
      '<input type="radio" name="schedule-mode" value="' + opt.mode + '"' + (isActive ? ' checked' : '') + ' onclick="event.stopPropagation();setScheduleMode(\'' + opt.mode + '\')"/>' +
      '<div style="flex:1">' +
        '<div style="font-weight:600;font-size:.85rem;display:flex;align-items:center;gap:6px">' + opt.icon + ' ' + escHtml(opt.label) + '</div>' +
        '<div style="font-size:.75rem;color:var(--muted);margin-top:2px">' + escHtml(opt.desc) + '</div>' +
        extra +
      '</div>' +
    '</div>';
  }).join('');

  pane.innerHTML = '<div style="margin-bottom:18px">' +
    '<h3 style="margin:0;font-size:1rem">Where should alerts be sent?</h3>' +
    '<p style="font-size:.78rem;color:var(--muted);margin:4px 0 0">Enable your delivery channels and configure their connection details.</p>' +
  '</div>' +
  channelRows +
  '<div style="margin-top:24px;margin-bottom:14px">' +
    '<h3 style="margin:0;font-size:1rem">When should alerts fire?</h3>' +
    '<p style="font-size:.78rem;color:var(--muted);margin:4px 0 0">Choose how quickly you want to be notified.</p>' +
  '</div>' +
  scheduleHtml +
  '<p style="font-size:.72rem;color:var(--muted);margin-top:12px;font-style:italic">' +
    'Note: Daily and weekly digests require server-side scheduling (coming soon). All alerts currently fire in real-time.' +
  '</p>';
}

function setScheduleMode(mode) {
  if (!automationsCfg.schedule) automationsCfg.schedule = {};
  automationsCfg.schedule.mode = mode;
  saveAutomationsCfg();
  renderWizardStep3();
  renderAlertSummary();
}

function updateSchedule(field, value) {
  if (!automationsCfg.schedule) automationsCfg.schedule = {};
  automationsCfg.schedule[field] = value;
  saveAutomationsCfg();
  renderAlertSummary();
}

function setManagerScopeMode(mode) {
  if (!automationsCfg.manager_scope) automationsCfg.manager_scope = { mode: 'all', managers: [] };
  automationsCfg.manager_scope.mode = mode;
  saveAutomationsCfg();
  renderWizardStep1();
  renderAlertSummary();
}

function toggleManagerScope(manager, checked) {
  if (!automationsCfg.manager_scope) automationsCfg.manager_scope = { mode: 'selected', managers: [] };
  const arr = automationsCfg.manager_scope.managers;
  if (checked && !arr.includes(manager)) arr.push(manager);
  if (!checked) automationsCfg.manager_scope.managers = arr.filter(m => m !== manager);
  saveAutomationsCfg();
  renderWizardStep1();
  renderAlertSummary();
}

// ── Channel helpers ──

function toggleChannel(key, enabled) {
  if (!automationsCfg.channels) automationsCfg.channels = {};
  if (!automationsCfg.channels[key]) automationsCfg.channels[key] = {};
  automationsCfg.channels[key].enabled = enabled;
  if (enabled && !automationsCfg.channels[key].alerts) {
    // Subscribe to currently selected alerts (not necessarily all)
    automationsCfg.channels[key].alerts = [...(automationsCfg.selected_alerts || ALERT_TYPES.map(a => a.key))];
  }
  saveAutomationsCfg();
  renderWizardStep3();
  renderAlertSummary();
  toast(enabled ? CHANNELS.find(c=>c.key===key)?.label + ' enabled' : CHANNELS.find(c=>c.key===key)?.label + ' disabled', 'success');
}

function updateChannelValue(key, value) {
  if (!automationsCfg.channels) automationsCfg.channels = {};
  if (!automationsCfg.channels[key]) automationsCfg.channels[key] = {};
  if (key === 'email') automationsCfg.channels[key].recipients = value.trim();
  else automationsCfg.channels[key].url = value.trim();
  saveAutomationsCfg();
}

function updateChannelMeta(key, prop, value) {
  if (!automationsCfg.channels) automationsCfg.channels = {};
  if (!automationsCfg.channels[key]) automationsCfg.channels[key] = {};
  automationsCfg.channels[key][prop] = value;
  saveAutomationsCfg();
}

async function testChannel(key) {
  const channels = automationsCfg.channels || {};
  const cfg = channels[key] || {};
  const statusEl = el('ch-test-status-' + key);

  const testCustomer = {
    id: 'test-00000000', name: 'Test Account', score: 42, status: 'risk',
    mrr: 5000, arr: 60000, tier: 'enterprise', manager: 'Test Manager',
    days: 14, renewal_date: '', lifecycle: 'active', tags: 'test', nps: 'detractor',
    logins: 3, adoption: 35, tickets: 7
  };
  const testExtra = { trigger: 'health_below_threshold', threshold: automationsCfg.alert_settings?.health_below_threshold?.threshold || 50, previous_score: 68, test: true };

  if (key === 'slack') {
    if (!cfg.url) { toast('Enter a Slack webhook URL first', 'warn'); return; }
    if (statusEl) statusEl.textContent = 'Sending test…';
    try {
      const payload = buildSlackPayload('health_below_threshold', testCustomer, testExtra);
      const { data, error } = await sb.functions.invoke('send-webhook', {
        body: { url: cfg.url, payload, event_type: 'test_slack', customer_name: 'Test Account', test: true }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">✓ Test sent to Slack</span>';
      toast('Test sent to Slack', 'success');
    } catch (err) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">✗ ' + escHtml(err.message || 'Failed') + '</span>';
      toast('Slack test failed: ' + (err.message || 'Unknown'), 'error');
    }

  } else if (key === 'teams') {
    if (!cfg.url) { toast('Enter a Teams webhook URL first', 'warn'); return; }
    if (statusEl) statusEl.textContent = 'Sending test…';
    try {
      const payload = buildTeamsPayload('health_below_threshold', testCustomer, testExtra);
      const { data, error } = await sb.functions.invoke('send-webhook', {
        body: { url: cfg.url, payload, event_type: 'test_teams', customer_name: 'Test Account', test: true }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">✓ Test sent to Teams</span>';
      toast('Test sent to Teams', 'success');
    } catch (err) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">✗ ' + escHtml(err.message || 'Failed') + '</span>';
      toast('Teams test failed: ' + (err.message || 'Unknown'), 'error');
    }

  } else if (key === 'email') {
    if (!cfg.recipients) { toast('Enter email recipients first', 'warn'); return; }
    if (statusEl) statusEl.textContent = 'Sending test…';
    try {
      await fireEmailAlert('health_below_threshold', testCustomer, testExtra, cfg);
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">✓ Test email sent</span>';
      toast('Test email sent', 'success');
    } catch (err) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">✗ ' + escHtml(err.message || 'Failed') + '</span>';
      toast('Email test failed: ' + (err.message || 'Unknown'), 'error');
    }
  }
}

// ── Webhook Triggers definition ──
const WEBHOOK_TRIGGERS = [
  { key: 'health_below_threshold', label: 'Health Score Drops Below Threshold',
    desc: 'Fires when any account\'s health score falls below your configured threshold.',
    hasThreshold: true, defaultThreshold: 50 },
  { key: 'account_at_risk', label: 'Account Marked At-Risk',
    desc: 'Fires when an account\'s status changes to "risk" or "critical".',
    hasThreshold: false }
];

// ── Webhook config UI ──
function renderWebhookConfig() {
  const container = el('auto-webhooks-list');
  if (!container) return;
  const wh = automationsCfg.webhooks || {};

  container.innerHTML = WEBHOOK_TRIGGERS.map(t => {
    const cfg = wh[t.key] || { url: '', enabled: false, threshold: t.defaultThreshold || 0 };
    return `
      <div class="auto-card">
        <div class="auto-card-hd">
          <div style="flex:1">
            <h3>${escHtml(t.label)}</h3>
            <p style="font-size:.78rem;color:var(--muted);margin-top:2px">${escHtml(t.desc)}</p>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" ${cfg.enabled ? 'checked' : ''}
              onchange="toggleWebhook('${t.key}', this.checked)"/>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="field" style="margin-bottom:10px">
          <label style="font-size:.78rem;font-weight:600;margin-bottom:4px;display:block">Webhook URL</label>
          <input type="url" id="wh-url-${t.key}" placeholder="https://hooks.zapier.com/hooks/catch/..."
            value="${escHtml(cfg.url || '')}"
            onchange="updateWebhookUrl('${t.key}', this.value)"
            style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:.82rem;font-family:var(--font);color:var(--text);background:var(--surface)"/>
        </div>
        ${t.hasThreshold ? `
          <div class="field" style="margin-bottom:10px;display:flex;align-items:center;gap:8px">
            <label style="font-size:.78rem;font-weight:600;white-space:nowrap">Score Threshold</label>
            <input type="number" id="wh-th-${t.key}" min="1" max="99"
              value="${cfg.threshold || t.defaultThreshold}"
              onchange="updateWebhookThreshold('${t.key}', +this.value)"
              style="width:80px;padding:6px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:.82rem;font-family:var(--font);color:var(--text);background:var(--surface)"/>
            <span style="font-size:.75rem;color:var(--muted)">Fire when score drops below this value</span>
          </div>
        ` : ''}
        <div style="display:flex;gap:8px;align-items:center;margin-top:12px">
          <button class="btn btn-sm btn-outline" onclick="testWebhook('${t.key}')"
            ${!cfg.url ? 'disabled title="Enter a webhook URL first"' : ''}>
            ⚡ Test Webhook
          </button>
          <span id="wh-test-status-${t.key}" style="font-size:.78rem;color:var(--muted)"></span>
        </div>
      </div>`;
  }).join('');
}

function toggleWebhook(key, enabled) {
  if (!automationsCfg.webhooks) automationsCfg.webhooks = {};
  if (!automationsCfg.webhooks[key]) automationsCfg.webhooks[key] = { url: '', enabled: false };
  automationsCfg.webhooks[key].enabled = enabled;
  saveAutomationsCfg();
  toast(enabled ? 'Webhook enabled' : 'Webhook disabled', 'success');
}

function updateWebhookUrl(key, url) {
  if (!automationsCfg.webhooks) automationsCfg.webhooks = {};
  if (!automationsCfg.webhooks[key]) automationsCfg.webhooks[key] = { url: '', enabled: false };
  automationsCfg.webhooks[key].url = url.trim();
  saveAutomationsCfg();
}

function updateWebhookThreshold(key, val) {
  if (!automationsCfg.webhooks) automationsCfg.webhooks = {};
  if (!automationsCfg.webhooks[key]) return;
  automationsCfg.webhooks[key].threshold = val;
  saveAutomationsCfg();
}

async function testWebhook(key) {
  const cfg = (automationsCfg.webhooks || {})[key];
  if (!cfg?.url) { toast('No webhook URL configured', 'warn'); return; }

  const statusEl = el('wh-test-status-' + key);
  if (statusEl) statusEl.textContent = 'Sending test…';

  const testPayload = {
    event: key,
    test: true,
    timestamp: new Date().toISOString(),
    account: {
      id: 'test-00000000',
      name: 'Test Account',
      score: 42,
      status: 'risk',
      mrr: 5000,
      tier: 'enterprise',
      manager: 'Test Manager',
      days_since_contact: 14,
      renewal_date: '',
      lifecycle: 'active',
      tags: 'test',
      nps: 'detractor'
    }
  };

  try {
    const { data, error } = await sb.functions.invoke('send-webhook', {
      body: { url: cfg.url, payload: testPayload, event_type: key, customer_id: null, customer_name: 'Test Account', test: true }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">✓ Test sent successfully</span>';
    toast('Test webhook sent', 'success');
  } catch (err) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">✗ Failed: ' + escHtml(err.message || 'Unknown error') + '</span>';
    toast('Test webhook failed: ' + (err.message || 'Unknown error'), 'error');
  }
}

// ── API Key Management ──
function renderApiSection() {
  renderApiKeySection();
  renderApiEndpoints();
}

function renderApiKeySection() {
  const container = el('auto-api-key-section');
  if (!container) return;

  const keyPrefix = automationsCfg.api_key_prefix || null;

  if (keyPrefix) {
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div class="auto-endpoint" style="flex:1;padding:8px 12px">
          <span style="color:var(--muted)">${escHtml(keyPrefix)}${'•'.repeat(32)}</span>
        </div>
        <button class="btn btn-sm btn-outline" style="color:var(--red);border-color:var(--red)" onclick="regenerateApiKey()">Regenerate</button>
      </div>
      <p style="font-size:.75rem;color:var(--muted)">Your full API key was shown only when generated. If you've lost it, regenerate a new one.</p>`;
  } else {
    container.innerHTML = `
      <p style="font-size:.82rem;margin-bottom:12px;color:var(--muted)">No API key generated yet. Generate one to enable inbound API endpoints.</p>
      <button class="btn btn-sm btn-primary" onclick="generateApiKey()">Generate API Key</button>`;
  }
}

async function generateApiKey() {
  // Generate a secure random key: iqc_ + 40 hex chars
  const arr = new Uint8Array(20);
  crypto.getRandomValues(arr);
  const hex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  const fullKey = 'iqc_' + hex;
  const prefix  = fullKey.substring(0, 8);

  // Hash the key for server-side storage
  const encoder = new TextEncoder();
  const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(fullKey));
  const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  // Delete old keys for this user, insert new one
  await sb.from('api_keys').delete().eq('user_id', currentUser.id);
  const { error } = await sb.from('api_keys').insert({
    user_id:    currentUser.id,
    key_hash:   hashHex,
    key_prefix: prefix
  });

  if (error) {
    toast('Failed to save API key: ' + error.message, 'error');
    return;
  }

  // Store prefix in automations config
  automationsCfg.api_key_prefix = prefix;
  saveAutomationsCfg();

  // Show the full key ONCE
  showApiKeyModal(fullKey);
  renderApiKeySection();
  logAudit('api_key_generated', null, '', { summary: 'API key generated for automations' });
}

function regenerateApiKey() {
  confirmAction('Regenerate API key? The old key will stop working immediately.', generateApiKey);
}

function showApiKeyModal(fullKey) {
  el('confirm-msg').innerHTML = `
    <div style="margin-bottom:14px">
      <p style="font-size:.85rem;font-weight:600;color:var(--red);margin-bottom:8px">
        ⚠ Copy this key now — it will not be shown again.
      </p>
      <div class="auto-endpoint" style="user-select:all;cursor:text;font-size:.82rem;padding:12px 14px">
        ${escHtml(fullKey)}
      </div>
    </div>`;
  el('confirm-ok').textContent = 'Copy & Close';
  el('confirm-ok').className = 'btn btn-primary btn-sm';
  el('confirm-ok').onclick = () => {
    navigator.clipboard.writeText(fullKey).then(() => toast('API key copied to clipboard', 'success'));
    closeModal('confirm-modal');
    // Reset confirm modal styling
    el('confirm-ok').textContent = 'Confirm';
    el('confirm-ok').className = 'btn btn-danger btn-sm';
  };
  openModal('confirm-modal');
}

function renderApiEndpoints() {
  const container = el('auto-api-endpoints');
  if (!container) return;
  const baseUrl = SUPABASE_URL + '/functions/v1/api-inbound';

  const endpoints = [
    {
      action: 'upsert_account',
      label: 'Create or Update Account',
      desc: 'Creates a new customer or updates an existing one matched by name.',
      fields: 'name (required), mrr, arr, score, tier, lifecycle, manager, tags, nps, logins, adoption, tickets, days, renewal_date, growth, since, next_touch',
      example: JSON.stringify({ action: 'upsert_account', data: { name: 'Acme Corp', mrr: 5000, tier: 'enterprise', score: 75, manager: 'Jane Smith', tags: 'strategic,q4-renewal' } }, null, 2)
    },
    {
      action: 'update_health',
      label: 'Update Health Field',
      desc: 'Update a specific health signal for an account matched by name.',
      fields: 'name (required), field (required), value (required). Fields: score, nps, logins, adoption, tickets, days, renewal_date, growth, mrr, arr, tier, lifecycle, manager, next_touch',
      example: JSON.stringify({ action: 'update_health', data: { name: 'Acme Corp', field: 'nps', value: 'promoter' } }, null, 2)
    }
  ];

  container.innerHTML = `
    <p style="font-size:.82rem;color:var(--muted);margin-bottom:16px">All endpoints accept <strong>POST</strong> requests with JSON body and require the <code style="background:var(--bg);padding:1px 5px;border-radius:4px;font-size:.78rem">x-api-key</code> header.</p>
    <div class="auto-endpoint" style="margin-bottom:16px">
      <strong>POST</strong> &nbsp;${escHtml(baseUrl)}
      <button class="btn btn-xs btn-ghost copy-btn" onclick="navigator.clipboard.writeText('${escHtml(baseUrl)}');toast('URL copied','success')">Copy</button>
    </div>
    ${endpoints.map(ep => `
      <div class="auto-card">
        <h3 style="margin:0 0 4px;font-size:.85rem">${escHtml(ep.label)}</h3>
        <p style="font-size:.78rem;color:var(--muted);margin-bottom:6px">${escHtml(ep.desc)}</p>
        <p style="font-size:.72rem;color:var(--muted);margin-bottom:10px"><strong>Fields:</strong> ${escHtml(ep.fields)}</p>
        <details style="font-size:.78rem">
          <summary style="cursor:pointer;color:var(--blue);font-weight:600;margin-bottom:6px">Example payload</summary>
          <pre style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;overflow-x:auto;font-size:.75rem;line-height:1.5;color:var(--text);white-space:pre-wrap">${escHtml(ep.example)}</pre>
        </details>
      </div>
    `).join('')}`;
}

// ── Event Log ──
async function loadWebhookLog(forceRefresh) {
  if (forceRefresh) { webhookEvents = []; webhookLogOffset = 0; }

  const loading = el('auto-log-loading');
  const table   = el('auto-log-table');
  const empty   = el('auto-log-empty');
  const pag     = el('auto-log-pagination');

  if (loading) loading.style.display = 'block';
  if (table)   table.style.display   = 'none';
  if (empty)   empty.style.display   = 'none';
  if (pag)     pag.style.display     = 'none';

  try {
    const { data, error } = await sb.from('webhook_events')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .range(webhookLogOffset, webhookLogOffset + 49);
    if (error) throw error;

    if (webhookLogOffset === 0) webhookEvents = data || [];
    else webhookEvents = webhookEvents.concat(data || []);

    if (loading) loading.style.display = 'none';

    if (!webhookEvents.length) {
      if (empty) empty.style.display = 'block';
      return;
    }

    if (table) table.style.display = 'table';
    if ((data || []).length >= 50 && pag) pag.style.display = 'block';

    renderWebhookLog();
  } catch (err) {
    if (loading) loading.style.display = 'none';
    toast('Failed to load event log', 'error');
  }
}

function loadMoreWebhookLog() {
  webhookLogOffset += 50;
  loadWebhookLog();
}

function renderWebhookLog() {
  const filterVal = (el('auto-log-filter') || {}).value || 'all';
  const filtered  = filterVal === 'all' ? webhookEvents
    : webhookEvents.filter(e => e.direction === filterVal);

  const tbody = el('auto-log-tbody');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);font-size:.85rem">No ${filterVal === 'all' ? '' : filterVal + ' '}events found</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(e => {
    const time = new Date(e.created_at).toLocaleString();
    const dirLabel = e.direction === 'outbound' ? '↑ Out' : '↓ In';
    const dirClass = e.direction === 'outbound' ? 'auto-dir-out' : 'auto-dir-in';
    const statusClass = e.status === 'success' ? 'success' : e.status === 'failed' ? 'failed' : 'pending';

    let detail = '';
    if (e.error_msg) detail = e.error_msg;
    else if (e.status_code) detail = 'HTTP ' + e.status_code;

    return `<tr>
      <td style="white-space:nowrap;font-size:.78rem;color:var(--muted)">${escHtml(time)}</td>
      <td><span class="${dirClass}">${dirLabel}</span></td>
      <td style="font-size:.8rem">${escHtml(e.event_type || '')}</td>
      <td style="font-weight:600;font-size:.82rem">${escHtml(e.customer_name || '—')}</td>
      <td><span class="auto-status ${statusClass}">${escHtml(e.status || 'unknown')}</span></td>
      <td style="font-size:.78rem;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(detail)}</td>
    </tr>`;
  }).join('');
}

// ── Trigger Detection ──
function snapshotCustomerStates() {
  _prevCustomerStates.clear();
  customers.forEach(c => {
    _prevCustomerStates.set(c.id, {
      score: c.score, status: c.status, nps: c.nps, csat: c.csat,
      lifecycle: c.lifecycle, renewal_date: c.renewal_date, days: c.days
    });
  });
}

function _snapFields(c) {
  return { score: c.score, status: c.status, nps: c.nps, csat: c.csat, lifecycle: c.lifecycle, renewal_date: c.renewal_date, days: c.days };
}

function checkWebhookTriggers(c) {
  const prev = _prevCustomerStates.get(c.id);
  const hasWebhooks = !!automationsCfg.webhooks;
  const hasChannels = !!automationsCfg.channels;
  if (!hasWebhooks && !hasChannels) { _prevCustomerStates.set(c.id, _snapFields(c)); return; }

  // Manager scope filter — skip if customer's manager isn't in scope
  const mgrScope = automationsCfg.manager_scope;
  if (mgrScope && mgrScope.mode === 'selected' && mgrScope.managers.length > 0) {
    if (!mgrScope.managers.includes(c.manager || '')) {
      _prevCustomerStates.set(c.id, _snapFields(c));
      return;
    }
  }

  const settings = automationsCfg.alert_settings || {};
  const triggeredEvents = [];

  // ── Evaluate all 7 trigger conditions ──

  // 1. Health below threshold
  const hbtThreshold = settings.health_below_threshold?.threshold || 50;
  if (prev && prev.score >= hbtThreshold && c.score < hbtThreshold) {
    triggeredEvents.push({ key: 'health_below_threshold',
      extra: { trigger: 'health_below_threshold', threshold: hbtThreshold, previous_score: prev.score } });
  }

  // 2. Account at-risk
  const riskStatuses = ['risk', 'critical'];
  const wasNotRisk = !prev || !riskStatuses.includes(prev.status);
  const isNowRisk = riskStatuses.includes(c.status);
  if (wasNotRisk && isNowRisk) {
    triggeredEvents.push({ key: 'account_at_risk',
      extra: { trigger: 'account_at_risk', previous_status: prev?.status ?? null } });
  }

  // 3. Renewal approaching
  if (c.renewal_date) {
    const daysUntil = Math.round((new Date(c.renewal_date) - new Date()) / (1000 * 60 * 60 * 24));
    const renewalDays = settings.renewal_approaching?.days || 30;
    const prevDaysUntil = prev?.renewal_date
      ? Math.round((new Date(prev.renewal_date) - new Date()) / (1000 * 60 * 60 * 24))
      : null;
    if (daysUntil <= renewalDays && daysUntil >= 0 && (prevDaysUntil === null || prevDaysUntil > renewalDays)) {
      triggeredEvents.push({ key: 'renewal_approaching',
        extra: { trigger: 'renewal_approaching', days_until_renewal: daysUntil, renewal_date: c.renewal_date } });
    }
  }

  // 4. No contact
  const maxDays = settings.no_contact?.max_days || 14;
  if (prev && prev.days <= maxDays && c.days > maxDays) {
    triggeredEvents.push({ key: 'no_contact',
      extra: { trigger: 'no_contact', days_since_contact: c.days, max_days: maxDays } });
  }

  // 5. NPS detractor
  if (prev && !npsIsDetractor(prev.nps) && npsIsDetractor(c.nps)) {
    triggeredEvents.push({ key: 'nps_detractor',
      extra: { trigger: 'nps_detractor', previous_nps: npsDisplay(prev.nps), current_nps: npsDisplay(c.nps) } });
  }

  // 5b. CSAT poor
  if (prev && !csatIsPoor(prev.csat) && csatIsPoor(c.csat)) {
    triggeredEvents.push({ key: 'nps_detractor',
      extra: { trigger: 'csat_poor', previous_csat: csatDisplay(prev.csat), current_csat: csatDisplay(c.csat) } });
  }

  // 6. Lifecycle change to atrisk or churned
  const badLifecycles = ['atrisk', 'churned'];
  if (prev && !badLifecycles.includes(prev.lifecycle) && badLifecycles.includes(c.lifecycle)) {
    triggeredEvents.push({ key: 'lifecycle_change',
      extra: { trigger: 'lifecycle_change', previous_lifecycle: prev.lifecycle, current_lifecycle: c.lifecycle } });
  }

  // 7. Rapid score drop
  const dropThreshold = settings.rapid_score_drop?.points || 15;
  if (prev && (prev.score - c.score) >= dropThreshold) {
    triggeredEvents.push({ key: 'rapid_score_drop',
      extra: { trigger: 'rapid_score_drop', previous_score: prev.score, drop_amount: prev.score - c.score, drop_threshold: dropThreshold } });
  }

  // ── Fire direct channels (per-channel filtering handled inside) ──
  triggeredEvents.forEach(evt => {
    fireDirectChannels(evt.key, c, evt.extra);
  });

  // ── Fire Zapier webhooks (only for original 2 trigger types) ──
  const hbt = (automationsCfg.webhooks || {}).health_below_threshold;
  if (hbt?.enabled && hbt?.url && prev && prev.score >= (hbt.threshold || 50) && c.score < (hbt.threshold || 50)) {
    fireWebhook('health_below_threshold', hbt.url, c, {
      trigger: 'health_below_threshold', threshold: hbt.threshold || 50, previous_score: prev.score
    });
  }

  const aar = (automationsCfg.webhooks || {}).account_at_risk;
  if (aar?.enabled && aar?.url && wasNotRisk && isNowRisk) {
    fireWebhook('account_at_risk', aar.url, c, {
      trigger: 'account_at_risk', previous_status: prev?.status ?? null
    });
  }

  // Update snapshot
  _prevCustomerStates.set(c.id, _snapFields(c));
}

async function fireWebhook(eventType, url, customer, extra, overridePayload) {
  const payload = overridePayload || {
    event: eventType,
    timestamp: new Date().toISOString(),
    account: {
      id:                customer.id,
      name:              customer.name,
      score:             customer.score,
      status:            customer.status,
      mrr:               customer.mrr || 0,
      arr:               customer.arr || 0,
      tier:              customer.tier || '',
      manager:           customer.manager || '',
      days_since_contact: customer.days || 0,
      renewal_date:      customer.renewal_date || '',
      lifecycle:         customer.lifecycle || '',
      tags:              Array.isArray(customer.tags) ? customer.tags.join(',') : (customer.tags || ''),
      nps:               npsDisplay(customer.nps),
      csat:              csatDisplay(customer.csat)
    },
    ...extra
  };

  try {
    const { data, error } = await sb.functions.invoke('send-webhook', {
      body: { url, payload, event_type: eventType, customer_id: customer.id, customer_name: customer.name }
    });
    if (error) console.warn('Webhook fire failed:', error.message);
  } catch (err) {
    console.warn('Webhook fire error:', err.message);
  }
}

// ── Message Builders (Slack / Teams / Email) ──

function _eventLabel(eventType) {
  const labels = {
    health_below_threshold: 'Health Score Alert',
    account_at_risk: 'Account At-Risk Alert',
    renewal_approaching: 'Renewal Approaching',
    no_contact: 'No Contact Alert',
    nps_detractor: 'NPS Detractor Alert',
    lifecycle_change: 'Lifecycle Change Alert',
    rapid_score_drop: 'Rapid Score Drop Alert'
  };
  return labels[eventType] || eventType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function _statusEmoji(status) {
  const map = { critical: '🔴', risk: '🟠', watch: '🟡', healthy: '🟢', expand: '🚀' };
  return map[status] || '⚪';
}

function buildSlackPayload(eventType, customer, extra) {
  const c = customer;
  const label = _eventLabel(eventType);
  const emoji = _statusEmoji(c.status);

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${emoji} ${label}`, emoji: true } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*Account:*\n${c.name}` },
      { type: 'mrkdwn', text: `*Health Score:*\n${c.score}/100 (${c.status})` },
      { type: 'mrkdwn', text: `*MRR:*\n$${(c.mrr||0).toLocaleString()}` },
      { type: 'mrkdwn', text: `*CSM:*\n${c.manager || 'Unassigned'}` }
    ]},
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*Tier:*\n${c.tier || '—'}` },
      { type: 'mrkdwn', text: `*Days Since Contact:*\n${c.days != null ? c.days : 'N/A'}` },
      { type: 'mrkdwn', text: `*NPS:*\n${npsDisplay(c.nps)} · *CSAT:*\n${csatDisplay(c.csat)}` },
      { type: 'mrkdwn', text: `*Lifecycle:*\n${c.lifecycle || '—'}` }
    ]}
  ];

  // State change context
  if (extra?.previous_score != null) {
    blocks.push({ type: 'context', elements: [
      { type: 'mrkdwn', text: `Score changed: *${extra.previous_score}* → *${c.score}*${extra.threshold ? ` (threshold: ${extra.threshold})` : ''}` }
    ]});
  }
  if (extra?.previous_status) {
    blocks.push({ type: 'context', elements: [
      { type: 'mrkdwn', text: `Status changed: *${extra.previous_status}* → *${c.status}*` }
    ]});
  }
  if (extra?.days_until_renewal != null) {
    blocks.push({ type: 'context', elements: [
      { type: 'mrkdwn', text: `Renewal in *${extra.days_until_renewal}* days (${extra.renewal_date})` }
    ]});
  }
  if (extra?.days_since_contact != null) {
    blocks.push({ type: 'context', elements: [
      { type: 'mrkdwn', text: `No contact for *${extra.days_since_contact}* days (max: ${extra.max_days})` }
    ]});
  }
  if (extra?.previous_nps) {
    blocks.push({ type: 'context', elements: [
      { type: 'mrkdwn', text: `NPS changed: *${extra.previous_nps}* → *${extra.current_nps}*` }
    ]});
  }
  if (extra?.previous_lifecycle) {
    blocks.push({ type: 'context', elements: [
      { type: 'mrkdwn', text: `Lifecycle changed: *${extra.previous_lifecycle}* → *${extra.current_lifecycle}*` }
    ]});
  }
  if (extra?.drop_amount != null) {
    blocks.push({ type: 'context', elements: [
      { type: 'mrkdwn', text: `Score dropped *${extra.drop_amount}* points: *${extra.previous_score}* → *${c.score}* (threshold: ${extra.drop_threshold})` }
    ]});
  }

  // Footer
  blocks.push({ type: 'context', elements: [
    { type: 'mrkdwn', text: `iQcadence • ${new Date().toLocaleString()}${extra?.test ? ' • TEST' : ''}` }
  ]});

  return { blocks };
}

function buildTeamsPayload(eventType, customer, extra) {
  const c = customer;
  const label = _eventLabel(eventType);
  const emoji = _statusEmoji(c.status);

  const facts = [
    { title: 'MRR', value: '$' + (c.mrr||0).toLocaleString() },
    { title: 'CSM', value: c.manager || 'Unassigned' },
    { title: 'Tier', value: c.tier || '—' },
    { title: 'Days Since Contact', value: c.days != null ? String(c.days) : 'N/A' },
    { title: 'NPS', value: npsDisplay(c.nps) },
    { title: 'CSAT', value: csatDisplay(c.csat) },
    { title: 'Lifecycle', value: c.lifecycle || '—' }
  ];

  if (extra?.previous_score != null) {
    facts.push({ title: 'Previous Score', value: String(extra.previous_score) });
  }
  if (extra?.threshold) {
    facts.push({ title: 'Threshold', value: String(extra.threshold) });
  }
  if (extra?.days_until_renewal != null) {
    facts.push({ title: 'Days Until Renewal', value: String(extra.days_until_renewal) });
    if (extra.renewal_date) facts.push({ title: 'Renewal Date', value: extra.renewal_date });
  }
  if (extra?.days_since_contact != null) {
    facts.push({ title: 'Days Since Contact', value: String(extra.days_since_contact) });
    facts.push({ title: 'Max Days Allowed', value: String(extra.max_days) });
  }
  if (extra?.previous_nps) {
    facts.push({ title: 'NPS Change', value: extra.previous_nps + ' → ' + extra.current_nps });
  }
  if (extra?.previous_lifecycle) {
    facts.push({ title: 'Lifecycle Change', value: extra.previous_lifecycle + ' → ' + extra.current_lifecycle });
  }
  if (extra?.drop_amount != null) {
    facts.push({ title: 'Score Drop', value: extra.drop_amount + ' points (' + extra.previous_score + ' → ' + c.score + ')' });
  }

  const card = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          { type: 'TextBlock', size: 'Large', weight: 'Bolder', text: `${emoji} ${label}`, wrap: true },
          { type: 'ColumnSet', columns: [
            { type: 'Column', width: 'stretch', items: [
              { type: 'TextBlock', text: c.name, weight: 'Bolder', size: 'Medium', wrap: true },
              { type: 'TextBlock', text: `Score: ${c.score}/100 — ${c.status}`, spacing: 'None', isSubtle: true, wrap: true }
            ]}
          ]},
          { type: 'FactSet', facts },
          { type: 'TextBlock', text: `iQcadence • ${new Date().toLocaleString()}${extra?.test ? ' • TEST' : ''}`, size: 'Small', isSubtle: true, wrap: true, spacing: 'Medium' }
        ]
      }
    }]
  };
  return card;
}

function buildAlertEmailHTML(eventType, customer, extra) {
  const c = customer;
  const label = _eventLabel(eventType);
  const emoji = _statusEmoji(c.status);
  const statusColors = { critical: '#dc2626', risk: '#ea580c', watch: '#d97706', healthy: '#16a34a', expand: '#7c3aed' };
  const sColor = statusColors[c.status] || '#6b7280';

  let changeRows = '';
  if (extra?.previous_score != null) {
    changeRows += `<tr><td style="padding:6px 12px;font-size:13px;color:#6b7280">Score Change</td><td style="padding:6px 12px;font-size:13px;font-weight:600">${extra.previous_score} → ${c.score}${extra.threshold ? ` (threshold: ${extra.threshold})` : ''}</td></tr>`;
  }
  if (extra?.previous_status) {
    changeRows += `<tr><td style="padding:6px 12px;font-size:13px;color:#6b7280">Status Change</td><td style="padding:6px 12px;font-size:13px;font-weight:600">${extra.previous_status} → ${c.status}</td></tr>`;
  }
  if (extra?.days_until_renewal != null) {
    changeRows += `<tr style="background:#f9fafb"><td style="padding:6px 12px;font-size:13px;color:#6b7280">Renewal</td><td style="padding:6px 12px;font-size:13px;font-weight:600">In ${extra.days_until_renewal} days (${escHtml(extra.renewal_date || '')})</td></tr>`;
  }
  if (extra?.days_since_contact != null) {
    changeRows += `<tr><td style="padding:6px 12px;font-size:13px;color:#6b7280">No Contact</td><td style="padding:6px 12px;font-size:13px;font-weight:600">${extra.days_since_contact} days (max: ${extra.max_days})</td></tr>`;
  }
  if (extra?.previous_nps) {
    changeRows += `<tr style="background:#f9fafb"><td style="padding:6px 12px;font-size:13px;color:#6b7280">NPS Change</td><td style="padding:6px 12px;font-size:13px;font-weight:600">${escHtml(extra.previous_nps)} → ${escHtml(extra.current_nps)}</td></tr>`;
  }
  if (extra?.previous_lifecycle) {
    changeRows += `<tr><td style="padding:6px 12px;font-size:13px;color:#6b7280">Lifecycle Change</td><td style="padding:6px 12px;font-size:13px;font-weight:600">${escHtml(extra.previous_lifecycle)} → ${escHtml(extra.current_lifecycle)}</td></tr>`;
  }
  if (extra?.drop_amount != null) {
    changeRows += `<tr style="background:#f9fafb"><td style="padding:6px 12px;font-size:13px;color:#6b7280">Rapid Drop</td><td style="padding:6px 12px;font-size:13px;font-weight:600">${extra.drop_amount} points (${extra.previous_score} → ${c.score})</td></tr>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px">
<table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  <tr><td style="background:linear-gradient(135deg,#1e40af,#7c3aed);padding:24px 28px;color:#fff">
    <h1 style="margin:0;font-size:20px;font-weight:700">${emoji} ${label}</h1>
    ${extra?.test ? '<p style="margin:4px 0 0;font-size:12px;opacity:.7">TEST ALERT</p>' : ''}
  </td></tr>
  <tr><td style="padding:24px 28px">
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
      <tr>
        <td style="padding:8px 0">
          <span style="font-size:22px;font-weight:700">${escHtml(c.name)}</span>
        </td>
        <td align="right" style="padding:8px 0">
          <span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;color:#fff;background:${sColor}">${c.score}/100 — ${c.status}</span>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <tr style="background:#f9fafb">
        <td style="padding:8px 12px;font-size:13px;color:#6b7280;width:40%">MRR</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:600">$${(c.mrr||0).toLocaleString()}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#6b7280">CSM</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:600">${escHtml(c.manager || 'Unassigned')}</td>
      </tr>
      <tr style="background:#f9fafb">
        <td style="padding:8px 12px;font-size:13px;color:#6b7280">Tier</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:600">${escHtml(c.tier || '—')}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#6b7280">Days Since Contact</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:600">${c.days != null ? c.days : 'N/A'}</td>
      </tr>
      <tr style="background:#f9fafb">
        <td style="padding:8px 12px;font-size:13px;color:#6b7280">NPS</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:600">${escHtml(npsDisplay(c.nps))}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#6b7280">CSAT</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:600">${escHtml(csatDisplay(c.csat))}</td>
      </tr>
      ${changeRows}
    </table>
  </td></tr>
  <tr><td style="padding:0 28px 20px;font-size:11px;color:#9ca3af;text-align:center">
    iQcadence CS Health Score — ${new Date().toLocaleString()}
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

// ── Direct Channel Fan-out ──

async function fireDirectChannels(eventType, customer, extra) {
  const channels = automationsCfg.channels || {};

  function isSubscribed(chCfg) {
    if (!chCfg.alerts) return true; // backward compat: no alerts array = all
    return chCfg.alerts.includes(eventType);
  }

  // Slack
  if (channels.slack?.enabled && channels.slack?.url && isSubscribed(channels.slack)) {
    try {
      const payload = buildSlackPayload(eventType, customer, extra);
      await fireWebhook(eventType + '_slack', channels.slack.url, customer, extra, payload);
    } catch (e) { console.warn('Slack channel fire error:', e.message); }
  }

  // Teams
  if (channels.teams?.enabled && channels.teams?.url && isSubscribed(channels.teams)) {
    try {
      const payload = buildTeamsPayload(eventType, customer, extra);
      await fireWebhook(eventType + '_teams', channels.teams.url, customer, extra, payload);
    } catch (e) { console.warn('Teams channel fire error:', e.message); }
  }

  // Email
  if (channels.email?.enabled && channels.email?.recipients && isSubscribed(channels.email)) {
    try {
      await fireEmailAlert(eventType, customer, extra, channels.email);
    } catch (e) { console.warn('Email channel fire error:', e.message); }
  }
}

async function fireEmailAlert(eventType, customer, extra, emailCfg) {
  const htmlBody = buildAlertEmailHTML(eventType, customer, extra);
  const prefix = emailCfg.subject_prefix || '[iQcadence Alert]';
  const subject = `${prefix} ${_eventLabel(eventType)} — ${customer.name}`;

  const { data, error } = await sb.functions.invoke('send-webhook', {
    body: {
      mode: 'email',
      recipients: emailCfg.recipients,
      subject,
      html_body: htmlBody,
      event_type: eventType + '_email',
      customer_id: customer.id,
      customer_name: customer.name
    }
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}



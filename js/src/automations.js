// ─── AUTOMATIONS (Zapier Webhook Integration) ──────────────

function saveAutomationsCfg() {
  localStorage.setItem('iqc_automations', JSON.stringify(automationsCfg));
  const cid = getEffectiveClientId();
  if (currentUser && cid) {
    sb.from('settings').upsert({
      client_id:   cid,
      user_id:     currentUser.id,
      automations: JSON.stringify(automationsCfg),
      updated_at:  new Date().toISOString()
    }, { onConflict: 'client_id' }).then(({ error }) => {
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
  // Ensure report_schedules exists
  if (!automationsCfg.report_schedules) {
    automationsCfg.report_schedules = {};
  }
  // Ensure custom_rules array exists
  if (!automationsCfg.custom_rules) {
    automationsCfg.custom_rules = [];
  }
  // Migrate inline URLs to saved_connections
  if (!automationsCfg.saved_connections) {
    automationsCfg.saved_connections = [];
    if (automationsCfg.channels) {
      ['slack', 'teams', 'email'].forEach(function(chKey) {
        var ch = automationsCfg.channels[chKey];
        if (!ch) return;
        var isEmail = chKey === 'email';
        var hasValue = isEmail ? !!ch.recipients : !!ch.url;
        if (hasValue) {
          var conn = {
            id: generateConnectionId(),
            type: chKey,
            name: chKey === 'slack' ? 'Slack Channel' : chKey === 'teams' ? 'Teams Channel' : 'Email Recipients'
          };
          if (isEmail) {
            conn.recipients = ch.recipients;
            if (ch.subject_prefix) conn.subject_prefix = ch.subject_prefix;
          } else {
            conn.url = ch.url;
          }
          automationsCfg.saved_connections.push(conn);
          ch.connection_id = conn.id;
        }
      });
    }
    // Convert custom rule channel booleans to connection IDs
    (automationsCfg.custom_rules || []).forEach(function(rule) {
      if (!rule.channels) return;
      ['slack', 'teams', 'email'].forEach(function(chKey) {
        if (rule.channels[chKey] === true && automationsCfg.channels && automationsCfg.channels[chKey] && automationsCfg.channels[chKey].connection_id) {
          rule.channels[chKey] = automationsCfg.channels[chKey].connection_id;
        }
      });
    });
  }
  // Migrate legacy global alerts → alert_rules[]
  if (!automationsCfg.alert_rules && automationsCfg.selected_alerts && automationsCfg.selected_alerts.length) {
    var legacyRule = {
      id: 'ar-migrated-' + Date.now(),
      name: 'Migrated Alerts',
      enabled: true,
      alert_types: [].concat(automationsCfg.selected_alerts),
      settings: JSON.parse(JSON.stringify(automationsCfg.alert_settings || {})),
      channels: {},
      schedule: JSON.parse(JSON.stringify(automationsCfg.schedule || { mode: 'realtime' })),
      manager_scope: JSON.parse(JSON.stringify(automationsCfg.manager_scope || { mode: 'all', managers: [] })),
      created_at: new Date().toISOString(),
      created_by: (typeof currentUser !== 'undefined' && currentUser && currentUser.email) ? currentUser.email : 'system'
    };
    ['slack', 'teams', 'email'].forEach(function(k) {
      var ch = (automationsCfg.channels || {})[k];
      legacyRule.channels[k] = (ch && ch.enabled && ch.connection_id) ? ch.connection_id : false;
    });
    automationsCfg.alert_rules = [legacyRule];
  }
  if (!automationsCfg.alert_rules) automationsCfg.alert_rules = [];
}

function _newAlertRuleDraft() {
  return {
    id: 'ar-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    name: '',
    enabled: true,
    alert_types: [],
    settings: {},
    channels: { slack: false, teams: false, email: false },
    schedule: { mode: 'realtime' },
    manager_scope: { mode: 'all', managers: [] },
    created_at: new Date().toISOString(),
    created_by: (typeof currentUser !== 'undefined' && currentUser && currentUser.email) ? currentUser.email : ''
  };
}

// ── Help search ──
function helpSearch() {
  var q = (el('help-search').value || '').trim().toLowerCase();
  var panes = document.querySelectorAll('#view-help .dtab-pane');
  var tabs = el('help-tab-row');
  var cards = document.querySelectorAll('#view-help .help-card');
  if (!q) {
    tabs.style.display = '';
    panes.forEach(function(p){ p.style.display = ''; p.classList.remove('active'); });
    var activeBtn = document.querySelector('#view-help .dtab.active');
    if (!activeBtn) activeBtn = document.querySelector('#view-help .dtab');
    if (activeBtn) activeBtn.click();
    cards.forEach(function(s){ s.style.display = ''; });
    // Also show hero blocks
    document.querySelectorAll('#view-help .help-hero').forEach(function(h){ h.style.display = ''; });
    var countEl = document.getElementById('help-search-count');
    if (countEl) countEl.style.display = 'none';
    return;
  }
  tabs.style.display = 'none';
  panes.forEach(function(p){ p.style.display = 'block'; p.classList.add('active'); });
  // Hide hero blocks during search
  document.querySelectorAll('#view-help .help-hero').forEach(function(h){ h.style.display = 'none'; });
  // Split query into words for multi-word matching
  var words = q.split(/\s+/).filter(Boolean);
  var count = 0;
  cards.forEach(function(s){
    var text = s.textContent.toLowerCase();
    var kw = (s.getAttribute('data-keywords') || '').toLowerCase();
    var combined = text + ' ' + kw;
    var match = words.every(function(w){ return combined.indexOf(w) !== -1; });
    s.style.display = match ? '' : 'none';
    if (match) count++;
  });
  // Show result count
  var countEl = document.getElementById('help-search-count');
  if (!countEl) {
    countEl = document.createElement('div');
    countEl.id = 'help-search-count';
    countEl.style.cssText = 'font-size:var(--fs-sm);color:var(--muted);margin-bottom:10px';
    el('help-tab-row').parentNode.insertBefore(countEl, el('help-tab-row').nextSibling);
  }
  countEl.style.display = '';
  countEl.textContent = count + ' result' + (count !== 1 ? 's' : '') + ' for "' + q + '"';
}

// ── Help tab switching ──
function helpTab(t) {
  document.querySelectorAll('#view-help .dtab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#view-help .dtab-pane').forEach(p => p.classList.remove('active'));
  const btn = document.querySelector('#view-help .dtab[data-htab="' + t + '"]')
           || [...document.querySelectorAll('#view-help .dtab')].find(b => b.textContent.trim().toLowerCase().includes(t));
  if (btn) btn.classList.add('active');
  const pane = document.getElementById('help-pane-' + t);
  if (pane) pane.classList.add('active');
}

// ── Tab switching ──
function autoTab(which) {
  ['active','rules'].forEach(t => {
    el('auto-tab-'+t)?.classList.toggle('active', t === which);
    el('auto-pane-'+t)?.classList.toggle('active', t === which);
  });
  if (which === 'active') renderActiveAlerts();
  if (which === 'rules') renderCustomRulesList();
}

function openCreateAlertModal(ruleId) {
  if (ruleId) {
    var existing = (automationsCfg.alert_rules || []).find(function(r) { return r.id === ruleId; });
    if (existing) {
      _alertWizardDraft = JSON.parse(JSON.stringify(existing));
      _editingAlertRule = ruleId;
    } else {
      _alertWizardDraft = _newAlertRuleDraft();
      _editingAlertRule = null;
    }
  } else {
    _alertWizardDraft = _newAlertRuleDraft();
    _editingAlertRule = null;
  }
  _wizardStep = 1;
  openModal('create-alert-modal');
  wizardGoToStep(1);
  renderWizardNav();
}

function closeCreateAlertModal() {
  closeModal('create-alert-modal');
  _alertWizardDraft = null;
  _editingAlertRule = null;
  _wizardStep = 1;
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
    setup: `<ol style="margin:6px 0 0 18px;font-size:var(--fs-sm);line-height:1.6;color:var(--muted)">
      <li>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener" style="color:var(--blue)">api.slack.com/apps</a> and click <strong>Create New App</strong> → choose <strong>From Scratch</strong></li>
      <li>Name your app (e.g. "iQcadence Alerts") and select your workspace, then click <strong>Create App</strong></li>
      <li>In the left sidebar, click <strong>Incoming Webhooks</strong> and toggle <strong>Activate Incoming Webhooks</strong> to <strong>On</strong></li>
      <li>Scroll down and click <strong>Add New Webhook to Workspace</strong></li>
      <li>Select the channel where alerts should post (e.g. #cs-alerts) and click <strong>Allow</strong></li>
      <li>Copy the <strong>Webhook URL</strong> (starts with <code style="font-size:var(--fs-sm);background:var(--bg);padding:1px 4px;border-radius:3px">https://hooks.slack.com/services/...</code>) and paste it above</li>
      <li>Click <strong>Send Test</strong> below to verify — you should see a test message appear in your channel</li>
    </ol>
    <p style="margin:8px 0 0;font-size:var(--fs-sm);color:var(--subtle)"><strong>Tip:</strong> You can customize the bot name and icon in your Slack app settings under <strong>Basic Information</strong> → <strong>Display Information</strong>. Alerts will include customer name, score, status, and the triggering event.</p>`
  },
  {
    key: 'teams', label: 'Microsoft Teams', icon: _aico(AUTO_ICONS.teams),
    desc: 'Post alerts to a Teams channel via Workflows webhook.',
    inputType: 'url', placeholder: 'https://prod-xx.westus.logic.azure.com:443/workflows/...',
    setup: `<ol style="margin:6px 0 0 18px;font-size:var(--fs-sm);line-height:1.6;color:var(--muted)">
      <li>Open <strong>Microsoft Teams</strong> and go to the channel where you want alerts</li>
      <li>Click the <strong>+</strong> (Add a tab) or go to <strong>Apps</strong> → search for <strong>Workflows</strong></li>
      <li>Select the template <strong>"Post to a channel when a webhook request is received"</strong></li>
      <li>Name the workflow (e.g. "iQcadence Alerts"), select the target <strong>Team</strong> and <strong>Channel</strong>, then click <strong>Add workflow</strong></li>
      <li>Copy the <strong>Webhook URL</strong> provided (starts with <code style="font-size:var(--fs-sm);background:var(--bg);padding:1px 4px;border-radius:3px">https://prod-xx.westus.logic.azure.com...</code>) and paste it above</li>
      <li>Click <strong>Send Test</strong> below to verify — you should see a test card appear in your channel</li>
    </ol>
    <p style="margin:8px 0 0;font-size:var(--fs-sm);color:var(--subtle)"><strong>Note:</strong> Microsoft retired the old "Incoming Webhook" connector. Use the <strong>Workflows</strong> app instead. If you don\'t see Workflows, ask your Teams admin to enable it.</p>`
  },
  {
    key: 'email', label: 'Email', icon: _aico(AUTO_ICONS.email),
    desc: 'Send HTML email alerts to one or more recipients.',
    inputType: 'email', placeholder: 'alerts@yourcompany.com, csm-team@company.com',
    setup: `<div style="margin:6px 0 0;font-size:var(--fs-sm);line-height:1.6;color:var(--muted)">
      <p style="margin:0 0 6px">Enter one or more email addresses separated by commas. Each recipient gets a formatted HTML email with customer details, score changes, and the triggering event.</p>
      <p style="margin:0;font-size:var(--fs-sm);color:var(--subtle)"><strong>Requires setup:</strong> Email delivery uses <a href="https://resend.com" target="_blank" rel="noopener" style="color:var(--blue)">Resend</a>. Your Supabase project must have the <code style="font-size:var(--fs-xs);background:var(--bg);padding:1px 4px;border-radius:3px">RESEND_API_KEY</code> secret configured. Contact your admin if emails are not being delivered.</p>
    </div>`
  }
];

// ── Saved Connections helpers ──

function generateConnectionId() {
  return 'sc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function getConnectionsForType(type) {
  return (automationsCfg.saved_connections || []).filter(function(c) { return c.type === type; });
}

function resolveConnection(channelKey, connectionIdOverride) {
  var conns = automationsCfg.saved_connections || [];
  var chCfg = (automationsCfg.channels || {})[channelKey] || {};
  var cid = connectionIdOverride || chCfg.connection_id;
  if (cid) {
    var found = conns.find(function(c) { return c.id === cid; });
    if (found) return found;
  }
  // Legacy fallback: inline url/recipients
  if (channelKey === 'email' && chCfg.recipients) {
    return { id: null, type: 'email', name: '', recipients: chCfg.recipients, subject_prefix: chCfg.subject_prefix || '' };
  }
  if (chCfg.url) {
    return { id: null, type: channelKey, name: '', url: chCfg.url };
  }
  return null;
}

function saveConnection(conn) {
  if (!automationsCfg.saved_connections) automationsCfg.saved_connections = [];
  var idx = automationsCfg.saved_connections.findIndex(function(c) { return c.id === conn.id; });
  if (idx >= 0) automationsCfg.saved_connections[idx] = conn;
  else automationsCfg.saved_connections.push(conn);
  saveAutomationsCfg();
}

function deleteConnection(connId) {
  automationsCfg.saved_connections = (automationsCfg.saved_connections || []).filter(function(c) { return c.id !== connId; });
  ['slack','teams','email'].forEach(function(k) {
    if (automationsCfg.channels && automationsCfg.channels[k] && automationsCfg.channels[k].connection_id === connId) {
      delete automationsCfg.channels[k].connection_id;
    }
  });
  (automationsCfg.custom_rules || []).forEach(function(rule) {
    Object.keys(rule.channels || {}).forEach(function(k) {
      if (rule.channels[k] === connId) rule.channels[k] = false;
    });
  });
  (automationsCfg.alert_rules || []).forEach(function(rule) {
    Object.keys(rule.channels || {}).forEach(function(k) {
      if (rule.channels[k] === connId) rule.channels[k] = false;
    });
  });
  saveAutomationsCfg();
}

// ── Custom Rule Field Definitions ──
const RULE_FIELD_DEFS = [
  { key: 'score',     label: 'Health Score',        type: 'number', ops: ['lt','gt','lte','gte','eq','neq'] },
  { key: 'status',    label: 'Status',              type: 'enum',   ops: ['eq','neq'], options: ['critical','risk','watch','healthy','expand'] },
  { key: 'tier',      label: 'Tier',                type: 'enum',   ops: ['eq','neq'], options: ['smb','mid','enterprise'] },
  { key: 'lifecycle', label: 'Lifecycle',            type: 'enum',   ops: ['eq','neq'], options: ['onboarding','active','atrisk','churned','won'] },
  { key: 'logins',    label: 'Logins',              type: 'number', ops: ['lt','gt','lte','gte','eq','neq'] },
  { key: 'adoption',  label: 'Adoption %',          type: 'number', ops: ['lt','gt','lte','gte','eq','neq'] },
  { key: 'tickets',   label: 'Open Tickets',        type: 'number', ops: ['lt','gt','lte','gte','eq','neq'] },
  { key: 'nps',       label: 'NPS',                 type: 'number', ops: ['lt','gt','lte','gte','eq','neq'] },
  { key: 'csat',      label: 'CSAT',                type: 'number', ops: ['lt','gt','lte','gte','eq','neq'] },
  { key: 'mrr',       label: 'MRR ($)',             type: 'number', ops: ['lt','gt','lte','gte','eq','neq'] },
  { key: 'days',      label: 'Days Since Contact',  type: 'number', ops: ['lt','gt','lte','gte','eq','neq'] },
  { key: 'growth',    label: 'Growth Signal',        type: 'enum',   ops: ['eq','neq'], options: ['none','up','down','flat'] },
  { key: 'momentum',  label: 'Momentum',            type: 'enum',   ops: ['eq','neq'], options: ['up','dn','flat','new'] },
  { key: 'cadence_status', label: 'Cadence Status', type: 'enum',   ops: ['eq','neq'], options: ['ok','warn','overdue'] },
  { key: 'renewal_within', label: 'Renewal Within (days)', type: 'number', ops: ['lte','gte'] },
  { key: 'tags',      label: 'Tags',                type: 'text',   ops: ['contains','not_contains'] },
  { key: 'manager',   label: 'CSM / Manager',       type: 'text',   ops: ['eq','neq','contains'] }
];
const RULE_OP_LABELS = { lt:'<', gt:'>', lte:'≤', gte:'≥', eq:'=', neq:'≠', contains:'contains', not_contains:'not contains' };
const RULE_OP_LABELS_LONG = { lt:'is less than', gt:'is greater than', lte:'is at most', gte:'is at least', eq:'is', neq:'is not', contains:'contains', not_contains:'does not contain' };

let _wizardStep = 1;
let _inlineEditKey = null;
let _alertSortKey = 'label';
let _alertSortDir = 1;
let _alertFilters = {};
let _editingRule = null;
let _ruleBuilderData = null;
let _ruleWizardStep = 1;
let _openAlertFilterKey = null;
let _alertWizardDraft = null;   // draft alert rule being created/edited
let _editingAlertRule = null;   // ID of alert rule being edited, or null for new

// Custom rules sort/filter state
let _crSortKey = 'name';
let _crSortDir = 1;
let _crFilters = {};
let _openCrFilterKey = null;

const ALERT_COL_DEFS = [
  { key: 'label',     label: 'Alerts',      sortKey: 'label',     ftype: 'text' },
  { key: 'condition', label: 'Conditions',   sortKey: 'condition', ftype: 'text' },
  { key: 'sentTo',    label: 'Sent To',      sortKey: 'sentTo',   ftype: 'enum', enumVals: ['Slack', 'Teams', 'Email'] },
  { key: 'timing',    label: 'Timing',       sortKey: 'timing',   ftype: 'enum', enumVals: ['Real-time', 'Daily', 'Weekly'] },
  { key: 'scope',     label: 'Scope',        sortKey: 'scope',    ftype: 'text' },
  { key: 'creator',   label: 'Created By',   sortKey: 'creator',  ftype: 'text' },
];

const CUSTOM_COL_DEFS = [
  { key: 'name',      label: 'Rule',         sortKey: 'name',      ftype: 'text' },
  { key: 'condition', label: 'Conditions',    sortKey: 'condition', ftype: 'text' },
  { key: 'sentTo',    label: 'Sent To',       sortKey: 'sentTo',   ftype: 'enum', enumVals: ['Slack', 'Teams', 'Email'] },
  { key: 'creator',   label: 'Created By',    sortKey: 'creator',  ftype: 'text' },
];

// ── Active Alerts (Tab 1) ──

function truncateUrl(url, maxLen) {
  let s = (url || '').replace(/^https?:\/\//, '');
  return s.length > maxLen ? escHtml(s.slice(0, maxLen) + '…') : escHtml(s);
}

function sentToHtml(alertKey) {
  const ch = automationsCfg.channels || {};
  const parts = [];
  const subscribed = (chKey) => !alertKey || (ch[chKey]?.alerts || []).includes(alertKey);
  ['slack','teams','email'].forEach(function(chKey) {
    if (ch[chKey]?.enabled && subscribed(chKey)) {
      var conn = resolveConnection(chKey);
      var connName = conn && conn.name ? ' (' + escHtml(conn.name) + ')' : '';
      var tooltip = conn ? escHtml(chKey === 'email' ? (conn.recipients || '') : (conn.url || '')) : 'Not configured';
      var label = chKey === 'teams' ? 'Teams' : chKey.charAt(0).toUpperCase() + chKey.slice(1);
      parts.push('<span class="dest-tag" title="' + tooltip + '">' + _aicoSm(AUTO_ICONS[chKey]) + ' ' + label + connName + '</span>');
    }
  });
  return parts.length
    ? parts.join(' ')
    : '<span style="color:var(--muted);font-size:var(--fs-base)">' + _aicoSm(AUTO_ICONS.warning) + ' None</span>';
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

function _alertRowData(rule) {
  function conditionTextForKey(key, settings) {
    var s = settings[key] || {};
    switch (key) {
      case 'health_below_threshold': return 'Score < ' + (s.threshold || 50);
      case 'account_at_risk': return 'Status → risk/critical';
      case 'renewal_approaching': return 'Renewal ≤ ' + (s.days || 30) + 'd';
      case 'no_contact': return 'Silent ' + (s.max_days || 14) + 'd+';
      case 'nps_detractor': return 'NPS → detractor';
      case 'lifecycle_change': return 'Lifecycle → at-risk/churned';
      case 'rapid_score_drop': return 'Drop ≥ ' + (s.points || 15) + 'pts';
      default: return '';
    }
  }
  var alertLabel = rule.alert_types.map(function(key) {
    var at = ALERT_TYPES.find(function(a) { return a.key === key; });
    return at ? at.shortLabel : key;
  }).join(', ');
  var conditions = rule.alert_types.map(function(key) {
    return conditionTextForKey(key, rule.settings || {});
  }).filter(Boolean).join('; ');
  var sentToArr = [];
  ['slack','teams','email'].forEach(function(k) { if (rule.channels[k]) sentToArr.push(k === 'teams' ? 'Teams' : k.charAt(0).toUpperCase() + k.slice(1)); });
  var s = rule.schedule || { mode: 'realtime' };
  var timing = s.mode === 'daily' ? 'Daily' : s.mode === 'weekly' ? 'Weekly' : 'Real-time';
  var ms = rule.manager_scope || { mode: 'all', managers: [] };
  var scope = ms.mode === 'selected' && ms.managers.length > 0 ? ms.managers.join(', ') : 'All';
  return { label: alertLabel, condition: conditions, sentTo: sentToArr.join(', '), sentToArr: sentToArr, timing: timing, scope: scope, creator: rule.created_by || '' };
}

function _filterAlertRows(rules) {
  if (!Object.keys(_alertFilters).length) return rules;
  return rules.filter(function(rule) {
    var d = _alertRowData(rule);
    for (var key in _alertFilters) {
      var f = _alertFilters[key];
      var val = (d[key] || '').toLowerCase();
      if (f.type === 'text' && val.indexOf(f.q) === -1) return false;
      if (f.type === 'enum') {
        var match = false;
        f.vals.forEach(function(v) { if (val.indexOf(v.toLowerCase()) !== -1) match = true; });
        if (!match) return false;
      }
    }
    return true;
  });
}

function _sortAlertRows(rules) {
  if (!_alertSortKey) return rules;
  var sorted = rules.slice();
  sorted.sort(function(a, b) {
    var da = _alertRowData(a), db = _alertRowData(b);
    var va = (da[_alertSortKey] || '').toLowerCase(), vb = (db[_alertSortKey] || '').toLowerCase();
    return va < vb ? -_alertSortDir : va > vb ? _alertSortDir : 0;
  });
  return sorted;
}

function _buildSortFilterTh(colDefs, sortKey, sortDir, filters, sortFn, filterFn) {
  var funnelSVG = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';
  return colDefs.map(function(col) {
    var isActiveSort = col.sortKey && sortKey === col.sortKey;
    var filterActive = col.ftype && (col.key in filters);
    var hasSort = !!col.sortKey;
    var hasFilter = !!col.ftype;
    var labelEl = hasSort
      ? '<button class="col-sort-label" onclick="' + sortFn + '(\'' + col.sortKey + '\')">' + col.label + '</button>'
      : '<span class="col-sort-label no-sort">' + col.label + '</span>';
    var arrowEl = hasSort
      ? '<span class="col-sort-arrow' + (isActiveSort ? '' : ' idle') + '">' + (sortDir === -1 ? '▼' : '▲') + '</span>'
      : '';
    var filterEl = hasFilter
      ? '<button class="col-filter-btn' + (filterActive ? ' active' : '') + '" onclick="event.stopPropagation();' + filterFn + '(\'' + col.key + '\',this)" title="Filter ' + col.label + '">' + funnelSVG + '</button>'
      : '';
    return '<th><div class="col-th-inner">' + labelEl + arrowEl + filterEl + '</div></th>';
  }).join('');
}

function renderActiveAlerts() {
  const container = el('active-alerts-container');
  if (!container) return;

  var rules = automationsCfg.alert_rules || [];

  if (!rules.length) {
    container.innerHTML = '<div class="active-alerts-empty">' +
      '<div class="empty-icon">' + _aicoLg(AUTO_ICONS.bell) + '</div>' +
      '<h3 style="margin-bottom:6px">No alerts configured yet</h3>' +
      '<p style="font-size:var(--fs-md);margin-bottom:16px">Create your first alert to start monitoring customer health.</p>' +
      '<button class="btn btn-sm btn-primary" onclick="openCreateAlertModal()">+ Create Alert</button>' +
    '</div>';
    return;
  }

  // Apply filters then sort
  var filtered = _filterAlertRows(rules);
  var sorted = _sortAlertRows(filtered);

  function ruleSentToHtml(rule) {
    var parts = [];
    ['slack','teams','email'].forEach(function(k) {
      var connId = rule.channels[k];
      if (!connId) return;
      var conn = (automationsCfg.saved_connections || []).find(function(c) { return c.id === connId; });
      var label = k === 'teams' ? 'Teams' : k.charAt(0).toUpperCase() + k.slice(1);
      var connName = conn && conn.name ? ' (' + escHtml(conn.name) + ')' : '';
      parts.push('<span class="dest-tag">' + _aicoSm(AUTO_ICONS[k]) + ' ' + label + connName + '</span>');
    });
    return parts.length ? parts.join(' ') : '<span style="color:var(--muted);font-size:var(--fs-base)">' + _aicoSm(AUTO_ICONS.warning) + ' None</span>';
  }

  function ruleTimingLabel(rule) {
    var s = rule.schedule || { mode: 'realtime' };
    if (s.mode === 'daily') return _aicoSm(AUTO_ICONS.daily) + ' Daily';
    if (s.mode === 'weekly') return _aicoSm(AUTO_ICONS.weekly) + ' Weekly';
    return _aicoSm(AUTO_ICONS.realtime) + ' Real-time';
  }

  function ruleScopeDisplay(rule) {
    var ms = rule.manager_scope || { mode: 'all', managers: [] };
    return ms.mode === 'selected' && ms.managers.length > 0 ? ms.managers.map(function(m) { return escHtml(m); }).join(', ') : 'All';
  }

  var rows = sorted.map(function(rule) {
    var alertLabels = rule.alert_types.map(function(key) {
      var at = ALERT_TYPES.find(function(a) { return a.key === key; });
      return at ? '<span style="display:inline-flex;align-items:center;gap:3px;margin-right:6px;white-space:nowrap"><span style="color:var(--blue)">' + _aicoSm(AUTO_ICONS[key]) + '</span>' + escHtml(at.shortLabel) + '</span>' : '';
    }).join('');

    var d = _alertRowData(rule);
    var scope = ruleScopeDisplay(rule);
    var disabledStyle = rule.enabled ? '' : 'opacity:.5;';

    return '<tr style="' + disabledStyle + '">' +
      '<td style="max-width:250px;line-height:1.5">' + alertLabels + '</td>' +
      '<td style="color:var(--muted);font-size:var(--fs-sm);max-width:200px">' + escHtml(d.condition) + '</td>' +
      '<td>' + ruleSentToHtml(rule) + '</td>' +
      '<td style="font-size:var(--fs-base);white-space:nowrap">' + ruleTimingLabel(rule) + '</td>' +
      '<td style="font-size:var(--fs-base);color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis" title="' + escHtml(scope) + '">' + scope + '</td>' +
      '<td style="font-size:var(--fs-base);color:var(--muted)">' + escHtml(rule.created_by || '\u2014') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<label class="toggle-switch toggle-sm" style="vertical-align:middle;margin-right:6px" title="' + (rule.enabled ? 'Enabled' : 'Disabled') + '">' +
          '<input type="checkbox" ' + (rule.enabled ? 'checked' : '') + ' onchange="toggleAlertRule(\'' + escHtml(rule.id) + '\', this.checked)"/>' +
          '<span class="toggle-slider"></span>' +
        '</label>' +
        '<button class="btn btn-xs btn-ghost" onclick="openCreateAlertModal(\'' + escHtml(rule.id) + '\')" title="Edit">' + _aicoSm(AUTO_ICONS.edit) + '</button> ' +
        '<button class="btn btn-xs btn-ghost" style="color:var(--red)" onclick="deleteAlertRule(\'' + escHtml(rule.id) + '\')" title="Delete">' + _aicoSm(AUTO_ICONS.x) + '</button>' +
      '</td></tr>';
  }).join('');

  var headerRow = _buildSortFilterTh(ALERT_COL_DEFS, _alertSortKey, _alertSortDir, _alertFilters, 'alertSortBy', 'openAlertFilter') +
    '<th style="width:120px"><div class="col-th-inner"><span class="col-sort-label no-sort">Actions</span></div></th>';

  var filterPills = _buildFilterPills(_alertFilters, ALERT_COL_DEFS, 'openAlertFilter', 'clearAlertFilter');

  container.innerHTML = filterPills +
    '<table class="alert-summary-table">' +
    '<thead><tr>' + headerRow + '</tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';
}

// ── Thin wrapper — keeps existing callers working ──
function renderAlertSummary() { renderActiveAlerts(); }

function deleteAlertRule(ruleId) {
  if (!confirm('Delete this alert rule? This cannot be undone.')) return;
  automationsCfg.alert_rules = (automationsCfg.alert_rules || []).filter(function(r) { return r.id !== ruleId; });
  saveAutomationsCfg();
  renderActiveAlerts();
  toast('Alert rule deleted', 'success');
}

function toggleAlertRule(ruleId, enabled) {
  var rule = (automationsCfg.alert_rules || []).find(function(r) { return r.id === ruleId; });
  if (rule) { rule.enabled = enabled; saveAutomationsCfg(); renderActiveAlerts(); }
}

// ── Inline Edit Helpers ──

function toggleInlineEdit(alertKey) {
  _inlineEditKey = (_inlineEditKey === alertKey) ? null : alertKey;
  renderAlertSummary();
}

function closeInlineEdit() {
  _inlineEditKey = null;
  renderAlertSummary();
}

function toggleChannelInline(channelKey, alertKey, enabled) {
  if (!automationsCfg.channels) automationsCfg.channels = {};
  if (!automationsCfg.channels[channelKey]) automationsCfg.channels[channelKey] = { enabled: true, alerts: [] };
  if (!automationsCfg.channels[channelKey].alerts) automationsCfg.channels[channelKey].alerts = [];
  const arr = automationsCfg.channels[channelKey].alerts;
  if (enabled && !arr.includes(alertKey)) arr.push(alertKey);
  if (!enabled) automationsCfg.channels[channelKey].alerts = arr.filter(a => a !== alertKey);
  saveAutomationsCfg();
  renderAlertSummary();
}

function wizardRemoveAlert(key) {
  automationsCfg.selected_alerts = (automationsCfg.selected_alerts || []).filter(a => a !== key);
  // Remove from all channels' alerts arrays
  ['slack','teams','email'].forEach(chKey => {
    if (automationsCfg.channels?.[chKey]?.alerts)
      automationsCfg.channels[chKey].alerts = automationsCfg.channels[chKey].alerts.filter(a => a !== key);
  });
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

// ── Shared filter pill bar builder ──
function _buildFilterPills(filters, colDefs, openFn, clearFn) {
  var keys = Object.keys(filters);
  if (!keys.length) return '';
  var pills = keys.map(function(key) {
    var f = filters[key];
    var def = colDefs.find(function(d) { return d.key === key; });
    var label = def ? def.label : key;
    var summary = '';
    if (f.type === 'text') summary = '"' + (f.q || '').slice(0, 20) + '"';
    else if (f.type === 'enum') {
      var arr = []; f.vals.forEach(function(v) { arr.push(v); });
      summary = arr.length <= 3 ? arr.join(', ') : arr.slice(0, 3).join(', ') + ' +' + (arr.length - 3);
    }
    return '<span class="filter-pill">' + escHtml(label) + ': ' + summary +
      '<button class="filter-pill-x" onclick="event.stopPropagation();' + clearFn + '(\'' + key + '\')" title="Remove filter">✕</button></span>';
  }).join('');
  return '<div class="auto-filter-pill-bar" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">' + pills + '</div>';
}

// ── Custom Rules Sort & Filter Functions ──

function crSortBy(key) {
  if (_crSortKey === key) _crSortDir *= -1;
  else { _crSortKey = key; _crSortDir = 1; }
  renderCustomRulesList();
}

function openCrFilter(key, btnEl) {
  if (_openCrFilterKey === key) { closeCrFilter(); return; }
  closeCrFilter();
  _openCrFilterKey = key;
  const col = CUSTOM_COL_DEFS.find(c => c.key === key);
  const menu = document.getElementById('alert-filter-portal');
  menu.innerHTML = _buildCrFilterMenu(col);
  menu.classList.add('open');
  const rect = (btnEl.closest('th') || btnEl).getBoundingClientRect();
  menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  menu.style.left = (rect.left   + window.scrollX)      + 'px';
  requestAnimationFrame(() => {
    const mr = menu.getBoundingClientRect();
    if (mr.right > window.innerWidth - 8)
      menu.style.left = (window.innerWidth - mr.width - 8 + window.scrollX) + 'px';
  });
  _populateCrFilterUI(key, col);
  setTimeout(() => menu.querySelector('input')?.focus(), 30);
}

function closeCrFilter() {
  const menu = document.getElementById('alert-filter-portal');
  if (menu) { menu.classList.remove('open'); menu.innerHTML = ''; }
  _openCrFilterKey = null;
}

function _buildCrFilterMenu(col) {
  let body = '';
  if (col.ftype === 'enum') {
    const vals = col.enumVals || [];
    body = '<div class="cff-enum-list">' + vals.map(v =>
      '<label class="cff-check-item">' +
        '<input type="checkbox" value="' + escHtml(v) + '" class="cr-enum-cb" onchange="applyCrFilterLive()"> ' +
        escHtml(v) +
      '</label>'
    ).join('') + '</div>';
  } else if (col.ftype === 'text') {
    body = '<input class="cff-text-input" id="cr-text" type="text" placeholder="Search ' + col.label.toLowerCase() + '…" oninput="applyCrFilterLive()" autocomplete="off">';
  }
  return '<div class="col-filter-hd">' +
      '<span class="col-filter-title">Filter: ' + col.label + '</span>' +
      '<button class="col-filter-clear" onclick="clearCrFilter(\'' + col.key + '\')">Clear</button>' +
    '</div>' +
    '<div class="col-filter-body">' + body + '</div>';
}

function _populateCrFilterUI(key, col) {
  const f = _crFilters[key];
  if (!f) return;
  if (col.ftype === 'enum') {
    document.querySelectorAll('.cr-enum-cb').forEach(cb => { cb.checked = f.vals.has(cb.value); });
  } else if (col.ftype === 'text') {
    const inp = document.getElementById('cr-text');
    if (inp) inp.value = f.q || '';
  }
}

function applyCrFilterLive() {
  const key = _openCrFilterKey;
  if (!key) return;
  const col = CUSTOM_COL_DEFS.find(c => c.key === key);
  if (!col) return;
  if (col.ftype === 'enum') {
    const checked = [...document.querySelectorAll('.cr-enum-cb:checked')].map(cb => cb.value);
    if (checked.length) _crFilters[key] = { type: 'enum', vals: new Set(checked) };
    else delete _crFilters[key];
  } else if (col.ftype === 'text') {
    const q = (document.getElementById('cr-text')?.value || '').trim().toLowerCase();
    if (q) _crFilters[key] = { type: 'text', q };
    else delete _crFilters[key];
  }
  renderCustomRulesList();
}

function clearCrFilter(key) {
  delete _crFilters[key];
  closeCrFilter();
  renderCustomRulesList();
}

function clearAllCrFilters() {
  _crFilters = {};
  closeCrFilter();
  renderCustomRulesList();
}

// ── Wizard Navigation (clickable stepper, animated transitions) ──

function wizardGoToStep(step) {
  // Validate current step before advancing
  if (step > _wizardStep) {
    if (_wizardStep === 1) {
      const mgrScope = _alertWizardDraft ? _alertWizardDraft.manager_scope : { mode: 'all', managers: [] };
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
  if (!_alertWizardDraft) return;
  // Validate: at least one alert type selected
  if (!_alertWizardDraft.alert_types.length) {
    toast('Select at least one alert type', 'error');
    return;
  }
  // Validate: at least one channel with a configured connection
  var hasConfigured = false;
  var missingConn = [];
  ['slack', 'teams', 'email'].forEach(function(k) {
    var connId = _alertWizardDraft.channels[k];
    if (connId) {
      var conn = (automationsCfg.saved_connections || []).find(function(c) { return c.id === connId; });
      if (conn && (conn.url || conn.recipients)) {
        hasConfigured = true;
      } else {
        var label = k === 'teams' ? 'Microsoft Teams' : k.charAt(0).toUpperCase() + k.slice(1);
        missingConn.push(label);
      }
    }
  });
  if (!hasConfigured && missingConn.length === 0) {
    toast('Enable at least one delivery channel and select a connection', 'error');
    return;
  }
  if (missingConn.length > 0) {
    toast(missingConn.join(', ') + ' enabled but no connection configured — please select or add one', 'error');
    return;
  }
  // Auto-generate name if empty
  if (!_alertWizardDraft.name || !_alertWizardDraft.name.trim()) {
    _alertWizardDraft.name = _alertWizardDraft.alert_types
      .map(function(k) { var at = ALERT_TYPES.find(function(a) { return a.key === k; }); return at ? at.shortLabel : k; })
      .slice(0, 3).join(', ') + (_alertWizardDraft.alert_types.length > 3 ? ' +' + (_alertWizardDraft.alert_types.length - 3) + ' more' : '');
  }
  // Ensure defaults for settings of configurable alert types
  _alertWizardDraft.alert_types.forEach(function(key) {
    var at = ALERT_TYPES.find(function(a) { return a.key === key; });
    if (at && at.configFields.length > 0 && !_alertWizardDraft.settings[key]) {
      _alertWizardDraft.settings[key] = {};
      at.configFields.forEach(function(f) { _alertWizardDraft.settings[key][f.name] = f.default; });
    }
  });
  // Save to alert_rules
  if (!automationsCfg.alert_rules) automationsCfg.alert_rules = [];
  if (_editingAlertRule) {
    var idx = automationsCfg.alert_rules.findIndex(function(r) { return r.id === _editingAlertRule; });
    if (idx >= 0) automationsCfg.alert_rules[idx] = _alertWizardDraft;
    else automationsCfg.alert_rules.push(_alertWizardDraft);
  } else {
    automationsCfg.alert_rules.push(_alertWizardDraft);
  }
  var wasEdit = !!_editingAlertRule;
  saveAutomationsCfg();
  _alertWizardDraft = null;
  _editingAlertRule = null;
  _wizardStep = 1;
  closeModal('create-alert-modal');
  renderActiveAlerts();
  toast(wasEdit ? 'Alert rule updated!' : 'Alert rule created!', 'success');
}

// ── Step 1: Choose Your Alerts (2-column grid) ──

function renderWizardStep1() {
  const pane = el('wizard-pane-1');
  if (!pane || !_alertWizardDraft) return;
  const selected = _alertWizardDraft.alert_types;

  const cards = ALERT_TYPES.map(at => {
    const isSel = selected.includes(at.key);
    return '<div class="wizard-alert-card ' + (isSel ? 'selected' : '') + '" onclick="wizardToggleAlert(\'' + at.key + '\')" data-alert-key="' + at.key + '">' +
      '<div class="wizard-alert-card__check">' + (isSel ? _aicoSm(AUTO_ICONS.check) : '') + '</div>' +
      '<span style="flex-shrink:0;display:flex;align-items:center;color:var(--blue)">' + at.icon + '</span>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:600;font-size:var(--fs-md)">' + escHtml(at.label) + '</div>' +
        '<div style="font-size:var(--fs-sm);color:var(--muted);margin-top:2px">' + escHtml(at.desc) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  // Build manager scope section
  const mgrScope = _alertWizardDraft.manager_scope || { mode: 'all', managers: [] };
  const allManagers = [...new Set(customers.map(c => c.manager || '').filter(Boolean))].sort();
  const mgrScopeHtml = '<div style="margin-top:24px;margin-bottom:14px">' +
    '<h3 style="margin:0;font-size:1rem">Who should alerts cover?</h3>' +
    '<p style="font-size:var(--fs-base);color:var(--muted);margin:4px 0 0">Scope alerts to specific managers or monitor all accounts.</p>' +
  '</div>' +
  '<div class="wizard-schedule-option ' + (mgrScope.mode === 'all' ? 'active' : '') + '" onclick="setManagerScopeMode(\'all\')">' +
    '<input type="radio" name="mgr-scope-mode" value="all"' + (mgrScope.mode === 'all' ? ' checked' : '') + ' onclick="event.stopPropagation();setManagerScopeMode(\'all\')"/>' +
    '<div style="flex:1"><div style="font-weight:600;font-size:var(--fs-md);display:flex;align-items:center;gap:6px">' + _aico(AUTO_ICONS.allMgrs) + ' All Managers</div>' +
    '<div style="font-size:var(--fs-sm);color:var(--muted);margin-top:2px">Alerts fire for every customer regardless of manager</div></div>' +
  '</div>' +
  '<div class="wizard-schedule-option ' + (mgrScope.mode === 'selected' ? 'active' : '') + '" onclick="setManagerScopeMode(\'selected\')">' +
    '<input type="radio" name="mgr-scope-mode" value="selected"' + (mgrScope.mode === 'selected' ? ' checked' : '') + ' onclick="event.stopPropagation();setManagerScopeMode(\'selected\')"/>' +
    '<div style="flex:1"><div style="font-weight:600;font-size:var(--fs-md);display:flex;align-items:center;gap:6px">' + _aico(AUTO_ICONS.selMgrs) + ' Selected Managers</div>' +
    '<div style="font-size:var(--fs-sm);color:var(--muted);margin-top:2px">Only fire alerts for accounts owned by chosen managers</div>' +
    (mgrScope.mode === 'selected' ? '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">' +
      allManagers.map(m => {
        const checked = (mgrScope.managers || []).includes(m);
        return '<label onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:4px;font-size:var(--fs-base);cursor:pointer">' +
          '<input type="checkbox"' + (checked ? ' checked' : '') + ' onchange="event.stopPropagation();toggleManagerScope(\'' + escHtml(m).replace(/'/g, "\\'") + '\', this.checked)"/> ' + escHtml(m) +
        '</label>';
      }).join('') +
    '</div>' : '') +
    '</div>' +
  '</div>';

  pane.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
    '<div>' +
      '<h3 style="margin:0;font-size:1rem">Which alerts do you want?</h3>' +
      '<p style="font-size:var(--fs-base);color:var(--muted);margin:4px 0 0">Select the conditions that should trigger notifications.</p>' +
    '</div>' +
    '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-xs btn-ghost" onclick="wizardSelectAll()" style="font-size:var(--fs-sm)">Select All</button>' +
      '<button class="btn btn-xs btn-ghost" onclick="wizardClearAll()" style="font-size:var(--fs-sm);color:var(--muted)">Clear</button>' +
    '</div>' +
  '</div>' +
  '<div class="wizard-alert-grid">' + cards + '</div>' +
  mgrScopeHtml;
}

function wizardToggleAlert(key) {
  if (!_alertWizardDraft) return;
  const idx = _alertWizardDraft.alert_types.indexOf(key);
  if (idx >= 0) _alertWizardDraft.alert_types.splice(idx, 1);
  else _alertWizardDraft.alert_types.push(key);
  renderWizardStep1();
}

function wizardSelectAll() {
  if (!_alertWizardDraft) return;
  _alertWizardDraft.alert_types = ALERT_TYPES.map(a => a.key);
  renderWizardStep1();
}

function wizardClearAll() {
  if (!_alertWizardDraft) return;
  _alertWizardDraft.alert_types = [];
  renderWizardStep1();
}

// ── Step 2: Configure Thresholds ──

function renderWizardStep2() {
  const pane = el('wizard-pane-2');
  if (!pane || !_alertWizardDraft) return;
  const selected = _alertWizardDraft.alert_types;
  const settings = _alertWizardDraft.settings;

  // Only show alerts that are selected AND have configurable fields
  const configurable = ALERT_TYPES.filter(at => selected.includes(at.key) && at.configFields.length > 0);

  if (!configurable.length) {
    pane.innerHTML = '<div style="text-align:center;padding:40px 20px">' +
      '<div style="font-size:2rem;margin-bottom:12px;color:var(--green)">' + _aicoLg(AUTO_ICONS.checkCircle) + '</div>' +
      '<h3 style="margin:0;font-size:1rem">No thresholds to configure</h3>' +
      '<p style="font-size:var(--fs-base);color:var(--muted);margin-top:6px">Your selected alerts use automatic detection \u2014 no thresholds needed.</p>' +
    '</div>';
    return;
  }

  const cards = configurable.map(at => {
    const atSettings = settings[at.key] || {};
    const fields = at.configFields.map(f => {
      const val = atSettings[f.name] ?? f.default;
      return '<div style="display:flex;align-items:center;gap:10px;margin-top:10px">' +
        '<label style="font-size:var(--fs-base);font-weight:600;white-space:nowrap;min-width:160px">' + escHtml(f.label) + '</label>' +
        '<input type="' + f.type + '" min="' + f.min + '" max="' + f.max + '" value="' + val + '"' +
        ' onchange="updateAlertSetting(\'' + at.key + '\', \'' + f.name + '\', +this.value)"' +
        ' style="width:90px;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:var(--fs-md);font-family:var(--font);color:var(--text);background:var(--surface);text-align:center"/>' +
        '<span style="font-size:var(--fs-sm);color:var(--muted)">' + escHtml(f.hint) + '</span>' +
      '</div>';
    }).join('');

    return '<div class="wizard-threshold-card">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<span style="flex-shrink:0;display:flex;align-items:center;color:var(--blue)">' + at.icon + '</span>' +
        '<div style="font-weight:600;font-size:var(--fs-md)">' + escHtml(at.label) + '</div>' +
      '</div>' +
      fields +
    '</div>';
  }).join('');

  pane.innerHTML = '<div style="margin-bottom:16px">' +
    '<h3 style="margin:0;font-size:1rem">Set your thresholds</h3>' +
    '<p style="font-size:var(--fs-base);color:var(--muted);margin:4px 0 0">Configure when each alert should fire. Only alerts with adjustable thresholds are shown.</p>' +
  '</div>' + cards;
}

function updateAlertSetting(alertKey, fieldName, value) {
  if (_alertWizardDraft) {
    if (!_alertWizardDraft.settings[alertKey]) _alertWizardDraft.settings[alertKey] = {};
    _alertWizardDraft.settings[alertKey][fieldName] = value;
  }
}

// ── Step 3: Delivery & Schedule ──

function renderWizardStep3() {
  const pane = el('wizard-pane-3');
  if (!pane || !_alertWizardDraft) return;
  const draftChannels = _alertWizardDraft.channels;
  const schedule = _alertWizardDraft.schedule || { mode: 'realtime' };

  // Build channel rows
  const channelRows = CHANNELS.map(ch => {
    const connId = draftChannels[ch.key];
    const isEnabled = !!connId;

    let configInputs = '';
    if (isEnabled) {
      configInputs = renderConnectionSelector(ch, connId, 'onWizardConnectionChange', 'wizard');
    }

    return '<div class="wizard-channel-row">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<span style="flex-shrink:0;display:flex;align-items:center;color:var(--blue)">' + ch.icon + '</span>' +
          '<div>' +
            '<div style="font-weight:600;font-size:var(--fs-md)">' + escHtml(ch.label) + '</div>' +
            '<div style="font-size:var(--fs-sm);color:var(--muted)">' + escHtml(ch.desc) + '</div>' +
          '</div>' +
        '</div>' +
        '<label class="toggle-switch">' +
          '<input type="checkbox" ' + (isEnabled ? 'checked' : '') +
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
        '<label style="font-size:var(--fs-sm);font-weight:600">Time</label>' +
        '<input type="time" value="' + (schedule.daily_time || '09:00') + '"' +
        ' onchange="updateSchedule(\'daily_time\', this.value)"' +
        ' style="padding:5px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:var(--fs-base);font-family:var(--font);color:var(--text);background:var(--surface)"/>' +
      '</div>';
    }
    if (opt.mode === 'weekly' && isActive) {
      extra = '<div style="margin-top:8px;display:flex;align-items:center;gap:12px">' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<label style="font-size:var(--fs-sm);font-weight:600">Day</label>' +
          '<select onchange="updateSchedule(\'weekly_day\', this.value)"' +
          ' style="padding:5px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:var(--fs-base);font-family:var(--font);color:var(--text);background:var(--surface)">' +
            ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d =>
              '<option value="' + d + '"' + (schedule.weekly_day === d ? ' selected' : '') + '>' + d.charAt(0).toUpperCase() + d.slice(1) + '</option>'
            ).join('') +
          '</select>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<label style="font-size:var(--fs-sm);font-weight:600">Time</label>' +
          '<input type="time" value="' + (schedule.weekly_time || '09:00') + '"' +
          ' onchange="updateSchedule(\'weekly_time\', this.value)"' +
          ' style="padding:5px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:var(--fs-base);font-family:var(--font);color:var(--text);background:var(--surface)"/>' +
        '</div>' +
      '</div>';
    }
    return '<div class="wizard-schedule-option ' + (isActive ? 'active' : '') + '" onclick="setScheduleMode(\'' + opt.mode + '\')">' +
      '<input type="radio" name="schedule-mode" value="' + opt.mode + '"' + (isActive ? ' checked' : '') + ' onclick="event.stopPropagation();setScheduleMode(\'' + opt.mode + '\')"/>' +
      '<div style="flex:1">' +
        '<div style="font-weight:600;font-size:var(--fs-md);display:flex;align-items:center;gap:6px">' + opt.icon + ' ' + escHtml(opt.label) + '</div>' +
        '<div style="font-size:var(--fs-sm);color:var(--muted);margin-top:2px">' + escHtml(opt.desc) + '</div>' +
        extra +
      '</div>' +
    '</div>';
  }).join('');

  pane.innerHTML = '<div style="margin-bottom:18px">' +
    '<h3 style="margin:0;font-size:1rem">Where should alerts be sent?</h3>' +
    '<p style="font-size:var(--fs-base);color:var(--muted);margin:4px 0 0">Enable your delivery channels and configure their connection details.</p>' +
  '</div>' +
  channelRows +
  '<div style="margin-top:24px;margin-bottom:14px">' +
    '<h3 style="margin:0;font-size:1rem">When should alerts fire?</h3>' +
    '<p style="font-size:var(--fs-base);color:var(--muted);margin:4px 0 0">Choose how quickly you want to be notified.</p>' +
  '</div>' +
  scheduleHtml +
  '<p style="font-size:var(--fs-sm);color:var(--muted);margin-top:12px;font-style:italic">' +
    'Note: Daily and weekly digests require server-side scheduling (coming soon). All alerts currently fire in real-time.' +
  '</p>';
}

function setScheduleMode(mode) {
  if (_alertWizardDraft) {
    _alertWizardDraft.schedule.mode = mode;
    renderWizardStep3();
  }
}

function updateSchedule(field, value) {
  if (_alertWizardDraft) {
    _alertWizardDraft.schedule[field] = value;
  }
}

function setManagerScopeMode(mode) {
  if (_alertWizardDraft) {
    _alertWizardDraft.manager_scope.mode = mode;
    renderWizardStep1();
  }
}

function toggleManagerScope(manager, checked) {
  if (_alertWizardDraft) {
    var arr = _alertWizardDraft.manager_scope.managers;
    if (checked && !arr.includes(manager)) arr.push(manager);
    if (!checked) _alertWizardDraft.manager_scope.managers = arr.filter(m => m !== manager);
    renderWizardStep1();
  }
}

// ── Channel helpers ──

function toggleChannel(key, enabled) {
  if (_alertWizardDraft) {
    if (enabled) {
      // Default to first saved connection
      var conns = getConnectionsForType(key);
      _alertWizardDraft.channels[key] = conns.length > 0 ? conns[0].id : false;
    } else {
      _alertWizardDraft.channels[key] = false;
    }
    renderWizardStep3();
    toast(enabled ? CHANNELS.find(c=>c.key===key)?.label + ' enabled' : CHANNELS.find(c=>c.key===key)?.label + ' disabled', 'success');
  }
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

// ── Connection selector UI ──

function renderConnectionSelector(ch, currentConnectionId, onChangeName, context) {
  var conns = getConnectionsForType(ch.key);
  var isEmail = ch.key === 'email';
  var conn = currentConnectionId
    ? (automationsCfg.saved_connections || []).find(function(c) { return c.id === currentConnectionId; })
    : null;

  var html = '<div style="margin-top:10px">';

  // Dropdown
  html += '<div class="field" style="margin-bottom:8px">' +
    '<label style="font-size:var(--fs-sm);font-weight:600;margin-bottom:3px;display:block">Connection</label>' +
    '<select id="conn-sel-' + context + '-' + ch.key + '"' +
    ' onchange="' + onChangeName + '(\'' + ch.key + '\', this.value)"' +
    ' style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:var(--fs-base);font-family:var(--font);color:var(--text);background:var(--surface)">';

  html += '<option value="">— Select a connection —</option>';
  conns.forEach(function(c) {
    var label = c.name + (isEmail ? ' (' + (c.recipients || '') + ')' : '');
    html += '<option value="' + c.id + '"' + (c.id === currentConnectionId ? ' selected' : '') + '>' + escHtml(label) + '</option>';
  });
  html += '<option value="__new__">+ Add new connection…</option>';
  html += '</select></div>';

  // Selected connection details
  if (conn) {
    var value = isEmail ? (conn.recipients || '') : (conn.url || '');
    html += '<div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:6px;word-break:break-all">' +
      (isEmail ? '📧 ' : '🔗 ') + escHtml(value) + '</div>';
    if (isEmail && conn.subject_prefix) {
      html += '<div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:6px">Subject: ' + escHtml(conn.subject_prefix) + '</div>';
    }
    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<button class="btn btn-xs btn-outline" onclick="testChannel(\'' + ch.key + '\', \'' + conn.id + '\')"' +
        (!value ? ' disabled title="No ' + (isEmail ? 'recipients' : 'URL') + ' configured"' : '') + '>' +
        _aicoSm(AUTO_ICONS.realtime) + ' Send Test</button>' +
      '<button class="btn btn-xs btn-ghost" onclick="editSavedConnection(\'' + conn.id + '\', \'' + context + '\', \'' + ch.key + '\')" style="color:var(--blue)">✏️ Edit</button>' +
      '<button class="btn btn-xs btn-ghost" onclick="deleteSavedConnectionUI(\'' + conn.id + '\', \'' + context + '\', \'' + ch.key + '\')" style="color:var(--red)">🗑 Remove</button>' +
      '<span id="ch-test-status-' + ch.key + '" style="font-size:var(--fs-sm);color:var(--muted)"></span>' +
    '</div>';
  }

  // Add new / edit form (initially hidden)
  html += '<div id="conn-form-' + context + '-' + ch.key + '" style="display:none;margin-top:10px;padding:12px;border:1.5px dashed var(--border);border-radius:8px;background:var(--bg)">';
  html += '<div class="field" style="margin-bottom:8px">' +
    '<label style="font-size:var(--fs-sm);font-weight:600;margin-bottom:3px;display:block">Connection Name</label>' +
    '<input type="text" id="conn-name-' + context + '-' + ch.key + '"' +
    ' placeholder="e.g. #cs-alerts"' +
    ' style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:var(--fs-base);font-family:var(--font);color:var(--text);background:var(--surface)"/></div>';

  html += '<div class="field" style="margin-bottom:8px">' +
    '<label style="font-size:var(--fs-sm);font-weight:600;margin-bottom:3px;display:block">' + (isEmail ? 'Recipients' : 'Webhook URL') + '</label>' +
    '<input type="' + ch.inputType + '" id="conn-value-' + context + '-' + ch.key + '"' +
    ' placeholder="' + escHtml(ch.placeholder) + '"' +
    ' style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:var(--fs-base);font-family:var(--font);color:var(--text);background:var(--surface)"/></div>';

  if (isEmail) {
    html += '<div class="field" style="margin-bottom:8px;display:flex;align-items:center;gap:8px">' +
      '<label style="font-size:var(--fs-sm);font-weight:600;white-space:nowrap">Subject Prefix</label>' +
      '<input type="text" id="conn-subject-' + context + '-' + ch.key + '"' +
      ' placeholder="[iQcadence Alert]" value="[iQcadence Alert]"' +
      ' style="width:200px;padding:6px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:var(--fs-base);font-family:var(--font);color:var(--text);background:var(--surface)"/></div>';
  }

  html += '<div style="display:flex;gap:8px;margin-top:8px">' +
    '<button class="btn btn-xs btn-primary" onclick="saveConnectionForm(\'' + ch.key + '\', \'' + context + '\')">Save Connection</button>' +
    '<button class="btn btn-xs btn-ghost" onclick="cancelConnectionForm(\'' + ch.key + '\', \'' + context + '\')">Cancel</button>' +
  '</div>';

  html += '<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--blue);font-size:var(--fs-sm);font-weight:600">Setup Instructions</summary>' + ch.setup + '</details>';
  html += '</div>'; // close form
  html += '</div>'; // close outer
  return html;
}

// ── Connection selector event handlers ──

function onWizardConnectionChange(chKey, value) {
  if (value === '__new__') {
    var form = el('conn-form-wizard-' + chKey);
    if (form) { form.style.display = 'block'; form.dataset.editingId = ''; }
    return;
  }
  if (_alertWizardDraft) {
    _alertWizardDraft.channels[chKey] = value || false;
    renderWizardStep3();
  }
}

function onRuleConnectionChange(chKey, value) {
  if (value === '__new__') {
    var form = el('conn-form-rule-' + chKey);
    if (form) { form.style.display = 'block'; form.dataset.editingId = ''; }
    return;
  }
  if (!_ruleBuilderData) return;
  if (!_ruleBuilderData.channels) _ruleBuilderData.channels = {};
  _ruleBuilderData.channels[chKey] = value || false;
  renderRuleBuilderBody();
}

function saveConnectionForm(chKey, context) {
  var form = el('conn-form-' + context + '-' + chKey);
  var name = (el('conn-name-' + context + '-' + chKey) || {}).value || '';
  var value = (el('conn-value-' + context + '-' + chKey) || {}).value || '';
  var isEmail = chKey === 'email';
  if (!name.trim()) { toast('Please enter a connection name', 'error'); return; }
  if (!value.trim()) { toast('Please enter a ' + (isEmail ? 'recipient' : 'webhook URL'), 'error'); return; }

  var editingId = form ? form.dataset.editingId : '';
  var conn;
  if (editingId) {
    conn = (automationsCfg.saved_connections || []).find(function(c) { return c.id === editingId; });
    if (!conn) return;
    conn.name = name.trim();
  } else {
    conn = { id: generateConnectionId(), type: chKey, name: name.trim() };
  }

  if (isEmail) {
    conn.recipients = value.trim();
    var sp = (el('conn-subject-' + context + '-' + chKey) || {}).value;
    if (sp) conn.subject_prefix = sp;
  } else {
    conn.url = value.trim();
  }
  saveConnection(conn);

  // Select the connection
  if (context === 'wizard') {
    if (_alertWizardDraft) {
      _alertWizardDraft.channels[chKey] = conn.id;
    }
    renderWizardStep3();
  } else {
    if (_ruleBuilderData) {
      if (!_ruleBuilderData.channels) _ruleBuilderData.channels = {};
      _ruleBuilderData.channels[chKey] = conn.id;
    }
    renderRuleBuilderBody();
  }
  toast('Connection "' + conn.name + '" saved', 'success');
}

function cancelConnectionForm(chKey, context) {
  var form = el('conn-form-' + context + '-' + chKey);
  if (form) form.style.display = 'none';
  var selectEl = el('conn-sel-' + context + '-' + chKey);
  if (selectEl) {
    var prevId = context === 'wizard'
      ? ((automationsCfg.channels || {})[chKey] || {}).connection_id || ''
      : ((_ruleBuilderData || {}).channels || {})[chKey] || '';
    if (typeof prevId !== 'string') prevId = '';
    selectEl.value = prevId;
  }
}

function editSavedConnection(connId, context, chKey) {
  var conn = (automationsCfg.saved_connections || []).find(function(c) { return c.id === connId; });
  if (!conn) return;
  var form = el('conn-form-' + context + '-' + chKey);
  if (!form) return;
  form.style.display = 'block';
  form.dataset.editingId = connId;
  var nameEl = el('conn-name-' + context + '-' + chKey);
  var valueEl = el('conn-value-' + context + '-' + chKey);
  if (nameEl) nameEl.value = conn.name || '';
  if (valueEl) valueEl.value = chKey === 'email' ? (conn.recipients || '') : (conn.url || '');
  if (chKey === 'email') {
    var spEl = el('conn-subject-' + context + '-' + chKey);
    if (spEl) spEl.value = conn.subject_prefix || '[iQcadence Alert]';
  }
}

function deleteSavedConnectionUI(connId, context, chKey) {
  var conn = (automationsCfg.saved_connections || []).find(function(c) { return c.id === connId; });
  if (!conn) return;
  deleteConnection(connId);
  // Clear selection
  if (context === 'wizard') {
    if (automationsCfg.channels && automationsCfg.channels[chKey]) {
      delete automationsCfg.channels[chKey].connection_id;
    }
    saveAutomationsCfg();
    renderWizardStep3();
  } else {
    if (_ruleBuilderData && _ruleBuilderData.channels) {
      _ruleBuilderData.channels[chKey] = false;
    }
    renderRuleBuilderBody();
  }
  toast('Connection "' + (conn.name || '') + '" removed', 'success');
}

async function testChannel(key, connectionIdOverride) {
  var conn = connectionIdOverride
    ? (automationsCfg.saved_connections || []).find(function(c) { return c.id === connectionIdOverride; })
    : resolveConnection(key);
  const statusEl = el('ch-test-status-' + key);

  const testCustomer = {
    id: 'test-00000000', name: 'Test Account', score: 42, status: 'risk',
    mrr: 5000, arr: 60000, tier: 'enterprise', manager: 'Test Manager',
    days: 14, renewal_date: '', lifecycle: 'active', tags: 'test', nps: 'detractor',
    logins: 3, adoption: 35, tickets: 7
  };
  const testExtra = { trigger: 'health_below_threshold', threshold: automationsCfg.alert_settings?.health_below_threshold?.threshold || 50, previous_score: 68, test: true };

  if (key === 'slack') {
    if (!conn || !conn.url) { toast('Enter a Slack webhook URL first', 'warn'); return; }
    if (statusEl) statusEl.textContent = 'Sending test…';
    try {
      const payload = buildSlackPayload('health_below_threshold', testCustomer, testExtra);
      const { data, error } = await sb.functions.invoke('send-webhook', {
        body: { url: conn.url, payload, event_type: 'test_slack', customer_name: 'Test Account', test: true }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">' + appIcon('check',12) + ' Test sent to Slack</span>';
      toast('Test sent to Slack', 'success');
    } catch (err) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">✗ ' + escHtml(err.message || 'Failed') + '</span>';
      toast('Slack test failed: ' + (err.message || 'Unknown'), 'error');
    }

  } else if (key === 'teams') {
    if (!conn || !conn.url) { toast('Enter a Teams webhook URL first', 'warn'); return; }
    if (statusEl) statusEl.textContent = 'Sending test…';
    try {
      const payload = buildTeamsPayload('health_below_threshold', testCustomer, testExtra);
      const { data, error } = await sb.functions.invoke('send-webhook', {
        body: { url: conn.url, payload, event_type: 'test_teams', customer_name: 'Test Account', test: true }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">' + appIcon('check',12) + ' Test sent to Teams</span>';
      toast('Test sent to Teams', 'success');
    } catch (err) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">✗ ' + escHtml(err.message || 'Failed') + '</span>';
      toast('Teams test failed: ' + (err.message || 'Unknown'), 'error');
    }

  } else if (key === 'email') {
    if (!conn || !conn.recipients) { toast('Enter email recipients first', 'warn'); return; }
    if (statusEl) statusEl.textContent = 'Sending test…';
    try {
      await fireEmailAlert('health_below_threshold', testCustomer, testExtra, conn);
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">' + appIcon('check',12) + ' Test email sent</span>';
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

// ── Native Integrations UI ──

let _integrationCache = {};
let _stripeSyncInProgress = false;
let _lastStripeSyncTime = 0;
let _lastStripeSyncResult = null;
let _stripeSyncTimer = null;
let _hubspotSyncInProgress = false;
let _lastHubSpotSyncTime = 0;
let _lastHubSpotSyncResult = null;
let _hubspotSyncTimer = null;

async function renderIntegrationsSection() {
  const wrap = el('integrations-section');
  if (!wrap) return;

  // Show loading
  wrap.innerHTML = '<div class="card" style="max-width:720px;margin-bottom:18px"><div class="card-hd"><h2>Native Integrations</h2></div><p style="padding:16px;color:var(--muted)">Loading integrations…</p></div>';

  try {
    const integrations = await loadIntegrationStatus();
    _integrationCache = {};
    for (const i of integrations) _integrationCache[i.platform] = i;
  } catch (e) {
    console.warn('Failed to load integrations:', e);
  }

  // Reconcile metric ownership — ensure only one platform owns each metric
  await reconcileMetricOwnership();

  const stripeInt = _integrationCache['stripe'] || null;
  const hubspotInt = _integrationCache['hubspot'] || null;
  const salesforceInt = _integrationCache['salesforce'] || null;

  // Update topbar sync button visibility
  const topSyncBtn = el('topbar-sync-btn');
  const hasAnyConnected = stripeInt?.status === 'connected' || hubspotInt?.status === 'connected' || salesforceInt?.status === 'connected';
  if (topSyncBtn) topSyncBtn.style.display = hasAnyConnected ? '' : 'none';

  wrap.innerHTML = `
    <div class="card" style="max-width:720px;margin-bottom:18px">
      <div class="card-hd"><h2>Sync Overview</h2></div>
      <p style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:8px">Which integration is providing each metric.</p>
      <div id="sync-overview" style="font-size:var(--fs-base)"></div>
    </div>
    <div class="card" style="max-width:720px;margin-bottom:18px">
      <div class="card-hd">
        <h2>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:6px"><path d="M6 3v12"/><path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>Stripe
          <span class="info-tip" data-tip="Connect your Stripe account to auto-sync subscription data: MRR, plan tier, and growth signals. Use a restricted API key with read-only access to Subscriptions and Products.">ⓘ</span>
        </h2>
        ${stripeInt?.status === 'connected' ? '<span style="font-size:var(--fs-sm);color:var(--green);font-weight:700">● Connected</span>' : '<span style="font-size:var(--fs-sm);color:var(--muted)">Not connected</span>'}
      </div>
      <div id="integration-stripe-body"></div>
    </div>
    <div class="card" style="max-width:720px;margin-bottom:18px">
      <div class="card-hd">
        <h2>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:6px"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>HubSpot
          <span class="info-tip" data-tip="Connect your HubSpot account to sync companies, deals, tickets, and engagement data. Use a Private App token with read access to CRM objects.">ⓘ</span>
        </h2>
        ${hubspotInt?.status === 'connected' ? '<span style="font-size:var(--fs-sm);color:var(--green);font-weight:700">● Connected</span>' : '<span style="font-size:var(--fs-sm);color:var(--muted)">Not connected</span>'}
      </div>
      <div id="integration-hubspot-body"></div>
    </div>
    <div class="card" style="max-width:720px;margin-bottom:18px">
      <div class="card-hd">
        <h2>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:6px"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>Salesforce
          <span class="info-tip" data-tip="Connect your Salesforce org to sync Accounts, Opportunities, Cases, and Contacts. Uses OAuth for secure access.">ⓘ</span>
        </h2>
        ${salesforceInt?.status === 'connected' ? '<span style="font-size:var(--fs-sm);color:var(--green);font-weight:700">● Connected</span>' : '<span style="font-size:var(--fs-sm);color:var(--muted)">Not connected</span>'}
      </div>
      <div id="integration-salesforce-body"></div>
    </div>`;

  renderHubSpotCard(hubspotInt);
  renderStripeCard(stripeInt);
  renderSalesforceCard(salesforceInt);
  renderSyncOverview();
}

// One-time recovery: restore wiped signals from last good history snapshot
async function recoverWipedSignals() {
  const signalKeys = ['logins','adoption','tickets','nps','csat','days','growth'];
  const toSave = [];
  let recovered = 0;

  for (const c of customers) {
    if (c.lifecycle === 'churned') continue;
    // Check if signals are wiped (all null/default)
    const allNull = signalKeys.every(k => c[k] == null || c[k] === 'none');
    if (!allNull) continue;
    if (!c.history || c.history.length < 2) continue;

    // Find last history entry with real signal data (before the wipe)
    let goodSnap = null;
    for (let i = c.history.length - 1; i >= 0; i--) {
      const s = c.history[i].signals;
      if (!s) continue;
      // Check if this snapshot has real data (not all null)
      const hasData = signalKeys.some(k => s[k] != null && s[k] !== 'none');
      if (hasData) { goodSnap = s; break; }
    }
    if (!goodSnap) continue;

    // Restore signals from the snapshot
    let changed = false;
    for (const k of signalKeys) {
      if (goodSnap[k] != null && (c[k] == null || c[k] === 'none')) {
        c[k] = goodSnap[k];
        changed = true;
      }
    }
    if (changed) {
      c._baseDays = c.days != null ? c.days : null;
      const { score } = scoreWithModel(c);
      c.score = score;
      c.status = getStatus(score);
      c.history.push({ score, date: new Date().toISOString(), signals: buildHistorySnapshot(c) });
      toSave.push(c);
      recovered++;
    }
  }

  if (toSave.length) {
    pauseSync(10000);
    for (const c of toSave) { try { await save(c); } catch(_) {} }
    refreshLiveScores();
    refreshMgrDropdown();
    const active = VIEWS.find(v => document.getElementById('view-'+v)?.classList.contains('active'));
    if (active === 'homebase')  renderHomeBase();
    if (active === 'customers') renderCustomers();
    if (active === 'alerts')    renderAlerts();
    if (active === 'trends')    renderTrends();
  }
  toast(`Recovered signals for ${recovered} customer${recovered !== 1 ? 's' : ''}`, recovered ? 'success' : 'default');
  return recovered;
}

/**
 * Shared post-sync handler: snapshots before, reloads, compares, saves history.
 * @param {Map} preScores  – Map<id, score> captured before sync
 * @param {Map} preSignals – Map<id, snapshot> captured before sync
 * @param {string[]} syncedNames – lowercased names of updated/created customers
 * @returns {Promise<void>}
 */
async function postSyncHistoryTrack(preScores, preSignals, syncedNames) {
  try {
    if (isAdmin() && activeClientId !== '__own__') {
      await loadClientCustomers(activeClientId, true);
    } else {
      await loadCustomersFromSupabase();
    }
  } catch(e) { console.warn('Post-sync reload:', e); }
  _lastSyncTime = Date.now();
  refreshLiveScores();

  const toSave = [];
  for (const c of customers) {
    if (!syncedNames.includes(c.name.toLowerCase())) continue;
    const oldScore = preScores.get(c.id);
    const oldSnap = preSignals.get(c.id);
    const newSnap = buildHistorySnapshot(c);
    const scoreChanged = oldScore != null && oldScore !== c.score;
    const signalsChanged = JSON.stringify(oldSnap) !== JSON.stringify(newSnap);
    if (scoreChanged || signalsChanged) {
      c.history = c.history || [];
      c.history.push({ score: c.score, date: new Date().toISOString(), signals: newSnap, prevSignals: oldSnap });
      toSave.push(c);
    }
  }
  if (toSave.length) {
    pauseSync(10000);
    for (const c of toSave) { try { await save(c); } catch(_) {} }
  }
  refreshMgrDropdown();
  const active = VIEWS.find(v => document.getElementById('view-'+v)?.classList.contains('active'));
  if (active === 'homebase')  renderHomeBase();
  if (active === 'customers') renderCustomers();
  if (active === 'alerts')    renderAlerts();
  if (active === 'trends')    renderTrends();
}

function renderSyncOverview() {
  const container = el('sync-overview');
  if (!container) return;
  const owners = getMetricOwners();
  const allMetrics = [
    { key: 'mrr',       label: 'MRR / ARR' },
    { key: 'tier',      label: 'Plan Tier' },
    { key: 'renewal',   label: 'Renewal Date' },
    { key: 'tickets',   label: 'Support Tickets' },
    { key: 'days',      label: 'Days Since Contact' },
    { key: 'contact',   label: 'Primary Contact' },
    { key: 'lifecycle', label: 'Lifecycle Stage' },
    { key: 'nps',       label: 'NPS' },
    { key: 'csat',      label: 'CSAT' },
    { key: 'growth',    label: 'Growth Signal' },
    { key: 'billing',   label: 'Billing Interval' },
  ];
  const platformColors = { stripe: '#635bff', hubspot: '#ff7a59', salesforce: '#00a1e0' };
  const platformLabels = { stripe: 'Stripe', hubspot: 'HubSpot', salesforce: 'Salesforce' };
  const rows = allMetrics.map(m => {
    const owner = owners[m.key];
    const dot = owner
      ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:var(--fs-sm);font-weight:600;color:${platformColors[owner]}"><span style="width:8px;height:8px;border-radius:50%;background:${platformColors[owner]};display:inline-block"></span>${platformLabels[owner]}</span>`
      : `<span style="font-size:var(--fs-sm);color:var(--muted)">—</span>`;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)">${m.label}${dot}</div>`;
  }).join('');
  container.innerHTML = rows;
}

// Metric definitions: which metrics each platform can provide
const PLATFORM_METRICS = {
  stripe:  [
    { key: 'mrr',     label: 'MRR / ARR' },
    { key: 'tier',    label: 'Plan Tier' },
    { key: 'growth',  label: 'Growth Signal' },
    { key: 'renewal', label: 'Renewal Date' },
    { key: 'billing', label: 'Billing Interval' },
  ],
  hubspot: [
    { key: 'mrr',        label: 'MRR / ARR (Deals)' },
    { key: 'tier',       label: 'Tier (Company property)' },
    { key: 'growth',     label: 'Growth Signal' },
    { key: 'renewal',    label: 'Renewal Date (Deal close)' },
    { key: 'tickets',    label: 'Support Tickets' },
    { key: 'days',       label: 'Days Since Contact' },
    { key: 'contact',    label: 'Primary Contact' },
    { key: 'nps',        label: 'NPS' },
    { key: 'csat',       label: 'CSAT' },
    { key: 'lifecycle',  label: 'Lifecycle Stage' },
  ],
  salesforce: [
    { key: 'mrr',       label: 'MRR / ARR (Opportunities)' },
    { key: 'tier',      label: 'Tier (Account property)' },
    { key: 'growth',    label: 'Growth Signal' },
    { key: 'renewal',   label: 'Renewal Date (Opp close)' },
    { key: 'tickets',   label: 'Support Cases' },
    { key: 'days',      label: 'Days Since Activity' },
    { key: 'contact',   label: 'Primary Contact' },
    { key: 'lifecycle', label: 'Account Type' },
  ]
};

// Returns { metric: platform } for all currently-enabled metrics across all connected integrations
// Metrics default to OFF — user must explicitly enable each metric before syncing
function getMetricOwners() {
  const owners = {};
  for (const [platform, integration] of Object.entries(_integrationCache)) {
    if (integration?.status !== 'connected') continue;
    const sm = integration.config?.sync_metrics || {};
    const metrics = PLATFORM_METRICS[platform] || [];
    for (const m of metrics) {
      if (sm[m.key] === true && !owners[m.key]) owners[m.key] = platform;
    }
  }
  return owners;
}

// Reconcile metric ownership across all connected integrations.
// If metric X is enabled on platform A, ensure all other platforms have it explicitly set to false.
async function reconcileMetricOwnership() {
  const owners = getMetricOwners();
  const updates = []; // { platform, config }

  for (const [platform, integration] of Object.entries(_integrationCache)) {
    if (integration?.status !== 'connected') continue;
    const metrics = PLATFORM_METRICS[platform] || [];
    const sm = integration.config?.sync_metrics || {};
    let changed = false;
    const newSm = { ...sm };

    for (const m of metrics) {
      const owner = owners[m.key];
      if (owner && owner !== platform && newSm[m.key] !== false) {
        // Another platform owns this metric — disable it here
        newSm[m.key] = false;
        changed = true;
      }
    }

    if (changed) {
      const newConfig = { ...(integration.config || {}), sync_metrics: newSm };
      updates.push({ platform, config: newConfig, integration });
    }
  }

  // Write changes to DB
  for (const u of updates) {
    try {
      await sb.from('integrations')
        .update({ config: u.config, updated_at: new Date().toISOString() })
        .eq('client_id', u.integration.client_id)
        .eq('platform', u.platform);
      u.integration.config = u.config;
      _integrationCache[u.platform] = u.integration;
      console.log(`[reconcile] Set conflicting metrics to false on ${u.platform}`);
    } catch (e) {
      console.warn(`[reconcile] Failed to update ${u.platform}:`, e);
    }
  }
}

// Build toggle HTML for a platform's metric list
function buildMetricTogglesHTML(platform, integration) {
  const metrics = PLATFORM_METRICS[platform] || [];
  const syncMetrics = integration.config?.sync_metrics || {};
  const owners = getMetricOwners();

  return metrics.map(m => {
    const enabled = syncMetrics[m.key] === true; // default off — user must enable
    const ownedBy = owners[m.key];
    const ownedByOther = ownedBy && ownedBy !== platform;
    const disabled = ownedByOther ? 'disabled' : '';
    const ownerNote = ownedByOther
      ? `<span class="mt-owner">(Synced by ${ownedBy.charAt(0).toUpperCase() + ownedBy.slice(1)})</span>`
      : '';

    return `<div class="mt-row">
      <span class="mt-label">${escHtml(m.label)} ${ownerNote}</span>
      <label class="mt-switch">
        <input type="checkbox" ${enabled && !ownedByOther ? 'checked' : ''} ${disabled}
          onchange="updateMetricToggle('${platform}','${m.key}',this.checked)" />
        <span class="mt-slider"></span>
      </label>
    </div>`;
  }).join('');
}

function renderStripeCard(integration) {
  const body = el('integration-stripe-body');
  if (!body) return;

  if (!integration || integration.status !== 'connected') {
    // Disconnected state
    body.innerHTML = `
      <p style="font-size:var(--fs-base);color:var(--muted);margin-bottom:14px">
        Connect your Stripe account to auto-sync MRR, plan tier, and growth signals from your subscriptions.
        Use a <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener" style="color:var(--blue)">restricted API key</a> with <strong>read-only</strong> access to Customers, Subscriptions, and Products.
      </p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="password" id="stripe-key-input" placeholder="sk_live_... or rk_live_..."
          style="flex:1;min-width:240px;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:var(--fs-base);font-family:var(--font-mono,monospace);color:var(--text);background:var(--surface)" />
        <button class="btn btn-sm btn-success" onclick="connectStripeUI()" id="stripe-connect-btn">Connect Stripe</button>
      </div>
      <div id="stripe-connect-status" style="margin-top:8px;font-size:var(--fs-sm)"></div>`;
  } else {
    // Connected state
    const syncAt = integration.last_sync_at
      ? new Date(integration.last_sync_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
      : 'Never';
    const stats = integration.sync_stats || {};
    const accountName = integration.config?.account_name || '';

    body.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:14px">
        ${accountName ? `<div style="font-size:var(--fs-base)"><span style="color:var(--muted)">Account:</span> <strong>${escHtml(accountName)}</strong></div>` : ''}
        <div style="font-size:var(--fs-base)"><span style="color:var(--muted)">Last sync:</span> <strong>${syncAt}</strong></div>
        ${stats.customers_matched != null ? `<div style="font-size:var(--fs-base)"><span style="color:var(--muted)">Customers:</span> <strong>${stats.customers_matched}</strong></div>` : ''}
        ${stats.updated != null ? `<div style="font-size:var(--fs-base)"><span style="color:var(--muted)">Updated:</span> <strong>${stats.updated}</strong></div>` : ''}
      </div>
      ${integration.last_sync_message ? `<p style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:12px">${escHtml(integration.last_sync_message)}</p>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm btn-primary" onclick="syncStripeUI()" id="stripe-sync-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Sync Now
        </button>
        <button class="btn btn-sm btn-danger" onclick="disconnectStripeUI()">Disconnect</button>
      </div>
      <div id="stripe-sync-status" style="margin-top:8px;font-size:var(--fs-sm)"></div>
      <div class="metric-toggles">
        <h3>Sync Settings</h3>
        ${buildMetricTogglesHTML('stripe', integration)}
      </div>`;
  }
}

async function connectStripeUI() {
  const input = el('stripe-key-input');
  const btn = el('stripe-connect-btn');
  const status = el('stripe-connect-status');
  const key = input?.value?.trim();
  if (!key) { toast('Enter your Stripe API key', 'error'); return; }
  if (!key.startsWith('sk_') && !key.startsWith('rk_')) {
    toast('Key should start with sk_live_ or rk_live_', 'error'); return;
  }

  btn.disabled = true;
  btn.textContent = 'Connecting…';
  status.innerHTML = '<span style="color:var(--muted)">Validating key with Stripe…</span>';

  try {
    const result = await connectIntegration('stripe', key);
    toast('Stripe connected!', 'success');
    input.value = '';
    renderIntegrationsSection(); // refresh the card
  } catch(e) {
    status.innerHTML = `<span style="color:var(--red)">${escHtml(e.message)}</span>`;
    toast('Connection failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect Stripe';
  }
}

async function disconnectStripeUI() {
  confirmAction('Disconnect Stripe? This will remove the stored API key.', async () => {
    try {
      await disconnectIntegration('stripe');
      toast('Stripe disconnected', 'warn');
      renderIntegrationsSection();
    } catch(e) {
      toast('Disconnect failed: ' + e.message, 'error');
    }
  });
}

async function updateSyncOption(platform, key, value) {
  const integration = _integrationCache[platform];
  if (!integration) return;
  const config = { ...(integration.config || {}) };
  config[key] = value;
  const { error } = await sb.from('integrations').update({ config }).eq('client_id', integration.client_id).eq('platform', platform);
  if (error) { toast('Failed to save: ' + error.message, 'error'); return; }
  integration.config = config;
  _integrationCache[platform] = integration;
  toast(value ? 'New accounts will be created during sync' : 'Sync will only update existing accounts', 'success');
}

async function updateMetricToggle(platform, metric, enabled) {
  const integration = _integrationCache[platform];
  if (!integration) return;

  const config = { ...(integration.config || {}) };
  config.sync_metrics = { ...(config.sync_metrics || {}), [metric]: enabled };

  try {
    const { error } = await sb.from('integrations')
      .update({ config, updated_at: new Date().toISOString() })
      .eq('client_id', integration.client_id)
      .eq('platform', platform);
    if (error) throw error;

    // Update cache
    integration.config = config;
    _integrationCache[platform] = integration;

    // If enabling a metric, disable it on other connected platforms
    if (enabled) {
      for (const [otherPlatform, otherInteg] of Object.entries(_integrationCache)) {
        if (otherPlatform === platform || otherInteg?.status !== 'connected') continue;
        const otherMetrics = (PLATFORM_METRICS[otherPlatform] || []).map(m => m.key);
        if (!otherMetrics.includes(metric)) continue;
        const otherSm = otherInteg.config?.sync_metrics || {};
        if (otherSm[metric] === false) continue; // already off
        const otherConfig = { ...(otherInteg.config || {}) };
        otherConfig.sync_metrics = { ...(otherConfig.sync_metrics || {}), [metric]: false };
        await sb.from('integrations')
          .update({ config: otherConfig, updated_at: new Date().toISOString() })
          .eq('client_id', otherInteg.client_id)
          .eq('platform', otherPlatform);
        otherInteg.config = otherConfig;
        _integrationCache[otherPlatform] = otherInteg;
      }
    }

    const label = (PLATFORM_METRICS[platform] || []).find(m => m.key === metric)?.label || metric;
    const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
    toast(`${platformName} will ${enabled ? 'now' : 'no longer'} sync ${label}`, enabled ? 'success' : 'warn');

    // Re-render all integration cards to update ownership labels
    if (_integrationCache['stripe']) renderStripeCard(_integrationCache['stripe']);
    if (_integrationCache['hubspot']) renderHubSpotCard(_integrationCache['hubspot']);
    if (_integrationCache['salesforce']) renderSalesforceCard(_integrationCache['salesforce']);
  } catch(e) {
    toast('Failed to update setting: ' + e.message, 'error');
    // Re-render to revert the toggle visually
    if (platform === 'stripe') renderStripeCard(integration);
    if (platform === 'hubspot') renderHubSpotCard(integration);
    if (platform === 'salesforce') renderSalesforceCard(integration);
  }
}

async function syncStripeUI() {
  const btn = el('stripe-sync-btn');
  const status = el('stripe-sync-status');
  if (!btn) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Syncing…';
  status.innerHTML = '<span style="color:var(--muted)">Pulling subscriptions from Stripe…</span>';
  _stripeSyncInProgress = true;

  try {
    const result = await syncIntegration('stripe');
    const stats = result.stats || {};
    _lastStripeSyncTime = Date.now();
    status.innerHTML = `<span style="color:var(--green)">✓ ${stats.customers_matched || 0} customers matched (${stats.total || 0} subscriptions), ${stats.updated || 0} updated</span> <a href="#" onclick="event.preventDefault();showSyncResultsModal('stripe',_lastStripeSyncResult)" style="font-size:var(--fs-sm);margin-left:6px">View Details</a>`;
    _lastStripeSyncResult = result;
    toast(`Stripe sync: ${stats.updated || 0} of ${stats.customers_matched || 0} customers updated`, 'success', 6000);

    if (stats.updated > 0) {
      const preScores = new Map(customers.map(c => [c.id, c.score]));
      const preSignals = new Map(customers.map(c => [c.id, buildHistorySnapshot(c)]));
      const syncedNames = (result.updates || []).map(u => u.name?.toLowerCase());
      await postSyncHistoryTrack(preScores, preSignals, syncedNames);
    }

    // Refresh the card to show updated sync stats
    _integrationCache['stripe'] = {
      ...(_integrationCache['stripe'] || {}),
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'success',
      last_sync_message: `${stats.customers_matched || 0} customers matched, ${stats.updated} updated`,
      sync_stats: stats
    };
    renderStripeCard(_integrationCache['stripe']);
    // Re-set status after card re-render (renderStripeCard wipes the status div)
    const statusAfter = el('stripe-sync-status');
    if (statusAfter) statusAfter.innerHTML = `<span style="color:var(--green)">✓ ${stats.customers_matched || 0} customers matched (${stats.total || 0} subscriptions), ${stats.updated || 0} updated</span> <a href="#" onclick="event.preventDefault();showSyncResultsModal('stripe',_lastStripeSyncResult)" style="font-size:var(--fs-sm);margin-left:6px">View Details</a>`;
  } catch(e) {
    status.innerHTML = `<span style="color:var(--red)">✗ ${escHtml(e.message)}</span>`;
    toast('Sync failed: ' + e.message, 'error');
  } finally {
    _stripeSyncInProgress = false;
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Sync Now';
  }
}

// ── Topbar Sync (quick access from header — syncs all connected integrations) ──
async function topbarSyncStripe() {
  const btn = el('topbar-sync-btn');
  if (!btn || btn.classList.contains('syncing')) return;

  btn.classList.add('syncing');
  btn.disabled = true;

  const hasStripe = _integrationCache['stripe']?.status === 'connected';
  const hasHubSpot = _integrationCache['hubspot']?.status === 'connected';
  const hasSalesforce = _integrationCache['salesforce']?.status === 'connected';
  const msgs = [];
  const allSyncedNames = [];
  let anyUpdated = false;

  // Snapshot scores and signals BEFORE any syncs
  const preScores = new Map(customers.map(c => [c.id, c.score]));
  const preSignals = new Map(customers.map(c => [c.id, buildHistorySnapshot(c)]));

  // Collect combined results across all platforms
  const allUpdates = [];
  const allCreated = [];
  const combinedStats = { updated: 0, created: 0, matched: 0, total: 0 };
  const platforms = [];

  // Sync Stripe if connected
  if (hasStripe) {
    _stripeSyncInProgress = true;
    try {
      const result = await syncIntegration('stripe');
      const stats = result.stats || {};
      _lastStripeSyncTime = Date.now();
      msgs.push(`Stripe: ${stats.updated || 0} updated`);
      if ((stats.updated || 0) > 0) anyUpdated = true;
      (result.updates || []).forEach(u => { if (u.name) allSyncedNames.push(u.name.toLowerCase()); });
      allUpdates.push(...(result.updates || []));
      allCreated.push(...(result.created || []));
      combinedStats.updated += stats.updated || 0;
      combinedStats.created += stats.created || 0;
      combinedStats.matched += stats.customers_matched || stats.matched || 0;
      combinedStats.total += stats.total || 0;
      platforms.push('stripe');
      _integrationCache['stripe'] = {
        ...(_integrationCache['stripe'] || {}),
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'success',
        last_sync_message: `${stats.customers_matched || 0} matched, ${stats.updated} updated`,
        sync_stats: stats
      };
    } catch(e) {
      msgs.push('Stripe: failed');
    } finally {
      _stripeSyncInProgress = false;
    }
  }

  // Sync HubSpot if connected
  if (hasHubSpot && !_hubspotSyncInProgress) {
    try {
      const result = await syncIntegration('hubspot');
      const stats = result.stats || {};
      msgs.push(`HubSpot: ${stats.updated || 0} updated`);
      if ((stats.updated || 0) > 0 || (stats.created || 0) > 0) anyUpdated = true;
      (result.updates || []).forEach(u => { if (u.name) allSyncedNames.push(u.name.toLowerCase()); });
      allUpdates.push(...(result.updates || []));
      allCreated.push(...(result.created || []));
      combinedStats.updated += stats.updated || 0;
      combinedStats.created += stats.created || 0;
      combinedStats.matched += stats.matched || 0;
      combinedStats.total += stats.total || 0;
      platforms.push('hubspot');
    } catch(e) {
      console.error('HubSpot sync error:', e);
      msgs.push('HubSpot: ' + (e.message || 'failed'));
    }
  }

  // Sync Salesforce if connected
  if (hasSalesforce && !_salesforceSyncInProgress) {
    _salesforceSyncInProgress = true;
    try {
      const result = await syncIntegration('salesforce');
      const stats = result.stats || {};
      _lastSalesforceSyncTime = Date.now();
      msgs.push(`Salesforce: ${stats.updated || 0} updated`);
      if ((stats.updated || 0) > 0 || (stats.created || 0) > 0) anyUpdated = true;
      (result.updates || []).forEach(u => { if (u.name) allSyncedNames.push(u.name.toLowerCase()); });
      allUpdates.push(...(result.updates || []));
      allCreated.push(...(result.created || []));
      combinedStats.updated += stats.updated || 0;
      combinedStats.created += stats.created || 0;
      combinedStats.matched += stats.matched || 0;
      combinedStats.total += stats.total || 0;
      platforms.push('salesforce');
    } catch(e) {
      console.error('Salesforce sync error:', e);
      msgs.push('Salesforce: ' + (e.message || 'failed'));
    } finally {
      _salesforceSyncInProgress = false;
    }
  }

  // Store combined results for the topbar details button
  if (allUpdates.length || allCreated.length) {
    _lastSyncPlatform = platforms.join(' + ');
    _lastSyncResult = { stats: combinedStats, updates: allUpdates, created: allCreated };
    _updateTopbarSyncDetailsBtn();
  }

  // Reload customers and track history for ALL synced platforms at once
  if (anyUpdated) {
    await postSyncHistoryTrack(preScores, preSignals, allSyncedNames);
  }

  toast(msgs.length ? msgs.join(' · ') : 'No integrations connected', msgs.some(m => m.includes('failed')) ? 'error' : 'success', 6000);
  btn.classList.remove('syncing');
  btn.disabled = false;
}

// Show/hide topbar sync button based on integration connection status
async function updateTopbarSyncVisibility() {
  const btn = el('topbar-sync-btn');
  if (!btn) return;
  try {
    if (!_integrationCache['stripe']) {
      const integrations = await loadIntegrationStatus();
      for (const i of integrations) _integrationCache[i.platform] = i;
    }
    const hasAny = _integrationCache['stripe']?.status === 'connected' || _integrationCache['hubspot']?.status === 'connected' || _integrationCache['salesforce']?.status === 'connected';
    btn.style.display = hasAny ? '' : 'none';
  } catch(e) {
    btn.style.display = 'none';
  }
}

// ── Auto Stripe Sync (page load + hourly) ──
async function autoSyncStripe() {
  // Guards
  if (_stripeSyncInProgress) return;
  if (!_integrationCache['stripe']) {
    try {
      const integrations = await loadIntegrationStatus();
      for (const i of integrations) _integrationCache[i.platform] = i;
    } catch(_) { return; }
  }
  if (_integrationCache['stripe']?.status !== 'connected') return;
  if (Date.now() - _lastStripeSyncTime < 30 * 60 * 1000) return; // 30-min cooldown

  _stripeSyncInProgress = true;
  try {
    const result = await syncIntegration('stripe');
    const stats = result.stats || {};
    _lastStripeSyncTime = Date.now();
    console.log(`[Auto-sync] Stripe: ${stats.customers_matched || 0} customers, ${stats.updated || 0} updated`);

    if (stats.updated > 0) {
      const preScores = new Map(customers.map(c => [c.id, c.score]));
      const preSignals = new Map(customers.map(c => [c.id, buildHistorySnapshot(c)]));
      const syncedNames = (result.updates || []).map(u => u.name?.toLowerCase());
      await postSyncHistoryTrack(preScores, preSignals, syncedNames);
    }

    _integrationCache['stripe'] = {
      ...(_integrationCache['stripe'] || {}),
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'success',
      last_sync_message: `${stats.customers_matched || 0} customers matched, ${stats.updated} updated`,
      sync_stats: stats
    };
  } catch(e) {
    console.warn('[Auto-sync] Stripe error:', e.message);
  } finally {
    _stripeSyncInProgress = false;
  }
}

// ═══════════════════════════════════════════════════════════════
// SYNC RESULTS MODAL
// ═══════════════════════════════════════════════════════════════

let _lastSyncResult = null;
let _lastSyncPlatform = null;

function showLastSyncResults() {
  if (_lastSyncResult && _lastSyncPlatform) {
    showSyncResultsModal(_lastSyncPlatform, _lastSyncResult);
  } else {
    toast('No sync results to show — run a sync first', 'warn');
  }
}

function _updateTopbarSyncDetailsBtn() {
  const btn = el('topbar-sync-details-btn');
  if (btn) btn.style.display = _lastSyncResult ? '' : 'none';
}

function _syncFmtVal(key, val) {
  if (val == null || val === '') return '—';
  if (key === 'mrr' || key === 'arr') return '$' + Number(val).toLocaleString();
  if (key === 'renewal_date') return val.split('T')[0];
  if (key === 'renewal') return val + ' mo';
  if (key === 'days') return val + 'd';
  return String(val);
}

const _SYNC_FIELD_LABELS = {
  mrr: 'MRR', arr: 'ARR', tier: 'Tier', lifecycle: 'Lifecycle',
  tickets: 'Tickets', days: 'Days Inactive', renewal_date: 'Renewal Date',
  renewal: 'Months to Renewal', contact_email: 'Contact Email',
  contact_name: 'Contact Name', growth: 'Growth', billing_interval: 'Billing',
  external_id: 'Domain', nps: 'NPS', csat: 'CSAT',
  hubspot_company_id: 'HubSpot ID', salesforce_account_id: 'Salesforce ID',
  last_contact_date: 'Last Contact', name: 'Name',
};
const _SYNC_SKIP_KEYS = new Set(['name', '_action', '_prev', 'id']);

function showSyncResultsModal(platform, result) {
  _lastSyncPlatform = platform;
  _lastSyncResult = result;
  _updateTopbarSyncDetailsBtn();
  const stats = result.stats || {};
  const updates = result.updates || [];
  const created = result.created || [];
  const allChanges = [...updates, ...created];

  const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
  const ts = new Date().toLocaleString();

  // Build change log rows — one row per changed field per customer
  let rowsHtml = '';
  if (allChanges.length === 0) {
    rowsHtml = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:16px">No changes in this sync</td></tr>';
  } else {
    for (const item of allChanges) {
      const action = item._action || 'updated';
      const prev = item._prev || {};
      const isCreated = action === 'created';

      // Get changed fields (exclude internal keys)
      const changedFields = Object.keys(item).filter(k => !_SYNC_SKIP_KEYS.has(k));

      if (isCreated) {
        // Created: single summary row
        const summary = changedFields
          .filter(k => item[k] != null && item[k] !== '' && item[k] !== 0)
          .map(k => `<b>${_SYNC_FIELD_LABELS[k] || k}</b>: ${escHtml(_syncFmtVal(k, item[k]))}`)
          .join(' · ');
        rowsHtml += `<tr style="border-top:1px solid var(--border)">
          <td style="padding:6px 8px;white-space:nowrap;font-weight:500;vertical-align:top">${escHtml(item.name || '—')}</td>
          <td style="padding:6px 8px;color:var(--green);font-weight:600">New</td>
          <td style="padding:6px 8px;color:var(--muted)" colspan="2"><span style="font-size:11px">${summary || '—'}</span></td>
        </tr>`;
      } else {
        // Updated: one row per changed field
        const fieldRows = changedFields.map(k => ({
          label: _SYNC_FIELD_LABELS[k] || k,
          oldVal: _syncFmtVal(k, prev[k]),
          newVal: _syncFmtVal(k, item[k]),
        }));

        for (let fi = 0; fi < fieldRows.length; fi++) {
          const f = fieldRows[fi];
          const isFirst = fi === 0;
          const borderStyle = isFirst ? 'border-top:1px solid var(--border)' : '';
          rowsHtml += `<tr style="${borderStyle}">
            ${isFirst
              ? `<td style="padding:6px 8px;white-space:nowrap;font-weight:500;vertical-align:top" rowspan="${fieldRows.length}">${escHtml(item.name || '—')}</td>`
              : ''}
            <td style="padding:4px 8px;color:var(--muted);font-size:12px">${escHtml(f.label)}</td>
            <td style="padding:4px 8px;font-size:12px">${escHtml(f.oldVal)}</td>
            <td style="padding:4px 8px;font-size:12px;font-weight:500">${escHtml(f.newVal)}</td>
          </tr>`;
        }
      }
    }
  }

  // Remove existing modal if present
  const existing = document.getElementById('sync-results-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'sync-results-modal';
  modal.className = 'modal-bg';
  modal.onclick = function(e) { if (e.target === modal) modal.classList.remove('open'); };
  modal.innerHTML = `
    <div class="modal" style="max-width:800px;max-height:80vh;display:flex;flex-direction:column">
      <div class="modal-hd">
        <h2>${platformLabel} Sync Changes</h2>
        <button class="modal-close" onclick="document.getElementById('sync-results-modal').classList.remove('open')">
          <svg viewBox="0 0 24 24" fill="none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-bd" style="overflow:auto;flex:1">
        <div style="display:flex;gap:16px;margin-bottom:12px;flex-wrap:wrap">
          <span style="font-size:var(--fs-sm);color:var(--muted)">${ts}</span>
          <span style="font-size:var(--fs-sm)"><b>${stats.matched || 0}</b> matched</span>
          <span style="font-size:var(--fs-sm);color:var(--green)"><b>${stats.created || 0}</b> created</span>
          <span style="font-size:var(--fs-sm);color:var(--blue,#3b82f6)"><b>${stats.updated || 0}</b> updated</span>
          ${stats.skipped ? `<span style="font-size:var(--fs-sm);color:var(--muted)"><b>${stats.skipped}</b> skipped</span>` : ''}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:var(--fs-sm)">
          <thead>
            <tr style="border-bottom:2px solid var(--border);text-align:left">
              <th style="padding:6px 8px">Customer</th>
              <th style="padding:6px 8px">Field</th>
              <th style="padding:6px 8px">Previous</th>
              <th style="padding:6px 8px">New</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div class="modal-ft">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('sync-results-modal').classList.remove('open')">Close</button>
        <button class="btn btn-sm" onclick="exportSyncResultsCsv('${platform}')">Export CSV</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
}

function exportSyncResultsCsv(platform) {
  if (!_lastSyncResult) return;
  const updates = _lastSyncResult.updates || [];
  const created = _lastSyncResult.created || [];
  const allChanges = [...updates, ...created];
  if (!allChanges.length) return;

  const csvEsc = (v) => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = ['Customer,Action,Field,Previous,New'];

  for (const item of allChanges) {
    const action = item._action || 'updated';
    const prev = item._prev || {};
    const isCreated = action === 'created';
    const changedFields = Object.keys(item).filter(k => !_SYNC_SKIP_KEYS.has(k));

    if (isCreated) {
      // Single summary row for creates
      const summary = changedFields.filter(k => item[k] != null && item[k] !== '' && item[k] !== 0)
        .map(k => `${_SYNC_FIELD_LABELS[k] || k}: ${_syncFmtVal(k, item[k])}`).join('; ');
      rows.push([csvEsc(item.name), 'Created', '', '', csvEsc(summary)].join(','));
    } else {
      for (const k of changedFields) {
        rows.push([
          csvEsc(item.name), 'Updated',
          csvEsc(_SYNC_FIELD_LABELS[k] || k),
          csvEsc(_syncFmtVal(k, prev[k])),
          csvEsc(_syncFmtVal(k, item[k]))
        ].join(','));
      }
    }
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${platform}-sync-changes-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
// HUBSPOT INTEGRATION UI
// ═══════════════════════════════════════════════════════════════

function renderHubSpotCard(integration) {
  const body = el('integration-hubspot-body');
  if (!body) return;

  if (!integration || integration.status !== 'connected') {
    body.innerHTML = `
      <p style="font-size:var(--fs-base);color:var(--muted);margin-bottom:14px">
        Connect your HubSpot account to sync companies, deals, tickets, and engagement activity.
        Click below to authorize IQcadence with your HubSpot portal.
      </p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-sm btn-success" onclick="connectHubSpotOAuth()" id="hubspot-connect-btn" style="display:inline-flex;align-items:center;gap:6px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
          Connect with HubSpot
        </button>
      </div>
      <div id="hubspot-connect-status" style="margin-top:8px;font-size:var(--fs-sm)"></div>`;
  } else {
    const syncAt = integration.last_sync_at
      ? new Date(integration.last_sync_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
      : 'Never';
    const stats = integration.sync_stats || {};
    const accountName = integration.config?.account_name || '';

    body.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:14px">
        ${accountName ? `<div style="font-size:var(--fs-base)"><span style="color:var(--muted)">Account:</span> <strong>${escHtml(accountName)}</strong></div>` : ''}
        <div style="font-size:var(--fs-base)"><span style="color:var(--muted)">Last sync:</span> <strong>${syncAt}</strong></div>
        ${stats.matched != null ? `<div style="font-size:var(--fs-base)"><span style="color:var(--muted)">Matched:</span> <strong>${stats.matched}</strong></div>` : ''}
        ${stats.created != null ? `<div style="font-size:var(--fs-base)"><span style="color:var(--muted)">Created:</span> <strong>${stats.created}</strong></div>` : ''}
        ${stats.updated != null ? `<div style="font-size:var(--fs-base)"><span style="color:var(--muted)">Updated:</span> <strong>${stats.updated}</strong></div>` : ''}
      </div>
      ${integration.last_sync_message ? `<p style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:12px">${escHtml(integration.last_sync_message)}</p>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn btn-sm btn-primary" onclick="syncHubSpotUI()" id="hubspot-sync-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Sync Now
        </button>
        <button class="btn btn-sm btn-danger" onclick="disconnectHubSpotUI()">Disconnect</button>
      </div>
      <div id="hubspot-sync-status" style="margin-top:8px;font-size:var(--fs-sm)"></div>
      <div class="metric-toggles">
        <h3>Sync Settings</h3>
        <div class="mt-row">
          <span class="mt-label">Create new accounts from HubSpot</span>
          <label class="mt-switch">
            <input type="checkbox" ${integration.config?.sync_creates !== false ? 'checked' : ''}
              onchange="updateSyncOption('hubspot','sync_creates',this.checked)" />
            <span class="mt-slider"></span>
          </label>
        </div>
        <div class="mt-row">
          <span class="mt-label">Deal amounts are</span>
          <select style="font-size:var(--fs-sm);padding:4px 8px;border-radius:6px;border:1px solid var(--border)"
            onchange="updateSyncOption('hubspot','deal_amount_frequency',this.value)">
            <option value="annual" ${(integration.config?.deal_amount_frequency || 'annual') === 'annual' ? 'selected' : ''}>Annual (÷12 for MRR)</option>
            <option value="monthly" ${integration.config?.deal_amount_frequency === 'monthly' ? 'selected' : ''}>Monthly</option>
          </select>
        </div>
        ${buildMetricTogglesHTML('hubspot', integration)}
      </div>
      <div class="metric-toggles" style="margin-top:12px">
        <h3>Push Back to HubSpot</h3>
        <div class="mt-row">
          <span class="mt-label">Push health score to company</span>
          <label class="mt-switch">
            <input type="checkbox" ${integration.config?.push_score === true ? 'checked' : ''}
              onchange="updateHubSpotPushToggle('push_score',this.checked)" />
            <span class="mt-slider"></span>
          </label>
        </div>
      </div>
      `;
  }
}

// PKCE helpers for OAuth 2.1
function _generateCodeVerifier() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function _generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// HubSpot OAuth 2.1 + PKCE — redirect to HubSpot authorization page
async function connectHubSpotOAuth() {
  const btn = el('hubspot-connect-btn');
  const status = el('hubspot-connect-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Redirecting…'; }

  // Build state payload with client_id, user_id, and return URL
  let userId = '';
  try {
    const { data } = await sb.auth.getSession();
    userId = data?.session?.user?.id || '';
  } catch(_) {}
  const clientId = _userClientId || (activeClientId !== '__own__' ? activeClientId : '');

  if (!clientId || !userId) {
    toast('Please sign in first', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Connect with HubSpot'; }
    return;
  }

  // Generate PKCE code verifier + challenge
  const codeVerifier = _generateCodeVerifier();
  const codeChallenge = await _generateCodeChallenge(codeVerifier);

  // Store verifier in sessionStorage so the callback Edge Function can use it
  // We pass it via state since the callback needs it server-side
  const state = btoa(JSON.stringify({
    client_id: clientId,
    user_id: userId,
    return_url: window.location.origin + window.location.pathname,
    code_verifier: codeVerifier
  }));

  const HUBSPOT_CLIENT_ID = '5182d65c-2b72-4b90-8676-ff87ca97e846';
  const redirectUri = encodeURIComponent(SUPABASE_URL + '/functions/v1/hubspot-oauth-callback');

  // Request all scopes IQcadence needs: companies, contacts, deals, tickets, engagements (tasks/notes)
  const hsScopes = [
    'crm.objects.companies.read',
    'crm.objects.contacts.read',
    'crm.objects.deals.read',
    'crm.objects.tickets.read',
    'sales-email-read',
  ].join('%20');
  const authUrl = `https://mcp-na2.hubspot.com/oauth/authorize/user?client_id=${HUBSPOT_CLIENT_ID}&redirect_uri=${redirectUri}&scope=${hsScopes}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

  if (status) status.innerHTML = '<span style="color:var(--muted)">Redirecting to HubSpot…</span>';
  window.location.href = authUrl;
}

async function disconnectHubSpotUI() {
  confirmAction('Disconnect HubSpot? This will remove the stored token.', async () => {
    try {
      await disconnectIntegration('hubspot');
      toast('HubSpot disconnected', 'warn');
      renderIntegrationsSection();
    } catch(e) {
      toast('Disconnect failed: ' + e.message, 'error');
    }
  });
}

async function syncHubSpotUI() {
  const btn = el('hubspot-sync-btn');
  const status = el('hubspot-sync-status');
  if (!btn) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Syncing…';
  status.innerHTML = '<span style="color:var(--muted)">Pulling companies, deals & tickets from HubSpot…</span>';
  _hubspotSyncInProgress = true;

  try {
    const result = await syncIntegration('hubspot');
    const stats = result.stats || {};
    _lastHubSpotSyncTime = Date.now();
    status.innerHTML = `<span style="color:var(--green)">✓ ${stats.matched || 0} matched, ${stats.created || 0} created, ${stats.updated || 0} updated (${stats.total || 0} companies)</span> <a href="#" onclick="event.preventDefault();showSyncResultsModal('hubspot',_lastHubSpotSyncResult)" style="font-size:var(--fs-sm);margin-left:6px">View Details</a>`;
    _lastHubSpotSyncResult = result;
    toast(`HubSpot sync: ${stats.matched || 0} matched, ${stats.created || 0} created, ${stats.updated || 0} updated`, 'success', 6000);

    // Reload and track history
    {
      const preScores = new Map(customers.map(c => [c.id, c.score]));
      const preSignals = new Map(customers.map(c => [c.id, buildHistorySnapshot(c)]));
      const syncedNames = (result.updates || []).map(u => u.name?.toLowerCase());
      await postSyncHistoryTrack(preScores, preSignals, syncedNames);
    }

    _integrationCache['hubspot'] = {
      ...(_integrationCache['hubspot'] || {}),
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'success',
      last_sync_message: `${stats.matched || 0} matched, ${stats.created || 0} created, ${stats.updated || 0} updated`,
      sync_stats: stats
    };
    // Re-render the card to show updated last sync time and stats
    renderHubSpotCard(_integrationCache['hubspot']);
    // Re-set status after card re-render (renderHubSpotCard wipes the status div)
    const statusAfterHS = el('hubspot-sync-status');
    if (statusAfterHS) statusAfterHS.innerHTML = `<span style="color:var(--green)">✓ ${stats.matched || 0} matched, ${stats.created || 0} created, ${stats.updated || 0} updated (${stats.total || 0} companies)</span> <a href="#" onclick="event.preventDefault();showSyncResultsModal('hubspot',_lastHubSpotSyncResult)" style="font-size:var(--fs-sm);margin-left:6px">View Details</a>`;
  } catch(e) {
    status.innerHTML = `<span style="color:var(--red)">✕ ${escHtml(e.message)}</span>`;
    toast('HubSpot sync failed: ' + e.message, 'error');
  } finally {
    _hubspotSyncInProgress = false;
  }
}

async function updateHubSpotPushToggle(key, enabled) {
  const integration = _integrationCache['hubspot'];
  if (!integration) return;

  const config = { ...(integration.config || {}), [key]: enabled };

  try {
    const { error } = await sb.from('integrations')
      .update({ config, updated_at: new Date().toISOString() })
      .eq('client_id', integration.client_id)
      .eq('platform', 'hubspot');
    if (error) throw error;
    integration.config = config;
    _integrationCache['hubspot'] = integration;
    toast(`HubSpot ${key.replace('_',' ')} ${enabled ? 'enabled' : 'disabled'}`, enabled ? 'success' : 'warn');
  } catch(e) {
    toast('Failed to update: ' + e.message, 'error');
    renderHubSpotCard(integration);
  }
}

async function autoSyncHubSpot() {
  if (_hubspotSyncInProgress) return;
  if (!_integrationCache['hubspot']) {
    try {
      const integrations = await loadIntegrationStatus();
      for (const i of integrations) _integrationCache[i.platform] = i;
    } catch(_) { return; }
  }
  if (_integrationCache['hubspot']?.status !== 'connected') return;
  if (Date.now() - _lastHubSpotSyncTime < 30 * 60 * 1000) return; // 30-min cooldown

  _hubspotSyncInProgress = true;
  try {
    const result = await syncIntegration('hubspot');
    const stats = result.stats || {};
    _lastHubSpotSyncTime = Date.now();
    console.log(`[Auto-sync] HubSpot: ${stats.matched || 0} matched, ${stats.created || 0} created, ${stats.updated || 0} updated`);

    {
      const preScores = new Map(customers.map(c => [c.id, c.score]));
      const preSignals = new Map(customers.map(c => [c.id, buildHistorySnapshot(c)]));
      const syncedNames = (result.updates || []).map(u => u.name?.toLowerCase());
      await postSyncHistoryTrack(preScores, preSignals, syncedNames);
    }

    _integrationCache['hubspot'] = {
      ...(_integrationCache['hubspot'] || {}),
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'success',
      last_sync_message: `${stats.matched || 0} matched, ${stats.created || 0} created, ${stats.updated || 0} updated`,
      sync_stats: stats
    };
  } catch(e) {
    console.warn('[Auto-sync] HubSpot error:', e.message);
  } finally {
    _hubspotSyncInProgress = false;
  }
}


// ══════════════════════════════════════════════════════════════
// ── SALESFORCE INTEGRATION ──
// ══════════════════════════════════════════════════════════════

const SALESFORCE_CLIENT_ID = '3MVG9GCMQoQ6rpzTE_H36Kn9iT7OO1uFRmzH2RH9NRRmXXVy5bhLgANafBXmTE6XDmQyuUgmWCQ==';

let _salesforceSyncInProgress = false;
let _lastSalesforceSyncTime = 0;
let _lastSalesforceSyncResult = null;

function renderSalesforceCard(integration) {
  const body = el('integration-salesforce-body');
  if (!body) return;

  if (!integration || integration.status !== 'connected') {
    body.innerHTML = `
      <div style="padding:16px">
        <p style="font-size:var(--fs-base);color:var(--subtle);margin-bottom:12px">Connect your Salesforce org to sync Accounts, Opportunities, Cases, and Contacts via OAuth.</p>
        <button class="btn btn-primary" onclick="connectSalesforceOAuth()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>Connect with Salesforce
        </button>
        <div id="salesforce-connect-status" style="margin-top:8px;font-size:var(--fs-sm)"></div>
      </div>`;
    return;
  }

  const syncTime = integration.last_sync_at ? fmtDate(integration.last_sync_at) : 'Never';
  const stats = integration.sync_stats || {};
  const statsLine = stats.total ? `${stats.matched || 0} matched, ${stats.created || 0} created, ${stats.updated || 0} updated` : '';
  const lastMsg = integration.last_sync_message || '';

  body.innerHTML = `
    <div style="padding:16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span style="font-size:var(--fs-base);font-weight:600">${escHtml(integration.config?.account_name || integration.config?.org_name || 'Salesforce Org')}</span>
      </div>
      <div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:8px">Last sync: ${syncTime}${statsLine ? ' — ' + statsLine : ''}${lastMsg && !statsLine ? ' — ' + escHtml(lastMsg) : ''}</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button class="btn btn-sm" id="salesforce-sync-btn" onclick="syncSalesforceUI()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Sync Now
        </button>
        <button class="btn btn-sm btn-danger" onclick="disconnectSalesforceUI()">Disconnect</button>
      </div>
      <div id="salesforce-sync-status" style="margin-top:8px;font-size:var(--fs-sm)"></div>
      <div class="metric-toggles">
        <h3>Sync Settings</h3>
        <div class="mt-row">
          <span class="mt-label">Create new accounts from Salesforce</span>
          <label class="mt-switch">
            <input type="checkbox" ${integration.config?.sync_creates !== false ? 'checked' : ''}
              onchange="updateSyncOption('salesforce','sync_creates',this.checked)" />
            <span class="mt-slider"></span>
          </label>
        </div>
        <div class="mt-row">
          <span class="mt-label">Opportunity amounts are</span>
          <select style="font-size:var(--fs-sm);padding:4px 8px;border-radius:6px;border:1px solid var(--border)"
            onchange="updateSyncOption('salesforce','deal_amount_frequency',this.value)">
            <option value="annual" ${(integration.config?.deal_amount_frequency || 'annual') === 'annual' ? 'selected' : ''}>Annual (÷12 for MRR)</option>
            <option value="monthly" ${integration.config?.deal_amount_frequency === 'monthly' ? 'selected' : ''}>Monthly</option>
          </select>
        </div>
        ${buildMetricTogglesHTML('salesforce', integration)}
      </div>
    </div>
    `;
}

async function connectSalesforceOAuth() {
  const statusEl = el('salesforce-connect-status');
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--muted)">Redirecting to Salesforce…</span>';

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) { toast('Please sign in first', 'error'); return; }

    const clientId = _userClientId || activeClientId;
    if (!clientId) { toast('No client found', 'error'); return; }

    // Generate PKCE
    const verifier = _generateCodeVerifier();
    const challenge = await _generateCodeChallenge(verifier);

    const state = btoa(JSON.stringify({
      client_id: clientId,
      user_id: session.user.id,
      return_url: window.location.origin + window.location.pathname,
      code_verifier: verifier
    }));

    const sfClientId = SALESFORCE_CLIENT_ID;
    const redirectUri = encodeURIComponent(SUPABASE_URL + '/functions/v1/salesforce-oauth-callback');
    const scopes = encodeURIComponent('api refresh_token');

    const authUrl = `https://orgfarm-3966efd483-dev-ed.develop.my.salesforce.com/services/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(sfClientId)}&redirect_uri=${redirectUri}&scope=${scopes}&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;
    window.location.href = authUrl;
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">Error: ${escHtml(e.message)}</span>`;
    toast('Failed to start Salesforce OAuth: ' + e.message, 'error');
  }
}

async function disconnectSalesforceUI() {
  if (!await confirmAction('Disconnect Salesforce?', 'This will remove the Salesforce connection. Customer data already synced will remain.')) return;
  try {
    await disconnectIntegration('salesforce');
    delete _integrationCache['salesforce'];
    toast('Salesforce disconnected', 'warn');
    renderIntegrationsSection();
  } catch(e) {
    toast('Failed to disconnect: ' + e.message, 'error');
  }
}

async function syncSalesforceUI() {
  if (_salesforceSyncInProgress) return;
  _salesforceSyncInProgress = true;

  const btn = el('salesforce-sync-btn');
  const status = el('salesforce-sync-status');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Syncing…'; }
  if (status) status.innerHTML = '<span style="color:var(--muted)">Syncing with Salesforce…</span>';

  try {
    const result = await syncIntegration('salesforce');
    const stats = result.stats || {};
    _lastSalesforceSyncTime = Date.now();

    _lastSalesforceSyncResult = result;
    if (status) status.innerHTML = `<span style="color:var(--green)">✓ ${stats.matched || 0} matched, ${stats.created || 0} created, ${stats.updated || 0} updated (${stats.total || 0} accounts)</span> <a href="#" onclick="event.preventDefault();showSyncResultsModal('salesforce',_lastSalesforceSyncResult)" style="font-size:var(--fs-sm);margin-left:6px">View Details</a>`;
    toast(`Salesforce sync: ${stats.matched || 0} matched, ${stats.created || 0} created, ${stats.updated || 0} updated`, 'success', 6000);

    if ((stats.updated || 0) > 0 || (stats.created || 0) > 0) {
      const preScores = new Map(customers.map(c => [c.id, c.score]));
      const preSignals = new Map(customers.map(c => [c.id, buildHistorySnapshot(c)]));
      const syncedNames = (result.updates || []).map(u => u.name?.toLowerCase());
      await postSyncHistoryTrack(preScores, preSignals, syncedNames);
    }

    _integrationCache['salesforce'] = {
      ...(_integrationCache['salesforce'] || {}),
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'success',
      last_sync_message: `${stats.matched || 0} matched, ${stats.created || 0} created, ${stats.updated || 0} updated`,
      sync_stats: stats
    };
    // Re-render the card to show updated last sync time and stats
    renderSalesforceCard(_integrationCache['salesforce']);
    // Re-set status after card re-render
    const statusAfterSF = el('salesforce-sync-status');
    if (statusAfterSF) statusAfterSF.innerHTML = `<span style="color:var(--green)">✓ ${stats.matched || 0} matched, ${stats.created || 0} created, ${stats.updated || 0} updated (${stats.total || 0} accounts)</span> <a href="#" onclick="event.preventDefault();showSyncResultsModal('salesforce',_lastSalesforceSyncResult)" style="font-size:var(--fs-sm);margin-left:6px">View Details</a>`;
  } catch(e) {
    if (status) status.innerHTML = `<span style="color:var(--red)">✕ ${escHtml(e.message)}</span>`;
    toast('Salesforce sync failed: ' + e.message, 'error', 6000);
  } finally {
    _salesforceSyncInProgress = false;
  }
}

async function autoSyncSalesforce() {
  if (_salesforceSyncInProgress) return;
  if (!_integrationCache['salesforce']) {
    try {
      const integrations = await loadIntegrationStatus();
      for (const i of integrations) _integrationCache[i.platform] = i;
    } catch(_) { return; }
  }
  if (_integrationCache['salesforce']?.status !== 'connected') return;
  if (Date.now() - _lastSalesforceSyncTime < 30 * 60 * 1000) return; // 30-min cooldown

  _salesforceSyncInProgress = true;
  try {
    const result = await syncIntegration('salesforce');
    const stats = result.stats || {};
    _lastSalesforceSyncTime = Date.now();
    console.log(`[Auto-sync] Salesforce: ${stats.matched || 0} matched, ${stats.created || 0} created, ${stats.updated || 0} updated`);

    {
      const preScores = new Map(customers.map(c => [c.id, c.score]));
      const preSignals = new Map(customers.map(c => [c.id, buildHistorySnapshot(c)]));
      const syncedNames = (result.updates || []).map(u => u.name?.toLowerCase());
      await postSyncHistoryTrack(preScores, preSignals, syncedNames);
    }

    _integrationCache['salesforce'] = {
      ...(_integrationCache['salesforce'] || {}),
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'success',
      last_sync_message: `${stats.matched || 0} matched, ${stats.created || 0} created, ${stats.updated || 0} updated`,
      sync_stats: stats
    };
  } catch(e) {
    console.warn('[Auto-sync] Salesforce error:', e.message);
  } finally {
    _salesforceSyncInProgress = false;
  }
}

// ── Topbar Customer Search ──
let _topbarSearchHL = -1; // highlighted index for keyboard nav

function topbarSearchInput() {
  const input = el('topbar-search');
  const results = el('topbar-search-results');
  if (!input || !results) return;

  const q = input.value.trim().toLowerCase();
  if (!q) {
    results.style.display = 'none';
    _topbarSearchHL = -1;
    return;
  }

  const matches = customers
    .filter(c => c.name.toLowerCase().includes(q) || (c.tags || []).some(t => t.toLowerCase().includes(q)))
    .slice(0, 8);

  if (matches.length === 0) {
    results.innerHTML = '<div class="topbar-sr-empty">No matching customers</div>';
  } else {
    results.innerHTML = matches.map((c, i) => `
      <div class="topbar-sr-item${i === _topbarSearchHL ? ' highlighted' : ''}" onmousedown="topbarSearchSelect('${escHtml(c.id)}')">
        <span class="topbar-sr-name">${escHtml(c.name)}</span>
        <span class="topbar-sr-meta">${scoreHTML(c)} ${badgeHTML(c.status)}</span>
      </div>
    `).join('');
  }
  results.style.display = 'block';
}

function topbarSearchSelect(id) {
  const input = el('topbar-search');
  const results = el('topbar-search-results');
  if (input) input.value = '';
  if (results) results.style.display = 'none';
  _topbarSearchHL = -1;
  openDetail(id);
}

function topbarSearchBlur() {
  setTimeout(() => {
    const results = el('topbar-search-results');
    if (results) results.style.display = 'none';
    _topbarSearchHL = -1;
  }, 180);
}

function topbarSearchKeydown(e) {
  const results = el('topbar-search-results');
  if (!results || results.style.display === 'none') return;

  const items = results.querySelectorAll('.topbar-sr-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _topbarSearchHL = Math.min(_topbarSearchHL + 1, items.length - 1);
    items.forEach((it, i) => it.classList.toggle('highlighted', i === _topbarSearchHL));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _topbarSearchHL = Math.max(_topbarSearchHL - 1, 0);
    items.forEach((it, i) => it.classList.toggle('highlighted', i === _topbarSearchHL));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (_topbarSearchHL >= 0 && _topbarSearchHL < items.length) {
      items[_topbarSearchHL].dispatchEvent(new MouseEvent('mousedown'));
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    results.style.display = 'none';
    _topbarSearchHL = -1;
    el('topbar-search').blur();
  }
}

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
            <p style="font-size:var(--fs-base);color:var(--muted);margin-top:2px">${escHtml(t.desc)}</p>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" ${cfg.enabled ? 'checked' : ''}
              onchange="toggleWebhook('${t.key}', this.checked)"/>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="field" style="margin-bottom:10px">
          <label style="font-size:var(--fs-base);font-weight:600;margin-bottom:4px;display:block">Webhook URL</label>
          <input type="url" id="wh-url-${t.key}" placeholder="https://hooks.zapier.com/hooks/catch/..."
            value="${escHtml(cfg.url || '')}"
            onchange="updateWebhookUrl('${t.key}', this.value)"
            style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:var(--fs-base);font-family:var(--font);color:var(--text);background:var(--surface)"/>
        </div>
        ${t.hasThreshold ? `
          <div class="field" style="margin-bottom:10px;display:flex;align-items:center;gap:8px">
            <label style="font-size:var(--fs-base);font-weight:600;white-space:nowrap">Score Threshold</label>
            <input type="number" id="wh-th-${t.key}" min="1" max="99"
              value="${cfg.threshold || t.defaultThreshold}"
              onchange="updateWebhookThreshold('${t.key}', +this.value)"
              style="width:80px;padding:6px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:var(--fs-base);font-family:var(--font);color:var(--text);background:var(--surface)"/>
            <span style="font-size:var(--fs-sm);color:var(--muted)">Fire when score drops below this value</span>
          </div>
        ` : ''}
        <div style="display:flex;gap:8px;align-items:center;margin-top:12px">
          <button class="btn btn-sm btn-outline" onclick="testWebhook('${t.key}')"
            ${!cfg.url ? 'disabled title="Enter a webhook URL first"' : ''}>
            ${appIcon('bolt',14)} Test Webhook
          </button>
          <span id="wh-test-status-${t.key}" style="font-size:var(--fs-base);color:var(--muted)"></span>
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
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">' + appIcon('check',12) + ' Test sent successfully</span>';
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
      <p style="font-size:var(--fs-sm);color:var(--muted)">Your full API key was shown only when generated. If you've lost it, regenerate a new one.</p>`;
  } else {
    container.innerHTML = `
      <p style="font-size:var(--fs-base);margin-bottom:12px;color:var(--muted)">No API key generated yet. Generate one to enable inbound API endpoints.</p>
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
      <p style="font-size:var(--fs-md);font-weight:600;color:var(--red);margin-bottom:8px">
        ${appIcon('warning',14)} Copy this key now — it will not be shown again.
      </p>
      <div class="auto-endpoint" style="user-select:all;cursor:text;font-size:var(--fs-base);padding:12px 14px">
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
    <p style="font-size:var(--fs-base);color:var(--muted);margin-bottom:16px">All endpoints accept <strong>POST</strong> requests with JSON body and require the <code style="background:var(--bg);padding:1px 5px;border-radius:4px;font-size:var(--fs-base)">x-api-key</code> header.</p>
    <div class="auto-endpoint" style="margin-bottom:16px">
      <strong>POST</strong> &nbsp;${escHtml(baseUrl)}
      <button class="btn btn-xs btn-ghost copy-btn" onclick="navigator.clipboard.writeText('${escHtml(baseUrl)}');toast('URL copied','success')">Copy</button>
    </div>
    ${endpoints.map(ep => `
      <div class="auto-card">
        <h3 style="margin:0 0 4px;font-size:var(--fs-md)">${escHtml(ep.label)}</h3>
        <p style="font-size:var(--fs-base);color:var(--muted);margin-bottom:6px">${escHtml(ep.desc)}</p>
        <p style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:10px"><strong>Fields:</strong> ${escHtml(ep.fields)}</p>
        <details style="font-size:var(--fs-base)">
          <summary style="cursor:pointer;color:var(--blue);font-weight:600;margin-bottom:6px">Example payload</summary>
          <pre style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;overflow-x:auto;font-size:var(--fs-sm);line-height:1.5;color:var(--text);white-space:pre-wrap">${escHtml(ep.example)}</pre>
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
  const pagTop = el('auto-log-pag-top');
  const pagBot = el('auto-log-pag-bot');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);font-size:var(--fs-md)">No ${filterVal === 'all' ? '' : filterVal + ' '}events found</td></tr>`;
    if (pagTop) pagTop.innerHTML = '';
    if (pagBot) pagBot.innerHTML = '';
    return;
  }

  // Paginate
  const pg = _pagGet('webhookLog');
  const slice = filtered.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE);
  const pagNav = _pagHTML(filtered.length, 'webhookLog', 'renderWebhookLog');
  if (pagTop) pagTop.innerHTML = pagNav;
  if (pagBot) pagBot.innerHTML = pagNav;

  tbody.innerHTML = slice.map(e => {
    const time = new Date(e.created_at).toLocaleString();
    const dirLabel = e.direction === 'outbound' ? '↑ Out' : '↓ In';
    const dirClass = e.direction === 'outbound' ? 'auto-dir-out' : 'auto-dir-in';
    const statusClass = e.status === 'success' ? 'success' : e.status === 'failed' ? 'failed' : 'pending';

    let detail = '';
    if (e.error_msg) detail = e.error_msg;
    else if (e.status_code) detail = 'HTTP ' + e.status_code;

    return `<tr>
      <td style="white-space:nowrap;font-size:var(--fs-sm);color:var(--muted)">${escHtml(time)}</td>
      <td><span class="${dirClass}">${dirLabel}</span></td>
      <td style="font-size:var(--fs-sm);word-break:break-all">${escHtml(e.event_type || '')}</td>
      <td style="font-weight:600;font-size:var(--fs-base)">${escHtml(e.customer_name || '—')}</td>
      <td><span class="auto-status ${statusClass}">${escHtml(e.status || 'unknown')}</span></td>
      <td style="font-size:var(--fs-sm);color:var(--muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(detail)}</td>
    </tr>`;
  }).join('');
}

// ── Trigger Detection ──
// Persist snapshots so alerts only fire on actual CHANGES, not every page load
function _saveSnapshots() {
  try {
    const obj = {};
    _prevCustomerStates.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem('iqc_trigger_snapshots', JSON.stringify(obj));
  } catch(e){}
}

function snapshotCustomerStates() {
  // Try to restore persisted snapshots first — this is what prevents repeat alerts
  try {
    const stored = localStorage.getItem('iqc_trigger_snapshots');
    if (stored) {
      const obj = JSON.parse(stored);
      _prevCustomerStates.clear();
      Object.keys(obj).forEach(k => _prevCustomerStates.set(k, obj[k]));
      // Merge any NEW customers that aren't in the stored snapshot yet
      customers.forEach(c => {
        if (!_prevCustomerStates.has(c.id)) {
          _prevCustomerStates.set(c.id, _snapFields(c));
        }
      });
      _saveSnapshots();
      return;
    }
  } catch(e){}
  // No persisted data — first run: snapshot current state (won't trigger alerts since prev matches current)
  _prevCustomerStates.clear();
  customers.forEach(c => {
    _prevCustomerStates.set(c.id, _snapFields(c));
  });
  _saveSnapshots();
}

function _snapFields(c) {
  return { score: c.score, status: c.status, nps: c.nps, csat: c.csat, lifecycle: c.lifecycle, renewal_date: c.renewal_date, days: c.days };
}

function _checkSingleTrigger(key, c, prev, s) {
  switch (key) {
    case 'health_below_threshold': {
      var th = (s && s.threshold) || 50;
      return prev && prev.score >= th && c.score < th ? { trigger: key, threshold: th, previous_score: prev.score } : null;
    }
    case 'account_at_risk': {
      var riskS = ['risk', 'critical'];
      var wasOk = !prev || !riskS.includes(prev.status);
      return wasOk && riskS.includes(c.status) ? { trigger: key, previous_status: prev ? prev.status : null } : null;
    }
    case 'renewal_approaching': {
      if (!c.renewal_date) return null;
      var du = Math.round((new Date(c.renewal_date) - new Date()) / 86400000);
      var rd = (s && s.days) || 30;
      var pdu = prev && prev.renewal_date ? Math.round((new Date(prev.renewal_date) - new Date()) / 86400000) : null;
      return du <= rd && du >= 0 && (pdu === null || pdu > rd) ? { trigger: key, days_until_renewal: du, renewal_date: c.renewal_date } : null;
    }
    case 'no_contact': {
      var md = (s && s.max_days) || 14;
      return prev && prev.days <= md && c.days > md ? { trigger: key, days_since_contact: c.days, max_days: md } : null;
    }
    case 'nps_detractor':
      return prev && !npsIsDetractor(prev.nps) && npsIsDetractor(c.nps) ? { trigger: key, previous_nps: npsDisplay(prev.nps), current_nps: npsDisplay(c.nps) } : null;
    case 'csat_poor':
      return prev && !csatIsPoor(prev.csat) && csatIsPoor(c.csat) ? { trigger: key, previous_csat: csatDisplay(prev.csat), current_csat: csatDisplay(c.csat) } : null;
    case 'lifecycle_change': {
      var bad = ['atrisk', 'churned'];
      return prev && !bad.includes(prev.lifecycle) && bad.includes(c.lifecycle) ? { trigger: key, previous_lifecycle: prev.lifecycle, current_lifecycle: c.lifecycle } : null;
    }
    case 'rapid_score_drop': {
      var dp = (s && s.points) || 15;
      return prev && (prev.score - c.score) >= dp ? { trigger: key, previous_score: prev.score, drop_amount: prev.score - c.score, drop_threshold: dp } : null;
    }
    default: return null;
  }
}

async function _fireChannelsForRule(eventType, customer, extra, rule) {
  var conns = automationsCfg.saved_connections || [];
  ['slack', 'teams', 'email'].forEach(async function(chKey) {
    var connId = rule.channels[chKey];
    if (!connId) return;
    var conn = conns.find(function(c) { return c.id === connId; });
    if (!conn) return;
    try {
      if (chKey === 'email' && conn.recipients) {
        await fireEmailAlert(eventType, customer, extra, conn);
      } else if (conn.url) {
        var payload;
        if (chKey === 'slack') payload = buildSlackPayload(eventType, customer, extra);
        else if (chKey === 'teams') payload = buildTeamsPayload(eventType, customer, extra);
        if (payload) await fireWebhook(eventType + '_' + chKey, conn.url, customer, extra, payload);
      }
    } catch (e) { console.warn(chKey + ' fire error:', e.message); }
  });
}

function checkWebhookTriggers(c) {
  const prev = _prevCustomerStates.get(c.id);
  const hasWebhooks = !!automationsCfg.webhooks;
  const rules = automationsCfg.alert_rules || [];
  if (!hasWebhooks && !rules.length && !(automationsCfg.custom_rules || []).length) {
    _prevCustomerStates.set(c.id, _snapFields(c));
    return;
  }

  // ── Cooldown setup ──
  const COOLDOWN_MS = 24 * 60 * 60 * 1000;
  try { if (!Object.keys(_alertCooldowns).length) { const stored = localStorage.getItem('iqc_alert_cooldowns'); if (stored) _alertCooldowns = JSON.parse(stored); } } catch(e){}
  const now = Date.now();
  Object.keys(_alertCooldowns).forEach(k => { if (now - _alertCooldowns[k] > COOLDOWN_MS) delete _alertCooldowns[k]; });

  // ── Evaluate each alert rule independently ──
  rules.forEach(function(rule) {
    if (!rule.enabled) return;
    // Manager scope filter per-rule
    var ms = rule.manager_scope;
    if (ms && ms.mode === 'selected' && ms.managers && ms.managers.length > 0) {
      if (!ms.managers.includes(c.manager || '')) return;
    }
    var ruleSettings = rule.settings || {};
    rule.alert_types.forEach(function(key) {
      var result = _checkSingleTrigger(key, c, prev, ruleSettings[key] || {});
      if (!result) return;
      var cdKey = c.id + '|' + key + '|' + rule.id;
      if (_alertCooldowns[cdKey] && (now - _alertCooldowns[cdKey]) < COOLDOWN_MS) return;
      _alertCooldowns[cdKey] = now;
      _fireChannelsForRule(key, c, result, rule);
    });
  });

  // ── Legacy: Fire direct channels for backward compat with old global config ──
  if (automationsCfg.channels && automationsCfg.selected_alerts && automationsCfg.selected_alerts.length && !rules.length) {
    var settings = automationsCfg.alert_settings || {};
    automationsCfg.selected_alerts.forEach(function(key) {
      var result = _checkSingleTrigger(key, c, prev, settings[key] || {});
      if (!result) return;
      var cdKey = c.id + '|' + key;
      if (_alertCooldowns[cdKey] && (now - _alertCooldowns[cdKey]) < COOLDOWN_MS) return;
      _alertCooldowns[cdKey] = now;
      fireDirectChannels(key, c, result);
    });
  }

  // ── Fire Zapier webhooks (only for original 2 trigger types) ──
  const riskStatuses = ['risk', 'critical'];
  const wasNotRisk = !prev || !riskStatuses.includes(prev.status);
  const isNowRisk = riskStatuses.includes(c.status);

  const hbt = (automationsCfg.webhooks || {}).health_below_threshold;
  if (hbt?.enabled && hbt?.url && prev && prev.score >= (hbt.threshold || 50) && c.score < (hbt.threshold || 50)) {
    const cdKey = c.id + '|hbt_zapier';
    if (!_alertCooldowns[cdKey] || (now - _alertCooldowns[cdKey]) >= COOLDOWN_MS) {
      _alertCooldowns[cdKey] = now;
      fireWebhook('health_below_threshold', hbt.url, c, {
        trigger: 'health_below_threshold', threshold: hbt.threshold || 50, previous_score: prev.score
      });
    }
  }

  const aar = (automationsCfg.webhooks || {}).account_at_risk;
  if (aar?.enabled && aar?.url && wasNotRisk && isNowRisk) {
    const cdKey = c.id + '|aar_zapier';
    if (!_alertCooldowns[cdKey] || (now - _alertCooldowns[cdKey]) >= COOLDOWN_MS) {
      _alertCooldowns[cdKey] = now;
      fireWebhook('account_at_risk', aar.url, c, {
        trigger: 'account_at_risk', previous_status: prev?.status ?? null
      });
    }
  }

  try { localStorage.setItem('iqc_alert_cooldowns', JSON.stringify(_alertCooldowns)); } catch(e){}

  // Evaluate custom rules
  evaluateCustomRules(c);

  // Update snapshot & persist so we don't re-alert on next page load
  _prevCustomerStates.set(c.id, _snapFields(c));
  _saveSnapshots();
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
    rapid_score_drop: 'Rapid Score Drop Alert',
    custom_rule: 'Custom Rule Alert'
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
  if (channels.slack?.enabled && isSubscribed(channels.slack)) {
    var slackConn = resolveConnection('slack');
    if (slackConn && slackConn.url) {
      try {
        const payload = buildSlackPayload(eventType, customer, extra);
        await fireWebhook(eventType + '_slack', slackConn.url, customer, extra, payload);
      } catch (e) { console.warn('Slack channel fire error:', e.message); }
    }
  }

  // Teams
  if (channels.teams?.enabled && isSubscribed(channels.teams)) {
    var teamsConn = resolveConnection('teams');
    if (teamsConn && teamsConn.url) {
      try {
        const payload = buildTeamsPayload(eventType, customer, extra);
        await fireWebhook(eventType + '_teams', teamsConn.url, customer, extra, payload);
      } catch (e) { console.warn('Teams channel fire error:', e.message); }
    }
  }

  // Email
  if (channels.email?.enabled && isSubscribed(channels.email)) {
    var emailConn = resolveConnection('email');
    if (emailConn && emailConn.recipients) {
      try {
        await fireEmailAlert(eventType, customer, extra, emailConn);
      } catch (e) { console.warn('Email channel fire error:', e.message); }
    }
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

// ═══════════════════════════════════════════════════════════════
// CUSTOM RULES — Builder, CRUD, Evaluation, Delivery
// ═══════════════════════════════════════════════════════════════

// ── List rendering ──

function _crRowData(rule) {
  var condPlain = ruleConditionSummaryPlain(rule);
  var sentToArr = [];
  var ch = rule.channels || {};
  ['slack','teams','email'].forEach(function(k) { if (ch[k]) sentToArr.push(k === 'teams' ? 'Teams' : k.charAt(0).toUpperCase() + k.slice(1)); });
  return { name: rule.name || '', condition: condPlain, sentTo: sentToArr.join(', '), sentToArr: sentToArr, creator: rule.created_by || '' };
}

function _filterCrRows(rules) {
  if (!Object.keys(_crFilters).length) return rules;
  return rules.filter(function(rule) {
    var d = _crRowData(rule);
    for (var key in _crFilters) {
      var f = _crFilters[key];
      var val = (d[key] || '').toLowerCase();
      if (f.type === 'text' && val.indexOf(f.q) === -1) return false;
      if (f.type === 'enum') {
        var match = false;
        f.vals.forEach(function(v) { if (val.indexOf(v.toLowerCase()) !== -1) match = true; });
        if (!match) return false;
      }
    }
    return true;
  });
}

function _sortCrRows(rules) {
  if (!_crSortKey) return rules;
  var sorted = rules.slice();
  sorted.sort(function(a, b) {
    var da = _crRowData(a), db = _crRowData(b);
    var va = (da[_crSortKey] || '').toLowerCase(), vb = (db[_crSortKey] || '').toLowerCase();
    return va < vb ? -_crSortDir : va > vb ? _crSortDir : 0;
  });
  return sorted;
}

function renderCustomRulesList() {
  var container = el('custom-rules-list');
  if (!container) return;
  var rules = automationsCfg.custom_rules || [];

  if (!rules.length) {
    container.innerHTML = '<div class="active-alerts-empty">' +
      '<div class="empty-icon">' + _aicoLg(AUTO_ICONS.edit) + '</div>' +
      '<h3 style="margin-bottom:6px">No custom rules yet</h3>' +
      '<p style="font-size:var(--fs-md);margin-bottom:16px">Build multi-condition rules like &ldquo;Score &lt; 40 AND Tier = Enterprise AND Renewal within 60 days&rdquo;.</p>' +
      '<button class="btn btn-sm btn-primary" onclick="openRuleBuilder()">+ Create Rule</button>' +
    '</div>';
    return;
  }

  var filtered = _filterCrRows(rules);
  var sorted = _sortCrRows(filtered);

  var rows = sorted.map(function(rule) {
    var condSummary = ruleConditionSummary(rule);
    var channelTags = ruleChannelTags(rule);
    var disabledStyle = rule.enabled ? '' : 'opacity:.5;';
    var createdBy = rule.created_by || '\u2014';

    return '<tr style="' + disabledStyle + '">' +
      '<td style="font-weight:600">' + escHtml(rule.name) + '</td>' +
      '<td style="font-size:var(--fs-sm);color:var(--muted);max-width:280px;line-height:1.5">' + condSummary + '</td>' +
      '<td>' + channelTags + '</td>' +
      '<td style="font-size:var(--fs-base);color:var(--muted)">' + escHtml(createdBy) + '</td>' +
      '<td style="white-space:nowrap">' +
        '<label class="toggle-switch toggle-sm" style="vertical-align:middle;margin-right:6px" title="' + (rule.enabled ? 'Enabled' : 'Disabled') + '">' +
          '<input type="checkbox" ' + (rule.enabled ? 'checked' : '') + ' onchange="toggleCustomRule(\'' + escHtml(rule.id) + '\', this.checked)"/>' +
          '<span class="toggle-slider"></span>' +
        '</label>' +
        '<button class="btn btn-xs btn-ghost" onclick="editCustomRule(\'' + escHtml(rule.id) + '\')" title="Edit">' + _aicoSm(AUTO_ICONS.edit) + '</button> ' +
        '<button class="btn btn-xs btn-ghost" style="color:var(--red)" onclick="deleteCustomRule(\'' + escHtml(rule.id) + '\')" title="Delete">' + _aicoSm(AUTO_ICONS.x) + '</button>' +
      '</td></tr>';
  }).join('');

  var headerRow = _buildSortFilterTh(CUSTOM_COL_DEFS, _crSortKey, _crSortDir, _crFilters, 'crSortBy', 'openCrFilter') +
    '<th style="width:120px"><div class="col-th-inner"><span class="col-sort-label no-sort">Actions</span></div></th>';

  var filterPills = _buildFilterPills(_crFilters, CUSTOM_COL_DEFS, 'openCrFilter', 'clearCrFilter');

  container.innerHTML = filterPills +
    '<table class="alert-summary-table">' +
    '<thead><tr>' + headerRow + '</tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';
}

function ruleConditionSummary(rule) {
  return (rule.groups || []).map(function(g) {
    var parts = (g.conditions || []).map(function(cond) {
      var fd = RULE_FIELD_DEFS.find(function(f) { return f.key === cond.field; });
      var label = fd ? fd.label : cond.field;
      var opLabel = RULE_OP_LABELS_LONG[cond.op] || cond.op;
      return escHtml(label) + ' ' + escHtml(opLabel) + ' <strong>' + escHtml(String(cond.value)) + '</strong>';
    });
    return parts.join(' <span style="color:var(--blue);font-weight:600">AND</span> ');
  }).join(' <span style="color:var(--purple,#7c3aed);font-weight:700;margin:0 4px">OR</span> ');
}

function ruleChannelTags(rule) {
  var ch = rule.channels || {};
  var conns = automationsCfg.saved_connections || [];
  var parts = [];
  ['slack','teams','email'].forEach(function(k) {
    if (ch[k]) {
      var connName = '';
      if (typeof ch[k] === 'string') {
        var conn = conns.find(function(c) { return c.id === ch[k]; });
        if (conn && conn.name) connName = ' (' + escHtml(conn.name) + ')';
      }
      var label = k === 'teams' ? 'Teams' : k.charAt(0).toUpperCase() + k.slice(1);
      parts.push('<span class="dest-tag">' + _aicoSm(AUTO_ICONS[k]) + ' ' + label + connName + '</span>');
    }
  });
  return parts.join(' ') || '<span style="color:var(--muted);font-size:var(--fs-sm)">No channels</span>';
}

// ── Builder open/close ──

function openRuleBuilder(existingRuleId) {
  if (existingRuleId) {
    var rule = (automationsCfg.custom_rules || []).find(function(r) { return r.id === existingRuleId; });
    if (!rule) return;
    _editingRule = existingRuleId;
    _ruleBuilderData = JSON.parse(JSON.stringify(rule));
    el('rule-builder-title').textContent = 'Edit Rule';
  } else {
    _editingRule = null;
    _ruleBuilderData = {
      id: 'cr-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      name: '',
      enabled: true,
      groups: [{ conditions: [{ field: 'score', op: 'lt', value: 50 }] }],
      channels: { slack: false, teams: false, email: false },
      created_at: new Date().toISOString(),
      created_by: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : ''
    };
    el('rule-builder-title').textContent = 'New Custom Rule';
  }

  _ruleWizardStep = 1;
  openModal('rule-builder-modal');
  renderRuleBuilderBody();
}

function closeRuleBuilder() {
  _editingRule = null;
  _ruleBuilderData = null;
  _ruleWizardStep = 1;
  closeModal('rule-builder-modal');
  var previewEl = el('rule-preview-results');
  if (previewEl) { previewEl.style.display = 'none'; previewEl.innerHTML = ''; }
}

function editCustomRule(ruleId) {
  openRuleBuilder(ruleId);
}

// ── Builder body rendering ──

function renderRuleBuilderBody() {
  var body = el('rule-builder-body');
  var footer = el('rule-builder-footer');
  if (!body || !_ruleBuilderData) return;

  // Update stepper
  var stepperEl = el('rule-builder-stepper');
  if (stepperEl) {
    stepperEl.querySelectorAll('.wizard-step').forEach(function(s) {
      var sn = parseInt(s.dataset.step);
      s.classList.toggle('active', sn === _ruleWizardStep);
      s.classList.toggle('completed', sn < _ruleWizardStep);
    });
    stepperEl.querySelectorAll('.wizard-step__line').forEach(function(line, i) {
      line.classList.toggle('completed', (i + 1) < _ruleWizardStep);
    });
  }

  if (_ruleWizardStep === 1) {
    renderRuleBuilderStep1(body, footer);
  } else {
    renderRuleBuilderStep2(body, footer);
  }
}

function renderRuleBuilderStep1(body, footer) {
  var html = '<div style="padding:18px 20px">';

  // Rule name
  html += '<div style="margin-bottom:18px">' +
    '<label style="font-size:var(--fs-base);font-weight:700;margin-bottom:6px;display:block">Rule Name</label>' +
    '<input type="text" class="rule-name-input" value="' + escHtml(_ruleBuilderData.name) + '"' +
      ' placeholder="e.g. Enterprise Churn Risk"' +
      ' oninput="_ruleBuilderData.name=this.value"/>' +
  '</div>';

  // Conditions
  html += '<div style="margin-bottom:14px">' +
    '<label style="font-size:var(--fs-base);font-weight:700;display:block;margin-bottom:4px">Conditions</label>' +
    '<p style="font-size:var(--fs-sm);color:var(--muted);margin:0 0 12px">All conditions in a group must match (AND). If any group matches, the rule fires (OR).</p>';

  _ruleBuilderData.groups.forEach(function(group, gi) {
    if (gi > 0) {
      html += '<div class="rule-or-divider">OR</div>';
    }
    html += '<div class="rule-group">' +
      '<div class="rule-group-header">' +
        '<span class="rule-group-label">Group ' + (gi + 1) + ' &mdash; all must match</span>' +
        (_ruleBuilderData.groups.length > 1
          ? '<button class="btn btn-xs btn-ghost" onclick="removeRuleGroup(' + gi + ')" style="color:var(--red);font-size:var(--fs-sm)">Remove</button>'
          : '') +
      '</div>';

    group.conditions.forEach(function(cond, ci) {
      html += renderConditionRow(gi, ci, cond);
    });

    html += '<button class="rule-add-condition" onclick="addRuleCondition(' + gi + ')">+ Add condition</button>' +
    '</div>';
  });

  html += '<button class="rule-add-or-group" onclick="addRuleOrGroup()">+ Add OR group</button>' +
  '</div></div>';

  body.innerHTML = html;

  // Preview results container — hide when body re-renders (conditions changed)
  var previewEl = el('rule-preview-results');
  if (previewEl) previewEl.style.display = 'none';

  // Footer — Step 1: Preview + Next
  footer.innerHTML = '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-sm btn-ghost" onclick="previewRuleMatches()" style="color:var(--blue);border:1.5px solid var(--blue);border-radius:8px">&#x1f50d; Preview Matches</button>' +
    '</div>' +
    '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-sm btn-ghost" onclick="closeRuleBuilder()">Cancel</button>' +
      '<button class="btn btn-sm btn-primary" onclick="ruleWizardNext()">Next &rarr;</button>' +
    '</div>';
}

function renderRuleBuilderStep2(body, footer) {
  var channels = automationsCfg.channels || {};
  var html = '<div style="padding:18px 20px">';

  html += '<h3 style="margin:0 0 4px;font-size:1rem">Where should alerts be sent?</h3>' +
    '<p style="font-size:var(--fs-base);color:var(--muted);margin:0 0 16px">Enable delivery channels and configure their connection details.</p>';

  CHANNELS.forEach(function(ch) {
    var isOn = !!(_ruleBuilderData.channels || {})[ch.key];

    var configInputs = '';
    if (isOn) {
      var currentConnId = typeof (_ruleBuilderData.channels || {})[ch.key] === 'string'
        ? _ruleBuilderData.channels[ch.key]
        : ((automationsCfg.channels || {})[ch.key] || {}).connection_id || '';
      configInputs = renderConnectionSelector(ch, currentConnId, 'onRuleConnectionChange', 'rule');
    }

    html += '<div class="wizard-channel-row">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<span style="flex-shrink:0;display:flex;align-items:center;color:var(--blue)">' + ch.icon + '</span>' +
          '<div>' +
            '<div style="font-weight:600;font-size:var(--fs-md)">' + escHtml(ch.label) + '</div>' +
            '<div style="font-size:var(--fs-sm);color:var(--muted)">' + escHtml(ch.desc) + '</div>' +
          '</div>' +
        '</div>' +
        '<label class="toggle-switch">' +
          '<input type="checkbox" ' + (isOn ? 'checked' : '') +
            ' onchange="toggleRuleChannel2(\'' + ch.key + '\', this.checked)"/>' +
          '<span class="toggle-slider"></span>' +
        '</label>' +
      '</div>' +
      configInputs +
    '</div>';
  });

  html += '</div>';
  body.innerHTML = html;

  // Footer — Step 2: Back + Save
  footer.innerHTML = '<div>' +
      '<button class="btn btn-sm btn-ghost" onclick="ruleWizardBack()">&larr; Back</button>' +
    '</div>' +
    '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-sm btn-ghost" onclick="closeRuleBuilder()">Cancel</button>' +
      '<button class="btn btn-sm btn-primary" onclick="saveCustomRule()">Save Rule</button>' +
    '</div>';
}

function renderConditionRow(groupIdx, condIdx, cond) {
  var fd = RULE_FIELD_DEFS.find(function(f) { return f.key === cond.field; }) || RULE_FIELD_DEFS[0];

  // Field dropdown
  var fieldSelect = '<select onchange="updateRuleCondField(' + groupIdx + ',' + condIdx + ',this.value)">' +
    RULE_FIELD_DEFS.map(function(f) {
      return '<option value="' + f.key + '"' + (f.key === cond.field ? ' selected' : '') + '>' + escHtml(f.label) + '</option>';
    }).join('') + '</select>';

  // Operator dropdown
  var opSelect = '<select onchange="updateRuleCondOp(' + groupIdx + ',' + condIdx + ',this.value)">' +
    fd.ops.map(function(op) {
      return '<option value="' + op + '"' + (op === cond.op ? ' selected' : '') + '>' + escHtml(RULE_OP_LABELS[op]) + '</option>';
    }).join('') + '</select>';

  // Value input
  var valueInput;
  if (fd.type === 'enum') {
    valueInput = '<select onchange="updateRuleCondValue(' + groupIdx + ',' + condIdx + ',this.value)">' +
      fd.options.map(function(o) {
        return '<option value="' + o + '"' + (String(cond.value) === o ? ' selected' : '') + '>' + escHtml(o) + '</option>';
      }).join('') + '</select>';
  } else if (fd.type === 'number') {
    valueInput = '<input type="number" value="' + (cond.value != null ? cond.value : '') + '"' +
      ' onchange="updateRuleCondValue(' + groupIdx + ',' + condIdx + ',+this.value)"/>';
  } else {
    valueInput = '<input type="text" value="' + escHtml(String(cond.value || '')) + '"' +
      ' onchange="updateRuleCondValue(' + groupIdx + ',' + condIdx + ',this.value)"/>';
  }

  // Remove button
  var canRemove = _ruleBuilderData.groups[groupIdx].conditions.length > 1;
  var removeBtn = canRemove
    ? '<button class="rule-remove-btn" onclick="removeRuleCondition(' + groupIdx + ',' + condIdx + ')" title="Remove">&times;</button>'
    : '';

  return '<div class="rule-condition-row">' +
    (condIdx > 0 ? '<span style="font-size:var(--fs-sm);font-weight:700;color:var(--blue);min-width:36px;text-align:center">AND</span>' : '<span style="min-width:36px"></span>') +
    fieldSelect + opSelect + valueInput + removeBtn +
  '</div>';
}

// ── Builder mutations ──

function updateRuleCondField(gi, ci, newField) {
  var fd = RULE_FIELD_DEFS.find(function(f) { return f.key === newField; }) || RULE_FIELD_DEFS[0];
  var cond = _ruleBuilderData.groups[gi].conditions[ci];
  cond.field = newField;
  cond.op = fd.ops[0];
  if (fd.type === 'enum') cond.value = fd.options[0];
  else if (fd.type === 'number') cond.value = 50;
  else cond.value = '';
  renderRuleBuilderBody();
}

function updateRuleCondOp(gi, ci, newOp) {
  _ruleBuilderData.groups[gi].conditions[ci].op = newOp;
}

function updateRuleCondValue(gi, ci, newValue) {
  _ruleBuilderData.groups[gi].conditions[ci].value = newValue;
}

function addRuleCondition(gi) {
  _ruleBuilderData.groups[gi].conditions.push({ field: 'score', op: 'lt', value: 50 });
  renderRuleBuilderBody();
}

function removeRuleCondition(gi, ci) {
  _ruleBuilderData.groups[gi].conditions.splice(ci, 1);
  renderRuleBuilderBody();
}

function addRuleOrGroup() {
  _ruleBuilderData.groups.push({ conditions: [{ field: 'score', op: 'lt', value: 50 }] });
  renderRuleBuilderBody();
}

function removeRuleGroup(gi) {
  _ruleBuilderData.groups.splice(gi, 1);
  renderRuleBuilderBody();
}

function toggleRuleChannel(chKey, checked) {
  if (!_ruleBuilderData.channels) _ruleBuilderData.channels = {};
  _ruleBuilderData.channels[chKey] = checked;
}

function toggleRuleChannel2(chKey, checked) {
  if (!_ruleBuilderData) return;
  if (!_ruleBuilderData.channels) _ruleBuilderData.channels = {};
  if (checked) {
    // Default to global connection if available, else true
    var globalConnId = ((automationsCfg.channels || {})[chKey] || {}).connection_id;
    _ruleBuilderData.channels[chKey] = globalConnId || true;
  } else {
    _ruleBuilderData.channels[chKey] = false;
  }
  // Also enable/disable the global channel config so URLs are available
  if (!automationsCfg.channels) automationsCfg.channels = {};
  if (!automationsCfg.channels[chKey]) automationsCfg.channels[chKey] = {};
  automationsCfg.channels[chKey].enabled = checked;
  if (checked && !automationsCfg.channels[chKey].alerts) {
    automationsCfg.channels[chKey].alerts = ALERT_TYPES.map(function(a) { return a.key; });
  }
  saveAutomationsCfg();
  renderRuleBuilderBody();
}

function updateRuleChannelValue(chKey, value) {
  if (!automationsCfg.channels) automationsCfg.channels = {};
  if (!automationsCfg.channels[chKey]) automationsCfg.channels[chKey] = {};
  if (chKey === 'email') automationsCfg.channels[chKey].recipients = value.trim();
  else automationsCfg.channels[chKey].url = value.trim();
  saveAutomationsCfg();
}

function updateRuleChannelMeta(chKey, prop, value) {
  if (!automationsCfg.channels) automationsCfg.channels = {};
  if (!automationsCfg.channels[chKey]) automationsCfg.channels[chKey] = {};
  automationsCfg.channels[chKey][prop] = value;
  saveAutomationsCfg();
}

function ruleWizardNext() {
  // Validate step 1
  if (!_ruleBuilderData) return;
  for (var gi = 0; gi < _ruleBuilderData.groups.length; gi++) {
    for (var ci = 0; ci < _ruleBuilderData.groups[gi].conditions.length; ci++) {
      var c = _ruleBuilderData.groups[gi].conditions[ci];
      if (c.value === '' || c.value === null || c.value === undefined) {
        toast('Please fill in all condition values', 'error'); return;
      }
    }
  }
  _ruleWizardStep = 2;
  renderRuleBuilderBody();
}

function ruleWizardBack() {
  _ruleWizardStep = 1;
  renderRuleBuilderBody();
}

// ── CRUD ──

function saveCustomRule() {
  if (!_ruleBuilderData) return;
  if (!_ruleBuilderData.name.trim()) { toast('Please give your rule a name', 'error'); return; }
  var hasChannel = Object.values(_ruleBuilderData.channels || {}).some(function(v) { return v; });
  if (!hasChannel) { toast('Select at least one notification channel', 'error'); return; }
  // Validate each enabled channel has a configured connection
  var missingConn = [];
  ['slack', 'teams', 'email'].forEach(function(k) {
    if (_ruleBuilderData.channels[k]) {
      var connId = typeof _ruleBuilderData.channels[k] === 'string' ? _ruleBuilderData.channels[k] : null;
      var conn = connId
        ? (automationsCfg.saved_connections || []).find(function(c) { return c.id === connId; })
        : resolveConnection(k);
      if (!conn || (!conn.url && !conn.recipients)) {
        var label = k === 'teams' ? 'Microsoft Teams' : k.charAt(0).toUpperCase() + k.slice(1);
        missingConn.push(label);
      }
    }
  });
  if (missingConn.length > 0) { toast(missingConn.join(', ') + ' enabled but no connection configured — please select or add one', 'error'); return; }
  for (var gi = 0; gi < _ruleBuilderData.groups.length; gi++) {
    for (var ci = 0; ci < _ruleBuilderData.groups[gi].conditions.length; ci++) {
      var c = _ruleBuilderData.groups[gi].conditions[ci];
      if (c.value === '' || c.value === null || c.value === undefined) {
        toast('Please fill in all condition values', 'error'); return;
      }
    }
  }

  if (!automationsCfg.custom_rules) automationsCfg.custom_rules = [];

  if (_editingRule) {
    var idx = automationsCfg.custom_rules.findIndex(function(r) { return r.id === _editingRule; });
    if (idx >= 0) automationsCfg.custom_rules[idx] = _ruleBuilderData;
    else automationsCfg.custom_rules.push(_ruleBuilderData);
  } else {
    automationsCfg.custom_rules.push(_ruleBuilderData);
  }

  var ruleName = _ruleBuilderData.name;
  var wasEdit = !!_editingRule;
  saveAutomationsCfg();
  closeRuleBuilder();
  renderCustomRulesList();
  logAudit('custom_rule_saved', null, '', { summary: (wasEdit ? 'Updated' : 'Created') + ' custom rule: ' + ruleName });
  toast('Custom rule saved!', 'success');
}

function toggleCustomRule(ruleId, enabled) {
  var rule = (automationsCfg.custom_rules || []).find(function(r) { return r.id === ruleId; });
  if (rule) {
    rule.enabled = enabled;
    saveAutomationsCfg();
    renderCustomRulesList();
  }
}

function deleteCustomRule(ruleId) {
  if (!confirm('Delete this custom rule? This cannot be undone.')) return;
  var name = '';
  automationsCfg.custom_rules = (automationsCfg.custom_rules || []).filter(function(r) {
    if (r.id === ruleId) { name = r.name; return false; }
    return true;
  });
  saveAutomationsCfg();
  closeRuleBuilder();
  renderCustomRulesList();
  logAudit('custom_rule_deleted', null, '', { summary: 'Deleted custom rule: ' + name });
  toast('Rule deleted', 'success');
}

// ── Preview matches ──

function previewRuleMatches() {
  var previewEl = el('rule-preview-results');
  if (!previewEl || !_ruleBuilderData) return;

  // Validate conditions have values
  for (var gi = 0; gi < _ruleBuilderData.groups.length; gi++) {
    for (var ci = 0; ci < _ruleBuilderData.groups[gi].conditions.length; ci++) {
      var c = _ruleBuilderData.groups[gi].conditions[ci];
      if (c.value === '' || c.value === null || c.value === undefined) {
        toast('Please fill in all condition values before previewing', 'error'); return;
      }
    }
  }

  // Evaluate against all customers
  var matches = [];
  (customers || []).forEach(function(cust) {
    var hit = _ruleBuilderData.groups.some(function(group) {
      return group.conditions.every(function(cond) {
        return evaluateCondition(cust, cond);
      });
    });
    if (hit) matches.push(cust);
  });

  // Sort matches by score ascending (worst first)
  matches.sort(function(a, b) { return (a.score || 0) - (b.score || 0); });

  var html = '<div class="rule-preview-wrap">';
  html += '<div class="rule-preview-header">' +
    '<h3>Preview: Matching Accounts</h3>' +
    '<span class="rule-preview-count">' + matches.length + ' of ' + (customers || []).length + ' accounts match</span>' +
  '</div>';

  if (matches.length === 0) {
    html += '<div class="rule-preview-empty">No accounts match the current conditions.</div>';
  } else {
    html += '<div class="rule-preview-scroll"><table class="rule-preview-table">' +
      '<thead><tr><th>Account</th><th>Score</th><th>Status</th><th>Tier</th><th>MRR</th><th>Days Since Contact</th></tr></thead><tbody>';

    var shown = matches.slice(0, 50);
    shown.forEach(function(m) {
      var sc = m.score != null ? m.score : '—';
      var statusColor = m.status === 'critical' ? 'var(--red)' : m.status === 'risk' ? 'var(--orange)' : m.status === 'watch' ? '#eab308' : m.status === 'healthy' ? 'var(--green)' : 'var(--blue)';
      var scoreColor = sc >= 80 ? 'var(--green)' : sc >= 60 ? '#eab308' : sc >= 40 ? 'var(--orange)' : 'var(--red)';
      var days = typeof getEffectiveDays === 'function' ? getEffectiveDays(m) : m.days;
      var mrr = m.mrr != null ? '$' + Number(m.mrr).toLocaleString() : '—';
      html += '<tr>' +
        '<td style="font-weight:600">' + escHtml(m.name) + '</td>' +
        '<td><span class="score-cell" style="background:' + scoreColor + ';color:#fff">' + sc + '</span></td>' +
        '<td><span style="color:' + statusColor + ';font-weight:600;text-transform:capitalize">' + escHtml(m.status || '—') + '</span></td>' +
        '<td style="text-transform:capitalize">' + escHtml(m.tier || '—') + '</td>' +
        '<td>' + mrr + '</td>' +
        '<td>' + (days != null ? days + 'd' : '—') + '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';
    if (matches.length > 50) {
      html += '<p style="font-size:var(--fs-sm);color:var(--muted);margin:8px 0 0;text-align:center">Showing first 50 of ' + matches.length + ' matches</p>';
    }
  }

  html += '</div>';
  previewEl.innerHTML = html;
  previewEl.style.display = 'block';

  // Scroll into view
  previewEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Evaluation engine ──

function evaluateCustomRules(c) {
  var rules = automationsCfg.custom_rules || [];
  if (!rules.length) return;

  var now = Date.now();
  var COOLDOWN_MS = 24 * 60 * 60 * 1000;

  rules.forEach(function(rule) {
    if (!rule.enabled) return;

    // 24h cooldown per customer + rule
    var cdKey = c.id + '|cr|' + rule.id;
    if (_alertCooldowns[cdKey] && (now - _alertCooldowns[cdKey]) < COOLDOWN_MS) return;

    // OR between groups, AND within each group
    var matches = rule.groups.some(function(group) {
      return group.conditions.every(function(cond) {
        return evaluateCondition(c, cond);
      });
    });

    if (matches) {
      _alertCooldowns[cdKey] = now;
      try { localStorage.setItem('iqc_alert_cooldowns', JSON.stringify(_alertCooldowns)); } catch(e) {}
      fireCustomRuleAlert(rule, c);
    }
  });
}

function evaluateCondition(c, cond) {
  var actual = getConditionFieldValue(c, cond.field);
  var expected = cond.value;
  if (actual == null) return false;

  switch (cond.op) {
    case 'lt':  return Number(actual) <  Number(expected);
    case 'gt':  return Number(actual) >  Number(expected);
    case 'lte': return Number(actual) <= Number(expected);
    case 'gte': return Number(actual) >= Number(expected);
    case 'eq':  return String(actual).toLowerCase() === String(expected).toLowerCase();
    case 'neq': return String(actual).toLowerCase() !== String(expected).toLowerCase();
    case 'contains': return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case 'not_contains': return !String(actual).toLowerCase().includes(String(expected).toLowerCase());
    default: return false;
  }
}

function getConditionFieldValue(c, field) {
  switch (field) {
    case 'score':     return c.score;
    case 'status':    return c.status;
    case 'tier':      return c.tier;
    case 'lifecycle': return c.lifecycle;
    case 'logins':    return c.logins;
    case 'adoption':  return c.adoption;
    case 'tickets':   return c.tickets;
    case 'nps':       return c.nps;
    case 'csat':      return c.csat;
    case 'mrr':       return c.mrr;
    case 'days':      return typeof getEffectiveDays === 'function' ? getEffectiveDays(c) : c.days;
    case 'growth':    return c.growth;
    case 'momentum':  return typeof getMomentum === 'function' ? getMomentum(c) : 'flat';
    case 'cadence_status': return typeof getCadenceStatus === 'function' ? getCadenceStatus(c).status : 'ok';
    case 'renewal_within':
      if (!c.renewal_date) return null;
      return Math.round((new Date(c.renewal_date) - new Date()) / (1000 * 60 * 60 * 24));
    case 'tags':
      return Array.isArray(c.tags) ? c.tags.join(',') : (c.tags || '');
    case 'manager':   return c.manager || '';
    default:          return c[field];
  }
}

// ── Custom rule delivery ──

async function fireCustomRuleAlert(rule, customer) {
  var globalChannels = automationsCfg.channels || {};
  var ruleChannels = rule.channels || {};
  var eventType = 'custom_rule';
  var extra = {
    trigger: 'custom_rule',
    rule_name: rule.name,
    rule_id: rule.id,
    matched_conditions: ruleConditionSummaryPlain(rule)
  };

  if (ruleChannels.slack) {
    var slackConnId = typeof ruleChannels.slack === 'string' ? ruleChannels.slack : null;
    var slackConn = slackConnId
      ? (automationsCfg.saved_connections || []).find(function(c) { return c.id === slackConnId; })
      : resolveConnection('slack');
    if (slackConn && slackConn.url) {
      try {
        var slackPayload = buildSlackPayload(eventType, customer, extra);
        await fireWebhook(eventType + '_slack_' + rule.id, slackConn.url, customer, extra, slackPayload);
      } catch (e) { console.warn('Custom rule Slack error:', e.message); }
    }
  }

  if (ruleChannels.teams) {
    var teamsConnId = typeof ruleChannels.teams === 'string' ? ruleChannels.teams : null;
    var teamsConn = teamsConnId
      ? (automationsCfg.saved_connections || []).find(function(c) { return c.id === teamsConnId; })
      : resolveConnection('teams');
    if (teamsConn && teamsConn.url) {
      try {
        var teamsPayload = buildTeamsPayload(eventType, customer, extra);
        await fireWebhook(eventType + '_teams_' + rule.id, teamsConn.url, customer, extra, teamsPayload);
      } catch (e) { console.warn('Custom rule Teams error:', e.message); }
    }
  }

  if (ruleChannels.email) {
    var emailConnId = typeof ruleChannels.email === 'string' ? ruleChannels.email : null;
    var emailConn = emailConnId
      ? (automationsCfg.saved_connections || []).find(function(c) { return c.id === emailConnId; })
      : resolveConnection('email');
    if (emailConn && emailConn.recipients) {
      try {
        await fireEmailAlert(eventType, customer, extra, emailConn);
      } catch (e) { console.warn('Custom rule Email error:', e.message); }
    }
  }
}

function ruleConditionSummaryPlain(rule) {
  return (rule.groups || []).map(function(g) {
    return g.conditions.map(function(cond) {
      var fd = RULE_FIELD_DEFS.find(function(f) { return f.key === cond.field; });
      return (fd ? fd.label : cond.field) + ' ' + (RULE_OP_LABELS_LONG[cond.op] || cond.op) + ' ' + cond.value;
    }).join(' AND ');
  }).join(' OR ');
}

/* ============================================================
   IQcadence - CS Health Score - app.js
   ============================================================ */
const APP_VERSION = 'v93';
console.log('%c IQcadence ' + APP_VERSION + ' loaded ', 'background:#6366f1;color:#fff;font-weight:bold;padding:2px 8px;border-radius:4px');

// ─── UNIFIED ICON SYSTEM ─────────────────────────────────────
// Feather-style SVG paths - 24×24 viewBox, stroke-based.
// Usage: appIcon('check', 16) → <svg ...>
const APP_ICONS = {
  /* Sentiment */
  sentPositive: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><circle cx="9" cy="9" r=".5" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r=".5" fill="currentColor" stroke="none"/>',
  sentNeutral:  '<circle cx="12" cy="12" r="10"/><line x1="8" y1="15" x2="16" y2="15"/><circle cx="9" cy="9" r=".5" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r=".5" fill="currentColor" stroke="none"/>',
  sentNegative: '<circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><circle cx="9" cy="9" r=".5" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r=".5" fill="currentColor" stroke="none"/>',
  /* Validation */
  check:       '<polyline points="20 6 9 17 4 12"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  /* Alert / warning */
  warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  /* Actions */
  bolt:    '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  target:  '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  sparkle: '<path d="M12 3l1.8 5.4L19.2 10l-5.4 1.6L12 17l-1.8-5.4L4.8 10l5.4-1.6z"/>',
  rocket:  '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 3 0 3 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-3 0-3"/>',
  /* UI chrome */
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  edit:     '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  save:     '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  trash:    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  x:        '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  tag:      '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  /* Content */
  mailbox:   '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/>',
  users:     '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
  lock:      '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  folder:    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  mail:      '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/>',
  /* Data viz */
  trendUp:   '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  trendDown: '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>',
  chartBar:  '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  calendar:  '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  download:  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  refresh:   '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'
};

function appIcon(key, size) {
  size = size || 16;
  var p = APP_ICONS[key];
  if (!p) return '';
  return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0">'+p+'</svg>';
}

function statusDotSVG(status) {
  var colors = { critical:'var(--red)', risk:'#ea580c', watch:'var(--amber)', healthy:'var(--green)', expand:'var(--purple)' };
  var c = colors[status] || 'var(--subtle)';
  return '<svg width="10" height="10" viewBox="0 0 10 10" style="display:inline-block;vertical-align:middle"><circle cx="5" cy="5" r="4" fill="'+c+'" stroke="none"/></svg>';
}

// ─── SUPABASE CLIENT ─────────────────────────────────────────
// NOTE: The anon key is intentionally public - Supabase security comes from
// Row Level Security (RLS) policies, not from hiding this key.
// Admin emails are loaded from js/config.js (gitignored) if available.
const _cfg = window.__IQCADENCE_CONFIG__ || {};
const SUPABASE_URL  = _cfg.SUPABASE_URL  || 'https://qctiyigznbztxcowehnl.supabase.co';
const SUPABASE_ANON = _cfg.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjdGl5aWd6bmJ6dHhjb3dlaG5sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NTEwMjcsImV4cCI6MjA4NzEyNzAyN30.Uto2G5WzDIgDplQlgSwvo1BT3voym8msjZSSy9GUBsg';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let currentUser = null; // set after auth

// ─── STATE ──────────────────────────────────────────────────
let customers  = [];
let snoozed    = new Map(); // id → expiry timestamp (ms)
let selectedIds= new Set();
let sortKey    = 'score';
let sortDir    = -1; // -1 = desc
let filterMode = 'all';
let activeManagers = new Set();
let mgrFilterAll   = true; // true = show all managers, false = use activeManagers set
const SEG_UNTAGGED = '__untagged__';
const SEG_UNTAGGED_LABEL = 'Untagged';
function segDisplayLabel(tag) { return tag === SEG_UNTAGGED ? SEG_UNTAGGED_LABEL : tag; }
let _userRole      = null;      // 'admin' | 'user' - fetched from user_profiles on login
let _userClientId  = null;      // user's client_id - resolved from user_profiles on login
let adminClients   = [];        // list of {id, name, notes} - admin only
let activeClientId = '__own__'; // '__own__' = admin's own data, else client UUID
let trash          = [];        // soft-deleted customers
let columnFilters  = {};        // per-column filter state (see COL_DEFS)
let _openColFilterKey = null;   // key of currently open column filter dropdown
let filterPresets  = [];        // saved filter presets [{ name, filterMode, columnFilters, sortKey, sortDir }]
let mrrExposureFilter = null;   // { label: string, ids: Set<string> } - set by clicking MRR Exposure rows
let _filterTier       = null;   // tier filter for customers table (set by segment click-through)
let _filterStage      = null;   // lifecycle stage filter for customers table (set by stage click-through)
let _filterManager    = null;   // CSM name filter for customers table (set by workload click-through)
let insightFilter     = null;   // { label: string, ids: Set<string> } - set by insight card click-through

// ─── AI INTEGRATION STATE ────────────────────────────────────
let _aiIntegrationConnected = false; // set true when Anthropic integration is connected

// ─── AUTOMATIONS STATE ──────────────────────────────────────
let automationsCfg    = {};        // { api_key_prefix, webhooks: { type: { url, enabled, threshold? } } }
let webhookEvents     = [];        // loaded from webhook_events table
let webhookLogOffset  = 0;
let _prevCustomerStates = new Map(); // id → { score, status } for trigger detection
let _alertCooldowns     = {};       // "custId|eventKey" → timestamp - dedup same alert within 24h

// ─── SHARED PAGINATION ──────────────────────────────────────
const PAGE_SIZE = 50;
const _pagState = {}; // key → current page (0-indexed)

function _pagGet(key) { return _pagState[key] || 0; }
function _pagSet(key, pg, renderFn) { _pagState[key] = pg; if (renderFn) renderFn(); }

// Build page controls HTML - place at top and/or bottom of a list
// total = total item count, key = state key, renderFnName = global function name to call on page change
function _pagHTML(total, key, renderFnName) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return '';
  const cur = _pagGet(key);
  const btns = [];
  btns.push(`<button class="pag-btn${cur===0?' disabled':''}" onclick="if(${cur}>0){_pagSet('${key}',${cur}-1,${renderFnName})}" ${cur===0?'disabled':''}>&lsaquo;</button>`);
  // Show max 7 page buttons with ellipsis
  const show = [];
  for (let i = 0; i < pages; i++) {
    if (i === 0 || i === pages-1 || (i >= cur-2 && i <= cur+2)) show.push(i);
    else if (show.length && show[show.length-1] !== -1) show.push(-1); // ellipsis marker
  }
  show.forEach(i => {
    if (i === -1) { btns.push('<span class="pag-ellipsis">&hellip;</span>'); return; }
    btns.push(`<button class="pag-btn${i===cur?' active':''}" onclick="_pagSet('${key}',${i},${renderFnName})">${i+1}</button>`);
  });
  btns.push(`<button class="pag-btn${cur>=pages-1?' disabled':''}" onclick="if(${cur}<${pages-1}){_pagSet('${key}',${cur}+1,${renderFnName})}" ${cur>=pages-1?'disabled':''}>&rsaquo;</button>`);
  return `<div class="pag-wrap">${btns.join('')}<span class="pag-info">${cur*PAGE_SIZE+1}–${Math.min((cur+1)*PAGE_SIZE,total)} of ${total}</span></div>`;
}

// ─── PLAN TIER GATING ──────────────────────────────────────
let clientPlanTier = 'growth'; // default until resolved - admin gets custom via isAdmin()
let _subscriptionStatus = 'none'; // none | active | past_due | canceled | incomplete

const PLAN_TIERS = ['core', 'growth', 'custom'];
const PLAN_TIER_LABELS = { core: 'Core', growth: 'Growth', custom: 'Custom' };
const PLAN_TIER_COLORS = { core: 'var(--teal)', growth: 'var(--blue)', custom: 'var(--purple)' };

const PLAN_FEATURES = {
  // Core (basic)
  reports_basic:     'core',
  trend_sparklines:  'core',
  email_digest:      'core',
  renewal_pipeline:  'core',
  urgency_scoring:   'core',
  at_risk_alerts:    'core',
  priority_list:     'core',
  // Growth+
  csm_filtering:     'growth',
  manager_dashboard: 'growth',
  sentiment:         'growth',
  audit_log:         'growth',
  custom_tags:       'growth',
  scoring_profiles:  'growth',
  segments:          'growth',
  alert_channels:    'growth',
  report_segments:   'growth',
  // Custom+
  next_best_action:  'custom',
  qbr_prep:          'custom',
  csm_performance:   'custom',
  report_csmperf:    'custom',
  playbooks:         'custom',
  momentum:          'custom',
  automations:       'custom',
  api_webhooks:      'custom',
  signal_model:      'custom',
  white_label:       'custom',
};

const PLAN_LIMITS = {
  core:   { users: 3,   accounts: 200,  ai_calls: 50 },
  growth: { users: 10,  accounts: 1000, ai_calls: 500 },
  custom: { users: Infinity, accounts: Infinity, ai_calls: Infinity },
};

// ─── AI USAGE TRACKING ──────────────────────────────────────
let _aiCallCount = 0;
let _aiCallMonth = '';

function _aiUsageKey() { return 'iqc_ai_usage_' + (_userClientId || 'local'); }

function _loadAIUsage() {
  try {
    var stored = JSON.parse(localStorage.getItem(_aiUsageKey()) || '{}');
    var now = new Date();
    var curMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    if (stored.month === curMonth) {
      _aiCallCount = stored.count || 0;
    } else {
      _aiCallCount = 0;
    }
    _aiCallMonth = curMonth;
  } catch(e) { _aiCallCount = 0; }
}

function _trackAICall() {
  _aiCallCount++;
  var now = new Date();
  _aiCallMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  try { localStorage.setItem(_aiUsageKey(), JSON.stringify({ month: _aiCallMonth, count: _aiCallCount })); } catch(e) {}
}

function checkAILimit() {
  if (isAdmin()) return true;
  if (!_aiCallMonth) _loadAIUsage();
  var limit = getPlanLimit('ai_calls');
  if (limit === Infinity) return true;
  if (_aiCallCount >= limit) {
    toast('AI call limit reached (' + limit + '/month on ' + (PLAN_TIER_LABELS[clientPlanTier] || clientPlanTier) + ' plan). Upgrade for more.', 'warn');
    return false;
  }
  return true;
}

function getAIUsageInfo() {
  if (!_aiCallMonth) _loadAIUsage();
  var limit = getPlanLimit('ai_calls');
  return { used: _aiCallCount, limit: limit, month: _aiCallMonth };
}

function hasFeature(key) {
  return true; // all tiers get full feature access — billing differentiates by user/account limits only
}

function getPlanLimit(key) {
  const limits = PLAN_LIMITS[clientPlanTier || 'growth'] || PLAN_LIMITS.growth;
  return limits[key];
}

function tierBadgeHTML(tier) {
  const label = PLAN_TIER_LABELS[tier] || tier;
  const color = PLAN_TIER_COLORS[tier] || 'var(--muted)';
  return `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:var(--fs-sm);font-weight:700;color:${color};background:color-mix(in srgb, ${color} 12%, transparent);text-transform:uppercase;letter-spacing:.03em">${label}</span>`;
}

function upgradeHTML(featureKey) {
  const needed = PLAN_FEATURES[featureKey] || 'growth';
  const label  = PLAN_TIER_LABELS[needed] || needed;
  return `<div style="text-align:center;padding:40px 20px;color:var(--muted)">
    <div style="margin-bottom:10px">${appIcon('lock',28)}</div>
    <h3 style="margin-bottom:6px;color:var(--text)">Upgrade to ${label}</h3>
    <p style="font-size:var(--fs-md);max-width:360px;margin:0 auto">This feature requires the ${label} plan or higher. Contact your admin to upgrade.</p>
  </div>`;
}

// Resolve the current user's client tier on boot
// Legacy tier migration map (old DB values → new tier names)
const TIER_MIGRATION = { solo: 'core', starter: 'core', pulse: 'core', team: 'growth', signal: 'growth', pro: 'growth', enterprise: 'custom', command: 'custom' };

async function resolveClientPlanTier() {
  if (isAdmin()) { clientPlanTier = 'custom'; _subscriptionStatus = 'active'; return; }

  // Use cached tier immediately so renders don't flash wrong state
  try {
    const cached = localStorage.getItem('iqc_plan_tier');
    if (cached && PLAN_TIERS.includes(cached)) clientPlanTier = cached;
  } catch(e) {}

  try {
    // Use cached _userClientId (resolved during ensureUserProfile)
    if (_userClientId) {
      const { data: clientRows } = await sb.from('clients')
        .select('plan_tier, subscription_status')
        .eq('id', _userClientId)
        .limit(1);
      const client = clientRows && clientRows.length ? clientRows[0] : null;
      clientPlanTier = client?.plan_tier || 'growth';
      _subscriptionStatus = client?.subscription_status || 'none';
    } else {
      clientPlanTier = 'growth';
    }
    // Migrate legacy tier names
    if (TIER_MIGRATION[clientPlanTier]) clientPlanTier = TIER_MIGRATION[clientPlanTier];
    localStorage.setItem('iqc_plan_tier', clientPlanTier);
  } catch(e) {
    console.warn('Could not resolve plan tier:', e.message);
    if (!PLAN_TIERS.includes(clientPlanTier)) clientPlanTier = 'growth';
  }
  applyTierGating();
  // Show past-due warning if needed
  if (_subscriptionStatus === 'past_due') {
    showBillingWarning('Your payment is past due. Please update your payment method to avoid service interruption.');
  }
}

function showBillingWarning(msg) {
  var existing = el('billing-warning-banner');
  if (existing) existing.remove();
  var banner = document.createElement('div');
  banner.id = 'billing-warning-banner';
  banner.style.cssText = 'background:#fef3c7;color:#92400e;padding:10px 20px;text-align:center;font-size:13px;font-weight:600;border-bottom:1px solid #fcd34d;position:sticky;top:0;z-index:999';
  banner.innerHTML = msg + ' <a href="#" onclick="nav(\'settings\');cfgTab(\'billing\');return false" style="color:#d97706;text-decoration:underline;margin-left:8px">Manage Billing</a>';
  document.body.prepend(banner);
}

// Show/hide nav items based on tier
function applyTierGating() {
  if (isAdmin()) return; // admin sees everything

  const gatedNav = {
    'ni-segments':    'segments',
    'ni-automations': 'alert_channels',
    'ni-csmperf':     'csm_performance',
    'ni-auditlog':    'audit_log',
  };

  Object.entries(gatedNav).forEach(([navId, featureKey]) => {
    const btn = document.getElementById(navId);
    if (btn) btn.style.display = hasFeature(featureKey) ? '' : 'none';
  });
}

// ─── iQcadence SIGNAL MODEL ──────────────────────────────────
const DEFAULT_SIGNAL_MODEL = { enabled: false, sensitivity: 'balanced' };
let signalModelCfg = { ...DEFAULT_SIGNAL_MODEL };
const SM_SENSITIVITY = { conservative: 5, balanced: 10, aggressive: 15 };

// Column definitions - drives header rendering + filter logic
const COL_DEFS = [
  { key:'name',      label:'Customer',      ftype:'text',   sortKey:'name' },
  { key:'manager',   label:'Manager',       ftype:'text',   sortKey:'manager' },
  { key:'profile',   label:'Profile',       ftype:'enum',   sortKey:'profile', enumFn:()=>profiles.map(p=>p.name) },
  { key:'score',     label:'Score',         ftype:'number', sortKey:'score' },
  { key:'_momentum', label:'Momentum (7d)', ftype:'enum',   sortKey:'_momentum',  enumVals:['up','dn','flat','new'] },
  { key:'status',    label:'Status',        ftype:'enum',   sortKey:'status',     enumVals:['critical','risk','watch','healthy','expand'] },
  { key:'lifecycle', label:'Stage',         ftype:'enum',   sortKey:'lifecycle',  enumVals:['onboarding','active','atrisk','won','churned'] },
  { key:'mrr',       label:'MRR',           ftype:'number', sortKey:'mrr' },
  { key:'arr',       label:'ARR',           ftype:'number', sortKey:'arr' },
  { key:'since',     label:'Tenure',        ftype:'tenure', sortKey:'since' },
  { key:'tickets',   label:'Tickets',       ftype:'number', sortKey:'tickets' },
  { key:'days',      label:'Last Contact',  ftype:'number', sortKey:'days' },
  { key:'renewal',   label:'Renewal',       ftype:'number', sortKey:'renewal' },
  { key:'next_touch',label:'Next Touch',    ftype:'number', sortKey:'next_touch' },
  { key:'tags',      label:'Tags',          ftype:'text',   sortKey:'tags' },
  { key:'nps',       label:'NPS',           ftype:'number', sortKey:'nps' },
  { key:'csat',      label:'CSAT',          ftype:'number', sortKey:'csat' },
  { key:'logins',    label:'Logins',        ftype:'number', sortKey:'logins' },
  { key:'adoption',  label:'Adoption',      ftype:'number', sortKey:'adoption' },
  { key:'growth',    label:'Growth',        ftype:'enum',   sortKey:'growth',     enumVals:['strong','mild','none'] },
  { key:'created',   label:'Date Added',    ftype:'date',   sortKey:'created' },
];

const ENUM_DISPLAY = {
  critical:'Critical', risk:'At Risk', watch:'Watch', healthy:'Healthy', expand:'Expansion',
  onboarding:'Onboarding', active:'Active', atrisk:'At Risk', won:'Won', churned:'Churned',
  up:'Improving', dn:'Declining', flat:'Flat', new:'New',
};

// Heatmap sort state
let dashHeatSort  = { key: 'score', dir: 1 };  // 1=asc (worst first default)
let detailId   = null;
let pendingResult = null; // last scored result not yet saved
let csvRows    = null;    // parsed CSV rows pending import
let csvHeaders = [];

const DEFAULT_WEIGHTS = {
  logins:    15,
  adoption:  30,
  tickets:   10,
  nps:       15,
  csat:       5,
  days:      15,
  growth:    10
};

const WEIGHT_LABELS = {
  logins:   'Login Frequency (30d)',
  adoption: 'Feature Adoption %',
  tickets:  'Open Support Tickets',
  nps:      'NPS (0–10)',
  csat:     'CSAT (1–5)',
  days:     'Days Since Contact',
  growth:   'Growth Signal'
};

// 5-band thresholds: critical < T1, risk < T2, watch < T3, healthy < T4, expand >= T4
const DEFAULT_THRESHOLDS = { critical: 25, risk: 50, watch: 65, healthy: 90 };

let weights    = { ...DEFAULT_WEIGHTS };
let thresholds = { ...DEFAULT_THRESHOLDS };
let profiles   = [];

// Expansion estimate config: mode = 'pct' (percentage of MRR) or 'flat' (fixed $ per account)
const DEFAULT_EXPANSION = { mode: 'pct', pct: 20, flat: 5000 };
let expansionConfig = { ...DEFAULT_EXPANSION };

// Contact cadence thresholds per tier (days)
const DEFAULT_CADENCE = {
  enterprise: { warn: 14, overdue: 30 },
  mid:        { warn: 21, overdue: 45 },
  smb:        { warn: 30, overdue: 60 }
};
let cadenceConfig = JSON.parse(JSON.stringify(DEFAULT_CADENCE));

// Renewal alert windows (days out from renewal date)
const DEFAULT_RENEWAL_WINDOWS = { critical: 14, warning: 30, upcoming: 60 };
let renewalWindows = { ...DEFAULT_RENEWAL_WINDOWS };

// Quiet account threshold (days with no logins before flagged)
const DEFAULT_QUIET_DAYS = 14;
let quietDays = DEFAULT_QUIET_DAYS;

// Momentum sensitivity (score change over 7d to classify as improving/declining)
const DEFAULT_MOMENTUM_PTS = 3;
let momentumPts = DEFAULT_MOMENTUM_PTS;


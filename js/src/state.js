/* ============================================================
   IQcadence — CS Health Score — app.js
   ============================================================ */
const APP_VERSION = 'v93';
console.log('%c IQcadence ' + APP_VERSION + ' loaded ', 'background:#6366f1;color:#fff;font-weight:bold;padding:2px 8px;border-radius:4px');

// ─── SUPABASE CLIENT ─────────────────────────────────────────
// NOTE: The anon key is intentionally public — Supabase security comes from
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
let _userRole      = null;      // 'admin' | 'user' — fetched from user_profiles on login
let adminClients   = [];        // list of {id, name, notes} — admin only
let activeClientId = '__own__'; // '__own__' = admin's own data, else client UUID
let trash          = [];        // soft-deleted customers
let columnFilters  = {};        // per-column filter state (see COL_DEFS)
let _openColFilterKey = null;   // key of currently open column filter dropdown
let filterPresets  = [];        // saved filter presets [{ name, filterMode, columnFilters, sortKey, sortDir }]
let mrrExposureFilter = null;   // { label: string, ids: Set<string> } — set by clicking MRR Exposure rows
let _filterTier       = null;   // tier filter for customers table (set by segment click-through)
let insightFilter     = null;   // { label: string, ids: Set<string> } — set by insight card click-through

// ─── AUTOMATIONS STATE ──────────────────────────────────────
let automationsCfg    = {};        // { api_key_prefix, webhooks: { type: { url, enabled, threshold? } } }
let webhookEvents     = [];        // loaded from webhook_events table
let webhookLogOffset  = 0;
let _prevCustomerStates = new Map(); // id → { score, status } for trigger detection

// ─── PLAN TIER GATING ──────────────────────────────────────
let clientPlanTier = 'enterprise'; // default to enterprise (full access) until resolved

const PLAN_TIERS = ['starter', 'team', 'pro', 'enterprise'];
const PLAN_TIER_LABELS = { starter: 'Starter', team: 'Team', pro: 'Pro', enterprise: 'Enterprise' };
const PLAN_TIER_COLORS = { starter: 'var(--muted)', team: 'var(--blue)', pro: 'var(--purple)', enterprise: 'var(--green)' };

const PLAN_FEATURES = {
  // Starter (basic)
  reports_basic:     'starter',
  trend_sparklines:  'starter',
  email_digest:      'starter',
  renewal_pipeline:  'starter',
  urgency_scoring:   'starter',
  at_risk_alerts:    'starter',
  priority_list:     'starter',
  // Team+
  csm_filtering:     'team',
  manager_dashboard: 'team',
  sentiment:         'team',
  audit_log:         'team',
  custom_tags:       'team',
  scoring_profiles:  'team',
  segments:          'team',
  alert_channels:    'team',
  report_segments:   'team',
  // Pro+
  next_best_action:  'pro',
  qbr_prep:          'pro',
  csm_performance:   'pro',
  report_csmperf:    'pro',
  playbooks:         'pro',
  momentum:          'pro',
  automations:       'pro',
  api_webhooks:      'pro',
};

const PLAN_LIMITS = {
  starter:    { users: 1,  accounts: 150 },
  team:       { users: 5,  accounts: 750 },
  pro:        { users: 15, accounts: Infinity },
  enterprise: { users: Infinity, accounts: Infinity },
};

function hasFeature(key) {
  if (isAdmin()) return true; // admin always has full access
  const userTier  = PLAN_TIERS.indexOf(clientPlanTier || 'starter');
  const needsTier = PLAN_TIERS.indexOf(PLAN_FEATURES[key] || 'starter');
  return userTier >= needsTier;
}

function getPlanLimit(key) {
  const limits = PLAN_LIMITS[clientPlanTier || 'starter'] || PLAN_LIMITS.starter;
  return limits[key];
}

function tierBadgeHTML(tier) {
  const label = PLAN_TIER_LABELS[tier] || tier;
  const color = PLAN_TIER_COLORS[tier] || 'var(--muted)';
  return `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.72rem;font-weight:700;color:${color};background:color-mix(in srgb, ${color} 12%, transparent);text-transform:uppercase;letter-spacing:.03em">${label}</span>`;
}

function upgradeHTML(featureKey) {
  const needed = PLAN_FEATURES[featureKey] || 'starter';
  const label  = PLAN_TIER_LABELS[needed] || needed;
  return `<div style="text-align:center;padding:40px 20px;color:var(--muted)">
    <div style="font-size:1.5rem;margin-bottom:10px">🔒</div>
    <h3 style="margin-bottom:6px;color:var(--text)">Upgrade to ${label}</h3>
    <p style="font-size:.85rem;max-width:360px;margin:0 auto">This feature requires the ${label} plan or higher. Contact your admin to upgrade.</p>
  </div>`;
}

// Resolve the current user's client tier on boot
// Legacy tier migration map (old DB values → new tier names)
const TIER_MIGRATION = { solo: 'starter', growth: 'pro' };

async function resolveClientPlanTier() {
  if (isAdmin()) { clientPlanTier = 'enterprise'; return; }

  // Use cached tier immediately so renders don't flash wrong state
  try {
    const cached = localStorage.getItem('iqc_plan_tier');
    if (cached && PLAN_TIERS.includes(cached)) clientPlanTier = cached;
  } catch(e) {}

  try {
    // Get user's client_id
    const { data: profile } = await sb.from('user_profiles')
      .select('client_id')
      .eq('user_id', currentUser.id)
      .single();
    if (profile?.client_id) {
      // Get client's plan_tier
      const { data: client } = await sb.from('clients')
        .select('plan_tier')
        .eq('id', profile.client_id)
        .single();
      clientPlanTier = client?.plan_tier || 'starter';
    } else {
      clientPlanTier = 'starter'; // no client assigned = starter
    }
    // Migrate legacy tier names (solo→starter, growth→pro)
    if (TIER_MIGRATION[clientPlanTier]) clientPlanTier = TIER_MIGRATION[clientPlanTier];
    localStorage.setItem('iqc_plan_tier', clientPlanTier);
  } catch(e) {
    console.warn('Could not resolve plan tier:', e.message);
    // Keep cached value if available, otherwise fall to starter
    if (!PLAN_TIERS.includes(clientPlanTier)) clientPlanTier = 'starter';
  }
  applyTierGating();
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

// Column definitions — drives header rendering + filter logic
const COL_DEFS = [
  { key:'name',      label:'Customer',     ftype:'text',   sortKey:'name' },
  { key:'manager',   label:'Manager',      ftype:'text',   sortKey:'manager' },
  { key:'profile',   label:'Profile',      ftype:'enum',   sortKey:'profile', enumFn:()=>profiles.map(p=>p.name) },
  { key:'score',     label:'Score',        ftype:'number', sortKey:'score' },
  { key:'_momentum', label:'Momentum',     ftype:'enum',   sortKey:'_momentum',  enumVals:['up','dn','flat','new'] },
  { key:'status',    label:'Status',       ftype:'enum',   sortKey:'status',     enumVals:['critical','risk','watch','healthy','expand'] },
  { key:'lifecycle', label:'Stage',        ftype:'enum',   sortKey:'lifecycle',  enumVals:['onboarding','active','atrisk','won','churned'] },
  { key:'mrr',       label:'MRR',          ftype:'number', sortKey:'mrr' },
  { key:'arr',       label:'ARR',          ftype:'number', sortKey:'arr' },
  { key:'since',     label:'Tenure',       ftype:'number', sortKey:'since' },
  { key:'days',      label:'Last Contact', ftype:'number', sortKey:'days' },
  { key:'renewal',   label:'Renewal',      ftype:'number', sortKey:'renewal' },
  { key:'next_touch',label:'Next Touch',   ftype:'number', sortKey:'next_touch' },
  { key:'tags',      label:'Tags',         ftype:'text',   sortKey:'tags' },
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
  logins:    25,
  adoption:  25,
  tickets:   20,
  nps:       10,
  csat:       5,
  days:      10,
  growth:     5
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
const DEFAULT_THRESHOLDS = { critical: 25, risk: 50, watch: 65, healthy: 80 };

let weights    = { ...DEFAULT_WEIGHTS };
let thresholds = { ...DEFAULT_THRESHOLDS };
let profiles   = [];


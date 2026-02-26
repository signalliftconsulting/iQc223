/* ============================================================
   IQcadence — CS Health Score — app.js
   ============================================================ */

// ─── SUPABASE CLIENT ─────────────────────────────────────────
const SUPABASE_URL  = 'https://qctiyigznbztxcowehnl.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjdGl5aWd6bmJ6dHhjb3dlaG5sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NTEwMjcsImV4cCI6MjA4NzEyNzAyN30.Uto2G5WzDIgDplQlgSwvo1BT3voym8msjZSSy9GUBsg';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let currentUser = null; // set after auth

// ─── STATE ──────────────────────────────────────────────────
let customers  = [];
let snoozed    = new Map(); // id → expiry timestamp (ms)
let selectedIds= new Set();
let sortKey    = 'score';
let sortDir    = -1; // -1 = desc
let filterMode = 'all';
let activeManagers = new Set(); // empty = show all
const SEG_UNTAGGED = '__untagged__';
const SEG_UNTAGGED_LABEL = 'Untagged';
function segDisplayLabel(tag) { return tag === SEG_UNTAGGED ? SEG_UNTAGGED_LABEL : tag; }
let adminClients   = [];        // list of {id, name, notes} — admin only
let activeClientId = '__own__'; // '__own__' = admin's own data, else client UUID
let trash          = [];        // soft-deleted customers
let columnFilters  = {};        // per-column filter state (see COL_DEFS)
let _openColFilterKey = null;   // key of currently open column filter dropdown
let filterPresets  = [];        // saved filter presets [{ name, filterMode, columnFilters, sortKey, sortDir }]

// ─── AUTOMATIONS STATE ──────────────────────────────────────
let automationsCfg    = {};        // { api_key_prefix, webhooks: { type: { url, enabled, threshold? } } }
let webhookEvents     = [];        // loaded from webhook_events table
let webhookLogOffset  = 0;
let _prevCustomerStates = new Map(); // id → { score, status } for trigger detection

// ─── PLAN TIER GATING ──────────────────────────────────────
let clientPlanTier = 'growth'; // default to growth (full access) until resolved

const PLAN_TIERS = ['solo', 'starter', 'team', 'growth'];
const PLAN_TIER_LABELS = { solo: 'Solo', starter: 'Starter', team: 'Team', growth: 'Growth' };
const PLAN_TIER_COLORS = { solo: 'var(--muted)', starter: 'var(--blue)', team: 'var(--purple)', growth: 'var(--green)' };

const PLAN_FEATURES = {
  // Starter+
  csm_filtering:     'starter',
  manager_dashboard: 'starter',
  email_digest:      'starter',
  // Team+
  trend_sparklines:  'team',
  renewal_pipeline:  'team',
  urgency_scoring:   'team',
  sentiment:         'team',
  priority_list:     'team',
  at_risk_alerts:    'team',
  audit_log:         'team',
  custom_tags:       'team',
  // Growth
  next_best_action:  'growth',
  scoring_profiles:  'growth',
  qbr_prep:          'growth',
  csm_performance:   'growth',
  playbooks:         'growth',
  momentum:          'growth',
  automations:       'growth',
  // Reports
  reports_basic:     'solo',
  reports_visual:    'team',
  reports_strategic: 'growth',
};

const PLAN_LIMITS = {
  solo:    { users: 1,  accounts: 20 },
  starter: { users: 3,  accounts: 60 },
  team:    { users: 8,  accounts: 150 },
  growth:  { users: 15, accounts: Infinity },
};

function hasFeature(key) {
  if (isAdmin()) return true; // admin always has full access
  const userTier  = PLAN_TIERS.indexOf(clientPlanTier || 'solo');
  const needsTier = PLAN_TIERS.indexOf(PLAN_FEATURES[key] || 'solo');
  return userTier >= needsTier;
}

function getPlanLimit(key) {
  const limits = PLAN_LIMITS[clientPlanTier || 'solo'] || PLAN_LIMITS.solo;
  return limits[key];
}

function tierBadgeHTML(tier) {
  const label = PLAN_TIER_LABELS[tier] || tier;
  const color = PLAN_TIER_COLORS[tier] || 'var(--muted)';
  return `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.72rem;font-weight:700;color:${color};background:color-mix(in srgb, ${color} 12%, transparent);text-transform:uppercase;letter-spacing:.03em">${label}</span>`;
}

function upgradeHTML(featureKey) {
  const needed = PLAN_FEATURES[featureKey] || 'solo';
  const label  = PLAN_TIER_LABELS[needed] || needed;
  return `<div style="text-align:center;padding:40px 20px;color:var(--muted)">
    <div style="font-size:1.5rem;margin-bottom:10px">🔒</div>
    <h3 style="margin-bottom:6px;color:var(--text)">Upgrade to ${label}</h3>
    <p style="font-size:.85rem;max-width:360px;margin:0 auto">This feature requires the ${label} plan or higher. Contact your admin to upgrade.</p>
  </div>`;
}

// Resolve the current user's client tier on boot
async function resolveClientPlanTier() {
  if (isAdmin()) { clientPlanTier = 'growth'; return; }

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
      clientPlanTier = client?.plan_tier || 'solo';
    } else {
      clientPlanTier = 'solo'; // no client assigned = solo
    }
    localStorage.setItem('iqc_plan_tier', clientPlanTier);
  } catch(e) {
    console.warn('Could not resolve plan tier:', e.message);
    // Keep cached value if available, otherwise fall to solo
    if (!PLAN_TIERS.includes(clientPlanTier)) clientPlanTier = 'solo';
  }
  applyTierGating();
}

// Show/hide nav items based on tier
function applyTierGating() {
  if (isAdmin()) return; // admin sees everything

  const gatedNav = {
    'ni-csmperf':  'csm_performance',
    'ni-auditlog': 'audit_log',
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
  { key:'_spark',    label:'Trend',        ftype:null,     sortKey:'_trend' },
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

// Dashboard-specific sort state (heatmap + recent table)
let dashHeatSort  = { key: 'score', dir: 1 };  // 1=asc (worst first default)
let dashRecentSort= { key: 'created', dir: -1 };
let detailId   = null;
let pendingResult = null; // last scored result not yet saved
let csvRows    = null;    // parsed CSV rows pending import
let csvHeaders = [];

const DEFAULT_WEIGHTS = {
  logins:    25,
  adoption:  25,
  tickets:   20,
  nps:       15,
  days:      10,
  growth:     5
};

const WEIGHT_LABELS = {
  logins:   'Login Frequency (30d)',
  adoption: 'Feature Adoption %',
  tickets:  'Open Support Tickets',
  nps:      'NPS / CSAT',
  days:     'Days Since Contact',
  growth:   'Growth Signal'
};

// 5-band thresholds: critical < T1, risk < T2, watch < T3, healthy < T4, expand >= T4
const DEFAULT_THRESHOLDS = { critical: 25, risk: 50, watch: 65, healthy: 80 };

let weights    = { ...DEFAULT_WEIGHTS };
let thresholds = { ...DEFAULT_THRESHOLDS };
let profiles   = [];

// ─── PERSIST ────────────────────────────────────────────────
// Settings (weights, thresholds, profiles, snoozed) stored in Supabase settings table.
// Customers stored in Supabase customers table with RLS (each user sees only their own).

function saveSettings() {
  // Also keep in localStorage as fast local cache
  localStorage.setItem('iqc_weights',    JSON.stringify(weights));
  localStorage.setItem('iqc_thresholds', JSON.stringify(thresholds));
  localStorage.setItem('iqc_profiles',   JSON.stringify(profiles));
  localStorage.setItem('iqc_snoozed',    JSON.stringify([...snoozed]));
  localStorage.setItem('iqc_dismissed',  JSON.stringify([...dismissed]));
  // Sync to Supabase (fire and forget)
  if (currentUser) {
    sb.from('settings').upsert({
      user_id:    currentUser.id,
      weights:    JSON.stringify(weights),
      thresholds: JSON.stringify(thresholds),
      profiles:   JSON.stringify(profiles),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' }).then(({error}) => {
      if (error) console.warn('Settings sync failed:', error.message);
    });
  }
}

function loadSettings() {
  try {
    const w = localStorage.getItem('iqc_weights');
    if (w) weights = { ...DEFAULT_WEIGHTS, ...JSON.parse(w) };
  } catch(e) {}
  try {
    const t = localStorage.getItem('iqc_thresholds');
    if (t) {
      const stored = JSON.parse(t);
      // Migrate old 2-key format to 4-key format
      if (stored.expand !== undefined && stored.critical === undefined) {
        // Old format had { risk, expand } — discard and use new defaults
        thresholds = { ...DEFAULT_THRESHOLDS };
      } else {
        thresholds = { ...DEFAULT_THRESHOLDS, ...stored };
      }
    }
  } catch(e) {}
  try {
    const p = localStorage.getItem('iqc_profiles');
    if (p) profiles = JSON.parse(p);
  } catch(e) { profiles = []; }
  ensureGlobalWeightsProfile();
  try {
    const s = localStorage.getItem('iqc_snoozed');
    if (s) {
      const parsed = JSON.parse(s);
      snoozed = new Map(Array.isArray(parsed[0]) ? parsed : parsed.map(id => [id, Infinity]));
    }
  } catch(e) {}
  try {
    const d = localStorage.getItem('iqc_dismissed');
    if (d) dismissed = new Set(JSON.parse(d));
  } catch(e) {}
  try {
    const ac = localStorage.getItem('iqc_automations');
    if (ac) { automationsCfg = JSON.parse(ac); migrateAutomationsCfg(); }
  } catch(e) {}
  try {
    const fp = localStorage.getItem('iqc_filter_presets');
    if (fp) filterPresets = JSON.parse(fp);
  } catch(e) {}
}

// Ensure the built-in "Global Weights" profile always exists and stays in sync with weights
function ensureGlobalWeightsProfile(persist = false) {
  // Remove ALL case variants
  profiles = profiles.filter(p => p.name.toLowerCase() !== 'global weights');
  // Re-insert the single canonical version at the front
  profiles.unshift({ name: 'Global Weights', weights: { ...weights } });
  // Always write back to Supabase when called after a remote load
  if (persist) saveSettings();
}

async function loadSettingsFromSupabase() {
  if (!currentUser) return;
  const { data } = await sb.from('settings').select('*').eq('user_id', currentUser.id).single();
  if (!data) return;
  try { if (data.weights)    weights    = { ...DEFAULT_WEIGHTS,    ...JSON.parse(data.weights) }; }    catch(e){}
  try { if (data.thresholds) thresholds = { ...DEFAULT_THRESHOLDS, ...JSON.parse(data.thresholds) }; } catch(e){}
  try { if (data.profiles)   profiles   = JSON.parse(data.profiles); }  catch(e){}
  try { if (data.automations) { automationsCfg = JSON.parse(data.automations); migrateAutomationsCfg(); } } catch(e){}
  ensureGlobalWeightsProfile(true); // persist=true → writes clean version back if duplicates found
  // Also update localStorage cache
  localStorage.setItem('iqc_weights',    JSON.stringify(weights));
  localStorage.setItem('iqc_thresholds', JSON.stringify(thresholds));
  localStorage.setItem('iqc_profiles',   JSON.stringify(profiles));
  // Sync profile dropdown in score form
  refreshProfileDropdown();
}

// ─── SUPABASE HELPERS ────────────────────────────────────────
function tryParse(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch(e) { return fallback; }
}

// Convert Supabase row → internal customer object
function fromRow(row) {
  return {
    id:        row.id,
    name:      row.name      || '',
    score:     row.score     || 0,
    status:    getStatus(row.score || 0),  // always derive from score, never trust stored value
    mrr:       row.mrr       || 0,
    arr:       row.arr       || 0,
    since:     row.since     || '',
    tier:      row.tier      || 'mid',
    lifecycle: row.lifecycle || 'active',
    logins:    row.logins    || 0,
    adoption:  row.adoption  || 0,
    tickets:   row.tickets   || 0,
    nps:       row.nps       || 'unknown',
    days:         row.days         || 0,
    _baseDays:    row.days         || 0,
    renewal_date: row.renewal_date || '',
    renewal:      row.renewal_date
      ? Math.max(0, Math.round((new Date(row.renewal_date) - new Date()) / (1000 * 60 * 60 * 24 * 30.44)))
      : (row.renewal || 0),
    growth:    row.growth    || 'none',
    tags:      row.tags      ? row.tags.split(',').map(t=>t.trim()).filter(Boolean) : [],
    notes:     tryParse(row.notes,     []),
    history:   tryParse(row.history,   []),
    sentiment: tryParse(row.sentiment, []),
    manager:         row.manager         || '',
    scoring_profile: row.scoring_profile || '',
    deleted_at:      row.deleted_at      || null,
    created:         row.created_at      || new Date().toISOString(),
    next_touch:      row.next_touch      || '',
    playbook_checks: tryParse(row.playbook_checks, {})
  };
}

// Convert internal customer → Supabase row fields
function toRow(c) {
  return {
    id:        c.id,
    user_id:   currentUser.id,
    name:      c.name,
    score:     c.score      || 0,
    status:    getStatus(c.score || 0),
    mrr:       c.mrr        || 0,
    arr:       c.arr        || 0,
    since:     c.since      || '',
    tier:      c.tier       || 'mid',
    lifecycle: c.lifecycle  || 'active',
    logins:    c.logins     || 0,
    adoption:  c.adoption   || 0,
    tickets:   c.tickets    || 0,
    nps:       c.nps        || 'unknown',
    days:         c._baseDays != null ? c._baseDays : (c.days || 0),
    renewal_date: c.renewal_date || '',
    renewal:      c.renewal      || 0,
    growth:    c.growth     || 'none',
    tags:      (c.tags      || []).join(','),
    notes:     JSON.stringify(c.notes     || []),
    history:   JSON.stringify(c.history   || []),
    sentiment: JSON.stringify(c.sentiment || []),
    manager:         c.manager         || '',
    scoring_profile: c.scoring_profile || '',
    deleted_at:      c.deleted_at      || null,
    created_at:      c.created         || new Date().toISOString(),
    next_touch:      c.next_touch      || '',
    playbook_checks: JSON.stringify(c.playbook_checks || {})
  };
}

// Load all customers for current user from Supabase
// Admin → own rows only (uses client filter dropdown for other clients)
// Non-admin → all rows in their client (RLS + user_ids lookup)
// Active rows (deleted_at IS NULL) → customers[]
// Soft-deleted rows (deleted_at IS NOT NULL) → trash[]
async function loadCustomersFromSupabase() {
  let query;

  if (isAdmin()) {
    // Admin always loads just their own rows here;
    // client data loaded separately via loadClientCustomers()
    query = sb.from('customers')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });
  } else {
    // Non-admin: load all customers from users in the same client
    const { data: profiles } = await sb.from('user_profiles')
      .select('user_id')
      .eq('client_id',
        // get this user's client_id first
        (await sb.from('user_profiles')
          .select('client_id')
          .eq('user_id', currentUser.id)
          .single()
        ).data?.client_id || '__none__'
      );
    const userIds = (profiles || []).map(p => p.user_id);
    if (!userIds.length) {
      customers = []; trash = [];
      localStorage.setItem('iqc_customers_cache', JSON.stringify(customers));
      return;
    }
    query = sb.from('customers')
      .select('*')
      .in('user_id', userIds)
      .order('created_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw error;
  const all = (data || []).map(fromRow);
  customers = all.filter(c => !c.deleted_at);
  trash     = all.filter(c =>  c.deleted_at);
  localStorage.setItem('iqc_customers_cache', JSON.stringify(customers));
  localStorage.setItem('iqc_last_refresh', String(Date.now()));
  snapshotCustomerStates();
}

// Loading overlay — reference counted so nested calls don't hide prematurely
let _loadingCount = 0;
let _loadingTimeout = null;
function setLoading(on) {
  if (on) {
    _loadingCount++;
    // Safety valve: always hide after 6 seconds no matter what
    clearTimeout(_loadingTimeout);
    _loadingTimeout = setTimeout(() => { _loadingCount = 0; _showOverlay(false); }, 6000);
    _showOverlay(true);
  } else {
    _loadingCount = Math.max(0, _loadingCount - 1);
    if (_loadingCount === 0) {
      clearTimeout(_loadingTimeout);
      _showOverlay(false);
    }
  }
}

function _showOverlay(on) {
  let ov = document.getElementById('loading-overlay');
  if (on) {
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'loading-overlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,.7);z-index:500;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:var(--muted);gap:10px';
      ov.innerHTML = '<div style="width:22px;height:22px;border:3px solid var(--border);border-top-color:var(--blue);border-radius:50%;animation:spin .7s linear infinite"></div> Syncing…';
      if (!document.getElementById('spin-style')) {
        const st = document.createElement('style');
        st.id = 'spin-style';
        st.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(st);
      }
      document.body.appendChild(ov);
    }
    ov.style.display = 'flex';
  } else {
    if (ov) ov.style.display = 'none';
  }
}

// save(c) — upsert a single customer
async function save(c) {
  if (!currentUser) return;
  // Always update localStorage cache immediately so UI stays intact
  localStorage.setItem('iqc_customers_cache', JSON.stringify(customers));
  const { error } = await sb.from('customers').upsert(toRow(c), { onConflict: 'id' });
  if (error) {
    console.error('Supabase save error:', error.message, error);
    throw error;
  }
  // Fire webhook triggers on successful save
  checkWebhookTriggers(c);
}

// atDelete(c) — SOFT delete: sets deleted_at, never removes the row
async function atDelete(c) {
  if (!currentUser) return;
  const deletedAt = new Date().toISOString();
  const { error } = await sb.from('customers')
    .update({ deleted_at: deletedAt })
    .eq('id', c.id).eq('user_id', currentUser.id);
  if (error) throw error;
}

// restoreCustomer(id) — clears deleted_at, brings customer back
async function restoreCustomer(id) {
  if (!currentUser) return;
  const c = trash.find(x => x.id === id);
  if (!c) return;
  c.deleted_at = null;
  customers.unshift(c);
  trash = trash.filter(x => x.id !== id);
  localStorage.setItem('iqc_customers_cache', JSON.stringify(customers));
  renderTrash();
  renderCustomers();
  logAudit('customer_restored', c.id, c.name, { summary: `Restored from trash — Score: ${c.score}/100, MRR: $${c.mrr||0}` });
  toast(`${c.name} restored`, 'success');
  const { error } = await sb.from('customers')
    .update({ deleted_at: null })
    .eq('id', id).eq('user_id', currentUser.id);
  if (error) toast('Restore sync failed', 'warn');
}

// hardDeleteCustomer(id) — permanently removes a row (from trash only)
async function hardDeleteCustomer(id) {
  const c = trash.find(x => x.id === id);
  if (!c) return;
  confirmAction(`Permanently delete "${c.name}"? This cannot be undone.`, async () => {
    const cName = c.name;
    trash = trash.filter(x => x.id !== id);
    renderTrash();
    logAudit('customer_hard_deleted', id, cName, { summary: 'Permanently removed from database' });
    toast(`${cName} permanently deleted`, 'warn');
    const { error } = await sb.from('customers').delete().eq('id', id).eq('user_id', currentUser.id);
    if (error) toast('Permanent delete sync failed', 'warn');
  });
}

// emptyTrash() — hard delete all soft-deleted records
async function emptyTrash() {
  if (!trash.length) return;
  confirmAction(`Permanently delete all ${trash.length} items in trash? This cannot be undone.`, async () => {
    const toNuke = [...trash];
    logAudit('customer_hard_deleted', null, '', { summary: `Emptied trash: ${toNuke.length} record${toNuke.length!==1?'s':''} permanently deleted` });
    trash = [];
    renderTrash();
    toast('Trash emptied', 'warn');
    await Promise.all(toNuke.map(c =>
      sb.from('customers').delete().eq('id', c.id).eq('user_id', currentUser.id).catch(()=>{})
    ));
  });
}

// renderTrash() — shows soft-deleted customers inside the customers view
function renderTrash() {
  const wrap = document.getElementById('trash-wrap');
  if (!wrap) return;

  const backBtn = `<button class="btn btn-sm btn-ghost" onclick="setFilter('all')" style="margin-bottom:12px">← Back to Customers</button>`;

  if (!trash.length) {
    wrap.innerHTML = backBtn + `<div class="empty-st"><div class="ei"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--subtle)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></div><h3>Trash is empty</h3><p>Deleted customers appear here. You can restore or permanently delete them.</p></div>`;
    return;
  }

  const rows = trash.map(c => {
    const deletedStr = c.deleted_at ? new Date(c.deleted_at).toLocaleDateString() : '—';
    return `<tr>
      <td><strong>${escHtml(c.name)}</strong></td>
      <td>${deletedStr}</td>
      <td>${badgeHTML(c.status)}</td>
      <td>$${(c.mrr||0).toLocaleString()}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-ghost" style="margin-right:4px" onclick="restoreCustomer('${c.id}')">Restore</button>
        <button class="btn btn-sm btn-danger" onclick="hardDeleteCustomer('${c.id}')">Delete Forever</button>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <button class="btn btn-sm btn-ghost" onclick="setFilter('all')">← Back to Customers</button>
        <span style="font-size:.85rem;color:var(--muted)">${trash.length} item${trash.length!==1?'s':''} in trash</span>
      </div>
      <button class="btn btn-sm btn-danger" onclick="emptyTrash()">Empty Trash</button>
    </div>
    <table class="ct">
      <thead><tr>
        <th>Name</th><th>Deleted</th><th>Status</th><th>MRR</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// atUpdate(c) — alias for save
async function atUpdate(c) { return save(c); }
async function atCreate(c) { return save(c); }

// ─── AUTH ────────────────────────────────────────────────────
function showAuthGate() {
  document.getElementById('auth-gate').style.display = 'flex';
  document.querySelector('.shell')?.style.setProperty('display','none');
  document.querySelector('.topbar')?.style.setProperty('visibility','hidden');
  document.querySelector('.footer')?.style.setProperty('display','none');
}

function hideAuthGate() {
  document.getElementById('auth-gate').style.display = 'none';
  document.querySelector('.shell')?.style.removeProperty('display');
  document.querySelector('.topbar')?.style.removeProperty('visibility');
  document.querySelector('.footer')?.style.removeProperty('display');
}

function authTab(tab) {
  ['login','signup','reset'].forEach(t => {
    document.getElementById('form-'+t).style.display  = t===tab ? 'block' : 'none';
    const btn = document.getElementById('tab-'+t);
    if (btn) btn.classList.toggle('active', t===tab);
  });
  document.getElementById('auth-err').textContent = '';
  document.getElementById('auth-ok').textContent  = '';
}

function authSetBusy(busy) {
  ['login-btn','signup-btn','reset-btn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.disabled = busy;
  });
}

function authErr(msg) {
  document.getElementById('auth-err').textContent = msg;
  document.getElementById('auth-ok').textContent  = '';
  authSetBusy(false);
}

function authOk(msg) {
  document.getElementById('auth-ok').textContent  = msg;
  document.getElementById('auth-err').textContent = '';
  authSetBusy(false);
}

async function authSignIn() {
  const email = el('login-email')?.value.trim();
  const pw    = el('login-pw')?.value;
  if (!email || !pw) { authErr('Please enter your email and password.'); return; }
  authSetBusy(true);
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  if (error) { authErr(error.message); return; }
  // onAuthStateChange will handle the rest
}

async function authSignUp() {
  const email = el('signup-email')?.value.trim();
  const pw    = el('signup-pw')?.value;
  const pw2   = el('signup-pw2')?.value;
  if (!email)      { authErr('Please enter your email.'); return; }
  if (!pw)         { authErr('Please choose a password.'); return; }
  if (pw.length<6) { authErr('Password must be at least 6 characters.'); return; }
  if (pw !== pw2)  { authErr('Passwords do not match.'); return; }
  authSetBusy(true);
  const { error } = await sb.auth.signUp({ email, password: pw });
  if (error) { authErr(error.message); return; }
  authOk('Account created! Check your email to confirm, then sign in.');
}

async function authReset() {
  const email = el('reset-email')?.value.trim();
  if (!email) { authErr('Please enter your email address.'); return; }
  authSetBusy(true);
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href
  });
  if (error) { authErr(error.message); return; }
  authOk('Reset link sent! Check your email.');
}

async function authSignOut() {
  // Clear any stuck loading overlay first
  _loadingCount = 0;
  clearTimeout(_loadingTimeout);
  _showOverlay(false);
  stopPolling();
  currentUser = null;
  customers   = [];
  trash       = [];
  await sb.auth.signOut();
  // Show login immediately — onAuthStateChange will also fire
  showAuthGate();
  authTab('login');
  toast('Signed out', 'default');
}

function updateUserUI(user) {
  const pill   = el('user-pill');
  const avatar = el('user-avatar');
  const label  = el('user-email-lbl');
  const signout= el('signout-btn');
  const settingsEmail = el('settings-email');
  if (user) {
    const initials = user.email.slice(0,2).toUpperCase();
    if (pill)   { pill.style.display = 'flex'; }
    if (avatar) avatar.textContent = initials;
    if (label)  label.textContent  = user.email;
    if (signout) signout.style.display = '';
    if (settingsEmail) settingsEmail.textContent = user.email;

    // Show admin nav items only for the admin email
    const admin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    ['ni-admin-sep','ni-admin-label','ni-clients','ni-users'].forEach(id => {
      const el2 = document.getElementById(id);
      if (el2) el2.style.display = admin ? '' : 'none';
    });
    const cfw = document.getElementById('client-filter-wrap');
    if (cfw) cfw.style.display = admin ? '' : 'none';
    if (admin) loadAdminClients();
  } else {
    if (pill)    pill.style.display    = 'none';
    if (signout) signout.style.display = 'none';
    ['ni-admin-sep','ni-admin-label','ni-clients','ni-users'].forEach(id => {
      const el2 = document.getElementById(id);
      if (el2) el2.style.display = 'none';
    });
    const cfw = document.getElementById('client-filter-wrap');
    if (cfw) cfw.style.display = 'none';
  }
}

// ─── SCORING ENGINE ─────────────────────────────────────────
function calcScore(data, w) {
  w = w || weights;
  // Normalize each signal to 0–100
  const logins_n   = Math.min(data.logins / 30, 1) * 100;
  const adoption_n = Math.min(data.adoption, 100);
  const tickets_n  = Math.max(0, 100 - data.tickets * 20); // 0 tix=100, 5+ tix=0
  const nps_n      = { unknown:50, detractor:0, passive:65, promoter:100 }[data.nps] || 50;
  const days_n     = Math.max(0, 100 - (data.days / 180) * 100);
  const growth_n   = { none:25, mild:65, strong:100 }[data.growth] || 25;

  const total = w.logins + w.adoption + w.tickets + w.nps + w.days + w.growth || 100;
  const score = (
    logins_n   * (w.logins   / total) +
    adoption_n * (w.adoption / total) +
    tickets_n  * (w.tickets  / total) +
    nps_n      * (w.nps      / total) +
    days_n     * (w.days     / total) +
    growth_n   * (w.growth   / total)
  );

  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    signals: { logins_n, adoption_n, tickets_n, nps_n, days_n, growth_n }
  };
}

// ─── STATUS CONSTANTS ────────────────────────────────────────
// Single source of truth for all 5 status bands
const STATUS_COLOR = {
  critical: '#dc2626',  // red
  risk:     '#ea580c',  // orange
  watch:    '#d97706',  // amber
  healthy:  '#16a34a',  // green
  expand:   '#0891b2',  // teal
};
const STATUS_LABEL = {
  critical: 'Critical',
  risk:     'At Risk',
  watch:    'Watch',
  healthy:  'Healthy',
  expand:   'Expansion',
};
const STATUS_CSS = {
  critical: 'critical',
  risk:     'risk',
  watch:    'watch',
  healthy:  'healthy',
  expand:   'expand',
};

function getStatus(score) {
  if (score <  thresholds.critical) return 'critical';
  if (score <  thresholds.risk)     return 'risk';
  if (score <  thresholds.watch)    return 'watch';
  if (score <  thresholds.healthy)  return 'healthy';
  return 'expand';
}

// ─── WEIGHT-AWARE HELPER ─────────────────────────────────────
// Returns the resolved weights for a customer (profile override or global)
function getActiveWeights(c) {
  const prof = c?.scoring_profile ? profiles.find(p => p.name === c.scoring_profile) : null;
  return prof ? prof.weights : weights;
}
// Returns true if a signal dimension is active (weight > 0) for this customer
function signalOn(c, key) {
  return (getActiveWeights(c)[key] || 0) > 0;
}

// ─── DYNAMIC SCORE DECAY ─────────────────────────────────────
// Returns the date when a customer was last scored (most recent history entry)
function getLastScoredDate(c) {
  const hist = c.history || [];
  if (!hist.length) return c.created ? new Date(c.created) : new Date();
  let max = 0;
  hist.forEach(function(h) { if (h.date) { var t = new Date(h.date).getTime(); if (t > max) max = t; } });
  return max ? new Date(max) : new Date(c.created || Date.now());
}

// Returns effective days since contact, accounting for time elapsed since last scored
function getEffectiveDays(c) {
  var base = c._baseDays != null ? c._baseDays : (c.days || 0);
  var lastScored = getLastScoredDate(c);
  var elapsed = Math.max(0, Math.floor((Date.now() - lastScored.getTime()) / 86400000));
  return base + elapsed;
}

// Recalculate all customer scores using dynamic effective days
function refreshLiveScores() {
  customers.forEach(function(c) {
    if (c.lifecycle === 'churned') return;
    var effDays = getEffectiveDays(c);
    if (effDays === c.days) return;
    var data = { logins: c.logins || 0, adoption: c.adoption || 0,
      tickets: c.tickets || 0, nps: c.nps || 'unknown',
      days: effDays, growth: c.growth || 'none' };
    var w = getActiveWeights(c);
    var result = calcScore(data, w);
    c.days   = effDays;
    c.score  = result.score;
    c.status = getStatus(result.score);
  });
}

function makeRec(score, data) {
  const status = getStatus(score);
  const name   = data.name ? `${data.name}` : 'This account';
  if (status === 'critical') {
    return `<strong>Critical:</strong> ${name} has very low health signals — act immediately. Escalate internally and book an emergency call this week before churn becomes likely.`;
  }
  if (status === 'risk') {
    const issues = [];
    if (signalOn(data,'logins')   && data.logins   < 5)        issues.push('very low login activity');
    if (signalOn(data,'adoption') && data.adoption < 30)       issues.push('poor feature adoption');
    if (signalOn(data,'tickets')  && data.tickets  >= 3)       issues.push(`${data.tickets} open support tickets`);
    if (signalOn(data,'nps')      && data.nps === 'detractor') issues.push('NPS detractor on record');
    if (signalOn(data,'days')     && data.days     > 30)       issues.push(`no contact in ${data.days} days`);
    if (issues.length)
      return `<strong>At Risk:</strong> ${name} is showing ${issues.slice(0,2).join(' and ')}. Act this week — schedule an EBR or health check call before this escalates.`;
    return `<strong>At Risk:</strong> Multiple weak signals detected. Reach out immediately and schedule a health check call.`;
  }
  if (status === 'watch') {
    return `<strong>Watch:</strong> ${name} has some warning signals. Stay close — increase your cadence and address any friction before it worsens.`;
  }
  if (status === 'expand') {
    if (signalOn(data,'growth') && data.growth === 'strong')
      return `<strong>Expansion Ready:</strong> ${name} is highly engaged with strong growth signals. This is the right time to open an upsell conversation — they're primed to say yes.`;
    return `<strong>Expansion Ready:</strong> ${name} is in great shape. Introduce an expansion conversation, request a referral, or propose a tier upgrade at your next touchpoint.`;
  }
  if (data.renewal <= 2)
    return `<strong>Healthy — Renewal Approaching:</strong> ${name} is in good shape but renews soon. Lock in the renewal now while sentiment is positive.`;
  return `<strong>Healthy:</strong> ${name} is in good shape. Maintain your regular cadence and watch for expansion signals.`;
}

function buildPlaybook(score, data) {
  const plays = [];
  const status = getStatus(score);
  const name   = data.name || 'the customer';

  // ── Login frequency ──────────────────────────────────────
  if (signalOn(data,'logins')) {
    if (data.logins === 0)
      plays.push({ type:'urgent', text:`<strong>Immediate re-engagement:</strong> ${name} hasn't logged in at all this month. Open with: <em>"Hey [name], I noticed you haven't had a chance to log in recently — is there something getting in the way? I'd love to set up a quick session to make sure you're getting value."</em>` });
    else if (data.logins < 5)
      plays.push({ type:'engage', text:`<strong>Re-engagement call:</strong> Only ${data.logins} logins this month — well below healthy levels. Ask: <em>"What does your typical week look like — are there blockers to using the platform more regularly? Let's remove them together."</em>` });
    else if (data.logins < 12)
      plays.push({ type:'coach', text:`<strong>Usage coaching:</strong> Login frequency is moderate at ${data.logins} days. Share a "tip of the month" and ask: <em>"Are there features you haven't had a chance to explore yet? I can walk you through what's working for similar teams."</em>` });
  }

  // ── Feature adoption ─────────────────────────────────────
  if (signalOn(data,'adoption')) {
    if (data.adoption < 25)
      plays.push({ type:'adopt', text:`<strong>Adoption rescue:</strong> Feature adoption is critically low at ${data.adoption}%. Book a hands-on session and say: <em>"A lot of value is sitting unused — let me show you exactly what [top feature] can do for your workflow. Teams like yours typically see [outcome] within 30 days."</em>` });
    else if (data.adoption < 50)
      plays.push({ type:'adopt', text:`<strong>Adoption workshop:</strong> ${data.adoption}% adoption leaves significant value on the table. Run a feature discovery session and ask: <em>"Which parts of the product does your team use daily? I want to make sure you're getting full value from everything available to you."</em>` });
  }

  // ── Support tickets ──────────────────────────────────────
  if (signalOn(data,'tickets')) {
    if (data.tickets >= 5)
      plays.push({ type:'urgent', text:`<strong>Escalation review:</strong> ${data.tickets} open tickets is a red flag. Loop in your support lead immediately and open with: <em>"I've been keeping a close eye on your open tickets — I want to make sure these are getting resolved fast enough. Can we get 20 minutes this week to walk through each one together?"</em>` });
    else if (data.tickets >= 3)
      plays.push({ type:'support', text:`<strong>Support sync:</strong> ${data.tickets} open tickets suggests friction. Ask: <em>"I saw you have a few open support requests — are these blocking anything important? I want to make sure nothing is slipping through the cracks on our end."</em>` });
  }

  // ── NPS / CSAT ───────────────────────────────────────────
  if (signalOn(data,'nps')) {
    if (data.nps === 'detractor')
      plays.push({ type:'urgent', text:`<strong>Executive recovery call:</strong> NPS detractor signal — don't wait. Escalate to leadership and reach out personally: <em>"I wanted to call you directly because your feedback matters a lot to us. Can you help me understand what's fallen short? I want to make this right."</em>` });
    else if (data.nps === 'promoter' && status === 'expand')
      plays.push({ type:'expand', text:`<strong>Leverage the promoter:</strong> NPS promoter + strong health = referral opportunity. Ask: <em>"We love having you as a customer — would you be open to a quick case study or intro to a peer who might benefit from [product]? I'll make it easy for you."</em>` });
  }

  // ── Days since contact ───────────────────────────────────
  if (signalOn(data,'days')) {
    if (data.days > 45)
      plays.push({ type:'urgent', text:`<strong>Urgent re-connect:</strong> No contact in ${data.days} days — this account has gone dark. Send a personal note today: <em>"Hey [name], it's been a while and I wanted to check in. How's everything going with [product]? Anything on your radar I should know about?"</em>` });
    else if (data.days > 21)
      plays.push({ type:'engage', text:`<strong>Check-in email:</strong> ${data.days} days since last contact. Reach out with something valuable — share a relevant case study, tip, or product update, then close with: <em>"Anything you'd like to cover on our next call?"</em>` });
  }

  // ── Renewal ──────────────────────────────────────────────
  if (data.renewal === 0)
    plays.push({ type:'renew', text:`<strong>Renewal NOW:</strong> Contract is at renewal — get this closed immediately. If health is strong, make it easy: <em>"Everything looks great on your account — I'd love to lock in your renewal and talk about what's coming next year."</em>` });
  else if (data.renewal <= 1)
    plays.push({ type:'renew', text:`<strong>Renewal urgency:</strong> ${data.renewal} month to renewal. Schedule the contract review call this week — lead with value: <em>"Before we talk paperwork, I want to make sure you've seen the ROI you were expecting. Let's walk through your results together."</em>` });
  else if (data.renewal <= 3 && status !== 'risk' && status !== 'critical')
    plays.push({ type:'renew', text:`<strong>Renewal prep:</strong> ${data.renewal} months to renewal. Start the conversation now while sentiment is positive: <em>"Renewal is coming up — I'd love to get ahead of it and make sure everything is lined up on your end."</em>` });

  // ── Growth signal ────────────────────────────────────────
  if (signalOn(data,'growth')) {
    if (data.growth === 'strong')
      plays.push({ type:'expand', text:`<strong>Upsell now:</strong> Strong growth signal detected — this is the right moment. Say: <em>"I noticed your team has been expanding usage significantly — have you thought about [next tier / additional seats / premium feature]? A lot of teams at your stage find it unlocks [specific outcome]."</em>` });
    else if (data.growth === 'mild' && status !== 'risk' && status !== 'critical')
      plays.push({ type:'expand', text:`<strong>Growth conversation:</strong> Mild growth signal — explore expansion potential. Ask: <em>"You've been growing steadily — where is the team headed over the next 6 months? I want to make sure [product] scales with you."</em>` });
  }

  // ── Case study ───────────────────────────────────────────
  if (status === 'expand' && signalOn(data,'nps') && data.nps === 'promoter')
    plays.push({ type:'expand', text:`<strong>Case study / referral:</strong> Happy, expanding customer — perfect for advocacy. Ask: <em>"You've had such a strong experience — would you be open to sharing your story? Even a quick quote or intro to a peer would mean a lot to us."</em>` });

  if (!plays.length)
    plays.push({ type:'ok', text:`<strong>Stay the course:</strong> ${name} looks healthy across all signals. Maintain your regular cadence, bring value on every call, and watch for any early warning signs.` });

  return plays;
}

// ─── NEXT BEST ACTION ────────────────────────────────────────
function buildNextBestAction(c) {
  const status  = getStatus(c.score);
  const mom     = getMomentum(c);
  const cad     = getCadenceStatus(c);
  const sent    = latestSentiment(c);
  const urgency = getRenewalUrgency(c);

  // Priority order: most urgent condition wins
  // Each check is also gated on whether that signal dimension is active (weight > 0)
  if (signalOn(c,'nps') && c.nps === 'detractor')
    return { level:'urgent', action:'Call them today', talk:`NPS detractor on file — this needs a personal call, not an email. Open with: "I wanted to reach out directly. Can you help me understand what's fallen short? I want to make this right."` };

  if (signalOn(c,'tickets') && c.tickets >= 5)
    return { level:'urgent', action:'Escalate support now', talk:`${c.tickets} open tickets is critical. Loop in your support lead and contact the customer today: "I've been watching your open tickets closely — can we get 20 minutes to walk through each one together?"` };

  if (c.renewal <= 1 && c.renewal >= 0)
    return { level:'urgent', action:'Close the renewal this week', talk:`Renewal is ${c.renewal === 0 ? 'NOW' : 'in 1 month'} — get this on the calendar immediately. Lead with value before paperwork: "Before we talk renewal, let's walk through your results together."` };

  if (sent?.val === 'negative')
    return { level:'warn', action:'Follow up on last call', talk:`Last call logged as negative — follow up within 24 hours. Ask: "I wanted to check in after our last conversation. Is there anything I can do to help get things back on track?"` };

  if (signalOn(c,'days') && cad.status === 'overdue')
    return { level:'warn', action:`Reach out now — ${c.days} days no contact`, talk:`This account has gone silent. Send a personal note today: "Hey [name], it's been a while — how's everything going? Anything on your radar I should know about?"` };

  if (status === 'critical')
    return { level:'urgent', action:'Escalate — critical health score', talk:`Critical score — act immediately. Book an executive call this week: "I've been keeping a very close eye on your account and want to personally make sure we get things back on track."` };

  if (status === 'risk' && mom === 'dn')
    return { level:'urgent', action:'Schedule emergency health check', talk:`At Risk AND declining — don't wait. Book a call this week: "I've been keeping a close eye on your account and want to make sure we're getting ahead of anything before it becomes a bigger issue."` };

  if (status === 'risk')
    return { level:'warn', action:'Schedule a health check call', talk:`At Risk account — reach out this week: "I wanted to check in and make sure you're getting the value you expected. Can we find 30 minutes to review where things stand?"` };

  if (status === 'watch')
    return { level:'warn', action:'Check in — some warning signs', talk:`Score is in the Watch zone. Proactively reach out: "I wanted to check in and make sure everything is going well. Anything on your radar I should know about?"` };

  if (signalOn(c,'growth') && status === 'expand' && c.growth === 'strong')
    return { level:'expand', action:'Open the upsell conversation', talk:`Perfect timing for expansion. Say: "Your team's engagement has been really strong — have you thought about [next tier / additional seats]? Teams at your stage typically see [outcome] when they expand."` };

  if (c.renewal <= 3)
    return { level:'renew', action:'Start renewal conversation', talk:`Get ahead of the renewal while sentiment is positive: "Renewal is coming up — I'd love to get ahead of it and make sure everything is lined up on your end."` };

  if (mom === 'dn')
    return { level:'warn', action:'Investigate score decline', talk:`Score is trending down — dig into what changed. Ask: "I noticed some changes in your usage patterns recently — is there anything going on that I should know about?"` };

  if (status === 'expand')
    return { level:'expand', action:'Ask for a referral or case study', talk:`Happy, healthy customer — great time to ask: "You've had such a great experience — would you be open to a quick intro to a peer who might benefit? I'll make it easy for you."` };

  return { level:'ok', action:'Send a value-add touchpoint', talk:`Account is healthy — maintain momentum. Send something useful: a relevant tip, case study, or product update. Close with: "Anything you'd like to cover on our next call?"` };
}

// ─── NAVIGATION ─────────────────────────────────────────────
const VIEWS = ['dashboard','alerts','customers','segments','csmperf','reports','score','csv','settings','automations','auditlog','users','clients'];
const ADMIN_EMAIL = 'signalliftconsulting@gmail.com';

function isAdmin() {
  return currentUser && currentUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

function nav(v) {
  VIEWS.forEach(id => {
    const view = document.getElementById('view-' + id);
    if (view) view.classList.remove('active');
    const ni = document.getElementById('ni-' + id);
    if (ni) ni.classList.remove('active');
  });
  const target = document.getElementById('view-' + v);
  if (target) target.classList.add('active');
  const ni = document.getElementById('ni-' + v);
  if (ni) ni.classList.add('active');

  // Always clear edit mode when navigating away from score view
  if (v !== 'score') {
    document.getElementById('score-form').dataset.editId = '';
    document.getElementById('form-title').textContent = 'Score a Customer';
  }

  if (v === 'dashboard') renderDashboard();
  if (v === 'alerts')    renderAlerts();
  if (v === 'customers') renderCustomers();
  if (v === 'segments')  renderSegments();
  if (v === 'csmperf')   { if (!hasFeature('csm_performance')) { el('csmperf-wrap').innerHTML = upgradeHTML('csm_performance'); el('csmperf-stats').innerHTML = ''; } else renderCSMPerformance(); }
  if (v === 'settings')  renderSettings();
  if (v === 'auditlog')  { if (!hasFeature('audit_log')) { el('audit-loading').style.display='none'; document.getElementById('audit-table').style.display='none'; document.getElementById('audit-empty').innerHTML = upgradeHTML('audit_log'); document.getElementById('audit-empty').style.display='block'; } else { loadAuditLog(); renderConfigHistory(); } }
  if (v === 'reports')     renderReporting();
  if (v === 'automations') renderAutomations();
  if (v === 'users')     renderUsers();
  if (v === 'clients')   renderClients();
}

// ─── REPORTS ────────────────────────────────────────────────
function renderReporting() {
  const wrap = el('reports-wrap');
  if (!wrap) return;

  const lockSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  const reports = [
    // Solo — Basic
    { section:'basic', tier:'solo', featureKey:'reports_basic',
      title:'Customer Health Export', desc:'Download all customers as CSV with scores, signals, status, MRR, and tags.',
      iconBg:'var(--blue-l)', iconColor:'var(--blue)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printCustomerHealth()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportCSV()' }
      ]
    },
    { section:'basic', tier:'solo', featureKey:'reports_basic',
      title:'Score History Export', desc:'Per-customer score changes over time with all signal snapshots.',
      iconBg:'var(--teal-l)', iconColor:'var(--teal)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
      actions:[{ label:'Export CSV', cls:'btn-primary', fn:'exportScoreHistory()' }]
    },
    // Team — Visual
    { section:'visual', tier:'team', featureKey:'reports_visual',
      title:'Portfolio Health Summary', desc:'Printable dashboard snapshot with KPI cards, status distribution, segment breakdown, and top at-risk accounts.',
      iconBg:'var(--purple-l)', iconColor:'var(--purple)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printPortfolioSummary()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportPortfolioCSV()' }
      ]
    },
    { section:'visual', tier:'team', featureKey:'reports_visual',
      title:'Weekly Health Digest', desc:'Email-ready weekly digest with KPIs, at-risk accounts, and score movers.',
      iconBg:'var(--green-l)', iconColor:'var(--green)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printDigestReport()' },
        { label:'Download HTML', cls:'btn-outline', fn:'downloadDigestHTML()' },
        { label:'Copy HTML', cls:'btn-outline', fn:'copyDigestHTML()' }
      ]
    },
    { section:'visual', tier:'team', featureKey:'reports_visual',
      title:'At-Risk Report', desc:'Critical and At Risk customers sorted by MRR, with scores, trends, days since contact, and renewal dates.',
      iconBg:'var(--red-l)', iconColor:'var(--red)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printAtRiskReport()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportAtRiskCSV()' }
      ]
    },
    { section:'visual', tier:'team', featureKey:'reports_visual',
      title:'Renewal Forecast Report', desc:'Customers grouped by renewal window (this month, 30/60/90 days) with health status and MRR.',
      iconBg:'var(--amber-l)', iconColor:'var(--amber)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printRenewalForecast()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportRenewalCSV()' }
      ]
    },
    // Growth — Strategic
    { section:'strategic', tier:'growth', featureKey:'reports_strategic',
      title:'CSM Performance Report', desc:'Per-manager portfolio metrics — avg score, risk ratio, MRR managed, contact cadence.',
      iconBg:'var(--blue-l)', iconColor:'var(--blue)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printCSMReport()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportCSMReportCSV()' }
      ]
    },
    { section:'strategic', tier:'growth', featureKey:'reports_strategic',
      title:'Segment Analysis Report', desc:'Health breakdown by tier, lifecycle, and tag — with MRR at risk per segment.',
      iconBg:'var(--purple-l)', iconColor:'var(--purple)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printSegmentAnalysis()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportSegmentCSV()' }
      ]
    },
    { section:'strategic', tier:'growth', featureKey:'reports_strategic',
      title:'Trend Report (30/60/90d)', desc:'Overall portfolio health score trend over time with status mix and MRR changes.',
      iconBg:'var(--teal-l)', iconColor:'var(--teal)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printTrendReport()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportTrendCSV()' }
      ]
    },
    { section:'strategic', tier:'growth', featureKey:'reports_strategic',
      title:'Churn Risk Report', desc:'Combined risk ranking with estimated revenue impact, scored by health, trend, NPS, engagement, and renewal proximity.',
      iconBg:'var(--red-l)', iconColor:'var(--red)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printChurnRiskReport()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportChurnRiskCSV()' }
      ]
    },
  ];

  const sections = [
    { key:'basic',     label:'Basic Reports',    tier:'solo' },
    { key:'visual',    label:'Visual Reports',   tier:'team' },
    { key:'strategic', label:'Strategic Reports', tier:'growth' },
  ];

  let html = '';
  sections.forEach(sec => {
    const secReports = reports.filter(r => r.section === sec.key);
    html += '<div class="rpt-section">' +
      '<div class="rpt-section-hd"><h2>' + sec.label + '</h2><span class="tier-badge">' + tierBadgeHTML(sec.tier) + '</span></div>' +
      '<div class="rpt-grid">';
    secReports.forEach(r => {
      const locked = !hasFeature(r.featureKey);
      html += '<div class="rpt-card' + (locked ? ' locked' : '') + '">' +
        (locked ? '<div class="rpt-lock-overlay">' + lockSvg + ' ' + (PLAN_TIER_LABELS[r.tier] || r.tier) + '+ required</div>' : '') +
        '<div class="rpt-card__icon" style="background:' + r.iconBg + ';color:' + r.iconColor + '">' + r.icon + '</div>' +
        '<div class="rpt-card__title">' + r.title + '</div>' +
        '<div class="rpt-card__desc">' + r.desc + '</div>' +
        '<div class="rpt-card__actions">' +
          r.actions.map(a => '<button class="btn btn-sm ' + a.cls + '" onclick="' + a.fn + '"' + (locked ? ' disabled' : '') + '>' + a.label + '</button>').join('') +
        '</div></div>';
    });
    html += '</div></div>';
  });
  wrap.innerHTML = html;
}

// ── Report: Score History Export (Solo) ──
function exportScoreHistory() {
  const hdr = 'customer_name,manager,tier,mrr,tags,date,score,status,logins,adoption,tickets,nps,days_since_contact,growth,lifecycle';
  const rows = [];
  customers.forEach(c => {
    (c.history || []).forEach(h => {
      const s = h.signals || {};
      const st = typeof getStatus === 'function' ? getStatus(h.score || 0) : '';
      rows.push(csvRow([
        c.name, c.manager || '', c.tier || '', c.mrr || 0, (c.tags || []).join('|'),
        h.date || '', h.score || 0, st,
        s.logins ?? '', s.adoption ?? '', s.tickets ?? '', s.nps ?? '',
        s.days ?? '', s.growth ?? '', s.lifecycle ?? ''
      ]));
    });
  });
  if (!rows.length) { toast('No score history found', 'warn'); return; }
  dlText(hdr + '\n' + rows.join('\n'), 'score-history-export.csv', 'text/csv');
  toast('Score history exported (' + rows.length + ' entries)', 'success');
}

// ── Shared print styles ──
function rptPrintCSS() {
  return '<style>' +
    '@page{size:auto;margin:16mm 12mm}' +
    '@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}' +
    '#print-area{font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#0f172a;padding:20px 36px;max-width:860px;margin:0 auto;line-height:1.55}' +
    '#print-area *{box-sizing:border-box}' +
    // header bar
    '.rpt-hdr{border-top:4px solid #4f46e5;padding-top:18px;margin-bottom:22px;page-break-inside:avoid}' +
    '.rpt-hdr-inner{display:flex;justify-content:space-between;align-items:flex-start}' +
    '.rpt-hdr h1{font-size:1.55rem;font-weight:800;margin:0 0 3px;letter-spacing:-.02em;color:#1e293b}' +
    '.rpt-hdr .sub{color:#64748b;font-size:.82rem;margin:0}' +
    '.rpt-brand{font-size:.7rem;color:#94a3b8;text-align:right;line-height:1.4;letter-spacing:.02em}' +
    '.rpt-brand strong{color:#4f46e5;font-weight:700;font-size:.75rem}' +
    // section headings
    'h2{font-size:1.05rem;font-weight:700;margin:20px 0 8px;padding-bottom:5px;border-bottom:2px solid #e2e8f0;color:#1e293b;letter-spacing:-.01em}' +
    // KPI cards
    '.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:14px 0;page-break-inside:avoid}' +
    '.kpi{border:1px solid #e2e8f0;border-top:3px solid #4f46e5;border-radius:10px;padding:16px 12px;text-align:center;background:#fff}' +
    '.kpi-num{font-size:1.45rem;font-weight:800;line-height:1.2;color:#1e293b}' +
    '.kpi-label{font-size:.68rem;color:#64748b;text-transform:uppercase;margin-top:5px;letter-spacing:.05em;font-weight:600}' +
    // tables
    'table{width:100%;border-collapse:collapse;font-size:.8rem;margin-top:10px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden}' +
    'thead th{text-align:left;color:#fff;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;padding:9px 10px;white-space:nowrap;background:#475569;font-weight:600}' +
    'th{text-align:left;color:#fff;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;padding:9px 10px;white-space:nowrap;background:#475569;font-weight:600}' +
    'td{padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#334155}' +
    'tr:nth-child(even) td{background:#f8fafc}' +
    'tr:last-child td{border-bottom:none}' +
    // status pill helper
    '.st-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}' +
    // bar chart
    '.bar{display:flex;height:24px;border-radius:6px;overflow:hidden;margin:10px 0;border:1px solid #e2e8f0}' +
    '.bar span{display:block}' +
    // footer
    '.rpt-footer{margin-top:16px;padding-top:10px;border-top:1.5px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;font-size:.68rem;color:#94a3b8;page-break-inside:avoid}' +
    // bucket headers
    '.bucket-hd{font-size:.95rem;font-weight:700;margin:20px 0 6px;display:flex;align-items:center;gap:8px;color:#1e293b}' +
    '.bucket-hd .ct{font-weight:400;color:#64748b;font-size:.82rem}' +
    // page break controls
    'table{page-break-inside:auto}tr{page-break-inside:avoid}' +
    'h2{page-break-after:avoid}.bucket-hd{page-break-after:avoid}' +
  '</style>';
}

function rptDateStr() {
  return new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
}

function rptHeader(title, subtitle) {
  return '<div class="rpt-hdr"><div class="rpt-hdr-inner">' +
    '<div><h1>' + escHtml(title) + '</h1><p class="sub">' + (subtitle || ('Generated ' + rptDateStr())) + '</p></div>' +
    '<div class="rpt-brand"><strong>iQcadence</strong><br>CS Health Score</div>' +
  '</div></div>';
}

function rptFooter() {
  return '<div class="rpt-footer"><span>iQcadence CS Health Score &middot; Confidential</span><span>' + rptDateStr() + '</span></div>';
}

function rptPrint(html) {
  const pa = document.getElementById('print-area');
  pa.style.display = 'block';
  pa.innerHTML = rptPrintCSS() + html;
  window.print();
  setTimeout(() => { pa.style.display = 'none'; pa.innerHTML = ''; }, 1000);
}

// ── SVG Chart Helpers for Print Reports ──

function svgDonut(segments, size) {
  size = size || 180;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (!total) return '';
  const cx = size / 2, cy = size / 2, r = size * 0.35, sw = size * 0.14;
  let angle = -90;
  const paths = [];
  segments.forEach(seg => {
    if (!seg.value) return;
    const pct = seg.value / total;
    const sa = angle, ea = angle + pct * 360;
    if (pct >= 0.999) {
      paths.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + seg.color + '" stroke-width="' + sw + '"/>');
    } else {
      const la = pct > 0.5 ? 1 : 0;
      const sr = sa * Math.PI / 180, er = ea * Math.PI / 180;
      const x1 = cx + r * Math.cos(sr), y1 = cy + r * Math.sin(sr);
      const x2 = cx + r * Math.cos(er), y2 = cy + r * Math.sin(er);
      paths.push('<path d="M' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' A' + r + ',' + r + ' 0 ' + la + ',1 ' + x2.toFixed(1) + ',' + y2.toFixed(1) + '" fill="none" stroke="' + seg.color + '" stroke-width="' + sw + '"/>');
    }
    angle = ea;
  });
  const legend = segments.filter(s => s.value > 0).map(seg => {
    const pct = Math.round(seg.value / total * 100);
    return '<div style="display:flex;align-items:center;gap:6px;font-size:.72rem;color:#334155;margin:3px 0">' +
      '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + seg.color + ';flex-shrink:0"></span>' +
      seg.label + ' <strong>' + seg.value + '</strong> (' + pct + '%)</div>';
  }).join('');
  return '<div style="display:flex;align-items:center;gap:28px;margin:14px 0;page-break-inside:avoid">' +
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' + paths.join('') +
    '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="' + (size * 0.15) + '" font-weight="800" fill="#1e293b">' + total + '</text>' +
    '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="' + (size * 0.06) + '" fill="#64748b" text-transform="uppercase" letter-spacing=".05em">TOTAL</text>' +
    '</svg><div>' + legend + '</div></div>';
}

function svgLineChart(points, w, h) {
  w = w || 780; h = h || 220;
  if (points.length < 2) return '';
  var pad = {t: 24, r: 24, b: 50, l: 48};
  var cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  var vals = points.map(function(p){ return p.value; });
  var rawMin = Math.min.apply(null, vals), rawMax = Math.max.apply(null, vals);
  var minV = Math.max(0, rawMin - 5), maxV = Math.min(100, rawMax + 5);
  if (maxV - minV < 10) { minV = Math.max(0, rawMin - 10); maxV = Math.min(100, rawMax + 10); }
  var range = maxV - minV || 1;
  // Grid + Y labels
  var grid = '', yLbl = '';
  for (var i = 0; i <= 4; i++) {
    var gv = minV + (range * i / 4), gy = pad.t + ch - (ch * i / 4);
    grid += '<line x1="' + pad.l + '" y1="' + gy.toFixed(1) + '" x2="' + (w - pad.r) + '" y2="' + gy.toFixed(1) + '" stroke="#e2e8f0" stroke-width=".8"/>';
    yLbl += '<text x="' + (pad.l - 8) + '" y="' + (gy + 3.5).toFixed(1) + '" text-anchor="end" font-size="9" fill="#94a3b8">' + Math.round(gv) + '</text>';
  }
  // Data points
  var pts = points.map(function(p, idx) {
    var x = pad.l + (cw * idx / (points.length - 1));
    var y = pad.t + ch - (ch * (p.value - minV) / range);
    return {x: x, y: y};
  });
  var linePath = pts.map(function(p, idx) { return (idx === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
  var areaPath = linePath + ' L' + pts[pts.length - 1].x.toFixed(1) + ',' + (pad.t + ch) + ' L' + pts[0].x.toFixed(1) + ',' + (pad.t + ch) + ' Z';
  // X labels
  var maxLbl = Math.min(14, points.length), step = Math.max(1, Math.ceil(points.length / maxLbl));
  var xLbl = '';
  points.forEach(function(p, idx) {
    if (idx % step === 0 || idx === points.length - 1) {
      var x = pad.l + (cw * idx / (points.length - 1));
      var lbl = p.label.length > 7 ? p.label.slice(5) : p.label;
      xLbl += '<text x="' + x.toFixed(1) + '" y="' + (h - 6) + '" text-anchor="middle" font-size="8.5" fill="#94a3b8" transform="rotate(-35,' + x.toFixed(1) + ',' + (h - 6) + ')">' + lbl + '</text>';
    }
  });
  // Dots
  var dots = pts.map(function(p) {
    return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3" fill="#4f46e5" stroke="#fff" stroke-width="1.5"/>';
  }).join('');
  return '<div style="margin:12px 0;overflow:hidden;page-break-inside:avoid"><svg width="100%" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet">' +
    grid + yLbl +
    '<defs><linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4f46e5" stop-opacity=".18"/><stop offset="100%" stop-color="#4f46e5" stop-opacity=".02"/></linearGradient></defs>' +
    '<path d="' + areaPath + '" fill="url(#lg1)"/>' +
    '<path d="' + linePath + '" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    dots + xLbl + '</svg></div>';
}

function svgBarH(items, w) {
  w = w || 780;
  var barH = 26, gap = 6, lblW = 130, valW = 80;
  var barArea = w - lblW - valW - 16;
  var h = items.length * (barH + gap) + 8;
  var maxV = Math.max.apply(null, items.map(function(d){ return d.value; })) || 1;
  var bars = items.map(function(item, i) {
    var y = i * (barH + gap) + 4;
    var bw = Math.max(3, (item.value / maxV) * barArea);
    var col = item.color || '#4f46e5';
    return '<text x="' + (lblW - 6) + '" y="' + (y + barH / 2 + 4) + '" text-anchor="end" font-size="11" font-weight="600" fill="#334155">' + item.label + '</text>' +
      '<rect x="' + lblW + '" y="' + y + '" width="' + bw.toFixed(1) + '" height="' + barH + '" rx="4" fill="' + col + '" opacity=".85"/>' +
      '<text x="' + (lblW + bw + 8).toFixed(1) + '" y="' + (y + barH / 2 + 4) + '" font-size="11" font-weight="700" fill="#334155">' + (item.valLabel || item.value) + '</text>';
  }).join('');
  return '<div style="margin:10px 0;page-break-inside:avoid"><svg width="100%" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet">' + bars + '</svg></div>';
}

function svgRiskBands(scored) {
  // Stacked risk band visualization: Low / Medium / High / Critical
  var bands = [
    {label: 'Low (0\u201329)', color: '#16a34a', count: 0},
    {label: 'Medium (30\u201349)', color: '#d97706', count: 0},
    {label: 'High (50\u201369)', color: '#f97316', count: 0},
    {label: 'Critical (70+)', color: '#dc2626', count: 0}
  ];
  scored.forEach(function(r) {
    if (r.risk >= 70) bands[3].count++;
    else if (r.risk >= 50) bands[2].count++;
    else if (r.risk >= 30) bands[1].count++;
    else bands[0].count++;
  });
  var total = scored.length || 1;
  var w = 780, barH = 32;
  var legend = bands.map(function(b) {
    var pct = Math.round(b.count / total * 100);
    return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:.72rem;color:#334155;margin-right:16px">' +
      '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + b.color + '"></span>' +
      b.label + ': <strong>' + b.count + '</strong> (' + pct + '%)</span>';
  }).join('');
  var barParts = bands.filter(function(b){ return b.count > 0; }).map(function(b) {
    var pct = Math.max(2, b.count / total * 100);
    return '<span style="display:block;width:' + pct + '%;background:' + b.color + ';height:' + barH + 'px"></span>';
  }).join('');
  return '<div style="margin:12px 0;page-break-inside:avoid">' +
    '<div class="bar" style="height:' + barH + 'px;border-radius:8px">' + barParts + '</div>' +
    '<div style="margin-top:8px;display:flex;flex-wrap:wrap">' + legend + '</div></div>';
}

function svgMiniBar(items) {
  // Compact bar chart within a section — used for segment comparisons
  return items.map(function(item) {
    var pct = Math.min(100, Math.max(2, item.value));
    var col = item.value >= 80 ? '#16a34a' : item.value >= 60 ? '#4f46e5' : item.value >= 40 ? '#d97706' : '#dc2626';
    return '<div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:.75rem">' +
      '<span style="width:100px;text-align:right;font-weight:600;color:#334155;flex-shrink:0">' + item.label + '</span>' +
      '<div style="flex:1;height:18px;background:#f1f5f9;border-radius:4px;overflow:hidden">' +
        '<div style="width:' + pct + '%;height:100%;background:' + col + ';border-radius:4px;opacity:.8"></div></div>' +
      '<span style="width:32px;font-weight:700;color:#334155">' + item.value + '</span></div>';
  }).join('');
}

// ── Report: Portfolio Health Summary (Team) ──
function printPortfolioSummary() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const total = active.length;
  const avg = total ? Math.round(active.reduce((s, c) => s + c.score, 0) / total) : 0;
  const totalMRR = active.reduce((s, c) => s + (c.mrr || 0), 0);

  const bands = ['critical', 'risk', 'watch', 'healthy', 'expand'];
  const bandData = bands.map(st => {
    const grp = active.filter(c => c.status === st);
    return { status: st, label: STATUS_LABEL[st], color: STATUS_COLOR[st], count: grp.length, mrr: grp.reduce((s, c) => s + (c.mrr || 0), 0), pct: total ? Math.round(grp.length / total * 100) : 0 };
  });
  const riskMRR = active.filter(c => c.status === 'critical' || c.status === 'risk').reduce((s, c) => s + (c.mrr || 0), 0);

  const tiers = ['smb', 'mid', 'enterprise'];
  const tierData = tiers.map(t => {
    const grp = active.filter(c => c.tier === t);
    return { label: t === 'smb' ? 'SMB' : t === 'mid' ? 'Mid-Market' : 'Enterprise', count: grp.length, mrr: grp.reduce((s, c) => s + (c.mrr || 0), 0), avg: grp.length ? Math.round(grp.reduce((s, c) => s + c.score, 0) / grp.length) : 0 };
  });

  const topRisk = [...active].filter(c => c.status === 'critical' || c.status === 'risk').sort((a, b) => (b.mrr || 0) - (a.mrr || 0)).slice(0, 10);

  let html = rptHeader('Portfolio Health Summary', 'Generated ' + rptDateStr() + ' &middot; ' + total + ' active accounts') +
    '<div class="kpi-row">' +
      '<div class="kpi"><div class="kpi-num">' + total + '</div><div class="kpi-label">Active Accounts</div></div>' +
      '<div class="kpi"><div class="kpi-num">' + avg + '</div><div class="kpi-label">Avg Health Score</div></div>' +
      '<div class="kpi"><div class="kpi-num">$' + fmtNum(totalMRR) + '</div><div class="kpi-label">Total MRR</div></div>' +
      '<div class="kpi" style="border-top-color:#dc2626"><div class="kpi-num" style="color:#dc2626">$' + fmtNum(riskMRR) + '</div><div class="kpi-label">MRR at Risk</div></div>' +
    '</div>' +
    '<h2>Status Distribution</h2>' +
    '<div style="display:flex;gap:30px;align-items:flex-start;flex-wrap:wrap">' +
      svgDonut(bandData.map(b => ({label: b.label, value: b.count, color: b.color})), 170) +
      '<div style="flex:1;min-width:280px"><table><tr><th>Status</th><th>Count</th><th>%</th><th style="text-align:right">MRR</th></tr>' +
        bandData.map(b => '<tr><td><span class="st-dot" style="background:' + b.color + '"></span>' + b.label + '</td><td>' + b.count + '</td><td>' + b.pct + '%</td><td style="text-align:right">$' + fmtNum(b.mrr) + '</td></tr>').join('') +
      '</table></div></div>' +
    '<h2>Segment Breakdown</h2>' +
    svgBarH(tierData.map(t => ({label: t.label, value: t.mrr, color: '#4f46e5', valLabel: '$' + fmtNum(t.mrr)}))) +
    '<table><tr><th>Tier</th><th>Accounts</th><th style="text-align:right">MRR</th><th>Avg Score</th><th style="text-align:right">Score</th></tr>' +
      tierData.map(t => {
        var col = t.avg >= 80 ? '#16a34a' : t.avg >= 60 ? '#4f46e5' : t.avg >= 40 ? '#d97706' : '#dc2626';
        return '<tr><td><strong>' + t.label + '</strong></td><td>' + t.count + '</td><td style="text-align:right">$' + fmtNum(t.mrr) + '</td>' +
          '<td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:14px;background:#f1f5f9;border-radius:3px;overflow:hidden"><div style="width:' + t.avg + '%;height:100%;background:' + col + ';border-radius:3px"></div></div></div></td>' +
          '<td style="text-align:right;font-weight:700;color:' + col + '">' + t.avg + '</td></tr>';
      }).join('') +
    '</table>';

  if (topRisk.length) {
    html += '<h2>Top At-Risk Accounts by MRR</h2>' +
      '<table><tr><th>Customer</th><th>Score</th><th>Status</th><th style="text-align:right">MRR</th><th>Days Since Contact</th><th>Renewal</th></tr>' +
      topRisk.map(c => '<tr><td><strong>' + escHtml(c.name) + '</strong></td><td style="font-weight:700;color:' + STATUS_COLOR[c.status] + '">' + c.score + '</td><td><span class="st-dot" style="background:' + STATUS_COLOR[c.status] + '"></span>' + STATUS_LABEL[c.status] + '</td><td style="text-align:right">$' + fmtNum(c.mrr || 0) + '</td><td' + ((c.days || 0) >= 14 ? ' style="color:#dc2626;font-weight:600"' : '') + '>' + (c.days ?? '\u2014') + 'd</td><td>' + (c.renewal_date ? fmtDate(c.renewal_date) : '\u2014') + '</td></tr>').join('') +
      '</table>';
  }
  html += rptFooter();
  rptPrint(html);
}

// ── Report: At-Risk Report (Team) ──
function printAtRiskReport() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const atRisk = active.filter(c => c.status === 'critical' || c.status === 'risk').sort((a, b) => (b.mrr || 0) - (a.mrr || 0));
  if (!atRisk.length) { toast('No at-risk customers found', 'success'); return; }
  const totalRiskMRR = atRisk.reduce((s, c) => s + (c.mrr || 0), 0);

  const critCount = atRisk.filter(c => c.status === 'critical').length;
  const riskCount = atRisk.length - critCount;
  const critMRR = atRisk.filter(c => c.status === 'critical').reduce((s, c) => s + (c.mrr || 0), 0);
  const riskOnlyMRR = totalRiskMRR - critMRR;

  let html = rptHeader('At-Risk Report', 'Generated ' + rptDateStr() + ' &middot; ' + atRisk.length + ' accounts &middot; $' + fmtNum(totalRiskMRR) + ' MRR at risk') +
    '<div class="kpi-row">' +
      '<div class="kpi" style="border-top-color:#dc2626"><div class="kpi-num" style="color:#dc2626">' + critCount + '</div><div class="kpi-label">Critical</div></div>' +
      '<div class="kpi" style="border-top-color:#f97316"><div class="kpi-num" style="color:#f97316">' + riskCount + '</div><div class="kpi-label">At Risk</div></div>' +
      '<div class="kpi" style="border-top-color:#dc2626"><div class="kpi-num" style="color:#dc2626">$' + fmtNum(critMRR) + '</div><div class="kpi-label">Critical MRR</div></div>' +
      '<div class="kpi" style="border-top-color:#f97316"><div class="kpi-num" style="color:#f97316">$' + fmtNum(riskOnlyMRR) + '</div><div class="kpi-label">At Risk MRR</div></div>' +
    '</div>' +
    svgBarH([
      {label: 'Critical', value: critMRR, color: '#dc2626', valLabel: '$' + fmtNum(critMRR) + ' (' + critCount + ' accts)'},
      {label: 'At Risk', value: riskOnlyMRR, color: '#f97316', valLabel: '$' + fmtNum(riskOnlyMRR) + ' (' + riskCount + ' accts)'}
    ]) +
    '<h2>At-Risk Accounts</h2>' +
    '<table><tr><th>Customer</th><th>Manager</th><th>Score</th><th>Status</th><th>7d Trend</th><th style="text-align:right">MRR</th><th>Days Since Contact</th><th>Renewal</th></tr>' +
    atRisk.map(c => {
      const delta = getDelta7d(c);
      const trendStr = delta > 0 ? '+' + delta : String(delta);
      const trendColor = delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : '#64748b';
      return '<tr><td><strong>' + escHtml(c.name) + '</strong></td><td>' + escHtml(c.manager || '\u2014') + '</td>' +
        '<td style="font-weight:700;color:' + STATUS_COLOR[c.status] + '">' + c.score + '</td>' +
        '<td><span class="st-dot" style="background:' + STATUS_COLOR[c.status] + '"></span>' + STATUS_LABEL[c.status] + '</td>' +
        '<td style="color:' + trendColor + ';font-weight:600">' + trendStr + '</td><td style="text-align:right">$' + fmtNum(c.mrr || 0) + '</td>' +
        '<td' + ((c.days || 0) >= 14 ? ' style="color:#dc2626;font-weight:600"' : '') + '>' + (c.days ?? '\u2014') + 'd</td>' +
        '<td>' + (c.renewal_date ? fmtDate(c.renewal_date) : '\u2014') + '</td></tr>';
    }).join('') +
    '</table>' + rptFooter();
  rptPrint(html);
}

function exportAtRiskCSV() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const atRisk = active.filter(c => c.status === 'critical' || c.status === 'risk').sort((a, b) => (b.mrr || 0) - (a.mrr || 0));
  if (!atRisk.length) { toast('No at-risk customers found', 'success'); return; }
  const hdr = CSV_CUST_HDR;
  const rows = atRisk.map(c => csvRow(csvCustCols(c)));
  dlText(hdr + '\n' + rows.join('\n'), 'at-risk-report.csv', 'text/csv');
  toast('At-risk report exported (' + atRisk.length + ' accounts)', 'success');
}

// ── Report: Renewal Forecast (Team) ──
function printRenewalForecast() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c) && c.renewal_date);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const d30 = new Date(now); d30.setDate(d30.getDate() + 30);
  const d60 = new Date(now); d60.setDate(d60.getDate() + 60);
  const d90 = new Date(now); d90.setDate(d90.getDate() + 90);

  const buckets = [
    { label: 'This Month', from: now, to: endOfMonth },
    { label: 'Next 30 Days', from: now, to: d30 },
    { label: '31\u201360 Days', from: d30, to: d60 },
    { label: '61\u201390 Days', from: d60, to: d90 },
  ];

  const assigned = new Set();
  const bucketData = buckets.map(b => {
    const items = active.filter(c => {
      if (assigned.has(c.id)) return false;
      const rd = new Date(c.renewal_date);
      return rd >= b.from && rd <= b.to;
    }).sort((a, b) => new Date(a.renewal_date) - new Date(b.renewal_date));
    items.forEach(c => assigned.add(c.id));
    const mrr = items.reduce((s, c) => s + (c.mrr || 0), 0);
    return { ...b, items, mrr };
  });

  const totalRenewals = bucketData.reduce((s, b) => s + b.items.length, 0);
  const totalRMRR = bucketData.reduce((s, b) => s + b.mrr, 0);
  let html = rptHeader('Renewal Forecast Report', 'Generated ' + rptDateStr() + ' &middot; ' + totalRenewals + ' renewals &middot; $' + fmtNum(totalRMRR) + ' MRR') +
    '<h2>MRR by Renewal Window</h2>' +
    svgBarH(bucketData.map(b => ({label: b.label, value: b.mrr, color: b.items.some(c => c.status === 'critical' || c.status === 'risk') ? '#d97706' : '#4f46e5', valLabel: '$' + fmtNum(b.mrr) + ' (' + b.items.length + ')'})));

  bucketData.forEach(b => {
    html += '<div class="bucket-hd">' + b.label + ' <span class="ct">' + b.items.length + ' accounts &middot; $' + fmtNum(b.mrr) + ' MRR</span></div>';
    if (b.items.length) {
      html += '<table><tr><th>Customer</th><th>Manager</th><th>Score</th><th>Status</th><th style="text-align:right">MRR</th><th>Renewal Date</th></tr>' +
        b.items.map(c => '<tr><td><strong>' + escHtml(c.name) + '</strong></td><td>' + escHtml(c.manager || '\u2014') + '</td><td style="font-weight:700;color:' + STATUS_COLOR[c.status] + '">' + c.score + '</td><td><span class="st-dot" style="background:' + STATUS_COLOR[c.status] + '"></span>' + STATUS_LABEL[c.status] + '</td><td style="text-align:right">$' + fmtNum(c.mrr || 0) + '</td><td>' + fmtDate(c.renewal_date) + '</td></tr>').join('') +
        '</table>';
    } else {
      html += '<p style="color:#94a3b8;font-size:.82rem;margin:4px 0 12px">No renewals in this window.</p>';
    }
  });

  html += rptFooter();
  rptPrint(html);
}

// ── Report: CSM Performance (Growth) ──
function printCSMReport() {
  const active = customers.filter(c => c.lifecycle !== 'churned');
  const managers = [...new Set(active.map(c => c.manager || '').filter(Boolean))].sort();
  if (!managers.length) { toast('No managers found', 'warn'); return; }

  const mgrData = managers.map(m => {
    const grp = active.filter(c => c.manager === m);
    const atRisk = grp.filter(c => c.status === 'critical' || c.status === 'risk').length;
    const avgScore = grp.length ? Math.round(grp.reduce((s, c) => s + c.score, 0) / grp.length) : 0;
    const mrr = grp.reduce((s, c) => s + (c.mrr || 0), 0);
    const avgDays = grp.length ? Math.round(grp.reduce((s, c) => s + (c.days || 0), 0) / grp.length) : 0;
    return { manager: m, count: grp.length, avgScore, atRisk, riskPct: grp.length ? Math.round(atRisk / grp.length * 100) : 0, mrr, avgDays };
  }).sort((a, b) => b.avgScore - a.avgScore);

  let html = rptHeader('CSM Performance Report', 'Generated ' + rptDateStr() + ' &middot; ' + managers.length + ' managers') +
    '<h2>Avg Health Score by Manager</h2>' +
    svgBarH(mgrData.map(m => {
      var col = m.avgScore >= 80 ? '#16a34a' : m.avgScore >= 60 ? '#4f46e5' : m.avgScore >= 40 ? '#d97706' : '#dc2626';
      return {label: m.manager.length > 18 ? m.manager.slice(0, 16) + '\u2026' : m.manager, value: m.avgScore, color: col, valLabel: m.avgScore + ' avg'};
    })) +
    '<h2>Manager Details</h2>' +
    '<table><tr><th>Manager</th><th>Accounts</th><th>Avg Score</th><th>At Risk</th><th>Risk %</th><th style="text-align:right">MRR Managed</th><th>Avg Days Contact</th></tr>' +
    mgrData.map(m => {
      const riskColor = m.riskPct >= 40 ? '#dc2626' : m.riskPct >= 20 ? '#d97706' : '#16a34a';
      return '<tr><td><strong>' + escHtml(m.manager) + '</strong></td><td>' + m.count + '</td><td style="font-weight:700">' + m.avgScore + '</td><td>' + m.atRisk + '</td><td style="color:' + riskColor + ';font-weight:600">' + m.riskPct + '%</td><td style="text-align:right">$' + fmtNum(m.mrr) + '</td><td>' + m.avgDays + 'd</td></tr>';
    }).join('') +
    '</table>' + rptFooter();
  rptPrint(html);
}

// ── Report: Segment Analysis (Growth) ──
function printSegmentAnalysis() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!active.length) { toast('No customers found', 'warn'); return; }

  function segTable(label, groups) {
    let chart = svgMiniBar(groups.map(g => ({label: g.label.length > 14 ? g.label.slice(0, 12) + '\u2026' : g.label, value: g.avg})));
    let h = '<h2>' + label + '</h2>' + chart +
      '<table><tr><th>Segment</th><th>Accounts</th><th>Avg Score</th><th style="text-align:right">MRR</th><th>At Risk %</th></tr>';
    groups.forEach(g => {
      const riskColor = g.riskPct >= 40 ? '#dc2626' : g.riskPct >= 20 ? '#d97706' : '#16a34a';
      h += '<tr><td><strong>' + escHtml(g.label) + '</strong></td><td>' + g.count + '</td><td style="font-weight:700">' + g.avg + '</td><td style="text-align:right">$' + fmtNum(g.mrr) + '</td><td style="color:' + riskColor + ';font-weight:600">' + g.riskPct + '%</td></tr>';
    });
    return h + '</table>';
  }

  function buildGroups(keyFn) {
    const map = {};
    active.forEach(c => {
      const keys = keyFn(c);
      (Array.isArray(keys) ? keys : [keys]).forEach(k => {
        if (!k) return;
        if (!map[k]) map[k] = [];
        map[k].push(c);
      });
    });
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length).map(([k, grp]) => {
      const atRisk = grp.filter(c => c.status === 'critical' || c.status === 'risk').length;
      return { label: k, count: grp.length, avg: Math.round(grp.reduce((s, c) => s + c.score, 0) / grp.length), mrr: grp.reduce((s, c) => s + (c.mrr || 0), 0), riskPct: Math.round(atRisk / grp.length * 100) };
    });
  }

  const tierMap = { smb: 'SMB', mid: 'Mid-Market', enterprise: 'Enterprise' };
  const byTier = buildGroups(c => tierMap[c.tier] || c.tier || 'Unknown');
  const byLifecycle = buildGroups(c => c.lifecycle || 'Unknown');
  const byTag = buildGroups(c => (c.tags && c.tags.length) ? c.tags : ['Untagged']);

  let html = rptHeader('Segment Analysis Report', 'Generated ' + rptDateStr() + ' &middot; ' + active.length + ' accounts') +
    segTable('By Tier', byTier) +
    segTable('By Lifecycle', byLifecycle) +
    (byTag.length ? segTable('By Tag', byTag) : '') +
    rptFooter();
  rptPrint(html);
}

// ── Report: Trend Report (Growth) ──
function printTrendReport() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const now = new Date();
  const d90ago = new Date(now); d90ago.setDate(d90ago.getDate() - 90);

  // Collect all history points in the last 90 days, group by date
  const dateMap = {};
  active.forEach(c => {
    (c.history || []).forEach(h => {
      if (!h.date) return;
      const d = h.date.slice(0, 10);
      if (new Date(d) < d90ago) return;
      if (!dateMap[d]) dateMap[d] = [];
      dateMap[d].push(h.score);
    });
  });

  const dates = Object.keys(dateMap).sort();
  if (!dates.length) { toast('No score history in the last 90 days', 'warn'); return; }

  const rows = dates.map(d => {
    const scores = dateMap[d];
    const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
    return { date: d, entries: scores.length, avg };
  });

  // Current snapshot
  const currentAvg = active.length ? Math.round(active.reduce((s, c) => s + c.score, 0) / active.length) : 0;
  const firstAvg = rows.length ? rows[0].avg : currentAvg;
  const delta = currentAvg - firstAvg;

  const deltaColor = delta >= 0 ? '#16a34a' : '#dc2626';
  let html = rptHeader('Trend Report (90 Days)') +
    '<div class="kpi-row">' +
      '<div class="kpi"><div class="kpi-num">' + currentAvg + '</div><div class="kpi-label">Current Avg Score</div></div>' +
      '<div class="kpi"><div class="kpi-num">' + firstAvg + '</div><div class="kpi-label">90 Days Ago</div></div>' +
      '<div class="kpi" style="border-top-color:' + deltaColor + '"><div class="kpi-num" style="color:' + deltaColor + '">' + (delta >= 0 ? '+' : '') + delta + '</div><div class="kpi-label">Change</div></div>' +
      '<div class="kpi"><div class="kpi-num">' + active.length + '</div><div class="kpi-label">Active Accounts</div></div>' +
    '</div>' +
    '<h2>Average Health Score Trend</h2>' +
    svgLineChart(rows.map(r => ({label: r.date, value: r.avg}))) +
    '<h2>Score Trend by Date</h2>' +
    '<table><tr><th>Date</th><th>Scores Recorded</th><th style="text-align:right">Avg Score</th></tr>' +
    rows.map(r => '<tr><td>' + r.date + '</td><td>' + r.entries + '</td><td style="text-align:right;font-weight:700">' + r.avg + '</td></tr>').join('') +
    '</table>' + rptFooter();
  rptPrint(html);
}

// ── Report: Churn Risk Report (Growth) ──
function printChurnRiskReport() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!active.length) { toast('No customers found', 'warn'); return; }

  // Compute composite churn risk score (0-100, higher = more at risk)
  const scored = active.map(c => {
    let risk = 0;
    // Health score (inverse, 0-30 pts)
    risk += Math.round((100 - c.score) * 0.3);
    // Negative trend (0-20 pts)
    const delta = getDelta7d(c);
    if (delta < 0) risk += Math.min(20, Math.abs(delta) * 2);
    // NPS detractor (0-15 pts)
    if (c.nps === 'detractor') risk += 15;
    else if (c.nps === 'passive') risk += 5;
    // Low engagement: logins (0-10 pts)
    if ((c.logins || 0) <= 2) risk += 10;
    else if ((c.logins || 0) <= 5) risk += 5;
    // Low adoption (0-10 pts)
    if ((c.adoption || 0) < 30) risk += 10;
    else if ((c.adoption || 0) < 50) risk += 5;
    // High tickets (0-5 pts)
    if ((c.tickets || 0) >= 5) risk += 5;
    // Imminent renewal (0-10 pts)
    if (c.renewal != null && c.renewal <= 2) risk += 10;
    else if (c.renewal != null && c.renewal <= 4) risk += 5;

    return { c, risk: Math.min(100, risk), impact: (c.mrr || 0) * 12 };
  }).sort((a, b) => b.risk - a.risk);

  const totalImpact = scored.reduce((s, r) => s + r.impact, 0);
  const highRisk = scored.filter(r => r.risk >= 50);

  let html = rptHeader('Churn Risk Report', 'Generated ' + rptDateStr() + ' &middot; ' + active.length + ' accounts analyzed') +
    '<div class="kpi-row">' +
      '<div class="kpi" style="border-top-color:#dc2626"><div class="kpi-num" style="color:#dc2626">' + highRisk.length + '</div><div class="kpi-label">High Risk (50+)</div></div>' +
      '<div class="kpi"><div class="kpi-num">$' + fmtNum(totalImpact) + '</div><div class="kpi-label">Total ARR Exposure</div></div>' +
      '<div class="kpi" style="border-top-color:#d97706"><div class="kpi-num" style="color:#d97706">$' + fmtNum(highRisk.reduce((s, r) => s + r.impact, 0)) + '</div><div class="kpi-label">High Risk ARR</div></div>' +
      '<div class="kpi"><div class="kpi-num">' + active.length + '</div><div class="kpi-label">Active Accounts</div></div>' +
    '</div>' +
    '<h2>Risk Distribution</h2>' +
    svgRiskBands(scored) +
    '<h2>All Accounts Ranked by Churn Risk</h2>' +
    '<table><tr><th>#</th><th>Customer</th><th>Risk Score</th><th>Health</th><th>7d Trend</th><th style="text-align:right">MRR</th><th style="text-align:right">Est. ARR</th><th>NPS</th><th>Renewal</th></tr>' +
    scored.map((r, i) => {
      const c = r.c;
      const delta = getDelta7d(c);
      const trendStr = delta > 0 ? '+' + delta : String(delta);
      const trendColor = delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : '#64748b';
      const riskColor = r.risk >= 70 ? '#dc2626' : r.risk >= 50 ? '#d97706' : r.risk >= 30 ? '#64748b' : '#16a34a';
      return '<tr><td style="color:#94a3b8">' + (i + 1) + '</td><td><strong>' + escHtml(c.name) + '</strong></td>' +
        '<td style="font-weight:700;color:' + riskColor + '">' + r.risk + '</td>' +
        '<td style="font-weight:700;color:' + STATUS_COLOR[c.status] + '">' + c.score + '</td>' +
        '<td style="color:' + trendColor + ';font-weight:600">' + trendStr + '</td>' +
        '<td style="text-align:right">$' + fmtNum(c.mrr || 0) + '</td><td style="text-align:right">$' + fmtNum(r.impact) + '</td>' +
        '<td>' + (c.nps || '\u2014') + '</td>' +
        '<td>' + (c.renewal_date ? fmtDate(c.renewal_date) : '\u2014') + '</td></tr>';
    }).join('') +
    '</table>' + rptFooter();
  rptPrint(html);
}

// ── CSV helpers ──
function csvRow(vals) { return vals.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(','); }

// Standard customer columns for pivot-table-ready CSVs
const CSV_CUST_HDR = 'name,manager,score,status,status_label,tier,lifecycle,mrr,arr,logins,adoption,tickets,nps,days_since_contact,growth,renewal_date,renewal_months,tags,since,next_touch,trend_7d';
function csvCustCols(c) {
  return [c.name, c.manager || '', c.score, c.status, STATUS_LABEL[c.status] || c.status,
    c.tier || '', c.lifecycle || '', c.mrr || 0, (c.mrr || 0) * 12,
    c.logins ?? '', c.adoption ?? '', c.tickets ?? '', c.nps || '',
    c.days ?? '', c.growth || '', c.renewal_date || '', c.renewal ?? '',
    (c.tags || []).join('|'), c.since || '', c.next_touch || '', getDelta7d(c)];
}

// ── Export: Portfolio Health CSV ──
function exportPortfolioCSV() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!active.length) { toast('No customers found', 'warn'); return; }
  const hdr = CSV_CUST_HDR;
  const rows = active.map(c => csvRow(csvCustCols(c)));
  dlText(hdr + '\n' + rows.join('\n'), 'portfolio-health-summary.csv', 'text/csv');
  toast('Portfolio CSV exported (' + active.length + ' accounts)', 'success');
}

// ── Export: Renewal Forecast CSV ──
function exportRenewalCSV() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c) && c.renewal_date);
  if (!active.length) { toast('No customers with renewal dates found', 'warn'); return; }
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const sorted = [...active].sort((a, b) => new Date(a.renewal_date) - new Date(b.renewal_date));
  const hdr = CSV_CUST_HDR + ',days_until_renewal,renewal_bucket';
  const rows = sorted.map(c => {
    const rd = new Date(c.renewal_date);
    const diff = Math.round((rd - now) / (1000 * 60 * 60 * 24));
    const bucket = diff <= 0 ? 'Past Due' : diff <= 30 ? '0-30 Days' : diff <= 60 ? '31-60 Days' : diff <= 90 ? '61-90 Days' : '90+ Days';
    return csvRow([...csvCustCols(c), diff, bucket]);
  });
  dlText(hdr + '\n' + rows.join('\n'), 'renewal-forecast.csv', 'text/csv');
  toast('Renewal forecast exported (' + sorted.length + ' accounts)', 'success');
}

// ── Export: CSM Performance CSV ──
function exportCSMReportCSV() {
  const active = customers.filter(c => c.lifecycle !== 'churned');
  const managers = [...new Set(active.map(c => c.manager || '').filter(Boolean))].sort();
  if (!managers.length) { toast('No managers found', 'warn'); return; }
  const hdr = 'manager,accounts,avg_score,critical_count,at_risk_count,watch_count,healthy_count,expansion_count,risk_pct,healthy_pct,mrr_managed,total_arr,avg_days_since_contact,avg_logins,avg_adoption';
  const rows = managers.map(m => {
    const grp = active.filter(c => c.manager === m);
    const n = grp.length;
    const critical = grp.filter(c => c.status === 'critical').length;
    const atRisk = grp.filter(c => c.status === 'risk').length;
    const watch = grp.filter(c => c.status === 'watch').length;
    const healthy = grp.filter(c => c.status === 'healthy').length;
    const expand = grp.filter(c => c.status === 'expand').length;
    const avgScore = n ? Math.round(grp.reduce((s, c) => s + c.score, 0) / n) : 0;
    const mrr = grp.reduce((s, c) => s + (c.mrr || 0), 0);
    const avgDays = n ? Math.round(grp.reduce((s, c) => s + (c.days || 0), 0) / n) : 0;
    const avgLogins = n ? Math.round(grp.reduce((s, c) => s + (c.logins || 0), 0) / n * 10) / 10 : 0;
    const avgAdoption = n ? Math.round(grp.reduce((s, c) => s + (c.adoption || 0), 0) / n) : 0;
    return csvRow([m, n, avgScore, critical, atRisk, watch, healthy, expand,
      n ? Math.round((critical + atRisk) / n * 100) : 0,
      n ? Math.round((healthy + expand) / n * 100) : 0,
      mrr, mrr * 12, avgDays, avgLogins, avgAdoption]);
  });
  dlText(hdr + '\n' + rows.join('\n'), 'csm-performance.csv', 'text/csv');
  toast('CSM report exported (' + managers.length + ' managers)', 'success');
}

// ── Export: Segment Analysis CSV ──
function exportSegmentCSV() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!active.length) { toast('No customers found', 'warn'); return; }
  function buildRows(type, keyFn) {
    const map = {};
    active.forEach(c => {
      const keys = keyFn(c);
      (Array.isArray(keys) ? keys : [keys]).forEach(k => {
        if (!k) return;
        if (!map[k]) map[k] = [];
        map[k].push(c);
      });
    });
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length).map(([k, grp]) => {
      const n = grp.length;
      const critical = grp.filter(c => c.status === 'critical').length;
      const atRisk = grp.filter(c => c.status === 'risk').length;
      const healthy = grp.filter(c => c.status === 'healthy').length;
      const expand = grp.filter(c => c.status === 'expand').length;
      const mrr = grp.reduce((s, c) => s + (c.mrr || 0), 0);
      return csvRow([type, k, n,
        Math.round(grp.reduce((s, c) => s + c.score, 0) / n),
        mrr, mrr * 12,
        critical, atRisk, healthy + expand,
        Math.round((critical + atRisk) / n * 100),
        Math.round((healthy + expand) / n * 100),
        Math.round(grp.reduce((s, c) => s + (c.days || 0), 0) / n),
        Math.round(grp.reduce((s, c) => s + (c.adoption || 0), 0) / n)]);
    });
  }
  const tierMap = { smb: 'SMB', mid: 'Mid-Market', enterprise: 'Enterprise' };
  const hdr = 'segment_type,segment_value,accounts,avg_score,mrr,arr,critical_count,at_risk_count,healthy_count,at_risk_pct,healthy_pct,avg_days_since_contact,avg_adoption';
  const rows = [
    ...buildRows('Tier', c => tierMap[c.tier] || c.tier || 'Unknown'),
    ...buildRows('Lifecycle', c => c.lifecycle || 'Unknown'),
    ...buildRows('Tag', c => (c.tags && c.tags.length) ? c.tags : ['Untagged']),
  ];
  dlText(hdr + '\n' + rows.join('\n'), 'segment-analysis.csv', 'text/csv');
  toast('Segment analysis exported', 'success');
}

// ── Export: Trend CSV ──
function exportTrendCSV() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const now = new Date();
  const d90ago = new Date(now); d90ago.setDate(d90ago.getDate() - 90);
  const dateMap = {};
  active.forEach(c => {
    (c.history || []).forEach(h => {
      if (!h.date) return;
      const d = h.date.slice(0, 10);
      if (new Date(d) < d90ago) return;
      if (!dateMap[d]) dateMap[d] = [];
      dateMap[d].push(h.score);
    });
  });
  const dates = Object.keys(dateMap).sort();
  if (!dates.length) { toast('No score history in last 90 days', 'warn'); return; }
  const hdr = 'date,scores_recorded,avg_score,min_score,max_score,median_score,score_spread';
  const rows = dates.map(d => {
    const scores = dateMap[d].sort((a, b) => a - b);
    const n = scores.length;
    const avg = Math.round(scores.reduce((s, v) => s + v, 0) / n);
    const min = scores[0];
    const max = scores[n - 1];
    const median = n % 2 === 0 ? Math.round((scores[n / 2 - 1] + scores[n / 2]) / 2) : scores[Math.floor(n / 2)];
    return csvRow([d, n, avg, min, max, median, max - min]);
  });
  dlText(hdr + '\n' + rows.join('\n'), 'trend-report-90d.csv', 'text/csv');
  toast('Trend report exported (' + dates.length + ' days)', 'success');
}

// ── Export: Churn Risk CSV ──
function exportChurnRiskCSV() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!active.length) { toast('No customers found', 'warn'); return; }
  const scored = active.map(c => {
    const healthPts = Math.round((100 - c.score) * 0.3);
    const delta = getDelta7d(c);
    const trendPts = delta < 0 ? Math.min(20, Math.abs(delta) * 2) : 0;
    const npsPts = c.nps === 'detractor' ? 15 : c.nps === 'passive' ? 5 : 0;
    const loginPts = (c.logins || 0) <= 2 ? 10 : (c.logins || 0) <= 5 ? 5 : 0;
    const adoptPts = (c.adoption || 0) < 30 ? 10 : (c.adoption || 0) < 50 ? 5 : 0;
    const engagePts = loginPts + adoptPts;
    const ticketPts = (c.tickets || 0) >= 5 ? 5 : 0;
    const renewPts = (c.renewal != null && c.renewal <= 2) ? 10 : (c.renewal != null && c.renewal <= 4) ? 5 : 0;
    const risk = Math.min(100, healthPts + trendPts + npsPts + engagePts + ticketPts + renewPts);
    return { c, risk, delta, impact: (c.mrr || 0) * 12, healthPts, trendPts, npsPts, engagePts, ticketPts, renewPts };
  }).sort((a, b) => b.risk - a.risk);
  const hdr = CSV_CUST_HDR + ',risk_score,est_arr_impact,risk_health_pts,risk_trend_pts,risk_nps_pts,risk_engagement_pts,risk_tickets_pts,risk_renewal_pts';
  const rows = scored.map(r => csvRow([...csvCustCols(r.c), r.risk, r.impact, r.healthPts, r.trendPts, r.npsPts, r.engagePts, r.ticketPts, r.renewPts]));
  dlText(hdr + '\n' + rows.join('\n'), 'churn-risk-report.csv', 'text/csv');
  toast('Churn risk report exported (' + scored.length + ' accounts)', 'success');
}

// ── Print: Customer Health (all customers table) ──
function printCustomerHealth() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!active.length) { toast('No customers found', 'warn'); return; }
  const sorted = [...active].sort((a, b) => a.score - b.score);
  let html = rptHeader('Customer Health Report', 'Generated ' + rptDateStr() + ' &middot; ' + active.length + ' accounts') +
    '<table><tr><th>Customer</th><th>Manager</th><th>Score</th><th>Status</th><th>Tier</th><th style="text-align:right">MRR</th><th>Logins</th><th>Adoption</th><th>Tickets</th><th>NPS</th></tr>' +
    sorted.map(c =>
      '<tr><td><strong>' + escHtml(c.name) + '</strong></td><td>' + escHtml(c.manager || '\u2014') + '</td>' +
      '<td style="font-weight:700;color:' + STATUS_COLOR[c.status] + '">' + c.score + '</td>' +
      '<td><span class="st-dot" style="background:' + STATUS_COLOR[c.status] + '"></span>' + STATUS_LABEL[c.status] + '</td>' +
      '<td>' + (c.tier === 'smb' ? 'SMB' : c.tier === 'mid' ? 'Mid' : c.tier === 'enterprise' ? 'Ent' : c.tier || '\u2014') + '</td>' +
      '<td style="text-align:right">$' + fmtNum(c.mrr || 0) + '</td>' +
      '<td>' + (c.logins ?? '\u2014') + '</td><td>' + (c.adoption ?? '\u2014') + '%</td>' +
      '<td>' + (c.tickets ?? '\u2014') + '</td><td>' + (c.nps || '\u2014') + '</td></tr>'
    ).join('') +
    '</table>' + rptFooter();
  rptPrint(html);
}

// ── Print: Weekly Digest (formatted for PDF) ──
function printDigestReport() {
  const digestHtml = buildDigestHTML();
  if (!digestHtml) { toast('No data to generate digest', 'warn'); return; }
  // Strip the inline email styles and wrap in our report CSS
  let html = rptHeader('Weekly Health Digest') +
    '<div style="font-size:.85rem;line-height:1.6">' + digestHtml + '</div>' +
    rptFooter();
  rptPrint(html);
}

// ─── TOAST ──────────────────────────────────────────────────
function toast(msg, type, dur) {
  type = type || 'default';
  dur  = dur  || 2800;
  const tw = document.getElementById('tw');
  const t  = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  tw.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, dur);
}

// ─── MODALS ─────────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
function openModal(id) {
  document.getElementById(id).classList.add('open');
}

// Close modal on backdrop click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-bg')) {
    e.target.classList.remove('open');
  }
  // Close preset dropdown on outside click
  if (!e.target.closest('#preset-dd-wrap')) {
    el('preset-dd-menu')?.classList.remove('open');
  }
  // Close bell dropdown on outside click (v86)
  if (!e.target.closest('#bell-dd-wrap')) {
    el('bell-dd-menu')?.classList.remove('open');
  }
});

// ─── KEYBOARD SHORTCUTS ──────────────────────────────────────
document.addEventListener('keydown', e => {
  // Esc — close open column filter dropdown or modal
  if (e.key === 'Escape') {
    closeColFilter();
    closeAlertFilter();
    document.querySelectorAll('.modal-bg.open').forEach(m => m.classList.remove('open'));
    return;
  }
  // Ignore shortcuts when typing in inputs
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;

  // Cmd/Ctrl + K — jump to customer search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    nav('customers');
    setTimeout(() => el('search-input')?.focus(), 50);
    return;
  }
  // Cmd/Ctrl + Enter — submit score form if on score view
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    const scoreView = document.getElementById('view-score');
    if (scoreView?.classList.contains('active')) {
      document.getElementById('score-form').requestSubmit();
    }
    return;
  }
  // Number shortcuts for nav (1-6)
  const navMap = { '1':'dashboard','2':'alerts','3':'customers','4':'score','5':'csv','6':'settings' };
  if (!e.metaKey && !e.ctrlKey && !e.altKey && navMap[e.key]) {
    nav(navMap[e.key]);
  }
});

// ─── SCORE FORM ─────────────────────────────────────────────
function rv(key, val) {
  document.getElementById('rv-' + key).textContent = val;
}

function getFormData() {
  return {
    name:     document.getElementById('f-name').value.trim(),
    manager:  (()=>{ const nEl=document.getElementById('f-manager-new'); if(nEl&&nEl.style.display!=='none'&&nEl.value.trim()) return nEl.value.trim(); const sEl=document.getElementById('f-manager'); return (sEl&&sEl.value&&sEl.value!=='__add_new__') ? sEl.value : ''; })(),
    mrr:      parseFloat(document.getElementById('f-mrr').value)      || 0,
    arr:      parseFloat(document.getElementById('f-arr')?.value)     || 0,
    since:    document.getElementById('f-since')?.value               || '',
    tier:     document.getElementById('f-tier').value,
    lifecycle:document.getElementById('f-lifecycle').value,
    tags:     document.getElementById('f-tags').value.split(',').map(t=>t.trim()).filter(Boolean),
    logins:   parseInt(document.getElementById('f-logins').value)     || 0,
    adoption: parseInt(document.getElementById('f-adoption').value)   || 0,
    tickets:  parseInt(document.getElementById('f-tickets').value)    || 0,
    nps:      document.getElementById('f-nps').value,
    days:         parseInt(document.getElementById('f-days').value)   || 0,
    renewal_date: document.getElementById('f-renewal-date')?.value || '',
    renewal:      (function() {
      const d = document.getElementById('f-renewal-date')?.value;
      if (!d) return 0;
      const ms = new Date(d) - new Date();
      return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24 * 30.44)));
    })(),
    growth:   document.getElementById('f-growth').value,
    note:     document.getElementById('f-note').value.trim(),
    profile:  (document.getElementById('f-profile')?.value || '')
  };
}

function submitForm(e) {
  e.preventDefault();
  const data = getFormData();

  // ── Account limit check ───────────────────────────────────
  const editId = document.getElementById('score-form').dataset.editId;
  if (!editId) {
    // Only check limits for NEW customers, not re-scores
    const dupe = customers.find(c => c.name.toLowerCase() === data.name?.toLowerCase());
    if (!dupe) {
      const limit = getPlanLimit('accounts');
      if (limit !== Infinity && customers.length >= limit) {
        toast(`Account limit reached (${limit}). Upgrade your plan to add more.`, 'error');
        return;
      }
    }
  }

  // ── Validation ──────────────────────────────────────────────
  if (!data.name) { toast('Customer name is required', 'error'); return; }
  if (data.mrr < 0)       { toast('MRR cannot be negative', 'error'); return; }
  if (data.logins < 0 || data.logins > 30)   { toast('Logins must be between 0 and 30', 'error'); return; }
  if (data.adoption < 0 || data.adoption > 100){ toast('Adoption must be between 0% and 100%', 'error'); return; }
  if (data.tickets < 0)   { toast('Tickets cannot be negative', 'error'); return; }
  if (data.days < 0)      { toast('Days since contact cannot be negative', 'error'); return; }

  // Resolve weights: per-customer profile overrides global weights
  const matchedProfile = data.profile ? profiles.find(p => p.name === data.profile) : null;
  const resolvedWeights = matchedProfile ? matchedProfile.weights : weights;

  const { score, signals } = calcScore(data, resolvedWeights);
  const status = getStatus(score);
  const rec    = makeRec(score, data);
  const plays  = buildPlaybook(score, data);

  pendingResult = { data, score, signals, status, rec, plays };
  showResult(pendingResult);
}

function showResult({ data, score, signals, status, rec, plays }) {
  document.getElementById('result-placeholder').style.display = 'none';
  const card = document.getElementById('result-card');
  card.style.display = 'block';

  // Score ring
  document.getElementById('score-num').textContent = score;
  const circ = 2 * Math.PI * 58;
  const fill = document.getElementById('ring-fill');
  fill.style.stroke           = STATUS_COLOR[status] || '#16a34a';
  fill.style.strokeDasharray  = circ;
  fill.style.strokeDashoffset = circ - (score / 100) * circ;

  // Badge
  const badgeEl = document.getElementById('score-badge');
  badgeEl.className   = 'badge badge-' + (STATUS_CSS[status] || 'healthy');
  badgeEl.textContent = STATUS_LABEL[status] || 'Healthy';

  // Rec
  document.getElementById('score-rec').innerHTML = rec;

  // Breakdown
  const bd = document.getElementById('breakdown-wrap');
  const signalDefs = [
    { key:'logins_n',   label:'Login Frequency',    color:'var(--blue)' },
    { key:'adoption_n', label:'Feature Adoption',   color:'var(--green)' },
    { key:'tickets_n',  label:'Support Health',     color:'var(--red)' },
    { key:'nps_n',      label:'NPS / CSAT',         color:'var(--purple)' },
    { key:'days_n',     label:'Contact Recency',    color:'var(--teal)' },
    { key:'growth_n',   label:'Growth Signal',      color:'var(--green)' }
  ];
  bd.innerHTML = signalDefs.map(s => `
    <div class="bd-row">
      <div class="bd-label">${s.label}</div>
      <div class="bd-bar"><div class="bd-fill" style="width:${Math.round(signals[s.key])}%;background:${s.color}"></div></div>
      <div class="bd-score">${Math.round(signals[s.key])}</div>
    </div>`).join('');

  // Playbook
  const pw = document.getElementById('playbook-wrap');
  const playTypeMap = { urgent:'U', engage:'E', coach:'C', adopt:'A', support:'S', expand:'X', renew:'R', ok:'OK' };
  const playClsMap  = { urgent:'play-urgent', engage:'play-engage', coach:'play-coach', adopt:'play-adopt', support:'play-support', expand:'play-expand', renew:'play-renew', ok:'play-ok' };
  pw.innerHTML = `<div class="playbook-title">Recommended Playbook</div>` +
    plays.map(p => `<div class="play-item"><div class="play-item__icon ${playClsMap[p.type]||''}">${playTypeMap[p.type]||'!'}</div><div class="play-item__text">${p.text}</div></div>`).join('');
}

// Store raw signals snapshot in history entry so we can diff later
function buildHistorySnapshot(data) {
  return {
    logins:    data.logins    ?? null,
    adoption:  data.adoption  ?? null,
    tickets:   data.tickets   ?? null,
    nps:       data.nps       ?? null,
    days:      data.days      ?? null,
    growth:    data.growth    ?? null,
    lifecycle: data.lifecycle ?? null,
  };
}

// Given two snapshots (current, previous), return array of change descriptions
function diffSnapshots(curr, prev) {
  if (!curr) return [];
  const parts = [];

  // Login frequency
  if (curr.logins != null) {
    if (!prev || prev.logins == null) {
      parts.push(`Login frequency: ${curr.logins}/mo`);
    } else if (curr.logins !== prev.logins) {
      const dir = curr.logins > prev.logins ? '↑' : '↓';
      parts.push(`Login frequency ${dir}: ${prev.logins}→${curr.logins}/mo`);
    }
  }

  // Feature adoption
  if (curr.adoption != null) {
    if (!prev || prev.adoption == null) {
      parts.push(`Adoption: ${curr.adoption}%`);
    } else if (curr.adoption !== prev.adoption) {
      const dir = curr.adoption > prev.adoption ? '↑' : '↓';
      parts.push(`Adoption ${dir}: ${prev.adoption}%→${curr.adoption}%`);
    }
  }

  // Support tickets
  if (curr.tickets != null) {
    if (!prev || prev.tickets == null) {
      parts.push(`Support tickets: ${curr.tickets}`);
    } else if (curr.tickets !== prev.tickets) {
      const dir = curr.tickets < prev.tickets ? '↑' : '↓'; // fewer = better
      parts.push(`Support tickets ${dir}: ${prev.tickets}→${curr.tickets}`);
    }
  }

  // NPS
  if (curr.nps != null) {
    if (!prev || prev.nps == null) {
      parts.push(`NPS: ${curr.nps}`);
    } else if (curr.nps !== prev.nps) {
      parts.push(`NPS changed: ${prev.nps}→${curr.nps}`);
    }
  }

  // Days since contact
  if (curr.days != null) {
    if (!prev || prev.days == null) {
      parts.push(`Last contact: ${curr.days}d ago`);
    } else if (curr.days !== prev.days) {
      const dir = curr.days < prev.days ? '↑' : '↓'; // fewer days = better
      parts.push(`Last contact ${dir}: ${prev.days}d→${curr.days}d ago`);
    }
  }

  // Growth signal
  if (curr.growth != null) {
    if (!prev || prev.growth == null) {
      parts.push(`Growth: ${curr.growth}`);
    } else if (curr.growth !== prev.growth) {
      parts.push(`Growth changed: ${prev.growth}→${curr.growth}`);
    }
  }

  // Lifecycle stage
  if (curr.lifecycle != null) {
    if (!prev || prev.lifecycle == null) {
      parts.push(`Stage: ${curr.lifecycle}`);
    } else if (curr.lifecycle !== prev.lifecycle) {
      parts.push(`Stage changed: ${prev.lifecycle}→${curr.lifecycle}`);
    }
  }

  return parts;
}

function saveScore() {
  if (!pendingResult) return;
  const { data, score, status } = pendingResult;

  // Duplicate detection
  const dupe = customers.find(c => c.name.toLowerCase() === data.name.toLowerCase());
  if (dupe) {
    confirmAction(
      `"${data.name}" already exists. Update their score with these new values?`,
      () => {
        dupe.score           = score;
        dupe.status          = status;
        dupe.logins          = data.logins;
        dupe.adoption        = data.adoption;
        dupe.tickets         = data.tickets;
        dupe.nps             = data.nps;
        dupe.days            = data.days;
        dupe._baseDays       = data.days;
        dupe.renewal         = data.renewal;
        dupe.renewal_date    = data.renewal_date || '';
        dupe.growth          = data.growth;
        dupe.mrr             = data.mrr;
        dupe.arr             = data.arr || (data.mrr * 12);
        dupe.since           = data.since || '';
        dupe.tier            = data.tier;
        dupe.lifecycle       = data.lifecycle;
        dupe.tags            = data.tags;
        dupe.scoring_profile = data.profile || '';
        if (data.note) {
          dupe.notes = dupe.notes || [];
          dupe.notes.unshift({ text: data.note, date: new Date().toISOString() });
        }
        dupe.history  = dupe.history || [];
        dupe.history.push({ score, date: new Date().toISOString(), signals: buildHistorySnapshot(data) });
        setLoading(true);
        save(dupe).then(() => { setLoading(false); toast('Score updated for ' + dupe.name, 'success'); })
                  .catch(() => { setLoading(false); toast('Updated locally — sync failed', 'warn'); });
        logAudit('customer_scored', dupe.id, dupe.name, { score, status, summary: `Re-scored → ${score}/100 (${status}), MRR: $${dupe.mrr}, Tier: ${dupe.tier}` });
        pendingResult = null;
        resetForm();
        nav('customers');
      }
    );
    return;
  }

  const cust = {
    id:              crypto.randomUUID(),
    name:            data.name,
    manager:         data.manager || '',
    scoring_profile: data.profile || '',
    mrr:             data.mrr,
    arr:             data.arr || (data.mrr * 12),
    since:           data.since || '',
    tier:            data.tier,
    lifecycle:       data.lifecycle,
    tags:            data.tags,
    logins:          data.logins,
    adoption:        data.adoption,
    tickets:         data.tickets,
    nps:             data.nps,
    days:            data.days,
    _baseDays:       data.days,
    renewal:         data.renewal,
    renewal_date:    data.renewal_date || '',
    growth:          data.growth,
    score,
    status,
    notes:    data.note ? [{ text: data.note, date: new Date().toISOString() }] : [],
    history:  [{ score, date: new Date().toISOString(), signals: buildHistorySnapshot(data) }],
    created:  new Date().toISOString()
  };
  customers.unshift(cust);
  refreshMgrDropdown();
  setLoading(true);
  save(cust).then(() => {
    setLoading(false);
    toast('Saved: ' + cust.name, 'success');
  }).catch(() => {
    setLoading(false);
    toast('Saved locally — sync failed, check connection', 'warn');
  });
  logAudit('customer_created', cust.id, cust.name, { score, status, summary: `New customer — Score: ${score}/100 (${status}), MRR: $${cust.mrr}, Tier: ${cust.tier}, Lifecycle: ${cust.lifecycle}` });
  pendingResult = null;
  resetForm();
  nav('dashboard');
}

function resetForm() {
  document.getElementById('score-form').reset();
  document.getElementById('rv-logins').textContent   = '10 days';
  document.getElementById('rv-adoption').textContent = '50%';
  document.getElementById('rv-days').textContent     = '14 days';
  document.getElementById('f-logins').value   = 10;
  document.getElementById('f-adoption').value = 50;
  document.getElementById('f-days').value     = 14;
  document.getElementById('result-card').style.display        = 'none';
  document.getElementById('result-placeholder').style.display = 'block';
  document.getElementById('form-title').textContent = 'Score a Customer';
  pendingResult = null;
  document.getElementById('score-form').dataset.editId = '';
}

function printReport() {
  if (!pendingResult) return;
  const { data, score, status, rec, plays } = pendingResult;
  const pa = document.getElementById('print-area');
  pa.style.display = 'block';
  pa.innerHTML = buildPrintHTML(data.name, score, status, rec, plays, data);
  window.print();
  setTimeout(() => { pa.style.display = 'none'; pa.innerHTML = ''; }, 1000);
}

function printCustomerReport() {
  if (!detailId) return;
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  logAudit('report_printed', c.id, c.name, { summary: `Report printed — Score: ${c.score}, Status: ${c.status}` });
  const rec   = makeRec(c.score, c);
  const plays = buildPlaybook(c.score, c);
  const pa    = document.getElementById('print-area');
  pa.style.display = 'block';
  pa.innerHTML = buildPrintHTML(c.name, c.score, c.status, rec, plays, c);
  window.print();
  setTimeout(() => { pa.style.display = 'none'; pa.innerHTML = ''; }, 1000);
}

function buildPrintHTML(name, score, status, rec, plays, data) {
  const labels = STATUS_LABEL;
  const colors = STATUS_COLOR;
  return `
    <style>
      body{font-family:system-ui,sans-serif;color:#0f172a;padding:32px;max-width:800px;margin:0 auto}
      h1{font-size:1.6rem;font-weight:800;margin-bottom:4px}
      h2{font-size:1.1rem;font-weight:700;margin:20px 0 8px}
      .score-big{font-size:4rem;font-weight:900;color:${colors[status]};line-height:1}
      .badge{display:inline-block;background:${colors[status]}22;color:${colors[status]};padding:4px 14px;border-radius:100px;font-weight:700;font-size:.88rem;border:1.5px solid ${colors[status]}55}
      .rec{background:#f1f5f9;border-left:4px solid ${colors[status]};padding:10px 14px;border-radius:4px;font-size:.88rem;line-height:1.6;margin-bottom:16px}
      .play{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:.84rem}
      table{width:100%;border-collapse:collapse;font-size:.82rem;margin-top:8px}
      th{text-align:left;color:#64748b;font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid #e2e8f0;padding:5px 8px}
      td{padding:6px 8px;border-bottom:1px solid #f1f5f9}
      .footer-p{margin-top:32px;font-size:.7rem;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
    </style>
    <h1>IQcadence Health Report — ${name}</h1>
    <p style="color:#64748b;font-size:.82rem">Generated ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} · IQcadence CS Health Score</p>
    <div style="margin:16px 0;display:flex;align-items:center;gap:20px;flex-wrap:wrap">
      <div class="score-big">${score}</div>
      <div>
        <div class="badge">${labels[status]}</div>
        <div style="margin-top:6px;font-size:.8rem;color:#64748b">MRR: $${(data.mrr||0).toLocaleString()} · Tier: ${(data.tier||'').toUpperCase()} · Stage: ${data.lifecycle||'—'}</div>
      </div>
    </div>
    <div class="rec">${rec.replace(/<[^>]+>/g,'')}</div>
    <h2>Signal Inputs</h2>
    <table>
      <tr><th>Signal</th><th>Value</th></tr>
      <tr><td>Login Frequency (30d)</td><td>${data.logins} days</td></tr>
      <tr><td>Feature Adoption</td><td>${data.adoption}%</td></tr>
      <tr><td>Open Support Tickets</td><td>${data.tickets}</td></tr>
      <tr><td>NPS / CSAT</td><td>${data.nps}</td></tr>
      <tr><td>Days Since Contact</td><td>${data.days}</td></tr>
      <tr><td>Growth Signal</td><td>${data.growth}</td></tr>
      <tr><td>Renewal Date</td><td>${data.renewal_date ? new Date(data.renewal_date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) + ' (' + data.renewal + ' mo)' : '—'}</td></tr>
    </table>
    <h2>Recommended Playbook</h2>
    ${plays.map(p=>`<div class="play">${p.icon} ${p.text.replace(/<[^>]+>/g,'')}</div>`).join('')}
    <p class="footer-p">Built with CS Health Score by IQcadence · All data is private and stored locally</p>
  `;
}

// ─── DASHBOARD ──────────────────────────────────────────────
function renderDashboard() { try { _renderDashboard(); } catch(e) { console.error('renderDashboard error:', e); } }
function _renderDashboard() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  // 5-band grouping
  const critical= active.filter(c => c.status === 'critical');
  const risk    = active.filter(c => c.status === 'risk');
  const watch   = active.filter(c => c.status === 'watch');
  const healthy = active.filter(c => c.status === 'healthy');
  const expand  = active.filter(c => c.status === 'expand');
  const total   = active.length;
  const avg     = total ? Math.round(active.reduce((s,c)=>s+c.score,0)/total) : null;
  const totalMRR= active.reduce((s,c)=>s+(c.mrr||0),0);
  const atRiskAll = [...critical, ...risk]; // combined "at risk" for KPI card 2

  // ── Hidden compat spans ──
  el('kpi-risk').textContent    = risk.length + critical.length;
  el('kpi-healthy').textContent = healthy.length;
  el('kpi-expand').textContent  = expand.length;
  el('kpi-avg').textContent     = avg !== null ? avg : '—';
  el('kpi-mrr').textContent     = '$' + fmtNum(totalMRR);

  const riskMRR = atRiskAll.reduce((s,c)=>s+(c.mrr||0),0);
  el('kpi-risk-mrr').textContent = riskMRR ? `$${fmtNum(riskMRR)} MRR at risk` : '';

  // ── KPI Card: Total MRR ──
  if (el('kpi-total-mrr'))    el('kpi-total-mrr').textContent    = '$' + fmtNum(totalMRR);
  if (el('kpi-avg-score-pill')) el('kpi-avg-score-pill').textContent = avg !== null ? `Avg score ${avg}` : 'Avg score —';

  // ── KPI Card 1: Book Health — 5-segment bar ──
  el('kpi-total').textContent = total;
  ['critical','risk','watch','healthy','expand'].forEach(st => {
    const seg = el('hbar-' + st);
    const grp = active.filter(c => c.status === st);
    if (seg) seg.style.width = total ? (grp.length / total * 100).toFixed(1) + '%' : '0%';
  });
  el('kpi-risk-pct').textContent    = (critical.length + risk.length) + ' At Risk';
  if (el('kpi-watch-pct'))   el('kpi-watch-pct').textContent   = watch.length   + ' Watch';
  el('kpi-healthy-pct').textContent = healthy.length + ' Healthy';
  el('kpi-expand-pct').textContent  = expand.length  + ' Expansion';

  // ── KPI Card 2: Revenue at Risk (critical + risk combined) ──
  el('kpi-risk-mrr-big').textContent = '$' + fmtNum(riskMRR);
  el('kpi-risk-count').textContent   = atRiskAll.length + (atRiskAll.length === 1 ? ' account' : ' accounts');

  // ── KPI Card 3: Renewals ──
  const renewSoon = active.filter(c => c.renewal != null && c.renewal >= 0 && c.renewal <= 1);
  const renewMRR  = renewSoon.reduce((s,c)=>s+(c.mrr||0),0);
  el('kpi-renewals').textContent     = renewSoon.length;
  const renewPill = el('kpi-renewals-mrr');
  if (renewPill) renewPill.textContent = renewMRR ? '$' + fmtNum(renewMRR) + ' at stake' : 'None due';

  // ── KPI Card 4: Expansion ──
  const expMRR  = expand.reduce((s,c)=>s+(c.mrr||0),0);
  el('exp-arpu').textContent  = '$' + fmtNum(Math.round(expMRR * 0.2));
  el('exp-count').textContent = expand.length + (expand.length === 1 ? ' account ready' : ' accounts ready');
  el('exp-mrr').textContent   = '$' + fmtNum(expMRR);

  // ── Alert badge (sidebar nav + topbar bell) ──
  const alertCount = buildAlerts().filter(a => !isSnoozed(a.id)).length;
  const ab = el('alert-badge');
  if (ab) { if (alertCount > 0) { ab.textContent = alertCount; ab.style.display = ''; } else ab.style.display = 'none'; }
  const bb2 = el('bell-badge');
  if (bb2) { if (alertCount > 0) { bb2.textContent = alertCount; bb2.style.display = ''; } else bb2.style.display = 'none'; }

  // ── Render sub-sections ──
  renderDonut(critical.length, risk.length, watch.length, healthy.length, expand.length, total);
  renderDistChart(active);
  renderMrrChart(critical, risk, watch, healthy, expand);
  renderSegChart(active);
  renderHeatmap(active);
  renderRecent(active);
  renderWins(active);
  renderDrops(active);

  // Gated dashboard widgets
  const rpWrap = el('renewal-pipeline-wrap');
  if (rpWrap) { if (hasFeature('renewal_pipeline')) renderRenewalPipeline(active); else rpWrap.innerHTML = upgradeHTML('renewal_pipeline'); }
  renderSegCards(active);
  renderDashAlerts();
  const plWrap = el('priority-table-wrap');
  if (plWrap) { if (hasFeature('priority_list')) renderPriorityList(); else plWrap.innerHTML = upgradeHTML('priority_list'); }
}

// ─── SEGMENT CARDS ───────────────────────────────────────────
function renderSegCards(active) {
  const wrap = el('seg-cards');
  if (!wrap) return;

  const tiers = [
    { key:'smb',        label:'SMB',         cls:'smb', color:'#7c3aed' },
    { key:'mid',        label:'Mid-Market',  cls:'mid', color:'#2563eb' },
    { key:'enterprise', label:'Enterprise',  cls:'ent', color:'#0891b2' },
  ];

  wrap.innerHTML = tiers.map(t => {
    const accs   = active.filter(c => c.tier === t.key);
    const count  = accs.length;
    if (!count) return `
      <div class="seg-card ${t.cls}" onclick="nav('customers');setFilter('all')">
        <div class="seg-card__label">${t.label}</div>
        <div class="seg-card__num">0</div>
        <div class="seg-card__sub">No accounts</div>
      </div>`;

    const totalMRR = accs.reduce((s,c) => s + (c.mrr||0), 0);
    const avgScore = Math.round(accs.reduce((s,c) => s + c.score, 0) / count);
    const atRisk   = accs.filter(c => c.status === 'critical' || c.status === 'risk').length;
    const expand   = accs.filter(c => c.status === 'expand').length;

    // Mini health bar counts
    const bands = ['critical','risk','watch','healthy','expand'];
    const bandColors = { critical:'#dc2626', risk:'#ea580c', watch:'#d97706', healthy:'#16a34a', expand:'#0891b2' };
    const healthBar = bands.map(st => {
      const n = accs.filter(c => c.status === st).length;
      const w = count ? (n/count*100).toFixed(1) : 0;
      return `<div class="seg-health-seg" style="width:${w}%;background:${bandColors[st]};min-width:${n?2:0}px"></div>`;
    }).join('');

    // Score color
    const scoreColor = avgScore >= 80 ? '#0891b2' : avgScore >= 65 ? '#16a34a' : avgScore >= 50 ? '#d97706' : avgScore >= 25 ? '#ea580c' : '#dc2626';

    return `
      <div class="seg-card ${t.cls}" onclick="filterByTier('${t.key}')">
        <div class="seg-card__label">${t.label}</div>
        <div style="display:flex;align-items:flex-end;gap:10px">
          <div>
            <div class="seg-card__num">${count}</div>
            <div class="seg-card__sub">${count === 1 ? 'account' : 'accounts'}</div>
          </div>
          <div style="margin-bottom:4px;font-size:1.3rem;font-weight:800;color:${scoreColor}">${avgScore}</div>
          <div style="margin-bottom:4px;font-size:.65rem;color:var(--muted)">avg score</div>
        </div>
        <div class="seg-health-bar">${healthBar}</div>
        <div class="seg-card__divider"></div>
        <div class="seg-card__row">
          <span class="seg-card__row-label">Total MRR</span>
          <span class="seg-card__row-val">$${fmtNum(totalMRR)}</span>
        </div>
        <div class="seg-card__row">
          <span class="seg-card__row-label">At Risk</span>
          <span class="seg-card__row-val" style="color:${atRisk ? '#ea580c' : 'var(--muted)'}">${atRisk} ${atRisk === 1 ? 'account' : 'accounts'}</span>
        </div>
        <div class="seg-card__row">
          <span class="seg-card__row-label">Expansion</span>
          <span class="seg-card__row-val" style="color:${expand ? '#0891b2' : 'var(--muted)'}">${expand} ${expand === 1 ? 'account' : 'accounts'}</span>
        </div>
      </div>`;
  }).join('');
}

function filterByTier(tier) {
  // Navigate to customers and filter by tier
  nav('customers');
  // Set a tier filter using the existing search box as a fallback,
  // or just show all and let them see it — best UX is to filter the list
  filterMode = 'all';
  const search = el('search-input');
  if (search) { search.value = ''; }
  // Filter customers by tier directly
  const tbody = el('cust-tbody');
  if (!tbody) return;
  // Re-render with tier filter applied via a temporary override
  _filterTier = tier;
  renderCustomers();
  _filterTier = null;
}

// Tier filter override (set temporarily by filterByTier)
let _filterTier = null;

// ─── DASHBOARD ALERTS SIDEBAR ────────────────────────────────
function renderDashAlerts() {
  const wrap = el('dash-alerts-wrap');
  if (!wrap) return;
  const alerts = buildAlerts().filter(a => !isSnoozed(a.id) && !dismissed.has(a.id)).slice(0, 5);
  if (!alerts.length) {
    wrap.innerHTML = '<div style="font-size:.78rem;color:var(--muted);padding:6px 0;text-align:center">All clear — no active alerts</div>';
    return;
  }
  wrap.innerHTML = alerts.map(a => {
    const def = ALERT_CATS[a.cat] || ALERT_CATS.health;
    const cust = customers.find(x => x.id === a.cid);
    return `
    <div class="dash-alert-item ${a.type}" onclick="openDetail('${a.cid}')">
      <div class="dash-alert-item__icon">${def.icon}</div>
      <div class="dash-alert-item__body">
        <div class="dash-alert-item__text"><strong>${escHtml(cust?.name||'')}</strong> — ${def.label}</div>
        <div class="dash-alert-item__sub">${escHtml(a.sub||'')}</div>
      </div>
      <button class="btn btn-xs btn-ghost" style="flex-shrink:0;padding:2px 7px;font-size:.66rem" onclick="event.stopPropagation();openDetail('${a.cid}')">→</button>
    </div>`;
  }).join('') + `<div style="margin-top:8px;text-align:center"><button class="btn btn-xs btn-ghost" onclick="nav('alerts')" style="font-size:.72rem;color:var(--muted)">See all ${buildAlerts().filter(a=>!isSnoozed(a.id)&&!dismissed.has(a.id)).length} alerts →</button></div>`;
}

function el(id) { return document.getElementById(id); }
function fmtNum(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
  return n.toLocaleString();
}

// Donut chart — 5 bands
function renderDonut(nCrit, nRisk, nWatch, nHealthy, nExpand, total) {
  const circ = 2 * Math.PI * 46;
  const arc = n => total ? (n / total) * circ : 0;

  const bands = [
    { id:'dn-critical', n:nCrit,    color:'#dc2626' },
    { id:'dn-risk',     n:nRisk,    color:'#ea580c' },
    { id:'dn-watch',    n:nWatch,   color:'#d97706' },
    { id:'dn-healthy',  n:nHealthy, color:'#16a34a' },
    { id:'dn-expand',   n:nExpand,  color:'#0891b2' },
  ];

  let offset = 0;
  bands.forEach(b => {
    const a = arc(b.n);
    const el = document.getElementById(b.id);
    if (!el) return;
    el.style.stroke           = b.color;
    el.style.strokeDasharray  = `${a} ${circ - a}`;
    el.style.strokeDashoffset = circ - offset;
    el.style.transform        = 'rotate(-90deg)';
    el.style.transformOrigin  = 'center';
    offset += a;
  });

  document.getElementById('dn-num').textContent         = total;
  document.getElementById('leg-critical').textContent   = nCrit;
  document.getElementById('leg-risk').textContent       = nRisk;
  document.getElementById('leg-watch').textContent      = nWatch;
  document.getElementById('leg-healthy').textContent    = nHealthy;
  document.getElementById('leg-expand').textContent     = nExpand;
}

// Score distribution bar chart
function renderDistChart(active) {
  const buckets = [
    { label:'0–24',  min:0,  max:24,  color:'#dc2626' },  // Critical — red
    { label:'25–49', min:25, max:49,  color:'#ea580c' },  // At Risk  — orange
    { label:'50–64', min:50, max:64,  color:'#d97706' },  // Watch    — amber
    { label:'65–79', min:65, max:79,  color:'#16a34a' },  // Healthy  — green
    { label:'80–100',min:80, max:100, color:'#0891b2' },  // Expansion — teal
  ];
  const counts = buckets.map(b => ({
    ...b,
    count: active.filter(c => c.score >= b.min && c.score <= b.max).length
  }));
  const max = Math.max(...counts.map(b=>b.count), 1);
  el('dist-chart').innerHTML = counts.map(b => `
    <div class="bar-row">
      <div class="bar-row__label">${b.label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(b.count/max)*100}%;background:${b.color}">
          ${b.count > 0 ? `<span class="bar-fill-lbl">${b.count}</span>` : ''}
        </div>
      </div>
      <div class="bar-row__val">${b.count}</div>
    </div>`).join('');
}

// MRR by status bar chart — 5 bands
function renderMrrChart(critical, risk, watch, healthy, expand) {
  const mrr = arr => arr.reduce((s,c)=>s+(c.mrr||0),0);
  const rows = [
    { label:'Critical',  val:mrr(critical), color:'#dc2626' },
    { label:'At Risk',   val:mrr(risk),     color:'#ea580c' },
    { label:'Watch',     val:mrr(watch),    color:'#d97706' },
    { label:'Healthy',   val:mrr(healthy),  color:'#16a34a' },
    { label:'Expansion', val:mrr(expand),   color:'#0891b2' },
  ];
  const maxV = Math.max(...rows.map(r=>r.val), 1);
  el('mrr-chart').innerHTML = rows.map(r => `
    <div class="bar-row">
      <div class="bar-row__label">${r.label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(r.val/maxV)*100}%;background:${r.color}">
          ${r.val > 0 ? `<span class="bar-fill-lbl">$${fmtNum(r.val)}</span>` : ''}
        </div>
      </div>
      <div class="bar-row__val">$${fmtNum(r.val)}</div>
    </div>`).join('');
}

// Segment avg score bar chart
function renderSegChart(active) {
  const segs = ['smb','mid','enterprise'];
  const segLabels = { smb:'SMB', mid:'Mid-Market', enterprise:'Enterprise' };
  const segColors = { smb:'#2563eb', mid:'#7c3aed', enterprise:'#0891b2' };
  const rows = segs.map(s => {
    const group = active.filter(c => c.tier === s);
    const avg   = group.length ? Math.round(group.reduce((a,c)=>a+c.score,0)/group.length) : null;
    return { label: segLabels[s], avg, count: group.length, color: segColors[s] };
  }).filter(r => r.count > 0);

  if (!rows.length) {
    el('seg-chart').innerHTML = '<div style="color:var(--subtle);font-size:.78rem;padding:12px 0">No customers yet</div>';
    return;
  }
  el('seg-chart').innerHTML = rows.map(r => `
    <div class="bar-row">
      <div class="bar-row__label">${r.label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${r.avg}%;background:${r.color}">
          ${r.avg >= 20 ? `<span class="bar-fill-lbl">${r.avg}</span>` : ''}
        </div>
      </div>
      <div class="bar-row__val">${r.avg}<span style="font-size:.66rem;color:var(--muted);margin-left:3px">(${r.count})</span></div>
    </div>`).join('');
}

// Signal heatmap
function dashHeatSortBy(key) {
  if (dashHeatSort.key === key) dashHeatSort.dir *= -1;
  else { dashHeatSort.key = key; dashHeatSort.dir = key === 'name' ? 1 : -1; }
  renderHeatmap(customers.filter(c => c.lifecycle !== 'churned'));
}

function renderHeatmap(active) {
  const wrap = el('heatmap-wrap');
  if (!active.length) {
    wrap.innerHTML = '<div style="color:var(--subtle);font-size:.8rem;padding:16px 0;text-align:center">No customers yet</div>';
    return;
  }

  // Sort
  const npsOrder = { promoter:3, passive:2, unknown:1, detractor:0 };
  const growOrder = { strong:2, mild:1, none:0 };
  const sorted = [...active].sort((a, b) => {
    let av, bv;
    switch (dashHeatSort.key) {
      case 'name':    av = a.name;     bv = b.name;     break;
      case 'score':   av = a.score;    bv = b.score;    break;
      case 'logins':  av = a.logins;   bv = b.logins;   break;
      case 'adoption':av = a.adoption; bv = b.adoption; break;
      case 'tickets': av = a.tickets;  bv = b.tickets;  break;
      case 'nps':     av = npsOrder[a.nps]||0; bv = npsOrder[b.nps]||0; break;
      case 'days':    av = a.days;     bv = b.days;     break;
      case 'growth':  av = growOrder[a.growth]||0; bv = growOrder[b.growth]||0; break;
      default:        av = a.score;    bv = b.score;
    }
    if (typeof av === 'string') return av.localeCompare(bv) * dashHeatSort.dir;
    return (av - bv) * dashHeatSort.dir;
  }).slice(0, 15);

  const hmColor = (v, inv) => {
    const n = inv ? 100 - v : v;
    if (n < 50) return 'hm-r';
    if (n < 80) return 'hm-y';
    return 'hm-g';
  };

  // Header helper — shows sort arrow on active column
  const thHeat = (key, label) => {
    const isActive = dashHeatSort.key === key;
    const arrow    = isActive ? (dashHeatSort.dir === 1 ? ' ↑' : ' ↓') : '';
    return `<th onclick="dashHeatSortBy('${key}')" style="cursor:pointer;user-select:none;${isActive?'color:var(--blue)':''}" title="Sort by ${label}">${label}${arrow}</th>`;
  };

  wrap.innerHTML = `<table>
    <thead><tr>
      ${thHeat('name',    'Customer')}
      ${thHeat('score',   'Score')}
      ${thHeat('logins',  'Logins')}
      ${thHeat('adoption','Adoption')}
      ${thHeat('tickets', 'Tickets')}
      ${thHeat('nps',     'NPS')}
      ${thHeat('days',    'Last Cont.')}
      ${thHeat('growth',  'Growth')}
    </tr></thead>
    <tbody>${sorted.map(c => {
      const loginPct  = Math.round((c.logins/30)*100);
      const ticketPct = Math.max(0,100-c.tickets*20);
      const npsPct    = {unknown:50,detractor:0,passive:65,promoter:100}[c.nps]||50;
      const daysPct   = Math.max(0,100-(c.days/180)*100);
      const growPct   = {none:25,mild:65,strong:100}[c.growth]||25;
      return `<tr>
        <td class="nc" style="cursor:pointer" onclick="openDetail('${c.id}')">${c.name}</td>
        <td class="${hmColor(c.score,false)}">${c.score}</td>
        <td class="${hmColor(loginPct,false)}">${c.logins}d</td>
        <td class="${hmColor(c.adoption,false)}">${c.adoption}%</td>
        <td class="${hmColor(ticketPct,false)}">${c.tickets}</td>
        <td class="${hmColor(npsPct,false)}">${c.nps}</td>
        <td class="${hmColor(daysPct,false)}">${c.days}d</td>
        <td class="${hmColor(growPct,false)}">${c.growth}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

// Recent table
function dashRecentSortBy(key) {
  if (dashRecentSort.key === key) dashRecentSort.dir *= -1;
  else {
    dashRecentSort.key = key;
    // Default direction: name → asc, everything else → desc
    dashRecentSort.dir = key === 'name' ? 1 : -1;
  }
  renderRecent(customers.filter(c => c.lifecycle !== 'churned'));
}

function renderRecent(active) {
  const wrap = el('recent-wrap');
  if (!wrap) return;
  if (!active.length) {
    wrap.innerHTML = '<div style="font-size:.78rem;color:var(--muted);padding:6px 0;text-align:center">No customers yet</div>';
    return;
  }
  // Show most recently scored (by created date), top 5
  const sorted = [...active]
    .sort((a,b) => new Date(b.created||0) - new Date(a.created||0))
    .slice(0, 5);

  wrap.innerHTML = sorted.map(c => `
    <div class="dash-recent-item" onclick="openDetail('${c.id}')">
      ${scoreHTML(c)}
      <span class="dash-recent-name">${escHtml(c.name)}</span>
      <span class="dash-recent-meta">${fmtDate(c.created)}</span>
    </div>`).join('');
}

// ─── THIS WEEK'S WINS ────────────────────────────────────────
function renderWins(active) {
  const wrap = el('wins-wrap');
  if (!wrap) return;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Find accounts with history entries in the last 7 days that improved
  const wins = [];
  active.forEach(c => {
    if (!c.history || c.history.length < 2) return;
    // Find the most recent score from the last 7 days
    const recent = [...c.history]
      .filter(h => new Date(h.date) >= weekAgo)
      .sort((a,b) => new Date(b.date) - new Date(a.date));
    if (!recent.length) return;
    // Compare to the score just before this week
    const beforeWeek = [...c.history]
      .filter(h => new Date(h.date) < weekAgo)
      .sort((a,b) => new Date(b.date) - new Date(a.date));
    const prevScore = beforeWeek.length ? beforeWeek[0].score : c.history[0].score;
    const newScore  = recent[0].score;
    const delta     = newScore - prevScore;
    if (delta > 0) wins.push({ c, delta, newScore, prevScore });
  });

  if (!wins.length) {
    wrap.innerHTML = '<div style="font-size:.78rem;color:var(--muted);padding:6px 0;text-align:center">No score improvements this week yet</div>';
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
    <div class="win-item" onclick="openDetail('${c.id}')">
      <div style="width:32px;height:32px;border-radius:50%;background:${badgeBg};border:2px solid ${badgeColor};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span style="font-size:.72rem;font-weight:800;color:${badgeColor}">${newScore}</span>
      </div>
      <div style="flex:1;min-width:0">
        <div class="win-name">${escHtml(c.name)}</div>
        <div style="font-size:.68rem;color:var(--muted)">${STATUS_LABEL[st]}</div>
      </div>
      <span class="win-delta" style="display:flex;align-items:center;gap:3px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>+${delta}</span>
    </div>`;
  }).join('') + winsSeeAll;
}

// ─── BIGGEST DROPS ───────────────────────────────────────────
function renderDrops(active) {
  const wrap = el('drops-wrap');
  if (!wrap) return;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const drops = [];
  active.forEach(c => {
    if (!c.history || c.history.length < 2) return;
    const recent = [...c.history]
      .filter(h => new Date(h.date) >= weekAgo)
      .sort((a,b) => new Date(b.date) - new Date(a.date));
    if (!recent.length) return;
    const beforeWeek = [...c.history]
      .filter(h => new Date(h.date) < weekAgo)
      .sort((a,b) => new Date(b.date) - new Date(a.date));
    const prevScore = beforeWeek.length ? beforeWeek[0].score : c.history[0].score;
    const newScore  = recent[0].score;
    const delta     = newScore - prevScore;
    if (delta < 0) drops.push({ c, delta, newScore, prevScore });
  });

  if (!drops.length) {
    wrap.innerHTML = '<div style="font-size:.78rem;color:var(--muted);padding:6px 0;text-align:center">No score drops this week</div>';
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
    <div class="win-item" onclick="openDetail('${c.id}')">
      <div style="width:32px;height:32px;border-radius:50%;background:${badgeBg};border:2px solid ${badgeColor};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span style="font-size:.72rem;font-weight:800;color:${badgeColor}">${newScore}</span>
      </div>
      <div style="flex:1;min-width:0">
        <div class="win-name">${escHtml(c.name)}</div>
        <div style="font-size:.68rem;color:var(--muted)">${STATUS_LABEL[st]}</div>
      </div>
      <span style="font-size:.75rem;font-weight:800;color:#dc2626;white-space:nowrap;display:flex;align-items:center;gap:3px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>-${Math.abs(delta)}</span>
    </div>`;
  }).join('') + dropsSeeAll;
}

// ─── ALERTS ─────────────────────────────────────────────────

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

// ─── RENEWAL PIPELINE WIDGET ─────────────────────────────────────────────────
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
    wrap.innerHTML = '<div style="color:var(--subtle);font-size:.78rem;padding:8px 0;text-align:center">No accounts have a renewal date set. Add renewal dates when editing a customer.</div>';
    return;
  }
  const rows = buckets.map(b => {
    const grp = withDate.filter(c => {
      const days = Math.round((new Date(c.renewal_date) - now) / 86400000);
      return days >= b.min && days <= b.max;
    });
    const mrr    = grp.reduce((s,c)=>s+(c.mrr||0),0);
    const atRisk = grp.filter(c=>c.status==='critical'||c.status==='risk').length;
    return { ...b, count:grp.length, mrr, atRisk };
  });
  wrap.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
    ${rows.map(r => {
      const riskBadge = r.atRisk ? `<span style="color:${r.color};font-size:.68rem;font-weight:700">⚠ ${r.atRisk} at risk</span>` : '';
      const countText = r.count ? `${r.count} acct${r.count!==1?'s':''}` : `<span style="color:var(--subtle)">—</span>`;
      return `<div style="border-left:3px solid ${r.color};background:${r.bg};border-radius:6px;padding:9px 12px">
        <div style="font-size:.65rem;font-weight:700;color:${r.color};text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">${r.label}</div>
        <div style="font-size:1.05rem;font-weight:800;color:#1e293b;margin-bottom:2px">${r.mrr ? '$'+fmtNum(r.mrr) : '—'}</div>
        <div style="font-size:.7rem;color:var(--muted);display:flex;gap:5px;align-items:center;flex-wrap:wrap">${countText}${r.atRisk?' · ':''}${riskBadge}</div>
      </div>`;
    }).join('')}
  </div>`;
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

// ─── ALERTS ─────────────────────────────────────────────────

// Category definitions — SVG icons, no emoji
const _ico = (path) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const ALERT_ICONS = {
  health:    _ico('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  renewal:   _ico('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  cadence:   _ico('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.09 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  sentiment: _ico('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  momentum:  _ico('<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>'),
  tickets:   _ico('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
  expansion: _ico('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
  snoozed:   _ico('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
};
const ALERT_CATS = {
  health:    { label:'Health',    icon: ALERT_ICONS.health,    type:'red'   },
  renewal:   { label:'Renewal',   icon: ALERT_ICONS.renewal,   type:'blue'  },
  cadence:   { label:'Cadence',   icon: ALERT_ICONS.cadence,   type:'amber' },
  sentiment: { label:'Sentiment', icon: ALERT_ICONS.sentiment, type:'amber' },
  momentum:  { label:'Momentum',  icon: ALERT_ICONS.momentum,  type:'amber' },
  tickets:   { label:'Support',   icon: ALERT_ICONS.tickets,   type:'red'   },
  expansion: { label:'Expansion', icon: ALERT_ICONS.expansion, type:'green' },
};

// Severity order for sorting (lower = higher priority)
const ALERT_SEV = { red:0, amber:1, blue:2, green:3 };

// Dismissed alerts set (persisted in settings)
let dismissed = new Set();

function buildAlerts() {
  const alerts = [];
  const now = new Date();

  // Customer display snapshot — embedded in every alert for rich rendering
  const snap = c => ({ _score:c.score, _status:c.status, _tier:c.tier, _manager:c.manager||'', _days:c.days||0 });

  customers.forEach(c => {
    if (c.lifecycle === 'churned') return;
    if (!passesManagerFilter(c)) return;

    // ── Health ──
    if (c.status === 'critical')
      alerts.push({ id:c.id+'-crit',  cid:c.id, cat:'health', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>is Critical — score ${c.score}</span>`,
        sub:`MRR $${fmtNum(c.mrr||0)}`, ...snap(c) });
    else if (c.status === 'risk')
      alerts.push({ id:c.id+'-risk',  cid:c.id, cat:'health', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>is At Risk — score ${c.score}</span>`,
        sub:`MRR $${fmtNum(c.mrr||0)}`, ...snap(c) });
    else if (c.status === 'watch')
      alerts.push({ id:c.id+'-watch', cid:c.id, cat:'health', type:'amber',
        msg:`<strong>${escHtml(c.name)}</strong> <span>in Watch zone — score ${c.score}</span>`,
        sub:`MRR $${fmtNum(c.mrr||0)}`, ...snap(c) });

    // ── Support tickets (only if tickets signal is active) ──
    if (signalOn(c,'tickets') && c.tickets >= 3)
      alerts.push({ id:c.id+'-tix', cid:c.id, cat:'tickets', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>has ${c.tickets} open support tickets</span>`,
        sub:`NPS: ${c.nps||'—'}`, ...snap(c) });

    // ── Renewal (uses renewal_date for accurate countdown) ──
    if (c.renewal_date) {
      const d = new Date(c.renewal_date);
      const days = Math.round((d - now) / 86400000);
      if (days >= 0 && days <= 60) {
        const urgency = days <= 14 ? 'red' : days <= 30 ? 'amber' : 'blue';
        const label   = days === 0 ? 'Today!' : days === 1 ? 'Tomorrow' : `${days} days`;
        alerts.push({ id:c.id+'-renew', cid:c.id, cat:'renewal', type:urgency,
          msg:`<strong>${escHtml(c.name)}</strong> <span>renews in ${label}</span>`,
          sub:`${d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} · MRR $${fmtNum(c.mrr||0)}`, ...snap(c) });
      }
    } else if (c.renewal != null && c.renewal >= 0 && c.renewal <= 2) {
      alerts.push({ id:c.id+'-renew', cid:c.id, cat:'renewal', type:'blue',
        msg:`<strong>${escHtml(c.name)}</strong> <span>renews in ${c.renewal} month${c.renewal===1?'':'s'}</span>`,
        sub:`MRR $${fmtNum(c.mrr||0)}`, ...snap(c) });
    }

    // ── Momentum ──
    if (getMomentum(c) === 'dn')
      alerts.push({ id:c.id+'-mom', cid:c.id, cat:'momentum', type:'amber',
        msg:`<strong>${escHtml(c.name)}</strong> <span>score is declining ↘</span>`,
        sub:`Score ${c.score}`, ...snap(c) });

    // ── Sentiment ──
    const sent = latestSentiment(c);
    if (sent?.val === 'negative')
      alerts.push({ id:c.id+'-sent', cid:c.id, cat:'sentiment', type:'amber',
        msg:`<strong>${escHtml(c.name)}</strong> <span>last call logged as negative</span>`,
        sub:`Sentiment: Negative`, ...snap(c) });

    // ── NPS Detractor (only if NPS signal is active) ──
    if (signalOn(c,'nps') && c.nps === 'detractor')
      alerts.push({ id:c.id+'-nps', cid:c.id, cat:'tickets', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>is an NPS Detractor</span>`,
        sub:`Score ${c.score}`, ...snap(c) });

    // ── Expansion opportunity (only if growth signal is active + no recent touch) ──
    if (signalOn(c,'growth') && (c.status === 'expand' || c.status === 'healthy') && (c.mrr||0) >= 3000) {
      const daysSince = c.days || 0;
      if (!signalOn(c,'days') || daysSince >= 30)
        alerts.push({ id:c.id+'-exp', cid:c.id, cat:'expansion', type:'green',
          msg:`<strong>${escHtml(c.name)}</strong> <span>expansion opportunity — ${daysSince}d since last touch</span>`,
          sub:`MRR $${fmtNum(c.mrr||0)} · Score ${c.score}`, ...snap(c) });
    }
  });

  // ── Cadence alerts (only if days-since-contact signal is active) ──
  // Enrich cadence alerts with customer snapshot too
  const cadAlerts = buildCadenceAlerts();
  cadAlerts.forEach(a => {
    const c = customers.find(x => x.id === a.cid);
    if (c) Object.assign(a, { _score:c.score, _status:c.status, _tier:c.tier, _manager:c.manager||'', _days:c.days||0 });
  });
  alerts.push(...cadAlerts);

  // Sort: severity first, then MRR desc
  alerts.sort((a,b) => {
    const sd = (ALERT_SEV[a.type]||9) - (ALERT_SEV[b.type]||9);
    if (sd !== 0) return sd;
    const ca = customers.find(x=>x.id===a.cid), cb = customers.find(x=>x.id===b.cid);
    return ((cb?.mrr||0) - (ca?.mrr||0));
  });

  return alerts;
}

// ─── MULTI-SELECT STATE ──────────────────────────────────────
let _selectedAlerts = new Set();
let _alertViewMode = 'category'; // 'category' | 'priority' | 'customer'

function setAlertView(mode) {
  _alertViewMode = mode;
  ['cat','pri','cust'].forEach(k => {
    const btn = el('alert-view-' + k);
    if (btn) btn.classList.toggle('active', mode === { cat:'category', pri:'priority', cust:'customer' }[k]);
  });
  const searchBox = el('alert-cust-search');
  if (searchBox) {
    searchBox.style.display = mode === 'customer' ? '' : 'none';
    if (mode !== 'customer') searchBox.value = '';
  }
  renderAlerts();
}

function alertToggleSelect(aid, el) {
  if (_selectedAlerts.has(aid)) _selectedAlerts.delete(aid);
  else _selectedAlerts.add(aid);
  _updateAlertBulkBar();
  // toggle .selected on row
  const row = document.getElementById('alert-row-'+aid);
  if (row) row.classList.toggle('selected', _selectedAlerts.has(aid));
}

function alertsSelectAll() {
  const all = buildAlerts().filter(a => !isSnoozed(a.id) && !dismissed.has(a.id));
  if (_selectedAlerts.size === all.length) {
    _selectedAlerts.clear();
  } else {
    all.forEach(a => _selectedAlerts.add(a.id));
  }
  _updateAlertBulkBar();
  _renderAlerts();
}

function alertsClearSelection() {
  _selectedAlerts.clear();
  _updateAlertBulkBar();
  _renderAlerts();
}

function _updateAlertBulkBar() {
  const bar = el('alert-bulk-bar');
  const cnt = el('alert-bulk-count');
  if (!bar) return;
  if (_selectedAlerts.size > 0) {
    bar.classList.add('visible');
    cnt.textContent = `${_selectedAlerts.size} selected`;
  } else {
    bar.classList.remove('visible');
  }
}

function toggleBulkSnoozeDd() {
  el('bulk-snooze-menu')?.classList.toggle('open');
}

function bulkSnooze(days) {
  el('bulk-snooze-menu')?.classList.remove('open');
  const expiry = Date.now() + days * 86400000;
  _selectedAlerts.forEach(aid => snoozed.set(aid, expiry));
  const n = _selectedAlerts.size;
  _selectedAlerts.clear();
  saveSettings();
  logAudit('bulk_snooze', null, '', { summary: `${n} alert${n===1?'':'s'} snoozed for ${days}d` });
  renderAlerts();
  renderDashboard();
  toast(`${n} alert${n===1?'':'s'} snoozed for ${days} day${days===1?'':'s'}`, 'default');
}

function bulkDismiss() {
  _selectedAlerts.forEach(aid => dismissed.add(aid));
  const n = _selectedAlerts.size;
  _selectedAlerts.clear();
  saveSettings();
  logAudit('bulk_dismiss', null, '', { summary: `${n} alert${n===1?'':'s'} dismissed` });
  renderAlerts();
  renderDashboard();
  toast(`${n} alert${n===1?'':'s'} dismissed`, 'default');
}

function renderAlerts() { try { _renderAlerts(); } catch(e) { console.error('renderAlerts error:', e); } }
function _renderAlerts() {
  const all    = buildAlerts();
  const active = all.filter(a => !isSnoozed(a.id) && !dismissed.has(a.id));
  const snz    = all.filter(a =>  isSnoozed(a.id));
  const list   = el('alerts-list');

  // Update sidebar badge + topbar bell badge (v86)
  const ab = el('alert-badge');
  if (ab) { if (active.length > 0) { ab.textContent = active.length; ab.style.display = ''; } else ab.style.display = 'none'; }
  const bb = el('bell-badge');
  if (bb) { if (active.length > 0) { bb.textContent = active.length; bb.style.display = ''; } else bb.style.display = 'none'; }

  _updateAlertBulkBar();

  // Show/hide view toggle bar
  const viewBar = el('alert-view-bar');
  if (viewBar) viewBar.style.display = (active.length || snz.length) ? 'flex' : 'none';

  if (!active.length && !snz.length) {
    list.innerHTML = '<div class="empty-st"><div class="ei"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div><h3>All clear!</h3><p>No alerts right now — all accounts are in good shape.</p></div>';
    renderAlertPanel(all, active, snz);
    return;
  }

  let html = '';

  if (_alertViewMode === 'priority') {
    // ── Priority view: sort all active alerts by severity then score ──
    const sevOrder = { red:0, amber:1, blue:2, green:3 };
    const sevLabels = { red:'Critical', amber:'Warning', blue:'Attention', green:'Opportunity' };
    const sevColors = { red:'#dc2626', amber:'#d97706', blue:'#2563eb', green:'#16a34a' };

    // Sort: severity first, then score ascending (worst first)
    const sorted = [...active].sort((a,b) => {
      const sd = (sevOrder[a.type]??9) - (sevOrder[b.type]??9);
      if (sd !== 0) return sd;
      return (a._score||0) - (b._score||0);
    });

    // Group by severity
    const groups = {};
    sorted.forEach(a => {
      const sev = a.type || 'amber';
      if (!groups[sev]) groups[sev] = [];
      groups[sev].push(a);
    });

    ['red','amber','blue','green'].forEach(sev => {
      const group = groups[sev];
      if (!group || !group.length) return;
      html += `<div class="alert-priority-hd"><div class="alert-priority-dot" style="background:${sevColors[sev]}"></div>${sevLabels[sev]} <span style="font-weight:400;color:var(--subtle)">(${group.length})</span></div>`;
      html += group.map(a => alertItemHTML(a, false)).join('');
    });
  } else if (_alertViewMode === 'customer') {
    // ── Customer view: group by customer, sorted by worst score ──
    const custSearch = (el('alert-cust-search')?.value || '').trim().toLowerCase();
    const custMap = {};
    active.forEach(a => {
      if (!custMap[a.cid]) custMap[a.cid] = { alerts: [], name: '', score: 100, status: '', mrr: 0 };
      custMap[a.cid].alerts.push(a);
      const c = customers.find(x => x.id === a.cid);
      if (c) {
        custMap[a.cid].name = c.name;
        custMap[a.cid].score = c.score;
        custMap[a.cid].status = c.status;
        custMap[a.cid].mrr = c.mrr || 0;
      }
    });
    // Sort customers: lowest score first, then highest MRR
    let custList = Object.entries(custMap).sort((a,b) => {
      const sd = a[1].score - b[1].score;
      if (sd !== 0) return sd;
      return b[1].mrr - a[1].mrr;
    });
    // Filter by search
    if (custSearch) {
      custList = custList.filter(([, data]) => data.name.toLowerCase().includes(custSearch));
    }
    if (custList.length) {
      custList.forEach(([cid, data]) => {
        const scoreColor = STATUS_COLOR[data.status] || '#94a3b8';
        html += `<div class="alert-group-hd" style="cursor:pointer" onclick="openDetail('${cid}')">
          <span class="alert-score-circle" style="background:${scoreColor};width:26px;height:26px;font-size:.65rem;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-weight:800">${data.score}</span>
          ${escHtml(data.name)}
          ${data.mrr ? `<span style="font-weight:400;color:var(--subtle);font-size:.75rem">$${fmtNum(data.mrr)} MRR</span>` : ''}
          <span style="font-weight:400;color:var(--subtle)">(${data.alerts.length} alert${data.alerts.length !== 1 ? 's' : ''})</span>
        </div>`;
        // Sort alerts within customer by severity
        const sevOrd = { red:0, amber:1, blue:2, green:3 };
        data.alerts.sort((a,b) => (sevOrd[a.type]??9) - (sevOrd[b.type]??9));
        html += data.alerts.map(a => alertItemHTML(a, false)).join('');
      });
    } else if (custSearch) {
      html += `<div style="text-align:center;padding:28px 16px;color:var(--muted);font-size:.85rem">No customers matching "${escHtml(custSearch)}"</div>`;
    }
  } else {
    // ── Category view (default) ──
    const cats = ['health','tickets','renewal','cadence','momentum','sentiment','expansion'];
    cats.forEach(cat => {
      const group = active.filter(a => a.cat === cat);
      if (!group.length) return;
      const def = ALERT_CATS[cat];
      html += `<div class="alert-group-hd" id="alert-grp-${cat}">${def.icon} ${def.label} <span style="font-weight:400;color:var(--subtle)">(${group.length})</span></div>`;
      html += group.map(a => alertItemHTML(a, false)).join('');
    });
  }

  // Snoozed section (shown in both views)
  if (snz.length) {
    html += `<div class="alert-group-hd" style="margin-top:20px">${ALERT_ICONS.snoozed} Snoozed <span style="font-weight:400;color:var(--subtle)">(${snz.length})</span></div>`;
    html += snz.map(a => alertItemHTML(a, true)).join('');
  }

  list.innerHTML = html;
  renderAlertPanel(all, active, snz);
}

// ─── ALERT RIGHT PANEL ───────────────────────────────────────
function renderAlertPanel(all, active, snz) {
  // KPI cells
  const critical = active.filter(a => a.cat === 'health' && a.type === 'red').length;
  const renewal  = active.filter(a => a.cat === 'renewal').length;

  function setKpi(id, val, cls) {
    const cell = el(id);
    if (!cell) return;
    cell.querySelector('.alert-kpi-val').textContent = val;
    if (cls) { cell.className = 'alert-kpi-cell ' + cls; }
  }
  setKpi('akpi-total',    active.length,                active.length > 0 ? 'red' : '');
  setKpi('akpi-critical', critical,                     critical > 0 ? 'red' : '');
  setKpi('akpi-renewal',  renewal,                      renewal > 0 ? 'blue' : '');
  setKpi('akpi-snoozed',  snz.length,                   snz.length > 0 ? 'amber' : '');

  // MRR exposure
  const mrrWrap = el('alert-mrr-wrap');
  if (mrrWrap) {
    const mrrMap = {
      'Critical/Risk':    { color:'#fca5a5', mrr:0 },
      'Watch':            { color:'#fde68a', mrr:0 },
      'Renewal ≤60d':     { color:'#93c5fd', mrr:0 },
      'No Contact 60d+':  { color:'#c4b5fd', mrr:0 },
      'Poor Sentiment':   { color:'#fda4af', mrr:0 }
    };
    // Dedupe by customer (only count each customer once per bucket)
    const seen = {};
    Object.keys(mrrMap).forEach(k => seen[k] = new Set());
    // Alert-based buckets
    active.forEach(a => {
      const c = customers.find(x => x.id === a.cid);
      if (!c) return;
      if (a.cat === 'health' && a.type === 'red' && !seen['Critical/Risk'].has(c.id)) { seen['Critical/Risk'].add(c.id); mrrMap['Critical/Risk'].mrr += c.mrr||0; }
      else if (a.cat === 'health' && a.type === 'amber' && !seen['Watch'].has(c.id)) { seen['Watch'].add(c.id); mrrMap['Watch'].mrr += c.mrr||0; }
      if (a.cat === 'renewal' && !seen['Renewal ≤60d'].has(c.id)) { seen['Renewal ≤60d'].add(c.id); mrrMap['Renewal ≤60d'].mrr += c.mrr||0; }
    });
    // Customer-based buckets: no contact 60d+, poor sentiment
    customers.filter(c => c.lifecycle !== 'churned').forEach(c => {
      if (c.days >= 60 && !seen['No Contact 60d+'].has(c.id)) { seen['No Contact 60d+'].add(c.id); mrrMap['No Contact 60d+'].mrr += c.mrr||0; }
      const sent = latestSentiment(c);
      if (sent && sent.val === 'negative' && !seen['Poor Sentiment'].has(c.id)) { seen['Poor Sentiment'].add(c.id); mrrMap['Poor Sentiment'].mrr += c.mrr||0; }
    });
    // Total uses unique customers across all buckets (no double-counting)
    const allExposed = new Set();
    Object.values(seen).forEach(s => s.forEach(id => allExposed.add(id)));
    let totalMrr = 0;
    allExposed.forEach(id => { const c = customers.find(x => x.id === id); if (c) totalMrr += c.mrr||0; });
    mrrWrap.innerHTML = Object.entries(mrrMap).map(([label, {color, mrr}]) => `
      <div class="alert-mrr-row">
        <div class="alert-mrr-dot" style="background:${color}"></div>
        <div class="alert-mrr-label">${label}</div>
        <div class="alert-mrr-val">$${fmtNum(mrr)}</div>
      </div>`).join('') +
      `<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.2);display:flex;justify-content:space-between;font-size:.75rem">
        <span style="color:rgba(255,255,255,.7);font-weight:600">Total Exposed MRR</span>
        <span style="font-weight:800;color:#fff">$${fmtNum(totalMrr)}</span>
      </div>`;
  }

  // By category bars
  const catWrap = el('alert-cat-wrap');
  if (catWrap) {
    const catOrder = ['health','tickets','renewal','cadence','momentum','sentiment','expansion'];
    const catCounts = {};
    catOrder.forEach(c => catCounts[c] = 0);
    active.forEach(a => { if (catCounts[a.cat] !== undefined) catCounts[a.cat]++; });
    const maxCount = Math.max(1, ...Object.values(catCounts));
    const catColors = { health:'#dc2626', tickets:'#ea580c', renewal:'#2563eb', cadence:'#d97706', momentum:'#d97706', sentiment:'#d97706', expansion:'#16a34a' };
    catWrap.innerHTML = catOrder.filter(c => catCounts[c] > 0).map(c => {
      const def = ALERT_CATS[c];
      const pct = Math.round((catCounts[c] / maxCount) * 100);
      return `
        <div class="alert-cat-row" onclick="document.getElementById('alert-grp-${c}')?.scrollIntoView({behavior:'smooth',block:'start'})">
          <div class="alert-cat-meta">
            <span class="alert-cat-name">${def.icon} ${def.label}</span>
            <span class="alert-cat-count">${catCounts[c]}</span>
          </div>
          <div class="alert-cat-track">
            <div class="alert-cat-bar" style="width:${pct}%;background:${catColors[c]}"></div>
          </div>
        </div>`;
    }).join('') || '<div style="font-size:.78rem;color:rgba(255,255,255,.6)">No active alerts</div>';
  }

  // Priority Actions
  const actWrap = el('alert-actions-wrap');
  if (actWrap) {
    const urgColors = { urgent:'#fca5a5', warn:'#fde68a', expand:'#86efac', renew:'#93c5fd', ok:'rgba(255,255,255,.4)' };
    const urgOrder  = { urgent:0, warn:1, expand:2, renew:3, ok:4 };

    // Dedupe by customer — one action per customer, pick first alert match
    const seen = new Set();
    const items = [];
    active.forEach(a => {
      if (seen.has(a.cid)) return;
      seen.add(a.cid);
      const c = customers.find(x => x.id === a.cid);
      if (!c) return;
      const nba = buildNextBestAction(c);
      items.push({ cid: c.id, name: c.name, level: nba.level, action: nba.action, mrr: c.mrr||0 });
    });

    // Sort by urgency then by MRR desc
    items.sort((a,b) => (urgOrder[a.level]||4) - (urgOrder[b.level]||4) || b.mrr - a.mrr);

    if (items.length) {
      actWrap.innerHTML = items.slice(0, 4).map(it => `
        <div class="alert-action-row" onclick="openDetail('${it.cid}')">
          <div class="alert-action-dot" style="background:${urgColors[it.level]||'rgba(255,255,255,.4)'}"></div>
          <div class="alert-action-body">
            <div class="alert-action-cust">${escHtml(it.name)}</div>
            <div class="alert-action-text">${escHtml(it.action)}</div>
          </div>
        </div>`).join('');
    } else {
      actWrap.innerHTML = '<div style="font-size:.78rem;color:rgba(255,255,255,.6);text-align:center;padding:12px 0">All clear — no actions needed</div>';
    }
  }
}

function tierChip(tier) {
  const map = { smb:'SMB', mid:'Mid-Market', enterprise:'Enterprise' };
  const label = map[tier] || tier || '';
  if (!label) return '';
  return `<span class="alert-tier-chip">${label}</span>`;
}

function alertItemHTML(a, isSnzd) {
  const def   = ALERT_CATS[a.cat] || ALERT_CATS.health;
  const sel   = _selectedAlerts.has(a.id);
  const scoreColor = STATUS_COLOR[a._status] || '#94a3b8';
  const scoreVal   = (a._score != null) ? a._score : '—';
  return `
    <div class="alert-item ${a.type} ${isSnzd?'snoozed':''} ${sel?'selected':''}" id="alert-row-${a.id}" onclick="openDetail('${a.cid}')">
      <div class="alert-score-circle" style="background:${scoreColor}">${scoreVal}</div>
      <input type="checkbox" class="alert-item__check" ${sel?'checked':''} onclick="event.stopPropagation();alertToggleSelect('${a.id}',this)" title="Select">
      <div class="alert-item__icon">${def.icon}</div>
      <div class="alert-item__body">
        <div class="alert-item__text">${a.msg}</div>
        <div class="alert-item__meta">
          <span class="alert-item__cat ${a.type}">${def.label}</span>
          ${tierChip(a._tier)}
          ${a._manager ? `<span class="alert-meta-csm">CSM: ${escHtml(a._manager)}</span>` : ''}
          ${a._days > 0 ? `<span class="alert-meta-days">${a._days}d since touch</span>` : ''}
          ${a.sub ? `<span style="color:var(--subtle)">${escHtml(a.sub)}</span>` : ''}
        </div>
      </div>
      <div class="alert-item__actions">
        ${isSnzd
          ? `<button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();unsnooze('${a.id}')">Wake</button>`
          : `<div class="snooze-dd"><button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();toggleSnoozeDd('${a.id}')">Snooze ▾</button>
             <div class="snooze-dd__menu" id="snooze-dd-${a.id}">
               <button class="snooze-dd__item" onclick="event.stopPropagation();snoozeAlert('${a.id}',1)">1 day</button>
               <button class="snooze-dd__item" onclick="event.stopPropagation();snoozeAlert('${a.id}',7)">7 days</button>
               <button class="snooze-dd__item" onclick="event.stopPropagation();snoozeAlert('${a.id}',30)">30 days</button>
             </div></div>
             <button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();dismissAlert('${a.id}')" title="Dismiss">✕</button>`}
        <button class="btn btn-xs btn-outline" onclick="event.stopPropagation();openDetail('${a.cid}')">View →</button>
      </div>
    </div>`;
}

function toggleSnoozeDd(aid) {
  document.querySelectorAll('.snooze-dd__menu').forEach(m => {
    if (m.id !== 'snooze-dd-'+aid) m.classList.remove('open');
  });
  el('snooze-dd-'+aid)?.classList.toggle('open');
}

// Close snooze dropdowns when clicking outside
document.addEventListener('click', () => {
  document.querySelectorAll('.snooze-dd__menu.open').forEach(m => m.classList.remove('open'));
});

function isSnoozed(aid) {
  if (!snoozed.has(aid)) return false;
  const expiry = snoozed.get(aid);
  if (Date.now() > expiry) { snoozed.delete(aid); return false; }
  return true;
}

function _alertAuditInfo(aid) {
  const a = buildAlerts().find(x => x.id === aid);
  const cust = a ? customers.find(x => x.id === a.cid) : null;
  return { custId: cust?.id||null, custName: cust?.name||'', catLabel: a ? (ALERT_CATS[a.cat]?.label||a.cat) : '' };
}

function snoozeAlert(aid, days=7) {
  const ai = _alertAuditInfo(aid);
  const expiry = Date.now() + days * 86400000;
  snoozed.set(aid, expiry);
  saveSettings();
  logAudit('alert_snoozed', ai.custId, ai.custName, { summary: `Alert snoozed for ${days}d — ${ai.catLabel}` });
  renderAlerts();
  renderDashboard();
  toast(`Alert snoozed for ${days} day${days===1?'':'s'} ⏱`, 'default');
}

function dismissAlert(aid) {
  const ai = _alertAuditInfo(aid);
  dismissed.add(aid);
  saveSettings();
  logAudit('alert_dismissed', ai.custId, ai.custName, { summary: `Alert dismissed — ${ai.catLabel}` });
  renderAlerts();
  renderDashboard();
  toast('Alert dismissed', 'default');
}

function unsnooze(aid) {
  const ai = _alertAuditInfo(aid);
  snoozed.delete(aid);
  saveSettings();
  logAudit('alert_unsnoozed', ai.custId, ai.custName, { summary: `Alert unsnoozed — ${ai.catLabel}` });
  renderAlerts();
  renderDashboard();
}

function clearSnoozed() {
  snoozed.clear();
  saveSettings();
  logAudit('alerts_cleared', null, '', { summary: 'All snoozed alerts cleared' });
  renderAlerts();
  renderDashboard();
  toast('Snoozed alerts cleared', 'success');
}

// ─── MANAGER FILTER ─────────────────────────────────────────
// Returns true if customer passes the active manager filter
function passesManagerFilter(c) {
  if (activeManagers.size === 0) return true;
  if (!c.manager && activeManagers.has('__unassigned__')) return true;
  return activeManagers.has(c.manager || '');
}

// Rebuild the manager dropdown from current customers list
function buildManagerSelectOptions(selectedManager) {
  const managers = [...new Set(customers.map(c => c.manager || '').filter(Boolean))].sort();
  let html = '<option value="">— Select —</option>';
  managers.forEach(m => {
    html += `<option value="${escHtml(m)}" ${m === selectedManager ? 'selected' : ''}>${escHtml(m)}</option>`;
  });
  if (selectedManager && !managers.includes(selectedManager)) {
    html += `<option value="${escHtml(selectedManager)}" selected>${escHtml(selectedManager)}</option>`;
  }
  html += '<option value="__add_new__">+ Add New...</option>';
  return html;
}

function refreshMgrDropdown() {
  const managers = [...new Set(customers.map(c => c.manager || '').filter(Boolean))].sort();
  const wrap = document.getElementById('mgr-filter-wrap');
  if (!wrap) return;

  // Always visible and always enabled
  if (managers.length === 0) return;

  // Populate datalist for form autocomplete (named managers only)
  const dl = document.getElementById('manager-datalist');
  if (dl) dl.innerHTML = managers.map(m => `<option value="${escHtml(m)}">`).join('');

  // Populate score-form <select> if present
  const fmSelect = document.getElementById('f-manager');
  if (fmSelect && fmSelect.tagName === 'SELECT') {
    const current = fmSelect.value;
    fmSelect.innerHTML = buildManagerSelectOptions(current);
  }

  const list = document.getElementById('mgr-filter-list');
  if (!list) return;

  // Check if any customers are unassigned
  const hasUnassigned = customers.some(c => !c.manager);

  const namedItems = managers.map(m => `
    <div class="mgr-filter__item">
      <label>
        <input type="checkbox" class="mgr-cb" value="${escHtml(m)}"
          onchange="mgrCbChange()"
          ${activeManagers.size === 0 || activeManagers.has(m) ? 'checked' : ''}>
        ${escHtml(m)}
      </label>
    </div>`).join('');

  const unassignedItem = hasUnassigned ? `
    <div class="mgr-filter__item">
      <label>
        <input type="checkbox" class="mgr-cb" value="__unassigned__"
          onchange="mgrCbChange()"
          ${activeManagers.size === 0 || activeManagers.has('__unassigned__') ? 'checked' : ''}>
        <span style="color:var(--muted);font-style:italic">Unassigned</span>
      </label>
    </div>` : '';

  list.innerHTML = namedItems + unassignedItem;

  updateMgrFilterLabel();
}

function toggleMgrDropdown() {
  const dd = document.getElementById('mgr-filter-dropdown');
  if (!dd) return;
  dd.style.display = dd.style.display === 'none' ? '' : 'none';
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('mgr-filter-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const dd = document.getElementById('mgr-filter-dropdown');
    if (dd) dd.style.display = 'none';
  }
});

// Close column filter dropdown when clicking outside
document.addEventListener('click', function(e) {
  if (!_openColFilterKey) return;
  const menu = document.getElementById('col-filter-portal');
  if (menu && menu.contains(e.target)) return;
  if (e.target.closest && e.target.closest('.col-filter-btn')) return;
  closeColFilter();
});

// Close alert filter dropdown when clicking outside
document.addEventListener('click', function(e) {
  if (!_openAlertFilterKey) return;
  const menu = document.getElementById('alert-filter-portal');
  if (menu && menu.contains(e.target)) return;
  if (e.target.closest && e.target.closest('.col-filter-btn')) return;
  closeAlertFilter();
});

function mgrAllToggle(cb) {
  // If "All" is checked → clear individual selections
  const cbs = document.querySelectorAll('.mgr-cb');
  if (cb.checked) {
    activeManagers.clear();
    cbs.forEach(c => c.checked = true);
  } else {
    // Uncheck all → effectively "none" — re-check all to avoid empty state
    cb.checked = true; // keep "All" checked — can't have nothing selected
  }
  updateMgrFilterLabel();
  renderDashboard(); renderCustomers(); renderAlerts(); renderSegments(); renderCSMPerformance();
}

function mgrCbChange() {
  const cbs = [...document.querySelectorAll('.mgr-cb')];
  const checked = cbs.filter(c => c.checked).map(c => c.value);
  const allCb = document.getElementById('mgr-all');
  if (checked.length === cbs.length || checked.length === 0) {
    // All or none selected → show all
    activeManagers.clear();
    cbs.forEach(c => c.checked = true);
    if (allCb) allCb.checked = true;
  } else {
    activeManagers = new Set(checked);
    if (allCb) allCb.checked = false;
  }
  updateMgrFilterLabel();
  renderDashboard(); renderCustomers(); renderAlerts(); renderSegments(); renderCSMPerformance();
}

function updateMgrFilterLabel() {
  const lbl = document.getElementById('mgr-filter-label');
  if (!lbl) return;
  if (activeManagers.size === 0) {
    lbl.textContent = 'All Managers';
  } else if (activeManagers.size === 1) {
    const val = [...activeManagers][0];
    lbl.textContent = val === '__unassigned__' ? 'Unassigned' : val;
  } else {
    lbl.textContent = activeManagers.size + ' Managers';
  }
}

// ─── CUSTOMERS LIST ─────────────────────────────────────────
function setFilter(f) {
  filterMode = f;
  // Clear any delta filter + sort when switching via status chips
  delete columnFilters['_delta'];
  if (sortKey === '_delta') { sortKey = 'score'; sortDir = -1; }
  // active chip styling for standard filters
  ['all','critical','risk','watch','healthy','expand','churned'].forEach(k => {
    const chip = el('fc-' + k);
    const sfx = {all:'a',critical:'cr',risk:'r',watch:'w',healthy:'h',expand:'e'}[k] || '';
    if (chip) chip.className = 'fchip' + (k===f && sfx ? ` f${sfx}` : k===f ? ' fa' : '');
  });
  // trash chip
  const trashChip = el('fc-trash');
  if (trashChip) trashChip.className = 'fchip' + (f==='trash' ? ' ft' : '');
  renderCustomers();
}

function sortBy(key) {
  if (sortKey === key) sortDir *= -1;
  else { sortKey = key; sortDir = -1; }
  renderTableHeaders();
  renderCustomers();
}

// ─── COLUMN HEADER RENDERING ─────────────────────────────────
function renderTableHeaders() {
  const tr = document.querySelector('#cust-thead tr');
  if (!tr) return;
  tr.querySelectorAll('th:not(.cb-col)').forEach(th => th.remove());
  const funnelSVG = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`;
  COL_DEFS.forEach(col => {
    const th = document.createElement('th');
    const isActiveSort = col.sortKey && sortKey === col.sortKey;
    const filterActive = col.ftype && (col.key in columnFilters);
    const hasSort      = !!col.sortKey;
    const hasFilter    = !!col.ftype;
    const labelEl = hasSort
      ? `<button class="col-sort-label" onclick="sortBy('${col.sortKey}')">${col.label}</button>`
      : `<span class="col-sort-label no-sort">${col.label}</span>`;
    const arrowEl = hasSort
      ? `<span class="col-sort-arrow${isActiveSort ? '' : ' idle'}">${sortDir === -1 ? '▼' : '▲'}</span>`
      : '';
    const filterEl = hasFilter
      ? `<button class="col-filter-btn${filterActive ? ' active' : ''}" onclick="event.stopPropagation();openColFilter('${col.key}',this)" title="Filter ${col.label}">${funnelSVG}</button>`
      : '';
    th.innerHTML = `<div class="col-th-inner">${labelEl}${arrowEl}${filterEl}</div>`;
    tr.appendChild(th);
  });
}

// ─── ACTIVE FILTER PILL BAR ──────────────────────────────────
function renderFilterPills() {
  const bar = document.getElementById('filter-pill-bar');
  if (!bar) return;
  const keys = Object.keys(columnFilters);
  if (!keys.length) { bar.style.display = 'none'; return; }

  bar.innerHTML = keys.map(key => {
    const f = columnFilters[key];
    const def = COL_DEFS.find(d => d.key === key);
    const label = def ? def.label : (key === '_delta' ? 'Delta' : key);

    let summary = '';
    if (f.type === 'untagged')     { summary = 'No tags'; }
    else if (f.type === 'text')    { summary = `"${(f.q||'').slice(0,20)}"`; }
    else if (f.type === 'enum')    {
      const arr = [...(f.vals||[])].map(v => ENUM_DISPLAY[v] || v);
      summary = arr.length <= 3 ? arr.join(', ') : arr.slice(0,3).join(', ') + ` +${arr.length-3}`;
    }
    else if (f.type === 'gt')      { summary = `> ${f.val}`; }
    else if (f.type === 'lt')      { summary = `< ${f.val}`; }
    else if (f.type === 'eq')      { summary = `= ${f.val}`; }
    else if (f.type === 'between') { summary = `${f.min} – ${f.max}`; }
    else if (f.type === 'up')      { summary = 'Improving this week'; }
    else if (f.type === 'down')    { summary = 'Declining this week'; }

    return `<span class="filter-pill" onclick="openColFilterFromPill('${key}',this)">${label}: ${summary}<button class="filter-pill-x" onclick="event.stopPropagation();clearColFilter('${key}')" title="Remove filter">✕</button></span>`;
  }).join('');

  bar.style.display = 'flex';
}

function openColFilterFromPill(key, pillEl) {
  // Try to scroll to the table & find the header button for better positioning
  const table = document.querySelector('#customers-table-card table');
  if (table) {
    const thBtns = table.querySelectorAll('.col-filter-btn');
    for (const btn of thBtns) {
      if (btn.getAttribute('onclick')?.includes(`'${key}'`)) {
        openColFilter(key, btn);
        return;
      }
    }
  }
  // Fallback: position from the pill itself
  openColFilter(key, pillEl);
}

// ─── COLUMN FILTER DROPDOWNS ─────────────────────────────────
function openColFilter(key, btnEl) {
  if (_openColFilterKey === key) { closeColFilter(); return; }
  closeColFilter();
  _openColFilterKey = key;
  const col  = COL_DEFS.find(c => c.key === key);
  const menu = document.getElementById('col-filter-portal');
  menu.innerHTML = buildColFilterMenu(col);
  menu.classList.add('open');
  const rect = (btnEl.closest('th') || btnEl).getBoundingClientRect();
  menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  menu.style.left = (rect.left   + window.scrollX)      + 'px';
  requestAnimationFrame(() => {
    const mr = menu.getBoundingClientRect();
    if (mr.right > window.innerWidth - 8)
      menu.style.left = (window.innerWidth - mr.width - 8 + window.scrollX) + 'px';
  });
  populateColFilterUI(key, col);
  setTimeout(() => menu.querySelector('input')?.focus(), 30);
}

function closeColFilter() {
  const menu = document.getElementById('col-filter-portal');
  if (menu) { menu.classList.remove('open'); menu.innerHTML = ''; }
  _openColFilterKey = null;
}

function buildColFilterMenu(col) {
  let body = '';
  if (col.ftype === 'number') {
    body = `
      <div class="cff-radio-group">
        <label class="cff-radio"><input type="radio" name="cfop" value="gt" onchange="cfOpChange()"> Greater than</label>
        <label class="cff-radio"><input type="radio" name="cfop" value="lt" onchange="cfOpChange()"> Less than</label>
        <label class="cff-radio"><input type="radio" name="cfop" value="eq" onchange="cfOpChange()"> Exactly</label>
        <label class="cff-radio"><input type="radio" name="cfop" value="between" onchange="cfOpChange()"> Between</label>
      </div>
      <div class="cff-inputs">
        <input class="cff-num-input" id="cf-val" type="number" placeholder="Value" oninput="applyColFilterLive()">
        <span class="cff-between-sep" id="cf-sep" style="display:none">and</span>
        <input class="cff-num-input" id="cf-val2" type="number" placeholder="Max" style="display:none" oninput="applyColFilterLive()">
      </div>`;
  } else if (col.ftype === 'enum') {
    const vals = col.enumFn ? col.enumFn() : (col.enumVals || []);
    body = `<div class="cff-enum-list">${vals.map(v => `
      <label class="cff-check-item">
        <input type="checkbox" value="${escHtml(v)}" class="cf-enum-cb" onchange="applyColFilterLive()">
        ${ENUM_DISPLAY[v] !== undefined ? ENUM_DISPLAY[v] : escHtml(v)}
      </label>`).join('')}</div>`;
  } else if (col.ftype === 'text') {
    body = `<input class="cff-text-input" id="cf-text" type="text" placeholder="Search ${col.label.toLowerCase()}…" oninput="applyColFilterLive()" autocomplete="off">`;
  }
  return `
    <div class="col-filter-hd">
      <span class="col-filter-title">Filter: ${col.label}</span>
      <button class="col-filter-clear" onclick="clearColFilter('${col.key}')">Clear</button>
    </div>
    <div class="col-filter-body">${body}</div>`;
}

function cfOpChange() {
  const op  = document.querySelector('input[name="cfop"]:checked')?.value;
  const v2  = document.getElementById('cf-val2');
  const sep = document.getElementById('cf-sep');
  const btw = op === 'between';
  if (v2)  v2.style.display  = btw ? '' : 'none';
  if (sep) sep.style.display = btw ? '' : 'none';
  applyColFilterLive();
}

function populateColFilterUI(key, col) {
  const f = columnFilters[key];
  if (!f) return;
  if (col.ftype === 'number') {
    const radio = document.querySelector(`input[name="cfop"][value="${f.type}"]`);
    if (radio) { radio.checked = true; cfOpChange(); }
    const v1 = document.getElementById('cf-val');
    const v2 = document.getElementById('cf-val2');
    if (v1) v1.value = (f.type === 'between' ? f.min : f.val) ?? '';
    if (v2 && f.max != null) v2.value = f.max;
  } else if (col.ftype === 'enum') {
    document.querySelectorAll('.cf-enum-cb').forEach(cb => { cb.checked = f.vals.has(cb.value); });
  } else if (col.ftype === 'text') {
    const inp = document.getElementById('cf-text');
    if (inp) inp.value = f.q || '';
  }
}

function applyColFilterLive() {
  const key = _openColFilterKey;
  if (!key) return;
  const col = COL_DEFS.find(c => c.key === key);
  if (!col) return;
  if (col.ftype === 'number') {
    const op = document.querySelector('input[name="cfop"]:checked')?.value;
    const v1 = parseFloat(document.getElementById('cf-val')?.value);
    const v2 = parseFloat(document.getElementById('cf-val2')?.value);
    if (!op || isNaN(v1)) { delete columnFilters[key]; }
    else if (op === 'between') {
      if (!isNaN(v2)) columnFilters[key] = { type:'between', min:v1, max:v2 };
      else delete columnFilters[key];
    } else {
      columnFilters[key] = { type:op, val:v1 };
    }
  } else if (col.ftype === 'enum') {
    const checked = [...document.querySelectorAll('.cf-enum-cb:checked')].map(cb => cb.value);
    if (checked.length) columnFilters[key] = { type:'enum', vals: new Set(checked) };
    else delete columnFilters[key];
  } else if (col.ftype === 'text') {
    const q = (document.getElementById('cf-text')?.value || '').trim().toLowerCase();
    if (q) columnFilters[key] = { type:'text', q };
    else delete columnFilters[key];
  }
  renderTableHeaders();
  renderCustomers();
}

function clearColFilter(key) {
  delete columnFilters[key];
  closeColFilter();
  renderTableHeaders();
  renderCustomers();
}

function isColFilterActive(key) { return key in columnFilters; }

// ─── COLUMN FILTER LOGIC ─────────────────────────────────────
function applyColumnFilters(list) {
  const keys = Object.keys(columnFilters);
  if (!keys.length) return list;
  return list.filter(c => {
    for (const key of keys) {
      const f = columnFilters[key];
      if (!f) continue;
      let v;
      switch (key) {
        case 'name':      v = (c.name||'').toLowerCase(); break;
        case 'manager':   v = (c.manager||'').toLowerCase(); break;
        case 'profile':   v = c.scoring_profile || 'Global Weights'; break;
        case 'score':     v = c.score || 0; break;
        case 'status':    v = c.status; break;
        case 'lifecycle': v = c.lifecycle; break;
        case '_momentum': v = getMomentum(c); break;
        case 'mrr':       v = c.mrr || 0; break;
        case 'arr':       v = c.arr || (c.mrr * 12) || 0; break;
        case 'since': {
          if (!c.since) { v = 0; break; }
          v = Math.floor((Date.now() - new Date(c.since)) / (1000*60*60*24*30.44));
          break;
        }
        case 'days':    v = c.days || 0; break;
        case 'renewal': v = c.renewal || 0; break;
        case 'next_touch': {
          if (!c.next_touch) { v = 9999; break; }
          v = Math.round((new Date(c.next_touch) - new Date()) / 86400000);
          break;
        }
        case 'tags': {
          if (f.type === 'untagged') {
            if ((c.tags || []).length > 0) return false;
            continue;
          }
          v = (c.tags||[]).join(' ').toLowerCase(); break;
        }
        case '_delta': {
          const d = getDelta7d(c);
          if (f.type === 'up'   && d <= 0) return false;
          if (f.type === 'down' && d >= 0) return false;
          continue; // handled inline — skip v-based checks below
        }
        default: continue;
      }
      if      (f.type === 'text')    { if (!v.includes(f.q))         return false; }
      else if (f.type === 'enum')    { if (!f.vals.has(String(v)))    return false; }
      else if (f.type === 'gt')      { if (!(v > f.val))              return false; }
      else if (f.type === 'lt')      { if (!(v < f.val))              return false; }
      else if (f.type === 'eq')      { if (v !== f.val)               return false; }
      else if (f.type === 'between') { if (v < f.min || v > f.max)    return false; }
    }
    return true;
  });
}

function renderCustomers() { try { _renderCustomers(); } catch(e) { console.error('renderCustomers error:', e); } }
function _renderCustomers() {
  renderTableHeaders(); // keep sort arrows + filter highlights in sync
  renderFilterPills();  // keep active filter pill bar in sync
  // ── Trash view ──────────────────────────────────────────
  const trashWrap = el('trash-wrap');
  const tableCard = el('customers-table-card');
  const bulkBar   = el('bulk-bar');

  if (filterMode === 'trash') {
    if (trashWrap)  trashWrap.style.display  = '';
    if (tableCard)  tableCard.style.display  = 'none';
    if (bulkBar)    bulkBar.style.display    = 'none';
    renderTrash();
    return;
  }
  if (trashWrap) trashWrap.style.display = 'none';
  if (tableCard) tableCard.style.display = '';

  const q = (el('search-input') ? el('search-input').value.toLowerCase() : '');
  let list = customers.filter(c => {
    if (filterMode === 'churned') return c.lifecycle === 'churned';
    if (filterMode === 'all')    return c.lifecycle !== 'churned';
    return c.status === filterMode && c.lifecycle !== 'churned';
  }).filter(c => passesManagerFilter(c)).filter(c => {
    if (_filterTier && c.tier !== _filterTier) return false;
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || (c.tags||[]).some(t=>t.toLowerCase().includes(q));
  });

  // Column filters (stack on top of global filters)
  list = applyColumnFilters(list);

  // Sort
  list.sort((a,b) => {
    let av = sortKey==='_delta'?getDelta7d(a): sortKey==='_trend'?getDelta7d(a): sortKey==='_momentum'?getMomentum(a): sortKey==='status'?(a.status||''): sortKey==='lifecycle'?(a.lifecycle||''): sortKey==='tags'?(a.tags||[]).join(', '): sortKey==='name'?a.name: sortKey==='manager'?(a.manager||'zzz'): sortKey==='profile'?(a.scoring_profile||'zzz'): sortKey==='score'?a.score: sortKey==='mrr'?a.mrr||0: sortKey==='arr'?(a.arr||(a.mrr*12)||0): sortKey==='since'?(a.since||'9999'): sortKey==='days'?a.days: sortKey==='renewal'?a.renewal||99: sortKey==='next_touch'?(a.next_touch||'9999'):0;
    let bv = sortKey==='_delta'?getDelta7d(b): sortKey==='_trend'?getDelta7d(b): sortKey==='_momentum'?getMomentum(b): sortKey==='status'?(b.status||''): sortKey==='lifecycle'?(b.lifecycle||''): sortKey==='tags'?(b.tags||[]).join(', '): sortKey==='name'?b.name: sortKey==='manager'?(b.manager||'zzz'): sortKey==='profile'?(b.scoring_profile||'zzz'): sortKey==='score'?b.score: sortKey==='mrr'?b.mrr||0: sortKey==='arr'?(b.arr||(b.mrr*12)||0): sortKey==='since'?(b.since||'9999'): sortKey==='days'?b.days: sortKey==='renewal'?b.renewal||99: sortKey==='next_touch'?(b.next_touch||'9999'):0;
    if (typeof av === 'string') return av.localeCompare(bv) * sortDir;
    return (av - bv) * sortDir;
  });

  const lbl = el('cust-count-lbl');
  if (lbl) lbl.textContent = `${list.length} customer${list.length!==1?'s':''}`;

  const tbody = el('cust-tbody');
  const table = el('cust-table');
  const empty = el('cust-empty');

  if (!list.length) {
    if (!customers.length || (filterMode !== 'all' && filterMode !== 'churned' && !customers.some(c => c.status === filterMode && c.lifecycle !== 'churned'))) {
      // Truly no customers — show onboarding empty state
      empty.style.display = 'block';
      table.style.display = 'none';
    } else {
      // Filters produced 0 results — keep headers, show message in tbody
      empty.style.display = 'none';
      table.style.display = '';
      const hasFilters = Object.keys(columnFilters).length > 0;
      tbody.innerHTML = `<tr><td colspan="20" style="text-align:center;padding:32px 16px;color:var(--muted);font-size:.85rem">
        <div style="margin-bottom:6px">No matching customers</div>
        ${hasFilters ? '<div style="font-size:.75rem">Try adjusting or clearing your filters</div>' : ''}
      </td></tr>`;
    }
    return;
  }
  empty.style.display = 'none';
  table.style.display = '';

  tbody.innerHTML = list.map(c => {
    const delta = scoreDelta(c);
    const isSel = selectedIds.has(c.id);
    const cad   = getCadenceStatus(c);
    return `
      <tr class="${isSel?'selected':''}" data-id="${c.id}">
        <td class="cb-col"><input type="checkbox" ${isSel?'checked':''} onchange="toggleSelect('${c.id}',this.checked)" onclick="event.stopPropagation()"/></td>
        <td style="cursor:pointer" onclick="openDetail('${c.id}')"><strong>${escHtml(c.name)}</strong>${(()=>{ if (!c.next_touch) return ''; const ntd = Math.round((new Date(c.next_touch)-new Date())/86400000); return ntd < 0 ? ' <span class="nt-badge nt-overdue" style="font-size:.62rem;padding:1px 5px">Touch overdue</span>' : ''; })()}</td>
        <td>${c.manager ? escHtml(c.manager) : '<span style="color:var(--muted);font-style:italic">—</span>'}</td>
        <td>${c.scoring_profile && c.scoring_profile !== 'Global Weights' ? `<span class="tag">${escHtml(c.scoring_profile)}</span>` : '<span style="color:var(--muted);font-style:italic;font-size:.75rem">Global</span>'}</td>
        <td>${scoreHTML(c)}</td>
        <td style="padding:4px 8px">${buildSparklineMini(c)}</td>
        <td>${momentumHTML(c)}</td>
        <td>${badgeHTML(c.status)}</td>
        <td>${lifecycleBadge(c.lifecycle)}</td>
        <td>${c.mrr ? '$'+fmtNum(c.mrr) : '—'}</td>
        <td>${(()=>{ const arr = c.arr || (c.mrr * 12); return arr ? '$'+fmtNum(arr) : '—'; })()}</td>
        <td>${(()=>{
          if (!c.since) return '—';
          const ms = new Date() - new Date(c.since);
          const months = Math.floor(ms / (1000*60*60*24*30.44));
          if (months < 1)  return 'New';
          if (months < 12) return months + 'mo';
          const yrs = Math.floor(months/12), rem = months%12;
          return rem ? `${yrs}y ${rem}mo` : `${yrs}y`;
        })()}</td>
        <td><div class="ct-two-line"><span class="${cad.cls}">${cad.label.replace(/\s*\(\d+d\)/,'')}</span><span class="ct-sub">${c.days}d ago</span></div></td>
        <td>${(()=>{
          if (c.renewal_date) {
            const d = new Date(c.renewal_date);
            const today = new Date(); today.setHours(0,0,0,0);
            const days = Math.round((d - today) / 86400000);
            const dateStr = d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
            const countdown = days < 0 ? `<span style="color:#dc2626;font-weight:700">Overdue</span>`
              : days === 0 ? `<span style="color:#dc2626;font-weight:700">Today</span>`
              : days <= 30 ? `<span style="color:#ea580c;font-weight:700">${days}d left</span>`
              : days <= 90 ? `<span style="color:#d97706;font-weight:700">${days}d left</span>`
              : `<span style="color:var(--muted)">${days}d left</span>`;
            return `<div class="ct-two-line">${countdown}<span class="ct-sub">${dateStr}</span></div>`;
          }
          if (c.renewal != null && c.renewal > 0) return `<div class="ct-two-line">${urgencyHTML(c)}<span class="ct-sub">${c.renewal}mo</span></div>`;
          return '—';
        })()}</td>
        <td class="nt-cell" onclick="event.stopPropagation();openInlineNextTouch('${c.id}',this)">${(()=>{
          if (!c.next_touch) return '<span class="nt-inline-empty">+ Schedule</span>';
          const d = new Date(c.next_touch);
          const today = new Date(); today.setHours(0,0,0,0);
          const ntd = Math.round((d - today) / 86400000);
          const dateStr = d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
          if (ntd < 0)  return `<span class="nt-badge nt-overdue">${dateStr}</span>`;
          if (ntd === 0) return `<span class="nt-badge nt-today">Today</span>`;
          if (ntd <= 7)  return `<span class="nt-badge nt-ok">${dateStr}</span>`;
          return `<span style="font-size:.75rem;color:var(--muted)">${dateStr}</span>`;
        })()}</td>
        <td>${(c.tags||[]).map(t=>`<span class="tag">${t}</span>`).join('')}</td>
      </tr>`;
  }).join('');
}

// ─── INLINE NEXT TOUCH EDITOR ────────────────────────────────
function openInlineNextTouch(custId, tdEl) {
  // Close any existing picker
  document.querySelectorAll('.nt-inline-picker').forEach(p => p.remove());

  const c = customers.find(x => x.id === custId);
  if (!c) return;

  const picker = document.createElement('div');
  picker.className = 'nt-inline-picker';
  picker.onclick = e => e.stopPropagation();
  picker.innerHTML = `
    <input type="date" id="nt-pick-date" value="${c.next_touch || ''}">
    <div class="nt-inline-picker-btns">
      ${c.next_touch ? `<button class="btn btn-ghost btn-xs" onclick="saveInlineNextTouch('${custId}','');this.closest('.nt-inline-picker').remove()">Clear</button>` : ''}
      <button class="btn btn-ghost btn-xs" onclick="this.closest('.nt-inline-picker').remove()">Cancel</button>
      <button class="btn btn-primary btn-xs" onclick="saveInlineNextTouch('${custId}',document.getElementById('nt-pick-date').value);this.closest('.nt-inline-picker').remove()">Save</button>
    </div>`;
  tdEl.appendChild(picker);

  // Auto-focus and open the date picker
  const inp = picker.querySelector('input');
  setTimeout(() => { inp.focus(); try { inp.showPicker(); } catch(e) {} }, 30);

  // Close on outside click
  const closeHandler = (e) => {
    if (!picker.contains(e.target) && e.target !== tdEl) {
      picker.remove();
      document.removeEventListener('click', closeHandler, true);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler, true), 50);
}

async function saveInlineNextTouch(custId, val) {
  const c = customers.find(x => x.id === custId);
  if (!c) return;
  const oldVal = c.next_touch || '';
  c.next_touch = val || '';
  // Persist to Supabase
  const row = toRow(c);
  const { error } = await sb.from('customers').update({ next_touch: row.next_touch }).eq('id', c.id);
  if (error) {
    console.warn('Failed to save next_touch:', error.message);
    c.next_touch = oldVal; // rollback
    toast('Failed to save — please try again', 'error');
  } else {
    logAudit('next_touch_updated', c.id, c.name, { from: oldVal || '(none)', to: val || '(cleared)' });
    toast(val ? `Next touch set to ${new Date(val).toLocaleDateString('en-US',{month:'short',day:'numeric'})}` : 'Next touch cleared', 'default');
  }
  renderCustomers();
}

function scoreHTML(c) {
  const col = STATUS_COLOR[c.status] || '#64748b';
  return `<div class="mini-score">
    <span style="font-weight:800;color:${col}">${c.score}</span>
    <div class="mini-bar"><div class="mini-bar__f" style="width:${c.score}%;background:${col}"></div></div>
  </div>`;
}

function badgeHTML(status) {
  const cls   = STATUS_CSS[status]   || 'healthy';
  const label = STATUS_LABEL[status] || 'Healthy';
  return `<span class="bsm ${cls}">${label}</span>`;
}

function lifecycleBadge(lc) {
  const map = {
    onboarding: { cls:'lc-onboarding', label:'Onboarding' },
    active:     { cls:'lc-active',     label:'Active' },
    atrisk:     { cls:'lc-atrisk',     label:'At Risk' },
    won:        { cls:'lc-won',        label:'Won' },
    churned:    { cls:'lc-churned',    label:'Churned' }
  };
  const { cls, label } = map[lc] || map.active;
  return `<span class="lifecycle-badge ${cls}">${label}</span>`;
}

function scoreDelta(c) {
  if (!c.history || c.history.length < 2) return null;
  const last  = c.history[c.history.length-1].score;
  const prev  = c.history[c.history.length-2].score;
  return last - prev;
}

function deltaHTML(delta) {
  if (delta === null) return '<span class="delta-eq">—</span>';
  if (delta > 0)  return `<span class="delta-up">▲ ${delta}</span>`;
  if (delta < 0)  return `<span class="delta-dn">▼ ${Math.abs(delta)}</span>`;
  return '<span class="delta-eq">→ 0</span>';
}

// ─── MOMENTUM ────────────────────────────────────────────────
// Looks at the last 3 history points to classify trajectory
function getMomentum(c) {
  if (!c.history || c.history.length < 2) return 'new';
  const hist = c.history;
  if (hist.length === 2) {
    const diff = hist[1].score - hist[0].score;
    if (diff >= 5)  return 'up';
    if (diff <= -5) return 'dn';
    return 'flat';
  }
  // Use last 3 points — compare trend direction
  const pts = hist.slice(-3).map(h => h.score);
  const avg1 = (pts[0] + pts[1]) / 2;
  const avg2 = pts[2];
  const diff = avg2 - avg1;
  if (diff >= 5)  return 'up';
  if (diff <= -5) return 'dn';
  return 'flat';
}

function momentumHTML(c) {
  const m = getMomentum(c);
  const svgUp   = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
  const svgDn   = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`;
  const svgFlat = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  const svgNew  = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="4"/></svg>`;
  const map = {
    up:   { cls:'up',   icon:svgUp,   label:'Improving' },
    dn:   { cls:'dn',   icon:svgDn,   label:'Declining' },
    flat: { cls:'flat', icon:svgFlat, label:'Flat' },
    new:  { cls:'new',  icon:svgNew,  label:'New' }
  };
  const { cls, icon, label } = map[m];
  return `<span class="momentum ${cls}">${icon} ${label}</span>`;
}

// ─── RENEWAL URGENCY ─────────────────────────────────────────
// Combines score + days to renewal into a single urgency level
function getRenewalUrgency(c) {
  if (c.renewal == null || c.lifecycle === 'churned') return null;
  const months = c.renewal;
  const score  = c.score;
  // Score the urgency 0–100 (higher = more urgent)
  const renewalFactor = Math.max(0, 1 - months / 12); // 0mo=1.0, 12mo=0
  const riskFactor    = Math.max(0, 1 - score / 100);  // score 0=1.0, 100=0
  const urgency       = Math.round((renewalFactor * 0.6 + riskFactor * 0.4) * 100);

  if (urgency >= 70) return { level:'critical', label:'Critical', cls:'critical', score: urgency };
  if (urgency >= 45) return { level:'high',     label:'High',     cls:'high',     score: urgency };
  if (urgency >= 20) return { level:'medium',   label:'Medium',   cls:'medium',   score: urgency };
  return               { level:'low',      label:'Low',      cls:'low',      score: urgency };
}

function urgencyHTML(c) {
  const u = getRenewalUrgency(c);
  if (!u) return '—';
  return `<span class="urgency ${u.cls}" title="Urgency score: ${u.score}/100">${u.label}</span>`;
}

// ─── CADENCE TRACKER ─────────────────────────────────────────
// Tier-based thresholds for days since last contact
const CADENCE_THRESHOLDS = {
  enterprise: { warn: 14, overdue: 30 },
  mid:        { warn: 21, overdue: 45 },
  smb:        { warn: 30, overdue: 60 }
};

function getCadenceStatus(c) {
  const thres = CADENCE_THRESHOLDS[c.tier] || CADENCE_THRESHOLDS.mid;
  if (c.days >= thres.overdue) return { status:'overdue', label:`Overdue (${c.days}d)`,  cls:'cadence-overdue' };
  if (c.days >= thres.warn)    return { status:'warn',    label:`Due Soon (${c.days}d)`, cls:'cadence-warn' };
  return                                { status:'ok',      label:`On Track (${c.days}d)`, cls:'cadence-ok' };
}

// Add cadence alerts to the alerts builder
function buildCadenceAlerts() {
  const alerts = [];
  customers.forEach(c => {
    if (c.lifecycle === 'churned') return;
    // Next touch overdue alert
    if (c.next_touch) {
      const ntDays = Math.round((new Date() - new Date(c.next_touch)) / 86400000);
      if (ntDays > 0) {
        alerts.push({
          id:  `${c.id}-ntouch`,
          cid: c.id,
          cat: 'cadence',
          type: ntDays > 7 ? 'red' : 'amber',
          msg: `<strong>${escHtml(c.name)}</strong> <span>— scheduled touch overdue by ${ntDays} day${ntDays !== 1 ? 's' : ''}</span>`,
          sub: `Was due ${new Date(c.next_touch).toLocaleDateString('en-US', { month:'short', day:'numeric' })}`
        });
      }
    }
    if (!signalOn(c,'days')) return; // cadence is a days-based signal — skip if weight is 0
    const cad = getCadenceStatus(c);
    if (cad.status === 'overdue') {
      alerts.push({
        id: c.id+'-cadence',
        cid: c.id,
        type: 'red',
        msg: `<strong>${c.name}</strong> <span>— check-in overdue! No contact in ${c.days} days (${(c.tier||'mid').toUpperCase()} SLA: ${CADENCE_THRESHOLDS[c.tier||'mid'].overdue}d)</span>`
      });
    } else if (cad.status === 'warn') {
      alerts.push({
        id: c.id+'-cadence',
        cid: c.id,
        type: 'amber',
        msg: `<strong>${c.name}</strong> <span>— check-in due soon (${c.days} days since contact)</span>`
      });
    }
  });
  return alerts;
}

// ─── SENTIMENT TRACKING ──────────────────────────────────────
let pendingSentiment = null; // 'positive' | 'neutral' | 'negative'

function setSentiment(val) {
  pendingSentiment = val;
  ['pos','neu','neg'].forEach(k => el('sent-'+k)?.classList.remove('active'));
  const map = { positive:'pos', neutral:'neu', negative:'neg' };
  el('sent-'+map[val])?.classList.add('active');
}

function logSentiment() {
  if (!pendingSentiment) { toast('Select a sentiment first', 'error'); return; }
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const note = el('sent-note')?.value.trim() || '';
  c.sentiment = c.sentiment || [];
  c.sentiment.unshift({ val: pendingSentiment, note, date: new Date().toISOString() });
  pendingSentiment = null;
  ['pos','neu','neg'].forEach(k => el('sent-'+k)?.classList.remove('active'));
  if (el('sent-note')) el('sent-note').value = '';
  renderDetailSentiment();
  logAudit('sentiment_logged', c.id, c.name, { summary: `Sentiment: ${c.sentiment[0].val}${note ? ' — "' + note.substring(0, 80) + '"' : ''}` });
  save(c).then(() => toast('Sentiment logged', 'success'))
         .catch(e => { console.error('Sentiment save failed:', e); toast('Saved locally — sync failed', 'warn'); });
}

function renderDetailSentiment() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const logs = c.sentiment || [];
  const icons = { positive:'😊', neutral:'😐', negative:'😟' };
  const labels = { positive:'Positive', neutral:'Neutral', negative:'Negative' };

  el('dm-sentiment-list').innerHTML = logs.length
    ? logs.map((s,i) => `
        <div class="sent-log">
          <div class="sent-log__icon">${icons[s.val]||'😐'}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:.8rem">${labels[s.val]||s.val}</div>
            ${s.note ? `<div style="font-size:.75rem;color:var(--muted);margin-top:1px">${escHtml(s.note)}</div>` : ''}
          </div>
          <div class="sent-log__meta">${fmtDate(s.date)}</div>
          <button class="btn btn-xs btn-danger" style="margin-left:6px" onclick="deleteSentiment(${i})">✕</button>
        </div>`).join('')
    : '<p style="font-size:.82rem;color:var(--muted)">No sentiment logs yet. Log one above.</p>';
}

function deleteSentiment(idx) {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  c.sentiment.splice(idx,1);
  renderDetailSentiment();
  save(c).catch(e => console.error('Sentiment delete sync failed:', e));
}

// Latest sentiment for a customer
function latestSentiment(c) {
  try {
    const s = Array.isArray(c.sentiment) ? c.sentiment : (typeof c.sentiment === 'string' ? JSON.parse(c.sentiment) : []);
    return s.length ? s[0] : null;
  } catch(e) { return null; }
}

// ─── PRIORITY LIST ───────────────────────────────────────────
function calcPriorityScore(c) {
  try {
    let score = 0;
    // Health risk — more weight for lower scores
    score += Math.max(0, 100 - c.score) * 0.35;
    // Renewal urgency
    const u = getRenewalUrgency(c);
    if (u) score += u.score * 0.30;
    // Last touch cadence — overdue contact is urgent regardless of health
    const cad = getCadenceStatus(c);
    if (cad.status === 'overdue') score += 35;
    else if (cad.status === 'warn') score += 15;
    // Declining momentum
    const mom = getMomentum(c);
    if (mom === 'dn') score += 20;
    // High MRR accounts always matter more
    if (c.mrr > 5000)  score += 10;
    if (c.mrr > 15000) score += 10;
    // Negative sentiment
    const sent = latestSentiment(c);
    if (sent?.val === 'negative') score += 15;
    // Expansion opportunity — bump healthy/expanding accounts with high MRR up
    if (c.status === 'expand' && c.growth === 'strong') score += 12;
    if (c.status === 'expand' && c.mrr > 5000)          score += 8;
    return Math.round(score);
  } catch(e) { return 0; }
}

function buildPriorityReasons(c) {
  const reasons = [];
  const cad  = getCadenceStatus(c);
  const u    = getRenewalUrgency(c);
  const mom  = getMomentum(c);
  const sent = latestSentiment(c);

  // ── Negative / urgent signals first ──
  if (c.status === 'critical')                reasons.push('Critical health');
  else if (c.status === 'risk')               reasons.push('At risk score');
  else if (c.status === 'watch')              reasons.push('Score needs monitoring');

  if (cad.status === 'overdue')               reasons.push(`No contact in ${c.days}d`);
  else if (cad.status === 'warn')             reasons.push(`Touch overdue (${c.days}d)`);

  if (u?.level === 'critical')               reasons.push(`Renewal in ${c.renewal}mo — urgent`);
  else if (u?.level === 'high')              reasons.push(`Renewal in ${c.renewal}mo`);

  if (mom === 'dn')                          reasons.push('Score declining');
  if (sent?.val === 'negative')              reasons.push('Negative sentiment');

  // ── Positive signals for healthy/expansion ──
  if (!reasons.length) {
    if (c.status === 'expand' && c.growth === 'strong') reasons.push('Expansion ready');
    else if (c.status === 'expand')                     reasons.push('High health · expansion candidate');
    else if (c.status === 'healthy' && c.mrr > 10000)  reasons.push('High-value healthy account');
    else if (c.status === 'healthy')                    reasons.push('Healthy · maintain cadence');
    if (u?.level === 'medium')                          reasons.push(`Renewal in ${c.renewal}mo`);
    if (c.mrr > 10000 && !reasons.length)              reasons.push('High MRR account');
  }

  // ── Fallback ──
  if (!reasons.length) reasons.push('Scheduled check-in due');

  return reasons.slice(0, 2).join(' · ');
}

function renderPriorityList() { try { _renderPriorityList(); } catch(e) { console.error('renderPriorityList error:', e); } }
function _renderPriorityList() {
  // Support both old (priority-list-wrap) and new (priority-table-wrap) element IDs
  const wrap = el('priority-table-wrap') || el('priority-list-wrap');
  if (!wrap) return;
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!active.length) {
    wrap.innerHTML = '<p style="font-size:.82rem;color:var(--muted);text-align:center;padding:28px 0">No customers yet. Score your first customer to see priority recommendations.</p>';
    return;
  }
  const ranked = [...active]
    .map(c => ({ c, pri: calcPriorityScore(c) }))
    .sort((a,b) => b.pri - a.pri)
    .slice(0, 10);

  const statusRankCls = { critical:'pr-critical', risk:'pr1', watch:'pr-watch', healthy:'pr2', expand:'pr-expand' };

  const rows = ranked.map(({ c }, i) => {
    const urg = getRenewalUrgency(c);
    const urgColor = { Critical:'var(--red)', High:'var(--amber)', Medium:'var(--blue)', Low:'var(--subtle)', '':'var(--subtle)' }[urg] || 'var(--subtle)';
    const growth = c.growth === 'up' ? '<span style="color:var(--green);font-weight:700">Up</span>'
                 : c.growth === 'dn' ? '<span style="color:var(--red);font-weight:700">Down</span>'
                 : '<span style="color:var(--subtle)">Flat</span>';
    const lastTouch = c.days != null ? (c.days === 0 ? 'Today' : `${c.days}d ago`) : '—';
    const renewalStr = (() => {
      if (c.renewal_date) {
        const d = new Date(c.renewal_date);
        const today = new Date(); today.setHours(0,0,0,0);
        const days = Math.round((d - today) / 86400000);
        const col = days < 0 ? '#dc2626' : days <= 30 ? '#ea580c' : days <= 90 ? '#d97706' : 'var(--muted)';
        const lbl = days < 0 ? 'Overdue' : days === 0 ? 'Today' : `${days}d`;
        return `<span style="color:${col};font-weight:700">${lbl}</span>`;
      }
      if (c.renewal != null && c.renewal >= 0) {
        const urgColor2 = urg?.level === 'critical' ? '#dc2626' : urg?.level === 'high' ? '#ea580c' : 'var(--muted)';
        return `<span style="color:${urgColor2};font-weight:700">${c.renewal}mo</span>`;
      }
      return '<span style="color:var(--subtle)">—</span>';
    })();
    return `<tr onclick="openDetail('${c.id}')">
      <td style="padding-left:14px">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="p-rank ${statusRankCls[c.status]||'pr3'}">${i+1}</span>
          <div>
            <div style="font-weight:700;font-size:.83rem">${escHtml(c.name)}</div>
            <div style="font-size:.68rem;color:var(--muted);margin-top:1px">${buildPriorityReasons(c)}</div>
          </div>
        </div>
      </td>
      <td>${scoreHTML(c)}</td>
      <td style="font-weight:700">${c.mrr ? '$'+fmtNum(c.mrr) : '—'}</td>
      <td>${renewalStr}</td>
      <td>${growth}</td>
      <td style="font-size:.73rem;color:var(--muted)">${lastTouch}</td>
      <td style="font-size:.73rem;color:var(--muted)">${escHtml(c.manager||'—')}</td>
      <td>
        <div class="qa-btns">
          <button class="btn btn-xs btn-ghost" title="Open account" onclick="event.stopPropagation();openDetail('${c.id}')">Open</button>
          <button class="btn btn-xs btn-outline" title="Log a touch" onclick="event.stopPropagation();openDetail('${c.id}');setTimeout(()=>el('note-text')?.focus(),400)">Log</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<table class="ptbl">
    <thead><tr>
      <th style="padding-left:14px">Account</th>
      <th>Health</th>
      <th>MRR</th>
      <th>Renewal</th>
      <th>Growth</th>
      <th>Last Touch</th>
      <th>Owner</th>
      <th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ─── BULK ACTIONS ────────────────────────────────────────────
function toggleSelect(id, checked) {
  if (checked) selectedIds.add(id);
  else         selectedIds.delete(id);
  updateBulkBar();
  renderCustomers();
}

function toggleSelectAll(checked) {
  const q = el('search-input') ? el('search-input').value.toLowerCase() : '';
  const list = customers.filter(c => {
    if (filterMode==='churned') return c.lifecycle==='churned';
    if (filterMode==='all')    return c.lifecycle!=='churned';
    return c.status===filterMode && c.lifecycle!=='churned';
  }).filter(c => passesManagerFilter(c)).filter(c => !q || c.name.toLowerCase().includes(q) || (c.tags||[]).some(t=>t.toLowerCase().includes(q)));
  if (checked) list.forEach(c => selectedIds.add(c.id));
  else         selectedIds.clear();
  updateBulkBar();
  renderCustomers();
}

function updateBulkBar() {
  const bar = el('bulk-bar');
  const cnt = el('bulk-count');
  const editBtn = el('bulk-edit-btn');
  if (selectedIds.size > 0) {
    bar.classList.add('show');
    cnt.textContent = `${selectedIds.size} selected`;
    // Edit only works with exactly 1 selected
    if (editBtn) {
      editBtn.style.display = selectedIds.size === 1 ? '' : 'none';
    }
  } else {
    bar.classList.remove('show');
  }
}

function clearSelection() {
  selectedIds.clear();
  updateBulkBar();
  renderCustomers();
}

function bulkEdit() {
  if (selectedIds.size !== 1) return;
  const id = [...selectedIds][0];
  clearSelection();
  editCustomer(id);
}

function bulkRescore() {
  if (!selectedIds.size) return;
  const n = selectedIds.size;
  confirmAction(`Re-score ${n} selected customer${n!==1?'s':''}?`, () => {
    const changed = [];
    customers.forEach(c => {
      if (!selectedIds.has(c.id)) return;
      const profileMatch = c.scoring_profile ? profiles.find(p => p.name === c.scoring_profile) : null;
      const resolvedWeights = profileMatch ? profileMatch.weights : weights;
      const { score } = calcScore(c, resolvedWeights);
      if (c.score !== score) {
        c.history = c.history || [];
        c.history.push({ score, date: new Date().toISOString() });
        c.score = score;
        c.status = getStatus(score);
        changed.push(c);
      }
    });
    clearSelection();
    toast(`Re-scored ${n} customer${n!==1?'s':''} (${changed.length} changed)`, 'success');
    renderCustomers();
    changed.forEach(c => save(c).catch(()=>{}));
  });
}

function bulkTag() {
  if (!selectedIds.size) return;
  el('bulk-tag-input').value = '';
  openModal('bulk-tag-modal');
}
function applyBulkTag() {
  const tag = el('bulk-tag-input').value.trim();
  if (!tag) return;
  const changed = [];
  customers.forEach(c => {
    if (selectedIds.has(c.id)) {
      c.tags = c.tags || [];
      if (!c.tags.includes(tag)) { c.tags.push(tag); changed.push(c); }
    }
  });
  closeModal('bulk-tag-modal');
  const n = selectedIds.size;
  logAudit('bulk_tag', null, '', { summary: `Tag "${tag}" applied to ${n} customer${n===1?'':'s'}` });
  clearSelection();
  toast(`Tag "${tag}" added to ${n} customers`, 'success');
  renderCustomers();
  Promise.all(changed.map(c => atUpdate(c).catch(()=>{}))).catch(()=>{});
}

function bulkLifecycle() {
  if (!selectedIds.size) return;
  openModal('bulk-lifecycle-modal');
}
function applyBulkLifecycle() {
  const stage = el('bulk-lc-input').value;
  const changed = [];
  customers.forEach(c => {
    if (selectedIds.has(c.id)) { c.lifecycle = stage; changed.push(c); }
  });
  closeModal('bulk-lifecycle-modal');
  const n = selectedIds.size;
  logAudit('bulk_lifecycle', null, '', { summary: `Lifecycle set to "${stage}" for ${n} customer${n===1?'':'s'}` });
  clearSelection();
  toast(`Stage updated for ${n} customers`, 'success');
  renderCustomers();
  Promise.all(changed.map(c => atUpdate(c).catch(()=>{}))).catch(()=>{});
}

function bulkDelete() {
  if (!selectedIds.size) return;
  const n = selectedIds.size;
  confirmAction(`Move ${n} selected customer${n!==1?'s':''} to Trash?`, async () => {
    const now = new Date().toISOString();
    const toDelete = customers.filter(c => selectedIds.has(c.id));
    toDelete.forEach(c => { c.deleted_at = now; trash.push(c); });
    customers = customers.filter(c => !selectedIds.has(c.id));
    clearSelection();
    logAudit('bulk_delete', null, '', { summary: `${n} customer${n===1?'':'s'} moved to Trash` });
    toast(`${n} customer${n!==1?'s':''} moved to Trash`, 'warn');
    renderCustomers();
    setLoading(true);
    await Promise.all(toDelete.map(c => atDelete(c).catch(()=>{}))).finally(() => setLoading(false));
  });
}

// ─── CUSTOMER DETAIL MODAL ───────────────────────────────────
function openDetail(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  detailId = id;

  el('dm-name').textContent = c.name;
  el('dm-sub').innerHTML = `
    ${badgeHTML(c.status)} ${lifecycleBadge(c.lifecycle)}
    <span style="margin-left:6px;color:var(--muted)">Score: <strong>${c.score}</strong></span>
    ${c.mrr ? `<span style="margin-left:6px;color:var(--muted)">MRR: <strong>$${fmtNum(c.mrr)}</strong></span>` : ''}
  `;

  // Gate QBR button
  const qbrBtn = el('dm-qbr-btn');
  if (qbrBtn) {
    if (hasFeature('qbr_prep')) { qbrBtn.style.display = ''; qbrBtn.disabled = false; }
    else { qbrBtn.style.display = 'none'; }
  }

  dtab('overview');
  openModal('detail-modal');
}

function dtab(which) {
  ['overview','playbook','notes','sentiment','history'].forEach(t => {
    el('dt-'+t)?.classList.toggle('active', t===which);
    el('dp-'+t)?.classList.toggle('active', t===which);
  });
  if (which === 'overview')  renderDetailOverview();
  if (which === 'playbook')  { if (hasFeature('playbooks')) renderDetailPlaybook(); else el('dm-playbook').innerHTML = upgradeHTML('playbooks'); }
  if (which === 'notes')     renderDetailNotes();
  if (which === 'sentiment') { if (hasFeature('sentiment')) renderDetailSentiment(); else el('dm-sentiment-list').innerHTML = upgradeHTML('sentiment'); }
  if (which === 'history')   renderDetailHistory();
}

function renderDetailOverview() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const { signals } = calcScore(c, getActiveWeights(c));
  const rec    = makeRec(c.score, c);
  const delta  = scoreDelta(c);
  const cad    = getCadenceStatus(c);
  const sent   = latestSentiment(c);
  const nba    = buildNextBestAction(c);
  const sentIcon = sent ? ({ positive:'😊', neutral:'😐', negative:'😟' }[sent.val]||'') : null;
  // Map nba.level to urgency color
  const nbaColors = {
    urgent:'var(--red)', warn:'var(--amber)', expand:'var(--green)',
    renew:'var(--teal)', ok:'var(--blue)'
  };
  const nbaColor = nbaColors[nba.level] || 'var(--blue)';

  el('dm-overview').innerHTML = `
    <!-- Next Best Action banner -->
    <div style="background:${nbaColor}0f;border:1.5px solid ${nbaColor}33;border-radius:var(--r);padding:13px 15px;margin-bottom:16px">
      <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:${nbaColor};margin-bottom:5px">Next Best Action</div>
      <div style="font-weight:700;font-size:.9rem;color:var(--text);margin-bottom:5px">${nba.action}</div>
      <div style="font-size:.79rem;color:var(--muted);line-height:1.6">${nba.talk}</div>
    </div>
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;flex-wrap:wrap">
      ${buildRingHTML(c.score, c.status)}
      <div style="flex:1;min-width:0">
        <div style="font-size:2rem;font-weight:800;line-height:1;letter-spacing:-.03em">${c.score}<span style="font-size:.9rem;font-weight:500;color:var(--muted)"> / 100</span></div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${badgeHTML(c.status)}
          ${momentumHTML(c)}
          ${deltaHTML(delta)}
        </div>
        <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;font-size:.78rem">
          <div>
            <label style="display:block;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:2px">Manager</label>
            <select id="di-manager" onchange="if(this.value==='__add_new__'){this.style.display='none';document.getElementById('di-manager-new').style.display='';document.getElementById('di-manager-new').focus()}" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.78rem;background:var(--bg);color:var(--text)">${buildManagerSelectOptions(c.manager||'')}</select>
            <input type="text" id="di-manager-new" placeholder="New manager name..." style="display:none;width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.78rem;background:var(--bg);color:var(--text);margin-top:4px" onblur="if(!this.value){this.style.display='none';document.getElementById('di-manager').style.display='';document.getElementById('di-manager').value=''}" />
          </div>
          <div>
            <label style="display:block;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:2px">Tier</label>
            <select id="di-tier" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.78rem;background:var(--bg);color:var(--text)">
              <option value="smb" ${c.tier==='smb'?'selected':''}>SMB</option>
              <option value="mid" ${c.tier==='mid'?'selected':''}>Mid-Market</option>
              <option value="enterprise" ${c.tier==='enterprise'?'selected':''}>Enterprise</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:2px">Lifecycle</label>
            <select id="di-lifecycle" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.78rem;background:var(--bg);color:var(--text)">
              <option value="onboarding" ${c.lifecycle==='onboarding'?'selected':''}>Onboarding</option>
              <option value="active" ${c.lifecycle==='active'?'selected':''}>Active</option>
              <option value="atrisk" ${c.lifecycle==='atrisk'?'selected':''}>At Risk</option>
              <option value="won" ${c.lifecycle==='won'?'selected':''}>Won/Upsold</option>
              <option value="churned" ${c.lifecycle==='churned'?'selected':''}>Churned</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:2px">Next Touch</label>
            <input type="date" id="di-next-touch" value="${c.next_touch||''}" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.78rem;background:var(--bg);color:var(--text)" />
          </div>
          <div style="grid-column:1/-1">
            <label style="display:block;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:2px">Tags</label>
            <input type="text" id="di-tags" value="${escHtml((c.tags||[]).join(', '))}" placeholder="Comma-separated" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.78rem;background:var(--bg);color:var(--text)" />
          </div>
        </div>
        <div style="margin-top:6px;font-size:.76rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:10px">
          <span>MRR: <strong style="color:var(--text)">${c.mrr ? '$'+fmtNum(c.mrr) : '—'}</strong></span>
          ${c.scoring_profile ? `<span>Profile: <strong style="color:var(--text)">${escHtml(c.scoring_profile)}</strong></span>` : ''}
        </div>
      </div>
    </div>
    <!-- Signals row: cadence + urgency + sentiment -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;background:var(--bg);border-radius:var(--r);border:1px solid var(--border)">
      <div style="flex:1;min-width:110px">
        <div style="font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:3px">Check-in</div>
        <span class="${cad.cls}">${cad.label}</span>
      </div>
      <div style="flex:1;min-width:110px">
        <div style="font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:3px">Renewal</div>
        ${c.renewal != null ? urgencyHTML(c) + ` <span style="font-size:.7rem;color:var(--muted);margin-left:4px">(${c.renewal}mo)</span>` : '<span style="font-size:.75rem;color:var(--muted)">—</span>'}
      </div>
      <div style="flex:1;min-width:110px">
        <div style="font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:3px">Last Vibe</div>
        ${sentIcon ? `<span style="font-size:.85rem">${sentIcon}</span> <span style="font-size:.75rem;color:var(--muted)">${fmtDate(sent.date)}</span>` : '<span style="font-size:.75rem;color:var(--muted)">—</span>'}
      </div>
      <div style="flex:1;min-width:110px">
        <div style="font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:3px">Next Touch</div>
        ${(()=>{
          if (!c.next_touch) return '<span style="font-size:.75rem;color:var(--muted)">Not scheduled</span>';
          const ntDays = Math.round((new Date(c.next_touch) - new Date()) / 86400000);
          if (ntDays < 0)  return `<span class="nt-badge nt-overdue">Overdue ${Math.abs(ntDays)}d</span>`;
          if (ntDays === 0) return `<span class="nt-badge nt-today">Today</span>`;
          return `<span class="nt-badge nt-ok">in ${ntDays}d</span>`;
        })()}
      </div>
    </div>
    <div class="rec-box" style="margin-bottom:14px">${rec}</div>
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      <button class="btn btn-primary btn-sm" onclick="saveDetailInline()" style="gap:4px">💾 Save Changes</button>
    </div>
    <div class="bd-title">Signal Breakdown</div>
    ${buildBreakdownHTML(signals, c)}
  `;
}

async function saveDetailInline() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;

  const mgrSelect = document.getElementById('di-manager');
  const mgrNew    = document.getElementById('di-manager-new');
  const tierInput = document.getElementById('di-tier');
  const lcInput  = document.getElementById('di-lifecycle');
  const ntInput  = document.getElementById('di-next-touch');
  const tagsInput = document.getElementById('di-tags');

  if (mgrNew && mgrNew.style.display !== 'none' && mgrNew.value.trim()) {
    c.manager = mgrNew.value.trim();
  } else if (mgrSelect && mgrSelect.value && mgrSelect.value !== '__add_new__') {
    c.manager = mgrSelect.value;
  }
  if (tierInput) c.tier      = tierInput.value;
  if (lcInput)   c.lifecycle = lcInput.value;
  if (ntInput)   c.next_touch = ntInput.value || null;
  if (tagsInput) {
    c.tags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
  }

  try {
    await save(c);
    refreshMgrDropdown();
    renderDetailOverview();
    // Update modal header subtitle
    el('dm-sub').innerHTML = `
      ${badgeHTML(c.status)} ${lifecycleBadge(c.lifecycle)}
      <span style="margin-left:6px;color:var(--muted)">Score: <strong>${c.score}</strong></span>
      ${c.mrr ? `<span style="margin-left:6px;color:var(--muted)">MRR: <strong>$${fmtNum(c.mrr)}</strong></span>` : ''}
    `;
    toast('Changes saved', 'success');
  } catch (err) {
    console.error('Save failed:', err);
    toast('Save failed — ' + (err.message || 'unknown error'), 'error');
  }
}

function buildRingHTML(score, status) {
  const col = STATUS_COLOR[status] || '#16a34a';
  const circ   = 2 * Math.PI * 34;
  const offset = circ - (score/100)*circ;
  return `
    <div style="position:relative;width:90px;height:90px;flex-shrink:0">
      <svg viewBox="0 0 90 90" width="90" height="90" style="transform:rotate(-90deg)">
        <circle cx="45" cy="45" r="34" fill="none" stroke="var(--border)" stroke-width="8"/>
        <circle cx="45" cy="45" r="34" fill="none" stroke="${col}" stroke-width="8"
          stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
      </svg>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:800">${score}</div>
    </div>`;
}

function buildBreakdownHTML(signals, c) {
  const w = c ? getActiveWeights(c) : weights;
  const total = (w.logins + w.adoption + w.tickets + w.nps + w.days + w.growth) || 100;
  const defs = [
    { key:'logins_n',   label:'Login Frequency', color:'var(--blue)',   weight:w.logins,   raw: c ? `${c.logins} logins/mo`  : '' },
    { key:'adoption_n', label:'Feature Adoption', color:'var(--green)',  weight:w.adoption, raw: c ? `${c.adoption}% adopted`  : '' },
    { key:'tickets_n',  label:'Support Health',   color:'var(--red)',    weight:w.tickets,  raw: c ? `${c.tickets} tickets`    : '' },
    { key:'nps_n',      label:'NPS / CSAT',       color:'var(--purple)', weight:w.nps,      raw: c ? c.nps                     : '' },
    { key:'days_n',     label:'Contact Recency',  color:'var(--teal)',   weight:w.days,     raw: c ? `${c.days}d ago`          : '' },
    { key:'growth_n',   label:'Growth Signal',    color:'var(--green)',  weight:w.growth,   raw: c ? c.growth                  : '' }
  ];
  return defs.map(d => `
    <div class="bd-row">
      <div class="bd-label">${d.label}</div>
      <div class="bd-weight">${Math.round((d.weight / total) * 100)}%</div>
      <div class="bd-bar"><div class="bd-fill" style="width:${Math.round(signals[d.key])}%;background:${d.color}"></div></div>
      <div class="bd-score">${Math.round(signals[d.key])}</div>
      ${d.raw ? `<div class="bd-raw">${d.raw}</div>` : ''}
    </div>`).join('');
}

function renderDetailPlaybook() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const plays = buildPlaybook(c.score, c);
  const playTypeMap2 = { urgent:'U', engage:'E', coach:'C', adopt:'A', support:'S', expand:'X', renew:'R', ok:'OK' };
  const playClsMap2  = { urgent:'play-urgent', engage:'play-engage', coach:'play-coach', adopt:'play-adopt', support:'play-support', expand:'play-expand', renew:'play-renew', ok:'play-ok' };
  const checks = c.playbook_checks || {};
  const done = Object.keys(checks).length;
  const pct  = plays.length ? Math.round((done / plays.length) * 100) : 0;
  const header = plays.length > 1
    ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div class="playbook-title" style="margin:0">Action Playbook for ${escHtml(c.name)}</div>
        <span style="margin-left:auto;font-size:.72rem;color:var(--muted)">${done}/${plays.length} done</span>
        <div style="width:60px;height:5px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:var(--green);border-radius:3px"></div>
        </div>
      </div>`
    : `<div class="playbook-title" style="margin-bottom:10px">Action Playbook for ${escHtml(c.name)}</div>`;
  el('dm-playbook').innerHTML = header +
    plays.map((p, i) => {
      const checked = !!checks[i];
      const cls = playClsMap2[p.type] || '';
      const ltr = playTypeMap2[p.type] || '!';
      return `<label class="play-item${checked ? ' play-done' : ''}">
        <input type="checkbox" style="flex-shrink:0;margin-top:2px" ${checked ? 'checked' : ''} onchange="togglePlayCheck(${i},this.checked)" onclick="event.stopPropagation()">
        <div class="play-item__icon ${cls}">${ltr}</div>
        <div class="play-item__text">${p.text}</div>
      </label>`;
    }).join('');
}

function togglePlayCheck(idx, checked) {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  c.playbook_checks = c.playbook_checks || {};
  if (checked) c.playbook_checks[idx] = true;
  else delete c.playbook_checks[idx];
  atUpdate(c).catch(() => {});
  renderDetailPlaybook();
}

function renderDetailNotes() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const notes = c.notes || [];
  el('dm-notes-list').innerHTML = notes.length
    ? notes.map((n,i) => `
        <div class="note-item">
          <div class="note-hd">
            <span class="note-date">${fmtDate(n.date)}</span>
            <button class="btn btn-xs btn-danger" onclick="deleteNote(${i})">✕</button>
          </div>
          <div class="note-text">${escHtml(n.text)}</div>
        </div>`).join('')
    : '<p style="font-size:.82rem;color:var(--muted)">No notes yet. Add one below.</p>';
  el('note-input').value = '';
}

function addNote() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const text = el('note-input').value.trim();
  if (!text) return;
  c.notes = c.notes || [];
  c.notes.unshift({ text, date: new Date().toISOString() });
  renderDetailNotes();
  logAudit('note_added', c.id, c.name, { summary: `Note: "${text.substring(0, 100)}${text.length > 100 ? '…' : ''}"` });
  save(c).then(() => toast('Note added', 'success'))
         .catch(e => { console.error('Note save failed:', e); toast('Saved locally — sync failed', 'warn'); });
}

function deleteNote(idx) {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  c.notes.splice(idx,1);
  renderDetailNotes();
  save(c).catch(e => console.error('Note delete sync failed:', e));
}

function renderDetailHistory() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const hist = c.history || [];

  // Sparkline
  el('dm-history-sparkline').innerHTML = hist.length >= 2
    ? buildSparkline(hist.map(h=>h.score), 260, 60)
    : '<p style="font-size:.8rem;color:var(--muted)">Score at least twice to see trend.</p>';

  // List — newest first; arr[i+1] = previous (older) entry
  el('dm-history-list').innerHTML = hist.length
    ? [...hist].reverse().map((h, i, arr) => {
        const dotColor = STATUS_COLOR[getStatus(h.score)] || '#16a34a';
        const prev = arr[i + 1];

        // Score delta badge
        let deltaHtml = '';
        if (prev != null) {
          const d = h.score - prev.score;
          if      (d > 0) deltaHtml = `<span class="delta-up" style="font-size:.72rem">▲${d}</span>`;
          else if (d < 0) deltaHtml = `<span class="delta-dn" style="font-size:.72rem">▼${Math.abs(d)}</span>`;
          else             deltaHtml = `<span class="delta-eq" style="font-size:.72rem">→0</span>`;
        }

        // Signal diff — what actually changed
        const changes = diffSnapshots(h.signals || null, prev ? (prev.signals || null) : null);
        let reasonHtml = '';
        if (changes.length) {
          reasonHtml = `<div class="hist-reason">${changes.map(escHtml).join(' &nbsp;·&nbsp; ')}</div>`;
        } else if (!prev) {
          reasonHtml = `<div class="hist-reason" style="font-style:italic">Initial score entry</div>`;
        } else if (!h.signals) {
          // Old entry with no signals stored — just say no detail available
          reasonHtml = `<div class="hist-reason" style="color:var(--subtle);font-style:italic">No signal detail (pre-v18 entry)</div>`;
        } else {
          reasonHtml = `<div class="hist-reason" style="font-style:italic">All signals unchanged</div>`;
        }

        return `
          <div class="hist-row">
            <div class="hist-dot" style="background:${dotColor}"></div>
            <div class="hist-score">${h.score}</div>
            ${deltaHtml}
            <div>${badgeHTML(getStatus(h.score))}</div>
            <div class="hist-date">${fmtDate(h.date)}</div>
          </div>
          ${reasonHtml}`;
      }).join('')
    : '<p style="font-size:.82rem;color:var(--muted)">No history yet.</p>';
}

function buildSparkline(values, w, h) {
  if (values.length < 2) return '';
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 100);
  const range = max - min || 1;
  const xStep = (w - 10) / (values.length - 1);
  const points = values.map((v,i) => {
    const x = 5 + i * xStep;
    const y = h - 5 - ((v - min) / range) * (h - 10);
    return `${x},${y}`;
  }).join(' ');
  const last  = values[values.length-1];
  const prev  = values[values.length-2];
  const color = last > prev ? '#16a34a' : last < prev ? '#dc2626' : '#64748b';
  return `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="sparkline">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${values.map((v,i)=>{
        const x = 5+i*xStep, y = h-5-((v-min)/range)*(h-10);
        return `<circle cx="${x}" cy="${y}" r="3" fill="${color}" opacity="${i===values.length-1?1:.5}"/>`;
      }).join('')}
    </svg>`;
}

// Mini sparkline for customer table cells — reuses buildSparkline() at small scale
function buildSparklineMini(c) {
  const hist = (c.history||[]).slice(-10); // last 10 score points
  if (hist.length < 2) return '<span style="color:var(--subtle);font-size:.7rem">—</span>';
  return buildSparkline(hist.map(h=>h.score), 72, 22);
}

function editCustomer(id) {
  const cid = id || detailId;
  if (!cid) return;
  const c = customers.find(x => x.id === cid);
  if (!c) return;

  closeModal('detail-modal');
  nav('score');
  document.getElementById('form-title').textContent = 'Re-score: ' + c.name;
  document.getElementById('score-form').dataset.editId = c.id;

  el('f-name').value     = c.name;
  // Reset manager fields: hide "new" input, show select, rebuild options, set value
  const fmNew = document.getElementById('f-manager-new');
  if (fmNew) { fmNew.style.display = 'none'; fmNew.value = ''; }
  const fmSel = el('f-manager');
  if (fmSel) { fmSel.style.display = ''; fmSel.innerHTML = buildManagerSelectOptions(c.manager || ''); }
  if (el('f-profile')) { refreshProfileDropdown(); el('f-profile').value = c.scoring_profile || ''; }
  el('f-mrr').value      = c.mrr   || '';
  if (el('f-arr'))   el('f-arr').value   = c.arr   || '';
  if (el('f-since')) el('f-since').value = c.since || '';
  el('f-tier').value     = c.tier || 'mid';
  el('f-lifecycle').value= c.lifecycle || 'active';
  el('f-tags').value     = (c.tags||[]).join(', ');
  el('f-logins').value   = c.logins;     rv('logins',   c.logins+'  days');
  el('f-adoption').value = c.adoption;   rv('adoption', c.adoption+'%');
  el('f-tickets').value  = c.tickets;
  el('f-nps').value      = c.nps;
  el('f-days').value     = c.days;       rv('days', c.days+' days');
  if (el('f-renewal-date')) el('f-renewal-date').value = c.renewal_date || '';
  if (el('f-next-touch'))  el('f-next-touch').value  = c.next_touch   || '';
  el('f-growth').value   = c.growth || 'none';
  el('f-note').value     = '';

  // Override saveScore to update in-place
  window._editMode = c.id;
}

// Patch submitForm to handle edit mode
const _origSubmit = HTMLFormElement.prototype.submit;
document.getElementById('score-form').addEventListener('submit', function(e) {
  // handled by onsubmit
});

// Patch saveScore for edit mode
const _origSaveScore = saveScore;
window.saveScore = function() {
  const editId = document.getElementById('score-form').dataset.editId;
  if (editId) {
    const c = customers.find(x => x.id === editId);
    if (c && pendingResult) {
      const { data, score, status } = pendingResult;
      /* Capture before-state for audit diff */
      const before = { name:c.name, manager:c.manager||'', score:c.score, status:c.status, mrr:c.mrr, arr:c.arr, tier:c.tier, lifecycle:c.lifecycle, logins:c.logins, adoption:c.adoption, tickets:c.tickets, nps:c.nps, days:c.days, growth:c.growth||'none', scoring_profile:c.scoring_profile||'' };
      c.name            = data.name;
      c.manager         = data.manager || '';
      c.scoring_profile = data.profile || '';
      c.score           = score;
      c.status          = status;
      c.logins          = data.logins;
      c.adoption        = data.adoption;
      c.tickets         = data.tickets;
      c.nps             = data.nps;
      c.days            = data.days;
      c._baseDays       = data.days;
      c.renewal         = data.renewal;
      c.renewal_date    = data.renewal_date || '';
      c.next_touch      = (el('f-next-touch') ? el('f-next-touch').value : '') || '';
      c.growth          = data.growth;
      c.mrr             = data.mrr;
      c.arr             = data.arr || (data.mrr * 12);
      c.since           = data.since || '';
      c.tier            = data.tier;
      c.lifecycle       = data.lifecycle;
      c.tags            = data.tags;
      if (data.note) {
        c.notes = c.notes || [];
        c.notes.unshift({ text: data.note, date: new Date().toISOString() });
      }
      c.history = c.history || [];
      c.history.push({ score, date: new Date().toISOString(), signals: buildHistorySnapshot(data) });
      setLoading(true);
      save(c).then(() => { setLoading(false); toast('Updated: ' + c.name, 'success'); })
              .catch(() => { setLoading(false); toast('Updated locally — sync failed', 'warn'); });
      /* Build granular audit diff */
      const after = { name:c.name, manager:c.manager, score, status, mrr:c.mrr, arr:c.arr, tier:c.tier, lifecycle:c.lifecycle, logins:c.logins, adoption:c.adoption, tickets:c.tickets, nps:c.nps, days:c.days, growth:c.growth||'none', scoring_profile:c.scoring_profile||'' };
      const changes = Object.keys(after).filter(k => String(before[k]) !== String(after[k])).map(k => `${k}: ${before[k]} → ${after[k]}`);
      const summaryText = changes.length ? changes.join(', ') : 'Re-scored (no field changes)';
      logAudit('customer_updated', c.id, c.name, { score, status, summary: summaryText });
      pendingResult = null;
      resetForm();
      nav('customers');
      return;
    }
  }
  _origSaveScore();
};

function deleteFromModal() {
  if (!detailId) return;
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  confirmAction(`Move "${c.name}" to Trash?`, async () => {
    c.deleted_at = new Date().toISOString();
    trash.push(c);
    customers = customers.filter(x => x.id !== detailId);
    closeModal('detail-modal');
    toast(`${c.name} moved to Trash`, 'warn');
    logAudit('customer_deleted', c.id, c.name, { summary: `Moved to trash — Score: ${c.score}/100, MRR: $${c.mrr||0}, Tier: ${c.tier}` });
    renderCustomers();
    setLoading(true);
    await atDelete(c).catch(()=>{});
    setLoading(false);
  });
}

function deleteCustomer(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  confirmAction(`Move "${c.name}" to Trash?`, async () => {
    c.deleted_at = new Date().toISOString();
    trash.push(c);
    customers = customers.filter(x => x.id !== id);
    toast(`${c.name} moved to Trash`, 'warn');
    logAudit('customer_deleted', c.id, c.name, { summary: `Moved to trash — Score: ${c.score}/100, MRR: $${c.mrr||0}, Tier: ${c.tier}` });
    renderCustomers();
    setLoading(true);
    await atDelete(c).catch(()=>{});
    setLoading(false);
  });
}

function confirmAction(msg, onOk) {
  el('confirm-msg').textContent = msg;
  el('confirm-ok').onclick = () => { closeModal('confirm-modal'); onOk(); };
  openModal('confirm-modal');
}

// ─── WEEKLY DIGEST (v86) ────────────────────────────────────

function showDigestPreview() {
  el('digest-preview').innerHTML = buildDigestHTML();
  openModal('digest-modal');
}

function buildDigestHTML() {
  const active = customers.filter(c => c.lifecycle !== 'churned');
  const critical = active.filter(c => c.status === 'critical').length;
  const atRisk   = active.filter(c => c.status === 'risk').length;
  const avgScore = active.length ? Math.round(active.reduce((s,c)=>s+c.score,0)/active.length) : 0;
  const totalMrr = active.reduce((s,c)=>s+(c.mrr||0),0);

  // Top at-risk (worst score first)
  const topRisk = [...active].filter(c=>c.status==='critical'||c.status==='risk')
    .sort((a,b)=>a.score-b.score).slice(0,3);

  // Upcoming renewals in next 7 days
  const now = new Date();
  const in7  = new Date(now); in7.setDate(now.getDate()+7);
  const upcoming = active.filter(c => {
    if (!c.renewal_date) return false;
    const d = new Date(c.renewal_date);
    return d >= now && d <= in7;
  }).sort((a,b)=>new Date(a.renewal_date)-new Date(b.renewal_date));

  // Score movers (need ≥2 history points)
  const withHist = active.filter(c=>(c.history||[]).length>=2);
  const deltas = withHist.map(c=>{
    const hist=c.history;
    const delta=hist[hist.length-1].score - hist[hist.length-2].score;
    return {c,delta};
  });
  const improved = [...deltas].filter(x=>x.delta>0).sort((a,b)=>b.delta-a.delta).slice(0,3);
  const dropped  = [...deltas].filter(x=>x.delta<0).sort((a,b)=>a.delta-b.delta).slice(0,3);

  const week = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  const sdot = s=>({critical:'🔴',risk:'🟠',watch:'🟡',healthy:'🟢',expand:'✨'}[s]||'⚪');

  return `<div style="max-width:580px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:linear-gradient(90deg,#2e3fa3,#4a6fd4);color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <div style="font-size:18px;font-weight:700">IQcadence CS Health Digest</div>
      <div style="font-size:12px;opacity:.8;margin-top:2px">Week of ${week}</div>
    </div>
    <div style="padding:20px 24px;background:#f8fafc;border-radius:0 0 8px 8px">

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
        ${[
          ['Total Accounts', active.length, '#1e293b'],
          ['Critical / At Risk', critical+' / '+atRisk, (critical+atRisk)>0?'#dc2626':'#16a34a'],
          ['Avg Health Score', avgScore, avgScore>=80?'#16a34a':avgScore>=65?'#d97706':'#dc2626'],
          ['Total MRR', '$'+fmtNum(totalMrr), '#2e3fa3'],
        ].map(([lbl,val,col])=>`<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:${col}">${val}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">${lbl}</div>
        </div>`).join('')}
      </div>

      ${topRisk.length?`<div style="margin-bottom:18px">
        <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">🚨 Accounts Needing Attention</div>
        ${topRisk.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9">
          <div>${sdot(c.status)} <strong>${escHtml(c.name)}</strong></div>
          <div style="font-size:12px;color:#64748b">Score ${c.score} · MRR $${fmtNum(c.mrr||0)}</div>
        </div>`).join('')}
      </div>`:``}

      ${upcoming.length?`<div style="margin-bottom:18px">
        <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">📅 Renewals This Week</div>
        ${upcoming.map(c=>{
          const days=Math.round((new Date(c.renewal_date)-now)/86400000);
          return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9">
            <div>${sdot(c.status)} <strong>${escHtml(c.name)}</strong></div>
            <div style="font-size:12px;color:#64748b">${days===0?'Today':days===1?'Tomorrow':'in '+days+'d'} · $${fmtNum(c.mrr||0)}/mo</div>
          </div>`;
        }).join('')}
      </div>`:``}

      ${(improved.length||dropped.length)?`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
        ${improved.length?`<div>
          <div style="font-size:12px;font-weight:700;color:#16a34a;margin-bottom:6px">📈 Most Improved</div>
          ${improved.map(({c,delta})=>`<div style="font-size:12px;padding:4px 0">${escHtml(c.name)} <span style="color:#16a34a;font-weight:700">+${delta}</span></div>`).join('')}
        </div>`:''}
        ${dropped.length?`<div>
          <div style="font-size:12px;font-weight:700;color:#dc2626;margin-bottom:6px">📉 Biggest Drops</div>
          ${dropped.map(({c,delta})=>`<div style="font-size:12px;padding:4px 0">${escHtml(c.name)} <span style="color:#dc2626;font-weight:700">${delta}</span></div>`).join('')}
        </div>`:''}
      </div>`:``}

      <div style="font-size:11px;color:#94a3b8;text-align:center;margin-top:8px">Generated by IQcadence CS Health Score · ${week}</div>
    </div>
  </div>`;
}

function copyDigestHTML() {
  const html = buildDigestHTML();
  navigator.clipboard.writeText(html)
    .then(()=>toast('HTML copied to clipboard','success'))
    .catch(()=>toast('Copy failed — try downloading instead','error'));
}

function downloadDigestHTML() {
  const inner = buildDigestHTML();
  const full = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CS Health Digest</title></head><body style="margin:0;padding:20px;background:#f1f5f9">${inner}</body></html>`;
  const blob = new Blob([full], { type:'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cs-digest-${new Date().toISOString().slice(0,10)}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Digest downloaded','success');
}

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

// ── Tab switching ──
function autoTab(which) {
  ['active','create','advanced'].forEach(t => {
    el('auto-tab-'+t)?.classList.toggle('active', t === which);
    el('auto-pane-'+t)?.classList.toggle('active', t === which);
  });
  if (which === 'active') renderActiveAlerts();
  if (which === 'create') { wizardGoToStep(_wizardStep); renderWizardNav(); }
  if (which === 'advanced') {
    renderWebhookConfig();
    renderApiSection();
    loadWebhookLog();
  }
}

// ── Main render ──
function renderAutomations() {
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
    desc: 'Fires when a customer\'s lifecycle transitions to "atrisk" or "churned".',
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
      score: c.score, status: c.status, nps: c.nps,
      lifecycle: c.lifecycle, renewal_date: c.renewal_date, days: c.days
    });
  });
}

function _snapFields(c) {
  return { score: c.score, status: c.status, nps: c.nps, lifecycle: c.lifecycle, renewal_date: c.renewal_date, days: c.days };
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
  if (prev && prev.nps !== 'detractor' && c.nps === 'detractor') {
    triggeredEvents.push({ key: 'nps_detractor',
      extra: { trigger: 'nps_detractor', previous_nps: prev.nps, current_nps: c.nps } });
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
      nps:               customer.nps || ''
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
      { type: 'mrkdwn', text: `*Days Since Contact:*\n${c.days || 0}` },
      { type: 'mrkdwn', text: `*NPS:*\n${c.nps || '—'}` },
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
    { title: 'Days Since Contact', value: String(c.days || 0) },
    { title: 'NPS', value: c.nps || '—' },
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
        <td style="padding:8px 12px;font-size:13px;font-weight:600">${c.days || 0}</td>
      </tr>
      <tr style="background:#f9fafb">
        <td style="padding:8px 12px;font-size:13px;color:#6b7280">NPS</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:600">${escHtml(c.nps || '—')}</td>
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


// ─── SETTINGS ───────────────────────────────────────────────
function cfgTab(which) {
  ['config','account'].forEach(t => {
    el('cfg-tab-'+t)?.classList.toggle('active', t === which);
    el('cfg-pane-'+t)?.classList.toggle('active', t === which);
  });
}

function auditTab(which) {
  document.querySelectorAll('#view-auditlog .dtab').forEach(b => {
    const key = b.textContent.trim().toLowerCase().startsWith('activity') ? 'activity' : 'config';
    b.classList.toggle('active', key === which);
  });
  ['activity','config'].forEach(t => {
    const pane = el('audit-pane-'+t);
    if (pane) pane.classList.toggle('active', t === which);
  });
  if (which === 'config') renderConfigHistory();
}

function renderSettings() {
  // Always reset to Config tab on navigation
  cfgTab('config');

  // Thresholds (available to all tiers)
  el('th-critical').value = thresholds.critical;
  el('th-risk').value     = thresholds.risk;
  el('th-watch').value    = thresholds.watch;
  el('th-healthy').value  = thresholds.healthy;
  updateThresholdLabels();

  // Weights — available to ALL tiers (ungated)
  const weightCard = el('weight-rows')?.closest('.card');
  if (weightCard) {
    weightCard.style.opacity = ''; weightCard.style.pointerEvents = '';
    weightCard.querySelector('.upgrade-overlay')?.remove();
  }

  // Scoring Profiles — gated to Growth tier
  const profileCard = el('profiles-list')?.closest('.card');
  if (profileCard) {
    if (hasFeature('scoring_profiles')) {
      profileCard.style.opacity = ''; profileCard.style.pointerEvents = '';
      profileCard.querySelector('.upgrade-overlay')?.remove();
    } else {
      profileCard.style.position = 'relative';
      if (!profileCard.querySelector('.upgrade-overlay')) {
        const ov = document.createElement('div');
        ov.className = 'upgrade-overlay';
        ov.style.cssText = 'position:absolute;inset:0;background:rgba(255,255,255,.85);z-index:5;display:flex;align-items:center;justify-content:center;border-radius:14px';
        ov.innerHTML = upgradeHTML('scoring_profiles');
        profileCard.appendChild(ov);
      }
    }
  }

  renderWeightRows();
  renderProfiles();
  refreshProfileDropdown();
  renderScoreDistribution();
  renderDataHealth();
}

// Populate the per-customer profile dropdown in the score form
function refreshProfileDropdown() {
  const sel = el('f-profile');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Global Weights</option>' +
    profiles.filter(p => p.name !== 'Global Weights').map(p => `<option value="${escHtml(p.name)}">${escHtml(p.name)}</option>`).join('');
  // Restore selection if the profile still exists
  if (profiles.find(p => p.name === current)) sel.value = current;
}

function renderWeightRows() {
  const keys = ['logins','adoption','tickets','nps','days','growth'];
  el('weight-rows').innerHTML = keys.map(k => `
    <div class="weight-row">
      <div class="weight-label">${WEIGHT_LABELS[k]}</div>
      <input type="range" min="0" max="100" value="${weights[k]}" id="wr-${k}"
        oninput="updateWeightFromSlider('${k}',this.value)" style="flex:1;cursor:pointer;accent-color:var(--blue)"/>
      <div class="weight-pct"><input type="number" min="0" max="100" value="${weights[k]}" id="wp-${k}"
        oninput="updateWeightFromInput('${k}',this.value)"
        style="width:42px;text-align:center;border:1.5px solid var(--border);border-radius:6px;padding:2px 2px;font-size:.78rem;font-weight:700;font-family:var(--font);color:var(--text);outline:none;background:var(--surface);-moz-appearance:textfield"
        onfocus="this.select()"/><span style="font-size:.78rem;font-weight:700;margin-left:1px">%</span></div>
    </div>`).join('');
  updateTotalBar();
}

function updateWeightFromSlider(key, val) {
  const v = Math.max(0, Math.min(100, parseInt(val)||0));
  const inp = el('wp-'+key);
  if (inp) inp.value = v;
  updateTotalBar();
}

function updateWeightFromInput(key, val) {
  const v = Math.max(0, Math.min(100, parseInt(val)||0));
  const slider = el('wr-'+key);
  if (slider) slider.value = v;
  updateTotalBar();
}

function updateTotalBar() {
  const keys = ['logins','adoption','tickets','nps','days','growth'];
  const total = keys.reduce((s,k) => s + parseInt(el('wr-'+k)?.value||0), 0);
  const fill  = el('total-fill');
  const lbl   = el('total-label');
  fill.style.width      = Math.min(total,100) + '%';
  fill.style.background = total===100 ? 'var(--green)' : total>100 ? 'var(--red)' : 'var(--amber)';
  lbl.textContent       = `Total: ${total}% ${total===100?'(good)':total>100?'— over 100%':'— needs '+( 100-total)+'%'}`;
  lbl.style.color       = total===100 ? 'var(--green)' : 'var(--red)';
}

function saveWeights() {
  const keys = ['logins','adoption','tickets','nps','days','growth'];
  const total = keys.reduce((s,k) => s + parseInt(el('wr-'+k)?.value||0), 0);
  if (total !== 100) { toast('Weights must total exactly 100%', 'error'); return; }
  const prev = { ...weights };
  keys.forEach(k => { weights[k] = parseInt(el('wr-'+k).value); });
  ensureGlobalWeightsProfile();   // sync profiles[0] from updated weights
  saveSettings();
  const changed = keys.filter(k => prev[k] !== weights[k]).map(k => `${WEIGHT_LABELS[k]||k}: ${prev[k]}→${weights[k]}`);
  logAudit('weights_updated', null, '', { summary: `Global weights changed: ${changed.join(', ')}`, weights: { ...weights } });
  rescoreByProfile('Global Weights');
  filterMode = 'all';
  renderDashboard();
  renderCustomers();
  renderAlerts();
  renderProfiles();
  refreshProfileDropdown();
  resetEditingState();
  logConfigChange('Global weights updated');
  renderScoreDistribution();
  toast('Weights saved!', 'success');
}

function resetWeights() {
  const keys = ['logins','adoption','tickets','nps','days','growth'];
  keys.forEach(k => {
    const input = el('wr-' + k);
    if (input) input.value = DEFAULT_WEIGHTS[k];
    const pct = el('wp-' + k);
    if (pct) pct.value = DEFAULT_WEIGHTS[k];
  });
  updateTotalBar();
  resetEditingState();
  renderScoreDistribution({ ...DEFAULT_WEIGHTS });
  toast('Sliders reset to defaults', 'default');
}

function saveWeightsAsProfile() {
  const keys = ['logins','adoption','tickets','nps','days','growth'];
  const total = keys.reduce((s,k) => s + parseInt(el('wr-'+k)?.value||0), 0);
  if (total !== 100) { toast('Weights must total 100% first', 'error'); return; }
  const sliderWeights = {};
  keys.forEach(k => { sliderWeights[k] = parseInt(el('wr-'+k).value); });
  // Open profile modal in "new" mode, pre-filled with current slider values
  const nameInput = el('profile-name-input');
  nameInput.value = '';
  nameInput.readOnly = false;
  nameInput.style.opacity = '';
  nameInput.style.cursor  = '';
  el('profile-modal').dataset.editIdx = '-1';
  if (el('profile-modal-title')) el('profile-modal-title').textContent = 'New Scoring Profile';
  if (el('profile-confirm-btn')) el('profile-confirm-btn').textContent = 'Save Profile';
  renderProfileModalWeights(sliderWeights);
  openModal('profile-modal');
}

function rescoreAll() {
  const keys = ['logins','adoption','tickets','nps','days','growth'];
  const total = keys.reduce((s,k) => s + parseInt(el('wr-'+k)?.value||0), 0);
  if (total !== 100) { toast('Save weights first (must total 100%)', 'error'); return; }
  let n = 0;
  const changed = [];
  customers.forEach(c => {
    const profileMatch = c.scoring_profile ? profiles.find(p => p.name === c.scoring_profile) : null;
    const resolvedWeights = profileMatch ? profileMatch.weights : weights;
    const { score } = calcScore(c, resolvedWeights);
    if (c.score !== score) {
      c.history = c.history || [];
      c.history.push({ score, date: new Date().toISOString() });
      c.score  = score;
      c.status = getStatus(score);
      changed.push(c);
      n++;
    }
  });
  filterMode = 'all';
  renderDashboard();
  renderCustomers();
  renderAlerts();
  if (n > 0) {
    const changedNames = changed.slice(0, 5).map(c => `${c.name} (${c.score})`).join(', ') + (changed.length > 5 ? ` +${changed.length - 5} more` : '');
    logAudit('customer_scored', null, '', { summary: `Bulk re-score: ${n} updated — ${changedNames}` });
  }
  logConfigChange(`Bulk re-score: ${n} customer${n!==1?'s':''} updated`);
  renderScoreDistribution();
  toast(`Re-scored ${n} customer${n!==1?'s':''}`, 'success');
  if (changed.length) {
    setLoading(true);
    Promise.all(changed.map(c => atUpdate(c).catch(()=>{}))).finally(() => setLoading(false));
  }
}

function updateThresholdLabels() {
  const c = parseInt(el('th-critical')?.value) || 25;
  const r = parseInt(el('th-risk')?.value)     || 50;
  const w = parseInt(el('th-watch')?.value)    || 65;
  const h = parseInt(el('th-healthy')?.value)  || 80;
  if (el('th-critical-max'))  el('th-critical-max').textContent  = c - 1;
  if (el('th-risk-range'))    el('th-risk-range').textContent    = `${c}–${r - 1}`;
  if (el('th-watch-range'))   el('th-watch-range').textContent   = `${r}–${w - 1}`;
  if (el('th-healthy-range')) el('th-healthy-range').textContent = `${w}–${h - 1}`;
  if (el('th-expand-val'))    el('th-expand-val').textContent    = h;
}

function saveThresholds() {
  const c = parseInt(el('th-critical').value);
  const r = parseInt(el('th-risk').value);
  const w = parseInt(el('th-watch').value);
  const h = parseInt(el('th-healthy').value);
  if ([c,r,w,h].some(isNaN) || !(c < r && r < w && w < h)) {
    toast('Thresholds must be in ascending order: Critical < At Risk < Watch < Healthy', 'error');
    return;
  }
  const prev = { ...thresholds };
  thresholds.critical = c;
  thresholds.risk     = r;
  thresholds.watch    = w;
  thresholds.healthy  = h;
  saveSettings();
  const changed = ['critical','risk','watch','healthy'].filter(k => prev[k] !== thresholds[k]).map(k => `${k}: ${prev[k]}→${thresholds[k]}`);
  logAudit('thresholds_updated', null, '', { summary: `Thresholds changed: ${changed.join(', ')}`, thresholds: { ...thresholds } });
  updateThresholdLabels();
  logConfigChange('Thresholds updated');
  renderScoreDistribution();
  toast('Thresholds saved!', 'success');
}

function resetThresholds() {
  thresholds = { ...DEFAULT_THRESHOLDS };
  saveSettings();
  logAudit('thresholds_reset', null, '', { summary: 'Thresholds reset to defaults', thresholds: { ...thresholds } });
  el('th-critical').value = thresholds.critical;
  el('th-risk').value     = thresholds.risk;
  el('th-watch').value    = thresholds.watch;
  el('th-healthy').value  = thresholds.healthy;
  updateThresholdLabels();
  logConfigChange('Thresholds reset to defaults');
  renderScoreDistribution();
  toast('Thresholds reset to defaults', 'warn');
}

/* ── Config Command Center (v92) ───────────────────────────── */

let editingProfileIdx = -1;  // -1 = global/default, ≥0 = profile index loaded into sliders

function previewProfile(idx) {
  const p = profiles[idx];
  if (!p) return;
  editingProfileIdx = idx;
  const isGlobal = p.name === 'Global Weights';
  // Load profile weights into sliders (preview only — no save)
  const keys = ['logins','adoption','tickets','nps','days','growth'];
  keys.forEach(k => {
    const input = el('wr-' + k);
    if (input) input.value = p.weights[k] ?? 0;
    const pct = el('wp-' + k);
    if (pct) pct.value = p.weights[k] ?? 0;
  });
  updateTotalBar();
  // Update editing indicator
  const label = el('editing-profile-label');
  if (label) {
    if (isGlobal) { label.style.display = 'none'; }
    else { label.textContent = 'Editing: ' + p.name; label.style.display = ''; }
  }
  // Show/hide "Update Profile" button
  const btn = el('btn-update-profile');
  if (btn) {
    if (isGlobal) { btn.style.display = 'none'; }
    else { btn.textContent = 'Update ' + p.name; btn.style.display = ''; }
  }
  // Update score distribution with these weights
  renderScoreDistribution(p.weights);
  // Highlight active profile in list
  renderProfiles();
}

function resetEditingState() {
  editingProfileIdx = -1;
  const label = el('editing-profile-label');
  if (label) label.style.display = 'none';
  const btn = el('btn-update-profile');
  if (btn) btn.style.display = 'none';
}

function updateEditingProfile() {
  if (editingProfileIdx < 0) return;
  const p = profiles[editingProfileIdx];
  if (!p) return;
  const keys = ['logins','adoption','tickets','nps','days','growth'];
  const total = keys.reduce((s,k) => s + parseInt(el('wr-'+k)?.value||0), 0);
  if (total !== 100) { toast('Weights must total 100%', 'error'); return; }
  const newWeights = {};
  keys.forEach(k => { newWeights[k] = parseInt(el('wr-'+k).value); });
  const isGlobal = p.name === 'Global Weights';
  profiles[editingProfileIdx].weights = newWeights;
  if (isGlobal) weights = { ...newWeights };
  saveSettings();
  logAudit('profile_updated', null, '', { summary: `Profile "${p.name}" updated via slider`, profile: p.name, weights: newWeights });
  logConfigChange('Profile "' + p.name + '" updated');
  rescoreByProfile(p.name);
  renderProfiles();
  refreshProfileDropdown();
  renderScoreDistribution();
  toast('Profile "' + p.name + '" updated', 'success');
}

function cfgTimeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return 'Just now';
  if (d < 3600000) return Math.round(d / 60000) + ' min ago';
  if (d < 86400000) return Math.round(d / 3600000) + ' hrs ago';
  if (d < 604800000) return Math.round(d / 86400000) + ' days ago';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderScoreDistribution(previewWeights) {
  const wrap = el('cfg-score-dist');
  if (!wrap) return;
  if (!customers.length) { wrap.innerHTML = '<p style="font-size:.8rem;color:var(--muted)">No customer data loaded.</p>'; return; }
  const bands = { critical: 0, risk: 0, watch: 0, healthy: 0, expand: 0 };
  customers.forEach(c => {
    const w = previewWeights || getActiveWeights(c);
    const { score } = calcScore(c, w);
    bands[getStatus(score)]++;
  });
  const total = customers.length;
  const colors = { critical: '#dc2626', risk: '#ea580c', watch: '#f59e0b', healthy: '#22c55e', expand: '#14b8a6' };
  const labels = { critical: 'Critical', risk: 'At Risk', watch: 'Watch', healthy: 'Healthy', expand: 'Expansion' };
  let barH = '<div class="score-dist-bar">';
  let legH = '<div class="score-dist-legend">';
  for (const key of ['critical', 'risk', 'watch', 'healthy', 'expand']) {
    const cnt = bands[key];
    const pct = total ? (cnt / total * 100) : 0;
    if (pct > 0) barH += `<div style="width:${pct}%;background:${colors[key]}">${pct >= 8 ? cnt : ''}</div>`;
    legH += `<span><span class="dl" style="background:${colors[key]}"></span>${labels[key]}: ${cnt} (${Math.round(pct)}%)</span>`;
  }
  barH += '</div>'; legH += '</div>';
  wrap.innerHTML = barH + legH;
}

function renderDataHealth() {
  const wrap = el('cfg-data-health');
  if (!wrap) return;
  if (!customers.length) { wrap.innerHTML = '<p style="font-size:.8rem;color:var(--muted)">No customer data loaded.</p>'; return; }
  const total = customers.length;
  let stale = 0, missing = 0;
  const sigKeys = ['logins','adoption','tickets','nps','days'];
  customers.forEach(c => {
    if (c.days >= 30) stale++;
    const miss = sigKeys.filter(s => c[s] === null || c[s] === undefined || c[s] === 0 || c[s] === 'unknown');
    if (miss.length >= 2) missing++;
  });
  const complete = total - missing;
  const pct = Math.round((complete / total) * 100);
  const lr = localStorage.getItem('iqc_last_refresh');
  const refreshTxt = lr ? cfgTimeAgo(parseInt(lr)) : 'Unknown';
  wrap.innerHTML = `
    <div class="dh-stats">
      <div class="dh-row"><span>Total Customers</span><span class="dh-val">${total}</span></div>
      <div class="dh-row"><span>Last Refresh</span><span class="dh-val">${refreshTxt}</span></div>
      <div style="border-top:1px solid var(--border);margin:2px 0"></div>
      <div class="dh-row"><span>Stale Accounts (30d+)</span><span class="dh-val ${stale ? 'warn' : 'good'}">${stale ? `<a href="#" onclick="event.preventDefault();showDhDetail('stale')" style="color:inherit;text-decoration:underline;cursor:pointer">${stale} ⚠</a>` : '0'}</span></div>
      <div class="dh-row"><span>Incomplete Signals</span><span class="dh-val ${missing ? 'warn' : 'good'}">${missing ? `<a href="#" onclick="event.preventDefault();showDhDetail('incomplete')" style="color:inherit;text-decoration:underline;cursor:pointer">${missing} ⚠</a>` : '0'}</span></div>
      <div class="dh-row"><span>Complete Data</span><span class="dh-val good">${complete}</span></div>
    </div>
    <div style="font-size:.72rem;color:var(--muted);margin-bottom:6px">Data completeness</div>
    <div class="dh-bar"><div style="width:${pct}%"></div></div>
    <div style="font-size:.72rem;font-weight:700;margin-top:4px">${pct}%</div>`;
}

function showDhDetail(type) {
  const title = el('dh-detail-title');
  const body = el('dh-detail-body');
  if (!title || !body) return;
  const statusColors = { critical:'#ef4444', risk:'#f59e0b', watch:'#eab308', healthy:'#22c55e', expand:'#3b82f6' };
  const sigKeys = ['logins','adoption','tickets','nps','days'];
  const sigLabels = { logins:'Logins/wk', adoption:'Adoption %', tickets:'Open Tickets', nps:'NPS', days:'Days Since Contact' };

  const tblStyle = 'style="min-width:0;width:100%"';

  if (type === 'stale') {
    title.textContent = 'Stale Accounts (30d+ since last contact)';
    const rows = customers.filter(c => c.days >= 30).sort((a,b) => b.days - a.days);
    if (!rows.length) { body.innerHTML = '<p style="padding:12px;color:var(--muted)">No stale accounts found.</p>'; }
    else {
      body.innerHTML = `<table class="ct" ${tblStyle}><thead><tr><th>Customer</th><th>Score</th><th>Days</th><th>Logins/wk</th><th>Tier</th><th>MRR</th></tr></thead><tbody>${
        rows.map(c => {
          const st = getStatus(c.score);
          return `<tr>
            <td><a href="#" onclick="event.preventDefault();closeModal('dh-detail-modal');openDetail('${c.id}')" style="color:var(--blue);font-weight:700;text-decoration:none">${escHtml(c.name)}</a></td>
            <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColors[st]||'#888'};margin-right:4px"></span>${c.score}</td>
            <td style="font-weight:600;color:${c.days>=60?'#ef4444':c.days>=30?'#f59e0b':'inherit'}">${c.days}d</td>
            <td>${c.logins}</td>
            <td style="text-transform:uppercase;font-size:.72rem">${escHtml(c.tier)}</td>
            <td>$${fmtNum(c.mrr||0)}</td>
          </tr>`;
        }).join('')
      }</tbody></table>`;
    }
  } else if (type === 'incomplete') {
    title.textContent = 'Incomplete Signals (2+ missing)';
    const rows = [];
    customers.forEach(c => {
      const miss = sigKeys.filter(s => c[s] === null || c[s] === undefined || c[s] === 0 || c[s] === 'unknown');
      if (miss.length >= 2) rows.push({ c, miss });
    });
    rows.sort((a,b) => b.miss.length - a.miss.length);
    if (!rows.length) { body.innerHTML = '<p style="padding:12px;color:var(--muted)">No incomplete accounts found.</p>'; }
    else {
      body.innerHTML = `<table class="ct" ${tblStyle}><thead><tr><th>Customer</th><th>Score</th><th>Missing Signals</th><th>Tier</th></tr></thead><tbody>${
        rows.map(({c, miss}) => {
          const st = getStatus(c.score);
          return `<tr>
            <td><a href="#" onclick="event.preventDefault();closeModal('dh-detail-modal');openDetail('${c.id}')" style="color:var(--blue);font-weight:700;text-decoration:none">${escHtml(c.name)}</a></td>
            <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColors[st]||'#888'};margin-right:4px"></span>${c.score}</td>
            <td style="font-size:.78rem">${miss.map(s => `<span style="display:inline-block;background:rgba(239,68,68,.08);color:#b91c1c;padding:1px 6px;border-radius:4px;margin:1px 2px;font-size:.72rem">${sigLabels[s]||s}</span>`).join('')}</td>
            <td style="text-transform:uppercase;font-size:.72rem">${escHtml(c.tier)}</td>
          </tr>`;
        }).join('')
      }</tbody></table>`;
    }
  }
  openModal('dh-detail-modal');
}

function logConfigChange(action) {
  const hist = JSON.parse(localStorage.getItem('iqc_config_history') || '[]');
  hist.unshift({ action, ts: Date.now(), user: currentUser?.email || '' });
  if (hist.length > 20) hist.length = 20;
  localStorage.setItem('iqc_config_history', JSON.stringify(hist));
  renderConfigHistory();
}

function renderConfigHistory() {
  const wrap = el('cfg-change-history');
  if (!wrap) return;
  const hist = JSON.parse(localStorage.getItem('iqc_config_history') || '[]');
  if (!hist.length) {
    wrap.innerHTML = '<ul class="cfg-history"><li class="ch-empty">No config changes recorded yet.</li></ul>';
    return;
  }
  let h = '<ul class="cfg-history">';
  hist.slice(0, 10).forEach(e => {
    const userStr = e.user ? `<span style="font-size:.72rem;color:var(--muted);margin-left:6px">${escHtml(e.user)}</span>` : '';
    h += `<li><div class="ch-action">${e.action}${userStr}</div><div class="ch-time">${cfgTimeAgo(e.ts)}</div></li>`;
  });
  h += '</ul>';
  wrap.innerHTML = h;
}

function clearConfigHistory() {
  localStorage.removeItem('iqc_config_history');
  renderConfigHistory();
  toast('Config history cleared', 'default');
}

function resetAllDefaults() {
  confirmAction('Reset both thresholds and weights to factory defaults?', () => {
    thresholds = { ...DEFAULT_THRESHOLDS };
    weights    = { ...DEFAULT_WEIGHTS };
    saveSettings();
    logAudit('settings_reset', null, '', { summary: 'All settings reset to defaults' });
    logConfigChange('All settings reset to defaults');
    el('th-critical').value = thresholds.critical;
    el('th-risk').value     = thresholds.risk;
    el('th-watch').value    = thresholds.watch;
    el('th-healthy').value  = thresholds.healthy;
    updateThresholdLabels();
    resetEditingState();
    renderWeightRows();
    renderProfiles();
    renderScoreDistribution();
    renderDashboard();
    renderCustomers();
    renderAlerts();
    toast('All settings reset to defaults', 'warn');
  });
}

function renderProfiles() {
  const wrap = el('profiles-list');
  if (!profiles.length) {
    wrap.innerHTML = '<p style="font-size:.82rem;color:var(--muted)">No profiles yet.</p>';
    return;
  }
  wrap.innerHTML = profiles.map((p,i) => {
    const isGlobal = p.name === 'Global Weights';
    const isActive = i === editingProfileIdx;
    return `
    <div class="profile-row${isActive ? ' profile-active' : ''}" onclick="previewProfile(${i})">
      <div class="profile-row__name">
        ${escHtml(p.name)}
        ${isGlobal ? '<span style="font-size:.68rem;color:var(--muted);margin-left:6px;font-style:italic">default</span>' : ''}
      </div>
      <button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();editProfile(${i})">Edit</button>
      ${!isGlobal ? `<button class="btn btn-xs btn-danger" onclick="event.stopPropagation();deleteProfile(${i})">✕</button>` : ''}
    </div>`;
  }).join('');
}

// Render weight sliders inside the profile modal using the given weight values
function renderProfileModalWeights(w) {
  const keys = ['logins','adoption','tickets','nps','days','growth'];
  el('pm-weight-rows').innerHTML = keys.map(k => `
    <div class="weight-row">
      <div class="weight-label">${WEIGHT_LABELS[k]}</div>
      <input type="range" min="0" max="100" value="${w[k] ?? 0}" id="pm-wr-${k}"
        oninput="updateProfileModalTotal()" style="flex:1;cursor:pointer;accent-color:var(--blue)"/>
      <div class="weight-pct" id="pm-wp-${k}">${w[k] ?? 0}%</div>
    </div>`).join('');
  updateProfileModalTotal();
}

function updateProfileModalTotal() {
  const keys = ['logins','adoption','tickets','nps','days','growth'];
  const total = keys.reduce((s,k) => s + parseInt(el('pm-wr-'+k)?.value||0), 0);
  // Update percentage labels next to each slider
  keys.forEach(k => {
    const pct = el('pm-wp-'+k);
    if (pct) pct.textContent = (el('pm-wr-'+k)?.value || 0) + '%';
  });
  const fill = el('pm-total-fill');
  const lbl  = el('pm-total-label');
  if (fill) { fill.style.width = Math.min(total,100)+'%'; fill.style.background = total===100?'var(--green)':total>100?'var(--red)':'var(--amber)'; }
  if (lbl)  { lbl.textContent = `Total: ${total}% ${total===100?'(good)':total>100?'— over 100%':'— needs '+(100-total)+'%'}`; lbl.style.color = total===100?'var(--green)':'var(--red)'; }
}

function saveProfile() {
  const nameInput = el('profile-name-input');
  nameInput.value = '';
  nameInput.readOnly = false;
  nameInput.style.opacity = '';
  nameInput.style.cursor  = '';
  el('profile-modal').dataset.editIdx = '-1';
  if (el('profile-modal-title')) el('profile-modal-title').textContent = 'New Scoring Profile';
  if (el('profile-confirm-btn')) el('profile-confirm-btn').textContent = 'Save Profile';
  // Pre-fill sliders with current global weights as a starting point
  renderProfileModalWeights({ ...weights });
  openModal('profile-modal');
}

function editProfile(idx) {
  const p = profiles[idx];
  if (!p) return;
  const isGlobal = p.name === 'Global Weights';
  const nameInput = el('profile-name-input');
  nameInput.value = p.name;
  nameInput.readOnly = isGlobal;
  nameInput.style.opacity = isGlobal ? '0.5' : '';
  nameInput.style.cursor  = isGlobal ? 'not-allowed' : '';
  el('profile-modal').dataset.editIdx = String(idx);
  if (el('profile-modal-title')) el('profile-modal-title').textContent = isGlobal ? 'Edit Global Weights' : 'Edit Profile';
  if (el('profile-confirm-btn')) el('profile-confirm-btn').textContent = 'Update Profile';
  renderProfileModalWeights({ ...p.weights });
  openModal('profile-modal');
}

function confirmSaveProfile() {
  const nameInput = el('profile-name-input');
  const editIdx   = parseInt(el('profile-modal').dataset.editIdx ?? '-1');
  // For Global Weights the name is locked; for others read the input
  const existingName = editIdx >= 0 ? profiles[editIdx]?.name : '';
  const isGlobal  = existingName === 'Global Weights';
  const name      = isGlobal ? 'Global Weights' : nameInput.value.trim();
  if (!name) { toast('Enter a profile name', 'error'); return; }
  // Duplicate name check — ignore the profile being edited itself
  const duplicate = profiles.some((p, i) => p.name.toLowerCase() === name.toLowerCase() && i !== editIdx);
  if (duplicate) { toast(`A profile named "${name}" already exists`, 'error'); return; }

  const keys  = ['logins','adoption','tickets','nps','days','growth'];
  const total = keys.reduce((s,k) => s + parseInt(el('pm-wr-'+k)?.value||0), 0);
  if (total !== 100) { toast('Weights must total exactly 100%', 'error'); return; }

  const profileWeights = {};
  keys.forEach(k => { profileWeights[k] = parseInt(el('pm-wr-'+k)?.value || 0); });

  if (editIdx >= 0) {
    const oldWeights = profiles[editIdx]?.weights || {};
    profiles[editIdx] = { name, weights: profileWeights };
    // If Global Weights changed, sync the global weights object
    if (isGlobal) {
      weights = { ...profileWeights };
    }
    const keys = ['logins','adoption','tickets','nps','days','growth'];
    const changed = keys.filter(k => (oldWeights[k]||0) !== profileWeights[k]).map(k => `${WEIGHT_LABELS[k]||k}: ${oldWeights[k]||0}→${profileWeights[k]}`);
    logAudit('profile_updated', null, '', { summary: `Profile "${name}" updated${changed.length ? ': ' + changed.join(', ') : ''}`, profile: name, weights: profileWeights });
    logConfigChange(`Profile "${name}" updated`);
    toast(`Profile "${name}" updated`, 'success');
    // Rescore all customers assigned to this profile (or all unassigned for Global Weights)
    rescoreByProfile(name);
  } else {
    profiles.push({ name, weights: profileWeights });
    logAudit('profile_created', null, '', { summary: `New scoring profile "${name}" created`, profile: name, weights: profileWeights });
    logConfigChange(`Profile "${name}" created`);
    toast(`Profile "${name}" saved`, 'success');
  }

  // Reset modal state
  nameInput.readOnly = false;
  nameInput.style.opacity = '';
  nameInput.style.cursor  = '';
  el('profile-modal').dataset.editIdx = '-1';
  if (el('profile-modal-title')) el('profile-modal-title').textContent = 'New Scoring Profile';
  if (el('profile-confirm-btn')) el('profile-confirm-btn').textContent = 'Save Profile';
  saveSettings();
  closeModal('profile-modal');
  renderProfiles();
  refreshProfileDropdown();
}

// Rescore all customers that use a given profile name.
// Global Weights rescores customers with no profile assigned.
function rescoreByProfile(profileName) {
  const isGlobal = profileName === 'Global Weights';
  const prof     = profiles.find(p => p.name === profileName);
  if (!prof) return;
  const changed = [];
  customers.forEach(c => {
    const usesThisProfile = isGlobal
      ? (!c.scoring_profile || c.scoring_profile === 'Global Weights')
      : c.scoring_profile === profileName;
    if (!usesThisProfile) return;
    const { score } = calcScore(c, prof.weights);
    if (c.score !== score) {
      c.history = c.history || [];
      c.history.push({ score, date: new Date().toISOString(), signals: buildHistorySnapshot(c) });
      c.score  = score;
      c.status = getStatus(score);
      changed.push(c);
    }
  });
  if (changed.length) {
    renderDashboard(); renderCustomers(); renderAlerts();
    toast(`Re-scored ${changed.length} customer${changed.length!==1?'s':''} on "${profileName}"`, 'success');
    setLoading(true);
    Promise.all(changed.map(c => atUpdate(c).catch(()=>{}))).finally(() => setLoading(false));
  }
}

function loadProfile(idx) {
  const p = profiles[idx];
  if (!p) return;
  weights = { ...p.weights };
  saveSettings();
  logAudit('profile_loaded', null, '', { summary: `Loaded profile "${p.name}" as global weights`, profile: p.name });
  renderWeightRows();
  renderDashboard();
  renderCustomers();
  toast(`Loaded profile: ${p.name}`, 'success');
}

function deleteProfile(idx) {
  const name = profiles[idx]?.name;
  profiles.splice(idx,1);
  saveSettings();
  logAudit('profile_deleted', null, '', { summary: `Scoring profile "${name}" deleted`, profile: name });
  renderProfiles();
  refreshProfileDropdown();
  logConfigChange(`Profile "${name}" deleted`);
  toast(`Profile "${name}" deleted`, 'warn');
}

// ─── CLIENT MANAGEMENT (ADMIN ONLY) ─────────────────────────

async function loadAdminClients() {
  if (!isAdmin()) return;
  try {
    const { data, error } = await sb.from('clients')
      .select('*').order('name', { ascending: true });
    if (error) throw error;
    adminClients = data || [];
    refreshClientDropdown();
    refreshClientSelects();
  } catch(e) {
    console.warn('loadAdminClients:', e.message);
  }
}

// Populate the topbar client filter radio list
function refreshClientDropdown() {
  const list = document.getElementById('client-filter-list');
  if (!list) return;
  list.innerHTML = adminClients.map(c => `
    <div class="mgr-filter__item">
      <label>
        <input type="radio" name="client-radio" value="${escHtml(c.id)}"
          onchange="clientRadioChange(this)"
          ${activeClientId === c.id ? 'checked' : ''}>
        ${escHtml(c.name)}
      </label>
    </div>`).join('');
  updateClientFilterLabel();
}

// Populate client <select> dropdowns in create/edit user modals
function refreshClientSelects() {
  const opts = `<option value="">— No client assigned —</option>` +
    adminClients.map(c => `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`).join('');
  ['cu-client','eu-client'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) { const cur = sel.value; sel.innerHTML = opts; sel.value = cur; }
  });
}

function toggleClientDropdown() {
  const dd = document.getElementById('client-filter-dropdown');
  if (!dd) return;
  dd.style.display = dd.style.display === 'none' ? '' : 'none';
}

document.addEventListener('click', function(e) {
  const wrap = document.getElementById('client-filter-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const dd = document.getElementById('client-filter-dropdown');
    if (dd) dd.style.display = 'none';
  }
});

async function clientRadioChange(radio) {
  activeClientId = radio.value;
  updateClientFilterLabel();
  document.getElementById('client-filter-dropdown').style.display = 'none';

  if (activeClientId === '__own__') {
    // Reload admin's own customers
    setLoading(true);
    try {
      await loadCustomersFromSupabase();
    } catch(e) { /* use cache */ } finally {
      setLoading(false);
    }
  } else {
    // Load this client's customers (all users assigned to this client)
    await loadClientCustomers(activeClientId);
  }
  activeManagers.clear();
  refreshMgrDropdown();
  renderDashboard();
  renderCustomers();
  renderAlerts();
}

function updateClientFilterLabel() {
  const lbl = document.getElementById('client-filter-label');
  if (!lbl) return;
  if (activeClientId === '__own__') {
    lbl.textContent = 'My Data';
  } else {
    const c = adminClients.find(x => x.id === activeClientId);
    lbl.textContent = c ? c.name : 'Client';
  }
}

// Load all customers belonging to users assigned to a given client
async function loadClientCustomers(clientId) {
  setLoading(true);
  try {
    // Get all user_ids assigned to this client
    const { data: profiles, error: pErr } = await sb.from('user_profiles')
      .select('user_id').eq('client_id', clientId);
    if (pErr) throw pErr;

    const userIds = (profiles || []).map(p => p.user_id);
    if (!userIds.length) { customers = []; trash = []; setLoading(false); return; }

    // Load all customers for those users (active + soft-deleted)
    const { data, error } = await sb.from('customers')
      .select('*')
      .in('user_id', userIds)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const all = (data || []).map(fromRow);
    customers = all.filter(c => !c.deleted_at);
    trash     = all.filter(c =>  c.deleted_at);
  } catch(e) {
    toast('Could not load client data: ' + e.message, 'error');
    customers = [];
    trash = [];
  } finally {
    setLoading(false);
  }
}

async function renderClients() {
  if (!isAdmin()) { nav('dashboard'); return; }
  await loadAdminClients();

  const loading = document.getElementById('clients-loading');
  const table   = document.getElementById('clients-table');
  const empty   = document.getElementById('clients-empty');
  const tbody   = document.getElementById('clients-tbody');
  const countEl = document.getElementById('clients-count');

  if (loading) loading.style.display = 'none';

  if (!adminClients.length) {
    if (empty) empty.style.display = '';
    if (table) table.style.display = 'none';
    if (countEl) countEl.textContent = '0 clients';
    return;
  }

  // Count users per client
  let profiles = [];
  try {
    const { data } = await sb.from('user_profiles').select('client_id');
    profiles = data || [];
  } catch(e) {}
  const userCounts = {};
  profiles.forEach(p => { if (p.client_id) userCounts[p.client_id] = (userCounts[p.client_id]||0)+1; });

  if (countEl) countEl.textContent = `${adminClients.length} client${adminClients.length!==1?'s':''}`;
  if (empty) empty.style.display = 'none';
  if (table) table.style.display = '';

  tbody.innerHTML = adminClients.map(c => `
    <tr>
      <td><strong>${escHtml(c.name)}</strong></td>
      <td>${tierBadgeHTML(c.plan_tier || 'solo')}</td>
      <td>${userCounts[c.id] || 0}</td>
      <td style="color:var(--muted);font-size:.8rem">${escHtml(c.notes || '—')}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-xs btn-outline" onclick="openEditClientModal('${escHtml(c.id)}','${escHtml(c.name)}',\`${escHtml(c.notes||'')}\`,'${escHtml(c.plan_tier||'solo')}')">Edit</button>
          <button class="btn btn-xs btn-danger" onclick="adminDeleteClient('${escHtml(c.id)}','${escHtml(c.name)}')">Remove</button>
        </div>
      </td>
    </tr>`).join('');
}

function openCreateClientModal() {
  if (!isAdmin()) return;
  el('cc-name').value  = '';
  el('cc-tier').value  = 'team';
  el('cc-notes').value = '';
  el('cc-err').textContent = '';
  el('cc-btn').disabled = false;
  el('cc-btn').textContent = 'Add Client →';
  openModal('create-client-modal');
}

async function adminSaveClient() {
  const name      = el('cc-name').value.trim();
  const plan_tier = el('cc-tier').value || 'team';
  const notes     = el('cc-notes').value.trim();
  if (!name) { el('cc-err').textContent = 'Business name is required.'; return; }
  el('cc-btn').disabled = true;
  el('cc-btn').textContent = 'Saving…';
  try {
    const { error } = await sb.from('clients').insert({
      id: crypto.randomUUID(), name, notes, plan_tier,
      user_id: currentUser.id,
      created_at: new Date().toISOString()
    });
    if (error) throw error;
    toast(`Client "${name}" added`, 'success');
    closeModal('create-client-modal');
    await loadAdminClients();
    renderClients();
  } catch(e) {
    el('cc-err').textContent = e.message || 'Save failed.';
    el('cc-btn').disabled = false;
    el('cc-btn').textContent = 'Add Client →';
  }
}

function openEditClientModal(id, name, notes, tier) {
  if (!isAdmin()) return;
  el('ec-id').value    = id;
  el('ec-name').value  = name;
  el('ec-tier').value  = tier || 'solo';
  el('ec-notes').value = notes;
  el('ec-err').textContent = '';
  el('ec-btn').disabled = false;
  el('ec-btn').textContent = 'Save Changes →';
  openModal('edit-client-modal');
}

async function adminUpdateClient() {
  const id        = el('ec-id').value;
  const name      = el('ec-name').value.trim();
  const plan_tier = el('ec-tier').value || 'solo';
  const notes     = el('ec-notes').value.trim();
  if (!name) { el('ec-err').textContent = 'Business name is required.'; return; }
  el('ec-btn').disabled = true;
  el('ec-btn').textContent = 'Saving…';
  try {
    const { error } = await sb.from('clients').update({ name, notes, plan_tier }).eq('id', id);
    if (error) throw error;
    toast(`Client updated`, 'success');
    closeModal('edit-client-modal');
    await loadAdminClients();
    renderClients();
  } catch(e) {
    el('ec-err').textContent = e.message || 'Save failed.';
    el('ec-btn').disabled = false;
    el('ec-btn').textContent = 'Save Changes →';
  }
}

async function adminDeleteClient(id, name) {
  if (!confirm(`Remove client "${name}"?\n\nUsers assigned to this client will become unassigned but their data is kept.`)) return;
  try {
    const { error } = await sb.from('clients').delete().eq('id', id);
    if (error) throw error;
    if (activeClientId === id) { activeClientId = '__own__'; updateClientFilterLabel(); }
    toast(`Client "${name}" removed`, 'warn');
    await loadAdminClients();
    renderClients();
  } catch(e) {
    toast('Remove failed: ' + e.message, 'error');
  }
}

// ─── USER MANAGEMENT (ADMIN ONLY) ────────────────────────────
// Uses the `profiles` Supabase table to track user metadata.
// Admin creates users via signUp, then stores business name in `user_profiles` table.
// Listing users: admin reads all rows from user_profiles (RLS allows admin to see all).
// Deleting users: removes from user_profiles + calls Supabase admin delete (requires service key — we soft-delete via profile flag).

async function renderUsers() {
  if (!isAdmin()) { nav('dashboard'); return; }

  const loading = el('users-loading');
  const table   = el('users-table');
  const empty   = el('users-empty');
  const tbody   = el('users-tbody');
  const countEl = el('users-count');

  if (loading) loading.style.display = '';
  if (table)   table.style.display   = 'none';
  if (empty)   empty.style.display   = 'none';

  try {
    // Load all user profiles (admin sees all via RLS policy)
    const { data: profiles_data, error } = await sb.from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;

    // For each profile, count their active (non-deleted) customers
    const { data: custData } = await sb.from('customers').select('user_id').is('deleted_at', null);
    const custCounts = {};
    (custData || []).forEach(r => {
      custCounts[r.user_id] = (custCounts[r.user_id] || 0) + 1;
    });

    if (loading) loading.style.display = 'none';

    if (!profiles_data || profiles_data.length === 0) {
      if (empty) empty.style.display = '';
      if (countEl) countEl.textContent = '0 users';
      return;
    }

    if (countEl) countEl.textContent = `${profiles_data.length} user${profiles_data.length!==1?'s':''}`;
    if (table) table.style.display = '';

    tbody.innerHTML = profiles_data.map(p => {
      const isSelf    = p.user_id === currentUser.id;
      const custCount = custCounts[p.user_id] || 0;
      const uid       = escHtml(p.user_id);
      const email     = escHtml(p.email || '');
      const clientId  = p.client_id || '';
      const client    = adminClients.find(c => c.id === clientId);
      const clientName = client ? escHtml(client.name) : '<span style="color:var(--subtle);font-style:italic">—</span>';
      return `
        <tr>
          <td>
            <strong>${email || '—'}</strong>
            ${isSelf ? '<span style="margin-left:6px;font-size:.7rem;background:var(--blue-l);color:var(--blue);padding:1px 6px;border-radius:4px;font-weight:700">YOU</span>' : ''}
          </td>
          <td>${clientName}</td>
          <td style="font-weight:600">${custCount}</td>
          <td style="color:var(--muted);font-size:.78rem">${fmtDate(p.created_at)}</td>
          <td>
            <div style="display:flex;gap:4px;flex-wrap:nowrap">
              <button class="btn btn-xs btn-outline" onclick="openEditUserModal('${uid}','${email}','${escHtml(clientId)}')">Edit</button>
              ${isSelf
                ? '<span style="font-size:.75rem;color:var(--subtle);padding:2px 4px">Can\'t Delete</span>'
                : `<button class="btn btn-xs btn-danger" onclick="adminDeleteUser('${uid}','${email}')">Remove</button>`}
            </div>
          </td>
        </tr>`;
    }).join('');

  } catch(e) {
    if (loading) loading.style.display = 'none';
    if (loading) loading.style.display = 'none';
    if (empty) {
      empty.style.display = '';
      if (e.message && e.message.includes('user_profiles')) {
        empty.innerHTML = `<strong>Setup required.</strong> The <code>user_profiles</code> table doesn't exist yet.<br><br>
          Run the SQL setup script in <strong>Supabase → SQL Editor</strong>, then reload this page.`;
      } else {
        empty.textContent = 'Error loading users: ' + e.message;
      }
    }
    console.error('renderUsers error:', e);
  }
}

function openCreateUserModal() {
  if (!isAdmin()) return;
  el('cu-email').value = '';
  el('cu-pw').value    = '';
  el('cu-err').textContent = '';
  el('cu-ok').textContent  = '';
  el('cu-btn').disabled    = false;
  el('cu-btn').textContent = 'Create User →';
  refreshClientSelects();
  el('cu-client').value = '';
  openModal('create-user-modal');
}

async function adminCreateUser() {
  if (!isAdmin()) return;
  const email    = el('cu-email').value.trim();
  const clientId = el('cu-client').value;
  const pw       = el('cu-pw').value;

  el('cu-err').textContent = '';
  el('cu-ok').textContent  = '';

  if (!email) { el('cu-err').textContent = 'Email is required.'; return; }
  if (!pw || pw.length < 8) { el('cu-err').textContent = 'Password must be at least 8 characters.'; return; }

  el('cu-btn').disabled = true;
  el('cu-btn').textContent = 'Creating…';

  try {
    const { data: signUpData, error: signUpErr } = await sb.auth.signUp({
      email, password: pw,
      options: { emailRedirectTo: window.location.href }
    });
    if (signUpErr) throw signUpErr;

    // If identities is empty, this email already exists in Supabase
    if (signUpData?.user?.identities?.length === 0) {
      throw new Error(`A user with email "${email}" already exists.`);
    }

    const newUserId = signUpData?.user?.id;
    if (!newUserId) throw new Error('Signup succeeded but no user ID returned. Check Supabase Auth settings.');

    const client = adminClients.find(c => c.id === clientId);
    const { error: profileErr } = await sb.from('user_profiles').upsert({
      user_id:       newUserId,
      email,
      business_name: client ? client.name : '',
      client_id:     clientId || null,
      created_at:    new Date().toISOString()
    }, { onConflict: 'user_id' });

    if (profileErr) throw new Error('User created in Auth but profile save failed: ' + profileErr.message);

    el('cu-ok').textContent  = `User "${email}" created! They can log in now with the password you set.`;
    el('cu-btn').textContent = 'Create User →';
    el('cu-btn').disabled    = false;
    toast(`User ${email} created`, 'success');
    setTimeout(() => { closeModal('create-user-modal'); renderUsers(); }, 2000);

  } catch(e) {
    el('cu-err').textContent = e.message || 'Failed to create user.';
    el('cu-btn').textContent = 'Create User →';
    el('cu-btn').disabled    = false;
  }
}

async function adminDeleteUser(userId, email) {
  if (!isAdmin()) return;
  if (userId === currentUser.id) { toast("You can't delete yourself", 'error'); return; }
  if (!confirm(`Remove user "${email}"?\n\nThis deletes their profile record. Their customer data stays in the database but will be inaccessible until a new account is created with the same user ID.`)) return;

  try {
    const { error } = await sb.from('user_profiles').delete().eq('user_id', userId);
    if (error) throw error;
    toast(`User ${email} removed`, 'warn');
    renderUsers();
  } catch(e) {
    toast('Remove failed: ' + e.message, 'error');
  }
}

function openEditUserModal(userId, email, clientId) {
  if (!isAdmin()) return;
  el('eu-userid').value = userId;
  el('eu-email').value  = email;
  el('eu-pw').value     = '';
  el('eu-err').textContent = '';
  el('eu-ok').textContent  = '';
  el('eu-btn').disabled    = false;
  el('eu-btn').textContent = 'Save Changes →';
  refreshClientSelects();
  el('eu-client').value = clientId || '';
  openModal('edit-user-modal');
}

async function adminSaveEdit() {
  if (!isAdmin()) return;
  const userId   = el('eu-userid').value;
  const clientId = el('eu-client').value;
  const pw       = el('eu-pw').value.trim();

  el('eu-err').textContent = '';
  el('eu-ok').textContent  = '';

  if (pw && pw.length < 8) {
    el('eu-err').textContent = 'Password must be at least 8 characters.';
    return;
  }

  el('eu-btn').disabled    = true;
  el('eu-btn').textContent = 'Saving…';

  try {
    const client = adminClients.find(c => c.id === clientId);
    const { error: profErr } = await sb.from('user_profiles')
      .update({ client_id: clientId || null, business_name: client ? client.name : '' })
      .eq('user_id', userId);
    if (profErr) throw profErr;

    el('eu-ok').textContent  = 'Profile updated!';
    el('eu-btn').textContent = 'Save Changes →';
    el('eu-btn').disabled    = false;
    toast('User updated', 'success');
    setTimeout(() => { closeModal('edit-user-modal'); renderUsers(); }, 1000);

  } catch(e) {
    el('eu-err').textContent = e.message || 'Save failed.';
    el('eu-btn').textContent = 'Save Changes →';
    el('eu-btn').disabled    = false;
  }
}

// Auto-register current user's profile on login (so admin can see them)
async function ensureUserProfile(user) {
  try {
    const { data } = await sb.from('user_profiles').select('user_id').eq('user_id', user.id).single();
    if (!data) {
      // Not registered yet — create profile row
      await sb.from('user_profiles').insert({
        user_id:       user.id,
        email:         user.email,
        business_name: '',
        created_at:    new Date().toISOString()
      });
    }
  } catch(e) { /* silent — non-critical */ }
}

// ─── CSV IMPORT ─────────────────────────────────────────────
function handleDragOver(e)  { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function handleDrop(e)      { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); const f=e.dataTransfer.files[0]; if(f) parseCSVFile(f); }
function handleFile(e)      { const f=e.target.files[0]; if(f) parseCSVFile(f); }

function parseCSVFile(file) {
  const reader = new FileReader();
  reader.onload = ev => parseCSVText(ev.target.result);
  reader.readAsText(file);
}

function parseCSVText(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) { toast('CSV must have a header row and at least one data row', 'error'); return; }
  csvHeaders = parseCSVLine(lines[0]);
  csvRows    = lines.slice(1).filter(l=>l.trim()).map(parseCSVLine);
  showColumnMap();
}

function parseCSVLine(line) {
  const res = [];
  let cur = '', inQ = false;
  for (let i=0; i<line.length; i++) {
    const ch = line[i];
    if (ch==='"') { inQ=!inQ; }
    else if (ch===','&&!inQ) { res.push(cur.trim()); cur=''; }
    else { cur+=ch; }
  }
  res.push(cur.trim());
  return res;
}

const APP_FIELDS = {
  name:            { label:'Customer Name', required:true },
  manager:         { label:'Assigned Manager', required:false },
  mrr:             { label:'MRR ($)',       required:false },
  arr:             { label:'ARR ($)',       required:false },
  logins:          { label:'Logins (30d)',  required:false },
  adoption:        { label:'Adoption %',   required:false },
  tickets:         { label:'Open Tickets', required:false },
  nps:             { label:'NPS Category', required:false },
  days:            { label:'Days Since Contact', required:false },
  renewal_date:    { label:'Renewal Date', required:false },
  renewal:         { label:'Months to Renewal',  required:false },
  growth:          { label:'Growth Signal', required:false },
  tier:            { label:'Tier',          required:false },
  tags:            { label:'Tags',          required:false },
  lifecycle:       { label:'Lifecycle',     required:false },
  since:           { label:'Customer Since', required:false },
  next_touch:      { label:'Next Touch Date', required:false },
  scoring_profile: { label:'Scoring Profile', required:false },
  note:            { label:'Note',            required:false },
  sentiment:       { label:'Sentiment',       required:false }
};

const FIELD_ALIASES = {
  name:            ['name','company','customer','account','customer name','company name'],
  manager:         ['manager','assigned manager','csm','cs manager','owner','account owner','rep'],
  mrr:             ['mrr','monthly recurring revenue','revenue'],
  arr:             ['arr','annual recurring revenue','annual revenue'],
  logins:          ['logins','logins_30d','login_frequency','login frequency','logins 30d'],
  adoption:        ['adoption','feature_adoption_pct','feature adoption','adoption %','adoption pct'],
  tickets:         ['tickets','open_tickets','support tickets','open tickets','support_tickets'],
  nps:             ['nps','nps_category','csat','nps/csat','nps category'],
  days:            ['days','days_since_contact','days since contact','last contact'],
  renewal_date:    ['renewal_date','renewal date','renews on','renews'],
  renewal:         ['renewal','months_to_renewal','months to renewal','renewal months'],
  growth:          ['growth','growth_signal','growth signal'],
  tier:            ['tier','segment'],
  tags:            ['tags','labels','tag'],
  lifecycle:       ['lifecycle','stage','lifecycle stage','status'],
  since:           ['since','customer since','customer_since','start date','start_date','joined'],
  next_touch:      ['next_touch','next touch','next contact','next_contact','scheduled touch'],
  scoring_profile: ['scoring_profile','scoring profile','profile','score profile'],
  note:            ['note','notes','comment','comments'],
  sentiment:       ['sentiment','sentiment value','customer sentiment']
};

function autoMap() {
  const mapping = {};
  Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
    const match = csvHeaders.findIndex(h => aliases.includes(h.toLowerCase().trim()));
    mapping[field] = match >= 0 ? match : -1;
  });
  return mapping;
}

/* Normalize various date formats → YYYY-MM-DD (ISO) for <input type="date"> & new Date() */
function normalizeDate(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';

  // Already ISO YYYY-MM-DD (with optional time portion)
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // MM/DD/YYYY or M/D/YYYY or MM-DD-YYYY
  const usMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (usMatch) {
    const [, m, d, y] = usMatch;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // MM/DD/YY or M/D/YY (2-digit year)
  const shortMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (shortMatch) {
    const [, m, d, yy] = shortMatch;
    const y = parseInt(yy) > 50 ? '19' + yy : '20' + yy;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // "Jan 15, 2026" / "January 15, 2026" / "15 Jan 2026"
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const namedMatch = s.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (namedMatch) {
    const mon = months[namedMatch[1].slice(0,3).toLowerCase()];
    if (mon) return `${namedMatch[3]}-${mon}-${namedMatch[2].padStart(2,'0')}`;
  }
  const namedMatch2 = s.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (namedMatch2) {
    const mon = months[namedMatch2[2].slice(0,3).toLowerCase()];
    if (mon) return `${namedMatch2[3]}-${mon}-${namedMatch2[1].padStart(2,'0')}`;
  }

  // Excel serial number (days since 1899-12-30)
  const num = parseFloat(s);
  if (!isNaN(num) && num > 30000 && num < 100000) {
    const d = new Date((num - 25569) * 86400000);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
  }

  // Last resort: try native Date parsing
  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) return fallback.toISOString().slice(0,10);

  return ''; // unrecognizable
}

function showColumnMap() {
  const auto = autoMap();
  const wrap = el('col-map-rows');
  wrap.innerHTML = Object.entries(APP_FIELDS).map(([field,meta]) => {
    const opts = csvHeaders.map((h,i)=>`<option value="${i}" ${auto[field]===i?'selected':''}>${h}</option>`).join('');
    return `
      <div class="col-map">
        <div style="font-size:.8rem;font-weight:600">${meta.label}${meta.required?' *':''}</div>
        <div class="col-map__arrow">→</div>
        <select id="cm-${field}">
          <option value="-1">— skip —</option>
          ${opts}
        </select>
      </div>`;
  }).join('');
  el('csv-map-wrap').style.display    = 'block';
  el('csv-prev-wrap').style.display   = 'none';
}

function applyMapping() {
  const mapping = {};
  Object.keys(APP_FIELDS).forEach(f => {
    mapping[f] = parseInt(el('cm-'+f)?.value ?? -1);
  });
  if (mapping.name < 0) { toast('Customer Name column is required', 'error'); return; }

  const npsMap = {
    promoter:['promoter','9','10','9-10'],
    passive:['passive','7','8','7-8'],
    detractor:['detractor','0','1','2','3','4','5','6','0-6']
  };
  const growMap = { strong:['strong'], mild:['mild'], none:['none','flat',''] };

  const parsed = csvRows.map((row,ri) => {
    const get = (f, def='') => mapping[f]>=0 ? (row[mapping[f]]||'').trim() : def;
    const npsRaw = get('nps','unknown').toLowerCase();
    let nps = 'unknown';
    Object.entries(npsMap).forEach(([k,vs])=>{ if(vs.includes(npsRaw)) nps=k; });
    const growRaw = get('growth','none').toLowerCase();
    let growth = 'none';
    Object.entries(growMap).forEach(([k,vs])=>{ if(vs.includes(growRaw)) growth=k; });

    const sentRaw = get('sentiment','').toLowerCase();
    const sentVal = ['positive','neutral','negative'].includes(sentRaw) ? sentRaw : '';

    return {
      _row: ri+2,
      name:            get('name'),
      manager:         get('manager',''),
      mrr:             parseFloat(get('mrr')) || 0,
      arr:             parseFloat(get('arr')) || 0,
      logins:          parseInt(get('logins'))|| 0,
      adoption:        parseInt(get('adoption'))|| 0,
      tickets:         parseInt(get('tickets'))|| 0,
      nps,
      days:            parseInt(get('days'))  || 0,
      renewal_date:    normalizeDate(get('renewal_date','')),
      renewal:         parseInt(get('renewal'))|| 0,
      growth,
      tier:            ['smb','mid','enterprise'].includes(get('tier','mid').toLowerCase()) ? get('tier','mid').toLowerCase() : 'mid',
      tags:            get('tags').split(/[,|]/).map(t=>t.trim()).filter(Boolean),
      lifecycle:       ['onboarding','active','atrisk','won','churned'].includes(get('lifecycle','active').toLowerCase()) ? get('lifecycle','active').toLowerCase() : 'active',
      since:           normalizeDate(get('since','')),
      next_touch:      normalizeDate(get('next_touch','')),
      scoring_profile: get('scoring_profile',''),
      _note:           get('note',''),
      _sentiment:      sentVal
    };
  }).filter(r => r.name);

  // Show preview
  el('csv-map-wrap').style.display  = 'none';
  el('csv-prev-wrap').style.display = 'block';
  el('csv-count').textContent       = `${parsed.length} rows ready to import`;
  el('csv-err').textContent         = csvRows.length - parsed.length > 0
    ? `${csvRows.length - parsed.length} rows skipped (missing name)`
    : '';

  el('csv-prev').innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Score</th><th>MRR</th><th>NPS</th><th>Tier</th></tr></thead>
      <tbody>${parsed.slice(0,8).map(r => {
        const {score} = calcScore(r);
        return `<tr>
          <td>${escHtml(r.name)}</td>
          <td><strong>${score}</strong></td>
          <td>${r.mrr?'$'+fmtNum(r.mrr):'—'}</td>
          <td>${r.nps}</td>
          <td>${r.tier}</td>
        </tr>`;
      }).join('')}
      ${parsed.length>8?`<tr><td colspan="5" style="color:var(--muted);font-style:italic">…and ${parsed.length-8} more</td></tr>`:''}
      </tbody>
    </table>`;

  // Stash for import
  el('csv-prev').dataset.json = JSON.stringify(parsed);
}

async function importCSV() {
  const raw = el('csv-prev').dataset.json;
  if (!raw) return;
  const rows = JSON.parse(raw);
  const toCreate = [], toUpdate = [];
  const now = new Date().toISOString();
  rows.forEach((r, i) => {
    // Extract transient import fields (prefixed with _)
    const importNote = r._note || '';
    const importSentiment = r._sentiment || '';
    delete r._note; delete r._sentiment; delete r._row;

    // If renewal_date provided, recalculate renewal months
    if (r.renewal_date) {
      r.renewal = Math.max(0, Math.round((new Date(r.renewal_date) - new Date()) / (1000*60*60*24*30.44)));
    }

    const { score } = calcScore(r);
    const status = getStatus(score);
    const dupe = customers.find(c => c.name.toLowerCase() === r.name.toLowerCase());
    if (dupe) {
      Object.assign(dupe, { ...r, score, status });
      dupe._baseDays = dupe.days || 0;
      dupe.history = dupe.history || [];
      dupe.history.push({ score, date: now });
      // Append note if provided
      if (importNote) {
        dupe.notes = dupe.notes || [];
        dupe.notes.push({ text: importNote, date: now });
      }
      // Append sentiment if provided
      if (importSentiment) {
        dupe.sentiment = dupe.sentiment || [];
        dupe.sentiment.push({ val: importSentiment, note: 'CSV import', date: now });
      }
      toUpdate.push(dupe);
    } else {
      const notes = importNote ? [{ text: importNote, date: now }] : [];
      const sentiment = importSentiment ? [{ val: importSentiment, note: 'CSV import', date: now }] : [];
      const newCust = {
        id: crypto.randomUUID(),
        ...r, score, status,
        _baseDays: r.days || 0,
        notes,
        sentiment,
        history: [{ score, date: now }],
        created: now
      };
      customers.unshift(newCust);
      toCreate.push(newCust);
    }
  });
  clearCSV();
  const createdNames = toCreate.slice(0, 5).map(c => c.name).join(', ') + (toCreate.length > 5 ? ` +${toCreate.length - 5} more` : '');
  const updatedNames = toUpdate.slice(0, 5).map(c => c.name).join(', ') + (toUpdate.length > 5 ? ` +${toUpdate.length - 5} more` : '');
  const importParts = [];
  if (toCreate.length) importParts.push(`Created ${toCreate.length}: ${createdNames}`);
  if (toUpdate.length) importParts.push(`Updated ${toUpdate.length}: ${updatedNames}`);
  logAudit('csv_import', null, '', { summary: importParts.join(' · ') || 'No records imported' });
  toast(`Importing ${toCreate.length} new + ${toUpdate.length} updates…`, 'default');
  nav('customers');
  setLoading(true);
  try {
    await Promise.all([
      ...toCreate.map(c => atCreate(c).catch(()=>{})),
      ...toUpdate.map(c => atUpdate(c).catch(()=>{}))
    ]);
    toast(`Done: ${toCreate.length} added, ${toUpdate.length} updated`, 'success');
  } catch(e) {
    toast('Import finished — some records may not have synced', 'warn');
  } finally {
    setLoading(false);
    refreshMgrDropdown();
    renderCustomers();
  }
}

function clearCSV() {
  csvRows = null; csvHeaders = [];
  el('csv-map-wrap').style.display  = 'none';
  el('csv-prev-wrap').style.display = 'none';
  el('csv-input').value = '';
}

function dlTemplate() {
  const hdr = 'name,manager,mrr,arr,logins_30d,feature_adoption_pct,open_tickets,nps_category,days_since_contact,renewal_date,months_to_renewal,growth_signal,tier,tags,lifecycle,customer_since,next_touch,scoring_profile,note,sentiment';
  const sample = [
    'Acme Corp,Jane Smith,5000,60000,22,75,1,promoter,7,2026-09-15,8,strong,mid,"power-user,renewal-soon",active,2024-01-10,2026-03-01,Global Weights,Great engagement,positive',
    'Beta Inc,Marcus Lee,1200,14400,8,40,3,passive,25,2026-05-01,3,none,smb,,onboarding,2025-11-01,,Global Weights,Needs onboarding help,neutral',
    'Gamma LLC,Jane Smith,12000,144000,28,90,0,promoter,3,2027-01-20,11,strong,enterprise,enterprise-plan,active,2023-06-15,2026-03-10,Global Weights,,positive'
  ].join('\n');
  dlText(hdr + '\n' + sample, 'cs-health-template.csv', 'text/csv');
}

function exportCSV() {
  const hdr = 'name,manager,score,status,mrr,arr,tier,lifecycle,logins,adoption,tickets,nps,days,renewal_date,renewal,growth,tags,since,next_touch,scoring_profile,note,sentiment,created';
  const rows = customers.map(c => {
    const latestNote = (c.notes||[]).length ? c.notes[c.notes.length-1].text : '';
    const latestSent = (c.sentiment||[]).length ? c.sentiment[c.sentiment.length-1].val : '';
    return [
      c.name, c.manager||'', c.score, c.status,
      c.mrr||0, c.arr||0, c.tier||'mid', c.lifecycle||'active',
      c.logins, c.adoption, c.tickets, c.nps, c.days,
      c.renewal_date||'', c.renewal||0, c.growth||'none',
      (c.tags||[]).join('|'), c.since||'', c.next_touch||'',
      c.scoring_profile||'', latestNote, latestSent, c.created||''
    ].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',');
  });
  dlText(hdr + '\n' + rows.join('\n'), 'cs-health-export.csv', 'text/csv');
}

function toggleExportDd(key) {
  const menu = el('export-menu-' + key);
  if (!menu) return;
  document.querySelectorAll('[id^="export-menu-"]').forEach(m => {
    if (m !== menu) m.classList.remove('open');
  });
  menu.classList.toggle('open');
}

// ─── NOTIFICATION BELL (v86) ───────────────────────────────────

function toggleBellDd() {
  const m = el('bell-dd-menu');
  if (!m) return;
  const open = m.classList.contains('open');
  document.querySelectorAll('.snooze-dd__menu.open').forEach(x => x.classList.remove('open'));
  if (!open) { renderBellDd(); m.classList.add('open'); }
}

function renderBellDd() {
  const m = el('bell-dd-menu');
  if (!m) return;
  const all = buildAlerts();
  const active = all.filter(a => !isSnoozed(a.id) && !dismissed.has(a.id));
  if (!active.length) {
    m.innerHTML = `<div style="padding:14px 16px;font-size:.8rem;color:var(--muted);text-align:center">✓ All clear — no active alerts</div>`;
    return;
  }
  const top5 = active.slice(0, 5);
  const dotColor = { red:'var(--red)', amber:'var(--amber)', blue:'var(--blue)', green:'var(--green)' };
  let html = top5.map(a => {
    const c = customers.find(x => x.id === a.cid);
    return `<button class="snooze-dd__item" onclick="toggleBellDd();${c ? `openDetail('${c.id}')` : `nav('alerts')`}" style="flex-direction:column;align-items:flex-start;gap:2px;padding:9px 14px">
      <div style="display:flex;align-items:center;gap:7px;width:100%">
        <span style="width:7px;height:7px;border-radius:50%;background:${dotColor[a.type]||'var(--muted)'};flex-shrink:0"></span>
        <span style="font-size:.78rem;color:var(--text);flex:1;text-align:left">${a.msg}</span>
      </div>
      ${a.sub ? `<div style="font-size:.7rem;color:var(--muted);padding-left:14px">${a.sub}</div>` : ''}
    </button>`;
  }).join('');
  if (active.length > 5) {
    html += `<div style="padding:5px 14px;font-size:.72rem;color:var(--muted)">+${active.length - 5} more alert${active.length - 5 !== 1 ? 's' : ''}</div>`;
  }
  html += `<div style="border-top:1px solid var(--border);padding:8px 14px">
    <button class="snooze-dd__item" onclick="toggleBellDd();nav('alerts')" style="font-size:.78rem;color:var(--blue);font-weight:600;width:100%;justify-content:center">View all alerts →</button>
  </div>`;
  m.innerHTML = html;
}

// ─── FILTER PRESETS (v85) ──────────────────────────────────────

function togglePresetDd() {
  const menu = el('preset-dd-menu');
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  // Close all other dropdowns first
  document.querySelectorAll('[id^="export-menu-"]').forEach(m => m.classList.remove('open'));
  if (!isOpen) {
    renderPresetDd();
    menu.classList.add('open');
  } else {
    menu.classList.remove('open');
  }
}

function renderPresetDd() {
  const menu = el('preset-dd-menu');
  if (!menu) return;
  let html = '';
  if (filterPresets.length === 0) {
    html += `<div class="snooze-dd__item" style="color:var(--muted);cursor:default;font-style:italic">No presets saved yet</div>`;
  }
  filterPresets.forEach((p, i) => {
    const parts = [];
    if (p.filterMode && p.filterMode !== 'all') parts.push(p.filterMode);
    const cf = p.columnFilters ? Object.keys(p.columnFilters).length : 0;
    if (cf) parts.push(`${cf} filter${cf>1?'s':''}`);
    const desc = parts.length ? parts.join(' + ') : 'all';
    html += `<div class="snooze-dd__item">
      <span style="flex:1;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick="applyPreset(${i})">
        <strong>${escHtml(p.name)}</strong>
        <span style="color:var(--muted);font-size:.72rem;margin-left:4px">${escHtml(desc)}</span>
      </span>
      <button class="preset-del" onclick="event.stopPropagation();deletePreset(${i})" title="Remove preset">✕</button>
    </div>`;
  });
  html += `<div style="border-top:1px solid var(--border);margin:4px 0"></div>`;
  html += `<div class="snooze-dd__item" onclick="saveCurrentPreset()" style="color:var(--blue);font-weight:600;cursor:pointer">+ Save current view as preset…</div>`;
  menu.innerHTML = html;
}

function saveCurrentPreset() {
  const name = prompt('Name this filter preset:');
  if (!name || !name.trim()) return;
  filterPresets.push({
    name: name.trim(),
    filterMode,
    columnFilters: JSON.parse(JSON.stringify(columnFilters)),
    sortKey,
    sortDir
  });
  localStorage.setItem('iqc_filter_presets', JSON.stringify(filterPresets));
  renderPresetDd();
  toast('Preset saved', 'success');
}

function applyPreset(idx) {
  const p = filterPresets[idx];
  if (!p) return;
  filterMode    = p.filterMode;
  columnFilters = JSON.parse(JSON.stringify(p.columnFilters));
  sortKey       = p.sortKey;
  sortDir       = p.sortDir;
  // Sync status chip UI
  document.querySelectorAll('.fchip').forEach(b => b.classList.remove('fa'));
  const chipId = filterMode === 'all' ? 'fc-all' : 'fc-' + filterMode;
  if (el(chipId)) el(chipId).classList.add('fa');
  renderCustomers();
  el('preset-dd-menu')?.classList.remove('open');
  toast(`Applied: ${p.name}`, 'success');
}

function deletePreset(idx) {
  filterPresets.splice(idx, 1);
  localStorage.setItem('iqc_filter_presets', JSON.stringify(filterPresets));
  renderPresetDd();
}

// ─── RESCORE FROM TOOLBAR (v85) ────────────────────────────────

function rescoreAllFromToolbar() {
  confirmAction(`Recalculate health scores for all ${customers.length} customer${customers.length !== 1 ? 's' : ''} using current weight settings?`, () => {
    let n = 0;
    const changed = [];
    customers.forEach(c => {
      const profileMatch = c.scoring_profile ? profiles.find(p => p.name === c.scoring_profile) : null;
      const resolvedWeights = profileMatch ? profileMatch.weights : weights;
      const { score } = calcScore(c, resolvedWeights);
      if (c.score !== score) {
        c.history = c.history || [];
        c.history.push({ score, date: new Date().toISOString() });
        c.score  = score;
        c.status = getStatus(score);
        changed.push(c);
        n++;
      }
    });
    renderDashboard();
    renderCustomers();
    renderAlerts();
    toast(`Re-scored ${n} customer${n !== 1 ? 's' : ''}`, 'success');
    if (changed.length) {
      setLoading(true);
      Promise.all(changed.map(c => atUpdate(c).catch(() => {}))).finally(() => setLoading(false));
    }
  });
}

// ─── SEGMENTS VIEW ───────────────────────────────────────────

let segSortKey = 'mrr';
let segSortDir = 'desc';
let _hideUntagged = localStorage.getItem('iqc_hide_untagged') === 'true';

function toggleHideUntagged() {
  _hideUntagged = !_hideUntagged;
  localStorage.setItem('iqc_hide_untagged', _hideUntagged);
  renderSegments();
}

function renderSegments() {
  const kpiRow = el('seg-kpi-row');
  const cardsWrap = el('seg-cards-wrap');
  const tableWrap = el('seg-table-wrap');
  const insightsWrap = el('seg-insights-wrap');
  if (!kpiRow) return;

  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));

  // Cache getDelta7d once per customer
  const deltaCache = new Map();
  active.forEach(c => deltaCache.set(c.id, getDelta7d(c)));

  // Build enriched segment data
  const tagMap = {};
  active.forEach(c => {
    (c.tags || []).forEach(tag => {
      if (!tagMap[tag]) tagMap[tag] = { tag, custs: [], totalMRR: 0, healthy: 0, watch: 0, atRisk: 0, riskMRR: 0, overdueCount: 0, renewals90: 0 };
      const seg = tagMap[tag];
      seg.custs.push(c);
      seg.totalMRR += (c.mrr || 0);
      if (c.status === 'healthy' || c.status === 'expand') seg.healthy++;
      else if (c.status === 'watch') seg.watch++;
      else if (c.status === 'critical' || c.status === 'risk') { seg.atRisk++; seg.riskMRR += (c.mrr || 0); }
      if (c.days != null && c.days >= 14) seg.overdueCount++;
      if (c.renewal != null && c.renewal > 0 && c.renewal <= 3) seg.renewals90++;
    });
  });

  // Collect untagged customers into a virtual segment
  const untaggedCustomers = active.filter(c => !c.tags || c.tags.length === 0);
  if (untaggedCustomers.length > 0) {
    tagMap[SEG_UNTAGGED] = { tag: SEG_UNTAGGED, custs: [], totalMRR: 0, healthy: 0, watch: 0, atRisk: 0, riskMRR: 0, overdueCount: 0, renewals90: 0 };
    const seg = tagMap[SEG_UNTAGGED];
    untaggedCustomers.forEach(c => {
      seg.custs.push(c);
      seg.totalMRR += (c.mrr || 0);
      if (c.status === 'healthy' || c.status === 'expand') seg.healthy++;
      else if (c.status === 'watch') seg.watch++;
      else if (c.status === 'critical' || c.status === 'risk') { seg.atRisk++; seg.riskMRR += (c.mrr || 0); }
      if (c.days != null && c.days >= 14) seg.overdueCount++;
      if (c.renewal != null && c.renewal > 0 && c.renewal <= 3) seg.renewals90++;
    });
  }

  const segments = Object.values(tagMap).map(seg => {
    seg.count = seg.custs.length;
    seg.avgScore = Math.round(seg.custs.reduce((s, c) => s + c.score, 0) / seg.count);
    seg.avgDelta = Math.round(seg.custs.reduce((s, c) => s + (deltaCache.get(c.id) || 0), 0) / seg.count * 10) / 10;
    seg.riskPct = Math.round((seg.atRisk / seg.count) * 100);
    seg.avgDays = seg.custs.filter(c => c.days != null).length
      ? Math.round(seg.custs.filter(c => c.days != null).reduce((s, c) => s + c.days, 0) / seg.custs.filter(c => c.days != null).length)
      : null;
    return seg;
  });

  // Apply "Hide Untagged" filter
  const visibleSegments = _hideUntagged ? segments.filter(s => s.tag !== SEG_UNTAGGED) : segments;

  // Cache for drill-down usage
  window._segData = visibleSegments;
  window._segDeltaCache = deltaCache;

  if (!visibleSegments.length) {
    const tagIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';
    kpiRow.innerHTML = '';
    if (cardsWrap) cardsWrap.innerHTML = `<div class="empty-st"><div class="ei" style="font-size:1.5rem;color:var(--muted)">${tagIcon}</div><h3>No tags yet</h3><p>Add tags to customers via the edit form or bulk-tag to create segments.</p></div>`;
    if (tableWrap) tableWrap.innerHTML = '';
    if (insightsWrap) insightsWrap.innerHTML = '';
    return;
  }

  const subtitle = el('seg-subtitle');
  if (subtitle) subtitle.textContent = `${visibleSegments.length} segment${visibleSegments.length !== 1 ? 's' : ''} \u00b7 ${active.length} accounts`;

  const toggleBtn = document.getElementById('seg-toggle-untagged');
  if (toggleBtn) toggleBtn.textContent = _hideUntagged ? 'Show Untagged' : 'Hide Untagged';

  renderSegKPIs(visibleSegments, active);
  renderSegCardGrid(visibleSegments);
  renderSegTable(visibleSegments);
  renderSegInsights(visibleSegments);
}

/* ── Segment KPI Cards ─────────────────────────────────────── */
function renderSegKPIs(segments, active) {
  const wrap = el('seg-kpi-row');
  if (!wrap) return;

  const _si = (path) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const icons = {
    tag:     _si('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'),
    people:  _si('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    dollar:  _si('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
    alert:   _si('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    trendUp: _si('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
  };

  // Unique account count
  const uniqueIds = new Set();
  segments.forEach(seg => seg.custs.forEach(c => uniqueIds.add(c.id)));
  const uniqueCount = uniqueIds.size;

  // Total unique MRR (by unique customer)
  const mrrMap = new Map();
  segments.forEach(seg => seg.custs.forEach(c => mrrMap.set(c.id, c.mrr || 0)));
  const totalMRR = [...mrrMap.values()].reduce((s, v) => s + v, 0);

  // Risk MRR (unique customers that are at risk)
  const riskIds = new Set();
  segments.forEach(seg => seg.custs.filter(c => c.status === 'critical' || c.status === 'risk').forEach(c => riskIds.add(c.id)));
  const riskMRR = [...riskIds].reduce((s, id) => s + (mrrMap.get(id) || 0), 0);

  // Highest-risk segment (by riskPct, min 3 accounts)
  const qualifiedSegs = segments.filter(s => s.count >= 2);
  const highestRisk = qualifiedSegs.length ? qualifiedSegs.reduce((a, b) => a.riskPct > b.riskPct ? a : b) : null;
  const hrColor = 'dash-kpi-red';

  // Fastest growing segment (by avgDelta)
  const fastestGrow = segments.length ? segments.reduce((a, b) => a.avgDelta > b.avgDelta ? a : b) : null;

  wrap.innerHTML = `
    <div class="dash-kpi-card dash-kpi-blue">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${icons.tag}</div>
        <span class="dash-kpi-label">Total Segments</span>
      </div>
      <div class="dash-kpi-num">${segments.length}</div>
      <div class="dash-kpi-sub">customer tag groups</div>
    </div>
    <div class="dash-kpi-card dash-kpi-purple">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${icons.people}</div>
        <span class="dash-kpi-label">Total Accounts</span>
      </div>
      <div class="dash-kpi-num">${uniqueCount}</div>
      <div class="dash-kpi-sub">across ${segments.length} segment${segments.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="dash-kpi-card dash-kpi-teal">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${icons.dollar}</div>
        <span class="dash-kpi-label">Segment MRR</span>
      </div>
      <div class="dash-kpi-num">$${fmtNum(totalMRR)}</div>
      <div class="dash-kpi-sub">${riskMRR > 0 ? '$' + fmtNum(riskMRR) + ' at risk' : 'No MRR at risk'}</div>
    </div>
    <div class="dash-kpi-card ${hrColor}">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${icons.alert}</div>
        <span class="dash-kpi-label">Highest-Risk</span>
      </div>
      <div class="dash-kpi-num" style="font-size:1.4rem">${highestRisk ? escHtml(segDisplayLabel(highestRisk.tag)) : '—'}</div>
      <div class="dash-kpi-sub">${highestRisk ? highestRisk.riskPct + '% at risk' : 'No data'}</div>
    </div>
    <div class="dash-kpi-card dash-kpi-green">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${icons.trendUp}</div>
        <span class="dash-kpi-label">Fastest-Growing</span>
      </div>
      <div class="dash-kpi-num" style="font-size:1.4rem">${fastestGrow ? escHtml(segDisplayLabel(fastestGrow.tag)) : '—'}</div>
      <div class="dash-kpi-sub">${fastestGrow ? (fastestGrow.avgDelta >= 0 ? '+' : '') + fastestGrow.avgDelta + ' avg trend' : 'No data'}</div>
    </div>
  `;
}

/* ── Segment Cards (enriched) ──────────────────────────────── */
function renderSegCardGrid(segments) {
  const wrap = el('seg-cards-wrap');
  if (!wrap) return;

  const sorted = [...segments].sort((a, b) => b.totalMRR - a.totalMRR);

  const scoreColor = v => v >= (thresholds.healthy || 80) ? 'var(--green)' : v >= (thresholds.watch || 65) ? 'var(--amber)' : v >= (thresholds.risk || 50) ? 'var(--orange,#ea580c)' : 'var(--red)';
  const scoreBg = v => v >= (thresholds.healthy || 80) ? 'var(--green-l)' : v >= (thresholds.watch || 65) ? 'var(--amber-l)' : v >= (thresholds.risk || 50) ? 'rgba(234,88,12,.1)' : 'var(--red-l)';

  let html = `<div class="seg-cards-grid">${sorted.map(seg => {
    const trendCls = seg.avgDelta > 0 ? 'up' : seg.avgDelta < 0 ? 'dn' : 'flat';
    const trendIcon = seg.avgDelta > 0 ? '▲' : seg.avgDelta < 0 ? '▼' : '—';
    const trendTxt = seg.avgDelta > 0 ? '+' + seg.avgDelta : '' + seg.avgDelta;
    const total = seg.healthy + seg.watch + seg.atRisk;
    const hPct = total ? Math.round((seg.healthy / total) * 100) : 0;
    const wPct = total ? Math.round((seg.watch / total) * 100) : 0;
    const rPct = total ? 100 - hPct - wPct : 0;
    const safeTag = seg.tag.replace(/'/g, "\\'").replace(/"/g, '&quot;');

    return `<div class="card seg-card" data-seg="${escHtml(seg.tag)}" onclick="drillSegFromCard('${safeTag}')" style="cursor:pointer">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span class="tag" style="font-size:.78rem">${escHtml(segDisplayLabel(seg.tag))}</span>
        <span class="seg-score-badge" style="color:${scoreColor(seg.avgScore)};background:${scoreBg(seg.avgScore)}">${seg.avgScore}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
        <span style="font-size:1.7rem;font-weight:800;line-height:1">${seg.count}</span>
        <span class="seg-card-trend ${trendCls}">${trendIcon} ${trendTxt}</span>
      </div>
      <div style="font-size:.7rem;color:var(--muted);margin-bottom:10px">account${seg.count !== 1 ? 's' : ''}</div>
      <div class="seg-health-bar" style="height:6px;margin-bottom:12px" title="${seg.healthy} healthy · ${seg.watch} watch · ${seg.atRisk} at risk">
        ${hPct ? `<span class="seg-health-seg" style="width:${hPct}%;background:var(--green)"></span>` : ''}
        ${wPct ? `<span class="seg-health-seg" style="width:${wPct}%;background:var(--amber)"></span>` : ''}
        ${rPct ? `<span class="seg-health-seg" style="width:${rPct}%;background:var(--red)"></span>` : ''}
      </div>
      <div class="seg-card__divider"></div>
      <div class="seg-card__row">
        <span class="seg-card__row-label">MRR</span>
        <span class="seg-card__row-val">$${fmtNum(seg.totalMRR)}</span>
      </div>
      <div class="seg-card__row">
        <span class="seg-card__row-label">At Risk</span>
        <span class="seg-card__row-val" style="color:${seg.atRisk ? 'var(--red)' : 'var(--green)'}">${seg.atRisk ? seg.atRisk + ' (' + seg.riskPct + '%)' : 'None'}</span>
      </div>
      ${seg.overdueCount ? `<div class="seg-card__row"><span class="seg-card__row-label">Overdue</span><span class="seg-card__row-val" style="color:var(--red)">${seg.overdueCount}</span></div>` : ''}
    </div>`;
  }).join('')}</div>`;

  html += `<div id="seg-card-expand" class="seg-expand-panel"></div>`;
  wrap.innerHTML = html;
}

/* ── Segment Comparison Table ──────────────────────────────── */
function renderSegTable(segments) {
  const wrap = el('seg-table-wrap');
  if (!wrap) return;

  const sortIcon = key => {
    if (segSortKey !== key) return '';
    return segSortDir === 'asc' ? ' ▲' : ' ▼';
  };
  const activeClass = key => segSortKey === key ? 'seg-sort-active' : '';

  const sorted = [...segments].sort((a, b) => {
    let va, vb;
    switch (segSortKey) {
      case 'tag':      va = a.tag.toLowerCase(); vb = b.tag.toLowerCase(); return segSortDir === 'asc' ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1);
      case 'count':    va = a.count; vb = b.count; break;
      case 'avgScore': va = a.avgScore; vb = b.avgScore; break;
      case 'avgDelta': va = a.avgDelta; vb = b.avgDelta; break;
      case 'mrr':      va = a.totalMRR; vb = b.totalMRR; break;
      case 'riskPct':  va = a.riskPct; vb = b.riskPct; break;
      case 'avgDays':  va = a.avgDays || 0; vb = b.avgDays || 0; break;
      case 'renewals': va = a.renewals90; vb = b.renewals90; break;
      default:         va = a.totalMRR; vb = b.totalMRR;
    }
    return segSortDir === 'asc' ? va - vb : vb - va;
  });

  const chevronDown = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  const scoreColor = v => v >= (thresholds.healthy || 80) ? 'var(--green)' : v >= (thresholds.watch || 65) ? 'var(--amber)' : v >= (thresholds.risk || 50) ? 'var(--orange,#ea580c)' : 'var(--red)';

  const colCount = 9;
  window._segColCount = colCount;

  wrap.innerHTML = `<div class="seg-table-wrap-scroll">
    <table class="ct" style="min-width:900px">
      <thead><tr>
        <th class="seg-sort-btn ${activeClass('tag')}" onclick="sortSegTable('tag')">Segment${sortIcon('tag')}</th>
        <th class="seg-sort-btn ${activeClass('count')}" onclick="sortSegTable('count')">Accounts${sortIcon('count')}</th>
        <th class="seg-sort-btn ${activeClass('avgScore')}" onclick="sortSegTable('avgScore')">Avg Score${sortIcon('avgScore')}</th>
        <th class="seg-sort-btn ${activeClass('avgDelta')}" onclick="sortSegTable('avgDelta')">Trend (7d)${sortIcon('avgDelta')}</th>
        <th class="seg-sort-btn ${activeClass('mrr')}" onclick="sortSegTable('mrr')">MRR${sortIcon('mrr')}</th>
        <th class="seg-sort-btn ${activeClass('riskPct')}" onclick="sortSegTable('riskPct')">At-Risk %${sortIcon('riskPct')}</th>
        <th class="seg-sort-btn ${activeClass('avgDays')}" onclick="sortSegTable('avgDays')">Avg Contact${sortIcon('avgDays')}</th>
        <th class="seg-sort-btn ${activeClass('renewals')}" onclick="sortSegTable('renewals')">Renewals \u226490d${sortIcon('renewals')}</th>
        <th style="width:90px"></th>
      </tr></thead>
      <tbody id="seg-table-tbody">${sorted.map(seg => {
        const trendCls = seg.avgDelta > 0 ? 'up' : seg.avgDelta < 0 ? 'dn' : 'flat';
        const trendIcon = seg.avgDelta > 0 ? '▲' : seg.avgDelta < 0 ? '▼' : '—';
        const trendTxt = seg.avgDelta > 0 ? '+' + seg.avgDelta : '' + seg.avgDelta;
        const safeTag = seg.tag.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const contactStr = seg.avgDays != null ? seg.avgDays + 'd' : '—';
        return `<tr class="seg-table-row" data-seg="${escHtml(seg.tag)}">
          <td><strong>${escHtml(segDisplayLabel(seg.tag))}</strong></td>
          <td>${seg.count}</td>
          <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.78rem;font-weight:700;color:${scoreColor(seg.avgScore)};background:${seg.avgScore >= 65 ? 'var(--green-l)' : seg.avgScore >= 50 ? 'var(--amber-l)' : 'var(--red-l)'}">${seg.avgScore}</span></td>
          <td><span class="csm-trend ${trendCls}" style="font-size:.68rem;padding:1px 6px">${trendIcon} ${trendTxt}</span></td>
          <td>$${fmtNum(seg.totalMRR)}</td>
          <td><span style="font-weight:700;color:${seg.riskPct > 30 ? 'var(--red)' : seg.riskPct > 0 ? 'var(--amber)' : 'var(--green)'}">${seg.riskPct}%</span> <span style="font-size:.7rem;color:var(--muted)">(${seg.atRisk})</span></td>
          <td>${contactStr}</td>
          <td>${seg.renewals90}</td>
          <td><button class="btn-sm csm-expand-btn" onclick="event.stopPropagation();drillSeg('${safeTag}')">${chevronDown} Expand</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

function sortSegTable(key) {
  if (segSortKey === key) segSortDir = segSortDir === 'asc' ? 'desc' : 'asc';
  else { segSortKey = key; segSortDir = key === 'tag' ? 'asc' : 'desc'; }
  const segments = window._segData;
  if (segments) renderSegTable(segments);
}

/* ── Shared Drill-Down Builder ─────────────────────────────── */
function buildSegDrillHTML(tagName) {
  const segments = window._segData || [];
  const deltaCache = window._segDeltaCache || new Map();
  const seg = segments.find(s => s.tag === tagName);
  if (!seg) return '<p>No data for this segment.</p>';

  const accs = seg.custs;
  const avgScore = seg.avgScore;
  const totalMRR = seg.totalMRR;
  const hmColor = v => v >= 65 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)';
  const dColor = seg.avgDelta > 0 ? 'var(--green)' : seg.avgDelta < 0 ? 'var(--red)' : 'var(--muted)';
  const dIcon = seg.avgDelta > 0 ? '▲' : seg.avgDelta < 0 ? '▼' : '—';

  let summaryHTML = `<div class="csm-drill-stats">
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${hmColor(avgScore)}">${avgScore}</div>
      <div class="csm-drill-stat__label">Avg Score</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${dColor}">${dIcon} ${Math.abs(seg.avgDelta)}</div>
      <div class="csm-drill-stat__label">7d Trend</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">${seg.count}</div>
      <div class="csm-drill-stat__label">Accounts</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">$${fmtNum(totalMRR)}</div>
      <div class="csm-drill-stat__label">Total MRR</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:var(--green)">${seg.healthy}</div>
      <div class="csm-drill-stat__label">Healthy</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${seg.atRisk ? 'var(--red)' : 'var(--muted)'}">${seg.atRisk}</div>
      <div class="csm-drill-stat__label">At Risk</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${seg.overdueCount ? 'var(--red)' : 'var(--muted)'}">${seg.overdueCount}</div>
      <div class="csm-drill-stat__label">Overdue</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">${seg.renewals90}</div>
      <div class="csm-drill-stat__label">Renewals \u226490d</div>
    </div>
  </div>`;

  // Sort by urgency
  const urgency = c => {
    const statusW = c.status === 'critical' ? 5 : c.status === 'risk' ? 4 : c.status === 'watch' ? 3 : c.status === 'healthy' ? 2 : 1;
    const renewalW = c.renewal != null && c.renewal > 0 ? Math.max(0, 13 - c.renewal) : 0;
    const mrrW = (c.mrr || 0) / 10000;
    const contactW = (c.days != null && c.days >= 14) ? 2 : 0;
    return (statusW * 10) + renewalW + mrrW + contactW;
  };
  const sorted = [...accs].sort((a, b) => urgency(b) - urgency(a));

  const OVERDUE_DAYS = 14;
  const tableHTML = `<table class="ct" style="min-width:auto;margin:0">
    <thead><tr>
      <th>Customer</th><th>Score</th><th>Trend</th><th>Status</th><th>MRR</th><th>Last Contact</th><th>Renewal</th><th>Lifecycle</th>
    </tr></thead>
    <tbody>${sorted.map(c => {
      const renewStr = c.renewal_date ? new Date(c.renewal_date).toLocaleDateString() : (c.renewal ? c.renewal + 'mo' : '—');
      const isOverdue = c.days != null && c.days >= OVERDUE_DAYS;
      const delta = deltaCache.get(c.id) || 0;
      const trendHTML = delta > 0
        ? `<span class="csm-trend up" style="font-size:.68rem;padding:1px 6px">▲ +${delta}</span>`
        : delta < 0
          ? `<span class="csm-trend dn" style="font-size:.68rem;padding:1px 6px">▼ ${delta}</span>`
          : `<span class="csm-trend flat" style="font-size:.68rem;padding:1px 6px">— 0</span>`;
      const contactCell = isOverdue
        ? `<span style="font-weight:700;color:var(--red)">${c.days}d ago</span> <span class="csm-overdue">OVERDUE</span>`
        : (c.days != null ? c.days + 'd ago' : '—');
      return `<tr style="cursor:pointer" onclick="openDetail('${c.id}')">
        <td><strong>${escHtml(c.name)}</strong></td>
        <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.78rem;font-weight:700;color:${c.score >= 65 ? 'var(--green)' : c.score >= 50 ? 'var(--amber)' : 'var(--red)'};background:${c.score >= 65 ? 'var(--green-l)' : c.score >= 50 ? 'var(--amber-l)' : 'var(--red-l)'}">${c.score}</span></td>
        <td>${trendHTML}</td>
        <td>${badgeHTML(c.status)}</td>
        <td>$${fmtNum(c.mrr || 0)}</td>
        <td>${contactCell}</td>
        <td>${renewStr}</td>
        <td style="font-size:.78rem;color:var(--muted)">${c.lifecycle || '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;

  const safeTag = tagName.replace(/'/g, "\\'");
  const viewBtn = `<div style="text-align:right;margin-top:12px"><button class="btn-sm" onclick="filterByTag('${safeTag}')" style="gap:4px">View in Customers <span style="font-size:.8rem">\u2192</span></button></div>`;

  return summaryHTML + tableHTML + viewBtn;
}

/* ── Table Row Expand (drillSeg) ───────────────────────────── */
function drillSeg(tagName) {
  const tbody = el('seg-table-tbody');
  if (!tbody) return;
  const colCount = window._segColCount || 9;

  const parentRow = tbody.querySelector(`tr.seg-table-row[data-seg="${CSS.escape(tagName)}"]`);
  if (!parentRow) return;

  // Toggle off if already expanded
  const existingExpand = parentRow.nextElementSibling;
  if (existingExpand && existingExpand.classList.contains('seg-table-expand-row')) {
    existingExpand.remove();
    parentRow.classList.remove('seg-row-expanded');
    const btn = parentRow.querySelector('.csm-expand-btn');
    if (btn) btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Expand`;
    return;
  }

  // Collapse any other open expand
  const prevExpanded = tbody.querySelector('tr.seg-table-expand-row');
  if (prevExpanded) {
    const prevParent = prevExpanded.previousElementSibling;
    if (prevParent) {
      prevParent.classList.remove('seg-row-expanded');
      const prevBtn = prevParent.querySelector('.csm-expand-btn');
      if (prevBtn) prevBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Expand`;
    }
    prevExpanded.remove();
  }

  parentRow.classList.add('seg-row-expanded');
  const btn = parentRow.querySelector('.csm-expand-btn');
  if (btn) btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg> Collapse`;

  const expandRow = document.createElement('tr');
  expandRow.className = 'seg-table-expand-row';
  expandRow.innerHTML = `<td colspan="${colCount}" class="seg-table-expand-cell">${buildSegDrillHTML(tagName)}</td>`;
  parentRow.after(expandRow);
}

/* ── Card Grid Expand (drillSegFromCard) ───────────────────── */
function drillSegFromCard(tagName) {
  const panel = document.getElementById('seg-card-expand');
  if (!panel) return;

  // Clear previous card highlight
  const prevCard = document.querySelector('.seg-card.seg-expanded');
  if (prevCard) prevCard.classList.remove('seg-expanded');

  // Toggle off if clicking same card
  if (panel.classList.contains('open') && panel.dataset.seg === tagName) {
    panel.classList.remove('open');
    panel.dataset.seg = '';
    panel.innerHTML = '';
    return;
  }

  // Highlight clicked card
  const card = document.querySelector(`.seg-card[data-seg="${CSS.escape(tagName)}"]`);
  if (card) card.classList.add('seg-expanded');

  panel.dataset.seg = tagName;
  panel.innerHTML = buildSegDrillHTML(tagName);
  panel.classList.add('open');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ── Segment Insights (auto-generated) ─────────────────────── */
function renderSegInsights(segments) {
  const wrap = el('seg-insights-wrap');
  if (!wrap) return;

  const _si = (path) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const iconAlert    = _si('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>');
  const iconCalendar = _si('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>');
  const iconTrendDn  = _si('<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>');
  const iconPhone    = _si('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>');
  const iconTrendUp  = _si('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>');
  const iconCheck    = _si('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>');

  const insights = [];

  segments.forEach(seg => {
    // High risk % (priority 4)
    if (seg.riskPct > 40 && seg.count >= 3) {
      insights.push({ priority: 4, icon: iconAlert, bg: 'var(--red-l)', color: 'var(--red)',
        html: `<strong>${escHtml(segDisplayLabel(seg.tag))}</strong> has <strong>${seg.riskPct}%</strong> at risk (${seg.atRisk}/${seg.count})` });
    }
    // At-risk renewals in 90 days (priority 4)
    const riskRenewals = seg.custs.filter(c => (c.status === 'critical' || c.status === 'risk') && c.renewal != null && c.renewal > 0 && c.renewal <= 3).length;
    if (riskRenewals > 0) {
      insights.push({ priority: 4, icon: iconCalendar, bg: 'var(--red-l)', color: 'var(--red)',
        html: `<strong>${escHtml(segDisplayLabel(seg.tag))}</strong> has <strong>${riskRenewals}</strong> at-risk renewal${riskRenewals !== 1 ? 's' : ''} in 90 days` });
    }
    // Declining segment (priority 3)
    if (seg.avgDelta < -2) {
      insights.push({ priority: 3, icon: iconTrendDn, bg: 'var(--amber-l)', color: 'var(--amber)',
        html: `<strong>${escHtml(segDisplayLabel(seg.tag))}</strong> is declining (${seg.avgDelta} avg this week)` });
    }
    // Overdue contacts (priority 3)
    if (seg.overdueCount > 0) {
      insights.push({ priority: 3, icon: iconPhone, bg: 'var(--amber-l)', color: 'var(--amber)',
        html: `<strong>${escHtml(segDisplayLabel(seg.tag))}</strong> has <strong>${seg.overdueCount}</strong> overdue contact${seg.overdueCount !== 1 ? 's' : ''} (14+ days)` });
    }
  });

  // Positive callouts (priority 0)
  const bestAvgScore = segments.reduce((a, b) => a.avgScore > b.avgScore ? a : b, segments[0]);
  if (bestAvgScore && bestAvgScore.avgScore >= 70) {
    insights.push({ priority: 0, icon: iconTrendUp, bg: 'var(--green-l)', color: 'var(--green)',
      html: `<strong>${escHtml(segDisplayLabel(bestAvgScore.tag))}</strong> is your healthiest segment (avg ${bestAvgScore.avgScore})` });
  }
  const bestDelta = segments.reduce((a, b) => a.avgDelta > b.avgDelta ? a : b, segments[0]);
  if (bestDelta && bestDelta.avgDelta >= 3) {
    insights.push({ priority: 0, icon: iconTrendUp, bg: 'var(--green-l)', color: 'var(--green)',
      html: `<strong>${escHtml(segDisplayLabel(bestDelta.tag))}</strong> is growing fastest (+${bestDelta.avgDelta} this week)` });
  }

  // Sort by priority desc, show top 8
  insights.sort((a, b) => b.priority - a.priority);
  const top = insights.slice(0, 8);

  if (!top.length) {
    wrap.innerHTML = `<div class="csm-focus-item" style="justify-content:center;padding:24px">
      <div class="csm-focus-icon" style="background:var(--green-l);color:var(--green)">${iconCheck}</div>
      <div class="csm-focus-text"><strong style="color:var(--muted)">No urgent segment focus areas</strong></div>
    </div>`;
    return;
  }

  wrap.innerHTML = top.map(ins => `<div class="csm-focus-item">
    <div class="csm-focus-icon" style="background:${ins.bg};color:${ins.color}">${ins.icon}</div>
    <div class="csm-focus-text"><p style="margin:0">${ins.html}</p></div>
  </div>`).join('');
}

function filterByTag(tag) {
  nav('customers');
  if (tag === SEG_UNTAGGED) {
    columnFilters['tags'] = { type: 'untagged' };
  } else {
    columnFilters['tags'] = { type: 'text', q: tag };
  }
  renderCustomers();
}

// Bulksheet export — import-compatible headers + current data, ready to re-upload
function exportBulksheet() {
  const hdr = 'name,manager,score,status,mrr,arr,tier,lifecycle,logins_30d,feature_adoption_pct,open_tickets,nps_category,days_since_contact,renewal_date,months_to_renewal,growth_signal,tags,since,next_touch,scoring_profile,note,sentiment,created';
  const rows = customers.map(c => {
    const latestNote = (c.notes||[]).length ? c.notes[c.notes.length-1].text : '';
    const latestSent = (c.sentiment||[]).length ? c.sentiment[c.sentiment.length-1].val : '';
    return [
      c.name, c.manager||'', c.score, c.status,
      c.mrr||0, c.arr||0, c.tier||'mid', c.lifecycle||'active',
      c.logins||0, c.adoption||0, c.tickets||0, c.nps||'unknown', c.days||0,
      c.renewal_date||'', c.renewal||0, c.growth||'none',
      (c.tags||[]).join('|'), c.since||'', c.next_touch||'',
      c.scoring_profile||'', latestNote, latestSent, c.created||''
    ].map(v => `"${String(v).replace(/"/g,'""')}"`)
    .join(',');
  });
  dlText(hdr + '\n' + rows.join('\n'), 'cs-health-bulksheet.csv', 'text/csv');
}

// ─── BACKUP ─────────────────────────────────────────────────
function showBackupMenu() { openModal('backup-modal'); }

function backupExport() {
  const data = {
    version: 3,
    exported: new Date().toISOString(),
    customers, weights, thresholds, profiles
  };
  dlText(JSON.stringify(data, null, 2), `cs-health-backup-${Date.now()}.json`, 'application/json');
  logAudit('backup_exported', null, '', { summary: `Backup exported (${customers.length} customers)` });
  toast('Backup exported', 'success');
}

function restoreBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.customers) throw new Error('Invalid backup');
      confirmAction(`Restore backup from ${fmtDate(data.exported)}? This will replace all current data.`, async () => {
        weights    = { ...DEFAULT_WEIGHTS,    ...data.weights };
        thresholds = { ...DEFAULT_THRESHOLDS, ...data.thresholds };
        profiles   = data.profiles || [];
        saveSettings();
        closeModal('backup-modal');
        toast('Restoring…', 'default');
        setLoading(true);
        // Delete all existing records then re-create from backup
        try {
          await Promise.all(customers.map(c => atDelete(c).catch(()=>{})));
          customers = data.customers.map(c => ({ ...c, _recId: undefined }));
          await Promise.all(customers.map(c => atCreate(c).catch(()=>{})));
          toast('Backup restored!', 'success');
          logAudit('backup_restored', null, '', { summary: `Backup restored from ${fmtDate(data.exported)} (${data.customers.length} customers)` });
          logConfigChange('Backup restored from file');
          renderDashboard();
          renderSettings();
        } catch(err) {
          toast('Restore finished — some records may not have synced', 'warn');
        } finally {
          setLoading(false);
        }
      });
    } catch(err) {
      toast('Invalid backup file', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ─── UTILITIES ──────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  } catch(e) { return iso; }
}

function dlText(content, filename, mime) {
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([content],{type:mime}));
  a.download= filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── DEMO DATA ───────────────────────────────────────────────
function initDemo() {
  const now = Date.now();
  const daysAgo = d => new Date(now - d*86400000).toISOString();
  const demo = [
    { name:'Acme Corp',       mrr:8500,  tier:'mid',        lifecycle:'active',    logins:22, adoption:78, tickets:1, nps:'promoter',  days:5,  renewal:9, growth:'strong', tags:['power-user'] },
    { name:'Beta Tech',       mrr:2200,  tier:'smb',        lifecycle:'atrisk',    logins:3,  adoption:22, tickets:4, nps:'detractor', days:45, renewal:2, growth:'none',   tags:['renewal-soon'] },
    { name:'Cascade Systems', mrr:18000, tier:'enterprise', lifecycle:'active',    logins:28, adoption:91, tickets:0, nps:'promoter',  days:3,  renewal:11,growth:'strong', tags:['upsell-candidate'] },
    { name:'Delta SaaS',      mrr:1100,  tier:'smb',        lifecycle:'onboarding',logins:8,  adoption:35, tickets:2, nps:'passive',   days:12, renewal:10,growth:'mild',   tags:[] },
    { name:'Echo AI',         mrr:5500,  tier:'mid',        lifecycle:'active',    logins:18, adoption:65, tickets:1, nps:'promoter',  days:9,  renewal:6, growth:'mild',   tags:['qbr-pending'] },
    { name:'Foxtrot Labs',    mrr:3300,  tier:'smb',        lifecycle:'atrisk',    logins:2,  adoption:15, tickets:5, nps:'detractor', days:60, renewal:1, growth:'none',   tags:['renewal-soon','churn-risk'] },
    { name:'Gamma Cloud',     mrr:22000, tier:'enterprise', lifecycle:'won',       logins:30, adoption:95, tickets:0, nps:'promoter',  days:2,  renewal:12,growth:'strong', tags:['case-study'] },
    { name:'Harbor Analytics',mrr:4800,  tier:'mid',        lifecycle:'active',    logins:14, adoption:58, tickets:2, nps:'passive',   days:18, renewal:5, growth:'none',   tags:[] }
  ];
  customers = demo.map((d, i) => {
    const { score } = calcScore(d);
    const status = getStatus(score);
    // Build history with 4 data points
    const hist = [
      { score: Math.max(0,Math.min(100,score - 15 + Math.floor(Math.random()*10))), date: daysAgo(90) },
      { score: Math.max(0,Math.min(100,score - 8  + Math.floor(Math.random()*8))),  date: daysAgo(60) },
      { score: Math.max(0,Math.min(100,score - 3  + Math.floor(Math.random()*6))),  date: daysAgo(30) },
      { score, date: daysAgo(i) }
    ];
    return {
      id:       crypto.randomUUID(),
      ...d,
      score, status,
      notes:    i===0 ? [{ text:'QBR went well. Champion is engaged and open to upsell convo.', date: daysAgo(5) }] : [],
      history:  hist,
      created:  daysAgo(i * 7)
    };
  });
  // Callers are responsible for pushing demo customers to Supabase via save()
}

// ─── PASSWORD CHANGE ─────────────────────────────────────────
async function changePassword() {
  const next    = el('pw-new')?.value     || '';
  const confirm = el('pw-confirm')?.value || '';

  if (next.length < 6) {
    toast('New password must be at least 6 characters', 'error');
    return;
  }
  if (next !== confirm) {
    toast('Passwords do not match', 'error');
    el('pw-confirm').value = '';
    el('pw-confirm').focus();
    return;
  }

  const { error } = await sb.auth.updateUser({ password: next });
  if (error) {
    toast('Error: ' + error.message, 'error');
    return;
  }

  // Clear fields
  if (el('pw-new'))     el('pw-new').value     = '';
  if (el('pw-confirm')) el('pw-confirm').value = '';

  logAudit('password_changed', null, '', { summary: 'Password changed' });
  toast('Password updated successfully!', 'success');
}

// ─── AUTO-REFRESH ────────────────────────────────────────────
let _pollTimer = null;

// Silent background sync — never shows the loading overlay
async function silentSync() {
  if (!currentUser) return;
  try {
    await loadCustomersFromSupabase();
    refreshMgrDropdown();
    const active = VIEWS.find(v => document.getElementById('view-'+v)?.classList.contains('active'));
    if (active === 'dashboard') renderDashboard();
    if (active === 'customers') renderCustomers();
    if (active === 'alerts')    renderAlerts();
  } catch(e) { /* silent */ }
}

function startPolling() {
  if (_pollTimer) return;
  _pollTimer = setInterval(silentSync, 60000);
}

function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// Refresh data when user returns to the tab (no spinner, debounced)
let _visibilityTimer = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentUser) {
    clearTimeout(_visibilityTimer);
    _visibilityTimer = setTimeout(silentSync, 1000);
  }
});

// ─── QBR PREP ────────────────────────────────────────────────
function openQBR() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  logAudit('qbr_opened', c.id, c.name, { summary: 'QBR Prep opened' });
  el('qbr-title').textContent = c.name;
  el('qbr-content').textContent = buildQBRText(c);
  closeModal('detail-modal');
  openModal('qbr-modal');
}

function buildQBRText(c) {
  const nba   = buildNextBestAction(c);
  const plays = buildPlaybook(c.score, c);
  const rec   = makeRec(c.score, c).replace(/<[^>]+>/g, '');
  const mom   = getMomentum(c);
  const cad   = getCadenceStatus(c);
  const sent  = latestSentiment(c);
  const u     = getRenewalUrgency(c);
  const momLabels = { up:'Improving', dn:'Declining', flat:'Flat', new:'New' };
  const sentLabels = { positive:'Positive', neutral:'Neutral', negative:'Negative' };
  const date  = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

  // Score history summary
  const hist = c.history || [];
  const histLine = hist.length >= 2
    ? `${hist[hist.length-2].score} → ${hist[hist.length-1].score} (${hist[hist.length-1].score > hist[hist.length-2].score ? '+' : ''}${hist[hist.length-1].score - hist[hist.length-2].score} pts)`
    : `${c.score} (first score)`;

  // Recent notes
  const recentNotes = (c.notes || []).slice(0, 3).map(n => `  • [${fmtDate(n.date)}] ${n.text}`).join('\n');

  // Plays as plain text
  const playsText = plays.map(p => `  • ${p.text.replace(/<[^>]+>/g,'')}`).join('\n');

  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QBR PREP SUMMARY — ${c.name.toUpperCase()}
Generated: ${date} · IQcadence CS Health Score
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HEALTH SNAPSHOT
  Health Score:    ${c.score} / 100  (${rec.replace(/^[^:]+:\s*/,'').split('.')[0]})
  Status:          ${STATUS_LABEL[c.status] || 'Healthy'}
  Momentum:        ${momLabels[mom] || '—'}
  Score Trend:     ${histLine}
  MRR:             ${c.mrr ? '$' + fmtNum(c.mrr) : '—'}
  Tier:            ${(c.tier || '—').toUpperCase()}
  Lifecycle:       ${c.lifecycle || '—'}
  Renewal:         ${c.renewal != null ? c.renewal + ' months' + (u ? ' — ' + u.label + ' urgency' : '') : '—'}

SIGNAL BREAKDOWN
  Login Frequency:    ${c.logins} / 30 days
  Feature Adoption:   ${c.adoption}%
  Open Tickets:       ${c.tickets}
  NPS / CSAT:         ${c.nps}
  Days Since Contact: ${c.days} days  (${cad.label})
  Growth Signal:      ${c.growth}
  Last Vibe Check:    ${sent ? sentLabels[sent.val] + ' — ' + fmtDate(sent.date) + (sent.note ? ' ("' + sent.note + '")' : '') : 'Not logged'}

NEXT BEST ACTION
  ${nba.action}
  "${nba.talk.replace(/<[^>]+>/g,'')}"

RECOMMENDED PLAYBOOK
${playsText}
${recentNotes ? `\nRECENT NOTES\n${recentNotes}` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Prepared with IQ Cadence · iqcadence.com
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

function copyQBR() {
  const text = el('qbr-content').textContent;
  navigator.clipboard.writeText(text).then(() => {
    toast('Copied to clipboard!', 'success');
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Copied to clipboard!', 'success');
  });
}

function printQBR() {
  const c = customers.find(x => x.id === detailId) || {};
  const pa = document.getElementById('print-area');
  pa.style.display = 'block';
  pa.innerHTML = `
    <style>
      body{font-family:'Courier New',monospace;color:#0f172a;padding:32px;max-width:800px;margin:0 auto;font-size:.82rem;line-height:1.7}
      pre{white-space:pre-wrap;word-break:break-word}
    </style>
    <pre>${escHtml(el('qbr-content').textContent)}</pre>`;
  window.print();
  setTimeout(() => { pa.style.display = 'none'; pa.innerHTML = ''; }, 1000);
}

// ─── CSM PERFORMANCE DASHBOARD ───────────────────────────────

function renderCSMPerformance() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const statsWrap  = el('csmperf-stats');
  const tableWrap  = el('csmperf-wrap');
  if (!statsWrap || !tableWrap) return;

  // Gather all managers
  const mgrs = {};
  active.forEach(c => {
    const key = c.manager ? c.manager.trim() : 'Unassigned';
    if (!mgrs[key]) mgrs[key] = [];
    mgrs[key].push(c);
  });

  const mgrList = Object.entries(mgrs).map(([name, accs]) => {
    const count    = accs.length;
    const totalMRR = accs.reduce((s, c) => s + (c.mrr || 0), 0);
    const totalARR = accs.reduce((s, c) => s + (c.arr || c.mrr * 12 || 0), 0);
    const avgScore = count ? Math.round(accs.reduce((s, c) => s + c.score, 0) / count) : 0;
    const healthy  = accs.filter(c => c.status === 'healthy' || c.status === 'expand').length;
    const watch    = accs.filter(c => c.status === 'watch').length;
    const atRisk   = accs.filter(c => c.status === 'critical' || c.status === 'risk').length;
    const riskMRR  = accs.filter(c => c.status === 'critical' || c.status === 'risk').reduce((s, c) => s + (c.mrr || 0), 0);
    const expand   = accs.filter(c => c.status === 'expand').length;

    // Average days since last contact
    const contactDays = accs.filter(c => c.days != null);
    const avgDays  = contactDays.length ? Math.round(contactDays.reduce((s, c) => s + c.days, 0) / contactDays.length) : null;

    // Renewals within 90 days
    const renewals90 = accs.filter(c => c.renewal != null && c.renewal > 0 && c.renewal <= 3).length;

    // 7-day portfolio trend (average delta across accounts)
    const deltas = accs.map(c => getDelta7d(c));
    const avgDelta = count ? Math.round(deltas.reduce((s, d) => s + d, 0) / count * 10) / 10 : 0;

    // Overdue contacts (14+ days)
    const overdueCount = accs.filter(c => c.days != null && c.days >= 14).length;

    // Health ratio (% healthy+expand)
    const healthPct = count ? Math.round((healthy / count) * 100) : 0;

    // Composite performance index (0–100)
    //   40% avg score, 25% health ratio, 20% inverse risk ratio, 15% contact cadence
    const riskPct     = count ? (atRisk / count) : 0;
    const contactScore = avgDays != null ? Math.max(0, 100 - (avgDays * 3)) : 50; // penalize high days
    const perfIndex = Math.round(
      (avgScore * 0.40) +
      (healthPct * 0.25) +
      ((1 - riskPct) * 100 * 0.20) +
      (contactScore * 0.15)
    );

    return { name, accs, count, totalMRR, totalARR, avgScore, healthy, watch, atRisk, riskMRR, expand, avgDays, renewals90, avgDelta, overdueCount, healthPct, perfIndex };
  });

  // Rank by performance index (exclude Unassigned from ranking)
  const ranked = mgrList.filter(m => m.name !== 'Unassigned').sort((a, b) => b.perfIndex - a.perfIndex);
  ranked.forEach((m, i) => { m.rank = i + 1; });
  const unassigned = mgrList.find(m => m.name === 'Unassigned');
  if (unassigned) unassigned.rank = null;
  // Display order: ranked CSMs first, then Unassigned at bottom
  const displayList = unassigned ? [...ranked, unassigned] : ranked;

  // --- Top-level summary stats ---
  const totalCSMs     = ranked.length;
  const totalAccounts = active.length;
  const totalMRR      = active.reduce((s, c) => s + (c.mrr || 0), 0);
  const overallAvg    = totalAccounts ? Math.round(active.reduce((s, c) => s + c.score, 0) / totalAccounts) : 0;
  const totalAtRisk   = active.filter(c => c.status === 'critical' || c.status === 'risk').length;
  const totalHealthy  = active.filter(c => c.status === 'healthy' || c.status === 'expand').length;
  const overallDelta  = totalAccounts ? Math.round(active.reduce((s, c) => s + getDelta7d(c), 0) / totalAccounts * 10) / 10 : 0;
  const totalOverdue  = active.filter(c => c.days != null && c.days >= 14).length;
  const avgAccsPerCSM = totalCSMs ? Math.round(totalAccounts / totalCSMs) : 0;

  const deltaIcon  = overallDelta > 0 ? '▲' : overallDelta < 0 ? '▼' : '—';
  const deltaColor = overallDelta > 0 ? 'var(--green)' : overallDelta < 0 ? 'var(--red)' : 'var(--muted)';

  const _si = (path) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const CSM_ICONS = {
    people:  _si('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    chart:   _si('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),
    dollar:  _si('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
    pulse:   _si('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
    alert:   _si('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  };

  const riskMRRTotal = active.filter(c=>c.status==='critical'||c.status==='risk').reduce((s,c)=>s+(c.mrr||0),0);
  const healthScoreGradient = overallAvg >= 65 ? 'dash-kpi-green' : overallAvg >= 50 ? 'dash-kpi-teal' : 'dash-kpi-red';
  const riskGradient = 'dash-kpi-red';

  statsWrap.innerHTML = `
    <div class="dash-kpi-card dash-kpi-blue">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${CSM_ICONS.people}</div>
        <span class="dash-kpi-label">Active CSMs</span>
      </div>
      <div class="dash-kpi-num">${totalCSMs}</div>
      <div class="dash-kpi-sub">~${avgAccsPerCSM} accounts each</div>
    </div>
    <div class="dash-kpi-card dash-kpi-purple">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${CSM_ICONS.chart}</div>
        <span class="dash-kpi-label">Total Accounts</span>
      </div>
      <div class="dash-kpi-num">${totalAccounts}</div>
      <div class="dash-kpi-sub">${totalHealthy} healthy · ${active.filter(c=>c.status==='watch').length} watch</div>
    </div>
    <div class="dash-kpi-card dash-kpi-teal">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${CSM_ICONS.dollar}</div>
        <span class="dash-kpi-label">Total MRR</span>
      </div>
      <div class="dash-kpi-num">$${fmtNum(totalMRR)}</div>
      <div class="dash-kpi-sub">${totalAtRisk ? '$' + fmtNum(riskMRRTotal) + ' at risk' : 'No MRR at risk'}</div>
    </div>
    <div class="dash-kpi-card ${healthScoreGradient}">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${CSM_ICONS.pulse}</div>
        <span class="dash-kpi-label">Avg Health Score</span>
      </div>
      <div class="dash-kpi-num">${overallAvg}</div>
      <div class="dash-kpi-sub">${deltaIcon} ${Math.abs(overallDelta)} pts this week</div>
    </div>
    <div class="dash-kpi-card ${riskGradient}">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${CSM_ICONS.alert}</div>
        <span class="dash-kpi-label">At-Risk Accounts</span>
      </div>
      <div class="dash-kpi-num">${totalAtRisk}</div>
      <div class="dash-kpi-sub">${totalOverdue ? totalOverdue + ' overdue contacts' : 'All contacts current'}</div>
    </div>
  `;

  // --- No CSMs ---
  if (displayList.length === 0 || (displayList.length === 1 && displayList[0].name === 'Unassigned')) {
    tableWrap.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">
      <div style="font-size:2rem;margin-bottom:8px;opacity:.3">👥</div>
      <h3 style="margin-bottom:4px">No CSMs assigned yet</h3>
      <p style="font-size:.85rem">Assign managers to your customers to see per-CSM performance metrics.</p>
    </div>`;
    return;
  }

  // --- Helpers ---
  const hmColor = v => v >= 65 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)';
  const hmBg    = v => v >= 65 ? 'var(--green-l)' : v >= 50 ? 'var(--amber-l)' : 'var(--red-l)';
  const rankBadge = r => {
    if (r === null) return '';
    const cls = r === 1 ? 'gold' : r === 2 ? 'silver' : r === 3 ? 'bronze' : 'default';
    return `<span class="csm-rank ${cls}">#${r}</span>`;
  };
  const trendBadge = d => {
    if (d > 0) return `<span class="csm-trend up">▲ +${d}</span>`;
    if (d < 0) return `<span class="csm-trend dn">▼ ${d}</span>`;
    return `<span class="csm-trend flat">— 0</span>`;
  };
  const healthBar = m => {
    const total = m.count || 1;
    const hPct = Math.round((m.healthy / total) * 100);
    const wPct = Math.round((m.watch / total) * 100);
    const rPct = 100 - hPct - wPct;
    return `<div class="csm-health-bar" title="${m.healthy} healthy · ${m.watch} watch · ${m.atRisk} at risk">
      <span style="width:${hPct}%;background:var(--green)"></span>
      <span style="width:${wPct}%;background:var(--amber)"></span>
      <span style="width:${rPct}%;background:var(--red)"></span>
    </div>`;
  };

  // --- CSM Leaderboard Table ---
  const colCount = 12;
  tableWrap.innerHTML = `<div class="csm-perf-table-wrap"><table class="ct" id="csm-perf-table">
    <thead><tr>
      <th style="width:36px">Rank</th>
      <th>CSM</th>
      <th>Score</th>
      <th>Perf Index</th>
      <th>Trend (7d)</th>
      <th>Health Mix</th>
      <th>Accounts</th>
      <th>MRR Managed</th>
      <th>At-Risk MRR</th>
      <th>Avg Contact</th>
      <th>Renewals ≤90d</th>
      <th></th>
    </tr></thead>
    <tbody id="csm-perf-tbody">${displayList.map(m => {
      const contactWarn = m.avgDays != null && m.avgDays >= 14;
      const safeName = escHtml(m.name).replace(/'/g, "\\'");
      return `<tr data-csm="${escHtml(m.name)}" class="csm-row">
      <td style="text-align:center">${rankBadge(m.rank)}</td>
      <td><strong>${escHtml(m.name)}</strong>${m.overdueCount ? ` <span style="font-size:.66rem;color:var(--red);font-weight:700">${m.overdueCount} overdue</span>` : ''}</td>
      <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.78rem;font-weight:700;color:${hmColor(m.avgScore)};background:${hmBg(m.avgScore)}">${m.avgScore}</span></td>
      <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.78rem;font-weight:700;color:${hmColor(m.perfIndex)};background:${hmBg(m.perfIndex)}">${m.perfIndex}</span></td>
      <td>${trendBadge(m.avgDelta)}</td>
      <td>${healthBar(m)}</td>
      <td>${m.count}</td>
      <td>$${fmtNum(m.totalMRR)}</td>
      <td style="color:${m.riskMRR ? 'var(--red)' : 'var(--muted)'};font-weight:${m.riskMRR ? '700' : '400'}">$${fmtNum(m.riskMRR)}</td>
      <td style="color:${contactWarn?'var(--red)':'inherit'};font-weight:${contactWarn?'700':'400'}">${m.avgDays != null ? m.avgDays + 'd' : '—'}</td>
      <td>${m.renewals90 || '—'}</td>
      <td><button class="btn btn-xs btn-ghost csm-expand-btn" data-csm="${escHtml(m.name)}" onclick="drillCSM('${safeName}')"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Expand</button></td>
    </tr>`}).join('')}</tbody>
  </table></div>`;
  // Store mgrList for drilldown access
  window._csmPerfData = displayList;
  window._csmColCount = colCount;

  // Render the 4 insight panels
  renderCSMWorkload(displayList);
  renderCSMFocus(displayList);
  renderCSMMovement(displayList);
  renderCSMActivity(displayList);
}

/* ─── WORKLOAD BALANCE ─────────────────────────────────────────── */
function renderCSMWorkload(mgrList) {
  const wrap = el('csm-workload-wrap');
  if (!wrap) return;
  const list = mgrList.filter(m => m.name !== 'Unassigned');
  if (!list.length) { wrap.innerHTML = '<p style="padding:20px;text-align:center;color:var(--muted);font-size:.82rem">No CSMs to display.</p>'; return; }

  const maxAccounts = Math.max(...list.map(m => m.count), 1);
  const maxMRR      = Math.max(...list.map(m => m.totalMRR), 1);
  const avgAccounts = Math.round(list.reduce((s,m) => s + m.count, 0) / list.length);

  wrap.innerHTML = `
    <div style="padding:10px 16px 4px;display:flex;gap:16px;font-size:.68rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">
      <span style="flex:0 0 110px">CSM</span>
      <span style="flex:1">Accounts</span>
      <span style="flex:1">MRR</span>
    </div>
    ${list.sort((a,b) => b.count - a.count).map(m => {
      const accPct = Math.round((m.count / maxAccounts) * 100);
      const mrrPct = Math.round((m.totalMRR / maxMRR) * 100);
      const overloaded = m.count > avgAccounts * 1.4;
      const accColor = overloaded ? 'var(--amber)' : 'var(--blue)';
      return `<div class="csm-workload-row">
        <div class="csm-workload-name">${escHtml(m.name)}</div>
        <div style="flex:1;display:flex;align-items:center;gap:8px">
          <div class="csm-workload-bar"><div class="csm-workload-fill" style="width:${accPct}%;background:${accColor}">${m.count}</div></div>
        </div>
        <div style="flex:1;display:flex;align-items:center;gap:8px">
          <div class="csm-workload-bar"><div class="csm-workload-fill" style="width:${mrrPct}%;background:var(--teal)">$${fmtNum(m.totalMRR)}</div></div>
        </div>
      </div>`;
    }).join('')}
    <div style="padding:8px 16px;font-size:.68rem;color:var(--subtle)">Average: ${avgAccounts} accounts per CSM${list.some(m => m.count > avgAccounts * 1.4) ? ' · <span style="color:var(--amber);font-weight:700">Amber bars indicate overloaded CSMs</span>' : ''}</div>
  `;
}

/* ─── SUGGESTED FOCUS AREAS ────────────────────────────────────── */
function renderCSMFocus(mgrList) {
  const wrap = el('csm-focus-wrap');
  if (!wrap) return;
  const items = [];
  const _fi = (path) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

  mgrList.filter(m => m.name !== 'Unassigned').forEach(m => {
    // Overdue contacts
    const overdueAccs = m.accs.filter(c => c.days != null && c.days >= 14);
    if (overdueAccs.length) {
      const names = overdueAccs.slice(0, 3).map(c => c.name).join(', ') + (overdueAccs.length > 3 ? ` +${overdueAccs.length - 3} more` : '');
      items.push({ csm: m.name, priority: 3, icon: _fi('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.09 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>'),
        color: 'var(--red)', bg: 'var(--red-l)',
        text: `<strong>${escHtml(m.name)}</strong> has ${overdueAccs.length} account${overdueAccs.length>1?'s':''} with no contact in 14+ days`,
        detail: names });
    }
    // At-risk renewals within 90 days
    const riskRenewals = m.accs.filter(c => (c.status === 'critical' || c.status === 'risk') && c.renewal != null && c.renewal > 0 && c.renewal <= 3);
    if (riskRenewals.length) {
      const names = riskRenewals.map(c => `${c.name} (${c.score})`).join(', ');
      items.push({ csm: m.name, priority: 4, icon: _fi('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
        color: 'var(--red)', bg: 'var(--red-l)',
        text: `<strong>${escHtml(m.name)}</strong> has ${riskRenewals.length} at-risk renewal${riskRenewals.length>1?'s':''} in the next 90 days`,
        detail: names });
    }
    // Declining portfolio (negative trend)
    if (m.avgDelta < -2) {
      items.push({ csm: m.name, priority: 2, icon: _fi('<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>'),
        color: 'var(--amber)', bg: 'var(--amber-l)',
        text: `<strong>${escHtml(m.name)}</strong>'s portfolio is declining (${m.avgDelta} avg this week)`,
        detail: `Avg score: ${m.avgScore}, ${m.atRisk} at risk` });
    }
    // High risk ratio
    if (m.count >= 3 && (m.atRisk / m.count) >= 0.4) {
      items.push({ csm: m.name, priority: 2, icon: _fi('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
        color: 'var(--red)', bg: 'var(--red-l)',
        text: `<strong>${escHtml(m.name)}</strong> has ${Math.round((m.atRisk/m.count)*100)}% of accounts at risk (${m.atRisk}/${m.count})`,
        detail: `$${fmtNum(m.riskMRR)} MRR at risk` });
    }
    // Positive callout — improving portfolio
    if (m.avgDelta >= 3) {
      items.push({ csm: m.name, priority: 0, icon: _fi('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
        color: 'var(--green)', bg: 'var(--green-l)',
        text: `<strong>${escHtml(m.name)}</strong> is improving their portfolio (+${m.avgDelta} avg this week)`,
        detail: `${m.healthy} healthy, avg score ${m.avgScore}` });
    }
  });

  items.sort((a, b) => b.priority - a.priority);

  if (!items.length) {
    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:.82rem"><div style="font-size:1.4rem;margin-bottom:6px;opacity:.3">✓</div>No urgent focus areas — all CSMs look good.</div>';
    return;
  }

  wrap.innerHTML = items.slice(0, 8).map(it => `
    <div class="csm-focus-item">
      <div class="csm-focus-icon" style="background:${it.bg};color:${it.color}">${it.icon}</div>
      <div class="csm-focus-text">
        <div>${it.text}</div>
        <p>${escHtml(it.detail)}</p>
      </div>
    </div>`).join('');
}

/* ─── PORTFOLIO MOVEMENT ───────────────────────────────────────── */
function renderCSMMovement(mgrList) {
  const wrap = el('csm-movement-wrap');
  if (!wrap) return;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const movements = [];

  mgrList.filter(m => m.name !== 'Unassigned').forEach(m => {
    m.accs.forEach(c => {
      const hist = (c.history || []).filter(h => h.date).sort((a, b) => new Date(b.date) - new Date(a.date));
      if (hist.length < 2) return;
      const currentScore = c.score;
      const currentStatus = c.status;
      // Find score from ~7 days ago
      const oldEntries = hist.filter(h => new Date(h.date) < weekAgo);
      if (!oldEntries.length) return;
      const oldScore = oldEntries[0].score;
      const oldStatus = getStatus(oldScore);
      if (oldStatus !== currentStatus) {
        const statusOrder = ['critical','risk','watch','healthy','expand'];
        const improved = statusOrder.indexOf(currentStatus) > statusOrder.indexOf(oldStatus);
        movements.push({
          csm: m.name, customer: c.name, from: oldStatus, to: currentStatus,
          improved, scoreDelta: currentScore - oldScore, mrr: c.mrr || 0
        });
      }
    });
  });

  if (!movements.length) {
    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:.82rem"><div style="font-size:1.4rem;margin-bottom:6px;opacity:.3">→</div>No health band changes in the last 7 days.</div>';
    return;
  }

  const statusLabel = s => (STATUS_LABEL[s] || s);
  // Sort: deteriorations first (more urgent), then improvements
  movements.sort((a, b) => a.improved - b.improved || b.mrr - a.mrr);

  wrap.innerHTML = movements.slice(0, 10).map(mv => {
    const arrowCls = mv.improved ? 'up' : 'dn';
    const arrowIcon = mv.improved ? '▲' : '▼';
    return `<div class="csm-movement-item">
      <span class="csm-movement-arrow ${arrowCls}">${arrowIcon}</span>
      <strong>${escHtml(mv.customer)}</strong>
      <span style="color:var(--muted)">moved from</span>
      ${badgeHTML(mv.from)}
      <span style="color:var(--muted)">→</span>
      ${badgeHTML(mv.to)}
      <span style="color:var(--muted);font-size:.72rem;margin-left:auto">${escHtml(mv.csm)} · $${fmtNum(mv.mrr)} MRR</span>
    </div>`;
  }).join('') + (movements.length > 10 ? `<div style="padding:8px 16px;font-size:.72rem;color:var(--subtle);text-align:center">+ ${movements.length - 10} more changes</div>` : '');
}

/* ─── CSM ACTIVITY FEED ────────────────────────────────────────── */
function renderCSMActivity(mgrList) {
  const wrap = el('csm-activity-wrap');
  if (!wrap) return;

  // Group recent audit logs by manager
  const csmNames = new Set(mgrList.filter(m => m.name !== 'Unassigned').map(m => m.name));
  const customerToCSM = {};
  customers.forEach(c => { if (c.manager) customerToCSM[c.name] = c.manager.trim(); });

  // Get recent audit entries and tag them with CSM
  const recent = (auditLogs || []).slice(0, 80).map(entry => {
    const csm = entry.customer_name ? (customerToCSM[entry.customer_name] || null) : null;
    return { ...entry, csm };
  }).filter(e => e.csm && csmNames.has(e.csm));

  if (!recent.length) {
    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:.82rem"><div style="font-size:1.4rem;margin-bottom:6px;opacity:.3">📋</div>No recent CSM activity found.</div>';
    return;
  }

  // Group by CSM, show most recent per CSM
  const byCsm = {};
  recent.forEach(e => {
    if (!byCsm[e.csm]) byCsm[e.csm] = [];
    if (byCsm[e.csm].length < 3) byCsm[e.csm].push(e);
  });

  const label = a => AUDIT_ACTION_LABELS[a] || a;
  const color = a => AUDIT_ACTION_COLORS[a] || 'var(--muted)';
  const relTime = d => {
    const diff = (Date.now() - new Date(d).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  };

  let html = '';
  Object.entries(byCsm).forEach(([csm, entries]) => {
    html += `<div style="padding:8px 16px 4px;font-size:.7rem;font-weight:700;color:var(--subtle);text-transform:uppercase;letter-spacing:.05em;background:var(--bg)">${escHtml(csm)}</div>`;
    entries.forEach(e => {
      let detail = '';
      try {
        const d = typeof e.details === 'string' ? JSON.parse(e.details) : (e.details || {});
        detail = d.summary ? escHtml(d.summary).substring(0, 80) : '';
      } catch {}
      html += `<div class="csm-activity-item">
        <div class="csm-activity-time">${relTime(e.created_at)}</div>
        <div class="csm-activity-body">
          <span style="display:inline-block;padding:1px 7px;border-radius:4px;font-size:.66rem;font-weight:700;color:${color(e.action)};background:color-mix(in srgb, ${color(e.action)} 12%, transparent)">${label(e.action)}</span>
          ${e.customer_name ? ` <strong>${escHtml(e.customer_name)}</strong>` : ''}
          ${detail ? `<p style="font-size:.72rem;color:var(--muted);margin-top:2px">${detail}</p>` : ''}
        </div>
      </div>`;
    });
  });

  wrap.innerHTML = html;
}

// Drill into a specific CSM's accounts — inline expand/collapse
function drillCSM(mgrName) {
  const tbody = el('csm-perf-tbody');
  if (!tbody) return;
  const colCount = window._csmColCount || 12;

  // Find the parent row for this CSM
  const parentRow = tbody.querySelector(`tr.csm-row[data-csm="${CSS.escape(mgrName)}"]`);
  if (!parentRow) return;

  // Check if already expanded — toggle off
  const existingExpand = parentRow.nextElementSibling;
  if (existingExpand && existingExpand.classList.contains('csm-expand-row')) {
    existingExpand.remove();
    parentRow.classList.remove('csm-expanded');
    // Reset button
    const btn = parentRow.querySelector('.csm-expand-btn');
    if (btn) btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Expand`;
    return;
  }

  // Collapse any other open expand row first
  const prevExpanded = tbody.querySelector('tr.csm-expand-row');
  if (prevExpanded) {
    const prevParent = prevExpanded.previousElementSibling;
    if (prevParent) {
      prevParent.classList.remove('csm-expanded');
      const prevBtn = prevParent.querySelector('.csm-expand-btn');
      if (prevBtn) prevBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Expand`;
    }
    prevExpanded.remove();
  }

  // Get accounts for this CSM
  const accs = customers.filter(c => {
    if (mgrName === 'Unassigned') return !c.manager || !c.manager.trim();
    return (c.manager || '').trim() === mgrName;
  }).filter(c => c.lifecycle !== 'churned');

  if (!accs.length) return;

  // Mark parent as expanded
  parentRow.classList.add('csm-expanded');
  const btn = parentRow.querySelector('.csm-expand-btn');
  if (btn) btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg> Collapse`;

  // --- CSM Summary Header ---
  const mgrData = (window._csmPerfData || []).find(m => m.name === mgrName);
  const avgScore   = mgrData ? mgrData.avgScore : Math.round(accs.reduce((s,c) => s+c.score, 0) / accs.length);
  const totalMRR   = accs.reduce((s,c) => s+(c.mrr||0), 0);
  const atRiskCt   = accs.filter(c => c.status === 'critical' || c.status === 'risk').length;
  const healthyCt  = accs.filter(c => c.status === 'healthy' || c.status === 'expand').length;
  const overdueCt  = accs.filter(c => c.days != null && c.days >= 14).length;
  const avgDelta   = mgrData ? mgrData.avgDelta : Math.round(accs.reduce((s,c) => s+getDelta7d(c), 0) / accs.length * 10) / 10;
  const renewals90 = accs.filter(c => c.renewal != null && c.renewal > 0 && c.renewal <= 3).length;

  const hmColor = v => v >= 65 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)';
  const dColor  = avgDelta > 0 ? 'var(--green)' : avgDelta < 0 ? 'var(--red)' : 'var(--muted)';
  const dIcon   = avgDelta > 0 ? '▲' : avgDelta < 0 ? '▼' : '—';

  let summaryHTML = `<div class="csm-drill-stats">
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${hmColor(avgScore)}">${avgScore}</div>
      <div class="csm-drill-stat__label">Avg Score</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${dColor}">${dIcon} ${Math.abs(avgDelta)}</div>
      <div class="csm-drill-stat__label">7d Trend</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">${accs.length}</div>
      <div class="csm-drill-stat__label">Accounts</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">$${fmtNum(totalMRR)}</div>
      <div class="csm-drill-stat__label">MRR Managed</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:var(--green)">${healthyCt}</div>
      <div class="csm-drill-stat__label">Healthy</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${atRiskCt?'var(--red)':'var(--muted)'}">${atRiskCt}</div>
      <div class="csm-drill-stat__label">At Risk</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${overdueCt?'var(--red)':'var(--muted)'}">${overdueCt}</div>
      <div class="csm-drill-stat__label">Overdue</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">${renewals90}</div>
      <div class="csm-drill-stat__label">Renewals ≤90d</div>
    </div>
  </div>`;

  // --- Sort by urgency: worst health + soonest renewal + highest MRR ---
  const urgency = c => {
    const statusW = c.status === 'critical' ? 5 : c.status === 'risk' ? 4 : c.status === 'watch' ? 3 : c.status === 'healthy' ? 2 : 1;
    const renewalW = c.renewal != null && c.renewal > 0 ? Math.max(0, 13 - c.renewal) : 0;
    const mrrW = (c.mrr || 0) / 10000;
    const contactW = (c.days != null && c.days >= 14) ? 2 : 0;
    return (statusW * 10) + renewalW + mrrW + contactW;
  };
  const sorted = [...accs].sort((a, b) => urgency(b) - urgency(a));

  // --- Accounts table with overdue flags ---
  const OVERDUE_DAYS = 14;
  const tableHTML = `<table class="ct" style="min-width:auto;margin:0">
    <thead><tr>
      <th>Customer</th>
      <th>Score</th>
      <th>Trend</th>
      <th>Status</th>
      <th>MRR</th>
      <th>Last Contact</th>
      <th>Renewal</th>
      <th>Lifecycle</th>
    </tr></thead>
    <tbody>${sorted.map(c => {
      const renewStr = c.renewal_date
        ? new Date(c.renewal_date).toLocaleDateString()
        : (c.renewal ? c.renewal + 'mo' : '—');
      const isOverdue = c.days != null && c.days >= OVERDUE_DAYS;
      const delta = getDelta7d(c);
      const trendHTML = delta > 0 ? `<span class="csm-trend up" style="font-size:.68rem;padding:1px 6px">▲ +${delta}</span>`
        : delta < 0 ? `<span class="csm-trend dn" style="font-size:.68rem;padding:1px 6px">▼ ${delta}</span>`
        : `<span class="csm-trend flat" style="font-size:.68rem;padding:1px 6px">— 0</span>`;
      const contactCell = isOverdue
        ? `<span style="font-weight:700;color:var(--red)">${c.days}d ago</span> <span class="csm-overdue">OVERDUE</span>`
        : (c.days != null ? c.days + 'd ago' : '—');
      return `<tr style="cursor:pointer" onclick="openDetail('${c.id}')">
        <td><strong>${escHtml(c.name)}</strong></td>
        <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.78rem;font-weight:700;color:${c.score>=65?'var(--green)':c.score>=50?'var(--amber)':'var(--red)'};background:${c.score>=65?'var(--green-l)':c.score>=50?'var(--amber-l)':'var(--red-l)'}">${c.score}</span></td>
        <td>${trendHTML}</td>
        <td>${badgeHTML(c.status)}</td>
        <td>$${fmtNum(c.mrr||0)}</td>
        <td>${contactCell}</td>
        <td>${renewStr}</td>
        <td style="font-size:.78rem;color:var(--muted)">${c.lifecycle || '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;

  // Insert expand row right after the parent
  const expandRow = document.createElement('tr');
  expandRow.className = 'csm-expand-row';
  expandRow.innerHTML = `<td colspan="${colCount}" class="csm-expand-cell">${summaryHTML}${tableHTML}</td>`;
  parentRow.after(expandRow);
}

// ─── AUDIT LOG ───────────────────────────────────────────────

const AUDIT_ACTION_LABELS = {
  customer_created:      'Customer Created',
  customer_scored:       'Customer Scored',
  customer_updated:      'Customer Updated',
  customer_deleted:      'Moved to Trash',
  customer_restored:     'Restored from Trash',
  customer_hard_deleted: 'Permanently Deleted',
  csv_import:            'CSV Import',
  settings_changed:      'Settings Changed',
  weights_updated:       'Weights Updated',
  weights_reset:         'Weights Reset',
  thresholds_updated:    'Thresholds Updated',
  thresholds_reset:      'Thresholds Reset',
  profile_created:       'Profile Created',
  profile_updated:       'Profile Updated',
  profile_loaded:        'Profile Loaded',
  profile_deleted:       'Profile Deleted',
  note_added:            'Note Added',
  sentiment_logged:      'Sentiment Logged',
  alert_snoozed:         'Alert Snoozed',
  alert_dismissed:       'Alert Dismissed',
  alert_unsnoozed:       'Alert Unsnoozed',
  alerts_cleared:        'Snoozed Alerts Cleared',
  bulk_snooze:           'Bulk Alert Snooze',
  bulk_dismiss:          'Bulk Alert Dismiss',
  bulk_tag:              'Bulk Tag Applied',
  bulk_lifecycle:        'Bulk Lifecycle Update',
  bulk_delete:           'Bulk Delete',
  backup_exported:       'Backup Exported',
  backup_restored:       'Backup Restored',
  password_changed:      'Password Changed',
  report_printed:        'Report Printed',
  qbr_opened:            'QBR Prep Opened',
};

const AUDIT_ACTION_COLORS = {
  customer_created:      'var(--green)',
  customer_scored:       'var(--blue)',
  customer_updated:      'var(--blue)',
  customer_deleted:      'var(--amber)',
  customer_restored:     'var(--green)',
  customer_hard_deleted: 'var(--red)',
  csv_import:            'var(--purple)',
  settings_changed:      'var(--teal)',
  weights_updated:       'var(--teal)',
  weights_reset:         'var(--amber)',
  thresholds_updated:    'var(--teal)',
  thresholds_reset:      'var(--amber)',
  profile_created:       'var(--green)',
  profile_updated:       'var(--teal)',
  profile_loaded:        'var(--blue)',
  profile_deleted:       'var(--red)',
  note_added:            'var(--muted)',
  sentiment_logged:      'var(--amber)',
  alert_snoozed:         'var(--amber)',
  alert_dismissed:       'var(--muted)',
  alert_unsnoozed:       'var(--blue)',
  alerts_cleared:        'var(--amber)',
  bulk_snooze:           'var(--amber)',
  bulk_dismiss:          'var(--muted)',
  bulk_tag:              'var(--purple)',
  bulk_lifecycle:        'var(--teal)',
  bulk_delete:           'var(--red)',
  backup_exported:       'var(--blue)',
  backup_restored:       'var(--amber)',
  password_changed:      'var(--teal)',
  report_printed:        'var(--muted)',
  qbr_opened:            'var(--blue)',
};

let auditLogs   = [];
let auditOffset = 0;
const AUDIT_PAGE_SIZE = 50;

// logAudit — fire-and-forget insert to Supabase
function logAudit(action, customerId, customerName, details) {
  if (!currentUser) return;
  const d = { ...(details || {}), user_email: currentUser.email || '' };
  const entry = {
    user_id:       currentUser.id,
    action:        action,
    customer_id:   customerId || null,
    customer_name: customerName || '',
    details:       JSON.stringify(d),
    created_at:    new Date().toISOString()
  };
  sb.from('audit_logs').insert(entry).then(({ error }) => {
    if (error) console.warn('Audit log write failed:', error.message);
  });
}

// loadAuditLog — fetch from Supabase with pagination + filter
async function loadAuditLog(forceRefresh) {
  if (forceRefresh) { auditLogs = []; auditOffset = 0; }

  const loading = document.getElementById('audit-loading');
  const table   = document.getElementById('audit-table');
  const empty   = document.getElementById('audit-empty');
  const pag     = document.getElementById('audit-pagination');
  if (!loading || !table) return;

  if (auditLogs.length === 0) {
    loading.style.display = 'block';
    table.style.display   = 'none';
    empty.style.display   = 'none';
    pag.style.display     = 'none';
  }

  try {
    let query = sb.from('audit_logs')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .range(auditOffset, auditOffset + AUDIT_PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) throw error;

    if (auditOffset === 0) {
      auditLogs = data || [];
    } else {
      auditLogs = auditLogs.concat(data || []);
    }

    loading.style.display = 'none';
    renderAuditLog();

    // Show "load more" if we got a full page
    if (data && data.length >= AUDIT_PAGE_SIZE) {
      pag.style.display = 'block';
    } else {
      pag.style.display = 'none';
    }

  } catch (err) {
    loading.style.display = 'none';
    empty.style.display   = 'block';
    console.error('Audit log load failed:', err);
  }
}

function loadMoreAudit() {
  auditOffset += AUDIT_PAGE_SIZE;
  loadAuditLog(false);
}

function renderAuditLog() {
  const table = document.getElementById('audit-table');
  const tbody = document.getElementById('audit-tbody');
  const empty = document.getElementById('audit-empty');
  if (!tbody) return;

  // Apply filter
  const filterVal = (document.getElementById('audit-filter-action') || {}).value || 'all';
  const filtered  = filterVal === 'all'
    ? auditLogs
    : auditLogs.filter(e => e.action === filterVal);

  if (filtered.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  table.style.display = '';
  empty.style.display = 'none';

  tbody.innerHTML = filtered.map(e => {
    const dt   = new Date(e.created_at);
    const time = dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const label = AUDIT_ACTION_LABELS[e.action] || e.action;
    const color = AUDIT_ACTION_COLORS[e.action] || 'var(--muted)';

    /* ── Parse details + extract user email ── */
    let parsedDetails = {};
    try { parsedDetails = typeof e.details === 'string' ? JSON.parse(e.details) : (e.details || {}); } catch {}
    const userEmail = parsedDetails.user_email || currentUser?.email || '—';

    /* ── Customer / scope column ── */
    let name;
    if (e.customer_name) {
      name = escHtml(e.customer_name);
    } else {
      const settingsActions = ['weights_updated','weights_reset','thresholds_updated','thresholds_reset','settings_changed','settings_reset'];
      const profileActions  = ['profile_created','profile_updated','profile_loaded','profile_deleted'];
      const importActions   = ['csv_import'];
      const alertActions    = ['alert_snoozed','alert_dismissed','alert_unsnoozed','alerts_cleared','bulk_snooze','bulk_dismiss'];
      const backupActions   = ['backup_exported','backup_restored'];
      const accountActions  = ['password_changed'];
      if (settingsActions.includes(e.action))      name = '<span style="color:var(--muted);font-style:italic">Global Settings</span>';
      else if (profileActions.includes(e.action))   name = '<span style="color:var(--muted);font-style:italic">Scoring Profiles</span>';
      else if (importActions.includes(e.action))    name = '<span style="color:var(--muted);font-style:italic">CSV Import</span>';
      else if (alertActions.includes(e.action))     name = '<span style="color:var(--muted);font-style:italic">Alerts</span>';
      else if (backupActions.includes(e.action))    name = '<span style="color:var(--muted);font-style:italic">Backup</span>';
      else if (accountActions.includes(e.action))   name = '<span style="color:var(--muted);font-style:italic">Account</span>';
      else if (e.action === 'bulk_tag' || e.action === 'bulk_lifecycle' || e.action === 'bulk_delete') name = '<span style="color:var(--muted);font-style:italic">Bulk Action</span>';
      else                                          name = '<span style="color:var(--subtle)">—</span>';
    }

    /* ── Details column (exclude user_email from display) ── */
    let detailStr = '';
    try {
      const d = { ...parsedDetails };
      delete d.user_email;
      const keys = Object.keys(d);
      if (keys.length === 0) {
        detailStr = '<span style="color:var(--subtle)">—</span>';
      } else if (d.summary) {
        detailStr = escHtml(d.summary);
      } else {
        const skip = new Set(['summary']);
        const parts = keys.filter(k => !skip.has(k)).slice(0, 5).map(k => {
          const v = typeof d[k] === 'object' ? JSON.stringify(d[k]) : d[k];
          return `<span style="color:var(--text);font-weight:600">${escHtml(k)}:</span> ${escHtml(String(v))}`;
        });
        if (keys.length > 5) parts.push(`<span style="color:var(--subtle)">+${keys.length - 5} more</span>`);
        detailStr = parts.join(' &nbsp;·&nbsp; ');
      }
    } catch {
      detailStr = '<span style="color:var(--subtle)">—</span>';
    }

    return `<tr>
      <td style="white-space:nowrap;font-size:.78rem;color:var(--muted)">${time}</td>
      <td style="font-size:.78rem;color:var(--text)">${escHtml(userEmail)}</td>
      <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.75rem;font-weight:700;color:${color};background:color-mix(in srgb, ${color} 12%, transparent)">${label}</span></td>
      <td style="font-weight:600;font-size:.85rem">${name}</td>
      <td style="font-size:.8rem;color:var(--muted);max-width:480px;line-height:1.5">${detailStr}</td>
    </tr>`;
  }).join('');
}

function exportAuditLog() {
  if (!auditLogs.length) { toast('No audit entries to export', 'warn'); return; }
  const filterVal = (document.getElementById('audit-filter-action') || {}).value || 'all';
  const filtered  = filterVal === 'all' ? auditLogs : auditLogs.filter(e => e.action === filterVal);
  if (!filtered.length) { toast('No entries match current filter', 'warn'); return; }

  const hdr = 'timestamp,action,customer_name,details';
  const rows = filtered.map(e => {
    const ts    = new Date(e.created_at).toISOString();
    const label = AUDIT_ACTION_LABELS[e.action] || e.action;
    const name  = e.customer_name || '';
    let detail  = '';
    try {
      const d = typeof e.details === 'string' ? JSON.parse(e.details) : (e.details || {});
      detail = d.summary || Object.entries(d).map(([k,v]) => k + ':' + v).join('; ');
    } catch {}
    return [ts, label, name, detail].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
  });
  dlText(hdr + '\n' + rows.join('\n'), 'audit-log-export.csv', 'text/csv');
  toast('Audit log exported', 'success');
}

// ─── BOOT ────────────────────────────────────────────────────
(async function init() {
  // Load settings from localStorage immediately (fast local cache)
  loadSettings();

  // ── Step 1: Check for existing session instantly ──────────
  // getSession() reads from localStorage — no network call needed.
  // This prevents the flicker of showing the auth gate on refresh.
  const { data: { session: existingSession } } = await sb.auth.getSession();

  if (existingSession?.user) {
    // Already logged in — show app immediately
    currentUser = existingSession.user;
    hideAuthGate();
    updateUserUI(currentUser);
    ensureUserProfile(currentUser); // register in user_profiles so admin can see this user

    // Load from cache instantly — no spinner
    let hasCached = false;
    try {
      const cached = localStorage.getItem('iqc_customers_cache');
      if (cached) { customers = JSON.parse(cached); hasCached = true; }
    } catch(e) {}

    refreshLiveScores();
    refreshMgrDropdown();
    renderDashboard();
    renderSettings();
    startPolling();

    // Sync from Supabase — only show spinner if no cache (first ever load)
    if (!hasCached) setLoading(true);
    try {
      await loadSettingsFromSupabase();
      await loadCustomersFromSupabase();
      await resolveClientPlanTier();
    } catch(err) {
      toast('Could not reach Supabase — showing cached data', 'warn');
    } finally {
      setLoading(false);
      refreshLiveScores();
      refreshMgrDropdown();
      renderDashboard();
      renderSettings();
    }

  } else {
    // No session — show auth gate
    showAuthGate();
  }

  // ── Step 2: Listen for future auth changes (sign in / sign out) ──
  sb.auth.onAuthStateChange(async (event, session) => {
    // Ignore INITIAL_SESSION — already handled above via getSession()
    if (event === 'INITIAL_SESSION') return;

    // TOKEN_REFRESHED fires silently when returning to the tab — don't reload
    if (event === 'TOKEN_REFRESHED') {
      currentUser = session?.user || null;
      silentSync(); // background refresh, no spinner
      return;
    }

    currentUser = session?.user || null;

    if (!currentUser) {
      stopPolling();
      customers = [];
      showAuthGate();
      authTab('login');
      return;
    }

    // Fresh sign-in only
    hideAuthGate();
    updateUserUI(currentUser);
    ensureUserProfile(currentUser);
    renderDashboard();
    renderSettings();
    startPolling();

    setLoading(true);
    try {
      await loadSettingsFromSupabase();
      await loadCustomersFromSupabase();
      await resolveClientPlanTier();
    } catch(err) {
      toast('Could not reach Supabase — showing cached data', 'warn');
    } finally {
      setLoading(false);
      refreshMgrDropdown();
      renderDashboard();
      renderSettings();
    }
  });
})();

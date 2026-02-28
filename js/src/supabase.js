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
    if (d) {
      const parsed = JSON.parse(d);
      // Migrate old Set format (array of strings) to Map format (alertId → score)
      if (parsed.length && Array.isArray(parsed[0])) {
        dismissed = new Map(parsed);
      } else {
        dismissed = new Map(parsed.map(id => [id, null]));
      }
    }
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
    // Admin loads rows from ALL admin user IDs so all admins see the same data
    const { data: adminProfiles } = await sb.from('user_profiles')
      .select('user_id, role')
      .eq('role', 'admin');
    const adminIds = (adminProfiles || []).map(p => p.user_id);
    if (!adminIds.includes(currentUser.id)) adminIds.push(currentUser.id);
    query = sb.from('customers')
      .select('*')
      .in('user_id', adminIds)
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
        <button class="btn btn-sm btn-ghost" style="margin-right:4px" onclick="restoreCustomer('${escHtml(c.id)}')">Restore</button>
        <button class="btn btn-sm btn-danger" onclick="hardDeleteCustomer('${escHtml(c.id)}')">Delete Forever</button>
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

// ─── DEMO DATA ───────────────────────────────────────────────

const _DEMO_PREFIXES = [
  'Apex','Atlas','Beacon','Blue','Bolt','Bridge','Bright','Cedar','Cipher','Cirrus',
  'Cobalt','Core','Crest','Crown','Dash','Drift','Edge','Ember','Falcon','Flux',
  'Forge','Frost','Grid','Harbor','Helix','Iron','Jade','Kite','Lumen','Maple',
  'Mesa','Nexus','Noble','Nova','Onyx','Orbit','Pave','Peak','Prism','Pulse',
  'Quartz','Raven','Ridge','Sage','Scale','Signal','Silver','Slate','Spark','Spire',
  'Steel','Stone','Storm','Summit','Swift','Terra','Tide','Timber','Torch','Trace',
  'Vantage','Vault','Vector','Vertex','Vista','Vortex','Wave','Zenith'
];
const _DEMO_SUFFIXES = [
  'AI','Analytics','Cloud','Connect','Data','Digital','Dynamics','Flow','Group','HQ',
  'Hub','Insights','Intelligence','IO','Labs','Logic','Metrics','Networks','Ops',
  'Platform','Point','Pulse','Shift','Soft','Solutions','Stack','Studio','Systems',
  'Tech','Ware','Works'
];
const _DEMO_CSMS = ['Sarah Mitchell','James Chen','Maria Rodriguez','David Kim','Rachel Foster','Anil Patel'];
const _DEMO_NOTES = [
  'QBR went well. Champion is engaged and open to upsell convo.',
  'Escalated to VP of Support — tickets still climbing.',
  'Onboarding kickoff completed. Primary contact trained.',
  'NPS follow-up done. Main concern is reporting gaps.',
  'Renewed early with 10% uplift. Very happy with recent features.',
  'Exec sponsor changed — need to rebuild relationship.',
  'Product usage dropped after key team member left.',
  'Expansion convo scheduled for next week.',
  'Flagged integration issues — eng team is investigating.',
  'Great case-study candidate. Asked about speaking at conference.'
];

// Trajectory definitions: each has base signal ranges + trend function
const _DEMO_TRAJECTORIES = {
  'stable-healthy': {
    logins:[18,30], adoption:[65,95], tickets:[0,2], days:[2,15],
    npsOpts:['promoter','promoter','promoter','passive'],
    growthOpts:['strong','strong','mild'],
    lifecycle:'active', noise:0.08,
    trend: () => 1.0
  },
  'stable-low': {
    logins:[3,10], adoption:[15,40], tickets:[2,5], days:[25,60],
    npsOpts:['detractor','detractor','passive'],
    growthOpts:['none','none','mild'],
    lifecycle:'atrisk', noise:0.10,
    trend: () => 1.0
  },
  'improving': {
    logins:[5,28], adoption:[20,85], tickets:[0,4], days:[5,40],
    npsOpts:['detractor','passive','passive','promoter'],
    growthOpts:['none','mild','strong'],
    lifecycle:'active', noise:0.12,
    trend: (d,t) => 0.3 + 0.7 * (d/t)
  },
  'declining': {
    logins:[5,28], adoption:[20,85], tickets:[0,5], days:[5,50],
    npsOpts:['promoter','passive','passive','detractor'],
    growthOpts:['strong','mild','none'],
    lifecycle:'atrisk', noise:0.10,
    trend: (d,t) => 1.0 - 0.65 * (d/t)
  },
  'volatile': {
    logins:[5,28], adoption:[25,85], tickets:[0,5], days:[5,45],
    npsOpts:['detractor','passive','promoter'],
    growthOpts:['none','mild','strong'],
    lifecycle:'active', noise:0.15,
    trend: (d,t) => 0.5 + 0.35 * Math.sin(d/t * Math.PI * 4)
  },
  'onboarding': {
    logins:[0,22], adoption:[5,65], tickets:[0,3], days:[5,20],
    npsOpts:['unknown','passive','passive','promoter'],
    growthOpts:['none','mild'],
    lifecycle:'onboarding', noise:0.12,
    trend: (d,t) => d < t*0.5 ? (d/(t*0.5)) : 1.0
  },
  'churning': {
    logins:[2,20], adoption:[10,60], tickets:[1,7], days:[10,80],
    npsOpts:['passive','detractor','detractor'],
    growthOpts:['mild','none','none'],
    lifecycle:'atrisk', noise:0.08,
    trend: (d,t) => d < t*0.65 ? (1.0 - 0.25*(d/(t*0.65))) : (0.75 - 0.65*((d-t*0.65)/(t*0.35)))
  }
};

// Trajectory assignment order (sums to ~150)
const _DEMO_TRAJ_DIST = [
  ...Array(38).fill('stable-healthy'),
  ...Array(15).fill('stable-low'),
  ...Array(27).fill('improving'),
  ...Array(27).fill('declining'),
  ...Array(21).fill('volatile'),
  ...Array(12).fill('onboarding'),
  ...Array(10).fill('churning')
];

function _dClamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function _dLerp([lo,hi],t){ return lo+(hi-lo)*_dClamp(t,0,1); }
function _dRand(lo,hi){ return lo+Math.random()*(hi-lo); }
function _dPick(arr,t){
  // Shift selection toward end of array as t increases
  const idx = _dClamp(Math.floor(t * arr.length), 0, arr.length-1);
  // Add some randomness
  const jitter = Math.floor(Math.random() * 2) - 1;
  return arr[_dClamp(idx+jitter, 0, arr.length-1)];
}

function _generateDemoNames(count) {
  const used = new Set();
  const names = [];
  const shuffled = [..._DEMO_PREFIXES].sort(() => Math.random()-0.5);
  for (let i = 0; i < shuffled.length && names.length < count; i++) {
    const suf = _DEMO_SUFFIXES[Math.floor(Math.random()*_DEMO_SUFFIXES.length)];
    const n = shuffled[i] + ' ' + suf;
    if (!used.has(n)) { used.add(n); names.push(n); }
  }
  // If we need more (unlikely), add numbered variants
  let extra = 1;
  while (names.length < count) { names.push('Company ' + (extra++)); }
  return names;
}

function _generateDemoSignals(traj, dayIdx, totalDays) {
  const t = traj.trend(dayIdx, totalDays);
  const n = () => 1 + (Math.random()*2-1) * traj.noise;
  // For positive signals, t scales up; for negative (tickets/days), invert
  const logins   = _dClamp(Math.round(_dLerp(traj.logins, t) * n()), 0, 40);
  const adoption = _dClamp(Math.round(_dLerp(traj.adoption, t) * n()), 0, 100);
  const tickets  = _dClamp(Math.round(_dLerp(traj.tickets, 1-t) * n()), 0, 8);
  const days     = _dClamp(Math.round(_dLerp(traj.days, 1-t) * n()), 0, 120);
  const nps      = _dPick(traj.npsOpts, t);
  const growth   = _dPick(traj.growthOpts, t);
  return { logins, adoption, tickets, nps, days, growth, lifecycle: traj.lifecycle };
}

function _generateDemoHistory(trajKey, now) {
  const traj = _DEMO_TRAJECTORIES[trajKey];
  const totalDays = 90;
  const entries = [];
  for (let d = totalDays; d >= 0; d--) {
    // Skip ~15% of days for realistic gaps (but always keep first and last)
    if (d > 0 && d < totalDays && Math.random() < 0.15) continue;
    const dayIdx = totalDays - d;
    const signals = _generateDemoSignals(traj, dayIdx, totalDays);
    const { score } = calcScore(signals);
    entries.push({
      score,
      date: new Date(now - d * 86400000).toISOString(),
      signals
    });
  }
  return entries;
}

function _generateDemoCustomer(name, index, now) {
  // Trajectory
  const trajKey = _DEMO_TRAJ_DIST[index % _DEMO_TRAJ_DIST.length];
  const traj = _DEMO_TRAJECTORIES[trajKey];

  // Tier & MRR
  const tier = index < 90 ? 'smb' : index < 135 ? 'mid' : 'enterprise';
  const mrr = tier === 'smb' ? Math.round(_dRand(500,3000)/50)*50
            : tier === 'mid' ? Math.round(_dRand(3000,15000)/100)*100
            : Math.round(_dRand(15000,50000)/500)*500;

  // History
  const history = _generateDemoHistory(trajKey, now);
  const last = history[history.length - 1];
  const lastSig = last.signals;

  // Renewal: spread across next 12 months
  const renDate = new Date(now);
  renDate.setMonth(renDate.getMonth() + (index % 12) + 1);
  renDate.setDate(1 + Math.floor(Math.random() * 27));
  const renewal_date = renDate.toISOString().slice(0,10);
  const renewal = Math.max(0, Math.round((renDate - new Date(now)) / (1000*60*60*24*30.44)));

  // Tags (auto-assigned)
  const tags = [];
  if (renewal <= 2) tags.push('renewal-soon');
  if (last.score >= 85 && lastSig.growth === 'strong') tags.push('upsell-candidate');
  if (last.score < 30) tags.push('churn-risk');
  if (lastSig.logins >= 25 && lastSig.adoption >= 80) tags.push('power-user');
  if (traj.lifecycle === 'onboarding') tags.push('onboarding');
  if (last.score >= 90 && lastSig.nps === 'promoter') tags.push('case-study');

  // Notes (~20% of customers)
  const notes = [];
  if (Math.random() < 0.20) {
    const noteDate = new Date(now - Math.floor(Math.random()*14)*86400000).toISOString();
    notes.push({ text: _DEMO_NOTES[index % _DEMO_NOTES.length], date: noteDate });
  }

  // Customer-since date (3-18 months ago)
  const sinceDate = new Date(now);
  sinceDate.setMonth(sinceDate.getMonth() - 3 - (index % 16));
  const since = sinceDate.toISOString().slice(0,10);

  // Created date (staggered)
  const createdDate = new Date(now);
  createdDate.setMonth(createdDate.getMonth() - 3 - Math.floor(Math.random()*9));
  const created = createdDate.toISOString();

  // Lifecycle override: stable-healthy with high score can be 'won'
  let lifecycle = traj.lifecycle;
  if (trajKey === 'stable-healthy' && last.score >= 88 && Math.random() < 0.2) lifecycle = 'won';

  return {
    id:              crypto.randomUUID(),
    name,
    score:           last.score,
    status:          getStatus(last.score),
    mrr,
    arr:             mrr * 12,
    since,
    tier,
    lifecycle,
    logins:          lastSig.logins,
    adoption:        lastSig.adoption,
    tickets:         lastSig.tickets,
    nps:             lastSig.nps,
    days:            lastSig.days,
    _baseDays:       lastSig.days,
    renewal_date,
    renewal,
    growth:          lastSig.growth,
    tags,
    notes,
    history,
    sentiment:       [],
    manager:         _DEMO_CSMS[index % _DEMO_CSMS.length],
    scoring_profile: '',
    deleted_at:      null,
    created,
    next_touch:      '',
    playbook_checks: {}
  };
}

function initDemo() {
  const now = Date.now();
  const names = _generateDemoNames(150);
  // Shuffle trajectory distribution for variety
  _DEMO_TRAJ_DIST.sort(() => Math.random() - 0.5);
  customers = names.map((name, i) => _generateDemoCustomer(name, i, now));
}

// One-time admin function: push demo data to Supabase for demo@iqcadence.com
// Run from browser console while logged in as admin: seedDemoData()
async function seedDemoData() {
  // Seeds 150 demo customers into an EXISTING client.
  // Usage: seedDemoData()           — auto-finds demo@iqcadence.com's client
  //        seedDemoData('some-email@x.com') — uses that user's client instead
  if (!isAdmin()) { console.error('Must be logged in as admin'); return; }

  const targetEmail = arguments[0] || 'demo@iqcadence.com';

  // 1. Find the user's profile and client
  console.log('1/3 — Finding user profile for ' + targetEmail + '…');
  const { data: prof, error: profErr } = await sb.from('user_profiles')
    .select('user_id, client_id, email, business_name')
    .eq('email', targetEmail.toLowerCase())
    .single();

  if (profErr || !prof) {
    console.error('No user_profiles row found for ' + targetEmail);
    console.error('Make sure the user has logged in at least once, or create their profile in User Management.');
    return;
  }
  if (!prof.client_id) {
    console.error('User ' + targetEmail + ' is not assigned to any client.');
    console.error('Go to Settings → User Management → Edit, and assign them to a client first.');
    return;
  }

  console.log('   User ID:', prof.user_id);
  console.log('   Client ID:', prof.client_id);
  console.log('   Business:', prof.business_name || '(none)');

  // 2. Generate 150 demo customers in memory
  console.log('2/3 — Generating 150 demo customers…');
  initDemo(); // populates customers[]

  // 3. Push to Supabase under that user's ID
  console.log('3/3 — Pushing to Supabase (150 rows)…');
  const rows = customers.map(c => {
    const row = toRow(c);
    row.user_id = prof.user_id; // assign to the target user
    return row;
  });

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const chunk = rows.slice(i, i + 25);
    const { error } = await sb.from('customers').upsert(chunk, { onConflict: 'id' });
    if (error) { console.error('Insert error at chunk', i, error.message); return; }
    inserted += chunk.length;
    console.log('   ' + inserted + '/' + rows.length + ' rows…');
  }

  console.log('✓ Done! 150 demo customers seeded under ' + targetEmail + ' (client: ' + prof.client_id + ')');
  console.log('Any user assigned to client ' + prof.client_id + ' will see these profiles.');
  toast('Demo data seeded — 150 customers for ' + targetEmail, 'success');
}

// ─── AUTO-REFRESH ────────────────────────────────────────────
let _pollTimer = null;

// Silent background sync — never shows the loading overlay
async function silentSync() {
  if (!currentUser) return;
  try {
    // Respect the active client context — if admin switched to a specific client,
    // reload that client's data instead of the admin's own
    if (isAdmin() && activeClientId !== '__own__') {
      await loadClientCustomers(activeClientId, true);
    } else {
      await loadCustomersFromSupabase();
    }
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

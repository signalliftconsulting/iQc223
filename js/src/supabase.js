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
  const { data, error } = await sb.from('settings').select('*').eq('user_id', currentUser.id).single();
  if (error || !data) return; // no settings row yet — use defaults
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
// Backfill missing NPS/CSAT in old history signals (pre-v127 data)
function _migrateHistory(history, currNps, currCsat) {
  if (!history || !history.length) return history;
  // Check if migration needed (first non-trivial entry missing nps)
  const sample = history.find(h => h.signals && h.score != null);
  if (!sample || sample.signals.nps !== undefined) return history; // already has nps
  // Approximate NPS/CSAT from health score with slight jitter
  history.forEach(h => {
    if (!h.signals) return;
    if (h.signals.nps === undefined) {
      const s = h.score || 50;
      const jitter = Math.floor(Math.random() * 2); // 0 or 1
      h.signals.nps = s >= 85 ? 9 + jitter : s >= 70 ? 8 - jitter : s >= 55 ? 6 + jitter : s >= 40 ? 5 - jitter : s >= 25 ? 4 - jitter : 3;
      h.signals.nps = Math.max(0, Math.min(10, h.signals.nps));
    }
    if (h.signals.csat === undefined) {
      const s = h.score || 50;
      h.signals.csat = s >= 80 ? 5 : s >= 60 ? 4 : s >= 40 ? 3 : s >= 20 ? 2 : 1;
    }
  });
  return history;
}

function fromRow(row) {
  // Separate columns (v129+) with backward compat for encoded "nps|csat" pair
  let nps = null, csat = null;
  if (row.csat != null) {
    // New schema: separate columns
    nps  = row.nps  != null ? Number(row.nps)  : null;
    csat = Number(row.csat);
  } else if (row.nps != null) {
    // Old schema: encoded pair in nps column
    const fb = decodeFeedbackPair(row.nps);
    nps  = fb.nps;
    csat = fb.csat;
  }
  if (nps != null && isNaN(nps)) nps = null;
  if (csat != null && isNaN(csat)) csat = null;

  const history = tryParse(row.history, []);
  _migrateHistory(history, nps, csat);
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
    logins:    row.logins    != null ? row.logins    : null,
    adoption:  row.adoption  != null ? row.adoption  : null,
    tickets:   row.tickets   != null ? row.tickets   : null,
    nps,
    csat,
    days:         row.days         != null ? row.days : null,
    _baseDays:    row.days         != null ? row.days : null,
    renewal_date: row.renewal_date || '',
    renewal:      row.renewal_date
      ? Math.max(0, Math.round((new Date(row.renewal_date) - new Date()) / (1000 * 60 * 60 * 24 * 30.44)))
      : (row.renewal || 0),
    growth:    row.growth    || 'none',
    tags:      row.tags      ? row.tags.split(',').map(t=>t.trim()).filter(Boolean) : [],
    notes:     tryParse(row.notes,     []),
    history,
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
    logins:    c.logins     != null ? c.logins   : null,
    adoption:  c.adoption   != null ? c.adoption : null,
    tickets:   c.tickets    != null ? c.tickets  : null,
    nps:       c.nps  != null ? c.nps  : null,
    csat:      c.csat != null ? c.csat : null,
    days:         c._baseDays != null ? c._baseDays : (c.days != null ? c.days : null),
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
  'Apex','Aquila','Arc','Atlas','Aura','Beacon','Blue','Bolt','Bridge','Bright',
  'Canyon','Cedar','Cipher','Cirrus','Clarity','Cobalt','Core','Crest','Crown','Cypress',
  'Dash','Delta','Drift','Dune','Echo','Edge','Elm','Ember','Equinox','Evergreen',
  'Falcon','Fern','Flint','Flux','Forge','Frost','Granite','Grid','Grove','Harbor',
  'Haven','Helix','Horizon','Indigo','Iron','Ivory','Jade','Juniper','Keystone','Kite',
  'Lantern','Lark','Lattice','Lumen','Lynx','Maple','Marina','Meridian','Mesa','Mica',
  'Mosaic','Nimbus','Nexus','Noble','North','Nova','Oak','Onyx','Orbit','Osprey',
  'Pave','Peak','Pine','Pinnacle','Prism','Pulse','Quartz','Raven','Redwood','Ridge',
  'Ripple','Sage','Scale','Sequoia','Signal','Silver','Skyline','Slate','Spark','Spire',
  'Steel','Stone','Storm','Strand','Summit','Swift','Tallow','Terra','Tide','Timber',
  'Torch','Trace','Trident','Vantage','Vault','Vector','Vertex','Vine','Vista','Vortex',
  'Walden','Wave','Willow','Zenith'
];
const _DEMO_SUFFIXES = [
  'AI','Analytics','Cloud','Co','Connect','Creative','Data','Digital','Dynamics','Flow',
  'Global','Group','HQ','Hub','Industries','Insights','Intelligence','IO','Labs','Logic',
  'Media','Metrics','Networks','Ops','Partners','Platform','Point','Pulse','Shift','Soft',
  'Solutions','Stack','Studio','Systems','Tech','Ventures','Ware','Works'
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
  'Great case-study candidate. Asked about speaking at conference.',
  'User training session completed — team showing strong adoption.',
  'Billing dispute resolved. Customer satisfied with outcome.',
  'Competitor eval in progress — need to demonstrate value ASAP.',
  'New decision-maker introduced. Scheduling intro call.',
  'Feature request logged for API enhancements — product team reviewing.'
];
const _DEMO_SENTIMENTS = [
  { val:'negative', note:'Customer expressed frustration with onboarding delays.' },
  { val:'negative', note:'Unhappy with recent product changes. Wants old workflow back.' },
  { val:'negative', note:'Support response time too slow — escalated internally.' },
  { val:'positive', note:'Very happy with latest release. Praised the team.' },
  { val:'positive', note:'Referred a colleague. Strong advocate.' },
  { val:'neutral',  note:'Routine check-in. No strong feelings either way.' },
  { val:'negative', note:'Budget concerns raised. May downgrade next renewal.' },
  { val:'positive', note:'Exceeded their KPIs using our platform. Great case study potential.' }
];

// ── Trajectory definitions: each has base signal ranges + trend function ──
// trend(d,t) returns 0–1 where d=dayIndex, t=totalDays. 1=best signals, 0=worst.
const _DEMO_TRAJECTORIES = {
  'stable-healthy': {
    logins:[18,30], adoption:[65,95], tickets:[0,2], days:[2,15],
    npsOpts:[8,9,9,10,10], csatOpts:[4,4,5,5,5],
    growthOpts:['strong','strong','mild'],
    lifecycle:'active', noise:0.08,
    trend: (d,t) => 0.95 + 0.05 * Math.sin(d/t * Math.PI * 6) // slight wobble around 0.95
  },
  'stable-low': {
    logins:[2,8], adoption:[12,35], tickets:[2,6], days:[30,70],
    npsOpts:[3,4,4,5,5], csatOpts:[1,2,2,2,3],
    growthOpts:['none','none','mild'],
    lifecycle:'atrisk', noise:0.10,
    trend: (d,t) => 0.15 + 0.1 * Math.sin(d/t * Math.PI * 3) // wobble around 0.15
  },
  'improving': {
    logins:[4,28], adoption:[15,88], tickets:[0,5], days:[5,45],
    npsOpts:[4,5,6,7,8,9], csatOpts:[2,2,3,3,4,5],
    growthOpts:['none','none','mild','strong'],
    lifecycle:'active', noise:0.10,
    // Slow start, accelerating improvement over 2 years
    trend: (d,t) => { const p = d/t; return 0.15 + 0.80 * (p < 0.3 ? p*0.5/0.3 : 0.5 + 0.5*((p-0.3)/0.7)); }
  },
  'declining': {
    logins:[4,26], adoption:[18,82], tickets:[0,6], days:[5,55],
    npsOpts:[9,8,7,6,5,4], csatOpts:[5,4,4,3,2,2],
    growthOpts:['strong','mild','none','none'],
    lifecycle:'atrisk', noise:0.09,
    // Gradual decline with a brief plateau in the middle
    trend: (d,t) => { const p = d/t; return p < 0.4 ? 1.0 - 0.3*p/0.4 : p < 0.55 ? 0.7 : 0.7 - 0.55*(p-0.55)/0.45; }
  },
  'slow-decline': {
    logins:[3,22], adoption:[10,55], tickets:[1,7], days:[10,80],
    npsOpts:[7,6,5,4,4,3], csatOpts:[3,3,2,2,1,1],
    growthOpts:['mild','none','none'],
    lifecycle:'atrisk', noise:0.07,
    // Very gradual, almost linear decline
    trend: (d,t) => 1.0 - 0.75 * (d/t)
  },
  'volatile': {
    logins:[4,28], adoption:[20,85], tickets:[0,6], days:[5,50],
    npsOpts:[3,5,7,9,10,6,4], csatOpts:[1,2,4,5,3,2,4],
    growthOpts:['none','mild','strong','none','mild'],
    lifecycle:'active', noise:0.12,
    // Multiple oscillations over 2 years
    trend: (d,t) => 0.5 + 0.4 * Math.sin(d/t * Math.PI * 7) * Math.cos(d/t * Math.PI * 2.3)
  },
  'onboarding': {
    logins:[0,20], adoption:[2,55], tickets:[0,3], days:[3,18],
    npsOpts:[null,null,7,7,8], csatOpts:[null,null,3,4,4],
    growthOpts:['none','mild'],
    lifecycle:'onboarding', noise:0.12,
    // Ramp up in first half, plateau
    trend: (d,t) => d < t*0.6 ? (d/(t*0.6)) * 0.85 : 0.85 + 0.15*(d-t*0.6)/(t*0.4),
    historyDays: 90 // only 3 months of history
  },
  'churned': {
    logins:[0,25], adoption:[5,80], tickets:[0,8], days:[3,120],
    npsOpts:[9,8,7,5,4,3,3], csatOpts:[5,4,3,2,2,1,1],
    growthOpts:['mild','none','none','none'],
    lifecycle:'churned', noise:0.06,
    // Healthy first 40%, slow decline 40-70%, collapse 70-100%
    trend: (d,t) => {
      const p = d/t;
      if (p < 0.4) return 0.9 - 0.15 * p / 0.4;
      if (p < 0.7) return 0.75 - 0.40 * (p-0.4)/0.3;
      return 0.35 - 0.30 * (p-0.7)/0.3;
    }
  },
  'recovered': {
    logins:[5,28], adoption:[15,85], tickets:[0,6], days:[5,50],
    npsOpts:[8,6,5,4,5,7,8,9], csatOpts:[4,3,2,2,3,3,4,5],
    growthOpts:['mild','none','none','mild','strong'],
    lifecycle:'active', noise:0.10,
    // V-shape: decline for 45%, bottom at 45-55%, recovery 55-100%
    trend: (d,t) => {
      const p = d/t;
      if (p < 0.45) return 0.85 - 0.60 * p / 0.45;
      if (p < 0.55) return 0.25 + 0.05 * Math.sin((p-0.45)/0.1 * Math.PI);
      return 0.25 + 0.65 * (p-0.55)/0.45;
    }
  },
  'seasonal': {
    logins:[12,30], adoption:[50,92], tickets:[0,4], days:[3,25],
    npsOpts:[7,8,8,9,9,10], csatOpts:[3,4,4,5,5],
    growthOpts:['mild','strong','mild'],
    lifecycle:'active', noise:0.08,
    // Healthy baseline with 3 seasonal dips over 2 years
    trend: (d,t) => {
      const base = 0.82;
      const dip = 0.25 * Math.max(0, Math.sin(d/t * Math.PI * 3) - 0.4) / 0.6;
      return base - dip + 0.08 * Math.sin(d/t * Math.PI * 11); // micro-wobble
    }
  }
};

// Trajectory assignment order (sums to 150)
const _DEMO_TRAJ_DIST = [
  ...Array(35).fill('stable-healthy'),
  ...Array(12).fill('stable-low'),
  ...Array(22).fill('improving'),
  ...Array(18).fill('declining'),
  ...Array(10).fill('slow-decline'),
  ...Array(15).fill('volatile'),
  ...Array(8).fill('onboarding'),
  ...Array(12).fill('churned'),
  ...Array(10).fill('recovered'),
  ...Array(8).fill('seasonal')
];

function _dClamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function _dLerp([lo,hi],t){ return lo+(hi-lo)*_dClamp(t,0,1); }
function _dRand(lo,hi){ return lo+Math.random()*(hi-lo); }
function _dPick(arr,t){
  const idx = _dClamp(Math.floor(t * arr.length), 0, arr.length-1);
  const jitter = Math.floor(Math.random() * 2) - 1;
  return arr[_dClamp(idx+jitter, 0, arr.length-1)];
}

function _generateDemoNames(count) {
  // Build all possible combinations, shuffle, and pick the first `count`
  const combos = [];
  for (const p of _DEMO_PREFIXES) for (const s of _DEMO_SUFFIXES) combos.push(p + ' ' + s);
  // Fisher-Yates shuffle
  for (let i = combos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combos[i], combos[j]] = [combos[j], combos[i]];
  }
  return combos.slice(0, count);
}

function _generateDemoSignals(traj, dayIdx, totalDays) {
  const t = traj.trend(dayIdx, totalDays);
  const n = () => 1 + (Math.random()*2-1) * traj.noise;
  const logins   = _dClamp(Math.round(_dLerp(traj.logins, t) * n()), 0, 40);
  const adoption = _dClamp(Math.round(_dLerp(traj.adoption, t) * n()), 0, 100);
  const tickets  = _dClamp(Math.round(_dLerp(traj.tickets, 1-t) * n()), 0, 10);
  const days     = _dClamp(Math.round(_dLerp(traj.days, 1-t) * n()), 0, 150);
  const nps      = _dPick(traj.npsOpts, t);
  const csat     = _dPick(traj.csatOpts, t);
  const growth   = _dPick(traj.growthOpts, t);
  return { logins, adoption, tickets, nps, csat, days, growth, lifecycle: traj.lifecycle };
}

function _generateDemoHistory(trajKey, now) {
  const traj = _DEMO_TRAJECTORIES[trajKey];
  const totalDays = traj.historyDays || 730; // 2 years default, shorter for onboarding
  const entries = [];
  for (let d = totalDays; d >= 0; d--) {
    // Variable frequency: weekly for old data, denser for recent
    if (d > 0 && d < totalDays) {
      if (d > 180) { if (d % 7 !== 0 || Math.random() < 0.10) continue; }       // >6mo: ~weekly
      else if (d > 30) { if (d % 3 !== 0 || Math.random() < 0.12) continue; }    // 1-6mo: every ~3d
      else { if (Math.random() < 0.20) continue; }                                // <1mo: most days
    }
    const dayIdx = totalDays - d;
    const signals = _generateDemoSignals(traj, dayIdx, totalDays);
    const { score } = calcScore(signals);
    entries.push({ score, date: new Date(now - d * 86400000).toISOString(), signals });
  }
  return entries;
}

function _generateDemoCustomer(name, index, now) {
  const trajKey = _DEMO_TRAJ_DIST[index % _DEMO_TRAJ_DIST.length];
  const traj = _DEMO_TRAJECTORIES[trajKey];

  // Tier & MRR — decouple from trajectory so high-value accounts appear in any bucket
  const tierRoll = Math.random();
  const tier = tierRoll < 0.55 ? 'smb' : tierRoll < 0.85 ? 'mid' : 'enterprise';
  const mrr = tier === 'smb' ? Math.round(_dRand(500,3500)/50)*50
            : tier === 'mid' ? Math.round(_dRand(3000,18000)/100)*100
            : Math.round(_dRand(15000,55000)/500)*500;

  // History
  const history = _generateDemoHistory(trajKey, now);
  const last = history[history.length - 1];
  const lastSig = last.signals;

  // Lifecycle
  let lifecycle = traj.lifecycle;
  if (trajKey === 'stable-healthy' && last.score >= 88 && Math.random() < 0.2) lifecycle = 'won';

  // Renewal date
  const renDate = new Date(now);
  if (lifecycle === 'churned') {
    // Churned: renewal is in the past (1-6 months ago)
    renDate.setMonth(renDate.getMonth() - 1 - Math.floor(Math.random() * 5));
  } else {
    renDate.setMonth(renDate.getMonth() + (index % 12) + 1);
  }
  renDate.setDate(1 + Math.floor(Math.random() * 27));
  const renewal_date = renDate.toISOString().slice(0,10);
  const renewal = Math.max(0, Math.round((renDate - new Date(now)) / (1000*60*60*24*30.44)));

  // Customer-since date
  const sinceDate = new Date(now);
  if (lifecycle === 'churned') sinceDate.setMonth(sinceDate.getMonth() - 18 - Math.floor(Math.random()*12));
  else if (trajKey === 'onboarding') sinceDate.setMonth(sinceDate.getMonth() - 1 - Math.floor(Math.random()*2));
  else sinceDate.setMonth(sinceDate.getMonth() - 6 - Math.floor(Math.random()*22));
  const since = sinceDate.toISOString().slice(0,10);

  // Created date
  const createdDate = new Date(sinceDate);
  createdDate.setDate(createdDate.getDate() - Math.floor(Math.random()*14));
  const created = createdDate.toISOString();

  // Tags
  const tags = [];
  if (lifecycle !== 'churned' && renewal <= 2) tags.push('renewal-soon');
  if (last.score >= 85 && lastSig.growth === 'strong') tags.push('upsell-candidate');
  if (last.score < 30) tags.push('churn-risk');
  if (lastSig.logins != null && lastSig.logins >= 25 && lastSig.adoption != null && lastSig.adoption >= 80) tags.push('power-user');
  if (trajKey === 'onboarding') tags.push('onboarding');
  if (last.score >= 90 && npsIsPromoter(lastSig.nps)) tags.push('case-study');
  if (trajKey === 'recovered') tags.push('save-success');
  if (lifecycle === 'churned') tags.push('churned');

  // Notes (~30% of customers, up to 2 notes each)
  const notes = [];
  if (Math.random() < 0.30) {
    const noteDate = new Date(now - Math.floor(Math.random()*30)*86400000).toISOString();
    notes.push({ text: _DEMO_NOTES[index % _DEMO_NOTES.length], date: noteDate });
    if (Math.random() < 0.35) {
      const noteDate2 = new Date(now - Math.floor(30 + Math.random()*60)*86400000).toISOString();
      notes.push({ text: _DEMO_NOTES[(index + 7) % _DEMO_NOTES.length], date: noteDate2 });
    }
  }

  // Sentiment (~35% of customers, 1-3 entries)
  const sentiment = [];
  if (Math.random() < 0.35) {
    const sCount = 1 + Math.floor(Math.random() * 2);
    for (let s = 0; s < sCount; s++) {
      const si = (index + s * 3) % _DEMO_SENTIMENTS.length;
      // Bias sentiment toward trajectory: declining/churned/slow-decline → more negative
      let pick = _DEMO_SENTIMENTS[si];
      if (['declining','churned','slow-decline','stable-low'].includes(trajKey) && pick.val === 'positive' && Math.random() < 0.7) {
        pick = _DEMO_SENTIMENTS[si % 3]; // first 3 are negative
      }
      if (['stable-healthy','improving','recovered'].includes(trajKey) && pick.val === 'negative' && Math.random() < 0.6) {
        pick = _DEMO_SENTIMENTS[3 + (si % 2)]; // indices 3-4 are positive
      }
      const sentDate = new Date(now - Math.floor((s * 30 + Math.random()*25)*86400000)).toISOString();
      sentiment.push({ val: pick.val, note: pick.note, date: sentDate });
    }
  }

  // Next scheduled touch (~40% of active customers)
  let next_touch = '';
  if (lifecycle !== 'churned' && Math.random() < 0.40) {
    const ntDate = new Date(now);
    ntDate.setDate(ntDate.getDate() + 1 + Math.floor(Math.random() * 21));
    next_touch = ntDate.toISOString().slice(0,10);
  }

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
    csat:            lastSig.csat,
    days:            lastSig.days,
    _baseDays:       lastSig.days,
    renewal_date,
    renewal,
    growth:          lastSig.growth,
    tags,
    notes,
    history,
    sentiment,
    manager:         _DEMO_CSMS[index % _DEMO_CSMS.length],
    scoring_profile: '',
    deleted_at:      null,
    created,
    next_touch,
    playbook_checks: {}
  };
}

function initDemo() {
  const now = Date.now();
  const names = _generateDemoNames(150);
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

  // 2. Delete existing customers for this user
  console.log('2/4 — Deleting existing customers for ' + targetEmail + '…');
  const { error: delErr } = await sb.from('customers').delete().eq('user_id', prof.user_id);
  if (delErr) { console.error('Delete error:', delErr.message); return; }
  console.log('   Old data cleared.');

  // 3. Generate 150 demo customers in memory
  console.log('3/4 — Generating 150 demo customers…');
  initDemo(); // populates customers[]

  // 4. Push to Supabase under that user's ID
  console.log('4/4 — Pushing to Supabase (150 rows)…');
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

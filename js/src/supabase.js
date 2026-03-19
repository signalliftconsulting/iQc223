// ─── PERSIST ────────────────────────────────────────────────
// Settings (weights, thresholds, profiles, snoozed) stored in Supabase settings table.
// Customers stored in Supabase customers table with RLS (each client's users see their client's customers).

// Resolve the effective client_id for settings/audit operations.
// Admin viewing a client → that client's ID; otherwise → user's own client.
function getEffectiveClientId() {
  if (typeof isAdmin === 'function' && isAdmin()
      && typeof activeClientId !== 'undefined'
      && activeClientId && activeClientId !== '__own__') {
    return activeClientId;
  }
  return _userClientId || null;
}

function saveSettings() {
  // Also keep in localStorage as fast local cache
  localStorage.setItem('iqc_weights',    JSON.stringify(weights));
  localStorage.setItem('iqc_thresholds', JSON.stringify(thresholds));
  localStorage.setItem('iqc_profiles',   JSON.stringify(profiles));
  localStorage.setItem('iqc_snoozed',    JSON.stringify([...snoozed]));
  localStorage.setItem('iqc_dismissed',  JSON.stringify([...dismissed]));
  localStorage.setItem('iqc_expansion',  JSON.stringify(expansionConfig));
  localStorage.setItem('iqc_cadence',    JSON.stringify(cadenceConfig));
  localStorage.setItem('iqc_renewal_windows', JSON.stringify(renewalWindows));
  localStorage.setItem('iqc_quiet_days', String(quietDays));
  localStorage.setItem('iqc_momentum_pts', String(momentumPts));
  localStorage.setItem('iqc_signal_model', JSON.stringify(signalModelCfg));
  // Sync to Supabase (fire and forget) - keyed by client_id
  const cid = getEffectiveClientId();
  if (currentUser && cid) {
    sb.from('settings').upsert({
      client_id:  cid,
      user_id:    currentUser.id,
      weights:    JSON.stringify(weights),
      thresholds: JSON.stringify(thresholds),
      profiles:     JSON.stringify(profiles),
      signal_model: JSON.stringify(signalModelCfg),
      updated_at:   new Date().toISOString()
    }, { onConflict: 'client_id' }).then(({error}) => {
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
        // Old format had { risk, expand } - discard and use new defaults
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
    if (fp) {
      filterPresets = JSON.parse(fp);
      // Restore Sets in enum filters that were serialized as arrays
      filterPresets.forEach(p => {
        if (p.columnFilters) p.columnFilters = deserializeColumnFilters(p.columnFilters);
      });
    }
  } catch(e) {}
  try {
    const ex = localStorage.getItem('iqc_expansion');
    if (ex) expansionConfig = { ...DEFAULT_EXPANSION, ...JSON.parse(ex) };
  } catch(e) {}
  try {
    const cc = localStorage.getItem('iqc_cadence');
    if (cc) {
      const parsed = JSON.parse(cc);
      ['enterprise','mid','smb'].forEach(t => {
        if (parsed[t]) cadenceConfig[t] = { ...DEFAULT_CADENCE[t], ...parsed[t] };
      });
    }
  } catch(e) {}
  try {
    const rw = localStorage.getItem('iqc_renewal_windows');
    if (rw) renewalWindows = { ...DEFAULT_RENEWAL_WINDOWS, ...JSON.parse(rw) };
  } catch(e) {}
  try {
    const qd = localStorage.getItem('iqc_quiet_days');
    if (qd) quietDays = parseInt(qd) || DEFAULT_QUIET_DAYS;
  } catch(e) {}
  try {
    const mp = localStorage.getItem('iqc_momentum_pts');
    if (mp) momentumPts = parseInt(mp) || DEFAULT_MOMENTUM_PTS;
  } catch(e) {}
  try {
    const sm = localStorage.getItem('iqc_signal_model');
    if (sm) signalModelCfg = { ...DEFAULT_SIGNAL_MODEL, ...JSON.parse(sm) };
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
  const cid = getEffectiveClientId();
  if (!cid) return; // no client assigned yet - use defaults
  const { data: settingsRows, error } = await sb.from('settings').select('*').eq('client_id', cid).limit(1);
  const data = settingsRows && settingsRows.length ? settingsRows[0] : null;
  if (error || !data) return; // no settings row yet - use defaults
  try { if (data.weights)    weights    = { ...DEFAULT_WEIGHTS,    ...JSON.parse(data.weights) }; }    catch(e){}
  try { if (data.thresholds) thresholds = { ...DEFAULT_THRESHOLDS, ...JSON.parse(data.thresholds) }; } catch(e){}
  try { if (data.profiles)   profiles   = JSON.parse(data.profiles); }  catch(e){}
  try { if (data.automations) { automationsCfg = JSON.parse(data.automations); migrateAutomationsCfg(); } } catch(e){}
  try { if (data.signal_model) signalModelCfg = { ...DEFAULT_SIGNAL_MODEL, ...JSON.parse(data.signal_model) }; } catch(e){}
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
    mrr:       row.mrr || (row.arr ? Math.round(row.arr / 12) : 0),
    arr:       row.arr || (row.mrr ? row.mrr * 12 : 0),
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
    next_touch:        row.next_touch        || '',
    next_touch_time:   row.next_touch_time   || '',
    playbook_checks:   tryParse(row.playbook_checks, {}),
    last_contact_date:  row.last_contact_date  || '',
    touch_history:      tryParse(row.touch_history, []),
    external_id:        row.external_id        || '',
    stripe_customer_id:  row.stripe_customer_id  || '',
    hubspot_company_id:  row.hubspot_company_id  || '',
    salesforce_account_id: row.salesforce_account_id || '',
    billing_interval:    row.billing_interval    || '',
    renewal_date:        row.renewal_date        || '',
    contact_name:        row.contact_name        || '',
    contact_email:       row.contact_email       || '',
    _client_id:          row.client_id           || null
  };
}

// Flag: set true once we confirm the customers table has a client_id column
let _dbHasClientId = false;
let _dbColumns = null; // Set of valid column names, detected on first load

// Convert internal customer → Supabase row fields
function toRow(c) {
  const row = {
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
    next_touch:        c.next_touch        || '',
    next_touch_time:   c.next_touch_time   || '',
    playbook_checks:   JSON.stringify(c.playbook_checks || {}),
    last_contact_date:  c.last_contact_date  || '',
    touch_history:      JSON.stringify(c.touch_history || []),
    external_id:        c.external_id        || '',
    stripe_customer_id:  c.stripe_customer_id  || '',
    hubspot_company_id:  c.hubspot_company_id  || '',
    salesforce_account_id: c.salesforce_account_id || '',
    billing_interval:    c.billing_interval    || '',
    contact_name:        c.contact_name        || '',
    contact_email:       c.contact_email       || ''
  };
  // Preserve the customer's original client_id from the DB row.
  // Falls back to active client context (admin viewing another client),
  // then to the current user's own client_id.
  if (_dbHasClientId) {
    const cid = c._client_id
      || (typeof isAdmin === 'function' && isAdmin() && typeof activeClientId !== 'undefined' && activeClientId !== '__own__' ? activeClientId : null)
      || _userClientId;
    if (cid) row.client_id = cid;
  }
  // Strip columns that don't exist in the DB (detected during first load)
  if (_dbColumns) {
    for (const key of Object.keys(row)) {
      if (!_dbColumns.has(key)) delete row[key];
    }
  }
  return row;
}

// Load all customers for current user's client from Supabase
// Uses client_id for ownership - all users in the same client see the same customers
// Active rows (deleted_at IS NULL) → customers[]
// Soft-deleted rows (deleted_at IS NOT NULL) → trash[]
async function loadCustomersFromSupabase() {
  let data, error;

  if (isAdmin()) {
    // Admin: try client_id first, fall back to loading all
    if (_userClientId) {
      ({ data, error } = await sb.from('customers')
        .select('*')
        .eq('client_id', _userClientId)
        .order('created_at', { ascending: false }));
      if (!error) _dbHasClientId = true;
    }
    // If no client_id set, or client_id query failed (column may not exist yet), load all
    if (!_userClientId || error) {
      if (error) console.warn('client_id query unavailable, using fallback:', error.message);
      ({ data, error } = await sb.from('customers')
        .select('*')
        .order('created_at', { ascending: false }));
    }
  } else if (_userClientId) {
    // Non-admin with client: try client_id first
    ({ data, error } = await sb.from('customers')
      .select('*')
      .eq('client_id', _userClientId)
      .order('created_at', { ascending: false }));
    if (!error) {
      _dbHasClientId = true;
    } else {
      // Fall back to user_id if client_id column doesn't exist yet
      console.warn('client_id query unavailable, falling back to user_id:', error.message);
      ({ data, error } = await sb.from('customers')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false }));
    }
  } else {
    // Non-admin without client: fall back to user_id
    ({ data, error } = await sb.from('customers')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false }));
  }

  if (error) throw error;
  // Detect valid DB columns from first row (so toRow() can skip missing columns)
  if (!_dbColumns && data && data.length) {
    _dbColumns = new Set(Object.keys(data[0]));
    console.log('DB columns detected:', _dbColumns.size);
  }
  const all = (data || []).map(fromRow);
  customers = all.filter(c => !c.deleted_at);
  trash     = all.filter(c =>  c.deleted_at);
  try {
    localStorage.setItem('iqc_customers_cache', JSON.stringify(customers));
    localStorage.setItem('iqc_last_refresh', String(Date.now()));
  } catch (e) {
    console.warn('localStorage cache skipped (quota exceeded)');
  }
  snapshotCustomerStates();
}

// Loading overlay - reference counted so nested calls don't hide prematurely
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

// save(c) - upsert a single customer
async function save(c) {
  if (!currentUser) return;
  // Always update localStorage cache immediately so UI stays intact
  try { localStorage.setItem('iqc_customers_cache', JSON.stringify(customers)); } catch(e) {}
  const { error } = await sb.from('customers').upsert(toRow(c), { onConflict: 'id' });
  if (error) {
    console.error('Supabase save error:', error.message, error);
    throw error;
  }
  // Fire webhook triggers on successful save
  checkWebhookTriggers(c);
}

// ── Historical data merge ────────────────────────────────────
// Merges new history entries into a customer, deduplicates by date, and saves.
// newEntries: [{date, score, signals}]
// Returns count of entries actually added.
function mergeHistory(c, newEntries) {
  if (!newEntries || !newEntries.length) return 0;
  c.history = c.history || [];
  const existing = new Set(c.history.map(h => (h.date || '').split('T')[0]));
  let added = 0;
  for (const entry of newEntries) {
    const day = (entry.date || '').split('T')[0];
    if (!day) continue;
    if (existing.has(day)) {
      // Replace if new entry has more filled signals
      const idx = c.history.findIndex(h => (h.date || '').split('T')[0] === day);
      if (idx >= 0) {
        const oldFilled = Object.values(c.history[idx].signals || {}).filter(v => v != null).length;
        const newFilled = Object.values(entry.signals || {}).filter(v => v != null).length;
        if (newFilled > oldFilled) { c.history[idx] = entry; added++; }
      }
    } else {
      c.history.push(entry);
      existing.add(day);
      added++;
    }
  }
  c.history.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return added;
}

// Pull historical data from a connected integration
// platform: 'salesforce' | 'hubspot' | 'stripe'
// lookback: '30d' | '90d' | '6mo' | '1yr'
async function pullHistoricalData(platform, lookback) {
  if (!sb || !currentUser) { toast('Not signed in', 'error'); return null; }
  const fnName = platform + '-history';
  toast('Pulling ' + lookback + ' of history from ' + platform + '…', 'info');
  try {
    const { data, error } = await sb.functions.invoke(fnName, {
      body: { lookback }
    });
    if (error) throw error;
    if (!data) throw new Error('No data returned');
    if (data.error) throw new Error(data.error);
    if (!data.customers) throw new Error('No customer data returned');

    // Normalize helper: strip common suffixes, lowercase, remove extra spaces/punctuation
    const _norm = s => (s || '').toLowerCase().replace(/[.,\-_]/g, ' ')
      .replace(/\b(inc|llc|ltd|corp|corporation|co|company|group|the)\b/gi, '')
      .replace(/\s+/g, ' ').trim();

    let totalAdded = 0, matched = 0;
    const unmatched = [];
    for (const entry of data.customers) {
      // 1. Exact match by external_id
      let c = customers.find(x =>
        entry.external_id && (x.external_id === entry.external_id || x.salesforce_account_id === entry.external_id || x.hubspot_company_id === entry.external_id || x.stripe_customer_id === entry.external_id)
      );
      // 2. Exact name match
      if (!c && entry.name) {
        c = customers.find(x => x.name && x.name.toLowerCase() === entry.name.toLowerCase());
      }
      // 3. Fuzzy name match: strip suffixes like Inc, LLC, Corp, extra punctuation
      if (!c && entry.name) {
        const normEntry = _norm(entry.name);
        if (normEntry.length >= 3) {
          c = customers.find(x => {
            const normX = _norm(x.name);
            return normX === normEntry || normX.startsWith(normEntry) || normEntry.startsWith(normX);
          });
        }
      }
      if (!c) {
        unmatched.push(entry.name || entry.external_id || 'unknown');
        continue;
      }
      matched++;
      const added = mergeHistory(c, entry.history || []);
      totalAdded += added;
      if (added > 0) await save(c);
    }

    const stats = data.stats || {};
    toast(`History imported: ${matched} customers, ${totalAdded} snapshots added (${stats.dateRange?.from || '?'} → ${stats.dateRange?.to || '?'})`, 'success');
    // Refresh UI
    if (typeof renderAll === 'function') renderAll();
    return { matched, totalAdded, stats, unmatched };
  } catch (err) {
    console.error('[pullHistoricalData]', err);
    toast('History pull failed: ' + (err.message || err), 'error');
    return null;
  }
}

// Ownership filter helper - uses client_id if DB supports it, else user_id
function _ownerEq(query) {
  if (_dbHasClientId && _userClientId) return query.eq('client_id', _userClientId);
  return query.eq('user_id', currentUser.id);
}

// atDelete(c) - SOFT delete: sets deleted_at, never removes the row
async function atDelete(c) {
  if (!currentUser) return;
  const deletedAt = new Date().toISOString();
  const { error } = await sb.from('customers').update({ deleted_at: deletedAt }).eq('id', c.id);
  if (error) console.warn('atDelete DB error:', error.message);
}

// restoreCustomer(id) - clears deleted_at, brings customer back
async function restoreCustomer(id) {
  if (!currentUser) return;
  const c = trash.find(x => x.id === id);
  if (!c) return;
  c.deleted_at = null;
  customers.unshift(c);
  trash = trash.filter(x => x.id !== id);
  try { localStorage.setItem('iqc_customers_cache', JSON.stringify(customers)); } catch(e) {}
  renderTrash();
  renderCustomers();
  updateAlertBadge();
  logAudit('customer_restored', c.id, c.name, { summary: `Restored from trash - Score: ${c.score}/100, MRR: $${c.mrr||0}` });
  toast(`${c.name} restored`, 'success');
  const { error } = await sb.from('customers').update({ deleted_at: null }).eq('id', id);
  if (error) toast('Restore sync failed', 'warn');
}

// hardDeleteCustomer(id) - permanently removes a row (from trash only)
async function hardDeleteCustomer(id) {
  const c = trash.find(x => x.id === id);
  if (!c) return;
  confirmAction(`Permanently delete "${c.name}"? This account and all its data will be gone forever and cannot be recovered.`, async () => {
    const cName = c.name;
    trash = trash.filter(x => x.id !== id);
    renderTrash();
    logAudit('customer_hard_deleted', id, cName, { summary: 'Permanently removed from database' });
    toast(`${cName} permanently deleted`, 'warn');
    const { error } = await sb.from('customers').delete().eq('id', id);
    if (error) { console.warn('hardDelete DB error:', error.message); toast('Permanent delete sync failed', 'warn'); }
  });
}

// emptyTrash() - hard delete all soft-deleted records
async function emptyTrash() {
  if (!trash.length) return;
  confirmAction(`Permanently delete all ${trash.length} items in trash? These accounts and all their data will be gone forever and cannot be recovered.`, async () => {
    const toNuke = [...trash];
    const ids = toNuke.map(c => c.id);
    logAudit('customer_hard_deleted', null, '', { summary: `Emptied trash: ${toNuke.length} record${toNuke.length!==1?'s':''} permanently deleted` });
    trash = [];
    toast('Trash emptied', 'warn');
    if (!customers.length) { if (typeof _wtDismiss === 'function') _wtDismiss(); nav('homebase'); } else { renderTrash(); }
    // Delete by id list - RLS handles ownership check
    const { error } = await sb.from('customers').delete().in('id', ids);
    if (error) console.warn('Trash empty DB error:', error.message);
  });
}

// ── Trash selection state ──
var _trashSelected = new Set();

function _trashToggle(id) {
  if (_trashSelected.has(id)) _trashSelected.delete(id); else _trashSelected.add(id);
  renderTrash();
}
function _trashToggleAll() {
  if (_trashSelected.size === trash.length) _trashSelected.clear();
  else trash.forEach(c => _trashSelected.add(c.id));
  renderTrash();
}
function _trashBulkRestore() {
  const ids = [..._trashSelected];
  if (!ids.length) return;
  confirmAction(`Restore ${ids.length} item${ids.length!==1?'s':''}?`, () => {
    ids.forEach(id => restoreCustomer(id));
    _trashSelected.clear();
  });
}
function _trashBulkDelete() {
  const ids = [..._trashSelected];
  if (!ids.length) return;
  confirmAction(`Permanently delete ${ids.length} item${ids.length!==1?'s':''}? These accounts and all their data will be gone forever and cannot be recovered.`, async () => {
    const toNuke = trash.filter(c => ids.includes(c.id));
    logAudit('customer_hard_deleted', null, '', { summary: `Bulk deleted ${toNuke.length} record${toNuke.length!==1?'s':''} from trash` });
    trash = trash.filter(c => !ids.includes(c.id));
    _trashSelected.clear();
    toNuke.forEach(c => toast(`${c.name} permanently deleted`, 'warn'));
    if (!customers.length && !trash.length) { if (typeof _wtDismiss === 'function') _wtDismiss(); nav('homebase'); } else { renderTrash(); }
    const { error } = await sb.from('customers').delete().in('id', ids);
    if (error) console.warn('Bulk trash delete DB error:', error.message);
  });
}

// renderTrash() - shows soft-deleted customers inside the customers view
function renderTrash() {
  const wrap = document.getElementById('trash-wrap');
  if (!wrap) return;

  // Clean up stale selections
  _trashSelected = new Set([..._trashSelected].filter(id => trash.some(c => c.id === id)));

  const backBtn = `<button class="btn btn-sm btn-ghost" onclick="setFilter('all')" style="margin-bottom:12px">← Back to Customers</button>`;

  if (!trash.length) {
    _trashSelected.clear();
    wrap.innerHTML = `<div style="padding:16px">${backBtn}<div class="empty-st"><div class="ei"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--subtle)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></div><h3>Trash is empty</h3><p>Deleted customers appear here. You can restore or permanently delete them.</p></div></div>`;
    return;
  }

  const selCount = _trashSelected.size;
  const allChecked = selCount === trash.length;

  const bulkBar = selCount > 0 ? `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:color-mix(in srgb, var(--teal) 8%, var(--surface));border:1px solid color-mix(in srgb, var(--teal) 25%, var(--border));border-radius:var(--r);margin-bottom:10px">
      <span style="font-size:var(--fs-sm);font-weight:600;color:var(--text)">${selCount} selected</span>
      <button class="btn btn-sm btn-ghost" onclick="_trashBulkRestore()">Restore Selected</button>
      <button class="btn btn-sm btn-danger" onclick="_trashBulkDelete()">Delete Selected Forever</button>
      <button class="btn btn-sm btn-ghost" onclick="_trashSelected.clear();renderTrash()" style="margin-left:auto">Clear Selection</button>
    </div>` : '';

  const rows = trash.map(c => {
    const deletedStr = c.deleted_at ? new Date(c.deleted_at).toLocaleDateString() : ' -';
    const checked = _trashSelected.has(c.id) ? 'checked' : '';
    return `<tr style="${checked ? 'background:color-mix(in srgb, var(--teal) 5%, var(--surface))' : ''}">
      <td style="width:36px;text-align:center"><input type="checkbox" ${checked} onchange="_trashToggle('${escHtml(c.id)}')" style="cursor:pointer"></td>
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

  wrap.innerHTML = `<div style="padding:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <button class="btn btn-sm btn-ghost" onclick="setFilter('all')">← Back to Customers</button>
        <span style="font-size:.85rem;color:var(--muted)">${trash.length} item${trash.length!==1?'s':''} in trash</span>
      </div>
      <button class="btn btn-sm btn-danger" onclick="emptyTrash()">Empty Trash</button>
    </div>
    ${bulkBar}
    <table class="ct">
      <thead><tr>
        <th style="width:36px;text-align:center"><input type="checkbox" ${allChecked ? 'checked' : ''} onchange="_trashToggleAll()" style="cursor:pointer" title="Select all"></th>
        <th>Name</th><th>Deleted</th><th>Status</th><th>MRR</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// atUpdate(c) - alias for save
async function atUpdate(c) { return save(c); }
async function atCreate(c) { return save(c); }

// ─── INTEGRATIONS ────────────────────────────────────────────

// Load integration status for the current client
async function loadIntegrationStatus(platform) {
  try {
    let q = sb.from('integrations').select('*');
    if (platform) q = q.eq('platform', platform);
    const { data, error } = await q;
    if (error) { console.warn('loadIntegrationStatus:', error.message); return []; }
    return data || [];
  } catch(e) { console.warn('loadIntegrationStatus:', e); return []; }
}

// Connect an integration (calls Edge Function)
async function connectIntegration(platform, credential) {
  const { data, error } = await sb.functions.invoke('integration-connect', {
    body: { platform, action: 'connect', credential }
  });
  if (error) throw new Error(error.message || 'Connection failed');
  if (data && !data.success) throw new Error(data.error || 'Connection failed');
  return data;
}

// Disconnect an integration (calls Edge Function)
async function disconnectIntegration(platform) {
  const { data, error } = await sb.functions.invoke('integration-connect', {
    body: { platform, action: 'disconnect' }
  });
  if (error) throw new Error(error.message || 'Disconnect failed');
  if (data && !data.success) throw new Error(data.error || 'Disconnect failed');
  return data;
}

// Trigger a sync (calls Edge Function)
async function syncIntegration(platform) {
  const fnName = platform + '-sync'; // e.g. 'stripe-sync'
  const { data, error } = await sb.functions.invoke(fnName, { body: {} });
  if (error) {
    // Try to extract server error message from the response
    let msg = error.message || 'Sync failed';
    try {
      if (error.context && typeof error.context.json === 'function') {
        const body = await error.context.json();
        if (body?.error) msg = body.error;
      }
    } catch(_) {}
    throw new Error(msg);
  }
  if (data && !data.success) throw new Error(data.error || 'Sync failed');
  return data;
}

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
// Weighted CSM list - senior reps get more accounts, junior fewer
// Duplicates control weight: more entries = more accounts assigned
// CSM definitions with target account share and health bias
// bias: 'good' = mostly healthy accounts, 'mixed' = realistic spread, 'tough' = more at-risk
const _DEMO_CSMS = [
  { name: 'Sarah Mitchell',   pct: 0.19, bias: 'good'  },  // Sr - largest book, mostly healthy
  { name: 'James Chen',       pct: 0.17, bias: 'mixed' },  // Sr - big book, realistic mix
  { name: 'Maria Rodriguez',  pct: 0.15, bias: 'mixed' },  // Mid - solid portfolio
  { name: 'David Kim',        pct: 0.13, bias: 'tough' },  // Mid - inherited some tough accounts
  { name: 'Rachel Foster',    pct: 0.12, bias: 'good'  },  // Mid - strong performer
  { name: 'Anil Patel',       pct: 0.10, bias: 'tough' },  // Jr - newer, got at-risk book
  { name: 'Emily Nakamura',   pct: 0.08, bias: 'mixed' },  // Jr - small book, still ramping
  { name: 'Tom Brennan',      pct: 0.06, bias: 'mixed' },  // Jr - smallest book
];

// Build weighted CSM list for round-robin (legacy compat for 250-count)
const _DEMO_CSMS_WEIGHTED = [];
_DEMO_CSMS.forEach(c => {
  const n = Math.max(1, Math.round(30 * c.pct / 0.19));
  for (let i = 0; i < n; i++) _DEMO_CSMS_WEIGHTED.push(c.name);
});

// Assign CSMs with uneven counts + health-biased sorting
function _assignCSMs(trajList, count) {
  // Build CSM slots
  const slots = [];
  _DEMO_CSMS.forEach(c => {
    const n = Math.max(1, Math.round(count * c.pct));
    for (let i = 0; i < n; i++) slots.push(c);
  });
  while (slots.length > count) slots.pop();
  while (slots.length < count) slots.push(_DEMO_CSMS[0]);

  // Sort trajectories by health: good trajectories first, tough last
  const healthOrder = { 'stable-healthy':0,'good-not-great':1,'seasonal':2,'recovered':3,'improving':4,'slow-improve':5,
    'stable-mid':6,'volatile':7,'onboarding-fast':8,'partial-recovery':9,'seasonal-declining':10,
    'onboarding-slow':11,'slow-decline':12,'declining':13,'stable-low':14,'churned-early':15,'churned-late':16 };
  const indices = trajList.map((t,i) => i);
  indices.sort((a,b) => healthOrder[trajList[a]] - healthOrder[trajList[b]]);

  // Sort slots: 'good' bias CSMs get first pick (healthy), 'tough' get last (at-risk)
  const biasOrder = { good: 0, mixed: 1, tough: 2 };
  slots.sort((a,b) => biasOrder[a.bias] - biasOrder[b.bias]);

  // Map: for each original index, assign a CSM name
  const assignments = new Array(count);
  indices.forEach((origIdx, slotIdx) => {
    assignments[origIdx] = slots[slotIdx].name;
  });
  return assignments;
}
const _DEMO_NOTES = [
  'QBR went well. Champion is engaged and open to upsell convo.',
  'Escalated to VP of Support - tickets still climbing.',
  'Onboarding kickoff completed. Primary contact trained.',
  'NPS follow-up done. Main concern is reporting gaps.',
  'Renewed early with 10% uplift. Very happy with recent features.',
  'Exec sponsor changed - need to rebuild relationship.',
  'Product usage dropped after key team member left.',
  'Expansion convo scheduled for next week.',
  'Flagged integration issues - eng team is investigating.',
  'Great case-study candidate. Asked about speaking at conference.',
  'User training session completed - team showing strong adoption.',
  'Billing dispute resolved. Customer satisfied with outcome.',
  'Competitor eval in progress - need to demonstrate value ASAP.',
  'New decision-maker introduced. Scheduling intro call.',
  'Feature request logged for API enhancements - product team reviewing.'
];
const _DEMO_SENTIMENTS = [
  { val:'negative', note:'Customer expressed frustration with onboarding delays.' },
  { val:'negative', note:'Unhappy with recent product changes. Wants old workflow back.' },
  { val:'negative', note:'Support response time too slow - escalated internally.' },
  { val:'positive', note:'Very happy with latest release. Praised the team.' },
  { val:'positive', note:'Referred a colleague. Strong advocate.' },
  { val:'neutral',  note:'Routine check-in. No strong feelings either way.' },
  { val:'negative', note:'Budget concerns raised. May downgrade next renewal.' },
  { val:'positive', note:'Exceeded their KPIs using our platform. Great case study potential.' }
];

// ── Trajectory definitions: each has base signal ranges + trend function ──
// trend(d,t) returns 0–1 where d=dayIndex, t=totalDays. 1=best signals, 0=worst.
// Wide signal ranges ensure visible metric changes as trend value shifts.
const _DEMO_TRAJECTORIES = {
  'stable-healthy': {
    logins:[14,30], adoption:[60,98], tickets:[0,1], days:[1,12],
    npsOpts:[8,9,9,10,10], csatOpts:[4,4,5,5,5],
    growthOpts:['strong','strong','mild'],
    lifecycle:'active', noise:0.12,
    // Solid performer - cruises 72-88 with natural wobble, occasional dip to high 60s
    trend: (d,t) => 0.76 + 0.14 * Math.sin(d/t * Math.PI * 8) + 0.05 * Math.cos(d/t * Math.PI * 3)
  },
  'good-not-great': {
    logins:[10,24], adoption:[48,82], tickets:[0,2], days:[3,18],
    npsOpts:[7,7,8,8,9], csatOpts:[3,4,4,4,5],
    growthOpts:['mild','mild','none'],
    lifecycle:'active', noise:0.09,
    // Reliably mid-range 60-75 - not a concern but not a star
    trend: (d,t) => 0.66 + 0.08 * Math.sin(d/t * Math.PI * 6) + 0.04 * Math.cos(d/t * Math.PI * 11)
  },
  'stable-mid': {
    logins:[4,20], adoption:[28,72], tickets:[0,3], days:[8,40],
    npsOpts:[5,6,7,7,8], csatOpts:[3,3,3,4,4],
    growthOpts:['none','mild','mild'],
    lifecycle:'active', noise:0.10,
    // Watch zone 42-62 - enough wobble to sometimes trigger alerts, sometimes look ok
    trend: (d,t) => 0.48 + 0.14 * Math.sin(d/t * Math.PI * 5) + 0.06 * Math.cos(d/t * Math.PI * 13)
  },
  'stable-low': {
    logins:[1,12], adoption:[10,45], tickets:[1,5], days:[20,70],
    npsOpts:[3,4,4,5,5,6], csatOpts:[1,2,2,3,3],
    growthOpts:['none','none','mild'],
    lifecycle:'atrisk', noise:0.10,
    // Risk zone 22-38 - brief upticks that never sustain
    trend: (d,t) => 0.25 + 0.10 * Math.sin(d/t * Math.PI * 4) + 0.06 * Math.max(0, Math.sin(d/t * Math.PI * 9))
  },
  'improving': {
    logins:[3,28], adoption:[15,92], tickets:[0,2], days:[3,50],
    npsOpts:[4,5,6,7,8,9], csatOpts:[2,3,3,4,4,5],
    growthOpts:['none','mild','mild','strong'],
    lifecycle:'active', noise:0.10,
    // Clear upward ramp - starts ~30, ends ~82, with steps/plateaus
    trend: (d,t) => {
      const p = d/t;
      if (p < 0.15) return 0.22 + 0.08 * p / 0.15;                         // slow start
      if (p < 0.35) return 0.30 + 0.18 * (p - 0.15) / 0.20;               // first push
      if (p < 0.50) return 0.48 + 0.04 * Math.sin((p - 0.35) * Math.PI * 6); // plateau wobble
      if (p < 0.75) return 0.48 + 0.24 * (p - 0.50) / 0.25;               // second push
      return 0.72 + 0.13 * (p - 0.75) / 0.25;                              // settling near 82
    }
  },
  'slow-improve': {
    logins:[5,22], adoption:[20,70], tickets:[0,2], days:[5,35],
    npsOpts:[5,5,6,6,7,7,8], csatOpts:[3,3,3,4,4,4],
    growthOpts:['none','none','mild','mild'],
    lifecycle:'active', noise:0.08,
    // Gradual grind upward 40→68 over the full period - not dramatic
    trend: (d,t) => 0.38 + 0.30 * (d/t) + 0.05 * Math.sin(d/t * Math.PI * 9)
  },
  'declining': {
    logins:[2,26], adoption:[12,85], tickets:[0,4], days:[3,65],
    npsOpts:[9,8,7,6,5,4,4], csatOpts:[5,4,4,3,2,2,1],
    growthOpts:['strong','mild','none','none'],
    lifecycle:'atrisk', noise:0.08,
    // Starts healthy ~85, slides to ~30 with a false recovery mid-way
    trend: (d,t) => {
      const p = d/t;
      if (p < 0.25) return 0.85 - 0.15 * p / 0.25;                         // initial slide
      if (p < 0.40) return 0.70 - 0.18 * (p - 0.25) / 0.15;               // accelerating
      if (p < 0.55) return 0.52 + 0.10 * Math.sin((p - 0.40) / 0.15 * Math.PI); // false rally
      return 0.52 - 0.28 * (p - 0.55) / 0.45;                              // final decline
    }
  },
  'slow-decline': {
    logins:[3,22], adoption:[15,68], tickets:[0,3], days:[8,55],
    npsOpts:[7,7,6,6,5,5,4], csatOpts:[4,4,3,3,3,2,2],
    growthOpts:['mild','none','none'],
    lifecycle:'active', noise:0.07,
    // Gradual slide from 80 → 42 with small wobbles
    trend: (d,t) => 0.80 - 0.38 * (d/t) + 0.06 * Math.sin(d/t * Math.PI * 7)
  },
  'volatile': {
    logins:[2,30], adoption:[15,95], tickets:[0,3], days:[2,55],
    npsOpts:[4,6,7,9,10,7,4], csatOpts:[2,3,4,5,4,3,2],
    growthOpts:['none','mild','strong','none','mild'],
    lifecycle:'active', noise:0.14,
    // Wild swings - 3 full cycles between ~30 and ~85
    trend: (d,t) => {
      const p = d/t;
      return 0.52 + 0.32 * Math.sin(p * Math.PI * 6) * (0.7 + 0.3 * Math.cos(p * Math.PI * 2.3));
    }
  },
  'onboarding-fast': {
    logins:[0,24], adoption:[0,70], tickets:[0,2], days:[2,20],
    npsOpts:[null,null,6,7,8,8], csatOpts:[null,null,3,4,4,5],
    growthOpts:['none','mild'],
    lifecycle:'onboarding', noise:0.12,
    // Quick ramp to ~75 in 2-3 months
    trend: (d,t) => {
      const p = d/t;
      if (p < 0.10) return 0.02 + 0.08 * p / 0.10;
      if (p < 0.30) return 0.10 + 0.35 * (p - 0.10) / 0.20;
      if (p < 0.40) return 0.45 + 0.05 * Math.sin((p - 0.30) / 0.10 * Math.PI);
      return 0.45 + 0.35 * (p - 0.40) / 0.60;
    },
    historyDays: 90
  },
  'onboarding-slow': {
    logins:[0,16], adoption:[0,50], tickets:[0,3], days:[5,35],
    npsOpts:[null,null,5,6,6,7], csatOpts:[null,null,3,3,3,4],
    growthOpts:['none','none','mild'],
    lifecycle:'onboarding', noise:0.10,
    // Sluggish ramp - 6 months in and only at ~55
    trend: (d,t) => {
      const p = d/t;
      if (p < 0.15) return 0.02 + 0.05 * p / 0.15;
      if (p < 0.40) return 0.07 + 0.18 * (p - 0.15) / 0.25;
      if (p < 0.60) return 0.25 + 0.08 * (p - 0.40) / 0.20;
      return 0.33 + 0.25 * (p - 0.60) / 0.40;
    },
    historyDays: 180
  },
  'churned-early': {
    logins:[0,22], adoption:[0,55], tickets:[0,4], days:[5,90],
    npsOpts:[6,5,4,3,3,2], csatOpts:[3,3,2,2,1,1],
    growthOpts:['none','none'],
    lifecycle:'churned', noise:0.08,
    // Never really got going - ramped to ~50 then fell off within 6 months
    trend: (d,t) => {
      const p = d/t;
      if (p < 0.35) return 0.10 + 0.45 * p / 0.35;                         // ramp attempt
      if (p < 0.50) return 0.55 - 0.05 * (p - 0.35) / 0.15;               // plateau
      if (p < 0.70) return 0.50 - 0.25 * (p - 0.50) / 0.20;               // decline
      return 0.25 - 0.22 * (p - 0.70) / 0.30;                              // gone
    },
    historyDays: 270
  },
  'churned-late': {
    logins:[0,26], adoption:[0,88], tickets:[0,6], days:[2,120],
    npsOpts:[9,8,7,5,4,3,2], csatOpts:[5,4,3,2,2,1,1],
    growthOpts:['mild','none','none','none'],
    lifecycle:'churned', noise:0.06,
    // Long-time customer - healthy for 60% of history, then steep collapse
    trend: (d,t) => {
      const p = d/t;
      if (p < 0.55) return 0.82 + 0.08 * Math.sin(p * Math.PI * 5);        // long healthy era
      if (p < 0.65) return 0.80 - 0.20 * (p - 0.55) / 0.10;               // warning signs
      if (p < 0.80) return 0.60 - 0.32 * (p - 0.65) / 0.15;               // rapid decline
      return 0.28 - 0.25 * (p - 0.80) / 0.20;                              // flatline near zero
    }
  },
  'recovered': {
    logins:[2,28], adoption:[10,90], tickets:[0,2], days:[3,55],
    npsOpts:[8,6,4,4,5,7,8,9], csatOpts:[4,3,2,2,3,4,4,5],
    growthOpts:['mild','none','none','mild','strong'],
    lifecycle:'active', noise:0.10,
    // V-shape: healthy 82 → dip to 28 → recovery to 75
    trend: (d,t) => {
      const p = d/t;
      if (p < 0.30) return 0.82 - 0.52 * p / 0.30;                         // drop
      if (p < 0.45) return 0.30 - 0.05 * Math.sin((p - 0.30) / 0.15 * Math.PI); // trough
      return 0.30 + 0.48 * (p - 0.45) / 0.55;                              // recovery
    }
  },
  'partial-recovery': {
    logins:[3,22], adoption:[12,72], tickets:[0,3], days:[5,50],
    npsOpts:[7,5,4,4,5,6,6], csatOpts:[4,3,2,2,3,3,3],
    growthOpts:['mild','none','none','mild'],
    lifecycle:'active', noise:0.09,
    // Dropped from 78 to 30, recovered to 58 but stalled - not fully back
    trend: (d,t) => {
      const p = d/t;
      if (p < 0.25) return 0.78 - 0.46 * p / 0.25;                         // drop
      if (p < 0.40) return 0.32 + 0.02 * Math.sin((p - 0.25) / 0.15 * Math.PI * 2); // trough
      if (p < 0.70) return 0.32 + 0.26 * (p - 0.40) / 0.30;               // partial recovery
      return 0.58 + 0.04 * Math.sin((p - 0.70) * Math.PI * 8);             // stalled
    }
  },
  'seasonal': {
    logins:[6,30], adoption:[35,95], tickets:[0,3], days:[2,30],
    npsOpts:[6,7,8,8,9,10], csatOpts:[3,4,4,5,5],
    growthOpts:['mild','strong','mild'],
    lifecycle:'active', noise:0.08,
    // 3-4 pronounced seasonal cycles - 45-88 range
    trend: (d,t) => {
      const p = d/t;
      return 0.62 + 0.26 * Math.sin(p * Math.PI * 7) + 0.06 * Math.sin(p * Math.PI * 19);
    }
  },
  'seasonal-declining': {
    logins:[4,26], adoption:[20,80], tickets:[0,3], days:[3,40],
    npsOpts:[8,7,7,6,6,5,5], csatOpts:[4,4,3,3,3,2],
    growthOpts:['mild','none','none'],
    lifecycle:'active', noise:0.09,
    // Seasonal cycles but each peak is lower - envelope shrinks from 85 to 55
    trend: (d,t) => {
      const p = d/t;
      const envelope = 0.75 - 0.25 * p;
      return envelope + 0.18 * Math.sin(p * Math.PI * 7);
    }
  }
};

// Tier-specific trajectory distributions - each tier has a different health profile
// Enterprise: healthiest, most stable, lowest churn
// Mid-Market: mixed, some volatility, moderate churn
// SMB: most volatile, highest churn, more onboarding issues
const _DEMO_TRAJ_BY_TIER = {
  enterprise: [
    ['stable-healthy',      0.30],
    ['good-not-great',      0.18],
    ['seasonal',            0.08],
    ['improving',           0.10],
    ['recovered',           0.06],
    ['stable-mid',          0.06],
    ['slow-improve',        0.04],
    ['onboarding-fast',     0.04],
    ['volatile',            0.02],
    ['declining',           0.03],
    ['slow-decline',        0.03],
    ['partial-recovery',    0.02],
    ['churned-late',        0.02],
    ['seasonal-declining',  0.02],
  ],
  mid: [
    ['stable-healthy',      0.16],
    ['good-not-great',      0.14],
    ['seasonal',            0.06],
    ['improving',           0.08],
    ['slow-improve',        0.05],
    ['recovered',           0.06],
    ['stable-mid',          0.10],
    ['partial-recovery',    0.05],
    ['onboarding-fast',     0.05],
    ['volatile',            0.04],
    ['declining',           0.05],
    ['slow-decline',        0.04],
    ['onboarding-slow',     0.03],
    ['stable-low',          0.02],
    ['churned-early',       0.03],
    ['churned-late',        0.02],
    ['seasonal-declining',  0.02],
  ],
  smb: [
    ['stable-healthy',      0.10],
    ['good-not-great',      0.10],
    ['seasonal',            0.04],
    ['improving',           0.06],
    ['slow-improve',        0.04],
    ['recovered',           0.04],
    ['stable-mid',          0.10],
    ['partial-recovery',    0.05],
    ['onboarding-fast',     0.06],
    ['onboarding-slow',     0.05],
    ['volatile',            0.06],
    ['declining',           0.05],
    ['slow-decline',        0.05],
    ['stable-low',          0.04],
    ['seasonal-declining',  0.04],
    ['churned-early',       0.07],
    ['churned-late',        0.05],
  ]
};

// Flat fallback for legacy/generic use
const _DEMO_TRAJ_PCTS = _DEMO_TRAJ_BY_TIER.mid;
function _buildTrajDist(count) {
  const dist = [];
  _DEMO_TRAJ_PCTS.forEach(([key, pct]) => {
    const n = Math.max(1, Math.round(count * pct));
    for (let i = 0; i < n; i++) dist.push(key);
  });
  // Trim or pad to exact count
  while (dist.length > count) dist.pop();
  while (dist.length < count) dist.push('stable-healthy');
  return dist;
}
// Legacy compat
const _DEMO_TRAJ_DIST = _buildTrajDist(250);

function _dClamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function _dLerp([lo,hi],t){ return lo+(hi-lo)*_dClamp(t,0,1); }
function _dRand(lo,hi,rng){ return lo+(rng||Math.random)()*(hi-lo); }
function _dPick(arr,t,rng){
  const idx = _dClamp(Math.floor(t * arr.length), 0, arr.length-1);
  const jitter = Math.floor((rng||Math.random)() * 2) - 1;
  return arr[_dClamp(idx+jitter, 0, arr.length-1)];
}
// Mulberry32 seeded PRNG - deterministic per customer
function _makeRng(seed) {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function _generateDemoNames(count) {
  // Build all possible combinations, shuffle deterministically, and pick the first `count`
  const combos = [];
  for (const p of _DEMO_PREFIXES) for (const s of _DEMO_SUFFIXES) combos.push(p + ' ' + s);
  // Seeded PRNG (mulberry32) for deterministic shuffle - same names every time
  let _s = 42;
  const rng = () => { _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // Fisher-Yates shuffle with seeded RNG
  for (let i = combos.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [combos[i], combos[j]] = [combos[j], combos[i]];
  }
  return combos.slice(0, count);
}

function _generateDemoSignals(traj, dayIdx, totalDays, rng, phaseOff) {
  const r = rng || Math.random;
  const po = phaseOff || 0;
  // Apply per-customer phase offset so same trajectory type produces different curves
  const t = traj.trend(dayIdx + po, totalDays);
  const n = () => 1 + (r()*2-1) * traj.noise;
  const logins   = _dClamp(Math.round(_dLerp(traj.logins, t) * n()), 0, 40);
  const adoption = _dClamp(Math.round(_dLerp(traj.adoption, t) * n()), 0, 100);
  const tickets  = _dClamp(Math.round(_dLerp(traj.tickets, 1-t) * n()), 0, 10);
  const days     = _dClamp(Math.round(_dLerp(traj.days, 1-t) * n()), 0, 150);
  const nps      = _dPick(traj.npsOpts, t, r);
  const csat     = _dPick(traj.csatOpts, t, r);
  const growth   = _dPick(traj.growthOpts, t, r);
  return { logins, adoption, tickets, nps, csat, days, growth, lifecycle: traj.lifecycle };
}

function _generateDemoHistory(trajKey, now, overrideDays, rng, phaseOff, mrr) {
  const traj = _DEMO_TRAJECTORIES[trajKey];
  const r = rng || Math.random;
  const totalDays = overrideDays || traj.historyDays || 730;
  const entries = [];
  // For churned trajectories, determine the churn point
  // Spread churns across the timeline: 40-85% through history
  // so some churned a year ago, others recently
  const isChurned = trajKey.startsWith('churned');
  const churnDay = isChurned ? Math.round(totalDays * (0.40 + (r() * 0.45))) : null;
  for (let d = totalDays; d >= 0; d--) {
    // Variable frequency: weekly for old data, denser for recent
    if (d > 0 && d < totalDays) {
      if (d > 180) { if (d % 7 !== 0 || r() < 0.10) continue; }       // >6mo: ~weekly
      else if (d > 30) { if (d % 3 !== 0 || r() < 0.12) continue; }    // 1-6mo: every ~3d
      else { if (r() < 0.20) continue; }                                // <1mo: most days
    }
    const dayIdx = totalDays - d;
    const signals = _generateDemoSignals(traj, dayIdx, totalDays, rng, phaseOff);
    // Embed MRR in signals - drops to 0 after churn point
    if (mrr != null) {
      const daysFromEnd = d;
      if (isChurned && daysFromEnd < (totalDays - churnDay)) {
        signals._mrr = 0;
      } else {
        signals._mrr = mrr;
      }
    }
    const { score } = calcScore(signals);
    entries.push({ score, date: new Date(now - d * 86400000).toISOString(), signals });
  }
  return entries;
}

function _generateDemoCustomer(name, index, now, trajList, csmAssignments) {
  const dist = trajList || _DEMO_TRAJ_DIST;
  const trajKey = dist[index % dist.length];
  const traj = _DEMO_TRAJECTORIES[trajKey];

  // Per-customer seeded RNG - deterministic but unique per customer
  const rng = _makeRng(1000 + index * 137);

  // Per-customer phase offset (±10-25% of history) - same trajectory type
  // produces visibly different curves for each customer
  const phaseOff = Math.round((rng() - 0.5) * 180);

  // Tier & MRR - deterministic per customer, decoupled from trajectory
  // Churned accounts skew toward mid/enterprise so churn impact is visible
  const tierRoll = rng();
  const isChurnedTraj = trajKey.startsWith('churned');
  const tier = isChurnedTraj
    ? (tierRoll < 0.30 ? 'smb' : tierRoll < 0.70 ? 'mid' : 'enterprise')
    : (tierRoll < 0.55 ? 'smb' : tierRoll < 0.85 ? 'mid' : 'enterprise');
  // Per-customer MRR spread - wider ranges so customers differ meaningfully
  const mrr = tier === 'smb' ? Math.round(_dRand(400,4000,rng)/50)*50
            : tier === 'mid' ? Math.round(_dRand(2500,22000,rng)/100)*100
            : Math.round(_dRand(12000,65000,rng)/500)*500;

  // History depth - stagger tenure: some founding clients, some recent additions
  // Creates natural cohorts: founding (18-24mo), early (12-18mo), mid (6-12mo), recent (2-6mo)
  let histDays;
  if (traj.historyDays) {
    histDays = traj.historyDays + Math.floor(rng() * 60);
  } else if (trajKey.startsWith('churned')) {
    // Churned customers: varied tenure before they left
    histDays = 180 + Math.floor(rng() * 540); // 6-24 months
  } else {
    // Spread across cohorts using per-customer RNG
    const cohortRoll = rng();
    if (cohortRoll < 0.20)      histDays = 600 + Math.floor(rng() * 130);  // founding: 20-24 months
    else if (cohortRoll < 0.45) histDays = 365 + Math.floor(rng() * 235);  // early: 12-20 months
    else if (cohortRoll < 0.72) histDays = 180 + Math.floor(rng() * 185);  // mid: 6-12 months
    else                        histDays = 60 + Math.floor(rng() * 120);   // recent: 2-6 months
  }
  const history = _generateDemoHistory(trajKey, now, histDays, rng, phaseOff, mrr);
  const last = history[history.length - 1];
  const lastSig = last.signals;
  // Churned customers: current MRR is 0 (they left), keep _prechurnMrr for reference
  const isChurned = trajKey.startsWith('churned');
  const currentMrr = isChurned ? 0 : mrr;

  // Lifecycle - spread across all stages for realistic mix
  let lifecycle = traj.lifecycle;
  if (trajKey === 'stable-healthy') {
    const r = rng();
    if (r < 0.12) lifecycle = 'won';
  } else if (trajKey === 'good-not-great') {
    // Stays active
  } else if (trajKey === 'improving' || trajKey === 'slow-improve') {
    if (rng() < 0.20) lifecycle = 'onboarding';
  } else if (trajKey === 'recovered') {
    if (rng() < 0.20) lifecycle = 'won';
  } else if (trajKey === 'partial-recovery') {
    if (rng() < 0.40) lifecycle = 'atrisk';
  } else if (trajKey === 'declining' || trajKey === 'slow-decline' || trajKey === 'seasonal-declining') {
    if (rng() < 0.35) lifecycle = 'atrisk';
  } else if (trajKey === 'volatile') {
    const r = rng();
    if (r < 0.15) lifecycle = 'atrisk';
  } else if (trajKey === 'seasonal') {
    if (rng() < 0.12) lifecycle = 'won';
  }

  // Renewal date
  const renDate = new Date(now);
  if (lifecycle === 'churned') {
    renDate.setMonth(renDate.getMonth() - 1 - Math.floor(rng() * 5));
  } else {
    renDate.setMonth(renDate.getMonth() + (index % 12) + 1);
  }
  renDate.setDate(1 + Math.floor(rng() * 27));
  const renewal_date = renDate.toISOString().slice(0,10);
  const renewal = Math.max(0, Math.round((renDate - new Date(now)) / (1000*60*60*24*30.44)));

  // Customer-since date - match history depth
  const sinceDate = new Date(now);
  sinceDate.setDate(sinceDate.getDate() - histDays - Math.floor(rng() * 60));
  const since = sinceDate.toISOString().slice(0,10);

  // Created date
  const createdDate = new Date(sinceDate);
  createdDate.setDate(createdDate.getDate() - Math.floor(rng()*14));
  const created = createdDate.toISOString();

  // Industry segment tag - 6 verticals, keeps segments page clean
  const _DEMO_INDUSTRIES = [
    'technology','healthcare','financial-services',
    'retail','professional-services','manufacturing'
  ];
  const tags = [_DEMO_INDUSTRIES[index % _DEMO_INDUSTRIES.length]];

  // Notes (~30% of customers, up to 2 notes each)
  const notes = [];
  if (rng() < 0.30) {
    const noteDate = new Date(now - Math.floor(rng()*30)*86400000).toISOString();
    notes.push({ text: _DEMO_NOTES[index % _DEMO_NOTES.length], date: noteDate });
    if (rng() < 0.35) {
      const noteDate2 = new Date(now - Math.floor(30 + rng()*60)*86400000).toISOString();
      notes.push({ text: _DEMO_NOTES[(index + 7) % _DEMO_NOTES.length], date: noteDate2 });
    }
  }

  // Sentiment (~35% of customers, 1-3 entries)
  const sentiment = [];
  if (rng() < 0.35) {
    const sCount = 1 + Math.floor(rng() * 2);
    for (let s = 0; s < sCount; s++) {
      const si = (index + s * 3) % _DEMO_SENTIMENTS.length;
      let pick = _DEMO_SENTIMENTS[si];
      if (['declining','churned-early','churned-late','slow-decline','stable-low','seasonal-declining'].includes(trajKey) && pick.val === 'positive' && rng() < 0.7) {
        pick = _DEMO_SENTIMENTS[si % 3];
      }
      if (['stable-healthy','good-not-great','improving','recovered'].includes(trajKey) && pick.val === 'negative' && rng() < 0.6) {
        pick = _DEMO_SENTIMENTS[3 + (si % 2)];
      }
      const sentDate = new Date(now - Math.floor((s * 30 + rng()*25)*86400000)).toISOString();
      sentiment.push({ val: pick.val, note: pick.note, date: sentDate });
    }
  }

  // Next scheduled touch (~40% of active customers)
  let next_touch = '';
  let next_touch_time = '';
  if (lifecycle !== 'churned' && rng() < 0.40) {
    const ntDate = new Date(now);
    ntDate.setDate(ntDate.getDate() + 1 + Math.floor(rng() * 21));
    next_touch = ntDate.toISOString().slice(0,10);
    if (rng() < 0.50) {
      const hr = 8 + Math.floor(rng() * 10);
      const mn = [0,15,30,45][Math.floor(rng()*4)];
      next_touch_time = String(hr).padStart(2,'0') + ':' + String(mn).padStart(2,'0');
    }
  }

  // Last contact date
  let last_contact_date = '';
  if (lifecycle !== 'churned' && lastSig.days != null && lastSig.days > 0 && rng() < 0.60) {
    const lcd = new Date(now);
    lcd.setDate(lcd.getDate() - lastSig.days);
    last_contact_date = lcd.toISOString().slice(0,10);
  }

  return {
    id:              crypto.randomUUID(),
    name,
    score:           last.score,
    status:          getStatus(last.score),
    mrr:             currentMrr,
    arr:             currentMrr * 12,
    _prechurnMrr:    isChurned ? mrr : undefined,
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
    manager:         (csmAssignments && csmAssignments[index]) || _DEMO_CSMS_WEIGHTED[index % _DEMO_CSMS_WEIGHTED.length],
    scoring_profile: '',
    deleted_at:      null,
    created,
    next_touch,
    next_touch_time,
    playbook_checks: {},
    last_contact_date
  };
}

function initDemo(count) {
  count = count || 250;
  const now = Date.now();
  const names = _generateDemoNames(count);
  const tierRng = _makeRng(555);

  // Step 1: Assign tiers first (55% SMB, 30% mid, 15% enterprise)
  const tiers = [];
  for (let i = 0; i < count; i++) {
    const r = tierRng();
    tiers.push(r < 0.55 ? 'smb' : r < 0.85 ? 'mid' : 'enterprise');
  }

  // Step 2: Build per-tier trajectory pools
  const tierCounts = { smb: 0, mid: 0, enterprise: 0 };
  tiers.forEach(t => tierCounts[t]++);

  const tierTrajLists = {};
  for (const t of ['smb', 'mid', 'enterprise']) {
    const pcts = _DEMO_TRAJ_BY_TIER[t];
    const list = [];
    pcts.forEach(([key, pct]) => {
      const n = Math.max(1, Math.round(tierCounts[t] * pct));
      for (let i = 0; i < n; i++) list.push(key);
    });
    while (list.length > tierCounts[t]) list.pop();
    while (list.length < tierCounts[t]) list.push('stable-healthy');
    // Shuffle within tier
    const rng = _makeRng(t === 'smb' ? 111 : t === 'mid' ? 222 : 333);
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    tierTrajLists[t] = list;
  }

  // Step 3: Build combined trajectory list matching tier order
  const tierIdx = { smb: 0, mid: 0, enterprise: 0 };
  const trajList = tiers.map(t => tierTrajLists[t][tierIdx[t]++]);

  // Assign CSMs with uneven book sizes and health bias
  const csmAssignments = _assignCSMs(trajList, count);
  customers = names.map((name, i) => _generateDemoCustomer(name, i, now, trajList, csmAssignments));

  // Override the random tier assignment in _generateDemoCustomer with our pre-assigned tiers
  customers.forEach((c, i) => {
    c.tier = tiers[i];
    const rng = _makeRng(2000 + i * 71);
    c.mrr = c.tier === 'smb' ? Math.round(_dRand(400, 4000, rng) / 50) * 50
          : c.tier === 'mid' ? Math.round(_dRand(2500, 22000, rng) / 100) * 100
          : Math.round(_dRand(12000, 65000, rng) / 500) * 500;
    c.arr = c.mrr * 12;
  });
}

// One-time admin function: push demo data to Supabase for demo@iqcadence.com
// Run from browser console while logged in as admin: seedDemoData()
async function seedDemoData(emailOrClientId, count) {
  // Seeds demo customers into an EXISTING client.
  // Usage: seedDemoData()                           - seeds the currently selected client (admin dropdown)
  //        seedDemoData('some-email@x.com')         - 75 accounts via email lookup
  //        seedDemoData('some-uuid-client-id')      - 75 accounts via client_id
  //        seedDemoData('client-uuid', 100)         - custom count
  count = count || 75;
  if (!isAdmin()) { console.error('Must be logged in as admin'); return; }

  // Default: use the currently active client from the admin dropdown (or fall back to demo email)
  let arg = emailOrClientId;
  if (!arg) {
    if (typeof activeClientId !== 'undefined' && activeClientId && activeClientId !== '__own__') {
      arg = activeClientId;
      console.log('No arg supplied - using active client from dropdown: ' + arg);
    } else {
      arg = 'demo@iqcadence.com';
      console.log('No arg supplied and no client selected - defaulting to demo@iqcadence.com');
    }
  }
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg);

  let targetClientId, targetUserId;

  if (isUUID) {
    // Direct client_id passed - verify it exists
    console.log('1/4 - Verifying client ' + arg + '…');
    const { data: cl, error: clErr } = await sb.from('clients').select('id, name').eq('id', arg).limit(1);
    if (clErr) { console.error('Client query error:', clErr.message); return; }
    if (!cl || !cl.length) { console.error('No client found with ID ' + arg); return; }
    targetClientId = cl[0].id;
    targetUserId = (await sb.auth.getUser()).data.user.id; // audit: current admin
    console.log('   Client:', cl[0].name, '(' + targetClientId + ')');
  } else {
    // Email passed - resolve to client_id
    const targetEmail = arg;
    console.log('1/4 - Finding user profile for ' + targetEmail + '…');
    let prof;
    try {
      const { data, error: profErr } = await sb.from('user_profiles')
        .select('user_id, client_id, email, business_name')
        .eq('email', targetEmail.toLowerCase())
        .limit(1);
      if (profErr) { console.error('Profile query error:', profErr.message); return; }
      prof = data && data.length ? data[0] : null;
    } catch(e) { console.error('Profile query exception:', e); return; }

    if (!prof) {
      console.error('No user_profiles row found for ' + targetEmail);
      console.error('Make sure the user has logged in at least once, or create their profile in User Management.');
      return;
    }
    if (!prof.client_id) {
      console.error('User ' + targetEmail + ' is not assigned to any client.');
      console.error('Go to Settings → User Management → Edit, and assign them to a client first.');
      return;
    }
    targetClientId = prof.client_id;
    targetUserId = prof.user_id;
    console.log('   User ID:', prof.user_id);
    console.log('   Client ID:', prof.client_id);
    console.log('   Business:', prof.business_name || '(none)');
  }

  // 2. Delete existing customers for this client
  console.log('2/4 - Deleting existing customers for client ' + targetClientId + '…');
  const { error: delErr } = await sb.from('customers').delete().eq('client_id', targetClientId);
  if (delErr) { console.error('Delete error:', delErr.message); return; }
  console.log('   Old data cleared.');

  // 3. Generate demo customers in memory
  console.log('3/4 - Generating ' + count + ' demo customers (2+ years history each)…');
  initDemo(count); // populates customers[]

  // 4. Push to Supabase under that user's ID
  console.log('4/4 - Pushing to Supabase (' + count + ' rows)…');
  const rows = customers.map(c => {
    const row = toRow(c);
    row.user_id = targetUserId;       // audit: who seeded
    row.client_id = targetClientId;   // ownership: target client
    return row;
  });

  // Auto-detect missing columns: try first row, strip any column the DB rejects, retry
  let badCols = new Set();
  let testRow = { ...rows[0] };
  for (let attempt = 0; attempt < 8; attempt++) {
    const { error: testErr } = await sb.from('customers').upsert([testRow], { onConflict: 'id' });
    if (!testErr) break;
    const colMatch = testErr.message.match(/Could not find the '(\w+)' column/);
    if (colMatch) {
      badCols.add(colMatch[1]);
      delete testRow[colMatch[1]];
      console.warn('   Stripping missing column: ' + colMatch[1]);
    } else {
      console.error('Insert error:', testErr.message);
      return;
    }
  }
  if (badCols.size) {
    console.log('   Stripped ' + badCols.size + ' missing columns: ' + [...badCols].join(', '));
    rows.forEach(r => badCols.forEach(col => delete r[col]));
  }

  // Bulk upsert in chunks of 25 (row 0 already inserted by test, upsert is idempotent)
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const chunk = rows.slice(i, i + 25);
    const { error } = await sb.from('customers').upsert(chunk, { onConflict: 'id' });
    if (error) { console.error('Insert error at row ' + i + ':', error.message); return; }
    inserted += chunk.length;
    console.log('   ' + inserted + '/' + rows.length + ' rows…');
  }

  // Verify rows actually landed
  const { count: verifyCount } = await sb.from('customers').select('*', { count: 'exact', head: true }).eq('client_id', targetClientId);
  console.log('✓ Verification: ' + (verifyCount ?? 'unknown') + ' rows in Supabase for client ' + targetClientId);
  console.log('✓ Done! Refresh the page to load them.');
  toast('Demo data seeded - ' + (verifyCount ?? count) + ' customers', 'success');
}

// Helper: list all clients (logs to console, no await needed)
function listClients() {
  sb.from('clients').select('id, name, plan_tier').then(({ data, error }) => {
    if (error) { console.error('Error:', error.message); return; }
    console.table(data);
  });
}

// ─── DEMO ACCOUNT SEED ──────────────────────────────────────
// Curated 42-customer demo for the 'Demo Account' client.
// Run from console: seedExampleData()
async function seedExampleData() {
  if (!isAdmin()) { console.error('Must be logged in as admin'); return; }

  // 1. Find 'Demo Account' client
  console.log('1/4 - Finding Demo Account client…');
  const { data: clients } = await sb.from('clients').select('id, name');
  const exClient = (clients || []).find(c => c.name.toLowerCase() === 'demo account');
  if (!exClient) { console.error("No client named 'Demo Account'. Create it in Settings → Clients first."); return; }

  // 2. Find a user assigned to that client
  const { data: profiles } = await sb.from('user_profiles').select('user_id, email').eq('client_id', exClient.id);
  if (!profiles || !profiles.length) { console.error('No users assigned to Demo Account client.'); return; }
  const targetUser = profiles[0];
  console.log('   Client:', exClient.name, '(' + exClient.id + ')');
  console.log('   Target user:', targetUser.email);

  // 3. Delete existing customers for this client
  console.log('2/4 - Clearing existing data…');
  await sb.from('customers').delete().eq('client_id', exClient.id);
  console.log('   Old data cleared.');

  // 4. Generate curated customers
  const now = Date.now();
  const CSMS = ['Alex Thompson', 'Jordan Lee', 'Sam Patel'];

  // Company definitions: [name, tier, mrr, trajKey, csmIndex, tenureMonths, renewalMonths, extraTags]
  // Spread across 2 years to show portfolio growth - started with ~8 clients, now 42
  // Earlier clients have more volatile histories (growing pains), newer ones healthier (product matured)
  const COMPANIES = [
    // ── Wave 1: Founding clients (22-24 months ago) - 8 accounts ──
    ['Meridian Health Systems',  'enterprise', 42000, 'recovered',       0, 24, 4, ['healthcare']],
    ['Atlas Robotics',           'enterprise', 48000, 'stable-healthy',  1, 23, 6, ['manufacturing']],
    ['Granite Peak Energy',      'enterprise', 52000, 'seasonal',        2, 24, 5, ['energy']],
    ['Cascade Financial Group',  'enterprise', 38000, 'volatile',        0, 22, 2, ['financial-services']],
    ['Redtail Software',         'mid',        7200,  'recovered',       0, 23, 5, ['technology']],
    ['Copperline Industries',    'mid',        7500,  'stable-healthy',  1, 22, 7, ['manufacturing']],
    ['Lantern Group',            'smb',        1200,  'churned',         0, 22, -3, ['media']],
    ['CloudNine Ventures',       'mid',        5500,  'volatile',        0, 23, 5, ['financial-services']],

    // ── Wave 2: Early growth (17-21 months ago) - 8 accounts ──
    ['Northpoint Logistics',     'enterprise', 35000, 'improving',       0, 21, 3, ['logistics']],
    ['Pacific Coast Insurance',  'enterprise', 31000, 'recovered',       1, 19, 3, ['insurance']],
    ['Zenith Pharma',            'mid',        11000, 'seasonal',        1, 20, 5, ['healthcare']],
    ['Silverlake Media',         'mid',        8000,  'declining',       0, 18, 3, ['media']],
    ['Vanguard Ops',             'mid',        7800,  'stable-healthy',  0, 19, 7, ['logistics']],
    ['Daybreak Education',       'smb',        1800,  'stable-low',      0, 18, 4, ['education']],
    ['Terraverde Foods',         'smb',        1600,  'churned',         1, 17, -2, ['food-beverage']],
    ['Ironclad Security',        'mid',        6500,  'improving',       2, 20, 7, ['technology']],

    // ── Wave 3: Acceleration (12-16 months ago) - 10 accounts ──
    ['TrueVista Analytics',      'mid',        12000, 'volatile',        0, 16, 6, ['technology']],
    ['Bridgewell Partners',      'mid',        9500,  'improving',       0, 14, 10, ['financial-services']],
    ['Horizon Biotech',          'mid',        6800,  'stable-healthy',  0, 15, 7, ['healthcare']],
    ['Ironbridge Capital',       'mid',        14000, 'improving',       1, 12, 9, ['financial-services']],
    ['Wavefront Digital',        'mid',        9000,  'declining',       1, 14, 2, ['media']],
    ['Beacon Aerospace',         'mid',        6200,  'volatile',        1, 16, 4, ['aerospace']],
    ['Stratos Telecom',          'mid',        13000, 'slow-decline',    2, 15, 1, ['telecom']],
    ['Blueshift Labs',           'mid',        10500, 'improving',       2, 13, 8, ['technology']],
    ['Lakeshore Realty',         'smb',        3100,  'seasonal',        2, 14, 6, ['real-estate']],
    ['Summit Trail Co',          'smb',        1500,  'improving',       0, 13, 6, ['retail']],

    // ── Wave 4: Growth phase (7-11 months ago) - 8 accounts ──
    ['Crestline Manufacturing',  'smb',        3200,  'declining',       0, 10, 1, ['manufacturing']],
    ['Oakridge Consulting',      'smb',        2800,  'stable-healthy',  0, 9, 9, ['professional-services']],
    ['RapidEdge Tech',           'smb',        2600,  'volatile',        0, 8, 8, ['technology']],
    ['Lionsgate Supply',         'mid',        6400,  'improving',       0, 11, 4, ['retail']],
    ['Keystone Learning',        'smb',        3400,  'stable-healthy',  1, 10, 10, ['education']],
    ['Prism Dynamics',           'mid',        5800,  'recovered',       1, 9, 6, ['technology']],
    ['Timberline Outdoors',      'smb',        2500,  'stable-healthy',  2, 8, 9, ['retail']],
    ['Greystone Partners',       'mid',        8800,  'improving',       0, 7, 2, ['financial-services']],

    // ── Wave 5: Recent additions (3-6 months ago) - 5 accounts ──
    ['Pinecrest Digital',        'smb',        2400,  'improving',       0, 5, 11, ['technology']],
    ['Wrenfield Analytics',      'smb',        1900,  'stable-healthy',  0, 4, 9, ['technology']],
    ['Frostbyte Gaming',         'smb',        2900,  'stable-healthy',  1, 6, 12, ['media']],
    ['Nightfall Studios',        'smb',        1400,  'improving',       2, 5, 3, ['media']],
    ['Sagebrush Marketing',      'smb',        2000,  'stable-healthy',  2, 3, 10, ['professional-services']],

    // ── Wave 6: Newest onboarding (0-2 months) - 3 accounts ──
    ['Evergreen Solutions',      'smb',        2100,  'onboarding',      0, 2, 12, ['professional-services']],
    ['Driftwood Creative',       'smb',        2200,  'onboarding',      1, 1, 13, ['media']],
    ['Helix Genomics',           'mid',        8500,  'onboarding',      2, 1, 14, ['healthcare']]
  ];

  console.log('3/4 - Generating ' + COMPANIES.length + ' curated customers…');
  const exCustomers = COMPANIES.map(([name, tier, mrr, trajKey, csmIdx, tenureMo, renewMo, extraTags], i) => {
    // Generate history scoped to tenure (so newer clients have shorter history)
    const tenureDays = Math.max(30, tenureMo * 30);
    const history = _generateDemoHistory(trajKey, now, tenureDays);
    const last = history[history.length - 1];
    const lastSig = last.signals;

    // Lifecycle from trajectory
    let lifecycle = _DEMO_TRAJECTORIES[trajKey].lifecycle;
    if (trajKey === 'stable-healthy' && last.score >= 88 && Math.random() < 0.15) lifecycle = 'won';

    // Renewal date
    const renDate = new Date(now);
    if (lifecycle === 'churned') {
      renDate.setMonth(renDate.getMonth() + renewMo); // renewMo is negative for churned
    } else {
      renDate.setMonth(renDate.getMonth() + renewMo);
    }
    renDate.setDate(1 + Math.floor(Math.random() * 27));
    const renewal_date = renDate.toISOString().slice(0,10);
    const renewal = Math.max(0, Math.round((renDate - new Date(now)) / (1000*60*60*24*30.44)));

    // Tenure
    const sinceDate = new Date(now);
    sinceDate.setMonth(sinceDate.getMonth() - tenureMo);
    const since = sinceDate.toISOString().slice(0,10);
    const created = new Date(sinceDate.getTime() - Math.floor(Math.random()*14)*86400000).toISOString();

    // Tags (industry-based)
    const tags = [...extraTags];

    // Notes - ~50% get notes, weighted toward troubled/important accounts
    const notes = [];
    const notePool = [
      'QBR went well - champion engaged, discussing expansion next quarter.',
      'Escalation raised around ticket response times. Eng team investigating.',
      'Onboarding progressing well. Primary users trained on core workflows.',
      'NPS follow-up complete. Concern around missing analytics features.',
      'Renewed early with 8% uplift. Very satisfied with recent improvements.',
      'Exec sponsor left the company - identifying new stakeholder.',
      'Usage dipped after team restructuring. Scheduled re-enablement session.',
      'Expansion discussion planned for next month. Multi-seat opportunity.',
      'Integration issues flagged - coordinating with product team.',
      'Strong advocate - asked about case study and referral program.',
      'Training session delivered to 12 new users. Adoption climbing.',
      'Competitor mentioned in renewal convo - need to reinforce value.',
      'Budget review coming up - prepared ROI deck for champion.',
      'New VP of Ops introduced. Scheduling exec alignment call.',
      'Feature request submitted for API webhooks - product reviewing.'
    ];
    if (Math.random() < 0.50 || ['declining','slow-decline','churned','recovered'].includes(trajKey)) {
      notes.push({ text: notePool[i % notePool.length], date: new Date(now - Math.floor(Math.random()*20)*86400000).toISOString() });
      if (Math.random() < 0.40) {
        notes.push({ text: notePool[(i + 7) % notePool.length], date: new Date(now - Math.floor(25 + Math.random()*40)*86400000).toISOString() });
      }
    }

    // Sentiment - ~45% get entries
    const sentiment = [];
    const sentPool = [
      { val:'negative', note:'Expressed frustration with slow support response.' },
      { val:'negative', note:'Unhappy with recent UX changes. Wants rollback option.' },
      { val:'negative', note:'Budget pressure - may reduce seats at renewal.' },
      { val:'positive', note:'Very happy with Q4 release. Praised the team publicly.' },
      { val:'positive', note:'Referred two new prospects. Strong internal advocate.' },
      { val:'neutral',  note:'Routine check-in. Stable, no major concerns.' },
      { val:'positive', note:'Hit their KPIs using our platform. Potential case study.' },
      { val:'neutral',  note:'Team change in progress. Monitoring for impact.' }
    ];
    if (Math.random() < 0.45) {
      let pick = sentPool[i % sentPool.length];
      if (['declining','churned','slow-decline'].includes(trajKey) && pick.val === 'positive') pick = sentPool[0];
      if (['stable-healthy','improving'].includes(trajKey) && pick.val === 'negative') pick = sentPool[3];
      sentiment.push({ val: pick.val, note: pick.note, date: new Date(now - Math.floor(Math.random()*15)*86400000).toISOString() });
      if (Math.random() < 0.30) {
        const pick2 = sentPool[(i + 4) % sentPool.length];
        sentiment.push({ val: pick2.val, note: pick2.note, date: new Date(now - Math.floor(30 + Math.random()*30)*86400000).toISOString() });
      }
    }

    // Next touch - 50% of active
    let next_touch = '';
    let next_touch_time = '';
    if (lifecycle !== 'churned' && Math.random() < 0.50) {
      const ntDate = new Date(now);
      ntDate.setDate(ntDate.getDate() + 1 + Math.floor(Math.random() * 18));
      next_touch = ntDate.toISOString().slice(0,10);
      if (Math.random() < 0.50) {
        const hr = 8 + Math.floor(Math.random() * 10);
        const mn = [0,15,30,45][Math.floor(Math.random()*4)];
        next_touch_time = String(hr).padStart(2,'0') + ':' + String(mn).padStart(2,'0');
      }
    }

    // Last contact date - 70% of active
    let last_contact_date = '';
    if (lifecycle !== 'churned' && lastSig.days != null && lastSig.days > 0 && Math.random() < 0.70) {
      const lcd = new Date(now);
      lcd.setDate(lcd.getDate() - lastSig.days);
      last_contact_date = lcd.toISOString().slice(0,10);
    }

    // Touch history - past calls for accounts with tenure > 3 months
    const touch_history = [];
    if (lifecycle !== 'churned' && tenureMo > 3) {
      const numPast = 2 + Math.floor(Math.random() * Math.min(4, Math.floor(tenureMo / 3)));
      for (let ti = 0; ti < numPast; ti++) {
        const daysAgo = 14 + Math.floor(Math.random() * Math.min(tenureDays - 14, 300));
        const thDate = new Date(now - daysAgo * 86400000);
        touch_history.push({
          date: thDate.toISOString().slice(0,10),
          status: Math.random() < 0.85 ? 'completed' : 'missed'
        });
      }
      touch_history.sort((a, b) => a.date.localeCompare(b.date));
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
      manager:         CSMS[csmIdx],
      scoring_profile: '',
      deleted_at:      lifecycle === 'churned' ? null : null,
      created,
      next_touch,
      next_touch_time,
      playbook_checks: {},
      last_contact_date,
      touch_history
    };
  });

  // 5. Push to Supabase
  console.log('4/4 - Pushing ' + exCustomers.length + ' customers to Supabase…');
  const rows = exCustomers.map(c => {
    const row = toRow(c);
    row.user_id = targetUser.user_id;   // audit: who seeded
    row.client_id = exClient.id;        // ownership: Demo Account client
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

  console.log('✓ Done! 42 customers seeded under Demo Account (' + exClient.id + ')');
  console.log('CSM distribution: Alex Thompson (18), Jordan Lee (14), Sam Patel (10)');
  toast('Demo data seeded - 42 customers across 3 CSMs', 'success');
}

// ─── AUTO-REFRESH ────────────────────────────────────────────
let _pollTimer = null;
let _syncPauseUntil = 0; // pause silentSync after bulk operations (e.g. rescoreAll)
let _lastSyncTime = 0;   // track last successful sync to avoid redundant reloads
let _syncInProgress = false;

// Call after bulk saves to prevent silentSync from overwriting local data
// while Supabase writes are still in flight
function pauseSync(ms) { _syncPauseUntil = Date.now() + (ms || 120000); }

// Silent background sync - never shows the loading overlay
async function silentSync() {
  if (!currentUser) return;
  if (Date.now() < _syncPauseUntil) return; // skip while bulk saves are in flight
  if (_syncInProgress) return; // prevent concurrent syncs
  // Skip if data was synced within the last 30 seconds
  if (Date.now() - _lastSyncTime < 30000) return;
  _syncInProgress = true;
  try {
    // Snapshot current state to detect if data actually changed
    const prevHash = customers.length + '|' + customers.reduce((s,c) => s + c.score, 0);

    // Respect the active client context - if admin switched to a specific client,
    // reload that client's data instead of the admin's own
    if (isAdmin() && activeClientId !== '__own__') {
      await loadClientCustomers(activeClientId, true);
    } else {
      await loadCustomersFromSupabase();
    }
    _lastSyncTime = Date.now();

    // Only re-render if data actually changed
    const newHash = customers.length + '|' + customers.reduce((s,c) => s + c.score, 0);
    if (newHash !== prevHash) {
      refreshMgrDropdown();
      const active = VIEWS.find(v => document.getElementById('view-'+v)?.classList.contains('active'));
      if (active === 'homebase')  renderHomeBase();
      if (active === 'customers') renderCustomers();
      if (active === 'alerts')    renderAlerts();
    }
  } catch(e) { /* silent */ }
  _syncInProgress = false;
}

function startPolling() {
  if (_pollTimer) return;
  _pollTimer = setInterval(silentSync, 60000);
}

function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// Refresh data when user returns to the tab (no spinner, debounced 3s)
let _visibilityTimer = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentUser) {
    clearTimeout(_visibilityTimer);
    _visibilityTimer = setTimeout(silentSync, 3000);
  }
});

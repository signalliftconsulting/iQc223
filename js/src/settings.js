// ─── SETTINGS ───────────────────────────────────────────────
function cfgTab(which) {
  ['config','account','api'].forEach(t => {
    el('cfg-tab-'+t)?.classList.toggle('active', t === which);
    el('cfg-pane-'+t)?.classList.toggle('active', t === which);
  });
  _renderSettingsGuide(which);
  if (which === 'account') {
    renderCSMList();
    renderDataHealth();
  }
  if (which === 'api') {
    if (!hasFeature('api_webhooks')) {
      const pane = el('cfg-pane-api');
      if (pane) pane.innerHTML = upgradeHTML('api_webhooks');
      return;
    }
    apiSubTab('integrations');
  }
}

function apiSubTab(which) {
  ['integrations','devtools'].forEach(t => {
    el('api-tab-'+t)?.classList.toggle('active', t === which);
    el('api-pane-'+t)?.classList.toggle('active', t === which);
  });
  if (which === 'integrations') {
    renderIntegrationsSection();
  } else if (which === 'devtools') {
    renderWebhookConfig();
    renderApiSection();
    loadWebhookLog();
  }
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

function _dismissSettingsGuide() {
  _dismissGuide('settings-guide', 'iqc_settings_guide_dismissed', true);
  const b = document.getElementById('settings-guide-badge'); if (b) b.style.display = 'none';
}

function _updateSettingsGuideBadge() {
  const b = el('settings-guide-badge');
  if (!b) return;
  try { b.style.display = localStorage.getItem('iqc_settings_guide_dismissed') === '1' ? 'none' : ''; } catch(e) { b.style.display = 'none'; }
}

function _renderSettingsGuide(tab) {
  var content = '';
  if (tab === 'account') {
    content =
      '<strong>Account Settings</strong> - Manage your team and data from here.<br>' +
      '<strong>CSM List:</strong> Add, edit, or remove Customer Success Managers. CSMs assigned here appear in the manager filter and CSM Performance page.<br>' +
      '<strong>Data Health:</strong> See how complete your customer data is - missing fields, stale accounts, and signal coverage gaps.<br>' +
      '<strong>Backup & Restore:</strong> Export your full dataset as a JSON backup or restore from a previous export.<br>' +
      '<strong>Password:</strong> Change your account password.';
  } else if (tab === 'api') {
    content =
      '<strong>Integrations</strong> - Connect external tools to auto-sync customer data.<br>' +
      '<strong>Native Integrations:</strong> Connect Salesforce, HubSpot, or Stripe to pull customer data, contacts, and revenue automatically.<br>' +
      '<strong>API & Webhooks:</strong> Use the REST API to push data from any system. Generate API keys, view endpoints, and configure inbound webhooks for real-time updates.<br>' +
      '<strong>Tip:</strong> Connected integrations sync on a schedule. Use the API for custom or real-time data flows.';
  } else {
    content =
      '<strong>Scoring Configuration</strong> - Control how iQcadence calculates health scores.<br>' +
      '<strong>iQcadence Signal Model:</strong> Enable the built-in signal model to automatically adjust scores based on signal trends, velocity, and cross-signal patterns. Choose Conservative, Balanced, or Aggressive sensitivity.<br>' +
      '<strong>Signal Weights:</strong> Set how much each metric (logins, adoption, NPS, CSAT, tickets, contact days, growth) impacts the health score. Weights must total 100%.<br>' +
      '<strong>Status Thresholds:</strong> Define the score boundaries for Critical, At Risk, Watch, Healthy, and Expand status bands.<br>' +
      '<strong>Scoring Profiles:</strong> Create custom weight sets for different segments (e.g. Enterprise vs SMB) - assign them per customer in the Score form.<br>' +
      '<strong>Tip:</strong> The Signal Model works on top of your weights - it detects patterns like declining engagement or improving sentiment and nudges scores accordingly.';
  }
  _renderGuide('settings-guide', 'iqc_settings_guide_dismissed', content);
}

function goToScoringConfig() {
  nav('settings');
  setTimeout(function() {
    var sc = document.getElementById('settings-scoring');
    if (sc) sc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 200);
}

function renderSettings() {
  // Always reset to Config tab on navigation (also renders the tab-specific guide)
  cfgTab('config');

  // Thresholds (available to all tiers)
  el('th-critical').value = thresholds.critical;
  el('th-risk').value     = thresholds.risk;
  el('th-watch').value    = thresholds.watch;
  el('th-healthy').value  = thresholds.healthy;
  updateThresholdLabels();
  renderExpansionSettings();
  renderCadenceSettings();
  renderRenewalWindows();
  renderMiscThresholds();

  // Weights - available to ALL tiers (ungated)
  const weightCard = el('weight-rows')?.closest('.card');
  if (weightCard) {
    weightCard.style.opacity = ''; weightCard.style.pointerEvents = '';
    weightCard.querySelector('.upgrade-overlay')?.remove();
  }

  // Scoring Profiles - gated to Growth tier
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
  renderCSMList();
  renderScoreDistribution();
  renderDataHealth();
  renderSignalModelSettings();
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
  const keys = ['logins','adoption','tickets','nps','csat','days','growth'];
  el('weight-rows').innerHTML = keys.map(k => {
    const isOff = (weights[k] || 0) === 0;
    return `
    <div class="weight-row" id="wrow-${k}" style="${isOff ? 'opacity:.45' : ''}">
      <div class="weight-label">${WEIGHT_LABELS[k]}</div>
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;min-width:56px" title="Toggle this signal on/off">
        <input type="checkbox" id="wt-${k}" ${isOff ? '' : 'checked'} onchange="toggleSignalWeight('${k}',this.checked)" style="accent-color:var(--blue);cursor:pointer;margin:0"/>
        <span id="wt-lbl-${k}">${isOff ? 'Off' : 'On'}</span>
      </label>
      <input type="range" min="0" max="100" value="${weights[k]}" id="wr-${k}"
        oninput="updateWeightFromSlider('${k}',this.value)" style="flex:1;cursor:pointer;accent-color:var(--blue)"${isOff ? ' disabled' : ''}/>
      <div class="weight-pct"><input type="number" min="0" max="100" value="${weights[k]}" id="wp-${k}"
        oninput="updateWeightFromInput('${k}',this.value)"
        style="width:42px;text-align:center;border:1.5px solid var(--border);border-radius:6px;padding:2px 2px;font-size:var(--fs-base);font-weight:700;font-family:var(--font);color:var(--text);outline:none;background:var(--surface);-moz-appearance:textfield"
        onfocus="this.select()"${isOff ? ' disabled' : ''}/><span style="font-size:var(--fs-base);font-weight:700;margin-left:1px">%</span></div>
    </div>`;
  }).join('');
  updateTotalBar();
}

function toggleSignalWeight(key, on) {
  const slider = el('wr-' + key);
  const inp = el('wp-' + key);
  const row = el('wrow-' + key);
  const lbl = el('wt-lbl-' + key);
  if (on) {
    // Turning on - restore to a default value (10) so they can adjust
    if (slider) { slider.value = 10; slider.disabled = false; }
    if (inp) { inp.value = 10; inp.disabled = false; }
    if (row) row.style.opacity = '';
    if (lbl) lbl.textContent = 'On';
  } else {
    // Turning off - set to 0
    if (slider) { slider.value = 0; slider.disabled = true; }
    if (inp) { inp.value = 0; inp.disabled = true; }
    if (row) row.style.opacity = '.45';
    if (lbl) lbl.textContent = 'Off';
  }
  updateTotalBar();
  _previewDistFromSliders();
}

function updateWeightFromSlider(key, val) {
  const v = Math.max(0, Math.min(100, parseInt(val)||0));
  const inp = el('wp-'+key);
  if (inp) inp.value = v;
  updateTotalBar();
  _previewDistFromSliders();
}

function updateWeightFromInput(key, val) {
  const v = Math.max(0, Math.min(100, parseInt(val)||0));
  const slider = el('wr-'+key);
  if (slider) slider.value = v;
  updateTotalBar();
  _previewDistFromSliders();
}

/* Live-preview score distribution as sliders move */
function _previewDistFromSliders() {
  const keys = ['logins','adoption','tickets','nps','csat','days','growth'];
  const pw = {};
  keys.forEach(k => { pw[k] = parseInt(el('wr-'+k)?.value||0); });
  renderScoreDistribution(pw);
}

function updateTotalBar() {
  const keys = ['logins','adoption','tickets','nps','csat','days','growth'];
  const total = keys.reduce((s,k) => s + parseInt(el('wr-'+k)?.value||0), 0);
  const fill  = el('total-fill');
  const lbl   = el('total-label');
  fill.style.width      = Math.min(total,100) + '%';
  fill.style.background = total===100 ? 'var(--green)' : total>100 ? 'var(--red)' : 'var(--amber)';
  lbl.textContent       = `Total: ${total}% ${total===100?'(good)':total>100?' - over 100%':' - needs '+( 100-total)+'%'}`;
  lbl.style.color       = total===100 ? 'var(--green)' : 'var(--red)';
}

function saveWeights() {
  const keys = ['logins','adoption','tickets','nps','csat','days','growth'];
  const total = keys.reduce((s,k) => s + parseInt(el('wr-'+k)?.value||0), 0);
  if (total !== 100) { toast('Weights must total exactly 100%', 'error'); return; }
  const prev = { ...weights };
  keys.forEach(k => { weights[k] = parseInt(el('wr-'+k).value); });
  ensureGlobalWeightsProfile();   // sync profiles[0] from updated weights
  saveSettings();
  const changed = keys.filter(k => prev[k] !== weights[k]).map(k => `${WEIGHT_LABELS[k]||k}: ${prev[k]}→${weights[k]}`);
  rescoreByProfile('Global Weights');
  filterMode = 'all';

  renderCustomers();
  renderAlerts();
  renderProfiles();
  refreshProfileDropdown();
  resetEditingState();
  const wDetail = keys.map(k => `${WEIGHT_LABELS[k]||k}: ${weights[k]}%`).join(', ');
  logConfigChange('Global weights updated', wDetail);
  renderScoreDistribution();
  toast('Weights saved!', 'success');
}

function resetWeights() {
  const keys = ['logins','adoption','tickets','nps','csat','days','growth'];
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
  const keys = ['logins','adoption','tickets','nps','csat','days','growth'];
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
  const keys = ['logins','adoption','tickets','nps','csat','days','growth'];
  const total = keys.reduce((s,k) => s + parseInt(el('wr-'+k)?.value||0), 0);
  if (total !== 100) { toast('Save weights first (must total 100%)', 'error'); return; }
  let n = 0;
  const changed = [];
  customers.forEach(c => {
    const { score } = scoreWithModel(c);
    if (c.score !== score) {
      c.history = c.history || [];
      c.history.push({ score, date: new Date().toISOString(), signals: buildHistorySnapshot(c) });
      c.score  = score;
      c.status = getStatus(score);
      applyAutoStage(c);
      changed.push(c);
      n++;
    }
  });
  filterMode = 'all';

  renderCustomers();
  renderAlerts();
  if (n > 0) {
    const changedNames = changed.slice(0, 5).map(c => `${c.name} (${c.score})`).join(', ') + (changed.length > 5 ? ` +${changed.length - 5} more` : '');
    logAudit('customer_scored', null, '', { summary: `Bulk re-score: ${n} updated - ${changedNames}` });
  }
  logConfigChange(`Bulk re-score: ${n} customer${n!==1?'s':''} updated`);
  renderScoreDistribution();
  toast(`Re-scored ${n} customer${n!==1?'s':''}`, 'success');
  if (changed.length) {
    pauseSync(120000); // pause silentSync for 2 min while saves complete
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
  updateThresholdLabels();
  logConfigChange('Thresholds updated', changed.length ? changed.join(', ') : 'No changes');
  renderScoreDistribution();
  toast('Thresholds saved!', 'success');
}

// ─── EXPANSION SETTINGS ──────────────────────────────────────
function renderExpansionSettings() {
  const modeEl = el('exp-mode');
  const pctEl = el('exp-pct');
  const flatEl = el('exp-flat');
  if (!modeEl) return;
  modeEl.value = expansionConfig.mode;
  if (pctEl) pctEl.value = expansionConfig.pct;
  if (flatEl) flatEl.value = expansionConfig.flat;
  toggleExpMode(expansionConfig.mode);
}

function toggleExpMode(mode) {
  const pctRow = el('exp-pct-row');
  const flatRow = el('exp-flat-row');
  if (pctRow) pctRow.style.display = mode === 'pct' ? '' : 'none';
  if (flatRow) flatRow.style.display = mode === 'flat' ? '' : 'none';
}

function saveExpansion() {
  const mode = el('exp-mode')?.value || 'pct';
  const pct = parseFloat(el('exp-pct')?.value);
  const flat = parseFloat(el('exp-flat')?.value);
  if (mode === 'pct' && (isNaN(pct) || pct <= 0 || pct > 100)) {
    toast('Percentage must be between 1 and 100', 'error'); return;
  }
  if (mode === 'flat' && (isNaN(flat) || flat <= 0)) {
    toast('Flat amount must be greater than 0', 'error'); return;
  }
  const prev = { ...expansionConfig };
  expansionConfig.mode = mode;
  if (!isNaN(pct)) expansionConfig.pct = pct;
  if (!isNaN(flat)) expansionConfig.flat = flat;
  saveSettings();
  const expDetail = mode === 'pct' ? `${expansionConfig.pct}% of MRR` : `$${expansionConfig.flat} per account`;
  logConfigChange('Expansion estimate updated', expDetail);
  toast('Expansion settings saved!', 'success');
}

// ─── CONTACT CADENCE SETTINGS ────────────────────────────────
function renderCadenceSettings() {
  ['enterprise','mid','smb'].forEach(t => {
    const wEl = el('cad-' + t + '-warn');
    const oEl = el('cad-' + t + '-overdue');
    if (wEl) wEl.value = cadenceConfig[t].warn;
    if (oEl) oEl.value = cadenceConfig[t].overdue;
  });
}

function saveCadence() {
  const tiers = ['enterprise','mid','smb'];
  for (const t of tiers) {
    const w = parseInt(el('cad-' + t + '-warn')?.value);
    const o = parseInt(el('cad-' + t + '-overdue')?.value);
    if (isNaN(w) || isNaN(o) || w < 1 || o < 1) {
      toast('All cadence values must be positive numbers', 'error'); return;
    }
    if (w >= o) {
      toast(`${t}: "Due Soon" days must be less than "Overdue" days`, 'error'); return;
    }
  }
  tiers.forEach(t => {
    cadenceConfig[t].warn = parseInt(el('cad-' + t + '-warn').value);
    cadenceConfig[t].overdue = parseInt(el('cad-' + t + '-overdue').value);
  });
  saveSettings();
  const cadDetail = `ENT ${cadenceConfig.enterprise.warn}/${cadenceConfig.enterprise.overdue}d, MID ${cadenceConfig.mid.warn}/${cadenceConfig.mid.overdue}d, SMB ${cadenceConfig.smb.warn}/${cadenceConfig.smb.overdue}d`;
  logConfigChange('Contact cadence updated', cadDetail);
  toast('Cadence settings saved!', 'success');
}

function resetCadence() {
  cadenceConfig = JSON.parse(JSON.stringify(DEFAULT_CADENCE));
  saveSettings();
  renderCadenceSettings();
  logConfigChange('Contact cadence reset to defaults');
  toast('Cadence reset to defaults', 'warn');
}

// ─── RENEWAL WINDOWS ─────────────────────────────────────────
function renderRenewalWindows() {
  const cEl = el('rw-critical'); const wEl = el('rw-warning'); const uEl = el('rw-upcoming');
  if (cEl) cEl.value = renewalWindows.critical;
  if (wEl) wEl.value = renewalWindows.warning;
  if (uEl) uEl.value = renewalWindows.upcoming;
}

function saveRenewalWindows() {
  const c = parseInt(el('rw-critical')?.value);
  const w = parseInt(el('rw-warning')?.value);
  const u = parseInt(el('rw-upcoming')?.value);
  if ([c,w,u].some(isNaN) || c < 1 || w < 1 || u < 1) { toast('All values must be positive', 'error'); return; }
  if (!(c < w && w < u)) { toast('Must be in order: Critical < Warning < Upcoming', 'error'); return; }
  renewalWindows.critical = c; renewalWindows.warning = w; renewalWindows.upcoming = u;
  saveSettings();
  logConfigChange('Renewal windows updated', `Critical ≤${c}d, Warning ≤${w}d, Upcoming ≤${u}d`);
  toast('Renewal windows saved!', 'success');
}

function resetRenewalWindows() {
  renewalWindows = { ...DEFAULT_RENEWAL_WINDOWS };
  saveSettings(); renderRenewalWindows();
  logConfigChange('Renewal windows reset to defaults');
  toast('Renewal windows reset to defaults', 'warn');
}

// ─── QUIET ACCOUNT & MOMENTUM ────────────────────────────────
function renderMiscThresholds() {
  const qEl = el('cfg-quiet-days');
  const mEl = el('cfg-momentum-pts');
  if (qEl) qEl.value = quietDays;
  if (mEl) mEl.value = momentumPts;
}

function saveMiscThresholds() {
  const q = parseInt(el('cfg-quiet-days')?.value);
  const m = parseInt(el('cfg-momentum-pts')?.value);
  if (isNaN(q) || q < 1) { toast('Quiet account days must be positive', 'error'); return; }
  if (isNaN(m) || m < 1) { toast('Momentum threshold must be positive', 'error'); return; }
  quietDays = q; momentumPts = m;
  saveSettings();
  logConfigChange('Signal thresholds updated', `Quiet=${q}d, Momentum=±${m}pts`);
  toast('Thresholds saved!', 'success');
}

function resetMiscThresholds() {
  quietDays = DEFAULT_QUIET_DAYS; momentumPts = DEFAULT_MOMENTUM_PTS;
  saveSettings(); renderMiscThresholds();
  logConfigChange('Signal thresholds reset to defaults');
  toast('Thresholds reset to defaults', 'warn');
}

function resetThresholds() {
  thresholds = { ...DEFAULT_THRESHOLDS };
  saveSettings();
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
  // Load profile weights into sliders (preview only - no save)
  const keys = ['logins','adoption','tickets','nps','csat','days','growth'];
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
  const keys = ['logins','adoption','tickets','nps','csat','days','growth'];
  const total = keys.reduce((s,k) => s + parseInt(el('wr-'+k)?.value||0), 0);
  if (total !== 100) { toast('Weights must total 100%', 'error'); return; }
  const newWeights = {};
  keys.forEach(k => { newWeights[k] = parseInt(el('wr-'+k).value); });
  const isGlobal = p.name === 'Global Weights';
  profiles[editingProfileIdx].weights = newWeights;
  if (isGlobal) weights = { ...newWeights };
  saveSettings();
  const pDetail = keys.map(k => `${WEIGHT_LABELS[k]||k}: ${newWeights[k]}%`).join(', ');
  logConfigChange('Profile "' + p.name + '" updated', pDetail);
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
  if (!customers.length) { wrap.innerHTML = '<p style="font-size:var(--fs-base);color:var(--muted)">No customer data loaded.</p>'; return; }
  const bands = { critical: 0, risk: 0, watch: 0, healthy: 0, expand: 0 };
  customers.forEach(c => {
    const w = previewWeights || getActiveWeights(c);
    const { score } = scoreWithModel(c, w);
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
  if (!customers.length) { wrap.innerHTML = '<p style="font-size:var(--fs-base);color:var(--muted)">No customer data loaded.</p>'; return; }
  const total = customers.length;
  let stale = 0, missing = 0;
  const sigKeys = ['logins','adoption','tickets','nps','csat','days'];
  customers.forEach(c => {
    if (c.days != null && c.days >= 30) stale++;
    const miss = sigKeys.filter(s => signalOn(c, s) && (c[s] === null || c[s] === undefined));
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
      <div class="dh-row"><span>Stale Accounts (30d+)</span><span class="dh-val ${stale ? 'warn' : 'good'}">${stale ? `<a href="#" onclick="event.preventDefault();showDhDetail('stale')" style="color:inherit;text-decoration:underline;cursor:pointer">${stale} ${appIcon('warning',12)}</a>` : '0'}</span></div>
      <div class="dh-row"><span>Incomplete Signals</span><span class="dh-val ${missing ? 'warn' : 'good'}">${missing ? `<a href="#" onclick="event.preventDefault();showDhDetail('incomplete')" style="color:inherit;text-decoration:underline;cursor:pointer">${missing} ${appIcon('warning',12)}</a>` : '0'}</span></div>
      <div class="dh-row"><span>Complete Data</span><span class="dh-val good">${complete}</span></div>
    </div>
    <div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:6px">Data completeness</div>
    <div class="dh-bar"><div style="width:${pct}%"></div></div>
    <div style="font-size:var(--fs-sm);font-weight:700;margin-top:4px">${pct}%</div>`;
}

function showDhDetail(type) {
  const title = el('dh-detail-title');
  const body = el('dh-detail-body');
  if (!title || !body) return;
  const statusColors = { critical:'#ef4444', risk:'#f59e0b', watch:'#eab308', healthy:'#22c55e', expand:'#3b82f6' };
  const sigKeys = ['logins','adoption','tickets','nps','csat','days'];
  const sigLabels = { logins:'Logins/wk', adoption:'Adoption %', tickets:'Open Tickets', nps:'NPS', days:'Days Since Contact' };

  const tblStyle = 'style="min-width:0;width:100%"';

  if (type === 'stale') {
    title.textContent = 'Stale Accounts (30d+ since last contact)';
    const rows = customers.filter(c => c.days != null && c.days >= 30).sort((a,b) => (b.days||0) - (a.days||0));
    if (!rows.length) { body.innerHTML = '<p style="padding:12px;color:var(--muted)">No stale accounts found.</p>'; }
    else {
      body.innerHTML = `<table class="ct" ${tblStyle}><thead><tr><th>Customer</th><th>Score</th><th>Days</th><th>Logins/wk</th><th>Tier</th><th>MRR</th></tr></thead><tbody>${
        rows.map(c => {
          const st = getStatus(c.score);
          return `<tr>
            <td><a href="#" onclick="event.preventDefault();closeModal('dh-detail-modal');openDetail('${escHtml(c.id)}')" style="color:var(--blue);font-weight:700;text-decoration:none">${escHtml(c.name)}</a></td>
            <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColors[st]||'#888'};margin-right:4px"></span>${c.score}</td>
            <td style="font-weight:600;color:${c.days != null && c.days>=60?'#ef4444':c.days != null && c.days>=30?'#f59e0b':'inherit'}">${c.days != null ? c.days+'d' : 'N/A'}</td>
            <td>${c.logins != null ? c.logins : 'N/A'}</td>
            <td style="text-transform:uppercase;font-size:var(--fs-sm)">${escHtml(c.tier)}</td>
            <td>$${fmtNum(c.mrr||0)}</td>
          </tr>`;
        }).join('')
      }</tbody></table>`;
    }
  } else if (type === 'incomplete') {
    title.textContent = 'Incomplete Signals (2+ missing)';
    const rows = [];
    customers.forEach(c => {
      const miss = sigKeys.filter(s => signalOn(c, s) && (c[s] === null || c[s] === undefined));
      if (miss.length >= 2) rows.push({ c, miss });
    });
    rows.sort((a,b) => b.miss.length - a.miss.length);
    if (!rows.length) { body.innerHTML = '<p style="padding:12px;color:var(--muted)">No incomplete accounts found.</p>'; }
    else {
      body.innerHTML = `<table class="ct" ${tblStyle}><thead><tr><th>Customer</th><th>Score</th><th>Missing Signals</th><th>Tier</th></tr></thead><tbody>${
        rows.map(({c, miss}) => {
          const st = getStatus(c.score);
          return `<tr>
            <td><a href="#" onclick="event.preventDefault();closeModal('dh-detail-modal');openDetail('${escHtml(c.id)}')" style="color:var(--blue);font-weight:700;text-decoration:none">${escHtml(c.name)}</a></td>
            <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColors[st]||'#888'};margin-right:4px"></span>${c.score}</td>
            <td style="font-size:var(--fs-base)">${miss.map(s => `<span style="display:inline-block;background:rgba(239,68,68,.08);color:#b91c1c;padding:1px 6px;border-radius:4px;margin:1px 2px;font-size:var(--fs-sm)">${sigLabels[s]||s}</span>`).join('')}</td>
            <td style="text-transform:uppercase;font-size:var(--fs-sm)">${escHtml(c.tier)}</td>
          </tr>`;
        }).join('')
      }</tbody></table>`;
    }
  }
  openModal('dh-detail-modal');
}

function logConfigChange(action, details) {
  const hist = JSON.parse(localStorage.getItem('iqc_config_history') || '[]');
  hist.unshift({ action, details: details || '', ts: Date.now(), user: currentUser?.email || '' });
  if (hist.length > 500) hist.length = 500;
  localStorage.setItem('iqc_config_history', JSON.stringify(hist));
  renderConfigHistory();
}

function renderConfigHistory() {
  const wrap = el('cfg-change-history');
  if (!wrap) return;
  const hist = JSON.parse(localStorage.getItem('iqc_config_history') || '[]');
  if (!hist.length) {
    wrap.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:var(--fs-md)">No config changes recorded yet.</div>';
    return;
  }
  const pg = _pagGet('cfgHist');
  const slice = hist.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE);
  const pagNav = _pagHTML(hist.length, 'cfgHist', 'renderConfigHistory');
  let h = pagNav;
  h += '<table class="ct" style="width:100%;min-width:0"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr></thead><tbody>';
  slice.forEach(e => {
    const dt = new Date(e.ts);
    const time = dt.toLocaleDateString('en-US', { month:'short', day:'numeric' }) + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const user = e.user ? escHtml(e.user) : '<span style="color:var(--subtle)"> -</span>';
    const detail = e.details ? escHtml(e.details) : '<span style="color:var(--subtle)"> -</span>';
    h += `<tr>
      <td style="font-size:var(--fs-sm);color:var(--muted);white-space:nowrap">${time}</td>
      <td style="font-size:var(--fs-sm);color:var(--text)">${user}</td>
      <td style="font-size:var(--fs-base);color:var(--text);font-weight:600;white-space:nowrap">${escHtml(e.action)}</td>
      <td style="font-size:var(--fs-sm);color:var(--muted);line-height:1.4">${detail}</td>
    </tr>`;
  });
  h += '</tbody></table>';
  h += pagNav;
  wrap.innerHTML = h;
}

function exportConfigHistory() {
  const hist = JSON.parse(localStorage.getItem('iqc_config_history') || '[]');
  if (!hist.length) { toast('No config history to export', 'warn'); return; }
  const hdr = 'timestamp,user,action,details';
  const rows = hist.map(e => {
    const ts = new Date(e.ts).toISOString();
    const csvEsc = v => '"' + String(v || '').replace(/"/g, '""') + '"';
    return [ts, csvEsc(e.user), csvEsc(e.action), csvEsc(e.details)].join(',');
  });
  const csv = hdr + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'config_history_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
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
  
    renderCustomers();
    renderAlerts();
    toast('All settings reset to defaults', 'warn');
  });
}

// ─── MANAGE CSMs ─────────────────────────────────────────────
function renderCSMList() {
  const wrap = el('cfg-csm-list');
  if (!wrap) return;
  const mgrs = {};
  customers.filter(c => c.lifecycle !== 'churned').forEach(c => {
    const m = (c.manager || '').trim();
    if (!m) return;
    mgrs[m] = (mgrs[m] || 0) + 1;
  });
  // Include manually added CSMs that have 0 accounts
  if (window._manualCSMs) window._manualCSMs.forEach(m => { if (!mgrs[m]) mgrs[m] = 0; });
  const sorted = Object.entries(mgrs).sort((a, b) => a[0].localeCompare(b[0]));
  if (!sorted.length) {
    wrap.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:10px">
      <input type="text" id="add-csm-input" placeholder="New CSM name…" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:var(--r);font-size:var(--fs-sm)" onkeydown="if(event.key==='Enter')addCSM()"/>
      <button class="btn btn-sm btn-primary" onclick="addCSM()">Add</button>
    </div><p style="font-size:var(--fs-base);color:var(--muted)">No CSMs assigned yet.</p>`;
    return;
  }
  wrap.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:10px">
    <input type="text" id="add-csm-input" placeholder="New CSM name…" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:var(--r);font-size:var(--fs-sm)" onkeydown="if(event.key==='Enter')addCSM()"/>
    <button class="btn btn-sm btn-primary" onclick="addCSM()">Add</button>
  </div>` +
  '<table class="ct" style="width:100%;min-width:0"><thead><tr><th>CSM</th><th style="text-align:center">Accounts</th><th style="text-align:right"></th></tr></thead><tbody>' +
    sorted.map(([name, count]) =>
      `<tr><td style="font-weight:600">${escHtml(name)}</td><td style="text-align:center">${count}</td><td style="text-align:right"><button class="btn btn-xs btn-danger" onclick="removeCSM('${escHtml(name).replace(/'/g, "\\'")}')">Remove</button></td></tr>`
    ).join('') + '</tbody></table>';
}

function addCSM() {
  const inp = el('add-csm-input');
  if (!inp) return;
  const name = inp.value.trim();
  if (!name) { toast('Enter a CSM name', 'warn'); return; }
  // Check if already exists
  const exists = customers.some(c => (c.manager || '').trim().toLowerCase() === name.toLowerCase());
  if (exists) { toast(`"${name}" is already a CSM`, 'warn'); return; }
  // Create a placeholder - add the CSM name to the manager dropdown by assigning to no one yet
  // We store in a lightweight list so the name appears even with 0 accounts
  if (!window._manualCSMs) window._manualCSMs = [];
  if (!window._manualCSMs.includes(name)) window._manualCSMs.push(name);
  inp.value = '';
  logConfigChange(`CSM "${name}" added`);
  renderCSMList();
  refreshMgrDropdown();
  toast(`"${name}" added as a CSM`, 'success');
}

function removeCSM(name) {
  const affected = customers.filter(c => c.manager === name);
  confirmAction(`Remove "${name}"? This will unassign them from ${affected.length} customer${affected.length !== 1 ? 's' : ''}.`, () => {
    affected.forEach(c => { c.manager = ''; });
    logConfigChange(`CSM "${name}" removed`, `${affected.length} customer(s) unassigned`);
    if (affected.length) {
      pauseSync(120000);
      setLoading(true);
      Promise.all(affected.map(c => atUpdate(c).catch(() => {}))).finally(() => setLoading(false));
    }
    renderCSMList();
    refreshMgrDropdown();
    renderCustomers();
    renderHomeBase();
    toast(`"${name}" removed - ${affected.length} customer${affected.length !== 1 ? 's' : ''} unassigned`, 'success');
  });
}

function renderProfiles() {
  const wrap = el('profiles-list');
  if (!profiles.length) {
    wrap.innerHTML = '<p style="font-size:var(--fs-base);color:var(--muted)">No profiles yet.</p>';
    return;
  }
  wrap.innerHTML = profiles.map((p,i) => {
    const isGlobal = p.name === 'Global Weights';
    const isActive = i === editingProfileIdx;
    return `
    <div class="profile-row${isActive ? ' profile-active' : ''}" onclick="previewProfile(${i})">
      <div class="profile-row__name">
        ${escHtml(p.name)}
        ${isGlobal ? '<span style="font-size:var(--fs-xs);color:var(--muted);margin-left:6px;font-style:italic">default</span>' : ''}
      </div>
      <button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();editProfile(${i})">Edit</button>
      ${!isGlobal ? `<button class="btn btn-xs btn-danger" onclick="event.stopPropagation();deleteProfile(${i})">✕</button>` : ''}
    </div>`;
  }).join('');
}

// Render weight sliders inside the profile modal using the given weight values
function renderProfileModalWeights(w) {
  const keys = ['logins','adoption','tickets','nps','csat','days','growth'];
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
  const keys = ['logins','adoption','tickets','nps','csat','days','growth'];
  const total = keys.reduce((s,k) => s + parseInt(el('pm-wr-'+k)?.value||0), 0);
  // Update percentage labels next to each slider
  keys.forEach(k => {
    const pct = el('pm-wp-'+k);
    if (pct) pct.textContent = (el('pm-wr-'+k)?.value || 0) + '%';
  });
  const fill = el('pm-total-fill');
  const lbl  = el('pm-total-label');
  if (fill) { fill.style.width = Math.min(total,100)+'%'; fill.style.background = total===100?'var(--green)':total>100?'var(--red)':'var(--amber)'; }
  if (lbl)  { lbl.textContent = `Total: ${total}% ${total===100?'(good)':total>100?' - over 100%':' - needs '+(100-total)+'%'}`; lbl.style.color = total===100?'var(--green)':'var(--red)'; }
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
  // Duplicate name check - ignore the profile being edited itself
  const duplicate = profiles.some((p, i) => p.name.toLowerCase() === name.toLowerCase() && i !== editIdx);
  if (duplicate) { toast(`A profile named "${name}" already exists`, 'error'); return; }

  const keys  = ['logins','adoption','tickets','nps','csat','days','growth'];
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
    const keys = ['logins','adoption','tickets','nps','csat','days','growth'];
    const changed = keys.filter(k => (oldWeights[k]||0) !== profileWeights[k]).map(k => `${WEIGHT_LABELS[k]||k}: ${oldWeights[k]||0}→${profileWeights[k]}`);
    logConfigChange(`Profile "${name}" updated`, changed.length ? changed.join(', ') : 'No changes');
    toast(`Profile "${name}" updated`, 'success');
    // Rescore all customers assigned to this profile (or all unassigned for Global Weights)
    rescoreByProfile(name);
  } else {
    profiles.push({ name, weights: profileWeights });
    const pKeys = ['logins','adoption','tickets','nps','csat','days','growth'];
    const pDetail = pKeys.map(k => `${WEIGHT_LABELS[k]||k}: ${profileWeights[k]}%`).join(', ');
    logConfigChange(`Profile "${name}" created`, pDetail);
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
    const { score } = scoreWithModel(c, prof.weights);
    if (c.score !== score) {
      c.history = c.history || [];
      c.history.push({ score, date: new Date().toISOString(), signals: buildHistorySnapshot(c) });
      c.score  = score;
      c.status = getStatus(score);
      applyAutoStage(c);
      changed.push(c);
    }
  });
  if (changed.length) {
    pauseSync(120000); // pause silentSync for 2 min while saves complete
    renderHomeBase(); renderCustomers(); renderAlerts();
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
  logConfigChange(`Loaded profile "${p.name}" as global weights`);
  renderWeightRows();

  renderCustomers();
  toast(`Loaded profile: ${p.name}`, 'success');
}

function deleteProfile(idx) {
  const name = profiles[idx]?.name;
  profiles.splice(idx,1);
  saveSettings();
  renderProfiles();
  refreshProfileDropdown();
  logConfigChange(`Profile "${name}" deleted`);
  toast(`Profile "${name}" deleted`, 'warn');
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
  logConfigChange('Backup exported', `${customers.length} customers`);
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
          logConfigChange('Backup restored', `From ${fmtDate(data.exported)} (${data.customers.length} customers)`);
          logConfigChange('Backup restored from file');
        
          renderSettings();
        } catch(err) {
          toast('Restore finished - some records may not have synced', 'warn');
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
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtDate(iso) {
  if (!iso) return ' -';
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

  logConfigChange('Password changed');
  toast('Password updated successfully!', 'success');
}

// ─── iQcadence SIGNAL MODEL SETTINGS ───────────────────────
function toggleSignalModel(enabled) {
  signalModelCfg.enabled = enabled;
  var wrap = el('cfg-sm-sensitivity-wrap');
  if (wrap) wrap.style.display = enabled ? '' : 'none';
  saveSettings();
  renderSignalModelPreview();
  logConfigChange('Signal Model ' + (enabled ? 'enabled' : 'disabled'));
  rescoreAllWithModel();
  renderScoreDistribution();
}

function setSmSensitivity(level) {
  signalModelCfg.sensitivity = level;
  document.querySelectorAll('.sm-sens-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.sens === level);
  });
  var desc = { conservative: 'Max adjustment: \u00b15 pts', balanced: 'Max adjustment: \u00b110 pts', aggressive: 'Max adjustment: \u00b115 pts' };
  var descEl = el('cfg-sm-sens-desc');
  if (descEl) descEl.textContent = desc[level] || desc.balanced;
  saveSettings();
  logConfigChange('Signal Model sensitivity', level);
  rescoreAllWithModel();
  renderScoreDistribution();
}

function renderSignalModelSettings() {
  // Plan tier gating
  var section = el('cfg-sm-section');
  if (section) {
    if (hasFeature('signal_model')) {
      section.querySelector('.upgrade-overlay')?.remove();
    } else {
      section.style.position = 'relative';
      if (!section.querySelector('.upgrade-overlay')) {
        var ov = document.createElement('div');
        ov.className = 'upgrade-overlay';
        ov.style.cssText = 'position:absolute;inset:0;background:rgba(255,255,255,.85);z-index:5;display:flex;align-items:center;justify-content:center;border-radius:14px';
        ov.innerHTML = upgradeHTML('signal_model');
        section.appendChild(ov);
      }
    }
  }
  var cb = el('cfg-sm-enabled');
  if (cb) cb.checked = signalModelCfg.enabled;
  var wrap = el('cfg-sm-sensitivity-wrap');
  if (wrap) wrap.style.display = signalModelCfg.enabled ? '' : 'none';
  document.querySelectorAll('.sm-sens-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.sens === signalModelCfg.sensitivity);
  });
  var desc = { conservative: 'Max adjustment: \u00b15 pts', balanced: 'Max adjustment: \u00b110 pts', aggressive: 'Max adjustment: \u00b115 pts' };
  var descEl = el('cfg-sm-sens-desc');
  if (descEl) descEl.textContent = desc[signalModelCfg.sensitivity] || desc.balanced;
  renderSignalModelPreview();
}

function renderSignalModelPreview() {
  var wrap = el('cfg-sm-cats');
  if (!wrap) return;
  var cats = [
    { label: 'Engagement & Usage',         count: 5, icon: appIcon('chartBar', 14) },
    { label: 'Revenue & Growth',            count: 4, icon: appIcon('trendUp', 14) },
    { label: 'Relationship & Stakeholder',  count: 4, icon: appIcon('users', 14) },
    { label: 'Support & Sentiment',         count: 4, icon: appIcon('clipboard', 14) },
    { label: 'Lifecycle & Timing',          count: 5, icon: appIcon('calendar', 14) },
    { label: 'Compound / Interaction',      count: 4, icon: appIcon('sparkle', 14) },
  ];
  wrap.innerHTML = cats.map(function(cat) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">' +
      '<span style="color:#0f766e">' + cat.icon + '</span>' +
      '<span style="flex:1;font-size:var(--fs-base)">' + cat.label + '</span>' +
      '<span style="font-size:var(--fs-xs);color:var(--muted)">' + cat.count + ' factors</span></div>';
  }).join('');
}

function rescoreAllWithModel() {
  var changed = [];
  customers.forEach(function(c) {
    if (c.lifecycle === 'churned') return;
    var result = scoreWithModel(c);
    if (c.score !== result.score) {
      c.history = c.history || [];
      c.history.push({ score: result.score, date: new Date().toISOString(), signals: buildHistorySnapshot(c) });
      c.score = result.score;
      c.status = getStatus(result.score);
      applyAutoStage(c);
      changed.push(c);
    }
  });
  if (changed.length) {
    renderHomeBase(); renderCustomers(); renderAlerts(); renderScoreDistribution();
    toast('Re-scored ' + changed.length + ' customer' + (changed.length !== 1 ? 's' : '') + ' with Signal Model', 'success');
    setLoading(true);
    Promise.all(changed.map(function(c) { return atUpdate(c).catch(function(){}); })).finally(function() { setLoading(false); });
  }
}

// ─── SETTINGS ───────────────────────────────────────────────
function cfgTab(which) {
  ['config','account','api'].forEach(t => {
    el('cfg-tab-'+t)?.classList.toggle('active', t === which);
    el('cfg-pane-'+t)?.classList.toggle('active', t === which);
  });
  if (which === 'api') {
    if (!hasFeature('api_webhooks')) {
      const pane = el('cfg-pane-api');
      if (pane) pane.innerHTML = upgradeHTML('api_webhooks');
      return;
    }
    renderIntegrationsSection();
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

function renderSettings() {
  // Always reset to Config tab on navigation
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
  const keys = ['logins','adoption','tickets','nps','csat','days','growth'];
  el('weight-rows').innerHTML = keys.map(k => `
    <div class="weight-row">
      <div class="weight-label">${WEIGHT_LABELS[k]}</div>
      <input type="range" min="0" max="100" value="${weights[k]}" id="wr-${k}"
        oninput="updateWeightFromSlider('${k}',this.value)" style="flex:1;cursor:pointer;accent-color:var(--blue)"/>
      <div class="weight-pct"><input type="number" min="0" max="100" value="${weights[k]}" id="wp-${k}"
        oninput="updateWeightFromInput('${k}',this.value)"
        style="width:42px;text-align:center;border:1.5px solid var(--border);border-radius:6px;padding:2px 2px;font-size:var(--fs-base);font-weight:700;font-family:var(--font);color:var(--text);outline:none;background:var(--surface);-moz-appearance:textfield"
        onfocus="this.select()"/><span style="font-size:var(--fs-base);font-weight:700;margin-left:1px">%</span></div>
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
  const keys = ['logins','adoption','tickets','nps','csat','days','growth'];
  const total = keys.reduce((s,k) => s + parseInt(el('wr-'+k)?.value||0), 0);
  const fill  = el('total-fill');
  const lbl   = el('total-label');
  fill.style.width      = Math.min(total,100) + '%';
  fill.style.background = total===100 ? 'var(--green)' : total>100 ? 'var(--red)' : 'var(--amber)';
  lbl.textContent       = `Total: ${total}% ${total===100?'(good)':total>100?'— over 100%':'— needs '+( 100-total)+'%'}`;
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
  logAudit('weights_updated', null, '', { summary: `Global weights changed: ${changed.join(', ')}`, weights: { ...weights } });
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
    const profileMatch = c.scoring_profile ? profiles.find(p => p.name === c.scoring_profile) : null;
    const resolvedWeights = profileMatch ? profileMatch.weights : weights;
    const { score } = calcScore(c, resolvedWeights);
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
    logAudit('customer_scored', null, '', { summary: `Bulk re-score: ${n} updated — ${changedNames}` });
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
  logAudit('thresholds_updated', null, '', { summary: `Thresholds changed: ${changed.join(', ')}`, thresholds: { ...thresholds } });
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
  logAudit('expansion_updated', null, '', { summary: `Expansion estimate changed: mode=${mode}, pct=${expansionConfig.pct}%, flat=$${expansionConfig.flat}`, expansion: { ...expansionConfig } });
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
  logAudit('cadence_updated', null, '', { summary: `Contact cadence updated: ENT ${cadenceConfig.enterprise.warn}/${cadenceConfig.enterprise.overdue}d, MID ${cadenceConfig.mid.warn}/${cadenceConfig.mid.overdue}d, SMB ${cadenceConfig.smb.warn}/${cadenceConfig.smb.overdue}d`, cadence: JSON.parse(JSON.stringify(cadenceConfig)) });
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
  logAudit('renewal_windows_updated', null, '', { summary: `Renewal windows: critical=${c}d, warning=${w}d, upcoming=${u}d` });
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
  logAudit('misc_thresholds_updated', null, '', { summary: `Quiet days=${q}, Momentum sensitivity=±${m} pts` });
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
  logAudit('profile_updated', null, '', { summary: `Profile "${p.name}" updated via slider`, profile: p.name, weights: newWeights });
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
  if (!customers.length) { wrap.innerHTML = '<p style="font-size:var(--fs-base);color:var(--muted)">No customer data loaded.</p>'; return; }
  const total = customers.length;
  let stale = 0, missing = 0;
  const sigKeys = ['logins','adoption','tickets','nps','csat','days'];
  customers.forEach(c => {
    if (c.days != null && c.days >= 30) stale++;
    const miss = sigKeys.filter(s => c[s] === null || c[s] === undefined);
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
      const miss = sigKeys.filter(s => c[s] === null || c[s] === undefined);
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
    const user = e.user ? escHtml(e.user) : '<span style="color:var(--subtle)">—</span>';
    const detail = e.details ? escHtml(e.details) : '<span style="color:var(--subtle)">—</span>';
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
  
    renderCustomers();
    renderAlerts();
    toast('All settings reset to defaults', 'warn');
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
    logAudit('profile_updated', null, '', { summary: `Profile "${name}" updated${changed.length ? ': ' + changed.join(', ') : ''}`, profile: name, weights: profileWeights });
    logConfigChange(`Profile "${name}" updated`, changed.length ? changed.join(', ') : 'No changes');
    toast(`Profile "${name}" updated`, 'success');
    // Rescore all customers assigned to this profile (or all unassigned for Global Weights)
    rescoreByProfile(name);
  } else {
    profiles.push({ name, weights: profileWeights });
    logAudit('profile_created', null, '', { summary: `New scoring profile "${name}" created`, profile: name, weights: profileWeights });
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
    const { score } = calcScore(c, prof.weights);
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
  logAudit('profile_loaded', null, '', { summary: `Loaded profile "${p.name}" as global weights`, profile: p.name });
  renderWeightRows();

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
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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

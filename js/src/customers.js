// Returns true if customer passes the active manager filter
function passesManagerFilter(c) {
  if (mgrFilterAll) return true;                          // "All Managers" checked
  if (activeManagers.size === 0) return false;            // none selected = show nothing
  if (!c.manager && activeManagers.has('__unassigned__')) return true;
  return activeManagers.has(c.manager || '');
}

// Rebuild the manager dropdown from current customers list
function buildManagerSelectOptions(selectedManager) {
  const managers = [...new Set(customers.map(c => c.manager || '').filter(Boolean))].sort();
  let html = '<option value="">\u2014 Remove Manager \u2014</option>';
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
  const manualCSMs = window._manualCSMs || [];
  const managers = [...new Set([...customers.map(c => c.manager || '').filter(Boolean), ...manualCSMs])].sort();
  const wrap = document.getElementById('mgr-filter-wrap');
  if (!wrap) return;

  // If no managers at all, clear the dropdown and hide the filter list
  if (managers.length === 0) {
    const dl = document.getElementById('manager-datalist');
    if (dl) dl.innerHTML = '';
    const list = document.getElementById('mgr-filter-list');
    if (list) list.innerHTML = '';
    const fmSelect = document.getElementById('f-manager');
    if (fmSelect && fmSelect.tagName === 'SELECT') fmSelect.innerHTML = '<option value=""> - none  -</option>';
    return;
  }

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
          ${mgrFilterAll || activeManagers.has(m) ? 'checked' : ''}>
        ${escHtml(m)}
      </label>
    </div>`).join('');

  const unassignedItem = hasUnassigned ? `
    <div class="mgr-filter__item">
      <label>
        <input type="checkbox" class="mgr-cb" value="__unassigned__"
          onchange="mgrCbChange()"
          ${mgrFilterAll || activeManagers.has('__unassigned__') ? 'checked' : ''}>
        <span style="color:var(--muted);font-style:italic">Unassigned</span>
      </label>
    </div>` : '';

  list.innerHTML = namedItems + unassignedItem;

  // Sync the "All Managers" checkbox with actual state
  const allCb = document.getElementById('mgr-all');
  if (allCb) allCb.checked = mgrFilterAll;

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
  if (!_openAlertFilterKey && !_openCrFilterKey) return;
  const menu = document.getElementById('alert-filter-portal');
  if (menu && menu.contains(e.target)) return;
  if (e.target.closest && e.target.closest('.col-filter-btn')) return;
  if (_openAlertFilterKey) closeAlertFilter();
  if (_openCrFilterKey) closeCrFilter();
});

function mgrAllToggle(cb) {
  const cbs = document.querySelectorAll('.mgr-cb');
  if (cb.checked) {
    mgrFilterAll = true;
    activeManagers.clear();
    cbs.forEach(c => c.checked = true);
  } else {
    mgrFilterAll = false;
    activeManagers.clear();
    cbs.forEach(c => c.checked = false);
  }
  updateMgrFilterLabel();
  renderHomeBase(); renderCustomers(); renderAlerts(); renderSegments(); renderCSMPerformance(); renderTrends(); renderCalendar();
}

function mgrCbChange() {
  const cbs = [...document.querySelectorAll('.mgr-cb')];
  const checked = cbs.filter(c => c.checked).map(c => c.value);
  const allCb = document.getElementById('mgr-all');
  if (checked.length === cbs.length) {
    mgrFilterAll = true;
    activeManagers.clear();
    if (allCb) allCb.checked = true;
  } else if (checked.length === 0) {
    mgrFilterAll = false;
    activeManagers.clear();
    if (allCb) allCb.checked = false;
  } else {
    mgrFilterAll = false;
    activeManagers = new Set(checked);
    if (allCb) allCb.checked = false;
  }
  updateMgrFilterLabel();
  renderHomeBase(); renderCustomers(); renderAlerts(); renderSegments(); renderCSMPerformance(); renderTrends(); renderCalendar();
}

function updateMgrFilterLabel() {
  const lbl = document.getElementById('mgr-filter-label');
  if (!lbl) return;
  if (mgrFilterAll) {
    lbl.textContent = 'All Managers';
  } else if (activeManagers.size === 0) {
    lbl.textContent = 'Select Managers…';
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
  mrrExposureFilter = null; // clear MRR drill-down when switching status chips
  insightFilter = null;     // clear insight drill-down
  _filterTier = null;       // clear tier drill-down
  _filterStage = null;      // clear stage drill-down
  _filterManager = null;    // clear CSM drill-down
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
    if (col.key === 'name') th.classList.add('col-frozen');
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
  const hasMrr = mrrExposureFilter && mrrExposureFilter.ids;
  const hasInsight = insightFilter && insightFilter.ids;
  const hasTier = !!_filterTier;
  const hasStage = !!_filterStage;
  const hasManager = !!_filterManager;
  if (!keys.length && !hasMrr && !hasInsight && !hasTier && !hasStage && !hasManager) { bar.style.display = 'none'; return; }

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
    /* date filters use gt/lt/eq/between - handled by those branches above */
    else if (f.type === 'up')      { summary = 'Improving this week'; }
    else if (f.type === 'down')    { summary = 'Declining this week'; }

    return `<span class="filter-pill" onclick="openColFilterFromPill('${key}',this)">${label}: ${summary}<button class="filter-pill-x" onclick="event.stopPropagation();clearColFilter('${key}')" title="Remove filter">✕</button></span>`;
  }).join('');

  // MRR Exposure pill
  if (hasMrr) {
    bar.innerHTML = `<span class="filter-pill" style="background:rgba(99,102,241,.25);border-color:rgba(99,102,241,.5)">MRR Exposure: ${mrrExposureFilter.label}<button class="filter-pill-x" onclick="event.stopPropagation();clearMrrExposureFilter()" title="Remove filter">✕</button></span>` + bar.innerHTML;
  }
  // Insight filter pill
  if (insightFilter && insightFilter.ids) {
    bar.innerHTML = `<span class="filter-pill" style="background:rgba(99,102,241,.15);border-color:rgba(99,102,241,.4)">Insight: ${escHtml(insightFilter.label)}<button class="filter-pill-x" onclick="event.stopPropagation();clearInsightFilter()" title="Remove filter">✕</button></span>` + bar.innerHTML;
  }
  // Tier filter pill
  if (_filterTier) {
    const tierLabel = _filterTier === 'enterprise' ? 'Enterprise' : _filterTier === 'mid' ? 'Mid-Market' : 'SMB';
    bar.innerHTML = `<span class="filter-pill" style="background:rgba(99,102,241,.15);border-color:rgba(99,102,241,.4)">Tier: ${tierLabel}<button class="filter-pill-x" onclick="event.stopPropagation();clearTierFilter()" title="Remove filter">✕</button></span>` + bar.innerHTML;
  }
  // Stage filter pill
  if (_filterStage) {
    const stageLabels = { onboarding:'Onboarding', active:'Active', atrisk:'At Risk', won:'Won / Upsold', churned:'Churned' };
    const stageLabel = stageLabels[_filterStage] || _filterStage;
    bar.innerHTML = `<span class="filter-pill" style="background:rgba(99,102,241,.15);border-color:rgba(99,102,241,.4)">Stage: ${stageLabel}<button class="filter-pill-x" onclick="event.stopPropagation();clearStageFilter()" title="Remove filter">✕</button></span>` + bar.innerHTML;
  }
  // CSM filter pill
  if (_filterManager) {
    bar.innerHTML = `<span class="filter-pill" style="background:rgba(16,185,129,.15);border-color:rgba(16,185,129,.4)">CSM: ${escHtml(_filterManager)}<button class="filter-pill-x" onclick="event.stopPropagation();clearManagerFilter()" title="Remove filter">✕</button></span>` + bar.innerHTML;
  }

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
  } else if (col.ftype === 'date') {
    body = `
      <div class="cff-radio-group">
        <label class="cff-radio"><input type="radio" name="cfop" value="gt" onchange="cfOpChange()"> After</label>
        <label class="cff-radio"><input type="radio" name="cfop" value="lt" onchange="cfOpChange()"> Before</label>
        <label class="cff-radio"><input type="radio" name="cfop" value="eq" onchange="cfOpChange()"> Exactly</label>
        <label class="cff-radio"><input type="radio" name="cfop" value="between" onchange="cfOpChange()"> Between</label>
      </div>
      <div class="cff-inputs">
        <input class="cff-date-input" id="cf-val" type="date" onchange="applyColFilterLive()">
        <span class="cff-between-sep" id="cf-sep" style="display:none">and</span>
        <input class="cff-date-input" id="cf-val2" type="date" style="display:none" onchange="applyColFilterLive()">
      </div>`;
  } else if (col.ftype === 'tenure') {
    body = `
      <div class="cff-radio-group">
        <label class="cff-radio"><input type="radio" name="cfop" value="gt" onchange="cfOpChange()"> More than</label>
        <label class="cff-radio"><input type="radio" name="cfop" value="lt" onchange="cfOpChange()"> Less than</label>
        <label class="cff-radio"><input type="radio" name="cfop" value="eq" onchange="cfOpChange()"> Exactly</label>
        <label class="cff-radio"><input type="radio" name="cfop" value="between" onchange="cfOpChange()"> Between</label>
      </div>
      <div class="cff-inputs">
        <div style="display:flex;gap:6px;align-items:center">
          <input class="cff-num-input" id="cf-tenure-y" type="number" min="0" placeholder="0" style="width:50px" oninput="applyColFilterLive()"><span style="font-size:var(--fs-sm);color:var(--muted)">yr</span>
          <input class="cff-num-input" id="cf-tenure-m" type="number" min="0" max="11" placeholder="0" style="width:50px" oninput="applyColFilterLive()"><span style="font-size:var(--fs-sm);color:var(--muted)">mo</span>
        </div>
        <div id="cf-tenure-row2" style="display:none;margin-top:6px">
          <span style="font-size:var(--fs-sm);color:var(--muted);display:block;margin-bottom:4px">and</span>
          <div style="display:flex;gap:6px;align-items:center">
            <input class="cff-num-input" id="cf-tenure-y2" type="number" min="0" placeholder="0" style="width:50px" oninput="applyColFilterLive()"><span style="font-size:var(--fs-sm);color:var(--muted)">yr</span>
            <input class="cff-num-input" id="cf-tenure-m2" type="number" min="0" max="11" placeholder="0" style="width:50px" oninput="applyColFilterLive()"><span style="font-size:var(--fs-sm);color:var(--muted)">mo</span>
          </div>
        </div>
      </div>`;
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
  // Tenure between fields
  const row2 = document.getElementById('cf-tenure-row2');
  if (row2) row2.style.display = btw ? '' : 'none';
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
  } else if (col.ftype === 'date') {
    const radio = document.querySelector(`input[name="cfop"][value="${f.type}"]`);
    if (radio) { radio.checked = true; cfOpChange(); }
    const v1 = document.getElementById('cf-val');
    const v2 = document.getElementById('cf-val2');
    if (v1) v1.value = (f.type === 'between' ? f.min : f.val) ?? '';
    if (v2 && f.max != null) v2.value = f.max;
  } else if (col.ftype === 'tenure') {
    const radio = document.querySelector(`input[name="cfop"][value="${f.type}"]`);
    if (radio) { radio.checked = true; cfOpChange(); }
    const val = f.type === 'between' ? f.min : f.val;
    if (val != null) {
      const ey = document.getElementById('cf-tenure-y'); if (ey) ey.value = Math.floor(val / 12) || '';
      const em = document.getElementById('cf-tenure-m'); if (em) em.value = val % 12 || '';
    }
    if (f.type === 'between' && f.max != null) {
      const ey2 = document.getElementById('cf-tenure-y2'); if (ey2) ey2.value = Math.floor(f.max / 12) || '';
      const em2 = document.getElementById('cf-tenure-m2'); if (em2) em2.value = f.max % 12 || '';
    }
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
  } else if (col.ftype === 'date') {
    const op = document.querySelector('input[name="cfop"]:checked')?.value;
    const v1 = document.getElementById('cf-val')?.value || '';
    const v2 = document.getElementById('cf-val2')?.value || '';
    if (!op || !v1) { delete columnFilters[key]; }
    else if (op === 'between') {
      if (v2) columnFilters[key] = { type:'between', min:v1, max:v2 };
      else delete columnFilters[key];
    } else {
      columnFilters[key] = { type:op, val:v1 };
    }
  } else if (col.ftype === 'enum') {
    const checked = [...document.querySelectorAll('.cf-enum-cb:checked')].map(cb => cb.value);
    if (checked.length) columnFilters[key] = { type:'enum', vals: new Set(checked) };
    else delete columnFilters[key];
  } else if (col.ftype === 'tenure') {
    const op = document.querySelector('input[name="cfop"]:checked')?.value;
    const y1 = parseInt(document.getElementById('cf-tenure-y')?.value) || 0;
    const m1 = parseInt(document.getElementById('cf-tenure-m')?.value) || 0;
    const months1 = y1 * 12 + m1;
    if (!op || months1 === 0) { delete columnFilters[key]; }
    else if (op === 'between') {
      const y2 = parseInt(document.getElementById('cf-tenure-y2')?.value) || 0;
      const m2 = parseInt(document.getElementById('cf-tenure-m2')?.value) || 0;
      const months2 = y2 * 12 + m2;
      if (months2 > 0) columnFilters[key] = { type:'between', min:months1, max:months2 };
      else delete columnFilters[key];
    } else {
      columnFilters[key] = { type:op, val:months1 };
    }
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
        case 'created': {
          const cd = c.created ? new Date(c.created).toISOString().slice(0,10) : '';
          if (!cd) return false;
          if (f.type === 'gt')      { if (!(cd > f.val))              return false; }
          else if (f.type === 'lt') { if (!(cd < f.val))              return false; }
          else if (f.type === 'eq') { if (cd !== f.val)               return false; }
          else if (f.type === 'between') { if (cd < f.min || cd > f.max) return false; }
          continue;
        }
        case 'tickets':  v = c.tickets != null ? c.tickets : 0; break;
        case 'nps':      v = c.nps != null ? c.nps : -1; break;
        case 'csat':     v = c.csat != null ? c.csat : -1; break;
        case 'logins':   v = c.logins != null ? c.logins : -1; break;
        case 'adoption': v = c.adoption != null ? c.adoption : -1; break;
        case 'growth':   v = c.growth || 'none'; break;
        case 'days':    v = c.days != null ? c.days : 999; break;
        case 'renewal': {
          if (c.renewal_date) { v = Math.round((new Date(c.renewal_date) - new Date()) / 86400000); }
          else if (c.renewal > 0) { v = c.renewal * 30; }
          else { v = 9999; }
          break;
        }
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
          continue; // handled inline - skip v-based checks below
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
    if (bulkBar)    { bulkBar.classList.remove('show'); bulkBar.style.display = ''; }
    renderTrash();
    return;
  }
  if (trashWrap) trashWrap.style.display = 'none';
  if (tableCard) tableCard.style.display = '';
  if (bulkBar)   bulkBar.style.display = '';  // clear any inline override from trash mode

  const q = (el('search-input') ? el('search-input').value.toLowerCase() : '');
  let list = customers.filter(c => {
    if (filterMode === 'churned') return c.lifecycle === 'churned';
    if (filterMode === 'all')    return c.lifecycle !== 'churned';
    return c.status === filterMode && c.lifecycle !== 'churned';
  }).filter(c => passesManagerFilter(c)).filter(c => {
    if (_filterTier && c.tier !== _filterTier) return false;
    if (_filterStage && (c.lifecycle || 'active') !== _filterStage) return false;
    if (_filterManager && (c.manager || '').trim() !== _filterManager) return false;
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || (c.tags||[]).some(t=>t.toLowerCase().includes(q));
  });

  // MRR Exposure click-through filter
  if (mrrExposureFilter && mrrExposureFilter.ids) {
    list = list.filter(c => mrrExposureFilter.ids.has(c.id));
  }
  // Insight click-through filter
  if (insightFilter && insightFilter.ids) {
    list = list.filter(c => insightFilter.ids.has(c.id));
  }

  // Column filters (stack on top of global filters)
  list = applyColumnFilters(list);

  // Sort
  list.sort((a,b) => {
    let av = sortKey==='_delta'?getDelta7d(a): sortKey==='_momentum'?getDelta7d(a): sortKey==='status'?(a.status||''): sortKey==='lifecycle'?(a.lifecycle||''): sortKey==='tags'?(a.tags||[]).join(', '): sortKey==='name'?a.name: sortKey==='manager'?(a.manager||'zzz'): sortKey==='profile'?(a.scoring_profile||'zzz'): sortKey==='score'?a.score: sortKey==='mrr'?a.mrr||0: sortKey==='arr'?(a.arr||(a.mrr*12)||0): sortKey==='since'?(a.since||'9999'): sortKey==='created'?(a.created||'9999'): sortKey==='days'?(a.days != null ? a.days : 999): sortKey==='nps'?(a.nps != null ? a.nps : -1): sortKey==='csat'?(a.csat != null ? a.csat : -1): sortKey==='logins'?(a.logins != null ? a.logins : -1): sortKey==='adoption'?(a.adoption != null ? a.adoption : -1): sortKey==='growth'?(a.growth||'zzz'): sortKey==='renewal'?a.renewal||99: sortKey==='next_touch'?(a.next_touch||'9999'):0;
    let bv = sortKey==='_delta'?getDelta7d(b): sortKey==='_momentum'?getDelta7d(b): sortKey==='status'?(b.status||''): sortKey==='lifecycle'?(b.lifecycle||''): sortKey==='tags'?(b.tags||[]).join(', '): sortKey==='name'?b.name: sortKey==='manager'?(b.manager||'zzz'): sortKey==='profile'?(b.scoring_profile||'zzz'): sortKey==='score'?b.score: sortKey==='mrr'?b.mrr||0: sortKey==='arr'?(b.arr||(b.mrr*12)||0): sortKey==='since'?(b.since||'9999'): sortKey==='created'?(b.created||'9999'): sortKey==='days'?(b.days != null ? b.days : 999): sortKey==='nps'?(b.nps != null ? b.nps : -1): sortKey==='csat'?(b.csat != null ? b.csat : -1): sortKey==='logins'?(b.logins != null ? b.logins : -1): sortKey==='adoption'?(b.adoption != null ? b.adoption : -1): sortKey==='growth'?(b.growth||'zzz'): sortKey==='renewal'?b.renewal||99: sortKey==='next_touch'?(b.next_touch||'9999'):0;
    if (typeof av === 'string') return av.localeCompare(bv) * sortDir;
    return (av - bv) * sortDir;
  });

  // Cache visible IDs in display order for shift-click range selection
  _visibleIds = list.map(c => c.id);

  const lbl = el('cust-count-lbl');
  if (lbl) lbl.textContent = `${list.length} customer${list.length!==1?'s':''}`;

  const tbody = el('cust-tbody');
  const table = el('cust-table');
  const empty = el('cust-empty');

  if (!list.length) {
    if (!customers.length || (filterMode !== 'all' && filterMode !== 'churned' && !customers.some(c => c.status === filterMode && c.lifecycle !== 'churned'))) {
      // Truly no customers - show onboarding empty state
      empty.style.display = 'block';
      table.style.display = 'none';
    } else {
      // Filters produced 0 results - keep headers, show message in tbody
      empty.style.display = 'none';
      table.style.display = '';
      const hasFilters = Object.keys(columnFilters).length > 0;
      tbody.innerHTML = `<tr><td colspan="20" style="text-align:center;padding:32px 16px;color:var(--muted);font-size:var(--fs-md)">
        <div style="margin-bottom:6px">No matching customers</div>
        ${hasFilters ? '<div style="font-size:var(--fs-sm)">Try adjusting or clearing your filters</div>' : ''}
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
        <td class="cb-col"><input type="checkbox" ${isSel?'checked':''} onclick="event.stopPropagation();toggleSelect('${escHtml(c.id)}',this.checked,event)"/></td>
        <td class="col-frozen" style="cursor:pointer" onclick="openDetail('${escHtml(c.id)}')"><strong>${escHtml(c.name)}</strong>${(()=>{ if (!c.next_touch) return ''; const ntd = Math.round((new Date(c.next_touch)-new Date())/86400000); return ntd < 0 ? ' <span class="nt-badge nt-overdue" style="font-size:var(--fs-xs);padding:1px 5px">Touch overdue</span>' : ''; })()}</td>
        <td>${c.manager ? escHtml(c.manager) : '<span style="color:var(--muted);font-style:italic"> -</span>'}</td>
        <td>${c.scoring_profile && c.scoring_profile !== 'Global Weights' ? `<span class="tag">${escHtml(c.scoring_profile)}</span>` : '<span style="color:var(--muted);font-style:italic;font-size:var(--fs-sm)">Global</span>'}</td>
        <td>${scoreHTML(c)}</td>
        <td>${momentumHTML(c)}</td>
        <td>${badgeHTML(c.status)}</td>
        <td>${lifecycleBadge(c.lifecycle)}</td>
        <td>${c.mrr ? '$'+fmtNum(c.mrr) : ' -'}</td>
        <td>${(()=>{ const arr = c.arr || (c.mrr * 12); return arr ? '$'+fmtNum(arr) : ' -'; })()}</td>
        <td>${(()=>{
          if (!c.since) return ' -';
          const ms = new Date() - new Date(c.since);
          const months = Math.floor(ms / (1000*60*60*24*30.44));
          if (months < 1)  return 'New';
          if (months < 12) return months + 'mo';
          const yrs = Math.floor(months/12), rem = months%12;
          return rem ? `${yrs}y ${rem}mo` : `${yrs}y`;
        })()}</td>
        <td>${c.tickets ? `<span style="font-weight:600${c.tickets >= 3 ? ';color:#dc2626' : c.tickets >= 1 ? ';color:#d97706' : ''}">${c.tickets}</span>` : '<span style="color:var(--muted)">0</span>'}</td>
        <td><div class="ct-two-line"><span class="${cad.cls}">${cad.label.replace(/\s*\(\d+d\)/,'')}</span><span class="ct-sub">${c.days != null ? c.days + 'd ago' : 'N/A'}</span></div></td>
        <td>${(()=>{
          if (c.renewal_date) {
            const d = new Date(c.renewal_date);
            const today = new Date(); today.setHours(0,0,0,0);
            const days = Math.round((d - today) / 86400000);
            if (days < 0) return `<span style="color:#dc2626;font-weight:700">${days}d</span>`;
            if (days === 0) return `<span style="color:#dc2626;font-weight:700">Today</span>`;
            if (days <= 30) return `<span style="color:#ea580c;font-weight:700">${days}d</span>`;
            if (days <= 90) return `<span style="color:#d97706;font-weight:700">${days}d</span>`;
            return `<span style="color:var(--muted)">${days}d</span>`;
          }
          if (c.renewal != null && c.renewal > 0) { const d = c.renewal * 30; return `<span style="color:${d<=30?'#ea580c':d<=90?'#d97706':'var(--muted)'};font-weight:600">~${d}d</span>`; }
          return ' -';
        })()}</td>
        <td class="nt-cell" onclick="event.stopPropagation();openInlineNextTouch('${escHtml(c.id)}',this)">${(()=>{
          if (!c.next_touch) return '<span class="nt-inline-empty">+ Schedule</span>';
          const d = new Date(c.next_touch);
          const today = new Date(); today.setHours(0,0,0,0);
          const ntd = Math.round((d - today) / 86400000);
          const dateStr = d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
          if (ntd < 0)  return `<span class="nt-badge nt-overdue">${dateStr}</span>`;
          if (ntd === 0) return `<span class="nt-badge nt-today">Today</span>`;
          if (ntd <= 7)  return `<span class="nt-badge nt-ok">${dateStr}</span>`;
          return `<span style="font-size:var(--fs-sm);color:var(--muted)">${dateStr}</span>`;
        })()}</td>
        <td>${((tags) => {
          if (!tags.length) return '';
          const first = `<span class="tag">${escHtml(tags[0])}</span>`;
          if (tags.length === 1) return first;
          const allTags = tags.map(t => escHtml(t)).join(', ');
          return first + `<span class="tag tag-more" title="${allTags}">+${tags.length - 1}</span>`;
        })(c.tags||[])}</td>
        <td>${(()=>{
          if (!c.created) return ' -';
          const d = new Date(c.created);
          return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
        })()}</td>
        <td>${c.nps != null ? c.nps : '<span style="color:var(--muted)"> -</span>'}</td>
        <td>${c.csat != null ? c.csat : '<span style="color:var(--muted)"> -</span>'}</td>
        <td>${c.logins != null ? c.logins : '<span style="color:var(--muted)"> -</span>'}</td>
        <td>${c.adoption != null ? c.adoption + '%' : '<span style="color:var(--muted)"> -</span>'}</td>
        <td>${(()=>{
          const g = c.growth || 'none';
          if (g === 'strong') return '<span style="color:#16a34a;font-weight:600">Strong</span>';
          if (g === 'mild') return '<span style="color:#d97706;font-weight:600">Mild</span>';
          return '<span style="color:var(--muted)">None</span>';
        })()}</td>
      </tr>`;
  }).join('');

  // Sync top scrollbar width and visibility
  _syncTopScrollbar();
}

// ─── TOP SCROLLBAR SYNC ─────────────────────────────────────
let _topScrollSyncing = false;
function _syncTopScrollbar() {
  // Double rAF to ensure browser has fully laid out the table
  requestAnimationFrame(() => { requestAnimationFrame(() => { _syncTopScrollbarNow(); }); });
}
function _syncTopScrollbarNow() {
  const wrap = el('cust-scroll-wrap');
  const top  = el('cust-top-scroll');
  const inner = el('cust-top-scroll-inner');
  const tbl  = el('cust-table');
  if (!wrap || !top || !inner || !tbl) return;

  // Always show if table is visible; set inner width to match table's full width
  const tw = tbl.offsetWidth;
  const ww = wrap.offsetWidth;
  console.log('[TopScroll] table offsetWidth=' + tw + ' wrap offsetWidth=' + ww + ' wrap.scrollWidth=' + wrap.scrollWidth + ' wrap.clientWidth=' + wrap.clientWidth);
  inner.style.width = tw + 'px';
  if (tw > ww) {
    top.style.display = 'block';
    top.style.overflowX = 'auto';
  } else {
    top.style.display = 'none';
  }

  // Bidirectional scroll sync (avoid infinite loop with flag)
  if (!top._synced) {
    top._synced = true;
    top.addEventListener('scroll', () => {
      if (_topScrollSyncing) return;
      _topScrollSyncing = true;
      wrap.scrollLeft = top.scrollLeft;
      _topScrollSyncing = false;
    });
    wrap.addEventListener('scroll', () => {
      if (_topScrollSyncing) return;
      _topScrollSyncing = true;
      top.scrollLeft = wrap.scrollLeft;
      _topScrollSyncing = false;
    });
    // Re-sync on window resize
    window.addEventListener('resize', () => { _syncTopScrollbarNow(); });
  }
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
      ${c.next_touch ? `<button class="btn btn-ghost btn-xs" onclick="saveInlineNextTouch('${escHtml(custId)}','');this.closest('.nt-inline-picker').remove()">Clear</button>` : ''}
      <button class="btn btn-ghost btn-xs" onclick="this.closest('.nt-inline-picker').remove()">Cancel</button>
      <button class="btn btn-primary btn-xs" onclick="saveInlineNextTouch('${escHtml(custId)}',document.getElementById('nt-pick-date').value);this.closest('.nt-inline-picker').remove()">Save</button>
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

  // Archive old next_touch to touch_history only if it's in the past (actually happened)
  if (oldVal) {
    const oldDate = new Date(oldVal);
    const today = new Date(); today.setHours(0,0,0,0);
    if (oldDate <= today) {
      if (!c.touch_history) c.touch_history = [];
      c.touch_history.push({ date: oldVal, status: 'completed', time: c.next_touch_time || '' });
      c.last_contact_date = oldVal;
    }
  }

  c.next_touch = val || '';
  // Recalculate days from last_contact_date if it exists
  if (c.last_contact_date) {
    const [_y,_m,_d] = c.last_contact_date.split('-').map(Number);
    const lcd = new Date(_y, _m-1, _d);
    if (!isNaN(lcd.getTime())) {
      const daysSince = Math.max(0, Math.floor((Date.now() - lcd.getTime()) / 86400000));
      c.days = daysSince;
      c._baseDays = daysSince;
    }
  }

  // Persist to Supabase
  const row = toRow(c);
  var _ntQuery = sb.from('customers').update({
    next_touch: row.next_touch,
    last_contact_date: row.last_contact_date,
    days: row.days,
    touch_history: row.touch_history
  }).eq('id', c.id);
  if (c._updated_at) _ntQuery = _ntQuery.eq('updated_at', c._updated_at);
  const { data: _ntData, error } = await _ntQuery.select('updated_at');
  if (!error && c._updated_at && (!_ntData || _ntData.length === 0)) {
    c.next_touch = oldVal;
    toast(escHtml(c.name) + ' was modified by another user. Refresh to see their changes.', 'warn');
    return;
  }
  if (!error && _ntData && _ntData[0]) c._updated_at = _ntData[0].updated_at;
  if (error) {
    console.warn('Failed to save next_touch:', error.message);
    c.next_touch = oldVal; // rollback
    toast('Failed to save - please try again', 'error');
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
  return getDelta7d(c);
}

function deltaHTML(delta) {
  if (delta === null) return '';
  if (delta !== 0) return `<small style="font-weight:500;color:var(--muted)">7v7 days</small>`;
  return '';
}

// ─── BULK ACTIONS ────────────────────────────────────────────
let _lastClickedId = null;   // for shift-click range selection

function toggleSelect(id, checked, ev) {
  // Shift-click: select or deselect range between last click and this click
  if (ev && ev.shiftKey && _lastClickedId && _lastClickedId !== id && _visibleIds) {
    const fromIdx = _visibleIds.indexOf(_lastClickedId);
    const toIdx   = _visibleIds.indexOf(id);
    if (fromIdx !== -1 && toIdx !== -1) {
      const lo = Math.min(fromIdx, toIdx), hi = Math.max(fromIdx, toIdx);
      for (let i = lo; i <= hi; i++) {
        if (checked) selectedIds.add(_visibleIds[i]);
        else         selectedIds.delete(_visibleIds[i]);
      }
    }
  } else {
    if (checked) selectedIds.add(id);
    else         selectedIds.delete(id);
  }
  _lastClickedId = id;
  updateBulkBar();
  renderCustomers();
}

function toggleSelectAll(checked) {
  const q = (el('search-input') ? el('search-input').value.toLowerCase() : '');
  let list = customers.filter(c => {
    if (filterMode==='churned') return c.lifecycle==='churned';
    if (filterMode==='all')    return c.lifecycle!=='churned';
    return c.status===filterMode && c.lifecycle!=='churned';
  }).filter(c => passesManagerFilter(c)).filter(c => {
    if (_filterTier && c.tier !== _filterTier) return false;
    if (_filterStage && (c.lifecycle || 'active') !== _filterStage) return false;
    if (_filterManager && (c.manager || '').trim() !== _filterManager) return false;
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || (c.tags||[]).some(t=>t.toLowerCase().includes(q));
  });
  if (mrrExposureFilter && mrrExposureFilter.ids) {
    list = list.filter(c => mrrExposureFilter.ids.has(c.id));
  }
  list = applyColumnFilters(list);
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
      const { score } = scoreWithModel(c);
      if (c.score !== score) {
        c.history = c.history || [];
        c.history.push({ score, date: new Date().toISOString(), signals: buildHistorySnapshot(c) });
        c.score = score;
        c.status = getStatus(score);
        applyAutoStage(c);
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
    updateAlertBadge();
    if (!customers.length) { nav('homebase'); } else { renderCustomers(); }
    setLoading(true);
    await Promise.all(toDelete.map(c => atDelete(c).catch(()=>{}))).finally(() => setLoading(false));
  });
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
    if (p.searchText) parts.push(`"${p.searchText}"`);
    const desc = parts.length ? parts.join(' + ') : 'all';
    html += `<div class="snooze-dd__item">
      <span style="flex:1;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick="applyPreset(${i})">
        <strong>${escHtml(p.name)}</strong>
        <span style="color:var(--muted);font-size:var(--fs-sm);margin-left:4px">${escHtml(desc)}</span>
      </span>
      <button class="preset-del" onclick="event.stopPropagation();deletePreset(${i})" title="Remove preset">✕</button>
    </div>`;
  });
  html += `<div style="border-top:1px solid var(--border);margin:4px 0"></div>`;
  html += `<div class="snooze-dd__item" onclick="saveCurrentPreset()" style="color:var(--blue);font-weight:600;cursor:pointer">+ Save current view as preset…</div>`;
  menu.innerHTML = html;
}

function serializeColumnFilters(cf) {
  const out = {};
  for (const [k, f] of Object.entries(cf)) {
    if (f.type === 'enum' && f.vals instanceof Set) {
      out[k] = { ...f, vals: [...f.vals] };
    } else {
      out[k] = { ...f };
    }
  }
  return out;
}
function deserializeColumnFilters(cf) {
  const out = {};
  for (const [k, f] of Object.entries(cf)) {
    if (f.type === 'enum') {
      // Handle all possible stored formats for vals
      if (f.vals instanceof Set) {
        out[k] = { ...f };
      } else if (Array.isArray(f.vals)) {
        out[k] = { ...f, vals: new Set(f.vals) };
      } else if (f.vals && typeof f.vals === 'object') {
        // Old broken format: Set serialized as {} or {0:"a",1:"b"} - try Object.values
        const arr = Object.values(f.vals);
        out[k] = { ...f, vals: arr.length ? new Set(arr) : new Set() };
      } else {
        // vals missing or null - skip this broken filter
        continue;
      }
    } else {
      out[k] = { ...f };
    }
  }
  return out;
}

function saveCurrentPreset() {
  const name = prompt('Name this filter preset:');
  if (!name || !name.trim()) return;
  const searchVal = (el('search-input') ? el('search-input').value : '').trim();
  filterPresets.push({
    name: name.trim(),
    filterMode,
    columnFilters: serializeColumnFilters(columnFilters),
    searchText: searchVal || '',
    sortKey,
    sortDir
  });
  persistPresets();
  renderPresetDd();
  toast('Preset saved', 'success');
}

function persistPresets() {
  // Ensure Sets are serialized as arrays before writing to localStorage
  const toSave = filterPresets.map(p => ({
    ...p,
    columnFilters: serializeColumnFilters(p.columnFilters || {})
  }));
  localStorage.setItem('iqc_filter_presets', JSON.stringify(toSave));
}

function applyPreset(idx) {
  const p = filterPresets[idx];
  if (!p) return;
  filterMode    = p.filterMode;
  columnFilters = deserializeColumnFilters(p.columnFilters || {});
  sortKey       = p.sortKey;
  sortDir       = p.sortDir;
  // Restore search text
  const searchInput = el('search-input');
  if (searchInput) searchInput.value = p.searchText || '';
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
  persistPresets();
  renderPresetDd();
}

// ─── RESCORE FROM TOOLBAR (v85) ────────────────────────────────

function rescoreAllFromToolbar() {
  confirmAction(`Recalculate health scores for all ${customers.length} customer${customers.length !== 1 ? 's' : ''} using current weight settings?`, () => {
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
    renderHomeBase();
    renderCustomers();
    renderAlerts();
    toast(`Re-scored ${n} customer${n !== 1 ? 's' : ''}`, 'success');
    if (changed.length) {
      setLoading(true);
      Promise.all(changed.map(c => atUpdate(c).catch(() => {}))).finally(() => setLoading(false));
    }
  });
}

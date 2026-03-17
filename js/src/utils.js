// ─── CORE HELPERS ───────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function fmtNum(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
  return n.toLocaleString();
}

// ─── RENEWAL DISPLAY ────────────────────────────────────────
// Shows days when < 1 month, otherwise months. Pass customer object or months number.
function fmtRenewalTime(c) {
  if (c && c.renewal_date) {
    var days = Math.max(0, Math.round((new Date(c.renewal_date) - new Date()) / 86400000));
    if (days === 0) return 'today';
    if (days < 30) return days + ' day' + (days !== 1 ? 's' : '');
    var mo = Math.round(days / 30.44);
    return mo + ' month' + (mo !== 1 ? 's' : '');
  }
  // Fallback: months-based
  var months = (typeof c === 'number') ? c : (c && c.renewal != null ? c.renewal : null);
  if (months == null) return '—';
  if (months <= 0) return 'today';
  return months + ' month' + (months !== 1 ? 's' : '');
}

// ─── TIME FORMATTING ────────────────────────────────────────
function fmtTime12(hhmm) {
  if (!hhmm) return '';
  var parts = hhmm.split(':');
  var h = parseInt(parts[0], 10);
  var m = parts[1] || '00';
  var ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return h + ':' + m + ' ' + ampm;
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
    if (e.target.id === 'qbr-modal' && typeof closeQBR === 'function') { closeQBR(); return; }
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
  // Number shortcuts for nav (1-7) — matches sidebar order
  const navMap = { '1':'homebase','2':'alerts','3':'customers','4':'segments','5':'trends','6':'csmperf','7':'calendar' };
  if (!e.metaKey && !e.ctrlKey && !e.altKey && navMap[e.key]) {
    nav(navMap[e.key]);
  }
});

// ─── GENERIC TABLE COLUMN FILTER FACTORY ────────────────────
// Creates a reusable column filter system for any table.
// Usage: const cf = makeColFilters('myPrefix', 'my-portal-id', MY_COLS, renderFn);
// Returns { filters, buildTh, renderPills, applyFilters }
const _cfRegistry = {}; // prefix → context
function makeColFilters(prefix, portalId, colDefs, renderFn) {
  const ctx = { filters: {}, openKey: null, portalId, colDefs, renderFn };
  _cfRegistry[prefix] = ctx;

  // Close on outside click
  document.addEventListener('mousedown', function(e) {
    if (!ctx.openKey) return;
    const menu = document.getElementById(portalId);
    if (!menu || !menu.classList.contains('open')) return;
    if (menu.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.col-filter-btn')) return;
    window['cf_close_' + prefix]();
  });

  // Register global functions
  window['cf_open_' + prefix] = function(key, btnEl) {
    const closeFn = window['cf_close_' + prefix];
    if (ctx.openKey === key) { closeFn(); return; }
    closeFn();
    ctx.openKey = key;
    const col = colDefs.find(c => c.key === key);
    const menu = document.getElementById(portalId);
    if (!menu || !col) return;
    menu.innerHTML = _cfBuildMenu(prefix, col);
    menu.classList.add('open');
    const rect = (btnEl.closest('th') || btnEl).getBoundingClientRect();
    menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left + window.scrollX) + 'px';
    requestAnimationFrame(() => {
      const mr = menu.getBoundingClientRect();
      if (mr.right > window.innerWidth - 8)
        menu.style.left = (window.innerWidth - mr.width - 8 + window.scrollX) + 'px';
    });
    _cfPopulate(prefix);
    setTimeout(() => menu.querySelector('input')?.focus(), 30);
  };

  window['cf_close_' + prefix] = function() {
    const menu = document.getElementById(portalId);
    if (menu) { menu.classList.remove('open'); menu.innerHTML = ''; }
    ctx.openKey = null;
  };

  window['cf_apply_' + prefix] = function() {
    const key = ctx.openKey;
    if (!key) return;
    const col = colDefs.find(c => c.key === key);
    if (!col) return;
    if (col.ftype === 'number') {
      const op = document.querySelector(`input[name="cfop_${prefix}"]:checked`)?.value;
      const v1 = parseFloat(document.getElementById(`cfv_${prefix}`)?.value);
      const v2 = parseFloat(document.getElementById(`cfv2_${prefix}`)?.value);
      if (!op || isNaN(v1)) { delete ctx.filters[key]; }
      else if (op === 'between') {
        if (!isNaN(v2)) ctx.filters[key] = { type:'between', min:v1, max:v2 };
        else delete ctx.filters[key];
      } else { ctx.filters[key] = { type:op, val:v1 }; }
    } else if (col.ftype === 'enum') {
      const checked = [...document.querySelectorAll(`.cfe_${prefix}:checked`)].map(cb => cb.value);
      if (checked.length) ctx.filters[key] = { type:'enum', vals: new Set(checked) };
      else delete ctx.filters[key];
    } else if (col.ftype === 'text') {
      const q = (document.getElementById(`cft_${prefix}`)?.value || '').trim().toLowerCase();
      if (q) ctx.filters[key] = { type:'text', q };
      else delete ctx.filters[key];
    }
    renderFn();
  };

  window['cf_opchange_' + prefix] = function() {
    const op = document.querySelector(`input[name="cfop_${prefix}"]:checked`)?.value;
    const v2 = document.getElementById(`cfv2_${prefix}`);
    const sep = document.getElementById(`cfs_${prefix}`);
    const btw = op === 'between';
    if (v2) v2.style.display = btw ? '' : 'none';
    if (sep) sep.style.display = btw ? '' : 'none';
    window['cf_apply_' + prefix]();
  };

  window['cf_clear_' + prefix] = function(key) {
    delete ctx.filters[key];
    window['cf_close_' + prefix]();
    renderFn();
  };

  window['cf_clearall_' + prefix] = function() {
    Object.keys(ctx.filters).forEach(k => delete ctx.filters[k]);
    window['cf_close_' + prefix]();
    renderFn();
  };

  return ctx;
}

function _cfBuildMenu(prefix, col) {
  const applyFn = `cf_apply_${prefix}()`;
  const opFn = `cf_opchange_${prefix}()`;
  let body = '';
  if (col.ftype === 'number') {
    body = `<div class="cff-radio-group">
      <label class="cff-radio"><input type="radio" name="cfop_${prefix}" value="gt" onchange="${opFn}"> Greater than</label>
      <label class="cff-radio"><input type="radio" name="cfop_${prefix}" value="lt" onchange="${opFn}"> Less than</label>
      <label class="cff-radio"><input type="radio" name="cfop_${prefix}" value="eq" onchange="${opFn}"> Exactly</label>
      <label class="cff-radio"><input type="radio" name="cfop_${prefix}" value="between" onchange="${opFn}"> Between</label>
    </div>
    <div class="cff-inputs">
      <input class="cff-num-input" id="cfv_${prefix}" type="number" placeholder="Value" oninput="${applyFn}">
      <span class="cff-between-sep" id="cfs_${prefix}" style="display:none">and</span>
      <input class="cff-num-input" id="cfv2_${prefix}" type="number" placeholder="Max" style="display:none" oninput="${applyFn}">
    </div>`;
  } else if (col.ftype === 'enum') {
    const vals = col.enumFn ? col.enumFn() : (col.enumVals || []);
    body = `<div class="cff-enum-list">${vals.map(v =>
      `<label class="cff-check-item"><input type="checkbox" value="${escHtml(v)}" class="cfe_${prefix}" onchange="${applyFn}"> ${ENUM_DISPLAY[v] !== undefined ? ENUM_DISPLAY[v] : escHtml(v)}</label>`
    ).join('')}</div>`;
  } else if (col.ftype === 'text') {
    body = `<input class="cff-text-input" id="cft_${prefix}" type="text" placeholder="Search ${col.label.toLowerCase()}..." oninput="${applyFn}" autocomplete="off">`;
  }
  return `<div class="col-filter-hd"><span class="col-filter-title">Filter: ${col.label}</span><button class="col-filter-clear" onclick="cf_clear_${prefix}('${col.key}')">Clear</button></div><div class="col-filter-body">${body}</div>`;
}

function _cfPopulate(prefix) {
  const ctx = _cfRegistry[prefix];
  if (!ctx || !ctx.openKey) return;
  const f = ctx.filters[ctx.openKey];
  if (!f) return;
  const col = ctx.colDefs.find(c => c.key === ctx.openKey);
  if (!col) return;
  if (col.ftype === 'number') {
    const radio = document.querySelector(`input[name="cfop_${prefix}"][value="${f.type}"]`);
    if (radio) { radio.checked = true; window['cf_opchange_' + prefix](); }
    const v1 = document.getElementById(`cfv_${prefix}`);
    const v2 = document.getElementById(`cfv2_${prefix}`);
    if (v1) v1.value = (f.type === 'between' ? f.min : f.val) ?? '';
    if (v2 && f.max != null) v2.value = f.max;
  } else if (col.ftype === 'enum') {
    document.querySelectorAll(`.cfe_${prefix}`).forEach(cb => { cb.checked = f.vals.has(cb.value); });
  } else if (col.ftype === 'text') {
    const inp = document.getElementById(`cft_${prefix}`);
    if (inp) inp.value = f.q || '';
  }
}

// Build a <th> string with sort + filter for generic tables
function cfBuildTh(prefix, col, sortKey, sortDir) {
  const ctx = _cfRegistry[prefix];
  const funnelSVG = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`;
  const isActiveSort = sortKey === col.key;
  const filterActive = ctx && col.ftype && (col.key in ctx.filters);
  const arrow = `<span class="col-sort-arrow${isActiveSort ? '' : ' idle'}">${sortDir === 1 ? '\u25B2' : '\u25BC'}</span>`;
  const filterBtn = col.ftype
    ? `<button class="col-filter-btn${filterActive ? ' active' : ''}" onclick="event.stopPropagation();cf_open_${prefix}('${col.key}',this)" title="Filter ${col.label}">${funnelSVG}</button>`
    : '';
  const cls = col.cls ? ` class="${col.cls}"` : '';
  return `<th${cls}><div class="col-th-inner"><button class="col-sort-label" onclick="${col.sortFn || ''}">${col.label}</button>${arrow}${filterBtn}</div></th>`;
}

// Apply column filters to a list
function cfApplyFilters(prefix, list, valueFn) {
  const ctx = _cfRegistry[prefix];
  if (!ctx) return list;
  const keys = Object.keys(ctx.filters);
  if (!keys.length) return list;
  return list.filter(item => {
    for (const key of keys) {
      const f = ctx.filters[key];
      if (!f) continue;
      const v = valueFn(item, key);
      if (f.type === 'text') { if (typeof v === 'string' && !v.includes(f.q)) return false; }
      else if (f.type === 'enum') { if (!f.vals.has(v)) return false; }
      else if (f.type === 'gt') { if (v <= f.val) return false; }
      else if (f.type === 'lt') { if (v >= f.val) return false; }
      else if (f.type === 'eq') { if (v !== f.val) return false; }
      else if (f.type === 'between') { if (v < f.min || v > f.max) return false; }
    }
    return true;
  });
}

// Render filter pills
function cfRenderPills(prefix) {
  const ctx = _cfRegistry[prefix];
  if (!ctx) return '';
  const keys = Object.keys(ctx.filters);
  if (!keys.length) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;align-items:center">`
    + keys.map(key => {
      const f = ctx.filters[key];
      const def = ctx.colDefs.find(d => d.key === key);
      const label = def ? def.label : key;
      let summary = '';
      if (f.type === 'text') summary = '"' + (f.q || '').slice(0, 20) + '"';
      else if (f.type === 'enum') {
        const arr = [...(f.vals || [])].map(v => ENUM_DISPLAY[v] || v);
        summary = arr.length <= 3 ? arr.join(', ') : arr.slice(0, 3).join(', ') + ' +' + (arr.length - 3);
      }
      else if (f.type === 'gt') summary = '> ' + f.val;
      else if (f.type === 'lt') summary = '< ' + f.val;
      else if (f.type === 'eq') summary = '= ' + f.val;
      else if (f.type === 'between') summary = f.min + ' - ' + f.max;
      return `<span class="filter-pill">${escHtml(label)}: ${escHtml(summary)}<button class="filter-pill-x" onclick="event.stopPropagation();cf_clear_${prefix}('${key}')" title="Remove filter">\u2715</button></span>`;
    }).join('')
    + `<button class="btn btn-xs btn-ghost" onclick="cf_clearall_${prefix}()" style="font-size:var(--fs-sm);color:var(--muted)">Clear all</button></div>`;
}

// ─── GLOBAL ERROR MONITORING ────────────────────────────────
// Catches uncaught exceptions and unhandled promise rejections,
// logs to webhook_events (admin-only, not visible to regular users).
(function() {
  var _errSeen = {};  // dedup: msg → timestamp
  var _errQueue = []; // batch queue
  var _errTimer = null;

  function _logClientError(msg, source, line, col, stack) {
    var key = (msg || '') + ':' + (source || '') + ':' + (line || 0);
    var now = Date.now();
    if (_errSeen[key] && now - _errSeen[key] < 60000) return; // dedup: same error within 60s
    _errSeen[key] = now;

    _errQueue.push({
      direction:  'client_error',
      event_type: 'js_error',
      status:     'error',
      error_msg:  (msg || 'Unknown error').substring(0, 500),
      payload:    JSON.stringify({
        source: (source || '').split('/').pop(),
        line: line || 0,
        col: col || 0,
        stack: (stack || '').substring(0, 1000),
        page: window._currentPage || 'unknown',
        ua: navigator.userAgent.substring(0, 150),
        v: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?'
      })
    });

    // Batch: flush after 2s so rapid errors get sent together
    if (!_errTimer) {
      _errTimer = setTimeout(_flushErrors, 2000);
    }
  }

  function _flushErrors() {
    _errTimer = null;
    if (!_errQueue.length) return;
    var batch = _errQueue.splice(0, 10); // max 10 per flush
    try {
      if (typeof sb === 'undefined' || !sb || typeof currentUser === 'undefined' || !currentUser) return;
      batch.forEach(function(evt) {
        evt.user_id = currentUser.id;
        sb.from('webhook_events').insert(evt).then(function() {}).catch(function(e) { console.warn('errorLog:', e.message); });
      });
    } catch(e) { /* fail silently */ }
  }

  window.onerror = function(msg, source, line, col, err) {
    _logClientError(msg, source, line, col, err ? err.stack : '');
    return false; // don't suppress console output
  };

  window.addEventListener('unhandledrejection', function(e) {
    var msg = e.reason ? (e.reason.message || String(e.reason)) : 'Unhandled promise rejection';
    var stack = e.reason ? (e.reason.stack || '') : '';
    _logClientError(msg, 'promise', 0, 0, stack);
  });
})();

// ─── CORE HELPERS ───────────────────────────────────────────
function el(id) { return document.getElementById(id); }

// Debounce: coalesce rapid calls into a single execution after `ms` delay
function debounce(fn, ms) {
  var timer;
  return function() {
    var ctx = this, args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(ctx, args); }, ms);
  };
}
// ─── EVENT DELEGATION ────────────────────────────────────────
// Replaces inline handlers (onclick, onchange, etc.) with data-* attributes
// Enables Content Security Policy without 'unsafe-inline'

// Click delegation: data-action="fnName" data-arg="value" [data-stop]
document.addEventListener('click', function(e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  if (t.dataset.stop !== undefined) e.stopPropagation();
  var fn = window[t.dataset.action];
  if (typeof fn !== 'function') return;
  var arg = t.dataset.arg;
  var arg2 = t.dataset.arg2;
  if (arg !== undefined && arg2 !== undefined) fn(arg, arg2);
  else if (arg !== undefined) fn(arg);
  else fn(e);
});

// Change delegation: data-change="fnName" [data-arg="value"]
document.addEventListener('change', function(e) {
  var t = e.target.closest('[data-change]');
  if (!t) return;
  var fn = window[t.dataset.change];
  if (typeof fn !== 'function') return;
  var arg = t.dataset.arg;
  if (arg !== undefined) fn(arg);
  else fn.call(t, e);
});

// Input delegation: data-input="fnName" [data-arg="value"]
document.addEventListener('input', function(e) {
  var t = e.target.closest('[data-input]');
  if (!t) return;
  var fn = window[t.dataset.input];
  if (typeof fn !== 'function') return;
  var arg = t.dataset.arg;
  if (arg !== undefined) fn.call(t, arg);
  else fn.call(t, e);
});

// Submit delegation: data-submit="fnName"
document.addEventListener('submit', function(e) {
  var form = e.target.closest('[data-submit]');
  if (!form) return;
  e.preventDefault();
  var fn = window[form.dataset.submit];
  if (typeof fn === 'function') fn(e);
});

// Focus/blur delegation
document.addEventListener('focus', function(e) {
  var t = e.target.closest('[data-focus]');
  if (!t) return;
  var fn = window[t.dataset.focus];
  if (typeof fn !== 'function') return;
  var arg = t.dataset.arg;
  if (arg !== undefined) fn(arg);
  else fn.call(t, e);
}, true);
document.addEventListener('keydown', function(e) {
  var t = e.target.closest('[data-keydown]');
  if (!t) return;
  var fn = window[t.dataset.keydown];
  if (typeof fn === 'function') fn(e);
});
document.addEventListener('blur', function(e) {
  var t = e.target.closest('[data-blur]');
  if (!t) return;
  var fn = window[t.dataset.blur];
  if (typeof fn === 'function') fn.call(t, e);
}, true);

// Drag delegation
document.addEventListener('drop', function(e) {
  var t = e.target.closest('[data-drop]');
  if (!t) return;
  var fn = window[t.dataset.drop];
  if (typeof fn === 'function') fn(e);
});
document.addEventListener('dragover', function(e) {
  var t = e.target.closest('[data-dragover]');
  if (!t) return;
  var fn = window[t.dataset.dragover];
  if (typeof fn === 'function') fn(e);
});
document.addEventListener('dragleave', function(e) {
  var t = e.target.closest('[data-dragleave]');
  if (!t) return;
  var fn = window[t.dataset.dragleave];
  if (typeof fn === 'function') fn(e);
});

// ── Named helpers for complex inline handlers ──
function toggleTbMenu() { var m = el('tb-user-menu'); if (m) { m.classList.toggle('open'); var a = el('tb-avatar'); if (a) a.setAttribute('aria-expanded', m.classList.contains('open')); } }
function toggleSbMenu() { var m = el('sb-menu'); if (m) { m.classList.toggle('open'); var a = el('sb-avatar'); if (a) a.setAttribute('aria-expanded', m.classList.contains('open')); } }
function handleCustSearch() { _custPage = 0; renderCustomers(); }
function handleManagerChange(e) {
  var sel = e && e.target ? e.target : this;
  if (sel.value === '__add_new__') { sel.style.display = 'none'; var inp = el('f-manager-new'); if (inp) { inp.style.display = ''; inp.focus(); } }
}
function handleManagerNewBlur() { if (!this.value) { this.style.display = 'none'; var sel = el('f-manager'); if (sel) { sel.style.display = ''; sel.value = ''; } } }
function handleAlertCustSearch() { renderAlerts(); }
function handleWebhookFilterChange() { _pagState.webhookLog = 0; renderWebhookLog(); }
function handleAuditFilterChange() { _pagState.auditLog = 0; renderAuditLog(); }

// Range input handlers (score form signals)
function rvLogins() { rv('logins', this.value + ' days'); }
function rvAdoption() { rv('adoption', this.value + '%'); }
function rvNps() { rv('nps-label', npsDisplay(Number(this.value))); }
function rvCsat() { rv('csat-label', csatDisplay(Number(this.value))); }
function rvDays() { rv('days', this.value + 'd'); }
function rvTickets() { rv('tickets', this.value); }
function rvThresholds() { updateThresholdLabels(); }

// Revenue sync handlers
function syncMrr() { syncRevenue('mrr'); }
function syncArr() { syncRevenue('arr'); }

// Sidebar/topbar menu close-then-navigate helpers
function tbMenuNav(page) { el('tb-user-menu')?.classList.remove('open'); nav(page); }
function tbMenuSignOut() { el('tb-user-menu')?.classList.remove('open'); authSignOut(); }
function sbMenuNav(page) { el('sb-menu')?.classList.remove('open'); nav(page); }
function sbMenuWhatsNew() { el('sb-menu')?.classList.remove('open'); showWhatsNew(); }
function sbMenuSignOut() { el('sb-menu')?.classList.remove('open'); authSignOut(); }

// File input click triggers
function clickCsvInput() { el('csv-input')?.click(); }
function clickCfgImport() { el('cfg-import-file')?.click(); }
function clickRestoreInput() { el('restore-input')?.click(); }

// Webhook/audit log refresh with force flag
function loadWebhookLogRefresh() { if (typeof renderWebhookLog === 'function') renderWebhookLog(true); }
function loadAuditLogRefresh() { if (typeof loadAuditLog === 'function') loadAuditLog(true); }

// Rule wizard step click
function ruleWizardStep1() { if (typeof _ruleWizardGoTo === 'function') _ruleWizardGoTo(1); }

// Help page smooth scroll
function helpScrollTo(id) {
  var target = el(id);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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
  if (months == null) return ' -';
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
  // Announce to screen readers
  var live = document.getElementById('a11y-live');
  if (live) live.textContent = msg;
}

// ─── MODALS ─────────────────────────────────────────────────
var _modalFocusStack = [];

function _trapModalFocus(e) {
  if (e.key !== 'Tab') return;
  var modal = e.currentTarget.querySelector('.modal') || e.currentTarget;
  var focusable = modal.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return;
  var first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function closeModal(id) {
  var m = document.getElementById(id);
  m.classList.remove('open');
  m.removeEventListener('keydown', _trapModalFocus);
  // Restore focus to element that opened the modal
  var prev = _modalFocusStack.pop();
  if (prev && prev.focus) try { prev.focus(); } catch(_) { console.warn('ls:', _.message); }
}
function openModal(id) {
  _modalFocusStack.push(document.activeElement);
  var m = document.getElementById(id);
  m.classList.add('open');
  m.addEventListener('keydown', _trapModalFocus);
  // Focus first interactive element inside the modal
  var first = m.querySelector('.modal button, .modal input, .modal textarea, .modal a[href]');
  if (first) setTimeout(function() { first.focus(); }, 50);
}

// Close modal on backdrop click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-bg') || (e.target.id === 'welcome-modal' && e.target === e.currentTarget)) {
    var id = e.target.id;
    // Custom close handlers for specific modals
    if (id === 'qbr-modal' && typeof closeQBR === 'function') { closeQBR(); return; }
    if (id === 'rule-builder-modal' && typeof closeRuleBuilder === 'function') { closeRuleBuilder(); return; }
    if (id === 'create-alert-modal' && typeof closeCreateAlertModal === 'function') { closeCreateAlertModal(); return; }
    if (id === 'welcome-modal' && typeof closeWelcome === 'function') { closeWelcome(); return; }
    if (id === 'whatsnew-modal' && typeof closeWhatsNew === 'function') { closeWhatsNew(); return; }
    // Default: close by ID
    closeModal(id);
    return;
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
  // Esc - close open column filter dropdown or modal
  if (e.key === 'Escape') {
    closeColFilter();
    closeAlertFilter();
    // Close topmost open modal via closeModal (restores focus properly)
    var openModals = document.querySelectorAll('.modal-bg.open');
    if (openModals.length) { closeModal(openModals[openModals.length - 1].id); }
    return;
  }
  // Ignore shortcuts when typing in inputs
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;

  // Cmd/Ctrl + K - jump to customer search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    nav('customers');
    setTimeout(() => el('search-input')?.focus(), 50);
    return;
  }
  // Cmd/Ctrl + Enter - submit score form if on score view
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    const scoreView = document.getElementById('view-score');
    if (scoreView?.classList.contains('active')) {
      document.getElementById('score-form').requestSubmit();
    }
    return;
  }
  // Number shortcuts for nav (1-7) - matches sidebar order
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

// ─── NAVIGATION ─────────────────────────────────────────────
const VIEWS = ['homebase','alerts','customers','segments','trends','csmperf','calendar','reports','score','csv','settings','automations','auditlog','users','clients','help'];
const ADMIN_EMAILS = (_cfg && _cfg.ADMIN_EMAILS) || [];

// ─── COLLAPSIBLE NAV GROUPS ─────────────────────────────────
const NAV_GROUPS = {
  main:     ['alerts','customers','segments','trends','csmperf','calendar'],
  automate: ['automations','reports'],
  data:     ['score','csv'],
  config:   ['settings','auditlog']
};

function toggleNavGroup(id) {
  const grp = document.getElementById('ng-' + id);
  if (!grp) return;
  grp.classList.toggle('open');
  _saveNavGroupState();
}

function _saveNavGroupState() {
  const state = {};
  Object.keys(NAV_GROUPS).forEach(id => {
    const grp = document.getElementById('ng-' + id);
    if (grp) state[id] = grp.classList.contains('open');
  });
  try { localStorage.setItem('iqc_nav_groups', JSON.stringify(state)); } catch(e) {}
}

function _restoreNavGroupState() {
  try {
    const saved = JSON.parse(localStorage.getItem('iqc_nav_groups'));
    if (!saved) return; // default: all open (set in HTML)
    Object.keys(NAV_GROUPS).forEach(id => {
      const grp = document.getElementById('ng-' + id);
      if (grp) {
        if (saved[id] === false) grp.classList.remove('open');
        else grp.classList.add('open');
      }
    });
  } catch(e) {}
}

function _autoExpandGroupFor(v) {
  for (const [groupId, views] of Object.entries(NAV_GROUPS)) {
    if (views.includes(v)) {
      const grp = document.getElementById('ng-' + groupId);
      if (grp && !grp.classList.contains('open')) {
        grp.classList.add('open');
        _saveNavGroupState();
      }
      break;
    }
  }
}

// Restore on load
_restoreNavGroupState();

function isAdmin() {
  // Primary: server-fetched role from user_profiles (can't be spoofed via console)
  if (_userRole === 'admin') return true;
  // Fallback: config-based check (only used before profile loads; RLS still protects data)
  return currentUser && ADMIN_EMAILS.some(e => currentUser.email.toLowerCase() === e.toLowerCase());
}

function nav(v) {
  // Remember active view for page refresh
  try { localStorage.setItem('iqc_active_view', v); } catch(e) {}

  // Auto-expand the group containing this view
  _autoExpandGroupFor(v);

  VIEWS.forEach(id => {
    const view = document.getElementById('view-' + id);
    if (view) view.classList.remove('active');
    const ni = document.getElementById('ni-' + id);
    if (ni) ni.classList.remove('active');
  });
  const target = document.getElementById('view-' + v);
  if (target) target.classList.add('active');
  // Scroll main area to top on page change
  const _mainEl = document.querySelector('main.main');
  if (_mainEl) _mainEl.scrollTop = 0;
  const ni = document.getElementById('ni-' + v);
  if (ni) ni.classList.add('active');

  // Always clear edit mode when navigating away from score view
  if (v !== 'score') {
    document.getElementById('score-form').dataset.editId = '';
    document.getElementById('form-title').textContent = 'Score a Customer';
    // Return to customer detail modal if rescore was opened from there
    if (typeof _returnToDetail !== 'undefined' && _returnToDetail) {
      const rid = _returnToDetail; _returnToDetail = '';
      setTimeout(() => openDetail(rid), 80);
    }
  }

  if (v === 'homebase')  renderHomeBase();
  if (v === 'alerts')    renderAlerts();
  if (v === 'customers') renderCustomers();
  if (v === 'segments')  { if (!hasFeature('segments')) { el('seg-kpi-row').innerHTML = ''; el('seg-table-wrap').innerHTML = upgradeHTML('segments'); } else renderSegments(); }
  if (v === 'trends')    renderTrends();
  if (v === 'csmperf')   { if (!hasFeature('csm_performance')) { el('csmperf-wrap').innerHTML = upgradeHTML('csm_performance'); el('csmperf-stats').innerHTML = ''; } else renderCSMPerformance(); }
  if (v === 'calendar')  renderCalendar();
  if (v === 'settings')  renderSettings();
  if (v === 'auditlog')  { if (!hasFeature('audit_log')) { el('audit-loading').style.display='none'; document.getElementById('audit-table').style.display='none'; document.getElementById('audit-empty').innerHTML = upgradeHTML('audit_log'); document.getElementById('audit-empty').style.display='block'; } else { loadAuditLog(); renderConfigHistory(); } }
  if (v === 'reports')     renderReporting();
  if (v === 'automations') renderAutomations();
  if (v === 'users')     renderUsers();
  if (v === 'clients')   renderClients();
}

/* Refresh the currently active page (used after saving from detail modal) */
function refreshCurrentPage() {
  const v = document.querySelector('.view.active');
  if (!v) return;
  const id = (v.id || '').replace('view-', '');
  if (id === 'homebase')  renderHomeBase();
  if (id === 'alerts')    renderAlerts();
  if (id === 'customers') renderCustomers();
  if (id === 'segments')  renderSegments();
  if (id === 'trends')    renderTrends();
  if (id === 'csmperf')   renderCSMPerformance();
  if (id === 'calendar')  renderCalendar();
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
  const active = all.filter(a => !isSnoozed(a.id) && !isDismissed(a.id));
  if (!active.length) {
    m.innerHTML = `<div style="padding:14px 16px;font-size:var(--fs-base);color:var(--muted);text-align:center">${appIcon('check',13)} All clear — no active alerts</div>`;
    return;
  }
  const top5 = active.slice(0, 5);
  const dotColor = { red:'var(--red)', amber:'var(--amber)', blue:'var(--blue)', green:'var(--green)' };
  let html = top5.map(a => {
    const c = customers.find(x => x.id === a.cid);
    return `<button class="snooze-dd__item" onclick="toggleBellDd();${c ? `openDetail('${escHtml(c.id)}')` : `nav('alerts')`}" style="flex-direction:column;align-items:flex-start;gap:2px;padding:9px 14px">
      <div style="display:flex;align-items:center;gap:7px;width:100%">
        <span style="width:7px;height:7px;border-radius:50%;background:${dotColor[a.type]||'var(--muted)'};flex-shrink:0"></span>
        <span style="font-size:var(--fs-base);color:var(--text);flex:1;text-align:left">${a.msg}</span>
      </div>
      ${a.sub ? `<div style="font-size:var(--fs-sm);color:var(--muted);padding-left:14px">${a.sub}</div>` : ''}
    </button>`;
  }).join('');
  if (active.length > 5) {
    html += `<div style="padding:5px 14px;font-size:var(--fs-sm);color:var(--muted)">+${active.length - 5} more alert${active.length - 5 !== 1 ? 's' : ''}</div>`;
  }
  html += `<div style="border-top:1px solid var(--border);padding:8px 14px">
    <button class="snooze-dd__item" onclick="toggleBellDd();nav('alerts')" style="font-size:var(--fs-base);color:var(--blue);font-weight:600;width:100%;justify-content:center">View all alerts →</button>
  </div>`;
  m.innerHTML = html;
}
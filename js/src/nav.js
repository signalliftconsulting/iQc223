// ─── NAVIGATION ─────────────────────────────────────────────
const VIEWS = ['dashboard','alerts','customers','segments','trends','csmperf','reports','score','csv','settings','automations','auditlog','users','clients','help'];
const ADMIN_EMAILS = (_cfg && _cfg.ADMIN_EMAILS) || [];

function isAdmin() {
  // Primary: server-fetched role from user_profiles (can't be spoofed via console)
  if (_userRole === 'admin') return true;
  // Fallback: config-based check (only used before profile loads; RLS still protects data)
  return currentUser && ADMIN_EMAILS.some(e => currentUser.email.toLowerCase() === e.toLowerCase());
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
  if (v === 'segments')  { if (!hasFeature('segments')) { el('seg-kpi-row').innerHTML = ''; el('seg-cards-wrap').innerHTML = upgradeHTML('segments'); el('seg-table-wrap').innerHTML = ''; el('seg-insights-wrap').innerHTML = ''; } else renderSegments(); }
  if (v === 'trends')    renderTrends();
  if (v === 'csmperf')   { if (!hasFeature('csm_performance')) { el('csmperf-wrap').innerHTML = upgradeHTML('csm_performance'); el('csmperf-stats').innerHTML = ''; } else renderCSMPerformance(); }
  if (v === 'settings')  renderSettings();
  if (v === 'auditlog')  { if (!hasFeature('audit_log')) { el('audit-loading').style.display='none'; document.getElementById('audit-table').style.display='none'; document.getElementById('audit-empty').innerHTML = upgradeHTML('audit_log'); document.getElementById('audit-empty').style.display='block'; } else { loadAuditLog(); renderConfigHistory(); } }
  if (v === 'reports')     renderReporting();
  if (v === 'automations') renderAutomations();
  if (v === 'users')     renderUsers();
  if (v === 'clients')   renderClients();
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
    return `<button class="snooze-dd__item" onclick="toggleBellDd();${c ? `openDetail('${escHtml(c.id)}')` : `nav('alerts')`}" style="flex-direction:column;align-items:flex-start;gap:2px;padding:9px 14px">
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
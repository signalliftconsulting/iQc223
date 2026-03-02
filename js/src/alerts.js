// ─── ALERTS ─────────────────────────────────────────────────

// Category definitions — SVG icons, no emoji
const _ico = (path) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const ALERT_ICONS = {
  health:    _ico('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  renewal:   _ico('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  cadence:   _ico('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.09 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  sentiment: _ico('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  momentum:  _ico('<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>'),
  tickets:   _ico('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
  expansion: _ico('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
  snoozed:   _ico('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  engagement:_ico('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
};
const ALERT_CATS = {
  health:     { label:'Health',     icon: ALERT_ICONS.health,     type:'red'   },
  renewal:    { label:'Renewal',    icon: ALERT_ICONS.renewal,    type:'blue'  },
  cadence:    { label:'Cadence',    icon: ALERT_ICONS.cadence,    type:'amber' },
  sentiment:  { label:'Sentiment',  icon: ALERT_ICONS.sentiment,  type:'amber' },
  momentum:   { label:'Momentum',   icon: ALERT_ICONS.momentum,   type:'amber' },
  tickets:    { label:'Support',    icon: ALERT_ICONS.tickets,    type:'red'   },
  engagement: { label:'Engagement', icon: ALERT_ICONS.engagement, type:'amber' },
  expansion:  { label:'Expansion',  icon: ALERT_ICONS.expansion,  type:'green' },
};

// Severity order for sorting (lower = higher priority)
const ALERT_SEV = { red:0, amber:1, blue:2, green:3 };

// Dismissed alerts map: alertId → score at time of dismissal
// Alert reappears if customer's score changes from when it was dismissed
let dismissed = new Map();

// MRR exposure bucket → Set of customer IDs (kept in sync with renderAlerts)
let _mrrSeen = {};
// Cached alert arrays for click-to-filter (refreshed each render)
let _cachedActive = [];
let _cachedSnoozed = [];

function buildAlerts() {
  const alerts = [];
  const now = new Date();
  // Customer display snapshot — embedded in every alert for rich rendering
  const snap = c => ({ _score:c.score, _status:c.status, _tier:c.tier, _manager:c.manager||'', _days:c.days != null ? c.days : 0, _mrr:c.mrr||0 });

  customers.forEach(c => {
    if (c.lifecycle === 'churned') return;
    if (!passesManagerFilter(c)) return;

    // ── Health ──
    if (c.status === 'critical')
      alerts.push({ id:c.id+'-crit',  cid:c.id, cat:'health', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>is Critical — score ${c.score}</span>`,
        sub:`MRR $${fmtNum(c.mrr||0)}`, ...snap(c) });
    else if (c.status === 'risk')
      alerts.push({ id:c.id+'-risk',  cid:c.id, cat:'health', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>is At Risk — score ${c.score}</span>`,
        sub:`MRR $${fmtNum(c.mrr||0)}`, ...snap(c) });
    else if (c.status === 'watch')
      alerts.push({ id:c.id+'-watch', cid:c.id, cat:'health', type:'amber',
        msg:`<strong>${escHtml(c.name)}</strong> <span>in Watch zone — score ${c.score}</span>`,
        sub:`MRR $${fmtNum(c.mrr||0)}`, ...snap(c) });

    // ── Support tickets (only if tickets signal is active) ──
    if (signalOn(c,'tickets') && c.tickets >= 3)
      alerts.push({ id:c.id+'-tix', cid:c.id, cat:'tickets', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>has ${c.tickets} open support tickets</span>`,
        sub:`NPS: ${npsDisplay(c.nps)} · CSAT: ${csatDisplay(c.csat)}`, ...snap(c) });

    // ── Low Logins (only if logins signal is active) ──
    if (signalOn(c,'logins') && c.logins != null && c.logins < 5)
      alerts.push({ id:c.id+'-logins', cid:c.id, cat:'engagement', type:'amber',
        msg:`<strong>${escHtml(c.name)}</strong> <span>has low login frequency (${c.logins}/mo)</span>`,
        sub:`Score ${c.score} · MRR $${fmtNum(c.mrr||0)}`, ...snap(c) });

    // ── Low Adoption (only if adoption signal is active) ──
    if (signalOn(c,'adoption') && c.adoption != null && c.adoption < 30)
      alerts.push({ id:c.id+'-adopt', cid:c.id, cat:'engagement', type:'amber',
        msg:`<strong>${escHtml(c.name)}</strong> <span>has low feature adoption (${c.adoption}%)</span>`,
        sub:`Score ${c.score} · MRR $${fmtNum(c.mrr||0)}`, ...snap(c) });

    // ── Renewal (uses renewal_date for accurate countdown) ──
    if (c.renewal_date) {
      const d = new Date(c.renewal_date);
      const days = Math.round((d - now) / 86400000);
      if (days >= 0 && days <= 60) {
        const urgency = days <= 14 ? 'red' : days <= 30 ? 'amber' : 'blue';
        const label   = days === 0 ? 'Today!' : days === 1 ? 'Tomorrow' : `${days} days`;
        alerts.push({ id:c.id+'-renew', cid:c.id, cat:'renewal', type:urgency,
          msg:`<strong>${escHtml(c.name)}</strong> <span>renews in ${label}</span>`,
          sub:`${d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} · MRR $${fmtNum(c.mrr||0)}`, ...snap(c) });
      }
    } else if (c.renewal != null && c.renewal >= 0 && c.renewal <= 2) {
      alerts.push({ id:c.id+'-renew', cid:c.id, cat:'renewal', type:'blue',
        msg:`<strong>${escHtml(c.name)}</strong> <span>renews in ${c.renewal} month${c.renewal===1?'':'s'}</span>`,
        sub:`MRR $${fmtNum(c.mrr||0)}`, ...snap(c) });
    }

    // ── Momentum ──
    if (getMomentum(c) === 'dn')
      alerts.push({ id:c.id+'-mom', cid:c.id, cat:'momentum', type:'amber',
        msg:`<strong>${escHtml(c.name)}</strong> <span>score is declining ↘</span>`,
        sub:`Score ${c.score}`, ...snap(c) });

    // ── Sentiment (only if sentiment feature is active + log exists) ──
    if (hasFeature('sentiment')) {
      const sent = latestSentiment(c);
      if (sent?.val === 'negative')
        alerts.push({ id:c.id+'-sent', cid:c.id, cat:'sentiment', type:'amber',
          msg:`<strong>${escHtml(c.name)}</strong> <span>last call logged as negative</span>`,
          sub:`Sentiment: Negative`, ...snap(c) });
    }

    // ── NPS Detractor (only if NPS signal is active) ──
    if (signalOn(c,'nps') && npsIsDetractor(c.nps))
      alerts.push({ id:c.id+'-nps', cid:c.id, cat:'sentiment', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>is an NPS Detractor (${npsDisplay(c.nps)})</span>`,
        sub:`Score ${c.score}`, ...snap(c) });

    // ── CSAT Poor (only if CSAT signal is active) ──
    if (signalOn(c,'csat') && csatIsPoor(c.csat))
      alerts.push({ id:c.id+'-csat', cid:c.id, cat:'sentiment', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>has a poor CSAT rating (${csatDisplay(c.csat)})</span>`,
        sub:`Score ${c.score}`, ...snap(c) });

    // ── Expansion opportunity (only if growth signal is active + no recent touch) ──
    if (signalOn(c,'growth') && (c.status === 'expand' || c.status === 'healthy') && (c.mrr||0) >= 3000) {
      const daysSince = c.days != null ? c.days : 0;
      if (!signalOn(c,'days') || daysSince >= 30)
        alerts.push({ id:c.id+'-exp', cid:c.id, cat:'expansion', type:'green',
          msg:`<strong>${escHtml(c.name)}</strong> <span>expansion opportunity — ${daysSince}d since last touch</span>`,
          sub:`MRR $${fmtNum(c.mrr||0)} · Score ${c.score}`, ...snap(c) });
    }
  });

  // ── Cadence alerts (only if days-since-contact signal is active) ──
  // Enrich cadence alerts with customer snapshot too
  const cadAlerts = buildCadenceAlerts();
  cadAlerts.forEach(a => {
    const c = customers.find(x => x.id === a.cid);
    if (c) Object.assign(a, { _score:c.score, _status:c.status, _tier:c.tier, _manager:c.manager||'', _days:c.days != null ? c.days : 0, _mrr:c.mrr||0 });
  });
  alerts.push(...cadAlerts);

  // Sort: severity first, then MRR desc
  alerts.sort((a,b) => {
    const sd = (ALERT_SEV[a.type]||9) - (ALERT_SEV[b.type]||9);
    if (sd !== 0) return sd;
    const ca = customers.find(x=>x.id===a.cid), cb = customers.find(x=>x.id===b.cid);
    return ((cb?.mrr||0) - (ca?.mrr||0));
  });

  return alerts;
}

// ─── MULTI-SELECT STATE ──────────────────────────────────────
let _selectedAlerts = new Set();
let _lastClickedAlert = null;
let _alertViewMode = 'category'; // 'category' | 'priority' | 'customer' | 'table'
let _alertTableFilter = null;    // { label: string, ids: Set<string> } — null = all alerted customers
let _alertTblSort = { key: 'score', dir: 1 }; // 1=asc (worst first), -1=desc

function toggleAlertGroup(hd) {
  const body = hd.nextElementSibling;
  if (!body || !body.classList.contains('alert-group-body')) return;
  const isHidden = getComputedStyle(body).display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  hd.classList.toggle('alert-grp-open', isHidden);
}

function setAlertView(mode) {
  _alertViewMode = mode;
  if (mode !== 'table') _alertTableFilter = null; // clear table filter when leaving table view
  const modeMap = { cat:'category', pri:'priority', cust:'customer', tbl:'table' };
  ['cat','pri','cust','tbl'].forEach(k => {
    const btn = el('alert-view-' + k);
    if (btn) btn.classList.toggle('active', mode === modeMap[k]);
  });
  const searchBox = el('alert-cust-search');
  if (searchBox) {
    searchBox.style.display = (mode === 'customer' || mode === 'table') ? '' : 'none';
    if (mode !== 'customer' && mode !== 'table') searchBox.value = '';
  }
  renderAlerts();
}

function alertToggleSelect(aid, el, ev) {
  // Shift+click range selection
  if (ev && ev.shiftKey && _lastClickedAlert && _lastClickedAlert !== aid) {
    const allChecks = [...document.querySelectorAll('#alerts-list .alert-item__check')];
    const ids = allChecks.map(cb => {
      const m = cb.getAttribute('onclick')?.match(/alertToggleSelect\('([^']+)'/);
      return m ? m[1] : null;
    }).filter(Boolean);
    const startIdx = ids.indexOf(_lastClickedAlert);
    const endIdx = ids.indexOf(aid);
    if (startIdx !== -1 && endIdx !== -1) {
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      for (let i = lo; i <= hi; i++) {
        _selectedAlerts.add(ids[i]);
        const row = document.getElementById('alert-row-' + ids[i]);
        if (row) row.classList.add('selected');
        if (allChecks[i]) allChecks[i].checked = true;
      }
      _lastClickedAlert = aid;
      _updateAlertBulkBar();
      return;
    }
  }
  // Normal toggle
  if (_selectedAlerts.has(aid)) _selectedAlerts.delete(aid);
  else _selectedAlerts.add(aid);
  _lastClickedAlert = aid;
  _updateAlertBulkBar();
  const row = document.getElementById('alert-row-'+aid);
  if (row) row.classList.toggle('selected', _selectedAlerts.has(aid));
}

function alertsSelectAll() {
  const all = buildAlerts().filter(a => !isSnoozed(a.id) && !isDismissed(a.id));
  if (_selectedAlerts.size === all.length) {
    _selectedAlerts.clear();
  } else {
    all.forEach(a => _selectedAlerts.add(a.id));
  }
  _updateAlertBulkBar();
  _renderAlerts();
}

function alertsClearSelection() {
  _selectedAlerts.clear();
  _updateAlertBulkBar();
  _renderAlerts();
}

function _updateAlertBulkBar() {
  const bar = el('alert-bulk-bar');
  const cnt = el('alert-bulk-count');
  if (!bar) return;
  if (_selectedAlerts.size > 0) {
    bar.classList.add('visible');
    cnt.textContent = `${_selectedAlerts.size} selected`;
  } else {
    bar.classList.remove('visible');
  }
}

function toggleBulkSnoozeDd() {
  document.querySelectorAll('.snooze-dd__menu').forEach(m => {
    if (m.id !== 'bulk-snooze-menu') m.classList.remove('open');
  });
  el('bulk-snooze-menu')?.classList.toggle('open');
}

function bulkSnooze(days) {
  el('bulk-snooze-menu')?.classList.remove('open');
  const expiry = Date.now() + days * 86400000;
  _selectedAlerts.forEach(aid => snoozed.set(aid, expiry));
  const n = _selectedAlerts.size;
  _selectedAlerts.clear();
  saveSettings();
  logAudit('bulk_snooze', null, '', { summary: `${n} alert${n===1?'':'s'} snoozed for ${days}d` });
  renderAlerts();

  toast(`${n} alert${n===1?'':'s'} snoozed for ${days} day${days===1?'':'s'}`, 'default');
}

function bulkDismiss() {
  _selectedAlerts.forEach(aid => {
    const cid = aid.replace(/-[^-]+$/, '');
    const c = customers.find(x => x.id === cid);
    dismissed.set(aid, c ? c.score : null);
  });
  const n = _selectedAlerts.size;
  _selectedAlerts.clear();
  saveSettings();
  logAudit('bulk_dismiss', null, '', { summary: `${n} alert${n===1?'':'s'} dismissed` });
  renderAlerts();

  toast(`${n} alert${n===1?'':'s'} dismissed`, 'default');
}

function renderAlerts() { try { _renderAlerts(); } catch(e) { console.error('renderAlerts error:', e); } }
function _renderAlerts() {
  const all    = buildAlerts();
  const active = all.filter(a => !isSnoozed(a.id) && !isDismissed(a.id));
  const snz    = all.filter(a =>  isSnoozed(a.id));
  _cachedActive = active;
  _cachedSnoozed = snz;
  const list   = el('alerts-list');

  // Update sidebar badge + topbar bell badge (v86)
  const ab = el('alert-badge');
  if (ab) { if (active.length > 0) { ab.textContent = active.length; ab.style.display = ''; } else ab.style.display = 'none'; }
  const bb = el('bell-badge');
  if (bb) { if (active.length > 0) { bb.textContent = active.length; bb.style.display = ''; } else bb.style.display = 'none'; }

  _updateAlertBulkBar();

  // Show/hide view toggle bar
  const viewBar = el('alert-view-bar');
  if (viewBar) viewBar.style.display = (active.length || snz.length || _alertTableFilter) ? 'flex' : 'none';

  if (!active.length && !snz.length && !(_alertViewMode === 'table' && _alertTableFilter)) {
    list.innerHTML = '<div class="empty-st"><div class="ei"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div><h3>All clear!</h3><p>No alerts right now — all accounts are in good shape.</p></div>';
    renderAlertPanel(all, active, snz);
    renderAlertBriefing(active, snz);
    return;
  }

  let html = '';

  if (_alertViewMode === 'priority') {
    // ── Priority view: sort all active alerts by severity then score ──
    const sevOrder = { red:0, amber:1, blue:2, green:3 };
    const sevLabels = { red:'Critical', amber:'Warning', blue:'Attention', green:'Opportunity' };
    const sevColors = { red:'#dc2626', amber:'#d97706', blue:'#2563eb', green:'#16a34a' };

    // Sort: severity first, then score ascending (worst first)
    const sorted = [...active].sort((a,b) => {
      const sd = (sevOrder[a.type]??9) - (sevOrder[b.type]??9);
      if (sd !== 0) return sd;
      return (a._score||0) - (b._score||0);
    });

    // Group by severity
    const groups = {};
    sorted.forEach(a => {
      const sev = a.type || 'amber';
      if (!groups[sev]) groups[sev] = [];
      groups[sev].push(a);
    });

    ['red','amber','blue','green'].forEach(sev => {
      const group = groups[sev];
      if (!group || !group.length) return;
      html += `<div class="alert-priority-hd" onclick="toggleAlertGroup(this)"><div class="alert-priority-dot" style="background:${sevColors[sev]}"></div>${sevLabels[sev]} <span style="font-weight:400;color:var(--subtle)">(${group.length})</span></div>`;
      html += `<div class="alert-group-body">${group.map(a => alertItemHTML(a, false)).join('')}</div>`;
    });
  } else if (_alertViewMode === 'customer') {
    // ── Customer view: group by customer, sorted by worst score ──
    const custSearch = (el('alert-cust-search')?.value || '').trim().toLowerCase();
    const custMap = {};
    active.forEach(a => {
      if (!custMap[a.cid]) custMap[a.cid] = { alerts: [], name: '', score: 100, status: '', mrr: 0 };
      custMap[a.cid].alerts.push(a);
      const c = customers.find(x => x.id === a.cid);
      if (c) {
        custMap[a.cid].name = c.name;
        custMap[a.cid].score = c.score;
        custMap[a.cid].status = c.status;
        custMap[a.cid].mrr = c.mrr || 0;
      }
    });
    // Sort customers: lowest score first, then highest MRR
    let custList = Object.entries(custMap).sort((a,b) => {
      const sd = a[1].score - b[1].score;
      if (sd !== 0) return sd;
      return b[1].mrr - a[1].mrr;
    });
    // Filter by search
    if (custSearch) {
      custList = custList.filter(([, data]) => data.name.toLowerCase().includes(custSearch));
    }
    if (custList.length) {
      custList.forEach(([cid, data]) => {
        const scoreColor = STATUS_COLOR[data.status] || '#94a3b8';
        html += `<div class="alert-group-hd" onclick="toggleAlertGroup(this)">
          <span class="alert-score-circle" style="background:${scoreColor};width:26px;height:26px;font-size:.65rem;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-weight:800">${data.score}</span>
          <span style="cursor:pointer" onclick="event.stopPropagation();openDetail('${escHtml(cid)}')">${escHtml(data.name)}</span>
          ${data.mrr ? `<span style="font-weight:400;color:var(--subtle);font-size:.75rem">$${fmtNum(data.mrr)} MRR</span>` : ''}
          <span style="font-weight:400;color:var(--subtle)">(${data.alerts.length} alert${data.alerts.length !== 1 ? 's' : ''})</span>
        </div>`;
        // Sort alerts within customer by severity
        const sevOrd = { red:0, amber:1, blue:2, green:3 };
        data.alerts.sort((a,b) => (sevOrd[a.type]??9) - (sevOrd[b.type]??9));
        html += `<div class="alert-group-body">${data.alerts.map(a => alertItemHTML(a, false)).join('')}</div>`;
      });
    } else if (custSearch) {
      html += `<div style="text-align:center;padding:28px 16px;color:var(--muted);font-size:.85rem">No customers matching "${escHtml(custSearch)}"</div>`;
    }
  } else if (_alertViewMode === 'table') {
    // ── Table view: customer table inline ──
    const tblSearch = (el('alert-cust-search')?.value || '').trim().toLowerCase();
    // Build customer list from filter or all alerted customers
    const alertedIds = _alertTableFilter ? _alertTableFilter.ids : new Set(active.map(a => a.cid));
    let tblList = customers.filter(c => alertedIds.has(c.id) && passesManagerFilter(c));
    if (tblSearch) tblList = tblList.filter(c => c.name.toLowerCase().includes(tblSearch));
    // Count alerts per customer
    const alertCountMap = {};
    active.forEach(a => { alertCountMap[a.cid] = (alertCountMap[a.cid]||0) + 1; });
    // Sort by current sort key
    const sk = _alertTblSort.key, sd = _alertTblSort.dir;
    tblList.sort((a,b) => {
      let va, vb;
      if (sk === 'name')    { va = (a.name||'').toLowerCase(); vb = (b.name||'').toLowerCase(); return va < vb ? -sd : va > vb ? sd : 0; }
      if (sk === 'score')   { va = a.score||0; vb = b.score||0; }
      else if (sk === 'delta')   { va = getDelta7d(a); vb = getDelta7d(b); }
      else if (sk === 'mrr')     { va = a.mrr||0; vb = b.mrr||0; }
      else if (sk === 'days')    { va = a.days||0; vb = b.days||0; }
      else if (sk === 'renewal') { va = a.renewal!=null?a.renewal:999; vb = b.renewal!=null?b.renewal:999; }
      else if (sk === 'alerts')  { va = alertCountMap[a.id]||0; vb = alertCountMap[b.id]||0; }
      else if (sk === 'tickets') { va = a.tickets||0; vb = b.tickets||0; }
      else if (sk === 'status')  { const so = {critical:0,risk:1,watch:2,healthy:3,expand:4}; va = so[a.status]??5; vb = so[b.status]??5; }
      else if (sk === 'manager') { va = (a.manager||'').toLowerCase(); vb = (b.manager||'').toLowerCase(); return va < vb ? -sd : va > vb ? sd : 0; }
      else { va = 0; vb = 0; }
      return (va - vb) * sd;
    });

    const filterLabel = _alertTableFilter ? _alertTableFilter.label : 'All Alerted Customers';
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <span style="font-size:.78rem;font-weight:700;color:var(--text)">${escHtml(filterLabel)}</span>
      <span style="font-size:.72rem;color:var(--muted)">${tblList.length} customer${tblList.length!==1?'s':''}</span>
      ${_alertTableFilter ? `<button class="btn btn-xs btn-ghost" onclick="_alertTableFilter=null;renderAlerts()">✕ Clear filter</button>` : ''}
    </div>`;

    const _thSort = (key, label) => {
      const active = sk === key;
      const arrow = active ? (sd === 1 ? ' ▲' : ' ▼') : '';
      return `<th class="alert-tbl-th${active?' active':''}" onclick="_alertTblSortBy('${key}')">${label}${arrow}</th>`;
    };

    if (tblList.length) {
      html += `<div style="overflow-x:auto"><table class="ct" style="display:table;width:100%">
        <thead><tr>
          ${_thSort('name','Customer')}
          ${_thSort('score','Score')}
          ${_thSort('delta','Δ 7d')}
          ${_thSort('status','Status')}
          ${_thSort('mrr','MRR')}
          ${_thSort('days','Last Contact')}
          ${_thSort('renewal','Renewal')}
          ${_thSort('alerts','Alerts')}
          ${_thSort('tickets','Tickets')}
          ${_thSort('manager','Manager')}
        </tr></thead><tbody>` +
        tblList.map(c => {
          const cad = getCadenceStatus(c);
          const cnt = alertCountMap[c.id] || 0;
          const d7 = getDelta7d(c);
          const d7Color = d7 > 0 ? '#16a34a' : d7 < 0 ? '#dc2626' : 'var(--muted)';
          const d7Str = d7 > 0 ? '+'+d7 : d7 === 0 ? '—' : String(d7);
          const renewalStr = c.renewal_date ? (() => {
            const d = new Date(c.renewal_date);
            const days = Math.round((d - new Date()) / 86400000);
            return days <= 0 ? '<span style="color:#dc2626;font-weight:700">Overdue</span>'
              : days <= 30 ? `<span style="color:#ea580c;font-weight:700">${days}d</span>`
              : `<span style="color:var(--muted)">${days}d</span>`;
          })() : '—';
          return `<tr style="cursor:pointer" onclick="openDetail('${escHtml(c.id)}')">
            <td style="padding:8px 12px"><strong>${escHtml(c.name)}</strong></td>
            <td style="padding:8px 12px">${scoreHTML(c)}</td>
            <td style="padding:8px 12px;font-size:.78rem;font-weight:700;color:${d7Color}">${d7Str}</td>
            <td style="padding:8px 12px">${badgeHTML(c.status)}</td>
            <td style="padding:8px 12px">${c.mrr ? '$'+fmtNum(c.mrr) : '—'}</td>
            <td style="padding:8px 12px"><span class="${cad.cls}">${cad.label.replace(/\\s*\\(\\d+d\\)/,'')}</span> <span style="font-size:.72rem;color:var(--muted)">${c.days != null ? c.days + 'd' : 'N/A'}</span></td>
            <td style="padding:8px 12px">${renewalStr}</td>
            <td style="padding:8px 12px"><span style="background:var(--red-l);color:var(--red);padding:2px 8px;border-radius:10px;font-size:.72rem;font-weight:700">${cnt}</span></td>
            <td style="padding:8px 12px;color:${c.tickets != null && c.tickets > 0 ? '#dc2626' : 'var(--subtle)'};font-weight:${c.tickets != null && c.tickets > 0 ? '700' : '400'}">${c.tickets != null ? c.tickets : 'N/A'}</td>
            <td style="padding:8px 12px;font-size:.82rem;color:var(--subtle)">${c.manager ? escHtml(c.manager) : '—'}</td>
          </tr>`;
        }).join('') + '</tbody></table></div>';
    } else {
      html += `<div style="text-align:center;padding:28px;color:var(--muted);font-size:.85rem">No matching customers</div>`;
    }
  } else {
    // ── Category view (default) ──
    const cats = ['health','tickets','engagement','renewal','cadence','momentum','sentiment','expansion'];
    cats.forEach(cat => {
      const group = active.filter(a => a.cat === cat);
      if (!group.length) return;
      const def = ALERT_CATS[cat];
      html += `<div class="alert-group-hd" id="alert-grp-${cat}" onclick="toggleAlertGroup(this)">${def.icon} ${def.label} <span style="font-weight:400;color:var(--subtle)">(${group.length})</span></div>`;
      html += `<div class="alert-group-body">${group.map(a => alertItemHTML(a, false)).join('')}</div>`;
    });
  }

  // Snoozed section (shown in alert card views, not table)
  if (snz.length && _alertViewMode !== 'table') {
    html += `<div class="alert-group-hd" style="margin-top:20px" onclick="toggleAlertGroup(this)">${ALERT_ICONS.snoozed} Snoozed <span style="font-weight:400;color:var(--subtle)">(${snz.length})</span></div>`;
    html += `<div class="alert-group-body">${snz.map(a => alertItemHTML(a, true)).join('')}</div>`;
  }

  // Remember which groups are expanded before re-render
  const openGroups = new Set();
  list.querySelectorAll('.alert-group-hd.alert-grp-open, .alert-priority-hd.alert-grp-open').forEach(hd => {
    openGroups.add(hd.id || hd.textContent.replace(/\s+/g,' ').trim().split('(')[0].trim());
  });

  list.innerHTML = html;

  // Restore expanded groups
  if (openGroups.size) {
    list.querySelectorAll('.alert-group-hd, .alert-priority-hd').forEach(hd => {
      const key = hd.id || hd.textContent.replace(/\s+/g,' ').trim().split('(')[0].trim();
      if (openGroups.has(key)) toggleAlertGroup(hd);
    });
  }

  renderAlertPanel(all, active, snz);
  renderAlertBriefing(active, snz);

  // Show/hide "View Snoozed" button
  const vsBtn = el('alerts-view-snoozed-btn');
  if (vsBtn) vsBtn.style.display = snz.length > 0 ? '' : 'none';
}

// ─── ALERT RIGHT PANEL ───────────────────────────────────────
function renderAlertPanel(all, active, snz) {
  // KPI cells
  const critical = active.filter(a => a.cat === 'health' && a.type === 'red').length;
  const renewal  = active.filter(a => a.cat === 'renewal').length;

  function setKpi(id, val, cls) {
    const cell = el(id);
    if (!cell) return;
    cell.querySelector('.alert-kpi-val').textContent = val;
    if (cls) { cell.className = 'alert-kpi-cell alert-kpi-click ' + cls; }
  }
  setKpi('akpi-total',    active.length,                active.length > 0 ? 'red' : '');
  setKpi('akpi-critical', critical,                     critical > 0 ? 'red' : '');
  setKpi('akpi-renewal',  renewal,                      renewal > 0 ? 'blue' : '');
  setKpi('akpi-snoozed',  snz.length,                   snz.length > 0 ? 'amber' : '');

  // MRR exposure
  const mrrWrap = el('alert-mrr-wrap');
  if (mrrWrap) {
    const mrrMap = {
      'Critical/Risk':    { color:'#fca5a5', mrr:0 },
      'Watch':            { color:'#fde68a', mrr:0 },
      'Renewal ≤60d':     { color:'#93c5fd', mrr:0 },
      'No Contact 60d+':  { color:'#c4b5fd', mrr:0 },
      'Poor Sentiment':   { color:'#fda4af', mrr:0 },
      'Low Adoption':     { color:'#fdba74', mrr:0 },
      'Low Logins':       { color:'#fcd34d', mrr:0 }
    };
    // Dedupe by customer (only count each customer once per bucket)
    const seen = {};
    Object.keys(mrrMap).forEach(k => seen[k] = new Set());
    _mrrSeen = seen; // expose for click-to-filter
    // Alert-based buckets
    active.forEach(a => {
      const c = customers.find(x => x.id === a.cid);
      if (!c) return;
      if (a.cat === 'health' && a.type === 'red' && !seen['Critical/Risk'].has(c.id)) { seen['Critical/Risk'].add(c.id); mrrMap['Critical/Risk'].mrr += c.mrr||0; }
      else if (a.cat === 'health' && a.type === 'amber' && !seen['Watch'].has(c.id)) { seen['Watch'].add(c.id); mrrMap['Watch'].mrr += c.mrr||0; }
      if (a.cat === 'renewal' && !seen['Renewal ≤60d'].has(c.id)) { seen['Renewal ≤60d'].add(c.id); mrrMap['Renewal ≤60d'].mrr += c.mrr||0; }
    });
    // Customer-based buckets: no contact 60d+, poor sentiment, low adoption, low logins (respects manager filter)
    customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c)).forEach(c => {
      if (c.days != null && c.days >= 60 && !seen['No Contact 60d+'].has(c.id)) { seen['No Contact 60d+'].add(c.id); mrrMap['No Contact 60d+'].mrr += c.mrr||0; }
      const sent = latestSentiment(c);
      if (sent && sent.val === 'negative' && !seen['Poor Sentiment'].has(c.id)) { seen['Poor Sentiment'].add(c.id); mrrMap['Poor Sentiment'].mrr += c.mrr||0; }
      if (signalOn(c,'adoption') && c.adoption != null && c.adoption < 30 && !seen['Low Adoption'].has(c.id)) { seen['Low Adoption'].add(c.id); mrrMap['Low Adoption'].mrr += c.mrr||0; }
      if (signalOn(c,'logins') && c.logins != null && c.logins < 5 && !seen['Low Logins'].has(c.id)) { seen['Low Logins'].add(c.id); mrrMap['Low Logins'].mrr += c.mrr||0; }
    });
    mrrWrap.innerHTML = Object.entries(mrrMap).map(([label, {color, mrr}]) => `
      <div class="alert-mrr-row" style="cursor:pointer;border-radius:6px;padding:5px 6px;margin:2px -6px;transition:background .15s" onclick="filterByMrrBucket('${label}')" onmouseover="this.style.background='rgba(255,255,255,.08)'" onmouseout="this.style.background=''">
        <div class="alert-mrr-dot" style="background:${color}"></div>
        <div class="alert-mrr-label">${label}</div>
        <div class="alert-mrr-val">$${fmtNum(mrr)}</div>
      </div>`).join('');
  }

  // By category bars
  const catWrap = el('alert-cat-wrap');
  if (catWrap) {
    const catOrder = ['health','tickets','engagement','renewal','cadence','momentum','sentiment','expansion'];
    const catCounts = {};
    catOrder.forEach(c => catCounts[c] = 0);
    active.forEach(a => { if (catCounts[a.cat] !== undefined) catCounts[a.cat]++; });
    const maxCount = Math.max(1, ...Object.values(catCounts));
    const catColors = { health:'#dc2626', tickets:'#ea580c', engagement:'#f59e0b', renewal:'#2563eb', cadence:'#d97706', momentum:'#d97706', sentiment:'#d97706', expansion:'#16a34a' };
    catWrap.innerHTML = catOrder.filter(c => catCounts[c] > 0).map(c => {
      const def = ALERT_CATS[c];
      const pct = Math.round((catCounts[c] / maxCount) * 100);
      return `
        <div class="alert-cat-row" onclick="filterByAlertCat('${c}')">
          <div class="alert-cat-meta">
            <span class="alert-cat-name">${def.icon} ${def.label}</span>
            <span class="alert-cat-count">${catCounts[c]}</span>
          </div>
          <div class="alert-cat-track">
            <div class="alert-cat-bar" style="width:${pct}%;background:${catColors[c]}"></div>
          </div>
        </div>`;
    }).join('') || '<div style="font-size:.78rem;color:rgba(255,255,255,.6)">No active alerts</div>';
  }

  // Priority Actions
  const actWrap = el('alert-actions-wrap');
  if (actWrap) {
    const urgColors = { urgent:'#fca5a5', warn:'#fde68a', expand:'#86efac', renew:'#93c5fd', ok:'rgba(255,255,255,.4)' };
    const urgOrder  = { urgent:0, warn:1, expand:2, renew:3, ok:4 };

    // Dedupe by customer — one action per customer, pick first alert match
    const seen = new Set();
    const items = [];
    active.forEach(a => {
      if (seen.has(a.cid)) return;
      seen.add(a.cid);
      const c = customers.find(x => x.id === a.cid);
      if (!c) return;
      const nba = buildNextBestAction(c);
      // MRR urgency boost: high-value accounts escalate warn → urgent
      let level = nba.level;
      if (level === 'warn' && (c.mrr||0) >= 10000) level = 'urgent';
      items.push({ cid: c.id, name: c.name, level, action: nba.action, mrr: c.mrr||0 });
    });

    // Sort by urgency then by MRR desc
    items.sort((a,b) => (urgOrder[a.level]||4) - (urgOrder[b.level]||4) || b.mrr - a.mrr);

    if (items.length) {
      actWrap.innerHTML = items.slice(0, 4).map(it => `
        <div class="alert-action-row" onclick="openDetail('${escHtml(it.cid)}')">
          <div class="alert-action-dot" style="background:${urgColors[it.level]||'rgba(255,255,255,.4)'}"></div>
          <div class="alert-action-body">
            <div class="alert-action-cust">${escHtml(it.name)}${it.mrr ? ` <span style="font-weight:400;font-size:.7rem;color:rgba(255,255,255,.55)">$${fmtNum(it.mrr)} MRR</span>` : ''}</div>
            <div class="alert-action-text">${escHtml(it.action)}</div>
          </div>
        </div>`).join('');
    } else {
      actWrap.innerHTML = '<div style="font-size:.78rem;color:rgba(255,255,255,.6);text-align:center;padding:12px 0">All clear — no actions needed</div>';
    }
  }
}

// ─── Alert panel → Table filter (stays on alerts page) ──────
function _alertTblSortBy(key) {
  if (_alertTblSort.key === key) _alertTblSort.dir *= -1;
  else { _alertTblSort.key = key; _alertTblSort.dir = key === 'name' || key === 'manager' ? 1 : -1; }
  renderAlerts();
}

function _alertShowTable(label, ids) {
  if (!ids || ids.size === 0) { toast('No customers in this bucket', 'warn'); return; }
  _alertTableFilter = { label, ids: new Set(ids) };
  _alertViewMode = 'table';
  const modeMap = { cat:'category', pri:'priority', cust:'customer', tbl:'table' };
  ['cat','pri','cust','tbl'].forEach(k => {
    const btn = el('alert-view-' + k);
    if (btn) btn.classList.toggle('active', 'table' === modeMap[k]);
  });
  const searchBox = el('alert-cust-search');
  if (searchBox) { searchBox.style.display = ''; searchBox.value = ''; }
  renderAlerts();
  const list = el('alerts-list');
  if (list) _smoothScrollWithOffset(list, 10);
}
function filterByMrrBucket(label) {
  _alertShowTable(label, _mrrSeen[label]);
}
function _smoothScrollWithOffset(target, offset) {
  if (!target) return;
  const main = document.querySelector('main.main');
  if (main && main.scrollHeight > main.clientHeight) {
    const y = target.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - (offset || 20);
    main.scrollTo({ top: y, behavior: 'smooth' });
  } else {
    const y = target.getBoundingClientRect().top + window.scrollY - (offset || 20);
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
}
function filterByAlertKpi(which) {
  // Switch to category view and scroll to the relevant group
  if (_alertViewMode !== 'category') setAlertView('category');
  let scrollTo = null;
  if (which === 'total')    scrollTo = 'alert-grp-health';
  if (which === 'critical') scrollTo = 'alert-grp-health';
  if (which === 'renewal')  scrollTo = 'alert-grp-renewal';
  setTimeout(() => {
    if (which === 'snoozed') {
      const snzHd = document.querySelector('#alerts-list .alert-group-hd:last-of-type');
      _smoothScrollWithOffset(snzHd);
    } else if (scrollTo) {
      _smoothScrollWithOffset(document.getElementById(scrollTo));
    }
  }, 50);
}
function filterByAlertCat(cat) {
  if (_alertViewMode !== 'category') setAlertView('category');
  setTimeout(() => {
    _smoothScrollWithOffset(document.getElementById('alert-grp-' + cat));
  }, 50);
}
function clearMrrExposureFilter() {
  mrrExposureFilter = null;
  renderCustomers();
}

// ════════════════════════════════════════════════════════════════
// Alert Briefing Panel — Smart narrative overview + action list
// ════════════════════════════════════════════════════════════════

function _briefLink(c) {
  return `<strong class="briefing-link" onclick="openDetail('${escHtml(c.id)}')">${escHtml(c.name)}</strong>`;
}

let _briefingGroups = [];
function _briefGroupLink(text, items, tableLabel) {
  const ids = new Set(items.map(x => x.cid || x.id));
  if (!ids.size) return `<strong>${text}</strong>`;
  const idx = _briefingGroups.length;
  _briefingGroups.push({ label: tableLabel || text, ids });
  return `<strong class="briefing-link" onclick="_briefShowGroup(${idx})">${text}</strong>`;
}
function _briefShowGroup(idx) {
  const g = _briefingGroups[idx];
  if (g) _alertShowTable(g.label, g.ids);
}

function _briefingNarrative(active, snz) {
  _briefingGroups = [];
  const total = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!total.length) return '';
  const n = total.length;
  const critRisk   = total.filter(c => c.status === 'critical' || c.status === 'risk');
  const watchAccts = total.filter(c => c.status === 'watch');
  const healthy    = total.filter(c => c.status === 'healthy' || c.status === 'expand');
  const healthPct  = Math.round((healthy.length / n) * 100);

  // MRR
  const riskMrr   = critRisk.reduce((s, c) => s + (c.mrr || 0), 0);
  const totalMrr  = total.reduce((s, c) => s + (c.mrr || 0), 0);
  const riskMrrPct = totalMrr > 0 ? Math.round((riskMrr / totalMrr) * 100) : 0;
  const avgScore = Math.round(total.reduce((s, c) => s + (c.score || 0), 0) / n);

  // Momentum — arrays for group linking
  const improvingAccts = [], decliningAccts = [];
  let biggestDrop = null, biggestRise = null;
  total.forEach(c => {
    const d = getDelta7d(c);
    if (d > 2) { improvingAccts.push(c); if (!biggestRise || d > getDelta7d(biggestRise)) biggestRise = c; }
    else if (d < -2) { decliningAccts.push(c); if (!biggestDrop || d < getDelta7d(biggestDrop)) biggestDrop = c; }
  });

  // Alert buckets — split sentiment from NPS (both cat:'sentiment' but different alerts)
  const renewals     = active.filter(a => a.cat === 'renewal');
  const urgRenewals  = renewals.filter(a => a.type === 'red');
  const cadenceRed   = active.filter(a => a.cat === 'cadence' && a.type === 'red');
  const ticketAlerts = active.filter(a => a.cat === 'tickets');
  const sentNeg      = active.filter(a => a.id.endsWith('-sent'));
  const npsDetract   = active.filter(a => a.id.endsWith('-nps') || a.id.endsWith('-csat'));
  const engAlerts    = active.filter(a => a.cat === 'engagement');
  const expansions   = active.filter(a => a.cat === 'expansion');

  // Touch & coverage
  const recentTouch  = total.filter(c => c.days != null && c.days <= 14).length;
  const touchPct     = Math.round((recentTouch / n) * 100);
  const ghosted      = total.filter(c => c.days != null && c.days > 30);
  const alertCids    = new Set(active.map(a => a.cid));
  const clearCount   = total.filter(c => !alertCids.has(c.id)).length;

  // Cross-signals
  const renewCids = new Set(renewals.map(a => a.cid));
  const riskyRenewals   = critRisk.filter(c => renewCids.has(c.id));
  const silentDecliners = total.filter(c => getDelta7d(c) < -3 && c.days != null && c.days > 21);
  const entAtRisk       = critRisk.filter(c => c.tier === 'enterprise');
  const entMrrAtRisk    = entAtRisk.reduce((s, c) => s + (c.mrr || 0), 0);
  const lowAdoption     = total.filter(c => c.adoption != null && c.adoption < 30 && (c.status === 'healthy' || c.status === 'expand'));
  const lowLogins       = total.filter(c => c.logins != null && c.logins < 5);

  const dow   = new Date().getDay();
  const isMon = dow === 1;
  const isFri = dow === 5;

  // ── Build 3 sections ──
  const working = [];    // What's Working (plain HTML strings)
  const notWorking = []; // What Needs Attention (plain HTML strings)
  const actions = [];    // What To Do — { text, items?, label? } for clickable rows
  const _act = (text, items, label) => actions.push({ text, items: items || null, label: label || '' });

  // ═══ WHAT'S WORKING ═══
  if (healthy.length > 0) {
    working.push(`${_briefGroupLink(healthy.length + '', healthy, 'Healthy / Expanding')} of ${n} accounts (${healthPct}%) are healthy or expanding`);
  }
  if (improvingAccts.length > 0) {
    working.push(`${_briefGroupLink(improvingAccts.length + '', improvingAccts, 'Improving This Week')} account${improvingAccts.length !== 1 ? 's' : ''} improving this week`);
    if (biggestRise && getDelta7d(biggestRise) > 8) {
      working.push(`Biggest gain: ${_briefLink(biggestRise)} +${getDelta7d(biggestRise)} pts`);
    }
  }
  if (touchPct >= 60) {
    working.push(`Outreach coverage at ${touchPct}% — ${touchPct >= 80 ? 'excellent' : 'solid'}`);
  }
  if (expansions.length > 0) {
    const expCusts = expansions.map(a => customers.find(x => x.id === a.cid)).filter(Boolean);
    const expMrr = expCusts.reduce((s, c) => s + (c.mrr || 0), 0);
    working.push(`${_briefGroupLink(expansions.length + '', expCusts, 'Expansion Opportunities')} expansion opportunit${expansions.length === 1 ? 'y' : 'ies'}${expMrr > 0 ? ` across $${fmtNum(expMrr)} MRR` : ''}`);
  }
  if (clearCount > 0 && clearCount >= n * 0.5) {
    const clearAccts = total.filter(c => !alertCids.has(c.id));
    working.push(`${_briefGroupLink(clearCount + '', clearAccts, 'No Alerts')} accounts have zero alerts`);
  }

  // ═══ WHAT NEEDS ATTENTION ═══
  if (critRisk.length > 0) {
    if (critRisk.length <= 3) {
      const names = critRisk.map(c => `${_briefLink(c)} (${c.score})`).join(', ');
      notWorking.push(`${names} — critical/at-risk, $${fmtNum(riskMrr)} MRR exposed${riskMrrPct >= 15 ? ` (${riskMrrPct}% of portfolio)` : ''}`);
    } else {
      notWorking.push(`${_briefGroupLink(critRisk.length + ' accounts', critRisk, 'Critical / At-Risk')} critical or at-risk — $${fmtNum(riskMrr)} MRR exposed${riskMrrPct >= 15 ? ` (${riskMrrPct}% of portfolio)` : ''}`);
    }
  }
  if (riskyRenewals.length > 0) {
    const rrMrr = riskyRenewals.reduce((s, c) => s + (c.mrr || 0), 0);
    const rrNames = riskyRenewals.slice(0, 2).map(c => _briefLink(c)).join(', ');
    const moreLink = riskyRenewals.length > 2 ? ` ${_briefGroupLink('+' + (riskyRenewals.length - 2) + ' more', riskyRenewals, 'At-Risk Renewals')}` : '';
    notWorking.push(`⚠ ${rrNames}${moreLink} — unhealthy AND renewing soon, $${fmtNum(rrMrr)} MRR at direct churn risk`);
  }
  if (entAtRisk.length > 0 && entMrrAtRisk > 0) {
    notWorking.push(`${_briefGroupLink(entAtRisk.length + ' enterprise account' + (entAtRisk.length !== 1 ? 's' : ''), entAtRisk, 'Enterprise At-Risk')} at risk — $${fmtNum(entMrrAtRisk)} high-value MRR`);
  }
  if (silentDecliners.length > 0) {
    const sdNames = silentDecliners.slice(0, 2).map(c => _briefLink(c)).join(', ');
    const moreLink = silentDecliners.length > 2 ? ` ${_briefGroupLink('+' + (silentDecliners.length - 2) + ' more', silentDecliners, 'Silent Decliners')}` : '';
    notWorking.push(`${sdNames}${moreLink} — declining with no contact in 21+ days`);
  }
  if (decliningAccts.length > improvingAccts.length && decliningAccts.length > 0) {
    notWorking.push(`Momentum tilting negative: ${_briefGroupLink(decliningAccts.length + ' declining', decliningAccts, 'Declining Accounts')} vs ${improvingAccts.length} improving`);
    if (biggestDrop && getDelta7d(biggestDrop) < -8) {
      notWorking.push(`Biggest drop: ${_briefLink(biggestDrop)} fell ${Math.abs(getDelta7d(biggestDrop))} pts${biggestDrop.status === 'critical' || biggestDrop.status === 'risk' ? ' — now at risk' : ''}`);
    }
  }
  if (ticketAlerts.length > 0 && sentNeg.length > 0) {
    const tixSentCusts = [...new Set([...ticketAlerts, ...sentNeg].map(a => a.cid))].map(id => customers.find(c => c.id === id)).filter(Boolean);
    notWorking.push(`${_briefGroupLink(ticketAlerts.length + ' with elevated tickets', tixSentCusts, 'Tickets + Sentiment')} + ${sentNeg.length} negative sentiment — possible product/support gap`);
  } else if (ticketAlerts.length > 0) {
    const tixCusts = ticketAlerts.map(a => customers.find(c => c.id === a.cid)).filter(Boolean);
    notWorking.push(`${_briefGroupLink(ticketAlerts.length + ' account' + (ticketAlerts.length !== 1 ? 's' : ''), tixCusts, 'Elevated Tickets')} with elevated support tickets`);
  } else if (sentNeg.length > 0) {
    const sentCusts = sentNeg.map(a => customers.find(c => c.id === a.cid)).filter(Boolean);
    notWorking.push(`${_briefGroupLink(sentNeg.length + ' account' + (sentNeg.length !== 1 ? 's' : ''), sentCusts, 'Negative Sentiment')} logged negative sentiment`);
  }
  if (npsDetract.length > 0) {
    const npsCusts = npsDetract.map(a => customers.find(c => c.id === a.cid)).filter(Boolean);
    notWorking.push(`${_briefGroupLink(npsDetract.length + ' NPS detractor' + (npsDetract.length !== 1 ? 's' : ''), npsCusts, 'NPS Detractors')} on file`);
  }
  if (lowAdoption.length > 0) {
    notWorking.push(`${_briefGroupLink(lowAdoption.length + ' "healthy" account' + (lowAdoption.length !== 1 ? 's' : ''), lowAdoption, 'Low Adoption')} with adoption &lt;30% — hidden churn risk`);
  }
  if (lowLogins.length > 0) {
    const llMrr = lowLogins.reduce((s, c) => s + (c.mrr || 0), 0);
    notWorking.push(`${_briefGroupLink(lowLogins.length + ' account' + (lowLogins.length !== 1 ? 's' : ''), lowLogins, 'Low Logins')} with &lt;5 logins/mo${llMrr > 0 ? ` — $${fmtNum(llMrr)} MRR at risk` : ''}`);
  }
  if (ghosted.length > 0 && touchPct < 50) {
    notWorking.push(`Only ${touchPct}% touched in 14d, ${_briefGroupLink(ghosted.length + '', ghosted, 'Untouched 30+ Days')} untouched for 30+ days`);
  }

  // ═══ WHAT TO DO ═══ (each row is clickable → opens table view)
  if (riskyRenewals.length > 0) {
    _act(`Build escalation plans for ${riskyRenewals.length} at-risk renewal${riskyRenewals.length !== 1 ? 's' : ''}`, riskyRenewals, 'At-Risk Renewals');
  } else if (urgRenewals.length > 0) {
    _act(`Lock in ${urgRenewals.length} renewal${urgRenewals.length !== 1 ? 's' : ''} due within 14 days`, urgRenewals, 'Urgent Renewals');
  } else if (renewals.length > 0) {
    _act(`Prep ${renewals.length} upcoming renewal${renewals.length !== 1 ? 's' : ''} (within 60d)`, renewals, 'Upcoming Renewals');
  }
  if (critRisk.length > 0 && !riskyRenewals.length) {
    _act(`Prioritize outreach to ${critRisk.length} critical/at-risk account${critRisk.length !== 1 ? 's' : ''}`, critRisk, 'Critical / At-Risk');
  }
  if (silentDecliners.length > 0) {
    _act(`Re-engage ${silentDecliners.length} silent decliner${silentDecliners.length !== 1 ? 's' : ''} before scores drop further`, silentDecliners, 'Silent Decliners');
  }
  if (cadenceRed.length > 0 && !silentDecliners.length) {
    _act(`Schedule overdue check-ins for ${cadenceRed.length} account${cadenceRed.length !== 1 ? 's' : ''}`, cadenceRed, 'Overdue Check-ins');
  }
  if (ticketAlerts.length > 0) {
    _act(`Proactive check-in on ${ticketAlerts.length} account${ticketAlerts.length !== 1 ? 's' : ''} with elevated tickets`, ticketAlerts, 'Elevated Tickets');
  }
  if (sentNeg.length > 0) {
    _act(`Follow up on ${sentNeg.length} negative sentiment log${sentNeg.length !== 1 ? 's' : ''}`, sentNeg, 'Negative Sentiment');
  }
  if (npsDetract.length > 0) {
    _act(`Address ${npsDetract.length} NPS detractor${npsDetract.length !== 1 ? 's' : ''} — schedule recovery calls`, npsDetract, 'NPS Detractors');
  }
  if (expansions.length > 0) {
    _act(`Start growth conversations with ${expansions.length} expansion-ready account${expansions.length !== 1 ? 's' : ''}`, expansions, 'Expansion Opportunities');
  }
  if (lowAdoption.length > 0) {
    _act(`Drive adoption for ${lowAdoption.length} under-utilized account${lowAdoption.length !== 1 ? 's' : ''}`, lowAdoption, 'Low Adoption');
  }
  if (lowLogins.length > 0) {
    _act(`Investigate low login activity on ${lowLogins.length} account${lowLogins.length !== 1 ? 's' : ''} — schedule engagement calls`, lowLogins, 'Low Logins');
  }
  if (ghosted.length > 0 && touchPct < 50) {
    _act(`${isFri ? 'Block time Monday to' : 'Prioritize'} outreach to ${ghosted.length} untouched account${ghosted.length !== 1 ? 's' : ''}`, ghosted, 'Untouched 30+ Days');
  }

  // All clear
  if (!notWorking.length && !actions.length) {
    const suggestions = [];
    if (total.some(c => c.status === 'expand')) suggestions.push('expansion conversations');
    if (renewals.length === 0) suggestions.push('early renewal planning');
    if (touchPct < 60) suggestions.push('outreach to untouched accounts');
    suggestions.push('strategic QBR prep');
    _act(`No urgent items — focus on ${suggestions.slice(0, 2).join(' or ')}`);
  }

  if (snz.length > 0) {
    _act(`Circle back on ${snz.length} snoozed alert${snz.length !== 1 ? 's' : ''}`, snz, 'Snoozed Alerts');
  }

  // Build sectioned HTML
  const sectionIcon = (icon, color) => `<span style="font-size:.72rem;margin-right:2px;color:${color}">${icon}</span>`;
  let html = '';

  if (working.length) {
    html += `<div class="briefing-section"><div class="briefing-section-hd">${sectionIcon('✅','var(--green)')} What's Working</div><ul class="briefing-list good">${working.map(l => `<li>${l}</li>`).join('')}</ul></div>`;
  }
  if (notWorking.length) {
    html += `<div class="briefing-section"><div class="briefing-section-hd">${sectionIcon('⚠','var(--amber)')} Needs Attention</div><ul class="briefing-list warn">${notWorking.map(l => `<li>${l}</li>`).join('')}</ul></div>`;
  }
  if (actions.length) {
    const actionLis = actions.map(a => {
      if (a.items && a.items.length) {
        const ids = new Set(a.items.map(x => x.cid || x.id));
        const idx = _briefingGroups.length;
        _briefingGroups.push({ label: a.label, ids });
        return `<li class="briefing-link-row" onclick="_briefShowGroup(${idx})">${a.text}</li>`;
      }
      return `<li>${a.text}</li>`;
    }).join('');
    html += `<div class="briefing-section"><div class="briefing-section-hd">${sectionIcon('📋','var(--blue)')} Action Items</div><ul class="briefing-list action">${actionLis}</ul></div>`;
  }

  return html;
}

function renderAlertBriefing(active, snz) {
  const wrap = el('alert-briefing');
  if (!wrap) return;

  // Hide if no customers loaded or no manager selected
  const total    = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!customers.length || !total.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  const n        = total.length;
  const healthy  = total.filter(c => c.status === 'healthy' || c.status === 'expand');
  const alertCids = new Set(active.map(a => a.cid));
  const clearPct  = n ? Math.round((total.filter(c => !alertCids.has(c.id)).length / n) * 100) : 0;
  const recentTouch = total.filter(c => c.days != null && c.days <= 14).length;
  const avgScore  = n ? Math.round(total.reduce((s, c) => s + (c.score || 0), 0) / n) : 0;
  const expansions = active.filter(a => a.cat === 'expansion');

  // Determine overall sentiment for accent color
  const critRisk = total.filter(c => c.status === 'critical' || c.status === 'risk');
  let accentCls = 'good';
  if (critRisk.length >= 3) accentCls = 'critical';
  else if (critRisk.length >= 1) accentCls = 'caution';
  else if (active.filter(a => a.type === 'red' || a.type === 'amber').length > 0) accentCls = 'caution';

  // ── Narrative ──
  const narrative = _briefingNarrative(active, snz);

  // ── Quick stats row ──
  const stats = [
    { icon: '💯', val: avgScore, lbl: 'Avg Score', cls: avgScore >= 65 ? 'stat-green' : avgScore >= 50 ? 'stat-amber' : 'stat-red' },
    { icon: '💚', val: healthy.length + '/' + n, lbl: 'Healthy', cls: 'stat-green' },
    { icon: '🔕', val: clearPct + '%', lbl: 'No Alerts', cls: clearPct >= 70 ? 'stat-green' : 'stat-amber' },
    { icon: '📞', val: recentTouch, lbl: 'Touched <14d', cls: '' },
    { icon: '🚀', val: expansions.length, lbl: 'Expansions', cls: expansions.length > 0 ? 'stat-green' : '' },
  ];
  const statsHtml = stats.map(s =>
    `<div class="briefing-kpi ${s.cls}"><div class="briefing-kpi-val">${s.val}</div><div class="briefing-kpi-lbl">${s.lbl}</div></div>`
  ).join('');

  // ── Assemble ──
  wrap.innerHTML = `
    <div class="briefing-accent ${accentCls}"></div>
    <div class="briefing-body">
      <div class="alert-briefing-hd">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
        Portfolio Briefing
      </div>
      <div class="briefing-stats-row">${statsHtml}</div>
      <div class="briefing-text">${narrative}</div>
    </div>`;
}

function tierChip(tier) {
  const map = { smb:'SMB', mid:'Mid-Market', enterprise:'Enterprise' };
  const label = map[tier] || tier || '';
  if (!label) return '';
  return `<span class="alert-tier-chip">${label}</span>`;
}

function alertItemHTML(a, isSnzd) {
  const def   = ALERT_CATS[a.cat] || ALERT_CATS.health;
  const sel   = _selectedAlerts.has(a.id);
  const scoreColor = STATUS_COLOR[a._status] || '#94a3b8';
  const scoreVal   = (a._score != null) ? a._score : '—';
  return `
    <div class="alert-item ${a.type} ${isSnzd?'snoozed':''} ${sel?'selected':''}" id="alert-row-${escHtml(a.id)}" onclick="openDetail('${escHtml(a.cid)}')">
      <div class="alert-score-circle" style="background:${scoreColor}">${scoreVal}</div>
      <input type="checkbox" class="alert-item__check" ${sel?'checked':''} onclick="event.stopPropagation();alertToggleSelect('${escHtml(a.id)}',this,event)" title="Select">
      <div class="alert-item__icon">${def.icon}</div>
      <div class="alert-item__body">
        <div class="alert-item__text">${a.msg}</div>
        <div class="alert-item__meta">
          <span class="alert-item__cat ${a.type}">${def.label}</span>
          ${a._mrr != null ? `<span style="color:var(--subtle);font-weight:600">$${fmtNum(a._mrr)}</span>` : ''}
          ${tierChip(a._tier)}
          ${a._manager ? `<span class="alert-meta-csm">CSM: ${escHtml(a._manager)}</span>` : ''}
          ${a._days > 0 ? `<span class="alert-meta-days">${a._days}d since touch</span>` : ''}
        </div>
      </div>
      <div class="alert-item__actions">
        ${isSnzd
          ? `<button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();unsnooze('${escHtml(a.id)}')">Wake</button>`
          : `<div class="snooze-dd"><button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();toggleSnoozeDd('${escHtml(a.id)}')">Snooze ▾</button>
             <div class="snooze-dd__menu" id="snooze-dd-${escHtml(a.id)}">
               <button class="snooze-dd__item" onclick="event.stopPropagation();snoozeAlert('${escHtml(a.id)}',1)">1 day</button>
               <button class="snooze-dd__item" onclick="event.stopPropagation();snoozeAlert('${escHtml(a.id)}',7)">7 days</button>
               <button class="snooze-dd__item" onclick="event.stopPropagation();snoozeAlert('${escHtml(a.id)}',30)">30 days</button>
             </div></div>
             <button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();dismissAlert('${escHtml(a.id)}')" title="Dismiss">✕</button>`}
        <button class="btn btn-xs btn-outline" onclick="event.stopPropagation();openDetail('${escHtml(a.cid)}')">View →</button>
      </div>
    </div>`;
}

function toggleSnoozeDd(aid) {
  document.querySelectorAll('.snooze-dd__menu').forEach(m => {
    if (m.id !== 'snooze-dd-'+aid) m.classList.remove('open');
  });
  el('snooze-dd-'+aid)?.classList.toggle('open');
}

// Close snooze dropdowns when clicking outside
document.addEventListener('click', () => {
  document.querySelectorAll('.snooze-dd__menu.open').forEach(m => m.classList.remove('open'));
});

// Sticky bar shadow when scrolled
(function() {
  const bar = document.getElementById('alert-sticky-bar');
  if (!bar) return;
  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'height:1px;margin:0;padding:0;visibility:hidden;pointer-events:none';
  bar.parentElement.insertBefore(sentinel, bar);
  const obs = new IntersectionObserver(([e]) => {
    bar.classList.toggle('stuck', !e.isIntersecting);
  }, { threshold: [1] });
  obs.observe(sentinel);
})();

function isSnoozed(aid) {
  if (!snoozed.has(aid)) return false;
  const expiry = snoozed.get(aid);
  if (Date.now() > expiry) { snoozed.delete(aid); return false; }
  return true;
}

function _alertAuditInfo(aid) {
  const a = buildAlerts().find(x => x.id === aid);
  const cust = a ? customers.find(x => x.id === a.cid) : null;
  return { custId: cust?.id||null, custName: cust?.name||'', catLabel: a ? (ALERT_CATS[a.cat]?.label||a.cat) : '' };
}

function snoozeAlert(aid, days=7) {
  const ai = _alertAuditInfo(aid);
  const expiry = Date.now() + days * 86400000;
  snoozed.set(aid, expiry);
  saveSettings();
  logAudit('alert_snoozed', ai.custId, ai.custName, { summary: `Alert snoozed for ${days}d — ${ai.catLabel}` });
  renderAlerts();

  toast(`Alert snoozed for ${days} day${days===1?'':'s'} ⏱`, 'default');
}

function isDismissed(aid) {
  if (!dismissed.has(aid)) return false;
  // Extract customer id from alert id (format: custId-alertType)
  const cid = aid.replace(/-[^-]+$/, '');
  const c = customers.find(x => x.id === cid);
  if (!c) return false;
  // Only stay dismissed if score hasn't changed
  return c.score === dismissed.get(aid);
}

function dismissAlert(aid) {
  const ai = _alertAuditInfo(aid);
  // Store the customer's current score so alert reappears if score changes
  const cid = aid.replace(/-[^-]+$/, '');
  const c = customers.find(x => x.id === cid);
  dismissed.set(aid, c ? c.score : null);
  saveSettings();
  logAudit('alert_dismissed', ai.custId, ai.custName, { summary: `Alert dismissed — ${ai.catLabel}` });
  renderAlerts();

  toast('Alert dismissed', 'default');
}

function unsnooze(aid) {
  const ai = _alertAuditInfo(aid);
  snoozed.delete(aid);
  saveSettings();
  logAudit('alert_unsnoozed', ai.custId, ai.custName, { summary: `Alert unsnoozed — ${ai.catLabel}` });
  renderAlerts();

}

function clearSnoozed() {
  snoozed.clear();
  saveSettings();
  logAudit('alerts_cleared', null, '', { summary: 'All snoozed alerts cleared' });
  renderAlerts();

  toast('Snoozed alerts cleared', 'success');
}

function viewSnoozedAlerts() {
  // Switch to category view if in table mode (snoozed section only shows in card views)
  if (_alertViewMode === 'table') setAlertView('category');
  setTimeout(() => {
    // Find the snoozed group header and expand + scroll to it
    const headers = document.querySelectorAll('#alerts-list .alert-group-hd');
    for (const hd of headers) {
      if (hd.textContent.includes('Snoozed')) {
        // Expand if collapsed
        const body = hd.nextElementSibling;
        if (body && body.classList.contains('alert-group-body') && getComputedStyle(body).display === 'none') {
          toggleAlertGroup(hd);
        }
        _smoothScrollWithOffset(hd);
        return;
      }
    }
  }, 50);
}

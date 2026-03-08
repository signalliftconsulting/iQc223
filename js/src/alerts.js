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
  quiet:     _ico('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'),
};
const ALERT_CATS = {
  health:     { label:'Health',     icon: ALERT_ICONS.health,     type:'red'   },
  renewal:    { label:'Renewal',    icon: ALERT_ICONS.renewal,    type:'blue'  },
  cadence:    { label:'Cadence',    icon: ALERT_ICONS.cadence,    type:'amber' },
  sentiment:  { label:'Sentiment',  icon: ALERT_ICONS.sentiment,  type:'amber' },
  momentum:   { label:'Momentum',   icon: ALERT_ICONS.momentum,   type:'amber' },
  tickets:    { label:'Support',    icon: ALERT_ICONS.tickets,    type:'red'   },
  engagement: { label:'Engagement', icon: ALERT_ICONS.engagement, type:'amber' },
  quiet:      { label:'Quiet',      icon: ALERT_ICONS.quiet,      type:'amber' },
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
      if (days >= 0 && days <= renewalWindows.upcoming) {
        const urgency = days <= renewalWindows.critical ? 'red' : days <= renewalWindows.warning ? 'amber' : 'blue';
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

    // ── Quiet Account (zero activity across all signals) ──
    if (isQuietAccount(c)) {
      const qDays = getQuietDays(c);
      const qType = qDays >= 30 ? 'red' : 'amber';
      alerts.push({ id:c.id+'-quiet', cid:c.id, cat:'quiet', type:qType,
        msg:`<strong>${escHtml(c.name)}</strong> <span>has gone completely quiet — ${qDays} days, zero activity</span>`,
        sub:`No logins · No tickets · No contact · MRR $${fmtNum(c.mrr||0)}`, ...snap(c) });
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
        html += `<div class="alert-group-hd" data-cid="${escHtml(cid)}" onclick="toggleAlertGroup(this)">
          <span class="alert-score-circle" style="background:${scoreColor};width:26px;height:26px;font-size:var(--fs-xs);display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-weight:800">${data.score}</span>
          <span style="cursor:pointer" onclick="event.stopPropagation();openDetail('${escHtml(cid)}')">${escHtml(data.name)}</span>
          ${data.mrr ? `<span style="font-weight:400;color:var(--subtle);font-size:var(--fs-sm)">$${fmtNum(data.mrr)} MRR</span>` : ''}
          <span style="font-weight:400;color:var(--subtle)">(${data.alerts.length} alert${data.alerts.length !== 1 ? 's' : ''})</span>
        </div>`;
        // Sort alerts within customer by severity
        const sevOrd = { red:0, amber:1, blue:2, green:3 };
        data.alerts.sort((a,b) => (sevOrd[a.type]??9) - (sevOrd[b.type]??9));
        html += `<div class="alert-group-body">${data.alerts.map(a => alertItemHTML(a, false)).join('')}</div>`;
      });
    } else if (custSearch) {
      html += `<div style="text-align:center;padding:28px 16px;color:var(--muted);font-size:var(--fs-md)">No customers matching "${escHtml(custSearch)}"</div>`;
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
      <span style="font-size:var(--fs-base);font-weight:700;color:var(--text)">${escHtml(filterLabel)}</span>
      <span style="font-size:var(--fs-sm);color:var(--muted)">${tblList.length} customer${tblList.length!==1?'s':''}</span>
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
            <td style="padding:8px 12px;font-size:var(--fs-base);font-weight:700;color:${d7Color}">${d7Str}</td>
            <td style="padding:8px 12px">${badgeHTML(c.status)}</td>
            <td style="padding:8px 12px">${c.mrr ? '$'+fmtNum(c.mrr) : '—'}</td>
            <td style="padding:8px 12px"><span class="${cad.cls}">${cad.label.replace(/\\s*\\(\\d+d\\)/,'')}</span> <span style="font-size:var(--fs-sm);color:var(--muted)">${c.days != null ? c.days + 'd' : 'N/A'}</span></td>
            <td style="padding:8px 12px">${renewalStr}</td>
            <td style="padding:8px 12px"><span style="background:var(--red-l);color:var(--red);padding:2px 8px;border-radius:10px;font-size:var(--fs-sm);font-weight:700">${cnt}</span></td>
            <td style="padding:8px 12px;color:${c.tickets != null && c.tickets > 0 ? '#dc2626' : 'var(--subtle)'};font-weight:${c.tickets != null && c.tickets > 0 ? '700' : '400'}">${c.tickets != null ? c.tickets : 'N/A'}</td>
            <td style="padding:8px 12px;font-size:var(--fs-base);color:var(--subtle)">${c.manager ? escHtml(c.manager) : '—'}</td>
          </tr>`;
        }).join('') + '</tbody></table></div>';
    } else {
      html += `<div style="text-align:center;padding:28px;color:var(--muted);font-size:var(--fs-md)">No matching customers</div>`;
    }
  } else {
    // ── Category view (default) ──
    const cats = ['health','tickets','quiet','engagement','renewal','cadence','momentum','sentiment','expansion'];
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

  // Restore expanded groups, or auto-expand first group on fresh render
  const allHeaders = list.querySelectorAll('.alert-group-hd, .alert-priority-hd');
  if (openGroups.size) {
    allHeaders.forEach(hd => {
      const key = hd.id || hd.textContent.replace(/\s+/g,' ').trim().split('(')[0].trim();
      if (openGroups.has(key)) toggleAlertGroup(hd);
    });
  } else if (allHeaders.length > 0 && _alertViewMode !== 'table') {
    // Auto-expand the first group so the page isn't all collapsed headers
    toggleAlertGroup(allHeaders[0]);
  }

  renderAlertPanel(all, active, snz);

  // Show/hide "View Snoozed" button
  const vsBtn = el('alerts-view-snoozed-btn');
  if (vsBtn) vsBtn.style.display = snz.length > 0 ? '' : 'none';
}

// ─── ALERT RIGHT PANEL ───────────────────────────────────────
function renderAlertPanel(all, active, snz) {
  // ── Compute KPI values ──
  const renewal = active.filter(a => a.cat === 'renewal').length;
  const totalSub = renewal > 0
    ? renewal + ' renewal' + (renewal !== 1 ? 's' : '') + ' \u226460d'
    : active.length === 0 ? 'all clear' : 'across your book';

  const critical = active.filter(a => a.cat === 'health' && a.type === 'red').length;
  const critSub = critical === 0 ? 'none flagged' : 'health alerts';

  const affectedIds = new Set(active.map(a => a.cid));
  const totalBook = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c)).length;
  let mrrExposed = 0;
  const mrrSeen = new Set();
  active.forEach(a => {
    if (mrrSeen.has(a.cid)) return;
    const c = customers.find(x => x.id === a.cid);
    if (!c) return;
    if (c.status === 'critical' || c.status === 'risk') { mrrSeen.add(a.cid); mrrExposed += c.mrr || 0; }
  });
  const mrrStr = mrrExposed > 0 ? '$' + fmtNum(mrrExposed) : '$0';
  const mrrSubStr = mrrSeen.size > 0 ? mrrSeen.size + ' account' + (mrrSeen.size !== 1 ? 's' : '') + ' at risk' : 'no revenue at risk';

  const pctAlerting = totalBook > 0 ? Math.round((affectedIds.size / totalBook) * 100) : 0;
  const acctSub = pctAlerting > 0 ? pctAlerting + '% of book' : 'affected';

  const snzSub = snz.length === 0 ? 'none paused' : 'paused';

  // ── Render gradient KPI cards (matching Dashboard/Trends/Segments) ──
  const _kI = (d) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const kpiRow = el('alert-kpi-row');
  if (kpiRow) {
    kpiRow.innerHTML = `
      <div class="dash-kpi-card dash-kpi-blue" onclick="filterByAlertKpi('all')">
        <div class="dash-kpi-top">
          <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${_kI('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>')}</div>
          <span class="dash-kpi-label">Active Alerts</span>
        </div>
        <div class="dash-kpi-num">${active.length}</div>
        <div class="dash-kpi-sub">${escHtml(totalSub)}</div>
      </div>
      <div class="dash-kpi-card ${critical > 0 ? 'dash-kpi-red' : 'dash-kpi-green'}" onclick="filterByAlertKpi('critical')">
        <div class="dash-kpi-top">
          <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${_kI('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>')}</div>
          <span class="dash-kpi-label">Critical / Risk</span>
        </div>
        <div class="dash-kpi-num">${critical}</div>
        <div class="dash-kpi-sub">${escHtml(critSub)}</div>
      </div>
      <div class="dash-kpi-card ${mrrExposed > 0 ? 'dash-kpi-amber' : 'dash-kpi-teal'}" onclick="filterByAlertKpi('mrr')">
        <div class="dash-kpi-top">
          <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${_kI('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>')}</div>
          <span class="dash-kpi-label">MRR Exposed</span>
        </div>
        <div class="dash-kpi-num">${mrrStr}</div>
        <div class="dash-kpi-sub">${escHtml(mrrSubStr)}</div>
      </div>
      <div class="dash-kpi-card dash-kpi-purple" onclick="filterByAlertKpi('accounts')">
        <div class="dash-kpi-top">
          <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${_kI('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>')}</div>
          <span class="dash-kpi-label">Accounts</span>
        </div>
        <div class="dash-kpi-num">${affectedIds.size}</div>
        <div class="dash-kpi-sub">${escHtml(acctSub)}</div>
      </div>
      <div class="dash-kpi-card dash-kpi-indigo" onclick="filterByAlertKpi('snoozed')">
        <div class="dash-kpi-top">
          <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${_kI('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>')}</div>
          <span class="dash-kpi-label">Snoozed</span>
        </div>
        <div class="dash-kpi-num">${snz.length}</div>
        <div class="dash-kpi-sub">${escHtml(snzSub)}</div>
      </div>`;
  }

  // ── MRR Exposure detail card ──
  const mrrWrap = el('alert-mrr-wrap');
  if (mrrWrap) {
    const mrrMap = {
      'Critical/Risk':    { color:'#dc2626', mrr:0 },
      'Watch':            { color:'#d97706', mrr:0 },
      'Renewal \u226460d': { color:'#2563eb', mrr:0 },
      'No Contact 60d+':  { color:'#7c3aed', mrr:0 },
      'Poor Sentiment':   { color:'#be123c', mrr:0 },
      'Low Adoption':     { color:'#ea580c', mrr:0 },
      'Low Logins':       { color:'#ca8a04', mrr:0 },
      'Quiet Accounts':   { color:'#6d28d9', mrr:0 }
    };
    const seen = {};
    Object.keys(mrrMap).forEach(k => seen[k] = new Set());
    _mrrSeen = seen;
    active.forEach(a => {
      const c = customers.find(x => x.id === a.cid);
      if (!c) return;
      if (a.cat === 'health' && a.type === 'red' && !seen['Critical/Risk'].has(c.id)) { seen['Critical/Risk'].add(c.id); mrrMap['Critical/Risk'].mrr += c.mrr||0; }
      else if (a.cat === 'health' && a.type === 'amber' && !seen['Watch'].has(c.id)) { seen['Watch'].add(c.id); mrrMap['Watch'].mrr += c.mrr||0; }
      if (a.cat === 'renewal' && !seen['Renewal \u226460d'].has(c.id)) { seen['Renewal \u226460d'].add(c.id); mrrMap['Renewal \u226460d'].mrr += c.mrr||0; }
    });
    customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c)).forEach(c => {
      if (c.days != null && c.days >= 60 && !seen['No Contact 60d+'].has(c.id)) { seen['No Contact 60d+'].add(c.id); mrrMap['No Contact 60d+'].mrr += c.mrr||0; }
      const sent = latestSentiment(c);
      if (sent && sent.val === 'negative' && !seen['Poor Sentiment'].has(c.id)) { seen['Poor Sentiment'].add(c.id); mrrMap['Poor Sentiment'].mrr += c.mrr||0; }
      if (signalOn(c,'adoption') && c.adoption != null && c.adoption < 30 && !seen['Low Adoption'].has(c.id)) { seen['Low Adoption'].add(c.id); mrrMap['Low Adoption'].mrr += c.mrr||0; }
      if (signalOn(c,'logins') && c.logins != null && c.logins < 5 && !seen['Low Logins'].has(c.id)) { seen['Low Logins'].add(c.id); mrrMap['Low Logins'].mrr += c.mrr||0; }
      if (isQuietAccount(c) && !seen['Quiet Accounts'].has(c.id)) { seen['Quiet Accounts'].add(c.id); mrrMap['Quiet Accounts'].mrr += c.mrr||0; }
    });
    const rows = Object.entries(mrrMap).filter(([, {mrr}]) => mrr > 0).sort((a, b) => b[1].mrr - a[1].mrr);
    const maxMrr = rows.length > 0 ? rows[0][1].mrr : 1;
    const totalMrrExposed = rows.reduce((s, [, {mrr}]) => s + mrr, 0);
    const mrrTotalEl = el('alert-mrr-total');
    if (mrrTotalEl) mrrTotalEl.textContent = '$' + fmtNum(totalMrrExposed);
    const mrrRows = rows.map(([label, {color, mrr}]) => {
      const pct = Math.round((mrr / maxMrr) * 100);
      return `
        <div style="display:flex;align-items:center;gap:6px;white-space:nowrap;cursor:pointer" onclick="filterByMrrBucket('${label}')">
          <div class="alert-mrr-dot" style="background:${color}"></div>
          <span class="alert-mrr-label">${label}</span>
        </div>
        <div style="height:7px;background:var(--border);border-radius:100px;overflow:hidden;cursor:pointer" onclick="filterByMrrBucket('${label}')">
          <div style="width:${pct}%;height:100%;background:${color};border-radius:100px;transition:width .4s"></div>
        </div>
        <div class="alert-mrr-val" style="font-weight:800;color:${color};white-space:nowrap;text-align:right;font-size:var(--fs-md);cursor:pointer" onclick="filterByMrrBucket('${label}')">$${fmtNum(mrr)}</div>`;
    }).join('');
    mrrWrap.innerHTML = mrrRows
      ? `<div style="display:grid;grid-template-columns:auto 1fr auto;gap:6px 10px;align-items:center">${mrrRows}</div>`
      : '<div class="alerts-detail-empty" style="padding:20px 0;text-align:center;color:var(--muted)">No MRR at risk — looking good!</div>';
  }

  // ── By Category detail card ──
  const catWrap = el('alert-cat-wrap');
  if (catWrap) {
    const catOrder = ['health','tickets','quiet','engagement','renewal','cadence','momentum','sentiment','expansion'];
    const catCounts = {};
    catOrder.forEach(c => catCounts[c] = 0);
    active.forEach(a => { if (catCounts[a.cat] !== undefined) catCounts[a.cat]++; });
    const totalAlerts = Object.values(catCounts).reduce((s, v) => s + v, 0);
    const catTotalEl = el('alert-cat-total');
    if (catTotalEl) catTotalEl.textContent = totalAlerts;
    const maxCount = Math.max(1, ...Object.values(catCounts));
    const catColors = { health:'#dc2626', tickets:'#ea580c', quiet:'#7c3aed', engagement:'#d97706', renewal:'#2563eb', cadence:'#b45309', momentum:'#ca8a04', sentiment:'#be123c', expansion:'#16a34a' };
    const catRows = catOrder.filter(c => catCounts[c] > 0).map(c => {
      const def = ALERT_CATS[c];
      const pct = Math.round((catCounts[c] / maxCount) * 100);
      return `
        <div style="display:flex;align-items:center;gap:5px;white-space:nowrap;cursor:pointer" onclick="filterByAlertCat('${c}')">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:5px;background:${catColors[c]}15;font-size:var(--fs-xs)">${def.icon}</span>
          <span class="alert-cat-name">${def.label}</span>
        </div>
        <div style="height:7px;background:var(--border);border-radius:100px;overflow:hidden;cursor:pointer" onclick="filterByAlertCat('${c}')">
          <div style="width:${pct}%;height:100%;background:${catColors[c]};border-radius:100px;transition:width .4s"></div>
        </div>
        <div style="text-align:right;cursor:pointer" onclick="filterByAlertCat('${c}')">
          <span style="background:${catColors[c]}12;color:${catColors[c]};padding:2px 9px;border-radius:100px;font-size:var(--fs-md);font-weight:800;white-space:nowrap">${catCounts[c]}</span>
        </div>`;
    }).join('');
    catWrap.innerHTML = catRows
      ? `<div style="display:grid;grid-template-columns:auto 1fr auto;gap:6px 10px;align-items:center">${catRows}</div>`
      : '<div class="alerts-detail-empty" style="padding:20px 0;text-align:center;color:var(--muted)">No active alerts — all clear!</div>';
  }

  // ── By Stage detail card ──
  const stageWrap = el('alert-stage-wrap');
  if (stageWrap) {
    const stageDefs = [
      { key: 'onboarding', label: 'Onboarding', color: '#3b82f6' },
      { key: 'active',     label: 'Active',     color: '#10b981' },
      { key: 'atrisk',     label: 'At Risk',    color: '#ef4444' },
      { key: 'won',        label: 'Won / Upsold', color: '#8b5cf6' },
      { key: 'churned',    label: 'Churned',    color: '#64748b' }
    ];
    const stageCounts = {};
    stageDefs.forEach(s => stageCounts[s.key] = 0);
    active.forEach(a => {
      const c = customers.find(x => x.id === a.cid);
      if (c) { const lc = c.lifecycle || 'active'; if (stageCounts[lc] !== undefined) stageCounts[lc]++; }
    });
    const stagesWithAlerts = stageDefs.filter(s => stageCounts[s.key] > 0);
    const stageTotalEl = el('alert-stage-total');
    if (stageTotalEl) stageTotalEl.textContent = stagesWithAlerts.length;
    const maxStageCount = Math.max(1, ...Object.values(stageCounts));
    const stageRows = stagesWithAlerts.map(s => {
      const cnt = stageCounts[s.key];
      const pct = Math.round((cnt / maxStageCount) * 100);
      return `
        <div style="display:flex;align-items:center;gap:6px;white-space:nowrap">
          <div style="width:8px;height:8px;border-radius:50%;background:${s.color};flex-shrink:0"></div>
          <span style="font-size:var(--fs-base);font-weight:600;color:var(--text)">${s.label}</span>
        </div>
        <div style="height:7px;background:var(--border);border-radius:100px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${s.color};border-radius:100px;transition:width .4s"></div>
        </div>
        <div style="text-align:right">
          <span style="background:${s.color}12;color:${s.color};padding:2px 9px;border-radius:100px;font-size:var(--fs-md);font-weight:800;white-space:nowrap">${cnt}</span>
        </div>`;
    }).join('');
    stageWrap.innerHTML = stageRows
      ? `<div style="display:grid;grid-template-columns:auto 1fr auto;gap:6px 10px;align-items:center">${stageRows}</div>`
      : '<div class="alerts-detail-empty" style="padding:20px 0;text-align:center;color:var(--muted)">No active alerts — all clear!</div>';
  }

  // Insights — surface actionable patterns across alerts
  const insWrap = el('alert-insights-wrap');
  if (insWrap) {
    const insights = [];
    const _iSvg = (d) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    // Helper: clickable customer name link (opens detail, stops card click)
    const _nameLink = (c) => `<strong class="ta-name-link" onclick="event.stopPropagation();openDetail('${c.id}')">${escHtml(c.name)}</strong>`;

    // Helper: build unique affected-customer list from alert array
    const uniqueCusts = (alerts) => {
      const seen = new Set(), out = [];
      alerts.forEach(a => { if (seen.has(a.cid)) return; seen.add(a.cid); const c = customers.find(x => x.id === a.cid); if (c) out.push(c); });
      return out;
    };

    // ── 1. Renewals at Risk — renewing soon AND unhealthy ──
    const renewalAlerts = active.filter(a => a.cat === 'renewal');
    if (renewalAlerts.length > 0) {
      const healthRiskIds = new Set(active.filter(a => a.cat === 'health' && a.type === 'red').map(a => a.cid));
      const atRiskRenewals = renewalAlerts.filter(a => healthRiskIds.has(a.cid));
      if (atRiskRenewals.length > 0) {
        const custs = uniqueCusts(atRiskRenewals);
        const renewMrr = custs.reduce((s, c) => s + (c.mrr || 0), 0);
        const nameList = custs.slice(0, 2).map(c => _nameLink(c));
        const extra = custs.length > 2 ? ` and ${custs.length - 2} more` : '';
        const rCids = custs.map(c => c.id);
        insights.push({
          score: 95 + custs.length, label: 'Renewals at Risk', accent: 'red',
          icon: _iSvg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
          iconBg: 'var(--red-l)', iconColor: 'var(--red)',
          cids: rCids, navMode: rCids.length === 1 ? 'customer' : 'table', navLabel: 'Renewals at Risk',
          text: `${nameList.join(' and ')}${extra} ${custs.length === 1 ? 'is' : 'are'} up for renewal while sitting at Critical or At Risk health. That's <strong>$${fmtNum(renewMrr)} MRR</strong> on the line — prioritize outreach before the renewal conversation starts.`
        });
      }
    }

    // ── 2. Biggest Account at Risk — highest-MRR critical/risk account with specific issues ──
    const healthAlerts = active.filter(a => a.cat === 'health' && a.type === 'red');
    if (healthAlerts.length > 0) {
      const riskCusts = uniqueCusts(healthAlerts).sort((a, b) => (b.mrr || 0) - (a.mrr || 0));
      const top = riskCusts[0];
      if (top && (top.mrr || 0) > 0) {
        // Collect what's wrong with this account
        const issues = [];
        const tAlerts = active.filter(a => a.cid === top.id);
        if (tAlerts.some(a => a.cat === 'tickets')) issues.push('open support tickets');
        if (tAlerts.some(a => a.cat === 'engagement')) issues.push('low engagement');
        if (tAlerts.some(a => a.cat === 'quiet')) issues.push('gone quiet');
        if (tAlerts.some(a => a.cat === 'momentum')) issues.push('declining momentum');
        if (tAlerts.some(a => a.cat === 'sentiment')) issues.push('poor sentiment');
        if (tAlerts.some(a => a.cat === 'cadence')) issues.push('overdue for contact');
        const issueText = issues.length > 0 ? `, plus ${issues.join(' and ')}` : '';
        insights.push({
          score: 85 + Math.min((top.mrr || 0) / 1000, 10), label: 'Highest MRR at Risk', accent: 'red',
          icon: _iSvg('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
          iconBg: 'var(--red-l)', iconColor: 'var(--red)',
          cids: [top.id], navMode: 'customer', navLabel: 'Highest MRR at Risk',
          text: `${_nameLink(top)} is your biggest dollar risk — <strong>$${fmtNum(top.mrr)} MRR</strong> at a score of <strong>${top.score}</strong>${issueText}. Start here today.`
        });
      }
    }

    // ── 3. Declining Momentum — accounts trending downward this week ──
    const alertCustIds = new Set(active.map(a => a.cid));
    const decliningCusts = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c) && alertCustIds.has(c.id) && getMomentum(c) === 'dn');
    if (decliningCusts.length >= 2) {
      const decMrr = decliningCusts.reduce((s, c) => s + (c.mrr || 0), 0);
      const totalAffected = new Set(active.map(a => a.cid)).size;
      const pct = Math.round((decliningCusts.length / totalAffected) * 100);
      const decIds = decliningCusts.map(c => c.id);
      // Find steepest drop and highest MRR separately
      const withDelta = decliningCusts.map(c => ({ c, delta: getDelta7d(c) }));
      withDelta.sort((a, b) => a.delta - b.delta); // most negative first
      const steepest = withDelta[0];
      const biggestMrr = decliningCusts.slice().sort((a, b) => (b.mrr || 0) - (a.mrr || 0))[0];
      let callout = '';
      if (steepest.c.id === biggestMrr.id) {
        callout = `${_nameLink(steepest.c)} (${Math.abs(Math.round(steepest.delta))} pt drop, $${fmtNum(steepest.c.mrr || 0)} MRR) is the biggest concern.`;
      } else {
        callout = `${_nameLink(steepest.c)} has the steepest drop (${Math.abs(Math.round(steepest.delta))} pts), while ${_nameLink(biggestMrr)} ($${fmtNum(biggestMrr.mrr || 0)} MRR) carries the most revenue risk.`;
      }
      insights.push({
        score: 60 + pct, label: 'Scores Still Falling', accent: 'red',
        icon: _iSvg('<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>'),
        iconBg: 'var(--red-l)', iconColor: 'var(--red)',
        cids: decIds, navMode: 'table', navLabel: 'Scores Still Falling',
        text: `<strong>${decliningCusts.length} accounts</strong> are still trending downward week-over-week — <strong>$${fmtNum(decMrr)} MRR</strong> that hasn't stabilized. ${callout}`
      });
    }

    // ── 4. Multi-signal accounts — accounts with 3+ different alert types need a plan ──
    const custAlertCats = {};
    active.forEach(a => {
      if (!custAlertCats[a.cid]) custAlertCats[a.cid] = new Set();
      custAlertCats[a.cid].add(a.cat);
    });
    const multiSignal = Object.entries(custAlertCats)
      .filter(([, cats]) => cats.size >= 3)
      .map(([cid, cats]) => ({ c: customers.find(x => x.id === cid), cats: cats.size }))
      .filter(x => x.c)
      .sort((a, b) => b.cats - a.cats || (b.c.mrr || 0) - (a.c.mrr || 0));
    if (multiSignal.length > 0) {
      const top = multiSignal[0];
      const topCats = [...custAlertCats[top.c.id]].map(k => (ALERT_CATS[k] || {}).label || '').filter(Boolean);
      const catCount = topCats.length;
      const others = multiSignal.length > 1 ? ` ${multiSignal.length - 1} other ${multiSignal.length - 1 === 1 ? 'account' : 'accounts'} also have 3+ alert types.` : '';
      const msCids = multiSignal.map(x => x.c.id);
      insights.push({
        score: 50 + catCount * 10, label: 'Multiple Red Flags', accent: 'amber',
        icon: _iSvg('<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
        iconBg: 'var(--amber-l)', iconColor: 'var(--amber)',
        cids: msCids, navMode: msCids.length === 1 ? 'customer' : 'table', navLabel: 'Multiple Red Flags',
        text: `${_nameLink(top.c)} is flagged across <strong>${catCount} categories</strong> — ${topCats.join(', ')}. When issues stack up like this, a single check-in call can uncover the root cause.${others}`
      });
    }

    // ── 5. Engagement Gap — low adoption/logins accounts with real MRR ──
    const engAlerts = active.filter(a => a.cat === 'engagement');
    if (engAlerts.length >= 2) {
      const engCusts = uniqueCusts(engAlerts).sort((a, b) => (b.mrr || 0) - (a.mrr || 0));
      const engMrr = engCusts.reduce((s, c) => s + (c.mrr || 0), 0);
      if (engMrr > 0) {
        const lowAdopt = engCusts.filter(c => c.adoption != null && c.adoption < 30);
        const lowLogin = engCusts.filter(c => c.logins != null && c.logins < 5);
        let detail = '';
        if (lowAdopt.length > 0 && lowLogin.length > 0) detail = `${lowAdopt.length} with low adoption and ${lowLogin.length} with low logins`;
        else if (lowAdopt.length > 0) detail = `${lowAdopt.length} with feature adoption under 30%`;
        else detail = `${lowLogin.length} with fewer than 5 logins per month`;
        const eCids = engCusts.map(c => c.id);
        insights.push({
          score: 45 + engCusts.length * 3, label: 'Engagement Drop', accent: 'amber',
          icon: _iSvg('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
          iconBg: 'var(--amber-l)', iconColor: 'var(--amber)',
          cids: eCids, navMode: 'table', navLabel: 'Low Engagement',
          text: `<strong>${engCusts.length} accounts</strong> (<strong>$${fmtNum(engMrr)} MRR</strong>) are underusing the product — ${detail}. Low usage often leads to churn — consider a training session or check-in to drive adoption.`
        });
      }
    }

    // ── 6. Silent Revenue — quiet high-value accounts ──
    const quietAlerts = active.filter(a => a.cat === 'quiet');
    if (quietAlerts.length > 0) {
      const quietCusts = uniqueCusts(quietAlerts).filter(c => (c.mrr || 0) >= 3000).sort((a, b) => (b.mrr || 0) - (a.mrr || 0));
      if (quietCusts.length > 0) {
        const totalQuietMrr = quietCusts.reduce((s, c) => s + (c.mrr || 0), 0);
        const topQ = quietCusts[0];
        const qDays = getQuietDays(topQ);
        const qCids = quietCusts.map(c => c.id);
        insights.push({
          score: 42 + quietCusts.length * 2, label: 'Silent Revenue', accent: 'amber',
          icon: _iSvg('<path d="M18.36 6.64A9 9 0 0 1 20.77 15"/><path d="M6.16 6.16a9 9 0 1 0 12.68 12.68"/><line x1="2" y1="2" x2="22" y2="22"/>'),
          iconBg: 'var(--amber-l)', iconColor: 'var(--amber)',
          cids: qCids, navMode: qCids.length === 1 ? 'customer' : 'table', navLabel: 'Quiet Accounts',
          text: `<strong>${quietCusts.length} ${quietCusts.length === 1 ? 'account' : 'accounts'}</strong> worth <strong>$${fmtNum(totalQuietMrr)} MRR</strong> ${quietCusts.length === 1 ? 'has' : 'have'} gone dark — zero logins, zero tickets, no contact. ${_nameLink(topQ)} ($${fmtNum(topQ.mrr || 0)} MRR) has been quiet for <strong>${qDays} days</strong>. Reach out now — the longer the silence, the harder the save.`
        });
      }
    }

    // Sort by score desc, show top 3
    insights.sort((a, b) => b.score - a.score);
    const topIns = insights.slice(0, 3);

    if (topIns.length) {
      // Store insight data for click navigation
      window._alertInsights = topIns;
      insWrap.innerHTML = '<div style="font-size:var(--fs-base);font-weight:700;color:var(--text);margin-bottom:8px">Insights</div>' +
        topIns.map((ins, idx) => {
          const cls = ins.accent === 'green' ? 'ta-card-green' : ins.accent === 'red' ? 'ta-card-red' : ins.accent === 'amber' ? 'ta-card-amber' : '';
          const clickable = ins.cids && ins.cids.length > 0;
          return `<div class="ta-card ${cls}${clickable ? ' ta-card-clickable' : ''}" ${clickable ? `onclick="_alertInsightClick(${idx})"` : ''}>
            <div class="ta-icon" style="background:${ins.iconBg};color:${ins.iconColor}">${ins.icon}</div>
            <div><div class="ta-label">${ins.label}</div><div class="ta-detail">${ins.text}</div></div>
          </div>`;
        }).join('');
    } else {
      insWrap.innerHTML = '';
    }
  }
}

// ─── Alert panel → Table filter (stays on alerts page) ──────
function _alertTblSortBy(key) {
  if (_alertTblSort.key === key) _alertTblSort.dir *= -1;
  else { _alertTblSort.key = key; _alertTblSort.dir = key === 'name' || key === 'manager' ? 1 : -1; }
  renderAlerts();
}

// Navigate from insight card: single customer → customer view + expand, multiple → table view
function _insightNav(mode, custIds, label) {
  const ids = custIds instanceof Set ? custIds : new Set(custIds);
  if (mode === 'customer' && ids.size === 1) {
    // Single customer: switch to customer view, expand, and scroll
    const cid = [...ids][0];
    setAlertView('customer');
    setTimeout(() => {
      const hd = document.querySelector(`.alert-group-hd[data-cid="${cid}"]`);
      if (hd) {
        const body = hd.nextElementSibling;
        if (body && body.classList.contains('alert-group-body') && getComputedStyle(body).display === 'none') {
          toggleAlertGroup(hd);
        }
        const stickyBar = document.getElementById('alert-sticky-bar');
        const barH = stickyBar ? stickyBar.offsetHeight : 0;
        _smoothScrollWithOffset(hd, barH + 12);
      }
    }, 80);
  } else if (mode === 'detail' && ids.size === 1) {
    // Open detail modal for single account
    openDetail([...ids][0]);
  } else {
    // Multiple customers: show in filtered table
    _alertShowTable(label || 'Insight', ids);
  }
}

function _alertInsightClick(idx) {
  const ins = window._alertInsights?.[idx];
  if (!ins || !ins.cids || !ins.cids.length) return;
  _insightNav(ins.navMode || 'table', ins.cids, ins.navLabel || ins.label);
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
  if (which === 'all')      scrollTo = 'alert-grp-health';
  if (which === 'total')    scrollTo = 'alert-grp-health';
  if (which === 'critical') scrollTo = 'alert-grp-health';
  if (which === 'renewal')  scrollTo = 'alert-grp-renewal';
  if (which === 'mrr')      scrollTo = 'alert-grp-health';
  if (which === 'accounts') scrollTo = 'alert-grp-health';
  setTimeout(() => {
    const stickyBar = document.getElementById('alert-sticky-bar');
    const barH = stickyBar ? stickyBar.offsetHeight : 0;
    if (which === 'snoozed') {
      const snzHd = document.querySelector('#alerts-list .alert-group-hd:last-of-type');
      _smoothScrollWithOffset(snzHd, barH + 12);
    } else if (scrollTo) {
      const hd = document.getElementById(scrollTo);
      if (hd) {
        const body = hd.nextElementSibling;
        if (body && body.classList.contains('alert-group-body') && getComputedStyle(body).display === 'none') {
          toggleAlertGroup(hd);
        }
        _smoothScrollWithOffset(hd, barH + 12);
      }
    }
  }, 50);
}
function filterByAlertCat(cat) {
  if (_alertViewMode !== 'category') setAlertView('category');
  setTimeout(() => {
    const hd = document.getElementById('alert-grp-' + cat);
    if (hd) {
      const body = hd.nextElementSibling;
      if (body && body.classList.contains('alert-group-body') && getComputedStyle(body).display === 'none') {
        toggleAlertGroup(hd);
      }
      const stickyBar = document.getElementById('alert-sticky-bar');
      const barH = stickyBar ? stickyBar.offsetHeight : 0;
      _smoothScrollWithOffset(hd, barH + 12);
    }
  }, 50);
}
function clearMrrExposureFilter() {
  mrrExposureFilter = null;
  renderCustomers();
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

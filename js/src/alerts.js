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
};
const ALERT_CATS = {
  health:    { label:'Health',    icon: ALERT_ICONS.health,    type:'red'   },
  renewal:   { label:'Renewal',   icon: ALERT_ICONS.renewal,   type:'blue'  },
  cadence:   { label:'Cadence',   icon: ALERT_ICONS.cadence,   type:'amber' },
  sentiment: { label:'Sentiment', icon: ALERT_ICONS.sentiment, type:'amber' },
  momentum:  { label:'Momentum',  icon: ALERT_ICONS.momentum,  type:'amber' },
  tickets:   { label:'Support',   icon: ALERT_ICONS.tickets,   type:'red'   },
  expansion: { label:'Expansion', icon: ALERT_ICONS.expansion, type:'green' },
};

// Severity order for sorting (lower = higher priority)
const ALERT_SEV = { red:0, amber:1, blue:2, green:3 };

// Dismissed alerts map: alertId → score at time of dismissal
// Alert reappears if customer's score changes from when it was dismissed
let dismissed = new Map();

function buildAlerts() {
  const alerts = [];
  const now = new Date();
  // Customer display snapshot — embedded in every alert for rich rendering
  const snap = c => ({ _score:c.score, _status:c.status, _tier:c.tier, _manager:c.manager||'', _days:c.days||0 });

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
        sub:`NPS: ${c.nps||'—'}`, ...snap(c) });

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

    // ── Sentiment ──
    const sent = latestSentiment(c);
    if (sent?.val === 'negative')
      alerts.push({ id:c.id+'-sent', cid:c.id, cat:'sentiment', type:'amber',
        msg:`<strong>${escHtml(c.name)}</strong> <span>last call logged as negative</span>`,
        sub:`Sentiment: Negative`, ...snap(c) });

    // ── NPS Detractor (only if NPS signal is active) ──
    if (signalOn(c,'nps') && c.nps === 'detractor')
      alerts.push({ id:c.id+'-nps', cid:c.id, cat:'tickets', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>is an NPS Detractor</span>`,
        sub:`Score ${c.score}`, ...snap(c) });

    // ── Expansion opportunity (only if growth signal is active + no recent touch) ──
    if (signalOn(c,'growth') && (c.status === 'expand' || c.status === 'healthy') && (c.mrr||0) >= 3000) {
      const daysSince = c.days || 0;
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
    if (c) Object.assign(a, { _score:c.score, _status:c.status, _tier:c.tier, _manager:c.manager||'', _days:c.days||0 });
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
let _alertViewMode = 'category'; // 'category' | 'priority' | 'customer'

function setAlertView(mode) {
  _alertViewMode = mode;
  ['cat','pri','cust'].forEach(k => {
    const btn = el('alert-view-' + k);
    if (btn) btn.classList.toggle('active', mode === { cat:'category', pri:'priority', cust:'customer' }[k]);
  });
  const searchBox = el('alert-cust-search');
  if (searchBox) {
    searchBox.style.display = mode === 'customer' ? '' : 'none';
    if (mode !== 'customer') searchBox.value = '';
  }
  renderAlerts();
}

function alertToggleSelect(aid, el) {
  if (_selectedAlerts.has(aid)) _selectedAlerts.delete(aid);
  else _selectedAlerts.add(aid);
  _updateAlertBulkBar();
  // toggle .selected on row
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
  renderDashboard();
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
  renderDashboard();
  toast(`${n} alert${n===1?'':'s'} dismissed`, 'default');
}

function renderAlerts() { try { _renderAlerts(); } catch(e) { console.error('renderAlerts error:', e); } }
function _renderAlerts() {
  const all    = buildAlerts();
  const active = all.filter(a => !isSnoozed(a.id) && !isDismissed(a.id));
  const snz    = all.filter(a =>  isSnoozed(a.id));
  const list   = el('alerts-list');

  // Update sidebar badge + topbar bell badge (v86)
  const ab = el('alert-badge');
  if (ab) { if (active.length > 0) { ab.textContent = active.length; ab.style.display = ''; } else ab.style.display = 'none'; }
  const bb = el('bell-badge');
  if (bb) { if (active.length > 0) { bb.textContent = active.length; bb.style.display = ''; } else bb.style.display = 'none'; }

  _updateAlertBulkBar();

  // Show/hide view toggle bar
  const viewBar = el('alert-view-bar');
  if (viewBar) viewBar.style.display = (active.length || snz.length) ? 'flex' : 'none';

  if (!active.length && !snz.length) {
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
      html += `<div class="alert-priority-hd"><div class="alert-priority-dot" style="background:${sevColors[sev]}"></div>${sevLabels[sev]} <span style="font-weight:400;color:var(--subtle)">(${group.length})</span></div>`;
      html += group.map(a => alertItemHTML(a, false)).join('');
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
        html += `<div class="alert-group-hd" style="cursor:pointer" onclick="openDetail('${escHtml(cid)}')">
          <span class="alert-score-circle" style="background:${scoreColor};width:26px;height:26px;font-size:.65rem;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-weight:800">${data.score}</span>
          ${escHtml(data.name)}
          ${data.mrr ? `<span style="font-weight:400;color:var(--subtle);font-size:.75rem">$${fmtNum(data.mrr)} MRR</span>` : ''}
          <span style="font-weight:400;color:var(--subtle)">(${data.alerts.length} alert${data.alerts.length !== 1 ? 's' : ''})</span>
        </div>`;
        // Sort alerts within customer by severity
        const sevOrd = { red:0, amber:1, blue:2, green:3 };
        data.alerts.sort((a,b) => (sevOrd[a.type]??9) - (sevOrd[b.type]??9));
        html += data.alerts.map(a => alertItemHTML(a, false)).join('');
      });
    } else if (custSearch) {
      html += `<div style="text-align:center;padding:28px 16px;color:var(--muted);font-size:.85rem">No customers matching "${escHtml(custSearch)}"</div>`;
    }
  } else {
    // ── Category view (default) ──
    const cats = ['health','tickets','renewal','cadence','momentum','sentiment','expansion'];
    cats.forEach(cat => {
      const group = active.filter(a => a.cat === cat);
      if (!group.length) return;
      const def = ALERT_CATS[cat];
      html += `<div class="alert-group-hd" id="alert-grp-${cat}">${def.icon} ${def.label} <span style="font-weight:400;color:var(--subtle)">(${group.length})</span></div>`;
      html += group.map(a => alertItemHTML(a, false)).join('');
    });
  }

  // Snoozed section (shown in both views)
  if (snz.length) {
    html += `<div class="alert-group-hd" style="margin-top:20px">${ALERT_ICONS.snoozed} Snoozed <span style="font-weight:400;color:var(--subtle)">(${snz.length})</span></div>`;
    html += snz.map(a => alertItemHTML(a, true)).join('');
  }

  list.innerHTML = html;
  renderAlertPanel(all, active, snz);
  renderAlertBriefing(active, snz);
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
    if (cls) { cell.className = 'alert-kpi-cell ' + cls; }
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
      'Poor Sentiment':   { color:'#fda4af', mrr:0 }
    };
    // Dedupe by customer (only count each customer once per bucket)
    const seen = {};
    Object.keys(mrrMap).forEach(k => seen[k] = new Set());
    // Alert-based buckets
    active.forEach(a => {
      const c = customers.find(x => x.id === a.cid);
      if (!c) return;
      if (a.cat === 'health' && a.type === 'red' && !seen['Critical/Risk'].has(c.id)) { seen['Critical/Risk'].add(c.id); mrrMap['Critical/Risk'].mrr += c.mrr||0; }
      else if (a.cat === 'health' && a.type === 'amber' && !seen['Watch'].has(c.id)) { seen['Watch'].add(c.id); mrrMap['Watch'].mrr += c.mrr||0; }
      if (a.cat === 'renewal' && !seen['Renewal ≤60d'].has(c.id)) { seen['Renewal ≤60d'].add(c.id); mrrMap['Renewal ≤60d'].mrr += c.mrr||0; }
    });
    // Customer-based buckets: no contact 60d+, poor sentiment
    customers.filter(c => c.lifecycle !== 'churned').forEach(c => {
      if (c.days >= 60 && !seen['No Contact 60d+'].has(c.id)) { seen['No Contact 60d+'].add(c.id); mrrMap['No Contact 60d+'].mrr += c.mrr||0; }
      const sent = latestSentiment(c);
      if (sent && sent.val === 'negative' && !seen['Poor Sentiment'].has(c.id)) { seen['Poor Sentiment'].add(c.id); mrrMap['Poor Sentiment'].mrr += c.mrr||0; }
    });
    // Total uses unique customers across all buckets (no double-counting)
    const allExposed = new Set();
    Object.values(seen).forEach(s => s.forEach(id => allExposed.add(id)));
    let totalMrr = 0;
    allExposed.forEach(id => { const c = customers.find(x => x.id === id); if (c) totalMrr += c.mrr||0; });
    mrrWrap.innerHTML = Object.entries(mrrMap).map(([label, {color, mrr}]) => `
      <div class="alert-mrr-row">
        <div class="alert-mrr-dot" style="background:${color}"></div>
        <div class="alert-mrr-label">${label}</div>
        <div class="alert-mrr-val">$${fmtNum(mrr)}</div>
      </div>`).join('') +
      `<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.2);display:flex;justify-content:space-between;font-size:.75rem">
        <span style="color:rgba(255,255,255,.7);font-weight:600">Total Exposed MRR</span>
        <span style="font-weight:800;color:#fff">$${fmtNum(totalMrr)}</span>
      </div>`;
  }

  // By category bars
  const catWrap = el('alert-cat-wrap');
  if (catWrap) {
    const catOrder = ['health','tickets','renewal','cadence','momentum','sentiment','expansion'];
    const catCounts = {};
    catOrder.forEach(c => catCounts[c] = 0);
    active.forEach(a => { if (catCounts[a.cat] !== undefined) catCounts[a.cat]++; });
    const maxCount = Math.max(1, ...Object.values(catCounts));
    const catColors = { health:'#dc2626', tickets:'#ea580c', renewal:'#2563eb', cadence:'#d97706', momentum:'#d97706', sentiment:'#d97706', expansion:'#16a34a' };
    catWrap.innerHTML = catOrder.filter(c => catCounts[c] > 0).map(c => {
      const def = ALERT_CATS[c];
      const pct = Math.round((catCounts[c] / maxCount) * 100);
      return `
        <div class="alert-cat-row" onclick="document.getElementById('alert-grp-${c}')?.scrollIntoView({behavior:'smooth',block:'start'})">
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
      items.push({ cid: c.id, name: c.name, level: nba.level, action: nba.action, mrr: c.mrr||0 });
    });

    // Sort by urgency then by MRR desc
    items.sort((a,b) => (urgOrder[a.level]||4) - (urgOrder[b.level]||4) || b.mrr - a.mrr);

    if (items.length) {
      actWrap.innerHTML = items.slice(0, 4).map(it => `
        <div class="alert-action-row" onclick="openDetail('${escHtml(it.cid)}')">
          <div class="alert-action-dot" style="background:${urgColors[it.level]||'rgba(255,255,255,.4)'}"></div>
          <div class="alert-action-body">
            <div class="alert-action-cust">${escHtml(it.name)}</div>
            <div class="alert-action-text">${escHtml(it.action)}</div>
          </div>
        </div>`).join('');
    } else {
      actWrap.innerHTML = '<div style="font-size:.78rem;color:rgba(255,255,255,.6);text-align:center;padding:12px 0">All clear — no actions needed</div>';
    }
  }
}

// ════════════════════════════════════════════════════════════════
// Alert Briefing Panel — Smart narrative overview + action list
// ════════════════════════════════════════════════════════════════

function _briefingNarrative(active, snz) {
  const total = customers.filter(c => c.lifecycle !== 'churned');
  if (!total.length) return '';
  const n = total.length;
  const critRisk   = total.filter(c => c.status === 'critical' || c.status === 'risk');
  const watchAccts = total.filter(c => c.status === 'watch');
  const healthy    = total.filter(c => c.status === 'healthy' || c.status === 'expand');
  const healthPct  = Math.round((healthy.length / n) * 100);

  // MRR at risk — only health-based critical/risk (matches MRR Exposure widget)
  const riskMrr = critRisk.reduce((s, c) => s + (c.mrr || 0), 0);

  // Average score
  const avgScore = Math.round(total.reduce((s, c) => s + (c.score || 0), 0) / n);

  // Alert counts by category
  const renewals     = active.filter(a => a.cat === 'renewal');
  const urgRenewals  = renewals.filter(a => a.type === 'red');
  const cadenceRed   = active.filter(a => a.cat === 'cadence' && a.type === 'red');
  const ticketAlerts = active.filter(a => a.cat === 'tickets');
  const sentNeg      = active.filter(a => a.cat === 'sentiment' && (a.type === 'red' || a.type === 'amber'));
  const expansions   = active.filter(a => a.cat === 'expansion');
  const momentum     = active.filter(a => a.cat === 'momentum');

  // Touched recently
  const recentTouch = total.filter(c => c.days != null && c.days <= 14).length;
  const touchPct    = Math.round((recentTouch / n) * 100);

  // Customers without alerts
  const alertCids  = new Set(active.map(a => a.cid));
  const clearCount = total.filter(c => !alertCids.has(c.id)).length;
  const clearPct   = Math.round((clearCount / n) * 100);

  const lines = [];

  // ── Opening: overall health assessment ──
  if (critRisk.length === 0 && watchAccts.length === 0) {
    if (n <= 3) {
      lines.push(`Your ${n} active account${n > 1 ? 's are' : ' is'} all in good standing with an average health score of ${avgScore}.`);
    } else {
      lines.push(`Your portfolio is in strong shape — all ${n} accounts are healthy or growing, with an average score of ${avgScore}.`);
    }
  } else if (critRisk.length === 0) {
    lines.push(`${healthy.length} of ${n} accounts (${healthPct}%) are healthy or growing. ${watchAccts.length} ${watchAccts.length === 1 ? 'is' : 'are'} in the watch zone but no accounts are at critical risk. Average score: ${avgScore}.`);
  } else if (critRisk.length <= 2) {
    const names = critRisk.slice(0, 2).map(c => c.name).join(' and ');
    lines.push(`Most of your portfolio is stable, but <strong>${names}</strong> ${critRisk.length === 1 ? 'needs' : 'need'} immediate attention.`);
    if (riskMrr > 0) lines.push(`That puts <strong>$${fmtNum(riskMrr)}</strong> in MRR at health-score risk.`);
  } else {
    lines.push(`<strong>${critRisk.length} accounts</strong> are in critical or at-risk health — <strong>$${fmtNum(riskMrr)}</strong> MRR is exposed. These should be your first priority today.`);
  }

  // ── Renewals ──
  if (urgRenewals.length > 0) {
    const renCids = new Set();
    const renNames = [];
    urgRenewals.forEach(a => { if (!renCids.has(a.cid)) { renCids.add(a.cid); const c = customers.find(x => x.id === a.cid); if (c) renNames.push(c.name); }});
    if (renNames.length <= 2) {
      lines.push(`<strong>${renNames.join(' and ')}</strong> ${renNames.length === 1 ? 'has a' : 'have'} renewal${renNames.length === 1 ? '' : 's'} due within 14 days — lock ${renNames.length === 1 ? 'this' : 'these'} in soon.`);
    } else {
      lines.push(`<strong>${urgRenewals.length} renewals</strong> are due within 14 days — get those conversations started.`);
    }
  } else if (renewals.length > 0) {
    lines.push(`${renewals.length} renewal${renewals.length === 1 ? '' : 's'} upcoming in the next 60 days — none urgent yet.`);
  }

  // ── Cadence / outreach gaps ──
  if (cadenceRed.length > 0) {
    const cadCids = new Set();
    const cadNames = [];
    cadenceRed.forEach(a => { if (!cadCids.has(a.cid)) { cadCids.add(a.cid); const c = customers.find(x => x.id === a.cid); if (c) cadNames.push(c.name); }});
    if (cadNames.length <= 2) {
      lines.push(`<strong>${cadNames.join(' and ')}</strong> ${cadNames.length === 1 ? 'has' : 'have'} overdue check-ins — reach out before silence becomes a risk.`);
    } else {
      lines.push(`<strong>${cadenceRed.length} accounts</strong> have overdue check-ins — get those touchpoints scheduled.`);
    }
  }

  // ── Tickets ──
  if (ticketAlerts.length > 0) {
    lines.push(`${ticketAlerts.length} account${ticketAlerts.length > 1 ? 's have' : ' has'} elevated support tickets — worth a proactive check-in.`);
  }

  // ── Sentiment ──
  if (sentNeg.length > 0) {
    lines.push(`${sentNeg.length} account${sentNeg.length > 1 ? 's' : ''} logged negative sentiment recently — follow up before it escalates.`);
  }

  // ── Declining momentum ──
  if (momentum.length > 0) {
    lines.push(`${momentum.length} account${momentum.length > 1 ? 's are' : ' is'} showing declining momentum scores.`);
  }

  // ── Positive / expansion ──
  if (expansions.length > 0) {
    lines.push(`On the bright side, <strong>${expansions.length} expansion</strong> opportunit${expansions.length === 1 ? 'y is' : 'ies are'} flagged — high-value accounts ready for growth conversations.`);
  }

  // ── Outreach / coverage ──
  if (touchPct >= 70) {
    lines.push(`Outreach coverage is strong — ${touchPct}% of accounts were touched in the last 14 days.`);
  } else if (touchPct >= 40) {
    lines.push(`${touchPct}% of accounts were touched in the last 14 days. Consider scheduling more check-ins this week.`);
  } else if (touchPct > 0) {
    lines.push(`Only ${touchPct}% of accounts have been contacted recently — outreach coverage could use attention.`);
  }

  // ── Snoozed ──
  if (snz.length > 0) {
    lines.push(`${snz.length} alert${snz.length > 1 ? 's are' : ' is'} snoozed — remember to circle back.`);
  }

  // ── All clear closing ──
  if (active.length === 0 && critRisk.length === 0) {
    lines.push(`No active alerts — a great time to focus on strategic outreach, expansion conversations, or getting ahead on renewals.`);
  }

  return lines.join(' ');
}

function renderAlertBriefing(active, snz) {
  const wrap = el('alert-briefing');
  if (!wrap) return;

  // Hide if no customers loaded
  if (!customers.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  const total    = customers.filter(c => c.lifecycle !== 'churned');
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
      <div class="briefing-narrative-row">
        <div class="briefing-narrative">
          <div class="alert-briefing-hd">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
            Portfolio Briefing
          </div>
          <p class="briefing-text">${narrative}</p>
        </div>
        <div class="briefing-stats-col">
          ${statsHtml}
        </div>
      </div>
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
      <input type="checkbox" class="alert-item__check" ${sel?'checked':''} onclick="event.stopPropagation();alertToggleSelect('${escHtml(a.id)}',this)" title="Select">
      <div class="alert-item__icon">${def.icon}</div>
      <div class="alert-item__body">
        <div class="alert-item__text">${a.msg}</div>
        <div class="alert-item__meta">
          <span class="alert-item__cat ${a.type}">${def.label}</span>
          ${tierChip(a._tier)}
          ${a._manager ? `<span class="alert-meta-csm">CSM: ${escHtml(a._manager)}</span>` : ''}
          ${a._days > 0 ? `<span class="alert-meta-days">${a._days}d since touch</span>` : ''}
          ${a.sub ? `<span style="color:var(--subtle)">${escHtml(a.sub)}</span>` : ''}
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
  renderDashboard();
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
  renderDashboard();
  toast('Alert dismissed', 'default');
}

function unsnooze(aid) {
  const ai = _alertAuditInfo(aid);
  snoozed.delete(aid);
  saveSettings();
  logAudit('alert_unsnoozed', ai.custId, ai.custName, { summary: `Alert unsnoozed — ${ai.catLabel}` });
  renderAlerts();
  renderDashboard();
}

function clearSnoozed() {
  snoozed.clear();
  saveSettings();
  logAudit('alerts_cleared', null, '', { summary: 'All snoozed alerts cleared' });
  renderAlerts();
  renderDashboard();
  toast('Snoozed alerts cleared', 'success');
}

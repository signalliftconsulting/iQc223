// ─── DASHBOARD ──────────────────────────────────────────────
function renderDashboard() { try { _renderDashboard(); } catch(e) { console.error('renderDashboard error:', e); } }
function _renderDashboard() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  // 5-band grouping
  const critical= active.filter(c => c.status === 'critical');
  const risk    = active.filter(c => c.status === 'risk');
  const watch   = active.filter(c => c.status === 'watch');
  const healthy = active.filter(c => c.status === 'healthy');
  const expand  = active.filter(c => c.status === 'expand');
  const total   = active.length;
  const avg     = total ? Math.round(active.reduce((s,c)=>s+c.score,0)/total) : null;
  const totalMRR= active.reduce((s,c)=>s+(c.mrr||0),0);
  const atRiskAll = [...critical, ...risk]; // combined "at risk" for KPI card 2

  // ── Hidden compat spans ──
  el('kpi-risk').textContent    = risk.length + critical.length;
  el('kpi-healthy').textContent = healthy.length;
  el('kpi-expand').textContent  = expand.length;
  el('kpi-avg').textContent     = avg !== null ? avg : '—';
  el('kpi-mrr').textContent     = '$' + fmtNum(totalMRR);

  const riskMRR = atRiskAll.reduce((s,c)=>s+(c.mrr||0),0);
  el('kpi-risk-mrr').textContent = riskMRR ? `$${fmtNum(riskMRR)} MRR at risk` : '';

  // ── KPI Card: Total MRR ──
  if (el('kpi-total-mrr'))    el('kpi-total-mrr').textContent    = '$' + fmtNum(totalMRR);
  if (el('kpi-avg-score-pill')) el('kpi-avg-score-pill').textContent = avg !== null ? `Avg score ${avg}` : 'Avg score —';

  // ── KPI Card 1: Book Health — 5-segment bar ──
  el('kpi-total').textContent = total;
  ['critical','risk','watch','healthy','expand'].forEach(st => {
    const seg = el('hbar-' + st);
    const grp = active.filter(c => c.status === st);
    if (seg) seg.style.width = total ? (grp.length / total * 100).toFixed(1) + '%' : '0%';
  });
  el('kpi-risk-pct').textContent    = (critical.length + risk.length) + ' At Risk';
  if (el('kpi-watch-pct'))   el('kpi-watch-pct').textContent   = watch.length   + ' Watch';
  el('kpi-healthy-pct').textContent = healthy.length + ' Healthy';
  el('kpi-expand-pct').textContent  = expand.length  + ' Expansion';

  // ── KPI Card 2: Revenue at Risk (critical + risk combined) ──
  el('kpi-risk-mrr-big').textContent = '$' + fmtNum(riskMRR);
  el('kpi-risk-count').textContent   = atRiskAll.length + (atRiskAll.length === 1 ? ' account' : ' accounts');

  // ── KPI Card 3: Renewals ──
  const renewSoon = active.filter(c => c.renewal != null && c.renewal >= 0 && c.renewal <= 1);
  const renewMRR  = renewSoon.reduce((s,c)=>s+(c.mrr||0),0);
  el('kpi-renewals').textContent     = renewSoon.length;
  const renewPill = el('kpi-renewals-mrr');
  if (renewPill) renewPill.textContent = renewMRR ? '$' + fmtNum(renewMRR) + ' at stake' : 'None due';

  // ── KPI Card 4: Expansion ──
  const expMRR  = expand.reduce((s,c)=>s+(c.mrr||0),0);
  el('exp-arpu').textContent  = '$' + fmtNum(Math.round(expMRR * 0.2));
  el('exp-count').textContent = expand.length + (expand.length === 1 ? ' account ready' : ' accounts ready');
  el('exp-mrr').textContent   = '$' + fmtNum(expMRR);

  // ── Alert badge (sidebar nav + topbar bell) ──
  const alertCount = buildAlerts().filter(a => !isSnoozed(a.id)).length;
  const ab = el('alert-badge');
  if (ab) { if (alertCount > 0) { ab.textContent = alertCount; ab.style.display = ''; } else ab.style.display = 'none'; }
  const bb2 = el('bell-badge');
  if (bb2) { if (alertCount > 0) { bb2.textContent = alertCount; bb2.style.display = ''; } else bb2.style.display = 'none'; }

  // ── Render sub-sections ──
  renderDonut(critical.length, risk.length, watch.length, healthy.length, expand.length, total);
  renderDistChart(active);
  renderMrrChart(critical, risk, watch, healthy, expand);
  renderSegChart(active);
  renderHeatmap(active);
  renderRecent(active);
  renderWins(active);
  renderDrops(active);

  // Gated dashboard widgets
  const rpWrap = el('renewal-pipeline-wrap');
  if (rpWrap) { if (hasFeature('renewal_pipeline')) renderRenewalPipeline(active); else rpWrap.innerHTML = upgradeHTML('renewal_pipeline'); }
  renderSegCards(active);
  renderDashAlerts();
  const plWrap = el('priority-table-wrap');
  if (plWrap) { if (hasFeature('priority_list')) renderPriorityList(); else plWrap.innerHTML = upgradeHTML('priority_list'); }
}

// ─── SEGMENT CARDS ───────────────────────────────────────────
function renderSegCards(active) {
  const wrap = el('seg-cards');
  if (!wrap) return;

  const tiers = [
    { key:'smb',        label:'SMB',         cls:'smb', color:'#7c3aed' },
    { key:'mid',        label:'Mid-Market',  cls:'mid', color:'#2563eb' },
    { key:'enterprise', label:'Enterprise',  cls:'ent', color:'#0891b2' },
  ];

  wrap.innerHTML = tiers.map(t => {
    const accs   = active.filter(c => c.tier === t.key);
    const count  = accs.length;
    if (!count) return `
      <div class="seg-card ${t.cls}" onclick="nav('customers');setFilter('all')">
        <div class="seg-card__label">${t.label}</div>
        <div class="seg-card__num">0</div>
        <div class="seg-card__sub">No accounts</div>
      </div>`;

    const totalMRR = accs.reduce((s,c) => s + (c.mrr||0), 0);
    const avgScore = Math.round(accs.reduce((s,c) => s + c.score, 0) / count);
    const atRisk   = accs.filter(c => c.status === 'critical' || c.status === 'risk').length;
    const expand   = accs.filter(c => c.status === 'expand').length;

    // Mini health bar counts
    const bands = ['critical','risk','watch','healthy','expand'];
    const bandColors = { critical:'#dc2626', risk:'#ea580c', watch:'#d97706', healthy:'#16a34a', expand:'#0891b2' };
    const healthBar = bands.map(st => {
      const n = accs.filter(c => c.status === st).length;
      const w = count ? (n/count*100).toFixed(1) : 0;
      return `<div class="seg-health-seg" style="width:${w}%;background:${bandColors[st]};min-width:${n?2:0}px"></div>`;
    }).join('');

    // Score color
    const scoreColor = avgScore >= 80 ? '#0891b2' : avgScore >= 65 ? '#16a34a' : avgScore >= 50 ? '#d97706' : avgScore >= 25 ? '#ea580c' : '#dc2626';

    return `
      <div class="seg-card ${t.cls}" onclick="filterByTier('${t.key}')">
        <div class="seg-card__label">${t.label}</div>
        <div style="display:flex;align-items:flex-end;gap:10px">
          <div>
            <div class="seg-card__num">${count}</div>
            <div class="seg-card__sub">${count === 1 ? 'account' : 'accounts'}</div>
          </div>
          <div style="margin-bottom:4px;font-size:1.3rem;font-weight:800;color:${scoreColor}">${avgScore}</div>
          <div style="margin-bottom:4px;font-size:.65rem;color:var(--muted)">avg score</div>
        </div>
        <div class="seg-health-bar">${healthBar}</div>
        <div class="seg-card__divider"></div>
        <div class="seg-card__row">
          <span class="seg-card__row-label">Total MRR</span>
          <span class="seg-card__row-val">$${fmtNum(totalMRR)}</span>
        </div>
        <div class="seg-card__row">
          <span class="seg-card__row-label">At Risk</span>
          <span class="seg-card__row-val" style="color:${atRisk ? '#ea580c' : 'var(--muted)'}">${atRisk} ${atRisk === 1 ? 'account' : 'accounts'}</span>
        </div>
        <div class="seg-card__row">
          <span class="seg-card__row-label">Expansion</span>
          <span class="seg-card__row-val" style="color:${expand ? '#0891b2' : 'var(--muted)'}">${expand} ${expand === 1 ? 'account' : 'accounts'}</span>
        </div>
      </div>`;
  }).join('');
}

function filterByTier(tier) {
  // Navigate to customers and filter by tier
  nav('customers');
  // Set a tier filter using the existing search box as a fallback,
  // or just show all and let them see it — best UX is to filter the list
  filterMode = 'all';
  const search = el('search-input');
  if (search) { search.value = ''; }
  // Filter customers by tier directly
  const tbody = el('cust-tbody');
  if (!tbody) return;
  // Re-render with tier filter applied via a temporary override
  _filterTier = tier;
  renderCustomers();
  _filterTier = null;
}

// Tier filter override (set temporarily by filterByTier)
let _filterTier = null;

// ─── DASHBOARD ALERTS SIDEBAR ────────────────────────────────
function renderDashAlerts() {
  const wrap = el('dash-alerts-wrap');
  if (!wrap) return;
  const alerts = buildAlerts().filter(a => !isSnoozed(a.id) && !isDismissed(a.id)).slice(0, 5);
  if (!alerts.length) {
    wrap.innerHTML = '<div style="font-size:.78rem;color:var(--muted);padding:6px 0;text-align:center">All clear — no active alerts</div>';
    return;
  }
  wrap.innerHTML = alerts.map(a => {
    const def = ALERT_CATS[a.cat] || ALERT_CATS.health;
    const cust = customers.find(x => x.id === a.cid);
    return `
    <div class="dash-alert-item ${a.type}" onclick="openDetail('${escHtml(a.cid)}')">
      <div class="dash-alert-item__icon">${def.icon}</div>
      <div class="dash-alert-item__body">
        <div class="dash-alert-item__text"><strong>${escHtml(cust?.name||'')}</strong> — ${def.label}</div>
        <div class="dash-alert-item__sub">${escHtml(a.sub||'')}</div>
      </div>
      <button class="btn btn-xs btn-ghost" style="flex-shrink:0;padding:2px 7px;font-size:.66rem" onclick="event.stopPropagation();openDetail('${escHtml(a.cid)}')">→</button>
    </div>`;
  }).join('') + `<div style="margin-top:8px;text-align:center"><button class="btn btn-xs btn-ghost" onclick="nav('alerts')" style="font-size:.72rem;color:var(--muted)">See all ${buildAlerts().filter(a=>!isSnoozed(a.id)&&!isDismissed(a.id)).length} alerts →</button></div>`;
}

function el(id) { return document.getElementById(id); }
function fmtNum(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
  return n.toLocaleString();
}

// Donut chart — 5 bands
function renderDonut(nCrit, nRisk, nWatch, nHealthy, nExpand, total) {
  const circ = 2 * Math.PI * 46;
  const arc = n => total ? (n / total) * circ : 0;

  const bands = [
    { id:'dn-critical', n:nCrit,    color:'#dc2626' },
    { id:'dn-risk',     n:nRisk,    color:'#ea580c' },
    { id:'dn-watch',    n:nWatch,   color:'#d97706' },
    { id:'dn-healthy',  n:nHealthy, color:'#16a34a' },
    { id:'dn-expand',   n:nExpand,  color:'#0891b2' },
  ];

  let offset = 0;
  bands.forEach(b => {
    const a = arc(b.n);
    const el = document.getElementById(b.id);
    if (!el) return;
    el.style.stroke           = b.color;
    el.style.strokeDasharray  = `${a} ${circ - a}`;
    el.style.strokeDashoffset = circ - offset;
    el.style.transform        = 'rotate(-90deg)';
    el.style.transformOrigin  = 'center';
    offset += a;
  });

  document.getElementById('dn-num').textContent         = total;
  document.getElementById('leg-critical').textContent   = nCrit;
  document.getElementById('leg-risk').textContent       = nRisk;
  document.getElementById('leg-watch').textContent      = nWatch;
  document.getElementById('leg-healthy').textContent    = nHealthy;
  document.getElementById('leg-expand').textContent     = nExpand;
}

// Score distribution bar chart
function renderDistChart(active) {
  const buckets = [
    { label:'0–24',  min:0,  max:24,  color:'#dc2626' },  // Critical — red
    { label:'25–49', min:25, max:49,  color:'#ea580c' },  // At Risk  — orange
    { label:'50–64', min:50, max:64,  color:'#d97706' },  // Watch    — amber
    { label:'65–79', min:65, max:79,  color:'#16a34a' },  // Healthy  — green
    { label:'80–100',min:80, max:100, color:'#0891b2' },  // Expansion — teal
  ];
  const counts = buckets.map(b => ({
    ...b,
    count: active.filter(c => c.score >= b.min && c.score <= b.max).length
  }));
  const max = Math.max(...counts.map(b=>b.count), 1);
  el('dist-chart').innerHTML = counts.map(b => `
    <div class="bar-row">
      <div class="bar-row__label">${b.label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(b.count/max)*100}%;background:${b.color}">
          ${b.count > 0 ? `<span class="bar-fill-lbl">${b.count}</span>` : ''}
        </div>
      </div>
      <div class="bar-row__val">${b.count}</div>
    </div>`).join('');
}

// MRR by status bar chart — 5 bands
function renderMrrChart(critical, risk, watch, healthy, expand) {
  const mrr = arr => arr.reduce((s,c)=>s+(c.mrr||0),0);
  const rows = [
    { label:'Critical',  val:mrr(critical), color:'#dc2626' },
    { label:'At Risk',   val:mrr(risk),     color:'#ea580c' },
    { label:'Watch',     val:mrr(watch),    color:'#d97706' },
    { label:'Healthy',   val:mrr(healthy),  color:'#16a34a' },
    { label:'Expansion', val:mrr(expand),   color:'#0891b2' },
  ];
  const maxV = Math.max(...rows.map(r=>r.val), 1);
  el('mrr-chart').innerHTML = rows.map(r => `
    <div class="bar-row">
      <div class="bar-row__label">${r.label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(r.val/maxV)*100}%;background:${r.color}">
          ${r.val > 0 ? `<span class="bar-fill-lbl">$${fmtNum(r.val)}</span>` : ''}
        </div>
      </div>
      <div class="bar-row__val">$${fmtNum(r.val)}</div>
    </div>`).join('');
}

// Segment avg score bar chart
function renderSegChart(active) {
  const segs = ['smb','mid','enterprise'];
  const segLabels = { smb:'SMB', mid:'Mid-Market', enterprise:'Enterprise' };
  const segColors = { smb:'#2563eb', mid:'#7c3aed', enterprise:'#0891b2' };
  const rows = segs.map(s => {
    const group = active.filter(c => c.tier === s);
    const avg   = group.length ? Math.round(group.reduce((a,c)=>a+c.score,0)/group.length) : null;
    return { label: segLabels[s], avg, count: group.length, color: segColors[s] };
  }).filter(r => r.count > 0);

  if (!rows.length) {
    el('seg-chart').innerHTML = '<div style="color:var(--subtle);font-size:.78rem;padding:12px 0">No customers yet</div>';
    return;
  }
  el('seg-chart').innerHTML = rows.map(r => `
    <div class="bar-row">
      <div class="bar-row__label">${r.label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${r.avg}%;background:${r.color}">
          ${r.avg >= 20 ? `<span class="bar-fill-lbl">${r.avg}</span>` : ''}
        </div>
      </div>
      <div class="bar-row__val">${r.avg}<span style="font-size:.66rem;color:var(--muted);margin-left:3px">(${r.count})</span></div>
    </div>`).join('');
}

// Signal heatmap
function dashHeatSortBy(key) {
  if (dashHeatSort.key === key) dashHeatSort.dir *= -1;
  else { dashHeatSort.key = key; dashHeatSort.dir = key === 'name' ? 1 : -1; }
  renderHeatmap(customers.filter(c => c.lifecycle !== 'churned'));
}

function renderHeatmap(active) {
  const wrap = el('heatmap-wrap');
  if (!active.length) {
    wrap.innerHTML = '<div style="color:var(--subtle);font-size:.8rem;padding:16px 0;text-align:center">No customers yet</div>';
    return;
  }

  // Sort
  const npsOrder = { promoter:3, passive:2, unknown:1, detractor:0 };
  const growOrder = { strong:2, mild:1, none:0 };
  const sorted = [...active].sort((a, b) => {
    let av, bv;
    switch (dashHeatSort.key) {
      case 'name':    av = a.name;     bv = b.name;     break;
      case 'score':   av = a.score;    bv = b.score;    break;
      case 'logins':  av = a.logins;   bv = b.logins;   break;
      case 'adoption':av = a.adoption; bv = b.adoption; break;
      case 'tickets': av = a.tickets;  bv = b.tickets;  break;
      case 'nps':     av = npsOrder[a.nps]||0; bv = npsOrder[b.nps]||0; break;
      case 'days':    av = a.days;     bv = b.days;     break;
      case 'growth':  av = growOrder[a.growth]||0; bv = growOrder[b.growth]||0; break;
      default:        av = a.score;    bv = b.score;
    }
    if (typeof av === 'string') return av.localeCompare(bv) * dashHeatSort.dir;
    return (av - bv) * dashHeatSort.dir;
  }).slice(0, 15);

  const hmColor = (v, inv) => {
    const n = inv ? 100 - v : v;
    if (n < 50) return 'hm-r';
    if (n < 80) return 'hm-y';
    return 'hm-g';
  };

  // Header helper — shows sort arrow on active column
  const thHeat = (key, label) => {
    const isActive = dashHeatSort.key === key;
    const arrow    = isActive ? (dashHeatSort.dir === 1 ? ' ↑' : ' ↓') : '';
    return `<th onclick="dashHeatSortBy('${key}')" style="cursor:pointer;user-select:none;${isActive?'color:var(--blue)':''}" title="Sort by ${label}">${label}${arrow}</th>`;
  };

  wrap.innerHTML = `<table>
    <thead><tr>
      ${thHeat('name',    'Customer')}
      ${thHeat('score',   'Score')}
      ${thHeat('logins',  'Logins')}
      ${thHeat('adoption','Adoption')}
      ${thHeat('tickets', 'Tickets')}
      ${thHeat('nps',     'NPS')}
      ${thHeat('days',    'Last Cont.')}
      ${thHeat('growth',  'Growth')}
    </tr></thead>
    <tbody>${sorted.map(c => {
      const loginPct  = Math.round((c.logins/30)*100);
      const ticketPct = Math.max(0,100-c.tickets*20);
      const npsPct    = {unknown:50,detractor:0,passive:65,promoter:100}[c.nps]||50;
      const daysPct   = Math.max(0,100-(c.days/180)*100);
      const growPct   = {none:25,mild:65,strong:100}[c.growth]||25;
      return `<tr>
        <td class="nc" style="cursor:pointer" onclick="openDetail('${escHtml(c.id)}')">${c.name}</td>
        <td class="${hmColor(c.score,false)}">${c.score}</td>
        <td class="${hmColor(loginPct,false)}">${c.logins}d</td>
        <td class="${hmColor(c.adoption,false)}">${c.adoption}%</td>
        <td class="${hmColor(ticketPct,false)}">${c.tickets}</td>
        <td class="${hmColor(npsPct,false)}">${c.nps}</td>
        <td class="${hmColor(daysPct,false)}">${c.days}d</td>
        <td class="${hmColor(growPct,false)}">${c.growth}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

// Recent table
function dashRecentSortBy(key) {
  if (dashRecentSort.key === key) dashRecentSort.dir *= -1;
  else {
    dashRecentSort.key = key;
    // Default direction: name → asc, everything else → desc
    dashRecentSort.dir = key === 'name' ? 1 : -1;
  }
  renderRecent(customers.filter(c => c.lifecycle !== 'churned'));
}

function renderRecent(active) {
  const wrap = el('recent-wrap');
  if (!wrap) return;
  if (!active.length) {
    wrap.innerHTML = '<div style="font-size:.78rem;color:var(--muted);padding:6px 0;text-align:center">No customers yet</div>';
    return;
  }
  // Show most recently scored (by created date), top 5
  const sorted = [...active]
    .sort((a,b) => new Date(b.created||0) - new Date(a.created||0))
    .slice(0, 5);

  wrap.innerHTML = sorted.map(c => `
    <div class="dash-recent-item" onclick="openDetail('${escHtml(c.id)}')">
      ${scoreHTML(c)}
      <span class="dash-recent-name">${escHtml(c.name)}</span>
      <span class="dash-recent-meta">${fmtDate(c.created)}</span>
    </div>`).join('');
}

// ─── THIS WEEK'S WINS ────────────────────────────────────────
function renderWins(active) {
  const wrap = el('wins-wrap');
  if (!wrap) return;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Find accounts with history entries in the last 7 days that improved
  const wins = [];
  active.forEach(c => {
    if (!c.history || c.history.length < 2) return;
    // Find the most recent score from the last 7 days
    const recent = [...c.history]
      .filter(h => new Date(h.date) >= weekAgo)
      .sort((a,b) => new Date(b.date) - new Date(a.date));
    if (!recent.length) return;
    // Compare to the score just before this week
    const beforeWeek = [...c.history]
      .filter(h => new Date(h.date) < weekAgo)
      .sort((a,b) => new Date(b.date) - new Date(a.date));
    const prevScore = beforeWeek.length ? beforeWeek[0].score : c.history[0].score;
    const newScore  = recent[0].score;
    const delta     = newScore - prevScore;
    if (delta > 0) wins.push({ c, delta, newScore, prevScore });
  });

  if (!wins.length) {
    wrap.innerHTML = '<div style="font-size:.78rem;color:var(--muted);padding:6px 0;text-align:center">No score improvements this week yet</div>';
    return;
  }

  // Sort by biggest improvement, show top 3 with "See all" link
  wins.sort((a,b) => b.delta - a.delta);
  const winsTotal = wins.length;
  const top = wins.slice(0, 3);
  const winsSeeAll = winsTotal > 3
    ? `<div class="widget-see-all" onclick="showAllDelta('up')">See all ${winsTotal} →</div>`
    : '';

  wrap.innerHTML = top.map(({ c, delta, newScore }) => {
    const st = getStatus(newScore);
    const badgeColor = STATUS_COLOR[st] || '#16a34a';
    const badgeBg    = { critical:'#fef2f2', risk:'#fff7ed', watch:'#fffbeb', healthy:'#f0fdf4', expand:'#ecfeff' }[st] || '#f0fdf4';
    return `
    <div class="win-item" onclick="openDetail('${escHtml(c.id)}')">
      <div style="width:32px;height:32px;border-radius:50%;background:${badgeBg};border:2px solid ${badgeColor};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span style="font-size:.72rem;font-weight:800;color:${badgeColor}">${newScore}</span>
      </div>
      <div style="flex:1;min-width:0">
        <div class="win-name">${escHtml(c.name)}</div>
        <div style="font-size:.68rem;color:var(--muted)">${STATUS_LABEL[st]}</div>
      </div>
      <span class="win-delta" style="display:flex;align-items:center;gap:3px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>+${delta}</span>
    </div>`;
  }).join('') + winsSeeAll;
}

// ─── BIGGEST DROPS ───────────────────────────────────────────
function renderDrops(active) {
  const wrap = el('drops-wrap');
  if (!wrap) return;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const drops = [];
  active.forEach(c => {
    if (!c.history || c.history.length < 2) return;
    const recent = [...c.history]
      .filter(h => new Date(h.date) >= weekAgo)
      .sort((a,b) => new Date(b.date) - new Date(a.date));
    if (!recent.length) return;
    const beforeWeek = [...c.history]
      .filter(h => new Date(h.date) < weekAgo)
      .sort((a,b) => new Date(b.date) - new Date(a.date));
    const prevScore = beforeWeek.length ? beforeWeek[0].score : c.history[0].score;
    const newScore  = recent[0].score;
    const delta     = newScore - prevScore;
    if (delta < 0) drops.push({ c, delta, newScore, prevScore });
  });

  if (!drops.length) {
    wrap.innerHTML = '<div style="font-size:.78rem;color:var(--muted);padding:6px 0;text-align:center">No score drops this week</div>';
    return;
  }

  // Sort by biggest drop (most negative first), show top 3 with "See all" link
  drops.sort((a,b) => a.delta - b.delta);
  const dropsTotal = drops.length;
  const topDrops   = drops.slice(0, 3);
  const dropsSeeAll = dropsTotal > 3
    ? `<div class="widget-see-all" onclick="showAllDelta('down')">See all ${dropsTotal} →</div>`
    : '';

  const statusBg = { critical:'#fef2f2', risk:'#fff7ed', watch:'#fffbeb', healthy:'#f0fdf4', expand:'#ecfeff' };

  wrap.innerHTML = topDrops.map(({ c, delta, newScore }) => {
    const st         = getStatus(newScore);
    const badgeColor = STATUS_COLOR[st] || '#ea580c';
    const badgeBg    = statusBg[st] || '#fff7ed';
    return `
    <div class="win-item" onclick="openDetail('${escHtml(c.id)}')">
      <div style="width:32px;height:32px;border-radius:50%;background:${badgeBg};border:2px solid ${badgeColor};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span style="font-size:.72rem;font-weight:800;color:${badgeColor}">${newScore}</span>
      </div>
      <div style="flex:1;min-width:0">
        <div class="win-name">${escHtml(c.name)}</div>
        <div style="font-size:.68rem;color:var(--muted)">${STATUS_LABEL[st]}</div>
      </div>
      <span style="font-size:.75rem;font-weight:800;color:#dc2626;white-space:nowrap;display:flex;align-items:center;gap:3px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>-${Math.abs(delta)}</span>
    </div>`;
  }).join('') + dropsSeeAll;
}

// ─── ALERTS ─────────────────────────────────────────────────

// Compute a customer's 7-day score delta (used for See All filtering + sorting)
function getDelta7d(c) {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const hist = c.history || [];
  const recent = hist.filter(h => new Date(h.date) >= weekAgo)
                     .sort((a,b) => new Date(b.date) - new Date(a.date));
  if (!recent.length) return 0;
  const before = hist.filter(h => new Date(h.date) < weekAgo)
                     .sort((a,b) => new Date(b.date) - new Date(a.date));
  const prev = before.length ? before[0].score : hist[0].score;
  return recent[0].score - prev;
}

// ─── RENEWAL PIPELINE WIDGET ─────────────────────────────────────────────────
function renderRenewalPipeline(active) {
  const wrap = el('renewal-pipeline-wrap');
  if (!wrap) return;
  const now = new Date(); now.setHours(0,0,0,0);
  const buckets = [
    { label:'0–30 days',  color:'#dc2626', bg:'#fef2f2', min:0,  max:30  },
    { label:'31–60 days', color:'#ea580c', bg:'#fff7ed', min:31, max:60  },
    { label:'61–90 days', color:'#d97706', bg:'#fffbeb', min:61, max:90  },
  ];
  const withDate = active.filter(c => c.renewal_date);
  if (!withDate.length) {
    wrap.innerHTML = '<div style="color:var(--subtle);font-size:.78rem;padding:8px 0;text-align:center">No accounts have a renewal date set. Add renewal dates when editing a customer.</div>';
    return;
  }
  const rows = buckets.map(b => {
    const grp = withDate.filter(c => {
      const days = Math.round((new Date(c.renewal_date) - now) / 86400000);
      return days >= b.min && days <= b.max;
    });
    const mrr    = grp.reduce((s,c)=>s+(c.mrr||0),0);
    const atRisk = grp.filter(c=>c.status==='critical'||c.status==='risk').length;
    return { ...b, count:grp.length, mrr, atRisk };
  });
  wrap.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
    ${rows.map(r => {
      const riskBadge = r.atRisk ? `<span style="color:${r.color};font-size:.68rem;font-weight:700">⚠ ${r.atRisk} at risk</span>` : '';
      const countText = r.count ? `${r.count} acct${r.count!==1?'s':''}` : `<span style="color:var(--subtle)">—</span>`;
      return `<div style="border-left:3px solid ${r.color};background:${r.bg};border-radius:6px;padding:9px 12px">
        <div style="font-size:.65rem;font-weight:700;color:${r.color};text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">${r.label}</div>
        <div style="font-size:1.05rem;font-weight:800;color:#1e293b;margin-bottom:2px">${r.mrr ? '$'+fmtNum(r.mrr) : '—'}</div>
        <div style="font-size:.7rem;color:var(--muted);display:flex;gap:5px;align-items:center;flex-wrap:wrap">${countText}${r.atRisk?' · ':''}${riskBadge}</div>
      </div>`;
    }).join('')}
  </div>`;
}

// Navigate to customers page pre-filtered to all improvers or all decliners this week
function showAllDelta(direction) {
  filterMode = 'all';
  columnFilters = {};
  columnFilters['_delta'] = { type: direction }; // 'up' or 'down'
  sortKey = '_delta';
  sortDir = direction === 'up' ? -1 : 1; // improvements desc, drops asc
  nav('customers');
}

// ─── PRIORITY LIST ───────────────────────────────────────────
function calcPriorityScore(c) {
  try {
    let score = 0;
    // Health risk — more weight for lower scores
    score += Math.max(0, 100 - c.score) * 0.35;
    // Renewal urgency
    const u = getRenewalUrgency(c);
    if (u) score += u.score * 0.30;
    // Last touch cadence — overdue contact is urgent regardless of health
    const cad = getCadenceStatus(c);
    if (cad.status === 'overdue') score += 35;
    else if (cad.status === 'warn') score += 15;
    // Declining momentum
    const mom = getMomentum(c);
    if (mom === 'dn') score += 20;
    // High MRR accounts always matter more
    if (c.mrr > 5000)  score += 10;
    if (c.mrr > 15000) score += 10;
    // Negative sentiment
    const sent = latestSentiment(c);
    if (sent?.val === 'negative') score += 15;
    // Expansion opportunity — bump healthy/expanding accounts with high MRR up
    if (c.status === 'expand' && c.growth === 'strong') score += 12;
    if (c.status === 'expand' && c.mrr > 5000)          score += 8;
    return Math.round(score);
  } catch(e) { return 0; }
}

function buildPriorityReasons(c) {
  const reasons = [];
  const cad  = getCadenceStatus(c);
  const u    = getRenewalUrgency(c);
  const mom  = getMomentum(c);
  const sent = latestSentiment(c);

  // ── Negative / urgent signals first ──
  if (c.status === 'critical')                reasons.push('Critical health');
  else if (c.status === 'risk')               reasons.push('At risk score');
  else if (c.status === 'watch')              reasons.push('Score needs monitoring');

  if (cad.status === 'overdue')               reasons.push(`No contact in ${c.days}d`);
  else if (cad.status === 'warn')             reasons.push(`Touch overdue (${c.days}d)`);

  if (u?.level === 'critical')               reasons.push(`Renewal in ${c.renewal}mo — urgent`);
  else if (u?.level === 'high')              reasons.push(`Renewal in ${c.renewal}mo`);

  if (mom === 'dn')                          reasons.push('Score declining');
  if (sent?.val === 'negative')              reasons.push('Negative sentiment');

  // ── Positive signals for healthy/expansion ──
  if (!reasons.length) {
    if (c.status === 'expand' && c.growth === 'strong') reasons.push('Expansion ready');
    else if (c.status === 'expand')                     reasons.push('High health · expansion candidate');
    else if (c.status === 'healthy' && c.mrr > 10000)  reasons.push('High-value healthy account');
    else if (c.status === 'healthy')                    reasons.push('Healthy · maintain cadence');
    if (u?.level === 'medium')                          reasons.push(`Renewal in ${c.renewal}mo`);
    if (c.mrr > 10000 && !reasons.length)              reasons.push('High MRR account');
  }

  // ── Fallback ──
  if (!reasons.length) reasons.push('Scheduled check-in due');

  return reasons.slice(0, 2).join(' · ');
}

function renderPriorityList() { try { _renderPriorityList(); } catch(e) { console.error('renderPriorityList error:', e); } }
function _renderPriorityList() {
  // Support both old (priority-list-wrap) and new (priority-table-wrap) element IDs
  const wrap = el('priority-table-wrap') || el('priority-list-wrap');
  if (!wrap) return;
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!active.length) {
    wrap.innerHTML = '<p style="font-size:.82rem;color:var(--muted);text-align:center;padding:28px 0">No customers yet. Score your first customer to see priority recommendations.</p>';
    return;
  }
  const ranked = [...active]
    .map(c => ({ c, pri: calcPriorityScore(c) }))
    .sort((a,b) => b.pri - a.pri)
    .slice(0, 10);

  const statusRankCls = { critical:'pr-critical', risk:'pr1', watch:'pr-watch', healthy:'pr2', expand:'pr-expand' };

  const rows = ranked.map(({ c }, i) => {
    const urg = getRenewalUrgency(c);
    const urgColor = { Critical:'var(--red)', High:'var(--amber)', Medium:'var(--blue)', Low:'var(--subtle)', '':'var(--subtle)' }[urg] || 'var(--subtle)';
    const growth = c.growth === 'up' ? '<span style="color:var(--green);font-weight:700">Up</span>'
                 : c.growth === 'dn' ? '<span style="color:var(--red);font-weight:700">Down</span>'
                 : '<span style="color:var(--subtle)">Flat</span>';
    const lastTouch = c.days != null ? (c.days === 0 ? 'Today' : `${c.days}d ago`) : '—';
    const renewalStr = (() => {
      if (c.renewal_date) {
        const d = new Date(c.renewal_date);
        const today = new Date(); today.setHours(0,0,0,0);
        const days = Math.round((d - today) / 86400000);
        const col = days < 0 ? '#dc2626' : days <= 30 ? '#ea580c' : days <= 90 ? '#d97706' : 'var(--muted)';
        const lbl = days < 0 ? 'Overdue' : days === 0 ? 'Today' : `${days}d`;
        return `<span style="color:${col};font-weight:700">${lbl}</span>`;
      }
      if (c.renewal != null && c.renewal >= 0) {
        const urgColor2 = urg?.level === 'critical' ? '#dc2626' : urg?.level === 'high' ? '#ea580c' : 'var(--muted)';
        return `<span style="color:${urgColor2};font-weight:700">${c.renewal}mo</span>`;
      }
      return '<span style="color:var(--subtle)">—</span>';
    })();
    return `<tr onclick="openDetail('${escHtml(c.id)}')">
      <td style="padding-left:14px">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="p-rank ${statusRankCls[c.status]||'pr3'}">${i+1}</span>
          <div>
            <div style="font-weight:700;font-size:.83rem">${escHtml(c.name)}</div>
            <div style="font-size:.68rem;color:var(--muted);margin-top:1px">${buildPriorityReasons(c)}</div>
          </div>
        </div>
      </td>
      <td>${scoreHTML(c)}</td>
      <td style="font-weight:700">${c.mrr ? '$'+fmtNum(c.mrr) : '—'}</td>
      <td>${renewalStr}</td>
      <td>${growth}</td>
      <td style="font-size:.73rem;color:var(--muted)">${lastTouch}</td>
      <td style="font-size:.73rem;color:var(--muted)">${escHtml(c.manager||'—')}</td>
      <td>
        <div class="qa-btns">
          <button class="btn btn-xs btn-ghost" title="Open account" onclick="event.stopPropagation();openDetail('${escHtml(c.id)}')">Open</button>
          <button class="btn btn-xs btn-outline" title="Log a touch" onclick="event.stopPropagation();openDetail('${escHtml(c.id)}');setTimeout(()=>el('note-text')?.focus(),400)">Log</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<table class="ptbl">
    <thead><tr>
      <th style="padding-left:14px">Account</th>
      <th>Health</th>
      <th>MRR</th>
      <th>Renewal</th>
      <th>Growth</th>
      <th>Last Touch</th>
      <th>Owner</th>
      <th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

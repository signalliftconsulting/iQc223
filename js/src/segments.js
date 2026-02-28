// ─── SEGMENTS VIEW ───────────────────────────────────────────

let segSortKey = 'mrr';
let segSortDir = 'desc';
let _hideUntagged = localStorage.getItem('iqc_hide_untagged') === 'true';

function toggleHideUntagged() {
  _hideUntagged = !_hideUntagged;
  localStorage.setItem('iqc_hide_untagged', _hideUntagged);
  renderSegments();
}

function renderSegments() {
  const kpiRow = el('seg-kpi-row');
  const cardsWrap = el('seg-cards-wrap');
  const tableWrap = el('seg-table-wrap');
  const insightsWrap = el('seg-insights-wrap');
  if (!kpiRow) return;

  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));

  // Cache getDelta7d once per customer
  const deltaCache = new Map();
  active.forEach(c => deltaCache.set(c.id, getDelta7d(c)));

  // Build enriched segment data
  const tagMap = {};
  active.forEach(c => {
    (c.tags || []).forEach(tag => {
      if (!tagMap[tag]) tagMap[tag] = { tag, custs: [], totalMRR: 0, healthy: 0, watch: 0, atRisk: 0, riskMRR: 0, overdueCount: 0, renewals90: 0 };
      const seg = tagMap[tag];
      seg.custs.push(c);
      seg.totalMRR += (c.mrr || 0);
      if (c.status === 'healthy' || c.status === 'expand') seg.healthy++;
      else if (c.status === 'watch') seg.watch++;
      else if (c.status === 'critical' || c.status === 'risk') { seg.atRisk++; seg.riskMRR += (c.mrr || 0); }
      if (c.days != null && c.days >= 14) seg.overdueCount++;
      if (c.renewal != null && c.renewal > 0 && c.renewal <= 3) seg.renewals90++;
    });
  });

  // Collect untagged customers into a virtual segment
  const untaggedCustomers = active.filter(c => !c.tags || c.tags.length === 0);
  if (untaggedCustomers.length > 0) {
    tagMap[SEG_UNTAGGED] = { tag: SEG_UNTAGGED, custs: [], totalMRR: 0, healthy: 0, watch: 0, atRisk: 0, riskMRR: 0, overdueCount: 0, renewals90: 0 };
    const seg = tagMap[SEG_UNTAGGED];
    untaggedCustomers.forEach(c => {
      seg.custs.push(c);
      seg.totalMRR += (c.mrr || 0);
      if (c.status === 'healthy' || c.status === 'expand') seg.healthy++;
      else if (c.status === 'watch') seg.watch++;
      else if (c.status === 'critical' || c.status === 'risk') { seg.atRisk++; seg.riskMRR += (c.mrr || 0); }
      if (c.days != null && c.days >= 14) seg.overdueCount++;
      if (c.renewal != null && c.renewal > 0 && c.renewal <= 3) seg.renewals90++;
    });
  }

  const segments = Object.values(tagMap).map(seg => {
    seg.count = seg.custs.length;
    seg.avgScore = Math.round(seg.custs.reduce((s, c) => s + c.score, 0) / seg.count);
    seg.avgDelta = Math.round(seg.custs.reduce((s, c) => s + (deltaCache.get(c.id) || 0), 0) / seg.count * 10) / 10;
    seg.riskPct = Math.round((seg.atRisk / seg.count) * 100);
    seg.avgDays = seg.custs.filter(c => c.days != null).length
      ? Math.round(seg.custs.filter(c => c.days != null).reduce((s, c) => s + c.days, 0) / seg.custs.filter(c => c.days != null).length)
      : null;
    return seg;
  });

  // Apply "Hide Untagged" filter
  const visibleSegments = _hideUntagged ? segments.filter(s => s.tag !== SEG_UNTAGGED) : segments;

  // Cache for drill-down usage
  window._segData = visibleSegments;
  window._segDeltaCache = deltaCache;

  if (!visibleSegments.length) {
    const tagIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';
    kpiRow.innerHTML = '';
    if (cardsWrap) cardsWrap.innerHTML = `<div class="empty-st"><div class="ei" style="font-size:1.5rem;color:var(--muted)">${tagIcon}</div><h3>No tags yet</h3><p>Add tags to customers via the edit form or bulk-tag to create segments.</p></div>`;
    if (tableWrap) tableWrap.innerHTML = '';
    if (insightsWrap) insightsWrap.innerHTML = '';
    return;
  }

  const subtitle = el('seg-subtitle');
  if (subtitle) subtitle.textContent = `${visibleSegments.length} segment${visibleSegments.length !== 1 ? 's' : ''} \u00b7 ${active.length} accounts`;

  const toggleBtn = document.getElementById('seg-toggle-untagged');
  if (toggleBtn) toggleBtn.textContent = _hideUntagged ? 'Show Untagged' : 'Hide Untagged';

  renderSegKPIs(visibleSegments, active);
  renderSegCardGrid(visibleSegments);
  renderSegTable(visibleSegments);
  renderSegInsights(visibleSegments);
}

/* ── Segment KPI Cards ─────────────────────────────────────── */
function renderSegKPIs(segments, active) {
  const wrap = el('seg-kpi-row');
  if (!wrap) return;

  const _si = (path) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const icons = {
    tag:     _si('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'),
    people:  _si('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    dollar:  _si('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
    alert:   _si('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    trendUp: _si('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
  };

  // Unique account count
  const uniqueIds = new Set();
  segments.forEach(seg => seg.custs.forEach(c => uniqueIds.add(c.id)));
  const uniqueCount = uniqueIds.size;

  // Total unique MRR (by unique customer)
  const mrrMap = new Map();
  segments.forEach(seg => seg.custs.forEach(c => mrrMap.set(c.id, c.mrr || 0)));
  const totalMRR = [...mrrMap.values()].reduce((s, v) => s + v, 0);

  // Risk MRR (unique customers that are at risk)
  const riskIds = new Set();
  segments.forEach(seg => seg.custs.filter(c => c.status === 'critical' || c.status === 'risk').forEach(c => riskIds.add(c.id)));
  const riskMRR = [...riskIds].reduce((s, id) => s + (mrrMap.get(id) || 0), 0);

  // Highest-risk segment (by riskPct, min 3 accounts)
  const qualifiedSegs = segments.filter(s => s.count >= 2);
  const highestRisk = qualifiedSegs.length ? qualifiedSegs.reduce((a, b) => a.riskPct > b.riskPct ? a : b) : null;
  const hrColor = 'dash-kpi-red';

  // Fastest growing segment (by avgDelta)
  const fastestGrow = segments.length ? segments.reduce((a, b) => a.avgDelta > b.avgDelta ? a : b) : null;

  wrap.innerHTML = `
    <div class="dash-kpi-card dash-kpi-blue">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${icons.tag}</div>
        <span class="dash-kpi-label">Total Segments</span>
      </div>
      <div class="dash-kpi-num">${segments.length}</div>
      <div class="dash-kpi-sub">customer tag groups</div>
    </div>
    <div class="dash-kpi-card dash-kpi-purple">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${icons.people}</div>
        <span class="dash-kpi-label">Total Accounts</span>
      </div>
      <div class="dash-kpi-num">${uniqueCount}</div>
      <div class="dash-kpi-sub">across ${segments.length} segment${segments.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="dash-kpi-card dash-kpi-teal">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${icons.dollar}</div>
        <span class="dash-kpi-label">Segment MRR</span>
      </div>
      <div class="dash-kpi-num">$${fmtNum(totalMRR)}</div>
      <div class="dash-kpi-sub">${riskMRR > 0 ? '$' + fmtNum(riskMRR) + ' at risk' : 'No MRR at risk'}</div>
    </div>
    <div class="dash-kpi-card ${hrColor}">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${icons.alert}</div>
        <span class="dash-kpi-label">Highest-Risk</span>
      </div>
      <div class="dash-kpi-num" style="font-size:1.4rem">${highestRisk ? escHtml(segDisplayLabel(highestRisk.tag)) : '—'}</div>
      <div class="dash-kpi-sub">${highestRisk ? highestRisk.riskPct + '% at risk' : 'No data'}</div>
    </div>
    <div class="dash-kpi-card dash-kpi-green">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${icons.trendUp}</div>
        <span class="dash-kpi-label">Fastest-Growing</span>
      </div>
      <div class="dash-kpi-num" style="font-size:1.4rem">${fastestGrow ? escHtml(segDisplayLabel(fastestGrow.tag)) : '—'}</div>
      <div class="dash-kpi-sub">${fastestGrow ? (fastestGrow.avgDelta >= 0 ? '+' : '') + fastestGrow.avgDelta + ' avg trend' : 'No data'}</div>
    </div>
  `;
}

/* ── Segment Cards (enriched) ──────────────────────────────── */
function renderSegCardGrid(segments) {
  const wrap = el('seg-cards-wrap');
  if (!wrap) return;

  const sorted = [...segments].sort((a, b) => b.totalMRR - a.totalMRR);

  const scoreColor = v => v >= (thresholds.healthy || 80) ? 'var(--green)' : v >= (thresholds.watch || 65) ? 'var(--amber)' : v >= (thresholds.risk || 50) ? 'var(--orange,#ea580c)' : 'var(--red)';
  const scoreBg = v => v >= (thresholds.healthy || 80) ? 'var(--green-l)' : v >= (thresholds.watch || 65) ? 'var(--amber-l)' : v >= (thresholds.risk || 50) ? 'rgba(234,88,12,.1)' : 'var(--red-l)';

  let html = `<div class="seg-cards-grid">${sorted.map(seg => {
    const trendCls = seg.avgDelta > 0 ? 'up' : seg.avgDelta < 0 ? 'dn' : 'flat';
    const trendIcon = seg.avgDelta > 0 ? '▲' : seg.avgDelta < 0 ? '▼' : '—';
    const trendTxt = seg.avgDelta > 0 ? '+' + seg.avgDelta : '' + seg.avgDelta;
    const total = seg.healthy + seg.watch + seg.atRisk;
    const hPct = total ? Math.round((seg.healthy / total) * 100) : 0;
    const wPct = total ? Math.round((seg.watch / total) * 100) : 0;
    const rPct = total ? 100 - hPct - wPct : 0;
    const safeTag = seg.tag.replace(/'/g, "\\'").replace(/"/g, '&quot;');

    return `<div class="card seg-card" data-seg="${escHtml(seg.tag)}" onclick="drillSegFromCard('${safeTag}')" style="cursor:pointer">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span class="tag" style="font-size:.78rem">${escHtml(segDisplayLabel(seg.tag))}</span>
        <span class="seg-score-badge" style="color:${scoreColor(seg.avgScore)};background:${scoreBg(seg.avgScore)}">${seg.avgScore}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
        <span style="font-size:1.7rem;font-weight:800;line-height:1">${seg.count}</span>
        <span class="seg-card-trend ${trendCls}">${trendIcon} ${trendTxt}</span>
      </div>
      <div style="font-size:.7rem;color:var(--muted);margin-bottom:10px">account${seg.count !== 1 ? 's' : ''}</div>
      <div class="seg-health-bar" style="height:6px;margin-bottom:12px" title="${seg.healthy} healthy · ${seg.watch} watch · ${seg.atRisk} at risk">
        ${hPct ? `<span class="seg-health-seg" style="width:${hPct}%;background:var(--green)"></span>` : ''}
        ${wPct ? `<span class="seg-health-seg" style="width:${wPct}%;background:var(--amber)"></span>` : ''}
        ${rPct ? `<span class="seg-health-seg" style="width:${rPct}%;background:var(--red)"></span>` : ''}
      </div>
      <div class="seg-card__divider"></div>
      <div class="seg-card__row">
        <span class="seg-card__row-label">MRR</span>
        <span class="seg-card__row-val">$${fmtNum(seg.totalMRR)}</span>
      </div>
      <div class="seg-card__row">
        <span class="seg-card__row-label">At Risk</span>
        <span class="seg-card__row-val" style="color:${seg.atRisk ? 'var(--red)' : 'var(--green)'}">${seg.atRisk ? seg.atRisk + ' (' + seg.riskPct + '%)' : 'None'}</span>
      </div>
      ${seg.overdueCount ? `<div class="seg-card__row"><span class="seg-card__row-label">Overdue</span><span class="seg-card__row-val" style="color:var(--red)">${seg.overdueCount}</span></div>` : ''}
    </div>`;
  }).join('')}</div>`;

  html += `<div id="seg-card-expand" class="seg-expand-panel"></div>`;
  wrap.innerHTML = html;
}

/* ── Segment Comparison Table ──────────────────────────────── */
function renderSegTable(segments) {
  const wrap = el('seg-table-wrap');
  if (!wrap) return;

  const sortIcon = key => {
    if (segSortKey !== key) return '';
    return segSortDir === 'asc' ? ' ▲' : ' ▼';
  };
  const activeClass = key => segSortKey === key ? 'seg-sort-active' : '';

  const sorted = [...segments].sort((a, b) => {
    let va, vb;
    switch (segSortKey) {
      case 'tag':      va = a.tag.toLowerCase(); vb = b.tag.toLowerCase(); return segSortDir === 'asc' ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1);
      case 'count':    va = a.count; vb = b.count; break;
      case 'avgScore': va = a.avgScore; vb = b.avgScore; break;
      case 'avgDelta': va = a.avgDelta; vb = b.avgDelta; break;
      case 'mrr':      va = a.totalMRR; vb = b.totalMRR; break;
      case 'riskPct':  va = a.riskPct; vb = b.riskPct; break;
      case 'avgDays':  va = a.avgDays || 0; vb = b.avgDays || 0; break;
      case 'renewals': va = a.renewals90; vb = b.renewals90; break;
      default:         va = a.totalMRR; vb = b.totalMRR;
    }
    return segSortDir === 'asc' ? va - vb : vb - va;
  });

  const chevronDown = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  const scoreColor = v => v >= (thresholds.healthy || 80) ? 'var(--green)' : v >= (thresholds.watch || 65) ? 'var(--amber)' : v >= (thresholds.risk || 50) ? 'var(--orange,#ea580c)' : 'var(--red)';

  const colCount = 9;
  window._segColCount = colCount;

  wrap.innerHTML = `<div class="seg-table-wrap-scroll">
    <table class="ct" style="min-width:900px">
      <thead><tr>
        <th class="seg-sort-btn ${activeClass('tag')}" onclick="sortSegTable('tag')">Segment${sortIcon('tag')}</th>
        <th class="seg-sort-btn ${activeClass('count')}" onclick="sortSegTable('count')">Accounts${sortIcon('count')}</th>
        <th class="seg-sort-btn ${activeClass('avgScore')}" onclick="sortSegTable('avgScore')">Avg Score${sortIcon('avgScore')}</th>
        <th class="seg-sort-btn ${activeClass('avgDelta')}" onclick="sortSegTable('avgDelta')">Trend (7d)${sortIcon('avgDelta')}</th>
        <th class="seg-sort-btn ${activeClass('mrr')}" onclick="sortSegTable('mrr')">MRR${sortIcon('mrr')}</th>
        <th class="seg-sort-btn ${activeClass('riskPct')}" onclick="sortSegTable('riskPct')">At-Risk %${sortIcon('riskPct')}</th>
        <th class="seg-sort-btn ${activeClass('avgDays')}" onclick="sortSegTable('avgDays')">Avg Contact${sortIcon('avgDays')}</th>
        <th class="seg-sort-btn ${activeClass('renewals')}" onclick="sortSegTable('renewals')">Renewals \u226490d${sortIcon('renewals')}</th>
        <th style="width:90px"></th>
      </tr></thead>
      <tbody id="seg-table-tbody">${sorted.map(seg => {
        const trendCls = seg.avgDelta > 0 ? 'up' : seg.avgDelta < 0 ? 'dn' : 'flat';
        const trendIcon = seg.avgDelta > 0 ? '▲' : seg.avgDelta < 0 ? '▼' : '—';
        const trendTxt = seg.avgDelta > 0 ? '+' + seg.avgDelta : '' + seg.avgDelta;
        const safeTag = seg.tag.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const contactStr = seg.avgDays != null ? seg.avgDays + 'd' : '—';
        return `<tr class="seg-table-row" data-seg="${escHtml(seg.tag)}">
          <td><strong>${escHtml(segDisplayLabel(seg.tag))}</strong></td>
          <td>${seg.count}</td>
          <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.78rem;font-weight:700;color:${scoreColor(seg.avgScore)};background:${seg.avgScore >= 65 ? 'var(--green-l)' : seg.avgScore >= 50 ? 'var(--amber-l)' : 'var(--red-l)'}">${seg.avgScore}</span></td>
          <td><span class="csm-trend ${trendCls}" style="font-size:.68rem;padding:1px 6px">${trendIcon} ${trendTxt}</span></td>
          <td>$${fmtNum(seg.totalMRR)}</td>
          <td><span style="font-weight:700;color:${seg.riskPct > 30 ? 'var(--red)' : seg.riskPct > 0 ? 'var(--amber)' : 'var(--green)'}">${seg.riskPct}%</span> <span style="font-size:.7rem;color:var(--muted)">(${seg.atRisk})</span></td>
          <td>${contactStr}</td>
          <td>${seg.renewals90}</td>
          <td><button class="btn-sm csm-expand-btn" onclick="event.stopPropagation();drillSeg('${safeTag}')">${chevronDown} Expand</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

function sortSegTable(key) {
  if (segSortKey === key) segSortDir = segSortDir === 'asc' ? 'desc' : 'asc';
  else { segSortKey = key; segSortDir = key === 'tag' ? 'asc' : 'desc'; }
  const segments = window._segData;
  if (segments) renderSegTable(segments);
}

/* ── Shared Drill-Down Builder ─────────────────────────────── */
function buildSegDrillHTML(tagName) {
  const segments = window._segData || [];
  const deltaCache = window._segDeltaCache || new Map();
  const seg = segments.find(s => s.tag === tagName);
  if (!seg) return '<p>No data for this segment.</p>';

  const accs = seg.custs;
  const avgScore = seg.avgScore;
  const totalMRR = seg.totalMRR;
  const hmColor = v => v >= 65 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)';
  const dColor = seg.avgDelta > 0 ? 'var(--green)' : seg.avgDelta < 0 ? 'var(--red)' : 'var(--muted)';
  const dIcon = seg.avgDelta > 0 ? '▲' : seg.avgDelta < 0 ? '▼' : '—';

  let summaryHTML = `<div class="csm-drill-stats">
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${hmColor(avgScore)}">${avgScore}</div>
      <div class="csm-drill-stat__label">Avg Score</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${dColor}">${dIcon} ${Math.abs(seg.avgDelta)}</div>
      <div class="csm-drill-stat__label">7d Trend</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">${seg.count}</div>
      <div class="csm-drill-stat__label">Accounts</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">$${fmtNum(totalMRR)}</div>
      <div class="csm-drill-stat__label">Total MRR</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:var(--green)">${seg.healthy}</div>
      <div class="csm-drill-stat__label">Healthy</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${seg.atRisk ? 'var(--red)' : 'var(--muted)'}">${seg.atRisk}</div>
      <div class="csm-drill-stat__label">At Risk</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${seg.overdueCount ? 'var(--red)' : 'var(--muted)'}">${seg.overdueCount}</div>
      <div class="csm-drill-stat__label">Overdue</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">${seg.renewals90}</div>
      <div class="csm-drill-stat__label">Renewals \u226490d</div>
    </div>
  </div>`;

  // Sort by urgency
  const urgency = c => {
    const statusW = c.status === 'critical' ? 5 : c.status === 'risk' ? 4 : c.status === 'watch' ? 3 : c.status === 'healthy' ? 2 : 1;
    const renewalW = c.renewal != null && c.renewal > 0 ? Math.max(0, 13 - c.renewal) : 0;
    const mrrW = (c.mrr || 0) / 10000;
    const contactW = (c.days != null && c.days >= 14) ? 2 : 0;
    return (statusW * 10) + renewalW + mrrW + contactW;
  };
  const sorted = [...accs].sort((a, b) => urgency(b) - urgency(a));

  const OVERDUE_DAYS = 14;
  const tableHTML = `<table class="ct" style="min-width:auto;margin:0">
    <thead><tr>
      <th>Customer</th><th>Score</th><th>Trend</th><th>Status</th><th>MRR</th><th>Last Contact</th><th>Renewal</th><th>Lifecycle</th>
    </tr></thead>
    <tbody>${sorted.map(c => {
      const renewStr = c.renewal_date ? new Date(c.renewal_date).toLocaleDateString() : (c.renewal ? c.renewal + 'mo' : '—');
      const isOverdue = c.days != null && c.days >= OVERDUE_DAYS;
      const delta = deltaCache.get(c.id) || 0;
      const trendHTML = delta > 0
        ? `<span class="csm-trend up" style="font-size:.68rem;padding:1px 6px">▲ +${delta}</span>`
        : delta < 0
          ? `<span class="csm-trend dn" style="font-size:.68rem;padding:1px 6px">▼ ${delta}</span>`
          : `<span class="csm-trend flat" style="font-size:.68rem;padding:1px 6px">— 0</span>`;
      const contactCell = isOverdue
        ? `<span style="font-weight:700;color:var(--red)">${c.days}d ago</span> <span class="csm-overdue">OVERDUE</span>`
        : (c.days != null ? c.days + 'd ago' : '—');
      return `<tr style="cursor:pointer" onclick="openDetail('${escHtml(c.id)}')">
        <td><strong>${escHtml(c.name)}</strong></td>
        <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.78rem;font-weight:700;color:${c.score >= 65 ? 'var(--green)' : c.score >= 50 ? 'var(--amber)' : 'var(--red)'};background:${c.score >= 65 ? 'var(--green-l)' : c.score >= 50 ? 'var(--amber-l)' : 'var(--red-l)'}">${c.score}</span></td>
        <td>${trendHTML}</td>
        <td>${badgeHTML(c.status)}</td>
        <td>$${fmtNum(c.mrr || 0)}</td>
        <td>${contactCell}</td>
        <td>${renewStr}</td>
        <td style="font-size:.78rem;color:var(--muted)">${c.lifecycle || '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;

  const safeTag = tagName.replace(/'/g, "\\'");
  const viewBtn = `<div style="text-align:right;margin-top:12px"><button class="btn-sm" onclick="filterByTag('${safeTag}')" style="gap:4px">View in Customers <span style="font-size:.8rem">\u2192</span></button></div>`;

  return summaryHTML + tableHTML + viewBtn;
}

/* ── Table Row Expand (drillSeg) ───────────────────────────── */
function drillSeg(tagName) {
  const tbody = el('seg-table-tbody');
  if (!tbody) return;
  const colCount = window._segColCount || 9;

  const parentRow = tbody.querySelector(`tr.seg-table-row[data-seg="${CSS.escape(tagName)}"]`);
  if (!parentRow) return;

  // Toggle off if already expanded
  const existingExpand = parentRow.nextElementSibling;
  if (existingExpand && existingExpand.classList.contains('seg-table-expand-row')) {
    existingExpand.remove();
    parentRow.classList.remove('seg-row-expanded');
    const btn = parentRow.querySelector('.csm-expand-btn');
    if (btn) btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Expand`;
    return;
  }

  // Collapse any other open expand
  const prevExpanded = tbody.querySelector('tr.seg-table-expand-row');
  if (prevExpanded) {
    const prevParent = prevExpanded.previousElementSibling;
    if (prevParent) {
      prevParent.classList.remove('seg-row-expanded');
      const prevBtn = prevParent.querySelector('.csm-expand-btn');
      if (prevBtn) prevBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Expand`;
    }
    prevExpanded.remove();
  }

  parentRow.classList.add('seg-row-expanded');
  const btn = parentRow.querySelector('.csm-expand-btn');
  if (btn) btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg> Collapse`;

  const expandRow = document.createElement('tr');
  expandRow.className = 'seg-table-expand-row';
  expandRow.innerHTML = `<td colspan="${colCount}" class="seg-table-expand-cell">${buildSegDrillHTML(tagName)}</td>`;
  parentRow.after(expandRow);
}

/* ── Card Grid Expand (drillSegFromCard) ───────────────────── */
function drillSegFromCard(tagName) {
  const panel = document.getElementById('seg-card-expand');
  if (!panel) return;

  // Clear previous card highlight
  const prevCard = document.querySelector('.seg-card.seg-expanded');
  if (prevCard) prevCard.classList.remove('seg-expanded');

  // Toggle off if clicking same card
  if (panel.classList.contains('open') && panel.dataset.seg === tagName) {
    panel.classList.remove('open');
    panel.dataset.seg = '';
    panel.innerHTML = '';
    return;
  }

  // Highlight clicked card
  const card = document.querySelector(`.seg-card[data-seg="${CSS.escape(tagName)}"]`);
  if (card) card.classList.add('seg-expanded');

  panel.dataset.seg = tagName;
  panel.innerHTML = buildSegDrillHTML(tagName);
  panel.classList.add('open');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ── Segment Insights (auto-generated) ─────────────────────── */
function renderSegInsights(segments) {
  const wrap = el('seg-insights-wrap');
  if (!wrap) return;

  const _si = (path) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const iconAlert    = _si('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>');
  const iconCalendar = _si('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>');
  const iconTrendDn  = _si('<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>');
  const iconPhone    = _si('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>');
  const iconTrendUp  = _si('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>');
  const iconCheck    = _si('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>');

  const insights = [];

  segments.forEach(seg => {
    // High risk % (priority 4)
    if (seg.riskPct > 40 && seg.count >= 3) {
      insights.push({ priority: 4, icon: iconAlert, bg: 'var(--red-l)', color: 'var(--red)',
        html: `<strong>${escHtml(segDisplayLabel(seg.tag))}</strong> has <strong>${seg.riskPct}%</strong> at risk (${seg.atRisk}/${seg.count})` });
    }
    // At-risk renewals in 90 days (priority 4)
    const riskRenewals = seg.custs.filter(c => (c.status === 'critical' || c.status === 'risk') && c.renewal != null && c.renewal > 0 && c.renewal <= 3).length;
    if (riskRenewals > 0) {
      insights.push({ priority: 4, icon: iconCalendar, bg: 'var(--red-l)', color: 'var(--red)',
        html: `<strong>${escHtml(segDisplayLabel(seg.tag))}</strong> has <strong>${riskRenewals}</strong> at-risk renewal${riskRenewals !== 1 ? 's' : ''} in 90 days` });
    }
    // Declining segment (priority 3)
    if (seg.avgDelta < -2) {
      insights.push({ priority: 3, icon: iconTrendDn, bg: 'var(--amber-l)', color: 'var(--amber)',
        html: `<strong>${escHtml(segDisplayLabel(seg.tag))}</strong> is declining (${seg.avgDelta} avg this week)` });
    }
    // Overdue contacts (priority 3)
    if (seg.overdueCount > 0) {
      insights.push({ priority: 3, icon: iconPhone, bg: 'var(--amber-l)', color: 'var(--amber)',
        html: `<strong>${escHtml(segDisplayLabel(seg.tag))}</strong> has <strong>${seg.overdueCount}</strong> overdue contact${seg.overdueCount !== 1 ? 's' : ''} (14+ days)` });
    }
  });

  // Positive callouts (priority 0)
  const bestAvgScore = segments.reduce((a, b) => a.avgScore > b.avgScore ? a : b, segments[0]);
  if (bestAvgScore && bestAvgScore.avgScore >= 70) {
    insights.push({ priority: 0, icon: iconTrendUp, bg: 'var(--green-l)', color: 'var(--green)',
      html: `<strong>${escHtml(segDisplayLabel(bestAvgScore.tag))}</strong> is your healthiest segment (avg ${bestAvgScore.avgScore})` });
  }
  const bestDelta = segments.reduce((a, b) => a.avgDelta > b.avgDelta ? a : b, segments[0]);
  if (bestDelta && bestDelta.avgDelta >= 3) {
    insights.push({ priority: 0, icon: iconTrendUp, bg: 'var(--green-l)', color: 'var(--green)',
      html: `<strong>${escHtml(segDisplayLabel(bestDelta.tag))}</strong> is growing fastest (+${bestDelta.avgDelta} this week)` });
  }

  // Sort by priority desc, show top 8
  insights.sort((a, b) => b.priority - a.priority);
  const top = insights.slice(0, 8);

  if (!top.length) {
    wrap.innerHTML = `<div class="csm-focus-item" style="justify-content:center;padding:24px">
      <div class="csm-focus-icon" style="background:var(--green-l);color:var(--green)">${iconCheck}</div>
      <div class="csm-focus-text"><strong style="color:var(--muted)">No urgent segment focus areas</strong></div>
    </div>`;
    return;
  }

  wrap.innerHTML = top.map(ins => `<div class="csm-focus-item">
    <div class="csm-focus-icon" style="background:${ins.bg};color:${ins.color}">${ins.icon}</div>
    <div class="csm-focus-text"><p style="margin:0">${ins.html}</p></div>
  </div>`).join('');
}

function filterByTag(tag) {
  nav('customers');
  if (tag === SEG_UNTAGGED) {
    columnFilters['tags'] = { type: 'untagged' };
  } else {
    columnFilters['tags'] = { type: 'text', q: tag };
  }
  renderCustomers();
}

// Bulksheet export — import-compatible headers + current data, ready to re-upload
function exportBulksheet() {
  const filtered = customers.filter(c => passesManagerFilter(c));
  const hdr = 'name,manager,score,status,mrr,arr,tier,lifecycle,logins_30d,feature_adoption_pct,open_tickets,nps_category,days_since_contact,renewal_date,months_to_renewal,growth_signal,tags,since,next_touch,scoring_profile,note,sentiment,created';
  const rows = filtered.map(c => {
    const latestNote = (c.notes||[]).length ? c.notes[c.notes.length-1].text : '';
    const latestSent = (c.sentiment||[]).length ? c.sentiment[c.sentiment.length-1].val : '';
    return [
      c.name, c.manager||'', c.score, c.status,
      c.mrr||0, c.arr||0, c.tier||'mid', c.lifecycle||'active',
      c.logins||0, c.adoption||0, c.tickets||0, c.nps||'unknown', c.days||0,
      c.renewal_date||'', c.renewal||0, c.growth||'none',
      (c.tags||[]).join('|'), c.since||'', c.next_touch||'',
      c.scoring_profile||'Global Weights', latestNote, latestSent, c.created||''
    ].map(v => `"${String(v).replace(/"/g,'""')}"`)
    .join(',');
  });
  dlText(hdr + '\n' + rows.join('\n'), 'cs-health-bulksheet.csv', 'text/csv');
  toast(`Exported ${filtered.length} customer${filtered.length !== 1 ? 's' : ''} (bulksheet)`);
}


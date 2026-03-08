// ─── SEGMENTS VIEW ───────────────────────────────────────────

let segSortKey = 'mrr';
let segSortDir = 'desc';
let _hideUntagged = localStorage.getItem('iqc_hide_untagged') === 'true';
let _segView = 'segments';
let tierSortKey = 'mrr';
let tierSortDir = 'desc';

// ── Segment Chart State ──
let _segChartMetric = 'score';
let _segChartRange = '90d';
let _segChartSelected = []; // empty = all segments
let _segChartTipData = [];

const SEG_CHART_COLORS = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#6366f1'];

function _segRangeToDays(range) {
  if (range === 'ytd') {
    const now = new Date();
    return Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / 86400000);
  }
  return { '7d': 7, '30d': 30, '90d': 90, '6m': 180, '1y': 365, '2y': 730 }[range] || 90;
}

function aggregateSegmentByDay(custs, metricKey, cutoff) {
  const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
  const isSumMetric = cfg.agg === 'sum';
  const isCountMetric = cfg.agg === 'count';
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const _todayStr = new Date().toISOString().slice(0, 10);

  if (isSumMetric || isCountMetric) {
    const allDates = new Set();
    const custEntries = [];
    custs.forEach(c => {
      const valForDate = {};
      (c.history || []).forEach(h => {
        if (!h.date) return;
        const val = cfg.val(h, c);
        if (val == null || typeof val !== 'number' || isNaN(val)) return;
        const key = new Date(h.date).toISOString().slice(0, 10);
        valForDate[key] = val;
      });
      const sortedDates = Object.keys(valForDate).sort();
      if (sortedDates.length) {
        custEntries.push({ valForDate, sortedDates });
        sortedDates.forEach(d => { if (d >= cutoffStr && d < _todayStr) allDates.add(d); });
      }
    });
    const dates = [...allDates].sort();
    return dates.map(date => {
      let total = 0, count = 0;
      custEntries.forEach(ce => {
        let val = null;
        for (let i = ce.sortedDates.length - 1; i >= 0; i--) {
          if (ce.sortedDates[i] <= date) { val = ce.valForDate[ce.sortedDates[i]]; break; }
        }
        if (val !== null) { total += val; count++; }
      });
      return { date, avg: isCountMetric ? count : total };
    }).filter(p => p.avg > 0).sort((a, b) => a.date.localeCompare(b.date));
  }

  // Avg metrics: forward-fill
  const allDates = new Set();
  const custData = [];
  custs.forEach(c => {
    const dateMap = {};
    (c.history || []).forEach(h => {
      if (!h.date) return;
      const val = cfg.val(h, c);
      if (val == null || typeof val !== 'number' || isNaN(val)) return;
      const key = new Date(h.date).toISOString().slice(0, 10);
      dateMap[key] = val;
    });
    const sortedDates = Object.keys(dateMap).sort();
    if (sortedDates.length) {
      custData.push({ dateMap, sortedDates });
      sortedDates.forEach(d => { if (d >= cutoffStr && d < _todayStr) allDates.add(d); });
    }
  });
  const dates = [...allDates].sort();
  return dates.map(date => {
    let total = 0, count = 0;
    custData.forEach(cd => {
      let val = null;
      for (let i = cd.sortedDates.length - 1; i >= 0; i--) {
        if (cd.sortedDates[i] <= date) { val = cd.dateMap[cd.sortedDates[i]]; break; }
      }
      if (val !== null) { total += val; count++; }
    });
    return { date, avg: count ? total / count : 0 };
  }).filter(p => p.avg > 0);
}

function toggleSegView(view) {
  _segView = view;
  _segChartSelected = []; // reset selection on view switch
  const segBtn = document.getElementById('seg-view-segments');
  const tierBtn = document.getElementById('seg-view-tiers');
  const stageBtn = document.getElementById('seg-view-stage');
  if (segBtn) segBtn.classList.toggle('active', view === 'segments');
  if (tierBtn) tierBtn.classList.toggle('active', view === 'tiers');
  if (stageBtn) stageBtn.classList.toggle('active', view === 'stage');
  const active = window._segActive;
  const dc = window._segDeltaCache;
  if (view === 'segments') {
    const segs = window._segData;
    if (segs) { renderSegTable(segs); renderSegChart(segs, active, dc); }
  } else if (view === 'stage') {
    if (active) { renderStageTable(active, dc); renderSegChart(window._segData, active, dc); }
  } else {
    if (active) { renderTierTable(active, dc); renderSegChart(window._segData, active, dc); }
  }
}

function toggleHideUntagged() {
  _hideUntagged = !_hideUntagged;
  localStorage.setItem('iqc_hide_untagged', _hideUntagged);
  renderSegments();
}

function renderSegments() {
  const kpiRow = el('seg-kpi-row');
  const tableWrap = el('seg-table-wrap');
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
  window._segActive = active;

  if (!visibleSegments.length) {
    const tagIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';
    kpiRow.innerHTML = '';
    if (tableWrap) tableWrap.innerHTML = `<div class="empty-st"><div class="ei" style="font-size:1.5rem;color:var(--muted)">${tagIcon}</div><h3>No tags yet</h3><p>Add tags to customers via the edit form or bulk-tag to create segments.</p></div>`;
    return;
  }

  const subtitle = el('seg-subtitle');
  if (subtitle) subtitle.textContent = `${visibleSegments.length} segment${visibleSegments.length !== 1 ? 's' : ''} \u00b7 ${active.length} accounts`;

  const showBtn = document.getElementById('seg-untag-show');
  const hideBtn = document.getElementById('seg-untag-hide');
  if (showBtn && hideBtn) {
    showBtn.classList.toggle('active', !_hideUntagged);
    hideBtn.classList.toggle('active', _hideUntagged);
  }

  renderSegKPIs(visibleSegments, active);
  if (_segView === 'tiers') {
    renderTierTable(active, deltaCache);
  } else if (_segView === 'stage') {
    renderStageTable(active, deltaCache);
  } else {
    renderSegTable(visibleSegments);
  }
  renderSegChart(visibleSegments, active, deltaCache);
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

/* ── Tier Table View ───────────────────────────────────────── */
function _buildTierData(active, deltaCache) {
  const tierDefs = [
    { key: 'smb',        label: 'SMB',        pill: 'tier-pill-smb' },
    { key: 'mid',        label: 'Mid-Market', pill: 'tier-pill-mid' },
    { key: 'enterprise', label: 'Enterprise', pill: 'tier-pill-ent' }
  ];
  return tierDefs.map(td => {
    const custs = active.filter(c => (c.tier || 'mid') === td.key);
    const count = custs.length;
    const totalMRR = custs.reduce((s, c) => s + (c.mrr || 0), 0);
    const avgScore = count ? Math.round(custs.reduce((s, c) => s + c.score, 0) / count) : 0;
    const avgDelta = count ? Math.round(custs.reduce((s, c) => s + (deltaCache.get(c.id) || 0), 0) / count * 10) / 10 : 0;
    const healthy = custs.filter(c => c.status === 'healthy' || c.status === 'expand').length;
    const watch = custs.filter(c => c.status === 'watch').length;
    const atRisk = custs.filter(c => c.status === 'critical' || c.status === 'risk').length;
    const riskPct = count ? Math.round((atRisk / count) * 100) : 0;
    const overdueCount = custs.filter(c => c.days != null && c.days >= 14).length;
    const renewals90 = custs.filter(c => c.renewal != null && c.renewal > 0 && c.renewal <= 3).length;
    const withDays = custs.filter(c => c.days != null);
    const avgDays = withDays.length ? Math.round(withDays.reduce((s, c) => s + c.days, 0) / withDays.length) : null;
    return { key: td.key, label: td.label, pill: td.pill, custs, count, totalMRR, avgScore, avgDelta, healthy, watch, atRisk, riskPct, overdueCount, renewals90, avgDays };
  });
}

function renderTierTable(active, deltaCache) {
  const wrap = el('seg-table-wrap');
  if (!wrap) return;

  const tiers = _buildTierData(active, deltaCache);
  window._tierData = tiers;

  const sortIcon = key => {
    if (tierSortKey !== key) return '';
    return tierSortDir === 'asc' ? ' ▲' : ' ▼';
  };
  const activeClass = key => tierSortKey === key ? 'seg-sort-active' : '';

  const sorted = [...tiers].sort((a, b) => {
    let va, vb;
    switch (tierSortKey) {
      case 'label':    va = a.label.toLowerCase(); vb = b.label.toLowerCase(); return tierSortDir === 'asc' ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1);
      case 'count':    va = a.count; vb = b.count; break;
      case 'avgScore': va = a.avgScore; vb = b.avgScore; break;
      case 'avgDelta': va = a.avgDelta; vb = b.avgDelta; break;
      case 'mrr':      va = a.totalMRR; vb = b.totalMRR; break;
      case 'riskPct':  va = a.riskPct; vb = b.riskPct; break;
      case 'avgDays':  va = a.avgDays || 0; vb = b.avgDays || 0; break;
      case 'renewals': va = a.renewals90; vb = b.renewals90; break;
      default:         va = a.totalMRR; vb = b.totalMRR;
    }
    return tierSortDir === 'asc' ? va - vb : vb - va;
  });

  const chevronDown = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  const scoreColor = v => v >= (thresholds.healthy || 80) ? 'var(--green)' : v >= (thresholds.watch || 65) ? 'var(--amber)' : v >= (thresholds.risk || 50) ? 'var(--orange,#ea580c)' : 'var(--red)';

  const colCount = 9;
  window._tierColCount = colCount;

  wrap.innerHTML = `<div class="seg-table-wrap-scroll">
    <table class="ct" style="min-width:900px">
      <thead><tr>
        <th class="seg-sort-btn ${activeClass('label')}" onclick="sortTierTable('label')">Tier${sortIcon('label')}</th>
        <th class="seg-sort-btn ${activeClass('count')}" onclick="sortTierTable('count')">Accounts${sortIcon('count')}</th>
        <th class="seg-sort-btn ${activeClass('avgScore')}" onclick="sortTierTable('avgScore')">Avg Score${sortIcon('avgScore')}</th>
        <th class="seg-sort-btn ${activeClass('avgDelta')}" onclick="sortTierTable('avgDelta')">Trend (7d)${sortIcon('avgDelta')}</th>
        <th class="seg-sort-btn ${activeClass('mrr')}" onclick="sortTierTable('mrr')">MRR${sortIcon('mrr')}</th>
        <th class="seg-sort-btn ${activeClass('riskPct')}" onclick="sortTierTable('riskPct')">At-Risk %${sortIcon('riskPct')}</th>
        <th class="seg-sort-btn ${activeClass('avgDays')}" onclick="sortTierTable('avgDays')">Avg Contact${sortIcon('avgDays')}</th>
        <th class="seg-sort-btn ${activeClass('renewals')}" onclick="sortTierTable('renewals')">Renewals \u226490d${sortIcon('renewals')}</th>
        <th style="width:90px"></th>
      </tr></thead>
      <tbody id="seg-table-tbody">${sorted.map(t => {
        const trendCls = t.avgDelta > 0 ? 'up' : t.avgDelta < 0 ? 'dn' : 'flat';
        const trendIcon = t.avgDelta > 0 ? '▲' : t.avgDelta < 0 ? '▼' : '—';
        const trendTxt = t.avgDelta > 0 ? '+' + t.avgDelta : '' + t.avgDelta;
        const contactStr = t.avgDays != null ? t.avgDays + 'd' : '—';
        return `<tr class="seg-table-row" data-tier="${t.key}">
          <td><span class="tier-pill ${t.pill}">${t.label}</span></td>
          <td>${t.count}</td>
          <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:var(--fs-base);font-weight:700;color:${scoreColor(t.avgScore)};background:${t.avgScore >= 65 ? 'var(--green-l)' : t.avgScore >= 50 ? 'var(--amber-l)' : 'var(--red-l)'}">${t.avgScore}</span></td>
          <td><span class="csm-trend ${trendCls}" style="font-size:var(--fs-xs);padding:1px 6px">${trendIcon} ${trendTxt}</span></td>
          <td>$${fmtNum(t.totalMRR)}</td>
          <td><span style="font-weight:700;color:${t.riskPct > 30 ? 'var(--red)' : t.riskPct > 0 ? 'var(--amber)' : 'var(--green)'}">${t.riskPct}%</span> <span style="font-size:var(--fs-sm);color:var(--muted)">(${t.atRisk})</span></td>
          <td>${contactStr}</td>
          <td>${t.renewals90}</td>
          <td><button class="btn-sm csm-expand-btn" onclick="event.stopPropagation();drillTier('${t.key}')">${chevronDown} Expand</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

function sortTierTable(key) {
  if (tierSortKey === key) tierSortDir = tierSortDir === 'asc' ? 'desc' : 'asc';
  else { tierSortKey = key; tierSortDir = key === 'label' ? 'asc' : 'desc'; }
  const active = window._segActive;
  const dc = window._segDeltaCache;
  if (active) renderTierTable(active, dc);
}

function drillTier(tierKey) {
  const tbody = el('seg-table-tbody');
  if (!tbody) return;
  const colCount = window._tierColCount || 9;

  const parentRow = tbody.querySelector(`tr.seg-table-row[data-tier="${tierKey}"]`);
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

  parentRow.classList.add('seg-row-expanded');
  const btn = parentRow.querySelector('.csm-expand-btn');
  if (btn) btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg> Collapse`;

  const expandRow = document.createElement('tr');
  expandRow.className = 'seg-table-expand-row';
  expandRow.innerHTML = `<td colspan="${colCount}" class="seg-table-expand-cell">${buildTierDrillHTML(tierKey)}</td>`;
  parentRow.after(expandRow);
}

function buildTierDrillHTML(tierKey) {
  const tiers = window._tierData || [];
  const deltaCache = window._segDeltaCache || new Map();
  const tier = tiers.find(t => t.key === tierKey);
  if (!tier) return '<p>No data for this tier.</p>';

  const accs = tier.custs;
  const avgScore = tier.avgScore;
  const totalMRR = tier.totalMRR;
  const hmColor = v => v >= 65 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)';
  const dColor = tier.avgDelta > 0 ? 'var(--green)' : tier.avgDelta < 0 ? 'var(--red)' : 'var(--muted)';
  const dIcon = tier.avgDelta > 0 ? '▲' : tier.avgDelta < 0 ? '▼' : '—';

  let summaryHTML = `<div class="csm-drill-stats">
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${hmColor(avgScore)}">${avgScore}</div>
      <div class="csm-drill-stat__label">Avg Score</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${dColor}">${dIcon} ${Math.abs(tier.avgDelta)}</div>
      <div class="csm-drill-stat__label">7d Trend</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">${tier.count}</div>
      <div class="csm-drill-stat__label">Accounts</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">$${fmtNum(totalMRR)}</div>
      <div class="csm-drill-stat__label">Total MRR</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:var(--green)">${tier.healthy}</div>
      <div class="csm-drill-stat__label">Healthy</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${tier.atRisk ? 'var(--red)' : 'var(--muted)'}">${tier.atRisk}</div>
      <div class="csm-drill-stat__label">At Risk</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${tier.overdueCount ? 'var(--red)' : 'var(--muted)'}">${tier.overdueCount}</div>
      <div class="csm-drill-stat__label">Overdue</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">${tier.renewals90}</div>
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
        ? `<span class="csm-trend up" style="font-size:var(--fs-xs);padding:1px 6px">▲ +${delta}</span>`
        : delta < 0
          ? `<span class="csm-trend dn" style="font-size:var(--fs-xs);padding:1px 6px">▼ ${delta}</span>`
          : `<span class="csm-trend flat" style="font-size:var(--fs-xs);padding:1px 6px">— 0</span>`;
      const contactCell = isOverdue
        ? `<span style="font-weight:700;color:var(--red)">${c.days}d ago</span> <span class="csm-overdue">OVERDUE</span>`
        : (c.days != null ? c.days + 'd ago' : '—');
      return `<tr style="cursor:pointer" onclick="openDetail('${escHtml(c.id)}')">
        <td><strong>${escHtml(c.name)}</strong></td>
        <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:var(--fs-base);font-weight:700;color:${c.score >= 65 ? 'var(--green)' : c.score >= 50 ? 'var(--amber)' : 'var(--red)'};background:${c.score >= 65 ? 'var(--green-l)' : c.score >= 50 ? 'var(--amber-l)' : 'var(--red-l)'}">${c.score}</span></td>
        <td>${trendHTML}</td>
        <td>${badgeHTML(c.status)}</td>
        <td>$${fmtNum(c.mrr || 0)}</td>
        <td>${contactCell}</td>
        <td>${renewStr}</td>
        <td style="font-size:var(--fs-base);color:var(--muted)">${c.lifecycle || '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;

  const viewBtn = `<div style="text-align:right;margin-top:12px"><button class="btn-sm" onclick="filterByTier('${tierKey}')" style="gap:4px">View in Customers <span style="font-size:var(--fs-base)">\u2192</span></button></div>`;

  return summaryHTML + tableHTML + viewBtn;
}

/* ── Stage (Lifecycle) Table ─────────────────────────────────── */
let stageSortKey = 'mrr';
let stageSortDir = 'desc';

function _buildStageData(active, deltaCache) {
  const stageDefs = [
    { key: 'onboarding', label: 'Onboarding', pill: 'stage-pill-onb' },
    { key: 'active',     label: 'Active',     pill: 'stage-pill-act' },
    { key: 'atrisk',     label: 'At Risk',    pill: 'stage-pill-risk' },
    { key: 'won',        label: 'Won / Upsold', pill: 'stage-pill-won' },
    { key: 'churned',    label: 'Churned',    pill: 'stage-pill-churn' }
  ];
  return stageDefs.map(sd => {
    const custs = active.filter(c => (c.lifecycle || 'active') === sd.key);
    const count = custs.length;
    const totalMRR = custs.reduce((s, c) => s + (c.mrr || 0), 0);
    const avgScore = count ? Math.round(custs.reduce((s, c) => s + c.score, 0) / count) : 0;
    const avgDelta = count ? Math.round(custs.reduce((s, c) => s + (deltaCache.get(c.id) || 0), 0) / count * 10) / 10 : 0;
    const healthy = custs.filter(c => c.status === 'healthy' || c.status === 'expand').length;
    const watch = custs.filter(c => c.status === 'watch').length;
    const atRisk = custs.filter(c => c.status === 'critical' || c.status === 'risk').length;
    const riskPct = count ? Math.round((atRisk / count) * 100) : 0;
    const overdueCount = custs.filter(c => c.days != null && c.days >= 14).length;
    const renewals90 = custs.filter(c => c.renewal != null && c.renewal > 0 && c.renewal <= 3).length;
    const withDays = custs.filter(c => c.days != null);
    const avgDays = withDays.length ? Math.round(withDays.reduce((s, c) => s + c.days, 0) / withDays.length) : null;
    return { key: sd.key, label: sd.label, pill: sd.pill, custs, count, totalMRR, avgScore, avgDelta, healthy, watch, atRisk, riskPct, overdueCount, renewals90, avgDays };
  }).filter(s => s.count > 0);
}

function renderStageTable(active, deltaCache) {
  const wrap = el('seg-table-wrap');
  if (!wrap) return;

  const stages = _buildStageData(active, deltaCache);
  window._stageData = stages;

  const sortIcon = key => {
    if (stageSortKey !== key) return '';
    return stageSortDir === 'asc' ? ' ▲' : ' ▼';
  };
  const activeClass = key => stageSortKey === key ? 'seg-sort-active' : '';

  const sorted = [...stages].sort((a, b) => {
    let va, vb;
    switch (stageSortKey) {
      case 'label':    va = a.label.toLowerCase(); vb = b.label.toLowerCase(); return stageSortDir === 'asc' ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1);
      case 'count':    va = a.count; vb = b.count; break;
      case 'avgScore': va = a.avgScore; vb = b.avgScore; break;
      case 'avgDelta': va = a.avgDelta; vb = b.avgDelta; break;
      case 'mrr':      va = a.totalMRR; vb = b.totalMRR; break;
      case 'riskPct':  va = a.riskPct; vb = b.riskPct; break;
      case 'avgDays':  va = a.avgDays || 0; vb = b.avgDays || 0; break;
      case 'renewals': va = a.renewals90; vb = b.renewals90; break;
      default:         va = a.totalMRR; vb = b.totalMRR;
    }
    return stageSortDir === 'asc' ? va - vb : vb - va;
  });

  const chevronDown = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  const scoreColor = v => v >= (thresholds.healthy || 80) ? 'var(--green)' : v >= (thresholds.watch || 65) ? 'var(--amber)' : v >= (thresholds.risk || 50) ? 'var(--orange,#ea580c)' : 'var(--red)';

  const stageColors = { onboarding:'#3b82f6', active:'#10b981', atrisk:'#ef4444', won:'#8b5cf6', churned:'#64748b' };

  const colCount = 9;
  window._stageColCount = colCount;

  wrap.innerHTML = `<div class="seg-table-wrap-scroll">
    <table class="ct" style="min-width:900px">
      <thead><tr>
        <th class="seg-sort-btn ${activeClass('label')}" onclick="sortStageTable('label')">Stage${sortIcon('label')}</th>
        <th class="seg-sort-btn ${activeClass('count')}" onclick="sortStageTable('count')">Accounts${sortIcon('count')}</th>
        <th class="seg-sort-btn ${activeClass('avgScore')}" onclick="sortStageTable('avgScore')">Avg Score${sortIcon('avgScore')}</th>
        <th class="seg-sort-btn ${activeClass('avgDelta')}" onclick="sortStageTable('avgDelta')">Trend (7d)${sortIcon('avgDelta')}</th>
        <th class="seg-sort-btn ${activeClass('mrr')}" onclick="sortStageTable('mrr')">MRR${sortIcon('mrr')}</th>
        <th class="seg-sort-btn ${activeClass('riskPct')}" onclick="sortStageTable('riskPct')">At-Risk %${sortIcon('riskPct')}</th>
        <th class="seg-sort-btn ${activeClass('avgDays')}" onclick="sortStageTable('avgDays')">Avg Contact${sortIcon('avgDays')}</th>
        <th class="seg-sort-btn ${activeClass('renewals')}" onclick="sortStageTable('renewals')">Renewals \u226490d${sortIcon('renewals')}</th>
        <th style="width:90px"></th>
      </tr></thead>
      <tbody id="seg-table-tbody">${sorted.map(t => {
        const trendCls = t.avgDelta > 0 ? 'up' : t.avgDelta < 0 ? 'dn' : 'flat';
        const trendIcon = t.avgDelta > 0 ? '▲' : t.avgDelta < 0 ? '▼' : '—';
        const trendTxt = t.avgDelta > 0 ? '+' + t.avgDelta : '' + t.avgDelta;
        const contactStr = t.avgDays != null ? t.avgDays + 'd' : '—';
        const sc = stageColors[t.key] || '#64748b';
        return `<tr class="seg-table-row" data-stage="${t.key}">
          <td><span class="stage-pill" style="background:${sc}15;color:${sc};border:1px solid ${sc}30;padding:2px 10px;border-radius:6px;font-size:var(--fs-base);font-weight:700">${t.label}</span></td>
          <td>${t.count}</td>
          <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:var(--fs-base);font-weight:700;color:${scoreColor(t.avgScore)};background:${t.avgScore >= 65 ? 'var(--green-l)' : t.avgScore >= 50 ? 'var(--amber-l)' : 'var(--red-l)'}">${t.avgScore}</span></td>
          <td><span class="csm-trend ${trendCls}" style="font-size:var(--fs-xs);padding:1px 6px">${trendIcon} ${trendTxt}</span></td>
          <td>$${fmtNum(t.totalMRR)}</td>
          <td><span style="font-weight:700;color:${t.riskPct > 30 ? 'var(--red)' : t.riskPct > 0 ? 'var(--amber)' : 'var(--green)'}">${t.riskPct}%</span> <span style="font-size:var(--fs-sm);color:var(--muted)">(${t.atRisk})</span></td>
          <td>${contactStr}</td>
          <td>${t.renewals90}</td>
          <td><button class="btn-sm csm-expand-btn" onclick="event.stopPropagation();drillStage('${t.key}')">${chevronDown} Expand</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

function sortStageTable(key) {
  if (stageSortKey === key) stageSortDir = stageSortDir === 'asc' ? 'desc' : 'asc';
  else { stageSortKey = key; stageSortDir = key === 'label' ? 'asc' : 'desc'; }
  const active = window._segActive;
  const dc = window._segDeltaCache;
  if (active) renderStageTable(active, dc);
}

function drillStage(stageKey) {
  const tbody = el('seg-table-tbody');
  if (!tbody) return;
  const colCount = window._stageColCount || 9;

  const parentRow = tbody.querySelector(`tr.seg-table-row[data-stage="${stageKey}"]`);
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

  parentRow.classList.add('seg-row-expanded');
  const btn = parentRow.querySelector('.csm-expand-btn');
  if (btn) btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg> Collapse`;

  const expandRow = document.createElement('tr');
  expandRow.className = 'seg-table-expand-row';
  expandRow.innerHTML = `<td colspan="${colCount}" class="seg-table-expand-cell">${buildStageDrillHTML(stageKey)}</td>`;
  parentRow.after(expandRow);
}

function buildStageDrillHTML(stageKey) {
  const stages = window._stageData || [];
  const deltaCache = window._segDeltaCache || new Map();
  const stage = stages.find(t => t.key === stageKey);
  if (!stage) return '<p>No data for this stage.</p>';

  const accs = stage.custs;
  const avgScore = stage.avgScore;
  const totalMRR = stage.totalMRR;
  const hmColor = v => v >= 65 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)';
  const dColor = stage.avgDelta > 0 ? 'var(--green)' : stage.avgDelta < 0 ? 'var(--red)' : 'var(--muted)';
  const dIcon = stage.avgDelta > 0 ? '▲' : stage.avgDelta < 0 ? '▼' : '—';

  let summaryHTML = `<div class="csm-drill-stats">
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${hmColor(avgScore)}">${avgScore}</div>
      <div class="csm-drill-stat__label">Avg Score</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${dColor}">${dIcon} ${Math.abs(stage.avgDelta)}</div>
      <div class="csm-drill-stat__label">7d Trend</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">${stage.count}</div>
      <div class="csm-drill-stat__label">Accounts</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">$${fmtNum(totalMRR)}</div>
      <div class="csm-drill-stat__label">Total MRR</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:var(--green)">${stage.healthy}</div>
      <div class="csm-drill-stat__label">Healthy</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${stage.atRisk ? 'var(--red)' : 'var(--muted)'}">${stage.atRisk}</div>
      <div class="csm-drill-stat__label">At Risk</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${stage.overdueCount ? 'var(--red)' : 'var(--muted)'}">${stage.overdueCount}</div>
      <div class="csm-drill-stat__label">Overdue</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">${stage.renewals90}</div>
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
      <th>Customer</th><th>Score</th><th>Trend</th><th>Status</th><th>MRR</th><th>Last Contact</th><th>Renewal</th><th>Tier</th>
    </tr></thead>
    <tbody>${sorted.map(c => {
      const renewStr = c.renewal_date ? new Date(c.renewal_date).toLocaleDateString() : (c.renewal ? c.renewal + 'mo' : '—');
      const isOverdue = c.days != null && c.days >= OVERDUE_DAYS;
      const delta = deltaCache.get(c.id) || 0;
      const trendHTML = delta > 0
        ? `<span class="csm-trend up" style="font-size:var(--fs-xs);padding:1px 6px">▲ +${delta}</span>`
        : delta < 0
          ? `<span class="csm-trend dn" style="font-size:var(--fs-xs);padding:1px 6px">▼ ${delta}</span>`
          : `<span class="csm-trend flat" style="font-size:var(--fs-xs);padding:1px 6px">— 0</span>`;
      const contactCell = isOverdue
        ? `<span style="font-weight:700;color:var(--red)">${c.days}d ago</span> <span class="csm-overdue">OVERDUE</span>`
        : (c.days != null ? c.days + 'd ago' : '—');
      const tierLabel = c.tier === 'enterprise' ? 'Enterprise' : c.tier === 'smb' ? 'SMB' : 'Mid-Market';
      return `<tr style="cursor:pointer" onclick="openDetail('${escHtml(c.id)}')">
        <td><strong>${escHtml(c.name)}</strong></td>
        <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:var(--fs-base);font-weight:700;color:${c.score >= 65 ? 'var(--green)' : c.score >= 50 ? 'var(--amber)' : 'var(--red)'};background:${c.score >= 65 ? 'var(--green-l)' : c.score >= 50 ? 'var(--amber-l)' : 'var(--red-l)'}">${c.score}</span></td>
        <td>${trendHTML}</td>
        <td>${badgeHTML(c.status)}</td>
        <td>$${fmtNum(c.mrr || 0)}</td>
        <td>${contactCell}</td>
        <td>${renewStr}</td>
        <td style="font-size:var(--fs-base);color:var(--muted)">${tierLabel}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;

  const viewBtn = `<div style="text-align:right;margin-top:12px"><button class="btn-sm" onclick="filterByStage('${stageKey}')" style="gap:4px">View in Customers <span style="font-size:var(--fs-base)">\u2192</span></button></div>`;

  return summaryHTML + tableHTML + viewBtn;
}

function filterByStage(stageKey) {
  columnFilters = {};
  insightFilter = null;
  mrrExposureFilter = null;
  filterMode = stageKey === 'churned' ? 'churned' : 'all';
  _filterTier = null;
  _filterStage = stageKey;
  nav('customers');
  renderCustomers();
}

function clearStageFilter() {
  _filterStage = null;
  renderCustomers();
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
        <span class="tag" style="font-size:var(--fs-base)">${escHtml(segDisplayLabel(seg.tag))}</span>
        <span class="seg-score-badge" style="color:${scoreColor(seg.avgScore)};background:${scoreBg(seg.avgScore)}">${seg.avgScore}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
        <span style="font-size:1.7rem;font-weight:800;line-height:1">${seg.count}</span>
        <span class="seg-card-trend ${trendCls}">${trendIcon} ${trendTxt}</span>
      </div>
      <div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:10px">account${seg.count !== 1 ? 's' : ''}</div>
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
          <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:var(--fs-base);font-weight:700;color:${scoreColor(seg.avgScore)};background:${seg.avgScore >= 65 ? 'var(--green-l)' : seg.avgScore >= 50 ? 'var(--amber-l)' : 'var(--red-l)'}">${seg.avgScore}</span></td>
          <td><span class="csm-trend ${trendCls}" style="font-size:var(--fs-xs);padding:1px 6px">${trendIcon} ${trendTxt}</span></td>
          <td>$${fmtNum(seg.totalMRR)}</td>
          <td><span style="font-weight:700;color:${seg.riskPct > 30 ? 'var(--red)' : seg.riskPct > 0 ? 'var(--amber)' : 'var(--green)'}">${seg.riskPct}%</span> <span style="font-size:var(--fs-sm);color:var(--muted)">(${seg.atRisk})</span></td>
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
        ? `<span class="csm-trend up" style="font-size:var(--fs-xs);padding:1px 6px">▲ +${delta}</span>`
        : delta < 0
          ? `<span class="csm-trend dn" style="font-size:var(--fs-xs);padding:1px 6px">▼ ${delta}</span>`
          : `<span class="csm-trend flat" style="font-size:var(--fs-xs);padding:1px 6px">— 0</span>`;
      const contactCell = isOverdue
        ? `<span style="font-weight:700;color:var(--red)">${c.days}d ago</span> <span class="csm-overdue">OVERDUE</span>`
        : (c.days != null ? c.days + 'd ago' : '—');
      return `<tr style="cursor:pointer" onclick="openDetail('${escHtml(c.id)}')">
        <td><strong>${escHtml(c.name)}</strong></td>
        <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:var(--fs-base);font-weight:700;color:${c.score >= 65 ? 'var(--green)' : c.score >= 50 ? 'var(--amber)' : 'var(--red)'};background:${c.score >= 65 ? 'var(--green-l)' : c.score >= 50 ? 'var(--amber-l)' : 'var(--red-l)'}">${c.score}</span></td>
        <td>${trendHTML}</td>
        <td>${badgeHTML(c.status)}</td>
        <td>$${fmtNum(c.mrr || 0)}</td>
        <td>${contactCell}</td>
        <td>${renewStr}</td>
        <td style="font-size:var(--fs-base);color:var(--muted)">${c.lifecycle || '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;

  const safeTag = tagName.replace(/'/g, "\\'");
  const viewBtn = `<div style="text-align:right;margin-top:12px"><button class="btn-sm" onclick="filterByTag('${safeTag}')" style="gap:4px">View in Customers <span style="font-size:var(--fs-base)">\u2192</span></button></div>`;

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

  // --- Segment-specific insights (things only the Segments page can surface) ---

  // Total MRR across all segments for concentration calc
  const totalSegMRR = segments.reduce((s, seg) => s + (seg.totalMRR || 0), 0);

  segments.forEach(seg => {
    // High risk % (priority 4) — segment composition, not individual alerts
    if (seg.riskPct > 40 && seg.count >= 3) {
      insights.push({ priority: 4, icon: iconAlert, bg: 'var(--red-l)', color: 'var(--red)',
        html: `<strong>${escHtml(segDisplayLabel(seg.tag))}</strong> has <strong>${seg.riskPct}%</strong> at risk (${seg.atRisk}/${seg.count})` });
    }
    // MRR Concentration — one segment holds outsized revenue share (priority 3)
    if (totalSegMRR > 0 && seg.totalMRR > 0) {
      const mrrPct = Math.round(seg.totalMRR / totalSegMRR * 100);
      if (mrrPct >= 40 && segments.length >= 3) {
        insights.push({ priority: 3, icon: iconAlert, bg: 'var(--amber-l)', color: 'var(--amber)',
          html: `<strong>${escHtml(segDisplayLabel(seg.tag))}</strong> holds <strong>${mrrPct}%</strong> of total MRR ($${fmtNum(seg.totalMRR)}) — high concentration risk` });
      }
    }
    // Score Spread — high variance within segment means inconsistent group (priority 2)
    if (seg.count >= 4) {
      const scores = seg.custs.map(c => c.score);
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      const spread = max - min;
      if (spread >= 40) {
        insights.push({ priority: 2, icon: iconTrendDn, bg: 'var(--amber-l)', color: 'var(--amber)',
          html: `<strong>${escHtml(segDisplayLabel(seg.tag))}</strong> has a wide score spread (${min}–${max}) — may need sub-segmenting` });
      }
    }
    // Declining segment (priority 3) — segment-level trajectory
    if (seg.avgDelta < -2) {
      insights.push({ priority: 3, icon: iconTrendDn, bg: 'var(--amber-l)', color: 'var(--amber)',
        html: `<strong>${escHtml(segDisplayLabel(seg.tag))}</strong> is declining (${seg.avgDelta} avg this week)` });
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

function filterByTier(tier) {
  // Clear all other filters so only the tier filter is active
  columnFilters = {};
  insightFilter = null;
  mrrExposureFilter = null;
  filterMode = 'all';
  _filterTier = tier;
  nav('customers');
  renderCustomers();
}

function clearTierFilter() {
  _filterTier = null;
  renderCustomers();
}

// Bulksheet export — all editable/importable fields (excludes auto-derived: score, status, created)
function exportBulksheet() {
  const filtered = customers.filter(c => passesManagerFilter(c));
  const hdr = 'name,manager,scoring_profile,mrr,arr,tier,lifecycle,logins_30d,feature_adoption_pct,open_tickets,nps,csat,days_since_contact,renewal_date,months_to_renewal,growth_signal,tags,since,next_touch,sentiment,note';
  const rows = filtered.map(c => {
    const latestNote = (c.notes||[]).length ? c.notes[c.notes.length-1].text : '';
    const latestSent = (c.sentiment||[]).length ? c.sentiment[c.sentiment.length-1].val : '';
    return [
      c.name, c.manager||'', c.scoring_profile||'Global Weights',
      c.mrr||0, c.arr||(c.mrr*12)||0, c.tier||'mid', c.lifecycle||'active',
      c.logins != null ? c.logins : '', c.adoption != null ? c.adoption : '',
      c.tickets != null ? c.tickets : '', c.nps != null ? c.nps : '',
      c.csat != null ? c.csat : '', c.days != null ? c.days : '',
      c.renewal_date||'', c.renewal||0, c.growth||'none',
      (c.tags||[]).join('|'), c.since||'', c.next_touch||'',
      latestSent, latestNote
    ].map(v => `"${String(v).replace(/"/g,'""')}"`)
    .join(',');
  });
  dlText(hdr + '\n' + rows.join('\n'), 'cs-health-bulksheet.csv', 'text/csv');
  toast(`Exported ${filtered.length} customer${filtered.length !== 1 ? 's' : ''} (bulksheet)`);
}

/* ═══════════════ SEGMENT COMPARISON CHART ═══════════════ */

function segChartMetricChanged(key) {
  _segChartMetric = key || 'score';
  _renderSegChartOnly();
}

function setSegChartRange(range) {
  _segChartRange = range;
  document.querySelectorAll('#seg-chart-range-row .dtab').forEach(b =>
    b.classList.toggle('active', b.dataset.range === range));
  _renderSegChartOnly();
}

function toggleSegChartPill(tag) {
  const idx = _segChartSelected.indexOf(tag);
  if (idx >= 0) {
    _segChartSelected.splice(idx, 1);
  } else {
    _segChartSelected.push(tag);
  }
  _renderSegChartOnly();
}

function segChartSelectAll() {
  _segChartSelected = [];
  _renderSegChartOnly();
}

function _renderSegChartOnly() {
  const data = _segView === 'tiers' ? window._tierData : _segView === 'stage' ? window._stageData : window._segData;
  if (!data || !data.length) return;
  _buildSegChartPills(data);
  _buildSegChartSVG(data);
  _buildSegChartAnalysis(data);
}

function renderSegChart(segments, active, deltaCache) {
  const card = el('seg-chart-card');
  if (!card) return;

  // Populate metric dropdown
  const sel = el('seg-chart-metric');
  if (sel && !sel.dataset.init) {
    sel.dataset.init = '1';
    sel.innerHTML = Object.keys(METRIC_CFG).map(k =>
      `<option value="${k}"${k === _segChartMetric ? ' selected' : ''}>${METRIC_CFG[k].label}</option>`
    ).join('');
  }

  const data = _segView === 'tiers' ? window._tierData : _segView === 'stage' ? window._stageData : segments;
  if (!data || !data.length) {
    const wrap = el('seg-chart-wrap');
    if (wrap) wrap.innerHTML = '<p style="color:var(--subtle);text-align:center;padding:40px 0;font-size:var(--fs-md)">Not enough data to display a comparison chart.</p>';
    return;
  }

  _buildSegChartPills(data);
  _buildSegChartSVG(data);
  _buildSegChartAnalysis(data);
}

function _segLabel(item) {
  return item.label || segDisplayLabel(item.tag) || item.key || '?';
}

function _buildSegChartPills(data) {
  const wrap = el('seg-chart-pills');
  if (!wrap) return;
  const isAll = _segChartSelected.length === 0;
  let html = `<button class="seg-pill${isAll ? ' active' : ''}" onclick="segChartSelectAll()">All</button>`;
  data.forEach((seg, i) => {
    const label = _segLabel(seg);
    const tag = seg.tag || seg.key || label;
    const color = SEG_CHART_COLORS[i % SEG_CHART_COLORS.length];
    const active = _segChartSelected.includes(tag);
    html += `<button class="seg-pill${active ? ' active' : ''}" style="${active ? 'background:' + color + ';border-color:' + color : ''}" onclick="toggleSegChartPill('${escHtml(tag)}')">`
      + `<span class="seg-pill-color" style="background:${color}"></span>${escHtml(label)}</button>`;
  });
  wrap.innerHTML = html;
}

function _buildSegChartSVG(data) {
  const wrap = el('seg-chart-wrap');
  if (!wrap) return;

  const metric = _segChartMetric || 'score';
  const cfg = METRIC_CFG[metric] || METRIC_CFG.score;
  const rangeDays = _segRangeToDays(_segChartRange);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - rangeDays);
  cutoff.setHours(0, 0, 0, 0);

  // Determine which segments to chart
  let chartSegs;
  if (_segChartSelected.length > 0) {
    chartSegs = data.filter(s => _segChartSelected.includes(s.tag || s.key || _segLabel(s)));
  } else {
    chartSegs = data;
  }

  // Build lines
  const lines = [];
  chartSegs.forEach((seg, i) => {
    const pts = aggregateSegmentByDay(seg.custs, metric, cutoff);
    if (pts.length >= 2) {
      lines.push({
        label: _segLabel(seg),
        color: SEG_CHART_COLORS[data.indexOf(seg) % SEG_CHART_COLORS.length],
        width: 2,
        points: pts,
        tag: seg.tag || seg.key
      });
    }
  });

  if (!lines.length) {
    wrap.innerHTML = '<p style="color:var(--subtle);text-align:center;padding:40px 0;font-size:var(--fs-md)">Not enough history data for the selected segments.</p>';
    return;
  }

  const W = 960, H = 260;
  const pad = { top: 14, right: 56, bottom: 36, left: 44 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  // Collect all dates
  const allDates = new Set();
  lines.forEach(l => l.points.forEach(p => allDates.add(p.date)));
  const dates = [...allDates].sort();

  const xScale = (i) => pad.left + (dates.length === 1 ? cW / 2 : (i / (dates.length - 1)) * cW);

  // Y-axis scale (reuse global _trendNiceScale)
  const yL = _trendNiceScale(lines, cfg.fixed || null);
  const yScaleL = (v) => pad.top + cH - ((v - yL.min) / (yL.max - yL.min || 1)) * cH;

  // Status bands if health score
  let bandSVG = '';
  if (metric === 'score') {
    const thresholds = window._clientThresholds || DEFAULT_THRESHOLDS;
    const bandDefs = [
      { y0: 0, y1: thresholds.critical, color: '#dc2626' },
      { y0: thresholds.critical, y1: thresholds.risk, color: '#ea580c' },
      { y0: thresholds.risk, y1: thresholds.watch, color: '#d97706' },
      { y0: thresholds.watch, y1: thresholds.healthy, color: '#16a34a' },
      { y0: thresholds.healthy, y1: 100, color: '#3b82f6' },
    ];
    bandSVG = bandDefs.map(b => {
      const y = yScaleL(b.y1);
      const h = yScaleL(b.y0) - y;
      return `<rect x="${pad.left}" y="${y}" width="${cW}" height="${h}" fill="${b.color}" opacity="0.055"/>`;
    }).join('');
  }

  // Grid lines + Y-axis labels
  let gridSVG = '';
  if (metric === 'score' && cfg.fixed) {
    for (let v = yL.min; v <= yL.max; v += 10) {
      const y = yScaleL(v);
      const isMajor = v % 25 === 0;
      gridSVG += `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="var(--border)" stroke-width="${isMajor ? 1 : 0.5}" opacity="${isMajor ? 0.7 : 0.35}" stroke-dasharray="${v === yL.min || v === yL.max ? '0' : '3,3'}"/>`;
      if (v % 20 === 0) {
        gridSVG += `<text x="${pad.left - 8}" y="${y + 3}" text-anchor="end" font-size="8" font-weight="${isMajor ? '600' : '400'}" fill="var(--subtle)">${cfg.axFmt(v)}</text>`;
      }
    }
  } else {
    const step = yL.step;
    for (let v = yL.min; v <= yL.max + step * 0.01; v += step) {
      const y = yScaleL(v);
      const isEdge = Math.abs(v - yL.min) < 0.01 || Math.abs(v - yL.max) < 0.01;
      gridSVG += `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="var(--border)" stroke-width="${isEdge ? 1 : 0.5}" opacity="${isEdge ? 0.7 : 0.35}" stroke-dasharray="${isEdge ? '0' : '3,3'}"/>`;
      gridSVG += `<text x="${pad.left - 8}" y="${y + 3}" text-anchor="end" font-size="8" font-weight="${isEdge ? '600' : '400'}" fill="var(--subtle)">${cfg.axFmt(v)}</text>`;
    }
  }

  // X-axis date labels
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let xLabels = '';
  const labelEvery = rangeDays <= 30 ? 2 : rangeDays <= 60 ? 4 : 7;
  dates.forEach((d, i) => {
    const x = xScale(i);
    const parts = d.split('-');
    const mo = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    if (rangeDays <= 30 || (rangeDays <= 60 && i % 2 === 0) || i % 3 === 0) {
      xLabels += `<line x1="${x}" y1="${yScaleL(yL.min)}" x2="${x}" y2="${yScaleL(yL.min) + 4}" stroke="var(--border)" stroke-width="0.5" opacity="0.5"/>`;
    }
    if (i % labelEvery === 0 || i === dates.length - 1) {
      xLabels += `<text x="${x}" y="${H - pad.bottom + 16}" text-anchor="middle" font-size="7.5" fill="var(--subtle)">${monthNames[mo]} ${day}</text>`;
    }
  });

  // Draw lines
  let linesSVG = '';
  const dateIdx = {};
  dates.forEach((d, i) => { dateIdx[d] = i; });

  lines.forEach((line, lineIdx) => {
    const pts = line.points.filter(p => dateIdx[p.date] !== undefined && !isNaN(p.avg))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (pts.length < 2) return;

    // Area fill (only for first line or single line)
    if (lines.length === 1 || lineIdx === 0) {
      const areaBottom = yScaleL(yL.min);
      const areaPts = pts.map(p => `${xScale(dateIdx[p.date])},${yScaleL(p.avg)}`);
      const firstX = xScale(dateIdx[pts[0].date]);
      const lastX = xScale(dateIdx[pts[pts.length - 1].date]);
      const areaPath = `M${firstX},${areaBottom} L${areaPts.join(' L')} L${lastX},${areaBottom} Z`;
      linesSVG += `<defs><linearGradient id="segAreaGrad${lineIdx}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${line.color}" stop-opacity="0.12"/>
        <stop offset="100%" stop-color="${line.color}" stop-opacity="0.01"/>
      </linearGradient></defs>`;
      linesSVG += `<path d="${areaPath}" fill="url(#segAreaGrad${lineIdx})"/>`;
    }

    // Polyline
    const polyPts = pts.map(p => `${xScale(dateIdx[p.date])},${yScaleL(p.avg)}`).join(' ');
    linesSVG += `<polyline points="${polyPts}" fill="none" stroke="${line.color}" stroke-width="${line.width}" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`;

    // Dots
    const dotR = 2.5;
    const labelSkip = pts.length <= 10 ? 1 : pts.length <= 20 ? 3 : pts.length <= 40 ? 5 : 8;
    pts.forEach((p, pi) => {
      const cx = xScale(dateIdx[p.date]);
      const cy = yScaleL(p.avg);
      linesSVG += `<circle cx="${cx}" cy="${cy}" r="${dotR + 1}" fill="var(--surface)" opacity="0.8"/>`;
      linesSVG += `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${line.color}"/>`;
      // Value labels on single-line view
      if (lines.length <= 2 && (pi % labelSkip === 0 || pi === pts.length - 1)) {
        linesSVG += `<text x="${cx}" y="${cy - dotR - 4}" text-anchor="middle" font-size="7" font-weight="700" fill="${line.color}">${cfg.fmt(p.avg)}</text>`;
      }
    });
  });

  // Build tooltip data
  _segChartTipData = dates.map((d) => {
    const parts = d.split('-');
    const mo = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    const dateLabel = monthNames[mo] + ' ' + day;
    const vals = lines.map(l => {
      const pt = l.points.find(x => x.date === d);
      return pt ? { label: l.label, color: l.color, val: cfg.fmt(pt.avg) } : null;
    }).filter(Boolean);
    return { dateLabel, vals };
  });

  // Hover columns
  let hoverSVG = '';
  const colW = dates.length > 1 ? cW / (dates.length - 1) : cW;
  dates.forEach((d, i) => {
    const cx = xScale(i);
    hoverSVG += `<rect x="${cx - colW / 2}" y="${pad.top}" width="${colW}" height="${cH}" fill="transparent" style="cursor:crosshair"
      onmouseenter="showSegChartTip(evt,${cx},${i})"
      onmouseleave="hideSegChartTip()"/>`;
  });

  // Axis borders
  let axisSVG = `<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${yScaleL(yL.min)}" stroke="var(--border)" stroke-width="1.5" opacity="0.5"/>`;
  axisSVG += `<line x1="${pad.left}" y1="${yScaleL(yL.min)}" x2="${W - pad.right}" y2="${yScaleL(yL.min)}" stroke="var(--border)" stroke-width="1.5" opacity="0.5"/>`;

  // Legend (HTML below chart)
  const legendHTML = `<div class="seg-chart-legend">${lines.map(l =>
    `<span class="seg-chart-legend-item"><span class="seg-chart-legend-dot" style="background:${l.color}"></span>${escHtml(l.label)}</span>`
  ).join('')}</div>`;

  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">
    ${bandSVG}${gridSVG}${axisSVG}${xLabels}${linesSVG}${hoverSVG}
  </svg>${legendHTML}`;
}

function showSegChartTip(evt, cx, colIdx) {
  let tip = document.getElementById('seg-chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'seg-chart-tip';
    tip.className = 'seg-chart-tooltip';
    el('seg-chart-wrap').appendChild(tip);
  }
  const data = _segChartTipData[colIdx];
  if (!data) return;

  let rows = '';
  data.vals.forEach(v => {
    rows += `<div style="display:flex;align-items:center;gap:6px;margin-top:3px"><span style="width:8px;height:8px;border-radius:50%;background:${v.color};flex-shrink:0"></span><span>${escHtml(v.label)}</span><strong style="margin-left:auto">${v.val}</strong></div>`;
  });

  tip.innerHTML = `<div style="font-weight:700;margin-bottom:4px;font-size:var(--fs-base)">${data.dateLabel}</div>${rows}`;
  const wrap = el('seg-chart-wrap');
  const svg = wrap.querySelector('svg');
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const wRect = wrap.getBoundingClientRect();
  const scaleX = rect.width / 960;
  const left = (cx * scaleX) + (rect.left - wRect.left);
  tip.style.display = 'block';
  // Flip to left side if too close to right edge
  if (left + 160 > wRect.width) {
    tip.style.left = (left - 170) + 'px';
  } else {
    tip.style.left = (left + 14) + 'px';
  }
  tip.style.top = '8px';
}

function hideSegChartTip() {
  const tip = document.getElementById('seg-chart-tip');
  if (tip) tip.style.display = 'none';
}

/* ── Segment Chart Analysis ─────────────────────────────── */
function _buildSegChartAnalysis(data) {
  const wrap = el('seg-chart-analysis');
  if (!wrap) return;

  const metric = _segChartMetric || 'score';
  const cfg = METRIC_CFG[metric] || METRIC_CFG.score;
  const rangeDays = _segRangeToDays(_segChartRange);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - rangeDays);
  cutoff.setHours(0, 0, 0, 0);

  // Get segments to analyze
  let chartSegs;
  if (_segChartSelected.length > 0) {
    chartSegs = data.filter(s => _segChartSelected.includes(s.tag || s.key || _segLabel(s)));
  } else {
    chartSegs = data;
  }

  // Build time series for each segment
  const series = [];
  chartSegs.forEach((seg, i) => {
    const pts = aggregateSegmentByDay(seg.custs, metric, cutoff);
    if (pts.length >= 2) {
      const label = _segLabel(seg);
      const color = SEG_CHART_COLORS[data.indexOf(seg) % SEG_CHART_COLORS.length];
      const startVal = pts[0].avg;
      const endVal = pts[pts.length - 1].avg;
      const delta = endVal - startVal;
      // Compute std dev
      const mean = pts.reduce((s, p) => s + p.avg, 0) / pts.length;
      const variance = pts.reduce((s, p) => s + Math.pow(p.avg - mean, 2), 0) / pts.length;
      const stdDev = Math.sqrt(variance);
      // Half-period split for momentum
      const mid = Math.floor(pts.length / 2);
      const firstHalfDelta = pts[mid].avg - pts[0].avg;
      const secondHalfDelta = pts[pts.length - 1].avg - pts[mid].avg;
      const tag = seg.tag || seg.key || label;
      series.push({ seg, label, tag, color, pts, startVal, endVal, delta, mean, stdDev, firstHalfDelta, secondHalfDelta });
    }
  });

  if (series.length < 1) { wrap.innerHTML = ''; return; }

  const _ai = (path) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const icons = {
    momentum: _ai('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
    corr:     _ai('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
    risk:     _ai('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    dollar:   _ai('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
    signal:   _ai('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
    drop:     _ai('<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>'),
  };

  const insights = [];
  const rangeLabel = _segChartRange;
  const metricLabel = cfg.label;
  const halfLabel = rangeDays <= 30 ? Math.round(rangeDays / 2) + 'd' : Math.round(rangeDays / 60) + 'mo';

  // ── 1. Momentum shift — segment was heading one way but recently reversed ──
  // This is NOT visible at a glance since the overall delta may look flat
  series.forEach(s => {
    const accel = s.secondHalfDelta - s.firstHalfDelta;
    const threshold = Math.max(2, Math.abs(s.delta) * 0.5);
    if (Math.abs(accel) < threshold) return;
    // Only interesting if the halves disagree or the acceleration is dramatic
    const reversed = (s.firstHalfDelta > 0.5 && s.secondHalfDelta < -0.5) || (s.firstHalfDelta < -0.5 && s.secondHalfDelta > 0.5);
    const accelerating = !reversed && Math.abs(s.secondHalfDelta) > Math.abs(s.firstHalfDelta) * 2;
    if (!reversed && !accelerating) return;
    const f = v => (v >= 0 ? '+' : '') + cfg.fmt(v);
    if (reversed) {
      const wasDir = s.firstHalfDelta > 0 ? 'climbing' : 'declining';
      const nowDir = s.secondHalfDelta > 0 ? 'recovering' : 'pulling back';
      insights.push({
        score: Math.abs(accel) + 3,
        icon: icons.momentum,
        color: s.secondHalfDelta > 0 ? 'var(--green)' : 'var(--red)',
        bg: s.secondHalfDelta > 0 ? 'var(--green-l)' : 'var(--red-l)',
        label: 'Momentum Shift',
        tags: [s.tag],
        text: `<strong>${escHtml(s.label)}</strong> was ${wasDir} (${f(s.firstHalfDelta)}) in the first half but is now ${nowDir} (${f(s.secondHalfDelta)}) — the overall ${rangeLabel} number masks this recent change in direction.`
      });
    } else {
      const dir = s.secondHalfDelta > 0 ? 'accelerating upward' : 'accelerating downward';
      insights.push({
        score: Math.abs(accel),
        icon: icons.momentum,
        color: s.secondHalfDelta > 0 ? 'var(--green)' : 'var(--amber)',
        bg: s.secondHalfDelta > 0 ? 'var(--green-l)' : 'var(--amber-l)',
        label: 'Accelerating',
        tags: [s.tag],
        text: `<strong>${escHtml(s.label)}</strong> is ${dir} — moved ${f(s.secondHalfDelta)} in the recent ${halfLabel} vs ${f(s.firstHalfDelta)} in the prior ${halfLabel}. The pace of change is picking up.`
      });
    }
  });

  // ── 2. Cross-signal: metric change vs health score (only when metric ≠ score) ──
  // Reveals whether this metric actually impacts health, which isn't visible on a single chart
  if (metric !== 'score' && series.length >= 2) {
    const scoreSeries = [];
    chartSegs.forEach(seg => {
      const pts = aggregateSegmentByDay(seg.custs, 'score', cutoff);
      if (pts.length >= 2) {
        scoreSeries.push({ label: _segLabel(seg), sDelta: pts[pts.length - 1].avg - pts[0].avg });
      }
    });
    if (scoreSeries.length >= 2) {
      const pairs = series.map(s => {
        const sc = scoreSeries.find(ss => ss.label === s.label);
        return sc ? { label: s.label, mDelta: s.delta, sDelta: sc.sDelta } : null;
      }).filter(Boolean);
      // Look for the outlier: metric went one way, score went the other — that's the non-obvious one
      const outliers = pairs.filter(p => (p.mDelta > 1 && p.sDelta < -1) || (p.mDelta < -1 && p.sDelta > 1));
      if (outliers.length > 0) {
        const ex = outliers.reduce((a, b) => Math.abs(b.mDelta) + Math.abs(b.sDelta) > Math.abs(a.mDelta) + Math.abs(a.sDelta) ? b : a);
        const mDir = ex.mDelta > 0 ? 'improved' : 'declined';
        const sDir = ex.sDelta > 0 ? 'improved' : 'dropped';
        const exSeries = series.find(ss => ss.label === ex.label);
        insights.push({
          score: Math.abs(ex.mDelta) + Math.abs(ex.sDelta),
          icon: icons.corr,
          color: 'var(--amber)',
          bg: 'var(--amber-l)',
          label: 'Disconnected Signal',
          tags: exSeries ? [exSeries.tag] : [],
          text: `<strong>${escHtml(ex.label)}</strong>'s ${metricLabel} ${mDir} (${ex.mDelta > 0 ? '+' : ''}${cfg.fmt(ex.mDelta)}) but their Health Score ${sDir} (${ex.sDelta > 0 ? '+' : ''}${Math.round(ex.sDelta)}) — something else is driving score changes in this segment.`
        });
      } else {
        // Check for strong positive correlation — metric and score moving together
        const sameDir = pairs.filter(p => (p.mDelta > 1 && p.sDelta > 1) || (p.mDelta < -1 && p.sDelta < -1));
        if (sameDir.length >= 2 && sameDir.length === pairs.length) {
          const ex = sameDir.reduce((a, b) => Math.abs(b.mDelta) > Math.abs(a.mDelta) ? b : a);
          const exS = series.find(ss => ss.label === ex.label);
          insights.push({
            score: sameDir.length * 1.5,
            icon: icons.signal,
            color: 'var(--blue)',
            bg: 'var(--blue-l,#dbeafe)',
            label: 'Strong Signal',
            tags: exS ? [exS.tag] : [],
            text: `${metricLabel} changes are tracking Health Score changes across all segments — this metric appears to be a reliable leading indicator. <strong>${escHtml(ex.label)}</strong> shows the clearest link.`
          });
        }
      }
    }
  }

  // ── 3. MRR concentration risk — which segments hold the $ ──
  // Not visible on the metric chart at all, adds financial context
  if (series.length >= 2) {
    const totalMRR = chartSegs.reduce((s, seg) => s + (seg.totalMRR || seg.custs.reduce((t, c) => t + (c.mrr || 0), 0)), 0);
    if (totalMRR > 0) {
      const segMRR = chartSegs.map(seg => {
        const mrr = seg.totalMRR || seg.custs.reduce((t, c) => t + (c.mrr || 0), 0);
        const pct = Math.round(mrr / totalMRR * 100);
        const s = series.find(x => x.label === _segLabel(seg));
        return { label: _segLabel(seg), mrr, pct, delta: s ? s.delta : 0, tag: s ? s.tag : (seg.tag || seg.key || _segLabel(seg)) };
      }).sort((a, b) => b.mrr - a.mrr);

      // Flag: biggest MRR segment is declining
      const biggest = segMRR[0];
      if (biggest.pct >= 30 && biggest.delta < -1) {
        insights.push({
          score: biggest.pct * Math.abs(biggest.delta) * 0.1,
          icon: icons.dollar,
          color: 'var(--red)',
          bg: 'var(--red-l)',
          label: 'Revenue Exposure',
          tags: [biggest.tag],
          text: `<strong>${escHtml(biggest.label)}</strong> holds ${biggest.pct}% of segment MRR ($${fmtNum(biggest.mrr)}) and its ${metricLabel} is declining — this concentrates risk in your highest-value segment.`
        });
      }
      // Flag: small MRR segment outperforming — possible expansion opportunity
      const smallest = segMRR.filter(s => s.pct < 20 && s.delta > 2);
      if (smallest.length > 0) {
        const opp = smallest.reduce((a, b) => b.delta > a.delta ? b : a);
        insights.push({
          score: opp.delta * 1.5,
          icon: icons.dollar,
          color: 'var(--green)',
          bg: 'var(--green-l)',
          label: 'Growth Opportunity',
          tags: [opp.tag],
          text: `<strong>${escHtml(opp.label)}</strong> is only ${opp.pct}% of MRR but has the strongest ${metricLabel} trajectory — healthy signals in a small segment could mean expansion potential.`
        });
      }
    }
  }

  // ── 4. Lagging risk — segment with declining customers that others don't have ──
  // Looks at per-customer variance within segments, not segment-level averages
  if (series.length >= 2 && metric === 'score') {
    chartSegs.forEach(seg => {
      const s = series.find(x => x.label === _segLabel(seg));
      if (!s) return;
      // Count how many customers in this segment are critical or risk vs others
      const riskCount = seg.custs.filter(c => c.status === 'critical' || c.status === 'risk').length;
      const riskPct = seg.custs.length ? Math.round(riskCount / seg.custs.length * 100) : 0;
      // Is the segment average OK but risk concentration is high?
      if (s.endVal >= 60 && riskPct >= 30) {
        insights.push({
          score: riskPct * 0.3,
          icon: icons.risk,
          color: 'var(--amber)',
          bg: 'var(--amber-l)',
          label: 'Hidden Risk',
          tags: [s.tag],
          text: `<strong>${escHtml(s.label)}</strong> averages ${cfg.fmt(s.endVal)} overall but ${riskPct}% of its accounts (${riskCount}/${seg.custs.length}) are at risk — the average hides a bimodal distribution of healthy and struggling accounts.`
        });
      }
    });
  }

  // ── 5. Contact gap correlation — segments with high days-since-contact and declining metric ──
  if (series.length >= 2) {
    chartSegs.forEach(seg => {
      const s = series.find(x => x.label === _segLabel(seg));
      if (!s || s.delta >= 0) return; // only flag declining segments
      const withDays = seg.custs.filter(c => c.days != null);
      if (withDays.length < 2) return;
      const avgDays = Math.round(withDays.reduce((t, c) => t + c.days, 0) / withDays.length);
      // Other segments' avg days
      const otherSegs = chartSegs.filter(x => _segLabel(x) !== _segLabel(seg));
      const otherDays = [];
      otherSegs.forEach(os => {
        const wd = os.custs.filter(c => c.days != null);
        if (wd.length) otherDays.push(Math.round(wd.reduce((t, c) => t + c.days, 0) / wd.length));
      });
      if (!otherDays.length) return;
      const otherAvg = Math.round(otherDays.reduce((t, d) => t + d, 0) / otherDays.length);
      if (avgDays > otherAvg * 1.5 && avgDays >= 10) {
        insights.push({
          score: (avgDays - otherAvg) * 0.5 + Math.abs(s.delta),
          icon: icons.risk,
          color: 'var(--amber)',
          bg: 'var(--amber-l)',
          label: 'Engagement Gap',
          tags: [s.tag],
          text: `<strong>${escHtml(s.label)}</strong> is declining and averages ${avgDays} days since last contact vs ${otherAvg} days for other segments — the lack of recent outreach may be contributing to the decline.`
        });
      }
    });
  }

  // ── 6. Drop attribution — find the worst anomalous drop and decompose what caused it ──
  {
    let worstSeg = null, worstDrop = 0, worstPeakPt = null, worstTroughPt = null, worstPeakIdx = 0, worstTroughIdx = 0;
    series.forEach(s => {
      if (s.pts.length < 5) return;
      let peakVal = s.pts[0].avg, peakIdx = 0;
      let bestDrop = 0, bestPI = 0, bestTI = 0;
      for (let i = 1; i < s.pts.length; i++) {
        if (s.pts[i].avg > peakVal) { peakVal = s.pts[i].avg; peakIdx = i; }
        const dd = peakVal - s.pts[i].avg;
        if (dd > bestDrop) { bestDrop = dd; bestPI = peakIdx; bestTI = i; }
      }
      const isScore = metric === 'score';
      if (isScore && bestDrop < 5) return;
      if (!isScore && (bestDrop / (s.pts[bestPI].avg || 1)) * 100 < 10) return;
      // Recovery check: if metric recovered >50% after the trough, skip
      const finalVal = s.pts[s.pts.length - 1].avg;
      const recov = finalVal - s.pts[bestTI].avg;
      if (bestDrop > 0 && recov / bestDrop > 0.5) return;
      const dts = [];
      for (let i = 1; i < s.pts.length; i++) dts.push(s.pts[i].avg - s.pts[i - 1].avg);
      const md = dts.reduce((a, b) => a + b, 0) / (dts.length || 1);
      const sd = Math.sqrt(dts.reduce((a, b) => a + Math.pow(b - md, 2), 0) / (dts.length || 1));
      if (sd > 0 && bestDrop < sd * 1.5) return;
      if (bestDrop > worstDrop) {
        worstDrop = bestDrop; worstSeg = s;
        worstPeakPt = s.pts[bestPI]; worstTroughPt = s.pts[bestTI];
        worstPeakIdx = bestPI; worstTroughIdx = bestTI;
      }
    });

    if (worstSeg && worstPeakPt && worstTroughPt) {
      const fmtD = d => { const dt = new Date(d); return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
      const pv = Math.round(worstPeakPt.avg), tv = Math.round(worstTroughPt.avg);
      const dropAbs = Math.round(worstDrop);
      const segCusts = worstSeg.seg.custs;

      // ── Per-customer concentration analysis ──
      const peakT = new Date(worstPeakPt.date).getTime();
      const troughT = new Date(worstTroughPt.date).getTime();
      const custDeltas = [];
      segCusts.forEach(c => {
        const hist = (c.history || []).filter(h => h.date).sort((a, b) => a.date.localeCompare(b.date));
        if (!hist.length) return;
        const findClosest = (tgt) => hist.reduce((best, h) =>
          Math.abs(new Date(h.date).getTime() - tgt) < Math.abs(new Date(best.date).getTime() - tgt) ? h : best
        );
        const pe = findClosest(peakT), te = findClosest(troughT);
        const sv = cfg.val(pe, c), ev = cfg.val(te, c);
        if (sv != null && ev != null) custDeltas.push({ name: c.name, delta: ev - sv });
      });
      let concentrationNote = '';
      if (custDeltas.length >= 2) {
        const declined = custDeltas.filter(d => d.delta < -0.5);
        const improved = custDeltas.filter(d => d.delta > 0.5);
        const pctDeclined = Math.round((declined.length / custDeltas.length) * 100);
        const fv2 = v => { const c2 = METRIC_CFG[metric]; return c2?.fmt ? c2.fmt(Math.abs(v)) : Math.round(Math.abs(v) * 10) / 10; };
        if (declined.length <= 2 && declined.length > 0 && custDeltas.length > 3) {
          declined.sort((a, b) => a.delta - b.delta);
          if (declined.length === 1) {
            concentrationNote = ` This was driven primarily by <strong>${escHtml(declined[0].name)}</strong> (down ${fv2(declined[0].delta)}) — the remaining ${custDeltas.length - 1} accounts were relatively flat.`;
          } else {
            concentrationNote = ` Driven primarily by <strong>${escHtml(declined[0].name)}</strong> (down ${fv2(declined[0].delta)}) and <strong>${escHtml(declined[1].name)}</strong> (down ${fv2(declined[1].delta)}) — most of the other ${custDeltas.length - 2} accounts were relatively flat.`;
          }
        } else if (pctDeclined >= 60) {
          if (custDeltas.length <= 5) {
            concentrationNote = ` <strong>${declined.length} of ${custDeltas.length}</strong> accounts in this segment declined during this period.`;
          } else {
            concentrationNote = ` This was a broad-based decline — <strong>${declined.length} of ${custDeltas.length}</strong> accounts (${pctDeclined}%) dropped during this period.`;
          }
        } else if (pctDeclined >= 30) {
          concentrationNote = ` <strong>${declined.length} of ${custDeltas.length}</strong> accounts (${pctDeclined}%) declined while ${improved.length} improved — a split trend worth investigating.`;
        }
      }

      // ── Day-over-day spikes (±7% or more) ──
      const dropSlice = worstSeg.pts.slice(worstPeakIdx, worstTroughIdx + 1);
      const dodSpikes = [];
      for (let i = 1; i < dropSlice.length; i++) {
        const prev = dropSlice[i - 1].avg, curr = dropSlice[i].avg;
        if (prev === 0) continue;
        const changePct = ((curr - prev) / Math.abs(prev)) * 100;
        if (Math.abs(changePct) >= 7) dodSpikes.push({ date: dropSlice[i].date, changePct, prev, curr });
      }
      let spikeNote = '';
      if (dodSpikes.length > 0) {
        dodSpikes.sort((a, b) => a.changePct - b.changePct);
        const worst = dodSpikes[0];
        const fvS = v => { const c2 = METRIC_CFG[metric]; return c2?.fmt ? c2.fmt(v) : Math.round(v * 10) / 10; };
        spikeNote = ` Sharpest single-day drop was <strong>${Math.abs(Math.round(worst.changePct))}%</strong> on ${fmtD(worst.date)} (${fvS(worst.prev)} → ${fvS(worst.curr)}).`;
        if (dodSpikes.length > 1) spikeNote += ` There were <strong>${dodSpikes.length} days</strong> during this window with day-over-day changes exceeding 7%.`;
      }

      if (metric === 'score') {
        const attribs = (typeof _attributeScoreDrop === 'function')
          ? _attributeScoreDrop(segCusts, worstPeakPt.date, worstTroughPt.date) : [];
        const negatives = attribs.filter(a => a.contribution < -0.3);
        if (negatives.length > 0) {
          const topN = negatives.slice(0, 3);
          const drivers = topN.map(a => {
            const fRaw = v => {
              if (a.unit === '%') return Math.round(v) + '%';
              if (a.unit === 'd') return Math.round(v) + ' days';
              return Math.round(v * 10) / 10;
            };
            const impact = Math.abs(Math.round(a.contribution * 10) / 10);
            if (a.signal === 'growth') {
              const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : 'None';
              if (a.rawStart === a.rawEnd) return null;
              return `<strong>${a.label}</strong> shifted from ${cap(a.rawStart)} to ${cap(a.rawEnd)}, costing ~${impact} pts`;
            }
            if (a.signal === 'tickets') return `<strong>${a.label}</strong> increased from ${fRaw(a.rawStart)} to ${fRaw(a.rawEnd)}, costing ~${impact} pts on the score`;
            if (a.signal === 'days') return `<strong>${a.label}</strong> increased from ${fRaw(a.rawStart)} to ${fRaw(a.rawEnd)}, costing ~${impact} pts`;
            if (a.rawEnd < a.rawStart) return `<strong>${a.label}</strong> dropped from ${fRaw(a.rawStart)} to ${fRaw(a.rawEnd)}, costing ~${impact} pts`;
            return `<strong>${a.label}</strong> moved from ${fRaw(a.rawStart)} to ${fRaw(a.rawEnd)}, costing ~${impact} pts`;
          }).filter(Boolean);
          if (drivers.length) {
            const othersStable = series.filter(s => s !== worstSeg && Math.abs(s.delta) < dropAbs * 0.3);
            const otherNote = othersStable.length > 0 ? ` Other segments held relatively steady.` : '';
            insights.push({
              score: dropAbs + 5, icon: icons.drop, color: 'var(--red)', bg: 'var(--red-l)',
              label: 'Decline Drivers', tags: [worstSeg.tag],
              text: `<strong>${escHtml(worstSeg.label)}</strong> dropped <strong>${dropAbs} points</strong> (${pv} → ${tv}) between ${fmtD(worstPeakPt.date)} and ${fmtD(worstTroughPt.date)}. ${drivers.length === 1 ? 'The primary driver was ' + drivers[0] : 'The biggest factors: ' + drivers.join('; ')}.${concentrationNote}${spikeNote}${otherNote}`
            });
          }
        }
      } else {
        const label = cfg.label;
        const fv = v => cfg.fmt ? cfg.fmt(v) : Math.round(v * 10) / 10;
        let text = `<strong>${escHtml(worstSeg.label)}</strong>'s ${label} fell <strong>${fv(worstDrop)}</strong> (${fv(worstPeakPt.avg)} → ${fv(worstTroughPt.avg)}) between ${fmtD(worstPeakPt.date)} and ${fmtD(worstTroughPt.date)}, which is larger than typical day-to-day variation for this metric.${concentrationNote}${spikeNote}`;
        const scorePts = aggregateSegmentByDay(segCusts, 'score', cutoff);
        if (scorePts.length >= 2) {
          const fn = (arr, d) => arr.reduce((best, p) => Math.abs(new Date(p.date).getTime() - new Date(d).getTime()) < Math.abs(new Date(best.date).getTime() - new Date(d).getTime()) ? p : best);
          const sp = fn(scorePts, worstPeakPt.date), st = fn(scorePts, worstTroughPt.date);
          const sd = Math.round(st.avg - sp.avg);
          if (sd < -2) text += ` During the same window, Health Score also dropped <strong>${Math.abs(sd)} points</strong>.`;
          else if (Math.abs(sd) <= 2) text += ` Health Score stayed stable during this window — other signals offset the impact.`;
        }
        insights.push({
          score: dropAbs + 3, icon: icons.drop, color: 'var(--red)', bg: 'var(--red-l)',
          label: 'Significant Decline', tags: [worstSeg.tag], text
        });
      }
    }
  }

  // Sort by score desc, show top 3
  insights.sort((a, b) => b.score - a.score);
  const top = insights.slice(0, 3);
  window._segChartInsights = top;

  if (!top.length) {
    wrap.innerHTML = '';
    return;
  }

  wrap.innerHTML = top.map((ins, idx) => {
    const clickable = ins.tags && ins.tags.length > 0;
    const accentCls = ins.color === 'var(--green)' ? ' ta-card-green' : ins.color === 'var(--red)' ? ' ta-card-red' : ins.color === 'var(--amber)' ? ' ta-card-amber' : '';
    return `<div class="ta-card${accentCls}${clickable ? ' ta-card-clickable' : ''}" style="border-left-color:${ins.color}" ${clickable ? `onclick="segAnalysisFocus(${idx})"` : ''}>
    <div class="ta-icon" style="background:${ins.bg};color:${ins.color}">${ins.icon}</div>
    <div>
      <div class="ta-label">${ins.label}</div>
      <div class="ta-detail">${ins.text}</div>
    </div>
  </div>`;
  }).join('');
}

function segAnalysisFocus(idx) {
  const insights = window._segChartInsights;
  if (!insights || !insights[idx]) return;
  const tags = insights[idx].tags || [];
  if (!tags.length) return;
  // If already showing exactly these tags, toggle back to all
  if (_segChartSelected.length === tags.length && tags.every(t => _segChartSelected.includes(t))) {
    _segChartSelected = [];
  } else {
    _segChartSelected = [...tags];
  }
  _renderSegChartOnly();
}


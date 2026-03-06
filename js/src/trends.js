// ── TRENDS PAGE ──────────────────────────────────────────────
let _trendRange = '30d';
let _trendCsmOverlay = '';
let _trendClientOverlays = []; // array of customer ids
let _trendMovers = [];          // current movers data
let _trendSortKey = 'absDelta'; // default sort by absolute change
let _trendSortDir = -1;         // -1 = descending
let _trendMetric1 = 'score';    // primary metric key
let _trendMetric2 = '';          // secondary metric key (empty = none)
let _trendTipData = [];          // tooltip data per date column

const METRIC_CFG = {
  score:    { label:'Health Score',        agg:'avg', fixed:[0,100], val: (h,c) => h.score,                            fmt: v => String(Math.round(v)),            axFmt: v => String(Math.round(v)) },
  logins:   { label:'Logins',             agg:'avg', fixed:null,     val: (h,c) => h.signals?.logins,                  fmt: v => String(Math.round(v*10)/10),     axFmt: v => String(Math.round(v*10)/10) },
  adoption: { label:'Adoption %',         agg:'avg', fixed:[0,100], val: (h,c) => h.signals?.adoption,                fmt: v => Math.round(v)+'%',               axFmt: v => Math.round(v)+'%' },
  tickets:  { label:'Open Tickets',       agg:'avg', fixed:null,     val: (h,c) => h.signals?.tickets,                 fmt: v => String(Math.round(v*10)/10),     axFmt: v => String(Math.round(v*10)/10) },
  nps:      { label:'NPS Score',            agg:'avg', fixed:[0,10],  val: (h,c) => h.signals?.nps,                     fmt: v => String(Math.round(v*10)/10),     axFmt: v => String(Math.round(v)) },
  csat:     { label:'CSAT Score',           agg:'avg', fixed:[1,5],   val: (h,c) => h.signals?.csat,                    fmt: v => String(Math.round(v*10)/10),     axFmt: v => String(Math.round(v)) },
  days:     { label:'Days Since Contact',  agg:'avg', fixed:null,    val: (h,c) => h.signals?.days,                    fmt: v => String(Math.round(v)),            axFmt: v => String(Math.round(v)) },
  mrr:      { label:'Total MRR',          agg:'sum', fixed:null,     val: (h,c) => c.mrr,                              fmt: v => '$'+fmtNum(Math.round(v)),       axFmt: v => { if(Math.abs(v)>=1e6) return '$'+(v/1e6).toFixed(1)+'M'; if(Math.abs(v)>=1e3) return '$'+Math.round(v/1e3)+'K'; return '$'+Math.round(v); } },
  arr:      { label:'Total ARR',          agg:'sum', fixed:null,     val: (h,c) => c.arr,                              fmt: v => '$'+fmtNum(Math.round(v)),       axFmt: v => { if(Math.abs(v)>=1e6) return '$'+(v/1e6).toFixed(1)+'M'; if(Math.abs(v)>=1e3) return '$'+Math.round(v/1e3)+'K'; return '$'+Math.round(v); } },
  customers:{ label:'# Customers',        agg:'count', fixed:null,   val: (h,c) => 1,                                  fmt: v => String(Math.round(v)),            axFmt: v => String(Math.round(v)) },
};

function setTrendMetric(slot, key) {
  if (slot === 1) _trendMetric1 = key || 'score';
  else _trendMetric2 = key || '';
  renderTrends();
}

function setTrendRange(range) {
  _trendRange = range;
  document.querySelectorAll('#trend-range-row .dtab').forEach(b =>
    b.classList.toggle('active', b.dataset.range === range));
  renderTrends();
}

function setTrendCsmOverlay(mgr) {
  _trendCsmOverlay = mgr || '';
  renderTrends();
}

function addTrendClient(id) {
  if (!_trendClientOverlays.includes(id)) _trendClientOverlays.push(id);
  const inp = el('trend-client-search');
  if (inp) inp.value = '';
  const ac = el('trend-client-ac');
  if (ac) ac.style.display = 'none';
  renderTrends();
}

function removeTrendClient(id) {
  _trendClientOverlays = _trendClientOverlays.filter(x => x !== id);
  renderTrends();
}

function trendClientAutocomplete() {
  const inp = el('trend-client-search');
  const ac = el('trend-client-ac');
  if (!inp || !ac) return;
  const q = (inp.value || '').trim().toLowerCase();
  if (!q) { ac.style.display = 'none'; return; }
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const matches = active.filter(c =>
    (c.name || '').toLowerCase().indexOf(q) !== -1 && !_trendClientOverlays.includes(c.id)
  ).slice(0, 8);
  if (!matches.length) { ac.style.display = 'none'; return; }
  ac.innerHTML = matches.map(c =>
    `<div onclick="addTrendClient('${escHtml(c.id)}')">${escHtml(c.name)} <span style="color:var(--subtle);font-size:.72rem">(${c.score})</span></div>`
  ).join('');
  ac.style.display = 'block';
}

// Close autocomplete on outside click
document.addEventListener('click', function(e) {
  const ac = el('trend-client-ac');
  if (ac && !e.target.closest('#trend-client-search') && !e.target.closest('#trend-client-ac')) {
    ac.style.display = 'none';
  }
});

function renderTrends() {
  const range = _trendRange || '30d';
  const m1 = _trendMetric1 || 'score';
  const m2 = _trendMetric2 || '';
  const m1Cfg = METRIC_CFG[m1] || METRIC_CFG.score;
  const m2Cfg = m2 ? (METRIC_CFG[m2] || null) : null;

  let days;
  const cutoff = new Date();
  if (range === 'ytd') {
    const jan1 = new Date(cutoff.getFullYear(), 0, 1);
    days = Math.ceil((cutoff - jan1) / 86400000);
    cutoff.setTime(jan1.getTime());
  } else {
    days = { '3d': 3, '7d': 7, '30d': 30, '90d': 90, '6m': 180, '1y': 365, '2y': 730 }[range] || 30;
    cutoff.setDate(cutoff.getDate() - days);
  }
  cutoff.setHours(0,0,0,0);

  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));

  // ── Aggregate portfolio data by day (supports any metric) ──
  // For avg metrics: forward-fills each customer's last known value so every
  // account contributes to every day, giving a true portfolio average.
  function aggregateByDay(custs, metricKey) {
    const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
    const isSumMetric = cfg.agg === 'sum';
    const isCountMetric = cfg.agg === 'count';
    const _todayStr = new Date().toISOString().slice(0,10);

    if (isSumMetric || isCountMetric) {
      // Sum/Count metrics: forward-fill each customer's value so all
      // customers that have been scored at least once contribute every day
      const allDates = new Set();
      const custEntries = []; // { valForDate: { 'YYYY-MM-DD': value }, sortedDates: [...] }
      custs.forEach(c => {
        const valForDate = {};
        (c.history || []).forEach(h => {
          if (!h.date) return;
          const val = cfg.val(h, c);
          if (val == null || typeof val !== 'number' || isNaN(val)) return;
          const key = new Date(h.date).toISOString().slice(0,10);
          valForDate[key] = val;
        });
        const sortedDates = Object.keys(valForDate).sort();
        if (sortedDates.length) {
          custEntries.push({ valForDate, sortedDates });
          sortedDates.forEach(d => { if (d >= cutoff.toISOString().slice(0,10) && d < _todayStr) allDates.add(d); });
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
      }).filter(p => p.avg > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    // Avg metrics: forward-fill so every customer is represented every day
    // 1. Collect all unique dates in range and per-customer date→value maps
    const allDates = new Set();
    const custData = []; // { dateMap: { 'YYYY-MM-DD': value }, sortedDates: [...] }
    custs.forEach(c => {
      const dateMap = {};
      (c.history || []).forEach(h => {
        if (!h.date) return;
        const val = cfg.val(h, c);
        if (val == null || typeof val !== 'number' || isNaN(val)) return;
        const key = new Date(h.date).toISOString().slice(0,10);
        dateMap[key] = val; // latest value wins if multiple entries on same day
      });
      const sortedDates = Object.keys(dateMap).sort();
      if (sortedDates.length) {
        custData.push({ dateMap, sortedDates });
        sortedDates.forEach(d => { if (d >= cutoff.toISOString().slice(0,10) && d < _todayStr) allDates.add(d); });
      }
    });

    // 2. For each date, forward-fill each customer's last known value
    const dates = [...allDates].sort();
    return dates.map(date => {
      let total = 0, count = 0;
      custData.forEach(cd => {
        // Find the most recent value at or before this date
        let val = null;
        for (let i = cd.sortedDates.length - 1; i >= 0; i--) {
          if (cd.sortedDates[i] <= date) { val = cd.dateMap[cd.sortedDates[i]]; break; }
        }
        if (val !== null) { total += val; count++; }
      });
      return { date, avg: count ? total / count : 0 };
    }).filter(p => p.avg > 0);
  }

  const portfolioData = aggregateByDay(active, m1);

  // ── KPIs (range-aware, based on health score) ──
  const currentAvg = active.length ? Math.round(active.reduce((s,c) => s + (c.score||0), 0) / active.length) : 0;

  // Range-aware delta: compare current score to score N days ago
  function _getDeltaNd(c, n) {
    const ago = new Date(); ago.setDate(ago.getDate() - n);
    const hist = (c.history || []).slice().sort((a,b) => new Date(b.date) - new Date(a.date));
    const recent = hist.filter(h => new Date(h.date) >= ago);
    if (!recent.length) return 0;
    const before = hist.filter(h => new Date(h.date) < ago);
    const prev = before.length ? before[0].score : hist[hist.length - 1].score;
    return recent[0].score - prev;
  }

  let improving = 0, declining = 0;
  active.forEach(c => {
    const d = _getDeltaNd(c, days);
    if (d > 0) improving++;
    else if (d < 0) declining++;
  });
  const avgDelta = active.length ? (active.reduce((s,c) => s + _getDeltaNd(c, days), 0) / active.length) : 0;
  const trendDir = avgDelta > 0.5 ? 'Improving' : avgDelta < -0.5 ? 'Declining' : 'Stable';
  const trendDirColor = avgDelta > 0.5 ? 'dash-kpi-green' : avgDelta < -0.5 ? 'dash-kpi-red' : 'dash-kpi-blue';
  const rangeLabel = range === 'ytd' ? 'YTD' : range;

  const _ti = (path) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const tIcons = {
    score: _ti('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    trend: _ti('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
    up:    _ti('<polyline points="18 15 12 9 6 15"/>'),
    down:  _ti('<polyline points="6 9 12 15 18 9"/>'),
  };

  const kpiRow = el('trend-kpi-row');
  if (kpiRow) kpiRow.innerHTML = `
    <div class="dash-kpi-card dash-kpi-blue">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${tIcons.score}</div>
        <span class="dash-kpi-label">Portfolio Avg Score</span>
      </div>
      <div class="dash-kpi-num">${currentAvg}</div>
      <div class="dash-kpi-sub">${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(1)} avg ${rangeLabel} change</div>
    </div>
    <div class="dash-kpi-card ${trendDirColor}">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${tIcons.trend}</div>
        <span class="dash-kpi-label">Trend Direction</span>
      </div>
      <div class="dash-kpi-num" style="font-size:1.5rem">${trendDir}</div>
      <div class="dash-kpi-sub">across ${active.length} active account${active.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="dash-kpi-card dash-kpi-teal">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${tIcons.up}</div>
        <span class="dash-kpi-label">Accounts Improving</span>
      </div>
      <div class="dash-kpi-num">${improving}</div>
      <div class="dash-kpi-sub">${active.length ? Math.round(improving/active.length*100) : 0}% of portfolio</div>
    </div>
    <div class="dash-kpi-card dash-kpi-red">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${tIcons.down}</div>
        <span class="dash-kpi-label">Accounts Declining</span>
      </div>
      <div class="dash-kpi-num">${declining}</div>
      <div class="dash-kpi-sub">${active.length ? Math.round(declining/active.length*100) : 0}% of portfolio</div>
    </div>
  `;

  // ── Build primary metric chart lines ──
  const OVERLAY_COLORS = ['#7c3aed','#ea580c','#0891b2','#db2777','#059669','#2563eb','#d97706','#dc2626','#16a34a','#64748b'];
  const lines = [];
  const m1AggLabel = m1Cfg.agg === 'sum' ? 'Total' : 'Avg';

  // Main portfolio line (primary metric)
  lines.push({ label: 'Portfolio ' + m1AggLabel, color: '#3b82f6', width: 2, points: portfolioData });

  // CSM overlay (primary metric)
  if (_trendCsmOverlay) {
    const csmCusts = active.filter(c => c.manager === _trendCsmOverlay);
    const csmData = aggregateByDay(csmCusts, m1);
    lines.push({ label: escHtml(_trendCsmOverlay), color: OVERLAY_COLORS[0], width: 1.5, points: csmData });
  }

  // Client overlays (primary metric)
  _trendClientOverlays.forEach((id, idx) => {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    const _olTodayStr = new Date().toISOString().slice(0,10);
    const hist = (c.history || []).filter(h => {
      if (!h.date) return false;
      const ds = new Date(h.date).toISOString().slice(0,10);
      if (ds >= _olTodayStr) return false;
      if (new Date(h.date) < cutoff) return false;
      const v = m1Cfg.val(h, c);
      return v != null && typeof v === 'number' && !isNaN(v);
    }).map(h => ({
      date: new Date(h.date).toISOString().slice(0,10),
      avg: m1Cfg.val(h, c)
    })).sort((a,b) => a.date.localeCompare(b.date));
    if (hist.length) {
      const ci = (idx + 1) % OVERLAY_COLORS.length;
      lines.push({ label: escHtml(c.name), color: OVERLAY_COLORS[ci], width: 1.5, points: hist });
    }
  });

  // ── Secondary metric line ──
  let m2Line = null;
  if (m2Cfg) {
    const m2Data = aggregateByDay(active, m2);
    const m2AggLabel = m2Cfg.agg === 'sum' ? 'Total' : 'Avg';
    if (m2Data.length) {
      m2Line = { label: m2Cfg.label + ' (' + m2AggLabel + ')', color: '#f59e0b', width: 2, points: m2Data };
    }
  }

  // Render chart
  const chartWrap = el('trend-chart-wrap');
  if (chartWrap) {
    chartWrap.innerHTML = buildTrendChart(lines, days, m1, m2Line, m2);
  }

  // Dynamic chart title
  const chartTitle = document.querySelector('#view-trends .chart-title');
  if (chartTitle) {
    let title = m1Cfg.label;
    if (m2Cfg) title += ' vs ' + m2Cfg.label;
    chartTitle.textContent = title + ' Trend';
  }

  // Render legend
  const legendWrap = el('trend-legend');
  if (legendWrap) {
    let legendHTML = lines.map(l =>
      `<div class="trend-legend-item"><div class="trend-legend-dot" style="background:${l.color}"></div>${l.label}</div>`
    ).join('');
    if (m2Line) {
      legendHTML += `<div class="trend-legend-item"><div class="trend-legend-dash" style="border-color:${m2Line.color}"></div>${m2Line.label}</div>`;
    }
    legendWrap.innerHTML = legendHTML;
  }

  // ── Client overlay tags ──
  const tagsWrap = el('trend-client-tags');
  if (tagsWrap) {
    tagsWrap.innerHTML = _trendClientOverlays.map(id => {
      const c = customers.find(x => x.id === id);
      return c ? `<span class="trend-client-tag">${escHtml(c.name)}<button onclick="removeTrendClient('${escHtml(id)}')">&times;</button></span>` : '';
    }).join('');
  }

  // ── CSM dropdown ──
  const csmSel = el('trend-csm-overlay');
  if (csmSel) {
    const mgrs = [...new Set(active.map(c => c.manager).filter(Boolean))].sort();
    const prev = csmSel.value;
    csmSel.innerHTML = '<option value="">No CSM Overlay</option>' +
      mgrs.map(m => `<option value="${escHtml(m)}"${m === prev ? ' selected' : ''}>${escHtml(m)}</option>`).join('');
  }

  // ── Sync metric dropdowns ──
  const sel1 = el('trend-metric-1');
  if (sel1) sel1.value = m1;
  const sel2 = el('trend-metric-2');
  if (sel2) sel2.value = m2;

  // ── Top Movers — build data, then render with current sort ──
  // ── Trend Analysis ──
  _buildTrendAnalysis(active, portfolioData, m2Line ? m2Line.points : null, cutoff, days, m1, m2);

  _trendMovers = active.map(c => {
    const allHist = (c.history || []).filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
    const inRange    = allHist.filter(h => new Date(h.date) >= cutoff);
    const beforeRange = allHist.filter(h => new Date(h.date) < cutoff);
    // Use latest entry before range as baseline (matches getDelta7d logic)
    const baseline = beforeRange.length ? beforeRange[beforeRange.length - 1].score
                   : inRange.length     ? inRange[0].score
                   : c.score;
    const endScore = inRange.length ? inRange[inRange.length - 1].score : c.score;
    const delta = endScore - baseline;
    return { name: c.name, score: c.score, delta, absDelta: Math.abs(delta), status: c.status, mrr: c.mrr || 0, manager: c.manager || '—', tickets: c.tickets != null ? c.tickets : 0, logins: c.logins, adoption: c.adoption, id: c.id };
  });
  renderTrendMovers();
}

function sortTrendMovers(key) {
  if (_trendSortKey === key) {
    _trendSortDir *= -1; // toggle direction
  } else {
    _trendSortKey = key;
    _trendSortDir = key === 'name' || key === 'status' || key === 'manager' ? 1 : -1; // text asc, numbers desc
  }
  renderTrendMovers();
}

function renderTrendMovers() {
  const wrap = el('trend-movers-wrap');
  if (!wrap) return;

  const statusColors = { critical:'#dc2626', risk:'#ea580c', watch:'#d97706', healthy:'#16a34a', expand:'#7c3aed' };
  const statusOrder = { critical:0, risk:1, watch:2, healthy:3, expand:4 };

  // Sort
  const sorted = [..._trendMovers].sort((a, b) => {
    let av, bv;
    switch (_trendSortKey) {
      case 'name':     av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
      case 'score':    av = a.score; bv = b.score; break;
      case 'delta':    av = a.delta; bv = b.delta; break;
      case 'absDelta': av = a.absDelta; bv = b.absDelta; break;
      case 'status':   av = statusOrder[a.status]||9; bv = statusOrder[b.status]||9; break;
      case 'mrr':      av = a.mrr; bv = b.mrr; break;
      case 'manager':  av = a.manager.toLowerCase(); bv = b.manager.toLowerCase(); break;
      case 'tickets':  av = a.tickets; bv = b.tickets; break;
      case 'logins':   av = a.logins != null ? a.logins : -1; bv = b.logins != null ? b.logins : -1; break;
      case 'adoption': av = a.adoption != null ? a.adoption : -1; bv = b.adoption != null ? b.adoption : -1; break;
      default:         av = a.absDelta; bv = b.absDelta;
    }
    if (av < bv) return -1 * _trendSortDir;
    if (av > bv) return  1 * _trendSortDir;
    return 0;
  });

  if (!sorted.length) {
    wrap.innerHTML = '<p style="color:var(--subtle);font-size:.84rem;padding:12px">No score history available for this period.</p>';
    return;
  }

  const arrow = (key) => _trendSortKey === key ? (_trendSortDir === 1 ? ' ▲' : ' ▼') : '';
  const thStyle = 'padding:8px 12px;font-weight:700;color:var(--fg);cursor:pointer;user-select:none;white-space:nowrap;position:sticky;top:0;background:var(--surface);z-index:1';

  wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.82rem">
    <thead><tr style="text-align:left;border-bottom:2px solid var(--border)">
      <th style="${thStyle}" onclick="sortTrendMovers('name')">Customer${arrow('name')}</th>
      <th style="${thStyle}" onclick="sortTrendMovers('score')">Score${arrow('score')}</th>
      <th style="${thStyle}" onclick="sortTrendMovers('delta')">Change${arrow('delta')}${_trendSortKey==='absDelta'?arrow('absDelta'):''}</th>
      <th style="${thStyle}" onclick="sortTrendMovers('status')">Status${arrow('status')}</th>
      <th style="${thStyle}" onclick="sortTrendMovers('mrr')">MRR${arrow('mrr')}</th>
      <th style="${thStyle}" onclick="sortTrendMovers('logins')">Logins${arrow('logins')}</th>
      <th style="${thStyle}" onclick="sortTrendMovers('adoption')">Adoption${arrow('adoption')}</th>
      <th style="${thStyle}" onclick="sortTrendMovers('tickets')">Tickets${arrow('tickets')}</th>
      <th style="${thStyle}" onclick="sortTrendMovers('manager')">CSM${arrow('manager')}</th>
    </tr></thead>
    <tbody>${sorted.map(m => {
      const dColor = m.delta > 0 ? '#16a34a' : m.delta < 0 ? '#dc2626' : 'var(--subtle)';
      const dSign = m.delta > 0 ? '+' : '';
      return `<tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="openDetail('${escHtml(m.id)}')">
        <td style="padding:8px 12px;color:var(--text);font-weight:600">${escHtml(m.name)}</td>
        <td style="padding:8px 12px;color:var(--text)">${m.score}</td>
        <td style="padding:8px 12px;color:${dColor};font-weight:700">${dSign}${m.delta}</td>
        <td style="padding:8px 12px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColors[m.status]||'#888'};margin-right:4px"></span>${m.status}</td>
        <td style="padding:8px 12px;color:var(--text)">$${fmtNum(m.mrr)}</td>
        <td style="padding:8px 12px;color:${m.logins != null && m.logins < 5 ? '#d97706' : 'var(--subtle)'};font-weight:${m.logins != null && m.logins < 5 ? '700' : '400'}">${m.logins != null ? m.logins + '/mo' : 'N/A'}</td>
        <td style="padding:8px 12px;color:${m.adoption != null && m.adoption < 30 ? '#d97706' : 'var(--subtle)'};font-weight:${m.adoption != null && m.adoption < 30 ? '700' : '400'}">${m.adoption != null ? m.adoption + '%' : 'N/A'}</td>
        <td style="padding:8px 12px;color:${m.tickets > 0 ? '#dc2626' : 'var(--subtle)'};font-weight:${m.tickets > 0 ? '700' : '400'}">${m.tickets}</td>
        <td style="padding:8px 12px;color:var(--subtle)">${escHtml(m.manager)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ── Compute nice Y-axis scale from data ──
function _trendNiceScale(linesArr, fixedRange) {
  if (fixedRange) {
    const range = fixedRange[1] - fixedRange[0];
    const step = range <= 5 ? 1 : range <= 12 ? 2 : 10;
    return { min: fixedRange[0], max: fixedRange[1], step };
  }
  let dMin = Infinity, dMax = -Infinity;
  linesArr.forEach(l => l.points.forEach(p => {
    if (p.avg < dMin) dMin = p.avg;
    if (p.avg > dMax) dMax = p.avg;
  }));
  if (dMin === Infinity) return { min: 0, max: 100, step: 20 };
  if (dMin === dMax) { dMin = dMin > 0 ? 0 : dMin - 1; dMax = dMax > 0 ? dMax + 1 : 1; }
  // Pad 8%
  const range = dMax - dMin;
  const padding = range * 0.08;
  dMin -= padding;
  dMax += padding;
  // Nice step
  const rawRange = dMax - dMin;
  const mag = Math.pow(10, Math.floor(Math.log10(rawRange)));
  let step = mag;
  const nSteps = rawRange / step;
  if (nSteps < 3) step = mag / 2;
  else if (nSteps > 7) step = mag * 2;
  dMin = Math.floor(dMin / step) * step;
  dMax = Math.ceil(dMax / step) * step;
  if (dMin === dMax) dMax += step;
  return { min: dMin, max: dMax, step };
}

function buildTrendChart(lines, rangeDays, m1Key, m2Line, m2Key) {
  if (!lines.length || !lines[0].points.length) {
    return '<p style="color:var(--subtle);text-align:center;padding:40px 0;font-size:.88rem">Not enough history to display a trend chart. Score a few customers to get started.</p>';
  }

  const m1Cfg = METRIC_CFG[m1Key] || METRIC_CFG.score;
  const m2Cfg = m2Key ? (METRIC_CFG[m2Key] || null) : null;
  const hasM2 = !!(m2Line && m2Line.points.length);

  const W = 960, H = 260;
  const pad = { top: 14, right: hasM2 ? 72 : 56, bottom: 36, left: 44 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  // Collect all dates across all lines + secondary
  const allDates = new Set();
  lines.forEach(l => l.points.forEach(p => allDates.add(p.date)));
  if (hasM2) m2Line.points.forEach(p => allDates.add(p.date));
  const dates = [...allDates].sort();
  if (!dates.length) {
    return '<p style="color:var(--subtle);text-align:center;padding:40px 0;font-size:.88rem">No data points in this range.</p>';
  }

  const xScale = (i) => pad.left + (dates.length === 1 ? cW/2 : (i / (dates.length - 1)) * cW);

  // ── Y-axis scales ──
  const yL = _trendNiceScale(lines, m1Cfg.fixed);
  const yR = hasM2 ? _trendNiceScale([m2Line], m2Cfg.fixed) : null;
  const yScaleL = (v) => pad.top + cH - ((v - yL.min) / (yL.max - yL.min || 1)) * cH;
  const yScaleR = yR ? (v) => pad.top + cH - ((v - yR.min) / (yR.max - yR.min || 1)) * cH : null;

  // ── Status bands (only when 'score' is selected) ──
  let bandSVG = '';
  const scoreAxis = m1Key === 'score' ? 'L' : (m2Key === 'score' ? 'R' : null);
  if (scoreAxis) {
    const yFn = scoreAxis === 'L' ? yScaleL : yScaleR;
    const thresholds = window._clientThresholds || DEFAULT_THRESHOLDS;
    const bandDefs = [
      { y0: 0,                   y1: thresholds.critical, color: '#dc2626', label: 'Critical' },
      { y0: thresholds.critical, y1: thresholds.risk,     color: '#ea580c', label: 'Risk' },
      { y0: thresholds.risk,     y1: thresholds.watch,    color: '#d97706', label: 'Watch' },
      { y0: thresholds.watch,    y1: thresholds.healthy,  color: '#16a34a', label: 'Healthy' },
      { y0: thresholds.healthy,  y1: 100,                 color: '#3b82f6', label: 'Expand' },
    ];
    bandSVG = bandDefs.map(b => {
      const y = yFn(b.y1);
      const h = yFn(b.y0) - y;
      return `<rect x="${pad.left}" y="${y}" width="${cW}" height="${h}" fill="${b.color}" opacity="0.055"/>`;
    }).join('');
    // Band labels on right edge only when no secondary axis
    if (!hasM2) {
      bandSVG += bandDefs.map(b => {
        const midY = (yFn(b.y1) + yFn(b.y0)) / 2;
        return `<text x="${W - pad.right + 6}" y="${midY + 3}" font-size="8" fill="${b.color}" opacity="0.6" font-weight="700">${b.label}</text>`;
      }).join('');
    }
  }

  // ── Left Y-axis grid lines + labels ──
  let gridSVG = '';
  if (m1Key === 'score' && m1Cfg.fixed) {
    // Health score 0-100: dense grid with major/minor lines
    for (let v = yL.min; v <= yL.max; v += 10) {
      const y = yScaleL(v);
      const isMajor = v % 25 === 0;
      gridSVG += `<line x1="${pad.left}" y1="${y}" x2="${W-pad.right}" y2="${y}" stroke="var(--border)" stroke-width="${isMajor?1:0.5}" opacity="${isMajor?0.7:0.35}" stroke-dasharray="${v===yL.min||v===yL.max?'0':'3,3'}"/>`;
      if (v % 20 === 0) {
        gridSVG += `<text x="${pad.left-8}" y="${y+3}" text-anchor="end" font-size="8" font-weight="${isMajor?'600':'400'}" fill="var(--subtle)">${m1Cfg.axFmt(v)}</text>`;
      }
    }
  } else {
    // All other metrics: use computed step for clean grid
    const step = yL.step;
    for (let v = yL.min; v <= yL.max + step * 0.01; v += step) {
      const y = yScaleL(v);
      const isEdge = Math.abs(v - yL.min) < 0.01 || Math.abs(v - yL.max) < 0.01;
      gridSVG += `<line x1="${pad.left}" y1="${y}" x2="${W-pad.right}" y2="${y}" stroke="var(--border)" stroke-width="${isEdge?1:0.5}" opacity="${isEdge?0.7:0.35}" stroke-dasharray="${isEdge?'0':'3,3'}"/>`;
      gridSVG += `<text x="${pad.left-8}" y="${y+3}" text-anchor="end" font-size="8" font-weight="${isEdge?'600':'400'}" fill="var(--subtle)">${m1Cfg.axFmt(v)}</text>`;
    }
  }

  // ── Right Y-axis labels (secondary metric) ──
  let rightAxisSVG = '';
  if (hasM2 && yR && m2Cfg) {
    const step = yR.step;
    for (let v = yR.min; v <= yR.max + step * 0.01; v += step) {
      const y = yScaleR(v);
      rightAxisSVG += `<text x="${W-pad.right+8}" y="${y+3}" font-size="8" fill="${m2Line.color}" opacity="0.75" font-weight="500">${m2Cfg.axFmt(v)}</text>`;
    }
    // Right axis line
    rightAxisSVG += `<line x1="${W-pad.right}" y1="${pad.top}" x2="${W-pad.right}" y2="${yScaleL(yL.min)}" stroke="${m2Line.color}" stroke-width="1" opacity="0.25"/>`;
  }

  // ── X-axis date labels ──
  let xLabels = '';
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labelEvery = rangeDays <= 7 ? 1 : rangeDays <= 30 ? 2 : rangeDays <= 90 ? 7 : rangeDays <= 180 ? 14 : 30;
  dates.forEach((d, i) => {
    const x = xScale(i);
    const parts = d.split('-');
    const mo = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    // Vertical tick marks
    if (rangeDays <= 30 || (rangeDays <= 90 && i % 3 === 0) || i % 7 === 0) {
      xLabels += `<line x1="${x}" y1="${yScaleL(yL.min)}" x2="${x}" y2="${yScaleL(yL.min)+4}" stroke="var(--border)" stroke-width="0.5" opacity="0.5"/>`;
    }
    // Labels
    if (i % labelEvery === 0 || i === dates.length - 1) {
      const lbl = monthNames[mo] + ' ' + day;
      xLabels += `<text x="${x}" y="${H - pad.bottom + 16}" text-anchor="middle" font-size="7.5" fill="var(--subtle)">${lbl}</text>`;
    }
  });

  // ── Draw primary metric lines (area fills + lines + dots) ──
  let linesSVG = '';
  const dateIdx = {};
  dates.forEach((d,i) => { dateIdx[d] = i; });

  const _hasBreakdown = lines.some(l => l.dashed);
  lines.forEach((line, lineIdx) => {
    const pts = line.points.filter(p => dateIdx[p.date] !== undefined && !isNaN(p.avg))
      .sort((a,b) => a.date.localeCompare(b.date));
    if (pts.length < 2) return;

    // Area fill under the main line (first line only, skip in breakdown mode)
    if (lineIdx === 0 && !_hasBreakdown) {
      const areaBottom = yScaleL(yL.min);
      const areaPts = pts.map(p => `${xScale(dateIdx[p.date])},${yScaleL(p.avg)}`);
      const firstX = xScale(dateIdx[pts[0].date]);
      const lastX = xScale(dateIdx[pts[pts.length-1].date]);
      const areaPath = `M${firstX},${areaBottom} L${areaPts.join(' L')} L${lastX},${areaBottom} Z`;
      linesSVG += `<defs><linearGradient id="trendAreaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${line.color}" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="${line.color}" stop-opacity="0.02"/>
      </linearGradient></defs>`;
      linesSVG += `<path d="${areaPath}" fill="url(#trendAreaGrad)"/>`;
    }

    // Line
    const polyPts = pts.map(p => `${xScale(dateIdx[p.date])},${yScaleL(p.avg)}`).join(' ');
    const dashAttr = line.dashed ? ' stroke-dasharray="6,4"' : '';
    const lineOp = line.dashed ? '0.45' : '0.9';
    linesSVG += `<polyline points="${polyPts}" fill="none" stroke="${line.color}" stroke-width="${line.width}" stroke-linejoin="round" stroke-linecap="round" opacity="${lineOp}"${dashAttr}/>`;

    // Dots — skip for dashed reference lines, smaller in breakdown mode
    if (!line.dashed) {
      const dotR = _hasBreakdown ? 2 : (lineIdx === 0 ? 3 : 2.2);
      pts.forEach((p, pi) => {
        const cx = xScale(dateIdx[p.date]);
        const cy = yScaleL(p.avg);
        linesSVG += `<circle cx="${cx}" cy="${cy}" r="${dotR+1}" fill="var(--surface)" opacity="0.8"/>`;
        linesSVG += `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${line.color}"/>`;
        // Value labels on main line only (skip in breakdown mode for clarity)
        if (!_hasBreakdown && lineIdx === 0) {
          const labelSkip = pts.length <= 15 ? 1 : pts.length <= 30 ? 2 : pts.length <= 60 ? 4 : 7;
          if (pi % labelSkip === 0 || pi === pts.length - 1) {
            linesSVG += `<text x="${cx}" y="${cy - dotR - 4}" text-anchor="middle" font-size="7" font-weight="700" fill="${line.color}">${m1Cfg.fmt(p.avg)}</text>`;
          }
        }
      });
    }
  });

  // ── Draw secondary metric line (dashed, right Y-axis) ──
  if (hasM2 && yScaleR) {
    const pts = m2Line.points.filter(p => dateIdx[p.date] !== undefined && !isNaN(p.avg))
      .sort((a,b) => a.date.localeCompare(b.date));
    if (pts.length >= 2) {
      // Subtle area fill
      const areaBottom = yScaleR(yR.min);
      const areaPts = pts.map(p => `${xScale(dateIdx[p.date])},${yScaleR(p.avg)}`);
      const firstX = xScale(dateIdx[pts[0].date]);
      const lastX = xScale(dateIdx[pts[pts.length-1].date]);
      const areaPath = `M${firstX},${areaBottom} L${areaPts.join(' L')} L${lastX},${areaBottom} Z`;
      linesSVG += `<defs><linearGradient id="trendArea2Grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${m2Line.color}" stop-opacity="0.10"/>
        <stop offset="100%" stop-color="${m2Line.color}" stop-opacity="0.01"/>
      </linearGradient></defs>`;
      linesSVG += `<path d="${areaPath}" fill="url(#trendArea2Grad)"/>`;

      // Dashed line
      const polyPts = pts.map(p => `${xScale(dateIdx[p.date])},${yScaleR(p.avg)}`).join(' ');
      linesSVG += `<polyline points="${polyPts}" fill="none" stroke="${m2Line.color}" stroke-width="${m2Line.width}" stroke-linejoin="round" stroke-linecap="round" opacity="0.85" stroke-dasharray="6,3"/>`;

      // Dots
      pts.forEach(p => {
        const cx = xScale(dateIdx[p.date]);
        const cy = yScaleR(p.avg);
        linesSVG += `<circle cx="${cx}" cy="${cy}" r="3" fill="var(--surface)" opacity="0.8"/>`;
        linesSVG += `<circle cx="${cx}" cy="${cy}" r="2" fill="${m2Line.color}"/>`;
      });
    }
  }

  // ── Build tooltip data ──
  _trendTipData = dates.map((d) => {
    const parts = d.split('-');
    const mo = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    const dateLabel = monthNames[mo] + ' ' + day;

    const primaryVals = lines.map(l => {
      const pt = l.points.find(x => x.date === d);
      return pt ? { label: l.label, color: l.color, val: m1Cfg.fmt(pt.avg) } : null;
    }).filter(Boolean);

    let secondaryVal = null;
    if (hasM2 && m2Cfg) {
      const pt = m2Line.points.find(x => x.date === d);
      if (pt) secondaryVal = { label: m2Line.label, color: m2Line.color, val: m2Cfg.fmt(pt.avg) };
    }

    return { dateLabel, primaryVals, secondaryVal };
  });

  // ── Hover columns ──
  let hoverSVG = '';
  const colW = dates.length > 1 ? cW / (dates.length - 1) : cW;
  dates.forEach((d, i) => {
    const cx = xScale(i);
    hoverSVG += `<rect x="${cx - colW/2}" y="${pad.top}" width="${colW}" height="${cH}" fill="transparent" style="cursor:crosshair"
      onmouseenter="showTrendTip(evt,${cx},${i})"
      onmouseleave="hideTrendTip()"/>`;
  });

  // ── Axis border lines ──
  let axisSVG = `<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${yScaleL(yL.min)}" stroke="var(--border)" stroke-width="1.5" opacity="0.5"/>`;
  axisSVG += `<line x1="${pad.left}" y1="${yScaleL(yL.min)}" x2="${W-pad.right}" y2="${yScaleL(yL.min)}" stroke="var(--border)" stroke-width="1.5" opacity="0.5"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">
    ${bandSVG}${gridSVG}${rightAxisSVG}${axisSVG}${xLabels}${linesSVG}${hoverSVG}
  </svg>`;
}

function showTrendTip(evt, cx, colIdx) {
  let tip = document.getElementById('trend-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'trend-tip';
    tip.className = 'trend-tooltip';
    el('trend-chart-wrap').appendChild(tip);
  }
  const data = _trendTipData[colIdx];
  if (!data) return;

  let rows = '';
  data.primaryVals.forEach(v => {
    rows += `<div style="display:flex;align-items:center;gap:6px;margin-top:3px"><span style="width:8px;height:8px;border-radius:50%;background:${v.color};flex-shrink:0"></span><span>${v.label}</span><strong style="margin-left:auto">${v.val}</strong></div>`;
  });
  if (data.secondaryVal) {
    rows += `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;border-top:1px solid var(--border);padding-top:4px"><span style="width:14px;height:0;border-top:2.5px dashed ${data.secondaryVal.color};flex-shrink:0"></span><span>${data.secondaryVal.label}</span><strong style="margin-left:auto">${data.secondaryVal.val}</strong></div>`;
  }

  tip.innerHTML = `<div style="font-weight:700;margin-bottom:4px;font-size:.82rem">${data.dateLabel}</div>${rows}`;
  // Position relative to the chart-wrap container
  const wrap = el('trend-chart-wrap');
  const svg = wrap.querySelector('svg');
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const wRect = wrap.getBoundingClientRect();
  const scaleX = rect.width / 960;
  const left = (cx * scaleX) + (rect.left - wRect.left);
  tip.style.display = 'block';
  tip.style.left = (left + 14) + 'px';
  tip.style.top = '8px';
}

function hideTrendTip() {
  const tip = document.getElementById('trend-tip');
  if (tip) tip.style.display = 'none';
}

/* ═══════════════ TREND ANALYSIS ═══════════════ */

const _taSvg = {
  trend:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  corr:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  signal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  zap:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  clock:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  users:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  bar:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  drop:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>'
};

function _fmtTaVal(v, metricKey) {
  const cfg = METRIC_CFG[metricKey];
  if (!cfg) return Math.round(v * 10) / 10;
  if (metricKey === 'mrr' || metricKey === 'arr') return '$' + fmtNum(Math.round(v));
  // For small deltas, show more precision so we don't display "+0"
  const rounded = cfg.fmt(v);
  if (rounded === '0' && Math.abs(v) > 0.001) return Math.round(v * 100) / 100;
  return rounded;
}

function _taRangeLabel(rangeDays) {
  if (rangeDays <= 1) return '1 day';
  if (rangeDays <= 7) return rangeDays + ' days';
  if (rangeDays <= 30) return rangeDays + ' days';
  if (rangeDays <= 90) return Math.round(rangeDays / 30) + ' months';
  if (rangeDays <= 365) return Math.round(rangeDays / 30) + ' months';
  return (rangeDays / 365).toFixed(1).replace('.0', '') + ' years';
}

/* 1. Trend Acceleration */
function _taTrendAccel(data, metricKey, rangeDays) {
  if (data.length < 6) return null;
  const mid = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, mid);
  const secondHalf = data.slice(mid);
  const d1 = firstHalf[firstHalf.length - 1].avg - firstHalf[0].avg;
  const d2 = secondHalf[secondHalf.length - 1].avg - secondHalf[0].avg;
  const diff = d2 - d1;
  const label = (METRIC_CFG[metricKey] || {}).label || metricKey;
  const halfLabel = _taRangeLabel(Math.round(rangeDays / 2));
  const isCurrency = metricKey === 'mrr' || metricKey === 'arr';
  const threshold = isCurrency ? Math.max(Math.abs(d1) * 0.1, 100) : 1;
  if (Math.abs(diff) < threshold) return null;
  const accel = diff > 0 && d2 > 0;
  const decel = diff < 0 && d1 > 0 && d2 >= 0;
  const accelDn = diff < 0 && d2 < 0;
  const decelDn = diff > 0 && d1 < 0 && d2 <= 0;
  let title, accent;
  if (accel) { title = label + ' is accelerating'; accent = 'green'; }
  else if (decel) { title = label + ' growth is decelerating'; accent = 'amber'; }
  else if (accelDn) { title = label + ' decline is accelerating'; accent = 'red'; }
  else if (decelDn) { title = label + ' decline is slowing'; accent = 'amber'; }
  else { title = label + ' momentum shifted'; accent = 'amber'; }
  const f = v => (v >= 0 ? '+' : '') + _fmtTaVal(v, metricKey);
  const detail = `Changed <strong>${f(d2)}</strong> in the recent ${halfLabel} vs <strong>${f(d1)}</strong> in the prior ${halfLabel}.`;
  return { priority: 2, icon: _taSvg.trend, iconBg: accent === 'green' ? 'var(--green-l)' : accent === 'red' ? 'var(--red-l)' : 'var(--amber-l)', iconColor: accent === 'green' ? 'var(--green)' : accent === 'red' ? 'var(--red)' : 'var(--amber)', accent, title, detail };
}

/* 2. Metric Correlation (dual metric) */
// Inverted metrics: lower value = better outcome
const _invertedMetrics = new Set(['days', 'tickets']);
function _taMetricCorrelation(data1, data2, m1, m2, rangeDays) {
  if (!data2 || !data2.length || data1.length < 3) return null;
  const rawD1 = data1[data1.length - 1].avg - data1[0].avg;
  const rawD2 = data2[data2.length - 1].avg - data2[0].avg;
  // Flip inverted metrics so positive = good for both
  const d1 = _invertedMetrics.has(m1) ? -rawD1 : rawD1;
  const d2 = _invertedMetrics.has(m2) ? -rawD2 : rawD2;
  const l1 = (METRIC_CFG[m1] || {}).label || m1;
  const l2 = (METRIC_CFG[m2] || {}).label || m2;
  const f1 = v => (v >= 0 ? '+' : '') + _fmtTaVal(v, m1);
  const f2 = v => (v >= 0 ? '+' : '') + _fmtTaVal(v, m2);
  const m2Hint = _invertedMetrics.has(m2) ? (rawD2 < 0 ? ' (improving)' : ' (worsening)') : '';

  // Detect recovery: check second-half trend for each metric
  const mid1 = Math.floor(data1.length / 2);
  const mid2 = Math.floor(data2.length / 2);
  const rawD1Recent = data1.length >= 6 ? data1[data1.length - 1].avg - data1[mid1].avg : rawD1;
  const rawD2Recent = data2.length >= 6 ? data2[data2.length - 1].avg - data2[mid2].avg : rawD2;
  const d1Recent = _invertedMetrics.has(m1) ? -rawD1Recent : rawD1Recent;
  const d2Recent = _invertedMetrics.has(m2) ? -rawD2Recent : rawD2Recent;
  // Recovery = overall negative but recent half is positive (and meaningful)
  const m1Recovering = d1 < 0 && d1Recent > 0 && Math.abs(rawD1Recent) > Math.abs(rawD1) * 0.3;
  const m2Recovering = d2 < 0 && d2Recent > 0 && Math.abs(rawD2Recent) > Math.abs(rawD2) * 0.3;

  const sameDir = (d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0);
  const oppositeDir = (d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0);
  // Check significance — both need meaningful movement
  const t1 = m1 === 'mrr' || m1 === 'arr' ? 100 : 0.5;
  const t2 = m2 === 'mrr' || m2 === 'arr' ? 100 : 0.5;
  if (Math.abs(rawD1) < t1 && Math.abs(rawD2) < t2) return null;
  const rl = _taRangeLabel(rangeDays);
  const halfLabel = _taRangeLabel(Math.round(rangeDays / 2));
  let title, detail, accent;
  if (sameDir) {
    const bothGood = d1 > 0;
    if (!bothGood && (m1Recovering || m2Recovering)) {
      // Both down overall but one or both recovering
      const recoverNames = [m1Recovering ? l1 : null, m2Recovering ? l2 : null].filter(Boolean).join(' and ');
      title = recoverNames + ' recovering after earlier decline';
      detail = `Over ${rl}, <strong>${l1} ${f1(rawD1)}</strong> and <strong>${l2} ${f2(rawD2)}${m2Hint}</strong> overall, but ${recoverNames} ${m1Recovering && m2Recovering ? 'have' : 'has'} been trending up in the recent ${halfLabel}. The recovery trend is encouraging.`;
      accent = 'amber';
    } else {
      title = l1 + ' and ' + l2 + ' both ' + (bothGood ? 'improved' : 'worsened');
      detail = `Over ${rl}, <strong>${l1} ${f1(rawD1)}</strong> while <strong>${l2} ${f2(rawD2)}${m2Hint}</strong>. ` + (bothGood ? 'Both metrics moving positively — a healthy reinforcing trend.' : 'Both metrics declining — investigate shared root causes.');
      accent = bothGood ? 'green' : 'red';
    }
  } else if (oppositeDir) {
    const m1Good = d1 > 0;
    if (!m1Good && m1Recovering) {
      // m1 overall down but recovering, m2 improving — both now trending up
      title = l1 + ' recovering — now trending with ' + l2;
      detail = `Over ${rl}, <strong>${l1} ${f1(rawD1)}</strong> overall but has been trending up in the recent ${halfLabel} (<strong>${f1(rawD1Recent)}</strong>). Combined with <strong>${l2} ${f2(rawD2)}${m2Hint}</strong>, both metrics are now moving in the right direction.`;
      accent = 'green';
    } else if (m1Good && m2Recovering) {
      title = l1 + ' improved and ' + l2 + ' now recovering';
      detail = `Over ${rl}, <strong>${l1} ${f1(rawD1)}</strong> while <strong>${l2} ${f2(rawD2)}${m2Hint}</strong> overall. However, ${l2} has turned around in the recent ${halfLabel} — a positive signal.`;
      accent = 'green';
    } else {
      const m2Improved = d2 > 0;
      title = l1 + (m1Good ? ' improved' : ' declined') + ' while ' + l2 + (m2Improved ? ' improved' : ' worsened');
      detail = `Over ${rl}, <strong>${l1} ${f1(rawD1)}</strong> while <strong>${l2} ${f2(rawD2)}${m2Hint}</strong>. ` + (m1Good ? 'Mixed signals — ' + l2 + ' may be a drag on future ' + l1 + ' performance.' : l2 + ' is improving but hasn\'t yet lifted ' + l1 + ' — watch for a lagging recovery.');
      accent = 'amber';
    }
  } else {
    return null;
  }
  return { priority: 1, icon: _taSvg.corr, iconBg: accent === 'green' ? 'var(--green-l)' : accent === 'red' ? 'var(--red-l)' : 'var(--amber-l)', iconColor: accent === 'green' ? 'var(--green)' : accent === 'red' ? 'var(--red)' : 'var(--amber)', accent, title, detail };
}

/* 3. Inflection Point */
function _taInflection(data, metricKey, rangeDays) {
  if (data.length < 10) return null;
  // Use a wider window to find sustained reversals, not blips
  // Window = ~10% of data length, min 3, max 15
  const win = Math.max(3, Math.min(15, Math.round(data.length * 0.1)));
  // For each candidate point, compare avg slope before vs after over the window
  let maxSwing = 0, bestIdx = -1, bestBefore = 0, bestAfter = 0;
  for (let i = win; i < data.length - win; i++) {
    const beforeSlope = (data[i].avg - data[i - win].avg) / win;
    const afterSlope = (data[i + win].avg - data[i].avg) / win;
    if ((beforeSlope > 0 && afterSlope < 0) || (beforeSlope < 0 && afterSlope > 0)) {
      const swing = Math.abs(afterSlope - beforeSlope) * win; // Total magnitude over window
      if (swing > maxSwing) { maxSwing = swing; bestIdx = i; bestBefore = beforeSlope; bestAfter = afterSlope; }
    }
  }
  const isCurrency = metricKey === 'mrr' || metricKey === 'arr';
  // Threshold relative to data range — swing must be at least 15% of the total range
  const vals = data.map(d => d.avg);
  const dataRange = Math.max(...vals) - Math.min(...vals);
  const threshold = isCurrency ? Math.max(200, dataRange * 0.15) : Math.max(3, dataRange * 0.15);
  if (bestIdx < 0 || maxSwing < threshold) return null;

  // Verify the reversal actually sustained — check overall slope from inflection to end
  // If the trend from inflection→end agrees with the BEFORE direction (not the after),
  // the reversal was a temporary blip and didn't stick
  const remaining = data.length - 1 - bestIdx;
  if (remaining >= win) {
    const endSlope = (data[data.length - 1].avg - data[bestIdx].avg) / remaining;
    // Reversal was temporary: original direction resumed
    if ((bestBefore > 0 && endSlope > 0) || (bestBefore < 0 && endSlope < 0)) return null;
  }

  const inflPt = data[bestIdx];
  const d = new Date(inflPt.date);
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const label = (METRIC_CFG[metricKey] || {}).label || metricKey;
  const wasRising = bestBefore > 0;
  const title = 'Trend reversed around ' + dateStr;
  const swingFmt = _fmtTaVal(Math.round(maxSwing * 10) / 10, metricKey);
  const unit = isCurrency ? '' : metricKey === 'csat' ? '' : ' pts';
  const detail = `<strong>${label}</strong> shifted from ${wasRising ? 'climbing' : 'declining'} to ${wasRising ? 'declining' : 'climbing'} around <strong>${dateStr}</strong>. The ${wasRising ? 'pullback' : 'recovery'} magnitude was <strong>${swingFmt}${unit}</strong>.`;
  const accent = wasRising ? 'red' : 'green';
  return { priority: 1, icon: _taSvg.zap, iconBg: accent === 'green' ? 'var(--green-l)' : 'var(--red-l)', iconColor: accent === 'green' ? 'var(--green)' : 'var(--red)', accent, title, detail };
}

/* 4. Volatility Assessment */
function _taVolatility(data, metricKey) {
  if (data.length < 10) return null;
  const diffs = [];
  for (let i = 1; i < data.length; i++) diffs.push(data[i].avg - data[i-1].avg);
  const mean = diffs.reduce((s,d) => s+d, 0) / diffs.length;
  const variance = diffs.reduce((s,d) => s + (d - mean) ** 2, 0) / diffs.length;
  const stddev = Math.sqrt(variance);
  const label = (METRIC_CFG[metricKey] || {}).label || metricKey;
  const isCurrency = metricKey === 'mrr' || metricKey === 'arr';
  // Compare to expected volatility scaled by metric range
  // Score ~0-100, CSAT ~1-5, Adoption ~0-100, Logins ~0-50, Days ~0-60, Tickets ~0-20
  const dataVals = data.map(d => d.avg);
  const dataRange = Math.max(...dataVals) - Math.min(...dataVals);
  const baseExpected = isCurrency ? 500 : Math.max(0.1, dataRange * 0.05);
  const ratio = stddev / baseExpected;
  if (ratio > 0.5 && ratio < 2.0) return null; // Normal range
  const isStable = ratio <= 0.5;
  const title = label + ' has been ' + (isStable ? 'unusually stable' : 'volatile');
  const fmtStd = isCurrency ? '$' + fmtNum(Math.round(stddev)) : (Math.round(stddev * 10) / 10);
  const detail = isStable
    ? `Daily variation of just <strong>${fmtStd}</strong> — the portfolio is in a tight range. A breakout in either direction could signal a shift.`
    : `Swinging <strong>±${fmtStd}</strong> day-to-day — higher than typical. Investigate whether specific accounts are driving the volatility.`;
  const accent = isStable ? 'green' : 'amber';
  return { priority: 3, icon: _taSvg.bar, iconBg: isStable ? 'var(--green-l)' : 'var(--amber-l)', iconColor: isStable ? 'var(--green)' : 'var(--amber)', accent, title, detail };
}

/* 5. Period-over-Period Comparison */
function _taPeriodComparison(data, metricKey, cutoff, rangeDays, active) {
  const label = (METRIC_CFG[metricKey] || {}).label || metricKey;
  const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
  // Compute prior period data
  const priorCutoff = new Date(cutoff.getTime() - rangeDays * 86400000);
  const cutoffStr = cutoff.toISOString().slice(0,10);
  // Current period avg
  if (data.length < 2) return null;
  const currentAvg = data.reduce((s,d) => s + d.avg, 0) / data.length;
  // Prior period avg — manually scan history
  const priorPts = [];
  const allDates = new Set();
  active.forEach(c => {
    (c.history || []).forEach(h => {
      if (!h.date) return;
      const d = new Date(h.date);
      const key = d.toISOString().slice(0,10);
      if (d >= priorCutoff && d < cutoff) allDates.add(key);
    });
  });
  if (allDates.size < 2) return null;
  // Use same aggregation approach — simplified: just get avg of all history points in prior window
  const priorDates = [...allDates].sort();
  priorDates.forEach(date => {
    let total = 0, count = 0;
    active.forEach(c => {
      const hist = (c.history || []).filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
      let val = null;
      for (const h of hist) {
        const key = new Date(h.date).toISOString().slice(0,10);
        if (key <= date) {
          const v = cfg.val(h, c);
          if (v != null && typeof v === 'number' && !isNaN(v)) val = v;
        }
      }
      if (val !== null) { total += val; count++; }
    });
    if (count) priorPts.push(total / count);
  });
  if (!priorPts.length) return null;
  const priorAvg = priorPts.reduce((s,v) => s+v, 0) / priorPts.length;
  const diff = currentAvg - priorAvg;
  const isCurrency = metricKey === 'mrr' || metricKey === 'arr';
  const threshold = isCurrency ? 100 : 0.5;
  if (Math.abs(diff) < threshold) return null;
  const rangeLabel = rangeDays <= 7 ? rangeDays + ' days' : rangeDays <= 30 ? rangeDays + ' days' : rangeDays <= 90 ? Math.round(rangeDays / 30) + ' month' + (rangeDays > 45 ? 's' : '') : Math.round(rangeDays / 30) + ' months';
  const improved = diff > 0;
  const f = v => _fmtTaVal(v, metricKey);
  const fd = v => (v >= 0 ? '+' : '') + _fmtTaVal(v, metricKey);
  const title = label + (improved ? ' improved' : ' declined') + ' vs prior period';
  const detail = `Averaged <strong>${f(currentAvg)}</strong> this period vs <strong>${f(priorAvg)}</strong> in the prior ${rangeLabel} — a <strong>${fd(diff)}</strong> shift.`;
  const accent = improved ? 'green' : 'red';
  return { priority: 2, icon: _taSvg.clock, iconBg: improved ? 'var(--green-l)' : 'var(--red-l)', iconColor: improved ? 'var(--green)' : 'var(--red)', accent, title, detail };
}

/* 6. CSM Overlay Divergence */
function _taCsmDivergence(data, active, cutoff, rangeDays, metricKey) {
  if (!_trendCsmOverlay) return null;
  const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
  const label = cfg.label || metricKey;
  const csmName = _trendCsmOverlay;
  if (data.length < 2) return null;

  // Helper: compute per-customer delta for a set of customers
  const _custDelta = function(c) {
    const hist = (c.history || []).filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
    const inRange = hist.filter(h => new Date(h.date) >= cutoff);
    const before = hist.filter(h => new Date(h.date) < cutoff);
    if (!inRange.length) return null;
    const startVal = before.length ? cfg.val(before[before.length - 1], c) : cfg.val(inRange[0], c);
    const endVal = cfg.val(inRange[inRange.length - 1], c);
    if (startVal == null || endVal == null) return null;
    return endVal - startVal;
  };

  // CSM cohort delta
  const csmCusts = active.filter(c => c.manager === csmName);
  if (csmCusts.length < 2) return null;
  const csmDeltas = csmCusts.map(_custDelta).filter(d => d !== null);
  if (csmDeltas.length < 2) return null;
  const csmAvgDelta = csmDeltas.reduce((s,d) => s+d, 0) / csmDeltas.length;

  // Rest-of-portfolio delta — same methodology, excluding CSM's own accounts
  const restCusts = active.filter(c => c.manager !== csmName);
  const restDeltas = restCusts.map(_custDelta).filter(d => d !== null);
  const portDelta = restDeltas.length ? restDeltas.reduce((s,d) => s+d, 0) / restDeltas.length : 0;

  const gap = csmAvgDelta - portDelta;
  const isCurrency = metricKey === 'mrr' || metricKey === 'arr';
  // Gap must be meaningful: at least 25% of the larger group's change, floor of 3 pts
  const minRelative = Math.max(Math.abs(csmAvgDelta), Math.abs(portDelta)) * 0.25;
  const threshold = isCurrency ? 200 : Math.max(3, minRelative);
  if (Math.abs(gap) < threshold) return null;
  const outperformed = gap > 0;
  const f = v => (v >= 0 ? '+' : '') + _fmtTaVal(v, metricKey);
  const title = escHtml(csmName) + '\'s accounts ' + (outperformed ? 'outperformed' : 'underperformed') + ' the rest of the portfolio';
  const detail = `${escHtml(csmName)}'s ${csmDeltas.length} accounts averaged <strong>${f(csmAvgDelta)}</strong> ${label} change vs <strong>${f(portDelta)}</strong> across the other ${restDeltas.length} accounts.`;
  const accent = outperformed ? 'green' : 'red';
  return { priority: 1, icon: _taSvg.users, iconBg: outperformed ? 'var(--green-l)' : 'var(--red-l)', iconColor: outperformed ? 'var(--green)' : 'var(--red)', accent, title, detail };
}

/* 7. Cross-Metric Signal */
function _taCrossSignal(active, cutoff, metricKey) {
  if (active.length < 6) return null;
  const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
  const label = cfg.label || metricKey;
  // Split accounts by whether their primary metric improved or declined
  const improving = [], declining = [];
  active.forEach(c => {
    const hist = (c.history || []).filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
    const inRange = hist.filter(h => new Date(h.date) >= cutoff);
    const before = hist.filter(h => new Date(h.date) < cutoff);
    if (!inRange.length) return;
    const startVal = before.length ? cfg.val(before[before.length - 1], c) : cfg.val(inRange[0], c);
    const endVal = cfg.val(inRange[inRange.length - 1], c);
    if (startVal == null || endVal == null) return;
    const delta = endVal - startVal;
    if (delta > 0.5) improving.push(c);
    else if (delta < -0.5) declining.push(c);
  });
  if (improving.length < 2 || declining.length < 2) return null;
  // Check which other signal differs most between the two groups
  const signals = [
    { key: 'logins', getter: c => c.logins, label: 'Logins' },
    { key: 'adoption', getter: c => c.adoption, label: 'Adoption %' },
    { key: 'tickets', getter: c => c.tickets, label: 'Open Tickets' },
    { key: 'nps', getter: c => c.nps, label: 'NPS' },
    { key: 'csat', getter: c => c.csat, label: 'CSAT' },
    { key: 'days', getter: c => c.days, label: 'Days Since Contact' }
  ].filter(s => s.key !== metricKey); // Don't compare metric to itself
  let bestSignal = null, bestGap = 0;
  signals.forEach(sig => {
    const impVals = improving.map(c => sig.getter(c)).filter(v => v != null);
    const decVals = declining.map(c => sig.getter(c)).filter(v => v != null);
    if (impVals.length < 2 || decVals.length < 2) return;
    const impAvg = impVals.reduce((s,v) => s+v, 0) / impVals.length;
    const decAvg = decVals.reduce((s,v) => s+v, 0) / decVals.length;
    const gap = Math.abs(impAvg - decAvg);
    // Normalize by the signal's range to compare fairly
    const maxVal = Math.max(...impVals, ...decVals);
    const minVal = Math.min(...impVals, ...decVals);
    const range = maxVal - minVal || 1;
    const normalizedGap = gap / range;
    if (normalizedGap > bestGap) {
      bestGap = normalizedGap;
      bestSignal = { ...sig, impAvg, decAvg, gap: impAvg - decAvg };
    }
  });
  if (!bestSignal || bestGap < 0.15) return null;
  const fv = v => Math.round(v * 10) / 10;
  const inverted = _invertedMetrics.has(bestSignal.key); // Lower = better
  // For inverted metrics: improving accounts having LOWER values = expected positive pattern
  // gap = impAvg - decAvg; for inverted: negative gap means improving accounts have lower (better) values
  const isHealthyPattern = inverted ? bestSignal.gap < 0 : bestSignal.gap > 0;
  const title = bestSignal.label + ' correlates most with ' + label + ' changes';
  let detail;
  if (inverted) {
    const lowerGroup = bestSignal.gap < 0 ? 'rising' : 'declining';
    detail = `Accounts with rising ${label} averaged <strong>${fv(bestSignal.impAvg)}</strong> ${bestSignal.label} vs <strong>${fv(bestSignal.decAvg)}</strong> for declining accounts — <strong>lower ${bestSignal.label} tracks with better ${label}</strong>.`;
  } else {
    detail = `Accounts with rising ${label} averaged <strong>${fv(bestSignal.impAvg)}</strong> ${bestSignal.label} vs <strong>${fv(bestSignal.decAvg)}</strong> for declining accounts — <strong>higher ${bestSignal.label} tracks with better ${label}</strong>.`;
  }
  const accent = isHealthyPattern ? 'green' : 'amber';
  return { priority: 3, icon: _taSvg.signal, iconBg: isHealthyPattern ? 'var(--green-l)' : 'var(--amber-l)', iconColor: isHealthyPattern ? 'var(--green)' : 'var(--amber)', accent, title, detail };
}

/* ── Drop Attribution — decompose score drops into signal contributions ── */

function _attributeScoreDrop(custs, peakDate, troughDate) {
  const SIGNALS = [
    { key: 'logins',   label: 'Logins',   unit: '',  norm: v => v != null ? Math.min(v / 30, 1) * 100 : 50 },
    { key: 'adoption', label: 'Adoption', unit: '%', norm: v => v != null ? Math.min(v, 100) : 50 },
    { key: 'tickets',  label: 'Tickets',  unit: '',  norm: v => v != null ? Math.max(0, 100 - v * 20) : 50 },
    { key: 'nps',      label: 'NPS',      unit: '',  norm: v => npsNormalized(v) },
    { key: 'csat',     label: 'CSAT',     unit: '',  norm: v => csatNormalized(v) },
    { key: 'days',     label: 'Days Since Contact', unit: 'd', norm: v => v != null ? Math.max(0, 100 - (v / 180) * 100) : 50 },
    { key: 'growth',   label: 'Growth',   unit: '',  norm: v => ({ none: 25, mild: 65, strong: 100 }[v] || 25) }
  ];
  const w = weights;
  const totalW = (w.logins + w.adoption + w.tickets + (w.nps || 0) + (w.csat || 0) + w.days + w.growth) || 100;
  const activeSignals = SIGNALS.filter(s => (w[s.key] || 0) > 0);
  if (!activeSignals.length) return [];

  const peakT = new Date(peakDate).getTime();
  const troughT = new Date(troughDate).getTime();
  const peakSums = {}, troughSums = {};
  activeSignals.forEach(s => { peakSums[s.key] = []; troughSums[s.key] = []; });

  custs.forEach(c => {
    const hist = (c.history || []).filter(h => h.date).sort((a, b) => a.date.localeCompare(b.date));
    if (!hist.length) return;
    const findClosest = (tgt) => hist.reduce((best, h) =>
      Math.abs(new Date(h.date).getTime() - tgt) < Math.abs(new Date(best.date).getTime() - tgt) ? h : best
    );
    const pe = findClosest(peakT);
    const te = findClosest(troughT);
    activeSignals.forEach(s => {
      const pv = pe.signals?.[s.key] ?? c[s.key] ?? null;
      const tv = te.signals?.[s.key] ?? c[s.key] ?? null;
      if (pv != null) peakSums[s.key].push(pv);
      if (tv != null) troughSums[s.key].push(tv);
    });
  });

  return activeSignals.map(s => {
    const pArr = peakSums[s.key], tArr = troughSums[s.key];
    if (!pArr.length || !tArr.length) return null;
    let rawStart, rawEnd, normStart, normEnd;
    if (s.key === 'growth') {
      // Growth is categorical (none/mild/strong) — use mode, not numeric average
      const mode = arr => { const freq = {}; arr.forEach(v => freq[v] = (freq[v]||0)+1); return Object.entries(freq).sort((a,b) => b[1]-a[1])[0]?.[0] || 'none'; };
      rawStart = mode(pArr);
      rawEnd   = mode(tArr);
      normStart = s.norm(rawStart);
      normEnd   = s.norm(rawEnd);
    } else {
      rawStart = pArr.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0) / pArr.length;
      rawEnd   = tArr.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0) / tArr.length;
      normStart = s.norm(rawStart);
      normEnd   = s.norm(rawEnd);
    }
    const contribution = (normEnd - normStart) * ((w[s.key] || 0) / totalW);
    return { signal: s.key, label: s.label, contribution, rawStart, rawEnd, normStart, normEnd, unit: s.unit };
  }).filter(Boolean).sort((a, b) => a.contribution - b.contribution);
}

function _taDropAttribution(active, data1, metricKey, cutoff, rangeDays) {
  if (!data1 || data1.length < 5) return null;
  const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;

  // Find largest peak-to-trough drawdown
  let peakVal = data1[0].avg, peakIdx = 0;
  let bestDrop = 0, bestPeakIdx = 0, bestTroughIdx = 0;
  for (let i = 1; i < data1.length; i++) {
    if (data1[i].avg > peakVal) { peakVal = data1[i].avg; peakIdx = i; }
    const drawdown = peakVal - data1[i].avg;
    if (drawdown > bestDrop) { bestDrop = drawdown; bestPeakIdx = peakIdx; bestTroughIdx = i; }
  }
  if (bestDrop < 0.5) return null;

  const peakPt = data1[bestPeakIdx];
  const troughPt = data1[bestTroughIdx];
  const dropAbs = peakPt.avg - troughPt.avg;
  const dropPct = peakPt.avg !== 0 ? (dropAbs / peakPt.avg) * 100 : 0;

  // Recovery check: if the metric recovered >50% of the drop after the trough, skip
  const finalPt = data1[data1.length - 1];
  const recovery = finalPt.avg - troughPt.avg;
  if (dropAbs > 0 && recovery / dropAbs > 0.5) return null; // recovered — not a current concern

  // Significance check: compute std dev of daily changes
  const deltas = [];
  for (let i = 1; i < data1.length; i++) deltas.push(data1[i].avg - data1[i - 1].avg);
  const meanDelta = deltas.reduce((s, v) => s + v, 0) / (deltas.length || 1);
  const stdDev = Math.sqrt(deltas.reduce((s, v) => s + Math.pow(v - meanDelta, 2), 0) / (deltas.length || 1));

  // Must be significant: > 5 pts (score) or > 10% (other), AND > 1.5× std dev
  const isScore = metricKey === 'score';
  if (isScore && dropAbs < 5) return null;
  if (!isScore && dropPct < 10) return null;
  if (stdDev > 0 && dropAbs < stdDev * 1.5) return null;

  // Format dates
  const fmtDate = d => { const dt = new Date(d); return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const peakDateStr = fmtDate(peakPt.date);
  const troughDateStr = fmtDate(troughPt.date);

  // ── Per-customer concentration analysis ──
  const peakT = new Date(peakPt.date).getTime();
  const troughT = new Date(troughPt.date).getTime();
  const custDeltas = [];
  active.forEach(c => {
    const hist = (c.history || []).filter(h => h.date).sort((a, b) => a.date.localeCompare(b.date));
    if (!hist.length) return;
    const findClosest = (tgt) => hist.reduce((best, h) =>
      Math.abs(new Date(h.date).getTime() - tgt) < Math.abs(new Date(best.date).getTime() - tgt) ? h : best
    );
    const pe = findClosest(peakT);
    const te = findClosest(troughT);
    const sv = cfg.val(pe, c), ev = cfg.val(te, c);
    if (sv != null && ev != null) custDeltas.push({ name: c.name, delta: ev - sv });
  });

  let concentrationNote = '';
  if (custDeltas.length >= 2) {
    const declined = custDeltas.filter(d => d.delta < -0.5);
    const improved = custDeltas.filter(d => d.delta > 0.5);
    const pctDeclined = Math.round((declined.length / custDeltas.length) * 100);

    if (declined.length <= 2 && declined.length > 0 && custDeltas.length > 3) {
      // Concentrated: 1-2 accounts drove the decline
      declined.sort((a, b) => a.delta - b.delta);
      const fv = v => _fmtTaVal(Math.abs(v), metricKey);
      if (declined.length === 1) {
        concentrationNote = ` This was driven primarily by <strong>${escHtml(declined[0].name)}</strong> (down ${fv(declined[0].delta)}) — the remaining ${custDeltas.length - 1} accounts were relatively flat.`;
      } else {
        concentrationNote = ` Driven primarily by <strong>${escHtml(declined[0].name)}</strong> (down ${fv(declined[0].delta)}) and <strong>${escHtml(declined[1].name)}</strong> (down ${fv(declined[1].delta)}) — most of the other ${custDeltas.length - 2} accounts were relatively flat.`;
      }
    } else if (pctDeclined >= 60) {
      if (custDeltas.length <= 5) {
        concentrationNote = ` <strong>${declined.length} of ${custDeltas.length}</strong> accounts declined during this period.`;
      } else {
        concentrationNote = ` This was a broad-based decline across the portfolio — <strong>${declined.length} of ${custDeltas.length}</strong> accounts (${pctDeclined}%) dropped during this period.`;
      }
    } else if (pctDeclined >= 30) {
      concentrationNote = ` <strong>${declined.length} of ${custDeltas.length}</strong> accounts (${pctDeclined}%) declined while ${improved.length} improved — a split trend worth investigating by segment.`;
    }
  }

  // ── Day-over-day spikes (changes of ±7% or more) ──
  const dropSlice = data1.slice(bestPeakIdx, bestTroughIdx + 1);
  const dodSpikes = [];
  for (let i = 1; i < dropSlice.length; i++) {
    const prev = dropSlice[i - 1].avg;
    const curr = dropSlice[i].avg;
    if (prev === 0) continue;
    const changePct = ((curr - prev) / Math.abs(prev)) * 100;
    if (Math.abs(changePct) >= 7) {
      dodSpikes.push({ date: dropSlice[i].date, changePct, prev, curr });
    }
  }
  let spikeNote = '';
  if (dodSpikes.length > 0) {
    dodSpikes.sort((a, b) => a.changePct - b.changePct); // most negative first
    const worst = dodSpikes[0];
    const fv = v => _fmtTaVal(v, metricKey);
    spikeNote = ` Sharpest single-day drop was <strong>${Math.abs(Math.round(worst.changePct))}%</strong> on ${fmtDate(worst.date)} (${fv(worst.prev)} → ${fv(worst.curr)}).`;
    if (dodSpikes.length > 1) {
      spikeNote += ` There were <strong>${dodSpikes.length} days</strong> during this window with day-over-day changes exceeding 7%.`;
    }
  }

  let title, detail;

  if (isScore) {
    // Decompose into signal contributions
    const attribs = _attributeScoreDrop(active, peakPt.date, troughPt.date);
    const negatives = attribs.filter(a => a.contribution < -0.3);
    if (!negatives.length) return null;

    title = 'Decline Drivers';
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
        if (a.rawStart === a.rawEnd) return null; // no change in mode — skip
        return `<strong>${a.label}</strong> shifted from ${cap(a.rawStart)} to ${cap(a.rawEnd)}, costing ~${impact} pts`;
      }
      if (a.signal === 'tickets') {
        return `<strong>${a.label}</strong> increased from ${fRaw(a.rawStart)} to ${fRaw(a.rawEnd)}, costing ~${impact} pts on the score`;
      }
      if (a.signal === 'days') {
        return `<strong>${a.label}</strong> increased from ${fRaw(a.rawStart)} to ${fRaw(a.rawEnd)}, costing ~${impact} pts`;
      }
      if (a.rawEnd < a.rawStart) {
        return `<strong>${a.label}</strong> dropped from ${fRaw(a.rawStart)} to ${fRaw(a.rawEnd)}, costing ~${impact} pts`;
      }
      return `<strong>${a.label}</strong> moved from ${fRaw(a.rawStart)} to ${fRaw(a.rawEnd)}, costing ~${impact} pts`;
    }).filter(Boolean);

    if (!drivers.length) return null;
    detail = `Health Score fell <strong>${Math.round(dropAbs)} points</strong> (${Math.round(peakPt.avg)} → ${Math.round(troughPt.avg)}) between ${peakDateStr} and ${troughDateStr}. `;
    if (drivers.length === 1) {
      detail += `The primary driver was ${drivers[0]}.`;
    } else {
      detail += `The biggest factors: ${drivers.join('; ')}.`;
    }
    detail += concentrationNote + spikeNote;
  } else {
    // Non-score metric: report the drop and cross-reference with health score
    title = 'Significant Decline';
    const label = cfg.label;
    const fv = v => _fmtTaVal(v, metricKey);
    detail = `${label} fell <strong>${fv(dropAbs)}</strong> (${fv(peakPt.avg)} → ${fv(troughPt.avg)}) between ${peakDateStr} and ${troughDateStr}, which is larger than typical day-to-day variation for this metric.`;
    detail += concentrationNote + spikeNote;

    // Cross-reference with health score
    try {
      const scoreData = aggregateByDay(active, 'score', cutoff);
      if (scoreData.length >= 2) {
        const findNearest = (arr, date) => arr.reduce((best, p) =>
          Math.abs(new Date(p.date).getTime() - new Date(date).getTime()) < Math.abs(new Date(best.date).getTime() - new Date(date).getTime()) ? p : best
        );
        const sPeak = findNearest(scoreData, peakPt.date);
        const sTrough = findNearest(scoreData, troughPt.date);
        const sDelta = Math.round(sTrough.avg - sPeak.avg);
        if (sDelta < -2) {
          detail += ` During the same window, Health Score also dropped <strong>${Math.abs(sDelta)} points</strong>.`;
        } else if (Math.abs(sDelta) <= 2) {
          detail += ` Health Score stayed stable during this window — other signals offset the impact.`;
        }
      }
    } catch (e) { /* aggregateByDay may fail for non-standard metrics */ }
  }

  return { priority: 1, icon: _taSvg.drop, iconBg: 'var(--red-l)', iconColor: 'var(--red)', accent: 'red', title, detail };
}

/* ── Orchestrator ─────────────────────────────── */
function _buildTrendAnalysis(active, data1, data2, cutoff, rangeDays, m1, m2) {
  const wrap = el('trend-analysis-wrap');
  if (!wrap) return;

  const results = [
    _taPeriodComparison(data1, m1, cutoff, rangeDays, active),
    _taTrendAccel(data1, m1, rangeDays),
    _taMetricCorrelation(data1, data2, m1, m2, rangeDays),
    _taInflection(data1, m1, rangeDays),
    _taVolatility(data1, m1),
    _taCsmDivergence(data1, active, cutoff, rangeDays, m1),
    _taCrossSignal(active, cutoff, m1),
    _taDropAttribution(active, data1, m1, cutoff, rangeDays)
  ].filter(Boolean);

  results.sort((a, b) => a.priority - b.priority);
  const top = results.slice(0, 5);

  if (!top.length) {
    wrap.innerHTML = '';
    return;
  }

  wrap.innerHTML = '<div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:8px">Analysis</div>' +
    top.map(ins => {
      const cls = ins.accent === 'green' ? 'ta-card-green' : ins.accent === 'red' ? 'ta-card-red' : ins.accent === 'amber' ? 'ta-card-amber' : '';
      return `<div class="ta-card ${cls}">
        <div class="ta-icon" style="background:${ins.iconBg};color:${ins.iconColor}">${ins.icon}</div>
        <div><div class="ta-label">${ins.title}</div><div class="ta-detail">${ins.detail}</div></div>
      </div>`;
    }).join('');
}

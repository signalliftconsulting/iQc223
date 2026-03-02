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
    days = { '7d': 7, '30d': 30, '90d': 90, '6m': 180, '1y': 365, '2y': 730 }[range] || 30;
    cutoff.setDate(cutoff.getDate() - days);
  }
  cutoff.setHours(0,0,0,0);

  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));

  // ── Aggregate portfolio data by day (supports any metric) ──
  function aggregateByDay(custs, metricKey) {
    const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
    const isSumMetric = cfg.agg === 'sum';
    const dayMap = {};
    custs.forEach(c => {
      (c.history || []).forEach(h => {
        if (!h.date) return;
        const d = new Date(h.date);
        if (d < cutoff) return;
        const val = cfg.val(h, c);
        if (val == null || typeof val !== 'number' || isNaN(val)) return;
        const key = d.toISOString().slice(0,10);
        if (!dayMap[key]) dayMap[key] = { total: 0, count: 0, seen: isSumMetric ? new Set() : null };
        // For sum metrics using current customer values (mrr/arr), only count each customer once per day
        if (isSumMetric) {
          if (dayMap[key].seen.has(c.id)) return;
          dayMap[key].seen.add(c.id);
        }
        dayMap[key].total += val;
        dayMap[key].count += 1;
      });
    });
    return Object.entries(dayMap)
      .map(([date, v]) => ({ date, avg: isSumMetric ? v.total : (v.count ? v.total / v.count : 0) }))
      .filter(p => !isNaN(p.avg))
      .sort((a, b) => a.date.localeCompare(b.date));
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
  const OVERLAY_COLORS = ['#7c3aed','#ea580c','#0891b2','#db2777','#059669'];
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
    const hist = (c.history || []).filter(h => {
      if (!h.date) return false;
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
  _trendMovers = active.map(c => {
    const hist = (c.history || []).filter(h => h.date && new Date(h.date) >= cutoff).sort((a,b) => a.date.localeCompare(b.date));
    const startScore = hist.length ? hist[0].score : c.score;
    const delta = c.score - startScore;
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
  }).slice(0, 10);

  if (!sorted.length) {
    wrap.innerHTML = '<p style="color:var(--subtle);font-size:.84rem;padding:12px">No score history available for this period.</p>';
    return;
  }

  const arrow = (key) => _trendSortKey === key ? (_trendSortDir === 1 ? ' ▲' : ' ▼') : '';
  const thStyle = 'padding:8px 12px;font-weight:700;color:var(--fg);cursor:pointer;user-select:none;white-space:nowrap';

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

  lines.forEach((line, lineIdx) => {
    const pts = line.points.filter(p => dateIdx[p.date] !== undefined && !isNaN(p.avg))
      .sort((a,b) => a.date.localeCompare(b.date));
    if (pts.length < 2) return;

    // Area fill under the main line (first line only)
    if (lineIdx === 0) {
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
    linesSVG += `<polyline points="${polyPts}" fill="none" stroke="${line.color}" stroke-width="${line.width}" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`;

    // Dots — larger for main, smaller for overlays
    const dotR = lineIdx === 0 ? 3 : 2.2;
    pts.forEach((p, pi) => {
      const cx = xScale(dateIdx[p.date]);
      const cy = yScaleL(p.avg);
      // White outline for readability
      linesSVG += `<circle cx="${cx}" cy="${cy}" r="${dotR+1}" fill="var(--surface)" opacity="0.8"/>`;
      linesSVG += `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${line.color}"/>`;
      // Value labels on main line dots (if not too crowded)
      const labelSkip = pts.length <= 15 ? 1 : pts.length <= 30 ? 2 : pts.length <= 60 ? 4 : 7;
      if (lineIdx === 0 && (pi % labelSkip === 0 || pi === pts.length - 1)) {
        linesSVG += `<text x="${cx}" y="${cy - dotR - 4}" text-anchor="middle" font-size="7" font-weight="700" fill="${line.color}">${m1Cfg.fmt(p.avg)}</text>`;
      }
    });
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

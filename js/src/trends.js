// ── TRENDS PAGE ──────────────────────────────────────────────
let _trendRange = '30d';
let _trendCsmOverlay = '';
let _trendClientOverlays = []; // array of customer ids
let _trendMovers = [];          // current movers data
let _trendSortKey = 'absDelta'; // default sort by absolute change
let _trendSortDir = -1;         // -1 = descending

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
  let days;
  const cutoff = new Date();
  if (range === 'ytd') {
    const jan1 = new Date(cutoff.getFullYear(), 0, 1);
    days = Math.ceil((cutoff - jan1) / 86400000);
    cutoff.setTime(jan1.getTime());
  } else {
    days = { '7d': 7, '30d': 30, '90d': 90 }[range] || 30;
    cutoff.setDate(cutoff.getDate() - days);
  }
  cutoff.setHours(0,0,0,0);

  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));

  // ── Aggregate portfolio data by day ──
  function aggregateByDay(custs) {
    const dayMap = {};
    custs.forEach(c => {
      (c.history || []).forEach(h => {
        if (!h.date) return;
        const d = new Date(h.date);
        if (d < cutoff) return;
        const key = d.toISOString().slice(0,10);
        if (!dayMap[key]) dayMap[key] = { total: 0, count: 0 };
        dayMap[key].total += h.score;
        dayMap[key].count += 1;
      });
    });
    return Object.entries(dayMap)
      .map(([date, v]) => ({ date, avg: Math.round(v.total / v.count) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  const portfolioData = aggregateByDay(active);

  // ── KPIs ──
  const currentAvg = active.length ? Math.round(active.reduce((s,c) => s + (c.score||0), 0) / active.length) : 0;
  let improving = 0, declining = 0;
  active.forEach(c => {
    const d = getDelta7d(c);
    if (d > 0) improving++;
    else if (d < 0) declining++;
  });
  const avgDelta7 = active.length ? (active.reduce((s,c) => s + getDelta7d(c), 0) / active.length) : 0;
  const trendDir = avgDelta7 > 0.5 ? 'Improving' : avgDelta7 < -0.5 ? 'Declining' : 'Stable';
  const trendDirColor = avgDelta7 > 0.5 ? 'dash-kpi-green' : avgDelta7 < -0.5 ? 'dash-kpi-red' : 'dash-kpi-blue';

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
      <div class="dash-kpi-sub">${avgDelta7 >= 0 ? '+' : ''}${avgDelta7.toFixed(1)} avg 7d change</div>
    </div>
    <div class="dash-kpi-card ${trendDirColor}">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${tIcons.trend}</div>
        <span class="dash-kpi-label">Trend Direction</span>
      </div>
      <div class="dash-kpi-num" style="font-size:1.5rem">${trendDir}</div>
      <div class="dash-kpi-sub">${active.length} active account${active.length !== 1 ? 's' : ''}</div>
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

  // ── Build chart lines ──
  const OVERLAY_COLORS = ['#7c3aed','#ea580c','#0891b2','#db2777','#059669'];
  const lines = [];

  // Main portfolio line
  lines.push({ label: 'Portfolio Average', color: '#3b82f6', width: 2, points: portfolioData });

  // CSM overlay
  if (_trendCsmOverlay) {
    const csmCusts = active.filter(c => c.manager === _trendCsmOverlay);
    const csmData = aggregateByDay(csmCusts);
    lines.push({ label: escHtml(_trendCsmOverlay), color: OVERLAY_COLORS[0], width: 1.5, points: csmData });
  }

  // Client overlays
  _trendClientOverlays.forEach((id, idx) => {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    const hist = (c.history || []).filter(h => h.date && new Date(h.date) >= cutoff)
      .map(h => ({ date: new Date(h.date).toISOString().slice(0,10), avg: h.score }))
      .sort((a,b) => a.date.localeCompare(b.date));
    if (hist.length) {
      const ci = (idx + 1) % OVERLAY_COLORS.length;
      lines.push({ label: escHtml(c.name), color: OVERLAY_COLORS[ci], width: 1.5, points: hist });
    }
  });

  // Render chart
  const chartWrap = el('trend-chart-wrap');
  if (chartWrap) {
    chartWrap.innerHTML = buildTrendChart(lines, days);
  }

  // Render legend
  const legendWrap = el('trend-legend');
  if (legendWrap) {
    legendWrap.innerHTML = lines.map(l =>
      `<div class="trend-legend-item"><div class="trend-legend-dot" style="background:${l.color}"></div>${l.label}</div>`
    ).join('');
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

  // ── Top Movers — build data, then render with current sort ──
  _trendMovers = active.map(c => {
    const hist = (c.history || []).filter(h => h.date && new Date(h.date) >= cutoff).sort((a,b) => a.date.localeCompare(b.date));
    const startScore = hist.length ? hist[0].score : c.score;
    const delta = c.score - startScore;
    return { name: c.name, score: c.score, delta, absDelta: Math.abs(delta), status: c.status, mrr: c.mrr || 0, manager: c.manager || '—', id: c.id };
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
      <th style="${thStyle}" onclick="sortTrendMovers('manager')">CSM${arrow('manager')}</th>
    </tr></thead>
    <tbody>${sorted.map(m => {
      const dColor = m.delta > 0 ? '#16a34a' : m.delta < 0 ? '#dc2626' : 'var(--subtle)';
      const dSign = m.delta > 0 ? '+' : '';
      return `<tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="nav('customers');setTimeout(()=>openDrawer('${escHtml(m.id)}'),100)">
        <td style="padding:8px 12px;color:var(--text);font-weight:600">${escHtml(m.name)}</td>
        <td style="padding:8px 12px;color:var(--text)">${m.score}</td>
        <td style="padding:8px 12px;color:${dColor};font-weight:700">${dSign}${m.delta}</td>
        <td style="padding:8px 12px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColors[m.status]||'#888'};margin-right:4px"></span>${m.status}</td>
        <td style="padding:8px 12px;color:var(--text)">$${fmtNum(m.mrr)}</td>
        <td style="padding:8px 12px;color:var(--subtle)">${escHtml(m.manager)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function buildTrendChart(lines, rangeDays) {
  if (!lines.length || !lines[0].points.length) {
    return '<p style="color:var(--subtle);text-align:center;padding:40px 0;font-size:.88rem">Not enough score history to display a trend chart. Score a few customers to get started.</p>';
  }

  const W = 960, H = 260;
  const pad = { top: 14, right: 56, bottom: 36, left: 40 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  // Collect all dates across all lines
  const allDates = new Set();
  lines.forEach(l => l.points.forEach(p => allDates.add(p.date)));
  const dates = [...allDates].sort();
  if (dates.length < 1) {
    return '<p style="color:var(--subtle);text-align:center;padding:40px 0;font-size:.88rem">No data points in this range.</p>';
  }

  const xScale = (i) => pad.left + (dates.length === 1 ? cW/2 : (i / (dates.length - 1)) * cW);
  const yScale = (v) => pad.top + cH - (v / 100) * cH;

  // ── Status bands (subtle background) ──
  const thresholds = window._clientThresholds || DEFAULT_THRESHOLDS;
  const bandDefs = [
    { y0: 0,               y1: thresholds.critical, color: '#dc2626', label: 'Critical' },
    { y0: thresholds.critical, y1: thresholds.risk,     color: '#ea580c', label: 'Risk' },
    { y0: thresholds.risk,     y1: thresholds.watch,    color: '#d97706', label: 'Watch' },
    { y0: thresholds.watch,    y1: thresholds.healthy,  color: '#16a34a', label: 'Healthy' },
    { y0: thresholds.healthy,  y1: 100,                 color: '#3b82f6', label: 'Expand' },
  ];
  let bandSVG = bandDefs.map(b => {
    const y = yScale(b.y1);
    const h = yScale(b.y0) - y;
    return `<rect x="${pad.left}" y="${y}" width="${cW}" height="${h}" fill="${b.color}" opacity="0.055"/>`;
  }).join('');
  // Band labels on right edge
  bandSVG += bandDefs.map(b => {
    const midY = (yScale(b.y1) + yScale(b.y0)) / 2;
    return `<text x="${W - pad.right + 6}" y="${midY + 3}" font-size="8" fill="${b.color}" opacity="0.6" font-weight="700">${b.label}</text>`;
  }).join('');

  // ── Grid lines (every 10 units for density) ──
  let gridSVG = '';
  for (let v = 0; v <= 100; v += 10) {
    const y = yScale(v);
    const isMajor = v % 25 === 0;
    gridSVG += `<line x1="${pad.left}" y1="${y}" x2="${W-pad.right}" y2="${y}" stroke="var(--border)" stroke-width="${isMajor?1:0.5}" opacity="${isMajor?0.7:0.35}" stroke-dasharray="${v===0||v===100?'0':'3,3'}"/>`;
    if (v % 20 === 0) {
      gridSVG += `<text x="${pad.left-8}" y="${y+3}" text-anchor="end" font-size="8" font-weight="${isMajor?'600':'400'}" fill="var(--subtle)">${v}</text>`;
    }
  }

  // ── X-axis date labels — show every date for 7d, every 2–3 for 30d, every 7 for 90d ──
  let xLabels = '';
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labelEvery = rangeDays <= 7 ? 1 : rangeDays <= 30 ? 2 : rangeDays <= 90 ? 7 : 14;
  dates.forEach((d, i) => {
    const x = xScale(i);
    const parts = d.split('-');
    const mo = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    // Vertical tick marks
    if (rangeDays <= 30 || (rangeDays <= 90 && i % 3 === 0) || i % 7 === 0) {
      xLabels += `<line x1="${x}" y1="${yScale(0)}" x2="${x}" y2="${yScale(0)+4}" stroke="var(--border)" stroke-width="0.5" opacity="0.5"/>`;
    }
    // Labels
    if (i % labelEvery === 0 || i === dates.length - 1) {
      const lbl = monthNames[mo] + ' ' + day;
      xLabels += `<text x="${x}" y="${H - pad.bottom + 16}" text-anchor="middle" font-size="7.5" fill="var(--subtle)">${lbl}</text>`;
    }
  });

  // ── Draw area fills + lines ──
  let linesSVG = '';
  const dateIdx = {};
  dates.forEach((d,i) => { dateIdx[d] = i; });

  lines.forEach((line, lineIdx) => {
    const pts = line.points.filter(p => dateIdx[p.date] !== undefined)
      .sort((a,b) => a.date.localeCompare(b.date));
    if (pts.length < 2) return;

    // Area fill under the main line (first line only)
    if (lineIdx === 0) {
      const areaBottom = yScale(0);
      const areaPts = pts.map(p => `${xScale(dateIdx[p.date])},${yScale(p.avg)}`);
      const firstX = xScale(dateIdx[pts[0].date]);
      const lastX = xScale(dateIdx[pts[pts.length-1].date]);
      const areaPath = `M${firstX},${areaBottom} L${areaPts.join(' L')} L${lastX},${areaBottom} Z`;
      // Gradient fill
      linesSVG += `<defs><linearGradient id="trendAreaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${line.color}" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="${line.color}" stop-opacity="0.02"/>
      </linearGradient></defs>`;
      linesSVG += `<path d="${areaPath}" fill="url(#trendAreaGrad)"/>`;
    }

    // Line
    const polyPts = pts.map(p => `${xScale(dateIdx[p.date])},${yScale(p.avg)}`).join(' ');
    linesSVG += `<polyline points="${polyPts}" fill="none" stroke="${line.color}" stroke-width="${line.width}" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`;

    // Dots — larger for main, smaller for overlays
    const dotR = lineIdx === 0 ? 3 : 2.2;
    pts.forEach((p, pi) => {
      const cx = xScale(dateIdx[p.date]);
      const cy = yScale(p.avg);
      // White outline for readability
      linesSVG += `<circle cx="${cx}" cy="${cy}" r="${dotR+1}" fill="var(--surface)" opacity="0.8"/>`;
      linesSVG += `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${line.color}"/>`;
      // Score labels on main line dots (if not too crowded)
      const labelSkip = pts.length <= 15 ? 1 : pts.length <= 30 ? 2 : pts.length <= 60 ? 4 : 7;
      if (lineIdx === 0 && (pi % labelSkip === 0 || pi === pts.length - 1)) {
        linesSVG += `<text x="${cx}" y="${cy - dotR - 4}" text-anchor="middle" font-size="7" font-weight="700" fill="${line.color}">${p.avg}</text>`;
      }
    });
  });

  // ── Vertical hover columns ──
  let hoverSVG = '';
  const mainPts = lines[0].points.filter(p => dateIdx[p.date] !== undefined)
    .sort((a,b) => a.date.localeCompare(b.date));
  const colW = dates.length > 1 ? cW / (dates.length - 1) : cW;
  mainPts.forEach((p, pi) => {
    const cx = xScale(dateIdx[p.date]);
    const parts = p.date.split('-');
    const mo = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    const lbl = monthNames[mo] + ' ' + day;
    // Collect all line values for this date
    const allVals = lines.map(l => {
      const pt = l.points.find(x => x.date === p.date);
      return pt ? pt.avg : null;
    }).filter(v => v !== null);
    const valStr = allVals.join(',');
    const nameStr = lines.filter((l,i) => { const pt = l.points.find(x => x.date === p.date); return pt; }).map(l => l.label).join('|');
    const colorStr = lines.filter((l,i) => { const pt = l.points.find(x => x.date === p.date); return pt; }).map(l => l.color).join('|');
    // Invisible hover rect (full column height)
    hoverSVG += `<rect x="${cx - colW/2}" y="${pad.top}" width="${colW}" height="${cH}" fill="transparent" style="cursor:crosshair"
      onmouseenter="showTrendTip(evt,${cx},'${lbl}',[${valStr}],'${nameStr}','${colorStr}')"
      onmouseleave="hideTrendTip()"/>`;
  });

  // ── Axis border lines ──
  let axisSVG = `<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${yScale(0)}" stroke="var(--border)" stroke-width="1.5" opacity="0.5"/>`;
  axisSVG += `<line x1="${pad.left}" y1="${yScale(0)}" x2="${W-pad.right}" y2="${yScale(0)}" stroke="var(--border)" stroke-width="1.5" opacity="0.5"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">
    ${bandSVG}${gridSVG}${axisSVG}${xLabels}${linesSVG}${hoverSVG}
  </svg>`;
}

function showTrendTip(evt, cx, dateLabel, scores, names, colors) {
  let tip = document.getElementById('trend-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'trend-tip';
    tip.className = 'trend-tooltip';
    el('trend-chart-wrap').appendChild(tip);
  }
  const nameArr = (typeof names === 'string') ? names.split('|') : [names];
  const colorArr = (typeof colors === 'string') ? colors.split('|') : [colors];
  const scoreArr = Array.isArray(scores) ? scores : [scores];
  let rows = scoreArr.map((s, i) =>
    `<div style="display:flex;align-items:center;gap:6px;margin-top:3px"><span style="width:8px;height:8px;border-radius:50%;background:${colorArr[i]||'#3b82f6'};flex-shrink:0"></span><span>${nameArr[i]||'Score'}</span><strong style="margin-left:auto">${s}</strong></div>`
  ).join('');
  tip.innerHTML = `<div style="font-weight:700;margin-bottom:4px;font-size:.82rem">${dateLabel}</div>${rows}`;
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


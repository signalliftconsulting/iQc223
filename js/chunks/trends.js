/* IQcadence chunk: trends — lazy-loaded */

// ── Smooth SVG Path Utility (Catmull-Rom → Cubic Bezier) ────
function _smoothPath(pts) {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

// ── Downsample screen-space points for smoother long-range lines ──
// Averages clusters of nearby points down to ~maxPts, preserving endpoints.
function _downsampleXY(pts, maxPts) {
  if (!pts || pts.length <= maxPts) return pts;
  const step = (pts.length - 1) / (maxPts - 1);
  const half = Math.ceil(step * 0.6);
  const result = [pts[0]];
  for (let i = 1; i < maxPts - 1; i++) {
    const center = Math.round(i * step);
    const lo = Math.max(0, center - half);
    const hi = Math.min(pts.length - 1, center + half);
    let sx = 0, sy = 0, n = 0;
    for (let j = lo; j <= hi; j++) { sx += pts[j].x; sy += pts[j].y; n++; }
    result.push({ x: sx / n, y: sy / n });
  }
  result.push(pts[pts.length - 1]);
  return result;
}

// ── TRENDS PAGE ──────────────────────────────────────────────
let _trendRange = '30d';
let _trendCsmOverlay = '';
let _trendClientOverlays = []; // array of customer ids
let _trendMovers = [];          // current movers data
let _trendSortKey = 'absDelta'; // default sort by absolute change
let _trendSortDir = -1;         // -1 = descending
let _trendSearch = '';
const TREND_COLS = [
  { key:'name',     label:'Customer', ftype:'text',   sortFn:"sortTrendMovers('name')", cls:'col-pin' },
  { key:'score',    label:'Score',    ftype:'number', sortFn:"sortTrendMovers('score')" },
  { key:'delta',    label:'Change',   ftype:'number', sortFn:"sortTrendMovers('delta')" },
  { key:'status',   label:'Status',   ftype:'enum',   sortFn:"sortTrendMovers('status')", enumVals:['critical','risk','watch','healthy','expand'] },
  { key:'mrr',      label:'MRR',      ftype:'number', sortFn:"sortTrendMovers('mrr')" },
  { key:'logins',   label:'Logins',   ftype:'number', sortFn:"sortTrendMovers('logins')" },
  { key:'adoption', label:'Adoption', ftype:'number', sortFn:"sortTrendMovers('adoption')" },
  { key:'tickets',  label:'Tickets',  ftype:'number', sortFn:"sortTrendMovers('tickets')" },
  { key:'manager',  label:'CSM',      ftype:'enum',   sortFn:"sortTrendMovers('manager')", enumFn:() => [...new Set(customers.map(c => c.manager || '').filter(Boolean))].sort() },
];
const _trendCF = makeColFilters('trend', 'tr-filter-portal', TREND_COLS, renderTrendMovers);
function _trendVal(m, key) {
  if (key === 'name') return (m.name || '').toLowerCase();
  if (key === 'score') return m.score || 0;
  if (key === 'delta') return m.delta || 0;
  if (key === 'status') return m.status || '';
  if (key === 'mrr') return m.mrr || 0;
  if (key === 'logins') return m.logins != null ? m.logins : -1;
  if (key === 'adoption') return m.adoption != null ? m.adoption : -1;
  if (key === 'tickets') return m.tickets != null ? m.tickets : -1;
  if (key === 'manager') return (m.manager || '').toLowerCase();
  return 0;
}
let _trendMetric1 = 'score';    // primary metric key
let _trendMetric2 = '';          // secondary metric key (empty = none)
let _trendShowChurned = false;   // include churned accounts in charts
let _trendTipData = [];          // tooltip data per date column
let _trendFirstRender = true;    // fade-in only on first render

// Range-aware delta: compare current score to score N days ago
// Returns null if no data exists near the range start (no fake baseline)
// Module-level so KPIs and analysis functions share the same calculation
function _getDeltaNd(c, n) {
  const ago = new Date(); ago.setDate(ago.getDate() - n);
  const hist = (c.history || []).slice().sort((a,b) => new Date(b.date) - new Date(a.date));
  const recent = hist.filter(h => new Date(h.date) >= ago);
  if (!recent.length) return null;
  const before = hist.filter(h => new Date(h.date) < ago);
  if (!before.length) return null;
  return recent[0].score - before[0].score;
}

const METRIC_CFG = {
  score:    { label:'Health Score',        agg:'avg', fixed:[0,100], val: (h,c) => h.score,                            fmt: v => String(Math.round(v)),            axFmt: v => String(Math.round(v)) },
  logins:   { label:'Logins',             agg:'avg', fixed:null,     val: (h,c) => h.signals?.logins,                  fmt: v => String(Math.round(v*10)/10),     axFmt: v => String(Math.round(v*10)/10) },
  adoption: { label:'Adoption %',         agg:'avg', fixed:[0,100], val: (h,c) => h.signals?.adoption,                fmt: v => Math.round(v)+'%',               axFmt: v => Math.round(v)+'%' },
  tickets:  { label:'Open Tickets',       agg:'avg', fixed:null,     val: (h,c) => h.signals?.tickets,                 fmt: v => String(Math.round(v*10)/10),     axFmt: v => String(Math.round(v*10)/10), lowerIsBetter:true },
  nps:      { label:'NPS Score',            agg:'avg', fixed:[0,10],  val: (h,c) => h.signals?.nps,                     fmt: v => String(Math.round(v*10)/10),     axFmt: v => String(Math.round(v)) },
  csat:     { label:'CSAT Score',           agg:'avg', fixed:[1,5],   val: (h,c) => h.signals?.csat,                    fmt: v => String(Math.round(v*10)/10),     axFmt: v => String(Math.round(v)) },
  days:     { label:'Days Since Contact',  agg:'avg', fixed:null,    val: (h,c) => h.signals?.days,                    fmt: v => String(Math.round(v)),            axFmt: v => String(Math.round(v)), lowerIsBetter:true },
  mrr:      { label:'Total MRR',          agg:'sum', fixed:null,     val: (h,c) => h.signals?._mrr != null ? h.signals._mrr : c.mrr, includeChurned:true, fmt: v => '$'+fmtNum(Math.round(v)), axFmt: v => { if(Math.abs(v)>=1e6) return '$'+(v/1e6).toFixed(1)+'M'; if(Math.abs(v)>=1e3) return '$'+Math.round(v/1e3)+'K'; return '$'+Math.round(v); } },
  arr:      { label:'Total ARR',          agg:'sum', fixed:null,     val: (h,c) => (h.signals?._mrr != null ? h.signals._mrr : c.mrr) * 12, includeChurned:true, fmt: v => '$'+fmtNum(Math.round(v)), axFmt: v => { if(Math.abs(v)>=1e6) return '$'+(v/1e6).toFixed(1)+'M'; if(Math.abs(v)>=1e3) return '$'+Math.round(v/1e3)+'K'; return '$'+Math.round(v); } },
  customers:{ label:'# Customers',        agg:'sum', fixed:null,     val: (h,c) => (h.signals?._mrr != null && h.signals._mrr === 0) ? 0 : 1, includeChurned:true, fmt: v => String(Math.round(v)), axFmt: v => String(Math.round(v)) },
};

function setTrendMetric(slot, key) {
  if (slot === 1) _trendMetric1 = key || 'score';
  else _trendMetric2 = key || '';
  renderTrends();
}

function setTrendRange(range) {
  _trendRange = range;
  // Sync both top and bottom range bars
  document.querySelectorAll('#trend-range-row .dtab, #trend-range-row2 .dtab').forEach(b =>
    b.classList.toggle('active', b.dataset.range === range));
  renderTrends();
}

function setTrendCsmOverlay(mgr) {
  _trendCsmOverlay = mgr || '';
  renderTrends();
}

function toggleTrendChurned(on) {
  _trendShowChurned = !!on;
  _syncChurnedToggle();
  renderTrends();
}
function _syncChurnedToggle() {
  const track = el('trend-churned-track');
  const thumb = el('trend-churned-thumb');
  const label = el('trend-churned-label');
  if (track) track.style.background = _trendShowChurned ? '#3b82f6' : '#cbd5e1';
  if (thumb) thumb.style.transform = _trendShowChurned ? 'translateX(14px)' : 'translateX(0)';
  if (label) {
    label.style.borderColor = _trendShowChurned ? '#3b82f6' : '';
    label.style.background = _trendShowChurned ? 'rgba(59,130,246,.06)' : '';
    label.style.color = _trendShowChurned ? 'var(--text)' : '';
  }
}

function addTrendClient(id) {
  if (_trendClientOverlays.includes(id)) return;
  if (_trendClientOverlays.length >= 2) _trendClientOverlays.shift();
  _trendClientOverlays.push(id);
  _syncClientDropdowns();
  renderTrends();
}

function removeTrendClient(id) {
  _trendClientOverlays = _trendClientOverlays.filter(x => x !== id);
  _syncClientDropdowns();
  _refreshTrendOverlays();
}

function toggleTrendOverlay(id) {
  if (_trendClientOverlays.includes(id)) {
    _trendClientOverlays = _trendClientOverlays.filter(x => x !== id);
  } else {
    if (_trendClientOverlays.length >= 2) _trendClientOverlays.shift();
    _trendClientOverlays.push(id);
  }
  _syncClientDropdowns();
  _refreshTrendOverlays();
}

function setTrendClientSlot(slot, id) {
  // slot 0 or 1
  if (id) {
    // Remove if already in other slot
    _trendClientOverlays = _trendClientOverlays.filter(x => x !== id);
    _trendClientOverlays[slot] = id;
  } else {
    _trendClientOverlays[slot] = undefined;
  }
  // Clean up: remove undefined/empty entries but keep slot positions
  _trendClientOverlays = _trendClientOverlays.filter(Boolean);
  _syncClientDropdowns();
  renderTrends();
}

function _trendClientSearch(slot) {
  const inp = el('trend-client-input-' + slot);
  const ac = el('trend-client-ac-' + slot);
  if (!inp || !ac) return;
  const q = (inp.value || '').trim().toLowerCase();
  if (!q) {
    // If cleared and there was a client, remove it
    if (_trendClientOverlays[slot]) {
      _trendClientOverlays[slot] = undefined;
      _trendClientOverlays = _trendClientOverlays.filter(Boolean);
      renderTrends();
    }
    ac.style.display = 'none';
    return;
  }
  const otherSlotId = _trendClientOverlays[slot === 0 ? 1 : 0];
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const matches = active.filter(c =>
    (c.name || '').toLowerCase().indexOf(q) !== -1 && c.id !== otherSlotId
  ).sort((a,b) => (a.name||'').localeCompare(b.name||'')).slice(0, 8);
  if (!matches.length) { ac.style.display = 'none'; return; }
  ac.innerHTML = matches.map(c =>
    `<div onclick="_trendClientPick(${slot},'${escHtml(c.id)}')">${escHtml(c.name)} <span style="color:var(--subtle);font-size:var(--fs-xs)">(${c.score})</span></div>`
  ).join('');
  ac.style.display = 'block';
}

function _trendClientPick(slot, id) {
  _trendClientOverlays = _trendClientOverlays.filter(x => x !== id);
  while (_trendClientOverlays.length <= slot) _trendClientOverlays.push(undefined);
  _trendClientOverlays[slot] = id;
  _trendClientOverlays = _trendClientOverlays.filter(Boolean);
  const c = customers.find(x => x.id === id);
  const inp = el('trend-client-input-' + slot);
  if (inp && c) inp.value = c.name || '';
  const ac = el('trend-client-ac-' + slot);
  if (ac) ac.style.display = 'none';
  renderTrends();
}

function _populateClientDropdowns() {
  _syncClientDropdowns();
}

function _syncClientDropdowns() {
  for (var s = 0; s < 2; s++) {
    var inp = el('trend-client-input-' + s);
    if (!inp) continue;
    var cid = _trendClientOverlays[s];
    var clearBtn = el('trend-client-clear-' + s);
    if (cid) {
      var c = customers.find(function(x) { return x.id === cid; });
      inp.value = c ? c.name : '';
      if (clearBtn) clearBtn.style.display = '';
    } else {
      if (document.activeElement !== inp) inp.value = '';
      if (clearBtn) clearBtn.style.display = 'none';
    }
  }
}

function _trendClientClear(slot) {
  _trendClientOverlays[slot] = undefined;
  _trendClientOverlays = _trendClientOverlays.filter(Boolean);
  var inp = el('trend-client-input-' + slot);
  if (inp) inp.value = '';
  var clearBtn = el('trend-client-clear-' + slot);
  if (clearBtn) clearBtn.style.display = 'none';
  renderTrends();
}

// Light refresh: only update chart lines, tags, and table row highlights - no scroll jump
function _refreshTrendOverlays() {
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
  const allWithHistory = _trendShowChurned ? customers.filter(c => passesManagerFilter(c)) : active;
  const _rangeName = { '3d':'3 Days','7d':'7 Days','30d':'30 Days','90d':'90 Days','6m':'6 Months','1y':'1 Year','2y':'2 Years','ytd':'YTD' }[range] || range;

  // Rebuild just the chart lines (reuse renderTrends' aggregation inline)
  function _aggByDay(custs, metricKey, rangeStart, rangeEnd) {
    const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
    const isSumMetric = cfg.agg === 'sum';
    const isCountMetric = cfg.agg === 'count';
    const _startDate = rangeStart || cutoff;
    const _endDate = rangeEnd || new Date();
    const _endStr = _endDate.toISOString().slice(0,10);
    function _allDays() {
      const dates = []; const d = new Date(_startDate);
      while (d.toISOString().slice(0,10) < _endStr) { dates.push(d.toISOString().slice(0,10)); d.setDate(d.getDate() + 1); }
      return dates;
    }
    if (isSumMetric || isCountMetric) {
      const ce = []; custs.forEach(c => { const vd = {}; (c.history||[]).forEach(h => { if(!h.date) return; const val = cfg.val(h,c); if(val==null||typeof val!=='number'||isNaN(val)) return; vd[new Date(h.date).toISOString().slice(0,10)] = val; }); const sd=Object.keys(vd).sort(); if(sd.length) ce.push({vd,sd}); });
      return _allDays().map(date => { let t=0,n=0; ce.forEach(e=>{let v=null; for(let i=e.sd.length-1;i>=0;i--){if(e.sd[i]<=date){v=e.vd[e.sd[i]];break;}} if(v!==null){t+=v;n++;}}); return {date,avg:isCountMetric?n:t,_count:n}; }).filter(p=>p._count>0).sort((a,b)=>a.date.localeCompare(b.date));
    }
    const cd = []; custs.forEach(c => { const dm={}; (c.history||[]).forEach(h => { if(!h.date) return; const val=cfg.val(h,c); if(val==null||typeof val!=='number'||isNaN(val)) return; dm[new Date(h.date).toISOString().slice(0,10)]=val; }); const sd=Object.keys(dm).sort(); if(sd.length) cd.push({dm,sd}); });
    return _allDays().map(date => { let t=0,n=0; cd.forEach(e=>{let v=null; for(let i=e.sd.length-1;i>=0;i--){if(e.sd[i]<=date){v=e.dm[e.sd[i]];break;}} if(v!==null){t+=v;n++;}}); return {date,avg:n?t/n:0,_count:n}; }).filter(p=>p._count>0);
  }

  const OVERLAY_COLORS = ['#7c3aed','#ea580c','#0891b2','#db2777','#059669','#2563eb','#d97706','#dc2626','#16a34a','#64748b'];
  const m1AggLabel = m1Cfg.agg === 'sum' ? 'Total' : 'Avg';
  const m1Pool = m1Cfg.includeChurned ? allWithHistory : active;
  const portfolioData = _aggByDay(m1Pool, m1);
  const lines = [{ label: 'Portfolio ' + m1AggLabel, color: '#3b82f6', width: 2.5, points: portfolioData }];

  if (_trendCsmOverlay) {
    const csmCusts = m1Pool.filter(c => c.manager === _trendCsmOverlay);
    lines.push({ label: escHtml(_trendCsmOverlay), color: OVERLAY_COLORS[0], width: 1.5, points: _aggByDay(csmCusts, m1) });
  }

  const _olTodayStr = new Date().toISOString().slice(0,10);
  _trendClientOverlays.forEach((id, idx) => {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    const dateMap = {};
    (c.history||[]).forEach(h => { if(!h.date) return; const v=m1Cfg.val(h,c); if(v==null||typeof v!=='number'||isNaN(v)) return; const ds=new Date(h.date).toISOString().slice(0,10); if(ds>=_olTodayStr) return; dateMap[ds]=v; });
    const scoredDates = Object.keys(dateMap).sort();
    if (!scoredDates.length) return;
    const allDays = []; const d = new Date(cutoff); while(d.toISOString().slice(0,10)<_olTodayStr){ allDays.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); }
    let lastVal = null; const pts = [];
    allDays.forEach(day => { if(dateMap[day]!==undefined) lastVal=dateMap[day]; if(lastVal===null){ for(let i=scoredDates.length-1;i>=0;i--){if(scoredDates[i]<=day){lastVal=dateMap[scoredDates[i]];break;}}} if(lastVal!==null) pts.push({date:day,avg:lastVal}); });
    if (pts.length >= 2) lines.push({ label: escHtml(c.name), color: OVERLAY_COLORS[(idx+1)%OVERLAY_COLORS.length], width: 1.5, points: pts });
  });

  // Prior period
  const priorCutoff = new Date(cutoff.getTime() - days * 86400000);
  const priorPortfolioData = _aggByDay(m1Pool, m1, priorCutoff, cutoff);
  let priorLine = null;
  if (priorPortfolioData.length >= 2) {
    const shiftedPrior = priorPortfolioData.map(p => { const s=new Date(new Date(p.date).getTime()+days*86400000); return {date:s.toISOString().slice(0,10),avg:p.avg}; });
    priorLine = { label: 'Prior ' + _rangeName, color: '#94a3b8', width: 1.5, points: shiftedPrior, dashed: true };
  }

  // Secondary metric
  let m2Line = null;
  if (m2Cfg) {
    const m2Pool = m2Cfg.includeChurned ? allWithHistory : active;
    const m2Data = _aggByDay(m2Pool, m2);
    if (m2Data.length) m2Line = { label: m2Cfg.label + ' (' + (m2Cfg.agg==='sum'?'Total':'Avg') + ')', color: '#f59e0b', width: 2, points: m2Data };
  }

  // Update chart only
  const chartWrap = el('trend-chart-wrap');
  if (chartWrap) chartWrap.innerHTML = buildTrendChart(lines, days, m1, m2Line, m2, priorLine);

  // Update legend
  const legendWrap = el('trend-legend');
  if (legendWrap) {
    let legendHTML = '';
    lines.forEach((l, i) => {
      legendHTML += `<div class="trend-legend-item"><div class="trend-legend-dot" style="background:${l.color}"></div>${l.label}</div>`;
      if (i === 0 && priorLine) legendHTML += `<div class="trend-legend-item"><div class="trend-legend-dash" style="border-color:${priorLine.color}"></div>${priorLine.label}</div>`;
    });
    if (m2Line) legendHTML += `<div class="trend-legend-item"><div class="trend-legend-dash" style="border-color:${m2Line.color}"></div>${m2Line.label}</div>`;
    legendWrap.innerHTML = legendHTML;
  }

  // Sync client dropdowns
  _syncClientDropdowns();

  // Update table row highlights in-place (no rebuild)
  const rows = document.querySelectorAll('#trend-movers-wrap tbody tr');
  rows.forEach(row => {
    const onclick = row.getAttribute('onclick') || '';
    const idMatch = onclick.match(/toggleTrendOverlay\('([^']+)'\)/);
    if (!idMatch) return;
    const rid = idMatch[1];
    const on = _trendClientOverlays.includes(rid);
    row.style.background = on ? 'color-mix(in srgb, var(--blue) 8%, transparent)' : '';
    const nameCell = row.querySelector('td:first-child');
    if (nameCell) {
      const badge = nameCell.querySelector('span[style*="ON CHART"]') || nameCell.querySelector('span[style*="font-size:9px"]');
      if (on && !badge) {
        const a = nameCell.querySelector('a');
        if (a) a.insertAdjacentHTML('afterend', ' <span style="font-size:9px;color:var(--blue);font-weight:700">ON CHART</span>');
      } else if (!on && badge) {
        badge.remove();
      }
    }
  });
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
    `<div onclick="addTrendClient('${escHtml(c.id)}')">${escHtml(c.name)} <span style="color:var(--subtle);font-size:var(--fs-sm)">(${c.score})</span></div>`
  ).join('');
  ac.style.display = 'block';
}

// Close autocomplete on outside click
document.addEventListener('click', function(e) {
  for (var s = 0; s < 2; s++) {
    var ac2 = el('trend-client-ac-' + s);
    if (ac2 && !e.target.closest('#trend-client-input-' + s) && !e.target.closest('#trend-client-ac-' + s)) {
      ac2.style.display = 'none';
    }
  }
  const ac = el('trend-client-ac');
  if (ac && !e.target.closest('#trend-client-search') && !e.target.closest('#trend-client-ac')) {
    ac.style.display = 'none';
  }
});

function renderTrends() {
  // Sync churned toggle
  const _churnCb = el('trend-show-churned');
  if (_churnCb) _churnCb.checked = _trendShowChurned;
  _syncChurnedToggle();

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
  // When "Include Churned" is on, revenue/count metrics include churned accounts
  // so churn shows as MRR drops and customer count decreases
  const allWithHistory = _trendShowChurned ? customers.filter(c => passesManagerFilter(c)) : active;

  // ── Aggregate portfolio data by day (supports any metric) ──
  // For avg metrics: forward-fills each customer's last known value so every
  // account contributes to every day, giving a true portfolio average.
  function aggregateByDay(custs, metricKey, rangeStart, rangeEnd) {
    const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
    const isSumMetric = cfg.agg === 'sum';
    const isCountMetric = cfg.agg === 'count';
    const _startDate = rangeStart || cutoff;
    const _endDate = rangeEnd || new Date();
    const _endStr = _endDate.toISOString().slice(0,10);

    // Generate every date from start to end so chart is continuous
    function _allDaysInRange() {
      const dates = [];
      const d = new Date(_startDate);
      while (d.toISOString().slice(0,10) < _endStr) {
        dates.push(d.toISOString().slice(0,10));
        d.setDate(d.getDate() + 1);
      }
      return dates;
    }

    if (isSumMetric || isCountMetric) {
      // Sum/Count metrics: forward-fill each customer's value so all
      // customers that have been scored at least once contribute every day
      const custEntries = [];
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
        }
      });
      const dates = _allDaysInRange();
      return dates.map(date => {
        let total = 0, count = 0;
        custEntries.forEach(ce => {
          let val = null;
          for (let i = ce.sortedDates.length - 1; i >= 0; i--) {
            if (ce.sortedDates[i] <= date) { val = ce.valForDate[ce.sortedDates[i]]; break; }
          }
          if (val !== null) { total += val; count++; }
        });
        return { date, avg: isCountMetric ? count : total, _count: count };
      }).filter(p => p._count > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    // Avg metrics: forward-fill so every customer is represented every day
    const custData = [];
    custs.forEach(c => {
      const dateMap = {};
      (c.history || []).forEach(h => {
        if (!h.date) return;
        const val = cfg.val(h, c);
        if (val == null || typeof val !== 'number' || isNaN(val)) return;
        const key = new Date(h.date).toISOString().slice(0,10);
        dateMap[key] = val;
      });
      const sortedDates = Object.keys(dateMap).sort();
      if (sortedDates.length) {
        custData.push({ dateMap, sortedDates });
      }
    });

    // For each date in full range, forward-fill each customer's last known value
    const dates = _allDaysInRange();
    return dates.map(date => {
      let total = 0, count = 0;
      custData.forEach(cd => {
        let val = null;
        for (let i = cd.sortedDates.length - 1; i >= 0; i--) {
          if (cd.sortedDates[i] <= date) { val = cd.dateMap[cd.sortedDates[i]]; break; }
        }
        if (val !== null) { total += val; count++; }
      });
      return { date, avg: count ? total / count : 0, _count: count };
    }).filter(p => p._count > 0);
  }

  // Use allWithHistory for metrics that need churned customers (MRR, ARR, customer count)
  const m1Pool = m1Cfg.includeChurned ? allWithHistory : active;
  const portfolioData = aggregateByDay(m1Pool, m1);

  // ── Prior-period comparison data ──
  const priorCutoff = new Date(cutoff.getTime() - days * 86400000);
  const priorPortfolioData = aggregateByDay(m1Pool, m1, priorCutoff, cutoff);

  // Change indicator: current end vs prior end
  const _curEnd = portfolioData.length ? portfolioData[portfolioData.length - 1].avg : null;
  const _priorEnd = priorPortfolioData.length ? priorPortfolioData[priorPortfolioData.length - 1].avg : null;
  let _absChange = null, _pctChange = null;
  if (_curEnd !== null && _priorEnd !== null) {
    _absChange = _curEnd - _priorEnd;
    if (Math.abs(_priorEnd) > 0.01) _pctChange = (_absChange / Math.abs(_priorEnd)) * 100;
  }

  // Date range labels
  const _fmtShort = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const _rangeLabel = _fmtShort(cutoff) + ' – ' + _fmtShort(new Date());
  const _rangeName = { '3d':'3 Days','7d':'7 Days','30d':'30 Days','90d':'90 Days','6m':'6 Months','1y':'1 Year','2y':'2 Years','ytd':'YTD' }[range] || range;

  // ── KPIs (range-aware, based on health score) ──
  const currentAvg = active.length ? Math.round(active.reduce((s,c) => s + (c.score||0), 0) / active.length) : 0;

  let improving = 0, declining = 0;
  let deltaSum = 0, deltaCount = 0;
  active.forEach(c => {
    const d = _getDeltaNd(c, days);
    if (d === null) return; // skip accounts without baseline data
    if (d > 0) improving++;
    else if (d < 0) declining++;
    deltaSum += d;
    deltaCount++;
  });
  const avgDelta = deltaCount ? (deltaSum / deltaCount) : null;
  const trendDir = avgDelta === null ? 'N/A' : avgDelta > 0.5 ? 'Improving' : avgDelta < -0.5 ? 'Declining' : 'Stable';
  const trendDirColor = avgDelta === null ? 'dash-kpi-blue' : avgDelta > 0.5 ? 'dash-kpi-green' : avgDelta < -0.5 ? 'dash-kpi-red' : 'dash-kpi-blue';
  const rangeLabel = range === 'ytd' ? 'YTD' : range;

  const _ti = (path) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const tIcons = {
    score: _ti('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    trend: _ti('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
    up:    _ti('<polyline points="18 15 12 9 6 15"/>'),
    down:  _ti('<polyline points="6 9 12 15 18 9"/>'),
  };

  // Dynamic number colors (headers stay static)
  const _tAvgValColor = currentAvg >= 65 ? '#16a34a' : currentAvg >= 50 ? '#d97706' : '#dc2626';
  const _tDirValColor = avgDelta === null ? '' : avgDelta > 0.5 ? '#16a34a' : avgDelta < -0.5 ? '#dc2626' : '';
  const _tImpValColor = improving > 0 ? '#16a34a' : '';
  const _tDecValColor = declining > 0 ? '#dc2626' : '#16a34a';
  const _deltaText = avgDelta === null ? 'N/A - not enough history' : `${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(1)} avg ${rangeLabel} change`;
  const _impPct = deltaCount ? Math.round(improving / deltaCount * 100) : 0;
  const _decPct = deltaCount ? Math.round(declining / deltaCount * 100) : 0;
  const _trendSub = avgDelta === null ? 'not enough history for this range' : `across ${deltaCount} account${deltaCount !== 1 ? 's' : ''} with baseline data`;

  const kpiRow = el('trend-kpi-row');
  if (kpiRow) kpiRow.innerHTML = `
    <div class="dash-kpi-card dash-kpi-blue">
      <div class="dash-kpi-hd"><div class="dash-kpi-icon">${tIcons.score}</div><span class="dash-kpi-label">Portfolio Avg Score <span class="info-tip tip-below" data-tip="Average health score across all active accounts for the selected time range.">\u24d8</span></span></div>
      <div class="dash-kpi-body"><div class="dash-kpi-num" style="color:${_tAvgValColor}">${currentAvg}</div><div class="dash-kpi-sub">${_deltaText}</div></div>
    </div>
    <div class="dash-kpi-card ${trendDirColor}">
      <div class="dash-kpi-hd"><div class="dash-kpi-icon">${tIcons.trend}</div><span class="dash-kpi-label">Trend Direction <span class="info-tip tip-below" data-tip="Overall portfolio health trend - Improving (avg change > +0.5), Declining (< −0.5), or Stable.">\u24d8</span></span></div>
      <div class="dash-kpi-body"><div class="dash-kpi-num" style="font-size:1.5rem${_tDirValColor ? ';color:' + _tDirValColor : ''}">${trendDir}</div><div class="dash-kpi-sub">${_trendSub}</div></div>
    </div>
    <div class="dash-kpi-card dash-kpi-teal">
      <div class="dash-kpi-hd"><div class="dash-kpi-icon">${tIcons.up}</div><span class="dash-kpi-label">Accounts Improving <span class="info-tip tip-below" data-tip="Accounts with a positive health score change over the selected period.">\u24d8</span></span></div>
      <div class="dash-kpi-body"><div class="dash-kpi-num"${_tImpValColor ? ` style="color:${_tImpValColor}"` : ''}>${improving}</div><div class="dash-kpi-sub">${_impPct}% of accounts with data</div></div>
    </div>
    <div class="dash-kpi-card dash-kpi-red">
      <div class="dash-kpi-hd"><div class="dash-kpi-icon">${tIcons.down}</div><span class="dash-kpi-label">Accounts Declining <span class="info-tip tip-below" data-tip="Accounts with a negative health score change over the selected period.">\u24d8</span></span></div>
      <div class="dash-kpi-body"><div class="dash-kpi-num" style="color:${_tDecValColor}">${declining}</div><div class="dash-kpi-sub">${_decPct}% of accounts with data</div></div>
    </div>
  `;

  // ── Build primary metric chart lines ──
  const OVERLAY_COLORS = ['#7c3aed','#ea580c','#0891b2','#db2777','#059669','#2563eb','#d97706','#dc2626','#16a34a','#64748b'];
  const lines = [];
  const m1AggLabel = m1Cfg.agg === 'sum' ? 'Total' : 'Avg';

  // Main portfolio line (primary metric)
  lines.push({ label: 'Portfolio ' + m1AggLabel, color: '#3b82f6', width: 2.5, points: portfolioData });

  // CSM overlay (primary metric)
  if (_trendCsmOverlay) {
    const csmCusts = m1Pool.filter(c => c.manager === _trendCsmOverlay);
    const csmData = aggregateByDay(csmCusts, m1);
    lines.push({ label: escHtml(_trendCsmOverlay), color: OVERLAY_COLORS[0], width: 1.5, points: csmData });
  }

  // Client overlays (primary metric) - forward-fill to keep line continuous
  const _olTodayStr = new Date().toISOString().slice(0,10);
  _trendClientOverlays.forEach((id, idx) => {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    // Build date→value map from history
    const dateMap = {};
    (c.history || []).forEach(h => {
      if (!h.date) return;
      const v = m1Cfg.val(h, c);
      if (v == null || typeof v !== 'number' || isNaN(v)) return;
      const ds = new Date(h.date).toISOString().slice(0,10);
      if (ds >= _olTodayStr) return;
      dateMap[ds] = v;
    });
    const scoredDates = Object.keys(dateMap).sort();
    if (!scoredDates.length) return;
    // Forward-fill across every day in the range
    const allDays = [];
    const d = new Date(cutoff);
    while (d.toISOString().slice(0,10) < _olTodayStr) {
      allDays.push(d.toISOString().slice(0,10));
      d.setDate(d.getDate() + 1);
    }
    let lastVal = null;
    const pts = [];
    allDays.forEach(day => {
      if (dateMap[day] !== undefined) lastVal = dateMap[day];
      // Also check for scores before range to seed initial value
      if (lastVal === null) {
        for (let i = scoredDates.length - 1; i >= 0; i--) {
          if (scoredDates[i] <= day) { lastVal = dateMap[scoredDates[i]]; break; }
        }
      }
      if (lastVal !== null) pts.push({ date: day, avg: lastVal });
    });
    if (pts.length >= 2) {
      const ci = (idx + 1) % OVERLAY_COLORS.length;
      lines.push({ label: escHtml(c.name), color: OVERLAY_COLORS[ci], width: 1.5, points: pts });
    }
  });

  // ── Prior-period comparison line (date-shifted to overlay on current X axis) ──
  let priorLine = null;
  if (priorPortfolioData.length >= 2) {
    const shiftedPrior = priorPortfolioData.map(p => {
      const shifted = new Date(new Date(p.date).getTime() + days * 86400000);
      return { date: shifted.toISOString().slice(0, 10), avg: p.avg };
    });
    priorLine = { label: 'Prior ' + _rangeName, color: '#94a3b8', width: 1.5, points: shiftedPrior, dashed: true };
  }

  // ── Secondary metric line ──
  let m2Line = null;
  if (m2Cfg) {
    const m2Pool = m2Cfg.includeChurned ? allWithHistory : active;
    const m2Data = aggregateByDay(m2Pool, m2);
    const m2AggLabel = m2Cfg.agg === 'sum' ? 'Total' : 'Avg';
    if (m2Data.length) {
      m2Line = { label: m2Cfg.label + ' (' + m2AggLabel + ')', color: '#f59e0b', width: 2, points: m2Data };
    }
  }

  // Render chart
  const chartWrap = el('trend-chart-wrap');
  if (chartWrap) {
    chartWrap.innerHTML = buildTrendChart(lines, days, m1, m2Line, m2, priorLine);
  }

  // ── Populate chart header ──
  const _chartTitleEl = el('trend-chart-title');
  const _chartRangeEl = el('trend-chart-range');
  const _chartChangeEl = el('trend-chart-change');
  if (_chartTitleEl) {
    let t = m1Cfg.label;
    if (m2Cfg) t += ' vs ' + m2Cfg.label;
    _chartTitleEl.textContent = t + ' Trend';
  }
  if (_chartRangeEl) _chartRangeEl.textContent = _rangeLabel;
  if (_chartChangeEl) {
    if (_absChange !== null) {
      const isUp = _absChange >= 0;
      const arrow = isUp ? '▲' : '▼';
      const isGood = m1Cfg.lowerIsBetter ? !isUp : isUp;
      const color = isGood ? '#16a34a' : '#dc2626';
      const sign = isUp ? '+' : '';
      const pctStr = _pctChange !== null ? ' (' + sign + _pctChange.toFixed(1) + '%)' : '';
      _chartChangeEl.innerHTML = '<span style="color:' + color + ';font-weight:700;font-size:.85rem;display:flex;align-items:center;gap:4px">' +
        arrow + ' ' + sign + m1Cfg.fmt(Math.abs(_absChange)) + pctStr +
        '<span style="font-weight:500;font-size:.7rem;color:var(--muted);margin-left:4px">vs prior ' + _rangeName.toLowerCase() + '</span></span>';
    } else {
      _chartChangeEl.innerHTML = '';
    }
  }

  // Render legend - prior period immediately after portfolio avg
  const legendWrap = el('trend-legend');
  if (legendWrap) {
    let legendHTML = '';
    lines.forEach((l, i) => {
      legendHTML += `<div class="trend-legend-item"><div class="trend-legend-dot" style="background:${l.color}"></div>${l.label}</div>`;
      if (i === 0 && priorLine) {
        legendHTML += `<div class="trend-legend-item"><div class="trend-legend-dash" style="border-color:${priorLine.color}"></div>${priorLine.label}</div>`;
      }
    });
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

  // ── Populate client dropdowns ──
  _populateClientDropdowns();

  // ── Sync metric dropdowns ──
  const sel1 = el('trend-metric-1');
  if (sel1) sel1.value = m1;
  const sel2 = el('trend-metric-2');
  if (sel2) sel2.value = m2;

  // ── Top Movers - build data, then render with current sort ──
  // ── Trend Analysis ──
  _buildTrendAnalysis(active, portfolioData, m2Line ? m2Line.points : null, cutoff, days, m1, m2, priorPortfolioData);

  _trendMovers = active.map(c => {
    const allHist = (c.history || []).filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
    const inRange    = allHist.filter(h => new Date(h.date) >= cutoff);
    const beforeRange = allHist.filter(h => new Date(h.date) < cutoff);
    // Only compute delta when there's real baseline data before the range
    const hasBaseline = beforeRange.length > 0;
    const baseline = hasBaseline ? beforeRange[beforeRange.length - 1].score : null;
    const endScore = inRange.length ? inRange[inRange.length - 1].score : c.score;
    const delta = hasBaseline ? endScore - baseline : null;
    return { name: c.name, score: c.score, delta, absDelta: delta !== null ? Math.abs(delta) : 0, noBaseline: !hasBaseline, status: c.status, mrr: c.mrr || 0, manager: c.manager || ' -', tickets: c.tickets != null ? c.tickets : 0, logins: c.logins, adoption: c.adoption, id: c.id };
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

  // Filter by search
  const filtered = _trendSearch ? _trendMovers.filter(m => m.name.toLowerCase().includes(_trendSearch) || m.manager.toLowerCase().includes(_trendSearch) || m.status.includes(_trendSearch)) : _trendMovers;

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let av, bv;
    switch (_trendSortKey) {
      case 'name':     av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
      case 'score':    av = a.score; bv = b.score; break;
      case 'delta':    av = a.delta !== null ? a.delta : -9999; bv = b.delta !== null ? b.delta : -9999; break;
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
    wrap.style.maxHeight = 'none';
    wrap.style.overflowY = 'visible';
    const noMsg = _trendSearch
      ? `No customers matching "${escHtml(_trendSearch)}".`
      : 'No score history available for this period.';
    wrap.innerHTML = `<div style="margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><input type="text" placeholder="Search customers..." value="${escHtml(_trendSearch)}" oninput="_trendSearch=this.value.toLowerCase();renderTrendMovers()" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:var(--fs-base);width:220px"/></div><p style="color:var(--subtle);font-size:var(--fs-md);padding:12px">${noMsg}</p>`;
    return;
  }

  // Apply column filters
  const trendFinal = cfApplyFilters('trend', sorted, _trendVal);

  // Build column headers
  const trCols = TREND_COLS.map(col => cfBuildTh('trend', col, _trendSortKey, _trendSortDir)).join('');

  // Remove scroll from outer wrapper - we put it on the table div only
  wrap.style.maxHeight = 'none';
  wrap.style.overflowY = 'visible';

  wrap.innerHTML = `<div style="margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><input type="text" placeholder="Search customers..." value="${escHtml(_trendSearch)}" oninput="_trendSearch=this.value.toLowerCase();renderTrendMovers()" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:var(--fs-base);width:220px"/><span style="font-size:var(--fs-sm);color:var(--muted)">${trendFinal.length} customer${trendFinal.length!==1?'s':''}</span></div>
    ${cfRenderPills('trend')}
    <div style="max-height:480px;overflow-y:auto;overflow-x:auto">
    <table class="ct" style="min-width:900px">
    <thead><tr>${trCols}</tr></thead>
    <tbody>${trendFinal.map(m => {
      const dColor = m.delta === null ? 'var(--muted)' : m.delta > 0 ? '#16a34a' : m.delta < 0 ? '#dc2626' : 'var(--subtle)';
      const dText = m.delta === null ? 'N/A' : (m.delta > 0 ? '+' : '') + m.delta;
      const _onChart = _trendClientOverlays.includes(m.id);
      return `<tr style="cursor:pointer${_onChart ? ';background:color-mix(in srgb, var(--blue) 8%, transparent)' : ''}" onclick="toggleTrendOverlay('${escHtml(m.id)}')">
        <td class="col-pin" style="font-weight:600;color:var(--text)"><a href="#" onclick="event.stopPropagation();openDetail('${escHtml(m.id)}');return false" style="color:inherit;text-decoration:none;border-bottom:1px dashed var(--border)">${escHtml(m.name)}</a>${_onChart ? ' <span style="font-size:9px;color:var(--blue);font-weight:700">ON CHART</span>' : ''}</td>
        <td>${m.score}</td>
        <td style="color:${dColor};font-weight:700">${dText}</td>
        <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColors[m.status]||'#888'};margin-right:4px"></span>${m.status}</td>
        <td>$${fmtNum(m.mrr)}</td>
        <td style="color:${m.logins != null && m.logins < 5 ? '#d97706' : 'var(--subtle)'};font-weight:${m.logins != null && m.logins < 5 ? '700' : '400'}">${m.logins != null ? m.logins + '/mo' : 'N/A'}</td>
        <td style="color:${m.adoption != null && m.adoption < 30 ? '#d97706' : 'var(--subtle)'};font-weight:${m.adoption != null && m.adoption < 30 ? '700' : '400'}">${m.adoption != null ? m.adoption + '%' : 'N/A'}</td>
        <td style="color:${m.tickets > 0 ? '#dc2626' : 'var(--subtle)'};font-weight:${m.tickets > 0 ? '700' : '400'}">${m.tickets}</td>
        <td style="color:var(--subtle)">${escHtml(m.manager)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
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
  // Don't go negative for metrics that can't be negative
  if (dMin < 0) dMin = 0;
  if (dMin === dMax) dMax += step;
  return { min: dMin, max: dMax, step };
}

function buildTrendChart(lines, rangeDays, m1Key, m2Line, m2Key, priorLine) {
  if (!lines.length || !lines[0].points.length) {
    return '<p style="color:var(--subtle);text-align:center;padding:40px 0;font-size:var(--fs-md)">Not enough history to display a trend chart. Score a few customers to get started.</p>';
  }

  const m1Cfg = METRIC_CFG[m1Key] || METRIC_CFG.score;
  const m2Cfg = m2Key ? (METRIC_CFG[m2Key] || null) : null;
  const hasM2 = !!(m2Line && m2Line.points.length);
  const hasPrior = !!(priorLine && priorLine.points.length >= 2);

  const W = 960, H = 210;
  const pad = { top: 12, right: hasM2 ? 66 : 48, bottom: 28, left: 44 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  // Collect all dates across all lines + secondary + prior
  const allDates = new Set();
  lines.forEach(l => l.points.forEach(p => allDates.add(p.date)));
  if (hasM2) m2Line.points.forEach(p => allDates.add(p.date));
  if (hasPrior) priorLine.points.forEach(p => allDates.add(p.date));
  const dates = [...allDates].sort();
  if (!dates.length) {
    return '<p style="color:var(--subtle);text-align:center;padding:40px 0;font-size:var(--fs-md)">No data points in this range.</p>';
  }

  const xScale = (i) => pad.left + (dates.length === 1 ? cW/2 : (i / (dates.length - 1)) * cW);

  // ── Y-axis scales ──
  const yL = _trendNiceScale(hasPrior ? [...lines, priorLine] : lines, m1Cfg.fixed);
  const yR = hasM2 ? _trendNiceScale([m2Line], m2Cfg.fixed) : null;
  const yScaleL = (v) => pad.top + cH - ((v - yL.min) / (yL.max - yL.min || 1)) * cH;
  const yScaleR = yR ? (v) => pad.top + cH - ((v - yR.min) / (yR.max - yR.min || 1)) * cH : null;

  // ── Chart font ──
  const _chartFont = "'DM Mono',monospace";

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
      return `<rect x="${pad.left}" y="${y}" width="${cW}" height="${h}" fill="${b.color}" opacity="0.04"/>`;
    }).join('');
    // Band labels on right edge only when no secondary axis
    if (!hasM2) {
      bandSVG += bandDefs.map(b => {
        const midY = (yFn(b.y1) + yFn(b.y0)) / 2;
        return `<text x="${W - pad.right + 6}" y="${midY + 3}" font-size="8" font-family="${_chartFont}" fill="${b.color}" opacity="0.5" font-weight="600">${b.label}</text>`;
      }).join('');
    }
  }

  // ── Left Y-axis grid lines + labels ──
  let gridSVG = '';
  if (m1Key === 'score' && m1Cfg.fixed) {
    // Health score 0-100: faint guide lines at 25, 50, 75 + edge labels
    [0, 25, 50, 75, 100].forEach(v => {
      if (v < yL.min || v > yL.max) return;
      const y = yScaleL(v);
      const isEdge = v === yL.min || v === yL.max;
      if (!isEdge) {
        gridSVG += `<line x1="${pad.left}" y1="${y}" x2="${W-pad.right}" y2="${y}" stroke="#cbd5e1" stroke-width="0.5" opacity="0.45"/>`;
      }
      gridSVG += `<text x="${pad.left-8}" y="${y+3}" text-anchor="end" font-size="8" font-weight="500" font-family="${_chartFont}" fill="#94a3b8">${m1Cfg.axFmt(v)}</text>`;
    });
  } else {
    // All other metrics: 4 evenly spaced guide lines
    const gRange = yL.max - yL.min;
    const gStep = gRange / 4;
    // Smart precision: show decimals when range is small
    const _axDec = gStep < 1 ? 1 : 0;
    for (let i = 0; i <= 4; i++) {
      const v = yL.min + i * gStep;
      const y = yScaleL(v);
      const isEdge = i === 0 || i === 4;
      if (!isEdge) {
        gridSVG += `<line x1="${pad.left}" y1="${y}" x2="${W-pad.right}" y2="${y}" stroke="#cbd5e1" stroke-width="0.5" opacity="0.45"/>`;
      }
      const vLabel = _axDec ? v.toFixed(_axDec) : String(Math.round(v));
      gridSVG += `<text x="${pad.left-8}" y="${y+3}" text-anchor="end" font-size="8" font-weight="500" font-family="${_chartFont}" fill="#94a3b8">${m1Cfg.axFmt(parseFloat(vLabel))}</text>`;
    }
  }

  // ── Right Y-axis labels (secondary metric) ──
  let rightAxisSVG = '';
  if (hasM2 && yR && m2Cfg) {
    const step = yR.step;
    for (let v = yR.min; v <= yR.max + step * 0.01; v += step) {
      const y = yScaleR(v);
      rightAxisSVG += `<text x="${W-pad.right+8}" y="${y+3}" font-size="8.5" font-family="${_chartFont}" fill="${m2Line.color}" opacity="0.75" font-weight="500">${m2Cfg.axFmt(v)}</text>`;
    }
    // Right axis line
    rightAxisSVG += `<line x1="${W-pad.right}" y1="${pad.top}" x2="${W-pad.right}" y2="${yScaleL(yL.min)}" stroke="${m2Line.color}" stroke-width="1" opacity="0.25"/>`;
  }

  // ── X-axis date labels ──
  let xLabels = '';
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // Smart x-axis: show fewer labels on longer timeframes, include year for 1y+
  const _xLabelEvery = rangeDays <= 7 ? 1 : rangeDays <= 30 ? Math.ceil(dates.length / 12) : rangeDays <= 90 ? Math.ceil(dates.length / 10) : rangeDays <= 180 ? Math.ceil(dates.length / 8) : Math.ceil(dates.length / 7);
  const _showYear = rangeDays > 180;
  dates.forEach((d, i) => {
    const x = xScale(i);
    const parts = d.split('-');
    const yr = parts[0].slice(2);
    const mo = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    // Subtle tick marks
    if (i % Math.max(1, Math.ceil(_xLabelEvery / 2)) === 0) {
      xLabels += `<line x1="${x}" y1="${yScaleL(yL.min)}" x2="${x}" y2="${yScaleL(yL.min)+3}" stroke="#e2e8f0" stroke-width="0.5" opacity="0.4"/>`;
    }
    // Labels - smarter formatting
    if (i % _xLabelEvery === 0 || i === dates.length - 1) {
      let lbl;
      if (_showYear && day <= 7) {
        lbl = monthNames[mo] + " '" + yr;
      } else if (rangeDays > 90) {
        lbl = monthNames[mo] + ' ' + day;
      } else {
        lbl = monthNames[mo] + ' ' + day;
      }
      xLabels += `<text x="${x}" y="${H - pad.bottom + 16}" text-anchor="middle" font-size="8" font-family="${_chartFont}" fill="#94a3b8">${lbl}</text>`;
    }
  });

  // ── Draw primary metric lines (area fills + lines + dots) ──
  let linesSVG = '';
  const dateIdx = {};
  dates.forEach((d,i) => { dateIdx[d] = i; });

  // Max rendered points - downsample for smoother lines on long ranges
  const _maxRPts = rangeDays > 365 ? 90 : rangeDays > 180 ? 120 : 9999;

  const _hasBreakdown = lines.some(l => l.dashed);
  lines.forEach((line, lineIdx) => {
    const pts = line.points.filter(p => dateIdx[p.date] !== undefined && !isNaN(p.avg))
      .sort((a,b) => a.date.localeCompare(b.date));
    if (pts.length < 2) return;

    // Area fill under the main line (first line only, skip in breakdown mode)
    const xyPtsRaw = pts.map(p => ({ x: xScale(dateIdx[p.date]), y: yScaleL(p.avg) }));
    const xyPts = _downsampleXY(xyPtsRaw, _maxRPts);
    if (lineIdx === 0 && !_hasBreakdown) {
      const areaBottom = yScaleL(yL.min);
      const firstX = xyPts[0].x;
      const lastX = xyPts[xyPts.length-1].x;
      const smoothTop = _smoothPath(xyPts);
      const cIdx = smoothTop.indexOf('C');
      const topCurve = cIdx >= 0 ? smoothTop.slice(cIdx) : `L${lastX},${xyPts[xyPts.length-1].y}`;
      const areaPath = `M${firstX},${areaBottom} L${firstX},${xyPts[0].y} ${topCurve} L${lastX},${areaBottom} Z`;
      linesSVG += `<defs><linearGradient id="trendAreaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${line.color}" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="${line.color}" stop-opacity="0.02"/>
      </linearGradient></defs>`;
      linesSVG += `<path d="${areaPath}" fill="url(#trendAreaGrad)"/>`;
    }

    // Smooth line
    const smoothD = _smoothPath(xyPts);
    const dashAttr = line.dashed ? ' stroke-dasharray="6,4"' : '';
    const lineOp = line.dashed ? '0.45' : '0.9';
    linesSVG += `<path d="${smoothD}" fill="none" stroke="${line.color}" stroke-width="${line.width}" stroke-linecap="round" opacity="${lineOp}"${dashAttr}/>`;

    // No inline labels - hover tooltip shows exact values for all lines
  });

  // ── Draw prior-period comparison line (dashed, muted gray) ──
  if (hasPrior) {
    const pPts = priorLine.points
      .filter(p => dateIdx[p.date] !== undefined && !isNaN(p.avg))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (pPts.length >= 2) {
      const pXYraw = pPts.map(p => ({ x: xScale(dateIdx[p.date]), y: yScaleL(p.avg) }));
      const pXY = _downsampleXY(pXYraw, _maxRPts);
      const pSmooth = _smoothPath(pXY);
      linesSVG += `<path d="${pSmooth}" fill="none" stroke="${priorLine.color}" stroke-width="${priorLine.width}" stroke-linecap="round" opacity="0.5" stroke-dasharray="6,4"/>`;
    }
  }

  // ── Draw secondary metric line (dashed, right Y-axis) ──
  if (hasM2 && yScaleR) {
    const pts = m2Line.points.filter(p => dateIdx[p.date] !== undefined && !isNaN(p.avg))
      .sort((a,b) => a.date.localeCompare(b.date));
    if (pts.length >= 2) {
      // Subtle area fill (smooth)
      const xyPts2raw = pts.map(p => ({ x: xScale(dateIdx[p.date]), y: yScaleR(p.avg) }));
      const xyPts2 = _downsampleXY(xyPts2raw, _maxRPts);
      const areaBottom = yScaleR(yR.min);
      const firstX = xyPts2[0].x;
      const lastX = xyPts2[xyPts2.length-1].x;
      const smoothTop2 = _smoothPath(xyPts2);
      const cIdx2 = smoothTop2.indexOf('C');
      const topCurve2 = cIdx2 >= 0 ? smoothTop2.slice(cIdx2) : `L${lastX},${xyPts2[xyPts2.length-1].y}`;
      const areaPath = `M${firstX},${areaBottom} L${firstX},${xyPts2[0].y} ${topCurve2} L${lastX},${areaBottom} Z`;
      linesSVG += `<defs><linearGradient id="trendArea2Grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${m2Line.color}" stop-opacity="0.10"/>
        <stop offset="100%" stop-color="${m2Line.color}" stop-opacity="0.01"/>
      </linearGradient></defs>`;
      linesSVG += `<path d="${areaPath}" fill="url(#trendArea2Grad)"/>`;

      // Smooth dashed line
      const smoothD2 = _smoothPath(xyPts2);
      linesSVG += `<path d="${smoothD2}" fill="none" stroke="${m2Line.color}" stroke-width="${m2Line.width}" stroke-linecap="round" opacity="0.85" stroke-dasharray="6,3"/>`;

    }
  }

  // ── Build tooltip data (Map-based for reliable lookups) ──
  // Pre-build date→value maps for each line (fast O(1) lookup)
  // Also track last-known value so hovering between sparse points still works
  const _lineMaps = lines.map(l => {
    const m = new Map();
    l.points.forEach(p => m.set(p.date, p.avg));
    return m;
  });
  const _m2Map = hasM2 ? (() => { const m = new Map(); m2Line.points.forEach(p => m.set(p.date, p.avg)); return m; })() : null;

  // Build carry-forward lookup: for each line, at each date index, store last known value
  const _lineCarry = _lineMaps.map(lm => {
    let last = null;
    return dates.map(d => {
      if (lm.has(d)) last = lm.get(d);
      return last;
    });
  });
  let _m2Carry = null;
  if (_m2Map) {
    let last = null;
    _m2Carry = dates.map(d => {
      if (_m2Map.has(d)) last = _m2Map.get(d);
      return last;
    });
  }

  // Prior-period carry-forward for tooltip
  let _priorCarry = null;
  if (hasPrior) {
    const priorMap = new Map();
    priorLine.points.forEach(p => priorMap.set(p.date, p.avg));
    let last = null;
    _priorCarry = dates.map(d => {
      if (priorMap.has(d)) last = priorMap.get(d);
      return last;
    });
  }

  _trendTipData = dates.map((d, di) => {
    const parts = d.split('-');
    const mo = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    const dateLabel = monthNames[mo] + ' ' + day;

    const primaryVals = lines.map((l, li) => {
      const val = _lineCarry[li][di];
      return val !== null ? { label: l.label, color: l.color, val: m1Cfg.fmt(val) } : null;
    }).filter(Boolean);

    let secondaryVal = null;
    if (hasM2 && m2Cfg && _m2Carry) {
      const val = _m2Carry[di];
      if (val !== null) secondaryVal = { label: m2Line.label, color: m2Line.color, val: m2Cfg.fmt(val) };
    }

    let priorVal = null;
    if (_priorCarry) {
      const val = _priorCarry[di];
      if (val !== null) priorVal = { label: priorLine.label, color: priorLine.color, val: m1Cfg.fmt(val) };
    }

    return { dateLabel, primaryVals, secondaryVal, priorVal };
  });

  // ── Hover columns with crosshair line ──
  let hoverSVG = `<line id="trend-crosshair" x1="0" y1="${pad.top}" x2="0" y2="${yScaleL(yL.min)}" stroke="#94a3b8" stroke-width="0.75" stroke-dasharray="3,3" opacity="0" pointer-events="none"/>`;
  const colW = dates.length > 1 ? cW / (dates.length - 1) : cW;
  dates.forEach((d, i) => {
    const cx = xScale(i);
    hoverSVG += `<rect x="${cx - colW/2}" y="${pad.top}" width="${colW}" height="${cH}" fill="transparent" style="cursor:crosshair"
      onmouseenter="showTrendTip(evt,${cx},${i})"
      onmouseleave="hideTrendTip()"/>`;
  });

  // ── Axis border lines ──
  let axisSVG = `<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${yScaleL(yL.min)}" stroke="#cbd5e1" stroke-width="1" opacity="0.5"/>`;
  axisSVG += `<line x1="${pad.left}" y1="${yScaleL(yL.min)}" x2="${W-pad.right}" y2="${yScaleL(yL.min)}" stroke="#cbd5e1" stroke-width="1" opacity="0.5"/>`;

  const _fadeStyle = _trendFirstRender ? 'opacity:0;animation:trendFadeIn .4s ease forwards' : '';
  _trendFirstRender = false;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;font-family:'DM Mono',ui-monospace,monospace;${_fadeStyle}">
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

  // Move crosshair
  const ch = document.getElementById('trend-crosshair');
  if (ch) { ch.setAttribute('x1', cx); ch.setAttribute('x2', cx); ch.setAttribute('opacity', '0.5'); }

  let rows = '';
  data.primaryVals.forEach(v => {
    rows += `<div style="display:flex;align-items:center;gap:6px;margin-top:3px"><span style="width:8px;height:8px;border-radius:50%;background:${v.color};flex-shrink:0"></span><span>${v.label}</span><strong style="margin-left:auto;font-family:'DM Mono',monospace">${v.val}</strong></div>`;
  });
  if (data.priorVal) {
    rows += `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;border-top:1px solid var(--border);padding-top:4px;opacity:0.65"><span style="width:14px;height:0;border-top:2px dashed ${data.priorVal.color};flex-shrink:0"></span><span>${data.priorVal.label}</span><strong style="margin-left:auto;font-family:'DM Mono',monospace">${data.priorVal.val}</strong></div>`;
  }
  if (data.secondaryVal) {
    rows += `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;border-top:1px solid var(--border);padding-top:4px"><span style="width:14px;height:0;border-top:2.5px dashed ${data.secondaryVal.color};flex-shrink:0"></span><span>${data.secondaryVal.label}</span><strong style="margin-left:auto;font-family:'DM Mono',monospace">${data.secondaryVal.val}</strong></div>`;
  }

  tip.innerHTML = `<div style="font-weight:700;margin-bottom:4px;font-size:var(--fs-base)">${data.dateLabel}</div>${rows}`;
  // Position relative to the chart-wrap container
  const wrap = el('trend-chart-wrap');
  const svg = wrap.querySelector('svg');
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const wRect = wrap.getBoundingClientRect();
  const scaleX = rect.width / 960;
  const left = (cx * scaleX) + (rect.left - wRect.left);
  tip.style.display = 'block';
  // Flip to left side if too close to right edge
  const tipW = tip.offsetWidth || 160;
  if (left + tipW + 20 > wRect.width) {
    tip.style.left = (left - tipW - 14) + 'px';
  } else {
    tip.style.left = (left + 14) + 'px';
  }
  tip.style.top = '8px';
}

function hideTrendTip() {
  const tip = document.getElementById('trend-tip');
  if (tip) tip.style.display = 'none';
  const ch = document.getElementById('trend-crosshair');
  if (ch) ch.setAttribute('opacity', '0');
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
  drop:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>',
  rise:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  dollar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  warn:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
};

// Clickable customer name link for analysis insights
function _taCustLink(name, id) {
  const safeId = (id || '').replace(/'/g, "\\'");
  return `<a href="#" onclick="event.preventDefault();openDetail('${safeId}')" style="color:var(--blue);font-weight:700;text-decoration:none;border-bottom:1px dashed var(--blue)">${escHtml(name)}</a>`;
}

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

/* 2. Metric Correlation (dual metric) */
// Inverted metrics: lower value = better outcome
const _invertedMetrics = new Set(['days', 'tickets']);

// Pearson correlation coefficient between two arrays
function _pearsonR(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return 0;
  const mx = xs.slice(0, n).reduce((s,v) => s+v, 0) / n;
  const my = ys.slice(0, n).reduce((s,v) => s+v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom > 0 ? num / denom : 0;
}

function _taMetricCorrelation(data1, data2, m1, m2, rangeDays) {
  if (!data2 || !data2.length || data1.length < 5) return null;
  const l1 = (METRIC_CFG[m1] || {}).label || m1;
  const l2 = (METRIC_CFG[m2] || {}).label || m2;
  const f1 = v => (v >= 0 ? '+' : '') + _fmtTaVal(v, m1);
  const f2 = v => (v >= 0 ? '+' : '') + _fmtTaVal(v, m2);
  const rl = _taRangeLabel(rangeDays);

  // Align data series by date
  const d1Map = {};
  data1.forEach(d => { d1Map[d.date] = d.avg; });
  const aligned1 = [], aligned2 = [];
  data2.forEach(d => {
    if (d1Map[d.date] != null) {
      aligned1.push(d1Map[d.date]);
      aligned2.push(d.avg);
    }
  });
  if (aligned1.length < 5) return null;

  // Flip inverted metrics so positive correlation = both improving together
  const s1 = _invertedMetrics.has(m1) ? aligned1.map(v => -v) : aligned1;
  const s2 = _invertedMetrics.has(m2) ? aligned2.map(v => -v) : aligned2;

  // Compute Pearson r on the full series
  const r = _pearsonR(s1, s2);
  const rPct = Math.abs(Math.round(r * 100));

  // Check for lagged correlation (does m2 follow m1 with a delay?)
  let bestLag = 0, bestLagR = Math.abs(r);
  const maxLag = Math.min(14, Math.floor(aligned1.length * 0.2));
  for (let lag = 1; lag <= maxLag; lag++) {
    const lagged1 = s1.slice(0, s1.length - lag);
    const lagged2 = s2.slice(lag);
    if (lagged1.length < 5) break;
    const lr = Math.abs(_pearsonR(lagged1, lagged2));
    if (lr > bestLagR + 0.1) { bestLagR = lr; bestLag = lag; }
  }

  // Check first-half vs second-half correlation for seasonal co-movement
  const mid = Math.floor(aligned1.length / 2);
  const rFirst = aligned1.length >= 10 ? _pearsonR(s1.slice(0, mid), s2.slice(0, mid)) : r;
  const rSecond = aligned1.length >= 10 ? _pearsonR(s1.slice(mid), s2.slice(mid)) : r;
  const corrShifted = Math.abs(rFirst - rSecond) > 0.4;

  // Overall changes for context
  const rawD1 = data1[data1.length - 1].avg - data1[0].avg;
  const rawD2 = data2[data2.length - 1].avg - data2[0].avg;

  let title, detail, accent;

  if (Math.abs(r) < 0.4 && bestLagR < 0.5) {
    // No meaningful correlation at any lag
    if (corrShifted) {
      // Correlation changed over time
      const rFirstPct = Math.abs(Math.round(rFirst * 100));
      const rSecondPct = Math.abs(Math.round(rSecond * 100));
      title = l1 + ' and ' + l2 + ' correlation shifted over time';
      detail = `In the first half of this period, ${l1} and ${l2} had a <strong>${rFirstPct}%</strong> ${rFirst > 0 ? 'positive' : 'inverse'} correlation. In the recent half, it shifted to <strong>${rSecondPct}%</strong> ${rSecond > 0 ? 'positive' : 'inverse'}. `;
      detail += `Something changed in how these metrics relate - worth investigating what happened around the midpoint.`;
      accent = 'amber';
    } else {
      title = 'No correlation between ' + l1 + ' and ' + l2;
      detail = `Over ${rl}, ${l1} (${f1(rawD1)}) and ${l2} (${f2(rawD2)}) moved independently - only <strong>${rPct}% correlation</strong>. `;
      detail += `These metrics are driven by different factors in your portfolio. Changes in one won't reliably predict changes in the other.`;
      accent = 'amber';
    }
  } else if (bestLag > 0 && bestLagR > 0.5 && bestLagR > Math.abs(r) + 0.1) {
    // Lagged correlation is stronger than direct
    const lagDays = Math.round(bestLag * rangeDays / aligned1.length);
    const lagRPct = Math.round(bestLagR * 100);
    title = l2 + ' follows ' + l1 + ' with a ~' + lagDays + ' day lag';
    detail = `Direct correlation is <strong>${rPct}%</strong>, but when ${l2} is shifted ${lagDays} days forward, correlation jumps to <strong>${lagRPct}%</strong>. `;
    detail += `This means changes in ${l1} show up in ${l2} about ${lagDays} days later. ${l1} (${f1(rawD1)}) is a leading indicator for ${l2} (${f2(rawD2)}) in your portfolio.`;
    accent = r > 0 ? 'green' : 'amber';
  } else if (r > 0.7) {
    // Strong positive correlation
    title = l1 + ' and ' + l2 + ' are strongly correlated (' + rPct + '%)';
    detail = `Over ${rl}, ${l1} (${f1(rawD1)}) and ${l2} (${f2(rawD2)}) moved together with <strong>${rPct}% correlation</strong>. `;
    const bothUp = rawD1 > 0 && rawD2 > 0;
    const bothDown = rawD1 < 0 && rawD2 < 0;
    if (bothUp) {
      detail += `Both improving together - these signals are reinforcing each other. Keep doing what's working.`;
      accent = 'green';
    } else if (bothDown) {
      detail += `Both declining together - this suggests a shared root cause. Fixing one may lift the other.`;
      accent = 'red';
    } else {
      detail += `They track closely - improvements in one tend to come with improvements in the other.`;
      accent = 'green';
    }
  } else if (r < -0.7) {
    // Strong inverse correlation
    title = l1 + ' and ' + l2 + ' move in opposite directions (' + rPct + '% inverse)';
    detail = `Over ${rl}, ${l1} (${f1(rawD1)}) and ${l2} (${f2(rawD2)}) have a <strong>${rPct}% inverse correlation</strong>. `;
    detail += `When ${l1} goes up, ${l2} tends to go down. This trade-off may indicate a resource constraint or competing priorities in your accounts.`;
    accent = 'amber';
  } else {
    // Moderate or weak correlation - not interesting enough to show
    return null;
  }
  return { priority: 1, icon: _taSvg.corr, iconBg: accent === 'green' ? 'var(--green-l)' : accent === 'red' ? 'var(--red-l)' : 'var(--amber-l)', iconColor: accent === 'green' ? 'var(--green)' : accent === 'red' ? 'var(--red)' : 'var(--amber)', accent, title, detail, cat: 'dualmetric' };
}

/* 3. Inflection Point - enhanced with customer attribution */
function _taInflection(data, metricKey, rangeDays, active) {
  if (data.length < 10 || !active || active.length < 3) return null;
  const win = Math.max(3, Math.min(15, Math.round(data.length * 0.1)));
  let maxSwing = 0, bestIdx = -1, bestBefore = 0, bestAfter = 0;
  for (let i = win; i < data.length - win; i++) {
    const beforeSlope = (data[i].avg - data[i - win].avg) / win;
    const afterSlope = (data[i + win].avg - data[i].avg) / win;
    if ((beforeSlope > 0 && afterSlope < 0) || (beforeSlope < 0 && afterSlope > 0)) {
      const swing = Math.abs(afterSlope - beforeSlope) * win;
      if (swing > maxSwing) { maxSwing = swing; bestIdx = i; bestBefore = beforeSlope; bestAfter = afterSlope; }
    }
  }
  const isCurrency = metricKey === 'mrr' || metricKey === 'arr';
  const vals = data.map(d => d.avg);
  const dataRange = Math.max(...vals) - Math.min(...vals);
  const threshold = isCurrency ? Math.max(200, dataRange * 0.15) : Math.max(3, dataRange * 0.15);
  if (bestIdx < 0 || maxSwing < threshold) return null;

  const remaining = data.length - 1 - bestIdx;
  if (remaining >= win) {
    const endSlope = (data[data.length - 1].avg - data[bestIdx].avg) / remaining;
    if ((bestBefore > 0 && endSlope > 0) || (bestBefore < 0 && endSlope < 0)) return null;
  }

  const inflPt = data[bestIdx];
  const inflDate = new Date(inflPt.date);
  const dateStr = inflDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const label = (METRIC_CFG[metricKey] || {}).label || metricKey;
  const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
  const wasRising = bestBefore > 0;

  // Find which customers drove the reversal - biggest movers around the inflection
  const inflT = inflDate.getTime();
  const windowMs = win * 86400000 * (rangeDays / data.length);
  const custMovers = [];
  active.forEach(c => {
    const hist = (c.history || []).filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
    if (hist.length < 2) return;
    const findNearest = (tgt) => hist.reduce((best, h) =>
      Math.abs(new Date(h.date).getTime() - tgt) < Math.abs(new Date(best.date).getTime() - tgt) ? h : best
    );
    const before = findNearest(inflT - windowMs);
    const after = findNearest(inflT + windowMs);
    if (before === after) return;
    const sv = cfg.val ? cfg.val(before, c) : before.score;
    const ev = cfg.val ? cfg.val(after, c) : after.score;
    if (sv != null && ev != null) custMovers.push({ name: c.name, id: c.id, delta: ev - sv, mrr: c.mrr || 0 });
  });

  // Sort by absolute delta to find biggest movers
  custMovers.sort((a,b) => Math.abs(b.delta) - Math.abs(a.delta));
  const topMovers = custMovers.filter(m => wasRising ? m.delta < -1 : m.delta > 1).slice(0, 3);
  const fd = v => (v >= 0 ? '+' : '') + Math.round(v);

  const title = (wasRising ? 'Decline' : 'Recovery') + ' started around ' + dateStr;
  let detail = `<strong>${label}</strong> shifted from ${wasRising ? 'climbing' : 'declining'} to ${wasRising ? 'declining' : 'climbing'} around <strong>${dateStr}</strong>.`;
  if (topMovers.length) {
    const word = wasRising ? 'Biggest drops' : 'Biggest gains';
    detail += ` ${word}: ` + topMovers.map(m => `${_taCustLink(m.name, m.id)} (${fd(m.delta)})`).join(', ') + '.';
  }

  const accent = wasRising ? 'red' : 'green';
  return { priority: 2, icon: _taSvg.zap, iconBg: accent === 'green' ? 'var(--green-l)' : 'var(--red-l)', iconColor: accent === 'green' ? 'var(--green)' : 'var(--red)', accent, title, detail, cat: 'inflection' };
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

  // Rest-of-portfolio delta - same methodology, excluding CSM's own accounts
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
  return { priority: 1, icon: _taSvg.users, iconBg: outperformed ? 'var(--green-l)' : 'var(--red-l)', iconColor: outperformed ? 'var(--green)' : 'var(--red)', accent, title, detail, cat: 'csm' };
}

/* 7. Cross-Metric Signal */
function _taCrossSignal(active, cutoff, metricKey) {
  if (active.length < 6) return null;
  const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
  const label = cfg.label || metricKey;
  const isScore = !metricKey || metricKey === 'score';
  const rangeDays = Math.round((Date.now() - cutoff.getTime()) / 86400000);

  // All possible signals we can compare
  const allSignals = [
    { key: 'logins', label: 'Logins' },
    { key: 'adoption', label: 'Adoption' },
    { key: 'tickets', label: 'Tickets' },
    { key: 'nps', label: 'NPS' },
    { key: 'csat', label: 'CSAT' },
    { key: 'days', label: 'Days Since Contact' }
  ];

  // Determine improving/declining based on the SELECTED metric, not always score
  const acctData = [];
  active.forEach(c => {
    if (c.lifecycle === 'churned') return;
    let metricDelta;
    if (isScore) {
      metricDelta = _getDeltaNd(c, rangeDays);
    } else {
      const sh = _sigHist(c, metricKey, cutoff);
      metricDelta = sh.delta;
      // For inverted metrics (tickets, days), flip so positive = improving
      if (metricDelta != null && _invertedMetrics.has(metricKey)) metricDelta = -metricDelta;
    }
    if (metricDelta === null || metricDelta === undefined) return;
    // Compute other signal deltas (exclude the primary metric itself)
    const sigDeltas = {};
    allSignals.filter(s => s.key !== metricKey).forEach(sig => {
      const sh = _sigHist(c, sig.key, cutoff);
      if (sh.delta != null) sigDeltas[sig.key] = sh.delta;
    });
    acctData.push({ c, metricDelta, sigDeltas });
  });
  if (acctData.length < 6) return null;

  // Split into improving/declining on the selected metric
  const threshold = isScore ? 2 : 0.5;
  const improving = acctData.filter(a => a.metricDelta > threshold);
  const declining = acctData.filter(a => a.metricDelta < -threshold);
  if (improving.length < 2 || declining.length < 2) return null;

  // Find which OTHER signal differs most between the two groups
  const compareSignals = allSignals.filter(s => s.key !== metricKey);
  let bestSig = null, bestDiff = 0;
  compareSignals.forEach(sig => {
    const impDeltas = improving.map(a => a.sigDeltas[sig.key]).filter(v => v != null);
    const decDeltas = declining.map(a => a.sigDeltas[sig.key]).filter(v => v != null);
    if (impDeltas.length < 2 || decDeltas.length < 2) return;
    const impAvg = impDeltas.reduce((s,v) => s+v, 0) / impDeltas.length;
    const decAvg = decDeltas.reduce((s,v) => s+v, 0) / decDeltas.length;
    const diff = Math.abs(impAvg - decAvg);
    const allVals = [...impDeltas, ...decDeltas];
    const mean = allVals.reduce((s,v) => s+v, 0) / allVals.length;
    const stddev = Math.sqrt(allVals.reduce((s,v) => s + (v - mean) ** 2, 0) / allVals.length) || 1;
    const normalized = diff / stddev;
    if (normalized > bestDiff) {
      bestDiff = normalized;
      bestSig = { ...sig, impAvgDelta: impAvg, decAvgDelta: decAvg };
    }
  });
  if (!bestSig || bestDiff < 0.5) return null;

  const fv = v => (v >= 0 ? '+' : '') + (Math.round(v * 10) / 10);

  // Find top 2 declining accounts with sharpest signal shift
  const inverted = _invertedMetrics.has(bestSig.key);
  const worstAccts = declining
    .filter(a => a.sigDeltas[bestSig.key] != null)
    .sort((a,b) => inverted ? b.sigDeltas[bestSig.key] - a.sigDeltas[bestSig.key] : a.sigDeltas[bestSig.key] - b.sigDeltas[bestSig.key])
    .slice(0, 2);

  const title = `Accounts with ${isScore ? 'declining scores' : 'falling ' + label} also saw sharper ${bestSig.label} changes`;
  let detail = `Among ${improving.length} accounts where ${label} improved, ${bestSig.label} averaged <strong>${fv(bestSig.impAvgDelta)}</strong>. `;
  detail += `Among ${declining.length} where ${label} declined, ${bestSig.label} averaged <strong>${fv(bestSig.decAvgDelta)}</strong>. `;
  if (worstAccts.length) {
    detail += worstAccts.map(a => `${_taCustLink(a.c.name, a.c.id)} (${bestSig.label} ${fv(a.sigDeltas[bestSig.key])})`).join(' and ');
    detail += ` had the biggest ${bestSig.label} shifts. Address ${bestSig.label} to improve ${label}.`;
  }
  return { priority: 3, icon: _taSvg.signal, iconBg: 'var(--amber-l)', iconColor: 'var(--amber)', accent: 'amber', title, detail, cat: 'crosssignal' };
}

/* ── Drop Attribution - decompose score drops into signal contributions ── */

// REMOVED: old _attributeScoreDrop - was diluting per-signal impact to near zero
// by averaging across all customers. Replaced with _taScoreDrivers below.
function _DISABLED_attributeScoreDrop(custs, peakDate, troughDate) {
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
      // Growth is categorical (none/mild/strong) - use mode, not numeric average
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

/* ── Score Drivers: which signals actually moved the portfolio score ── */
function _taScoreDrivers(active, data1, metricKey, cutoff, rangeDays) {
  if (metricKey !== 'score' || !data1 || data1.length < 5 || active.length < 5) return null;

  // Use actual chart start and end values - not peak/trough math
  const startAvg = Math.round(data1[0].avg);
  const endAvg = Math.round(data1[data1.length - 1].avg);
  const scoreDelta = endAvg - startAvg;
  if (Math.abs(scoreDelta) < 2) return null; // Not enough movement to analyze

  const rl = _taRangeLabel(rangeDays);
  const nonChurned = active.filter(c => c.lifecycle !== 'churned');

  // For each signal, compute the average CHANGE across the portfolio over the period
  const SIGS = [
    { key: 'logins', label: 'Logins', unit: '', bad: 'down', good: 'up' },
    { key: 'adoption', label: 'Adoption', unit: '%', bad: 'down', good: 'up' },
    { key: 'tickets', label: 'Tickets', unit: '', bad: 'up', good: 'down' },
    { key: 'nps', label: 'NPS', unit: '', bad: 'down', good: 'up' },
    { key: 'csat', label: 'CSAT', unit: '', bad: 'down', good: 'up' },
    { key: 'days', label: 'Days Since Contact', unit: 'd', bad: 'up', good: 'down' }
  ];

  const sigChanges = [];
  SIGS.forEach(sig => {
    const deltas = [];
    nonChurned.forEach(c => {
      const sh = _sigHist(c, sig.key, cutoff);
      if (sh.delta != null) deltas.push(sh.delta);
    });
    if (deltas.length < 3) return;
    const avgDelta = deltas.reduce((s,v) => s+v, 0) / deltas.length;
    // Is this signal moving in a bad direction?
    const isWorsening = (sig.bad === 'up' && avgDelta > 0.3) || (sig.bad === 'down' && avgDelta < -0.3);
    const isImproving = (sig.good === 'up' && avgDelta > 0.3) || (sig.good === 'down' && avgDelta < -0.3);
    sigChanges.push({ ...sig, avgDelta, isWorsening, isImproving, count: deltas.length });
  });

  const fd = v => (v >= 0 ? '+' : '') + (Math.round(v * 10) / 10);
  const declining = scoreDelta < 0;

  if (declining) {
    // Score went down - find the signals that worsened
    const drivers = sigChanges.filter(s => s.isWorsening).sort((a,b) => Math.abs(b.avgDelta) - Math.abs(a.avgDelta));
    if (!drivers.length) return null;
    const top2 = drivers.slice(0, 2);

    const title = 'Portfolio score dropped ' + Math.abs(scoreDelta) + ' pts - driven by ' + top2.map(d => d.label).join(' and ');
    let detail = `Score went from <strong>${startAvg}</strong> to <strong>${endAvg}</strong> over ${rl}. `;
    detail += top2.map(d => `<strong>${d.label}</strong> moved ${fd(d.avgDelta)}${d.unit} on average`).join(', ') + '. ';
    // Is anything offsetting it?
    const bright = sigChanges.filter(s => s.isImproving);
    if (bright.length) {
      detail += `${bright[0].label} improved (${fd(bright[0].avgDelta)}${bright[0].unit}) but wasn't enough to offset the decline. `;
    }
    detail += `Focus CSM efforts on the top declining signal (${top2[0].label}) to reverse the trend.`;
    return { priority: 1, icon: _taSvg.drop, iconBg: 'var(--red-l)', iconColor: 'var(--red)', accent: 'red', title, detail, cat: 'drivers' };
  } else {
    // Score went up - find what's driving it
    const drivers = sigChanges.filter(s => s.isImproving).sort((a,b) => Math.abs(b.avgDelta) - Math.abs(a.avgDelta));
    if (!drivers.length) return null;
    const top2 = drivers.slice(0, 2);

    const title = 'Portfolio score up ' + scoreDelta + ' pts - ' + top2.map(d => d.label).join(' and ') + ' leading';
    let detail = `Score went from <strong>${startAvg}</strong> to <strong>${endAvg}</strong> over ${rl}. `;
    detail += top2.map(d => `<strong>${d.label}</strong> improved ${fd(d.avgDelta)}${d.unit} on average`).join(', ') + '. ';
    const drags = sigChanges.filter(s => s.isWorsening);
    if (drags.length) {
      detail += `${drags[0].label} is still moving the wrong direction (${fd(drags[0].avgDelta)}${drags[0].unit}) - addressing it could accelerate gains.`;
    } else {
      detail += `All signals are trending positive - keep doing what's working.`;
    }
    return { priority: 2, icon: _taSvg.rise || _taSvg.trend, iconBg: 'var(--green-l)', iconColor: 'var(--green)', accent: 'green', title, detail, cat: 'drivers' };
  }
}

/* 9. Churn Impact - call out churned accounts and their revenue impact */
function _taChurnImpact(cutoff, rangeDays) {
  if (!_trendShowChurned) return null;
  const churned = customers.filter(c => c.lifecycle === 'churned' && passesManagerFilter(c));
  if (!churned.length) return null;

  // Find churned customers whose churn happened within the selected range
  const rangeStart = cutoff.getTime();
  const rangeEnd = Date.now();
  const recentChurns = [];
  churned.forEach(c => {
    const hist = (c.history || []).filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
    // Find churn point: first entry where _mrr drops to 0, capture pre-churn MRR from history
    let churnDate = null;
    let preMrr = 0;
    for (let i = 1; i < hist.length; i++) {
      const curMrr = hist[i].signals?._mrr;
      const prevMrr = hist[i-1].signals?._mrr;
      if (curMrr === 0 && prevMrr > 0) {
        churnDate = new Date(hist[i].date);
        preMrr = prevMrr;
        break;
      }
    }
    // Fallback: scan history for highest _mrr if no clean transition found
    if (!preMrr) {
      for (const h of hist) {
        if (h.signals?._mrr > preMrr) preMrr = h.signals._mrr;
      }
    }
    if (!churnDate) {
      // Approximate: find last non-zero _mrr entry
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].signals?._mrr > 0) {
          churnDate = new Date(hist[Math.min(i + 1, hist.length - 1)].date);
          break;
        }
      }
    }
    if (!churnDate) {
      // Last resort: use renewal_date as approximate churn date
      if (c.renewal_date) {
        const rd = new Date(c.renewal_date);
        if (rd <= new Date()) churnDate = rd;
      }
    }
    if (!churnDate) return;
    // Last resort fallback for MRR - estimate from tier if no _mrr in history
    if (!preMrr) preMrr = c._prechurnMrr || 0;
    if (!preMrr) {
      // Estimate based on tier midpoints
      preMrr = c.tier === 'enterprise' ? 25000 : c.tier === 'mid' ? 8000 : 1500;
    }
    const ct = churnDate.getTime();
    if (ct >= rangeStart && ct <= rangeEnd) {
      recentChurns.push({ c, churnDate, mrr: preMrr });
    }
  });
  if (!recentChurns.length) return null;

  recentChurns.sort((a,b) => b.mrr - a.mrr);
  const totalLostMRR = recentChurns.reduce((s,x) => s + x.mrr, 0);
  const rl = _taRangeLabel(rangeDays);
  const fmtDate = d => d.toLocaleDateString('en-US', { month:'short', day:'numeric' });

  let detail = `<strong>${recentChurns.length} account${recentChurns.length > 1 ? 's' : ''}</strong> churned in this period, losing <strong>$${fmtNum(totalLostMRR)}/mo</strong> in MRR. `;
  const top = recentChurns.slice(0, 3);
  detail += top.map(x => `<strong>${_taCustLink(x.c.name, x.c.id)}</strong> ($${fmtNum(x.mrr)}/mo, churned ${fmtDate(x.churnDate)})`).join(', ');
  if (recentChurns.length > 3) detail += ` and ${recentChurns.length - 3} more`;
  detail += '.';

  const title = recentChurns.length + ' account' + (recentChurns.length > 1 ? 's' : '') + ' churned - $' + fmtNum(totalLostMRR) + '/mo lost';
  return { priority: 1, icon: _taSvg.drop, iconBg: 'var(--red-l)', iconColor: 'var(--red)', accent: 'red', title, detail, cat: 'churn' };
}

/* ═══════════════════════════════════════════════════════════════════
   ANALYTICAL INSIGHTS - these compute relationships, patterns, and
   predictions. They should never just restate what's visible in tables.
   ═══════════════════════════════════════════════════════════════════ */

// Helper: get signal history for a customer
function _sigHist(c, key, cutoff) {
  const hist = (c.history || []).filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
  const before = hist.filter(h => new Date(h.date) < cutoff);
  const after = hist.filter(h => new Date(h.date) >= cutoff);
  const sv = before.length ? before[before.length - 1].signals?.[key] : null;
  const ev = after.length ? after[after.length - 1].signals?.[key] : null;
  return { sv, ev, delta: (sv != null && ev != null) ? ev - sv : null };
}

/* ── 1. Leading Indicator: signals moving but scores haven't caught up ── */
function _taLeadingIndicator(active, cutoff, rangeDays) {
  if (active.length < 5) return null;
  // Compare signal trajectory vs score trajectory for each account
  // If signals are dropping but score is still stable, that's a leading indicator
  const leading = [];
  active.forEach(c => {
    if (c.lifecycle === 'churned') return;
    const scoreDelta = _getDeltaNd(c, rangeDays);
    if (scoreDelta === null) return;
    // Check if key signals moved significantly while score stayed flat
    const lh = _sigHist(c, 'logins', cutoff);
    const ah = _sigHist(c, 'adoption', cutoff);
    const th = _sigHist(c, 'tickets', cutoff);
    const dh = _sigHist(c, 'days', cutoff);
    let signalWarnings = 0, signalDetails = [];
    if (lh.delta != null && lh.delta < -3 && lh.ev != null) { signalWarnings++; signalDetails.push('logins ' + (lh.delta > 0 ? '+' : '') + Math.round(lh.delta)); }
    if (ah.delta != null && ah.delta < -8 && ah.ev != null) { signalWarnings++; signalDetails.push('adoption ' + (ah.delta > 0 ? '+' : '') + Math.round(ah.delta) + '%'); }
    if (th.delta != null && th.delta > 1 && th.ev != null) { signalWarnings++; signalDetails.push('tickets +' + Math.round(th.delta)); }
    if (dh.delta != null && dh.delta > 10 && dh.ev != null) { signalWarnings++; signalDetails.push('contact gap +' + Math.round(dh.delta) + 'd'); }
    // Score is still OK (>=55) but 2+ signals are heading the wrong way
    if (signalWarnings >= 2 && (c.score || 0) >= 55 && scoreDelta > -5) {
      leading.push({ c, score: c.score, scoreDelta, signalWarnings, signalDetails, mrr: c.mrr || 0 });
    }
  });
  if (leading.length < 1) return null;
  leading.sort((a,b) => b.signalWarnings - a.signalWarnings || b.mrr - a.mrr);
  const top = leading.slice(0, 2);

  const title = leading.length + ' account' + (leading.length > 1 ? 's' : '') + ' with signals dropping before scores reflect it';
  let detail = top.map(x =>
    `${_taCustLink(x.c.name, x.c.id)} (score ${x.score}, looks OK) but ${x.signalDetails.join(', ')}`
  ).join('. ') + '.';
  detail += ` Because scores lag signals by 1-2 weeks, reach out now before the drop shows up. Focus on the declining signals first.`;
  return { priority: 1, icon: _taSvg.zap, iconBg: 'var(--amber-l)', iconColor: 'var(--amber)', accent: 'amber', title, detail, cat: 'leading' };
}

/* ── 2. Churn Pattern Match: current accounts matching churned account patterns ── */
function _taChurnPatternMatch(active, rangeDays) {
  const churned = customers.filter(c => c.lifecycle === 'churned');
  if (churned.length < 2 || active.length < 5) return null;

  // Compute avg signals of churned accounts pre-collapse
  let churnLogins = [], churnAdopt = [], churnDays = [];
  churned.forEach(c => {
    const hist = (c.history || []).filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
    if (hist.length < 5) return;
    const preIdx = Math.floor(hist.length * 0.65);
    const s = hist[preIdx]?.signals;
    if (!s) return;
    if (s.logins != null) churnLogins.push(s.logins);
    if (s.adoption != null) churnAdopt.push(s.adoption);
    if (s.days != null) churnDays.push(s.days);
  });
  if (churnLogins.length < 2) return null;
  const avgCL = churnLogins.reduce((s,v) => s+v, 0) / churnLogins.length;
  const avgCA = churnAdopt.length ? churnAdopt.reduce((s,v) => s+v, 0) / churnAdopt.length : null;
  const avgCD = churnDays.length ? churnDays.reduce((s,v) => s+v, 0) / churnDays.length : null;

  const matches = [];
  active.forEach(c => {
    if (c.lifecycle === 'churned') return;
    let matchScore = 0, details = [];
    if (c.logins != null && c.logins <= avgCL * 1.2) { matchScore++; details.push('logins ' + Math.round(c.logins)); }
    if (c.adoption != null && avgCA != null && c.adoption <= avgCA * 1.2) { matchScore++; details.push('adoption ' + Math.round(c.adoption) + '%'); }
    if (c.days != null && avgCD != null && c.days >= avgCD * 0.8) { matchScore++; details.push(Math.round(c.days) + 'd since contact'); }
    if (matchScore >= 2 && (c.score || 100) < 70) {
      matches.push({ c, matchScore, details, mrr: c.mrr || 0 });
    }
  });
  if (matches.length < 1) return null;
  matches.sort((a,b) => b.matchScore - a.matchScore || b.mrr - a.mrr);
  const top = matches.slice(0, 2);

  const title = matches.length + ' active account' + (matches.length > 1 ? 's show' : ' shows') + ' the same signal pattern as accounts that churned';
  let detail = top.map(x =>
    `${_taCustLink(x.c.name, x.c.id)} ($${fmtNum(x.mrr)}/mo) - ${x.details.slice(0, 2).join(', ')}`
  ).join('. ') + '.';
  detail += ` These signals match what churned accounts looked like before they left. Schedule a check-in call and focus on the weakest signal first.`;
  return { priority: 1, icon: _taSvg.drop, iconBg: 'var(--red-l)', iconColor: 'var(--red)', accent: 'red', title, detail, cat: 'churnmatch' };
}

/* ── 3. Contact Gap Impact: proving that silence hurts scores ── */
function _taContactGapImpact(active, cutoff, rangeDays) {
  if (active.length < 5) return null;
  const gapAccounts = [];
  active.forEach(c => {
    if (c.lifecycle === 'churned') return;
    const dh = _sigHist(c, 'days', cutoff);
    const scoreDelta = _getDeltaNd(c, rangeDays);
    if (dh.delta == null || scoreDelta == null) return;
    if (dh.delta > 10 && scoreDelta < -3) {
      gapAccounts.push({ c, daysDelta: dh.delta, daysNow: dh.ev, scoreDelta, mrr: c.mrr || 0 });
    }
  });
  if (gapAccounts.length < 2) return null;
  gapAccounts.sort((a,b) => a.scoreDelta - b.scoreDelta);

  // Compare contacted vs not-contacted score changes
  let contactedDeltas = [], gappedDeltas = [];
  active.forEach(c => {
    if (c.lifecycle === 'churned') return;
    const d = _getDeltaNd(c, rangeDays);
    if (d === null) return;
    if ((c.days || 0) <= 14) contactedDeltas.push(d);
    else if ((c.days || 0) > 30) gappedDeltas.push(d);
  });
  const contactedAvg = contactedDeltas.length >= 2 ? Math.round(contactedDeltas.reduce((s,v) => s+v, 0) / contactedDeltas.length * 10) / 10 : null;
  const gappedAvg = gappedDeltas.length >= 2 ? Math.round(gappedDeltas.reduce((s,v) => s+v, 0) / gappedDeltas.length * 10) / 10 : null;

  const top = gapAccounts.slice(0, 2);
  const title = gapAccounts.length + ' accounts have not been contacted in 30+ days and their scores are falling';
  let detail = top.map(x => `${_taCustLink(x.c.name, x.c.id)} - ${Math.round(x.daysNow)} days since last contact, score dropped ${Math.round(Math.abs(x.scoreDelta))} pts`).join('. ') + '. ';
  if (contactedAvg != null && gappedAvg != null && contactedAvg - gappedAvg > 2) {
    detail += `Accounts contacted recently averaged <strong>${contactedAvg > 0 ? '+' : ''}${contactedAvg}</strong> pts while accounts with 30+ day gaps averaged <strong>${gappedAvg > 0 ? '+' : ''}${gappedAvg}</strong> pts. `;
  }
  detail += `Schedule a check-in or value touchpoint with these accounts.`;
  return { priority: 2, icon: _taSvg.users, iconBg: 'var(--amber-l)', iconColor: 'var(--amber)', accent: 'amber', title, detail, cat: 'contactgap' };
}

/* ── Seasonal Pattern Detection ── */
function _taSeasonalPattern(data, metricKey, rangeDays, priorData) {
  // Need at least 6 months of data and a prior period to compare
  if (rangeDays < 180 || !priorData || priorData.length < 10 || data.length < 10) return null;
  const label = (METRIC_CFG[metricKey] || {}).label || metricKey;

  // Sample both periods at matching intervals and compute correlation
  const n = Math.min(data.length, priorData.length);
  const step = Math.max(1, Math.floor(n / 20)); // ~20 sample points
  const curr = [], prior = [];
  for (let i = 0; i < n; i += step) {
    curr.push(data[Math.min(i, data.length - 1)].avg);
    prior.push(priorData[Math.min(i, priorData.length - 1)].avg);
  }
  if (curr.length < 5) return null;

  // Pearson correlation on the shape (detrended: subtract linear fit)
  const detrend = (arr) => {
    const n = arr.length;
    const sx = n * (n - 1) / 2, sx2 = n * (n - 1) * (2 * n - 1) / 6;
    const sy = arr.reduce((s,v) => s+v, 0);
    const sxy = arr.reduce((s,v,i) => s + i * v, 0);
    const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
    const intercept = (sy - slope * sx) / n;
    return arr.map((v,i) => v - (slope * i + intercept));
  };
  const dc = detrend(curr);
  const dp = detrend(prior);
  const mc = dc.reduce((s,v) => s+v, 0) / dc.length;
  const mp = dp.reduce((s,v) => s+v, 0) / dp.length;
  let num = 0, dc2 = 0, dp2 = 0;
  for (let i = 0; i < dc.length; i++) {
    num += (dc[i] - mc) * (dp[i] - mp);
    dc2 += (dc[i] - mc) ** 2;
    dp2 += (dp[i] - mp) ** 2;
  }
  const corr = (dc2 > 0 && dp2 > 0) ? num / Math.sqrt(dc2 * dp2) : 0;

  // Compare current vs prior level
  const currAvg = curr.reduce((s,v) => s+v, 0) / curr.length;
  const priorAvg = prior.reduce((s,v) => s+v, 0) / prior.length;
  const levelDiff = Math.round(currAvg - priorAvg);

  if (corr > 0.4) {
    // Similar shape - seasonal pattern detected
    const title = 'Seasonal pattern detected in ' + label;
    let detail;
    if (Math.abs(levelDiff) <= 3) {
      detail = `${label} is following the same shape as the same period last year. This is seasonal, not structural - it followed the same path last time. No action needed unless it deviates from the prior year pattern.`;
    } else if (levelDiff > 3) {
      detail = `${label} is following a similar pattern to last year but running <strong>${levelDiff} pts higher</strong>. The seasonal shape is repeating but the overall level has improved.`;
    } else {
      detail = `${label} follows the same seasonal shape as last year but is running <strong>${Math.abs(levelDiff)} pts lower</strong>. While the pattern is seasonal, the declining baseline warrants attention.`;
    }
    const accent = levelDiff >= -2 ? 'green' : 'amber';
    return { priority: 2, icon: _taSvg.clock, iconBg: accent === 'green' ? 'var(--green-l)' : 'var(--amber-l)', iconColor: accent === 'green' ? 'var(--green)' : 'var(--amber)', accent, title, detail, cat: 'gen' };
  } else if (corr < 0.1 && Math.abs(levelDiff) > 5) {
    // Different pattern AND different level - this isn't seasonal
    const direction = levelDiff > 0 ? 'higher' : 'lower';
    const title = label + ' diverging from last year\'s pattern';
    const detail = `${label} is <strong>${Math.abs(levelDiff)} pts ${direction}</strong> than the same period last year and the pattern doesn't match. This isn't seasonal - something changed. ` + (levelDiff < 0 ? 'Look at what shifted in the portfolio around the time the divergence started.' : 'Whatever changed is working - identify it and double down.');
    const accent = levelDiff > 0 ? 'green' : 'red';
    return { priority: 1, icon: _taSvg.zap, iconBg: accent === 'green' ? 'var(--green-l)' : 'var(--red-l)', iconColor: accent === 'green' ? 'var(--green)' : 'var(--red)', accent, title, detail, cat: 'gen' };
  }
  return null;
}

/* ── WoW / MoM Acceleration ── */
function _taAcceleration(data, metricKey, rangeDays) {
  if (data.length < 14 || rangeDays < 14) return null;
  const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
  const label = cfg.label || metricKey;
  const isCurrency = metricKey === 'mrr' || metricKey === 'arr';
  const fv = v => isCurrency ? '$' + fmtNum(Math.round(Math.abs(v))) : String(Math.round(Math.abs(v) * 10) / 10);

  // Split data into 3 segments for acceleration detection
  const third = Math.floor(data.length / 3);
  const seg1 = data.slice(0, third);
  const seg2 = data.slice(third, third * 2);
  const seg3 = data.slice(third * 2);
  const avg = arr => arr.reduce((s,d) => s + d.avg, 0) / arr.length;
  const a1 = avg(seg1), a2 = avg(seg2), a3 = avg(seg3);
  const d12 = a2 - a1, d23 = a3 - a2;

  // Must have meaningful movement
  const thresh = isCurrency ? 200 : 1.5;
  if (Math.abs(d12) < thresh && Math.abs(d23) < thresh) return null;

  // Acceleration = d23 much larger magnitude than d12 in same direction
  // Deceleration = d12 was big but d23 flattened
  const sameDir = (d12 > 0 && d23 > 0) || (d12 < 0 && d23 < 0);
  const flip = _invertedMetrics.has(metricKey);

  let title, detail, accent;
  if (sameDir && Math.abs(d23) > Math.abs(d12) * 1.4) {
    // Accelerating
    const improving = flip ? d23 < 0 : d23 > 0;
    title = label + (improving ? ' improvement is accelerating' : ' decline is accelerating');
    detail = `${label} moved <strong>${fv(d12)}</strong> in the first third of this period, then <strong>${fv(d23)}</strong> in the latest third - the pace is picking up. `;
    detail += improving ? 'Whatever is driving this is gaining momentum.' : 'The rate of decline is increasing - this needs intervention soon.';
    accent = improving ? 'green' : 'red';
  } else if (sameDir && Math.abs(d23) < Math.abs(d12) * 0.5) {
    // Decelerating
    const wasImproving = flip ? d12 < 0 : d12 > 0;
    title = label + (wasImproving ? ' gains are slowing down' : ' decline is easing');
    detail = `${label} moved <strong>${fv(d12)}</strong> in the first third but only <strong>${fv(d23)}</strong> recently - the pace is tapering. `;
    detail += wasImproving ? 'The improvement may be plateauing. Check if a new initiative is needed.' : 'The decline is losing steam, which is a positive signal.';
    accent = 'amber';
  } else if (!sameDir && Math.abs(d23) > thresh) {
    // Direction reversal
    const nowImproving = flip ? d23 < 0 : d23 > 0;
    title = label + ' reversed direction recently';
    detail = `${label} was ${flip ? (d12 < 0 ? 'improving' : 'worsening') : (d12 > 0 ? 'rising' : 'falling')} (${fv(d12)}) but has ${nowImproving ? 'turned positive' : 'started declining'} (${fv(d23)}) in the latest third. `;
    detail += nowImproving ? 'This reversal is encouraging - monitor to see if it sustains.' : 'This reversal needs attention before it becomes a trend.';
    accent = nowImproving ? 'green' : 'red';
  } else {
    return null;
  }
  return { priority: 2, icon: _taSvg.zap, iconBg: accent === 'green' ? 'var(--green-l)' : accent === 'red' ? 'var(--red-l)' : 'var(--amber-l)', iconColor: accent === 'green' ? 'var(--green)' : accent === 'red' ? 'var(--red)' : 'var(--amber)', accent, title, detail, cat: 'accel' };
}

/* ── Spend Cohort Analysis: high-MRR vs low-MRR behavior ── */
function _taSpendCohort(active, rangeDays, metricKey) {
  const nonChurned = active.filter(c => c.lifecycle !== 'churned' && (c.mrr || 0) > 0);
  if (nonChurned.length < 8) return null;
  const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
  const label = cfg.label || metricKey;

  // Split into top 25% and bottom 25% by MRR
  const sorted = nonChurned.slice().sort((a,b) => (b.mrr||0) - (a.mrr||0));
  const q = Math.max(2, Math.floor(sorted.length * 0.25));
  const topSpend = sorted.slice(0, q);
  const botSpend = sorted.slice(-q);

  // Get current metric values
  const getVal = c => {
    if (metricKey === 'score') return c.score || 0;
    if (metricKey === 'mrr') return c.mrr || 0;
    if (metricKey === 'arr') return c.arr || 0;
    return c[metricKey] != null ? c[metricKey] : null;
  };

  const topVals = topSpend.map(c => getVal(c)).filter(v => v != null);
  const botVals = botSpend.map(c => getVal(c)).filter(v => v != null);
  if (topVals.length < 2 || botVals.length < 2) return null;

  const topAvg = topVals.reduce((s,v) => s+v, 0) / topVals.length;
  const botAvg = botVals.reduce((s,v) => s+v, 0) / botVals.length;
  const diff = topAvg - botAvg;

  // Also get deltas
  const getDelta = c => _getDeltaNd(c, rangeDays);
  const topDeltas = topSpend.map(c => getDelta(c)).filter(v => v !== null);
  const botDeltas = botSpend.map(c => getDelta(c)).filter(v => v !== null);
  const topDeltaAvg = topDeltas.length ? topDeltas.reduce((s,v) => s+v, 0) / topDeltas.length : 0;
  const botDeltaAvg = botDeltas.length ? botDeltas.reduce((s,v) => s+v, 0) / botDeltas.length : 0;

  const isCurrency = metricKey === 'mrr' || metricKey === 'arr';
  const fv = v => isCurrency ? '$' + fmtNum(Math.round(v)) : String(Math.round(v * 10) / 10);
  const fvd = v => (v >= 0 ? '+' : '') + fv(v);
  const topMrrTotal = topSpend.reduce((s,c) => s + (c.mrr||0), 0);
  const rl = _taRangeLabel(rangeDays);

  let title, detail, accent;
  if (metricKey === 'score' && Math.abs(diff) > 8) {
    // Score gap between high and low spenders
    const highBetter = diff > 0;
    if (highBetter) {
      title = 'Top spenders are healthier than small accounts';
      detail = `Your top ${q} accounts by MRR ($${fmtNum(topMrrTotal)}/mo total) average a health score of <strong>${fv(topAvg)}</strong> vs <strong>${fv(botAvg)}</strong> for the bottom ${q}. `;
      if (Math.abs(topDeltaAvg - botDeltaAvg) > 2) {
        detail += topDeltaAvg > botDeltaAvg
          ? `Top spenders also improved more (${fvd(topDeltaAvg)} vs ${fvd(botDeltaAvg)}) over ${rl}. The gap is widening.`
          : `But small accounts improved more (${fvd(botDeltaAvg)} vs ${fvd(topDeltaAvg)}) over ${rl} - the gap may be closing.`;
      }
      accent = 'green';
    } else {
      title = 'Small accounts are healthier than your top spenders';
      detail = `Your top ${q} accounts by MRR ($${fmtNum(topMrrTotal)}/mo) average a health score of <strong>${fv(topAvg)}</strong> vs <strong>${fv(botAvg)}</strong> for the bottom ${q}. `;
      detail += `Higher-value accounts scoring lower is a revenue risk - prioritize engagement with your largest customers.`;
      accent = 'red';
    }
  } else if (metricKey === 'score' && Math.abs(topDeltaAvg - botDeltaAvg) > 4) {
    // Similar current score but different trends
    const topBetter = topDeltaAvg > botDeltaAvg;
    title = topBetter ? 'Top spenders improving faster than small accounts' : 'Small accounts improving while top spenders stall';
    detail = `Over ${rl}, top ${q} MRR accounts moved <strong>${fvd(topDeltaAvg)}</strong> pts while bottom ${q} moved <strong>${fvd(botDeltaAvg)}</strong>. `;
    detail += topBetter ? 'High-value customers are responding well to current engagement.' : 'Your highest-value customers are not keeping up - reallocate attention to them.';
    accent = topBetter ? 'green' : 'red';
  } else {
    return null;
  }
  return { priority: 3, icon: _taSvg.dollar, iconBg: accent === 'green' ? 'var(--green-l)' : accent === 'red' ? 'var(--red-l)' : 'var(--amber-l)', iconColor: accent === 'green' ? 'var(--green)' : accent === 'red' ? 'var(--red)' : 'var(--amber)', accent, title, detail, cat: 'spend' };
}

/* ── Tenure Cohort: new vs established customer behavior ── */
function _taTenureCohort(active, rangeDays, metricKey) {
  const nonChurned = active.filter(c => c.lifecycle !== 'churned' && c.since);
  if (nonChurned.length < 8) return null;
  const now = Date.now();
  const sixMonths = 180 * 86400000;

  const newer = nonChurned.filter(c => (now - new Date(c.since).getTime()) < sixMonths);
  const established = nonChurned.filter(c => (now - new Date(c.since).getTime()) >= sixMonths * 2);
  if (newer.length < 2 || established.length < 2) return null;

  const getVal = c => metricKey === 'score' ? (c.score || 0) : c[metricKey] != null ? c[metricKey] : null;
  const newVals = newer.map(c => getVal(c)).filter(v => v != null);
  const estVals = established.map(c => getVal(c)).filter(v => v != null);
  if (newVals.length < 2 || estVals.length < 2) return null;

  const newAvg = newVals.reduce((s,v) => s+v, 0) / newVals.length;
  const estAvg = estVals.reduce((s,v) => s+v, 0) / estVals.length;
  const diff = newAvg - estAvg;

  const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
  const label = cfg.label || metricKey;
  const isCurrency = metricKey === 'mrr' || metricKey === 'arr';
  const fv = v => isCurrency ? '$' + fmtNum(Math.round(v)) : String(Math.round(v * 10) / 10);

  if (Math.abs(diff) < (isCurrency ? 500 : 5)) return null;

  let title, detail, accent;
  const newBetter = _invertedMetrics.has(metricKey) ? diff < 0 : diff > 0;
  if (newBetter) {
    title = 'Newer accounts outperforming established ones on ' + label;
    detail = `${newer.length} accounts under 6 months average <strong>${fv(newAvg)}</strong> ${label} vs <strong>${fv(estAvg)}</strong> for ${established.length} accounts over a year. `;
    detail += 'Recent onboarding may be more effective, or newer accounts are in their honeymoon phase. Watch whether this sustains.';
    accent = 'green';
  } else {
    title = 'Newer accounts lagging behind on ' + label;
    detail = `${newer.length} accounts under 6 months average <strong>${fv(newAvg)}</strong> ${label} vs <strong>${fv(estAvg)}</strong> for ${established.length} accounts over a year. `;
    detail += 'Newer customers may need stronger onboarding or earlier engagement to close this gap.';
    accent = 'amber';
  }
  return { priority: 3, icon: _taSvg.users, iconBg: accent === 'green' ? 'var(--green-l)' : 'var(--amber-l)', iconColor: accent === 'green' ? 'var(--green)' : 'var(--amber)', accent, title, detail, cat: 'tenure' };
}

/* ── Cross-Metric Correlation (without overlay) ── */
function _taSignalCorrelation(active, cutoff, rangeDays, metricKey) {
  if (active.length < 8) return null;
  const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
  const label = cfg.label || metricKey;
  const signals = ['logins','adoption','tickets','nps','csat','days'].filter(s => s !== metricKey);

  // For each customer, get metric delta and signal deltas
  const days = rangeDays;
  const pairs = {};
  signals.forEach(sig => { pairs[sig] = { xs: [], ys: [] }; });

  active.forEach(c => {
    if (c.lifecycle === 'churned') return;
    const metricDelta = _getDeltaNd(c, days);
    if (metricDelta === null) return;
    signals.forEach(sig => {
      const sh = _sigHist(c, sig, cutoff);
      if (sh.delta != null) {
        pairs[sig].xs.push(sh.delta);
        pairs[sig].ys.push(metricDelta);
      }
    });
  });

  // Compute Pearson correlation for each signal vs the metric
  let best = null, bestR = 0;
  signals.forEach(sig => {
    const p = pairs[sig];
    if (p.xs.length < 5) return;
    const n = p.xs.length;
    const mx = p.xs.reduce((s,v) => s+v, 0) / n;
    const my = p.ys.reduce((s,v) => s+v, 0) / n;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
      num += (p.xs[i] - mx) * (p.ys[i] - my);
      dx2 += (p.xs[i] - mx) ** 2;
      dy2 += (p.ys[i] - my) ** 2;
    }
    const r = (dx2 > 0 && dy2 > 0) ? num / Math.sqrt(dx2 * dy2) : 0;
    if (Math.abs(r) > Math.abs(bestR)) { bestR = r; best = sig; }
  });

  if (!best || Math.abs(bestR) < 0.35) return null;
  const rl = _taRangeLabel(rangeDays);
  const sigLabel = (WEIGHT_LABELS[best] || best);
  const strength = Math.abs(bestR) > 0.7 ? 'strong' : 'moderate';
  const dir = bestR > 0 ? 'positive' : 'negative';
  const flip = _invertedMetrics.has(best);
  const rPct = Math.round(Math.abs(bestR) * 100);

  let title, detail, accent;
  if (bestR > 0.35) {
    title = sigLabel + ' has a ' + strength + ' ' + dir + ' correlation with ' + label + ' (' + rPct + '%)';
    detail = `Over ${rl}, accounts where ${sigLabel} ${flip ? 'decreased' : 'increased'} also tended to see ${label} rise. `;
    detail += `Correlation: <strong>${rPct}%</strong>. ${sigLabel} changes appear to be ${strength === 'strong' ? 'a key driver' : 'a contributing factor'} of ${label} movement.`;
    accent = 'green';
  } else {
    title = sigLabel + ' has a ' + strength + ' inverse correlation with ' + label + ' (' + rPct + '%)';
    detail = `Over ${rl}, accounts where ${sigLabel} ${flip ? 'decreased' : 'increased'} tended to see ${label} drop. `;
    detail += `Inverse correlation: <strong>${rPct}%</strong>. Rising ${sigLabel} appears to ${strength === 'strong' ? 'reliably predict' : 'be associated with'} ${label} decline.`;
    accent = 'amber';
  }
  return { priority: 2, icon: _taSvg.signal, iconBg: accent === 'green' ? 'var(--green-l)' : 'var(--amber-l)', iconColor: accent === 'green' ? 'var(--green)' : 'var(--amber)', accent, title, detail, cat: 'correlation' };
}

/* ── MRR Concentration Risk ── */
function _taMrrConcentration(active) {
  const nonChurned = active.filter(c => c.lifecycle !== 'churned' && (c.mrr || 0) > 0);
  if (nonChurned.length < 5) return null;
  const sorted = nonChurned.slice().sort((a,b) => (b.mrr||0) - (a.mrr||0));
  const totalMrr = sorted.reduce((s,c) => s + (c.mrr||0), 0);
  if (totalMrr < 1000) return null;

  // Top 3 accounts as % of total
  const top3 = sorted.slice(0, 3);
  const top3Mrr = top3.reduce((s,c) => s + (c.mrr||0), 0);
  const top3Pct = Math.round(top3Mrr / totalMrr * 100);

  if (top3Pct < 25) return null; // Not concentrated enough to be interesting

  // Check health of top 3
  const top3AtRisk = top3.filter(c => (c.score || 0) < 50);
  const top3Avg = Math.round(top3.reduce((s,c) => s + (c.score||0), 0) / top3.length);

  let title, detail, accent;
  if (top3AtRisk.length > 0) {
    title = top3Pct + '% of MRR concentrated in top 3 accounts - ' + top3AtRisk.length + ' at risk';
    detail = `${top3.map(c => `${_taCustLink(c.name, c.id)} ($${fmtNum(c.mrr)}/mo, score ${c.score})`).join(', ')} make up <strong>${top3Pct}%</strong> of portfolio MRR. `;
    detail += `${top3AtRisk.map(c => c.name).join(' and ')} ${top3AtRisk.length === 1 ? 'is' : 'are'} scoring below 50 - losing ${top3AtRisk.length === 1 ? 'this account' : 'any of these'} would be a significant revenue hit.`;
    accent = 'red';
  } else if (top3Pct > 40) {
    title = top3Pct + '% of MRR in top 3 accounts - high concentration';
    detail = `${top3.map(c => `${_taCustLink(c.name, c.id)} ($${fmtNum(c.mrr)}/mo, score ${c.score})`).join(', ')}. `;
    detail += `All are healthy (avg ${top3Avg}), but this level of concentration means losing any one would materially impact revenue. Diversify the book.`;
    accent = 'amber';
  } else {
    title = 'Top 3 accounts represent ' + top3Pct + '% of MRR - all healthy';
    detail = `${top3.map(c => `${_taCustLink(c.name, c.id)} ($${fmtNum(c.mrr)}/mo, score ${c.score})`).join(', ')}. `;
    detail += `Avg score of ${top3Avg}. Concentration is moderate and these accounts are in good shape.`;
    accent = 'green';
  }
  return { priority: 7, icon: _taSvg.dollar, iconBg: accent === 'green' ? 'var(--green-l)' : accent === 'red' ? 'var(--red-l)' : 'var(--amber-l)', iconColor: accent === 'green' ? 'var(--green)' : accent === 'red' ? 'var(--red)' : 'var(--amber)', accent, title, detail, cat: 'mrrconc' };
}

/* ── Renewal Pipeline Risk ── */
function _taRenewalRisk(active, rangeDays) {
  const nonChurned = active.filter(c => c.lifecycle !== 'churned' && c.renewal_date);
  if (nonChurned.length < 3) return null;
  const now = new Date();
  const next90 = nonChurned.filter(c => {
    const rd = new Date(c.renewal_date);
    const daysOut = (rd - now) / 86400000;
    return daysOut >= 0 && daysOut <= 90;
  });
  if (next90.length < 2) return null;

  const atRisk = next90.filter(c => (c.score || 0) < 50);
  const healthy = next90.filter(c => (c.score || 0) >= 70);
  const totalMrr = next90.reduce((s,c) => s + (c.mrr||0), 0);
  const riskMrr = atRisk.reduce((s,c) => s + (c.mrr||0), 0);

  let title, detail, accent;
  if (atRisk.length > 0 && riskMrr > 0) {
    title = next90.length + ' renewals in 90 days - $' + fmtNum(riskMrr) + '/mo at risk';
    detail = `${next90.length} accounts renew in the next 90 days ($${fmtNum(totalMrr)}/mo total). `;
    detail += `${atRisk.length} ${atRisk.length === 1 ? 'is' : 'are'} scoring below 50: `;
    detail += atRisk.slice(0, 3).map(c => `${_taCustLink(c.name, c.id)} (${c.score}, $${fmtNum(c.mrr||0)}/mo, ${Math.round((new Date(c.renewal_date) - now) / 86400000)}d out)`).join(', ');
    detail += `. Prioritize these for save plays before renewal.`;
    accent = 'red';
  } else if (next90.length >= 3) {
    title = next90.length + ' renewals in 90 days - $' + fmtNum(totalMrr) + '/mo pipeline';
    detail = `${healthy.length} healthy, ${next90.length - healthy.length - atRisk.length} watch, ${atRisk.length} at risk. `;
    detail += healthy.length === next90.length ? 'All renewals look solid.' : 'Watch-zone accounts need a check-in before renewal.';
    accent = atRisk.length > 0 ? 'amber' : 'green';
  } else {
    return null;
  }
  return { priority: 6, icon: _taSvg.clock, iconBg: accent === 'green' ? 'var(--green-l)' : accent === 'red' ? 'var(--red-l)' : 'var(--amber-l)', iconColor: accent === 'green' ? 'var(--green)' : accent === 'red' ? 'var(--red)' : 'var(--amber)', accent, title, detail, cat: 'renewal' };
}

/* ── Silent Risk: accounts going quiet across multiple signals ── */
function _taSilentRisk(active, rangeDays) {
  if (active.length < 5) return null;
  const now = Date.now();
  const nonChurned = active.filter(c => c.lifecycle !== 'churned');

  // Find accounts where MULTIPLE signals are trending bad simultaneously
  const multiSignalRisk = [];
  nonChurned.forEach(c => {
    let badCount = 0;
    if ((c.days || 0) > 30) badCount++;
    if ((c.logins || 0) < 5) badCount++;
    if ((c.adoption || 0) < 30) badCount++;
    if ((c.nps != null) && c.nps <= 5) badCount++;
    if ((c.tickets || 0) >= 3) badCount++;
    if (badCount >= 3 && (c.score || 0) > 35) {
      // Score hasn't caught up yet - this is the interesting case
      multiSignalRisk.push({ c, badCount, gap: (c.score || 0) - 25 });
    }
  });

  if (multiSignalRisk.length < 1) return null;
  multiSignalRisk.sort((a,b) => (b.c.mrr||0) - (a.c.mrr||0));

  const top = multiSignalRisk.slice(0, 3);
  const totalMrr = top.reduce((s,x) => s + (x.c.mrr||0), 0);
  const title = multiSignalRisk.length + ' account' + (multiSignalRisk.length > 1 ? 's have' : ' has') + ' multiple weak signals but score hasn\'t dropped yet';
  let detail = top.map(x => {
    const warns = [];
    if ((x.c.days || 0) > 30) warns.push(x.c.days + 'd no contact');
    if ((x.c.logins || 0) < 5) warns.push(x.c.logins + ' logins');
    if ((x.c.adoption || 0) < 30) warns.push(x.c.adoption + '% adoption');
    return `${_taCustLink(x.c.name, x.c.id)} (score ${x.c.score}, ${warns.slice(0,2).join(', ')})`;
  }).join('; ') + '. ';
  detail += `These accounts show ${multiSignalRisk.length > 1 ? '3+' : '3+'} warning signals each. Scores will likely drop soon - get ahead of it now.`;

  return { priority: 1, icon: _taSvg.warn, iconBg: 'var(--red-l)', iconColor: 'var(--red)', accent: 'red', title, detail, cat: 'silent' };
}

/* ── Week-over-Week Comparison ── */
function _taWoWChange(data, metricKey, rangeDays) {
  if (rangeDays < 14 || data.length < 14) return null;
  const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
  const label = cfg.label || metricKey;
  const isCurrency = metricKey === 'mrr' || metricKey === 'arr';

  // Get last 7 days avg and prior 7 days avg
  const recent7 = data.slice(-7);
  const prior7 = data.slice(-14, -7);
  if (recent7.length < 5 || prior7.length < 5) return null;

  const recentAvg = recent7.reduce((s,d) => s + d.avg, 0) / recent7.length;
  const priorAvg = prior7.reduce((s,d) => s + d.avg, 0) / prior7.length;
  const change = recentAvg - priorAvg;
  const pctChange = priorAvg !== 0 ? Math.round(change / Math.abs(priorAvg) * 1000) / 10 : 0;

  const fv = v => isCurrency ? '$' + fmtNum(Math.round(Math.abs(v))) : String(Math.round(Math.abs(v) * 10) / 10);
  const thresh = isCurrency ? 300 : 1.0;
  if (Math.abs(change) < thresh) return null;

  const flip = _invertedMetrics.has(metricKey);
  const improved = flip ? change < 0 : change > 0;
  const title = label + ' ' + (improved ? 'up' : 'down') + ' ' + fv(change) + ' week-over-week' + (Math.abs(pctChange) >= 1 ? ' (' + (pctChange > 0 ? '+' : '') + pctChange + '%)' : '');
  const detail = `Last 7 days averaged <strong>${cfg.fmt(recentAvg)}</strong> vs <strong>${cfg.fmt(priorAvg)}</strong> the week before. ` +
    (improved ? 'This is a positive weekly shift.' : 'This weekly decline warrants monitoring.');
  const accent = improved ? 'green' : 'red';
  return { priority: 3, icon: _taSvg.trend, iconBg: accent === 'green' ? 'var(--green-l)' : 'var(--red-l)', iconColor: accent === 'green' ? 'var(--green)' : 'var(--red)', accent, title, detail, cat: 'wow' };
}

/* ═══ Stats Utilities ═══ */
function _stats(arr) {
  if (!arr.length) return null;
  const sorted = arr.slice().sort((a,b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s,v) => s + v, 0);
  const mean = sum / n;
  const median = n % 2 === 0 ? (sorted[n/2-1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)];
  const variance = sorted.reduce((s,v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const outliers = sorted.filter(v => v < lo || v > hi);
  const min = sorted[0], max = sorted[n - 1];
  // Skewness: positive = tail right (most scores clustered low), negative = tail left (clustered high)
  const skew = n >= 3 ? sorted.reduce((s,v) => s + ((v - mean) / (stddev || 1)) ** 3, 0) / n : 0;
  return { mean, median, stddev, q1, q3, iqr, min, max, lo, hi, outliers, skew, n };
}

/* ── Distribution Analysis: score distribution shape and outliers ── */
function _taDistribution(active, rangeDays, metricKey) {
  const nonChurned = active.filter(c => c.lifecycle !== 'churned');
  if (nonChurned.length < 8) return null;

  const cfg = METRIC_CFG[metricKey || 'score'] || METRIC_CFG.score;
  const label = cfg.label || metricKey || 'Health Score';
  const isScore = !metricKey || metricKey === 'score';

  // Get current value for each customer based on metric
  const getVal = (c) => {
    if (isScore) return c.score || 0;
    const hist = (c.history || []).filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
    if (!hist.length) return null;
    return cfg.val(hist[hist.length - 1], c);
  };

  const vals = nonChurned.map(c => getVal(c)).filter(v => v != null);
  if (vals.length < 8) return null;
  const st = _stats(vals);
  if (!st) return null;

  // Also compute delta distribution using metric-specific values
  const deltas = [];
  nonChurned.forEach(c => {
    if (isScore) {
      const d = _getDeltaNd(c, rangeDays);
      if (d !== null) deltas.push({ c, d });
    } else {
      const hist = (c.history || []).filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - rangeDays);
      const before = hist.filter(h => new Date(h.date) < cutoff);
      const after = hist.filter(h => new Date(h.date) >= cutoff);
      if (before.length && after.length) {
        const sv = cfg.val(before[before.length - 1], c);
        const ev = cfg.val(after[after.length - 1], c);
        if (sv != null && ev != null) deltas.push({ c, d: ev - sv });
      }
    }
  });
  const deltaVals = deltas.map(x => x.d);
  const dst = deltaVals.length >= 5 ? _stats(deltaVals) : null;

  const deltaOutliers = dst ? deltas.filter(x => x.d < dst.lo || x.d > dst.hi) : [];

  const rl = _taRangeLabel(rangeDays);
  const isCurrency = metricKey === 'mrr' || metricKey === 'arr';
  const fmtV = v => isCurrency ? '$' + fmtNum(Math.round(v)) : String(Math.round(v * 10) / 10);
  const r1 = v => Math.round(v);
  const r1d = v => Math.round(v * 10) / 10;
  const unit = isCurrency ? '' : (metricKey === 'adoption' ? '%' : ' pts');

  let title, detail, accent;

  // Decide what's most interesting to report
  if (deltaOutliers.length >= 1 && deltaOutliers.length <= 3) {
    deltaOutliers.sort((a,b) => a.d - b.d);
    const negOut = deltaOutliers.filter(x => x.d < dst.lo);
    const posOut = deltaOutliers.filter(x => x.d > dst.hi);

    if (negOut.length && posOut.length) {
      title = label + ' outliers pulling the portfolio in opposite directions';
      detail = `Most accounts changed between <strong>${fmtV(dst.q1)}</strong> and <strong>${fmtV(dst.q3)}</strong>${unit} (median ${fmtV(dst.median)}). `;
      detail += negOut.slice(0,1).map(x => `${_taCustLink(x.c.name, x.c.id)} (${fmtV(x.d)}${unit})`).join('') + ' is an outlier drop';
      detail += ' and ' + posOut.slice(0,1).map(x => `${_taCustLink(x.c.name, x.c.id)} (+${fmtV(x.d)}${unit})`).join('') + ' is an outlier gain. ';
      detail += `These are disproportionately affecting the portfolio average. Look at what's different about these accounts.`;
      accent = 'amber';
    } else if (negOut.length) {
      title = negOut.length + ' outlier' + (negOut.length > 1 ? 's' : '') + ' dragging down portfolio ' + label;
      detail = `The typical account changed <strong>${fmtV(dst.median)}</strong>${unit} (middle 50% between ${fmtV(dst.q1)} and ${fmtV(dst.q3)}). `;
      detail += negOut.slice(0,2).map(x => `${_taCustLink(x.c.name, x.c.id)} (${fmtV(x.d)}${unit}, $${fmtNum(x.c.mrr || 0)}/mo)`).join(' and ');
      detail += ` fell well outside the normal range. Prioritize ${negOut.length === 1 ? 'this account' : 'these accounts'}.`;
      accent = 'red';
    } else {
      title = posOut.length + ' account' + (posOut.length > 1 ? 's' : '') + ' significantly outperforming on ' + label;
      detail = `The typical account changed <strong>${fmtV(dst.median)}</strong>${unit}. `;
      detail += posOut.slice(0,2).map(x => `${_taCustLink(x.c.name, x.c.id)} (+${fmtV(x.d)}${unit})`).join(' and ');
      detail += ` grew far beyond the normal range. Understand what's working for ${posOut.length === 1 ? 'this account' : 'them'} and replicate it.`;
      accent = 'green';
    }
  } else if (Math.abs(st.skew) > 0.8) {
    if (st.skew < -0.8) {
      const lowTail = nonChurned.filter(c => getVal(c) != null && getVal(c) < st.q1).sort((a,b) => (getVal(a) || 0) - (getVal(b) || 0));
      title = label + ' distribution is top-heavy with a few accounts pulling it down';
      detail = `Median ${label} is <strong>${fmtV(st.median)}</strong> (higher than the mean of ${fmtV(st.mean)}). `;
      detail += `But ${lowTail.length} accounts in the bottom quartile (below ${fmtV(st.q1)}) are dragging the average. `;
      if (lowTail.length >= 1) {
        detail += `Lowest: ${_taCustLink(lowTail[0].name, lowTail[0].id)} (${fmtV(getVal(lowTail[0]))}). Fix the tail to lift the portfolio.`;
      }
      accent = 'amber';
    } else {
      title = 'Most accounts have low ' + label + ' - a few high values inflate the average';
      detail = `Median ${label} is <strong>${fmtV(st.median)}</strong> (lower than the mean of ${fmtV(st.mean)}). Most accounts cluster in the ${fmtV(st.q1)}-${fmtV(st.q3)} range. `;
      detail += `The portfolio looks better than it is because a few high performers pull the average up. Focus on the middle of the pack.`;
      accent = 'red';
    }
  } else if (st.stddev > (isCurrency ? st.mean * 0.5 : 18)) {
    title = 'Wide ' + label + ' spread across the portfolio (std dev: ' + fmtV(st.stddev) + ')';
    detail = `${label} ranges from <strong>${fmtV(st.min)}</strong> to <strong>${fmtV(st.max)}</strong> with a standard deviation of ${fmtV(st.stddev)}. `;
    detail += `The middle 50% falls between ${fmtV(st.q1)} and ${fmtV(st.q3)}. This level of variance suggests inconsistent performance across accounts.`;
    accent = 'amber';
  } else {
    title = label + ' distribution: median ' + fmtV(st.median) + ', spread ' + fmtV(st.q1) + '-' + fmtV(st.q3) + ' (middle 50%)';
    detail = `Across ${st.n} accounts: mean <strong>${fmtV(st.mean)}</strong>, median <strong>${fmtV(st.median)}</strong>, std dev ${fmtV(st.stddev)}. `;
    if (dst) {
      detail += `Over ${rl}, the typical account moved <strong>${fmtV(dst.median)}</strong>${unit} (range: ${fmtV(dst.min)} to +${fmtV(dst.max)}).`;
    }
    accent = isScore ? (st.median >= 65 ? 'green' : st.median >= 45 ? 'amber' : 'red') : 'amber';
  }

  return { priority: 4, icon: _taSvg.bar, iconBg: accent === 'green' ? 'var(--green-l)' : accent === 'red' ? 'var(--red-l)' : 'var(--amber-l)', iconColor: accent === 'green' ? 'var(--green)' : accent === 'red' ? 'var(--red)' : 'var(--amber)', accent, title, detail, cat: 'gen' };
}

/* ── Client Overlay Insight ── */
function _taClientOverlay(active, cutoff, rangeDays, metricKey) {
  if (!_trendClientOverlays || !_trendClientOverlays.length) return [];
  const cfg = METRIC_CFG[metricKey] || METRIC_CFG.score;
  const label = cfg.label || metricKey;
  const rl = _taRangeLabel(rangeDays);
  const results = [];

  _trendClientOverlays.forEach(cid => {
    const c = customers.find(x => x.id === cid);
    if (!c) return;
    const hist = (c.history || []).filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
    const inRange = hist.filter(h => new Date(h.date) >= cutoff);
    const before = hist.filter(h => new Date(h.date) < cutoff);
    if (!inRange.length) return;

    const startVal = before.length ? cfg.val(before[before.length - 1], c) : cfg.val(inRange[0], c);
    const endVal = cfg.val(inRange[inRange.length - 1], c);
    if (startVal == null || endVal == null) return;
    const delta = endVal - startVal;
    const f = v => _fmtTaVal(v, metricKey);
    const fd = v => (v >= 0 ? '+' : '') + _fmtTaVal(v, metricKey);

    // Compare to portfolio average change
    const portStart = active.length ? active.reduce((s,x) => {
      const h2 = (x.history || []).filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
      const b2 = h2.filter(h => new Date(h.date) < cutoff);
      if (!b2.length) return s;
      const v = cfg.val(b2[b2.length - 1], x);
      return v != null ? { sum: s.sum + v, n: s.n + 1 } : s;
    }, { sum: 0, n: 0 }) : { sum: 0, n: 0 };
    const portEnd = active.length ? active.reduce((s,x) => {
      const h2 = (x.history || []).filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
      const r2 = h2.filter(h => new Date(h.date) >= cutoff);
      if (!r2.length) return s;
      const v = cfg.val(r2[r2.length - 1], x);
      return v != null ? { sum: s.sum + v, n: s.n + 1 } : s;
    }, { sum: 0, n: 0 }) : { sum: 0, n: 0 };
    const portDelta = (portEnd.n && portStart.n) ? (portEnd.sum / portEnd.n) - (portStart.sum / portStart.n) : 0;

    const outperformed = delta > portDelta;
    const gap = Math.abs(delta - portDelta);

    // Build signal breakdown for this client
    const sigs = [
      { key: 'logins', label: 'Logins' }, { key: 'adoption', label: 'Adoption' },
      { key: 'tickets', label: 'Tickets' }, { key: 'nps', label: 'NPS' },
      { key: 'days', label: 'Days Since Contact' }
    ];
    const sigChanges = [];
    sigs.forEach(sig => {
      const sh = _sigHist(c, sig.key, cutoff);
      if (sh.delta != null && Math.abs(sh.delta) > 0.5) {
        const inverted = _invertedMetrics.has(sig.key);
        const good = inverted ? sh.delta < 0 : sh.delta > 0;
        sigChanges.push({ ...sig, delta: sh.delta, good });
      }
    });
    sigChanges.sort((a,b) => Math.abs(b.delta) - Math.abs(a.delta));

    let title = _taCustLink(c.name, c.id) + ': ' + label + ' ' + fd(delta) + ' over ' + rl;
    let detail = `${label} went from <strong>${f(startVal)}</strong> to <strong>${f(endVal)}</strong>. `;
    if (portDelta !== 0) {
      detail += outperformed
        ? `That's ${fd(gap)} better than the portfolio average (${fd(portDelta)}). `
        : `Portfolio average was ${fd(portDelta)} - this account is ${fd(gap)} behind. `;
    }
    if (sigChanges.length) {
      const top2 = sigChanges.slice(0, 2);
      detail += 'Key signal changes: ' + top2.map(s => {
        const fv = (s.delta >= 0 ? '+' : '') + (Math.round(s.delta * 10) / 10);
        return `<strong>${s.label}</strong> ${fv}`;
      }).join(', ') + '. ';
      const worst = sigChanges.filter(s => !s.good);
      if (worst.length) {
        detail += `Focus on ${worst[0].label} to improve this account.`;
      }
    }
    const accent = delta > 2 ? 'green' : delta < -2 ? 'red' : 'amber';
    results.push({ priority: 0, _contextual: true, icon: _taSvg.users, iconBg: accent === 'green' ? 'var(--green-l)' : accent === 'red' ? 'var(--red-l)' : 'var(--amber-l)', iconColor: accent === 'green' ? 'var(--green)' : accent === 'red' ? 'var(--red)' : 'var(--amber)', accent, title, detail });
  });
  return results;
}

/* ── Orchestrator ─────────────────────────────── */
function _buildTrendAnalysis(active, data1, data2, cutoff, rangeDays, m1, m2, priorData) {
  const wrap = el('trend-analysis-wrap');
  if (!wrap) return;

  // Include churned accounts in analysis pool when toggle is on
  const allForAnalysis = _trendShowChurned
    ? customers.filter(c => passesManagerFilter(c))
    : active;

  const hasDualMetric = m2 && data2 && data2.length;
  const hasCsmOverlay = !!_trendCsmOverlay;
  const hasClientOverlay = _trendClientOverlays && _trendClientOverlays.length > 0;

  // === CONTEXTUAL insights: directly tied to what the user selected ===
  // These ALWAYS appear first when applicable
  const contextual = [];

  // Client overlay: per-client breakdown with signal changes
  if (hasClientOverlay) {
    contextual.push(..._taClientOverlay(active, cutoff, rangeDays, m1));
  }

  // CSM overlay: how this CSM compares to the rest
  if (hasCsmOverlay) {
    const csm = _taCsmDivergence(data1, active, cutoff, rangeDays, m1);
    if (csm) { csm.priority = 0; csm._contextual = true; contextual.push(csm); }
  }

  // Dual metric: how the two selected metrics relate
  if (hasDualMetric) {
    const corr = _taMetricCorrelation(data1, data2, m1, m2, rangeDays);
    if (corr) { corr.priority = 0; corr._contextual = true; contextual.push(corr); }
  }

  // === GENERAL insights: large library, pick best & most diverse ===
  const isScoreMetric = !m1 || m1 === 'score';
  const isRevenueMetric = m1 === 'mrr' || m1 === 'arr';

  // TIER 1: Metric-specific dynamic insights (change with metric & timeframe)
  const tier1 = [
    _taAcceleration(data1, m1, rangeDays),
    _taWoWChange(data1, m1, rangeDays),
    _taInflection(data1, m1, rangeDays, allForAnalysis),
    _taSeasonalPattern(data1, m1, rangeDays, priorData),
    _taDistribution(allForAnalysis, rangeDays, m1),
  ].filter(Boolean);
  tier1.forEach(ins => { ins.priority = Math.min(ins.priority, 2); }); // boost to top

  // TIER 2: Cross-signal & correlation insights
  const tier2 = [
    _taSignalCorrelation(allForAnalysis, cutoff, rangeDays, m1),
    _taCrossSignal(allForAnalysis, cutoff, m1),
  ].filter(Boolean);
  tier2.forEach(ins => { ins.priority = Math.min(ins.priority, 3); });

  // TIER 3: Score-specific deep dives (only when viewing health score)
  const tier3 = isScoreMetric ? [
    _taScoreDrivers(allForAnalysis, data1, m1, cutoff, rangeDays),
    _taLeadingIndicator(allForAnalysis, cutoff, rangeDays),
    _taChurnPatternMatch(allForAnalysis, rangeDays),
    _taSilentRisk(allForAnalysis, rangeDays),
    _taContactGapImpact(allForAnalysis, cutoff, rangeDays),
  ].filter(Boolean) : [];
  tier3.forEach(ins => { ins.priority = Math.min(ins.priority, 3); });

  // TIER 4: Cohort analysis
  const tier4 = [
    _taSpendCohort(allForAnalysis, rangeDays, m1),
    _taTenureCohort(allForAnalysis, rangeDays, m1),
  ].filter(Boolean);
  tier4.forEach(ins => { ins.priority = 4; });

  // TIER 5: Static revenue/risk (only when viewing score or revenue metrics)
  const tier5 = (isScoreMetric || isRevenueMetric) ? [
    _taMrrConcentration(allForAnalysis),
    _taRenewalRisk(allForAnalysis, rangeDays),
    _taChurnImpact(cutoff, rangeDays),
  ].filter(Boolean) : [];
  tier5.forEach(ins => { ins.priority = 6; }); // always last resort

  const allGeneral = [...tier1, ...tier2, ...tier3, ...tier4, ...tier5];

  // Remove duplicates if CSM/correlation already in contextual
  if (hasCsmOverlay) {
    const idx = allGeneral.findIndex(r => r.title && r.title.includes(escHtml(_trendCsmOverlay)));
    if (idx >= 0) allGeneral.splice(idx, 1);
  }

  // Sort by priority first
  allGeneral.sort((a, b) => a.priority - b.priority);

  // Pick top insights but ensure CATEGORY DIVERSITY - no two from the same category
  const general = [];
  const usedCats = new Set();
  for (const ins of allGeneral) {
    const cat = ins.cat || ins.title;
    if (usedCats.has(cat)) continue;
    general.push(ins);
    usedCats.add(cat);
    if (general.length >= 5) break; // pool of 5 diverse candidates
  }

  // === Combine: contextual first, then fill remaining slots from general ===
  const maxInsights = 3;
  const top = contextual.slice(0, maxInsights);
  const remaining = maxInsights - top.length;
  if (remaining > 0) {
    top.push(...general.slice(0, remaining));
  }

  if (!top.length) {
    wrap.innerHTML = '';
    return;
  }

  wrap.innerHTML = '<div style="font-size:var(--fs-base);font-weight:700;color:var(--text);margin-bottom:8px">Analysis</div>' +
    top.map(ins => {
      const cls = ins.accent === 'green' ? 'ta-card-green' : ins.accent === 'red' ? 'ta-card-red' : ins.accent === 'amber' ? 'ta-card-amber' : '';
      return `<div class="ta-card ${cls}">
        <div class="ta-icon" style="background:${ins.iconBg};color:${ins.iconColor}">${ins.icon}</div>
        <div><div class="ta-label">${ins.title}</div><div class="ta-detail">${ins.detail}</div></div>
      </div>`;
    }).join('');
}


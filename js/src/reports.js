// ─── REPORTS ────────────────────────────────────────────────
function renderReporting() {
  const wrap = el('reports-wrap');
  if (!wrap) return;

  const lockSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  const reports = [
    { section:'all', tier:'starter', featureKey:'reports_basic',
      title:'Customer Health Export', desc:'Download all customers as CSV with scores, signals, status, MRR, and tags.',
      iconBg:'var(--blue-l)', iconColor:'var(--blue)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printCustomerHealth()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportCSV()' },
        { label:'Email', cls:'btn-outline', fn:"openReportEmailPanel('customer_health')" }
      ]
    },
    { section:'all', tier:'starter', featureKey:'reports_basic',
      title:'Score History Export', desc:'Per-customer score changes over time with all signal snapshots.',
      iconBg:'var(--teal-l)', iconColor:'var(--teal)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
      actions:[{ label:'Export CSV', cls:'btn-primary', fn:'exportScoreHistory()' }]
    },
    { section:'all', tier:'starter', featureKey:'reports_basic',
      title:'Portfolio Health Summary', desc:'Printable dashboard snapshot with KPI cards, status distribution, segment breakdown, and top at-risk accounts.',
      iconBg:'var(--purple-l)', iconColor:'var(--purple)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printPortfolioSummary()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportPortfolioCSV()' },
        { label:'Email', cls:'btn-outline', fn:"openReportEmailPanel('portfolio_summary')" }
      ]
    },
    { section:'all', tier:'starter', featureKey:'reports_basic',
      title:'Weekly Health Digest', desc:'Email-ready weekly digest with KPIs, at-risk accounts, and score movers.',
      iconBg:'var(--green-l)', iconColor:'var(--green)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printDigestReport()' },
        { label:'Download HTML', cls:'btn-outline', fn:'downloadDigestHTML()' },
        { label:'Copy HTML', cls:'btn-outline', fn:'copyDigestHTML()' },
        { label:'Email', cls:'btn-outline', fn:"openReportEmailPanel('weekly_digest')" }
      ]
    },
    { section:'all', tier:'starter', featureKey:'reports_basic',
      title:'At-Risk Report', desc:'Critical and At Risk customers sorted by MRR, with scores, trends, days since contact, and renewal dates.',
      iconBg:'var(--red-l)', iconColor:'var(--red)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printAtRiskReport()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportAtRiskCSV()' },
        { label:'Email', cls:'btn-outline', fn:"openReportEmailPanel('at_risk')" }
      ]
    },
    { section:'all', tier:'starter', featureKey:'reports_basic',
      title:'Renewal Forecast Report', desc:'Customers grouped by renewal window (this month, 30/60/90 days) with health status and MRR.',
      iconBg:'var(--amber-l)', iconColor:'var(--amber)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printRenewalForecast()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportRenewalCSV()' },
        { label:'Email', cls:'btn-outline', fn:"openReportEmailPanel('renewal_forecast')" }
      ]
    },
    { section:'all', tier:'starter', featureKey:'reports_basic',
      title:'Trend Report (30/60/90d)', desc:'Overall portfolio health score trend over time with status mix and MRR changes.',
      iconBg:'var(--teal-l)', iconColor:'var(--teal)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printTrendReport()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportTrendCSV()' },
        { label:'Email', cls:'btn-outline', fn:"openReportEmailPanel('trend_report')" }
      ]
    },
    { section:'all', tier:'starter', featureKey:'reports_basic',
      title:'Churn Risk Report', desc:'Combined risk ranking with estimated revenue impact, scored by health, trend, NPS, engagement, and renewal proximity.',
      iconBg:'var(--red-l)', iconColor:'var(--red)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printChurnRiskReport()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportChurnRiskCSV()' },
        { label:'Email', cls:'btn-outline', fn:"openReportEmailPanel('churn_risk')" }
      ]
    },
    // Gated reports
    { section:'all', tier:'team', featureKey:'report_segments',
      title:'Segment Analysis Report', desc:'Health breakdown by tier, lifecycle, and tag — with MRR at risk per segment.',
      iconBg:'var(--purple-l)', iconColor:'var(--purple)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printSegmentAnalysis()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportSegmentCSV()' },
        { label:'Email', cls:'btn-outline', fn:"openReportEmailPanel('segment_analysis')" }
      ]
    },
    { section:'all', tier:'pro', featureKey:'report_csmperf',
      title:'CSM Performance Report', desc:'Per-manager portfolio metrics — avg score, risk ratio, MRR managed, contact cadence.',
      iconBg:'var(--blue-l)', iconColor:'var(--blue)',
      icon:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      actions:[
        { label:'Print / PDF', cls:'btn-primary', fn:'printCSMReport()' },
        { label:'Export CSV', cls:'btn-outline', fn:'exportCSMReportCSV()' },
        { label:'Email', cls:'btn-outline', fn:"openReportEmailPanel('csm_performance')" }
      ]
    },
  ];

  const sections = [
    { key:'all', label:'Reports' },
  ];

  let html = '';
  sections.forEach(sec => {
    const secReports = reports.filter(r => r.section === sec.key);
    html += '<div class="rpt-section">' +
      '<div class="rpt-section-hd"><h2>' + sec.label + '</h2></div>' +
      '<div class="rpt-grid">';
    secReports.forEach(r => {
      const locked = !hasFeature(r.featureKey);
      html += '<div class="rpt-card' + (locked ? ' locked' : '') + '">' +
        (locked ? '<div class="rpt-lock-overlay">' + lockSvg + ' ' + (PLAN_TIER_LABELS[r.tier] || r.tier) + '+ required</div>' : '') +
        '<div class="rpt-card__icon" style="background:' + r.iconBg + ';color:' + r.iconColor + '">' + r.icon + '</div>' +
        '<div class="rpt-card__title">' + r.title + '</div>' +
        '<div class="rpt-card__desc">' + r.desc + '</div>' +
        '<div class="rpt-card__actions">' +
          r.actions.map(a => '<button class="btn btn-sm ' + a.cls + '" onclick="' + a.fn + '"' + (locked ? ' disabled' : '') + '>' + a.label + '</button>').join('') +
        '</div></div>';
    });
    html += '</div></div>';
  });
  wrap.innerHTML = html;
}

// ── Report: Score History Export (Solo) ──
function exportScoreHistory() {
  const hdr = 'customer_name,manager,tier,mrr,tags,date,score,status,logins,adoption,tickets,nps,csat,days_since_contact,growth,lifecycle';
  const rows = [];
  customers.forEach(c => {
    (c.history || []).forEach(h => {
      const s = h.signals || {};
      const st = typeof getStatus === 'function' ? getStatus(h.score || 0) : '';
      rows.push(csvRow([
        c.name, c.manager || '', c.tier || '', c.mrr || 0, (c.tags || []).join('|'),
        h.date || '', h.score || 0, st,
        s.logins ?? '', s.adoption ?? '', s.tickets ?? '', s.nps ?? '', s.csat ?? '',
        s.days ?? '', s.growth ?? '', s.lifecycle ?? ''
      ]));
    });
  });
  if (!rows.length) { toast('No score history found', 'warn'); return; }
  dlText(hdr + '\n' + rows.join('\n'), 'score-history-export.csv', 'text/csv');
  toast('Score history exported (' + rows.length + ' entries)', 'success');
}

// ── Shared print styles ──
function rptPrintCSS() {
  return '<style>' +
    '@page{size:auto;margin:16mm 12mm}' +
    '@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}' +
    '#print-area{font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#0f172a;padding:20px 36px;max-width:860px;margin:0 auto;line-height:1.55}' +
    '#print-area *{box-sizing:border-box}' +
    // header bar
    '.rpt-hdr{border-top:4px solid #4f46e5;padding-top:18px;margin-bottom:22px;page-break-inside:avoid}' +
    '.rpt-hdr-inner{display:flex;justify-content:space-between;align-items:flex-start}' +
    '.rpt-hdr h1{font-size:1.55rem;font-weight:800;margin:0 0 3px;letter-spacing:-.02em;color:#1e293b}' +
    '.rpt-hdr .sub{color:#64748b;font-size:.82rem;margin:0}' +
    '.rpt-brand{font-size:.7rem;color:#94a3b8;text-align:right;line-height:1.4;letter-spacing:.02em}' +
    '.rpt-brand strong{color:#4f46e5;font-weight:700;font-size:.75rem}' +
    // section headings
    'h2{font-size:1.05rem;font-weight:700;margin:20px 0 8px;padding-bottom:5px;border-bottom:2px solid #e2e8f0;color:#1e293b;letter-spacing:-.01em}' +
    // KPI cards
    '.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:14px 0;page-break-inside:avoid}' +
    '.kpi{border:1px solid #e2e8f0;border-top:3px solid #4f46e5;border-radius:10px;padding:16px 12px;text-align:center;background:#fff}' +
    '.kpi-num{font-size:1.45rem;font-weight:800;line-height:1.2;color:#1e293b}' +
    '.kpi-label{font-size:.68rem;color:#64748b;text-transform:uppercase;margin-top:5px;letter-spacing:.05em;font-weight:600}' +
    // tables
    'table{width:100%;border-collapse:collapse;font-size:.8rem;margin-top:10px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden}' +
    'thead th{text-align:left;color:#fff;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;padding:9px 10px;white-space:nowrap;background:#475569;font-weight:600}' +
    'th{text-align:left;color:#fff;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;padding:9px 10px;white-space:nowrap;background:#475569;font-weight:600}' +
    'td{padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#334155}' +
    'tr:nth-child(even) td{background:#f8fafc}' +
    'tr:last-child td{border-bottom:none}' +
    // status pill helper
    '.st-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}' +
    // bar chart
    '.bar{display:flex;height:24px;border-radius:6px;overflow:hidden;margin:10px 0;border:1px solid #e2e8f0}' +
    '.bar span{display:block}' +
    // footer
    '.rpt-footer{margin-top:16px;padding-top:10px;border-top:1.5px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;font-size:.68rem;color:#94a3b8;page-break-inside:avoid}' +
    // bucket headers
    '.bucket-hd{font-size:.95rem;font-weight:700;margin:20px 0 6px;display:flex;align-items:center;gap:8px;color:#1e293b}' +
    '.bucket-hd .ct{font-weight:400;color:#64748b;font-size:.82rem}' +
    // page break controls
    'table{page-break-inside:auto}tr{page-break-inside:avoid}' +
    'h2{page-break-after:avoid}.bucket-hd{page-break-after:avoid}' +
  '</style>';
}

function rptDateStr() {
  return new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
}

function rptHeader(title, subtitle) {
  return '<div class="rpt-hdr"><div class="rpt-hdr-inner">' +
    '<div><h1>' + escHtml(title) + '</h1><p class="sub">' + (subtitle || ('Generated ' + rptDateStr())) + '</p></div>' +
    '<div class="rpt-brand"><strong>iQcadence</strong><br>CS Health Score</div>' +
  '</div></div>';
}

function rptFooter() {
  return '<div class="rpt-footer"><span>iQcadence CS Health Score &middot; Confidential</span><span>' + rptDateStr() + '</span></div>';
}

function rptPrint(html) {
  const pa = document.getElementById('print-area');
  pa.style.display = 'block';
  pa.innerHTML = rptPrintCSS() + html;
  window.print();
  setTimeout(() => { pa.style.display = 'none'; pa.innerHTML = ''; }, 1000);
}

// ── SVG Chart Helpers for Print Reports ──

function svgDonut(segments, size) {
  size = size || 180;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (!total) return '';
  const cx = size / 2, cy = size / 2, r = size * 0.35, sw = size * 0.14;
  let angle = -90;
  const paths = [];
  segments.forEach(seg => {
    if (!seg.value) return;
    const pct = seg.value / total;
    const sa = angle, ea = angle + pct * 360;
    if (pct >= 0.999) {
      paths.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + seg.color + '" stroke-width="' + sw + '"/>');
    } else {
      const la = pct > 0.5 ? 1 : 0;
      const sr = sa * Math.PI / 180, er = ea * Math.PI / 180;
      const x1 = cx + r * Math.cos(sr), y1 = cy + r * Math.sin(sr);
      const x2 = cx + r * Math.cos(er), y2 = cy + r * Math.sin(er);
      paths.push('<path d="M' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' A' + r + ',' + r + ' 0 ' + la + ',1 ' + x2.toFixed(1) + ',' + y2.toFixed(1) + '" fill="none" stroke="' + seg.color + '" stroke-width="' + sw + '"/>');
    }
    angle = ea;
  });
  const legend = segments.filter(s => s.value > 0).map(seg => {
    const pct = Math.round(seg.value / total * 100);
    return '<div style="display:flex;align-items:center;gap:6px;font-size:.72rem;color:#334155;margin:3px 0">' +
      '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + seg.color + ';flex-shrink:0"></span>' +
      seg.label + ' <strong>' + seg.value + '</strong> (' + pct + '%)</div>';
  }).join('');
  return '<div style="display:flex;align-items:center;gap:28px;margin:14px 0;page-break-inside:avoid">' +
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' + paths.join('') +
    '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="' + (size * 0.15) + '" font-weight="800" fill="#1e293b">' + total + '</text>' +
    '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="' + (size * 0.06) + '" fill="#64748b" text-transform="uppercase" letter-spacing=".05em">TOTAL</text>' +
    '</svg><div>' + legend + '</div></div>';
}

function svgLineChart(points, w, h) {
  w = w || 780; h = h || 220;
  if (points.length < 2) return '';
  var pad = {t: 24, r: 24, b: 50, l: 48};
  var cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  var vals = points.map(function(p){ return p.value; });
  var rawMin = Math.min.apply(null, vals), rawMax = Math.max.apply(null, vals);
  var minV = Math.max(0, rawMin - 5), maxV = Math.min(100, rawMax + 5);
  if (maxV - minV < 10) { minV = Math.max(0, rawMin - 10); maxV = Math.min(100, rawMax + 10); }
  var range = maxV - minV || 1;
  // Grid + Y labels
  var grid = '', yLbl = '';
  for (var i = 0; i <= 4; i++) {
    var gv = minV + (range * i / 4), gy = pad.t + ch - (ch * i / 4);
    grid += '<line x1="' + pad.l + '" y1="' + gy.toFixed(1) + '" x2="' + (w - pad.r) + '" y2="' + gy.toFixed(1) + '" stroke="#e2e8f0" stroke-width=".8"/>';
    yLbl += '<text x="' + (pad.l - 8) + '" y="' + (gy + 3.5).toFixed(1) + '" text-anchor="end" font-size="9" fill="#94a3b8">' + Math.round(gv) + '</text>';
  }
  // Data points
  var pts = points.map(function(p, idx) {
    var x = pad.l + (cw * idx / (points.length - 1));
    var y = pad.t + ch - (ch * (p.value - minV) / range);
    return {x: x, y: y};
  });
  var linePath = pts.map(function(p, idx) { return (idx === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
  var areaPath = linePath + ' L' + pts[pts.length - 1].x.toFixed(1) + ',' + (pad.t + ch) + ' L' + pts[0].x.toFixed(1) + ',' + (pad.t + ch) + ' Z';
  // X labels
  var maxLbl = Math.min(14, points.length), step = Math.max(1, Math.ceil(points.length / maxLbl));
  var xLbl = '';
  points.forEach(function(p, idx) {
    if (idx % step === 0 || idx === points.length - 1) {
      var x = pad.l + (cw * idx / (points.length - 1));
      var lbl = p.label.length > 7 ? p.label.slice(5) : p.label;
      xLbl += '<text x="' + x.toFixed(1) + '" y="' + (h - 6) + '" text-anchor="middle" font-size="8.5" fill="#94a3b8" transform="rotate(-35,' + x.toFixed(1) + ',' + (h - 6) + ')">' + lbl + '</text>';
    }
  });
  // Dots
  var dots = pts.map(function(p) {
    return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3" fill="#4f46e5" stroke="#fff" stroke-width="1.5"/>';
  }).join('');
  return '<div style="margin:12px 0;overflow:hidden;page-break-inside:avoid"><svg width="100%" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet">' +
    grid + yLbl +
    '<defs><linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4f46e5" stop-opacity=".18"/><stop offset="100%" stop-color="#4f46e5" stop-opacity=".02"/></linearGradient></defs>' +
    '<path d="' + areaPath + '" fill="url(#lg1)"/>' +
    '<path d="' + linePath + '" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    dots + xLbl + '</svg></div>';
}

function svgBarH(items, w) {
  w = w || 780;
  var barH = 26, gap = 6, lblW = 130, valW = 80;
  var barArea = w - lblW - valW - 16;
  var h = items.length * (barH + gap) + 8;
  var maxV = Math.max.apply(null, items.map(function(d){ return d.value; })) || 1;
  var bars = items.map(function(item, i) {
    var y = i * (barH + gap) + 4;
    var bw = Math.max(3, (item.value / maxV) * barArea);
    var col = item.color || '#4f46e5';
    return '<text x="' + (lblW - 6) + '" y="' + (y + barH / 2 + 4) + '" text-anchor="end" font-size="11" font-weight="600" fill="#334155">' + item.label + '</text>' +
      '<rect x="' + lblW + '" y="' + y + '" width="' + bw.toFixed(1) + '" height="' + barH + '" rx="4" fill="' + col + '" opacity=".85"/>' +
      '<text x="' + (lblW + bw + 8).toFixed(1) + '" y="' + (y + barH / 2 + 4) + '" font-size="11" font-weight="700" fill="#334155">' + (item.valLabel || item.value) + '</text>';
  }).join('');
  return '<div style="margin:10px 0;page-break-inside:avoid"><svg width="100%" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet">' + bars + '</svg></div>';
}

function svgRiskBands(scored) {
  // Stacked risk band visualization: Low / Medium / High / Critical
  var bands = [
    {label: 'Low (0\u201329)', color: '#16a34a', count: 0},
    {label: 'Medium (30\u201349)', color: '#d97706', count: 0},
    {label: 'High (50\u201369)', color: '#f97316', count: 0},
    {label: 'Critical (70+)', color: '#dc2626', count: 0}
  ];
  scored.forEach(function(r) {
    if (r.risk >= 70) bands[3].count++;
    else if (r.risk >= 50) bands[2].count++;
    else if (r.risk >= 30) bands[1].count++;
    else bands[0].count++;
  });
  var total = scored.length || 1;
  var w = 780, barH = 32;
  var legend = bands.map(function(b) {
    var pct = Math.round(b.count / total * 100);
    return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:.72rem;color:#334155;margin-right:16px">' +
      '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + b.color + '"></span>' +
      b.label + ': <strong>' + b.count + '</strong> (' + pct + '%)</span>';
  }).join('');
  var barParts = bands.filter(function(b){ return b.count > 0; }).map(function(b) {
    var pct = Math.max(2, b.count / total * 100);
    return '<span style="display:block;width:' + pct + '%;background:' + b.color + ';height:' + barH + 'px"></span>';
  }).join('');
  return '<div style="margin:12px 0;page-break-inside:avoid">' +
    '<div class="bar" style="height:' + barH + 'px;border-radius:8px">' + barParts + '</div>' +
    '<div style="margin-top:8px;display:flex;flex-wrap:wrap">' + legend + '</div></div>';
}

function svgMiniBar(items) {
  // Compact bar chart within a section — used for segment comparisons
  return items.map(function(item) {
    var pct = Math.min(100, Math.max(2, item.value));
    var col = item.value >= 80 ? '#16a34a' : item.value >= 60 ? '#4f46e5' : item.value >= 40 ? '#d97706' : '#dc2626';
    return '<div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:.75rem">' +
      '<span style="width:100px;text-align:right;font-weight:600;color:#334155;flex-shrink:0">' + item.label + '</span>' +
      '<div style="flex:1;height:18px;background:#f1f5f9;border-radius:4px;overflow:hidden">' +
        '<div style="width:' + pct + '%;height:100%;background:' + col + ';border-radius:4px;opacity:.8"></div></div>' +
      '<span style="width:32px;font-weight:700;color:#334155">' + item.value + '</span></div>';
  }).join('');
}

// ── Report: Portfolio Health Summary (Team) ──
function buildPortfolioSummaryHTML() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const total = active.length;
  const avg = total ? Math.round(active.reduce((s, c) => s + c.score, 0) / total) : 0;
  const totalMRR = active.reduce((s, c) => s + (c.mrr || 0), 0);

  const bands = ['critical', 'risk', 'watch', 'healthy', 'expand'];
  const bandData = bands.map(st => {
    const grp = active.filter(c => c.status === st);
    return { status: st, label: STATUS_LABEL[st], color: STATUS_COLOR[st], count: grp.length, mrr: grp.reduce((s, c) => s + (c.mrr || 0), 0), pct: total ? Math.round(grp.length / total * 100) : 0 };
  });
  const riskMRR = active.filter(c => c.status === 'critical' || c.status === 'risk').reduce((s, c) => s + (c.mrr || 0), 0);

  const tiers = ['smb', 'mid', 'enterprise'];
  const tierData = tiers.map(t => {
    const grp = active.filter(c => c.tier === t);
    return { label: t === 'smb' ? 'SMB' : t === 'mid' ? 'Mid-Market' : 'Enterprise', count: grp.length, mrr: grp.reduce((s, c) => s + (c.mrr || 0), 0), avg: grp.length ? Math.round(grp.reduce((s, c) => s + c.score, 0) / grp.length) : 0 };
  });

  const topRisk = [...active].filter(c => c.status === 'critical' || c.status === 'risk').sort((a, b) => (b.mrr || 0) - (a.mrr || 0)).slice(0, 10);

  let html = rptHeader('Portfolio Health Summary', 'Generated ' + rptDateStr() + ' &middot; ' + total + ' active accounts') +
    '<div class="kpi-row">' +
      '<div class="kpi"><div class="kpi-num">' + total + '</div><div class="kpi-label">Active Accounts</div></div>' +
      '<div class="kpi"><div class="kpi-num">' + avg + '</div><div class="kpi-label">Avg Health Score</div></div>' +
      '<div class="kpi"><div class="kpi-num">$' + fmtNum(totalMRR) + '</div><div class="kpi-label">Total MRR</div></div>' +
      '<div class="kpi" style="border-top-color:#dc2626"><div class="kpi-num" style="color:#dc2626">$' + fmtNum(riskMRR) + '</div><div class="kpi-label">MRR at Risk</div></div>' +
    '</div>' +
    '<h2>Status Distribution</h2>' +
    '<div style="display:flex;gap:30px;align-items:flex-start;flex-wrap:wrap">' +
      svgDonut(bandData.map(b => ({label: b.label, value: b.count, color: b.color})), 170) +
      '<div style="flex:1;min-width:280px"><table><tr><th>Status</th><th>Count</th><th>%</th><th style="text-align:right">MRR</th></tr>' +
        bandData.map(b => '<tr><td><span class="st-dot" style="background:' + b.color + '"></span>' + b.label + '</td><td>' + b.count + '</td><td>' + b.pct + '%</td><td style="text-align:right">$' + fmtNum(b.mrr) + '</td></tr>').join('') +
      '</table></div></div>' +
    '<h2>Segment Breakdown</h2>' +
    svgBarH(tierData.map(t => ({label: t.label, value: t.mrr, color: '#4f46e5', valLabel: '$' + fmtNum(t.mrr)}))) +
    '<table><tr><th>Tier</th><th>Accounts</th><th style="text-align:right">MRR</th><th>Avg Score</th><th style="text-align:right">Score</th></tr>' +
      tierData.map(t => {
        var col = t.avg >= 80 ? '#16a34a' : t.avg >= 60 ? '#4f46e5' : t.avg >= 40 ? '#d97706' : '#dc2626';
        return '<tr><td><strong>' + t.label + '</strong></td><td>' + t.count + '</td><td style="text-align:right">$' + fmtNum(t.mrr) + '</td>' +
          '<td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:14px;background:#f1f5f9;border-radius:3px;overflow:hidden"><div style="width:' + t.avg + '%;height:100%;background:' + col + ';border-radius:3px"></div></div></div></td>' +
          '<td style="text-align:right;font-weight:700;color:' + col + '">' + t.avg + '</td></tr>';
      }).join('') +
    '</table>';

  if (topRisk.length) {
    html += '<h2>Top At-Risk Accounts by MRR</h2>' +
      '<table><tr><th>Customer</th><th>Score</th><th>Status</th><th style="text-align:right">MRR</th><th>Days Since Contact</th><th>Renewal</th></tr>' +
      topRisk.map(c => '<tr><td><strong>' + escHtml(c.name) + '</strong></td><td style="font-weight:700;color:' + STATUS_COLOR[c.status] + '">' + c.score + '</td><td><span class="st-dot" style="background:' + STATUS_COLOR[c.status] + '"></span>' + STATUS_LABEL[c.status] + '</td><td style="text-align:right">$' + fmtNum(c.mrr || 0) + '</td><td' + ((c.days || 0) >= 14 ? ' style="color:#dc2626;font-weight:600"' : '') + '>' + (c.days ?? '\u2014') + 'd</td><td>' + (c.renewal_date ? fmtDate(c.renewal_date) : '\u2014') + '</td></tr>').join('') +
      '</table>';
  }
  html += rptFooter();
  return html;
}
function printPortfolioSummary() { const h = buildPortfolioSummaryHTML(); if (h) rptPrint(h); else toast('No data','warn'); }

// ── Report: At-Risk Report (Team) ──
function buildAtRiskReportHTML() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const atRisk = active.filter(c => c.status === 'critical' || c.status === 'risk').sort((a, b) => (b.mrr || 0) - (a.mrr || 0));
  if (!atRisk.length) return '';
  const totalRiskMRR = atRisk.reduce((s, c) => s + (c.mrr || 0), 0);

  const critCount = atRisk.filter(c => c.status === 'critical').length;
  const riskCount = atRisk.length - critCount;
  const critMRR = atRisk.filter(c => c.status === 'critical').reduce((s, c) => s + (c.mrr || 0), 0);
  const riskOnlyMRR = totalRiskMRR - critMRR;

  let html = rptHeader('At-Risk Report', 'Generated ' + rptDateStr() + ' &middot; ' + atRisk.length + ' accounts &middot; $' + fmtNum(totalRiskMRR) + ' MRR at risk') +
    '<div class="kpi-row">' +
      '<div class="kpi" style="border-top-color:#dc2626"><div class="kpi-num" style="color:#dc2626">' + critCount + '</div><div class="kpi-label">Critical</div></div>' +
      '<div class="kpi" style="border-top-color:#f97316"><div class="kpi-num" style="color:#f97316">' + riskCount + '</div><div class="kpi-label">At Risk</div></div>' +
      '<div class="kpi" style="border-top-color:#dc2626"><div class="kpi-num" style="color:#dc2626">$' + fmtNum(critMRR) + '</div><div class="kpi-label">Critical MRR</div></div>' +
      '<div class="kpi" style="border-top-color:#f97316"><div class="kpi-num" style="color:#f97316">$' + fmtNum(riskOnlyMRR) + '</div><div class="kpi-label">At Risk MRR</div></div>' +
    '</div>' +
    svgBarH([
      {label: 'Critical', value: critMRR, color: '#dc2626', valLabel: '$' + fmtNum(critMRR) + ' (' + critCount + ' accts)'},
      {label: 'At Risk', value: riskOnlyMRR, color: '#f97316', valLabel: '$' + fmtNum(riskOnlyMRR) + ' (' + riskCount + ' accts)'}
    ]) +
    '<h2>At-Risk Accounts</h2>' +
    '<table><tr><th>Customer</th><th>Manager</th><th>Score</th><th>Status</th><th>7d Trend</th><th style="text-align:right">MRR</th><th>Days Since Contact</th><th>Renewal</th></tr>' +
    atRisk.map(c => {
      const delta = getDelta7d(c);
      const trendStr = delta > 0 ? '+' + delta : String(delta);
      const trendColor = delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : '#64748b';
      return '<tr><td><strong>' + escHtml(c.name) + '</strong></td><td>' + escHtml(c.manager || '\u2014') + '</td>' +
        '<td style="font-weight:700;color:' + STATUS_COLOR[c.status] + '">' + c.score + '</td>' +
        '<td><span class="st-dot" style="background:' + STATUS_COLOR[c.status] + '"></span>' + STATUS_LABEL[c.status] + '</td>' +
        '<td style="color:' + trendColor + ';font-weight:600">' + trendStr + '</td><td style="text-align:right">$' + fmtNum(c.mrr || 0) + '</td>' +
        '<td' + ((c.days || 0) >= 14 ? ' style="color:#dc2626;font-weight:600"' : '') + '>' + (c.days ?? '\u2014') + 'd</td>' +
        '<td>' + (c.renewal_date ? fmtDate(c.renewal_date) : '\u2014') + '</td></tr>';
    }).join('') +
    '</table>' + rptFooter();
  return html;
}
function printAtRiskReport() { const h = buildAtRiskReportHTML(); if (h) rptPrint(h); else toast('No at-risk customers found','success'); }

function exportAtRiskCSV() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const atRisk = active.filter(c => c.status === 'critical' || c.status === 'risk').sort((a, b) => (b.mrr || 0) - (a.mrr || 0));
  if (!atRisk.length) { toast('No at-risk customers found', 'success'); return; }
  const hdr = CSV_CUST_HDR;
  const rows = atRisk.map(c => csvRow(csvCustCols(c)));
  dlText(hdr + '\n' + rows.join('\n'), 'at-risk-report.csv', 'text/csv');
  toast('At-risk report exported (' + atRisk.length + ' accounts)', 'success');
}

// ── Report: Renewal Forecast (Team) ──
function buildRenewalForecastHTML() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c) && c.renewal_date);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const d30 = new Date(now); d30.setDate(d30.getDate() + 30);
  const d60 = new Date(now); d60.setDate(d60.getDate() + 60);
  const d90 = new Date(now); d90.setDate(d90.getDate() + 90);

  const buckets = [
    { label: 'This Month', from: now, to: endOfMonth },
    { label: 'Next 30 Days', from: now, to: d30 },
    { label: '31\u201360 Days', from: d30, to: d60 },
    { label: '61\u201390 Days', from: d60, to: d90 },
  ];

  const assigned = new Set();
  const bucketData = buckets.map(b => {
    const items = active.filter(c => {
      if (assigned.has(c.id)) return false;
      const rd = new Date(c.renewal_date);
      return rd >= b.from && rd <= b.to;
    }).sort((a, b) => new Date(a.renewal_date) - new Date(b.renewal_date));
    items.forEach(c => assigned.add(c.id));
    const mrr = items.reduce((s, c) => s + (c.mrr || 0), 0);
    return { ...b, items, mrr };
  });

  const totalRenewals = bucketData.reduce((s, b) => s + b.items.length, 0);
  const totalRMRR = bucketData.reduce((s, b) => s + b.mrr, 0);
  let html = rptHeader('Renewal Forecast Report', 'Generated ' + rptDateStr() + ' &middot; ' + totalRenewals + ' renewals &middot; $' + fmtNum(totalRMRR) + ' MRR') +
    '<h2>MRR by Renewal Window</h2>' +
    svgBarH(bucketData.map(b => ({label: b.label, value: b.mrr, color: b.items.some(c => c.status === 'critical' || c.status === 'risk') ? '#d97706' : '#4f46e5', valLabel: '$' + fmtNum(b.mrr) + ' (' + b.items.length + ')'})));

  bucketData.forEach(b => {
    html += '<div class="bucket-hd">' + b.label + ' <span class="ct">' + b.items.length + ' accounts &middot; $' + fmtNum(b.mrr) + ' MRR</span></div>';
    if (b.items.length) {
      html += '<table><tr><th>Customer</th><th>Manager</th><th>Score</th><th>Status</th><th style="text-align:right">MRR</th><th>Renewal Date</th></tr>' +
        b.items.map(c => '<tr><td><strong>' + escHtml(c.name) + '</strong></td><td>' + escHtml(c.manager || '\u2014') + '</td><td style="font-weight:700;color:' + STATUS_COLOR[c.status] + '">' + c.score + '</td><td><span class="st-dot" style="background:' + STATUS_COLOR[c.status] + '"></span>' + STATUS_LABEL[c.status] + '</td><td style="text-align:right">$' + fmtNum(c.mrr || 0) + '</td><td>' + fmtDate(c.renewal_date) + '</td></tr>').join('') +
        '</table>';
    } else {
      html += '<p style="color:#94a3b8;font-size:.82rem;margin:4px 0 12px">No renewals in this window.</p>';
    }
  });

  html += rptFooter();
  return html;
}
function printRenewalForecast() { rptPrint(buildRenewalForecastHTML()); }

// ── Report: CSM Performance (Growth) ──
function buildCSMReportHTML() {
  const active = customers.filter(c => c.lifecycle !== 'churned');
  const managers = [...new Set(active.map(c => c.manager || '').filter(Boolean))].sort();
  if (!managers.length) return '';

  const mgrData = managers.map(m => {
    const grp = active.filter(c => c.manager === m);
    const atRisk = grp.filter(c => c.status === 'critical' || c.status === 'risk').length;
    const avgScore = grp.length ? Math.round(grp.reduce((s, c) => s + c.score, 0) / grp.length) : 0;
    const mrr = grp.reduce((s, c) => s + (c.mrr || 0), 0);
    const avgDays = grp.length ? Math.round(grp.reduce((s, c) => s + (c.days || 0), 0) / grp.length) : 0;
    return { manager: m, count: grp.length, avgScore, atRisk, riskPct: grp.length ? Math.round(atRisk / grp.length * 100) : 0, mrr, avgDays };
  }).sort((a, b) => b.avgScore - a.avgScore);

  let html = rptHeader('CSM Performance Report', 'Generated ' + rptDateStr() + ' &middot; ' + managers.length + ' managers') +
    '<h2>Avg Health Score by Manager</h2>' +
    svgBarH(mgrData.map(m => {
      var col = m.avgScore >= 80 ? '#16a34a' : m.avgScore >= 60 ? '#4f46e5' : m.avgScore >= 40 ? '#d97706' : '#dc2626';
      return {label: m.manager.length > 18 ? m.manager.slice(0, 16) + '\u2026' : m.manager, value: m.avgScore, color: col, valLabel: m.avgScore + ' avg'};
    })) +
    '<h2>Manager Details</h2>' +
    '<table><tr><th>Manager</th><th>Accounts</th><th>Avg Score</th><th>At Risk</th><th>Risk %</th><th style="text-align:right">MRR Managed</th><th>Avg Days Contact</th></tr>' +
    mgrData.map(m => {
      const riskColor = m.riskPct >= 40 ? '#dc2626' : m.riskPct >= 20 ? '#d97706' : '#16a34a';
      return '<tr><td><strong>' + escHtml(m.manager) + '</strong></td><td>' + m.count + '</td><td style="font-weight:700">' + m.avgScore + '</td><td>' + m.atRisk + '</td><td style="color:' + riskColor + ';font-weight:600">' + m.riskPct + '%</td><td style="text-align:right">$' + fmtNum(m.mrr) + '</td><td>' + m.avgDays + 'd</td></tr>';
    }).join('') +
    '</table>' + rptFooter();
  return html;
}
function printCSMReport() { const h = buildCSMReportHTML(); if (h) rptPrint(h); else toast('No managers found','warn'); }

// ── Report: Segment Analysis (Growth) ──
function buildSegmentAnalysisHTML() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!active.length) return '';

  function segTable(label, groups) {
    let chart = svgMiniBar(groups.map(g => ({label: g.label.length > 14 ? g.label.slice(0, 12) + '\u2026' : g.label, value: g.avg})));
    let h = '<h2>' + label + '</h2>' + chart +
      '<table><tr><th>Segment</th><th>Accounts</th><th>Avg Score</th><th style="text-align:right">MRR</th><th>At Risk %</th></tr>';
    groups.forEach(g => {
      const riskColor = g.riskPct >= 40 ? '#dc2626' : g.riskPct >= 20 ? '#d97706' : '#16a34a';
      h += '<tr><td><strong>' + escHtml(g.label) + '</strong></td><td>' + g.count + '</td><td style="font-weight:700">' + g.avg + '</td><td style="text-align:right">$' + fmtNum(g.mrr) + '</td><td style="color:' + riskColor + ';font-weight:600">' + g.riskPct + '%</td></tr>';
    });
    return h + '</table>';
  }

  function buildGroups(keyFn) {
    const map = {};
    active.forEach(c => {
      const keys = keyFn(c);
      (Array.isArray(keys) ? keys : [keys]).forEach(k => {
        if (!k) return;
        if (!map[k]) map[k] = [];
        map[k].push(c);
      });
    });
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length).map(([k, grp]) => {
      const atRisk = grp.filter(c => c.status === 'critical' || c.status === 'risk').length;
      return { label: k, count: grp.length, avg: Math.round(grp.reduce((s, c) => s + c.score, 0) / grp.length), mrr: grp.reduce((s, c) => s + (c.mrr || 0), 0), riskPct: Math.round(atRisk / grp.length * 100) };
    });
  }

  const tierMap = { smb: 'SMB', mid: 'Mid-Market', enterprise: 'Enterprise' };
  const byTier = buildGroups(c => tierMap[c.tier] || c.tier || 'Unknown');
  const byLifecycle = buildGroups(c => c.lifecycle || 'Unknown');
  const byTag = buildGroups(c => (c.tags && c.tags.length) ? c.tags : ['Untagged']);

  let html = rptHeader('Segment Analysis Report', 'Generated ' + rptDateStr() + ' &middot; ' + active.length + ' accounts') +
    segTable('By Tier', byTier) +
    segTable('By Lifecycle', byLifecycle) +
    (byTag.length ? segTable('By Tag', byTag) : '') +
    rptFooter();
  return html;
}
function printSegmentAnalysis() { const h = buildSegmentAnalysisHTML(); if (h) rptPrint(h); else toast('No customers found','warn'); }

// ── Report: Trend Report (Growth) ──
function buildTrendReportHTML() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const now = new Date();
  const d90ago = new Date(now); d90ago.setDate(d90ago.getDate() - 90);

  // Collect all history points in the last 90 days, group by date
  const dateMap = {};
  active.forEach(c => {
    (c.history || []).forEach(h => {
      if (!h.date) return;
      const d = h.date.slice(0, 10);
      if (new Date(d) < d90ago) return;
      if (!dateMap[d]) dateMap[d] = [];
      dateMap[d].push(h.score);
    });
  });

  const dates = Object.keys(dateMap).sort();
  if (!dates.length) return '';

  const rows = dates.map(d => {
    const scores = dateMap[d];
    const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
    return { date: d, entries: scores.length, avg };
  });

  // Current snapshot
  const currentAvg = active.length ? Math.round(active.reduce((s, c) => s + c.score, 0) / active.length) : 0;
  const firstAvg = rows.length ? rows[0].avg : currentAvg;
  const delta = currentAvg - firstAvg;

  const deltaColor = delta >= 0 ? '#16a34a' : '#dc2626';
  let html = rptHeader('Trend Report (90 Days)') +
    '<div class="kpi-row">' +
      '<div class="kpi"><div class="kpi-num">' + currentAvg + '</div><div class="kpi-label">Current Avg Score</div></div>' +
      '<div class="kpi"><div class="kpi-num">' + firstAvg + '</div><div class="kpi-label">90 Days Ago</div></div>' +
      '<div class="kpi" style="border-top-color:' + deltaColor + '"><div class="kpi-num" style="color:' + deltaColor + '">' + (delta >= 0 ? '+' : '') + delta + '</div><div class="kpi-label">Change</div></div>' +
      '<div class="kpi"><div class="kpi-num">' + active.length + '</div><div class="kpi-label">Active Accounts</div></div>' +
    '</div>' +
    '<h2>Average Health Score Trend</h2>' +
    svgLineChart(rows.map(r => ({label: r.date, value: r.avg}))) +
    '<h2>Score Trend by Date</h2>' +
    '<table><tr><th>Date</th><th>Scores Recorded</th><th style="text-align:right">Avg Score</th></tr>' +
    rows.map(r => '<tr><td>' + r.date + '</td><td>' + r.entries + '</td><td style="text-align:right;font-weight:700">' + r.avg + '</td></tr>').join('') +
    '</table>' + rptFooter();
  return html;
}
function printTrendReport() { const h = buildTrendReportHTML(); if (h) rptPrint(h); else toast('No score history in the last 90 days','warn'); }

// ── Report: Churn Risk Report (Growth) ──
function buildChurnRiskReportHTML() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!active.length) return '';

  // Compute composite churn risk score (0-100, higher = more at risk)
  const scored = active.map(c => {
    let risk = 0;
    // Health score (inverse, 0-30 pts)
    risk += Math.round((100 - c.score) * 0.3);
    // Negative trend (0-20 pts)
    const delta = getDelta7d(c);
    if (delta < 0) risk += Math.min(20, Math.abs(delta) * 2);
    // NPS detractor (0-15 pts)
    if (npsIsDetractor(c.nps)) risk += 15;
    else if (!npsIsPromoter(c.nps) && c.nps != null) risk += 5;
    // CSAT poor (0-10 pts)
    if (csatIsPoor(c.csat)) risk += 10;
    else if (!csatIsGood(c.csat) && c.csat != null) risk += 3;
    // Low engagement: logins (0-10 pts)
    if ((c.logins || 0) <= 2) risk += 10;
    else if ((c.logins || 0) <= 5) risk += 5;
    // Low adoption (0-10 pts)
    if ((c.adoption || 0) < 30) risk += 10;
    else if ((c.adoption || 0) < 50) risk += 5;
    // High tickets (0-5 pts)
    if ((c.tickets || 0) >= 5) risk += 5;
    // Imminent renewal (0-10 pts)
    if (c.renewal != null && c.renewal <= 2) risk += 10;
    else if (c.renewal != null && c.renewal <= 4) risk += 5;

    return { c, risk: Math.min(100, risk), impact: (c.mrr || 0) * 12 };
  }).sort((a, b) => b.risk - a.risk);

  const totalImpact = scored.reduce((s, r) => s + r.impact, 0);
  const highRisk = scored.filter(r => r.risk >= 50);

  let html = rptHeader('Churn Risk Report', 'Generated ' + rptDateStr() + ' &middot; ' + active.length + ' accounts analyzed') +
    '<div class="kpi-row">' +
      '<div class="kpi" style="border-top-color:#dc2626"><div class="kpi-num" style="color:#dc2626">' + highRisk.length + '</div><div class="kpi-label">High Risk (50+)</div></div>' +
      '<div class="kpi"><div class="kpi-num">$' + fmtNum(totalImpact) + '</div><div class="kpi-label">Total ARR Exposure</div></div>' +
      '<div class="kpi" style="border-top-color:#d97706"><div class="kpi-num" style="color:#d97706">$' + fmtNum(highRisk.reduce((s, r) => s + r.impact, 0)) + '</div><div class="kpi-label">High Risk ARR</div></div>' +
      '<div class="kpi"><div class="kpi-num">' + active.length + '</div><div class="kpi-label">Active Accounts</div></div>' +
    '</div>' +
    '<h2>Risk Distribution</h2>' +
    svgRiskBands(scored) +
    '<h2>All Accounts Ranked by Churn Risk</h2>' +
    '<table><tr><th>#</th><th>Customer</th><th>Risk Score</th><th>Health</th><th>7d Trend</th><th style="text-align:right">MRR</th><th style="text-align:right">Est. ARR</th><th>NPS</th><th>CSAT</th><th>Renewal</th></tr>' +
    scored.map((r, i) => {
      const c = r.c;
      const delta = getDelta7d(c);
      const trendStr = delta > 0 ? '+' + delta : String(delta);
      const trendColor = delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : '#64748b';
      const riskColor = r.risk >= 70 ? '#dc2626' : r.risk >= 50 ? '#d97706' : r.risk >= 30 ? '#64748b' : '#16a34a';
      return '<tr><td style="color:#94a3b8">' + (i + 1) + '</td><td><strong>' + escHtml(c.name) + '</strong></td>' +
        '<td style="font-weight:700;color:' + riskColor + '">' + r.risk + '</td>' +
        '<td style="font-weight:700;color:' + STATUS_COLOR[c.status] + '">' + c.score + '</td>' +
        '<td style="color:' + trendColor + ';font-weight:600">' + trendStr + '</td>' +
        '<td style="text-align:right">$' + fmtNum(c.mrr || 0) + '</td><td style="text-align:right">$' + fmtNum(r.impact) + '</td>' +
        '<td>' + npsDisplay(c.nps) + '</td>' +
        '<td>' + csatDisplay(c.csat) + '</td>' +
        '<td>' + (c.renewal_date ? fmtDate(c.renewal_date) : '\u2014') + '</td></tr>';
    }).join('') +
    '</table>' + rptFooter();
  return html;
}
function printChurnRiskReport() { const h = buildChurnRiskReportHTML(); if (h) rptPrint(h); else toast('No customers found','warn'); }

// ── CSV helpers ──
function csvRow(vals) { return vals.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(','); }

// Standard customer columns for pivot-table-ready CSVs
const CSV_CUST_HDR = 'name,manager,score,status,status_label,tier,lifecycle,mrr,arr,logins,adoption,tickets,nps,csat,days_since_contact,growth,renewal_date,renewal_months,tags,since,next_touch,trend_7d';
function csvCustCols(c) {
  return [c.name, c.manager || '', c.score, c.status, STATUS_LABEL[c.status] || c.status,
    c.tier || '', c.lifecycle || '', c.mrr || 0, (c.mrr || 0) * 12,
    c.logins ?? '', c.adoption ?? '', c.tickets ?? '', c.nps ?? '', c.csat ?? '',
    c.days ?? '', c.growth || '', c.renewal_date || '', c.renewal ?? '',
    (c.tags || []).join('|'), c.since || '', c.next_touch || '', getDelta7d(c)];
}

// ── Export: Portfolio Health CSV ──
function exportPortfolioCSV() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!active.length) { toast('No customers found', 'warn'); return; }
  const hdr = CSV_CUST_HDR;
  const rows = active.map(c => csvRow(csvCustCols(c)));
  dlText(hdr + '\n' + rows.join('\n'), 'portfolio-health-summary.csv', 'text/csv');
  toast('Portfolio CSV exported (' + active.length + ' accounts)', 'success');
}

// ── Export: Renewal Forecast CSV ──
function exportRenewalCSV() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c) && c.renewal_date);
  if (!active.length) { toast('No customers with renewal dates found', 'warn'); return; }
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const sorted = [...active].sort((a, b) => new Date(a.renewal_date) - new Date(b.renewal_date));
  const hdr = CSV_CUST_HDR + ',days_until_renewal,renewal_bucket';
  const rows = sorted.map(c => {
    const rd = new Date(c.renewal_date);
    const diff = Math.round((rd - now) / (1000 * 60 * 60 * 24));
    const bucket = diff <= 0 ? 'Past Due' : diff <= 30 ? '0-30 Days' : diff <= 60 ? '31-60 Days' : diff <= 90 ? '61-90 Days' : '90+ Days';
    return csvRow([...csvCustCols(c), diff, bucket]);
  });
  dlText(hdr + '\n' + rows.join('\n'), 'renewal-forecast.csv', 'text/csv');
  toast('Renewal forecast exported (' + sorted.length + ' accounts)', 'success');
}

// ── Export: CSM Performance CSV ──
function exportCSMReportCSV() {
  const active = customers.filter(c => c.lifecycle !== 'churned');
  const managers = [...new Set(active.map(c => c.manager || '').filter(Boolean))].sort();
  if (!managers.length) { toast('No managers found', 'warn'); return; }
  const hdr = 'manager,accounts,avg_score,critical_count,at_risk_count,watch_count,healthy_count,expansion_count,risk_pct,healthy_pct,mrr_managed,total_arr,avg_days_since_contact,avg_logins,avg_adoption';
  const rows = managers.map(m => {
    const grp = active.filter(c => c.manager === m);
    const n = grp.length;
    const critical = grp.filter(c => c.status === 'critical').length;
    const atRisk = grp.filter(c => c.status === 'risk').length;
    const watch = grp.filter(c => c.status === 'watch').length;
    const healthy = grp.filter(c => c.status === 'healthy').length;
    const expand = grp.filter(c => c.status === 'expand').length;
    const avgScore = n ? Math.round(grp.reduce((s, c) => s + c.score, 0) / n) : 0;
    const mrr = grp.reduce((s, c) => s + (c.mrr || 0), 0);
    const avgDays = n ? Math.round(grp.reduce((s, c) => s + (c.days || 0), 0) / n) : 0;
    const avgLogins = n ? Math.round(grp.reduce((s, c) => s + (c.logins || 0), 0) / n * 10) / 10 : 0;
    const avgAdoption = n ? Math.round(grp.reduce((s, c) => s + (c.adoption || 0), 0) / n) : 0;
    return csvRow([m, n, avgScore, critical, atRisk, watch, healthy, expand,
      n ? Math.round((critical + atRisk) / n * 100) : 0,
      n ? Math.round((healthy + expand) / n * 100) : 0,
      mrr, mrr * 12, avgDays, avgLogins, avgAdoption]);
  });
  dlText(hdr + '\n' + rows.join('\n'), 'csm-performance.csv', 'text/csv');
  toast('CSM report exported (' + managers.length + ' managers)', 'success');
}

// ── Export: Segment Analysis CSV ──
function exportSegmentCSV() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!active.length) { toast('No customers found', 'warn'); return; }
  function buildRows(type, keyFn) {
    const map = {};
    active.forEach(c => {
      const keys = keyFn(c);
      (Array.isArray(keys) ? keys : [keys]).forEach(k => {
        if (!k) return;
        if (!map[k]) map[k] = [];
        map[k].push(c);
      });
    });
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length).map(([k, grp]) => {
      const n = grp.length;
      const critical = grp.filter(c => c.status === 'critical').length;
      const atRisk = grp.filter(c => c.status === 'risk').length;
      const healthy = grp.filter(c => c.status === 'healthy').length;
      const expand = grp.filter(c => c.status === 'expand').length;
      const mrr = grp.reduce((s, c) => s + (c.mrr || 0), 0);
      return csvRow([type, k, n,
        Math.round(grp.reduce((s, c) => s + c.score, 0) / n),
        mrr, mrr * 12,
        critical, atRisk, healthy + expand,
        Math.round((critical + atRisk) / n * 100),
        Math.round((healthy + expand) / n * 100),
        Math.round(grp.reduce((s, c) => s + (c.days || 0), 0) / n),
        Math.round(grp.reduce((s, c) => s + (c.adoption || 0), 0) / n)]);
    });
  }
  const tierMap = { smb: 'SMB', mid: 'Mid-Market', enterprise: 'Enterprise' };
  const hdr = 'segment_type,segment_value,accounts,avg_score,mrr,arr,critical_count,at_risk_count,healthy_count,at_risk_pct,healthy_pct,avg_days_since_contact,avg_adoption';
  const rows = [
    ...buildRows('Tier', c => tierMap[c.tier] || c.tier || 'Unknown'),
    ...buildRows('Lifecycle', c => c.lifecycle || 'Unknown'),
    ...buildRows('Tag', c => (c.tags && c.tags.length) ? c.tags : ['Untagged']),
  ];
  dlText(hdr + '\n' + rows.join('\n'), 'segment-analysis.csv', 'text/csv');
  toast('Segment analysis exported', 'success');
}

// ── Export: Trend CSV ──
function exportTrendCSV() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const now = new Date();
  const d90ago = new Date(now); d90ago.setDate(d90ago.getDate() - 90);
  const dateMap = {};
  active.forEach(c => {
    (c.history || []).forEach(h => {
      if (!h.date) return;
      const d = h.date.slice(0, 10);
      if (new Date(d) < d90ago) return;
      if (!dateMap[d]) dateMap[d] = [];
      dateMap[d].push(h.score);
    });
  });
  const dates = Object.keys(dateMap).sort();
  if (!dates.length) { toast('No score history in last 90 days', 'warn'); return; }
  const hdr = 'date,scores_recorded,avg_score,min_score,max_score,median_score,score_spread';
  const rows = dates.map(d => {
    const scores = dateMap[d].sort((a, b) => a - b);
    const n = scores.length;
    const avg = Math.round(scores.reduce((s, v) => s + v, 0) / n);
    const min = scores[0];
    const max = scores[n - 1];
    const median = n % 2 === 0 ? Math.round((scores[n / 2 - 1] + scores[n / 2]) / 2) : scores[Math.floor(n / 2)];
    return csvRow([d, n, avg, min, max, median, max - min]);
  });
  dlText(hdr + '\n' + rows.join('\n'), 'trend-report-90d.csv', 'text/csv');
  toast('Trend report exported (' + dates.length + ' days)', 'success');
}

// ── Export: Churn Risk CSV ──
function exportChurnRiskCSV() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!active.length) { toast('No customers found', 'warn'); return; }
  const scored = active.map(c => {
    const healthPts = Math.round((100 - c.score) * 0.3);
    const delta = getDelta7d(c);
    const trendPts = delta < 0 ? Math.min(20, Math.abs(delta) * 2) : 0;
    const npsPts = npsIsDetractor(c.nps) ? 15 : (!npsIsPromoter(c.nps) && c.nps != null) ? 5 : 0;
    const csatPts = csatIsPoor(c.csat) ? 10 : (!csatIsGood(c.csat) && c.csat != null) ? 3 : 0;
    const loginPts = (c.logins || 0) <= 2 ? 10 : (c.logins || 0) <= 5 ? 5 : 0;
    const adoptPts = (c.adoption || 0) < 30 ? 10 : (c.adoption || 0) < 50 ? 5 : 0;
    const engagePts = loginPts + adoptPts;
    const ticketPts = (c.tickets || 0) >= 5 ? 5 : 0;
    const renewPts = (c.renewal != null && c.renewal <= 2) ? 10 : (c.renewal != null && c.renewal <= 4) ? 5 : 0;
    const risk = Math.min(100, healthPts + trendPts + npsPts + csatPts + engagePts + ticketPts + renewPts);
    return { c, risk, delta, impact: (c.mrr || 0) * 12, healthPts, trendPts, npsPts, csatPts, engagePts, ticketPts, renewPts };
  }).sort((a, b) => b.risk - a.risk);
  const hdr = CSV_CUST_HDR + ',risk_score,est_arr_impact,risk_health_pts,risk_trend_pts,risk_nps_pts,risk_csat_pts,risk_engagement_pts,risk_tickets_pts,risk_renewal_pts';
  const rows = scored.map(r => csvRow([...csvCustCols(r.c), r.risk, r.impact, r.healthPts, r.trendPts, r.npsPts, r.csatPts, r.engagePts, r.ticketPts, r.renewPts]));
  dlText(hdr + '\n' + rows.join('\n'), 'churn-risk-report.csv', 'text/csv');
  toast('Churn risk report exported (' + scored.length + ' accounts)', 'success');
}

// ── Print: Customer Health (all customers table) ──
function buildCustomerHealthHTML() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  if (!active.length) return '';
  const sorted = [...active].sort((a, b) => a.score - b.score);
  let html = rptHeader('Customer Health Report', 'Generated ' + rptDateStr() + ' &middot; ' + active.length + ' accounts') +
    '<table><tr><th>Customer</th><th>Manager</th><th>Score</th><th>Status</th><th>Tier</th><th style="text-align:right">MRR</th><th>Logins</th><th>Adoption</th><th>Tickets</th><th>NPS</th><th>CSAT</th></tr>' +
    sorted.map(c =>
      '<tr><td><strong>' + escHtml(c.name) + '</strong></td><td>' + escHtml(c.manager || '\u2014') + '</td>' +
      '<td style="font-weight:700;color:' + STATUS_COLOR[c.status] + '">' + c.score + '</td>' +
      '<td><span class="st-dot" style="background:' + STATUS_COLOR[c.status] + '"></span>' + STATUS_LABEL[c.status] + '</td>' +
      '<td>' + (c.tier === 'smb' ? 'SMB' : c.tier === 'mid' ? 'Mid' : c.tier === 'enterprise' ? 'Ent' : c.tier || '\u2014') + '</td>' +
      '<td style="text-align:right">$' + fmtNum(c.mrr || 0) + '</td>' +
      '<td>' + (c.logins ?? '\u2014') + '</td><td>' + (c.adoption ?? '\u2014') + '%</td>' +
      '<td>' + (c.tickets ?? '\u2014') + '</td><td>' + npsDisplay(c.nps) + '</td><td>' + csatDisplay(c.csat) + '</td></tr>'
    ).join('') +
    '</table>' + rptFooter();
  return html;
}
function printCustomerHealth() { const h = buildCustomerHealthHTML(); if (h) rptPrint(h); else toast('No customers found','warn'); }

// ── Print: Weekly Digest (formatted for PDF) ──
function printDigestReport() {
  const digestHtml = buildDigestHTML();
  if (!digestHtml) { toast('No data to generate digest', 'warn'); return; }
  // Strip the inline email styles and wrap in our report CSS
  let html = rptHeader('Weekly Health Digest') +
    '<div style="font-size:.85rem;line-height:1.6">' + digestHtml + '</div>' +
    rptFooter();
  rptPrint(html);
}


// ─── WEEKLY DIGEST (v86) ────────────────────────────────────

function showDigestPreview() {
  el('digest-preview').innerHTML = buildDigestHTML();
  openModal('digest-modal');
}

function buildDigestHTML() {
  const active = customers.filter(c => c.lifecycle !== 'churned');
  const critical = active.filter(c => c.status === 'critical').length;
  const atRisk   = active.filter(c => c.status === 'risk').length;
  const avgScore = active.length ? Math.round(active.reduce((s,c)=>s+c.score,0)/active.length) : 0;
  const totalMrr = active.reduce((s,c)=>s+(c.mrr||0),0);

  // Top at-risk (worst score first)
  const topRisk = [...active].filter(c=>c.status==='critical'||c.status==='risk')
    .sort((a,b)=>a.score-b.score).slice(0,3);

  // Upcoming renewals in next 7 days
  const now = new Date();
  const in7  = new Date(now); in7.setDate(now.getDate()+7);
  const upcoming = active.filter(c => {
    if (!c.renewal_date) return false;
    const d = new Date(c.renewal_date);
    return d >= now && d <= in7;
  }).sort((a,b)=>new Date(a.renewal_date)-new Date(b.renewal_date));

  // Score movers (need ≥2 history points)
  const withHist = active.filter(c=>(c.history||[]).length>=2);
  const deltas = withHist.map(c=>{
    const hist=c.history;
    const delta=hist[hist.length-1].score - hist[hist.length-2].score;
    return {c,delta};
  });
  const improved = [...deltas].filter(x=>x.delta>0).sort((a,b)=>b.delta-a.delta).slice(0,3);
  const dropped  = [...deltas].filter(x=>x.delta<0).sort((a,b)=>a.delta-b.delta).slice(0,3);

  const week = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  const sdot = s=>({critical:'🔴',risk:'🟠',watch:'🟡',healthy:'🟢',expand:'✨'}[s]||'⚪');

  return `<div style="max-width:580px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:linear-gradient(90deg,#2e3fa3,#4a6fd4);color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <div style="font-size:18px;font-weight:700">IQcadence CS Health Digest</div>
      <div style="font-size:12px;opacity:.8;margin-top:2px">Week of ${week}</div>
    </div>
    <div style="padding:20px 24px;background:#f8fafc;border-radius:0 0 8px 8px">

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
        ${[
          ['Total Accounts', active.length, '#1e293b'],
          ['Critical / At Risk', critical+' / '+atRisk, (critical+atRisk)>0?'#dc2626':'#16a34a'],
          ['Avg Health Score', avgScore, avgScore>=80?'#16a34a':avgScore>=65?'#d97706':'#dc2626'],
          ['Total MRR', '$'+fmtNum(totalMrr), '#2e3fa3'],
        ].map(([lbl,val,col])=>`<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:${col}">${val}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">${lbl}</div>
        </div>`).join('')}
      </div>

      ${topRisk.length?`<div style="margin-bottom:18px">
        <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">🚨 Accounts Needing Attention</div>
        ${topRisk.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9">
          <div>${sdot(c.status)} <strong>${escHtml(c.name)}</strong></div>
          <div style="font-size:12px;color:#64748b">Score ${c.score} · MRR $${fmtNum(c.mrr||0)}</div>
        </div>`).join('')}
      </div>`:``}

      ${upcoming.length?`<div style="margin-bottom:18px">
        <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">📅 Renewals This Week</div>
        ${upcoming.map(c=>{
          const days=Math.round((new Date(c.renewal_date)-now)/86400000);
          return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9">
            <div>${sdot(c.status)} <strong>${escHtml(c.name)}</strong></div>
            <div style="font-size:12px;color:#64748b">${days===0?'Today':days===1?'Tomorrow':'in '+days+'d'} · $${fmtNum(c.mrr||0)}/mo</div>
          </div>`;
        }).join('')}
      </div>`:``}

      ${(improved.length||dropped.length)?`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
        ${improved.length?`<div>
          <div style="font-size:12px;font-weight:700;color:#16a34a;margin-bottom:6px">📈 Most Improved</div>
          ${improved.map(({c,delta})=>`<div style="font-size:12px;padding:4px 0">${escHtml(c.name)} <span style="color:#16a34a;font-weight:700">+${delta}</span></div>`).join('')}
        </div>`:''}
        ${dropped.length?`<div>
          <div style="font-size:12px;font-weight:700;color:#dc2626;margin-bottom:6px">📉 Biggest Drops</div>
          ${dropped.map(({c,delta})=>`<div style="font-size:12px;padding:4px 0">${escHtml(c.name)} <span style="color:#dc2626;font-weight:700">${delta}</span></div>`).join('')}
        </div>`:''}
      </div>`:``}

      <div style="font-size:11px;color:#94a3b8;text-align:center;margin-top:8px">Generated by IQcadence CS Health Score · ${week}</div>
    </div>
  </div>`;
}

function copyDigestHTML() {
  const html = buildDigestHTML();
  navigator.clipboard.writeText(html)
    .then(()=>toast('HTML copied to clipboard','success'))
    .catch(()=>toast('Copy failed — try downloading instead','error'));
}

function downloadDigestHTML() {
  const inner = buildDigestHTML();
  const full = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CS Health Digest</title></head><body style="margin:0;padding:20px;background:#f1f5f9">${inner}</body></html>`;
  const blob = new Blob([full], { type:'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cs-digest-${new Date().toISOString().slice(0,10)}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Digest downloaded','success');
}

// ─── REPORT EMAIL / SCHEDULING ────────────────────────────────

const EMAILABLE_REPORTS = [
  { key:'weekly_digest',      label:'Weekly Health Digest',       builder: () => buildDigestHTML() },
  { key:'customer_health',    label:'Customer Health Report',     builder: () => buildCustomerHealthHTML() },
  { key:'portfolio_summary',  label:'Portfolio Health Summary',   builder: () => buildPortfolioSummaryHTML() },
  { key:'at_risk',            label:'At-Risk Report',             builder: () => buildAtRiskReportHTML() },
  { key:'renewal_forecast',   label:'Renewal Forecast Report',    builder: () => buildRenewalForecastHTML() },
  { key:'trend_report',       label:'Trend Report (90d)',         builder: () => buildTrendReportHTML() },
  { key:'churn_risk',         label:'Churn Risk Report',          builder: () => buildChurnRiskReportHTML() },
  { key:'segment_analysis',   label:'Segment Analysis Report',    builder: () => buildSegmentAnalysisHTML() },
  { key:'csm_performance',    label:'CSM Performance Report',     builder: () => buildCSMReportHTML() },
];

function wrapReportForEmail(innerHtml) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;background:#f3f4f6">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px">' +
    '<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">' +
    '<tr><td style="padding:20px 24px">' + rptPrintCSS() + innerHtml + '</td></tr>' +
    '<tr><td style="padding:0 24px 16px;font-size:11px;color:#9ca3af;text-align:center">' +
    'iQcadence CS Health Score &middot; ' + rptDateStr() +
    '</td></tr></table></td></tr></table></body></html>';
}

function buildReportEmailPayload(reportKey) {
  const def = EMAILABLE_REPORTS.find(r => r.key === reportKey);
  if (!def) return { html: null, subject: '' };
  const inner = def.builder();
  if (!inner) return { html: null, subject: '' };
  // Digest is already email-styled, others need the email wrapper with print CSS
  const html = reportKey === 'weekly_digest'
    ? '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:20px;background:#f1f5f9">' + inner + '</body></html>'
    : wrapReportForEmail(inner);
  return { html, subject: def.label + ' — ' + rptDateStr() };
}

function _getReportScheduleCfg(reportKey) {
  if (!automationsCfg.report_schedules) automationsCfg.report_schedules = {};
  if (!automationsCfg.report_schedules[reportKey]) {
    automationsCfg.report_schedules[reportKey] = {
      enabled: false, frequency: 'weekly', day: 'monday', time: '09:00',
      recipients: '', subject_prefix: '[iQcadence Report]'
    };
  }
  return automationsCfg.report_schedules[reportKey];
}

let _remKey = null; // currently open report key in the email modal

function openReportEmailPanel(reportKey) {
  _remKey = reportKey;
  const def = EMAILABLE_REPORTS.find(r => r.key === reportKey);
  const title = el('rem-title');
  if (title) title.textContent = 'Email: ' + (def ? def.label : reportKey);

  // Pre-fill recipients from alert email config if available
  const cfg = _getReportScheduleCfg(reportKey);
  if (!cfg.recipients && automationsCfg.channels?.email?.recipients) {
    cfg.recipients = automationsCfg.channels.email.recipients;
  }

  reportEmailTab('send');
  openModal('report-email-modal');
}

function reportEmailTab(which) {
  const body = el('rem-body');
  if (!body || !_remKey) return;
  const cfg = _getReportScheduleCfg(_remKey);

  const tabHtml = '<div class="dtab-row" style="margin-bottom:14px">' +
    '<button class="dtab' + (which === 'send' ? ' active' : '') + '" onclick="reportEmailTab(\'send\')">Send Now</button>' +
    '<button class="dtab' + (which === 'schedule' ? ' active' : '') + '" onclick="reportEmailTab(\'schedule\')">Schedule</button>' +
  '</div>';

  if (which === 'send') {
    body.innerHTML = tabHtml +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
        '<label style="font-size:.75rem;font-weight:600;color:var(--text)">Recipients <span style="font-weight:400;color:var(--muted)">(comma-separated emails)</span></label>' +
        '<input type="text" id="rem-recipients" class="form-input" placeholder="team@company.com, manager@company.com" value="' + escHtml(cfg.recipients || '') + '" style="font-size:.82rem"/>' +
        '<label style="font-size:.75rem;font-weight:600;color:var(--text)">Subject Prefix</label>' +
        '<input type="text" id="rem-prefix" class="form-input" placeholder="[iQcadence Report]" value="' + escHtml(cfg.subject_prefix || '[iQcadence Report]') + '" style="font-size:.82rem"/>' +
        '<div style="display:flex;gap:8px;margin-top:4px">' +
          '<button class="btn btn-primary btn-sm" onclick="sendReportEmailNow()">Send Now</button>' +
          '<button class="btn btn-outline btn-sm" onclick="sendReportEmailTest()">Send Test to Me</button>' +
        '</div>' +
        '<p style="font-size:.7rem;color:var(--muted);margin-top:4px">Send Now delivers the report to all listed recipients. Send Test sends only to your email.</p>' +
      '</div>';
  } else {
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    body.innerHTML = tabHtml +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<label style="font-size:.82rem;font-weight:600;color:var(--text)">Enable scheduled delivery</label>' +
          '<label class="toggle-switch" style="margin-left:auto"><input type="checkbox" id="rem-sched-enabled" ' + (cfg.enabled ? 'checked' : '') + ' onchange="toggleReportSchedule()"/><span class="toggle-slider"></span></label>' +
        '</div>' +
        '<div id="rem-sched-opts" style="' + (cfg.enabled ? '' : 'opacity:.5;pointer-events:none;') + 'display:flex;flex-direction:column;gap:10px">' +
          '<label style="font-size:.75rem;font-weight:600;color:var(--text)">Frequency</label>' +
          '<div style="display:flex;gap:8px">' +
            '<label style="font-size:.82rem;display:flex;align-items:center;gap:4px"><input type="radio" name="rem-freq" value="daily" ' + (cfg.frequency === 'daily' ? 'checked' : '') + '/> Daily</label>' +
            '<label style="font-size:.82rem;display:flex;align-items:center;gap:4px"><input type="radio" name="rem-freq" value="weekly" ' + (cfg.frequency !== 'daily' ? 'checked' : '') + '/> Weekly</label>' +
          '</div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
            '<div><label style="font-size:.75rem;font-weight:600;color:var(--text)">Day</label>' +
              '<select id="rem-sched-day" class="form-input" style="font-size:.82rem;margin-top:4px">' +
                days.map(d => '<option value="' + d + '"' + (cfg.day === d ? ' selected' : '') + '>' + d.charAt(0).toUpperCase() + d.slice(1) + '</option>').join('') +
              '</select></div>' +
            '<div><label style="font-size:.75rem;font-weight:600;color:var(--text)">Time</label>' +
              '<input type="time" id="rem-sched-time" class="form-input" value="' + (cfg.time || '09:00') + '" style="font-size:.82rem;margin-top:4px"/></div>' +
          '</div>' +
          '<label style="font-size:.75rem;font-weight:600;color:var(--text)">Recipients</label>' +
          '<input type="text" id="rem-sched-recip" class="form-input" placeholder="team@company.com" value="' + escHtml(cfg.recipients || '') + '" style="font-size:.82rem"/>' +
          '<label style="font-size:.75rem;font-weight:600;color:var(--text)">Subject Prefix</label>' +
          '<input type="text" id="rem-sched-prefix" class="form-input" placeholder="[iQcadence Report]" value="' + escHtml(cfg.subject_prefix || '[iQcadence Report]') + '" style="font-size:.82rem"/>' +
          '<button class="btn btn-primary btn-sm" onclick="saveReportSchedule()" style="align-self:flex-start">Save Schedule</button>' +
          '<p style="font-size:.7rem;color:var(--muted);font-style:italic;margin-top:2px">Scheduled reports are sent automatically by the server at the configured time, even if the app is not open.</p>' +
        '</div>' +
      '</div>';
  }
}

function toggleReportSchedule() {
  const opts = el('rem-sched-opts');
  const cb = el('rem-sched-enabled');
  if (opts) opts.style.opacity = cb?.checked ? '' : '.5';
  if (opts) opts.style.pointerEvents = cb?.checked ? '' : 'none';
}

function saveReportSchedule() {
  if (!_remKey) return;
  const cfg = _getReportScheduleCfg(_remKey);
  cfg.enabled = !!el('rem-sched-enabled')?.checked;
  cfg.frequency = document.querySelector('input[name="rem-freq"]:checked')?.value || 'weekly';
  cfg.day = el('rem-sched-day')?.value || 'monday';
  cfg.time = el('rem-sched-time')?.value || '09:00';
  cfg.recipients = (el('rem-sched-recip')?.value || '').trim();
  cfg.subject_prefix = (el('rem-sched-prefix')?.value || '[iQcadence Report]').trim();
  saveAutomationsCfg();
  toast('Report schedule saved', 'success');
}

async function sendReportEmailNow() {
  if (!_remKey) return;
  const recipients = (el('rem-recipients')?.value || '').trim();
  if (!recipients) { toast('Enter at least one email address', 'warn'); return; }

  // Persist recipients to config
  const cfg = _getReportScheduleCfg(_remKey);
  cfg.recipients = recipients;
  cfg.subject_prefix = (el('rem-prefix')?.value || '[iQcadence Report]').trim();
  saveAutomationsCfg();

  const { html, subject } = buildReportEmailPayload(_remKey);
  if (!html) { toast('Could not generate report — no data', 'error'); return; }
  const prefix = cfg.subject_prefix || '[iQcadence Report]';

  try {
    toast('Sending report...', 'default');
    const { data, error } = await sb.functions.invoke('send-webhook', {
      body: { mode: 'email', recipients, subject: prefix + ' ' + subject, html_body: html,
              event_type: 'report_' + _remKey, customer_id: null, customer_name: null }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    toast('Report sent to ' + recipients.split(',').length + ' recipient(s)', 'success');
  } catch(err) {
    toast('Failed to send: ' + (err.message || 'Unknown error'), 'error');
  }
}

async function sendReportEmailTest() {
  if (!_remKey || !currentUser) return;
  const email = currentUser.email;
  if (!email) { toast('No email on current user', 'error'); return; }

  const { html, subject } = buildReportEmailPayload(_remKey);
  if (!html) { toast('Could not generate report — no data', 'error'); return; }
  const prefix = (el('rem-prefix')?.value || '[iQcadence Report]').trim();

  try {
    toast('Sending test to ' + email + '...', 'default');
    const { data, error } = await sb.functions.invoke('send-webhook', {
      body: { mode: 'email', recipients: email, subject: prefix + ' ' + subject + ' (TEST)',
              html_body: html, event_type: 'report_test_' + _remKey, customer_id: null, customer_name: null }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    toast('Test report sent to ' + email, 'success');
  } catch(err) {
    toast('Failed to send test: ' + (err.message || 'Unknown error'), 'error');
  }
}

// ── Auto-send scheduled reports on app load ──
async function checkScheduledReports() {
  if (!automationsCfg.report_schedules || !currentUser) return;
  const now = new Date();
  for (const [key, cfg] of Object.entries(automationsCfg.report_schedules)) {
    if (!cfg.enabled || !cfg.recipients) continue;

    // Determine if this report is due
    const lastSent = cfg.last_sent ? new Date(cfg.last_sent) : null;
    let isDue = false;

    if (!lastSent) {
      // Never sent — due now
      isDue = true;
    } else if (cfg.frequency === 'daily') {
      // Due if last sent was before today
      const todayCutoff = new Date(now);
      const [h, m] = (cfg.time || '09:00').split(':').map(Number);
      todayCutoff.setHours(h, m, 0, 0);
      isDue = lastSent < todayCutoff && now >= todayCutoff;
    } else {
      // Weekly: due if last sent was >6 days ago AND today matches the day + past the time
      const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
      const targetDay = dayNames.indexOf(cfg.day || 'monday');
      const todayDay = now.getDay();
      if (todayDay === targetDay) {
        const [h, m] = (cfg.time || '09:00').split(':').map(Number);
        const cutoff = new Date(now);
        cutoff.setHours(h, m, 0, 0);
        isDue = now >= cutoff && (!lastSent || (now - lastSent) > 6 * 24 * 60 * 60 * 1000);
      }
    }

    if (!isDue) continue;

    // Send the report
    const def = EMAILABLE_REPORTS.find(r => r.key === key);
    if (!def) continue;

    try {
      const { html, subject } = buildReportEmailPayload(key);
      if (!html) continue;
      const prefix = cfg.subject_prefix || '[iQcadence Report]';
      const { data, error } = await sb.functions.invoke('send-webhook', {
        body: { mode: 'email', recipients: cfg.recipients, subject: prefix + ' ' + subject,
                html_body: html, event_type: 'report_scheduled_' + key, customer_id: null, customer_name: null }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Update last_sent
      cfg.last_sent = now.toISOString();
      saveAutomationsCfg();
      console.log('Scheduled report sent:', def.label, '->', cfg.recipients);
    } catch(err) {
      console.warn('Scheduled report failed:', key, err?.message || err);
    }
  }
}


// ═══════════════════════════════════════════════════════════════
// REPORTS PAGE TABS — Report Templates / Scheduled Reports
// ═══════════════════════════════════════════════════════════════

function reportsTab(which) {
  ['templates','schedules'].forEach(t => {
    el('rpt-tab-'+t)?.classList.toggle('active', t === which);
    el('rpt-pane-'+t)?.classList.toggle('active', t === which);
  });
  if (which === 'schedules') renderScheduledReports();
}

// ── Scheduled Reports Table ──

let _schedEditKey = null;

function renderScheduledReports() {
  const container = el('scheduled-reports-container');
  if (!container) return;

  const schedules = automationsCfg.report_schedules || {};
  const dayLabel = d => d ? d.charAt(0).toUpperCase() + d.slice(1) : '';

  // Show only reports that have been configured (have recipients)
  const configured = EMAILABLE_REPORTS.filter(r => {
    const cfg = schedules[r.key];
    return cfg && cfg.recipients;
  });

  if (!configured.length) {
    container.innerHTML =
      '<div style="text-align:center;padding:40px 20px">' +
        '<div style="font-size:2rem;margin-bottom:8px">\u{1F4E7}</div>' +
        '<p style="font-size:.92rem;color:var(--text);font-weight:600;margin-bottom:4px">No report schedules configured</p>' +
        '<p style="font-size:.82rem;color:var(--muted)">Switch to <strong>Report Templates</strong> and click the <strong>Email</strong> button on any report to set up a schedule.</p>' +
      '</div>';
    return;
  }

  const editSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const checkSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  const theadCols =
    '<th>Report</th>' +
    '<th>Status</th>' +
    '<th>Frequency</th>' +
    '<th>Day / Time</th>' +
    '<th>Recipients</th>' +
    '<th>Last Sent</th>' +
    '<th style="width:80px">Actions</th>';

  const rows = configured.map(r => {
    const cfg = schedules[r.key] || {};
    const isEditing = _schedEditKey === r.key;

    const enabledHtml = '<label class="toggle-switch"><input type="checkbox" ' +
      (cfg.enabled ? 'checked' : '') +
      ' onchange="toggleSchedEnabled(\'' + r.key + '\', this.checked)"/><span class="toggle-slider"></span></label>';

    const freqText = (cfg.frequency === 'daily' ? 'Daily' : 'Weekly');
    const dayTimeText = cfg.frequency === 'daily'
      ? (cfg.time || '09:00')
      : dayLabel(cfg.day || 'monday') + ' @ ' + (cfg.time || '09:00');

    const recipText = (cfg.recipients || '').length > 30
      ? escHtml(cfg.recipients.substring(0, 28)) + '&hellip;'
      : escHtml(cfg.recipients || '\u2014');

    const lastSentText = cfg.last_sent
      ? new Date(cfg.last_sent).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '\u2014';

    let inlineEditHtml = '';
    if (isEditing) {
      const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
      inlineEditHtml = '<tr><td colspan="7" style="padding:0 12px 10px">' +
        '<div class="summary-inline-edit">' +
          '<div class="inline-field">' +
            '<label>Frequency</label>' +
            '<div style="display:flex;gap:10px">' +
              '<label style="font-size:.82rem;display:flex;align-items:center;gap:4px"><input type="radio" name="sched-freq-' + r.key + '" value="daily" ' + (cfg.frequency === 'daily' ? 'checked' : '') + '/> Daily</label>' +
              '<label style="font-size:.82rem;display:flex;align-items:center;gap:4px"><input type="radio" name="sched-freq-' + r.key + '" value="weekly" ' + (cfg.frequency !== 'daily' ? 'checked' : '') + '/> Weekly</label>' +
            '</div>' +
          '</div>' +
          '<div class="inline-field">' +
            '<label>Day</label>' +
            '<select id="sched-day-' + r.key + '" class="form-input" style="font-size:.82rem;max-width:160px">' +
              days.map(d => '<option value="' + d + '"' + (cfg.day === d ? ' selected' : '') + '>' + dayLabel(d) + '</option>').join('') +
            '</select>' +
          '</div>' +
          '<div class="inline-field">' +
            '<label>Time</label>' +
            '<input type="time" id="sched-time-' + r.key + '" class="form-input" value="' + (cfg.time || '09:00') + '" style="font-size:.82rem;max-width:140px"/>' +
          '</div>' +
          '<div class="inline-field">' +
            '<label>Recipients</label>' +
            '<input type="text" id="sched-recip-' + r.key + '" class="form-input" placeholder="team@company.com" value="' + escHtml(cfg.recipients || '') + '" style="font-size:.82rem;flex:1"/>' +
          '</div>' +
          '<div class="inline-field">' +
            '<label>Subject Prefix</label>' +
            '<input type="text" id="sched-prefix-' + r.key + '" class="form-input" placeholder="[iQcadence Report]" value="' + escHtml(cfg.subject_prefix || '[iQcadence Report]') + '" style="font-size:.82rem;flex:1"/>' +
          '</div>' +
          '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">' +
            '<button class="btn btn-xs btn-ghost" style="color:var(--red)" onclick="removeReportSchedule(\'' + r.key + '\')">Remove Schedule</button>' +
            '<button class="btn btn-xs btn-primary" onclick="saveSchedInline(\'' + r.key + '\')">Save</button>' +
            '<button class="btn btn-xs btn-ghost" onclick="closeSchedInlineEdit()" style="color:var(--blue)">Done</button>' +
          '</div>' +
        '</div>' +
      '</td></tr>';
    }

    return '<tr class="' + (isEditing ? 'editing' : '') + (!cfg.enabled ? ' sched-disabled' : '') + '">' +
      '<td><strong>' + escHtml(r.label) + '</strong></td>' +
      '<td>' + enabledHtml + '</td>' +
      '<td style="font-size:.82rem">' + freqText + '</td>' +
      '<td style="font-size:.82rem;color:var(--muted)">' + dayTimeText + '</td>' +
      '<td style="font-size:.82rem;color:var(--muted);max-width:160px;overflow:hidden;text-overflow:ellipsis" title="' + escHtml(cfg.recipients || '') + '">' + recipText + '</td>' +
      '<td style="font-size:.78rem;color:var(--muted)">' + lastSentText + '</td>' +
      '<td>' +
        '<button class="btn btn-xs btn-ghost" onclick="toggleSchedInlineEdit(\'' + r.key + '\')" title="' + (isEditing ? 'Close' : 'Edit') + '">' + (isEditing ? checkSvg : editSvg) + '</button>' +
      '</td></tr>' +
      inlineEditHtml;
  }).join('');

  container.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
      '<h3 style="margin:0;font-size:1rem;font-weight:700;color:var(--text)">Scheduled Reports</h3>' +
      '<span style="font-size:.78rem;color:var(--muted)">' + configured.filter(r => (schedules[r.key] || {}).enabled).length + ' of ' + configured.length + ' active</span>' +
    '</div>' +
    '<table class="alert-summary-table">' +
      '<thead><tr>' + theadCols + '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>' +
    '<p style="font-size:.72rem;color:var(--muted);margin-top:12px;font-style:italic">To add a new schedule, switch to Report Templates and click the Email button on any report.</p>';
}

function toggleSchedInlineEdit(reportKey) {
  _schedEditKey = (_schedEditKey === reportKey) ? null : reportKey;
  renderScheduledReports();
}

function closeSchedInlineEdit() {
  _schedEditKey = null;
  renderScheduledReports();
}

function toggleSchedEnabled(reportKey, enabled) {
  if (!automationsCfg.report_schedules) automationsCfg.report_schedules = {};
  if (!automationsCfg.report_schedules[reportKey]) return;
  automationsCfg.report_schedules[reportKey].enabled = enabled;
  saveAutomationsCfg();
  renderScheduledReports();
}

function saveSchedInline(reportKey) {
  if (!automationsCfg.report_schedules) automationsCfg.report_schedules = {};
  const cfg = automationsCfg.report_schedules[reportKey];
  if (!cfg) return;

  const freqRadio = document.querySelector('input[name="sched-freq-' + reportKey + '"]:checked');
  cfg.frequency = freqRadio ? freqRadio.value : 'weekly';
  cfg.day = el('sched-day-' + reportKey)?.value || 'monday';
  cfg.time = el('sched-time-' + reportKey)?.value || '09:00';
  cfg.recipients = (el('sched-recip-' + reportKey)?.value || '').trim();
  cfg.subject_prefix = (el('sched-prefix-' + reportKey)?.value || '[iQcadence Report]').trim();

  saveAutomationsCfg();
  _schedEditKey = null;
  renderScheduledReports();
  toast('Report schedule saved', 'success');
}

function removeReportSchedule(reportKey) {
  if (!automationsCfg.report_schedules || !automationsCfg.report_schedules[reportKey]) return;
  automationsCfg.report_schedules[reportKey].enabled = false;
  automationsCfg.report_schedules[reportKey].recipients = '';
  saveAutomationsCfg();
  _schedEditKey = null;
  renderScheduledReports();
  toast('Report schedule removed', 'success');
}

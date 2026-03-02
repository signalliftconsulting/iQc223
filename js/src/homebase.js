// ─── HOME BASE ──────────────────────────────────────────────
// Strategic overview with AI-generated analytical insights.
// Different from Alerts (reactive threshold) and Dashboard (data display).
// Home Base = "Here's what the data is telling you" (narrative, pattern-based).

let _hbPeriodDays = 7; // comparison period: 7, 14, or 30

function setInsightFilter(label, ids) {
  if (!ids || !ids.length) return;
  insightFilter = { label: label, ids: new Set(ids) };
  mrrExposureFilter = null;
  filterMode = 'all';
  columnFilters = {};
  nav('customers');
  const _m = document.querySelector('main.main'); if (_m) _m.scrollTop = 0; else window.scrollTo(0, 0);
}
function clearInsightFilter() {
  insightFilter = null;
  renderCustomers();
}

// ── SVG Icon Library ──
const _hbSvg = {
  // Pulse KPI icons (18x18, white stroke for gradient cards)
  pulse: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  alertTri: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  dollar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  calendar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  // Insight category icons (16x16)
  trend: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  risk: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  renewal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  workload: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  opportunity: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>',
  engagement: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  // Empty states
  chartEmpty: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  checkCircle: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
};

// Category → icon key mapping
const _hbCatIcon = {
  'Trend': 'trend', 'Risk': 'risk', 'Renewal': 'renewal',
  'Workload': 'workload', 'Opportunity': 'opportunity', 'Engagement': 'engagement'
};

// Category → CSS class suffix
const _hbCatClass = {
  'Trend': 'trend', 'Risk': 'risk', 'Renewal': 'renewal',
  'Workload': 'workload', 'Opportunity': 'opportunity', 'Engagement': 'engagement'
};

function renderHomeBase() { try { _renderHomeBase(); } catch(e) { console.error('renderHomeBase error:', e); } }

function _renderHomeBase() {
  const wrap = el('homebase-wrap');
  if (!wrap) return;

  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const now = new Date();

  // ── Compute pulse KPIs ──
  const total     = active.length;
  const avgScore  = total ? Math.round(active.reduce((s,c) => s + c.score, 0) / total) : 0;
  const critical  = active.filter(c => c.status === 'critical');
  const risk      = active.filter(c => c.status === 'risk');
  const atRisk    = [...critical, ...risk];
  const atRiskMRR = atRisk.reduce((s,c) => s + (c.mrr || 0), 0);

  // Renewals in next 30 days
  const renewals30 = active.filter(c => {
    if (c.renewal_date) {
      const rd = new Date(c.renewal_date);
      const diff = (rd - now) / 86400000;
      return diff >= 0 && diff <= 30;
    }
    return c.renewal != null && c.renewal >= 0 && c.renewal <= 1;
  });
  const renewalsAtRisk = renewals30.filter(c => c.status === 'critical' || c.status === 'risk');

  // ── Historical comparison (period-based) ──
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - _hbPeriodDays);

  function getScoreAtCutoff(c) {
    const hist = (c.history || []).filter(h => h.date).sort((a,b) => new Date(a.date) - new Date(b.date));
    if (!hist.length) return null;
    let best = null;
    for (const h of hist) {
      if (new Date(h.date) <= cutoff) best = h;
    }
    return best ? best.score : hist[0].score;
  }

  function getDeltaPeriod(c) {
    const prev = getScoreAtCutoff(c);
    if (prev === null) return 0;
    return c.score - prev;
  }

  const withHist = active.filter(c => (c.history || []).length >= 1);
  const prevAvg = withHist.length
    ? Math.round(withHist.reduce((s,c) => s + (getScoreAtCutoff(c) || c.score), 0) / withHist.length)
    : avgScore;
  const avgDelta = avgScore - prevAvg;

  const prevAtRiskCount = withHist.filter(c => {
    const prev = getScoreAtCutoff(c);
    if (prev === null) return false;
    return prev < (thresholds?.risk || 50);
  }).length;
  const atRiskDelta = atRisk.length - prevAtRiskCount;

  const prevAtRiskMRR = withHist.filter(c => {
    const prev = getScoreAtCutoff(c);
    return prev !== null && prev < (thresholds?.risk || 50);
  }).reduce((s,c) => s + (c.mrr || 0), 0);
  const mrrDelta = atRiskMRR - prevAtRiskMRR;

  // ── Delta formatters for gradient cards (white text) ──
  const deltaArrow = (val, invert) => {
    if (val === 0) return '<span style="opacity:.5">—</span>';
    const good = invert ? val < 0 : val > 0;
    const arrow = val > 0 ? '▲' : '▼';
    return `<span class="${good ? 'up' : 'down'}">${arrow} ${Math.abs(val)}</span>`;
  };
  const deltaArrowMRR = (val) => {
    if (val === 0) return '<span style="opacity:.5">—</span>';
    const good = val < 0;
    const arrow = val > 0 ? '▲' : '▼';
    return `<span class="${good ? 'up' : 'down'}">${arrow} $${fmtNum(Math.abs(val))}</span>`;
  };

  // ── Generate insights ──
  const insights = _generateInsights(active, now, cutoff);

  // ── Build Focus list ──
  const focusList = _buildFocusList(active, now);

  // ── Build page snapshots ──
  const snapshots = _buildPageSnapshots(active, now, cutoff, atRisk, atRiskMRR, total, avgScore, renewals30);

  // ── Extra KPI values ──
  const watch   = active.filter(c => c.status === 'watch');
  const healthy = active.filter(c => c.status === 'healthy');
  const expand  = active.filter(c => c.status === 'expand');
  const totalMRR = active.reduce((s,c) => s + (c.mrr || 0), 0);
  const renewMRR = renewals30.reduce((s,c) => s + (c.mrr || 0), 0);
  const expMRR   = expand.reduce((s,c) => s + (c.mrr || 0), 0);

  // ── Render ──
  let html = '';

  // Welcome banner
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const userName = currentUser?.email ? currentUser.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const healthyCount = active.filter(c => c.status === 'healthy' || c.status === 'expand').length;
  const healthyPct = total ? Math.round(healthyCount / total * 100) : 0;
  const improving = withHist.filter(c => getDeltaPeriod(c) > 2).length;
  const declining = withHist.filter(c => getDeltaPeriod(c) < -2).length;
  const mgrLabel = mgrFilterAll ? '' : (activeManagers.size === 1 ? ` for ${[...activeManagers][0]}` : ` across ${activeManagers.size} managers`);

  // ── Deep-signal analysis for briefing ──
  // Silent decliners: were healthy/expand, now dropping fast
  const silentDecliners = withHist.filter(c => {
    const prev = getScoreAtCutoff(c);
    return prev !== null && prev >= (thresholds?.healthy || 65) && getDeltaPeriod(c) < -5;
  });
  // Contact gaps: no contact in 30+ days
  const contactGap = active.filter(c => (c.days || 0) >= 30);
  const contactGapHighVal = contactGap.filter(c => (c.mrr || 0) >= 5000);
  // Biggest single at-risk account
  const biggestRisk = atRisk.length ? atRisk.reduce((a, b) => (b.mrr || 0) > (a.mrr || 0) ? b : a) : null;
  // NPS detractors
  const detractors = active.filter(c => c.nps !== null && c.nps !== undefined && c.nps <= 6);
  // Low adoption
  const lowAdoption = active.filter(c => (c.adoption || 0) < 30 && (c.mrr || 0) > 0);
  // Manager concentration: does one CSM hold >40% of at-risk MRR?
  const mgrRisk = {};
  atRisk.forEach(c => { const m = c.manager || 'Unassigned'; mgrRisk[m] = (mgrRisk[m] || 0) + (c.mrr || 0); });
  const topRiskMgr = Object.entries(mgrRisk).sort((a,b) => b[1] - a[1])[0];
  const mgrConcentrated = topRiskMgr && atRiskMRR > 0 && topRiskMgr[1] / atRiskMRR > 0.4;

  // Build prioritized insight pool (max 2-3 signals)
  const signals = [];

  // Silent decliners — early warning, high value
  if (silentDecliners.length >= 2) {
    signals.push({ p: 1, text: `${silentDecliners.length} previously healthy accounts are now declining. Early intervention could prevent churn.` });
  } else if (silentDecliners.length === 1) {
    signals.push({ p: 1, text: `${silentDecliners[0].name} was healthy but is now declining and may need a check-in.` });
  }
  // Contact gap on high-value accounts
  if (contactGapHighVal.length > 0) {
    const gapMRR = contactGapHighVal.reduce((s,c) => s + (c.mrr||0), 0);
    signals.push({ p: 2, text: `${contactGapHighVal.length} high-value account${contactGapHighVal.length > 1 ? 's' : ''} ($${fmtNum(gapMRR)} MRR) haven't been contacted in 30+ days.` });
  } else if (contactGap.length > 5) {
    signals.push({ p: 3, text: `${contactGap.length} accounts have gone 30+ days without contact.` });
  }
  // Manager concentration risk
  if (mgrConcentrated && mgrFilterAll) {
    const pct = Math.round(topRiskMgr[1] / atRiskMRR * 100);
    signals.push({ p: 2, text: `${pct}% of at-risk MRR sits under ${topRiskMgr[0]}, creating concentrated exposure.` });
  }
  // Biggest single risk
  if (biggestRisk && biggestRisk.mrr >= 10000) {
    signals.push({ p: 3, text: `Largest at-risk account is ${biggestRisk.name} at $${fmtNum(biggestRisk.mrr)}/mo.` });
  }
  // NPS detractors
  if (detractors.length >= 3) {
    signals.push({ p: 4, text: `${detractors.length} accounts have NPS scores of 6 or below, which may signal softening sentiment.` });
  }
  // Low adoption
  if (lowAdoption.length >= 5) {
    signals.push({ p: 4, text: `${lowAdoption.length} accounts are below 30% feature adoption, a leading indicator of churn.` });
  }
  // Momentum (fallback if nothing else fires)
  if (declining > improving + 5) signals.push({ p: 5, text: `Net momentum is negative, with more accounts declining than improving this period.` });
  else if (improving > declining + 5) signals.push({ p: 5, text: `Positive momentum this period, with ${improving} accounts trending upward.` });

  // Pick top 2-3 by priority
  signals.sort((a,b) => a.p - b.p);
  const topSignals = signals.slice(0, 3);

  // Opening line
  let opener = '';
  if (healthyPct >= 80) opener = `Portfolio${mgrLabel} is strong at ${healthyPct}% healthy.`;
  else if (healthyPct >= 60) opener = `Portfolio${mgrLabel} is at ${healthyPct}% healthy, stable with room to improve.`;
  else if (healthyPct >= 40) opener = `Portfolio${mgrLabel} is at ${healthyPct}% healthy, below target.`;
  else opener = `Portfolio${mgrLabel} needs attention at only ${healthyPct}% healthy.`;

  const summaryText = opener + (topSignals.length ? ' ' + topSignals.map(s => s.text).join(' ') : '');

  html += '<div class="hb-welcome">';
  html += `<div class="hb-greeting">${greeting}${userName ? ', ' + escHtml(userName) : ''}</div>`;
  html += `<div class="hb-date">${dateStr}</div>`;
  html += `<div class="hb-summary">${summaryText}</div>`;
  html += '</div>';

  // ── 5 KPI Cards Row (from Dashboard) ──
  const _kpiIcon = (svg) => `<div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${svg}</div>`;
  const _kpiSvg = {
    people: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    alert:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    cal:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    trend:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
    dollar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'
  };

  // Health bar segment widths
  const hbPct = (arr) => total ? (arr.length / total * 100).toFixed(1) + '%' : '0%';

  html += '<div class="dash-kpi-row">';

  // Card 1: Book Health
  html += `<div class="dash-kpi-card dash-kpi-blue" onclick="nav('customers');setFilter('all')">
    <div class="dash-kpi-top">${_kpiIcon(_kpiSvg.people)}<span class="dash-kpi-label">Book Health</span></div>
    <div class="dash-kpi-num">${total}</div>
    <div class="dash-kpi-sub">Total active accounts</div>
    <div class="dash-health-bar">
      <div class="dash-health-seg" style="background:#dc2626;width:${hbPct(critical)}" title="Critical"></div>
      <div class="dash-health-seg" style="background:#ea580c;width:${hbPct(risk)}" title="At Risk"></div>
      <div class="dash-health-seg" style="background:#d97706;width:${hbPct(watch)}" title="Watch"></div>
      <div class="dash-health-seg" style="background:#16a34a;width:${hbPct(healthy)}" title="Healthy"></div>
      <div class="dash-health-seg" style="background:#0891b2;width:${hbPct(expand)}" title="Expansion"></div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
      <span class="dash-kpi-pill red">${atRisk.length} At Risk</span>
      <span class="dash-kpi-pill amber">${watch.length} Watch</span>
      <span class="dash-kpi-pill green">${healthy.length} Healthy</span>
      <span class="dash-kpi-pill teal">${expand.length} Exp.</span>
    </div>
  </div>`;

  // Card 2: Revenue at Risk
  html += `<div class="dash-kpi-card dash-kpi-red" onclick="nav('customers');setFilter('risk')">
    <div class="dash-kpi-top">${_kpiIcon(_kpiSvg.alert)}<span class="dash-kpi-label">Revenue at Risk</span></div>
    <div class="dash-kpi-num">$${fmtNum(atRiskMRR)}</div>
    <div class="dash-kpi-sub">MRR in At Risk accounts</div>
    <div style="margin-top:10px"><span class="dash-kpi-pill red">${atRisk.length} account${atRisk.length !== 1 ? 's' : ''}</span></div>
  </div>`;

  // Card 3: Upcoming Renewals
  html += `<div class="dash-kpi-card dash-kpi-teal" onclick="nav('alerts')">
    <div class="dash-kpi-top">${_kpiIcon(_kpiSvg.cal)}<span class="dash-kpi-label">Upcoming Renewals</span></div>
    <div class="dash-kpi-num">${renewals30.length}</div>
    <div class="dash-kpi-sub">Due in next 30 days</div>
    <div style="margin-top:10px"><span class="dash-kpi-pill teal">${renewMRR ? '$' + fmtNum(renewMRR) + ' at stake' : 'None due'}</span></div>
  </div>`;

  // Card 4: Expansion Opportunity
  html += `<div class="dash-kpi-card dash-kpi-green" onclick="nav('customers');setFilter('expand')">
    <div class="dash-kpi-top">${_kpiIcon(_kpiSvg.trend)}<span class="dash-kpi-label">Expansion Opportunity</span></div>
    <div class="dash-kpi-num">$${fmtNum(Math.round(expMRR * 0.2))}</div>
    <div class="dash-kpi-sub">Est. upsell potential (20%)</div>
    <div style="margin-top:10px"><span class="dash-kpi-pill green">${expand.length} account${expand.length !== 1 ? 's' : ''} ready</span></div>
  </div>`;

  // Card 5: Total MRR
  html += `<div class="dash-kpi-card dash-kpi-purple" onclick="nav('customers');setFilter('all')">
    <div class="dash-kpi-top">${_kpiIcon(_kpiSvg.dollar)}<span class="dash-kpi-label">Total MRR</span></div>
    <div class="dash-kpi-num">$${fmtNum(totalMRR)}</div>
    <div class="dash-kpi-sub">All active accounts</div>
    <div style="margin-top:10px"><span class="dash-kpi-pill" style="background:rgba(255,255,255,.2);color:#fff">Avg score ${avgScore}</span></div>
  </div>`;

  html += '</div>';

  // ── Page Snapshots (quick-glance per tab) ──
  html += '<div class="hb-snap-grid">';
  snapshots.forEach(snap => {
    html += `<div class="hb-snap-card" onclick="nav('${snap.view}')">
      <div class="hb-snap-icon" style="background:${snap.iconBg};color:${snap.iconColor}">${snap.icon}</div>
      <div class="hb-snap-body">
        <div class="hb-snap-title">${snap.title}</div>
        <div class="hb-snap-detail">${snap.detail}</div>
      </div>
      <svg class="hb-snap-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`;
  });
  html += '</div>';

  // ── Renewal Pipeline (moved from Dashboard) ──
  html += '<div class="card" style="margin-bottom:20px;padding:16px 20px">';
  html += '<div class="card-hd" style="margin-bottom:12px"><div class="hb-section-hd" style="margin-bottom:0">Renewal Pipeline</div></div>';
  html += '<div id="renewal-pipeline-wrap"></div>';
  html += '</div>';

  // ── Insights section ──
  html += '<div class="hb-section hb-section-tinted" style="margin-bottom:16px;padding-bottom:8px">';
  html += '<div class="card-hd" style="margin-bottom:12px">';
  html += '<div class="hb-section-hd" style="margin-bottom:0">Insights' + (insights.length ? ` <span class="hb-count">(${insights.length})</span>` : '') + '</div>';
  html += '<div style="display:flex;align-items:center;gap:8px">';
  html += `<select class="form-input" style="width:auto;padding:4px 10px;font-size:.76rem" onchange="_hbPeriodDays=+this.value;renderHomeBase()">
    <option value="7"${_hbPeriodDays===7?' selected':''}>7 days</option>
    <option value="14"${_hbPeriodDays===14?' selected':''}>14 days</option>
    <option value="30"${_hbPeriodDays===30?' selected':''}>30 days</option>
  </select>`;
  html += '</div></div>';

  if (!insights.length) {
    html += `<div class="hb-empty">${_hbSvg.chartEmpty}<p>Portfolio data is building — insights will appear as you score more customers and history accumulates.</p></div>`;
  } else {
    html += '<div class="hb-insights-wrap">';
    insights.forEach(ins => {
      html += _renderInsightCard(ins);
    });
    html += '</div>';
  }
  html += '</div>';

  // ── Most Improved / Biggest Drops (moved from Dashboard) ──
  html += '<div class="hb-movers-grid">';
  html += '<div class="card" style="padding:16px 20px"><div class="card-hd" style="margin-bottom:8px"><div class="hb-section-hd" style="margin-bottom:0">Most Improved</div></div><div id="wins-wrap"></div></div>';
  html += '<div class="card" style="padding:16px 20px"><div class="card-hd" style="margin-bottom:8px"><div class="hb-section-hd" style="margin-bottom:0">Biggest Drops</div></div><div id="drops-wrap"></div></div>';
  html += '</div>';

  // ── This Week's Focus ──
  html += '<div class="hb-section hb-section-warm" style="margin-bottom:16px">';
  html += '<div class="card-hd" style="margin-bottom:12px">';
  html += `<div class="hb-section-hd" style="margin-bottom:0">This Week's Focus <span class="hb-count">(${focusList.length})</span></div>`;
  html += '</div>';

  if (!focusList.length) {
    html += `<div class="hb-empty">${_hbSvg.checkCircle}<p>All clear — no urgent items this week. Your portfolio is looking good.</p></div>`;
  } else {
    html += '<div class="hb-focus-list">';
    focusList.forEach((f, i) => {
      const dotColor = _statusColor(f.status);
      html += `<div class="hb-focus-item" onclick="openDetail('${escHtml(f.id)}')">
        <span class="hb-focus-rank">${i + 1}</span>
        <div class="hb-focus-body">
          <div class="hb-focus-name"><span class="hb-focus-dot" style="background:${dotColor}"></span>${escHtml(f.name)}</div>
          <div class="hb-focus-reason">${escHtml(f.reason)}</div>
        </div>
        <div class="hb-focus-meta">
          ${f.mrr ? '<span class="hb-focus-mrr">$' + fmtNum(f.mrr) + '</span>' : ''}
          <span class="hb-focus-score" style="background:${dotColor}">${f.score}</span>
        </div>
      </div>`;
    });
    html += '</div>';
  }
  html += '</div>';

  // ── Signal Heatmap (moved from Dashboard) ──
  html += '<div class="card" style="padding:16px 20px">';
  html += '<div class="card-hd" style="margin-bottom:12px"><div class="hb-section-hd" style="margin-bottom:0">Signal Heatmap</div></div>';
  html += '<div id="heatmap-wrap" class="heatmap"></div>';
  html += '</div>';

  wrap.innerHTML = html;

  // ── Render moved Dashboard widgets into their containers ──
  if (typeof renderRenewalPipeline === 'function') {
    if (typeof hasFeature === 'function' && hasFeature('renewal_pipeline')) renderRenewalPipeline(active);
    else if (el('renewal-pipeline-wrap')) el('renewal-pipeline-wrap').innerHTML = typeof upgradeHTML === 'function' ? upgradeHTML('renewal_pipeline') : '';
  }
  if (typeof renderWins === 'function') renderWins(active);
  if (typeof renderDrops === 'function') renderDrops(active);
  if (typeof renderHeatmap === 'function') renderHeatmap(active);
}

// ═══════════════════════════════════════════════════════════════
// PAGE SNAPSHOTS — Quick-glance insight per main tab
// ═══════════════════════════════════════════════════════════════

function _buildPageSnapshots(active, now, cutoff, atRisk, atRiskMRR, total, avgScore, renewals30) {
  const s = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">';
  const snapshots = [];

  // ── Alerts snapshot ──
  try {
    const allAlerts = typeof buildAlerts === 'function' ? buildAlerts() : [];
    const activeAlerts = allAlerts.filter(a => !isSnoozed(a.id) && !isDismissed(a.id));
    const redAlerts = activeAlerts.filter(a => a.type === 'red');
    const amberAlerts = activeAlerts.filter(a => a.type === 'amber');
    let detail = '';
    if (!activeAlerts.length) {
      detail = 'All clear — no active alerts. Focus on proactive outreach.';
    } else {
      const parts = [`<strong>${activeAlerts.length}</strong> active`];
      if (redAlerts.length) parts.push(`${redAlerts.length} critical`);
      if (amberAlerts.length) parts.push(`${amberAlerts.length} warning`);
      detail = parts.join(' · ');
      // Add top-priority context
      const topAlert = activeAlerts[0];
      if (topAlert) {
        const cust = customers.find(x => x.id === topAlert.cid);
        const shortMsg = topAlert.msg.replace(/<[^>]+>/g, '').substring(0, 50);
        detail += `<br>Top: ${cust ? cust.name : shortMsg}`;
      }
    }
    snapshots.push({
      view: 'alerts', title: 'Alerts', detail,
      icon: s + '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
      iconBg: activeAlerts.length > 0 ? 'var(--red-l)' : 'var(--green-l)',
      iconColor: activeAlerts.length > 0 ? 'var(--red)' : 'var(--green)'
    });
  } catch(e) {}

  // ── Customers snapshot ──
  try {
    const healthy = active.filter(c => c.status === 'healthy' || c.status === 'expand');
    const healthyPct = total ? Math.round(healthy.length / total * 100) : 0;
    const totalMRR = active.reduce((s,c) => s + (c.mrr || 0), 0);
    let detail = `<strong>${total}</strong> active · ${healthyPct}% healthy · $${fmtNum(totalMRR)} MRR`;
    // Second line: movement or stale contacts
    const withHist = active.filter(c => (c.history || []).length >= 1);
    const improving = withHist.filter(c => _getDeltaPeriod(c, cutoff) > 2).length;
    const declining = withHist.filter(c => _getDeltaPeriod(c, cutoff) < -2).length;
    if (improving > 0 || declining > 0) {
      detail += `<br>${improving} improving, ${declining} declining this period`;
    } else {
      const stale = active.filter(c => c.days != null && c.days > 30);
      if (stale.length >= 3) detail += `<br>${stale.length} not contacted in 30+ days`;
    }
    snapshots.push({
      view: 'customers', title: 'Customers', detail,
      icon: s + '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      iconBg: 'var(--blue-l)', iconColor: 'var(--blue)'
    });
  } catch(e) {}

  // ── Segments snapshot ──
  try {
    const tags = new Set();
    active.forEach(c => (c.tags || []).forEach(t => tags.add(t)));
    const tagCount = tags.size;
    const atRiskPct = total ? Math.round(atRisk.length / total * 100) : 0;
    const tiers = {};
    active.forEach(c => {
      const t = c.tier || 'Unknown';
      if (!tiers[t]) tiers[t] = { total: 0, risk: 0 };
      tiers[t].total++;
      if (c.status === 'critical' || c.status === 'risk') tiers[t].risk++;
    });
    const tierList = Object.entries(tiers).filter(([,v]) => v.total >= 2).map(([k,v]) => ({
      name: k, pct: Math.round(v.risk/v.total*100), total: v.total, risk: v.risk
    }));
    tierList.sort((a,b) => b.pct - a.pct);
    let detail = `<strong>${tagCount}</strong> tags · ${Object.keys(tiers).length} tiers · ${atRiskPct}% at risk`;
    if (tierList.length > 0 && tierList[0].pct > 0) {
      detail += `<br>${tierList[0].name} highest risk at ${tierList[0].pct}%`;
    }
    snapshots.push({
      view: 'segments', title: 'Segments', detail,
      icon: s + '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
      iconBg: 'var(--purple-l)', iconColor: 'var(--purple)'
    });
  } catch(e) {}

  // ── Trends snapshot ──
  try {
    const withHist = active.filter(c => (c.history || []).length >= 1);
    const improving = withHist.filter(c => _getDeltaPeriod(c, cutoff) > 2).length;
    const declining = withHist.filter(c => _getDeltaPeriod(c, cutoff) < -2).length;
    let direction = 'stable';
    if (improving > declining + 2) direction = 'trending up';
    else if (declining > improving + 2) direction = 'trending down';
    let detail = `Portfolio ${direction} over ${_hbPeriodDays}d`;
    if (improving > 0 || declining > 0) {
      detail += `<br>${improving} up, ${declining} down`;
      // Add biggest mover
      let biggestDrop = null;
      withHist.forEach(c => {
        const d = _getDeltaPeriod(c, cutoff);
        if (!biggestDrop || d < biggestDrop.delta) biggestDrop = { name: c.name, delta: d };
      });
      if (biggestDrop && biggestDrop.delta < -5) detail += ` · Biggest drop: ${biggestDrop.name}`;
    }
    snapshots.push({
      view: 'trends', title: 'Trends', detail,
      icon: s + '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
      iconBg: improving >= declining ? 'var(--green-l)' : 'var(--amber-l)',
      iconColor: improving >= declining ? 'var(--green)' : 'var(--amber)'
    });
  } catch(e) {}

  // ── CSM Performance snapshot ──
  try {
    const byMgr = {};
    active.forEach(c => {
      const m = c.manager || 'Unassigned';
      if (!byMgr[m]) byMgr[m] = { count: 0, risk: 0, mrr: 0, scoreSum: 0 };
      byMgr[m].count++;
      byMgr[m].scoreSum += c.score;
      byMgr[m].mrr += (c.mrr || 0);
      if (c.status === 'critical' || c.status === 'risk') byMgr[m].risk++;
    });
    const mgrs = Object.entries(byMgr).filter(([k]) => k !== 'Unassigned');
    const csmCount = mgrs.length;
    const riskMRR = atRisk.reduce((s,c) => s + (c.mrr || 0), 0);
    let bestCsm = null, worstCsm = null;
    mgrs.forEach(([name, data]) => {
      const avg = Math.round(data.scoreSum / data.count);
      if (!bestCsm || avg > bestCsm.avg) bestCsm = { name, avg };
      if (!worstCsm || avg < worstCsm.avg) worstCsm = { name, avg };
    });
    let detail = `<strong>${csmCount}</strong> CSM${csmCount !== 1 ? 's' : ''} · $${fmtNum(riskMRR)} at risk`;
    if (bestCsm && worstCsm && csmCount >= 2 && bestCsm.name !== worstCsm.name) {
      detail += `<br>Top: ${bestCsm.name} (${bestCsm.avg}) · Low: ${worstCsm.name} (${worstCsm.avg})`;
    } else if (bestCsm) {
      detail += `<br>Top: ${bestCsm.name} (avg ${bestCsm.avg})`;
    }
    snapshots.push({
      view: 'csmperf', title: 'CSM Performance', detail,
      icon: s + '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
      iconBg: 'var(--teal-l)', iconColor: 'var(--teal)'
    });
  } catch(e) {}

  return snapshots;
}

// ── Pulse KPI Card (gradient) ──
function _pulseCard(svgIcon, label, value, delta, sub, colorClass) {
  return `<div class="hb-pulse-card ${colorClass}">
    <div class="hb-pulse-top">
      <div class="hb-pulse-icon">${svgIcon}</div>
      <span class="hb-pulse-label">${label}</span>
    </div>
    <div class="hb-pulse-value">${value}</div>
    <div class="hb-pulse-bottom">
      <span class="hb-pulse-delta">${delta}</span>
      <span class="hb-pulse-sub">${sub}</span>
    </div>
  </div>`;
}

function _statusColor(status) {
  const map = { critical:'var(--red)', risk:'var(--red)', watch:'var(--amber)', healthy:'var(--green)', expand:'var(--blue)' };
  return map[status] || 'var(--muted)';
}

// ═══════════════════════════════════════════════════════════════
// INSIGHT ENGINE — ~15 generators producing strategic observations
// ═══════════════════════════════════════════════════════════════

function _generateInsights(active, now, cutoff) {
  const insights = [];
  const generators = [
    _insightPortfolioMomentum,
    _insightWinLossBalance,
    _insightBestWorstWeek,
    _insightTierDivergence,
    _insightRiskConcentration,
    _insightEmergingRisk,
    _insightMrrAtRiskDelta,
    _insightRenewalReadiness,
    _insightRenewalRisk,
    _insightContactGaps,
    _insightWorkloadBalance,
    _insightExpansionReady,
    _insightPositiveMovers,
    _insightAdoptionCorrelation,
    _insightTicketSpike
  ];

  generators.forEach(gen => {
    try {
      const result = gen(active, now, cutoff);
      if (result) insights.push(result);
    } catch(e) { /* skip broken generators */ }
  });

  insights.sort((a,b) => a.priority - b.priority);
  return insights;
}

// ── Helper: get delta for configurable period ──
function _getDeltaPeriod(c, cutoff) {
  const hist = (c.history || []).filter(h => h.date).sort((a,b) => new Date(a.date) - new Date(b.date));
  if (!hist.length) return 0;
  let best = null;
  for (const h of hist) {
    if (new Date(h.date) <= cutoff) best = h;
  }
  const prev = best ? best.score : hist[0].score;
  return c.score - prev;
}

function _getScoreNDaysAgo(c, daysAgo) {
  const target = new Date();
  target.setDate(target.getDate() - daysAgo);
  const hist = (c.history || []).filter(h => h.date).sort((a,b) => new Date(a.date) - new Date(b.date));
  if (!hist.length) return null;
  let best = null;
  for (const h of hist) {
    if (new Date(h.date) <= target) best = h;
  }
  return best ? best.score : null;
}

// ── INSIGHT: Portfolio Momentum ──
function _insightPortfolioMomentum(active, now, cutoff) {
  const withHist = active.filter(c => (c.history || []).length >= 1);
  if (withHist.length < 3) return null;

  const deltas = withHist.map(c => _getDeltaPeriod(c, cutoff));
  const avgDelta = Math.round(deltas.reduce((s,d) => s+d, 0) / deltas.length * 10) / 10;
  if (Math.abs(avgDelta) < 1) return null;

  const improving = avgDelta > 0;
  return {
    category: 'Trend',
    priority: improving ? 3 : 1,
    title: improving
      ? `Portfolio health improved ${Math.abs(avgDelta)} pts this period`
      : `Portfolio health declined ${Math.abs(avgDelta)} pts this period`,
    detail: `Average score moved from ${Math.round(withHist.reduce((s,c) => { const prev = _getScoreNDaysAgo(c, _hbPeriodDays); return s + (prev !== null ? prev : c.score); }, 0) / withHist.length)} to ${Math.round(active.reduce((s,c) => s+c.score, 0) / active.length)} across ${withHist.length} accounts with history data.`,
    action: { label: 'View Trends', fn: "nav('trends')" }
  };
}

// ── INSIGHT: Win/Loss Balance ──
function _insightWinLossBalance(active, now, cutoff) {
  const withHist = active.filter(c => (c.history || []).length >= 1);
  if (withHist.length < 3) return null;

  const improving = withHist.filter(c => _getDeltaPeriod(c, cutoff) > 2);
  const declining = withHist.filter(c => _getDeltaPeriod(c, cutoff) < -2);
  if (improving.length === 0 && declining.length === 0) return null;

  const ratio = improving.length / Math.max(declining.length, 1);
  const net = improving.length - declining.length;

  if (Math.abs(net) < 2) return null;

  const good = net > 0;
  const allTrending = [...declining, ...improving];
  const focusIds = JSON.stringify(allTrending.map(c => c.id));
  const focusLabel = `${declining.length} declining + ${improving.length} improving accounts`;
  return {
    category: 'Trend',
    priority: good ? 4 : 2,
    title: good
      ? `${improving.length} accounts improving vs ${declining.length} declining`
      : `${declining.length} accounts declining vs ${improving.length} improving`,
    detail: good
      ? `Net positive momentum — ${ratio.toFixed(1)}x more accounts gaining health than losing it this period.`
      : `Net negative momentum — more accounts losing health than gaining. Review declining accounts for patterns.`,
    action: { label: 'View Customers', fn: `setInsightFilter('${focusLabel}',${focusIds})` }
  };
}

// ── INSIGHT: Best/Worst Week ──
function _insightBestWorstWeek(active, now, cutoff) {
  const withHist = active.filter(c => (c.history || []).length >= 2);
  if (withHist.length < 5) return null;

  const currentImprovers = withHist.filter(c => _getDeltaPeriod(c, cutoff) > 2).length;

  const periods = [2, 3, 4].map(mult => {
    const pCutoff = new Date(now);
    pCutoff.setDate(pCutoff.getDate() - _hbPeriodDays * mult);
    const pEnd = new Date(now);
    pEnd.setDate(pEnd.getDate() - _hbPeriodDays * (mult - 1));
    return withHist.filter(c => {
      const hist = (c.history || []).filter(h => h.date).sort((a,b) => new Date(a.date) - new Date(b.date));
      let atStart = null, atEnd = null;
      for (const h of hist) {
        if (new Date(h.date) <= pCutoff) atStart = h.score;
        if (new Date(h.date) <= pEnd) atEnd = h.score;
      }
      if (atStart === null || atEnd === null) return false;
      return (atEnd - atStart) > 2;
    }).length;
  });

  if (!periods.length || periods.every(p => p === 0)) return null;

  const maxPrev = Math.max(...periods);
  const avgPrev = Math.round(periods.reduce((s,p) => s+p, 0) / periods.length);

  if (currentImprovers > maxPrev && currentImprovers > 3) {
    return {
      category: 'Trend',
      priority: 3,
      title: `Best period for improvements in ${periods.length + 1} periods`,
      detail: `${currentImprovers} accounts gained health this period vs avg ${avgPrev} in prior periods. Momentum is building.`,
      action: { label: 'View Trends', fn: "nav('trends')" }
    };
  }

  const currentDecliners = withHist.filter(c => _getDeltaPeriod(c, cutoff) < -2).length;
  const prevDecliners = [2, 3, 4].map(mult => {
    const pCutoff = new Date(now);
    pCutoff.setDate(pCutoff.getDate() - _hbPeriodDays * mult);
    const pEnd = new Date(now);
    pEnd.setDate(pEnd.getDate() - _hbPeriodDays * (mult - 1));
    return withHist.filter(c => {
      const hist = (c.history || []).filter(h => h.date).sort((a,b) => new Date(a.date) - new Date(b.date));
      let atStart = null, atEnd = null;
      for (const h of hist) {
        if (new Date(h.date) <= pCutoff) atStart = h.score;
        if (new Date(h.date) <= pEnd) atEnd = h.score;
      }
      if (atStart === null || atEnd === null) return false;
      return (atEnd - atStart) < -2;
    }).length;
  });
  const maxPrevDec = Math.max(...prevDecliners);

  if (currentDecliners > maxPrevDec && currentDecliners > 3) {
    return {
      category: 'Trend',
      priority: 1,
      title: `Worst period for declines in ${prevDecliners.length + 1} periods`,
      detail: `${currentDecliners} accounts lost health this period — above the recent average. Investigate the pattern.`,
      action: { label: 'View Trends', fn: "nav('trends')" }
    };
  }

  return null;
}

// ── INSIGHT: Tier Divergence ──
function _insightTierDivergence(active) {
  const tiers = {};
  active.forEach(c => {
    const t = (c.tier || 'Unknown').toLowerCase();
    if (!tiers[t]) tiers[t] = { total: 0, atRisk: 0, label: c.tier || 'Unknown' };
    tiers[t].total++;
    if (c.status === 'critical' || c.status === 'risk') tiers[t].atRisk++;
  });

  const tierList = Object.values(tiers).filter(t => t.total >= 3);
  if (tierList.length < 2) return null;

  tierList.forEach(t => t.riskPct = Math.round(t.atRisk / t.total * 100));
  tierList.sort((a,b) => b.riskPct - a.riskPct);

  const worst = tierList[0];
  const best  = tierList[tierList.length - 1];
  const gap   = worst.riskPct - best.riskPct;

  if (gap < 15) return null;

  return {
    category: 'Risk',
    priority: 2,
    title: `${worst.label} tier underperforming at ${worst.riskPct}% at-risk`,
    detail: `${worst.label} has ${worst.riskPct}% at-risk accounts vs ${best.riskPct}% for ${best.label} — a ${gap}pt gap. Consider a tier-specific engagement strategy.`,
    action: { label: 'View Segments', fn: "nav('segments')" }
  };
}

// ── INSIGHT: Risk Concentration (by CSM) ──
function _insightRiskConcentration(active) {
  const atRisk = active.filter(c => c.status === 'critical' || c.status === 'risk');
  if (atRisk.length < 3) return null;

  const byMgr = {};
  atRisk.forEach(c => {
    const m = c.manager || 'Unassigned';
    if (!byMgr[m]) byMgr[m] = { count: 0, mrr: 0 };
    byMgr[m].count++;
    byMgr[m].mrr += (c.mrr || 0);
  });

  const managers = Object.entries(byMgr).sort((a,b) => b[1].mrr - a[1].mrr);
  const totalRiskMRR = atRisk.reduce((s,c) => s + (c.mrr || 0), 0);
  const totalMgrs = new Set(active.map(c => c.manager || 'Unassigned')).size;

  if (managers.length < 2 || totalRiskMRR < 1000) return null;

  const topMgrMRR = managers.slice(0, 2).reduce((s,m) => s + m[1].mrr, 0);
  const topPct = Math.round(topMgrMRR / totalRiskMRR * 100);

  if (topPct < 55 || totalMgrs < 3) return null;

  const topNames = managers.slice(0, 2).map(m => m[0]).join(' and ');
  return {
    category: 'Workload',
    priority: 2,
    title: `At-risk MRR concentrated with ${managers.slice(0,2).length} CSMs`,
    detail: `${topPct}% of at-risk MRR ($${fmtNum(topMgrMRR)}) sits with ${topNames}. Consider rebalancing or targeted support.`,
    action: { label: 'View CSM Performance', fn: "nav('csmperf')" }
  };
}

// ── INSIGHT: Emerging Risk (healthy but weak signals) ──
function _insightEmergingRisk(active) {
  const healthyAccts = active.filter(c => c.status === 'healthy' || c.status === 'expand');
  if (healthyAccts.length < 3) return null;

  const earlyWarning = healthyAccts.filter(c => {
    const weakSignals = [
      c.logins != null && c.logins < 5,
      c.adoption != null && c.adoption < 30,
      c.tickets != null && c.tickets >= 5,
      npsIsDetractor(c.nps),
      c.days != null && c.days > 30
    ].filter(Boolean).length;
    return weakSignals >= 2;
  });

  if (earlyWarning.length < 2) return null;
  const ewIds = JSON.stringify(earlyWarning.map(c => c.id));

  return {
    category: 'Risk',
    priority: 2,
    title: `${earlyWarning.length} healthy accounts showing early warning signals`,
    detail: `These accounts are scored healthy but have 2+ concerning metrics (low logins, low adoption, high tickets, or NPS detractor). They may be at risk of decline.`,
    action: { label: 'View Customers', fn: `setInsightFilter('${earlyWarning.length} accounts with early warnings',${ewIds})` }
  };
}

// ── INSIGHT: MRR at Risk Delta ──
function _insightMrrAtRiskDelta(active, now, cutoff) {
  const atRisk = active.filter(c => c.status === 'critical' || c.status === 'risk');
  const currentMRR = atRisk.reduce((s,c) => s + (c.mrr || 0), 0);

  const withHist = active.filter(c => (c.history || []).length >= 1);
  if (withHist.length < 5) return null;

  const prevAtRisk = withHist.filter(c => {
    const prev = _getScoreNDaysAgo(c, _hbPeriodDays);
    if (prev === null) return false;
    return prev < (thresholds?.risk || 50);
  });
  const prevMRR = prevAtRisk.reduce((s,c) => s + (c.mrr || 0), 0);
  const delta = currentMRR - prevMRR;

  if (Math.abs(delta) < 1000) return null;

  const increased = delta > 0;
  const arIds = JSON.stringify(atRisk.map(c => c.id));
  return {
    category: 'Risk',
    priority: increased ? 1 : 4,
    title: increased
      ? `At-risk MRR increased $${fmtNum(Math.abs(delta))} this period`
      : `At-risk MRR decreased $${fmtNum(Math.abs(delta))} this period`,
    detail: increased
      ? `Revenue exposure grew from $${fmtNum(prevMRR)} to $${fmtNum(currentMRR)}. New accounts entered the risk zone — review before they escalate.`
      : `Revenue exposure shrank from $${fmtNum(prevMRR)} to $${fmtNum(currentMRR)}. Recovery efforts are paying off.`,
    action: { label: 'View Customers', fn: `setInsightFilter('${atRisk.length} at-risk accounts',${arIds})` }
  };
}

// ── INSIGHT: Renewal Readiness ──
function _insightRenewalReadiness(active, now) {
  const next30 = active.filter(c => {
    if (!c.renewal_date) return c.renewal != null && c.renewal >= 0 && c.renewal <= 1;
    const diff = (new Date(c.renewal_date) - now) / 86400000;
    return diff >= 0 && diff <= 30;
  });
  if (next30.length < 2) return null;

  const avgRenewScore = Math.round(next30.reduce((s,c) => s+c.score, 0) / next30.length);
  const overallAvg = active.length ? Math.round(active.reduce((s,c) => s+c.score, 0) / active.length) : 0;
  const gap = overallAvg - avgRenewScore;

  if (gap < 5) return null;
  const rrIds = JSON.stringify(next30.map(c => c.id));

  return {
    category: 'Renewal',
    priority: gap > 15 ? 1 : 2,
    title: `Upcoming renewals score ${avgRenewScore} vs portfolio avg ${overallAvg}`,
    detail: `${next30.length} accounts renewing in the next 30 days have an average score ${gap} points below your portfolio average. Proactive outreach recommended.`,
    action: { label: 'View Customers', fn: `setInsightFilter('${next30.length} upcoming renewals',${rrIds})` }
  };
}

// ── INSIGHT: Renewal Risk ──
function _insightRenewalRisk(active, now) {
  const next30 = active.filter(c => {
    if (!c.renewal_date) return c.renewal != null && c.renewal >= 0 && c.renewal <= 1;
    const diff = (new Date(c.renewal_date) - now) / 86400000;
    return diff >= 0 && diff <= 30;
  });
  const atRiskRenewals = next30.filter(c => c.status === 'critical' || c.status === 'risk');
  if (atRiskRenewals.length < 1 || next30.length < 2) return null;

  const renewMRR = atRiskRenewals.reduce((s,c) => s + (c.mrr || 0), 0);
  const rrIds = JSON.stringify(atRiskRenewals.map(c => c.id));

  return {
    category: 'Renewal',
    priority: 1,
    title: `${atRiskRenewals.length} of ${next30.length} upcoming renewals are at-risk`,
    detail: `$${fmtNum(renewMRR)} MRR is at risk among accounts renewing in the next 30 days. These need immediate attention.`,
    action: { label: 'View Customers', fn: `setInsightFilter('${atRiskRenewals.length} at-risk renewals',${rrIds})` }
  };
}

// ── INSIGHT: Contact Gaps ──
function _insightContactGaps(active) {
  const stale = active.filter(c => c.days != null && c.days > 30);
  if (stale.length < 3) return null;

  const enterprise = stale.filter(c => (c.tier || '').toLowerCase() === 'enterprise');
  const atRiskStale = stale.filter(c => c.status === 'critical' || c.status === 'risk');

  let extra = '';
  if (enterprise.length > 0) extra += `, including ${enterprise.length} Enterprise`;
  if (atRiskStale.length > 0) extra += ` and ${atRiskStale.length} at-risk`;

  const staleIds = JSON.stringify(stale.map(c => c.id));
  return {
    category: 'Workload',
    priority: atRiskStale.length > 2 ? 2 : 3,
    title: `${stale.length} accounts not contacted in 30+ days`,
    detail: `${stale.length} accounts have gone over 30 days without contact${extra}. Regular touchpoints reduce churn risk.`,
    action: { label: 'View Customers', fn: `setInsightFilter('${stale.length} accounts with no contact 30+ days',${staleIds})` }
  };
}

// ── INSIGHT: Workload Balance ──
function _insightWorkloadBalance(active) {
  const byMgr = {};
  active.forEach(c => {
    const m = c.manager || 'Unassigned';
    if (!byMgr[m]) byMgr[m] = 0;
    byMgr[m]++;
  });
  const mgrs = Object.entries(byMgr).filter(([k]) => k !== 'Unassigned');
  if (mgrs.length < 2) return null;

  mgrs.sort((a,b) => b[1] - a[1]);
  const highest = mgrs[0];
  const lowest = mgrs[mgrs.length - 1];
  const ratio = highest[1] / Math.max(lowest[1], 1);

  if (ratio < 2.5 || highest[1] - lowest[1] < 5) return null;

  return {
    category: 'Workload',
    priority: 4,
    title: `CSM workload imbalance: ${highest[0]} has ${highest[1]} accounts`,
    detail: `${highest[0]} manages ${highest[1]} accounts vs ${lowest[0]} with ${lowest[1]} — a ${ratio.toFixed(1)}x difference. Consider rebalancing for better coverage.`,
    action: { label: 'View CSM Performance', fn: "nav('csmperf')" }
  };
}

// ── INSIGHT: Expansion Ready ──
function _insightExpansionReady(active) {
  const expanding = active.filter(c => c.status === 'expand');
  if (expanding.length < 2) return null;

  const strongEngagement = expanding.filter(c => {
    const signals = [
      c.logins != null && c.logins >= 15,
      c.adoption != null && c.adoption >= 60,
      npsIsPromoter(c.nps)
    ].filter(Boolean).length;
    return signals >= 2;
  });

  if (strongEngagement.length < 2) return null;
  const totalMRR = strongEngagement.reduce((s,c) => s + (c.mrr || 0), 0);
  const seIds = JSON.stringify(strongEngagement.map(c => c.id));

  return {
    category: 'Opportunity',
    priority: 3,
    title: `${strongEngagement.length} accounts ready for expansion`,
    detail: `${strongEngagement.length} Expand-status accounts have strong engagement signals (high logins, adoption, and NPS). Combined MRR: $${fmtNum(totalMRR)} — upsell candidates.`,
    action: { label: 'View Customers', fn: `setInsightFilter('${strongEngagement.length} expansion-ready accounts',${seIds})` }
  };
}

// ── INSIGHT: Positive Movers ──
function _insightPositiveMovers(active, now, cutoff) {
  const movedUp = active.filter(c => {
    const prev = _getScoreNDaysAgo(c, _hbPeriodDays);
    if (prev === null) return false;
    const prevStatus = getStatus(prev);
    return (prevStatus === 'watch' || prevStatus === 'risk') && (c.status === 'healthy' || c.status === 'expand');
  });

  if (movedUp.length < 1) return null;
  const muIds = JSON.stringify(movedUp.map(c => c.id));

  return {
    category: 'Opportunity',
    priority: 4,
    title: `${movedUp.length} account${movedUp.length > 1 ? 's' : ''} improved to Healthy this period`,
    detail: `${movedUp.map(c => c.name).slice(0, 4).join(', ')}${movedUp.length > 4 ? ' +' + (movedUp.length - 4) + ' more' : ''} moved out of Watch/Risk into Healthy or Expand status.`,
    action: { label: 'View Customers', fn: `setInsightFilter('${movedUp.length} recently improved accounts',${muIds})` }
  };
}

// ── INSIGHT: Adoption Correlation ──
function _insightAdoptionCorrelation(active) {
  const withAdoption = active.filter(c => c.adoption != null);
  if (withAdoption.length < 5) return null;

  const lowAdoption = withAdoption.filter(c => c.adoption < 30);
  const lowAdoptionAtRisk = lowAdoption.filter(c => c.status === 'critical' || c.status === 'risk');

  if (lowAdoption.length < 3) return null;

  const riskRate = Math.round(lowAdoptionAtRisk.length / lowAdoption.length * 100);
  const overallRiskRate = Math.round(active.filter(c => c.status === 'critical' || c.status === 'risk').length / active.length * 100);

  if (riskRate <= overallRiskRate + 10) return null;

  const multiplier = (riskRate / Math.max(overallRiskRate, 1)).toFixed(1);
  const laIds = JSON.stringify(lowAdoption.map(c => c.id));

  return {
    category: 'Engagement',
    priority: 3,
    title: `Low adoption accounts are ${multiplier}x more likely to be at-risk`,
    detail: `${lowAdoption.length} accounts with <30% adoption have a ${riskRate}% at-risk rate vs ${overallRiskRate}% overall. Driving adoption could prevent future churn.`,
    action: { label: 'View Customers', fn: `setInsightFilter('${lowAdoption.length} low-adoption accounts',${laIds})` }
  };
}

// ── INSIGHT: Ticket Spike ──
function _insightTicketSpike(active) {
  const highTickets = active.filter(c => c.tickets != null && c.tickets >= 5);
  if (highTickets.length < 2) return null;

  const withTickets = active.filter(c => c.tickets != null);
  if (withTickets.length < 5) return null;

  const avgTickets = Math.round(withTickets.reduce((s,c) => s + c.tickets, 0) / withTickets.length * 10) / 10;

  return {
    category: 'Engagement',
    priority: highTickets.some(c => c.status === 'critical' || c.status === 'risk') ? 2 : 3,
    title: `${highTickets.length} accounts have 5+ open tickets`,
    detail: `These accounts have elevated ticket volume (portfolio avg: ${avgTickets}). High ticket counts often precede health declines — review for patterns.`,
    action: { label: 'View Customers', fn: `setInsightFilter('${highTickets.length} accounts with 5+ tickets',${JSON.stringify(highTickets.map(c=>c.id))})` }
  };
}

// ═══════════════════════════════════════════════════════════════
// THIS WEEK'S FOCUS — Top 5 urgent accounts
// ═══════════════════════════════════════════════════════════════

function _buildFocusList(active, now) {
  const scored = active.map(c => {
    let urgency = 0;
    let reasons = [];

    if (c.status === 'critical') { urgency += 40; reasons.push('critical status'); }
    else if (c.status === 'risk') { urgency += 25; reasons.push('at-risk'); }

    let renewDays = null;
    if (c.renewal_date) {
      renewDays = Math.round((new Date(c.renewal_date) - now) / 86400000);
    } else if (c.renewal != null) {
      renewDays = Math.round(c.renewal * 30);
    }
    if (renewDays != null && renewDays >= 0 && renewDays <= 30) {
      urgency += 30 - renewDays;
      reasons.push(`renewal in ${renewDays}d`);
    }

    const delta = getDelta7d(c);
    if (delta < -10) { urgency += 20; reasons.push(`score dropped ${Math.abs(delta)}pts`); }
    else if (delta < -5) { urgency += 10; reasons.push(`score dropped ${Math.abs(delta)}pts`); }

    if (c.days != null && c.days > 30) {
      urgency += Math.min(c.days / 3, 15);
      reasons.push(`no contact ${c.days} days`);
    }

    if (c.tickets != null && c.tickets >= 5) {
      urgency += c.tickets * 2;
      reasons.push(`${c.tickets} open tickets`);
    }

    if (npsIsDetractor(c.nps)) {
      urgency += 10;
      reasons.push('NPS detractor');
    }

    if (c.mrr > 0) urgency += Math.min(c.mrr / 1000, 10);

    return {
      id: c.id, name: c.name, score: c.score, status: c.status,
      mrr: c.mrr, urgency, reason: reasons.slice(0, 3).join(', ')
    };
  });

  return scored
    .filter(s => s.urgency > 10)
    .sort((a,b) => b.urgency - a.urgency)
    .slice(0, 5);
}

// ── Render a single insight card ──
function _renderInsightCard(ins) {
  const catColors = {
    'Trend':       { bg: 'var(--blue-l)',   border: 'var(--blue-m)',   text: 'var(--blue)' },
    'Risk':        { bg: 'var(--red-l)',     border: 'var(--red-m)',    text: 'var(--red)' },
    'Renewal':     { bg: 'var(--purple-l)',  border: 'var(--purple-m)', text: 'var(--purple)' },
    'Workload':    { bg: 'var(--amber-l)',   border: 'var(--amber-m)',  text: 'var(--amber)' },
    'Opportunity': { bg: 'var(--green-l)',   border: 'var(--green-m)',  text: 'var(--green)' },
    'Engagement':  { bg: 'var(--teal-l)',    border: 'var(--teal-m)',   text: 'var(--teal)' },
  };
  const c = catColors[ins.category] || catColors['Trend'];
  const catClass = _hbCatClass[ins.category] || 'trend';
  const iconKey = _hbCatIcon[ins.category] || 'trend';
  const iconSvg = _hbSvg[iconKey] || _hbSvg.trend;

  // Priority class for background tinting
  const pClass = ins.priority <= 1 ? ' hb-p1' : ins.priority <= 2 ? ' hb-p2' : '';

  return `<div class="hb-insight-card hb-cat-${catClass}${pClass}">
    <div class="hb-insight-icon ic-${catClass}">${iconSvg}</div>
    <div class="hb-insight-body">
      <div class="hb-insight-top">
        <span class="hb-insight-cat" style="background:${c.bg};color:${c.text};border:1px solid ${c.border}">${ins.category}</span>
        <span class="hb-insight-title">${escHtml(ins.title)}</span>
      </div>
      <div class="hb-insight-detail">${escHtml(ins.detail)}</div>
      ${ins.action ? `<button class="hb-insight-action" onclick="${ins.action.fn.replace(/"/g,'&quot;')}">${ins.action.label} →</button>` : ''}
    </div>
  </div>`;
}

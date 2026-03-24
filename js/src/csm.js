// ─── CSM PERFORMANCE DASHBOARD ───────────────────────────────
let _csmSortKey = 'perfIndex';
let _csmSortDir = -1;
let _csmSearch = '';

function sortCSMTable(key) {
  if (_csmSortKey === key) _csmSortDir *= -1;
  else { _csmSortKey = key; _csmSortDir = (key === 'name') ? 1 : -1; }
  renderCSMPerformance();
}

function csmSearchFilter(val) {
  _csmSearch = (val || '').toLowerCase();
  renderCSMPerformance();
}

function renderCSMPerformance() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const statsWrap  = el('csmperf-stats');
  const tableWrap  = el('csmperf-wrap');
  if (!statsWrap || !tableWrap) return;

  // Empty state when no customers loaded
  if (!customers.length) {
    statsWrap.innerHTML = '';
    tableWrap.innerHTML = '<div class="empty-state" style="text-align:center;padding:80px 20px;color:#64748b"><div style="font-size:48px;margin-bottom:16px;opacity:.4">\uD83D\uDC64</div><h3 style="font-size:18px;color:#1e293b;margin-bottom:8px">No data yet</h3><p style="font-size:14px;margin-bottom:20px">Add customers or load demo data to get started.</p><button class="btn btn-sm btn-primary" data-action="nav" data-arg="homebase">Go to Home Base</button></div>';
    return;
  }

  // Gather all managers
  const mgrs = {};
  active.forEach(c => {
    const key = c.manager ? c.manager.trim() : 'Unassigned';
    if (!mgrs[key]) mgrs[key] = [];
    mgrs[key].push(c);
  });

  const mgrList = Object.entries(mgrs).map(([name, accs]) => {
    const count    = accs.length;
    const totalMRR = accs.reduce((s, c) => s + (c.mrr || 0), 0);
    const totalARR = accs.reduce((s, c) => s + (c.arr || c.mrr * 12 || 0), 0);
    const avgScore = count ? Math.round(accs.reduce((s, c) => s + c.score, 0) / count) : 0;
    const healthy  = accs.filter(c => c.status === 'healthy' || c.status === 'expand').length;
    const watch    = accs.filter(c => c.status === 'watch').length;
    const atRisk   = accs.filter(c => c.status === 'critical' || c.status === 'risk').length;
    const riskMRR  = accs.filter(c => c.status === 'critical' || c.status === 'risk').reduce((s, c) => s + (c.mrr || 0), 0);
    const expand   = accs.filter(c => c.status === 'expand').length;

    // Average days since last contact
    const contactDays = accs.filter(c => c.days != null);
    const avgDays  = contactDays.length ? Math.round(contactDays.reduce((s, c) => s + c.days, 0) / contactDays.length) : null;

    // Renewals within 90 days
    const renewals90 = accs.filter(c => c.renewal != null && c.renewal > 0 && c.renewal <= 3).length;

    // 7-day portfolio trend (average delta across accounts)
    const deltas = accs.map(c => getDelta7d(c));
    const avgDelta = count ? Math.round(deltas.reduce((s, d) => s + d, 0) / count * 10) / 10 : 0;

    // Overdue contacts (14+ days)
    const overdueCount = accs.filter(c => c.days != null && c.days >= 14).length;

    // Health ratio (% healthy+expand)
    const healthPct = count ? Math.round((healthy / count) * 100) : 0;

    // Composite performance index (0–100)
    //   40% avg score, 25% health ratio, 20% inverse risk ratio, 15% contact cadence
    const riskPct     = count ? (atRisk / count) : 0;
    const contactScore = avgDays != null ? Math.max(0, 100 - (avgDays * 3)) : 50; // penalize high days
    const perfIndex = Math.round(
      (avgScore * 0.40) +
      (healthPct * 0.25) +
      ((1 - riskPct) * 100 * 0.20) +
      (contactScore * 0.15)
    );

    return { name, accs, count, totalMRR, totalARR, avgScore, healthy, watch, atRisk, riskMRR, expand, avgDays, renewals90, avgDelta, overdueCount, healthPct, perfIndex };
  });

  // Rank by performance index (exclude Unassigned from ranking)
  const ranked = mgrList.filter(m => m.name !== 'Unassigned').sort((a, b) => b.perfIndex - a.perfIndex);
  ranked.forEach((m, i) => { m.rank = i + 1; });
  const unassigned = mgrList.find(m => m.name === 'Unassigned');
  if (unassigned) unassigned.rank = null;
  // Display order: ranked CSMs first, then Unassigned at bottom
  const displayList = unassigned ? [...ranked, unassigned] : ranked;

  // --- Top-level summary stats ---
  const totalCSMs     = ranked.length;
  const totalAccounts = active.length;
  const totalMRR      = active.reduce((s, c) => s + (c.mrr || 0), 0);
  const overallAvg    = totalAccounts ? Math.round(active.reduce((s, c) => s + c.score, 0) / totalAccounts) : 0;
  const totalAtRisk   = active.filter(c => c.status === 'critical' || c.status === 'risk').length;
  const totalHealthy  = active.filter(c => c.status === 'healthy' || c.status === 'expand').length;
  const overallDelta  = totalAccounts ? Math.round(active.reduce((s, c) => s + getDelta7d(c), 0) / totalAccounts * 10) / 10 : 0;
  const totalOverdue  = active.filter(c => c.days != null && c.days >= 14).length;
  const avgAccsPerCSM = totalCSMs ? Math.round(totalAccounts / totalCSMs) : 0;

  const deltaIcon  = overallDelta > 0 ? '▲' : overallDelta < 0 ? '▼' : ' -';
  const deltaColor = overallDelta > 0 ? 'var(--green)' : overallDelta < 0 ? 'var(--red)' : 'var(--muted)';

  const _si = (path) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const CSM_ICONS = {
    people:  _si('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    chart:   _si('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),
    dollar:  _si('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
    pulse:   _si('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
    alert:   _si('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  };

  const riskMRRTotal = active.filter(c=>c.status==='critical'||c.status==='risk').reduce((s,c)=>s+(c.mrr||0),0);
  const healthScoreGradient = overallAvg >= 65 ? 'dash-kpi-green' : overallAvg >= 50 ? 'dash-kpi-teal' : 'dash-kpi-red';
  const riskGradient = 'dash-kpi-red';

  const avgMRRPerCSM = totalCSMs ? Math.round(totalMRR / totalCSMs) : 0;
  const avgAtRiskPerCSM = totalCSMs ? (totalAtRisk / totalCSMs).toFixed(1).replace(/\.0$/, '') : 0;
  const overdueGradient = totalOverdue > 0 ? 'dash-kpi-red' : 'dash-kpi-green';

  // Dynamic number colors (headers stay static)
  const _csmAvgValColor = overallAvg >= 65 ? '#16a34a' : overallAvg >= 50 ? '#d97706' : '#dc2626';
  const _csmOverdueValColor = totalOverdue > 0 ? '#dc2626' : '#16a34a';
  const healthyPct = totalAccounts ? Math.round((totalHealthy / totalAccounts) * 100) : 0;
  const _csmHealthyPctColor = healthyPct >= 70 ? '#16a34a' : healthyPct >= 50 ? '#d97706' : '#dc2626';
  const _csmAtRiskColor = totalAtRisk > 0 ? '#dc2626' : '#16a34a';
  const atRiskGradient = totalAtRisk > 0 ? 'dash-kpi-red' : 'dash-kpi-green';
  const healthyPctGradient = healthyPct >= 70 ? 'dash-kpi-green' : healthyPct >= 50 ? 'dash-kpi-teal' : 'dash-kpi-red';

  const CSM_ICONS_EXTRA = {
    shield: _si('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
    heart:  _si('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'),
  };

  statsWrap.innerHTML = `
    <div class="dash-kpi-card dash-kpi-blue">
      <div class="dash-kpi-hd"><div class="dash-kpi-icon">${CSM_ICONS.people}</div><span class="dash-kpi-label">Active CSMs <span class="info-tip tip-below" data-tip="Customer Success Managers with assigned accounts.">\u24d8</span></span></div>
      <div class="dash-kpi-body"><div class="dash-kpi-num">${totalCSMs}</div><div class="dash-kpi-sub">${totalAccounts} accounts across team</div></div>
    </div>
    <div class="dash-kpi-card dash-kpi-purple">
      <div class="dash-kpi-hd"><div class="dash-kpi-icon">${CSM_ICONS.chart}</div><span class="dash-kpi-label">Avg Book Size <span class="info-tip tip-below" data-tip="Average number of accounts managed per CSM.">\u24d8</span></span></div>
      <div class="dash-kpi-body"><div class="dash-kpi-num">${avgAccsPerCSM}</div><div class="dash-kpi-sub">accounts per CSM</div></div>
    </div>
    <div class="dash-kpi-card dash-kpi-teal">
      <div class="dash-kpi-hd"><div class="dash-kpi-icon">${CSM_ICONS.dollar}</div><span class="dash-kpi-label">Avg MRR / CSM <span class="info-tip tip-below" data-tip="Average monthly recurring revenue managed per CSM.">\u24d8</span></span></div>
      <div class="dash-kpi-body"><div class="dash-kpi-num">$${fmtNum(avgMRRPerCSM)}</div><div class="dash-kpi-sub">$${fmtNum(totalMRR)} total portfolio</div></div>
    </div>
    <div class="dash-kpi-card ${healthyPctGradient}">
      <div class="dash-kpi-hd"><div class="dash-kpi-icon">${CSM_ICONS_EXTRA.heart}</div><span class="dash-kpi-label">Healthy Rate <span class="info-tip tip-below" data-tip="Percentage of accounts in healthy or expansion status. Green >= 70%, amber 50-69%, red < 50%.">\u24d8</span></span></div>
      <div class="dash-kpi-body"><div class="dash-kpi-num" style="color:${_csmHealthyPctColor}">${healthyPct}%</div><div class="dash-kpi-sub">${totalHealthy} of ${totalAccounts} accounts healthy</div></div>
    </div>
    <div class="dash-kpi-card ${overdueGradient}">
      <div class="dash-kpi-hd"><div class="dash-kpi-icon">${CSM_ICONS.alert}</div><span class="dash-kpi-label">Overdue Contacts <span class="info-tip tip-below" data-tip="Customers not contacted within the required interval. Red when any are overdue.">\u24d8</span></span></div>
      <div class="dash-kpi-body"><div class="dash-kpi-num" style="color:${_csmOverdueValColor}">${totalOverdue}</div><div class="dash-kpi-sub">${totalOverdue ? avgAtRiskPerCSM + ' at-risk per CSM' : 'All contacts current'}</div></div>
    </div>
  `;

  // --- No CSMs ---
  if (displayList.length === 0 || (displayList.length === 1 && displayList[0].name === 'Unassigned')) {
    tableWrap.innerHTML = `<div class="empty-st"><div class="ei">${appIcon('users',36)}</div><h3>No CSMs assigned yet</h3><p>Assign managers to customers via the Customer detail panel.</p></div>`;
    return;
  }

  // --- Helpers ---
  const hmColor = v => v >= 65 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)';
  const hmBg    = v => v >= 65 ? 'var(--green-l)' : v >= 50 ? 'var(--amber-l)' : 'var(--red-l)';
  const rankBadge = r => {
    if (r === null) return '';
    const cls = r === 1 ? 'gold' : r === 2 ? 'silver' : r === 3 ? 'bronze' : 'default';
    return `<span class="csm-rank ${cls}">#${r}</span>`;
  };
  const trendBadge = d => {
    if (d > 0) return `<span class="csm-trend up">▲ +${d}</span>`;
    if (d < 0) return `<span class="csm-trend dn">▼ ${d}</span>`;
    return `<span class="csm-trend flat"> - 0</span>`;
  };
  const healthBar = m => {
    const total = m.count || 1;
    const hPct = Math.round((m.healthy / total) * 100);
    const wPct = Math.round((m.watch / total) * 100);
    const rPct = 100 - hPct - wPct;
    return `<div class="csm-health-bar" title="${m.healthy} healthy · ${m.watch} watch · ${m.atRisk} at risk">
      <span style="width:${hPct}%;background:var(--green)"></span>
      <span style="width:${wPct}%;background:var(--amber)"></span>
      <span style="width:${rPct}%;background:var(--red)"></span>
    </div>`;
  };

  // Apply search filter
  let filteredList = displayList;
  if (_csmSearch) {
    filteredList = displayList.filter(m => m.name.toLowerCase().includes(_csmSearch));
  }

  // Apply sort
  const sortedList = [...filteredList].sort((a, b) => {
    const key = _csmSortKey;
    let va, vb;
    if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); return va < vb ? -_csmSortDir : va > vb ? _csmSortDir : 0; }
    va = key === 'avgDays' ? (a[key] ?? 999) : (a[key] || 0);
    vb = key === 'avgDays' ? (b[key] ?? 999) : (b[key] || 0);
    return (va - vb) * _csmSortDir;
  });

  // Re-rank after sort
  let rankN = 1;
  sortedList.forEach(m => { if (m.name !== 'Unassigned') m.rank = rankN++; });

  // --- CSM Leaderboard Table ---
  const colCount = 12;
  const sArr = (key) => _csmSortKey === key ? (_csmSortDir > 0 ? ' ▲' : ' ▼') : '';
  const sHd = (key, label) => `<th style="cursor:pointer;user-select:none" onclick="sortCSMTable('${key}')">${label}${sArr(key)}</th>`;
  tableWrap.innerHTML = `
    <div style="margin-bottom:8px"><input type="text" placeholder="Search CSMs…" value="${escHtml(_csmSearch)}" oninput="csmSearchFilter(this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:var(--fs-base);width:220px"/></div>
    <div class="csm-perf-table-wrap"><table class="ct" id="csm-perf-table">
    <thead><tr>
      ${sHd('rank','Rank')}
      ${sHd('name','CSM')}
      ${sHd('avgScore','Score')}
      ${sHd('perfIndex','Perf Index')}
      ${sHd('avgDelta','Trend (7d)')}
      <th>Health Mix</th>
      ${sHd('count','Accounts')}
      ${sHd('totalMRR','MRR Managed')}
      ${sHd('riskMRR','At-Risk MRR')}
      ${sHd('avgDays','Avg Contact')}
      ${sHd('renewals90','Renewals ≤90d')}
      <th></th>
    </tr></thead>
    <tbody id="csm-perf-tbody">${sortedList.map(m => {
      const contactWarn = m.avgDays != null && m.avgDays >= 14;
      const safeName = escHtml(m.name).replace(/'/g, "\\'");
      return `<tr data-csm="${escHtml(m.name)}" class="csm-row">
      <td style="text-align:center">${rankBadge(m.rank)}</td>
      <td><strong><a href="#" onclick="event.preventDefault();event.stopPropagation();filterByManager('${safeName}')" style="color:inherit;text-decoration:none" onmouseover="this.style.color='var(--teal)'" onmouseout="this.style.color='inherit'">${escHtml(m.name)}</a></strong>${m.overdueCount ? ` <span style="font-size:var(--fs-xs);color:var(--red);font-weight:700">${m.overdueCount} overdue</span>` : ''}</td>
      <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:var(--fs-base);font-weight:700;color:${hmColor(m.avgScore)};background:${hmBg(m.avgScore)}">${m.avgScore}</span></td>
      <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:var(--fs-base);font-weight:700;color:${hmColor(m.perfIndex)};background:${hmBg(m.perfIndex)}">${m.perfIndex}</span></td>
      <td>${trendBadge(m.avgDelta)}</td>
      <td>${healthBar(m)}</td>
      <td>${m.count}</td>
      <td>$${fmtNum(m.totalMRR)}</td>
      <td style="color:${m.riskMRR ? 'var(--red)' : 'var(--muted)'};font-weight:${m.riskMRR ? '700' : '400'}">$${fmtNum(m.riskMRR)}</td>
      <td style="color:${contactWarn?'var(--red)':'inherit'};font-weight:${contactWarn?'700':'400'}">${m.avgDays != null ? m.avgDays + 'd' : ' -'}</td>
      <td>${m.renewals90 || ' -'}</td>
      <td><button class="btn btn-xs btn-ghost csm-expand-btn" data-csm="${escHtml(m.name)}" onclick="drillCSM('${safeName}')"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Expand</button></td>
    </tr>`}).join('')}</tbody>
  </table></div>`;
  // Store mgrList for drilldown access
  window._csmPerfData = displayList;
  window._csmColCount = colCount;

  // Render the 4 insight panels
  renderCSMWorkload(displayList);
  renderCSMFocus(displayList);
  renderCSMMovement(displayList);
  renderCSMActivity(displayList);
}

/* ─── WORKLOAD BALANCE ─────────────────────────────────────────── */
const TIER_COLORS = { enterprise: 'var(--blue)', mid: 'var(--purple)', smb: 'var(--teal)' };
const TIER_LABELS = { enterprise: 'Enterprise', mid: 'Mid-Market', smb: 'SMB' };

function renderCSMWorkload(mgrList) {
  const wrap = el('csm-workload-wrap');
  if (!wrap) return;
  const list = mgrList.filter(m => m.name !== 'Unassigned');
  if (!list.length) { wrap.innerHTML = '<p style="padding:20px;text-align:center;color:var(--muted);font-size:var(--fs-base)">No CSMs to display.</p>'; return; }

  const maxAccounts = Math.max(...list.map(m => m.count), 1);
  const maxMRR      = Math.max(...list.map(m => m.totalMRR), 1);
  const avgAccounts = Math.round(list.reduce((s,m) => s + m.count, 0) / list.length);

  // Detect which tiers are actually present
  const activeTiers = ['enterprise','mid','smb'].filter(t => list.some(m => m.accs.some(c => (c.tier || 'smb') === t)));

  wrap.innerHTML = `
    <div style="padding:10px 16px 4px;display:flex;gap:16px;font-size:var(--fs-xs);font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">
      <span style="flex:0 0 110px">CSM</span>
      <span style="flex:1">Accounts</span>
      <span style="flex:1">MRR by Tier</span>
    </div>
    ${list.sort((a,b) => b.count - a.count).map(m => {
      const accPct = Math.round((m.count / maxAccounts) * 100);
      const overloaded = m.count > avgAccounts * 1.4;
      const accColor = overloaded ? 'var(--red)' : 'var(--green)';
      // Tier MRR breakdown
      const tierMRR = {};
      m.accs.forEach(c => { const t = (c.tier || 'smb').toLowerCase(); tierMRR[t] = (tierMRR[t] || 0) + (c.mrr || 0); });
      const mTotal = m.totalMRR || 1;
      const mrrPct = Math.round((m.totalMRR / maxMRR) * 100);
      const entPct = Math.round((tierMRR.enterprise || 0) / mTotal * 100);
      const midPct = Math.round((tierMRR.mid || 0) / mTotal * 100);
      const smbPct = Math.max(0, 100 - entPct - midPct);
      const tierTitle = [
        tierMRR.enterprise ? 'Enterprise $' + fmtNum(tierMRR.enterprise) : '',
        tierMRR.mid ? 'Mid-Market $' + fmtNum(tierMRR.mid) : '',
        tierMRR.smb ? 'SMB $' + fmtNum(tierMRR.smb) : ''
      ].filter(Boolean).join(' · ');
      return `<div class="csm-workload-row" style="cursor:pointer" onclick="filterByManager('${escHtml(m.name).replace(/'/g,"\\'")}')">
        <div class="csm-workload-name">${escHtml(m.name)}</div>
        <div style="flex:1;display:flex;align-items:center;gap:8px">
          <div class="csm-workload-bar"><div class="csm-workload-fill" style="width:${accPct}%;background:${accColor}">${m.count}</div></div>
        </div>
        <div style="flex:1;display:flex;align-items:center;gap:8px">
          <div class="csm-workload-bar" style="position:relative;overflow:hidden" title="${tierTitle}">
            <div style="display:flex;width:${mrrPct}%;height:100%;border-radius:inherit">
              ${entPct ? `<span style="width:${entPct}%;background:var(--blue);min-width:0"></span>` : ''}
              ${midPct ? `<span style="width:${midPct}%;background:var(--purple);min-width:0"></span>` : ''}
              ${smbPct ? `<span style="width:${smbPct}%;background:var(--teal);min-width:0"></span>` : ''}
            </div>
            <span style="position:absolute;inset:0;display:flex;align-items:center;padding:0 8px;font-size:var(--fs-xs);font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.3)">$${fmtNum(m.totalMRR)}</span>
          </div>
        </div>
      </div>`;
    }).join('')}
    <div style="padding:8px 16px;font-size:var(--fs-xs);color:var(--subtle);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span>Average: ${avgAccounts} accounts per CSM</span>
      ${list.some(m => m.count > avgAccounts * 1.4) ? '<span style="color:var(--red);font-weight:700">Red bars = overloaded</span>' : ''}
      <span style="margin-left:auto;display:flex;gap:10px">${activeTiers.map(t => `<span style="display:flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:2px;background:${TIER_COLORS[t]}"></span>${TIER_LABELS[t]}</span>`).join('')}</span>
    </div>
  `;
}

/* ─── SUGGESTED FOCUS AREAS ────────────────────────────────────── */
function renderCSMFocus(mgrList) {
  const wrap = el('csm-focus-wrap');
  if (!wrap) return;
  const items = [];
  const _fi = (path) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const icPhone = _fi('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.09 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>');
  const icCal = _fi('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>');
  const icDown = _fi('<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>');
  const icUp = _fi('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>');
  const icAlert = _fi('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>');
  const icTarget = _fi('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>');
  const icShuffle = _fi('<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>');

  // Clickable customer name link - closes modal, opens detail
  const _cl = (c) => '<a class="fd-cust-link" onclick="closeModal(\'focus-detail-modal\');openDetail(\'' + escHtml(c.id) + '\')">' + escHtml(c.name) + '</a>';

  // ── Gather cross-team data ───────────────────────────────────
  const activeMgrs = mgrList.filter(m => m.name !== 'Unassigned' && m.count > 0);
  if (!activeMgrs.length) {
    wrap.innerHTML = '<div class="empty-st" style="padding:24px"><div class="ei">' + appIcon('checkCircle',32) + '</div><h3>All clear</h3><p>No focus areas to show.</p></div>';
    return;
  }
  const allAccs = activeMgrs.flatMap(m => m.accs);
  const teamAvgScore = Math.round(allAccs.reduce((s,c) => s + c.score, 0) / allAccs.length);
  const teamAvgDelta = Math.round(allAccs.reduce((s,c) => s + getDelta7d(c), 0) / allAccs.length * 10) / 10;

  // ── Generator 1: Consolidated renewal pipeline ───────────────
  // One combined insight - "X at-risk renewals across Y CSMs with $Z MRR"
  (() => {
    const riskRenewals = allAccs.filter(c => (c.status === 'critical' || c.status === 'risk') && c.renewal != null && c.renewal > 0 && c.renewal <= 3);
    if (!riskRenewals.length) return;
    const renewMRR = riskRenewals.reduce((s,c) => s + (c.mrr||0), 0);
    const csmNames = [...new Set(riskRenewals.map(c => c.manager ? c.manager.trim() : 'Unassigned'))];
    // Find the single biggest at-risk renewal
    riskRenewals.sort((a,b) => (b.mrr||0) - (a.mrr||0));
    const top = riskRenewals[0];
    const topDays = top.renewal_date ? Math.max(0, Math.round((new Date(top.renewal_date) - new Date()) / 86400000)) : Math.round((top.renewal || 0) * 30);
    // Which CSM has the most at-risk renewal MRR?
    const csmMRR = {};
    riskRenewals.forEach(c => { const k = c.manager ? c.manager.trim() : 'Unassigned'; csmMRR[k] = (csmMRR[k]||0) + (c.mrr||0); });
    const heaviestCSM = Object.entries(csmMRR).sort((a,b) => b[1] - a[1])[0];
    // Severity: high if any critical + renewal ≤30d OR MRR > $50k, medium if >1 account, low otherwise
    var _rrSev = (riskRenewals.some(c => c.status === 'critical' && topDays <= 30) || renewMRR >= 50000) ? 'high' : riskRenewals.length >= 3 ? 'high' : riskRenewals.length >= 2 ? 'medium' : 'low';
    var _rrColor = _rrSev === 'high' ? 'var(--red)' : _rrSev === 'medium' ? 'var(--amber)' : 'var(--amber)';
    var _rrBg = _rrSev === 'high' ? 'var(--red-l)' : 'var(--amber-l)';
    var _rrPri = _rrSev === 'high' ? 7 : _rrSev === 'medium' ? 5 : 3;
    var _rrUrgency = _rrSev === 'high' ? ' Without immediate intervention, these accounts are very likely to churn at renewal.' : _rrSev === 'medium' ? ' These need attention before renewal conversations start.' : ' Worth monitoring as the renewal date approaches.';
    const detail = `There ${riskRenewals.length === 1 ? 'is' : 'are'} <strong>${riskRenewals.length}</strong> account${riskRenewals.length>1?'s':''} coming up for renewal that ${riskRenewals.length === 1 ? 'is' : 'are'} currently at risk, representing <strong>$${fmtNum(renewMRR)}/mo</strong> in revenue that could churn. The largest is ${_cl(top)} at $${fmtNum(top.mrr||0)}/mo with a health score of ${top.score} and roughly ${topDays} days until renewal.${heaviestCSM ? ` <strong>${escHtml(heaviestCSM[0])}</strong> is carrying the heaviest load with $${fmtNum(heaviestCSM[1])}/mo of at-risk renewal MRR on their plate.` : ''}${_rrUrgency}`;
    items.push({ priority: _rrPri, icon: icCal,
      color: _rrColor, bg: _rrBg,
      title: `${riskRenewals.length} At-Risk Renewal${riskRenewals.length>1?'s':''} - $${fmtNum(renewMRR)}/mo`,
      text: `<strong>${riskRenewals.length}</strong> at-risk renewal${riskRenewals.length>1?'s':''} across ${csmNames.length} CSM${csmNames.length>1?'s':''} - <strong>$${fmtNum(renewMRR)}/mo</strong> MRR at stake`,
      detail,
      steps: [
        'Prioritize outreach to the highest-MRR renewal - ' + _cl(top) + ' ($' + fmtNum(top.mrr||0) + '/mo, ~' + topDays + 'd out)',
        heaviestCSM ? 'Coordinate with <strong>' + escHtml(heaviestCSM[0]) + '</strong> who carries the most at-risk renewal exposure' : 'Align CSMs on renewal save strategies',
        'Flag any accounts with a score below 40 for executive sponsor escalation'
      ] });
  })();

  // ── Generator 2: Neglected + declining accounts (cross-team) ─
  // Accounts declining with no recent contact - the "silent bleed"
  (() => {
    const neglected = allAccs.filter(c => c.days != null && c.days >= 14 && getDelta7d(c) < -2);
    if (neglected.length < 2) return;
    const ndMRR = neglected.reduce((s,c) => s + (c.mrr||0), 0);
    const csmsAffected = [...new Set(neglected.map(c => c.manager ? c.manager.trim() : 'Unassigned'))];
    neglected.sort((a,b) => getDelta7d(a) - getDelta7d(b));
    const worst = neglected.slice(0, 3);
    // Severity: high if ≥5 neglected or MRR > $30k, medium if ≥3, low otherwise
    var _ndSev = (neglected.length >= 5 || ndMRR >= 30000) ? 'high' : neglected.length >= 3 ? 'medium' : 'low';
    var _ndColor = _ndSev === 'high' ? 'var(--red)' : 'var(--amber)';
    var _ndBg = _ndSev === 'high' ? 'var(--red-l)' : 'var(--amber-l)';
    var _ndPri = _ndSev === 'high' ? 6 : _ndSev === 'medium' ? 4 : 3;
    var _ndSuffix = _ndSev === 'high' ? ` This is a systemic issue - too many accounts are bleeding out unnoticed.` : _ndSev === 'medium' ? ` This pattern needs addressing before more accounts slip into critical.` : ` Worth flagging to prevent this from becoming a larger problem.`;
    const detail = `These accounts are actively losing health points while no one is reaching out - a "silent bleed" that often leads to surprise churn. The worst right now: ` + worst.map(c => `${_cl(c)} is down ${Math.abs(getDelta7d(c))} pts this week with ${c.days} days since last contact ($${fmtNum(c.mrr||0)}/mo)`).join('; ') + `. Together they represent <strong>$${fmtNum(ndMRR)}/mo</strong> in MRR that\'s eroding without anyone noticing.${_ndSuffix}`;
    items.push({ priority: _ndPri, icon: icPhone,
      color: _ndColor, bg: _ndBg,
      title: `${neglected.length} Neglected & Declining Accounts`,
      text: `<strong>${neglected.length}</strong> accounts declining with no contact in 14+ days across ${csmsAffected.length} CSM${csmsAffected.length>1?'s':''} - $${fmtNum(ndMRR)}/mo exposed`,
      detail,
      steps: [
        'Assign same-day outreach for the worst-declining accounts - start with ' + _cl(worst[0]),
        'Review contact cadence - these accounts have gone 14+ days without a touchpoint while declining',
        'Set up alerts for accounts that go 10+ days without contact while score is dropping'
      ] });
  })();

  // ── Generator 3: CSM performance spread ──────────────────────
  // Gap between best and worst performing CSM - flags team disparity
  (() => {
    if (activeMgrs.length < 2) return;
    const sorted = [...activeMgrs].sort((a,b) => b.avgDelta - a.avgDelta);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const spread = Math.round((best.avgDelta - worst.avgDelta) * 10) / 10;
    if (spread < 3) return; // not significant
    // Severity: high if spread ≥8, medium if ≥5, low otherwise
    var _psSev = spread >= 8 ? 'high' : spread >= 5 ? 'medium' : 'low';
    var _psColor = _psSev === 'high' ? 'var(--red)' : 'var(--amber)';
    var _psBg = _psSev === 'high' ? 'var(--red-l)' : 'var(--amber-l)';
    var _psPri = _psSev === 'high' ? 5 : _psSev === 'medium' ? 3 : 2;
    var _psSuffix = _psSev === 'high' ? ` A ${spread}-point gap is unusually wide and likely signals a structural issue - coaching, workload, or account complexity mismatch.` : ` A ${spread}-point spread usually signals different engagement approaches, workload issues, or account mix problems worth digging into.`;
    const detail = `There\'s a significant gap in how CSM portfolios are performing this week. <strong>${escHtml(best.name)}</strong> is trending at <strong>${best.avgDelta > 0 ? '+' : ''}${best.avgDelta} pts/wk</strong> with an avg score of ${best.avgScore}, while <strong>${escHtml(worst.name)}</strong> is at <strong>${worst.avgDelta > 0 ? '+' : ''}${worst.avgDelta} pts/wk</strong> with an avg score of ${worst.avgScore}.${_psSuffix}`;
    items.push({ priority: _psPri, icon: icShuffle,
      color: _psColor, bg: _psBg,
      title: `${spread} pt Performance Gap Between CSMs`,
      text: `<strong>${spread} pt</strong> spread between fastest- and slowest-improving portfolios this week`,
      detail,
      steps: [
        'Schedule a 1:1 with <strong>' + escHtml(worst.name) + '</strong> to identify blockers in their portfolio',
        'Have <strong>' + escHtml(best.name) + '</strong> share their playbook or run a team knowledge-share session',
        'Review whether account assignment complexity differs between top and bottom performers'
      ] });
  })();

  // ── Generator 4: MRR concentration risk ──────────────────────
  // Single accounts that represent outsized MRR exposure if they churn
  (() => {
    const totalMRR = allAccs.reduce((s,c) => s + (c.mrr||0), 0);
    if (!totalMRR) return;
    const highMRR = allAccs.filter(c => (c.mrr||0) >= totalMRR * 0.08 && (c.status === 'critical' || c.status === 'risk'));
    if (!highMRR.length) return;
    highMRR.sort((a,b) => (b.mrr||0) - (a.mrr||0));
    const combinedMRR = highMRR.reduce((s,c) => s + (c.mrr||0), 0);
    const pct = Math.round(combinedMRR / totalMRR * 100);
    const topAcct = highMRR[0];
    const topPct = Math.round((topAcct.mrr||0) / totalMRR * 100);
    // Severity: high if pct ≥20 or any critical, medium if pct ≥12, low otherwise
    var _mcSev = (pct >= 20 || highMRR.some(c => c.status === 'critical')) ? 'high' : pct >= 12 ? 'medium' : 'low';
    var _mcPri = _mcSev === 'high' ? 6 : _mcSev === 'medium' ? 4 : 3;
    var _mcSuffix = _mcSev === 'high' ? ` This is a top-of-house risk - losing ${highMRR.length === 1 ? 'this account' : 'any of these'} would materially damage the business.` : ` Losing ${highMRR.length === 1 ? 'this account' : 'any of these'} would create a noticeable impact on the overall book of business.`;
    const detail = `A large share of portfolio revenue is concentrated in ${highMRR.length === 1 ? 'a single account that\'s' : highMRR.length + ' accounts that are'} currently at risk. ${_cl(topAcct)} alone accounts for <strong>${topPct}%</strong> of total MRR with a health score of ${topAcct.score} (${topAcct.status}), managed by ${escHtml(topAcct.manager||'Unassigned')}.${highMRR.length > 1 ? ' Plus ' + (highMRR.length - 1) + ' more high-value account' + (highMRR.length > 2 ? 's' : '') + ' also at risk.' : ''}${_mcSuffix}`;
    items.push({ priority: _mcPri, icon: icAlert,
      color: 'var(--red)', bg: 'var(--red-l)',
      title: `${pct}% MRR at Risk in ${highMRR.length} Account${highMRR.length>1?'s':''}`,
      text: `<strong>${pct}%</strong> of total MRR ($${fmtNum(combinedMRR)}/mo) sits in ${highMRR.length} at-risk high-value account${highMRR.length>1?'s':''}`,
      detail,
      steps: [
        'Assign an executive sponsor to ' + _cl(topAcct) + ' immediately',
        'Build a 30-day save plan with specific adoption and engagement milestones',
        'Assess pipeline diversification - single-account exposure above 8% of MRR is high risk'
      ] });
  })();

  // ── Generator 5: Adoption-score disconnect ───────────────────
  // Accounts with decent scores but dropping adoption - lagging risk
  (() => {
    const disconnected = allAccs.filter(c =>
      c.adoption != null && c.adoption < 25 &&
      c.score >= 60 && (c.status === 'healthy' || c.status === 'watch')
    );
    if (disconnected.length < 2) return;
    const dcMRR = disconnected.reduce((s,c) => s + (c.mrr||0), 0);
    const csmsAffected = [...new Set(disconnected.map(c => c.manager ? c.manager.trim() : 'Unassigned'))];
    disconnected.sort((a,b) => a.adoption - b.adoption);
    const examples = disconnected.slice(0,3).map(c => `${_cl(c)} (score ${c.score}, ${c.adoption}% adoption)`).join(' · ');
    // Severity: high if ≥5 disconnected or MRR > $25k, medium if ≥3, low otherwise
    var _dcSev = (disconnected.length >= 5 || dcMRR >= 25000) ? 'high' : disconnected.length >= 3 ? 'medium' : 'low';
    var _dcColor = _dcSev === 'high' ? 'var(--red)' : 'var(--amber)';
    var _dcBg = _dcSev === 'high' ? 'var(--red-l)' : 'var(--amber-l)';
    var _dcPri = _dcSev === 'high' ? 5 : _dcSev === 'medium' ? 3 : 2;
    var _dcSuffix = _dcSev === 'high' ? ` This is a widespread adoption gap - these accounts will likely drop scores in the next 1–2 cycles without enablement.` : ` This is a leading indicator of future churn - customers who aren\'t using the product tend to question its value at renewal.`;
    items.push({ priority: _dcPri, icon: icDown,
      color: _dcColor, bg: _dcBg,
      title: `${disconnected.length} Accounts with Low Adoption Risk`,
      text: `<strong>${disconnected.length}</strong> accounts look healthy but have adoption under 25% - potential lagging risk ($${fmtNum(dcMRR)}/mo)`,
      detail: `These accounts look healthy on the surface - scores above 60 - but product adoption is under 25%.${_dcSuffix} The most at risk: ` + examples + `. Together they represent <strong>$${fmtNum(dcMRR)}/mo</strong> in MRR that could quietly slip away.`,
      steps: [
        'Run adoption deep-dives on the lowest-adoption accounts - identify unused features',
        'Schedule product training or enablement sessions for these accounts',
        'Treat these as leading indicators - scores may drop soon if adoption stays low'
      ] });
  })();

  // ── Generator 6: Workload imbalance ──────────────────────────
  // One CSM carries significantly more at-risk accounts than others
  (() => {
    if (activeMgrs.length < 2) return;
    const avgRisk = activeMgrs.reduce((s,m) => s + m.atRisk, 0) / activeMgrs.length;
    const overloaded = activeMgrs.filter(m => m.atRisk >= avgRisk * 2 && m.atRisk >= 3);
    if (!overloaded.length) return;
    overloaded.sort((a,b) => b.atRisk - a.atRisk);
    const csm = overloaded[0];
    // Severity: high if ≥5 at-risk or riskMRR > $40k, medium if ≥4 or multiple overloaded CSMs, low otherwise
    var _wlSev = (csm.atRisk >= 5 || csm.riskMRR >= 40000) ? 'high' : (csm.atRisk >= 4 || overloaded.length > 1) ? 'medium' : 'low';
    var _wlColor = _wlSev === 'high' ? 'var(--red)' : 'var(--amber)';
    var _wlBg = _wlSev === 'high' ? 'var(--red-l)' : 'var(--amber-l)';
    var _wlPri = _wlSev === 'high' ? 5 : _wlSev === 'medium' ? 3 : 2;
    var _wlSuffix = _wlSev === 'high' ? ` This CSM is critically overloaded - immediate redistribution is needed to prevent account losses.` : ` Redistributing some of this load could prevent accounts from slipping through the cracks.`;
    const detail = `<strong>${escHtml(csm.name)}</strong> is managing <strong>${csm.atRisk} at-risk accounts</strong> worth $${fmtNum(csm.riskMRR)}/mo, while the team average is only ${Math.round(avgRisk)}. When one CSM is stretched too thin across too many problem accounts, response times suffer and at-risk accounts don\'t get the attention they need.${overloaded.length > 1 ? ' <strong>' + escHtml(overloaded[1].name) + '</strong> is also elevated at ' + overloaded[1].atRisk + ' at-risk accounts.' : ''}${_wlSuffix}`;
    items.push({ priority: _wlPri, icon: icAlert,
      color: _wlColor, bg: _wlBg,
      title: `${escHtml(csm.name)} Carrying ${csm.atRisk} At-Risk Accounts`,
      text: `Risk accounts are unevenly distributed - <strong>${escHtml(csm.name)}</strong> carries ${Math.round(csm.atRisk / Math.max(1, activeMgrs.reduce((s,m)=>s+m.atRisk,0)) * 100)}% of team's at-risk load`,
      detail,
      steps: [
        'Evaluate redistributing 1–2 at-risk accounts to lower-loaded CSMs',
        'Provide <strong>' + escHtml(csm.name) + '</strong> with additional support or temporary assistance',
        'Review whether workload imbalance is contributing to declining portfolio health'
      ] });
  })();

  // ── Generator 7: Cross-CSM bright spot ───────────────────────
  // Which CSM is driving the most improvement, and what are they doing differently?
  (() => {
    const improving = activeMgrs.filter(m => m.avgDelta >= 1.5 && m.avgDelta > teamAvgDelta + 1);
    if (!improving.length) return;
    improving.sort((a,b) => b.avgDelta - a.avgDelta);
    const best = improving[0];
    const improvingAccts = best.accs.filter(c => getDelta7d(c) > 2);
    // What's different about this CSM's portfolio?
    const contactDays = best.accs.filter(c => c.days != null);
    const avgContact = contactDays.length ? Math.round(contactDays.reduce((s,c) => s + c.days, 0) / contactDays.length) : null;
    const teamContact = allAccs.filter(c => c.days != null);
    const teamAvgContact = teamContact.length ? Math.round(teamContact.reduce((s,c) => s + c.days, 0) / teamContact.length) : null;
    let why = `<strong>${escHtml(best.name)}</strong> is outpacing the rest of the team with <strong>${improvingAccts.length} of ${best.count}</strong> accounts actively improving this week. Their portfolio is trending at <strong>+${best.avgDelta} pts/wk</strong> compared to the team average of ${teamAvgDelta > 0 ? '+' : ''}${teamAvgDelta}.`;
    if (avgContact != null && teamAvgContact != null && avgContact < teamAvgContact - 3) {
      why += ` One likely factor: they\'re making contact every <strong>${avgContact} days</strong> on average, vs <strong>${teamAvgContact} days</strong> team-wide. More frequent touchpoints are clearly correlating with better outcomes.`;
    } else {
      why += ` Understanding what they\'re doing differently - whether it\'s talk tracks, timing, or prioritization - could help lift the rest of the team.`;
    }
    items.push({ priority: 1, icon: icUp,
      color: 'var(--green)', bg: 'var(--green-l)',
      title: `${escHtml(best.name)} Driving Strong Portfolio Gains`,
      text: `<strong>${escHtml(best.name)}</strong> is driving the strongest portfolio gains at <strong>+${best.avgDelta} pts/wk</strong>`,
      detail: why,
      steps: [
        'Document what <strong>' + escHtml(best.name) + '</strong> is doing differently - contact cadence, talk tracks, etc.',
        'Have them present their approach at the next team meeting',
        'Apply their methods to underperforming portfolios as a test'
      ] });
  })();

  // ── Generator 8: Biggest single account at risk ──────────────
  // The #1 account across all CSMs that needs attention today
  (() => {
    const atRisk = allAccs.filter(c => c.status === 'critical' || c.status === 'risk');
    if (!atRisk.length) return;
    const totalMRR = allAccs.reduce((s,c) => s + (c.mrr||0), 0);
    // Score by: MRR share of portfolio (primary), severity, decline speed, renewal urgency
    atRisk.sort((a,b) => {
      const pctA = totalMRR ? (a.mrr||0) / totalMRR * 100 : 0;
      const pctB = totalMRR ? (b.mrr||0) / totalMRR * 100 : 0;
      const scoreA = pctA * 3 + (a.status === 'critical' ? 8 : 0) + Math.abs(Math.min(0, getDelta7d(a))) * 1.5 + (a.renewal != null && a.renewal > 0 && a.renewal <= 2 ? 5 : 0);
      const scoreB = pctB * 3 + (b.status === 'critical' ? 8 : 0) + Math.abs(Math.min(0, getDelta7d(b))) * 1.5 + (b.renewal != null && b.renewal > 0 && b.renewal <= 2 ? 5 : 0);
      return scoreB - scoreA;
    });
    const top = atRisk[0];
    const delta = getDelta7d(top);
    const topMRR = top.mrr || 0;
    const mrrPct = totalMRR ? Math.round(topMRR / totalMRR * 100) : 0;

    // Build conversational "why" narrative
    var why = 'This is the highest-priority account across all CSMs right now. ';
    why += _cl(top) + ' represents <strong>$' + fmtNum(topMRR) + '/mo</strong>';
    if (mrrPct >= 2) why += ' (' + mrrPct + '% of total portfolio MRR)';
    why += ', and ';
    if (top.status === 'critical') {
      why += 'is in <strong>critical</strong> status with a health score of ' + top.score;
    } else {
      why += 'is flagged as <strong>at risk</strong> with a health score of ' + top.score;
    }
    if (delta && delta < 0) {
      why += ' that\'s dropped <strong>' + Math.abs(delta) + ' points</strong> this week';
    } else if (delta && delta > 0) {
      why += ', though it did improve ' + delta + ' pts this week';
    }
    why += '. ';

    // Explain the risk signals conversationally
    var whySignals = [];
    if (top.days != null && top.days >= 14) whySignals.push('no one has reached out in <strong>' + top.days + ' days</strong>');
    if (top.logins != null && top.logins < 5) whySignals.push('login activity is very low');
    if (top.adoption != null && top.adoption < 30) whySignals.push('adoption is only at ' + top.adoption + '%');
    if (top.tickets != null && top.tickets >= 3) whySignals.push('they have ' + top.tickets + ' open support tickets');
    if (top.renewal != null && top.renewal > 0 && top.renewal <= 3) {
      var renewDays = top.renewal_date ? Math.max(0, Math.round((new Date(top.renewal_date) - new Date()) / 86400000)) : Math.round((top.renewal || 0) * 30);
      whySignals.push('their renewal is coming up in <strong>' + renewDays + ' days</strong>');
    }
    if (whySignals.length === 1) {
      why += 'On top of that, ' + whySignals[0] + '. ';
    } else if (whySignals.length > 1) {
      why += 'On top of that, ' + whySignals.slice(0, -1).join(', ') + ' and ' + whySignals[whySignals.length - 1] + '. ';
    }
    why += 'Managed by <strong>' + escHtml(top.manager || 'Unassigned') + '</strong>.';

    var signalBullets = [];
    if (top.logins != null && top.logins < 5) signalBullets.push('low logins');
    if (top.adoption != null && top.adoption < 30) signalBullets.push(top.adoption + '% adoption');
    if (top.tickets != null && top.tickets >= 3) signalBullets.push(top.tickets + ' open tickets');
    if (top.days != null && top.days >= 14) signalBullets.push(top.days + 'd since contact');
    if (top.renewal != null && top.renewal > 0 && top.renewal <= 3) signalBullets.push('renews within 90d');
    var signalStr = signalBullets.length ? signalBullets.join(', ') : 'multiple weak signals';

    // Severity: high if critical + large MRR or declining, medium if risk, low if otherwise
    var _tpSev = (top.status === 'critical' && (mrrPct >= 5 || (delta && delta < -3))) ? 'high' : top.status === 'critical' ? 'high' : (mrrPct >= 8 || (delta && delta < -5)) ? 'high' : 'medium';
    var _tpPri = _tpSev === 'high' ? 6 : 4;
    items.push({ priority: _tpPri, icon: icTarget,
      color: 'var(--red)', bg: 'var(--red-l)',
      title: `Top Priority: ${escHtml(top.name)} ($${fmtNum(topMRR)}/mo)`,
      text: `Highest-priority account across all CSMs: ${_cl(top)} ($${fmtNum(topMRR)}/mo, ${top.status})`,
      detail: why,
      steps: [
        'Reach out to <strong>' + escHtml(top.manager||'Unassigned') + '</strong> today for a status update on this account',
        'Review the risk signals (' + signalStr + ') and build a specific action plan for each',
        'Schedule a customer check-in within 48 hours - don\'t let this one go quiet'
      ] });
  })();

  // ── Generator 9: CSM Contact Cadence Gap ────────────────────
  // Compare average days-since-contact per CSM to find who's falling behind
  (() => {
    if (activeMgrs.length < 2) return;
    const csmCadence = activeMgrs.map(m => {
      const withDays = m.accs.filter(c => c.days != null);
      const avg = withDays.length ? Math.round(withDays.reduce((s,c) => s + c.days, 0) / withDays.length * 10) / 10 : null;
      const declining = m.accs.filter(c => getDelta7d(c) < -2).length;
      return { name: m.name, avg, count: m.count, declining, accs: m.accs };
    }).filter(x => x.avg != null);
    if (csmCadence.length < 2) return;
    csmCadence.sort((a,b) => b.avg - a.avg); // worst first
    const worst = csmCadence[0];
    const best = csmCadence[csmCadence.length - 1];
    const teamAvg = Math.round(csmCadence.reduce((s,x) => s + x.avg, 0) / csmCadence.length * 10) / 10;
    const gap = Math.round((worst.avg - best.avg) * 10) / 10;
    if (gap < 5) return; // not significant
    var _ccSev = gap >= 15 ? 'high' : gap >= 8 ? 'medium' : 'low';
    var _ccPri = _ccSev === 'high' ? 5 : _ccSev === 'medium' ? 3 : 2;
    var _ccColor = _ccSev === 'high' ? 'var(--red)' : 'var(--amber)';
    var _ccBg = _ccSev === 'high' ? 'var(--red-l)' : 'var(--amber-l)';
    const detail = `<strong>${escHtml(best.name)}</strong> averages <strong>${best.avg} days</strong> between contacts while <strong>${escHtml(worst.name)}</strong> averages <strong>${worst.avg} days</strong> — a ${gap}-day gap. The team average is ${teamAvg} days. ${worst.declining > 0 ? `<strong>${escHtml(worst.name)}</strong> has <strong>${worst.declining} declining accounts</strong>, which is likely correlated with the longer contact gaps.` : ''} Customers who go longer without touchpoints are significantly more likely to show declining health scores.`;
    items.push({ priority: _ccPri, icon: icPhone,
      color: _ccColor, bg: _ccBg,
      title: `${gap}-Day Contact Cadence Gap Between CSMs`,
      text: `<strong>${escHtml(best.name)}</strong> contacts every ${best.avg}d vs <strong>${escHtml(worst.name)}</strong> at ${worst.avg}d — ${gap}-day gap`,
      detail,
      steps: [
        'Review <strong>' + escHtml(worst.name) + '</strong>\'s contact workflow — are they prioritizing the right accounts?',
        'Set team cadence targets: Enterprise ≤14d, Mid-Market ≤21d, SMB ≤30d',
        'Share <strong>' + escHtml(best.name) + '</strong>\'s approach — what\'s making them more responsive?'
      ] });
  })();

  // ── Generator 10: CSM Save Rate ────────────────────────────
  // Which CSMs are recovering accounts from at-risk to healthy?
  (() => {
    if (activeMgrs.length < 2) return;
    const csmSaves = activeMgrs.map(m => {
      const improving = m.accs.filter(c => (c.status === 'watch' || c.status === 'healthy') && getDelta7d(c) >= 3);
      const stuckRisk = m.accs.filter(c => (c.status === 'critical' || c.status === 'risk') && getDelta7d(c) <= 0);
      return { name: m.name, saved: improving.length, stuck: stuckRisk.length, total: m.count, improving, stuckRisk };
    });
    const bestSaver = [...csmSaves].sort((a,b) => b.saved - a.saved)[0];
    const worstSaver = [...csmSaves].sort((a,b) => b.stuck - a.stuck)[0];
    if (bestSaver.saved < 2 && worstSaver.stuck < 2) return;
    var detail = '';
    if (bestSaver.saved >= 2) {
      detail += `<strong>${escHtml(bestSaver.name)}</strong> has <strong>${bestSaver.saved} accounts</strong> actively recovering (gaining 3+ pts/wk and moving out of risk status). `;
    }
    if (worstSaver.stuck >= 2) {
      detail += `Meanwhile, <strong>${escHtml(worstSaver.name)}</strong> has <strong>${worstSaver.stuck} at-risk accounts</strong> that are flat or still declining — none showing recovery momentum. `;
      detail += 'Understanding the difference in approach between these two CSMs could unlock better save rates across the team.';
    }
    var _srPri = worstSaver.stuck >= 4 ? 4 : worstSaver.stuck >= 2 ? 3 : 2;
    items.push({ priority: _srPri, icon: icUp,
      color: 'var(--amber)', bg: 'var(--amber-l)',
      title: 'CSM Save Rate Comparison',
      text: `<strong>${escHtml(bestSaver.name)}</strong> recovering ${bestSaver.saved} accounts vs <strong>${escHtml(worstSaver.name)}</strong> with ${worstSaver.stuck} stuck at-risk`,
      detail,
      steps: [
        bestSaver.saved >= 2 ? 'Have <strong>' + escHtml(bestSaver.name) + '</strong> share their recovery playbook — what outreach and actions led to turnaround?' : 'Identify what save strategies are working across the team',
        worstSaver.stuck >= 2 ? 'Review <strong>' + escHtml(worstSaver.name) + '</strong>\'s stuck accounts — are they getting the right type of engagement?' : 'Ensure all CSMs have clear save plans for at-risk accounts',
        'Track save rate as a team KPI — accounts recovered from risk to healthy per month'
      ] });
  })();

  // ── Generator 11: CSM Portfolio Momentum ───────────────────
  // Flag any CSM whose entire book is trending significantly negative
  (() => {
    if (activeMgrs.length < 2) return;
    const teamDelta = Math.round(activeMgrs.reduce((s,m) => s + m.avgDelta, 0) / activeMgrs.length * 10) / 10;
    const sinking = activeMgrs.filter(m => m.avgDelta <= -2 && m.avgDelta < teamDelta - 1.5);
    if (!sinking.length) return;
    sinking.sort((a,b) => a.avgDelta - b.avgDelta);
    const worst = sinking[0];
    const decliningAccts = worst.accs.filter(c => getDelta7d(c) < -2);
    var _pmSev = worst.avgDelta <= -5 ? 'high' : worst.avgDelta <= -3 ? 'medium' : 'low';
    var _pmPri = _pmSev === 'high' ? 6 : _pmSev === 'medium' ? 4 : 3;
    var _pmColor = _pmSev === 'high' ? 'var(--red)' : 'var(--amber)';
    var _pmBg = _pmSev === 'high' ? 'var(--red-l)' : 'var(--amber-l)';
    const detail = `<strong>${escHtml(worst.name)}</strong>'s entire portfolio is trending at <strong>${worst.avgDelta} pts/wk</strong> while the team average is ${teamDelta > 0 ? '+' : ''}${teamDelta}. <strong>${decliningAccts.length} of ${worst.count}</strong> accounts are actively declining. This isn't about one bad account — it's a portfolio-wide pattern that suggests something changed: workload, personal capacity, account complexity, or engagement approach. ${_pmSev === 'high' ? 'At this rate, multiple accounts could drop into critical within 1-2 weeks without intervention.' : 'This is worth a direct conversation to understand what\'s driving the decline.'}`;
    items.push({ priority: _pmPri, icon: icDown,
      color: _pmColor, bg: _pmBg,
      title: `${escHtml(worst.name)}'s Portfolio Trending ${worst.avgDelta} pts/wk`,
      text: `<strong>${escHtml(worst.name)}</strong>'s book is at <strong>${worst.avgDelta} pts/wk</strong> with ${decliningAccts.length}/${worst.count} accounts declining`,
      detail,
      steps: [
        'Schedule a 1:1 with <strong>' + escHtml(worst.name) + '</strong> — ask directly what\'s changed this week',
        'Review the ' + decliningAccts.length + ' declining accounts — are they clustered by tier, lifecycle, or issue type?',
        'Consider temporary workload relief if the decline is capacity-driven'
      ] });
  })();

  // ── Generator 12: CSM Tier Mismatch ────────────────────────
  // CSM managing mostly enterprise accounts but underperforming, or vice versa
  (() => {
    if (activeMgrs.length < 2) return;
    const csmTier = activeMgrs.map(m => {
      const ent = m.accs.filter(c => c.tier === 'enterprise').length;
      const entPct = m.count ? Math.round(ent / m.count * 100) : 0;
      return { name: m.name, entPct, avgScore: m.avgScore, avgDelta: m.avgDelta, count: m.count, ent };
    });
    // Find CSMs with high enterprise % but low scores, or low enterprise % with high scores
    const highEntLowScore = csmTier.filter(x => x.entPct >= 50 && x.avgScore < 60);
    const lowEntHighScore = csmTier.filter(x => x.entPct <= 20 && x.avgScore >= 70);
    if (!highEntLowScore.length || !lowEntHighScore.length) return;
    const struggling = highEntLowScore[0];
    const thriving = lowEntHighScore[0];
    const detail = `<strong>${escHtml(struggling.name)}</strong> manages ${struggling.entPct}% enterprise accounts with an average score of only ${struggling.avgScore}, while <strong>${escHtml(thriving.name)}</strong> manages ${thriving.entPct}% enterprise with an average score of ${thriving.avgScore}. Enterprise accounts require deeper engagement, more strategic conversations, and longer touchpoints. This performance gap may reflect a complexity mismatch — not every CSM is equally equipped for high-touch enterprise management. Consider whether rebalancing by tier could improve outcomes.`;
    items.push({ priority: 3, icon: icShuffle,
      color: 'var(--amber)', bg: 'var(--amber-l)',
      title: 'Enterprise Account Performance Mismatch',
      text: `<strong>${escHtml(struggling.name)}</strong> (${struggling.entPct}% enterprise, avg ${struggling.avgScore}) vs <strong>${escHtml(thriving.name)}</strong> (${thriving.entPct}%, avg ${thriving.avgScore})`,
      detail,
      steps: [
        'Assess whether <strong>' + escHtml(struggling.name) + '</strong> needs enterprise-specific coaching or playbooks',
        'Consider redistributing some enterprise accounts to CSMs with stronger enterprise track records',
        'Evaluate if the tier assignment in your book reflects actual account complexity'
      ] });
  })();

  // ── Generator 13: CSM Renewal Track Record ─────────────────
  // Which CSMs have the most upcoming renewals and how healthy are those accounts?
  (() => {
    if (activeMgrs.length < 2) return;
    const csmRenewals = activeMgrs.map(m => {
      const upcoming = m.accs.filter(c => c.renewal != null && c.renewal > 0 && c.renewal <= 3);
      const healthy = upcoming.filter(c => c.status === 'healthy' || c.status === 'expand');
      const atRisk = upcoming.filter(c => c.status === 'critical' || c.status === 'risk');
      const renewMRR = upcoming.reduce((s,c) => s + (c.mrr||0), 0);
      const riskMRR = atRisk.reduce((s,c) => s + (c.mrr||0), 0);
      return { name: m.name, total: upcoming.length, healthy: healthy.length, atRisk: atRisk.length, renewMRR, riskMRR, upcoming, atRiskAccts: atRisk };
    }).filter(x => x.total > 0);
    if (!csmRenewals.length) return;
    csmRenewals.sort((a,b) => b.riskMRR - a.riskMRR);
    const riskiest = csmRenewals[0];
    if (riskiest.atRisk === 0) return; // all renewals healthy — no insight needed
    const safest = [...csmRenewals].sort((a,b) => b.healthy - a.healthy)[0];
    var _rnSev = riskiest.riskMRR >= 20000 || riskiest.atRisk >= 3 ? 'high' : riskiest.atRisk >= 2 ? 'medium' : 'low';
    var _rnPri = _rnSev === 'high' ? 5 : _rnSev === 'medium' ? 3 : 2;
    var _rnColor = _rnSev === 'high' ? 'var(--red)' : 'var(--amber)';
    var _rnBg = _rnSev === 'high' ? 'var(--red-l)' : 'var(--amber-l)';
    const topRiskAcct = riskiest.atRiskAccts.sort((a,b) => (b.mrr||0) - (a.mrr||0))[0];
    const detail = `<strong>${escHtml(riskiest.name)}</strong> has <strong>${riskiest.atRisk} at-risk account${riskiest.atRisk>1?'s':''}</strong> renewing in the next 90 days, with <strong>$${fmtNum(riskiest.riskMRR)}/mo</strong> at stake. The biggest risk is ${_cl(topRiskAcct)} at $${fmtNum(topRiskAcct.mrr||0)}/mo (score: ${topRiskAcct.score}).${safest.name !== riskiest.name && safest.healthy >= 2 ? ` In contrast, <strong>${escHtml(safest.name)}</strong> has ${safest.healthy} healthy renewals coming up — review what\'s different about how they prepare accounts pre-renewal.` : ''} Renewal readiness should be a weekly conversation topic for any CSM with at-risk renewals on the horizon.`;
    items.push({ priority: _rnPri, icon: icCal,
      color: _rnColor, bg: _rnBg,
      title: `${escHtml(riskiest.name)}: ${riskiest.atRisk} At-Risk Renewal${riskiest.atRisk>1?'s':''} ($${fmtNum(riskiest.riskMRR)}/mo)`,
      text: `<strong>${escHtml(riskiest.name)}</strong> has ${riskiest.atRisk} at-risk renewal${riskiest.atRisk>1?'s':''} worth <strong>$${fmtNum(riskiest.riskMRR)}/mo</strong> in the next 90 days`,
      detail,
      steps: [
        'Review save plans for each of <strong>' + escHtml(riskiest.name) + '</strong>\'s at-risk renewals — start with ' + _cl(topRiskAcct),
        'Ensure renewal prep conversations happen at least 30 days before each renewal date',
        'Track renewal outcomes by CSM — build a save rate metric for team accountability'
      ] });
  })();

  // ── Render ───────────────────────────────────────────────────
  items.sort((a, b) => b.priority - a.priority);

  if (!items.length) {
    wrap.innerHTML = '<div class="empty-st" style="padding:24px"><div class="ei">' + appIcon('checkCircle',32) + '</div><h3>All clear</h3><p>No focus areas to show.</p></div>';
    window._csmFocusItems = [];
    return;
  }

  var shown = items.slice(0, 6);
  window._csmFocusItems = shown;
  wrap.innerHTML = shown.map(function(it, idx) { return '<div class="csm-focus-item" onclick="openFocusDetail(' + idx + ')">' +
    '<div class="csm-focus-icon" style="background:' + it.bg + ';color:' + it.color + '">' + it.icon + '</div>' +
    '<div class="csm-focus-title">' + it.title + '</div>' +
    '<svg class="csm-focus-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
    '</div>'; }).join('');
}

function openFocusDetail(idx) {
  var items = window._csmFocusItems;
  if (!items || !items[idx]) return;
  var it = items[idx];

  // Accent-colored header banner
  el('fd-banner').style.background = it.bg;
  el('fd-banner').style.color = it.color;
  el('fd-banner-icon').innerHTML = it.icon.replace(/width="13" height="13"/, 'width="22" height="22"');
  el('fd-title').innerHTML = it.title;

  // Build body
  var h = '';

  // Issue block
  h += '<div class="fd-section">' +
    '<div class="fd-section-hd"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Issue</div>' +
    '<div class="fd-section-body">' + it.text + '</div>' +
  '</div>';

  // Why This Matters - callout card
  h += '<div class="fd-callout" style="border-left-color:' + it.color + '">' +
    '<div class="fd-callout-hd">Why This Matters</div>' +
    '<div class="fd-callout-body">' + it.detail + '</div>' +
  '</div>';

  // Next Steps - numbered cards
  h += '<div class="fd-section">' +
    '<div class="fd-section-hd"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Suggested Next Steps</div>' +
    '<div class="fd-steps-list">' +
    it.steps.map(function(s, i) {
      return '<div class="fd-step">' +
        '<span class="fd-step-num" style="background:' + it.bg + ';color:' + it.color + '">' + (i + 1) + '</span>' +
        '<span class="fd-step-text">' + s + '</span>' +
      '</div>';
    }).join('') +
    '</div></div>';

  el('fd-body').innerHTML = h;
  openModal('focus-detail-modal');
}

/* ─── PORTFOLIO MOVEMENT ───────────────────────────────────────── */
function renderCSMMovement(mgrList) {
  const wrap = el('csm-movement-wrap');
  if (!wrap) return;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const movements = [];

  mgrList.filter(m => m.name !== 'Unassigned').forEach(m => {
    m.accs.forEach(c => {
      const hist = (c.history || []).filter(h => h.date).sort((a, b) => new Date(b.date) - new Date(a.date));
      if (hist.length < 2) return;
      const currentScore = c.score;
      const currentStatus = c.status;
      // Find score from ~7 days ago
      const oldEntries = hist.filter(h => new Date(h.date) < weekAgo);
      if (!oldEntries.length) return;
      const oldScore = oldEntries[0].score;
      const oldStatus = getStatus(oldScore);
      if (oldStatus !== currentStatus) {
        const statusOrder = ['critical','risk','watch','healthy','expand'];
        const improved = statusOrder.indexOf(currentStatus) > statusOrder.indexOf(oldStatus);
        movements.push({
          csm: m.name, customer: c.name, cid: c.id, from: oldStatus, to: currentStatus,
          improved, scoreDelta: currentScore - oldScore, mrr: c.mrr || 0
        });
      }
    });
  });

  if (!movements.length) {
    wrap.innerHTML = '<div class="empty-st" style="padding:24px"><div class="ei">' + appIcon('check',32) + '</div><h3>No changes</h3><p>No health band changes in the last 7 days.</p></div>';
    return;
  }

  const statusLabel = s => (STATUS_LABEL[s] || s);
  // Sort: deteriorations first (more urgent), then improvements
  movements.sort((a, b) => a.improved - b.improved || b.mrr - a.mrr);

  wrap.style.maxHeight = '420px';
  wrap.style.overflowY = 'auto';

  wrap.innerHTML = movements.map(mv => {
    const arrowCls = mv.improved ? 'up' : 'dn';
    const arrowIcon = mv.improved ? '▲' : '▼';
    return `<div class="csm-movement-item">
      <span class="csm-movement-arrow ${arrowCls}">${arrowIcon}</span>
      <a onclick="openDetail('${mv.cid}')" style="cursor:pointer;font-weight:700;color:var(--text);text-decoration:none;border-bottom:1px dashed var(--border);transition:color .15s" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text)'">${escHtml(mv.customer)}</a>
      <span style="color:var(--muted)">moved from</span>
      ${badgeHTML(mv.from)}
      <span style="color:var(--muted)">→</span>
      ${badgeHTML(mv.to)}
      <span style="color:var(--muted);font-size:var(--fs-sm);margin-left:auto">${escHtml(mv.csm)} · $${fmtNum(mv.mrr)} MRR</span>
    </div>`;
  }).join('');
}

/* ─── CSM click-through helpers ────────────────────────────────── */
function filterByManager(name) {
  columnFilters = {};
  insightFilter = null;
  mrrExposureFilter = null;
  _filterTier = null;
  _filterStage = null;
  filterMode = 'all';
  _filterManager = name;
  nav('customers');
  renderCustomers();
}
function clearManagerFilter() {
  _filterManager = null;
  renderCustomers();
}

/* ─── CSM ACTIVITY FEED ────────────────────────────────────────── */
function renderCSMActivity(mgrList) {
  const wrap = el('csm-activity-wrap');
  if (!wrap) return;

  // Group recent audit logs by manager
  const csmNames = new Set(mgrList.filter(m => m.name !== 'Unassigned').map(m => m.name));
  const customerToCSM = {};
  customers.forEach(c => { if (c.manager) customerToCSM[c.name] = c.manager.trim(); });

  // Get recent audit entries and tag them with CSM
  const recent = (auditLogs || []).slice(0, 80).map(entry => {
    const csm = entry.customer_name ? (customerToCSM[entry.customer_name] || null) : null;
    return { ...entry, csm };
  }).filter(e => e.csm && csmNames.has(e.csm));

  if (!recent.length) {
    wrap.innerHTML = '<div class="empty-st" style="padding:24px"><div class="ei">' + appIcon('clipboard',32) + '</div><h3>No activity</h3><p>No recent CSM activity found.</p></div>';
    return;
  }

  // Group by CSM, show most recent per CSM
  const byCsm = {};
  recent.forEach(e => {
    if (!byCsm[e.csm]) byCsm[e.csm] = [];
    if (byCsm[e.csm].length < 3) byCsm[e.csm].push(e);
  });

  const label = a => AUDIT_ACTION_LABELS[a] || a;
  const color = a => AUDIT_ACTION_COLORS[a] || 'var(--muted)';
  const relTime = d => {
    const diff = (Date.now() - new Date(d).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  };

  let html = '';
  Object.entries(byCsm).forEach(([csm, entries]) => {
    html += `<div style="padding:8px 16px 4px;font-size:var(--fs-sm);font-weight:700;color:var(--subtle);text-transform:uppercase;letter-spacing:.05em;background:var(--bg)">${escHtml(csm)}</div>`;
    entries.forEach(e => {
      let detail = '';
      try {
        const d = typeof e.details === 'string' ? JSON.parse(e.details) : (e.details || {});
        detail = d.summary ? escHtml(d.summary).substring(0, 80) : '';
      } catch {}
      html += `<div class="csm-activity-item">
        <div class="csm-activity-time">${relTime(e.created_at)}</div>
        <div class="csm-activity-body">
          <span style="display:inline-block;padding:1px 7px;border-radius:4px;font-size:var(--fs-xs);font-weight:700;color:${color(e.action)};background:color-mix(in srgb, ${color(e.action)} 12%, transparent)">${label(e.action)}</span>
          ${e.customer_name ? ` <strong>${escHtml(e.customer_name)}</strong>` : ''}
          ${detail ? `<p style="font-size:var(--fs-sm);color:var(--muted);margin-top:2px">${detail}</p>` : ''}
        </div>
      </div>`;
    });
  });

  wrap.innerHTML = html;
}

// Drill into a specific CSM's accounts - inline expand/collapse
function drillCSM(mgrName) {
  const tbody = el('csm-perf-tbody');
  if (!tbody) return;
  const colCount = window._csmColCount || 12;

  // Find the parent row for this CSM
  const parentRow = tbody.querySelector(`tr.csm-row[data-csm="${CSS.escape(mgrName)}"]`);
  if (!parentRow) return;

  // Check if already expanded - toggle off
  const existingExpand = parentRow.nextElementSibling;
  if (existingExpand && existingExpand.classList.contains('csm-expand-row')) {
    existingExpand.remove();
    parentRow.classList.remove('csm-expanded');
    // Reset button
    const btn = parentRow.querySelector('.csm-expand-btn');
    if (btn) btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Expand`;
    return;
  }

  // Collapse any other open expand row first
  const prevExpanded = tbody.querySelector('tr.csm-expand-row');
  if (prevExpanded) {
    const prevParent = prevExpanded.previousElementSibling;
    if (prevParent) {
      prevParent.classList.remove('csm-expanded');
      const prevBtn = prevParent.querySelector('.csm-expand-btn');
      if (prevBtn) prevBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Expand`;
    }
    prevExpanded.remove();
  }

  // Get accounts for this CSM
  const accs = customers.filter(c => {
    if (mgrName === 'Unassigned') return !c.manager || !c.manager.trim();
    return (c.manager || '').trim() === mgrName;
  }).filter(c => c.lifecycle !== 'churned');

  if (!accs.length) return;

  // Mark parent as expanded
  parentRow.classList.add('csm-expanded');
  const btn = parentRow.querySelector('.csm-expand-btn');
  if (btn) btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg> Collapse`;

  // --- CSM Summary Header ---
  const mgrData = (window._csmPerfData || []).find(m => m.name === mgrName);
  const avgScore   = mgrData ? mgrData.avgScore : Math.round(accs.reduce((s,c) => s+c.score, 0) / accs.length);
  const totalMRR   = accs.reduce((s,c) => s+(c.mrr||0), 0);
  const atRiskCt   = accs.filter(c => c.status === 'critical' || c.status === 'risk').length;
  const healthyCt  = accs.filter(c => c.status === 'healthy' || c.status === 'expand').length;
  const overdueCt  = accs.filter(c => c.days != null && c.days >= 14).length;
  const avgDelta   = mgrData ? mgrData.avgDelta : Math.round(accs.reduce((s,c) => s+getDelta7d(c), 0) / accs.length * 10) / 10;
  const renewals90 = accs.filter(c => c.renewal != null && c.renewal > 0 && c.renewal <= 3).length;

  const hmColor = v => v >= 65 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)';
  const dColor  = avgDelta > 0 ? 'var(--green)' : avgDelta < 0 ? 'var(--red)' : 'var(--muted)';
  const dIcon   = avgDelta > 0 ? '▲' : avgDelta < 0 ? '▼' : ' -';

  let summaryHTML = `<div class="csm-drill-stats">
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${hmColor(avgScore)}">${avgScore}</div>
      <div class="csm-drill-stat__label">Avg Score</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${dColor}">${dIcon} ${Math.abs(avgDelta)}</div>
      <div class="csm-drill-stat__label">7d Trend</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">${accs.length}</div>
      <div class="csm-drill-stat__label">Accounts</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">$${fmtNum(totalMRR)}</div>
      <div class="csm-drill-stat__label">MRR Managed</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:var(--green)">${healthyCt}</div>
      <div class="csm-drill-stat__label">Healthy</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${atRiskCt?'var(--red)':'var(--muted)'}">${atRiskCt}</div>
      <div class="csm-drill-stat__label">At Risk</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val" style="color:${overdueCt?'var(--red)':'var(--muted)'}">${overdueCt}</div>
      <div class="csm-drill-stat__label">Overdue</div>
    </div>
    <div class="csm-drill-stat">
      <div class="csm-drill-stat__val">${renewals90}</div>
      <div class="csm-drill-stat__label">Renewals ≤90d</div>
    </div>
  </div>`;

  // --- Sort by urgency: worst health + soonest renewal + highest MRR ---
  const urgency = c => {
    const statusW = c.status === 'critical' ? 5 : c.status === 'risk' ? 4 : c.status === 'watch' ? 3 : c.status === 'healthy' ? 2 : 1;
    const renewalW = c.renewal != null && c.renewal > 0 ? Math.max(0, 13 - c.renewal) : 0;
    const mrrW = (c.mrr || 0) / 10000;
    const contactW = (c.days != null && c.days >= 14) ? 2 : 0;
    return (statusW * 10) + renewalW + mrrW + contactW;
  };
  const sorted = [...accs].sort((a, b) => urgency(b) - urgency(a));

  // --- Accounts table with overdue flags ---
  const OVERDUE_DAYS = 14;
  const tableHTML = `<table class="ct" style="min-width:auto;margin:0">
    <thead><tr>
      <th>Customer</th>
      <th>Score</th>
      <th>Trend</th>
      <th>Status</th>
      <th>MRR</th>
      <th>Last Contact</th>
      <th>Renewal</th>
      <th>Lifecycle</th>
    </tr></thead>
    <tbody>${sorted.map(c => {
      const renewStr = c.renewal_date
        ? new Date(c.renewal_date).toLocaleDateString()
        : (c.renewal ? c.renewal + 'mo' : ' -');
      const isOverdue = c.days != null && c.days >= OVERDUE_DAYS;
      const delta = getDelta7d(c);
      const trendHTML = delta > 0 ? `<span class="csm-trend up" style="font-size:var(--fs-xs);padding:1px 6px">▲ +${delta}</span>`
        : delta < 0 ? `<span class="csm-trend dn" style="font-size:var(--fs-xs);padding:1px 6px">▼ ${delta}</span>`
        : `<span class="csm-trend flat" style="font-size:var(--fs-xs);padding:1px 6px"> - 0</span>`;
      const contactCell = isOverdue
        ? `<span style="font-weight:700;color:var(--red)">${c.days}d ago</span> <span class="csm-overdue">OVERDUE</span>`
        : (c.days != null ? c.days + 'd ago' : ' -');
      return `<tr style="cursor:pointer" onclick="openDetail('${escHtml(c.id)}')">
        <td><strong>${escHtml(c.name)}</strong></td>
        <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:var(--fs-base);font-weight:700;color:${c.score>=65?'var(--green)':c.score>=50?'var(--amber)':'var(--red)'};background:${c.score>=65?'var(--green-l)':c.score>=50?'var(--amber-l)':'var(--red-l)'}">${c.score}</span></td>
        <td>${trendHTML}</td>
        <td>${badgeHTML(c.status)}</td>
        <td>$${fmtNum(c.mrr||0)}</td>
        <td>${contactCell}</td>
        <td>${renewStr}</td>
        <td style="font-size:var(--fs-base);color:var(--muted)">${c.lifecycle || ' -'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;

  // Insert expand row right after the parent
  const expandRow = document.createElement('tr');
  expandRow.className = 'csm-expand-row';
  expandRow.innerHTML = `<td colspan="${colCount}" class="csm-expand-cell">${summaryHTML}${tableHTML}</td>`;
  parentRow.after(expandRow);
}


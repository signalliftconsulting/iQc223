// ─── CSM PERFORMANCE DASHBOARD ───────────────────────────────

function renderCSMPerformance() {
  const active = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c));
  const statsWrap  = el('csmperf-stats');
  const tableWrap  = el('csmperf-wrap');
  if (!statsWrap || !tableWrap) return;

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

  const deltaIcon  = overallDelta > 0 ? '▲' : overallDelta < 0 ? '▼' : '—';
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

  statsWrap.innerHTML = `
    <div class="dash-kpi-card dash-kpi-blue">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${CSM_ICONS.people}</div>
        <span class="dash-kpi-label">Active CSMs</span>
      </div>
      <div class="dash-kpi-num">${totalCSMs}</div>
      <div class="dash-kpi-sub">~${avgAccsPerCSM} accounts each</div>
    </div>
    <div class="dash-kpi-card dash-kpi-purple">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${CSM_ICONS.chart}</div>
        <span class="dash-kpi-label">Total Accounts</span>
      </div>
      <div class="dash-kpi-num">${totalAccounts}</div>
      <div class="dash-kpi-sub">${totalHealthy} healthy · ${active.filter(c=>c.status==='watch').length} watch</div>
    </div>
    <div class="dash-kpi-card dash-kpi-teal">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${CSM_ICONS.dollar}</div>
        <span class="dash-kpi-label">Total MRR</span>
      </div>
      <div class="dash-kpi-num">$${fmtNum(totalMRR)}</div>
      <div class="dash-kpi-sub">${totalAtRisk ? '$' + fmtNum(riskMRRTotal) + ' at risk' : 'No MRR at risk'}</div>
    </div>
    <div class="dash-kpi-card ${healthScoreGradient}">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${CSM_ICONS.pulse}</div>
        <span class="dash-kpi-label">Avg Health Score</span>
      </div>
      <div class="dash-kpi-num">${overallAvg}</div>
      <div class="dash-kpi-sub">${deltaIcon} ${Math.abs(overallDelta)} pts this week</div>
    </div>
    <div class="dash-kpi-card ${riskGradient}">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon" style="background:rgba(255,255,255,.15)">${CSM_ICONS.alert}</div>
        <span class="dash-kpi-label">At-Risk Accounts</span>
      </div>
      <div class="dash-kpi-num">${totalAtRisk}</div>
      <div class="dash-kpi-sub">${totalOverdue ? totalOverdue + ' overdue contacts' : 'All contacts current'}</div>
    </div>
  `;

  // --- No CSMs ---
  if (displayList.length === 0 || (displayList.length === 1 && displayList[0].name === 'Unassigned')) {
    tableWrap.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">
      <div style="font-size:2rem;margin-bottom:8px;opacity:.3">👥</div>
      <h3 style="margin-bottom:4px">No CSMs assigned yet</h3>
      <p style="font-size:.85rem">Assign managers to your customers to see per-CSM performance metrics.</p>
    </div>`;
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
    return `<span class="csm-trend flat">— 0</span>`;
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

  // --- CSM Leaderboard Table ---
  const colCount = 12;
  tableWrap.innerHTML = `<div class="csm-perf-table-wrap"><table class="ct" id="csm-perf-table">
    <thead><tr>
      <th style="width:36px">Rank</th>
      <th>CSM</th>
      <th>Score</th>
      <th>Perf Index</th>
      <th>Trend (7d)</th>
      <th>Health Mix</th>
      <th>Accounts</th>
      <th>MRR Managed</th>
      <th>At-Risk MRR</th>
      <th>Avg Contact</th>
      <th>Renewals ≤90d</th>
      <th></th>
    </tr></thead>
    <tbody id="csm-perf-tbody">${displayList.map(m => {
      const contactWarn = m.avgDays != null && m.avgDays >= 14;
      const safeName = escHtml(m.name).replace(/'/g, "\\'");
      return `<tr data-csm="${escHtml(m.name)}" class="csm-row">
      <td style="text-align:center">${rankBadge(m.rank)}</td>
      <td><strong>${escHtml(m.name)}</strong>${m.overdueCount ? ` <span style="font-size:.66rem;color:var(--red);font-weight:700">${m.overdueCount} overdue</span>` : ''}</td>
      <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.78rem;font-weight:700;color:${hmColor(m.avgScore)};background:${hmBg(m.avgScore)}">${m.avgScore}</span></td>
      <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.78rem;font-weight:700;color:${hmColor(m.perfIndex)};background:${hmBg(m.perfIndex)}">${m.perfIndex}</span></td>
      <td>${trendBadge(m.avgDelta)}</td>
      <td>${healthBar(m)}</td>
      <td>${m.count}</td>
      <td>$${fmtNum(m.totalMRR)}</td>
      <td style="color:${m.riskMRR ? 'var(--red)' : 'var(--muted)'};font-weight:${m.riskMRR ? '700' : '400'}">$${fmtNum(m.riskMRR)}</td>
      <td style="color:${contactWarn?'var(--red)':'inherit'};font-weight:${contactWarn?'700':'400'}">${m.avgDays != null ? m.avgDays + 'd' : '—'}</td>
      <td>${m.renewals90 || '—'}</td>
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
function renderCSMWorkload(mgrList) {
  const wrap = el('csm-workload-wrap');
  if (!wrap) return;
  const list = mgrList.filter(m => m.name !== 'Unassigned');
  if (!list.length) { wrap.innerHTML = '<p style="padding:20px;text-align:center;color:var(--muted);font-size:.82rem">No CSMs to display.</p>'; return; }

  const maxAccounts = Math.max(...list.map(m => m.count), 1);
  const maxMRR      = Math.max(...list.map(m => m.totalMRR), 1);
  const avgAccounts = Math.round(list.reduce((s,m) => s + m.count, 0) / list.length);

  // Tier MRR breakdown per CSM
  const tierColors = { enterprise: 'var(--purple)', mid: 'var(--blue)', smb: 'var(--teal)' };
  const tierLabels = { enterprise: 'Enterprise', mid: 'Mid-Market', smb: 'SMB' };

  wrap.innerHTML = `
    <div style="padding:10px 16px 4px;display:flex;gap:16px;font-size:.68rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">
      <span style="flex:0 0 110px">CSM</span>
      <span style="flex:1">Accounts</span>
      <span style="flex:1">MRR by Tier</span>
    </div>
    ${list.sort((a,b) => b.count - a.count).map(m => {
      const accPct = Math.round((m.count / maxAccounts) * 100);
      const mrrPct = Math.round((m.totalMRR / maxMRR) * 100);
      const overloaded = m.count > avgAccounts * 1.4;
      const accColor = overloaded ? 'var(--amber)' : '#4f46e5';
      // Tier MRR breakdown
      const tierMRR = {};
      m.accs.forEach(c => {
        const t = (c.tier || 'smb').toLowerCase();
        tierMRR[t] = (tierMRR[t] || 0) + (c.mrr || 0);
      });
      const mTotal = m.totalMRR || 1;
      const entPct = Math.round((tierMRR.enterprise || 0) / mTotal * 100);
      const midPct = Math.round((tierMRR.mid || 0) / mTotal * 100);
      const smbPct = Math.max(0, 100 - entPct - midPct);
      const tierTitle = [
        tierMRR.enterprise ? 'Enterprise $' + fmtNum(tierMRR.enterprise) : '',
        tierMRR.mid ? 'Mid-Market $' + fmtNum(tierMRR.mid) : '',
        tierMRR.smb ? 'SMB $' + fmtNum(tierMRR.smb) : ''
      ].filter(Boolean).join(' · ');
      return `<div class="csm-workload-row">
        <div class="csm-workload-name">${escHtml(m.name)}</div>
        <div style="flex:1;display:flex;align-items:center;gap:8px">
          <div class="csm-workload-bar"><div class="csm-workload-fill" style="width:${accPct}%;background:${accColor}">${m.count}</div></div>
        </div>
        <div style="flex:1;display:flex;align-items:center;gap:8px">
          <div class="csm-workload-bar" style="position:relative;overflow:hidden" title="${tierTitle}">
            <div style="display:flex;width:${mrrPct}%;height:100%;border-radius:inherit">
              ${entPct ? `<span style="width:${entPct}%;background:#1e293b;min-width:0"></span>` : ''}
              ${midPct ? `<span style="width:${midPct}%;background:#ea580c;min-width:0"></span>` : ''}
              ${smbPct ? `<span style="width:${smbPct}%;background:var(--teal);min-width:0"></span>` : ''}
            </div>
            <span style="position:absolute;inset:0;display:flex;align-items:center;padding:0 8px;font-size:.68rem;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.3)">$${fmtNum(m.totalMRR)}</span>
          </div>
        </div>
      </div>`;
    }).join('')}
    <div style="padding:8px 16px;font-size:.68rem;color:var(--subtle);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span>Average: ${avgAccounts} accounts per CSM</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:#1e293b"></span>Enterprise</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:#ea580c"></span>Mid-Market</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:var(--teal)"></span>SMB</span>
      ${list.some(m => m.count > avgAccounts * 1.4) ? '<span style="color:var(--amber);font-weight:700">Amber bars = overloaded</span>' : ''}
    </div>
  `;
}

/* ─── SUGGESTED FOCUS AREAS ────────────────────────────────────── */
function renderCSMFocus(mgrList) {
  const wrap = el('csm-focus-wrap');
  if (!wrap) return;
  const items = [];
  const _fi = (path) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

  mgrList.filter(m => m.name !== 'Unassigned').forEach(m => {
    // Overdue contacts
    const overdueAccs = m.accs.filter(c => c.days != null && c.days >= 14);
    if (overdueAccs.length) {
      const names = overdueAccs.slice(0, 3).map(c => c.name).join(', ') + (overdueAccs.length > 3 ? ` +${overdueAccs.length - 3} more` : '');
      items.push({ csm: m.name, priority: 3, icon: _fi('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.09 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>'),
        color: 'var(--red)', bg: 'var(--red-l)',
        text: `<strong>${escHtml(m.name)}</strong> has ${overdueAccs.length} account${overdueAccs.length>1?'s':''} with no contact in 14+ days`,
        detail: names });
    }
    // At-risk renewals within 90 days
    const riskRenewals = m.accs.filter(c => (c.status === 'critical' || c.status === 'risk') && c.renewal != null && c.renewal > 0 && c.renewal <= 3);
    if (riskRenewals.length) {
      const names = riskRenewals.map(c => `${c.name} (${c.score})`).join(', ');
      items.push({ csm: m.name, priority: 4, icon: _fi('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
        color: 'var(--red)', bg: 'var(--red-l)',
        text: `<strong>${escHtml(m.name)}</strong> has ${riskRenewals.length} at-risk renewal${riskRenewals.length>1?'s':''} in the next 90 days`,
        detail: names });
    }
    // Declining portfolio (negative trend)
    if (m.avgDelta < -2) {
      items.push({ csm: m.name, priority: 2, icon: _fi('<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>'),
        color: 'var(--amber)', bg: 'var(--amber-l)',
        text: `<strong>${escHtml(m.name)}</strong>'s portfolio is declining (${m.avgDelta} avg this week)`,
        detail: `Avg score: ${m.avgScore}, ${m.atRisk} at risk` });
    }
    // High risk ratio
    if (m.count >= 3 && (m.atRisk / m.count) >= 0.4) {
      items.push({ csm: m.name, priority: 2, icon: _fi('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
        color: 'var(--red)', bg: 'var(--red-l)',
        text: `<strong>${escHtml(m.name)}</strong> has ${Math.round((m.atRisk/m.count)*100)}% of accounts at risk (${m.atRisk}/${m.count})`,
        detail: `$${fmtNum(m.riskMRR)} MRR at risk` });
    }
    // Positive callout — improving portfolio
    if (m.avgDelta >= 3) {
      items.push({ csm: m.name, priority: 0, icon: _fi('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
        color: 'var(--green)', bg: 'var(--green-l)',
        text: `<strong>${escHtml(m.name)}</strong> is improving their portfolio (+${m.avgDelta} avg this week)`,
        detail: `${m.healthy} healthy, avg score ${m.avgScore}` });
    }
  });

  items.sort((a, b) => b.priority - a.priority);

  if (!items.length) {
    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:.82rem"><div style="font-size:1.4rem;margin-bottom:6px;opacity:.3">✓</div>No urgent focus areas — all CSMs look good.</div>';
    return;
  }

  wrap.innerHTML = items.slice(0, 8).map(it => `
    <div class="csm-focus-item">
      <div class="csm-focus-icon" style="background:${it.bg};color:${it.color}">${it.icon}</div>
      <div class="csm-focus-text">
        <div>${it.text}</div>
        <p>${escHtml(it.detail)}</p>
      </div>
    </div>`).join('');
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
          csm: m.name, customer: c.name, from: oldStatus, to: currentStatus,
          improved, scoreDelta: currentScore - oldScore, mrr: c.mrr || 0
        });
      }
    });
  });

  if (!movements.length) {
    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:.82rem"><div style="font-size:1.4rem;margin-bottom:6px;opacity:.3">→</div>No health band changes in the last 7 days.</div>';
    return;
  }

  const statusLabel = s => (STATUS_LABEL[s] || s);
  // Sort: deteriorations first (more urgent), then improvements
  movements.sort((a, b) => a.improved - b.improved || b.mrr - a.mrr);

  wrap.innerHTML = movements.slice(0, 10).map(mv => {
    const arrowCls = mv.improved ? 'up' : 'dn';
    const arrowIcon = mv.improved ? '▲' : '▼';
    return `<div class="csm-movement-item">
      <span class="csm-movement-arrow ${arrowCls}">${arrowIcon}</span>
      <strong>${escHtml(mv.customer)}</strong>
      <span style="color:var(--muted)">moved from</span>
      ${badgeHTML(mv.from)}
      <span style="color:var(--muted)">→</span>
      ${badgeHTML(mv.to)}
      <span style="color:var(--muted);font-size:.72rem;margin-left:auto">${escHtml(mv.csm)} · $${fmtNum(mv.mrr)} MRR</span>
    </div>`;
  }).join('') + (movements.length > 10 ? `<div style="padding:8px 16px;font-size:.72rem;color:var(--subtle);text-align:center">+ ${movements.length - 10} more changes</div>` : '');
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
    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:.82rem"><div style="font-size:1.4rem;margin-bottom:6px;opacity:.3">📋</div>No recent CSM activity found.</div>';
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
    html += `<div style="padding:8px 16px 4px;font-size:.7rem;font-weight:700;color:var(--subtle);text-transform:uppercase;letter-spacing:.05em;background:var(--bg)">${escHtml(csm)}</div>`;
    entries.forEach(e => {
      let detail = '';
      try {
        const d = typeof e.details === 'string' ? JSON.parse(e.details) : (e.details || {});
        detail = d.summary ? escHtml(d.summary).substring(0, 80) : '';
      } catch {}
      html += `<div class="csm-activity-item">
        <div class="csm-activity-time">${relTime(e.created_at)}</div>
        <div class="csm-activity-body">
          <span style="display:inline-block;padding:1px 7px;border-radius:4px;font-size:.66rem;font-weight:700;color:${color(e.action)};background:color-mix(in srgb, ${color(e.action)} 12%, transparent)">${label(e.action)}</span>
          ${e.customer_name ? ` <strong>${escHtml(e.customer_name)}</strong>` : ''}
          ${detail ? `<p style="font-size:.72rem;color:var(--muted);margin-top:2px">${detail}</p>` : ''}
        </div>
      </div>`;
    });
  });

  wrap.innerHTML = html;
}

// Drill into a specific CSM's accounts — inline expand/collapse
function drillCSM(mgrName) {
  const tbody = el('csm-perf-tbody');
  if (!tbody) return;
  const colCount = window._csmColCount || 12;

  // Find the parent row for this CSM
  const parentRow = tbody.querySelector(`tr.csm-row[data-csm="${CSS.escape(mgrName)}"]`);
  if (!parentRow) return;

  // Check if already expanded — toggle off
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
  const dIcon   = avgDelta > 0 ? '▲' : avgDelta < 0 ? '▼' : '—';

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
        : (c.renewal ? c.renewal + 'mo' : '—');
      const isOverdue = c.days != null && c.days >= OVERDUE_DAYS;
      const delta = getDelta7d(c);
      const trendHTML = delta > 0 ? `<span class="csm-trend up" style="font-size:.68rem;padding:1px 6px">▲ +${delta}</span>`
        : delta < 0 ? `<span class="csm-trend dn" style="font-size:.68rem;padding:1px 6px">▼ ${delta}</span>`
        : `<span class="csm-trend flat" style="font-size:.68rem;padding:1px 6px">— 0</span>`;
      const contactCell = isOverdue
        ? `<span style="font-weight:700;color:var(--red)">${c.days}d ago</span> <span class="csm-overdue">OVERDUE</span>`
        : (c.days != null ? c.days + 'd ago' : '—');
      return `<tr style="cursor:pointer" onclick="openDetail('${escHtml(c.id)}')">
        <td><strong>${escHtml(c.name)}</strong></td>
        <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.78rem;font-weight:700;color:${c.score>=65?'var(--green)':c.score>=50?'var(--amber)':'var(--red)'};background:${c.score>=65?'var(--green-l)':c.score>=50?'var(--amber-l)':'var(--red-l)'}">${c.score}</span></td>
        <td>${trendHTML}</td>
        <td>${badgeHTML(c.status)}</td>
        <td>$${fmtNum(c.mrr||0)}</td>
        <td>${contactCell}</td>
        <td>${renewStr}</td>
        <td style="font-size:.78rem;color:var(--muted)">${c.lifecycle || '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;

  // Insert expand row right after the parent
  const expandRow = document.createElement('tr');
  expandRow.className = 'csm-expand-row';
  expandRow.innerHTML = `<td colspan="${colCount}" class="csm-expand-cell">${summaryHTML}${tableHTML}</td>`;
  parentRow.after(expandRow);
}


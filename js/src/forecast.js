// ── REVENUE FORECAST ───────────────────────────────────────
let _fcSortKey = 'impact';
let _fcSortDir = -1;
let _fcSearch = '';
let _fcTab = 'all';
let _fcCatFilter = 'all';

function setFcCatFilter(cat) {
  _fcCatFilter = cat;
  _renderFcTable();
}

// ── Classification ─────────────────────────────────────────

function _fcChurnProb(score) {
  if (score < 20) return 0.80;
  if (score < 40) return 0.50;
  if (score < 60) return 0.25;
  return 0.05;
}

function _fcExpansionEst(c) {
  return expansionConfig.mode === 'flat'
    ? expansionConfig.flat
    : Math.round((c.mrr || 0) * (expansionConfig.pct / 100));
}

function _fcClassify(c) {
  const mrr = c.mrr || 0;
  if (c.lifecycle === 'churned') return { cat: 'churn', impact: -mrr, prob: 1 };

  const score = c.score || 0;
  const delta = _getDeltaNd(c, 30);
  const declining = delta !== null && delta < 0;

  // Expand: high score + growth signal or won
  if (score >= 80 && (c.growth === 'strong' || c.lifecycle === 'won')) {
    return { cat: 'expand', impact: _fcExpansionEst(c), prob: 0 };
  }
  // Churn risk: very low score
  if (score < 30) {
    const prob = _fcChurnProb(score);
    return { cat: 'churn', impact: -Math.round(mrr * prob), prob };
  }
  // Contract: mid score + declining
  if (score < 60 && declining) {
    // Linear: 40% loss at score 30, 20% at score 59
    const pct = 0.40 - 0.20 * ((score - 30) / 29);
    return { cat: 'contract', impact: -Math.round(mrr * pct), prob: 0 };
  }
  // Retain
  return { cat: 'retain', impact: 0, prob: 0 };
}

// ── Dollar formatting for chart labels ─────────────────────

function _fcFmtDollar(v) {
  const abs = Math.abs(v);
  if (abs >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + fmtNum(Math.round(v));
}

// ── Waterfall Chart ────────────────────────────────────────

function _fcBuildWaterfall(start, expand, contract, churn, projected) {
  const W = 960, H = 300;
  const pad = { top: 32, right: 20, bottom: 44, left: 65 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  const maxVal = Math.max(start, start + expand, projected) * 1.15;
  if (maxVal <= 0) return '<div style="color:var(--muted);padding:20px;text-align:center">No MRR data to chart</div>';

  const yScale = (v) => pad.top + cH - (v / maxVal) * cH;
  const barW = cW / 7;
  const gap = (cW - barW * 5) / 6;
  const barX = (i) => pad.left + gap + i * (barW + gap);

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;font-family:inherit">`;

  // Y-axis gridlines
  const steps = 4;
  const stepVal = maxVal / steps;
  for (let i = 0; i <= steps; i++) {
    const val = stepVal * i;
    const y = yScale(val);
    svg += `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>`;
    svg += `<text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${_fcFmtDollar(val)}</text>`;
  }

  // Baseline
  svg += `<line x1="${pad.left}" y1="${yScale(0)}" x2="${W - pad.right}" y2="${yScale(0)}" stroke="var(--text)" stroke-width="1"/>`;

  // Bars
  const bars = [];
  let running = start;

  // Bar 0: Starting MRR
  bars.push({ x: barX(0), top: start, bot: 0, fill: '#64748b', label: _fcFmtDollar(start), name: 'Current MRR' });

  // Bar 1: Expansion
  const expBot = running;
  running += expand;
  bars.push({ x: barX(1), top: running, bot: expBot, fill: '#16a34a', label: '+' + _fcFmtDollar(expand), name: 'Expansion', connFrom: start });

  // Bar 2: Contraction
  const conTop = running;
  running -= contract;
  bars.push({ x: barX(2), top: conTop, bot: running, fill: '#d97706', label: '-' + _fcFmtDollar(contract), name: 'Contraction', connFrom: conTop });

  // Bar 3: Churn
  const chTop = running;
  running -= churn;
  bars.push({ x: barX(3), top: chTop, bot: running, fill: '#dc2626', label: '-' + _fcFmtDollar(churn), name: 'Churn', connFrom: chTop });

  // Bar 4: Projected MRR
  const projColor = projected >= start ? '#16a34a' : '#dc2626';
  bars.push({ x: barX(4), top: projected, bot: 0, fill: projColor, label: _fcFmtDollar(projected), name: 'Projected MRR', connFrom: running });

  // Draw connector lines + bars
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const y1 = yScale(b.top);
    const y2 = yScale(b.bot);
    const h = Math.max(1, y2 - y1);

    // Connector line from previous bar
    if (b.connFrom != null && i > 0) {
      const prevX = bars[i - 1].x + barW;
      const connY = yScale(b.connFrom);
      svg += `<line x1="${prevX}" y1="${connY}" x2="${b.x}" y2="${connY}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4,3" opacity="0.5"/>`;
    }

    // Bar rect with rounded top corners
    svg += `<rect x="${b.x}" y="${y1}" width="${barW}" height="${h}" rx="4" fill="${b.fill}" opacity="0.85"/>`;

    // Dollar label above bar
    svg += `<text x="${b.x + barW / 2}" y="${y1 - 8}" text-anchor="middle" font-size="12" font-weight="700" fill="${b.fill}">${b.label}</text>`;

    // Category label below
    svg += `<text x="${b.x + barW / 2}" y="${yScale(0) + 18}" text-anchor="middle" font-size="11" fill="var(--muted)">${b.name}</text>`;
  }

  svg += '</svg>';
  return svg;
}

// ── Analysis Insights ──────────────────────────────────────

function _fcBuildAnalysis(classified, startMRR, nrr, expandTotal, contractTotal, churnTotal) {
  const insights = [];
  const expandAccts = classified.filter(c => c.fc.cat === 'expand');
  const contractAccts = classified.filter(c => c.fc.cat === 'contract');
  const churnAccts = classified.filter(c => c.fc.cat === 'churn');

  // 1. NRR Summary
  const nrrRound = Math.round(nrr);
  let nrrTitle, nrrDetail, nrrAccent;
  if (nrrRound >= 110) {
    nrrTitle = 'Strong NRR projection at ' + nrrRound + '%';
    nrrDetail = `Expansion from <strong>${expandAccts.length}</strong> accounts (+$${fmtNum(expandTotal)}/mo) significantly outpaces risk. `;
    nrrDetail += contractAccts.length + churnAccts.length > 0
      ? `${contractAccts.length + churnAccts.length} accounts pose risk ($${fmtNum(contractTotal + churnTotal)}/mo), but net growth is strong.`
      : 'No significant contraction or churn risk detected.';
    nrrAccent = 'green';
  } else if (nrrRound >= 100) {
    nrrTitle = 'NRR projected at ' + nrrRound + '% - slight growth';
    nrrDetail = `Expansion ($${fmtNum(expandTotal)}/mo from ${expandAccts.length} accounts) edges out risk ($${fmtNum(contractTotal + churnTotal)}/mo from ${contractAccts.length + churnAccts.length} accounts). `;
    nrrDetail += 'Revenue is growing but the margin is thin. Reducing churn risk would strengthen the position.';
    nrrAccent = 'green';
  } else if (nrrRound >= 95) {
    nrrTitle = 'NRR projected at ' + nrrRound + '% - roughly flat';
    nrrDetail = `Expansion ($${fmtNum(expandTotal)}/mo from ${expandAccts.length} accounts) is being offset by risk ($${fmtNum(contractTotal + churnTotal)}/mo from ${contractAccts.length + churnAccts.length} accounts). `;
    nrrDetail += 'Focus on converting at-risk accounts to retain to push NRR above 100%.';
    nrrAccent = 'amber';
  } else {
    nrrTitle = 'NRR projected at ' + nrrRound + '% - revenue declining';
    nrrDetail = `Risk ($${fmtNum(contractTotal + churnTotal)}/mo) exceeds expansion ($${fmtNum(expandTotal)}/mo). `;
    nrrDetail += `${churnAccts.length} accounts at churn risk and ${contractAccts.length} contracting. Immediate action needed on the highest-MRR at-risk accounts.`;
    nrrAccent = 'red';
  }
  insights.push({ icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>', iconBg: nrrAccent === 'green' ? 'var(--green-l)' : nrrAccent === 'red' ? 'var(--red-l)' : 'var(--amber-l)', iconColor: nrrAccent === 'green' ? 'var(--green)' : nrrAccent === 'red' ? 'var(--red)' : 'var(--amber)', accent: nrrAccent, title: nrrTitle, detail: nrrDetail });

  // 2. Risk callout - biggest at-risk accounts
  const allRisk = [...contractAccts, ...churnAccts].sort((a, b) => Math.abs(b.fc.impact) - Math.abs(a.fc.impact));
  if (allRisk.length > 0) {
    const topRisk = allRisk.slice(0, 3);
    const totalRiskMrr = allRisk.reduce((s, c) => s + (c.mrr || 0), 0);
    const entRisk = allRisk.filter(c => c.tier === 'enterprise');
    let riskTitle = '$' + fmtNum(Math.round(totalRiskMrr)) + '/mo exposed across ' + allRisk.length + ' accounts';
    let riskDetail = topRisk.map(c => `${_taCustLink(c.name, c.id)} (score ${c.score}, $${fmtNum(c.mrr || 0)}/mo, ${c.fc.cat})`).join(', ') + '. ';
    const weightedLoss = Math.round(contractTotal + churnTotal);
    riskDetail += `Probability-weighted impact is $${fmtNum(weightedLoss)}/mo. `;
    if (entRisk.length > 0) {
      const entMrr = entRisk.reduce((s, c) => s + (c.mrr || 0), 0);
      riskDetail += `${entRisk.length} enterprise account${entRisk.length > 1 ? 's' : ''} ($${fmtNum(entMrr)}/mo) in this group - prioritize these.`;
    } else {
      const recoveryImpact = Math.round(totalRiskMrr / startMRR * 100);
      riskDetail += `Saving all at-risk accounts would protect ~${recoveryImpact} pts of NRR.`;
    }
    insights.push({ icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>', iconBg: 'var(--red-l)', iconColor: 'var(--red)', accent: 'red', title: riskTitle, detail: riskDetail });
  }

  // 3. Actionable - borderline accounts or expansion opportunity
  const borderline = classified.filter(c => c.fc.cat === 'retain' && (c.score || 0) >= 55 && (c.score || 0) <= 70 && c.renewal && c.renewal <= 90);
  if (borderline.length > 0) {
    const blMrr = borderline.reduce((s, c) => s + (c.mrr || 0), 0);
    insights.push({ icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', iconBg: 'var(--amber-l)', iconColor: 'var(--amber)', accent: 'amber', title: borderline.length + ' borderline accounts with upcoming renewals', detail: `${borderline.length} accounts scoring 55-70 with renewals in the next 90 days ($${fmtNum(blMrr)}/mo). These could tip to contract or strengthen to expand. A proactive touchpoint now could shift the outcome. ` + borderline.slice(0, 2).map(c => `${_taCustLink(c.name, c.id)} (${c.score}, $${fmtNum(c.mrr || 0)}/mo)`).join(', ') + '.' });
  } else if (expandAccts.length > 0) {
    const expMrr = expandAccts.reduce((s, c) => s + (c.mrr || 0), 0);
    insights.push({ icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>', iconBg: 'var(--green-l)', iconColor: 'var(--green)', accent: 'green', title: expandAccts.length + ' accounts ready for expansion ($' + fmtNum(expandTotal) + '/mo potential)', detail: expandAccts.slice(0, 3).map(c => `${_taCustLink(c.name, c.id)} (score ${c.score}, $${fmtNum(c.mrr || 0)}/mo)`).join(', ') + `. These accounts have high health scores and strong growth signals - ideal candidates for upsell conversations.` });
  }

  return insights;
}

// ── Tables ─────────────────────────────────────────────────

function setFcTab(tab) {
  _fcTab = tab;
  ['all', 'csm', 'tier', 'renewal'].forEach(t => {
    var btn = el('fc-tab-' + t);
    if (btn) btn.classList.toggle('active', t === tab);
  });
  _renderFcTable();
}

function sortFcTable(key) {
  if (_fcSortKey === key) _fcSortDir *= -1;
  else { _fcSortKey = key; _fcSortDir = key === 'name' ? 1 : -1; }
  _renderFcTable();
}

function _renderFcTable() {
  var wrap = el('fc-table-wrap');
  if (!wrap) return;

  var pool = customers.filter(function(c) { return c.lifecycle !== 'churned' && passesManagerFilter(c); });
  var classified = pool.map(function(c) { return Object.assign({}, c, { fc: _fcClassify(c), delta30: _getDeltaNd(c, 30) }); });

  if (_fcTab === 'csm') return _renderFcCsm(wrap, classified);
  if (_fcTab === 'tier') return _renderFcTier(wrap, classified);
  if (_fcTab === 'renewal') return _renderFcRenewal(wrap, classified);

  // All Customers table
  var q = _fcSearch.toLowerCase();
  var list = classified;
  if (q) list = list.filter(function(c) { return (c.name || '').toLowerCase().indexOf(q) !== -1; });
  if (_fcCatFilter !== 'all') list = list.filter(function(c) { return c.fc.cat === _fcCatFilter; });

  // Sort
  list.sort(function(a, b) {
    var va, vb;
    if (_fcSortKey === 'name') { va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); return _fcSortDir * (va < vb ? -1 : va > vb ? 1 : 0); }
    if (_fcSortKey === 'mrr') { va = a.mrr || 0; vb = b.mrr || 0; }
    else if (_fcSortKey === 'score') { va = a.score || 0; vb = b.score || 0; }
    else if (_fcSortKey === 'delta30') { va = a.delta30 || 0; vb = b.delta30 || 0; }
    else if (_fcSortKey === 'renewal') { va = a.renewal || 999; vb = b.renewal || 999; }
    else if (_fcSortKey === 'category') { var o = { churn: 0, contract: 1, retain: 2, expand: 3 }; va = o[a.fc.cat] || 2; vb = o[b.fc.cat] || 2; }
    else { va = Math.abs(a.fc.impact); vb = Math.abs(b.fc.impact); }
    return _fcSortDir * ((va || 0) - (vb || 0));
  });

  var catColors = { expand: '#dcfce7', retain: '', contract: '#fef3c7', churn: '#fee2e2' };
  var catBorders = { expand: 'var(--green)', retain: 'transparent', contract: 'var(--amber)', churn: 'var(--red)' };
  var catLabels = { expand: '<span style="color:var(--green);font-weight:600">Expand</span>', retain: '<span style="color:var(--muted)">Retain</span>', contract: '<span style="color:var(--amber);font-weight:600">Contract</span>', churn: '<span style="color:var(--red);font-weight:600">Churn</span>' };

  var arrow = _fcSortDir === 1 ? ' &#9650;' : ' &#9660;';
  var th = function(key, label) {
    return '<th style="cursor:pointer;white-space:nowrap;padding:8px 10px;font-size:var(--fs-sm);color:var(--muted);font-weight:600;text-align:left;border-bottom:2px solid var(--border)" onclick="sortFcTable(\'' + key + '\')">' + label + (_fcSortKey === key ? arrow : '') + '</th>';
  };

  function _fcChip(key, label, color) {
    var active = _fcCatFilter === key;
    var bg = active ? (color || 'var(--text)') : 'transparent';
    var fg = active ? '#fff' : 'var(--muted)';
    var bdr = active ? bg : 'var(--border)';
    return '<button onclick="setFcCatFilter(\'' + key + '\')" style="padding:4px 12px;font-size:var(--fs-sm);font-weight:600;border-radius:100px;border:1.5px solid ' + bdr + ';background:' + bg + ';color:' + fg + ';cursor:pointer;font-family:inherit">' + label + '</button>';
  }
  var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">' +
    '<input type="text" placeholder="Search customers..." value="' + escHtml(_fcSearch) + '" oninput="_fcSearch=this.value;_renderFcTable()" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:var(--fs-base);width:220px"/>' +
    _fcChip('all', 'All', 'var(--text)') +
    _fcChip('expand', 'Expand', 'var(--green)') +
    _fcChip('retain', 'Retain', 'var(--muted)') +
    _fcChip('contract', 'Contract', 'var(--amber)') +
    _fcChip('churn', 'Churn', 'var(--red)') +
  '</div>';
  html += '<div style="max-height:500px;overflow-y:auto"><table class="ct" style="width:100%;border-collapse:collapse">';
  html += '<thead><tr>' + th('name', 'Customer') + th('mrr', 'MRR') + th('score', 'Score') + th('delta30', '\u039430d') + th('renewal', 'Renewal') + th('category', 'Forecast') + th('impact', 'Impact') + '</tr></thead>';
  html += '<tbody>';

  list.forEach(function(c) {
    var bg = catColors[c.fc.cat] || '';
    var border = catBorders[c.fc.cat] || 'transparent';
    var d = c.delta30;
    var dStr = d === null ? '-' : (d > 0 ? '<span style="color:var(--green)">+' + Math.round(d) + '</span>' : d < 0 ? '<span style="color:var(--red)">' + Math.round(d) + '</span>' : '0');
    var ren = c.renewal != null ? c.renewal + 'd' : '-';
    var imp = c.fc.impact;
    var impStr = imp > 0 ? '<span style="color:var(--green)">+$' + fmtNum(imp) + '</span>' : imp < 0 ? '<span style="color:var(--red)">-$' + fmtNum(Math.abs(imp)) + '</span>' : '-';

    html += '<tr style="border-left:3px solid ' + border + ';background:' + (bg ? bg : 'transparent') + '">';
    html += '<td style="padding:7px 10px;font-weight:600"><a href="#" onclick="event.preventDefault();openDetail(\'' + escHtml(c.id) + '\')" style="color:var(--blue);text-decoration:none">' + escHtml(c.name) + '</a></td>';
    html += '<td style="padding:7px 10px">$' + fmtNum(c.mrr || 0) + '</td>';
    html += '<td style="padding:7px 10px">' + (c.score || 0) + '</td>';
    html += '<td style="padding:7px 10px">' + dStr + '</td>';
    html += '<td style="padding:7px 10px">' + ren + '</td>';
    html += '<td style="padding:7px 10px">' + (catLabels[c.fc.cat] || '') + '</td>';
    html += '<td style="padding:7px 10px;font-weight:600">' + impStr + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  wrap.innerHTML = html;
}

function _renderFcCsm(wrap, classified) {
  var groups = {};
  classified.forEach(function(c) {
    var mgr = c.manager || 'Unassigned';
    if (!groups[mgr]) groups[mgr] = [];
    groups[mgr].push(c);
  });

  var rows = Object.keys(groups).map(function(mgr) {
    var accts = groups[mgr];
    var bookMrr = accts.reduce(function(s, c) { return s + (c.mrr || 0); }, 0);
    var exp = accts.filter(function(c) { return c.fc.cat === 'expand'; }).reduce(function(s, c) { return s + c.fc.impact; }, 0);
    var con = accts.filter(function(c) { return c.fc.cat === 'contract'; }).reduce(function(s, c) { return s + Math.abs(c.fc.impact); }, 0);
    var ch = accts.filter(function(c) { return c.fc.cat === 'churn'; }).reduce(function(s, c) { return s + Math.abs(c.fc.impact); }, 0);
    var proj = bookMrr + exp - con - ch;
    var nrr = bookMrr > 0 ? Math.round(proj / bookMrr * 100) : 100;
    return { mgr: mgr, bookMrr: bookMrr, nrr: nrr, exp: exp, con: con, ch: ch, count: accts.length };
  });

  rows.sort(function(a, b) { return a.nrr - b.nrr; });

  var html = '<table class="ct" style="width:100%;border-collapse:collapse">';
  html += '<thead><tr><th style="padding:8px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:2px solid var(--border)">CSM</th><th style="padding:8px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:2px solid var(--border)">Book MRR</th><th style="padding:8px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:2px solid var(--border)">NRR %</th><th style="padding:8px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:2px solid var(--border)">Expansion</th><th style="padding:8px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:2px solid var(--border)">Contraction</th><th style="padding:8px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:2px solid var(--border)">Churn</th><th style="padding:8px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:2px solid var(--border)"># Accounts</th></tr></thead><tbody>';

  rows.forEach(function(r) {
    var nrrColor = r.nrr >= 100 ? 'var(--green)' : r.nrr >= 90 ? 'var(--amber)' : 'var(--red)';
    html += '<tr>';
    html += '<td style="padding:7px 10px;font-weight:600">' + escHtml(r.mgr) + '</td>';
    html += '<td style="padding:7px 10px">$' + fmtNum(r.bookMrr) + '</td>';
    html += '<td style="padding:7px 10px;font-weight:700;color:' + nrrColor + '">' + r.nrr + '%</td>';
    html += '<td style="padding:7px 10px;color:var(--green)">+$' + fmtNum(r.exp) + '</td>';
    html += '<td style="padding:7px 10px;color:var(--amber)">-$' + fmtNum(r.con) + '</td>';
    html += '<td style="padding:7px 10px;color:var(--red)">-$' + fmtNum(r.ch) + '</td>';
    html += '<td style="padding:7px 10px">' + r.count + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function _renderFcTier(wrap, classified) {
  var tiers = ['enterprise', 'mid', 'smb'];
  var tierLabels = { enterprise: 'Enterprise', mid: 'Mid-Market', smb: 'SMB' };

  var rows = tiers.map(function(t) {
    var accts = classified.filter(function(c) { return c.tier === t; });
    if (!accts.length) return null;
    var bookMrr = accts.reduce(function(s, c) { return s + (c.mrr || 0); }, 0);
    var exp = accts.filter(function(c) { return c.fc.cat === 'expand'; }).reduce(function(s, c) { return s + c.fc.impact; }, 0);
    var con = accts.filter(function(c) { return c.fc.cat === 'contract'; }).reduce(function(s, c) { return s + Math.abs(c.fc.impact); }, 0);
    var ch = accts.filter(function(c) { return c.fc.cat === 'churn'; }).reduce(function(s, c) { return s + Math.abs(c.fc.impact); }, 0);
    var proj = bookMrr + exp - con - ch;
    var nrr = bookMrr > 0 ? Math.round(proj / bookMrr * 100) : 100;
    return { tier: tierLabels[t] || t, bookMrr: bookMrr, nrr: nrr, exp: exp, con: con, ch: ch, count: accts.length };
  }).filter(Boolean);

  var html = '<table class="ct" style="width:100%;border-collapse:collapse">';
  html += '<thead><tr><th style="padding:8px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:2px solid var(--border)">Tier</th><th style="padding:8px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:2px solid var(--border)">Book MRR</th><th style="padding:8px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:2px solid var(--border)">NRR %</th><th style="padding:8px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:2px solid var(--border)">Expansion</th><th style="padding:8px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:2px solid var(--border)">Contraction</th><th style="padding:8px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:2px solid var(--border)">Churn</th><th style="padding:8px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:2px solid var(--border)"># Accounts</th></tr></thead><tbody>';

  rows.forEach(function(r) {
    var nrrColor = r.nrr >= 100 ? 'var(--green)' : r.nrr >= 90 ? 'var(--amber)' : 'var(--red)';
    html += '<tr>';
    html += '<td style="padding:7px 10px;font-weight:600">' + escHtml(r.tier) + '</td>';
    html += '<td style="padding:7px 10px">$' + fmtNum(r.bookMrr) + '</td>';
    html += '<td style="padding:7px 10px;font-weight:700;color:' + nrrColor + '">' + r.nrr + '%</td>';
    html += '<td style="padding:7px 10px;color:var(--green)">+$' + fmtNum(r.exp) + '</td>';
    html += '<td style="padding:7px 10px;color:var(--amber)">-$' + fmtNum(r.con) + '</td>';
    html += '<td style="padding:7px 10px;color:var(--red)">-$' + fmtNum(r.ch) + '</td>';
    html += '<td style="padding:7px 10px">' + r.count + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function _renderFcRenewal(wrap, classified) {
  var windows = [
    { label: 'Next 30 Days', min: 0, max: 30 },
    { label: '30-60 Days', min: 31, max: 60 },
    { label: '60-90 Days', min: 61, max: 90 }
  ];

  var html = '';
  windows.forEach(function(w) {
    var accts = classified.filter(function(c) { return c.renewal != null && c.renewal >= w.min && c.renewal <= w.max; });
    if (!accts.length) return;
    accts.sort(function(a, b) { return (a.score || 0) - (b.score || 0); });

    var totalMrr = accts.reduce(function(s, c) { return s + (c.mrr || 0); }, 0);
    var atRisk = accts.filter(function(c) { return (c.score || 0) < 50; });
    var riskMrr = atRisk.reduce(function(s, c) { return s + (c.mrr || 0); }, 0);

    html += '<div style="margin-bottom:16px">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><strong>' + w.label + '</strong><span style="color:var(--muted);font-size:var(--fs-sm)">' + accts.length + ' renewals - $' + fmtNum(totalMrr) + '/mo';
    if (atRisk.length > 0) html += ' - <span style="color:var(--red)">' + atRisk.length + ' at risk ($' + fmtNum(riskMrr) + ')</span>';
    html += '</span></div>';

    html += '<table class="ct" style="width:100%;border-collapse:collapse"><thead><tr>';
    html += '<th style="padding:6px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:1px solid var(--border)">Customer</th>';
    html += '<th style="padding:6px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:1px solid var(--border)">MRR</th>';
    html += '<th style="padding:6px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:1px solid var(--border)">Score</th>';
    html += '<th style="padding:6px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:1px solid var(--border)">Forecast</th>';
    html += '<th style="padding:6px 10px;text-align:left;font-size:var(--fs-sm);color:var(--muted);border-bottom:1px solid var(--border)">Days Out</th>';
    html += '</tr></thead><tbody>';

    accts.forEach(function(c) {
      var catLabels = { expand: '<span style="color:var(--green);font-weight:600">Expand</span>', retain: '<span style="color:var(--muted)">Retain</span>', contract: '<span style="color:var(--amber);font-weight:600">Contract</span>', churn: '<span style="color:var(--red);font-weight:600">Churn</span>' };
      var riskBg = (c.score || 0) < 50 ? '#fee2e2' : '';
      html += '<tr style="background:' + riskBg + '">';
      html += '<td style="padding:6px 10px;font-weight:600"><a href="#" onclick="event.preventDefault();openDetail(\'' + escHtml(c.id) + '\')" style="color:var(--blue);text-decoration:none">' + escHtml(c.name) + '</a></td>';
      html += '<td style="padding:6px 10px">$' + fmtNum(c.mrr || 0) + '</td>';
      html += '<td style="padding:6px 10px">' + (c.score || 0) + '</td>';
      html += '<td style="padding:6px 10px">' + (catLabels[c.fc.cat] || '') + '</td>';
      html += '<td style="padding:6px 10px">' + (c.renewal || '-') + 'd</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
  });

  if (!html) html = '<p style="color:var(--muted);padding:16px">No renewals in the next 90 days.</p>';
  wrap.innerHTML = html;
}

// ── Main Render ────────────────────────────────────────────

function renderForecast() { try { _renderForecast(); } catch (e) { console.error('renderForecast error:', e); } }

function _renderForecast() {
  var kpiRow = el('fc-kpi-row');
  if (!kpiRow) return;

  var pool = customers.filter(function(c) { return c.lifecycle !== 'churned' && passesManagerFilter(c); });
  var classified = pool.map(function(c) { return Object.assign({}, c, { fc: _fcClassify(c) }); });

  var startMRR = pool.reduce(function(s, c) { return s + (c.mrr || 0); }, 0);
  var expandTotal = 0, contractTotal = 0, churnTotal = 0;
  var expandCount = 0, contractCount = 0, churnCount = 0;

  classified.forEach(function(c) {
    if (c.fc.cat === 'expand') { expandTotal += c.fc.impact; expandCount++; }
    if (c.fc.cat === 'contract') { contractTotal += Math.abs(c.fc.impact); contractCount++; }
    if (c.fc.cat === 'churn') { churnTotal += Math.abs(c.fc.impact); churnCount++; }
  });

  var projectedMRR = startMRR + expandTotal - contractTotal - churnTotal;
  var nrr = startMRR > 0 ? (projectedMRR / startMRR * 100) : 100;

  // ── KPI Cards ──
  var nrrColor = nrr >= 100 ? '#0f766e' : nrr >= 90 ? '#b45309' : '#dc2626';
  var nrrBg = nrr >= 100 ? 'dash-kpi-teal' : nrr >= 90 ? 'dash-kpi-amber' : 'dash-kpi-red';
  var nrrIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>';
  var upIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>';
  var downIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>';
  var warnIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

  kpiRow.innerHTML = `
    <div class="dash-kpi-card ${nrrBg}">
      <div class="dash-kpi-hd"><div class="dash-kpi-icon">${nrrIcon}</div><span class="dash-kpi-label">Projected NRR</span></div>
      <div class="dash-kpi-body"><div class="dash-kpi-num" style="color:${nrrColor}">${Math.round(nrr)}%</div><div class="dash-kpi-sub">Net Revenue Retention (90-day)</div></div>
    </div>
    <div class="dash-kpi-card dash-kpi-green">
      <div class="dash-kpi-hd"><div class="dash-kpi-icon">${upIcon}</div><span class="dash-kpi-label">Expansion Pipeline</span></div>
      <div class="dash-kpi-body"><div class="dash-kpi-num" style="color:#16a34a">$${fmtNum(expandTotal)}</div><div class="dash-kpi-sub">${expandCount} account${expandCount !== 1 ? 's' : ''} with growth signals</div></div>
    </div>
    <div class="dash-kpi-card dash-kpi-amber">
      <div class="dash-kpi-hd"><div class="dash-kpi-icon">${downIcon}</div><span class="dash-kpi-label">Contraction Risk</span></div>
      <div class="dash-kpi-body"><div class="dash-kpi-num" style="color:#b45309">$${fmtNum(contractTotal)}</div><div class="dash-kpi-sub">${contractCount} account${contractCount !== 1 ? 's' : ''} with declining scores</div></div>
    </div>
    <div class="dash-kpi-card dash-kpi-red">
      <div class="dash-kpi-hd"><div class="dash-kpi-icon">${warnIcon}</div><span class="dash-kpi-label">Churn Risk</span></div>
      <div class="dash-kpi-body"><div class="dash-kpi-num" style="color:#dc2626">$${fmtNum(Math.round(churnTotal))}</div><div class="dash-kpi-sub">${churnCount} account${churnCount !== 1 ? 's' : ''} at risk of churning</div></div>
    </div>
  `;

  // ── Waterfall Chart ──
  var wfWrap = el('fc-waterfall-wrap');
  if (wfWrap) wfWrap.innerHTML = _fcBuildWaterfall(startMRR, expandTotal, contractTotal, churnTotal, projectedMRR);

  // ── Revenue Concentration chart ──
  var concWrap = el('fc-concentration-wrap');
  if (concWrap) {
    var sorted = classified.slice().sort(function(a, b) { return (b.mrr || 0) - (a.mrr || 0); });
    var totalMRR = sorted.reduce(function(s, c) { return s + (c.mrr || 0); }, 0) || 1;
    var top10 = sorted.slice(0, 5);
    var maxBar = top10.length ? (top10[0].mrr || 0) : 1;
    var statusColors = { critical: '#dc2626', risk: '#f59e0b', watch: '#eab308', healthy: '#10b981', expand: '#6366f1' };

    // Concentration metrics
    var top3MRR = sorted.slice(0, 3).reduce(function(s, c) { return s + (c.mrr || 0); }, 0);
    var top3Pct = (top3MRR / totalMRR * 100).toFixed(0);
    var top10MRR = top10.reduce(function(s, c) { return s + (c.mrr || 0); }, 0);
    var top10Pct = (top10MRR / totalMRR * 100).toFixed(0);
    var concentrationRisk = top3Pct > 50 ? 'high' : top3Pct > 35 ? 'moderate' : 'low';
    var concColor = concentrationRisk === 'high' ? '#dc2626' : concentrationRisk === 'moderate' ? '#f59e0b' : '#10b981';
    var concLabel = concentrationRisk === 'high' ? 'High concentration risk' : concentrationRisk === 'moderate' ? 'Moderate concentration' : 'Well diversified';

    // Warning banner
    var bannerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;background:color-mix(in srgb, ' + concColor + ' 8%, transparent);border:1px solid color-mix(in srgb, ' + concColor + ' 20%, transparent);margin-bottom:10px">' +
      '<div style="width:8px;height:8px;border-radius:50%;background:' + concColor + ';flex-shrink:0"></div>' +
      '<span style="font-size:var(--fs-sm);color:var(--text)">' + concLabel + ' - Top 3 accounts = <strong>' + top3Pct + '%</strong> of MRR, Top 5 = <strong>' + top10Pct + '%</strong></span>' +
    '</div>';

    // Bars
    var barsHTML = top10.map(function(c, i) {
      var mrr = c.mrr || 0;
      var pct = (mrr / totalMRR * 100).toFixed(1);
      var barW = (mrr / maxBar * 100).toFixed(1);
      var sColor = statusColors[c.status] || '#94a3b8';
      var name = (c.name || 'Unknown').length > 18 ? (c.name || 'Unknown').slice(0, 17) + '...' : (c.name || 'Unknown');
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:' + (i < 9 ? '4' : '0') + 'px">' +
        '<div style="width:110px;display:flex;align-items:center;gap:5px;flex-shrink:0;overflow:hidden">' +
          '<div style="width:7px;height:7px;border-radius:50%;background:' + sColor + ';flex-shrink:0" title="' + (c.status || '') + '"></div>' +
          '<span style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + (c.name || '') + '">' + name + '</span>' +
        '</div>' +
        '<div style="flex:1;background:var(--bg);border-radius:3px;height:18px;overflow:hidden">' +
          '<div style="width:' + barW + '%;height:100%;border-radius:3px;background:' + (i < 3 ? 'linear-gradient(90deg,' + sColor + ',' + sColor + 'cc)' : sColor + '66') + ';min-width:2px"></div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0;white-space:nowrap"><span style="font-size:12px;font-weight:600;color:var(--text)">$' + fmtNum(Math.round(mrr)) + '</span> <span style="font-size:10px;color:var(--muted)">' + pct + '%</span></div>' +
      '</div>';
    }).join('');

    concWrap.innerHTML = bannerHTML + barsHTML;
  }

  // ── Analysis ──
  var analysisWrap = el('fc-analysis-wrap');
  if (analysisWrap) {
    var insights = _fcBuildAnalysis(classified, startMRR, nrr, expandTotal, contractTotal, churnTotal);
    if (insights.length) {
      analysisWrap.innerHTML = '<div style="font-size:var(--fs-base);font-weight:700;color:var(--text);margin-bottom:8px">Analysis</div>' +
        insights.map(function(ins) {
          var cls = ins.accent === 'green' ? 'ta-card-green' : ins.accent === 'red' ? 'ta-card-red' : ins.accent === 'amber' ? 'ta-card-amber' : '';
          return '<div class="ta-card ' + cls + '"><div class="ta-icon" style="background:' + ins.iconBg + ';color:' + ins.iconColor + '">' + ins.icon + '</div><div><div class="ta-label">' + ins.title + '</div><div class="ta-detail">' + ins.detail + '</div></div></div>';
        }).join('');
    } else {
      analysisWrap.innerHTML = '';
    }
  }

  // ── Table ──
  _renderFcTable();
}

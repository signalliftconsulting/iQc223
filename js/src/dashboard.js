// ─── DASHBOARD WIDGETS (kept for Home Base) ─────────────────

function el(id) { return document.getElementById(id); }
function fmtNum(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
  return n.toLocaleString();
}

// ─── SIGNAL HEATMAP ─────────────────────────────────────────
function dashHeatSortBy(key) {
  if (dashHeatSort.key === key) dashHeatSort.dir *= -1;
  else { dashHeatSort.key = key; dashHeatSort.dir = key === 'name' ? 1 : -1; }
  renderHeatmap(customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c)));
}

function renderHeatmap(active) {
  const wrap = el('heatmap-wrap');
  if (!wrap) return;
  if (!active.length) {
    wrap.innerHTML = '<div style="color:var(--subtle);font-size:.8rem;padding:16px 0;text-align:center">No customers yet</div>';
    return;
  }

  // Sort — NPS/CSAT sort uses normalized 0-100
  const growOrder = { strong:2, mild:1, none:0 };
  const sorted = [...active].sort((a, b) => {
    let av, bv;
    switch (dashHeatSort.key) {
      case 'name':    av = a.name;     bv = b.name;     break;
      case 'score':   av = a.score;    bv = b.score;    break;
      case 'logins':  av = a.logins != null ? a.logins : -1;   bv = b.logins != null ? b.logins : -1;   break;
      case 'adoption':av = a.adoption != null ? a.adoption : -1; bv = b.adoption != null ? b.adoption : -1; break;
      case 'tickets': av = a.tickets != null ? a.tickets : -1;  bv = b.tickets != null ? b.tickets : -1;  break;
      case 'nps':     av = npsNormalized(a.nps); bv = npsNormalized(b.nps); break;
      case 'csat':    av = csatNormalized(a.csat); bv = csatNormalized(b.csat); break;
      case 'days':    av = a.days != null ? a.days : -1;     bv = b.days != null ? b.days : -1;     break;
      case 'growth':  av = growOrder[a.growth]||0; bv = growOrder[b.growth]||0; break;
      default:        av = a.score;    bv = b.score;
    }
    if (typeof av === 'string') return av.localeCompare(bv) * dashHeatSort.dir;
    return (av - bv) * dashHeatSort.dir;
  });

  const hmColor = (v, inv) => {
    const n = inv ? 100 - v : v;
    if (n < 50) return 'hm-r';
    if (n < 80) return 'hm-y';
    return 'hm-g';
  };

  // Header helper — shows sort arrow on active column
  const thHeat = (key, label) => {
    const isActive = dashHeatSort.key === key;
    const arrow    = isActive ? (dashHeatSort.dir === 1 ? ' ↑' : ' ↓') : '';
    return `<th onclick="dashHeatSortBy('${key}')" style="cursor:pointer;user-select:none;${isActive?'color:var(--blue)':''}" title="Sort by ${label}">${label}${arrow}</th>`;
  };

  wrap.innerHTML = `<table>
    <thead><tr>
      ${thHeat('name',    'Customer')}
      ${thHeat('score',   'Score')}
      ${thHeat('logins',  'Logins')}
      ${thHeat('adoption','Adoption')}
      ${thHeat('tickets', 'Tickets')}
      ${thHeat('nps',     'NPS')}
      ${thHeat('csat',    'CSAT')}
      ${thHeat('days',    'Last Cont.')}
      ${thHeat('growth',  'Growth')}
    </tr></thead>
    <tbody>${sorted.map(c => {
      const loginPct  = c.logins != null ? Math.round((c.logins/30)*100) : 50;
      const ticketPct = c.tickets != null ? Math.max(0,100-c.tickets*20) : 50;
      const npsPct    = npsNormalized(c.nps);
      const csatPct   = csatNormalized(c.csat);
      const daysPct   = c.days != null ? Math.max(0,100-(c.days/180)*100) : 50;
      const growPct   = {none:25,mild:65,strong:100}[c.growth]||25;
      return `<tr>
        <td class="nc" style="cursor:pointer" onclick="openDetail('${escHtml(c.id)}')">${c.name}</td>
        <td class="${hmColor(c.score,false)}">${c.score}</td>
        <td class="${hmColor(loginPct,false)}">${c.logins != null ? c.logins+'d' : '<span style="color:var(--subtle)">N/A</span>'}</td>
        <td class="${hmColor(c.adoption != null ? c.adoption : 50,false)}">${c.adoption != null ? c.adoption+'%' : '<span style="color:var(--subtle)">N/A</span>'}</td>
        <td class="${hmColor(ticketPct,false)}">${c.tickets != null ? c.tickets : '<span style="color:var(--subtle)">N/A</span>'}</td>
        <td class="${hmColor(npsPct,false)}">${npsDisplay(c.nps)}</td>
        <td class="${hmColor(csatPct,false)}">${csatDisplay(c.csat)}</td>
        <td class="${hmColor(daysPct,false)}">${c.days != null ? c.days+'d' : '<span style="color:var(--subtle)">N/A</span>'}</td>
        <td class="${hmColor(growPct,false)}">${c.growth}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

// ─── THIS WEEK'S WINS ────────────────────────────────────────
function renderWins(active) {
  const wrap = el('wins-wrap');
  if (!wrap) return;

  // Use getDelta7d() as single source of truth (matches detail panel & customers table)
  const wins = [];
  active.forEach(c => {
    if (!c.history || c.history.length < 2) return;
    const delta = getDelta7d(c);
    if (delta > 0) wins.push({ c, delta, newScore: c.score });
  });

  if (!wins.length) {
    wrap.innerHTML = '<div style="font-size:.78rem;color:var(--muted);padding:6px 0;text-align:center">No score improvements this week yet</div>';
    return;
  }

  // Sort by biggest improvement, show top 3 with "See all" link
  wins.sort((a,b) => b.delta - a.delta);
  const winsTotal = wins.length;
  const top = wins.slice(0, 3);
  const winsSeeAll = winsTotal > 3
    ? `<div class="widget-see-all" onclick="showAllDelta('up')">See all ${winsTotal} →</div>`
    : '';

  wrap.innerHTML = top.map(({ c, delta, newScore }) => {
    const st = getStatus(newScore);
    const badgeColor = STATUS_COLOR[st] || '#16a34a';
    const badgeBg    = { critical:'#fef2f2', risk:'#fff7ed', watch:'#fffbeb', healthy:'#f0fdf4', expand:'#ecfeff' }[st] || '#f0fdf4';
    return `
    <div class="win-item" onclick="openDetail('${escHtml(c.id)}')">
      <div style="width:32px;height:32px;border-radius:50%;background:${badgeBg};border:2px solid ${badgeColor};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span style="font-size:.72rem;font-weight:800;color:${badgeColor}">${newScore}</span>
      </div>
      <div style="flex:1;min-width:0">
        <div class="win-name">${escHtml(c.name)}</div>
        <div style="font-size:.68rem;color:var(--muted)">${STATUS_LABEL[st]}</div>
      </div>
      <span class="win-delta" style="display:flex;align-items:center;gap:3px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>+${delta}</span>
    </div>`;
  }).join('') + winsSeeAll;
}

// ─── BIGGEST DROPS ───────────────────────────────────────────
function renderDrops(active) {
  const wrap = el('drops-wrap');
  if (!wrap) return;

  // Use getDelta7d() as single source of truth (matches detail panel & customers table)
  const drops = [];
  active.forEach(c => {
    if (!c.history || c.history.length < 2) return;
    const delta = getDelta7d(c);
    if (delta < 0) drops.push({ c, delta, newScore: c.score });
  });

  if (!drops.length) {
    wrap.innerHTML = '<div style="font-size:.78rem;color:var(--muted);padding:6px 0;text-align:center">No score drops this week</div>';
    return;
  }

  // Sort by biggest drop (most negative first), show top 3 with "See all" link
  drops.sort((a,b) => a.delta - b.delta);
  const dropsTotal = drops.length;
  const topDrops   = drops.slice(0, 3);
  const dropsSeeAll = dropsTotal > 3
    ? `<div class="widget-see-all" onclick="showAllDelta('down')">See all ${dropsTotal} →</div>`
    : '';

  const statusBg = { critical:'#fef2f2', risk:'#fff7ed', watch:'#fffbeb', healthy:'#f0fdf4', expand:'#ecfeff' };

  wrap.innerHTML = topDrops.map(({ c, delta, newScore }) => {
    const st         = getStatus(newScore);
    const badgeColor = STATUS_COLOR[st] || '#ea580c';
    const badgeBg    = statusBg[st] || '#fff7ed';
    return `
    <div class="win-item" onclick="openDetail('${escHtml(c.id)}')">
      <div style="width:32px;height:32px;border-radius:50%;background:${badgeBg};border:2px solid ${badgeColor};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span style="font-size:.72rem;font-weight:800;color:${badgeColor}">${newScore}</span>
      </div>
      <div style="flex:1;min-width:0">
        <div class="win-name">${escHtml(c.name)}</div>
        <div style="font-size:.68rem;color:var(--muted)">${STATUS_LABEL[st]}</div>
      </div>
      <span style="font-size:.75rem;font-weight:800;color:#dc2626;white-space:nowrap;display:flex;align-items:center;gap:3px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>-${Math.abs(delta)}</span>
    </div>`;
  }).join('') + dropsSeeAll;
}

// Compute a customer's 7-day score delta (used for See All filtering + sorting)
function getDelta7d(c) {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const hist = c.history || [];
  const recent = hist.filter(h => new Date(h.date) >= weekAgo)
                     .sort((a,b) => new Date(b.date) - new Date(a.date));
  if (!recent.length) return 0;
  const before = hist.filter(h => new Date(h.date) < weekAgo)
                     .sort((a,b) => new Date(b.date) - new Date(a.date));
  const prev = before.length ? before[0].score : hist[0].score;
  return recent[0].score - prev;
}

// ─── RENEWAL PIPELINE WIDGET ─────────────────────────────────
function renderRenewalPipeline(active) {
  const wrap = el('renewal-pipeline-wrap');
  if (!wrap) return;
  const now = new Date(); now.setHours(0,0,0,0);
  const buckets = [
    { label:'0–30 days',  color:'#dc2626', bg:'#fef2f2', min:0,  max:30  },
    { label:'31–60 days', color:'#ea580c', bg:'#fff7ed', min:31, max:60  },
    { label:'61–90 days', color:'#d97706', bg:'#fffbeb', min:61, max:90  },
  ];
  const withDate = active.filter(c => c.renewal_date);
  if (!withDate.length) {
    wrap.innerHTML = '<div style="color:var(--subtle);font-size:.78rem;padding:8px 0;text-align:center">No accounts have a renewal date set. Add renewal dates when editing a customer.</div>';
    return;
  }
  const rows = buckets.map(b => {
    const grp = withDate.filter(c => {
      const days = Math.round((new Date(c.renewal_date) - now) / 86400000);
      return days >= b.min && days <= b.max;
    });
    const mrr    = grp.reduce((s,c)=>s+(c.mrr||0),0);
    const atRisk = grp.filter(c=>c.status==='critical'||c.status==='risk').length;
    return { ...b, count:grp.length, mrr, atRisk, ids: grp.map(c=>c.id) };
  });
  wrap.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
    ${rows.map(r => {
      const riskBadge = r.atRisk ? `<span style="color:${r.color};font-size:.68rem;font-weight:700">⚠ ${r.atRisk} at risk</span>` : '';
      const countText = r.count ? `${r.count} acct${r.count!==1?'s':''}` : `<span style="color:var(--subtle)">—</span>`;
      const clickable = r.count > 0;
      return `<div style="border-left:3px solid ${r.color};background:${r.bg};border-radius:6px;padding:9px 12px;${clickable?'cursor:pointer;transition:transform .15s,box-shadow .15s':''}" ${clickable?`onclick="filterRenewalBucket('Renewal ${r.label}',${JSON.stringify(r.ids)})" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 12px rgba(0,0,0,.1)'" onmouseout="this.style.transform='';this.style.boxShadow=''"`:''}>
        <div style="font-size:.65rem;font-weight:700;color:${r.color};text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">${r.label}</div>
        <div style="font-size:1.05rem;font-weight:800;color:#1e293b;margin-bottom:2px">${r.mrr ? '$'+fmtNum(r.mrr) : '—'}</div>
        <div style="font-size:.7rem;color:var(--muted);display:flex;gap:5px;align-items:center;flex-wrap:wrap">${countText}${r.atRisk?' · ':''}${riskBadge}</div>
      </div>`;
    }).join('')}
  </div>`;
}

// Navigate to customers tab filtered to a renewal pipeline bucket
function filterRenewalBucket(label, ids) {
  if (!ids || !ids.length) return;
  mrrExposureFilter = { label, ids: new Set(ids) };
  sortKey = 'renewal';
  sortDir = 1;
  nav('customers');
}

// Navigate to customers page pre-filtered to all improvers or all decliners this week
function showAllDelta(direction) {
  filterMode = 'all';
  columnFilters = {};
  columnFilters['_delta'] = { type: direction }; // 'up' or 'down'
  sortKey = '_delta';
  sortDir = direction === 'up' ? -1 : 1; // improvements desc, drops asc
  nav('customers');
}

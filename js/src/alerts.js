// ─── ALERTS ─────────────────────────────────────────────────

// Category definitions - SVG icons, no emoji
const _ico = (path) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const ALERT_ICONS = {
  health:    _ico('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  renewal:   _ico('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  cadence:   _ico('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.09 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  sentiment: _ico('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  momentum:  _ico('<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>'),
  tickets:   _ico('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
  expansion: _ico('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
  snoozed:   _ico('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  engagement:_ico('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  quiet:     _ico('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'),
  onboarding:_ico('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
};
const ALERT_CATS = {
  health:     { label:'Health',     icon: ALERT_ICONS.health,     type:'red'   },
  renewal:    { label:'Renewal',    icon: ALERT_ICONS.renewal,    type:'blue'  },
  cadence:    { label:'Cadence',    icon: ALERT_ICONS.cadence,    type:'amber' },
  sentiment:  { label:'Sentiment',  icon: ALERT_ICONS.sentiment,  type:'amber' },
  momentum:   { label:'Momentum',   icon: ALERT_ICONS.momentum,   type:'amber' },
  tickets:    { label:'Support',    icon: ALERT_ICONS.tickets,    type:'red'   },
  engagement: { label:'Engagement', icon: ALERT_ICONS.engagement, type:'amber' },
  quiet:      { label:'Quiet',      icon: ALERT_ICONS.quiet,      type:'amber' },
  expansion:  { label:'Expansion',  icon: ALERT_ICONS.expansion,  type:'green' },
  onboarding: { label:'Onboarding', icon: ALERT_ICONS.onboarding, type:'red'   },
};

// Severity order for sorting (lower = higher priority)
const ALERT_SEV = { red:0, amber:1, blue:2, green:3 };

// Dismissed alerts map: alertId → score at time of dismissal
// Alert reappears if customer's score changes from when it was dismissed
let dismissed = new Map();

// MRR exposure bucket → Set of customer IDs (kept in sync with renderAlerts)
let _mrrSeen = {};
// Stage bucket → Set of customer IDs (kept in sync with renderAlerts)
let _stageSeen = {};
// Cached alert arrays for click-to-filter (refreshed each render)
let _cachedActive = [];
let _cachedSnoozed = [];
let _cachedCritIds = new Set();
let _cachedMrrIds = new Set();
let _cachedAffectedIds = new Set();
let _cachedSnzIds = new Set();

function buildAlerts() {
  const alerts = [];
  const now = new Date();
  // Customer display snapshot - embedded in every alert for rich rendering
  const snap = c => ({ _score:c.score, _status:c.status, _tier:c.tier, _manager:c.manager||'', _days:c.days != null ? c.days : 0, _mrr:c.mrr||0 });

  customers.forEach(c => {
    if (c.lifecycle === 'churned') return;
    if (!passesManagerFilter(c)) return;

    // ── Health ──
    var _hMom = getMomentum(c);
    var _hDelta = getDelta7d(c);
    var _hTrend = _hMom === 'dn' ? ' · Declining ↘' + (_hDelta ? ' (' + _hDelta + 'pts)' : '') : _hMom === 'up' ? ' · Recovering ↗' : '';
    var _hTier = c.tier === 'enterprise' ? ' · Enterprise' : c.tier === 'smb' ? ' · SMB' : '';
    if (c.status === 'critical')
      alerts.push({ id:c.id+'-crit',  cid:c.id, cat:'health', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>is Critical - score ${c.score}</span>`,
        sub:`$${fmtNum(c.mrr||0)} MRR at risk${_hTrend}${_hTier}`, ...snap(c) });
    else if (c.status === 'risk')
      alerts.push({ id:c.id+'-risk',  cid:c.id, cat:'health', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>is At Risk - score ${c.score}</span>`,
        sub:`$${fmtNum(c.mrr||0)} MRR${_hTrend}${_hTier}`, ...snap(c) });
    else if (c.status === 'watch')
      alerts.push({ id:c.id+'-watch', cid:c.id, cat:'health', type:'amber',
        msg:`<strong>${escHtml(c.name)}</strong> <span>in Watch zone - score ${c.score}</span>`,
        sub:`$${fmtNum(c.mrr||0)} MRR${_hTrend}${_hTier}`, ...snap(c) });

    // ── Support tickets (only if tickets signal is active) ──
    if (signalOn(c,'tickets') && c.tickets >= 3) {
      var _tixCtx = c.tickets >= 5 ? 'Heavy support load - likely frustrated' : 'Multiple open issues - may signal product friction';
      var _tixSent = (signalOn(c,'nps') && npsIsDetractor(c.nps)) ? ' · NPS Detractor' : (signalOn(c,'csat') && csatIsPoor(c.csat)) ? ' · Low CSAT' : '';
      alerts.push({ id:c.id+'-tix', cid:c.id, cat:'tickets', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>has ${c.tickets} open support tickets</span>`,
        sub:`${_tixCtx}${_tixSent} · $${fmtNum(c.mrr||0)} MRR`, ...snap(c) });
    }

    // ── Low Logins (only if logins signal is active) ──
    if (signalOn(c,'logins') && c.logins != null && c.logins < 5) {
      var _loginCtx = c.logins === 0 ? 'Zero logins this month' : c.logins + ' logins/mo - well below healthy (15+)';
      alerts.push({ id:c.id+'-logins', cid:c.id, cat:'engagement', type:'amber',
        msg:`<strong>${escHtml(c.name)}</strong> <span>has low login frequency (${c.logins}/mo)</span>`,
        sub:`${_loginCtx} · Score ${c.score} · $${fmtNum(c.mrr||0)} MRR`, ...snap(c) });
    }

    // ── Low Adoption (only if adoption signal is active) ──
    if (signalOn(c,'adoption') && c.adoption != null && c.adoption < 30) {
      var _adoptCtx = c.adoption < 10 ? 'Nearly zero usage of available features' : Math.round(100 - c.adoption) + '% of features untouched';
      alerts.push({ id:c.id+'-adopt', cid:c.id, cat:'engagement', type:'amber',
        msg:`<strong>${escHtml(c.name)}</strong> <span>has low feature adoption (${c.adoption}%)</span>`,
        sub:`${_adoptCtx} · Score ${c.score} · $${fmtNum(c.mrr||0)} MRR`, ...snap(c) });
    }

    // ── Renewal (uses renewal_date for accurate countdown) ──
    if (c.renewal_date) {
      const d = new Date(c.renewal_date);
      const days = Math.round((d - now) / 86400000);
      if (days >= 0 && days <= renewalWindows.upcoming) {
        const urgency = days <= renewalWindows.critical ? 'red' : days <= renewalWindows.warning ? 'amber' : 'blue';
        const label   = days === 0 ? 'Today!' : days === 1 ? 'Tomorrow' : `${days} days`;
        var _rHealth = (c.status === 'critical' || c.status === 'risk') ? ' · ⚠ Health: ' + (c.status === 'critical' ? 'Critical' : 'At Risk') : c.status === 'healthy' || c.status === 'expand' ? ' · ✓ Health: Good' : '';
        alerts.push({ id:c.id+'-renew', cid:c.id, cat:'renewal', type:urgency,
          msg:`<strong>${escHtml(c.name)}</strong> <span>renews in ${label}</span>`,
          sub:`${d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} · $${fmtNum(c.mrr||0)} MRR${_rHealth}`, ...snap(c) });
      }
    } else if (c.renewal != null && c.renewal >= 0 && c.renewal <= 2) {
      var _rHealth2 = (c.status === 'critical' || c.status === 'risk') ? ' · ⚠ Health: ' + (c.status === 'critical' ? 'Critical' : 'At Risk') : '';
      alerts.push({ id:c.id+'-renew', cid:c.id, cat:'renewal', type:'blue',
        msg:`<strong>${escHtml(c.name)}</strong> <span>renews in ${fmtRenewalTime(c)}</span>`,
        sub:`$${fmtNum(c.mrr||0)} MRR${_rHealth2}`, ...snap(c) });
    }

    // ── Momentum ──
    if (getMomentum(c) === 'dn') {
      var _mDelta = getDelta7d(c);
      var _mDrivers = _nbaScoreDrivers(c);
      var _mDetail = _mDrivers.length ? _mDrivers.map(function(d){return d.label;}).join(', ') + ' driving the drop' : 'Check signal breakdown for details';
      alerts.push({ id:c.id+'-mom', cid:c.id, cat:'momentum', type:'amber',
        msg:`<strong>${escHtml(c.name)}</strong> <span>score declining${_mDelta ? ' (' + _mDelta + ' pts)' : ''} ↘</span>`,
        sub:`Score ${c.score} · ${_mDetail} · $${fmtNum(c.mrr||0)} MRR`, ...snap(c) });
    }

    // ── Sentiment (only if sentiment feature is active + log exists) ──
    if (hasFeature('sentiment')) {
      const sent = latestSentiment(c);
      if (sent?.val === 'negative') {
        var _sentCtx = (c.status === 'critical' || c.status === 'risk') ? 'Negative call on an at-risk account - escalate' : 'Follow up to address concerns raised';
        var _sentMom = getMomentum(c) === 'dn' ? ' · Score declining ↘' : '';
        alerts.push({ id:c.id+'-sent', cid:c.id, cat:'sentiment', type:'amber',
          msg:`<strong>${escHtml(c.name)}</strong> <span>last call logged as negative</span>`,
          sub:`${_sentCtx} · $${fmtNum(c.mrr||0)} MRR${_sentMom}`, ...snap(c) });
      }
    }

    // ── NPS Detractor (only if NPS signal is active) ──
    if (signalOn(c,'nps') && npsIsDetractor(c.nps)) {
      var _npsCtx = c.nps <= 4 ? 'Strongly negative - likely telling others' : 'Detractor range - at risk of spreading negative word';
      alerts.push({ id:c.id+'-nps', cid:c.id, cat:'sentiment', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>is an NPS Detractor (${npsDisplay(c.nps)})</span>`,
        sub:`${_npsCtx} · Score ${c.score} · $${fmtNum(c.mrr||0)} MRR`, ...snap(c) });
    }

    // ── CSAT Poor (only if CSAT signal is active) ──
    if (signalOn(c,'csat') && csatIsPoor(c.csat)) {
      var _csatCtx = c.csat <= 2 ? 'Very dissatisfied - needs immediate outreach' : 'Below acceptable - follow up on what\'s not working';
      alerts.push({ id:c.id+'-csat', cid:c.id, cat:'sentiment', type:'red',
        msg:`<strong>${escHtml(c.name)}</strong> <span>has a poor CSAT rating (${csatDisplay(c.csat)})</span>`,
        sub:`${_csatCtx} · Score ${c.score} · $${fmtNum(c.mrr||0)} MRR`, ...snap(c) });
    }

    // ── Expansion opportunity (only if growth signal is active + no recent touch) ──
    if (signalOn(c,'growth') && (c.status === 'expand' || c.status === 'healthy') && (c.mrr||0) >= 3000) {
      const daysSince = c.days != null ? c.days : 0;
      if (!signalOn(c,'days') || daysSince >= 30) {
        var _expTier = c.tier === 'enterprise' ? 'High-value Enterprise account' : c.tier === 'smb' ? 'Growing SMB account' : 'Mid-Market account';
        var _expAdopt = (c.adoption != null && c.adoption >= 70) ? ' · High adoption (' + c.adoption + '%)' : '';
        alerts.push({ id:c.id+'-exp', cid:c.id, cat:'expansion', type:'green',
          msg:`<strong>${escHtml(c.name)}</strong> <span>expansion opportunity - ${daysSince}d since last touch</span>`,
          sub:`${_expTier} · $${fmtNum(c.mrr||0)} MRR · Score ${c.score}${_expAdopt}`, ...snap(c) });
      }
    }

    // ── Quiet Account (zero activity across all signals) ──
    const _quietFired = isQuietAccount(c);
    if (_quietFired) {
      const qDays = getQuietDays(c);
      const qType = qDays >= 30 ? 'red' : 'amber';
      var _qLife = c.lifecycle === 'onboarding' ? 'Gone silent during onboarding' : c.lifecycle === 'active' ? (qDays >= 45 ? 'Extended silence - possible ghost churn' : 'Complete disengagement') : 'No activity detected';
      var _qRenew = (c.renewal != null && c.renewal <= 3) ? ' · Renewal in ' + c.renewal + ' mo' : '';
      alerts.push({ id:c.id+'-quiet', cid:c.id, cat:'quiet', type:qType,
        msg:`<strong>${escHtml(c.name)}</strong> <span>has gone completely quiet - ${qDays} days, zero activity</span>`,
        sub:`${_qLife} · $${fmtNum(c.mrr||0)} MRR${_qRenew}`, ...snap(c) });
    }

    // ── Key Contact Gone Quiet - named contact, no activity 21+ days ──
    if (!_quietFired && c.contact_name) {
      const kcDays = getEffectiveDays(c);
      if (kcDays != null && kcDays >= 21) {
        const kcType = kcDays >= 30 ? 'red' : 'amber';
        var _kcCtx = kcDays >= 45 ? 'May have left the company - verify contact is still active' : kcDays >= 30 ? 'Significant gap - risk of losing champion relationship' : 'Approaching disengagement threshold';
        var _kcMom = getMomentum(c) === 'dn' ? ' · Score declining ↘' : '';
        alerts.push({ id:c.id+'-kcQuiet', cid:c.id, cat:'quiet', type:kcType,
          msg:`<strong>${escHtml(c.name)}</strong> <span>key contact ${escHtml(c.contact_name)} - no activity in ${kcDays}d</span>`,
          sub:`${_kcCtx} · $${fmtNum(c.mrr||0)} MRR${_kcMom}`, ...snap(c) });
      }
    }

    // ── Pre-Renewal Risk - engagement drop within 60 days of renewal ──
    if (c.renewal_date) {
      const prDays = Math.round((new Date(c.renewal_date) - now) / 86400000);
      if (prDays >= 0 && prDays <= 60 && (getMomentum(c) === 'dn' || getDelta7d(c) <= -5)) {
        const delta = getDelta7d(c);
        var _prDrivers = _nbaScoreDrivers(c);
        var _prDetail = _prDrivers.length ? _prDrivers.map(function(d){return d.label;}).join(', ') : 'multiple signals weakening';
        var _prUrgency = prDays <= 14 ? 'Immediate save plan needed' : prDays <= 30 ? 'Urgent - limited time before renewal' : 'Act now while there\'s still time';
        alerts.push({ id:c.id+'-preRenew', cid:c.id, cat:'renewal', type:'red',
          msg:`<strong>${escHtml(c.name)}</strong> <span>renews in ${prDays}d with declining health (${delta >= 0 ? '+' : ''}${delta} pts)</span>`,
          sub:`${_prUrgency} · ${_prDetail} · $${fmtNum(c.mrr||0)} MRR`, ...snap(c) });
      }
    }

    // ── Expansion Signal Enhanced - multi-signal strength ──
    const _expFired = signalOn(c,'growth') && (c.status === 'expand' || c.status === 'healthy') && (c.mrr||0) >= 3000;
    if (!_expFired && c.score >= 75 && (c.adoption != null && c.adoption >= 70) && c.growth && c.growth !== 'none' && (c.logins != null && c.logins >= 10)) {
      var _esTier = c.tier === 'enterprise' ? 'Enterprise upsell opportunity' : c.tier === 'smb' ? 'SMB growth candidate' : 'Strong expansion candidate';
      var _esMom = getMomentum(c) === 'up' ? ' · Momentum ↗' : '';
      alerts.push({ id:c.id+'-expSig', cid:c.id, cat:'expansion', type:'green',
        msg:`<strong>${escHtml(c.name)}</strong> <span>expansion signals - ${c.adoption}% adoption, strong engagement, growth detected</span>`,
        sub:`${_esTier} · $${fmtNum(c.mrr||0)} MRR · Score ${c.score}${_esMom}`, ...snap(c) });
    }

    // ── Support Spike - tickets above historical baseline ──
    if (signalOn(c,'tickets') && c.tickets >= 3) {
      const hist = c.history || [];
      const d30 = new Date(now - 30*86400000), d90 = new Date(now - 90*86400000);
      const older = hist.filter(h => { const d = new Date(h.date); return d >= d90 && d < d30 && h.signals?.tickets != null; });
      const baseline = older.length ? older.reduce((s,h) => s + h.signals.tickets, 0) / older.length : null;
      if (baseline != null && c.tickets >= baseline * 2) {
        var _spikeRatio = Math.round(c.tickets / baseline);
        var _spikeCtx = _spikeRatio >= 4 ? 'Major escalation risk - investigate root cause immediately' : 'Significant increase - may indicate product issue or unmet need';
        var _spikeMom = getMomentum(c) === 'dn' ? ' · Score declining ↘' : '';
        alerts.push({ id:c.id+'-tixSpike', cid:c.id, cat:'tickets', type:'red',
          msg:`<strong>${escHtml(c.name)}</strong> <span>support spike - ${c.tickets} tickets vs ${Math.round(baseline)} avg baseline</span>`,
          sub:`${_spikeRatio}x above normal · ${_spikeCtx} · $${fmtNum(c.mrr||0)} MRR${_spikeMom}`, ...snap(c) });
      }
    }

    // ── Ghosted After Onboarding - login drop-off 30-90 days post-start ──
    if (c.since && c.lifecycle !== 'churned' && c.lifecycle !== 'won') {
      const sinceDays = Math.round((now - new Date(c.since)) / 86400000);
      if (sinceDays >= 30 && sinceDays <= 90 && (c.logins == null || c.logins < 3)) {
        var _goAdopt = (c.adoption != null && c.adoption < 20) ? 'Near-zero adoption - onboarding may not have stuck' : 'Low engagement post-onboarding';
        var _goMrr = (c.mrr||0) >= 5000 ? ' · High-value account ($' + fmtNum(c.mrr||0) + '/mo)' : ' · $' + fmtNum(c.mrr||0) + ' MRR';
        alerts.push({ id:c.id+'-ghostOb', cid:c.id, cat:'onboarding', type:'red',
          msg:`<strong>${escHtml(c.name)}</strong> <span>going dark ${sinceDays}d after onboarding - ${c.logins != null ? c.logins + ' logins/mo' : 'no login data'}</span>`,
          sub:`${_goAdopt}${_goMrr} · Score ${c.score}`, ...snap(c) });
      }
    }

    // ── NPS Drop + Silence - NPS decreased with no engagement ──
    if (signalOn(c,'nps') && c.nps != null) {
      const npsHist = (c.history || []).filter(h => h.signals?.nps != null).sort((a,b) => new Date(b.date) - new Date(a.date));
      const prevNps = npsHist.length >= 2 ? npsHist[1].signals.nps : null;
      if (prevNps != null && c.nps < prevNps) {
        const effDays = getEffectiveDays(c);
        const silent = (effDays != null && effDays >= 14) || (c.logins != null && c.logins < 5);
        if (silent)
          alerts.push({ id:c.id+'-npsDrop', cid:c.id, cat:'sentiment', type:'red',
            msg:`<strong>${escHtml(c.name)}</strong> <span>NPS dropped ${prevNps} → ${c.nps} with low engagement</span>`,
            sub:`${npsDisplay(c.nps)} · ${effDays != null ? effDays + 'd since contact' : 'Logins ' + (c.logins||0) + '/mo'}`, ...snap(c) });
      }
    }

    // ── Renewal ≤30 Days + Health Below 70 ──
    if (c.renewal_date) {
      const r30Days = Math.round((new Date(c.renewal_date) - now) / 86400000);
      if (r30Days >= 0 && r30Days <= 30 && c.score < 70) {
        // Skip if pre-renewal risk already fired (more specific)
        const preRenewFired = c.renewal_date && Math.round((new Date(c.renewal_date) - now) / 86400000) <= 60 && (getMomentum(c) === 'dn' || getDelta7d(c) <= -5);
        if (!preRenewFired) {
          var _r70Ctx = c.score < 50 ? 'Critical health going into renewal - save plan needed' : 'Below-threshold health - address concerns before renewal conversation';
          var _r70Tier = c.tier === 'enterprise' ? ' · Enterprise' : '';
          alerts.push({ id:c.id+'-renew70', cid:c.id, cat:'renewal', type:'red',
            msg:`<strong>${escHtml(c.name)}</strong> <span>renews in ${r30Days}d with health score ${c.score} - below 70</span>`,
            sub:`${_r70Ctx} · $${fmtNum(c.mrr||0)} MRR${_r70Tier}`, ...snap(c) });
        }
      }
    }
  });

  // ── Cadence alerts (only if days-since-contact signal is active) ──
  // Enrich cadence alerts with customer snapshot too
  const cadAlerts = buildCadenceAlerts();
  cadAlerts.forEach(a => {
    const c = customers.find(x => x.id === a.cid);
    if (c) Object.assign(a, { _score:c.score, _status:c.status, _tier:c.tier, _manager:c.manager||'', _days:c.days != null ? c.days : 0, _mrr:c.mrr||0 });
  });
  alerts.push(...cadAlerts);

  // Sort: severity first, then MRR desc
  alerts.sort((a,b) => {
    const sd = (ALERT_SEV[a.type]||9) - (ALERT_SEV[b.type]||9);
    if (sd !== 0) return sd;
    const ca = customers.find(x=>x.id===a.cid), cb = customers.find(x=>x.id===b.cid);
    return ((cb?.mrr||0) - (ca?.mrr||0));
  });

  return alerts;
}

// ─── MULTI-SELECT STATE ──────────────────────────────────────
let _selectedAlerts = new Set();
let _lastClickedAlert = null;
let _alertViewMode = 'briefing'; // 'briefing' | 'category' | 'priority' | 'customer' | 'table'
let _alertTableFilter = null;    // { label: string, ids: Set<string> } - null = all alerted customers
let _alertTblSort = { key: 'score', dir: 1 }; // 1=asc (worst first), -1=desc
let _alertTblFilters = {};  // column key → { type, val/vals/q/min/max }
let _openATF = null;        // currently open alert-table filter key
// Persistent expanded group state: Set of "viewMode:groupKey" strings
const _alertExpanded = new Set();

const ALERT_TBL_COLS = [
  { key:'name',    label:'Customer',     ftype:'text' },
  { key:'score',   label:'Score',        ftype:'number' },
  { key:'delta',   label:'\u0394 7d',    ftype:'number' },
  { key:'status',  label:'Status',       ftype:'enum', enumVals:['critical','risk','watch','healthy','expand'] },
  { key:'mrr',     label:'MRR',          ftype:'number' },
  { key:'days',    label:'Last Contact',  ftype:'number' },
  { key:'renewal', label:'Renewal',      ftype:'number' },
  { key:'alerts',  label:'Alerts',       ftype:'number' },
  { key:'tickets', label:'Tickets',      ftype:'number' },
  { key:'manager', label:'Manager',      ftype:'enum', enumFn:() => [...new Set(customers.map(c => c.manager || '').filter(Boolean))].sort() },
];

function _alertGroupKey(hd) {
  return _alertViewMode + ':' + (hd.id || hd.getAttribute('data-grp') || hd.textContent.replace(/\s+/g,' ').trim().replace(/\d+$/, '').trim());
}
function toggleAlertGroup(hd) {
  const body = hd.nextElementSibling;
  if (!body || !body.classList.contains('aw-grp-body')) return;
  const isHidden = getComputedStyle(body).display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  hd.classList.toggle('alert-grp-open', isHidden);
  // Persist
  const key = _alertGroupKey(hd);
  if (isHidden) _alertExpanded.add(key); else _alertExpanded.delete(key);
}
function toggleBriefTier(el) {
  el.classList.toggle('collapsed');
  const key = 'briefing:' + (el.getAttribute('data-tier') || '');
  if (el.classList.contains('collapsed')) _alertExpanded.delete(key); else _alertExpanded.add(key);
}

function setAlertView(mode, keepExpanded) {
  _alertViewMode = mode;
  if (mode !== 'table') {
    _alertTableFilter = null; // clear table filter when leaving table view
    Object.keys(_alertTblFilters).forEach(k => delete _alertTblFilters[k]); // clear column filters
    closeATFilter();
  }
  // Clear expanded state for this view mode unless told to keep it (e.g. widget-driven nav)
  if (!keepExpanded) {
    const prefix = mode + ':';
    [..._alertExpanded].forEach(k => { if (k.startsWith(prefix)) _alertExpanded.delete(k); });
  }
  const modeMap = { brief:'briefing', cat:'category', pri:'priority', cust:'customer', tbl:'table' };
  ['brief','cat','pri','cust','tbl'].forEach(k => {
    const btn = el('alert-view-' + k);
    if (btn) btn.classList.toggle('active', mode === modeMap[k]);
  });
  const searchBox = el('alert-cust-search');
  if (searchBox) searchBox.style.display = mode === 'briefing' ? 'none' : '';
  const selAllBtn = el('alerts-select-all-btn');
  if (selAllBtn) selAllBtn.style.display = mode === 'briefing' ? 'none' : '';
  renderAlerts();
}

function alertToggleSelect(aid, el, ev) {
  // Shift+click range selection
  if (ev && ev.shiftKey && _lastClickedAlert && _lastClickedAlert !== aid) {
    const allChecks = [...document.querySelectorAll('#alerts-list .aw-list-check')];
    const ids = allChecks.map(cb => {
      const m = cb.getAttribute('onclick')?.match(/alertToggleSelect\('([^']+)'/);
      return m ? m[1] : null;
    }).filter(Boolean);
    const startIdx = ids.indexOf(_lastClickedAlert);
    const endIdx = ids.indexOf(aid);
    if (startIdx !== -1 && endIdx !== -1) {
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      for (let i = lo; i <= hi; i++) {
        _selectedAlerts.add(ids[i]);
        const row = document.getElementById('alert-row-' + ids[i]);
        if (row) row.classList.add('aw-list-row--sel');
        if (allChecks[i]) allChecks[i].checked = true;
      }
      _lastClickedAlert = aid;
      _updateAlertBulkBar();
      return;
    }
  }
  // Normal toggle
  if (_selectedAlerts.has(aid)) _selectedAlerts.delete(aid);
  else _selectedAlerts.add(aid);
  _lastClickedAlert = aid;
  _updateAlertBulkBar();
  const row = document.getElementById('alert-row-'+aid);
  if (row) row.classList.toggle('aw-list-row--sel', _selectedAlerts.has(aid));
}

function alertsSelectAll() {
  const all = buildAlerts().filter(a => !isSnoozed(a.id) && !isDismissed(a.id));
  if (_selectedAlerts.size === all.length) {
    _selectedAlerts.clear();
  } else {
    all.forEach(a => _selectedAlerts.add(a.id));
  }
  _updateAlertBulkBar();
  _renderAlerts();
}

function alertsClearSelection() {
  _selectedAlerts.clear();
  _updateAlertBulkBar();
  _renderAlerts();
}

function _updateAlertBulkBar() {
  const bar = el('alert-bulk-bar');
  const cnt = el('alert-bulk-count');
  if (!bar) return;
  if (_selectedAlerts.size > 0) {
    bar.classList.add('visible');
    cnt.textContent = `${_selectedAlerts.size} selected`;
  } else {
    bar.classList.remove('visible');
  }
}

function toggleBulkSnoozeDd() {
  document.querySelectorAll('.snooze-dd__menu').forEach(m => {
    if (m.id !== 'bulk-snooze-menu') m.classList.remove('open');
  });
  el('bulk-snooze-menu')?.classList.toggle('open');
}

function bulkSnooze(days) {
  el('bulk-snooze-menu')?.classList.remove('open');
  const expiry = Date.now() + days * 86400000;
  _selectedAlerts.forEach(aid => snoozed.set(aid, expiry));
  const n = _selectedAlerts.size;
  _selectedAlerts.clear();
  saveSettings();
  logAudit('bulk_snooze', null, '', { summary: `${n} alert${n===1?'':'s'} snoozed for ${days}d` });
  renderAlerts();

  toast(`${n} alert${n===1?'':'s'} snoozed for ${days} day${days===1?'':'s'}`, 'default');
}

function bulkDismiss() {
  _selectedAlerts.forEach(aid => {
    const cid = aid.replace(/-[^-]+$/, '');
    const c = customers.find(x => x.id === cid);
    dismissed.set(aid, c ? c.score : null);
  });
  const n = _selectedAlerts.size;
  _selectedAlerts.clear();
  saveSettings();
  logAudit('bulk_dismiss', null, '', { summary: `${n} alert${n===1?'':'s'} dismissed` });
  renderAlerts();

  toast(`${n} alert${n===1?'':'s'} dismissed`, 'default');
}

// Standalone badge update - call after any data refresh to keep badge in sync
function updateAlertBadge() {
  try {
    const all    = buildAlerts();
    const active = all.filter(a => !isSnoozed(a.id) && !isDismissed(a.id));
    const ab = el('alert-badge');
    if (ab) { if (active.length > 0) { ab.textContent = active.length; ab.style.display = ''; } else ab.style.display = 'none'; }
    const bb = el('bell-badge');
    if (bb) { if (active.length > 0) { bb.textContent = active.length; bb.style.display = ''; } else bb.style.display = 'none'; }
  } catch(e) { console.warn('updateAlertBadge error:', e); }
}

function renderAlerts() { try { _renderAlerts(); } catch(e) { console.error('renderAlerts error:', e); } }
function _renderAlerts() {
  // Empty state when no customers loaded
  if (!customers.length) {
    var _alWrap = el('alerts-list');
    if (_alWrap) _alWrap.innerHTML = '<div class="empty-state" style="text-align:center;padding:80px 20px;color:#64748b"><div style="font-size:48px;margin-bottom:16px;opacity:.4">\uD83D\uDD14</div><h3 style="font-size:18px;color:#1e293b;margin-bottom:8px">No data yet</h3><p style="font-size:14px;margin-bottom:20px">Add customers or load demo data to get started.</p><button class="btn btn-sm btn-primary" data-action="nav" data-arg="homebase">Go to Home Base</button></div>';
    return;
  }
  const all    = buildAlerts();
  const active = all.filter(a => !isSnoozed(a.id) && !isDismissed(a.id));
  const snz    = all.filter(a =>  isSnoozed(a.id));
  _cachedActive = active;
  _cachedSnoozed = snz;
  const list   = el('alerts-list');

  // Update sidebar badge + topbar bell badge
  // Show unique customer count (not total alerts) for a cleaner number
  const _uniqueAlertCids = new Set(active.map(a => a.cid));
  const _alertDisplayCount = _uniqueAlertCids.size;
  const ab = el('alert-badge');
  if (ab) { if (_alertDisplayCount > 0) { ab.textContent = _alertDisplayCount; ab.style.display = ''; } else ab.style.display = 'none'; }
  const bb = el('bell-badge');
  if (bb) { if (_alertDisplayCount > 0) { bb.textContent = _alertDisplayCount; bb.style.display = ''; } else bb.style.display = 'none'; }

  _updateAlertBulkBar();

  // Show/hide view toggle bar
  const viewBar = el('alert-view-bar');
  if (viewBar) viewBar.style.display = (active.length || snz.length || _alertTableFilter) ? 'flex' : 'none';

  if (!active.length && !snz.length && !(_alertViewMode === 'table' && _alertTableFilter)) {
    list.innerHTML = '<div class="empty-st"><div class="ei"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div><h3>All clear!</h3><p>No alerts right now - all accounts are in good shape.</p></div>';
    renderAlertPanel(all, active, snz);
    return;
  }

  let html = '';

  // Search term for all views
  const _viewSearch = (el('alert-cust-search')?.value || '').trim().toLowerCase();

  if (_alertViewMode === 'briefing') {
    // ── Briefing view: prescribed actions grouped by urgency ──
    html = _renderBriefingView(active, snz);
  } else if (_alertViewMode === 'priority') {
    // ── Priority view: sort all active alerts by severity then score ──
    const sevOrder = { red:0, amber:1, blue:2, green:3 };
    const sevLabels = { red:'Critical', amber:'Warning', blue:'Attention', green:'Opportunity' };
    const sevColors = { red:'#b91c1c', amber:'#b45309', blue:'#1d4ed8', green:'#15803d' };

    // Filter by search
    let filtered = active;
    if (_viewSearch) {
      filtered = active.filter(a => {
        const c = customers.find(x => x.id === a.cid);
        const name = c ? c.name.toLowerCase() : '';
        return name.includes(_viewSearch) || (a.label||'').toLowerCase().includes(_viewSearch);
      });
    }

    // Sort: severity first, then score ascending (worst first)
    const sorted = [...filtered].sort((a,b) => {
      const sd = (sevOrder[a.type]??9) - (sevOrder[b.type]??9);
      if (sd !== 0) return sd;
      return (a._score||0) - (b._score||0);
    });

    // Group by severity
    const groups = {};
    sorted.forEach(a => {
      const sev = a.type || 'amber';
      if (!groups[sev]) groups[sev] = [];
      groups[sev].push(a);
    });

    let priHasResults = false;
    ['red','amber','blue','green'].forEach(sev => {
      const group = groups[sev];
      if (!group || !group.length) return;
      priHasResults = true;
      html += `<div class="aw-grp-hd" data-grp="${sev}" onclick="toggleAlertGroup(this)"><span class="aw-grp-hd__label" style="color:${sevColors[sev]}">${sevLabels[sev]}</span><span class="aw-grp-hd__count">${group.length}</span><span class="aw-grp-hd__chevron">›</span></div>`;
      html += `<div class="aw-grp-body">${group.map(a => alertItemHTML(a, false)).join('')}</div>`;
    });
    if (!priHasResults && _viewSearch) {
      html += `<div style="text-align:center;padding:28px 16px;color:var(--muted);font-size:var(--fs-md)">No alerts matching "${escHtml(_viewSearch)}"</div>`;
    }
  } else if (_alertViewMode === 'customer') {
    // ── Customer view: group by customer, sorted by worst score ──
    const custSearch = _viewSearch;
    const custMap = {};
    active.forEach(a => {
      if (!custMap[a.cid]) custMap[a.cid] = { alerts: [], name: '', score: 100, status: '', mrr: 0 };
      custMap[a.cid].alerts.push(a);
      const c = customers.find(x => x.id === a.cid);
      if (c) {
        custMap[a.cid].name = c.name;
        custMap[a.cid].score = c.score;
        custMap[a.cid].status = c.status;
        custMap[a.cid].mrr = c.mrr || 0;
      }
    });
    // Sort customers: lowest score first, then highest MRR
    let custList = Object.entries(custMap).sort((a,b) => {
      const sd = a[1].score - b[1].score;
      if (sd !== 0) return sd;
      return b[1].mrr - a[1].mrr;
    });
    // Filter by search
    if (custSearch) {
      custList = custList.filter(([, data]) => data.name.toLowerCase().includes(custSearch));
    }
    if (custList.length) {
      custList.forEach(([cid, data]) => {
        const scoreColor = STATUS_COLOR[data.status] || '#94a3b8';
        const _pillBg = data.status === 'critical' ? 'rgba(220,38,38,.08)' : data.status === 'risk' ? 'rgba(220,38,38,.06)' : data.status === 'watch' ? 'rgba(217,119,6,.06)' : 'rgba(8,145,178,.06)';
        html += `<div class="aw-grp-hd" data-cid="${escHtml(cid)}" data-grp="${escHtml(cid)}" onclick="toggleAlertGroup(this)">
          <span class="aw-grp-hd__score" style="background:${scoreColor}">${data.score}</span>
          <span class="aw-grp-hd__label" style="cursor:pointer;font-weight:600" onclick="event.stopPropagation();openDetail('${escHtml(cid)}')">${escHtml(data.name)}</span>
          ${data.mrr ? `<span style="font-weight:400;color:var(--subtle);font-size:.75rem">$${fmtNum(data.mrr)}</span>` : ''}
          <span class="aw-grp-hd__count">${data.alerts.length} alert${data.alerts.length !== 1 ? 's' : ''}</span>
          <span class="aw-grp-hd__chevron">›</span>
        </div>`;
        // Sort alerts within customer by severity
        const sevOrd = { red:0, amber:1, blue:2, green:3 };
        data.alerts.sort((a,b) => (sevOrd[a.type]??9) - (sevOrd[b.type]??9));
        html += `<div class="aw-grp-body">${data.alerts.map(a => alertItemHTML(a, false)).join('')}</div>`;
      });
    } else if (custSearch) {
      html += `<div style="text-align:center;padding:28px 16px;color:var(--muted);font-size:var(--fs-md)">No customers matching "${escHtml(custSearch)}"</div>`;
    }
  } else if (_alertViewMode === 'table') {
    // ── Table view: customer table inline ──
    // Build customer list from filter or all alerted customers
    const alertedIds = _alertTableFilter ? _alertTableFilter.ids : new Set(active.map(a => a.cid));
    let tblList = customers.filter(c => alertedIds.has(c.id) && passesManagerFilter(c));
    if (_viewSearch) tblList = tblList.filter(c => c.name.toLowerCase().includes(_viewSearch));
    // Count alerts per customer
    const alertCountMap = {};
    active.forEach(a => { alertCountMap[a.cid] = (alertCountMap[a.cid]||0) + 1; });
    // Sort by current sort key
    const sk = _alertTblSort.key, sd = _alertTblSort.dir;
    tblList.sort((a,b) => {
      let va, vb;
      if (sk === 'name')    { va = (a.name||'').toLowerCase(); vb = (b.name||'').toLowerCase(); return va < vb ? -sd : va > vb ? sd : 0; }
      if (sk === 'score')   { va = a.score||0; vb = b.score||0; }
      else if (sk === 'delta')   { va = getDelta7d(a); vb = getDelta7d(b); }
      else if (sk === 'mrr')     { va = a.mrr||0; vb = b.mrr||0; }
      else if (sk === 'days')    { va = a.days||0; vb = b.days||0; }
      else if (sk === 'renewal') { va = a.renewal!=null?a.renewal:999; vb = b.renewal!=null?b.renewal:999; }
      else if (sk === 'alerts')  { va = alertCountMap[a.id]||0; vb = alertCountMap[b.id]||0; }
      else if (sk === 'tickets') { va = a.tickets||0; vb = b.tickets||0; }
      else if (sk === 'status')  { const so = {critical:0,risk:1,watch:2,healthy:3,expand:4}; va = so[a.status]??5; vb = so[b.status]??5; }
      else if (sk === 'manager') { va = (a.manager||'').toLowerCase(); vb = (b.manager||'').toLowerCase(); return va < vb ? -sd : va > vb ? sd : 0; }
      else { va = 0; vb = 0; }
      return (va - vb) * sd;
    });

    // Apply column filters
    tblList = _applyATFilters(tblList, alertCountMap);

    const filterLabel = _alertTableFilter ? _alertTableFilter.label : 'All Alerted Customers';
    html += `<div style="display:flex;align-items:center;gap:8px;padding:12px 16px 14px;flex-wrap:wrap">
      <span style="font-size:var(--fs-base);font-weight:700;color:var(--text)">${escHtml(filterLabel)}</span>
      <span style="font-size:var(--fs-sm);color:var(--muted)">${tblList.length} customer${tblList.length!==1?'s':''}</span>
      ${_alertTableFilter ? `<button class="btn btn-xs btn-ghost" onclick="_alertTableFilter=null;renderAlerts()">✕ Clear filter</button>` : ''}
    </div>`;

    // Filter pills
    html += _renderATFilterPills();

    // Build sortable/filterable column headers
    const _funnelSVG = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`;
    const _thCols = ALERT_TBL_COLS.map(col => {
      const isActiveSort = sk === col.key;
      const filterActive = col.ftype && (col.key in _alertTblFilters);
      const arrow = `<span class="col-sort-arrow${isActiveSort ? '' : ' idle'}">${sd === 1 ? '\u25B2' : '\u25BC'}</span>`;
      const filterBtn = col.ftype
        ? `<button class="col-filter-btn${filterActive ? ' active' : ''}" onclick="event.stopPropagation();openATFilter('${escHtml(col.key)}',this)" title="Filter ${col.label}">${_funnelSVG}</button>`
        : '';
      const pinCls = col.key === 'name' ? ' class="col-pin"' : '';
      return `<th${pinCls}><div class="col-th-inner"><button class="col-sort-label" onclick="_alertTblSortBy('${escHtml(col.key)}')">${col.label}</button>${arrow}${filterBtn}</div></th>`;
    }).join('');

    if (tblList.length) {
      html += `<table class="ct" style="display:table;width:100%">
        <thead><tr>${_thCols}</tr></thead><tbody>` +
        tblList.map(c => {
          const cad = getCadenceStatus(c);
          const cnt = alertCountMap[c.id] || 0;
          const d7 = getDelta7d(c);
          const d7Color = d7 > 0 ? '#16a34a' : d7 < 0 ? '#dc2626' : 'var(--muted)';
          const d7Str = d7 > 0 ? '+'+d7 : d7 === 0 ? ' -' : String(d7);
          const renewalStr = c.renewal_date ? (() => {
            const d = new Date(c.renewal_date);
            const days = Math.round((d - new Date()) / 86400000);
            return days <= 0 ? '<span style="color:#dc2626;font-weight:700">Overdue</span>'
              : days <= 30 ? `<span style="color:#ea580c;font-weight:700">${days}d</span>`
              : `<span style="color:var(--muted)">${days}d</span>`;
          })() : ' -';
          return `<tr style="cursor:pointer" onclick="openDetail('${escHtml(c.id)}')">
            <td class="col-pin" style="padding:8px 12px"><strong>${escHtml(c.name)}</strong></td>
            <td style="padding:8px 12px">${scoreHTML(c)}</td>
            <td style="padding:8px 12px;font-size:var(--fs-base);font-weight:700;color:${d7Color}">${d7Str}</td>
            <td style="padding:8px 12px">${badgeHTML(c.status)}</td>
            <td style="padding:8px 12px">${c.mrr ? '$'+fmtNum(c.mrr) : ' -'}</td>
            <td style="padding:8px 12px"><span class="${cad.cls}">${cad.label.replace(/\\s*\\(\\d+d\\)/,'')}</span> <span style="font-size:var(--fs-sm);color:var(--muted)">${c.days != null ? c.days + 'd' : 'N/A'}</span></td>
            <td style="padding:8px 12px">${renewalStr}</td>
            <td style="padding:8px 12px"><span style="background:var(--red-l);color:var(--red);padding:2px 8px;border-radius:10px;font-size:var(--fs-sm);font-weight:700">${cnt}</span></td>
            <td style="padding:8px 12px;color:${c.tickets != null && c.tickets > 0 ? '#dc2626' : 'var(--subtle)'};font-weight:${c.tickets != null && c.tickets > 0 ? '700' : '400'}">${c.tickets != null ? c.tickets : 'N/A'}</td>
            <td style="padding:8px 12px;font-size:var(--fs-base);color:var(--subtle)">${c.manager ? escHtml(c.manager) : ' -'}</td>
          </tr>`;
        }).join('') + '</tbody></table>';
    } else {
      html += `<div style="text-align:center;padding:28px;color:var(--muted);font-size:var(--fs-md)">No matching customers</div>`;
    }
  } else {
    // ── Category view (default) - sorted most → least alerts ──
    // Filter by search
    let catActive = active;
    if (_viewSearch) {
      catActive = active.filter(a => {
        const c = customers.find(x => x.id === a.cid);
        const name = c ? c.name.toLowerCase() : '';
        return name.includes(_viewSearch) || (a.label||'').toLowerCase().includes(_viewSearch);
      });
    }
    const cats = ['health','tickets','quiet','engagement','renewal','cadence','momentum','sentiment','expansion','onboarding'];
    const catGroups = cats.map(cat => ({ cat, alerts: catActive.filter(a => a.cat === cat) })).filter(g => g.alerts.length > 0);
    catGroups.sort((a, b) => b.alerts.length - a.alerts.length);
    if (catGroups.length) {
      catGroups.forEach(({ cat, alerts: group }) => {
        const def = ALERT_CATS[cat];
        html += `<div class="aw-grp-hd" id="alert-grp-${cat}" data-grp="${cat}" onclick="toggleAlertGroup(this)"><span class="aw-grp-hd__label">${def.label}</span><span class="aw-grp-hd__count">${group.length}</span><span class="aw-grp-hd__chevron">›</span></div>`;
        html += `<div class="aw-grp-body">${group.map(a => alertItemHTML(a, false)).join('')}</div>`;
      });
    } else if (_viewSearch) {
      html += `<div style="text-align:center;padding:28px 16px;color:var(--muted);font-size:var(--fs-md)">No alerts matching "${escHtml(_viewSearch)}"</div>`;
    }
  }

  // Snoozed section (shown in alert card views, not table)
  if (snz.length && _alertViewMode !== 'table' && _alertViewMode !== 'briefing') {
    html += `<div class="aw-grp-hd" data-grp="snoozed" style="margin-top:20px" onclick="toggleAlertGroup(this)"><span class="aw-grp-hd__label">Snoozed</span><span class="aw-grp-hd__count">${snz.length}</span><span class="aw-grp-hd__chevron">›</span></div>`;
    html += `<div class="aw-grp-body">${snz.map(a => alertItemHTML(a, true)).join('')}</div>`;
  }

  list.innerHTML = html;

  // Restore expanded groups from persistent state (all start collapsed by default)
  list.querySelectorAll('.aw-grp-hd').forEach(hd => {
    const key = _alertGroupKey(hd);
    if (_alertExpanded.has(key)) toggleAlertGroup(hd);
  });

  renderAlertPanel(all, active, snz);

  // Show/hide "View Snoozed" button
  const vsBtn = el('alerts-view-snoozed-btn');
  if (vsBtn) vsBtn.style.display = snz.length > 0 ? '' : 'none';
}

// ─── ALERT RIGHT PANEL ───────────────────────────────────────
function renderAlertPanel(all, active, snz) {
  // ── Compute KPI values ──
  const renewal = active.filter(a => a.cat === 'renewal').length;
  const totalSub = renewal > 0
    ? renewal + ' renewal' + (renewal !== 1 ? 's' : '') + ' \u226460d'
    : active.length === 0 ? 'all clear' : 'across your book';

  const _critAlerts = active.filter(a => a.cat === 'health' && a.type === 'red');
  const critical = _critAlerts.length;
  const critSub = critical === 0 ? 'none flagged' : 'health alerts';
  _cachedCritIds = new Set(_critAlerts.map(a => a.cid));

  const affectedIds = new Set(active.map(a => a.cid));
  _cachedAffectedIds = affectedIds;
  const totalBook = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c)).length;

  // Pre-compute full MRR exposure (all risk categories, deduped) so KPI and widget match
  const _expSeen = {};
  ['Critical/Risk','Watch','Renewal \u226460d','No Contact 60d+','Poor Sentiment','Low Adoption','Low Logins','Quiet Accounts'].forEach(k => _expSeen[k] = new Set());
  active.forEach(a => {
    const c = customers.find(x => x.id === a.cid);
    if (!c) return;
    if (a.cat === 'health' && a.type === 'red' && !_expSeen['Critical/Risk'].has(c.id)) _expSeen['Critical/Risk'].add(c.id);
    else if (a.cat === 'health' && a.type === 'amber' && !_expSeen['Watch'].has(c.id)) _expSeen['Watch'].add(c.id);
    if (a.cat === 'renewal' && !_expSeen['Renewal \u226460d'].has(c.id)) _expSeen['Renewal \u226460d'].add(c.id);
  });
  customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c)).forEach(c => {
    if (c.days != null && c.days >= 60 && !_expSeen['No Contact 60d+'].has(c.id)) _expSeen['No Contact 60d+'].add(c.id);
    const sent = latestSentiment(c);
    if (sent && sent.val === 'negative' && !_expSeen['Poor Sentiment'].has(c.id)) _expSeen['Poor Sentiment'].add(c.id);
    if (signalOn(c,'adoption') && c.adoption != null && c.adoption < 30 && !_expSeen['Low Adoption'].has(c.id)) _expSeen['Low Adoption'].add(c.id);
    if (signalOn(c,'logins') && c.logins != null && c.logins < 5 && !_expSeen['Low Logins'].has(c.id)) _expSeen['Low Logins'].add(c.id);
    if (isQuietAccount(c) && !_expSeen['Quiet Accounts'].has(c.id)) _expSeen['Quiet Accounts'].add(c.id);
  });
  const _allExpIds = new Set();
  Object.values(_expSeen).forEach(s => s.forEach(id => _allExpIds.add(id)));
  _cachedMrrIds = _allExpIds;
  _cachedSnzIds = new Set(snz.map(a => a.cid));
  let mrrExposed = 0;
  _allExpIds.forEach(id => { const c = customers.find(x => x.id === id); if (c) mrrExposed += c.mrr || 0; });
  const mrrStr = mrrExposed > 0 ? '$' + fmtNum(mrrExposed) : '$0';
  const mrrSubStr = _allExpIds.size > 0 ? _allExpIds.size + ' account' + (_allExpIds.size !== 1 ? 's' : '') + ' at risk' : 'no revenue at risk';

  const pctAlerting = totalBook > 0 ? Math.round((affectedIds.size / totalBook) * 100) : 0;
  const acctSub = pctAlerting > 0 ? pctAlerting + '% of book' : 'affected';

  const snzSub = snz.length === 0 ? 'none paused' : 'paused';

  // ── Dynamic page subtitle ──
  const _subEl = document.getElementById('alert-subtitle');
  if (_subEl) {
    if (active.length === 0) {
      _subEl.textContent = 'All clear \u2014 no action needed';
    } else {
      const _parts = [];
      if (critical > 0) _parts.push(critical + ' critical');
      if (mrrExposed > 0) _parts.push('$' + fmtNum(mrrExposed) + ' MRR exposed');
      _parts.push(affectedIds.size + ' account' + (affectedIds.size !== 1 ? 's' : '') + ' need attention');
      _subEl.textContent = _parts.join(' \xB7 ');
    }
  }

  // ── Render KPI summary cards (v2 widget style) ──
  const kpiRow = el('alert-kpi-row');
  if (kpiRow) {
    const _kpi = (onclick, hdBg, title, badge, label, val, valStyle, change, changeClass, tip) =>
      `<div class="aw-card" onclick="${escHtml(onclick)}">
        <div class="aw-hd" style="background:${hdBg}"><span class="aw-hd-title">${title}${tip ? ' <span class="info-tip tip-below" data-tip="' + tip + '">\u24d8</span>' : ''}</span><span class="aw-hd-badge">${badge}</span></div>
        <div class="aw-body">
          <div class="aw-kpi-label">${label}</div>
          <div class="aw-kpi-val"${valStyle ? ` style="color:${valStyle}"` : ''}>${val}</div>
          <div class="aw-kpi-change ${changeClass}">${escHtml(change)}</div>
        </div>
      </div>`;
    // Dynamic colors for KPI numbers only (headers stay static)
    const alertValColor = active.length >= 10 ? '#991b1b' : active.length >= 5 ? '#92400e' : '';
    const alertBadge = active.length === 0 ? 'Clear' : active.length >= 10 ? 'High' : 'Live';
    const acctValColor = pctAlerting >= 40 ? '#991b1b' : pctAlerting >= 20 ? '#92400e' : '';
    const snzValColor = snz.length >= 10 ? '#92400e' : '#64748b';

    kpiRow.innerHTML =
      _kpi("filterByAlertKpi('all')", '#0f766e', 'Active Alerts', alertBadge, 'Active Alerts', active.length, alertValColor, totalSub, 'aw-kpi-flat', 'Total active alerts across your book. Click to show all.') +
      _kpi("filterByAlertKpi('critical')", '#991b1b', 'Critical / Risk', critical > 0 ? 'Alert' : 'Clear', 'Critical / Risk', critical, critical > 0 ? '#991b1b' : '#16a34a', critSub, 'aw-kpi-flat', 'Customers in Critical or Risk health status. Click to filter.') +
      _kpi("filterByAlertKpi('mrr')", '#92400e', 'MRR Exposed', mrrExposed > 0 ? 'Risk' : 'Safe', 'MRR Exposed', mrrStr, mrrExposed > 0 ? '#92400e' : '', mrrSubStr, 'aw-kpi-flat', 'Total MRR at risk, deduplicated. Each customer counted once even if flagged in multiple categories. Click to filter.') +
      _kpi("filterByAlertKpi('accounts')", '#0f766e', 'Accounts', pctAlerting + '%', 'Accounts Affected', `${affectedIds.size}<span style="font-size:1rem;font-weight:400;color:var(--subtle)"> / ${totalBook}</span>`, acctValColor, acctSub, 'aw-kpi-flat', 'Percentage and count of accounts with active alerts. Click to filter.') +
      _kpi("filterByAlertKpi('snoozed')", '#475569', 'Snoozed', snz.length >= 10 ? 'High' : 'Paused', 'Snoozed', snz.length, snzValColor, snzSub, 'aw-kpi-flat', 'Alerts temporarily paused. Click to view snoozed alerts.');
  }

  // ── Update feed count badge ──
  const feedBadge = el('aw-feed-count');
  if (feedBadge) feedBadge.textContent = active.length;

  // ── MRR Exposure detail card (reuses pre-computed _expSeen) ──
  const mrrWrap = el('alert-mrr-wrap');
  if (mrrWrap) {
    const _expColors = {
      'Critical/Risk':'#991b1b','Watch':'#92400e','Renewal \u226460d':'#0891b2',
      'No Contact 60d+':'#b45309','Poor Sentiment':'#b91c1c','Low Adoption':'#92400e',
      'Low Logins':'#78350f','Quiet Accounts':'#991b1b'
    };
    _mrrSeen = _expSeen;
    const rows = Object.entries(_expSeen)
      .map(([label, ids]) => {
        let mrr = 0;
        ids.forEach(id => { const c = customers.find(x => x.id === id); if (c) mrr += c.mrr || 0; });
        return [label, { color: _expColors[label], mrr }];
      })
      .filter(([, {mrr}]) => mrr > 0)
      .sort((a, b) => b[1].mrr - a[1].mrr);
    const maxMrr = rows.length > 0 ? rows[0][1].mrr : 1;
    const mrrTotalEl = el('alert-mrr-total');
    if (mrrTotalEl) mrrTotalEl.textContent = mrrStr;
    const mrrRows = rows.map(([label, {color, mrr}]) => {
      const pct = Math.round((mrr / maxMrr) * 100);
      return `<div class="aw-prog" onclick="filterByMrrBucket('${escHtml(label)}')">
        <div class="aw-prog-hdr"><span class="aw-prog-name"><span class="dot" style="background:${color}"></span>${label}</span><span class="aw-prog-val" style="color:${color}">$${fmtNum(mrr)}</span></div>
        <div class="aw-prog-track"><div class="aw-prog-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>`;
    }).join('');
    mrrWrap.innerHTML = mrrRows || '<div class="alerts-detail-empty">No MRR at risk</div>';
  }

  // ── By Stage detail card ──
  const stageWrap = el('alert-stage-wrap');
  if (stageWrap) {
    const stageDefs = [
      { key: 'onboarding', label: 'Onboarding', color: '#0891b2' },
      { key: 'active',     label: 'Active',     color: '#16a34a' },
      { key: 'atrisk',     label: 'At Risk',    color: '#991b1b' },
      { key: 'won',        label: 'Won / Upsold', color: '#16a34a' },
      { key: 'churned',    label: 'Churned',    color: '#64748b' }
    ];
    const stageCounts = {};
    const stageIds = {};
    stageDefs.forEach(s => { stageCounts[s.key] = 0; stageIds[s.key] = new Set(); });
    active.forEach(a => {
      const c = customers.find(x => x.id === a.cid);
      if (c) { const lc = c.lifecycle || 'active'; if (stageCounts[lc] !== undefined && !stageIds[lc].has(c.id)) { stageCounts[lc]++; stageIds[lc].add(c.id); } }
    });
    _stageSeen = {};
    stageDefs.forEach(s => { _stageSeen[s.label] = stageIds[s.key]; });
    const stagesWithAlerts = stageDefs.filter(s => stageCounts[s.key] > 0);
    const stageTotalEl = el('alert-stage-total');
    if (stageTotalEl) stageTotalEl.textContent = stagesWithAlerts.length;
    const maxStageCount = Math.max(1, ...Object.values(stageCounts));
    const stageRows = stagesWithAlerts.map(s => {
      const cnt = stageCounts[s.key];
      const pct = Math.round((cnt / maxStageCount) * 100);
      return `<div class="aw-prog" style="cursor:pointer" onclick="filterByStageBucket('${escHtml(s.label)}')">
        <div class="aw-prog-hdr"><span class="aw-prog-name"><span class="dot" style="background:${s.color}"></span>${s.label}</span><span class="aw-prog-val" style="color:${s.color}">${cnt}</span></div>
        <div class="aw-prog-track"><div class="aw-prog-fill" style="width:${pct}%;background:${s.color}"></div></div>
      </div>`;
    }).join('');
    stageWrap.innerHTML = stageRows || '<div class="alerts-detail-empty">No active alerts</div>';
  }

  // Insights - surface actionable patterns across alerts
  const insWrap = el('alert-insights-row');
  if (insWrap) {
    const insights = [];
    const _iSvg = (d) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    // Helper: clickable customer name link (opens detail, stops card click)
    const _nameLink = (c) => `<strong class="ta-name-link" onclick="event.stopPropagation();openDetail('${escHtml(c.id)}')">${escHtml(c.name)}</strong>`;

    // Helper: build unique affected-customer list from alert array
    const uniqueCusts = (alerts) => {
      const seen = new Set(), out = [];
      alerts.forEach(a => { if (seen.has(a.cid)) return; seen.add(a.cid); const c = customers.find(x => x.id === a.cid); if (c) out.push(c); });
      return out;
    };

    // ── 1. Renewals at Risk - renewing soon AND unhealthy ──
    const renewalAlerts = active.filter(a => a.cat === 'renewal');
    if (renewalAlerts.length > 0) {
      const healthRiskIds = new Set(active.filter(a => a.cat === 'health' && a.type === 'red').map(a => a.cid));
      const atRiskRenewals = renewalAlerts.filter(a => healthRiskIds.has(a.cid));
      if (atRiskRenewals.length > 0) {
        const custs = uniqueCusts(atRiskRenewals);
        const renewMrr = custs.reduce((s, c) => s + (c.mrr || 0), 0);
        const nameList = custs.slice(0, 2).map(c => _nameLink(c));
        const extra = custs.length > 2 ? ` and ${custs.length - 2} more` : '';
        const rCids = custs.map(c => c.id);
        insights.push({
          score: 95 + custs.length, label: 'Renewals at Risk', accent: 'red',
          icon: _iSvg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
          iconBg: 'var(--red-l)', iconColor: 'var(--red)',
          cids: rCids, navMode: rCids.length === 1 ? 'customer' : 'table', navLabel: 'Renewals at Risk',
          text: `${nameList.join(' and ')}${extra} ${custs.length === 1 ? 'is' : 'are'} up for renewal while sitting at Critical or At Risk health. That's <strong>$${fmtNum(renewMrr)} MRR</strong> on the line - prioritize outreach before the renewal conversation starts.`
        });
      }
    }

    // ── 2. Biggest Account at Risk - highest-MRR critical/risk account with specific issues ──
    const healthAlerts = active.filter(a => a.cat === 'health' && a.type === 'red');
    if (healthAlerts.length > 0) {
      const riskCusts = uniqueCusts(healthAlerts).sort((a, b) => (b.mrr || 0) - (a.mrr || 0));
      const top = riskCusts[0];
      if (top && (top.mrr || 0) > 0) {
        // Collect what's wrong with this account
        const issues = [];
        const tAlerts = active.filter(a => a.cid === top.id);
        if (tAlerts.some(a => a.cat === 'tickets')) issues.push('open support tickets');
        if (tAlerts.some(a => a.cat === 'engagement')) issues.push('low engagement');
        if (tAlerts.some(a => a.cat === 'quiet')) issues.push('gone quiet');
        if (tAlerts.some(a => a.cat === 'momentum')) issues.push('declining momentum');
        if (tAlerts.some(a => a.cat === 'sentiment')) issues.push('poor sentiment');
        if (tAlerts.some(a => a.cat === 'cadence')) issues.push('overdue for contact');
        const issueText = issues.length > 0 ? `, plus ${issues.join(' and ')}` : '';
        insights.push({
          score: 85 + Math.min((top.mrr || 0) / 1000, 10), label: 'Highest MRR at Risk', accent: 'red',
          icon: _iSvg('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
          iconBg: 'var(--red-l)', iconColor: 'var(--red)',
          cids: [top.id], navMode: 'customer', navLabel: 'Highest MRR at Risk',
          text: `${_nameLink(top)} is your biggest dollar risk - <strong>$${fmtNum(top.mrr)} MRR</strong> at a score of <strong>${top.score}</strong>${issueText}. Start here today.`
        });
      }
    }

    // ── 3. Declining Momentum - accounts trending downward this week ──
    const alertCustIds = new Set(active.map(a => a.cid));
    const decliningCusts = customers.filter(c => c.lifecycle !== 'churned' && passesManagerFilter(c) && alertCustIds.has(c.id) && getMomentum(c) === 'dn');
    if (decliningCusts.length >= 2) {
      const decMrr = decliningCusts.reduce((s, c) => s + (c.mrr || 0), 0);
      const totalAffected = new Set(active.map(a => a.cid)).size;
      const pct = Math.round((decliningCusts.length / totalAffected) * 100);
      const decIds = decliningCusts.map(c => c.id);
      // Find steepest drop and highest MRR separately
      const withDelta = decliningCusts.map(c => ({ c, delta: getDelta7d(c) }));
      withDelta.sort((a, b) => a.delta - b.delta); // most negative first
      const steepest = withDelta[0];
      const biggestMrr = decliningCusts.slice().sort((a, b) => (b.mrr || 0) - (a.mrr || 0))[0];
      let callout = '';
      if (steepest.c.id === biggestMrr.id) {
        callout = `${_nameLink(steepest.c)} (${Math.abs(Math.round(steepest.delta))} pt drop, $${fmtNum(steepest.c.mrr || 0)} MRR) is the biggest concern.`;
      } else {
        callout = `${_nameLink(steepest.c)} has the steepest drop (${Math.abs(Math.round(steepest.delta))} pts), while ${_nameLink(biggestMrr)} ($${fmtNum(biggestMrr.mrr || 0)} MRR) carries the most revenue risk.`;
      }
      insights.push({
        score: 60 + pct, label: 'Scores Still Falling', accent: 'red',
        icon: _iSvg('<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>'),
        iconBg: 'var(--red-l)', iconColor: 'var(--red)',
        cids: decIds, navMode: 'table', navLabel: 'Scores Still Falling',
        text: `<strong>${decliningCusts.length} accounts</strong> are still trending downward week-over-week - <strong>$${fmtNum(decMrr)} MRR</strong> that hasn't stabilized. ${callout}`
      });
    }

    // ── 4. Multi-signal accounts - accounts with 3+ different alert types need a plan ──
    const custAlertCats = {};
    active.forEach(a => {
      if (!custAlertCats[a.cid]) custAlertCats[a.cid] = new Set();
      custAlertCats[a.cid].add(a.cat);
    });
    const multiSignal = Object.entries(custAlertCats)
      .filter(([, cats]) => cats.size >= 3)
      .map(([cid, cats]) => ({ c: customers.find(x => x.id === cid), cats: cats.size }))
      .filter(x => x.c)
      .sort((a, b) => b.cats - a.cats || (b.c.mrr || 0) - (a.c.mrr || 0));
    if (multiSignal.length > 0) {
      const top = multiSignal[0];
      const topCats = [...custAlertCats[top.c.id]].map(k => (ALERT_CATS[k] || {}).label || '').filter(Boolean);
      const catCount = topCats.length;
      const others = multiSignal.length > 1 ? ` ${multiSignal.length - 1} other ${multiSignal.length - 1 === 1 ? 'account' : 'accounts'} also have 3+ alert types.` : '';
      const msCids = multiSignal.map(x => x.c.id);
      insights.push({
        score: 50 + catCount * 10, label: 'Multiple Red Flags', accent: 'amber',
        icon: _iSvg('<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
        iconBg: 'var(--amber-l)', iconColor: 'var(--amber)',
        cids: msCids, navMode: msCids.length === 1 ? 'customer' : 'table', navLabel: 'Multiple Red Flags',
        text: `${_nameLink(top.c)} is flagged across <strong>${catCount} categories</strong> - ${topCats.join(', ')}. When issues stack up like this, a single check-in call can uncover the root cause.${others}`
      });
    }

    // ── 5. Engagement Gap - low adoption/logins accounts with real MRR ──
    const engAlerts = active.filter(a => a.cat === 'engagement');
    if (engAlerts.length >= 2) {
      const engCusts = uniqueCusts(engAlerts).sort((a, b) => (b.mrr || 0) - (a.mrr || 0));
      const engMrr = engCusts.reduce((s, c) => s + (c.mrr || 0), 0);
      if (engMrr > 0) {
        const lowAdopt = engCusts.filter(c => c.adoption != null && c.adoption < 30);
        const lowLogin = engCusts.filter(c => c.logins != null && c.logins < 5);
        let detail = '';
        if (lowAdopt.length > 0 && lowLogin.length > 0) detail = `${lowAdopt.length} with low adoption and ${lowLogin.length} with low logins`;
        else if (lowAdopt.length > 0) detail = `${lowAdopt.length} with feature adoption under 30%`;
        else detail = `${lowLogin.length} with fewer than 5 logins per month`;
        const eCids = engCusts.map(c => c.id);
        insights.push({
          score: 45 + engCusts.length * 3, label: 'Engagement Drop', accent: 'amber',
          icon: _iSvg('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
          iconBg: 'var(--amber-l)', iconColor: 'var(--amber)',
          cids: eCids, navMode: 'table', navLabel: 'Low Engagement',
          text: `<strong>${engCusts.length} accounts</strong> (<strong>$${fmtNum(engMrr)} MRR</strong>) are underusing the product - ${detail}. Low usage often leads to churn - consider a training session or check-in to drive adoption.`
        });
      }
    }

    // ── 6. Silent Revenue - quiet high-value accounts ──
    const quietAlerts = active.filter(a => a.cat === 'quiet');
    if (quietAlerts.length > 0) {
      const quietCusts = uniqueCusts(quietAlerts).filter(c => (c.mrr || 0) >= 3000).sort((a, b) => (b.mrr || 0) - (a.mrr || 0));
      if (quietCusts.length > 0) {
        const totalQuietMrr = quietCusts.reduce((s, c) => s + (c.mrr || 0), 0);
        const topQ = quietCusts[0];
        const qDays = getQuietDays(topQ);
        const qCids = quietCusts.map(c => c.id);
        insights.push({
          score: 42 + quietCusts.length * 2, label: 'Silent Revenue', accent: 'amber',
          icon: _iSvg('<path d="M18.36 6.64A9 9 0 0 1 20.77 15"/><path d="M6.16 6.16a9 9 0 1 0 12.68 12.68"/><line x1="2" y1="2" x2="22" y2="22"/>'),
          iconBg: 'var(--amber-l)', iconColor: 'var(--amber)',
          cids: qCids, navMode: qCids.length === 1 ? 'customer' : 'table', navLabel: 'Quiet Accounts',
          text: `<strong>${quietCusts.length} ${quietCusts.length === 1 ? 'account' : 'accounts'}</strong> worth <strong>$${fmtNum(totalQuietMrr)} MRR</strong> ${quietCusts.length === 1 ? 'has' : 'have'} gone dark - zero logins, zero tickets, no contact. ${_nameLink(topQ)} ($${fmtNum(topQ.mrr || 0)} MRR) has been quiet for <strong>${qDays} days</strong>. Reach out now - the longer the silence, the harder the save.`
        });
      }
    }

    // Sort by score desc, show top 3 - pin "Highest MRR at Risk" first
    insights.sort((a, b) => b.score - a.score);
    // Move "Highest MRR at Risk" to position 0 if present
    const mrrIdx = insights.findIndex(x => x.label === 'Highest MRR at Risk');
    if (mrrIdx > 0) { const [mrr] = insights.splice(mrrIdx, 1); insights.unshift(mrr); }
    const topIns = insights.slice(0, 3);

    if (topIns.length) {
      // Store insight data for click navigation
      window._alertInsights = topIns;
      const hdColors = { red: '#991b1b', amber: '#92400e', green: '#166534' };
      const insTips = {
        'Renewals at Risk': 'Accounts renewing soon that are also in Critical/Risk health. Click to view.',
        'Highest MRR at Risk': 'Your highest-revenue account currently at Critical or Risk. Click to open.',
        'Scores Still Falling': 'Accounts with scores still trending down week-over-week. Click to view.',
        'Multiple Red Flags': 'Accounts flagged across 3+ alert categories that may need a deeper conversation. Click to view.',
        'Engagement Drop': 'Accounts with low product adoption or login activity. Click to view.',
        'Silent Revenue': 'High-value accounts that have gone completely quiet. Click to view.'
      };
      insWrap.innerHTML = topIns.map((ins, idx) => {
        const accentColor = hdColors[ins.accent] || '#0f766e';
        const clickable = ins.cids && ins.cids.length > 0;
        const insTip = insTips[ins.label] || 'Click to view details';
        return `<div class="aw-card"${clickable ? ` onclick="_alertInsightClick(${idx})" style="cursor:pointer"` : ''}>
          <div class="aw-hd" style="background:${accentColor}"><span class="aw-hd-title">${ins.label} <span class="info-tip tip-below" data-tip="${insTip}">\u24d8</span></span></div>
          <div class="aw-body">
            <div class="aw-insight-text">${ins.text}</div>
          </div>
        </div>`;
      }).join('');
    } else {
      insWrap.innerHTML = '';
    }
  }
}

// ─── Alert panel → Table filter (stays on alerts page) ──────
function _alertTblSortBy(key) {
  if (_alertTblSort.key === key) _alertTblSort.dir *= -1;
  else { _alertTblSort.key = key; _alertTblSort.dir = key === 'name' || key === 'manager' ? 1 : -1; }
  renderAlerts();
}

// ─── ALERT TABLE COLUMN FILTERS ─────────────────────────────
// Close filter on outside click
document.addEventListener('mousedown', function(e) {
  const menu = document.getElementById('at-filter-portal');
  if (!menu || !menu.classList.contains('open')) return;
  if (menu.contains(e.target)) return;
  if (e.target.closest && e.target.closest('.col-filter-btn')) return;
  closeATFilter();
});

function openATFilter(key, btnEl) {
  if (_openATF === key) { closeATFilter(); return; }
  closeATFilter();
  _openATF = key;
  const col = ALERT_TBL_COLS.find(c => c.key === key);
  const menu = document.getElementById('at-filter-portal');
  if (!menu || !col) return;
  menu.innerHTML = _buildATFilterMenu(col);
  menu.classList.add('open');
  const rect = (btnEl.closest('th') || btnEl).getBoundingClientRect();
  menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  menu.style.left = (rect.left + window.scrollX) + 'px';
  requestAnimationFrame(() => {
    const mr = menu.getBoundingClientRect();
    if (mr.right > window.innerWidth - 8)
      menu.style.left = (window.innerWidth - mr.width - 8 + window.scrollX) + 'px';
  });
  _populateATFilterUI(key, col);
  setTimeout(() => menu.querySelector('input')?.focus(), 30);
}

function closeATFilter() {
  const menu = document.getElementById('at-filter-portal');
  if (menu) { menu.classList.remove('open'); menu.innerHTML = ''; }
  _openATF = null;
}

function _buildATFilterMenu(col) {
  let body = '';
  if (col.ftype === 'number') {
    body = `<div class="cff-radio-group">
      <label class="cff-radio"><input type="radio" name="atfop" value="gt" onchange="_atfOpChange()"> Greater than</label>
      <label class="cff-radio"><input type="radio" name="atfop" value="lt" onchange="_atfOpChange()"> Less than</label>
      <label class="cff-radio"><input type="radio" name="atfop" value="eq" onchange="_atfOpChange()"> Exactly</label>
      <label class="cff-radio"><input type="radio" name="atfop" value="between" onchange="_atfOpChange()"> Between</label>
    </div>
    <div class="cff-inputs">
      <input class="cff-num-input" id="atf-val" type="number" placeholder="Value" oninput="_applyATFilterLive()">
      <span class="cff-between-sep" id="atf-sep" style="display:none">and</span>
      <input class="cff-num-input" id="atf-val2" type="number" placeholder="Max" style="display:none" oninput="_applyATFilterLive()">
    </div>`;
  } else if (col.ftype === 'enum') {
    const vals = col.enumFn ? col.enumFn() : (col.enumVals || []);
    body = `<div class="cff-enum-list">${vals.map(v =>
      `<label class="cff-check-item"><input type="checkbox" value="${escHtml(v)}" class="atf-enum-cb" onchange="_applyATFilterLive()"> ${ENUM_DISPLAY[v] !== undefined ? ENUM_DISPLAY[v] : escHtml(v)}</label>`
    ).join('')}</div>`;
  } else if (col.ftype === 'text') {
    body = `<input class="cff-text-input" id="atf-text" type="text" placeholder="Search ${col.label.toLowerCase()}..." oninput="_applyATFilterLive()" autocomplete="off">`;
  }
  return `<div class="col-filter-hd">
    <span class="col-filter-title">Filter: ${col.label}</span>
    <button class="col-filter-clear" onclick="clearATFilter('${escHtml(col.key)}')">Clear</button>
  </div>
  <div class="col-filter-body">${body}</div>`;
}

function _atfOpChange() {
  const op = document.querySelector('input[name="atfop"]:checked')?.value;
  const v2 = document.getElementById('atf-val2');
  const sep = document.getElementById('atf-sep');
  const btw = op === 'between';
  if (v2) v2.style.display = btw ? '' : 'none';
  if (sep) sep.style.display = btw ? '' : 'none';
  _applyATFilterLive();
}

function _populateATFilterUI(key, col) {
  const f = _alertTblFilters[key];
  if (!f) return;
  if (col.ftype === 'number') {
    const radio = document.querySelector(`input[name="atfop"][value="${f.type}"]`);
    if (radio) { radio.checked = true; _atfOpChange(); }
    const v1 = document.getElementById('atf-val');
    const v2 = document.getElementById('atf-val2');
    if (v1) v1.value = (f.type === 'between' ? f.min : f.val) ?? '';
    if (v2 && f.max != null) v2.value = f.max;
  } else if (col.ftype === 'enum') {
    document.querySelectorAll('.atf-enum-cb').forEach(cb => { cb.checked = f.vals.has(cb.value); });
  } else if (col.ftype === 'text') {
    const inp = document.getElementById('atf-text');
    if (inp) inp.value = f.q || '';
  }
}

function _applyATFilterLive() {
  const key = _openATF;
  if (!key) return;
  const col = ALERT_TBL_COLS.find(c => c.key === key);
  if (!col) return;
  if (col.ftype === 'number') {
    const op = document.querySelector('input[name="atfop"]:checked')?.value;
    const v1 = parseFloat(document.getElementById('atf-val')?.value);
    const v2 = parseFloat(document.getElementById('atf-val2')?.value);
    if (!op || isNaN(v1)) { delete _alertTblFilters[key]; }
    else if (op === 'between') {
      if (!isNaN(v2)) _alertTblFilters[key] = { type:'between', min:v1, max:v2 };
      else delete _alertTblFilters[key];
    } else {
      _alertTblFilters[key] = { type:op, val:v1 };
    }
  } else if (col.ftype === 'enum') {
    const checked = [...document.querySelectorAll('.atf-enum-cb:checked')].map(cb => cb.value);
    if (checked.length) _alertTblFilters[key] = { type:'enum', vals: new Set(checked) };
    else delete _alertTblFilters[key];
  } else if (col.ftype === 'text') {
    const q = (document.getElementById('atf-text')?.value || '').trim().toLowerCase();
    if (q) _alertTblFilters[key] = { type:'text', q };
    else delete _alertTblFilters[key];
  }
  renderAlerts();
}

function clearATFilter(key) {
  delete _alertTblFilters[key];
  closeATFilter();
  renderAlerts();
}

function clearAllATFilters() {
  Object.keys(_alertTblFilters).forEach(k => delete _alertTblFilters[k]);
  closeATFilter();
  renderAlerts();
}

function _atfGetValue(c, key, alertCountMap) {
  if (key === 'name') return (c.name || '').toLowerCase();
  if (key === 'score') return c.score || 0;
  if (key === 'delta') return getDelta7d(c);
  if (key === 'status') return c.status || '';
  if (key === 'mrr') return c.mrr || 0;
  if (key === 'days') return c.days != null ? c.days : 9999;
  if (key === 'renewal') return c.renewal_date ? Math.round((new Date(c.renewal_date) - new Date()) / 86400000) : 9999;
  if (key === 'alerts') return (alertCountMap && alertCountMap[c.id]) || 0;
  if (key === 'tickets') return c.tickets != null ? c.tickets : 0;
  if (key === 'manager') return (c.manager || '').toLowerCase();
  return 0;
}

function _applyATFilters(list, alertCountMap) {
  const keys = Object.keys(_alertTblFilters);
  if (!keys.length) return list;
  return list.filter(c => {
    for (const key of keys) {
      const f = _alertTblFilters[key];
      if (!f) continue;
      const v = _atfGetValue(c, key, alertCountMap);
      if (f.type === 'text') {
        if (typeof v === 'string' && !v.includes(f.q)) return false;
      } else if (f.type === 'enum') {
        if (!f.vals.has(v)) return false;
      } else if (f.type === 'gt') {
        if (v <= f.val) return false;
      } else if (f.type === 'lt') {
        if (v >= f.val) return false;
      } else if (f.type === 'eq') {
        if (v !== f.val) return false;
      } else if (f.type === 'between') {
        if (v < f.min || v > f.max) return false;
      }
    }
    return true;
  });
}

function _renderATFilterPills() {
  const keys = Object.keys(_alertTblFilters);
  if (!keys.length) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;align-items:center">`
    + keys.map(key => {
      const f = _alertTblFilters[key];
      const def = ALERT_TBL_COLS.find(d => d.key === key);
      const label = def ? def.label : key;
      let summary = '';
      if (f.type === 'text') summary = '"' + (f.q || '').slice(0, 20) + '"';
      else if (f.type === 'enum') {
        const arr = [...(f.vals || [])].map(v => ENUM_DISPLAY[v] || v);
        summary = arr.length <= 3 ? arr.join(', ') : arr.slice(0, 3).join(', ') + ' +' + (arr.length - 3);
      }
      else if (f.type === 'gt') summary = '> ' + f.val;
      else if (f.type === 'lt') summary = '< ' + f.val;
      else if (f.type === 'eq') summary = '= ' + f.val;
      else if (f.type === 'between') summary = f.min + ' - ' + f.max;
      return `<span class="filter-pill">${escHtml(label)}: ${escHtml(summary)}<button class="filter-pill-x" onclick="event.stopPropagation();clearATFilter('${key}')" title="Remove filter">\u2715</button></span>`;
    }).join('')
    + `<button class="btn btn-xs btn-ghost" onclick="clearAllATFilters()" style="font-size:var(--fs-sm);color:var(--muted)">Clear all</button></div>`;
}

// Navigate from insight card: single customer → customer view + expand, multiple → table view
function _insightNav(mode, custIds, label) {
  const ids = custIds instanceof Set ? custIds : new Set(custIds);
  if (mode === 'customer' && ids.size === 1) {
    // Single customer: switch to customer view, expand, and scroll
    const cid = [...ids][0];
    setAlertView('customer', true);
    setTimeout(() => {
      const hd = document.querySelector(`.aw-grp-hd[data-cid="${cid}"]`);
      if (hd) {
        const body = hd.nextElementSibling;
        if (body && body.classList.contains('aw-grp-body') && getComputedStyle(body).display === 'none') {
          toggleAlertGroup(hd);
        }
        const stickyBar = document.getElementById('alert-sticky-bar');
        const barH = stickyBar ? stickyBar.offsetHeight : 0;
        _smoothScrollWithOffset(hd, barH + 12);
      }
    }, 80);
  } else if (mode === 'detail' && ids.size === 1) {
    // Open detail modal for single account
    openDetail([...ids][0]);
  } else {
    // Multiple customers: show in filtered table
    _alertShowTable(label || 'Insight', ids);
  }
}

function _alertInsightClick(idx) {
  const ins = window._alertInsights?.[idx];
  if (!ins || !ins.cids || !ins.cids.length) return;
  _insightNav(ins.navMode || 'table', ins.cids, ins.navLabel || ins.label);
}

function _alertShowTable(label, ids) {
  if (!ids || ids.size === 0) { toast('No customers in this bucket', 'warn'); return; }
  _alertTableFilter = { label, ids: new Set(ids) };
  _alertViewMode = 'table';
  const modeMap = { cat:'category', pri:'priority', cust:'customer', tbl:'table' };
  ['cat','pri','cust','tbl'].forEach(k => {
    const btn = el('alert-view-' + k);
    if (btn) btn.classList.toggle('active', 'table' === modeMap[k]);
  });
  const searchBox = el('alert-cust-search');
  if (searchBox) { searchBox.style.display = ''; searchBox.value = ''; }
  renderAlerts();
  const list = el('alerts-list');
  if (list) _smoothScrollWithOffset(list, 10);
}
function filterByMrrBucket(label) {
  _alertShowTable(label, _mrrSeen[label]);
}
function filterByStageBucket(label) {
  _alertShowTable(label, _stageSeen[label]);
}
function _smoothScrollWithOffset(target, offset) {
  if (!target) return;
  const main = document.querySelector('main.main');
  if (main && main.scrollHeight > main.clientHeight) {
    const y = target.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - (offset || 20);
    main.scrollTo({ top: y, behavior: 'smooth' });
  } else {
    const y = target.getBoundingClientRect().top + window.scrollY - (offset || 20);
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
}
function filterByAlertKpi(which) {
  // All top widgets → table view filtered to relevant accounts
  if (which === 'all' || which === 'total') {
    _alertShowTable('Active Alerts', _cachedAffectedIds);
  } else if (which === 'critical') {
    _alertShowTable('Critical / Risk', _cachedCritIds);
  } else if (which === 'mrr') {
    _alertShowTable('MRR Exposed', _cachedMrrIds);
  } else if (which === 'accounts') {
    _alertShowTable('Accounts Affected', _cachedAffectedIds);
  } else if (which === 'snoozed') {
    _alertShowTable('Snoozed', _cachedSnzIds);
  }
}
function filterByAlertCat(cat) {
  if (_alertViewMode !== 'category') setAlertView('category', true);
  setTimeout(() => {
    const hd = document.getElementById('alert-grp-' + cat);
    if (hd) {
      const body = hd.nextElementSibling;
      if (body && body.classList.contains('aw-grp-body') && getComputedStyle(body).display === 'none') {
        toggleAlertGroup(hd);
      }
      const stickyBar = document.getElementById('alert-sticky-bar');
      const barH = stickyBar ? stickyBar.offsetHeight : 0;
      _smoothScrollWithOffset(hd, barH + 12);
    }
  }, 50);
}
function clearMrrExposureFilter() {
  mrrExposureFilter = null;
  renderCustomers();
}

// ─── BRIEFING VIEW ──────────────────────────────────────────
function _renderBriefingView(active, snz) {
  const now = new Date();
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayName = dayNames[now.getDay()];
  const dateStr = `${monthNames[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  // Build action items from alerts - one per customer, merged
  const custActions = {};
  active.forEach(a => {
    if (!custActions[a.cid]) {
      const c = customers.find(x => x.id === a.cid);
      if (!c) return;
      custActions[a.cid] = {
        c, alerts: [], cats: new Set(), worstType: 'green',
        score: c.score, status: c.status, mrr: c.mrr || 0,
        delta: getDelta7d(c), days: c.days, manager: c.manager || ''
      };
    }
    custActions[a.cid].alerts.push(a);
    custActions[a.cid].cats.add(a.cat);
    const sevOrder = { red:0, amber:1, blue:2, green:3 };
    if ((sevOrder[a.type]||3) < (sevOrder[custActions[a.cid].worstType]||3)) {
      custActions[a.cid].worstType = a.type;
    }
  });

  // Classify each customer into urgency tiers
  const tiers = { immediate: [], thisWeek: [], monitor: [] };

  Object.values(custActions).forEach(ca => {
    const c = ca.c;
    const hasCritRisk = ca.cats.has('health') && (c.status === 'critical' || c.status === 'risk');
    const bigDrop = ca.delta <= -10;
    const renewSoon = c.renewal_date && (() => {
      const d = Math.round((new Date(c.renewal_date) - now) / 86400000);
      return d >= 0 && d <= 30;
    })();
    const overdue = c.days != null && c.days >= 30;

    if (hasCritRisk || bigDrop) {
      tiers.immediate.push(ca);
    } else if (renewSoon || ca.cats.has('tickets') || overdue || ca.cats.has('quiet')) {
      tiers.thisWeek.push(ca);
    } else {
      tiers.monitor.push(ca);
    }
  });

  // Sort each tier: worst score first, then highest MRR
  const tierSort = (a, b) => {
    const sd = a.score - b.score;
    if (sd !== 0) return sd;
    return b.mrr - a.mrr;
  };
  tiers.immediate.sort(tierSort);
  tiers.thisWeek.sort(tierSort);
  tiers.monitor.sort(tierSort);

  // Build HTML
  let h = '';

  // ── Minimal header - KPIs already visible above ──
  h += `<div class="brief-hd"><span class="brief-hd__day">Briefing</span><span class="brief-hd__date">${dateStr}</span></div>`;

  // ── Urgency tiers ──
  const tierDefs = [
    { key:'immediate', label:'Act Now', icon:'🔴', color:'#991b1b', bg:'rgba(220,38,38,.04)', desc:'Critical health, rapid drops - outreach today', items: tiers.immediate },
    { key:'thisWeek',  label:'This Week', icon:'🟡', color:'#92400e', bg:'rgba(217,119,6,.04)', desc:'Renewals, overdue contact, support issues - schedule check-ins', items: tiers.thisWeek },
    { key:'monitor',   label:'Monitor', icon:'🔵', color:'#1e40af', bg:'rgba(30,64,175,.04)', desc:'Watch zone or engagement dips - check in this month, escalate if signals worsen', items: tiers.monitor },
  ];

  tierDefs.forEach(tier => {
    if (!tier.items.length) return;

    const tierExpanded = _alertExpanded.has('briefing:' + tier.key);
    h += `<div class="brief-tier${tierExpanded ? '' : ' collapsed'}" data-tier="${tier.key}">
      <div class="brief-tier__hd" onclick="toggleBriefTier(this.parentElement)">
        <span class="brief-tier__dot" style="background:${tier.color}"></span>
        <span class="brief-tier__label">${tier.label}</span>
        <span class="brief-tier__count">${tier.items.length}</span>
        <span class="brief-tier__desc">${tier.desc}</span>
        <span class="brief-tier__chevron">‹</span>
      </div>
      <div class="brief-tier__body">`;

    tier.items.forEach(ca => {
      const c = ca.c;
      const scoreColor = STATUS_COLOR[c.status] || '#94a3b8';
      const d7 = ca.delta;
      const d7Color = d7 > 0 ? '#16a34a' : d7 < 0 ? '#dc2626' : 'var(--muted)';
      const d7Str = d7 > 0 ? '+'+d7 : d7 === 0 ? ' -' : String(d7);

      // Build prescribed action text
      const actions = _briefAction(ca);

      // Renewal info
      let renewStr = '';
      if (c.renewal_date) {
        const rd = Math.round((new Date(c.renewal_date) - now) / 86400000);
        renewStr = rd <= 0 ? '<span style="color:#dc2626;font-weight:700">Overdue</span>'
          : rd <= 30 ? `<span style="color:#ea580c;font-weight:700">${rd}d</span>`
          : `${rd}d`;
      }

      // Alert category pills
      const catPills = [...ca.cats].map(cat => {
        const def = ALERT_CATS[cat];
        if (!def) return '';
        const pillColors = { red:'#991b1b', amber:'#92400e', blue:'#1e40af', green:'#166534' };
        return `<span class="brief-cat-pill" style="color:${pillColors[def.type]||'#64748b'};background:${def.type === 'red' ? 'rgba(220,38,38,.07)' : def.type === 'amber' ? 'rgba(217,119,6,.07)' : def.type === 'green' ? 'rgba(22,163,74,.07)' : 'rgba(30,64,175,.07)'}">${def.icon} ${def.label}</span>`;
      }).join('');

      h += `<div class="brief-item" onclick="openDetail('${escHtml(c.id)}')">
        <div class="brief-item__left">
          <div class="brief-item__score" style="background:${scoreColor}">${c.score}</div>
          <div class="brief-item__info">
            <div class="brief-item__name">
              ${escHtml(c.name)}
              <span class="brief-item__delta" style="color:${d7Color}">${d7Str}</span>
              ${c.mrr ? `<span class="brief-item__mrr">$${fmtNum(c.mrr)}</span>` : ''}
              ${renewStr ? `<span class="brief-item__renew">⟳ ${renewStr}</span>` : ''}
            </div>
            <div class="brief-item__cats">${catPills}</div>
            <div class="brief-item__action">${actions}</div>
          </div>
        </div>
        <div class="brief-item__right">
          ${c.manager ? `<span class="brief-item__mgr">${escHtml(c.manager)}</span>` : ''}
          <button class="btn btn-xs btn-outline brief-item__btn" onclick="event.stopPropagation();openDetail('${escHtml(c.id)}')" title="Open detail">Review →</button>
        </div>
      </div>`;
    });

    h += `</div></div>`;
  });

  if (!Object.keys(custActions).length) {
    h += `<div style="text-align:center;padding:40px 16px;color:var(--muted)">
      <div style="font-size:2rem;margin-bottom:8px">✓</div>
      <div style="font-weight:600;font-size:1.05rem;margin-bottom:4px">All clear</div>
      <div>No action items - your book is in good shape.</div>
    </div>`;
  }

  return h;
}

// Prescribe an action based on the alert mix for a customer
function _briefAction(ca) {
  const parts = [];
  const c = ca.c;

  if (c.status === 'critical') {
    parts.push('<strong>Escalate:</strong> Account is critical - initiate rescue outreach');
  } else if (c.status === 'risk') {
    parts.push('<strong>Outreach:</strong> Account at risk - schedule a health check call');
  }

  if (ca.delta <= -15) {
    parts.push(`<strong>Investigate:</strong> Score dropped ${Math.abs(ca.delta)} pts in 7 days`);
  } else if (ca.delta <= -10) {
    parts.push(`<strong>Watch:</strong> Score declining (${ca.delta} pts this week)`);
  }

  if (ca.cats.has('renewal')) {
    const rd = c.renewal_date ? Math.round((new Date(c.renewal_date) - new Date()) / 86400000) : null;
    if (rd != null && rd <= 14) parts.push(`<strong>Renewal prep:</strong> Renews in ${rd}d - confirm expansion/retention plan`);
    else if (rd != null) parts.push(`<strong>Renewal touch:</strong> Renews in ${rd}d - start renewal conversation`);
  }

  if (ca.cats.has('tickets')) {
    parts.push(`<strong>Support sync:</strong> ${c.tickets || '3+'} open tickets - check with support team`);
  }

  if (ca.cats.has('quiet')) {
    parts.push('<strong>Re-engage:</strong> Account has gone silent - send a value-add touchpoint');
  }

  if (ca.cats.has('cadence') && !parts.some(p => p.includes('Outreach'))) {
    parts.push(`<strong>Check-in:</strong> ${c.days || 0}d since last contact - schedule a touch`);
  }

  if (ca.cats.has('engagement') && !parts.some(p => p.includes('Re-engage'))) {
    parts.push('<strong>Adoption review:</strong> Low engagement - share best practices or training');
  }

  if (ca.cats.has('sentiment')) {
    parts.push('<strong>Follow up:</strong> Negative sentiment logged - address concerns');
  }

  if (ca.cats.has('expansion')) {
    parts.push('<strong>Opportunity:</strong> Expansion signals detected - explore upsell');
  }
  if (ca.cats.has('onboarding')) {
    parts.push('<strong>Onboarding:</strong> Customer going dark post-implementation - re-engage immediately');
  }

  if (!parts.length) {
    parts.push('<strong>Review:</strong> Check current status and determine next steps');
  }

  // Return top 2 actions max to keep it concise
  return parts.slice(0, 2).join('<span class="brief-action-sep">·</span>');
}

function tierChip(tier) {
  const map = { smb:'SMB', mid:'Mid-Market', enterprise:'Enterprise' };
  const label = map[tier] || tier || '';
  if (!label) return '';
  return `<span class="alert-tier-chip">${label}</span>`;
}

function alertItemHTML(a, isSnzd) {
  const def   = ALERT_CATS[a.cat] || ALERT_CATS.health;
  const sel   = _selectedAlerts.has(a.id);
  const scoreColor = STATUS_COLOR[a._status] || '#94a3b8';
  const scoreVal   = (a._score != null) ? a._score : ' -';
  const catColors = { red:'#991b1b', amber:'#92400e', blue:'#1e40af', green:'#166534' };
  const avatarBg = catColors[a.type] || '#64748b';
  // Score pill background tint
  const pillBg = a._status === 'critical' ? 'rgba(220,38,38,.06)' : a._status === 'risk' ? 'rgba(220,38,38,.06)' : a._status === 'watch' ? 'rgba(217,119,6,.06)' : 'rgba(15,118,110,.06)';
  return `
    <div class="aw-list-row ${isSnzd?'aw-list-row--snz':''} ${sel?'aw-list-row--sel':''}" id="alert-row-${escHtml(a.id)}" onclick="openDetail('${escHtml(a.cid)}')">
      <input type="checkbox" class="aw-list-check" ${sel?'checked':''} onclick="event.stopPropagation();alertToggleSelect('${escHtml(a.id)}',this,event)" title="Select">
      <div class="aw-list-avatar" style="background:${avatarBg}">${def.icon}</div>
      <div class="aw-list-info">
        <div class="aw-list-name">${a.msg}</div>
        <div class="aw-list-detail">
          <span style="color:${avatarBg};font-weight:600">${def.label}</span>
          ${a._mrr != null ? `<span>$${fmtNum(a._mrr)}</span>` : ''}
          ${a._tier ? `<span>${escHtml(a._tier === 'smb' ? 'SMB' : a._tier === 'mid' ? 'Mid-Market' : a._tier === 'enterprise' ? 'Enterprise' : a._tier)}</span>` : ''}
          ${a._days > 0 ? `<span>${a._days}d since touch</span>` : ''}
        </div>
      </div>
      <div class="aw-list-score" style="background:${pillBg};color:${scoreColor}">${scoreVal}</div>
      <div class="aw-list-actions">
        ${isSnzd
          ? `<button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();unsnooze('${escHtml(a.id)}')">Wake</button>`
          : `<div class="snooze-dd"><button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();toggleSnoozeDd('${escHtml(a.id)}')">Snooze ▾</button>
             <div class="snooze-dd__menu" id="snooze-dd-${escHtml(a.id)}">
               <button class="snooze-dd__item" onclick="event.stopPropagation();snoozeAlert('${escHtml(a.id)}',1)">1 day</button>
               <button class="snooze-dd__item" onclick="event.stopPropagation();snoozeAlert('${escHtml(a.id)}',7)">7 days</button>
               <button class="snooze-dd__item" onclick="event.stopPropagation();snoozeAlert('${escHtml(a.id)}',30)">30 days</button>
             </div></div>
             <button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();dismissAlert('${escHtml(a.id)}')" title="Dismiss">✕</button>`}
      </div>
    </div>`;
}

function toggleSnoozeDd(aid) {
  document.querySelectorAll('.snooze-dd__menu').forEach(m => {
    if (m.id !== 'snooze-dd-'+aid) m.classList.remove('open');
  });
  el('snooze-dd-'+aid)?.classList.toggle('open');
}

// Close snooze dropdowns when clicking outside
document.addEventListener('click', (e) => {
  document.querySelectorAll('.snooze-dd__menu.open').forEach(m => {
    // Don't close if click was inside the dropdown's wrapper
    if (m.closest('.snooze-dd') && m.closest('.snooze-dd').contains(e.target)) return;
    m.classList.remove('open');
  });
});

// Sticky bar shadow when scrolled
(function() {
  const bar = document.getElementById('alert-sticky-bar');
  if (!bar) return;
  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'height:1px;margin:0;padding:0;visibility:hidden;pointer-events:none';
  bar.parentElement.insertBefore(sentinel, bar);
  const obs = new IntersectionObserver(([e]) => {
    bar.classList.toggle('stuck', !e.isIntersecting);
  }, { threshold: [1] });
  obs.observe(sentinel);
})();

function isSnoozed(aid) {
  if (!snoozed.has(aid)) return false;
  const expiry = snoozed.get(aid);
  if (Date.now() > expiry) { snoozed.delete(aid); return false; }
  return true;
}

function _alertAuditInfo(aid) {
  const a = buildAlerts().find(x => x.id === aid);
  const cust = a ? customers.find(x => x.id === a.cid) : null;
  return { custId: cust?.id||null, custName: cust?.name||'', catLabel: a ? (ALERT_CATS[a.cat]?.label||a.cat) : '' };
}

function snoozeAlert(aid, days=7) {
  const ai = _alertAuditInfo(aid);
  const expiry = Date.now() + days * 86400000;
  snoozed.set(aid, expiry);
  saveSettings();
  logAudit('alert_snoozed', ai.custId, ai.custName, { summary: `Alert snoozed for ${days}d - ${ai.catLabel}` });
  renderAlerts();

  toast(`Alert snoozed for ${days} day${days===1?'':'s'} ⏱`, 'default');
}

function isDismissed(aid) {
  if (!dismissed.has(aid)) return false;
  // Extract customer id from alert id (format: custId-alertType)
  const cid = aid.replace(/-[^-]+$/, '');
  const c = customers.find(x => x.id === cid);
  if (!c) return false;
  // Only stay dismissed if score hasn't changed
  return c.score === dismissed.get(aid);
}

function dismissAlert(aid) {
  const ai = _alertAuditInfo(aid);
  // Store the customer's current score so alert reappears if score changes
  const cid = aid.replace(/-[^-]+$/, '');
  const c = customers.find(x => x.id === cid);
  dismissed.set(aid, c ? c.score : null);
  saveSettings();
  logAudit('alert_dismissed', ai.custId, ai.custName, { summary: `Alert dismissed - ${ai.catLabel}` });
  renderAlerts();

  toast('Alert dismissed', 'default');
}

function unsnooze(aid) {
  const ai = _alertAuditInfo(aid);
  snoozed.delete(aid);
  saveSettings();
  logAudit('alert_unsnoozed', ai.custId, ai.custName, { summary: `Alert unsnoozed - ${ai.catLabel}` });
  renderAlerts();

}

function clearSnoozed() {
  snoozed.clear();
  saveSettings();
  logAudit('alerts_cleared', null, '', { summary: 'All snoozed alerts cleared' });
  renderAlerts();

  toast('Snoozed alerts cleared', 'success');
}

function viewSnoozedAlerts() {
  // Switch to category view if in table/briefing mode (snoozed section only shows in card views)
  if (_alertViewMode === 'table' || _alertViewMode === 'briefing') setAlertView('category', true);
  setTimeout(() => {
    // Find the snoozed group header and expand + scroll to it
    const headers = document.querySelectorAll('#alerts-list .aw-grp-hd');
    for (const hd of headers) {
      if (hd.textContent.includes('Snoozed')) {
        // Expand if collapsed
        const body = hd.nextElementSibling;
        if (body && body.classList.contains('aw-grp-body') && getComputedStyle(body).display === 'none') {
          toggleAlertGroup(hd);
        }
        _smoothScrollWithOffset(hd);
        return;
      }
    }
  }, 50);
}

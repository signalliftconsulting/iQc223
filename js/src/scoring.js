// ─── NPS / CSAT HELPERS (Separate Signals) ──────────────────
// NPS: 0–10 scale. Promoter ≥9, Passive 7–8, Detractor ≤6. null = N/A.
// CSAT: 1–5 scale. Good ≥4, Neutral 3, Poor ≤2. null = N/A.
function npsNormalized(score)  { if (score == null) return 50; return Math.round((score / 10) * 100); }
function csatNormalized(score) { if (score == null) return 50; return Math.round(((score - 1) / 4) * 100); }
function npsCategory(score) {
  if (score == null) return 'N/A';
  return score >= 9 ? 'Promoter' : score >= 7 ? 'Passive' : 'Detractor';
}
function csatCategory(score) {
  if (score == null) return 'N/A';
  return score >= 4 ? 'Good' : score === 3 ? 'Neutral' : 'Poor';
}
function npsDisplay(score)  { if (score == null) return 'N/A'; return score + ' — ' + npsCategory(score); }
function csatDisplay(score) { if (score == null) return 'N/A'; return score + '/5 — ' + csatCategory(score); }
function npsIsDetractor(score) { return score != null && score <= 6; }
function npsIsPromoter(score)  { return score != null && score >= 9; }
function csatIsPoor(score)     { return score != null && score <= 2; }
function csatIsGood(score)     { return score != null && score >= 4; }
// DB storage: NPS + CSAT encoded in the nps TEXT column as "N|C"
function encodeFeedbackPair(nps, csat) {
  const n = nps != null ? String(nps) : '';
  const c = csat != null ? String(csat) : '';
  if (!n && !c) return '';
  return n + '|' + c;
}
function decodeFeedbackPair(val) {
  if (val == null || val === '' || val === 'unknown') return { nps: null, csat: null };
  if (typeof val === 'string' && val.includes('|')) {
    const [n, c] = val.split('|');
    return { nps: n !== '' ? Number(n) : null, csat: c !== '' ? Number(c) : null };
  }
  // v122 combined "nps:9" / "csat:4" format
  if (typeof val === 'string' && val.includes(':')) {
    const [t, s] = val.split(':');
    if (t === 'nps') return { nps: Number(s), csat: null };
    if (t === 'csat') return { nps: null, csat: Number(s) };
  }
  // Legacy categorical
  const legacy = { promoter: 10, passive: 7, detractor: 3 };
  if (legacy[val] !== undefined) return { nps: legacy[val], csat: null };
  const num = Number(val);
  if (!isNaN(num) && num >= 0 && num <= 10) return { nps: num, csat: null };
  return { nps: null, csat: null };
}

// ─── SCORING ENGINE ─────────────────────────────────────────
function calcScore(data, w) {
  w = w || weights;
  // Normalize each signal to 0–100 (null/N/A → 50 neutral default)
  const logins_n   = data.logins   != null ? Math.min(data.logins / 30, 1) * 100 : 50;
  const adoption_n = data.adoption != null ? Math.min(data.adoption, 100) : 50;
  const tickets_n  = data.tickets  != null ? Math.max(0, 100 - data.tickets * 20) : 50; // 0 tix=100, 5+ tix=0
  const nps_n      = npsNormalized(data.nps);
  const csat_n     = csatNormalized(data.csat);
  const days_n     = data.days     != null ? Math.max(0, 100 - (data.days / 180) * 100) : 50;
  const growth_n   = data.growth === 'na' ? 50 : ({ none:25, mild:65, strong:100 }[data.growth] || 25);

  const total = (w.logins + w.adoption + w.tickets + (w.nps||0) + (w.csat||0) + w.days + w.growth) || 100;
  const score = (
    logins_n   * (w.logins   / total) +
    adoption_n * (w.adoption / total) +
    tickets_n  * (w.tickets  / total) +
    nps_n      * ((w.nps||0) / total) +
    csat_n     * ((w.csat||0) / total) +
    days_n     * (w.days     / total) +
    growth_n   * (w.growth   / total)
  );

  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    signals: { logins_n, adoption_n, tickets_n, nps_n, csat_n, days_n, growth_n }
  };
}

// ─── iQcadence SIGNAL MODEL — 26-Factor Proprietary Engine ──
const SIGNAL_FACTORS = [
  // ── Engagement & Usage ──
  { id:'recency_decay', name:'Recency Decay', category:'engagement',
    compute:function(c,bs,sig){
      var hist=(c.history||[]).filter(function(h){return h.date&&h.signals}).sort(function(a,b){return b.date.localeCompare(a.date)});
      if(hist.length<3) return null;
      var r=hist[0].signals, o=hist[2].signals, dc=0;
      ['logins','adoption'].forEach(function(d){if(r[d]!=null&&o[d]!=null&&r[d]<o[d]) dc++});
      ['tickets','days'].forEach(function(d){if(r[d]!=null&&o[d]!=null&&r[d]>o[d]) dc++});
      if(dc>=3) return {adj:-3,reason:dc+' signals worse than 2 snapshots ago \u2014 recent activity weighted higher'};
      if(dc===0) return {adj:+1,reason:'All tracked signals stable or improving vs recent history'};
      return null;
    }},
  { id:'engagement_depth', name:'Engagement Depth', category:'engagement',
    compute:function(c,bs,sig){
      if(c.logins==null||c.adoption==null) return null;
      var depth=(c.logins/30)*(c.adoption/100);
      if(depth>0.5) return {adj:+2,reason:'High engagement depth ('+c.logins+' logins, '+c.adoption+'% adoption)'};
      if(depth<0.05&&c.lifecycle!=='onboarding') return {adj:-2,reason:'Very low engagement depth ('+c.logins+' logins, '+c.adoption+'% adoption)'};
      return null;
    }},
  { id:'adoption_plateau', name:'Adoption Plateau', category:'engagement',
    compute:function(c,bs,sig){
      if(c.lifecycle==='onboarding'||c.adoption==null) return null;
      var hist=(c.history||[]).filter(function(h){return h.signals&&h.signals.adoption!=null}).sort(function(a,b){return a.date.localeCompare(b.date)});
      if(hist.length<4) return null;
      var last4=hist.slice(-4).map(function(h){return h.signals.adoption});
      var range=Math.max.apply(null,last4)-Math.min.apply(null,last4);
      if(range<=3&&c.adoption<60) return {adj:-2,reason:'Adoption plateaued at '+c.adoption+'% for '+last4.length+' snapshots'};
      return null;
    }},
  { id:'login_trend', name:'Login Frequency Trend', category:'engagement',
    compute:function(c,bs,sig){
      var hist=(c.history||[]).filter(function(h){return h.signals&&h.signals.logins!=null}).sort(function(a,b){return a.date.localeCompare(b.date)});
      if(hist.length<3) return null;
      var l3=hist.slice(-3).map(function(h){return h.signals.logins});
      var accel=(l3[2]-l3[1])-(l3[1]-l3[0]);
      if(accel>3) return {adj:+2,reason:'Login frequency accelerating ('+l3[0]+' \u2192 '+l3[1]+' \u2192 '+l3[2]+'/mo)'};
      if(accel<-3) return {adj:-2,reason:'Login frequency decelerating ('+l3[0]+' \u2192 '+l3[1]+' \u2192 '+l3[2]+'/mo)'};
      return null;
    }},
  { id:'feature_breadth', name:'Feature Breadth', category:'engagement',
    compute:function(c,bs,sig){
      if(c.adoption==null) return null;
      if(c.adoption>=85) return {adj:+2,reason:'Exceptional feature breadth at '+c.adoption+'% \u2014 deep product investment'};
      if(c.adoption<=15&&c.lifecycle!=='onboarding') return {adj:-1,reason:'Very narrow feature usage at '+c.adoption+'%'};
      return null;
    }},

  // ── Revenue & Growth ──
  { id:'revenue_momentum', name:'Revenue Momentum', category:'revenue',
    compute:function(c,bs,sig){
      if(!c.mrr) return null;
      var hist=(c.history||[]).filter(function(h){return h.signals&&h.signals.mrr!=null});
      if(hist.length<2) return null;
      var sorted=hist.sort(function(a,b){return a.date.localeCompare(b.date)});
      var prev=sorted[sorted.length-2].signals.mrr||0;
      if(prev===0) return null;
      var pct=((c.mrr-prev)/prev)*100;
      if(pct>10) return {adj:+2,reason:'MRR grew '+Math.round(pct)+'% ($'+fmtNum(prev)+' \u2192 $'+fmtNum(c.mrr)+')'};
      if(pct<-10) return {adj:-2,reason:'MRR declined '+Math.round(Math.abs(pct))+'% ($'+fmtNum(prev)+' \u2192 $'+fmtNum(c.mrr)+')'};
      return null;
    }},
  { id:'growth_health_div', name:'Growth-Health Divergence', category:'revenue',
    compute:function(c,bs,sig){
      if(!c.mrr||c.growth!=='strong') return null;
      if(getMomentum(c)==='dn'&&bs>=40) return {adj:-3,reason:'Revenue growing but health declining \u2014 hidden churn risk'};
      return null;
    }},
  { id:'tier_relative', name:'Tier-Relative Performance', category:'revenue',
    compute:function(c,bs,sig){
      var base={enterprise:72,mid:65,smb:58}; var bl=base[c.tier]||base.mid; var diff=bs-bl;
      if(c.tier==='enterprise'&&diff<-10) return {adj:-2,reason:'Enterprise account underperforming tier baseline by '+Math.abs(Math.round(diff))+' pts'};
      if(c.tier==='smb'&&diff>15) return {adj:+1,reason:'SMB overperforming tier baseline by '+Math.round(diff)+' pts'};
      return null;
    }},
  { id:'expansion_velocity', name:'Expansion Velocity', category:'revenue',
    compute:function(c,bs,sig){
      if(c.growth==='strong'&&c.lifecycle==='active'&&bs>=75) return {adj:+2,reason:'Strong growth signal with healthy active account \u2014 expansion candidate'};
      if(c.growth==='strong'&&c.lifecycle==='won') return {adj:+1,reason:'Recently expanded with continued strong growth signal'};
      return null;
    }},

  // ── Relationship & Stakeholder ──
  { id:'contact_recency', name:'Contact Recency', category:'relationship',
    compute:function(c,bs,sig){
      var days=getEffectiveDays(c); if(days==null) return null;
      var thres=getCadenceThresholds()[c.tier||'mid']||getCadenceThresholds().mid;
      if(days>thres.overdue*1.5){
        var adj=c.mrr>=5000?-3:-2;
        return {adj:adj,reason:'No contact in '+days+' days \u2014 well past '+(c.tier||'mid')+' overdue threshold ('+thres.overdue+'d)'};
      }
      return null;
    }},
  { id:'comm_gap_accel', name:'Communication Gap Acceleration', category:'relationship',
    compute:function(c,bs,sig){
      var hist=(c.history||[]).filter(function(h){return h.signals&&h.signals.days!=null}).sort(function(a,b){return a.date.localeCompare(b.date)});
      if(hist.length<3) return null;
      var l3=hist.slice(-3).map(function(h){return h.signals.days});
      if(l3[2]>l3[1]&&l3[1]>l3[0]&&(l3[2]-l3[0])>10) return {adj:-2,reason:'Contact gaps accelerating: '+l3[0]+'d \u2192 '+l3[1]+'d \u2192 '+l3[2]+'d since contact'};
      return null;
    }},
  { id:'cadence_compliance', name:'Cadence Compliance', category:'relationship',
    compute:function(c,bs,sig){
      var cad=getCadenceStatus(c);
      if(cad.status==='ok'&&c.next_touch){
        var ntd=Math.round((new Date(c.next_touch)-new Date())/86400000);
        if(ntd>=0&&ntd<=3) return {adj:+1,reason:'On-cadence with upcoming scheduled touch'};
      }
      return null;
    }},

  // ── Support & Sentiment ──
  { id:'support_burden', name:'Support Burden', category:'support',
    compute:function(c,bs,sig){
      if(c.tickets==null) return null;
      var hist=(c.history||[]).filter(function(h){return h.signals&&h.signals.tickets!=null});
      if(hist.length<2) return null;
      var avg=hist.reduce(function(s,h){return s+h.signals.tickets},0)/hist.length;
      if(c.tickets>avg*2&&c.tickets>=3) return {adj:-2,reason:'Ticket volume ('+c.tickets+') is '+Math.round(c.tickets/Math.max(avg,0.1))+'x historical average'};
      return null;
    }},
  { id:'ticket_accel', name:'Ticket Acceleration', category:'support',
    compute:function(c,bs,sig){
      var hist=(c.history||[]).filter(function(h){return h.signals&&h.signals.tickets!=null}).sort(function(a,b){return a.date.localeCompare(b.date)});
      if(hist.length<3) return null;
      var l3=hist.slice(-3).map(function(h){return h.signals.tickets});
      if(l3[2]>l3[1]&&l3[1]>l3[0]&&l3[2]>=3) return {adj:-2,reason:'Ticket count accelerating: '+l3[0]+' \u2192 '+l3[1]+' \u2192 '+l3[2]};
      return null;
    }},
  { id:'sentiment_trajectory', name:'Sentiment Trajectory', category:'support',
    compute:function(c,bs,sig){
      var hist=(c.history||[]).filter(function(h){return h.signals&&h.signals.nps!=null}).sort(function(a,b){return a.date.localeCompare(b.date)});
      if(hist.length<3) return null;
      var l3=hist.slice(-3).map(function(h){return h.signals.nps});
      if(l3[2]<l3[1]&&l3[1]<l3[0]&&(l3[0]-l3[2])>=2) return {adj:-2,reason:'NPS declining: '+l3[0]+' \u2192 '+l3[1]+' \u2192 '+l3[2]};
      if(l3[2]>l3[1]&&l3[1]>l3[0]&&(l3[2]-l3[0])>=2) return {adj:+1,reason:'NPS improving: '+l3[0]+' \u2192 '+l3[1]+' \u2192 '+l3[2]};
      return null;
    }},
  { id:'sent_engage_disconnect', name:'Sentiment-Engagement Disconnect', category:'support',
    compute:function(c,bs,sig){
      if(c.nps==null||c.logins==null) return null;
      if(npsIsPromoter(c.nps)&&c.logins<5) return {adj:-2,reason:'Passive happy: NPS promoter ('+c.nps+') but only '+c.logins+' logins/mo \u2014 disengaged advocate'};
      if(npsIsDetractor(c.nps)&&c.logins>=20) return {adj:+1,reason:'Vocal critic but heavily engaged ('+c.logins+' logins) \u2014 frustration may be fixable'};
      return null;
    }},

  // ── Lifecycle & Timing ──
  { id:'renewal_gravity', name:'Renewal Gravity', category:'lifecycle',
    compute:function(c,bs,sig){
      if(!c.renewal_date) return null;
      var dtr=Math.round((new Date(c.renewal_date)-new Date())/86400000);
      if(dtr<0||dtr>180||c.lifecycle==='churned') return null;
      if(dtr<=60&&bs<65) return {adj:-3,reason:'Renewal in '+dtr+' days with below-average health ('+bs+')'};
      if(dtr<=60&&bs>=80) return {adj:+1,reason:'Renewal in '+dtr+' days with strong health \u2014 likely safe'};
      if(dtr<=120&&bs<50) return {adj:-2,reason:'Renewal in '+dtr+' days with concerning health ('+bs+')'};
      return null;
    }},
  { id:'onboarding_velocity', name:'Onboarding Velocity', category:'lifecycle',
    compute:function(c,bs,sig){
      if(c.lifecycle!=='onboarding') return null;
      if(c.adoption!=null&&c.adoption>=50&&c.logins>=10) return {adj:+2,reason:'Strong onboarding velocity: '+c.adoption+'% adoption, '+c.logins+' logins in ramp phase'};
      if(c.adoption!=null&&c.adoption<20&&c.logins!=null&&c.logins<3) return {adj:-3,reason:'Slow onboarding: only '+c.adoption+'% adoption and '+c.logins+' logins \u2014 time-to-value at risk'};
      return null;
    }},
  { id:'tenure_risk', name:'Tenure Risk Curve', category:'lifecycle',
    compute:function(c,bs,sig){
      if(!c.since) return null;
      var td=Math.floor((Date.now()-new Date(c.since).getTime())/86400000);
      if(isNaN(td)||td<0) return null;
      if(td>=90&&td<=180&&c.lifecycle==='active'&&bs<65) return {adj:-2,reason:'In the 90\u2013180 day tenure risk zone ('+td+'d) with below-average health'};
      if(td>365&&bs>=60) return {adj:+1,reason:'Long-tenure customer ('+Math.round(td/365)+'yr+) \u2014 historical retention likelihood higher'};
      return null;
    }},
  { id:'post_onboard_cliff', name:'Post-Onboarding Cliff', category:'lifecycle',
    compute:function(c,bs,sig){
      if(c.lifecycle!=='active') return null;
      var hist=(c.history||[]).filter(function(h){return h.signals&&h.signals.lifecycle}).sort(function(a,b){return a.date.localeCompare(b.date)});
      var obIdx=-1,actIdx=-1;
      for(var i=0;i<hist.length;i++){if(hist[i].signals.lifecycle==='onboarding') obIdx=i;}
      for(var j=obIdx+1;j<hist.length;j++){if(hist[j].signals.lifecycle==='active'){actIdx=j;break;}}
      if(obIdx<0||actIdx<0) return null;
      var daysSince=Math.floor((Date.now()-new Date(hist[actIdx].date).getTime())/86400000);
      if(daysSince>=15&&daysSince<=90){
        var drop=hist[actIdx].score-bs;
        if(drop>=8) return {adj:-2,reason:'Post-onboarding cliff: score dropped '+drop+' pts since transitioning to active '+daysSince+'d ago'};
      }
      return null;
    }},
  { id:'seasonal_norm', name:'Seasonal Normalization', category:'lifecycle',
    compute:function(c,bs,sig){
      var hist=(c.history||[]).filter(function(h){return h.date});
      if(hist.length<12) return null;
      var cm=new Date().getMonth();
      var same=hist.filter(function(h){return new Date(h.date).getMonth()===cm});
      if(same.length<2) return null;
      var avg=same.reduce(function(s,h){return s+h.score},0)/same.length;
      if(bs<avg-10) return {adj:+1,reason:'Score below seasonal average for this period (avg '+Math.round(avg)+') \u2014 may normalize'};
      return null;
    }},

  // ── Compound / Interaction ──
  { id:'multi_deterioration', name:'Multi-Signal Deterioration', category:'compound',
    compute:function(c,bs,sig){
      var hist=(c.history||[]).filter(function(h){return h.date&&h.signals}).sort(function(a,b){return b.date.localeCompare(a.date)});
      if(hist.length<2) return null;
      var prev=hist[1].signals, curr=hist[0].signals, dc=0, names=[];
      if(curr.logins!=null&&prev.logins!=null&&curr.logins<prev.logins-2){dc++;names.push('logins');}
      if(curr.adoption!=null&&prev.adoption!=null&&curr.adoption<prev.adoption-3){dc++;names.push('adoption');}
      if(curr.tickets!=null&&prev.tickets!=null&&curr.tickets>prev.tickets+1){dc++;names.push('tickets');}
      if(curr.nps!=null&&prev.nps!=null&&curr.nps<prev.nps-1){dc++;names.push('NPS');}
      if(curr.csat!=null&&prev.csat!=null&&curr.csat<prev.csat){dc++;names.push('CSAT');}
      if(curr.days!=null&&prev.days!=null&&curr.days>prev.days+7){dc++;names.push('contact');}
      if(dc>=3) return {adj:-3,reason:dc+' signals declining simultaneously ('+names.join(', ')+') \u2014 compounding risk'};
      return null;
    }},
  { id:'recovery_momentum', name:'Recovery Momentum', category:'compound',
    compute:function(c,bs,sig){
      var delta=getDelta7d(c);
      if(delta>=8&&bs<65) return {adj:+3,reason:'Strong recovery momentum (+'+delta+' pts in 7d) \u2014 keep reinforcing'};
      if(delta>=5&&bs<50) return {adj:+2,reason:'Recovery underway (+'+delta+' pts in 7d) from critical/risk territory'};
      return null;
    }},
  { id:'silent_churn', name:'Silent Churn Pattern', category:'compound',
    compute:function(c,bs,sig){
      var hist=(c.history||[]).filter(function(h){return h.date}).sort(function(a,b){return a.date.localeCompare(b.date)});
      if(hist.length<4) return null;
      var l4=hist.slice(-4), sc=l4.map(function(h){return h.score});
      var allDec=sc.every(function(s,i){return i===0||s<=sc[i-1]});
      var maxDrop=0; sc.forEach(function(s,i){if(i>0){var d=sc[i-1]-s;if(d>maxDrop)maxDrop=d;}});
      var totalDrop=sc[0]-sc[sc.length-1];
      if(allDec&&maxDrop<=5&&totalDrop>=8) return {adj:-3,reason:'Silent churn pattern: score drifted '+totalDrop+' pts over '+l4.length+' snapshots with no single alarm'};
      return null;
    }},
  { id:'false_positive_supp', name:'False Positive Suppression', category:'compound',
    compute:function(c,bs,sig){
      if(bs<70) return null;
      var w=getActiveWeights(c), bad=[];
      if((w.logins||0)>0&&sig.logins_n<25) bad.push('logins');
      if((w.adoption||0)>0&&sig.adoption_n<25) bad.push('adoption');
      if((w.tickets||0)>0&&sig.tickets_n<25) bad.push('tickets');
      if((w.nps||0)>0&&sig.nps_n<25) bad.push('NPS');
      if((w.csat||0)>0&&sig.csat_n<25) bad.push('CSAT');
      if((w.days||0)>0&&sig.days_n<25) bad.push('contact');
      if(bad.length===1) return {adj:+1,reason:'High overall health despite weak '+bad[0]+' \u2014 likely an anomaly, not a pattern'};
      return null;
    }}
];

function applySignalModel(c, baseScore, baseSignals) {
  if (!signalModelCfg.enabled) return { adjustedScore: baseScore, factors: [], totalAdj: 0 };
  var maxAdj = SM_SENSITIVITY[signalModelCfg.sensitivity] || SM_SENSITIVITY.balanced;
  var raw = [];
  SIGNAL_FACTORS.forEach(function(f) {
    try {
      var result = f.compute(c, baseScore, baseSignals);
      if (result && result.adj !== 0) raw.push({ id: f.id, name: f.name, category: f.category, adj: result.adj, reason: result.reason });
    } catch(e) { console.warn('Signal factor error [' + f.id + ']:', e.message); }
  });
  var totalRaw = raw.reduce(function(s, f) { return s + f.adj; }, 0);
  // Sensitivity multiplier: conservative dampens, balanced is 1:1, aggressive amplifies
  var sensMultiplier = { conservative: 0.5, balanced: 1.0, aggressive: 1.6 };
  var mult = sensMultiplier[signalModelCfg.sensitivity] || 1.0;
  var scaled = totalRaw * mult;
  // Then cap at sensitivity ceiling
  var capped = Math.max(-maxAdj, Math.min(maxAdj, scaled));
  var totalAdj = Math.round(capped);
  var finalScale = totalRaw !== 0 ? capped / totalRaw : 1;
  raw.forEach(function(f) { f.adj = Math.round(f.adj * finalScale * 10) / 10; });
  return { adjustedScore: Math.round(Math.max(0, Math.min(100, baseScore + totalAdj))), factors: raw, totalAdj: totalAdj };
}

function scoreWithModel(c, w) {
  w = w || getActiveWeights(c);
  var data = { logins: c.logins, adoption: c.adoption, tickets: c.tickets,
    nps: c.nps, csat: c.csat, days: c.days != null ? c.days : (getEffectiveDays(c) || c.days), growth: c.growth || 'none' };
  var base = calcScore(data, w);
  var model = applySignalModel(c, base.score, base.signals);
  c._signalModel = {
    enabled: signalModelCfg.enabled, baseScore: base.score, adjustedScore: model.adjustedScore,
    totalAdj: model.totalAdj, sensitivity: signalModelCfg.sensitivity,
    factors: model.factors, computedAt: new Date().toISOString()
  };
  return { score: model.adjustedScore, signals: base.signals, _base: base.score };
}

// ─── STATUS CONSTANTS ────────────────────────────────────────
// Single source of truth for all 5 status bands
const STATUS_COLOR = {
  critical: '#dc2626',  // red
  risk:     '#ea580c',  // orange
  watch:    '#d97706',  // amber
  healthy:  '#16a34a',  // green
  expand:   '#0891b2',  // teal
};
const STATUS_LABEL = {
  critical: 'Critical',
  risk:     'At Risk',
  watch:    'Watch',
  healthy:  'Healthy',
  expand:   'Expansion',
};
const STATUS_CSS = {
  critical: 'critical',
  risk:     'risk',
  watch:    'watch',
  healthy:  'healthy',
  expand:   'expand',
};

function getStatus(score) {
  if (score <  thresholds.critical) return 'critical';
  if (score <  thresholds.risk)     return 'risk';
  if (score <  thresholds.watch)    return 'watch';
  if (score <  thresholds.healthy)  return 'healthy';
  return 'expand';
}

/* ── Auto-stage: move lifecycle to/from "atrisk" based on score ── */
function applyAutoStage(c) {
  if (!c) return false;
  const lc = c.lifecycle || 'active';
  // Don't touch onboarding, won, or churned — those are business decisions
  if (lc === 'onboarding' || lc === 'won' || lc === 'churned') return false;
  const st = c.status || getStatus(c.score || 50);
  // Score fell to risk/critical → auto-set At Risk
  if ((st === 'critical' || st === 'risk') && lc !== 'atrisk') {
    c.lifecycle = 'atrisk';
    return true;
  }
  // Score recovered past risk threshold → auto-restore Active
  if (st !== 'critical' && st !== 'risk' && lc === 'atrisk') {
    c.lifecycle = 'active';
    return true;
  }
  return false;
}

// ─── WEIGHT-AWARE HELPER ─────────────────────────────────────
// Returns the resolved weights for a customer (profile override or global)
function getActiveWeights(c) {
  const prof = c?.scoring_profile ? profiles.find(p => p.name === c.scoring_profile) : null;
  return prof ? prof.weights : weights;
}
// Returns true if a signal dimension is active (weight > 0) for this customer
function signalOn(c, key) {
  return (getActiveWeights(c)[key] || 0) > 0;
}

// ─── DYNAMIC SCORE DECAY ─────────────────────────────────────
// Returns the date when a customer was last scored (most recent history entry)
function getLastScoredDate(c) {
  const hist = c.history || [];
  if (!hist.length) return c.created ? new Date(c.created) : new Date();
  let max = 0;
  hist.forEach(function(h) { if (h.date) { var t = new Date(h.date).getTime(); if (t > max) max = t; } });
  return max ? new Date(max) : new Date(c.created || Date.now());
}

// Returns effective days since contact, accounting for time elapsed since last scored
function getEffectiveDays(c) {
  if (c.days == null && c._baseDays == null) return null; // N/A
  // If last_contact_date exists, calculate directly from it (exact, no drift)
  if (c.last_contact_date) {
    var _p = c.last_contact_date.split('-').map(Number);
    var lcd = new Date(_p[0], _p[1]-1, _p[2]);
    if (!isNaN(lcd.getTime())) {
      return Math.max(0, Math.floor((Date.now() - lcd.getTime()) / 86400000));
    }
  }
  // Fallback: existing _baseDays + elapsed approach
  var base = c._baseDays != null ? c._baseDays : (c.days || 0);
  var lastScored = getLastScoredDate(c);
  var elapsed = Math.max(0, Math.floor((Date.now() - lastScored.getTime()) / 86400000));
  return base + elapsed;
}

// Auto-promote past next_touch to last_contact_date
// Returns true if a transition occurred (caller should persist)
function applyNextTouchTransition(c) {
  if (!c.next_touch) return false;
  var ntDate = new Date(c.next_touch);
  if (isNaN(ntDate.getTime())) return false;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  if (ntDate >= today) return false; // still in the future or today
  // Archive to touch_history before clearing
  if (!c.touch_history) c.touch_history = [];
  c.touch_history.push({ date: c.next_touch, status: 'completed', time: c.next_touch_time || '' });
  // Promote: next_touch becomes last_contact_date
  c.last_contact_date = c.next_touch;
  c.next_touch = '';
  c.next_touch_time = '';
  // Recalculate days from the new last_contact_date
  var daysSince = Math.max(0, Math.floor((Date.now() - ntDate.getTime()) / 86400000));
  c.days = daysSince;
  c._baseDays = daysSince;
  return true;
}

// Recalculate all customer scores using dynamic effective days
function refreshLiveScores() {
  var transitioned = [];
  customers.forEach(function(c) {
    if (c.lifecycle === 'churned') return;
    // Auto-promote past next_touch → last_contact_date
    if (applyNextTouchTransition(c)) transitioned.push(c);
    var effDays = getEffectiveDays(c);
    if (effDays === c.days && !transitioned.includes(c)) return;
    c.days = effDays;
    var result = scoreWithModel(c);
    c.score  = result.score;
    c.status = getStatus(result.score);
    if (applyAutoStage(c) && !transitioned.includes(c)) transitioned.push(c);
  });
  // Persist transitioned customers (fire-and-forget)
  if (transitioned.length && typeof save === 'function') {
    transitioned.forEach(function(c) { save(c).catch(function(){}); });
  }
}

// ─── LIFECYCLE CONTEXT ────────────────────────────────────────
// Centralized config for lifecycle-aware recommendations
const LIFECYCLE_CONTEXT = {
  onboarding: { focus:'Adoption & Enablement', suppress:['expand'], qbrGoal:'Confirm time-to-value and drive adoption' },
  active:     { focus:'Retention & Growth',    suppress:[],         qbrGoal:'Maintain health and explore growth' },
  atrisk:     { focus:'Stabilization',         suppress:['expand'], qbrGoal:'Stabilize the account and remove friction' },
  won:        { focus:'Value Realization',      suppress:['expand'], qbrGoal:'Ensure new capabilities are delivering value' },
  churned:    { focus:'Winback',               suppress:['expand','renew'], qbrGoal:'Assess winback potential' }
};

function makeRec(score, data) {
  const status = getStatus(score);
  const name   = data.name || 'This account';
  const lc     = data.lifecycle || 'active';
  const mom    = getMomentum(data);
  const delta  = (data.history && data.history.length >= 2) ? getDelta7d(data) : 0;

  // ── Build conversational signal observations ─────────────
  const good = [], bad = [];
  if (signalOn(data,'logins')) {
    if (data.logins != null && data.logins >= 15) good.push('they\'re logging in consistently');
    else if (data.logins != null && data.logins < 5) bad.push(data.logins === 0 ? 'they haven\'t logged in at all this month' : 'they\'re only logging in ' + data.logins + ' day' + (data.logins !== 1 ? 's' : '') + ' a month');
  }
  if (signalOn(data,'adoption')) {
    if (data.adoption != null && data.adoption >= 70) good.push('they\'re using the platform heavily');
    else if (data.adoption != null && data.adoption < 30) bad.push('they\'re only using about ' + data.adoption + '% of what we offer');
  }
  if (signalOn(data,'tickets')) {
    if (data.tickets != null && data.tickets === 0) good.push('no open support issues');
    else if (data.tickets != null && data.tickets >= 3) bad.push('they\'ve got ' + data.tickets + ' open support tickets');
  }
  if (signalOn(data,'nps')) {
    if (npsIsPromoter(data.nps)) good.push('they gave us a ' + data.nps + ' on NPS — a promoter');
    else if (npsIsDetractor(data.nps)) bad.push('they scored us a ' + data.nps + ' on NPS, which is detractor territory');
  }
  if (signalOn(data,'csat')) {
    if (data.csat != null && data.csat >= 4) good.push('satisfaction scores are solid');
    else if (csatIsPoor(data.csat)) bad.push('their satisfaction rating came back low');
  }
  if (signalOn(data,'days')) {
    if (data.days != null && data.days <= 7) good.push('we spoke with them recently');
    else if (data.days != null && data.days > 30) bad.push('we haven\'t talked to them in ' + data.days + ' days');
  }
  if (signalOn(data,'growth')) {
    if (data.growth === 'strong') good.push('there are strong expansion signals');
    else if (data.growth === 'none') bad.push('there\'s no growth activity happening');
  }

  const _join = function(arr) {
    if (arr.length <= 1) return arr[0] || '';
    if (arr.length === 2) return arr[0] + ' and ' + arr[1];
    return arr.slice(0,-1).join(', ') + ', and ' + arr[arr.length-1];
  };
  const _cap = function(s) { return s.charAt(0).toUpperCase() + s.slice(1); };

  // ── Contextual enrichment ─────────────────────────────────
  const tier = data.tier || 'mid';
  const tierLabel = {enterprise:'an Enterprise',mid:'a Mid-Market',smb:'an SMB'}[tier] || 'a Mid-Market';
  const isHighValue = tier === 'enterprise' || (data.mrr && data.mrr >= 10000);
  const mrrStr = data.mrr ? '$' + fmtNum(data.mrr) + '/mo' : '';

  // Compound signal patterns
  const disengaged = bad.some(function(b){return b.includes('logging in') || b.includes('logged in');}) && bad.some(function(b){return b.includes('using about');});
  const silentAndSlipping = bad.some(function(b){return b.includes('haven\'t talked');}) && mom === 'dn';
  const unhappyAndQuiet = (bad.some(function(b){return b.includes('NPS');}) || bad.some(function(b){return b.includes('satisfaction');})) && bad.some(function(b){return b.includes('haven\'t talked');});

  // Renewal proximity
  const renewDays = (data.renewal_date) ? Math.round((new Date(data.renewal_date) - new Date()) / 86400000) : null;
  const renewNow = renewDays != null && renewDays <= 0;
  const renewSoon = data.renewal != null && data.renewal <= 3;
  const renewUrgent = data.renewal != null && data.renewal <= 1;

  // Momentum flavor
  var momFlavor = '';
  if (mom === 'dn' && score <= 35) momFlavor = 'freefall';
  else if (mom === 'dn' && score >= 70) momFlavor = 'slipping';
  else if (mom === 'up' && score <= 35) momFlavor = 'recovering';
  else if (mom === 'up') momFlavor = 'climbing';
  else if (!mom || mom === 'flat') momFlavor = 'flat';

  // Kicker: most relevant extra context (only one fires)
  var _kicker = function(st) {
    if (disengaged && st !== 'expand' && st !== 'healthy') return ' This looks like full disengagement — not just one signal, they\'ve pulled back across the board.';
    if (unhappyAndQuiet) return ' They\'re unhappy and we\'re not in touch — that\'s a dangerous combination.';
    if (silentAndSlipping && st !== 'healthy') return ' Score is dropping and we haven\'t been in contact — that silence is the risk.';
    if (renewNow && (st === 'critical' || st === 'risk' || st === 'watch')) return ' Renewal is today — this needs immediate attention to prevent churn.';
    if (renewNow && (st === 'healthy' || st === 'expand')) return ' Renewal is today — health looks good, so this should close smoothly.';
    if (renewUrgent && (st === 'critical' || st === 'risk')) return ' Renewal is imminent, which puts real timeline pressure on this.';
    if (renewSoon && (st === 'critical' || st === 'risk' || st === 'watch')) return ' Renewal is in ' + fmtRenewalTime(data) + ' — we need to be in a better position by then.';
    if (renewSoon && (st === 'healthy' || st === 'expand')) return ' Renewal is in ' + fmtRenewalTime(data) + ' — should be smooth given current health.';
    if (isHighValue && mrrStr && st !== 'expand' && st !== 'healthy') return ' As ' + tierLabel + ' account at ' + mrrStr + ', this should be a top priority.';
    return '';
  };

  // ── Lifecycle-first overrides ──
  if (lc === 'onboarding') {
    if ((status === 'critical' || status === 'risk') && mom === 'up') {
      var t = name + ' is still ramping up, but things are starting to turn around.';
      if (bad.length) t += ' The concern is that ' + _join(bad.slice(0,2)) + '.';
      t += ' Onboarding recoveries are fragile though — these gains can reverse before they\'ve seen real value from the product.';
      return t;
    }
    if (status === 'critical' || status === 'risk') {
      var t = name + ' is struggling during onboarding, which is the worst time for it.';
      if (bad.length) t += ' ' + _cap(bad[0]) + (bad.length > 1 ? ', and ' + bad[1] : '') + '.';
      t += ' Issues this early compound fast — they lose confidence before they\'ve gotten any real value.';
      return t;
    }
    if (status === 'watch') {
      var t = name + ' is onboarding and mostly on track, but not quite where we\'d want them.';
      if (bad.length) t += ' ' + _cap(bad[0]) + ' — common early on, but it becomes a real problem if it persists past the first 30 days.';
      return t;
    }
    var t = name + ' is onboarding well.';
    if (good.length) t += ' ' + _cap(good[0]) + ', which is a great early sign.';
    t += ' Still early enough to lock in the right habits.';
    return t;
  }

  if (lc === 'won') {
    if ((status === 'critical' || status === 'risk') && mom === 'up') {
      var t = name + ' had a dip after expanding, but things are trending back up.';
      if (bad.length) t += ' Still seeing some issues — ' + _join(bad.slice(0,2)) + '.';
      t += ' Post-expansion dips happen when the new scope hasn\'t fully landed yet.';
      return t;
    }
    if (status === 'critical' || status === 'risk') {
      var t = name + ' has gone downhill since the expansion.';
      if (bad.length) t += ' ' + _cap(bad[0]) + '.';
      t += ' The new capabilities might not be landing as expected — if they don\'t see value soon, buyer\'s remorse kicks in.';
      return t;
    }
    if (status === 'watch') {
      var t = name + ' expanded recently but the new scope needs reinforcement.';
      if (bad.length) t += ' ' + _cap(bad[0]) + '.';
      t += ' Not alarming yet, but worth a check-in within the next week or two to make sure the new scope is landing.';
      return t;
    }
    var t = name + ' is doing great post-expansion.';
    if (good.length) t += ' ' + _cap(good[0]) + '.';
    t += ' The new scope is landing well.';
    return t;
  }

  if (lc === 'churned') {
    if (score >= 50) {
      var t = 'There might be a winback opportunity here.';
      if (good.length) t += ' Before they left, ' + _join(good.slice(0,2)) + ' — so the relationship wasn\'t all bad.';
      t += ' A targeted re-engagement could work.';
      return t;
    }
    var t = 'Winback looks tough on this one.';
    if (bad.length) t += ' Before they churned, ' + _join(bad.slice(0,2)) + '.';
    t += ' Would need a significant reason for them to come back.';
    return t;
  }

  // ── Standard health assessment ────────────────────────────
  if (status === 'critical') {
    var t = name + ' is in serious trouble.';
    if (bad.length) t += ' ' + _cap(bad[0]) + (bad.length > 1 ? ', and ' + bad[1] : '') + '.';
    if (good.length) t += ' The one bright spot is ' + good[0] + '.';
    if (data.mrr) t += ' That\'s $' + fmtNum(data.mrr) + ' MRR we could lose.';
    if (momFlavor === 'freefall') t += ' The score is in freefall — this needs immediate intervention before it\'s too late.';
    else if (momFlavor === 'recovering') t += ' There are early signs of recovery, but they\'re still deep in the danger zone.';
    else if (mom === 'dn') t += ' And it\'s getting worse — without stepping in, this is heading toward churn.';
    t += _kicker('critical');
    return t;
  }

  if (status === 'risk') {
    var t = name + ' needs attention.';
    if (bad.length === 1) t += ' The main concern is ' + bad[0] + '.';
    else if (bad.length > 1) t += ' ' + _cap(bad[0]) + ', and ' + bad[1] + '.';
    if (good.length) t += ' On the plus side, ' + good[0] + '.';
    if (data.mrr && data.mrr >= 5000) t += ' At ' + mrrStr + ', this is worth prioritizing.';
    if (mom === 'up') t += ' Things are trending up, which is encouraging, but they\'re not out of the woods yet.';
    else if (mom === 'dn') t += ' And the trend is going the wrong direction, which makes this more pressing.';
    t += _kicker('risk');
    return t;
  }

  if (status === 'watch') {
    var t = name + ' is okay but not great — worth keeping an eye on.';
    if (bad.length) t += ' ' + _cap(bad[0]) + ', which is the main thing I\'d flag.';
    if (good.length) t += ' ' + _cap(good[0]) + ' though, which is a positive.';
    if (isHighValue) t += ' As ' + tierLabel + ' account, even Watch status warrants closer attention.';
    if (mom === 'dn') t += ' If this keeps slipping, they\'ll move into At Risk.';
    else if (mom === 'up') t += ' The trend is positive — a little more attention could push them back to Healthy.';
    t += _kicker('watch');
    return t;
  }

  if (status === 'expand') {
    var t = name + ' is thriving — this is one to get excited about.';
    if (good.length) t += ' ' + _cap(good[0]) + (good.length > 1 ? ', and ' + good[1] : '') + '.';
    if (mom === 'dn') { t += ' Score dipped ' + (Math.abs(delta) || 'a few') + ' points recently though — check the trend chart to see which signals are pulling back before pushing growth conversations.'; }
    else if (data.mrr) t += ' At ' + mrrStr + ', a successful expansion here would be a big win.';
    else t += ' Great candidate for an expansion conversation.';
    t += _kicker('expand');
    return t;
  }

  // Healthy
  var t = name + ' is in good shape — no major concerns.';
  if (good.length) t += ' ' + _cap(good[0]) + (good.length > 1 ? ', and ' + good[1] : '') + '.';
  if (bad.length) t += ' The only thing I\'d keep an eye on is ' + bad[0] + ' — if that gets worse, it could drag the score down.';
  if (momFlavor === 'slipping') t += ' Score has been dipping from a good position — down ' + (Math.abs(delta) || 'a few') + ' points recently. Check the signal breakdown to see what\'s changing before it becomes a trend.';
  else if (mom === 'dn') t += ' Score has been dipping — down ' + (Math.abs(delta) || 'a few') + ' points recently. Check the signal breakdown to see what\'s changing.';
  t += _kicker('healthy');
  return t;
}

function buildPlaybook(score, data) {
  const plays = [];
  const status = getStatus(score);
  const name   = data.name || 'the customer';
  const lc     = data.lifecycle || 'active';
  const lcCtx  = LIFECYCLE_CONTEXT[lc] || LIFECYCLE_CONTEXT.active;

  // ── Lifecycle-specific plays (prepended) ─────────────────
  if (lc === 'onboarding') {
    plays.push({ type:'adopt', text:`<strong>Kickoff check-in:</strong> ${name} is onboarding — confirm the onboarding plan is on track. Ask: <em>"Are you getting the value you expected so far? Any blockers we should remove right away?"</em>` });
    plays.push({ type:'coach', text:`<strong>Stakeholder mapping:</strong> Identify the champion, executive sponsor, and day-to-day users at ${name}. Build relationships across the org early to reduce single-point-of-failure risk.` });
    if (signalOn(data,'adoption') && data.adoption != null && data.adoption < 50)
      plays.push({ type:'adopt', text:`<strong>Hands-on enablement:</strong> Adoption is at ${data.adoption}% — expected to be ramping but needs a push. Schedule a dedicated training session: <em>"Let me walk your team through the key workflows — teams that adopt these early see results 2x faster."</em>` });
    plays.push({ type:'coach', text:`<strong>Success plan review:</strong> Revisit the success criteria defined at kickoff. Make sure ${name} is tracking toward their first measurable win — this is critical for long-term retention.` });
  }
  if (lc === 'won') {
    plays.push({ type:'coach', text:`<strong>Value realization check:</strong> ${name} recently expanded — confirm the new capabilities are being used. Ask: <em>"How is [new feature/tier] working for your team? Is it meeting the expectations we discussed?"</em>` });
    plays.push({ type:'adopt', text:`<strong>Transition support:</strong> Ensure the expanded scope is fully onboarded and users are trained. Don't assume the new purchase auto-deploys — schedule a walkthrough if needed.` });
  }
  if (lc === 'churned') {
    plays.push({ type:'engage', text:`<strong>Winback assessment:</strong> Review what led to ${name}'s churn. If the relationship was positive and conditions have changed, draft a targeted win-back offer with a clear "what's new" message.` });
    return plays; // Churned accounts skip signal-based plays
  }

  // ── Login frequency ──────────────────────────────────────
  if (signalOn(data,'logins')) {
    if (data.logins === 0)
      plays.push({ type:'urgent', text:`<strong>Immediate re-engagement:</strong> ${name} hasn't logged in at all this month. Open with: <em>"Hey [name], I noticed you haven't had a chance to log in recently — is there something getting in the way? I'd love to set up a quick session to make sure you're getting value."</em>` });
    else if (data.logins < 5)
      plays.push({ type:'engage', text:`<strong>Re-engagement call:</strong> Only ${data.logins} logins this month — well below healthy levels. Ask: <em>"What does your typical week look like — are there blockers to using the platform more regularly? Let's remove them together."</em>` });
    else if (data.logins < 12)
      plays.push({ type:'coach', text:`<strong>Usage coaching:</strong> Login frequency is moderate at ${data.logins} days. Share a "tip of the month" and ask: <em>"Are there features you haven't had a chance to explore yet? I can walk you through what's working for similar teams."</em>` });
  }

  // ── Feature adoption ─────────────────────────────────────
  if (signalOn(data,'adoption')) {
    if (data.adoption < 25)
      plays.push({ type:'adopt', text:`<strong>Adoption rescue:</strong> Feature adoption is critically low at ${data.adoption}%. Book a hands-on session and say: <em>"A lot of value is sitting unused — let me show you exactly what [top feature] can do for your workflow. Teams like yours typically see [outcome] within 30 days."</em>` });
    else if (data.adoption < 50)
      plays.push({ type:'adopt', text:`<strong>Adoption workshop:</strong> ${data.adoption}% adoption leaves significant value on the table. Run a feature discovery session and ask: <em>"Which parts of the product does your team use daily? I want to make sure you're getting full value from everything available to you."</em>` });
  }

  // ── Support tickets ──────────────────────────────────────
  if (signalOn(data,'tickets')) {
    if (data.tickets >= 5)
      plays.push({ type:'urgent', text:`<strong>Escalation review:</strong> ${data.tickets} open tickets is a red flag. Loop in your support lead immediately and open with: <em>"I've been keeping a close eye on your open tickets — I want to make sure these are getting resolved fast enough. Can we get 20 minutes this week to walk through each one together?"</em>` });
    else if (data.tickets >= 3)
      plays.push({ type:'support', text:`<strong>Support sync:</strong> ${data.tickets} open tickets suggests friction. Ask: <em>"I saw you have a few open support requests — are these blocking anything important? I want to make sure nothing is slipping through the cracks on our end."</em>` });
  }

  // ── NPS ─────────────────────────────────────────────────
  if (signalOn(data,'nps')) {
    if (npsIsDetractor(data.nps))
      plays.push({ type:'urgent', text:`<strong>Executive recovery call:</strong> NPS detractor (${npsDisplay(data.nps)}) — don't wait. Escalate to leadership and reach out personally: <em>"I wanted to call you directly because your feedback matters a lot to us. Can you help me understand what's fallen short? I want to make this right."</em>` });
    else if (npsIsPromoter(data.nps) && status === 'expand')
      plays.push({ type:'expand', text:`<strong>Leverage the promoter:</strong> NPS ${npsDisplay(data.nps)} + strong health = referral opportunity. Ask: <em>"We love having you as a customer — would you be open to a quick case study or intro to a peer who might benefit from [product]? I'll make it easy for you."</em>` });
  }

  // ── CSAT ────────────────────────────────────────────────
  if (signalOn(data,'csat')) {
    if (csatIsPoor(data.csat))
      plays.push({ type:'urgent', text:`<strong>CSAT recovery needed:</strong> CSAT is ${csatDisplay(data.csat)} — satisfaction is critically low. Reach out today: <em>"I saw your recent feedback and I want to personally make sure we address what's not working. Can we get 20 minutes this week?"</em>` });
    else if (csatIsGood(data.csat) && status === 'expand')
      plays.push({ type:'expand', text:`<strong>High CSAT — referral ready:</strong> CSAT ${csatDisplay(data.csat)} indicates strong satisfaction. Ask: <em>"You've had such a great experience — would you be open to sharing your story or introducing a peer?"</em>` });
  }

  // ── Days since contact ───────────────────────────────────
  if (signalOn(data,'days')) {
    if (data.days > 45)
      plays.push({ type:'urgent', text:`<strong>Urgent re-connect:</strong> No contact in ${data.days} days — this account has gone dark. Send a personal note today: <em>"Hey [name], it's been a while and I wanted to check in. How's everything going with [product]? Anything on your radar I should know about?"</em>` });
    else if (data.days > 21)
      plays.push({ type:'engage', text:`<strong>Check-in email:</strong> ${data.days} days since last contact. Reach out with something valuable — share a relevant case study, tip, or product update, then close with: <em>"Anything you'd like to cover on our next call?"</em>` });
  }

  // ── Compound signal patterns ────────────────────────────
  if (signalOn(data,'logins') && signalOn(data,'adoption') && data.logins != null && data.logins < 5 && data.adoption != null && data.adoption < 30)
    plays.push({ type:'urgent', text:`<strong>Full disengagement:</strong> ${name} has both low logins (${data.logins}/mo) and low adoption (${data.adoption}%). This isn't one signal — they've checked out across the board. This needs a direct, honest conversation: <em>"I want to be straight with you — the data shows your team isn't getting value from us right now. Can we reset and figure out what needs to change?"</em>` });
  if (signalOn(data,'days') && data.days > 30 && getMomentum(data) === 'dn')
    plays.push({ type:'urgent', text:`<strong>Silent decline:</strong> Score is dropping and we haven't been in touch for ${data.days} days. The longer this goes unaddressed, the harder recovery gets. Break the silence today with a personal note — not a template.` });
  if ((signalOn(data,'nps') && npsIsDetractor(data.nps)) && signalOn(data,'days') && data.days > 21)
    plays.push({ type:'urgent', text:`<strong>Unhappy and unreachable:</strong> NPS detractor (${npsDisplay(data.nps)}) combined with ${data.days} days of no contact. They may already be evaluating alternatives. This needs an exec-level save call, not a standard check-in.` });
  if (data.renewal != null && data.renewal <= 3 && (status === 'critical' || status === 'risk'))
    plays.push({ type:'urgent', text:`<strong>Renewal at risk:</strong> ${name} renews in ${fmtRenewalTime(data)} while in ${status === 'critical' ? 'critical' : 'at-risk'} health. Lead with a recovery plan before any renewal discussion: <em>"I want to make sure we solve what's not working before we talk about next year."</em>` });

  // ── Renewal ──────────────────────────────────────────────
  if (data.renewal === 0)
    plays.push({ type:'renew', text:`<strong>Renewal NOW:</strong> Contract is at renewal — get this closed immediately. If health is strong, make it easy: <em>"Everything looks great on your account — I'd love to lock in your renewal and talk about what's coming next year."</em>` });
  else if (data.renewal != null && data.renewal <= 1)
    plays.push({ type:'renew', text:`<strong>Renewal urgency:</strong> ${fmtRenewalTime(data)} to renewal. Schedule the contract review call this week — lead with value: <em>"Before we talk paperwork, I want to make sure you've seen the ROI you were expecting. Let's walk through your results together."</em>` });
  else if (data.renewal != null && data.renewal <= 3 && status !== 'risk' && status !== 'critical')
    plays.push({ type:'renew', text:`<strong>Renewal prep:</strong> ${fmtRenewalTime(data)} to renewal. Start the conversation now while sentiment is positive: <em>"Renewal is coming up — I'd love to get ahead of it and make sure everything is lined up on your end."</em>` });

  // ── Growth signal ────────────────────────────────────────
  if (signalOn(data,'growth')) {
    if (data.growth === 'strong')
      plays.push({ type:'expand', text:`<strong>Upsell now:</strong> Strong growth signal detected — this is the right moment. Say: <em>"I noticed your team has been expanding usage significantly — have you thought about [next tier / additional seats / premium feature]? A lot of teams at your stage find it unlocks [specific outcome]."</em>` });
    else if (data.growth === 'mild' && status !== 'risk' && status !== 'critical')
      plays.push({ type:'expand', text:`<strong>Growth conversation:</strong> Mild growth signal — explore expansion potential. Ask: <em>"You've been growing steadily — where is the team headed over the next 6 months? I want to make sure [product] scales with you."</em>` });
  }

  // ── Case study ───────────────────────────────────────────
  if (status === 'expand' && ((signalOn(data,'nps') && npsIsPromoter(data.nps)) || (signalOn(data,'csat') && csatIsGood(data.csat))))
    plays.push({ type:'expand', text:`<strong>Case study / referral:</strong> Happy, expanding customer — perfect for advocacy. Ask: <em>"You've had such a strong experience — would you be open to sharing your story? Even a quick quote or intro to a peer would mean a lot to us."</em>` });

  // ── Borderline signal checks (catch mediocre signals that contribute to a Watch/Risk score) ──
  if (status === 'watch' || status === 'risk' || status === 'critical') {
    if (signalOn(data,'logins') && data.logins >= 5 && data.logins < 12 && !plays.some(p => p.type === 'coach' || p.type === 'engage'))
      plays.push({ type:'coach', text:`<strong>Boost engagement:</strong> ${name} is logging in ${data.logins} days/month — moderate but below ideal. Ask: <em>"Are there features your team hasn't explored yet? I'd love to walk you through what's working for similar teams."</em>` });
    if (signalOn(data,'adoption') && data.adoption >= 25 && data.adoption < 50 && !plays.some(p => p.type === 'adopt'))
      plays.push({ type:'adopt', text:`<strong>Improve adoption:</strong> Feature adoption is at ${data.adoption}% — there's value being left on the table. Run a feature discovery session: <em>"I'd love to show you a few capabilities that could save your team time."</em>` });
    if (signalOn(data,'days') && data.days > 14 && data.days <= 21 && !plays.some(p => p.type === 'engage' || p.type === 'urgent'))
      plays.push({ type:'engage', text:`<strong>Close the gap:</strong> It's been ${data.days} days since last contact — get ahead of this before it becomes a bigger issue. Send a check-in: <em>"Hey [name], just wanted to touch base — anything on your radar?"</em>` });
    if (signalOn(data,'nps') && !npsIsDetractor(data.nps) && !npsIsPromoter(data.nps) && data.nps != null && !plays.some(p => p.type === 'urgent'))
      plays.push({ type:'coach', text:`<strong>Move the needle on NPS:</strong> ${name} is in the passive range (${npsDisplay(data.nps)}) — not unhappy, but not an advocate either. Ask: <em>"What would it take for us to go from good to great for your team?"</em>` });
    if (signalOn(data,'csat') && !csatIsPoor(data.csat) && !csatIsGood(data.csat) && data.csat != null && !plays.some(p => p.type === 'urgent'))
      plays.push({ type:'coach', text:`<strong>Improve CSAT:</strong> ${name} has a neutral CSAT rating (${csatDisplay(data.csat)}). Ask: <em>"What's one thing we could improve to make your experience better?"</em>` });
  }

  // ── Status-aware fallback ──
  if (!plays.length) {
    if (status === 'critical' || status === 'risk') {
      const drivers = _nbaScoreDrivers(data);
      const driverHint = drivers.length ? ' The biggest movers: ' + drivers.map(d => d.label + ' ' + d.desc).join('; ') + '.' : ' No single signal is in crisis, but several are dragging the score down together — check the Signal Breakdown for the full picture.';
      plays.push({ type:'urgent', text:`<strong>Dig into what changed:</strong> ${name} is ${status === 'critical' ? 'critical' : 'at risk'}.${driverHint} Reach out today: <em>"I've been keeping a close eye on your account — can we find time this week to check in?"</em>` });
    }
    else if (status === 'watch')
      plays.push({ type:'engage', text:`<strong>Proactive check-in:</strong> ${name} is in the Watch zone — signals are borderline across the board. Increase your cadence and reach out: <em>"I wanted to check in and make sure everything is tracking well. Anything on your radar I should know about?"</em>` });
    else if (status === 'expand' && getMomentum(data) !== 'dn')
      plays.push({ type:'expand', text:`<strong>Capitalize on momentum:</strong> ${name} is in great shape with strong engagement. Explore expansion opportunities, ask for a referral, or propose a tier upgrade at your next touchpoint.` });
    else if (status === 'expand') {
      const drivers = _nbaScoreDrivers(data);
      const driverHint = drivers.length ? drivers.map(d => d.label + ' ' + d.desc).join('; ') + '.' : 'Check the trend chart and signal breakdown to see which signals are pulling back.';
      plays.push({ type:'engage', text:`<strong>Pause on expansion — score is dipping:</strong> ${name} scores well overall but momentum has turned negative. ${driverHint} Understand the drop before pushing growth conversations.` });
    }
    else
      plays.push({ type:'ok', text:`<strong>Stay the course:</strong> ${name} is healthy across all signals. Maintain your regular cadence and bring value on every call. If logins drop below 5/mo, adoption falls under 30%, or you go more than 30 days without contact — that's when to act.` });
  }

  // ── Lifecycle suppression: remove play types not appropriate for this stage ──
  if (lcCtx.suppress.length)
    return plays.filter(p => !lcCtx.suppress.includes(p.type));
  return plays;
}

// ─── SCORE DECLINE DRIVERS (per-customer) ────────────────────
// Compare current signal values to ~7 days ago, return top contributors to score drop
function _nbaScoreDrivers(c) {
  const hist = (c.history || []).filter(h => h.date).sort((a, b) => a.date.localeCompare(b.date));
  if (hist.length < 2) return [];

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoT = weekAgo.getTime();

  const recent = hist[hist.length - 1];
  const prev = hist.reduce((best, h) =>
    Math.abs(new Date(h.date).getTime() - weekAgoT) < Math.abs(new Date(best.date).getTime() - weekAgoT) ? h : best
  );
  if (recent === prev) return [];

  const w = getActiveWeights(c);
  const totalW = (w.logins + w.adoption + w.tickets + (w.nps || 0) + (w.csat || 0) + w.days + w.growth) || 100;

  const signals = [
    { key: 'logins', label: 'Logins', wt: w.logins,
      get: h => h.signals?.logins ?? c.logins,
      norm: v => v != null ? Math.min(v / 30, 1) * 100 : 50,
      desc: (a, b) => `went from ${Math.round(a)}/mo to ${Math.round(b)}/mo` },
    { key: 'adoption', label: 'Adoption', wt: w.adoption,
      get: h => h.signals?.adoption ?? c.adoption,
      norm: v => v != null ? Math.min(v, 100) : 50,
      desc: (a, b) => `dropped from ${Math.round(a)}% to ${Math.round(b)}%` },
    { key: 'tickets', label: 'Tickets', wt: w.tickets,
      get: h => h.signals?.tickets ?? c.tickets,
      norm: v => v != null ? Math.max(0, 100 - v * 20) : 50,
      desc: (a, b) => `increased from ${Math.round(a)} to ${Math.round(b)}` },
    { key: 'nps', label: 'NPS', wt: w.nps || 0,
      get: h => h.signals?.nps ?? c.nps,
      norm: v => npsNormalized(v),
      desc: (a, b) => `dropped from ${Math.round(a * 10) / 10} to ${Math.round(b * 10) / 10}` },
    { key: 'csat', label: 'CSAT', wt: w.csat || 0,
      get: h => h.signals?.csat ?? c.csat,
      norm: v => csatNormalized(v),
      desc: (a, b) => `dropped from ${csatDisplay(a)} to ${csatDisplay(b)}` },
    { key: 'days', label: 'Days Since Contact', wt: w.days,
      get: h => h.signals?.days ?? c.days,
      norm: v => v != null ? Math.max(0, 100 - (v / 180) * 100) : 50,
      desc: (a, b) => `grew from ${Math.round(a)}d to ${Math.round(b)}d` }
  ].filter(s => s.wt > 0);

  const results = [];
  signals.forEach(s => {
    const rawPrev = s.get(prev);
    const rawCurr = s.get(recent);
    if (rawPrev == null || rawCurr == null) return;
    const normPrev = s.norm(rawPrev);
    const normCurr = s.norm(rawCurr);
    const contribution = (normCurr - normPrev) * (s.wt / totalW);
    if (contribution < -1) { // meaningful negative impact
      results.push({ key: s.key, label: s.label, contribution, desc: s.desc(rawPrev, rawCurr) });
    }
  });
  results.sort((a, b) => a.contribution - b.contribution); // most negative first
  return results.slice(0, 2);
}

// ─── SCORE IMPROVEMENT DRIVERS (per-customer) ────────────────
// Like _nbaScoreDrivers but for positive changes — what improved?
function _nbaScoreGains(c) {
  const hist = (c.history || []).filter(h => h.date).sort((a, b) => a.date.localeCompare(b.date));
  if (hist.length < 2) return [];

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoT = weekAgo.getTime();

  const recent = hist[hist.length - 1];
  const prev = hist.reduce((best, h) =>
    Math.abs(new Date(h.date).getTime() - weekAgoT) < Math.abs(new Date(best.date).getTime() - weekAgoT) ? h : best
  );
  if (recent === prev) return [];

  const w = getActiveWeights(c);
  const totalW = (w.logins + w.adoption + w.tickets + (w.nps || 0) + (w.csat || 0) + w.days + w.growth) || 100;

  const signals = [
    { key: 'logins', label: 'logins', wt: w.logins,
      get: h => h.signals?.logins ?? c.logins,
      norm: v => v != null ? Math.min(v / 30, 1) * 100 : 50,
      desc: (a, b) => `went from ${Math.round(a)}/mo to ${Math.round(b)}/mo` },
    { key: 'adoption', label: 'adoption', wt: w.adoption,
      get: h => h.signals?.adoption ?? c.adoption,
      norm: v => v != null ? Math.min(v, 100) : 50,
      desc: (a, b) => `rose from ${Math.round(a)}% to ${Math.round(b)}%` },
    { key: 'tickets', label: 'tickets', wt: w.tickets,
      get: h => h.signals?.tickets ?? c.tickets,
      norm: v => v != null ? Math.max(0, 100 - v * 20) : 50,
      desc: (a, b) => `dropped from ${Math.round(a)} to ${Math.round(b)}` },
    { key: 'nps', label: 'NPS', wt: w.nps || 0,
      get: h => h.signals?.nps ?? c.nps,
      norm: v => npsNormalized(v),
      desc: (a, b) => `improved from ${Math.round(a * 10) / 10} to ${Math.round(b * 10) / 10}` },
    { key: 'csat', label: 'CSAT', wt: w.csat || 0,
      get: h => h.signals?.csat ?? c.csat,
      norm: v => csatNormalized(v),
      desc: (a, b) => `improved from ${csatDisplay(a)} to ${csatDisplay(b)}` },
    { key: 'days', label: 'contact recency', wt: w.days,
      get: h => h.signals?.days ?? c.days,
      norm: v => v != null ? Math.max(0, 100 - (v / 180) * 100) : 50,
      desc: (a, b) => `improved from ${Math.round(a)}d to ${Math.round(b)}d ago` }
  ].filter(s => s.wt > 0);

  const results = [];
  signals.forEach(s => {
    const rawPrev = s.get(prev);
    const rawCurr = s.get(recent);
    if (rawPrev == null || rawCurr == null) return;
    const normPrev = s.norm(rawPrev);
    const normCurr = s.norm(rawCurr);
    const contribution = (normCurr - normPrev) * (s.wt / totalW);
    if (contribution > 1) { // meaningful positive impact
      results.push({ key: s.key, label: s.label, contribution, desc: s.desc(rawPrev, rawCurr) });
    }
  });
  results.sort((a, b) => b.contribution - a.contribution); // most positive first
  return results.slice(0, 2);
}

// ─── NEXT BEST ACTION ────────────────────────────────────────
function buildNextBestAction(c) {
  const status  = getStatus(c.score);
  const mom     = getMomentum(c);
  const delta   = (c.history && c.history.length >= 2) ? getDelta7d(c) : 0;
  const improving = mom === 'up';
  const declining = mom === 'dn';
  const bigImprove = delta >= 10;
  const cad     = getCadenceStatus(c);
  const sent    = latestSentiment(c);
  const lc      = c.lifecycle || 'active';

  // ── Lifecycle-first overrides ──────────────────────────────
  if (lc === 'onboarding') {
    if ((status === 'critical' || status === 'risk') && bigImprove)
      return { level:'warn', action:'Reinforce onboarding momentum', talk:`${c.name||'This customer'} started rough but is recovering fast. Whatever changed is working — find out what and double down: "Things are heading in the right direction — what clicked for your team recently? Let's make sure we keep that going."` };
    if (status === 'critical' || status === 'risk')
      return { level:'urgent', action:'Onboarding at risk — remove blockers now', talk:`${c.name||'This customer'} is a new customer showing risk signals with no recovery trend yet. Schedule a hands-on enablement session immediately: "I want to make sure we get you off to a strong start. Can we get 30 minutes to walk through any blockers together?"` };
    if (signalOn(c,'adoption') && c.adoption != null && c.adoption < 40)
      return { level:'warn', action:`Drive adoption — only ${c.adoption}% utilized`, talk:`New customer at ${c.adoption}% adoption — this is the critical window for time-to-value. Schedule a training session: "Let me walk your team through the key features — teams that adopt these early see results much faster."` };
    if (signalOn(c,'logins') && c.logins != null && c.logins < 5)
      return { level:'warn', action:'Boost early engagement — low logins', talk:`New customer with only ${c.logins} logins this month. Reach out: "I wanted to check in on how things are going — are you finding it easy to get started? I'd love to walk you through a few things."` };
    return { level:'ok', action:'Continue onboarding — confirm time-to-value', talk:`Onboarding is on track. Keep the momentum going — focus on adoption milestones and building champion relationships. Ask: "What's working well so far? Anything we can do to help you get more value faster?"` };
  }
  if (lc === 'won') {
    if ((status === 'critical' || status === 'risk') && bigImprove)
      return { level:'warn', action:'Post-expansion recovering — stay close', talk:`${c.name||'This customer'} struggled after expanding but is now trending in the right direction. Stay close to ensure the recovery continues: "Glad to see things picking up — what's been the biggest adjustment for your team with the new capabilities?"` };
    if (status === 'critical' || status === 'risk')
      return { level:'warn', action:'Expansion at risk — ensure value realization', talk:`${c.name||'This customer'} recently expanded but signals are dropping. Focus on ensuring the new capabilities are delivering value: "I want to make sure you're getting what you expected from the expansion. Can we review how things are going?"` };
    return { level:'ok', action:'Value realization — check new capabilities adoption', talk:`Recently expanded — make sure the new scope is fully adopted and delivering ROI. Ask: "How is [the new capability] working for your team? Is it meeting the expectations we discussed?"` };
  }
  if (lc === 'churned') {
    if (c.score >= 50)
      return { level:'warn', action:'Assess winback potential', talk:`${c.name||'This account'} churned but had decent engagement. Consider a targeted re-engagement: "We've made some improvements since we last worked together — would you be open to a quick conversation about what's new?"` };
    return { level:'ok', action:'Account churned — document lessons learned', talk:`This account has churned. Document what led to the loss. If their signals ever start improving (new logins, support tickets closing), or you hear about leadership changes or new funding — that's your winback window.` };
  }
  const urgency = getRenewalUrgency(c);

  // Priority order: most urgent condition wins
  // Each check is also gated on whether that signal dimension is active (weight > 0)
  if (signalOn(c,'nps') && npsIsDetractor(c.nps))
    return { level:'urgent', action:'Call them today', talk:`NPS detractor (${npsDisplay(c.nps)}) — this needs a personal call, not an email. Open with: "I wanted to reach out directly. Can you help me understand what's fallen short? I want to make this right."` };

  if (signalOn(c,'csat') && csatIsPoor(c.csat))
    return { level:'urgent', action:'Follow up on CSAT', talk:`Poor CSAT (${csatDisplay(c.csat)}) — satisfaction is critically low. Reach out today: "I saw your recent feedback and want to personally address what's not working."` };

  if (signalOn(c,'tickets') && c.tickets >= 5)
    return { level:'urgent', action:'Escalate support now', talk:`${c.tickets} open tickets is critical. Loop in your support lead and contact the customer today: "I've been watching your open tickets closely — can we get 20 minutes to walk through each one together?"` };

  if (c.renewal != null && c.renewal <= 1 && c.renewal >= 0)
    return { level:'urgent', action:'Close the renewal this week', talk:`Renewal is ${c.renewal === 0 ? 'NOW' : 'in 1 month'} — get this on the calendar immediately. Lead with value before paperwork: "Before we talk renewal, let's walk through your results together."` };

  if (sent?.val === 'negative')
    return { level:'warn', action:'Follow up on last call', talk:`Last call logged as negative — follow up within 24 hours. Ask: "I wanted to check in after our last conversation. Is there anything I can do to help get things back on track?"` };

  if (signalOn(c,'days') && cad.status === 'overdue')
    return { level:'warn', action:`Reach out now — ${c.days} days no contact`, talk:`This account has gone silent. Send a personal note today: "Hey [name], it's been a while — how's everything going? Anything on your radar I should know about?"` };

  if (status === 'critical' && bigImprove)
    return { level:'warn', action:'Recovery underway — stay close', talk:`Critical score but recovering fast. Something is working — find out what and reinforce it: "I can see things are moving in the right direction. What's been the biggest change recently? Let's make sure we keep this going."` };

  if (status === 'critical')
    return { level:'urgent', action:'Escalate — critical health score', talk:`Critical score with no recovery trend — act immediately. Book an executive call this week: "I've been keeping a very close eye on your account and want to personally make sure we get things back on track."` };

  if (status === 'risk' && declining)
    return { level:'urgent', action:'Schedule emergency health check', talk:`At Risk AND still declining — don't wait. Book a call this week: "I've been keeping a close eye on your account and want to make sure we're getting ahead of anything before it becomes a bigger issue."` };

  if (status === 'risk' && bigImprove)
    return { level:'warn', action:'Keep the recovery going', talk:`At Risk but on an upward trajectory. Don't change what's working — check in to understand what's driving the improvement: "Things are trending better — what shifted? I want to make sure we keep building on this."` };

  if (status === 'risk')
    return { level:'warn', action:'Schedule a health check call', talk:`At Risk account — reach out this week: "I wanted to check in and make sure you're getting the value you expected. Can we find 30 minutes to review where things stand?"` };

  if (signalOn(c,'logins') && c.logins != null && c.logins < 5 && signalOn(c,'adoption') && c.adoption != null && c.adoption < 30)
    return { level:'warn', action:'Address low engagement — logins & adoption down', talk:`Both login frequency (${c.logins}/mo) and adoption (${c.adoption}%) are low. Schedule a hands-on session: "I'd love to walk you through a few features your team might not be using yet — can we find 30 minutes?"` };

  if (signalOn(c,'adoption') && c.adoption != null && c.adoption < 30)
    return { level:'warn', action:`Drive adoption — only ${c.adoption}% utilized`, talk:`Adoption is at ${c.adoption}% — they're not getting full value. Offer a guided session: "I noticed your team is only using a fraction of what's available. Can I show you a few quick wins that other teams at your stage love?"` };

  if (signalOn(c,'logins') && c.logins != null && c.logins < 5)
    return { level:'warn', action:`Investigate low logins (${c.logins}/mo)`, talk:`Only ${c.logins} logins this month is a red flag. Reach out: "I noticed your team's activity has dipped recently — is everything okay? Anything I can help unblock?"` };

  if (status === 'watch') {
    // Build a specific action based on which signals are actually weak
    const watchSigns = [];
    if (signalOn(c,'logins') && c.logins != null && c.logins < 10) watchSigns.push('logins at ' + c.logins + '/mo');
    if (signalOn(c,'adoption') && c.adoption != null && c.adoption < 50) watchSigns.push('adoption at ' + c.adoption + '%');
    if (signalOn(c,'tickets') && c.tickets != null && c.tickets >= 3) watchSigns.push(c.tickets + ' open tickets');
    if (signalOn(c,'days') && c.days != null && c.days > 21) watchSigns.push('no contact in ' + c.days + 'd');
    if (signalOn(c,'nps') && c.nps != null && c.nps <= 7) watchSigns.push('NPS ' + c.nps);
    if (signalOn(c,'csat') && c.csat != null && c.csat <= 3) watchSigns.push('CSAT ' + csatDisplay(c.csat));
    const signSummary = watchSigns.length ? watchSigns.slice(0, 2).join(', ') : 'mixed signals';
    if (improving)
      return { level:'warn', action:'Trending up — address remaining gaps', talk:`Heading in the right direction but still in Watch territory (${signSummary}). Keep the momentum: "Things are looking better — I want to make sure we close the remaining gaps. Can we review where you're still seeing friction?"` };
    return { level:'warn', action:'Check in — ' + signSummary, talk:`In the Watch zone with ${signSummary}. Proactively reach out: "I wanted to check in and make sure everything is going well. Anything on your radar I should know about?"` };
  }

  if (signalOn(c,'growth') && status === 'expand' && c.growth === 'strong' && !declining)
    return { level:'expand', action:'Open the upsell conversation', talk:`Perfect timing for expansion. Say: "Your team's engagement has been really strong — have you thought about [next tier / additional seats]? Teams at your stage typically see [outcome] when they expand."` };

  if (c.renewal != null && c.renewal <= 3)
    return { level:'renew', action:'Start renewal conversation', talk:`Get ahead of the renewal while sentiment is positive: "Renewal is coming up — I'd love to get ahead of it and make sure everything is lined up on your end."` };

  if (declining) {
    const drop = Math.abs(delta);
    // Find which signal drove the decline by comparing current vs week-ago values
    const drivers = _nbaScoreDrivers(c);
    let driverText = '';
    let actionSuffix = '';
    if (drivers.length > 0) {
      const top = drivers[0];
      actionSuffix = ` — driven by ${top.label}`;
      if (drivers.length === 1) {
        driverText = `The main factor: <strong>${top.label}</strong> ${top.desc}. `;
      } else {
        driverText = `The main factors: <strong>${top.label}</strong> ${top.desc} and <strong>${drivers[1].label}</strong> ${drivers[1].desc}. `;
      }
    }
    return { level:'warn', action:`Score decline (−${drop} pts)${actionSuffix}`, talk:`Score dropped ${drop} points this week. ${driverText}Ask: "I noticed some changes in your usage patterns recently — is there anything going on that I should know about?"` };
  }

  if (status === 'expand')
    return { level:'expand', action:'Ask for a referral or case study', talk:`Happy, healthy customer — great time to ask: "You've had such a great experience — would you be open to a quick intro to a peer who might benefit? I'll make it easy for you."` };

  return { level:'ok', action:'Send a value-add touchpoint', talk:`Account is healthy — maintain momentum. Send something useful: a relevant tip, case study, or product update. Close with: "Anything you'd like to cover on our next call?"` };
}

// ─── MOMENTUM ────────────────────────────────────────────────
// Looks at the last 3 history points to classify trajectory
function getMomentum(c) {
  if (!c.history || c.history.length < 2) return 'new';
  // Use 7-day delta for consistency with trend sparkline and insights
  const diff = getDelta7d(c);
  if (diff >= momentumPts)  return 'up';
  if (diff <= -momentumPts) return 'dn';
  return 'flat';
}

function momentumHTML(c) {
  const m = getMomentum(c);
  const diff = (c.history && c.history.length >= 2) ? getDelta7d(c) : 0;
  const svgUp   = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
  const svgDn   = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`;
  const svgFlat = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  const svgNew  = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="4"/></svg>`;
  const map = {
    up:   { cls:'up',   icon:svgUp,   label:'Improving' },
    dn:   { cls:'dn',   icon:svgDn,   label:'Declining' },
    flat: { cls:'flat', icon:svgFlat, label:'Flat' },
    new:  { cls:'new',  icon:svgNew,  label:'New' }
  };
  const { cls, icon, label } = map[m];
  const delta = m === 'up' ? ` +${diff}` : m === 'dn' ? ` ${diff}` : '';
  return `<span class="momentum ${cls}">${icon} ${label}${delta}</span>`;
}

// ─── RENEWAL URGENCY ─────────────────────────────────────────
// Combines score + days to renewal into a single urgency level
function getRenewalUrgency(c) {
  if (c.renewal == null || c.lifecycle === 'churned') return null;
  const months = c.renewal;
  const score  = c.score;
  // Score the urgency 0–100 (higher = more urgent)
  const renewalFactor = Math.max(0, 1 - months / 12); // 0mo=1.0, 12mo=0
  const riskFactor    = Math.max(0, 1 - score / 100);  // score 0=1.0, 100=0
  const urgency       = Math.round((renewalFactor * 0.6 + riskFactor * 0.4) * 100);

  if (urgency >= 70) return { level:'critical', label:'Critical', cls:'critical', score: urgency };
  if (urgency >= 45) return { level:'high',     label:'High',     cls:'high',     score: urgency };
  if (urgency >= 20) return { level:'medium',   label:'Medium',   cls:'medium',   score: urgency };
  return               { level:'low',      label:'Low',      cls:'low',      score: urgency };
}

function urgencyHTML(c) {
  const u = getRenewalUrgency(c);
  if (!u) return '—';
  return `<span class="urgency ${u.cls}" title="Urgency score: ${u.score}/100">${u.label}</span>`;
}

// ─── CADENCE TRACKER ─────────────────────────────────────────
// Tier-based thresholds for days since last contact
// cadenceConfig is defined in state.js and configurable via Settings
function getCadenceThresholds() { return cadenceConfig; }

function getCadenceStatus(c) {
  if (c.days == null) return { status:'ok', label:'N/A', cls:'cadence-ok' };
  const ct = getCadenceThresholds();
  const thres = ct[c.tier] || ct.mid;
  if (c.days >= thres.overdue) return { status:'overdue', label:`Overdue (${c.days}d)`,  cls:'cadence-overdue' };
  if (c.days >= thres.warn)    return { status:'warn',    label:`Due Soon (${c.days}d)`, cls:'cadence-warn' };
  return                                { status:'ok',      label:`On Track (${c.days}d)`, cls:'cadence-ok' };
}

// ─── QUIET ACCOUNT DETECTION ──────────────────────────────────
// "Quiet" = zero activity across ALL channels: no logins, no tickets, no CSM contact.
// quietDays is defined in state.js and configurable via Settings

function isQuietAccount(c) {
  if (c.lifecycle === 'churned' || c.lifecycle === 'won') return false;
  if (c.logins != null && c.logins > 0) return false;
  if (c.tickets != null && c.tickets > 0) return false;
  const effDays = getEffectiveDays(c);
  if (effDays == null || effDays < quietDays) return false;
  return true;
}

function getQuietDays(c) {
  return getEffectiveDays(c) || 0;
}

// Add cadence alerts to the alerts builder
function buildCadenceAlerts() {
  const alerts = [];
  customers.forEach(c => {
    if (c.lifecycle === 'churned') return;
    if (!passesManagerFilter(c)) return;
    // Next touch overdue alert
    if (c.next_touch) {
      const ntDays = Math.round((new Date() - new Date(c.next_touch)) / 86400000);
      if (ntDays > 0) {
        var _ntCtx = ntDays > 14 ? 'Significantly overdue — reschedule immediately' : ntDays > 7 ? 'Over a week late' : 'Recently overdue';
        var _ntHealth = (c.status === 'critical' || c.status === 'risk') ? ' · ⚠ ' + (c.status === 'critical' ? 'Critical' : 'At Risk') : '';
        alerts.push({
          id:  `${c.id}-ntouch`,
          cid: c.id,
          cat: 'cadence',
          type: ntDays > 7 ? 'red' : 'amber',
          msg: `<strong>${escHtml(c.name)}</strong> <span>— scheduled touch overdue by ${ntDays} day${ntDays !== 1 ? 's' : ''}</span>`,
          sub: `${_ntCtx} · Was due ${new Date(c.next_touch).toLocaleDateString('en-US', { month:'short', day:'numeric' })}${_ntHealth}`
        });
      }
    }
    if (!signalOn(c,'days')) return; // cadence is a days-based signal — skip if weight is 0
    const cad = getCadenceStatus(c);
    if (cad.status === 'overdue') {
      var _cadCtx = (c.status === 'critical' || c.status === 'risk') ? 'At-risk account going uncontacted' : c.tier === 'enterprise' ? 'Enterprise SLA breach' : 'Contact cadence exceeded';
      var _cadMom = getMomentum(c) === 'dn' ? ' · Score declining ↘' : '';
      alerts.push({
        id: c.id+'-cadence',
        cid: c.id,
        type: 'red',
        msg: `<strong>${c.name}</strong> <span>— check-in overdue! No contact in ${c.days} days (${(c.tier||'mid').toUpperCase()} SLA: ${getCadenceThresholds()[c.tier||'mid'].overdue}d)</span>`,
        sub: `${_cadCtx} · $${fmtNum(c.mrr||0)} MRR${_cadMom}`
      });
    } else if (cad.status === 'warn') {
      var _cadWCtx = (c.status === 'critical' || c.status === 'risk') ? 'At-risk — don\'t let this go overdue' : 'Approaching cadence limit';
      alerts.push({
        id: c.id+'-cadence',
        cid: c.id,
        type: 'amber',
        msg: `<strong>${c.name}</strong> <span>— check-in due soon (${c.days} days since contact)</span>`,
        sub: `${_cadWCtx} · $${fmtNum(c.mrr||0)} MRR`
      });
    }
  });
  return alerts;
}
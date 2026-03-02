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
  const growth_n   = { none:25, mild:65, strong:100 }[data.growth] || 25;

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
    var lcd = new Date(c.last_contact_date);
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
  // Promote: next_touch becomes last_contact_date
  c.last_contact_date = c.next_touch;
  c.next_touch = '';
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
    var data = { logins: c.logins, adoption: c.adoption,
      tickets: c.tickets, nps: c.nps, csat: c.csat,
      days: effDays, growth: c.growth || 'none' };
    var w = getActiveWeights(c);
    var result = calcScore(data, w);
    c.days   = effDays;
    c.score  = result.score;
    c.status = getStatus(result.score);
  });
  // Persist transitioned customers (fire-and-forget)
  if (transitioned.length && typeof save === 'function') {
    transitioned.forEach(function(c) { save(c).catch(function(){}); });
  }
}

function makeRec(score, data) {
  const status = getStatus(score);
  const name   = data.name ? `${data.name}` : 'This account';
  if (status === 'critical') {
    return `<strong>Critical:</strong> ${name} has very low health signals — act immediately. Escalate internally and book an emergency call this week before churn becomes likely.`;
  }
  if (status === 'risk') {
    const issues = [];
    if (signalOn(data,'logins')   && data.logins   < 5)        issues.push('very low login activity');
    if (signalOn(data,'adoption') && data.adoption < 30)       issues.push('poor feature adoption');
    if (signalOn(data,'tickets')  && data.tickets  >= 3)       issues.push(`${data.tickets} open support tickets`);
    if (signalOn(data,'nps')      && npsIsDetractor(data.nps)) issues.push('NPS detractor on record');
    if (signalOn(data,'csat')     && csatIsPoor(data.csat))    issues.push('poor CSAT rating');
    if (signalOn(data,'days')     && data.days     > 30)       issues.push(`no contact in ${data.days} days`);
    if (issues.length)
      return `<strong>At Risk:</strong> ${name} is showing ${issues.slice(0,2).join(' and ')}. Act this week — schedule an EBR or health check call before this escalates.`;
    return `<strong>At Risk:</strong> Multiple weak signals detected. Reach out immediately and schedule a health check call.`;
  }
  if (status === 'watch') {
    return `<strong>Watch:</strong> ${name} has some warning signals. Stay close — increase your cadence and address any friction before it worsens.`;
  }
  if (status === 'expand') {
    if (signalOn(data,'growth') && data.growth === 'strong')
      return `<strong>Expansion Ready:</strong> ${name} is highly engaged with strong growth signals. This is the right time to open an upsell conversation — they're primed to say yes.`;
    return `<strong>Expansion Ready:</strong> ${name} is in great shape. Introduce an expansion conversation, request a referral, or propose a tier upgrade at your next touchpoint.`;
  }
  if (data.renewal != null && data.renewal <= 2)
    return `<strong>Healthy — Renewal Approaching:</strong> ${name} is in good shape but renews soon. Lock in the renewal now while sentiment is positive.`;
  return `<strong>Healthy:</strong> ${name} is in good shape. Maintain your regular cadence and watch for expansion signals.`;
}

function buildPlaybook(score, data) {
  const plays = [];
  const status = getStatus(score);
  const name   = data.name || 'the customer';

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

  // ── Renewal ──────────────────────────────────────────────
  if (data.renewal === 0)
    plays.push({ type:'renew', text:`<strong>Renewal NOW:</strong> Contract is at renewal — get this closed immediately. If health is strong, make it easy: <em>"Everything looks great on your account — I'd love to lock in your renewal and talk about what's coming next year."</em>` });
  else if (data.renewal != null && data.renewal <= 1)
    plays.push({ type:'renew', text:`<strong>Renewal urgency:</strong> ${data.renewal} month to renewal. Schedule the contract review call this week — lead with value: <em>"Before we talk paperwork, I want to make sure you've seen the ROI you were expecting. Let's walk through your results together."</em>` });
  else if (data.renewal != null && data.renewal <= 3 && status !== 'risk' && status !== 'critical')
    plays.push({ type:'renew', text:`<strong>Renewal prep:</strong> ${data.renewal} months to renewal. Start the conversation now while sentiment is positive: <em>"Renewal is coming up — I'd love to get ahead of it and make sure everything is lined up on your end."</em>` });

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
    if (status === 'critical' || status === 'risk')
      plays.push({ type:'urgent', text:`<strong>Investigate:</strong> ${name} is ${status === 'critical' ? 'critical' : 'at risk'} — the composite score is low even though no single signal is in crisis. Review recent trends, reach out today, and dig into what may have changed: <em>"I've been keeping a close eye on your account — can we find time this week to check in?"</em>` });
    else if (status === 'watch')
      plays.push({ type:'engage', text:`<strong>Proactive check-in:</strong> ${name} is in the Watch zone — signals are borderline across the board. Increase your cadence and reach out: <em>"I wanted to check in and make sure everything is tracking well. Anything on your radar I should know about?"</em>` });
    else if (status === 'expand')
      plays.push({ type:'expand', text:`<strong>Capitalize on momentum:</strong> ${name} is in great shape with strong engagement. Explore expansion opportunities, ask for a referral, or propose a tier upgrade at your next touchpoint.` });
    else
      plays.push({ type:'ok', text:`<strong>Stay the course:</strong> ${name} is healthy across all signals. Maintain your regular cadence, bring value on every call, and watch for any early warning signs.` });
  }

  return plays;
}

// ─── NEXT BEST ACTION ────────────────────────────────────────
function buildNextBestAction(c) {
  const status  = getStatus(c.score);
  const mom     = getMomentum(c);
  const cad     = getCadenceStatus(c);
  const sent    = latestSentiment(c);
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

  if (status === 'critical')
    return { level:'urgent', action:'Escalate — critical health score', talk:`Critical score — act immediately. Book an executive call this week: "I've been keeping a very close eye on your account and want to personally make sure we get things back on track."` };

  if (status === 'risk' && mom === 'dn')
    return { level:'urgent', action:'Schedule emergency health check', talk:`At Risk AND declining — don't wait. Book a call this week: "I've been keeping a close eye on your account and want to make sure we're getting ahead of anything before it becomes a bigger issue."` };

  if (status === 'risk')
    return { level:'warn', action:'Schedule a health check call', talk:`At Risk account — reach out this week: "I wanted to check in and make sure you're getting the value you expected. Can we find 30 minutes to review where things stand?"` };

  if (signalOn(c,'logins') && c.logins != null && c.logins < 5 && signalOn(c,'adoption') && c.adoption != null && c.adoption < 30)
    return { level:'warn', action:'Address low engagement — logins & adoption down', talk:`Both login frequency (${c.logins}/mo) and adoption (${c.adoption}%) are low. Schedule a hands-on session: "I'd love to walk you through a few features your team might not be using yet — can we find 30 minutes?"` };

  if (signalOn(c,'adoption') && c.adoption != null && c.adoption < 30)
    return { level:'warn', action:`Drive adoption — only ${c.adoption}% utilized`, talk:`Adoption is at ${c.adoption}% — they're not getting full value. Offer a guided session: "I noticed your team is only using a fraction of what's available. Can I show you a few quick wins that other teams at your stage love?"` };

  if (signalOn(c,'logins') && c.logins != null && c.logins < 5)
    return { level:'warn', action:`Investigate low logins (${c.logins}/mo)`, talk:`Only ${c.logins} logins this month is a red flag. Reach out: "I noticed your team's activity has dipped recently — is everything okay? Anything I can help unblock?"` };

  if (status === 'watch')
    return { level:'warn', action:'Check in — some warning signs', talk:`Score is in the Watch zone. Proactively reach out: "I wanted to check in and make sure everything is going well. Anything on your radar I should know about?"` };

  if (signalOn(c,'growth') && status === 'expand' && c.growth === 'strong')
    return { level:'expand', action:'Open the upsell conversation', talk:`Perfect timing for expansion. Say: "Your team's engagement has been really strong — have you thought about [next tier / additional seats]? Teams at your stage typically see [outcome] when they expand."` };

  if (c.renewal != null && c.renewal <= 3)
    return { level:'renew', action:'Start renewal conversation', talk:`Get ahead of the renewal while sentiment is positive: "Renewal is coming up — I'd love to get ahead of it and make sure everything is lined up on your end."` };

  if (mom === 'dn')
    return { level:'warn', action:'Investigate score decline', talk:`Score is trending down — dig into what changed. Ask: "I noticed some changes in your usage patterns recently — is there anything going on that I should know about?"` };

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
  if (diff >= 3)  return 'up';
  if (diff <= -3) return 'dn';
  return 'flat';
}

function momentumHTML(c) {
  const m = getMomentum(c);
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
  return `<span class="momentum ${cls}">${icon} ${label}</span>`;
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
const CADENCE_THRESHOLDS = {
  enterprise: { warn: 14, overdue: 30 },
  mid:        { warn: 21, overdue: 45 },
  smb:        { warn: 30, overdue: 60 }
};

function getCadenceStatus(c) {
  if (c.days == null) return { status:'ok', label:'N/A', cls:'cadence-ok' };
  const thres = CADENCE_THRESHOLDS[c.tier] || CADENCE_THRESHOLDS.mid;
  if (c.days >= thres.overdue) return { status:'overdue', label:`Overdue (${c.days}d)`,  cls:'cadence-overdue' };
  if (c.days >= thres.warn)    return { status:'warn',    label:`Due Soon (${c.days}d)`, cls:'cadence-warn' };
  return                                { status:'ok',      label:`On Track (${c.days}d)`, cls:'cadence-ok' };
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
        alerts.push({
          id:  `${c.id}-ntouch`,
          cid: c.id,
          cat: 'cadence',
          type: ntDays > 7 ? 'red' : 'amber',
          msg: `<strong>${escHtml(c.name)}</strong> <span>— scheduled touch overdue by ${ntDays} day${ntDays !== 1 ? 's' : ''}</span>`,
          sub: `Was due ${new Date(c.next_touch).toLocaleDateString('en-US', { month:'short', day:'numeric' })}`
        });
      }
    }
    if (!signalOn(c,'days')) return; // cadence is a days-based signal — skip if weight is 0
    const cad = getCadenceStatus(c);
    if (cad.status === 'overdue') {
      alerts.push({
        id: c.id+'-cadence',
        cid: c.id,
        type: 'red',
        msg: `<strong>${c.name}</strong> <span>— check-in overdue! No contact in ${c.days} days (${(c.tier||'mid').toUpperCase()} SLA: ${CADENCE_THRESHOLDS[c.tier||'mid'].overdue}d)</span>`
      });
    } else if (cad.status === 'warn') {
      alerts.push({
        id: c.id+'-cadence',
        cid: c.id,
        type: 'amber',
        msg: `<strong>${c.name}</strong> <span>— check-in due soon (${c.days} days since contact)</span>`
      });
    }
  });
  return alerts;
}
// ─── SCORE FORM ─────────────────────────────────────────────
function rv(key, val) {
  document.getElementById('rv-' + key).textContent = val;
}
// Generic N/A toggle for logins, adoption, tickets, days
function toggleSignalNA(key) {
  const na = el('f-' + key + '-na').checked;
  const inp = el('f-' + key);
  inp.disabled = na; inp.style.opacity = na ? '.4' : '1';
  const rvEl = el('rv-' + key);
  if (rvEl) {
    if (na) { rvEl.textContent = 'N/A'; rvEl.style.color = 'var(--subtle)'; }
    else {
      rvEl.style.color = '';
      if (key === 'logins') rvEl.textContent = inp.value + ' days';
      else if (key === 'adoption') rvEl.textContent = inp.value + '%';
      else if (key === 'days') rvEl.textContent = inp.value + ' days';
    }
  }
}
function toggleNpsNA() {
  const na = el('f-nps-na').checked;
  const inp = el('f-nps');
  inp.disabled = na; inp.style.opacity = na ? '.4' : '1';
  el('rv-nps-label').textContent = na ? 'N/A' : npsDisplay(Number(inp.value));
  el('rv-nps-label').style.color = na ? 'var(--subtle)' : '';
}
function toggleCsatNA() {
  const na = el('f-csat-na').checked;
  const inp = el('f-csat');
  inp.disabled = na; inp.style.opacity = na ? '.4' : '1';
  el('rv-csat-label').textContent = na ? 'N/A' : csatDisplay(Number(inp.value));
  el('rv-csat-label').style.color = na ? 'var(--subtle)' : '';
}

// Gray out signals with zero weight in the selected scoring profile
function applyProfileSignalState() {
  var profName = el('f-profile') ? el('f-profile').value : '';
  var prof = profName ? profiles.find(function(p) { return p.name === profName; }) : null;
  var w = prof ? prof.weights : weights;
  var signalFields = {
    logins:  'f-logins',
    adoption:'f-adoption',
    tickets: 'f-tickets',
    nps:     'f-nps',
    csat:    'f-csat',
    days:    'f-days',
    growth:  'f-growth'
  };
  Object.keys(signalFields).forEach(function(key) {
    var fieldEl = el(signalFields[key]);
    if (!fieldEl) return;
    var wrapper = fieldEl.closest('.field');
    if (!wrapper) return;
    var isOff = !(w[key] > 0);
    wrapper.style.opacity = isOff ? '.35' : '';
    wrapper.style.pointerEvents = isOff ? 'none' : '';
    if (isOff) {
      wrapper.title = 'Weight is 0 in this profile — not used in scoring';
    } else {
      wrapper.title = '';
    }
  });
}

function getFormData() {
  return {
    name:     document.getElementById('f-name').value.trim(),
    contact_name:  (document.getElementById('f-contact-name')?.value || '').trim(),
    contact_email: (document.getElementById('f-contact-email')?.value || '').trim(),
    manager:  (()=>{ const nEl=document.getElementById('f-manager-new'); if(nEl&&nEl.style.display!=='none'&&nEl.value.trim()) return nEl.value.trim(); const sEl=document.getElementById('f-manager'); return (sEl&&sEl.value&&sEl.value!=='__add_new__') ? sEl.value : ''; })(),
    mrr:      parseFloat(document.getElementById('f-mrr').value)      || 0,
    arr:      parseFloat(document.getElementById('f-arr')?.value)     || 0,
    since:    document.getElementById('f-since')?.value               || '',
    tier:     document.getElementById('f-tier').value,
    lifecycle:document.getElementById('f-lifecycle').value,
    billing_interval: document.getElementById('f-billing')?.value || '',
    tags:     document.getElementById('f-tags').value.split(',').map(t=>t.trim()).filter(Boolean),
    logins:   el('f-logins-na').checked ? null : (parseInt(document.getElementById('f-logins').value) || 0),
    adoption: el('f-adoption-na').checked ? null : (parseInt(document.getElementById('f-adoption').value) || 0),
    tickets:  el('f-tickets-na').checked ? null : (parseInt(document.getElementById('f-tickets').value) || 0),
    nps:      el('f-nps-na').checked ? null : parseInt(el('f-nps').value),
    csat:     el('f-csat-na').checked ? null : parseInt(el('f-csat').value),
    days:     el('f-days').value !== '' ? parseInt(el('f-days').value) : null,
    renewal_date: document.getElementById('f-renewal-date')?.value || '',
    renewal:      (function() {
      const d = document.getElementById('f-renewal-date')?.value;
      if (!d) return 0;
      const ms = new Date(d) - new Date();
      return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24 * 30.44)));
    })(),
    growth:   document.getElementById('f-growth').value,
    note:     (document.getElementById('f-note')?.value || '').trim(),
    profile:  (document.getElementById('f-profile')?.value || '')
  };
}

function submitForm(e) {
  e.preventDefault();
  const data = getFormData();

  // ── Account limit check ───────────────────────────────────
  const editId = document.getElementById('score-form').dataset.editId;
  if (!editId) {
    // Only check limits for NEW customers, not re-scores
    const dupe = customers.find(c => c.name.toLowerCase() === data.name?.toLowerCase());
    if (!dupe) {
      const limit = getPlanLimit('accounts');
      if (limit !== Infinity && customers.length >= limit) {
        toast(`Account limit reached (${limit}). Upgrade your plan to add more.`, 'error');
        return;
      }
    }
  }

  // ── Duplicate name check ────────────────────────────────────
  if (!editId && data.name) {
    const dupe = customers.find(c => c.name.trim().toLowerCase() === data.name.trim().toLowerCase());
    if (dupe) {
      toast(`"${data.name}" already exists. Open their profile to re-score.`, 'error');
      return;
    }
  }

  // ── Validation ──────────────────────────────────────────────
  if (!data.name) { toast('Customer name is required', 'error'); return; }
  if (data.mrr < 0)       { toast('MRR cannot be negative', 'error'); return; }
  if (data.logins != null && (data.logins < 0 || data.logins > 30))   { toast('Logins must be between 0 and 30', 'error'); return; }
  if (data.adoption != null && (data.adoption < 0 || data.adoption > 100)){ toast('Adoption must be between 0% and 100%', 'error'); return; }
  if (data.tickets != null && data.tickets < 0)   { toast('Tickets cannot be negative', 'error'); return; }
  if (data.days != null && data.days < 0)          { toast('Days since contact cannot be negative', 'error'); return; }

  // Resolve weights: per-customer profile overrides global weights
  const matchedProfile = data.profile ? profiles.find(p => p.name === data.profile) : null;
  const resolvedWeights = matchedProfile ? matchedProfile.weights : weights;

  // Merge existing customer data for Signal Model factors
  const existing = editId ? customers.find(x => x.id === editId) : customers.find(x => x.name && x.name.toLowerCase() === (data.name||'').toLowerCase());
  const tempC = { ...data, history: existing?.history || [], lifecycle: existing?.lifecycle || data.lifecycle, tier: existing?.tier || data.tier, since: existing?.since || data.since, scoring_profile: data.profile || '', renewal_date: existing?.renewal_date || data.renewal_date, contact_name: existing?.contact_name || data.contact_name, next_touch: existing?.next_touch };
  const { score, signals } = scoreWithModel(tempC, resolvedWeights);
  const status = getStatus(score);
  const rec    = makeRec(score, data);
  const plays  = buildPlaybook(score, data);

  pendingResult = { data, score, signals, status, rec, plays };
  showResult(pendingResult);
}

function showResult({ data, score, signals, status, rec, plays }) {
  document.getElementById('result-placeholder').style.display = 'none';
  const card = document.getElementById('result-card');
  card.style.display = 'block';

  // Scroll to the result so the user sees the score immediately
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Score ring — animate via transition + rAF
  document.getElementById('score-num').textContent = score;
  const circ = 2 * Math.PI * 50;
  const fill = document.getElementById('ring-fill');
  fill.style.stroke          = STATUS_COLOR[status] || '#16a34a';
  fill.style.strokeDasharray = String(circ);
  fill.style.transition      = 'none';
  fill.style.strokeDashoffset = String(circ);            // start fully hidden
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fill.style.transition      = 'stroke-dashoffset .9s cubic-bezier(.4,0,.2,1), stroke .3s';
      fill.style.strokeDashoffset = String(circ - (score / 100) * circ);  // animate to score
    });
  });

  // Badge
  const badgeEl = document.getElementById('score-badge');
  badgeEl.className   = 'badge badge-' + (STATUS_CSS[status] || 'healthy');
  badgeEl.textContent = STATUS_LABEL[status] || 'Healthy';

  // Rec
  document.getElementById('score-rec').innerHTML = '<div class="rec-box__title">Health Assessment</div>' + rec;

  // Breakdown — resolve weights for the selected profile
  const bd = document.getElementById('breakdown-wrap');
  const profName = el('f-profile') ? el('f-profile').value : '';
  const matchedProf = profName ? profiles.find(p => p.name === profName) : null;
  const bw = matchedProf ? matchedProf.weights : weights;
  const signalDefs = [
    { key:'logins_n',   wkey:'logins',   label:'Login Frequency',    color:'var(--blue)' },
    { key:'adoption_n', wkey:'adoption', label:'Feature Adoption',   color:'var(--green)' },
    { key:'tickets_n',  wkey:'tickets',  label:'Support Health',     color:'var(--red)' },
    { key:'nps_n',      wkey:'nps',      label:'NPS (0–10)',         color:'var(--purple)' },
    { key:'csat_n',     wkey:'csat',     label:'CSAT (1–5)',         color:'#7c3aed' },
    { key:'days_n',     wkey:'days',     label:'Contact Recency',    color:'var(--teal)' },
    { key:'growth_n',   wkey:'growth',   label:'Growth Signal',      color:'var(--green)' }
  ];
  bd.innerHTML = signalDefs.map(s => {
    const off = !((bw[s.wkey] || 0) > 0);
    return `<div class="bd-row${off ? ' bd-row--off' : ''}">
      <div class="bd-label">${s.label}${off ? ' <span style="font-size:var(--fs-xs);color:var(--muted)">(off)</span>' : ''}</div>
      <div class="bd-bar"><div class="bd-fill" style="width:${off ? 0 : Math.round(signals[s.key])}%;background:${s.color}"></div></div>
      <div class="bd-score">${off ? '—' : Math.round(signals[s.key])}</div>
    </div>`;
  }).join('');

  // Playbook
  const pw = document.getElementById('playbook-wrap');
  const playTypeMap = { urgent:'U', engage:'E', coach:'C', adopt:'A', support:'S', expand:'X', renew:'R', ok:'OK' };
  const playClsMap  = { urgent:'play-urgent', engage:'play-engage', coach:'play-coach', adopt:'play-adopt', support:'play-support', expand:'play-expand', renew:'play-renew', ok:'play-ok' };
  pw.innerHTML = `<div class="playbook-title">Recommended Playbook</div>` +
    plays.map(p => `<div class="play-item"><div class="play-item__icon ${playClsMap[p.type]||''}">${playTypeMap[p.type]||'!'}</div><div class="play-item__text">${p.text}</div></div>`).join('');
}

// Store raw signals snapshot in history entry so we can diff later
function buildHistorySnapshot(data) {
  return {
    logins:           data.logins           ?? null,
    adoption:         data.adoption         ?? null,
    tickets:          data.tickets          ?? null,
    nps:              data.nps              ?? null,
    csat:             data.csat             ?? null,
    days:             data.days             ?? null,
    growth:           data.growth           ?? null,
    lifecycle:        data.lifecycle        ?? null,
    mrr:              data.mrr              ?? null,
    arr:              data.arr              ?? null,
    billing_interval: data.billing_interval ?? null,
  };
}

// Given two snapshots (current, previous), return array of change descriptions
function diffSnapshots(curr, prev) {
  if (!curr) return [];
  const parts = [];

  // Login frequency
  if (curr.logins != null) {
    if (!prev || prev.logins == null) {
      parts.push(`Login frequency: ${curr.logins}/mo`);
    } else if (curr.logins !== prev.logins) {
      const dir = curr.logins > prev.logins ? '↑' : '↓';
      parts.push(`Login frequency ${dir}: ${prev.logins}→${curr.logins}/mo`);
    }
  }

  // Feature adoption
  if (curr.adoption != null) {
    if (!prev || prev.adoption == null) {
      parts.push(`Adoption: ${curr.adoption}%`);
    } else if (curr.adoption !== prev.adoption) {
      const dir = curr.adoption > prev.adoption ? '↑' : '↓';
      parts.push(`Adoption ${dir}: ${prev.adoption}%→${curr.adoption}%`);
    }
  }

  // Support tickets
  if (curr.tickets != null) {
    if (!prev || prev.tickets == null) {
      parts.push(`Support tickets: ${curr.tickets}`);
    } else if (curr.tickets !== prev.tickets) {
      const dir = curr.tickets < prev.tickets ? '↑' : '↓'; // fewer = better
      parts.push(`Support tickets ${dir}: ${prev.tickets}→${curr.tickets}`);
    }
  }

  // NPS
  if (curr.nps != null) {
    if (!prev || prev.nps == null) {
      parts.push(`NPS: ${npsDisplay(curr.nps)}`);
    } else if (curr.nps !== prev.nps) {
      parts.push(`NPS: ${npsDisplay(prev.nps)}→${npsDisplay(curr.nps)}`);
    }
  }
  // CSAT
  if (curr.csat != null) {
    if (!prev || prev.csat == null) {
      parts.push(`CSAT: ${csatDisplay(curr.csat)}`);
    } else if (curr.csat !== prev.csat) {
      parts.push(`CSAT: ${csatDisplay(prev.csat)}→${csatDisplay(curr.csat)}`);
    }
  }

  // Days since contact
  if (curr.days != null) {
    if (!prev || prev.days == null) {
      parts.push(`Last contact: ${curr.days}d ago`);
    } else if (curr.days !== prev.days) {
      const dir = curr.days < prev.days ? '↑' : '↓'; // fewer days = better
      parts.push(`Last contact ${dir}: ${prev.days}d→${curr.days}d ago`);
    }
  }

  // Growth signal
  if (curr.growth != null) {
    if (!prev || prev.growth == null) {
      parts.push(`Growth: ${curr.growth}`);
    } else if (curr.growth !== prev.growth) {
      parts.push(`Growth changed: ${prev.growth}→${curr.growth}`);
    }
  }

  // Lifecycle stage
  if (curr.lifecycle != null) {
    if (!prev || prev.lifecycle == null) {
      parts.push(`Stage: ${curr.lifecycle}`);
    } else if (curr.lifecycle !== prev.lifecycle) {
      parts.push(`Stage changed: ${prev.lifecycle}→${curr.lifecycle}`);
    }
  }

  // MRR
  if (curr.mrr != null) {
    if (!prev || prev.mrr == null) {
      parts.push(`MRR: $${Number(curr.mrr).toLocaleString()}`);
    } else if (curr.mrr !== prev.mrr) {
      const dir = curr.mrr > prev.mrr ? '↑' : '↓';
      parts.push(`MRR ${dir}: $${Number(prev.mrr).toLocaleString()}→$${Number(curr.mrr).toLocaleString()}`);
    }
  }

  // ARR
  if (curr.arr != null) {
    if (!prev || prev.arr == null) {
      parts.push(`ARR: $${Number(curr.arr).toLocaleString()}`);
    } else if (curr.arr !== prev.arr) {
      const dir = curr.arr > prev.arr ? '↑' : '↓';
      parts.push(`ARR ${dir}: $${Number(prev.arr).toLocaleString()}→$${Number(curr.arr).toLocaleString()}`);
    }
  }

  // Billing interval
  if (curr.billing_interval) {
    if (!prev || !prev.billing_interval) {
      parts.push(`Billing: ${curr.billing_interval}`);
    } else if (curr.billing_interval !== prev.billing_interval) {
      parts.push(`Billing: ${prev.billing_interval}→${curr.billing_interval}`);
    }
  }

  return parts;
}

function saveScore() {
  if (!pendingResult) return;
  const { data, score, status } = pendingResult;

  // Duplicate detection
  const dupe = customers.find(c => c.name.toLowerCase() === data.name.toLowerCase());
  if (dupe) {
    confirmAction(
      `"${data.name}" already exists. Update their score with these new values?`,
      () => {
        dupe.score           = score;
        dupe.status          = status;
        dupe.contact_name    = data.contact_name || dupe.contact_name || '';
        dupe.contact_email   = data.contact_email || dupe.contact_email || '';
        dupe.logins          = data.logins;
        dupe.adoption        = data.adoption;
        dupe.tickets         = data.tickets;
        dupe.nps             = data.nps;
        dupe.csat            = data.csat;
        dupe.days            = data.days;
        dupe._baseDays       = data.days;
        dupe.renewal         = data.renewal;
        dupe.renewal_date    = data.renewal_date || '';
        dupe.growth          = data.growth;
        dupe.mrr             = data.mrr || (data.arr ? Math.round(data.arr / 12) : 0);
        dupe.arr             = data.arr || (data.mrr ? data.mrr * 12 : 0);
        dupe.since           = data.since || '';
        dupe.tier            = data.tier;
        dupe.lifecycle       = data.lifecycle;
        dupe.tags              = data.tags;
        dupe.billing_interval  = data.billing_interval || dupe.billing_interval || '';
        dupe.scoring_profile   = data.profile || '';
        applyAutoStage(dupe);
        if (data.note) {
          dupe.notes = dupe.notes || [];
          dupe.notes.unshift({ text: data.note, date: new Date().toISOString() });
        }
        dupe.history  = dupe.history || [];
        dupe.history.push({ score, date: new Date().toISOString(), signals: buildHistorySnapshot(data) });
        setLoading(true);
        save(dupe).then(() => { setLoading(false); toast('Score updated for ' + dupe.name, 'success'); })
                  .catch(() => { setLoading(false); toast('Updated locally — sync failed', 'warn'); });
        logAudit('customer_scored', dupe.id, dupe.name, { score, status, summary: `Re-scored → ${score}/100 (${status}), MRR: $${dupe.mrr}, Tier: ${dupe.tier}` });
        pendingResult = null;
        resetForm();
        nav(_returnToPage || 'customers');
        _returnToPage = '';
        if (_returnToDetail) { const rid = _returnToDetail; _returnToDetail = ''; setTimeout(() => openDetail(rid), 80); }
      }
    );
    return;
  }

  const cust = {
    id:              crypto.randomUUID(),
    name:            data.name,
    contact_name:    data.contact_name || '',
    contact_email:   data.contact_email || '',
    manager:         data.manager || '',
    scoring_profile: data.profile || '',
    mrr:             data.mrr || (data.arr ? Math.round(data.arr / 12) : 0),
    arr:             data.arr || (data.mrr ? data.mrr * 12 : 0),
    since:           data.since || '',
    tier:            data.tier,
    lifecycle:       data.lifecycle,
    tags:              data.tags,
    billing_interval:  data.billing_interval || '',
    logins:            data.logins,
    adoption:        data.adoption,
    tickets:         data.tickets,
    nps:             data.nps,
    csat:            data.csat,
    days:            data.days,
    _baseDays:       data.days,
    renewal:         data.renewal,
    renewal_date:    data.renewal_date || '',
    growth:          data.growth,
    score,
    status,
    notes:    data.note ? [{ text: data.note, date: new Date().toISOString() }] : [],
    history:  [{ score, date: new Date().toISOString(), signals: buildHistorySnapshot(data) }],
    sentiment: [],
    created:  new Date().toISOString()
  };
  applyAutoStage(cust);
  customers.unshift(cust);
  refreshMgrDropdown();
  setLoading(true);
  save(cust).then(() => {
    setLoading(false);
    toast('Saved: ' + cust.name, 'success');
  }).catch(() => {
    setLoading(false);
    toast('Saved locally — sync failed, check connection', 'warn');
  });
  logAudit('customer_created', cust.id, cust.name, { score, status, summary: `New customer — Score: ${score}/100 (${status}), MRR: $${cust.mrr}, Tier: ${cust.tier}, Lifecycle: ${cust.lifecycle}` });
  pendingResult = null;
  resetForm();
  nav(_returnToPage || 'customers');
  _returnToPage = '';
  if (_returnToDetail) { const rid = _returnToDetail; _returnToDetail = ''; setTimeout(() => openDetail(rid), 80); }
}

function saveDetailsOnly() {
  const editId = document.getElementById('score-form').dataset.editId;
  if (!editId) { toast('Save Details is only available when editing an existing customer', 'error'); return; }
  const c = customers.find(x => x.id === editId);
  if (!c) { toast('Customer not found', 'error'); return; }
  const data = getFormData();
  if (!data.name) { toast('Customer name is required', 'error'); return; }

  // Block duplicate names (different customer with same name)
  const nameConflict = customers.find(x => x.id !== editId && x.name.toLowerCase() === data.name.toLowerCase());
  if (nameConflict) {
    toast(`A customer named "${nameConflict.name}" already exists. Please use a different name.`, 'error');
    return;
  }

  c.name             = data.name;
  c.contact_name     = data.contact_name || '';
  c.contact_email    = data.contact_email || '';
  c.manager          = data.manager || c.manager || '';
  c.mrr              = data.mrr || (data.arr ? Math.round(data.arr / 12) : 0);
  c.arr              = data.arr || (data.mrr ? data.mrr * 12 : 0);
  c.since            = data.since || c.since || '';
  c.tier             = data.tier;
  c.lifecycle        = data.lifecycle;
  c.tags             = data.tags;
  c.billing_interval = data.billing_interval || c.billing_interval || '';
  c.scoring_profile  = data.profile || c.scoring_profile || '';
  c.renewal_date     = data.renewal_date || c.renewal_date || '';
  if (data.note) {
    c.notes = c.notes || [];
    c.notes.unshift({ text: data.note, date: new Date().toISOString() });
  }
  applyAutoStage(c);
  setLoading(true);
  save(c).then(() => {
    setLoading(false);
    toast('Details saved for ' + c.name, 'success');
  }).catch(() => {
    setLoading(false);
    toast('Saved locally — sync failed', 'warn');
  });
  logAudit('customer_updated', c.id, c.name, { summary: `Details updated (no re-score)` });
  resetForm();
  nav(_returnToPage || 'customers');
  _returnToPage = '';
  if (_returnToDetail) { const rid = _returnToDetail; _returnToDetail = ''; setTimeout(() => openDetail(rid), 80); }
}

function resetForm() {
  document.getElementById('score-form').reset();
  // Reset logins (active by default)
  el('f-logins-na').checked = false; el('f-logins').value = 10; el('f-logins').disabled = false; el('f-logins').style.opacity = '1';
  el('rv-logins').textContent = '10 days'; el('rv-logins').style.color = '';
  // Reset adoption (active by default)
  el('f-adoption-na').checked = false; el('f-adoption').value = 50; el('f-adoption').disabled = false; el('f-adoption').style.opacity = '1';
  el('rv-adoption').textContent = '50%'; el('rv-adoption').style.color = '';
  // Reset tickets (active by default)
  el('f-tickets-na').checked = false; el('f-tickets').value = 1; el('f-tickets').disabled = false; el('f-tickets').style.opacity = '1';
  // Reset days (read-only, auto-tracked)
  el('f-days').value = '';
  const daysDisp = el('rv-days-display');
  if (daysDisp) { daysDisp.textContent = 'Will track from first scheduled call'; daysDisp.style.color = 'var(--subtle)'; }
  // Reset NPS slider (default: 8, not N/A)
  el('f-nps-na').checked = false; el('f-nps').value = 8; el('f-nps').disabled = false; el('f-nps').style.opacity = '1';
  el('rv-nps-label').textContent = npsDisplay(8); el('rv-nps-label').style.color = '';
  // Reset CSAT slider (default: N/A)
  el('f-csat-na').checked = true; el('f-csat').value = 3; el('f-csat').disabled = true; el('f-csat').style.opacity = '.4';
  el('rv-csat-label').textContent = 'N/A'; el('rv-csat-label').style.color = 'var(--subtle)';
  document.getElementById('result-card').style.display        = 'none';
  document.getElementById('result-placeholder').style.display = 'block';
  document.getElementById('form-title').textContent = 'Score a Customer';
  pendingResult = null;
  document.getElementById('score-form').dataset.editId = '';
  if (el('save-details-wrap')) el('save-details-wrap').style.display = 'none';
  applyProfileSignalState();
}

function printReport() {
  if (!pendingResult) return;
  const { data, score, status, rec, plays } = pendingResult;
  const pa = document.getElementById('print-area');
  pa.style.display = 'block';
  pa.innerHTML = buildPrintHTML(data.name, score, status, rec, plays, data);
  window.print();
  setTimeout(() => { pa.style.display = 'none'; pa.innerHTML = ''; }, 1000);
}

function printCustomerReport() {
  if (!detailId) return;
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  logAudit('report_printed', c.id, c.name, { summary: `Report printed — Score: ${c.score}, Status: ${c.status}` });
  const rec   = makeRec(c.score, c);
  const plays = buildPlaybook(c.score, c);
  const pa    = document.getElementById('print-area');
  pa.style.display = 'block';
  pa.innerHTML = buildPrintHTML(c.name, c.score, c.status, rec, plays, c);
  window.print();
  setTimeout(() => { pa.style.display = 'none'; pa.innerHTML = ''; }, 1000);
}

function buildPrintHTML(name, score, status, rec, plays, data) {
  const labels = STATUS_LABEL;
  const colors = STATUS_COLOR;
  return `
    <style>
      body{font-family:system-ui,sans-serif;color:#0f172a;padding:32px;max-width:800px;margin:0 auto}
      h1{font-size:1.6rem;font-weight:800;margin-bottom:4px}
      h2{font-size:1.1rem;font-weight:700;margin:20px 0 8px}
      .score-big{font-size:4rem;font-weight:900;color:${colors[status]};line-height:1}
      .badge{display:inline-block;background:${colors[status]}22;color:${colors[status]};padding:4px 14px;border-radius:100px;font-weight:700;font-size:var(--fs-md);border:1.5px solid ${colors[status]}55}
      .rec{background:#f1f5f9;border-left:4px solid ${colors[status]};padding:10px 14px;border-radius:4px;font-size:var(--fs-md);line-height:1.6;margin-bottom:16px}
      .play{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:var(--fs-md)}
      table{width:100%;border-collapse:collapse;font-size:var(--fs-base);margin-top:8px}
      th{text-align:left;color:#64748b;font-size:var(--fs-sm);text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid #e2e8f0;padding:5px 8px}
      td{padding:6px 8px;border-bottom:1px solid #f1f5f9}
      .footer-p{margin-top:32px;font-size:var(--fs-sm);color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
    </style>
    <h1>IQcadence Health Report — ${name}</h1>
    <p style="color:#64748b;font-size:var(--fs-base)">Generated ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} · IQcadence CS Health Score</p>
    <div style="margin:16px 0;display:flex;align-items:center;gap:20px;flex-wrap:wrap">
      <div class="score-big">${score}</div>
      <div>
        <div class="badge">${labels[status]}</div>
        <div style="margin-top:6px;font-size:var(--fs-base);color:#64748b">MRR: $${(data.mrr||0).toLocaleString()} · Tier: ${(data.tier||'').toUpperCase()} · Stage: ${data.lifecycle||'—'}</div>
      </div>
    </div>
    <div class="rec"><strong>Health Assessment:</strong> ${rec.replace(/<[^>]+>/g,'')}</div>
    <h2>Signal Inputs</h2>
    <table>
      <tr><th>Signal</th><th>Value</th></tr>
      <tr><td>Login Frequency (30d)</td><td>${data.logins != null ? data.logins + ' days' : 'N/A'}</td></tr>
      <tr><td>Feature Adoption</td><td>${data.adoption != null ? data.adoption + '%' : 'N/A'}</td></tr>
      <tr><td>Open Support Tickets</td><td>${data.tickets != null ? data.tickets : 'N/A'}</td></tr>
      <tr><td>NPS</td><td>${npsDisplay(data.nps)}</td></tr>
      <tr><td>CSAT</td><td>${csatDisplay(data.csat)}</td></tr>
      <tr><td>Days Since Contact</td><td>${data.days != null ? data.days + ' days' : 'N/A'}</td></tr>
      <tr><td>Growth Signal</td><td>${data.growth}</td></tr>
      <tr><td>Renewal Date</td><td>${data.renewal_date ? new Date(data.renewal_date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) + ' (' + data.renewal + ' mo)' : '—'}</td></tr>
    </table>
    <h2>Recommended Playbook</h2>
    ${plays.map(p=>`<div class="play">${p.icon} ${p.text.replace(/<[^>]+>/g,'')}</div>`).join('')}
    <p class="footer-p">Built with CS Health Score by IQcadence · All data is private and stored locally</p>
  `;
}

// ─── SENTIMENT TRACKING ──────────────────────────────────────
let pendingSentiment = null; // 'positive' | 'neutral' | 'negative'

function setSentiment(val) {
  pendingSentiment = val;
  ['pos','neu','neg'].forEach(k => el('sent-'+k)?.classList.remove('active'));
  const map = { positive:'pos', neutral:'neu', negative:'neg' };
  el('sent-'+map[val])?.classList.add('active');
}

function logSentiment() {
  if (!pendingSentiment) { toast('Select a sentiment first', 'error'); return; }
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const note = el('sent-note')?.value.trim() || '';
  c.sentiment = c.sentiment || [];
  c.sentiment.unshift({ val: pendingSentiment, note, date: new Date().toISOString() });
  pendingSentiment = null;
  ['pos','neu','neg'].forEach(k => el('sent-'+k)?.classList.remove('active'));
  if (el('sent-note')) el('sent-note').value = '';
  renderDetailSentiment();
  logAudit('sentiment_logged', c.id, c.name, { summary: `Sentiment: ${c.sentiment[0].val}${note ? ' — "' + note.substring(0, 80) + '"' : ''}` });
  save(c).then(() => toast('Sentiment logged', 'success'))
         .catch(e => { console.error('Sentiment save failed:', e); toast('Saved locally — sync failed', 'warn'); });
}

function renderDetailSentiment() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  // Parse sentiment the same way as latestSentiment() to avoid mismatches
  let logs;
  try { logs = Array.isArray(c.sentiment) ? c.sentiment : (typeof c.sentiment === 'string' ? JSON.parse(c.sentiment) : []); }
  catch(e) { logs = []; }
  // Sort newest-first by date (mixed unshift/push order can't be trusted)
  logs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const icons = { positive: appIcon('sentPositive',18), neutral: appIcon('sentNeutral',18), negative: appIcon('sentNegative',18) };
  const labels = { positive:'Positive', neutral:'Neutral', negative:'Negative' };

  const sentWrap = el('dm-sentiment-list');
  if (!logs.length) {
    sentWrap.innerHTML = '<p style="font-size:var(--fs-base);color:var(--muted)">No sentiment logs yet. Log one above.</p>';
    return;
  }
  const pg = _pagGet('sentLog');
  const slice = logs.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE);
  const pagNav = _pagHTML(logs.length, 'sentLog', 'renderDetailSentiment');
  sentWrap.innerHTML = pagNav + slice.map((s,si) => {
    const idx = pg * PAGE_SIZE + si; // original index for delete
    return `<div class="sent-log">
          <div class="sent-log__icon">${icons[s.val]||appIcon('sentNeutral',18)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:var(--fs-base)">${labels[s.val]||s.val}</div>
            ${s.note ? `<div style="font-size:var(--fs-sm);color:var(--muted);margin-top:1px">${escHtml(s.note)}</div>` : ''}
          </div>
          <div class="sent-log__meta">${fmtDate(s.date)}</div>
          <button class="btn btn-xs btn-danger" style="margin-left:6px" onclick="deleteSentiment(${idx})">✕</button>
        </div>`;
  }).join('') + pagNav;
}

function deleteSentiment(idx) {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  // Ensure sentiment is an array before splicing
  if (!Array.isArray(c.sentiment)) {
    try { c.sentiment = typeof c.sentiment === 'string' ? JSON.parse(c.sentiment) : []; }
    catch(e) { c.sentiment = []; }
  }
  c.sentiment.splice(idx,1);
  renderDetailSentiment();
  save(c).catch(e => console.error('Sentiment delete sync failed:', e));
}

// Latest sentiment for a customer
function latestSentiment(c) {
  try {
    const s = Array.isArray(c.sentiment) ? c.sentiment : (typeof c.sentiment === 'string' ? JSON.parse(c.sentiment) : []);
    if (!s.length) return null;
    // Find the entry with the most recent date (don't trust array order — unshift vs push)
    let best = s[0];
    for (let i = 1; i < s.length; i++) {
      if (s[i].date && (!best.date || s[i].date > best.date)) best = s[i];
    }
    return best;
  } catch(e) { return null; }
}

// ─── CUSTOMER DETAIL MODAL ───────────────────────────────────
function openDetail(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  detailId = id;
  if (typeof _wtCompleteIfActive === 'function') _wtCompleteIfActive('customer-deepdive');
  if (typeof _wtHighlightQBRButton === 'function') _wtHighlightQBRButton();
  _pagState.sentLog = 0;
  _pagState.scoreHist = 0;

  el('dm-name').textContent = c.name;
  el('dm-sub').innerHTML = `
    ${badgeHTML(c.status)} ${lifecycleBadge(c.lifecycle)}
    <span style="margin-left:6px;color:var(--muted)">Score: <strong>${c.score}</strong></span>
    ${c.mrr ? `<span style="margin-left:6px;color:var(--muted)">MRR: <strong>$${fmtNum(c.mrr)}</strong></span>` : ''}
  `;

  // Gate QBR button
  const qbrBtn = el('dm-qbr-btn');
  if (qbrBtn) {
    if (hasFeature('qbr_prep')) { qbrBtn.style.display = ''; qbrBtn.disabled = false; }
    else { qbrBtn.style.display = 'none'; }
  }

  // Alert count badge on Alerts tab
  const alertTab = el('dt-alerts');
  if (alertTab) {
    const cnt = buildAlerts().filter(a => a.cid === id && !isDismissed(a.id) && !isSnoozed(a.id)).length;
    alertTab.textContent = cnt > 0 ? `Alerts (${cnt})` : 'Alerts';
  }

  dtab('overview');
  openModal('detail-modal');
}

function dtab(which) {
  ['overview','alerts','playbook','notes','sentiment','history'].forEach(t => {
    el('dt-'+t)?.classList.toggle('active', t===which);
    el('dp-'+t)?.classList.toggle('active', t===which);
  });
  if (which === 'overview')  renderDetailOverview();
  if (which === 'alerts')    renderDetailAlerts();
  if (which === 'playbook')  { if (hasFeature('playbooks')) renderDetailPlaybook(); else el('dm-playbook').innerHTML = upgradeHTML('playbooks'); }
  if (which === 'notes')     renderDetailNotes();
  if (which === 'sentiment') { if (hasFeature('sentiment')) renderDetailSentiment(); else el('dm-sentiment-list').innerHTML = upgradeHTML('sentiment'); }
  if (which === 'history')   renderDetailHistory();
}

function renderDetailAlerts() {
  const wrap = el('dm-alerts');
  if (!wrap) return;
  const c = customers.find(x => x.id === detailId);
  if (!c) { wrap.innerHTML = ''; return; }

  // Build all alerts and filter to this customer
  const all = buildAlerts();
  const mine = all.filter(a => a.cid === c.id);
  const active = mine.filter(a => !isDismissed(a.id) && !isSnoozed(a.id));
  const snzd   = mine.filter(a => isSnoozed(a.id));
  const dism   = mine.filter(a => isDismissed(a.id) && !isSnoozed(a.id));

  if (!mine.length) {
    wrap.innerHTML = `<div class="empty-st" style="padding:24px"><div class="ei" style="color:var(--green)">${appIcon('checkCircle',32)}</div><h3>All clear!</h3><p>No active alerts for this customer.</p></div>`;
    return;
  }

  const sevColor = { red:'var(--red)', amber:'var(--amber)', blue:'var(--blue)', green:'var(--green)' };

  function alertRow(a, state) {
    const def = ALERT_CATS[a.cat] || ALERT_CATS.health;
    const color = sevColor[a.type] || 'var(--muted)';
    const opacity = state === 'dismissed' ? 'opacity:.45;' : state === 'snoozed' ? 'opacity:.6;' : '';
    const badge = state === 'snoozed'
      ? `<span style="font-size:var(--fs-xs);color:var(--amber);font-weight:600;margin-left:auto;white-space:nowrap">⏸ Snoozed</span>`
      : state === 'dismissed'
      ? `<span style="font-size:var(--fs-xs);color:var(--muted);font-weight:600;margin-left:auto;white-space:nowrap">Dismissed</span>`
      : '';
    const actions = state === 'snoozed'
      ? `<button class="btn btn-xs btn-ghost" onclick="unsnooze('${escHtml(a.id)}');renderDetailAlerts()">Wake</button>`
      : state !== 'dismissed'
      ? `<button class="btn btn-xs btn-ghost" onclick="snoozeAlert('${escHtml(a.id)}',7);renderDetailAlerts()">Snooze 7d</button>
         <button class="btn btn-xs btn-ghost" onclick="dismissAlert('${escHtml(a.id)}');renderDetailAlerts()">Dismiss</button>
`
      : '';
    return `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:var(--r);border:1.5px solid ${color}22;background:${color}08;${opacity}">
        <div style="color:${color};flex-shrink:0;margin-top:2px">${def.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:var(--fs-base);font-weight:600;color:var(--text)">${def.label}</div>
          <div style="font-size:var(--fs-base);color:var(--subtle);margin-top:2px">${a.msg.replace(/<strong>.*?<\/strong>\s*/, '')}</div>
          ${a.sub ? `<div style="font-size:var(--fs-sm);color:var(--muted);margin-top:3px">${escHtml(a.sub)}</div>` : ''}
        </div>
        ${badge}
        <div style="display:flex;gap:4px;flex-shrink:0;align-items:center">${actions}</div>
      </div>`;
  }

  let html = '';
  if (active.length) {
    html += `<div style="font-size:var(--fs-sm);font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Active (${active.length})</div>`;
    html += `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">${active.map(a => alertRow(a, 'active')).join('')}</div>`;
  }
  if (snzd.length) {
    html += `<div style="font-size:var(--fs-sm);font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Snoozed (${snzd.length})</div>`;
    html += `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">${snzd.map(a => alertRow(a, 'snoozed')).join('')}</div>`;
  }
  if (dism.length) {
    html += `<div style="font-size:var(--fs-sm);font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Dismissed (${dism.length})</div>`;
    html += `<div style="display:flex;flex-direction:column;gap:6px">${dism.map(a => alertRow(a, 'dismissed')).join('')}</div>`;
  }
  wrap.innerHTML = html;
}

function renderDetailOverview() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const { signals } = scoreWithModel(c);
  const rec    = makeRec(c.score, c);
  const delta  = scoreDelta(c);
  const cad    = getCadenceStatus(c);
  const sent   = latestSentiment(c);
  const nba    = buildNextBestAction(c);
  const sentIcon = sent ? ({ positive: appIcon('sentPositive',20), neutral: appIcon('sentNeutral',20), negative: appIcon('sentNegative',20) }[sent.val]||'') : null;
  // Map nba.level to urgency color
  const nbaColors = {
    urgent:'var(--red)', warn:'var(--amber)', expand:'var(--green)',
    renew:'var(--teal)', ok:'var(--blue)'
  };
  const nbaColor = nbaColors[nba.level] || 'var(--blue)';

  el('dm-overview').innerHTML = `
    <!-- Next Best Action banner -->
    <div class="nba-banner" style="background:${nbaColor}0f;border:1.5px solid ${nbaColor}33">
      <div class="nba-banner__title" style="color:${nbaColor}">Next Best Action</div>
      <div class="nba-banner__action">${nba.action}</div>
      <div class="nba-banner__talk">${nba.talk}</div>
    </div>
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;flex-wrap:wrap">
      ${buildRingHTML(c.score, c.status)}
      <div style="flex:1;min-width:0">
        <div style="font-size:2rem;font-weight:800;line-height:1;letter-spacing:-.03em">${c.score}<span style="font-size:var(--fs-lg);font-weight:500;color:var(--muted)"> / 100</span></div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${badgeHTML(c.status)}
          ${momentumHTML(c)}
          ${deltaHTML(delta)}
        </div>
        ${c.scoring_profile ? `<div style="margin-top:6px;font-size:var(--fs-sm);color:var(--muted)">Profile: <strong style="color:var(--text)">${escHtml(c.scoring_profile)}</strong></div>` : ''}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin-bottom:12px;padding:0;background:var(--bg);border-radius:var(--r);border:1px solid var(--border);overflow:hidden">
      <div style="padding:8px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border)">
        <div style="font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--subtle);margin-bottom:2px">Manager</div>
        <div style="font-weight:500;font-size:var(--fs-base)">${escHtml(c.manager||'—')}</div>
      </div>
      <div style="padding:8px 12px;border-bottom:1px solid var(--border);border-right:1px solid var(--border)">
        <div style="font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--subtle);margin-bottom:2px">Tier</div>
        <div><span class="tier-pill-${c.tier==='enterprise'?'ent':c.tier||'mid'}" style="font-size:var(--fs-sm);padding:1px 7px;border-radius:4px;font-weight:600">${c.tier==='enterprise'?'Enterprise':c.tier==='smb'?'SMB':'Mid-Market'}</span></div>
      </div>
      <div style="padding:8px 12px;border-bottom:1px solid var(--border)">
        <div style="font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--subtle);margin-bottom:2px">Lifecycle</div>
        <div>${lifecycleBadge(c.lifecycle)}</div>
      </div>
      ${(c.contact_name||c.contact_email) ? `<div style="padding:8px 12px;grid-column:1/-1;border-bottom:1px solid var(--border);display:flex;gap:16px">
        <div><div style="font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--subtle);margin-bottom:2px">Contact</div><div style="font-weight:500;font-size:var(--fs-base)">${escHtml(c.contact_name||'—')}</div></div>
        <div><div style="font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--subtle);margin-bottom:2px">Email</div><div style="font-size:var(--fs-base)">${c.contact_email ? `<a href="mailto:${escHtml(c.contact_email)}" style="color:var(--blue);text-decoration:none;font-weight:500">${escHtml(c.contact_email)}</a>` : '—'}</div></div>
      </div>` : ''}
      <div style="padding:8px 12px;border-right:1px solid var(--border)${(c.tags&&c.tags.length)||c.external_id||c.stripe_customer_id?';border-bottom:1px solid var(--border)':''}">
        <div style="font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--subtle);margin-bottom:2px">MRR</div>
        <div style="font-weight:600;font-size:var(--fs-base)">${c.mrr ? '$'+fmtNum(c.mrr) : '—'}</div>
      </div>
      <div style="padding:8px 12px;border-right:1px solid var(--border)${(c.tags&&c.tags.length)||c.external_id||c.stripe_customer_id?';border-bottom:1px solid var(--border)':''}">
        <div style="font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--subtle);margin-bottom:2px">ARR</div>
        <div style="font-weight:600;font-size:var(--fs-base)">${c.arr ? '$'+fmtNum(c.arr) : '—'}</div>
      </div>
      <div style="padding:8px 12px${(c.tags&&c.tags.length)||c.external_id||c.stripe_customer_id?';border-bottom:1px solid var(--border)':''}">
        <div style="font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--subtle);margin-bottom:2px">Billing</div>
        <div style="font-weight:500;font-size:var(--fs-base)">${c.billing_interval ? c.billing_interval.charAt(0).toUpperCase()+c.billing_interval.slice(1) : '—'}</div>
      </div>
      ${(c.tags&&c.tags.length) ? `<div style="padding:8px 12px;grid-column:1/-1${c.external_id||c.stripe_customer_id?';border-bottom:1px solid var(--border)':''}"><div style="font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--subtle);margin-bottom:3px">Tags</div><div style="display:flex;gap:4px;flex-wrap:wrap">${c.tags.map(t=>`<span style="font-size:var(--fs-xs);background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1px 6px">${escHtml(t)}</span>`).join('')}</div></div>` : ''}
      ${c.external_id||c.stripe_customer_id ? `<div style="padding:8px 12px;grid-column:1/-1;display:flex;gap:16px">${c.external_id?`<div><span style="font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--subtle)">External ID</span> <span style="font-size:var(--fs-sm);color:var(--muted);margin-left:4px">${escHtml(c.external_id)}</span></div>`:''}${c.stripe_customer_id?`<div><span style="font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--subtle)">Stripe</span> <span style="font-size:var(--fs-sm);color:var(--muted);margin-left:4px">${escHtml(c.stripe_customer_id)} <a href="https://dashboard.stripe.com/customers/${encodeURIComponent(c.stripe_customer_id)}" target="_blank" rel="noopener" style="color:var(--blue)" title="Open in Stripe">↗</a></span></div>`:''}</div>` : ''}
    </div>
    <!-- Signals row: tickets + last contact + next touch + renewal + sentiment -->
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px;padding:10px 12px;background:var(--bg);border-radius:var(--r);border:1px solid var(--border)">
      <div>
        <div class="sig-label">Open Tickets</div>
        <span style="font-size:var(--fs-base);font-weight:600${(c.tickets||0) >= 3 ? ';color:#dc2626' : (c.tickets||0) >= 1 ? ';color:#d97706' : ''}">${c.tickets || 0}</span>
      </div>
      <div>
        <div class="sig-label">Last Contact</div>
        ${(()=>{
          if (c.last_contact_date) {
            const [y,m,d] = c.last_contact_date.split('-').map(Number);
            const lcd = new Date(y, m-1, d); // local date, no timezone shift
            const daysAgo = Math.max(0, Math.floor((Date.now() - lcd.getTime()) / 86400000));
            return `<span style="font-size:var(--fs-base);font-weight:600">${lcd.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span> <span style="font-size:var(--fs-sm);color:var(--muted)">(${daysAgo}d ago)</span>`;
          }
          if (c.days != null) return `<span style="font-size:var(--fs-base);font-weight:600">${c.days}d ago</span>`;
          return '<span style="font-size:var(--fs-sm);color:var(--muted)">—</span>';
        })()}
      </div>
      <div>
        <div class="sig-label">Next Touch</div>
        ${(()=>{
          if (!c.next_touch) return '<span style="font-size:var(--fs-sm);color:var(--muted)">Not scheduled</span>';
          const ntDays = Math.round((new Date(c.next_touch) - new Date()) / 86400000);
          const tDisp = c.next_touch_time ? ' at ' + fmtTime12(c.next_touch_time) : '';
          if (ntDays < 0)  return `<span class="nt-badge nt-overdue">Overdue ${Math.abs(ntDays)}d${tDisp}</span>`;
          if (ntDays === 0) return `<span class="nt-badge nt-today">Today${tDisp}</span>`;
          return `<span class="nt-badge nt-ok">in ${ntDays}d${tDisp}</span>`;
        })()}
      </div>
      <div>
        <div class="sig-label">Renewal</div>
        ${(()=>{
          if (c.renewal_date) {
            const d = new Date(c.renewal_date);
            const today = new Date(); today.setHours(0,0,0,0);
            const days = Math.round((d - today) / 86400000);
            const dateStr = d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
            const color = days <= 0 ? '#dc2626' : days <= 30 ? '#ea580c' : days <= 90 ? '#d97706' : 'var(--muted)';
            const label = days < 0 ? 'Overdue' : days === 0 ? 'Today' : `${days}d left`;
            return `<span style="font-weight:700;color:${color}">${label}</span> <span style="font-size:var(--fs-sm);color:var(--muted);margin-left:4px">${dateStr}</span>`;
          }
          if (c.renewal != null && c.renewal > 0) return urgencyHTML(c) + ` <span style="font-size:var(--fs-sm);color:var(--muted);margin-left:4px">(${c.renewal}mo)</span>`;
          return '<span style="font-size:var(--fs-sm);color:var(--muted)">—</span>';
        })()}
      </div>
      <div>
        <div class="sig-label">Last Vibe</div>
        ${sentIcon ? `<span style="font-size:var(--fs-md)">${sentIcon}</span> <span style="font-size:var(--fs-sm);color:var(--muted)">${fmtDate(sent.date)}</span>` : '<span style="font-size:var(--fs-sm);color:var(--muted)">—</span>'}
      </div>
    </div>
    <div class="rec-box" style="margin-bottom:14px"><div class="rec-box__title">Health Assessment</div>${rec}</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;padding:10px 12px;background:var(--bg);border-radius:var(--r);border:1px solid var(--border);flex-wrap:wrap">
      <span class="di-label" style="margin:0;white-space:nowrap">Schedule Next Touch</span>
      <input type="date" id="di-next-touch" class="di-input" value="${c.next_touch||''}" style="width:140px" />
      <input type="time" id="di-next-touch-time" class="di-input" value="${c.next_touch_time||''}" style="width:100px" />
      <button class="btn btn-primary btn-sm" onclick="saveNextTouch()" style="gap:4px">${appIcon('save',14)} Save</button>
    </div>
    <div class="bd-title">Signal Breakdown</div>
    ${buildBreakdownHTML(signals, c)}
    ${buildSignalModelInsightsHTML(c)}
  `;
}

function buildSignalModelInsightsHTML(c) {
  if (!c._signalModel || !c._signalModel.enabled || !c._signalModel.factors.length) return '';
  var sm = c._signalModel;
  var adjColor = sm.totalAdj >= 0 ? 'var(--green)' : 'var(--red)';
  var adjSign = sm.totalAdj >= 0 ? '+' : '';
  var catIcons = { engagement: appIcon('chartBar',13), revenue: appIcon('trendUp',13), relationship: appIcon('users',13), support: appIcon('clipboard',13), lifecycle: appIcon('calendar',13), compound: appIcon('sparkle',13) };
  var factorRows = sm.factors.sort(function(a,b){ return a.adj - b.adj; }).map(function(f) {
    var c2 = f.adj >= 0 ? 'var(--green)' : 'var(--red)';
    var sign = f.adj >= 0 ? '+' : '';
    return '<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">' +
      '<span style="color:#0f766e;flex-shrink:0;margin-top:2px">' + (catIcons[f.category] || '') + '</span>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:600;font-size:var(--fs-base)">' + f.name +
          ' <span style="font-weight:700;color:' + c2 + ';margin-left:4px">' + sign + f.adj + '</span></div>' +
        '<div style="font-size:var(--fs-sm);color:var(--muted);margin-top:1px">' + f.reason + '</div>' +
      '</div></div>';
  }).join('');
  return '<div style="margin-top:14px">' +
    '<div class="bd-title" style="display:flex;align-items:center;gap:8px">' +
      appIcon('sparkle',16) + ' Signal Model Insights' +
      '<span style="margin-left:auto;font-size:var(--fs-sm);font-weight:700;color:' + adjColor + '">Net: ' + adjSign + sm.totalAdj + ' pts</span>' +
    '</div>' +
    '<div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:8px">' +
      'Base: ' + sm.baseScore + ' \u2192 Adjusted: ' + sm.adjustedScore +
      ' (' + sm.sensitivity + ', ' + sm.factors.length + ' factor' + (sm.factors.length !== 1 ? 's' : '') + ' fired)' +
    '</div>' + factorRows + '</div>';
}

async function saveNextTouch() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;

  const ntInput = document.getElementById('di-next-touch');
  if (!ntInput) return;

  const newNt = ntInput.value || '';
  const oldNt = c.next_touch || '';
  const timeInput = document.getElementById('di-next-touch-time');
  const newTime = timeInput ? timeInput.value || '' : '';

  // Archive old next_touch only if it's today or past (actually happened)
  // Future scheduled calls that get rescheduled are just replaced
  if (oldNt && oldNt !== newNt) {
    const oldDate = new Date(oldNt);
    const today = new Date(); today.setHours(0,0,0,0);
    if (oldDate <= today) {
      if (!c.touch_history) c.touch_history = [];
      c.touch_history.push({ date: oldNt, status: 'completed', time: c.next_touch_time || '' });
      c.last_contact_date = oldNt;
      const daysSince = Math.max(0, Math.floor((Date.now() - oldDate.getTime()) / 86400000));
      c.days = daysSince;
      c._baseDays = daysSince;
    }
  }
  c.next_touch = newNt;
  c.next_touch_time = newNt ? newTime : '';

  /* Recalculate score — days may have changed from archival */
  const { score: newSc } = scoreWithModel(c);
  if (newSc !== c.score) {
    c.score = newSc;
    c.status = getStatus(newSc);
    applyAutoStage(c);
  }

  try {
    await save(c);
    renderDetailOverview();
    el('dm-sub').innerHTML = `
      ${badgeHTML(c.status)} ${lifecycleBadge(c.lifecycle)}
      <span style="margin-left:6px;color:var(--muted)">Score: <strong>${c.score}</strong></span>
      ${c.mrr ? `<span style="margin-left:6px;color:var(--muted)">MRR: <strong>$${fmtNum(c.mrr)}</strong></span>` : ''}
    `;
    refreshCurrentPage();
    toast('Next touch saved', 'success');
  } catch (err) {
    console.error('Save failed:', err);
    toast('Save failed — ' + (err.message || 'unknown error'), 'error');
  }
}

function buildRingHTML(score, status) {
  const col = STATUS_COLOR[status] || '#16a34a';
  const circ   = 2 * Math.PI * 34;
  const offset = circ - (score/100)*circ;
  return `
    <div style="position:relative;width:90px;height:90px;flex-shrink:0">
      <svg viewBox="0 0 90 90" width="90" height="90" style="transform:rotate(-90deg)">
        <circle cx="45" cy="45" r="34" fill="none" stroke="var(--border)" stroke-width="8"/>
        <circle cx="45" cy="45" r="34" fill="none" stroke="${col}" stroke-width="8"
          stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
      </svg>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:800">${score}</div>
    </div>`;
}

function buildBreakdownHTML(signals, c) {
  const w = c ? getActiveWeights(c) : weights;
  const total = (w.logins + w.adoption + w.tickets + (w.nps||0) + (w.csat||0) + w.days + w.growth) || 100;
  const defs = [
    { key:'logins_n',   label:'Login Frequency', color:'var(--blue)',   weight:w.logins,   raw: c ? (c.logins != null ? `${c.logins} logins/mo` : 'N/A')  : '' },
    { key:'adoption_n', label:'Feature Adoption', color:'var(--green)',  weight:w.adoption, raw: c ? (c.adoption != null ? `${c.adoption}% adopted` : 'N/A')  : '' },
    { key:'tickets_n',  label:'Support Health',   color:'var(--red)',    weight:w.tickets,  raw: c ? (c.tickets != null ? `${c.tickets} tickets` : 'N/A')    : '' },
    { key:'nps_n',      label:'NPS (0–10)',       color:'var(--purple)', weight:w.nps||0,   raw: c ? npsDisplay(c.nps)         : '' },
    { key:'csat_n',     label:'CSAT (1–5)',       color:'#7c3aed',      weight:w.csat||0,  raw: c ? csatDisplay(c.csat)        : '' },
    { key:'days_n',     label:'Contact Recency',  color:'var(--teal)',   weight:w.days,     raw: c ? (c.days != null ? `${c.days}d ago` : 'N/A')          : '' },
    { key:'growth_n',   label:'Growth Signal',    color:'var(--green)',  weight:w.growth,   raw: c ? c.growth                  : '' }
  ];
  return defs.map(d => {
    const off = !(d.weight > 0);
    return `<div class="bd-row${off ? ' bd-row--off' : ''}">
      <div class="bd-label">${d.label}${off ? ' <span style="font-size:var(--fs-xs);color:var(--muted)">(off)</span>' : ''}</div>
      <div class="bd-weight">${off ? '—' : Math.round((d.weight / total) * 100) + '%'}</div>
      <div class="bd-bar"><div class="bd-fill" style="width:${off ? 0 : Math.round(signals[d.key])}%;background:${d.color}"></div></div>
      <div class="bd-score">${off ? '—' : Math.round(signals[d.key])}</div>
      ${d.raw ? `<div class="bd-raw">${d.raw}</div>` : ''}
    </div>`;
  }).join('');
}

/* stable key for a play — type + bold title (survives index shifts) */
function playKey(p) {
  const t = (p.text.match(/<strong>([^<]+)</) || [])[1] || '';
  return p.type + '|' + t.replace(/:?\s*$/, '');
}

function renderDetailPlaybook() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const plays = buildPlaybook(c.score, c);
  const playTypeMap2 = { urgent:'U', engage:'E', coach:'C', adopt:'A', support:'S', expand:'X', renew:'R', ok:'OK' };
  const playClsMap2  = { urgent:'play-urgent', engage:'play-engage', coach:'play-coach', adopt:'play-adopt', support:'play-support', expand:'play-expand', renew:'play-renew', ok:'play-ok' };

  const RESET_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days
  const now = Date.now();

  /* ── Auto-clear: migrate old index-based & boolean checks, prune stale, 30d reset ── */
  let checks = c.playbook_checks || {};
  let dirty = false;

  // Migrate old numeric-index checks → key-based
  const numKeys = Object.keys(checks).filter(k => /^\d+$/.test(k));
  if (numKeys.length) {
    const migrated = {};
    Object.keys(checks).forEach(k => { if (!/^\d+$/.test(k)) migrated[k] = checks[k]; });
    numKeys.forEach(k => { const idx = +k; if (plays[idx]) migrated[playKey(plays[idx])] = now; });
    checks = migrated;
    c.playbook_checks = checks;
    dirty = true;
  }

  // Migrate old boolean `true` values → timestamps
  Object.keys(checks).forEach(k => {
    if (checks[k] === true) { checks[k] = now; dirty = true; }
  });

  // Prune stale keys (play no longer in playbook)
  const validKeys = new Set(plays.map(playKey));
  Object.keys(checks).forEach(k => {
    if (!validKeys.has(k)) { delete checks[k]; dirty = true; }
  });

  // Auto-reset items older than 30 days
  Object.keys(checks).forEach(k => {
    if (typeof checks[k] === 'number' && (now - checks[k]) >= RESET_MS) {
      delete checks[k]; dirty = true;
    }
  });

  if (dirty) { c.playbook_checks = checks; atUpdate(c).catch(() => {}); }

  const done = Object.keys(checks).length;
  const pct  = plays.length ? Math.round((done / plays.length) * 100) : 0;
  const clearLink = done > 0
    ? `<a href="#" onclick="event.preventDefault();clearPlaybookChecks()" style="font-size:var(--fs-sm);color:var(--muted);text-decoration:underline;white-space:nowrap">Clear completed</a>`
    : '';
  const header = plays.length > 1
    ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <div class="playbook-title" style="margin:0">Action Playbook for ${escHtml(c.name)}</div>
        <span style="margin-left:auto;font-size:var(--fs-sm);color:var(--muted)">${done}/${plays.length} done</span>
        <div style="width:60px;height:5px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:var(--green);border-radius:3px"></div>
        </div>
        ${clearLink}
      </div>`
    : `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div class="playbook-title" style="margin:0">Action Playbook for ${escHtml(c.name)}</div>
        ${clearLink}
      </div>`;
  el('dm-playbook').innerHTML = header +
    plays.map((p, i) => {
      const ts = checks[playKey(p)];
      const checked = !!ts;
      const cls = playClsMap2[p.type] || '';
      const ltr = playTypeMap2[p.type] || '!';
      let ageLabel = '';
      if (checked && typeof ts === 'number') {
        const days = Math.floor((now - ts) / 86400000);
        ageLabel = days < 1 ? ' · done today' : days === 1 ? ' · done 1d ago' : ` · done ${days}d ago`;
      }
      return `<label class="play-item${checked ? ' play-done' : ''}">
        <input type="checkbox" style="flex-shrink:0;margin-top:2px" ${checked ? 'checked' : ''} onchange="togglePlayCheck(${i},this.checked)" onclick="event.stopPropagation()">
        <div class="play-item__icon ${cls}">${ltr}</div>
        <div class="play-item__text">${p.text}${ageLabel ? '<span style="color:var(--muted);font-size:var(--fs-sm)">' + ageLabel + '</span>' : ''}</div>
      </label>`;
    }).join('');
}

function togglePlayCheck(idx, checked) {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const plays = buildPlaybook(c.score, c);
  if (!plays[idx]) return;
  const key = playKey(plays[idx]);
  c.playbook_checks = c.playbook_checks || {};
  if (checked) c.playbook_checks[key] = Date.now();   // timestamp instead of true
  else delete c.playbook_checks[key];
  atUpdate(c).catch(() => {});
  renderDetailPlaybook();
}

function clearPlaybookChecks() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  c.playbook_checks = {};
  atUpdate(c).catch(() => {});
  renderDetailPlaybook();
}

function renderDetailNotes() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const notes = c.notes || [];
  el('dm-notes-list').innerHTML = notes.length
    ? notes.map((n,i) => `
        <div class="note-item">
          <div class="note-hd">
            <span class="note-date">${fmtDate(n.date)}</span>
            <button class="btn btn-xs btn-danger" onclick="deleteNote(${i})">✕</button>
          </div>
          <div class="note-text">${escHtml(n.text)}</div>
        </div>`).join('')
    : '<p style="font-size:var(--fs-base);color:var(--muted)">No notes yet. Add one below.</p>';
  el('note-input').value = '';
}

function addNote() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const text = el('note-input').value.trim();
  if (!text) return;
  c.notes = c.notes || [];
  c.notes.unshift({ text, date: new Date().toISOString() });
  renderDetailNotes();
  logAudit('note_added', c.id, c.name, { summary: `Note: "${text.substring(0, 100)}${text.length > 100 ? '…' : ''}"` });
  save(c).then(() => toast('Note added', 'success'))
         .catch(e => { console.error('Note save failed:', e); toast('Saved locally — sync failed', 'warn'); });
}

function deleteNote(idx) {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  c.notes.splice(idx,1);
  renderDetailNotes();
  save(c).catch(e => console.error('Note delete sync failed:', e));
}

function renderDetailHistory() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const hist = c.history || [];

  // Sparkline
  el('dm-history-sparkline').innerHTML = hist.length >= 2
    ? buildSparkline(hist.map(h=>h.score), 260, 60)
    : '<p style="font-size:var(--fs-base);color:var(--muted)">Score at least twice to see trend.</p>';

  // List — newest first; arr[i+1] = previous (older) entry
  const histList = el('dm-history-list');
  const reversed = [...hist].reverse();
  if (!reversed.length) {
    histList.innerHTML = '<p style="font-size:var(--fs-base);color:var(--muted)">No history yet.</p>';
    return;
  }
  const pg = _pagGet('scoreHist');
  const slice = reversed.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE);
  const pagNav = _pagHTML(reversed.length, 'scoreHist', 'renderDetailHistory');
  // Need the entry before first slice item for delta calculation
  const sliceStart = pg * PAGE_SIZE;
  histList.innerHTML = pagNav + slice.map((h, i) => {
    const globalIdx = sliceStart + i;
    const dotColor = STATUS_COLOR[getStatus(h.score)] || '#16a34a';
    const prev = reversed[globalIdx + 1]; // next in reversed = older entry

    // Score delta badge
    let deltaHtml = '';
    if (prev != null) {
      const d = h.score - prev.score;
      if      (d > 0) deltaHtml = `<span class="delta-up" style="font-size:var(--fs-sm)">▲${d}</span>`;
      else if (d < 0) deltaHtml = `<span class="delta-dn" style="font-size:var(--fs-sm)">▼${Math.abs(d)}</span>`;
      else             deltaHtml = `<span class="delta-eq" style="font-size:var(--fs-sm)">→0</span>`;
    }

    // Signal diff — what actually changed (use embedded prevSignals if available for sync entries)
    const prevSnap = h.prevSignals || (prev ? (prev.signals || null) : null);
    const changes = diffSnapshots(h.signals || null, prevSnap);
    let reasonHtml = '';
    if (changes.length) {
      reasonHtml = `<div class="hist-reason">${changes.map(escHtml).join(' &nbsp;·&nbsp; ')}</div>`;
    } else if (!prev) {
      reasonHtml = `<div class="hist-reason" style="font-style:italic">Initial score entry</div>`;
    } else if (!h.signals) {
      reasonHtml = `<div class="hist-reason" style="color:var(--subtle);font-style:italic">No signal detail (pre-v18 entry)</div>`;
    } else {
      reasonHtml = `<div class="hist-reason" style="font-style:italic">All signals unchanged</div>`;
    }

    return `
      <div class="hist-row">
        <div class="hist-dot" style="background:${dotColor}"></div>
        <div class="hist-score">${h.score}</div>
        ${deltaHtml}
        <div>${badgeHTML(getStatus(h.score))}</div>
        <div class="hist-date">${fmtDate(h.date)}</div>
      </div>
      ${reasonHtml}`;
  }).join('') + pagNav;
}

function buildSparkline(values, w, h) {
  if (values.length < 2) return '';
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 100);
  const range = max - min || 1;
  const padX = 8, padY = 8;
  const plotW = w - padX * 2, plotH = h - padY * 2;
  const xStep = plotW / (values.length - 1);
  const pts = values.map((v,i) => ({
    x: padX + i * xStep,
    y: padY + plotH - ((v - min) / range) * plotH,
    v
  }));
  const lastVal  = values[values.length-1];
  const prevVal  = values[values.length-2];
  const color = lastVal > prevVal ? '#16a34a' : lastVal < prevVal ? '#dc2626' : '#64748b';

  // Smooth path (Catmull-Rom → Cubic Bezier)
  let pathD = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    pathD += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }

  // Area fill under curve
  const areaD = pathD + ` L${pts[pts.length-1].x},${padY+plotH} L${pts[0].x},${padY+plotH} Z`;

  // Only show first and last value (no hover on sparklines)
  const first = pts[0];
  const last = pts[pts.length - 1];

  return `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="sparkline" style="font-family:'DM Mono',monospace">
      <defs><linearGradient id="spkGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
      </linearGradient></defs>
      <path d="${areaD}" fill="url(#spkGrad)"/>
      <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
      <circle cx="${first.x}" cy="${first.y}" r="2" fill="#fff" stroke="${color}" stroke-width="1.5"/>
      <text x="${first.x}" y="${first.y - 5}" text-anchor="middle" font-size="7.5" font-weight="600" fill="${color}">${Math.round(first.v)}</text>
      <circle cx="${last.x}" cy="${last.y}" r="2.5" fill="#fff" stroke="${color}" stroke-width="1.5"/>
      <text x="${last.x}" y="${last.y - 5}" text-anchor="middle" font-size="7.5" font-weight="600" fill="${color}">${Math.round(last.v)}</text>
    </svg>`;
}

// Mini sparkline for customer table cells — reuses buildSparkline() at small scale
function buildSparklineMini(c) {
  const hist = (c.history||[]).slice(-10); // last 10 score points
  if (hist.length < 2) return '<span style="color:var(--subtle);font-size:var(--fs-sm)">—</span>';
  return buildSparkline(hist.map(h=>h.score), 72, 22);
}

let _returnToPage = '';
let _returnToDetail = '';

function editCustomer(id) {
  const cid = id || detailId;
  if (!cid) return;
  const c = customers.find(x => x.id === cid);
  if (!c) return;

  try { _returnToPage = localStorage.getItem('iqc_active_view') || 'dashboard'; } catch(e) { _returnToPage = 'dashboard'; }
  _returnToDetail = c.id;
  closeModal('detail-modal');
  nav('score');
  document.getElementById('form-title').textContent = 'Re-score: ' + c.name;
  document.getElementById('score-form').dataset.editId = c.id;
  if (el('save-details-wrap')) el('save-details-wrap').style.display = 'flex';

  el('f-name').value     = c.name;
  if (el('f-contact-name'))  el('f-contact-name').value  = c.contact_name || '';
  if (el('f-contact-email')) el('f-contact-email').value = c.contact_email || '';
  // Reset manager fields: hide "new" input, show select, rebuild options, set value
  const fmNew = document.getElementById('f-manager-new');
  if (fmNew) { fmNew.style.display = 'none'; fmNew.value = ''; }
  const fmSel = el('f-manager');
  if (fmSel) { fmSel.style.display = ''; fmSel.innerHTML = buildManagerSelectOptions(c.manager || ''); }
  if (el('f-profile')) { refreshProfileDropdown(); el('f-profile').value = c.scoring_profile || ''; }
  el('f-mrr').value      = c.mrr   || '';
  if (el('f-arr'))   el('f-arr').value   = c.arr   || '';
  if (el('f-since')) el('f-since').value = c.since || '';
  el('f-tier').value     = c.tier || 'mid';
  el('f-lifecycle').value= c.lifecycle || 'active';
  el('f-tags').value     = (c.tags||[]).join(', ');
  if (el('f-billing')) el('f-billing').value = c.billing_interval || '';
  // Login Frequency
  if (c.logins != null) { el('f-logins-na').checked = false; el('f-logins').value = c.logins; el('f-logins').disabled = false; el('f-logins').style.opacity = '1'; rv('logins', c.logins + ' days'); el('rv-logins').style.color = ''; }
  else { el('f-logins-na').checked = true; toggleSignalNA('logins'); }
  // Feature Adoption
  if (c.adoption != null) { el('f-adoption-na').checked = false; el('f-adoption').value = c.adoption; el('f-adoption').disabled = false; el('f-adoption').style.opacity = '1'; rv('adoption', c.adoption + '%'); el('rv-adoption').style.color = ''; }
  else { el('f-adoption-na').checked = true; toggleSignalNA('adoption'); }
  // Open Support Tickets
  if (c.tickets != null) { el('f-tickets-na').checked = false; el('f-tickets').value = c.tickets; el('f-tickets').disabled = false; el('f-tickets').style.opacity = '1'; }
  else { el('f-tickets-na').checked = true; toggleSignalNA('tickets'); }
  // NPS slider
  if (c.nps != null) { el('f-nps-na').checked = false; el('f-nps').value = c.nps; el('f-nps').disabled = false; el('f-nps').style.opacity = '1'; rv('nps-label', npsDisplay(c.nps)); el('rv-nps-label').style.color = ''; }
  else { el('f-nps-na').checked = true; toggleNpsNA(); }
  // CSAT slider
  if (c.csat != null) { el('f-csat-na').checked = false; el('f-csat').value = c.csat; el('f-csat').disabled = false; el('f-csat').style.opacity = '1'; rv('csat-label', csatDisplay(c.csat)); el('rv-csat-label').style.color = ''; }
  else { el('f-csat-na').checked = true; toggleCsatNA(); }
  // Days Since Last Contact (read-only, auto-tracked)
  const daysDisp = el('rv-days-display');
  if (daysDisp) {
    if (c.last_contact_date) {
      const [_y,_m,_d] = c.last_contact_date.split('-').map(Number);
      const lcd = new Date(_y, _m-1, _d);
      const daysAgo = Math.max(0, Math.floor((Date.now() - lcd.getTime()) / 86400000));
      const dateStr = lcd.toLocaleDateString('en-US', { month:'short', day:'numeric' });
      daysDisp.innerHTML = `<span>${daysAgo} days</span> <span style="font-weight:400;font-size:var(--fs-sm);color:var(--muted)">since ${dateStr}</span>`;
      daysDisp.style.color = daysAgo > 30 ? 'var(--red)' : daysAgo > 14 ? 'var(--amber)' : 'var(--green)';
    } else if (c.days != null) {
      daysDisp.innerHTML = `<span>${c.days} days</span> <span style="font-weight:400;font-size:var(--fs-sm);color:var(--muted)">(no contact date tracked)</span>`;
      daysDisp.style.color = c.days > 30 ? 'var(--red)' : c.days > 14 ? 'var(--amber)' : '';
    } else {
      daysDisp.textContent = 'N/A';
      daysDisp.style.color = 'var(--subtle)';
    }
  }
  if (el('f-days')) el('f-days').value = c.days != null ? c.days : '';
  if (el('f-renewal-date')) el('f-renewal-date').value = c.renewal_date || '';
  if (el('f-next-touch'))  el('f-next-touch').value  = c.next_touch   || '';
  if (el('f-next-touch-time')) el('f-next-touch-time').value = c.next_touch_time || '';
  el('f-growth').value   = c.growth || 'none';
  if (el('f-note')) el('f-note').value = '';
  applyProfileSignalState();

  // Override saveScore to update in-place
  window._editMode = c.id;

  // Pre-populate result panel with current score so breakdown is visible immediately
  const curData = {
    name: c.name, manager: c.manager || '', mrr: c.mrr || 0, arr: c.arr || 0,
    tier: c.tier || 'mid', lifecycle: c.lifecycle || 'active', tags: c.tags || [],
    billing_interval: c.billing_interval || '',
    logins: c.logins, adoption: c.adoption, tickets: c.tickets,
    nps: c.nps, csat: c.csat, days: c.days, growth: c.growth || 'none',
    renewal: c.renewal, renewal_date: c.renewal_date || '', profile: c.scoring_profile || ''
  };
  const rw = c.scoring_profile ? (profiles.find(p => p.name === c.scoring_profile) || {}).weights || weights : weights;
  const tempCur = { ...c, ...curData, scoring_profile: curData.profile };
  const { score: curScore, signals: curSignals } = scoreWithModel(tempCur, rw);
  const curStatus = getStatus(curScore);
  const curRec    = makeRec(curScore, curData);
  const curPlays  = buildPlaybook(curScore, curData);
  pendingResult = { data: curData, score: curScore, signals: curSignals, status: curStatus, rec: curRec, plays: curPlays };
  showResult(pendingResult);
}

// Patch submitForm to handle edit mode
const _origSubmit = HTMLFormElement.prototype.submit;
document.getElementById('score-form').addEventListener('submit', function(e) {
  // handled by onsubmit
});

// Patch saveScore for edit mode
const _origSaveScore = saveScore;
window.saveScore = function() {
  const editId = document.getElementById('score-form').dataset.editId;
  if (editId) {
    const c = customers.find(x => x.id === editId);
    if (c && pendingResult) {
      const { data, score, status } = pendingResult;
      /* Capture before-state for audit diff */
      const before = { name:c.name, manager:c.manager||'', score:c.score, status:c.status, mrr:c.mrr, arr:c.arr, tier:c.tier, lifecycle:c.lifecycle, logins:c.logins, adoption:c.adoption, tickets:c.tickets, nps:c.nps, csat:c.csat, days:c.days, growth:c.growth||'none', scoring_profile:c.scoring_profile||'' };
      c.name            = data.name;
      c.manager         = data.manager || '';
      c.scoring_profile = data.profile || '';
      c.score           = score;
      c.status          = status;
      c.logins          = data.logins;
      c.adoption        = data.adoption;
      c.tickets         = data.tickets;
      c.nps             = data.nps;
      c.csat            = data.csat;
      c.days            = data.days;
      c._baseDays       = data.days;
      c.renewal         = data.renewal;
      c.renewal_date    = data.renewal_date || '';
      c.next_touch      = (el('f-next-touch') ? el('f-next-touch').value : '') || '';
      c.next_touch_time = c.next_touch ? (el('f-next-touch-time') ? el('f-next-touch-time').value : '') || '' : '';
      c.growth          = data.growth;
      c.mrr             = data.mrr || (data.arr ? Math.round(data.arr / 12) : 0);
      c.arr             = data.arr || (data.mrr ? data.mrr * 12 : 0);
      c.since           = data.since || '';
      c.tier            = data.tier;
      c.lifecycle       = data.lifecycle;
      c.tags              = data.tags;
      c.billing_interval  = data.billing_interval || c.billing_interval || '';
      if (data.note) {
        c.notes = c.notes || [];
        c.notes.unshift({ text: data.note, date: new Date().toISOString() });
      }
      c.history = c.history || [];
      c.history.push({ score, date: new Date().toISOString(), signals: buildHistorySnapshot(data) });
      setLoading(true);
      save(c).then(() => { setLoading(false); toast('Updated: ' + c.name, 'success'); })
              .catch(() => { setLoading(false); toast('Updated locally — sync failed', 'warn'); });
      /* Build granular audit diff */
      const after = { name:c.name, manager:c.manager, score, status, mrr:c.mrr, arr:c.arr, tier:c.tier, lifecycle:c.lifecycle, logins:c.logins, adoption:c.adoption, tickets:c.tickets, nps:c.nps, csat:c.csat, days:c.days, growth:c.growth||'none', scoring_profile:c.scoring_profile||'' };
      const changes = Object.keys(after).filter(k => String(before[k]) !== String(after[k])).map(k => `${k}: ${before[k]} → ${after[k]}`);
      const summaryText = changes.length ? changes.join(', ') : 'Re-scored (no field changes)';
      logAudit('customer_updated', c.id, c.name, { score, status, summary: summaryText });
      pendingResult = null;
      resetForm();
      nav(_returnToPage || 'customers');
      _returnToPage = '';
      if (_returnToDetail) { const rid = _returnToDetail; _returnToDetail = ''; setTimeout(() => openDetail(rid), 80); }
      return;
    }
  }
  _origSaveScore();
};

function deleteFromModal() {
  if (!detailId) return;
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  confirmAction(`Move "${c.name}" to Trash?`, async () => {
    c.deleted_at = new Date().toISOString();
    trash.push(c);
    customers = customers.filter(x => x.id !== detailId);
    closeModal('detail-modal');
    toast(`${c.name} moved to Trash`, 'warn');
    logAudit('customer_deleted', c.id, c.name, { summary: `Moved to trash — Score: ${c.score}/100, MRR: $${c.mrr||0}, Tier: ${c.tier}` });
    renderCustomers();
    setLoading(true);
    await atDelete(c).catch(()=>{});
    setLoading(false);
  });
}

function deleteCustomer(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  confirmAction(`Move "${c.name}" to Trash?`, async () => {
    c.deleted_at = new Date().toISOString();
    trash.push(c);
    customers = customers.filter(x => x.id !== id);
    toast(`${c.name} moved to Trash`, 'warn');
    logAudit('customer_deleted', c.id, c.name, { summary: `Moved to trash — Score: ${c.score}/100, MRR: $${c.mrr||0}, Tier: ${c.tier}` });
    if (!customers.length) { nav('homebase'); } else { renderCustomers(); }
    setLoading(true);
    await atDelete(c).catch(()=>{});
    setLoading(false);
  });
}

function confirmAction(msg, onOk) {
  el('confirm-msg').textContent = msg;
  el('confirm-ok').onclick = () => { closeModal('confirm-modal'); onOk(); };
  openModal('confirm-modal');
}

// ─── QBR PREP ────────────────────────────────────────────────
function openQBR() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  if (typeof _wtCompleteIfActive === 'function') _wtCompleteIfActive('qbr-prep');
  logAudit('qbr_opened', c.id, c.name, { summary: 'QBR Prep opened' });
  el('qbr-content').innerHTML = buildQBRHTML(c);
  closeModal('detail-modal');
  openModal('qbr-modal');
}
function closeQBR() {
  closeModal('qbr-modal');
  if (detailId) setTimeout(() => openDetail(detailId), 80);
}

/* ── Rich HTML version (displayed in modal) ── */
function buildQBRHTML(c) {
  const cad   = getCadenceStatus(c);
  const sent  = latestSentiment(c);
  const u     = getRenewalUrgency(c);
  const date  = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

  const statusColor = STATUS_COLOR[c.status] || '#16a34a';
  const statusLabel = STATUS_LABEL[c.status] || 'Healthy';

  const momIcons  = { up:'↑', dn:'↓', flat:'→', new:'★' };
  const momColors = { up:'#16a34a', dn:'#dc2626', flat:'#d97706', new:'#2563eb' };
  const momLabels = { up:'Improving', dn:'Declining', flat:'Flat', new:'New' };
  const sentLabels = { positive:'Positive', neutral:'Neutral', negative:'Negative' };

  const hist = c.history || [];
  // Derive momentum from the last two history entries so label always matches the displayed score change
  var mom, histLine;
  if (hist.length >= 2) {
    var prevScore = hist[hist.length-2].score, curScore = hist[hist.length-1].score;
    var histDiff = curScore - prevScore;
    histLine = prevScore + ' → ' + curScore + ' <span style="color:' + (histDiff >= 0 ? '#16a34a' : '#dc2626') + '">(' + (histDiff > 0 ? '+' : '') + histDiff + ')</span>';
    mom = histDiff >= momentumPts ? 'up' : histDiff <= -momentumPts ? 'dn' : 'flat';
  } else {
    histLine = '';
    mom = hist.length < 2 ? 'new' : 'flat';
  }

  const tierMap = { smb:'SMB', mid:'Mid-Market', enterprise:'Enterprise' };
  const tierDisp = tierMap[c.tier] || c.tier || '';
  const name = c.name || 'This account';

  // SVG icons
  const svgi = (d, w=14) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:middle">${d}</svg>`;
  const svgSummary   = svgi('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>');
  const svgWins      = svgi('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>');
  const svgRisks     = svgi('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>');
  const svgAgenda    = svgi('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>');
  const svgQuestions = svgi('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>');
  const svgNotes     = svgi('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>');
  const svgDollar    = svgi('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', 12);
  const svgRenewal   = svgi('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>', 12);

  const lc   = c.lifecycle || 'active';
  const lcCtx = LIFECYCLE_CONTEXT[lc] || LIFECYCLE_CONTEXT.active;

  /* ── Wins & Highlights ── */
  const wins = [];
  // Lifecycle-aware wins
  if (lc === 'onboarding' && c.adoption != null && c.adoption >= 40) wins.push(`Strong early adoption during onboarding (${c.adoption}%)`);
  if (lc === 'won' && c.logins != null && c.logins >= 10) wins.push('Smooth transition after expansion \u2014 engagement remains strong');
  if (c.logins != null && c.logins >= 15) wins.push(`Strong engagement \u2014 ${c.logins} logins in the past 30 days`);
  if (c.adoption != null && c.adoption >= 60) wins.push(`High feature adoption at ${c.adoption}%`);
  if (c.tickets != null && c.tickets <= 1) wins.push(`Clean support queue \u2014 ${c.tickets === 0 ? 'no' : 'only 1'} open ticket${c.tickets === 1 ? '' : 's'}`);
  if (c.nps != null && npsIsPromoter(c.nps)) wins.push(`NPS promoter (${npsDisplay(c.nps)}) \u2014 strong advocacy potential`);
  if (c.csat != null && csatIsGood(c.csat)) wins.push(`High satisfaction (CSAT ${csatDisplay(c.csat)})`);
  if (c.growth === 'strong' && lc !== 'onboarding' && lc !== 'won') wins.push('Strong growth trajectory \u2014 expansion opportunity');
  else if (c.growth === 'mild' && lc !== 'onboarding' && lc !== 'won') wins.push('Positive growth trend emerging');
  if (sent && sent.val === 'positive') wins.push(`Positive sentiment logged on ${fmtDate(sent.date)}`);
  if (mom === 'up') wins.push('Health score is trending upward');
  if (c.days != null && c.days <= 7) wins.push('Recently engaged \u2014 last contact within 7 days');

  /* ── Risks & Concerns ── */
  const risks = [];
  if (c.logins != null && c.logins < 5) risks.push({ sev:'high', text:`Low engagement \u2014 only ${c.logins} login${c.logins === 1 ? '' : 's'} in the past 30 days` });
  else if (c.logins != null && c.logins < 12) risks.push({ sev:'med', text:`Moderate engagement \u2014 ${c.logins} logins/month (below ideal)` });
  if (c.adoption != null && c.adoption < 25) risks.push({ sev:'high', text:`Critical adoption gap \u2014 only ${c.adoption}% of features utilized` });
  else if (c.adoption != null && c.adoption < 50) risks.push({ sev:'med', text:`Adoption at ${c.adoption}% \u2014 significant value left on the table` });
  if (c.tickets != null && c.tickets >= 5) risks.push({ sev:'high', text:`${c.tickets} open support tickets \u2014 unresolved friction` });
  else if (c.tickets != null && c.tickets >= 3) risks.push({ sev:'med', text:`${c.tickets} open tickets may indicate product friction` });
  if (c.nps != null && npsIsDetractor(c.nps)) risks.push({ sev:'high', text:`NPS detractor (${npsDisplay(c.nps)}) \u2014 needs immediate attention` });
  if (c.csat != null && csatIsPoor(c.csat)) risks.push({ sev:'high', text:`CSAT is ${csatDisplay(c.csat)} \u2014 satisfaction critically low` });
  if (c.days != null && c.days > 30) risks.push({ sev:'high', text:`No contact in ${c.days} days \u2014 relationship at risk` });
  else if (c.days != null && c.days > 14) risks.push({ sev:'med', text:`${c.days} days since last contact \u2014 follow-up overdue` });
  if (c.growth === 'declining') risks.push({ sev:'med', text:'Growth signal is declining' });
  if (sent && sent.val === 'negative') risks.push({ sev:'high', text:`Negative sentiment logged on ${fmtDate(sent.date)}` });
  if (mom === 'dn') risks.push({ sev:'med', text:'Health score trending downward' });
  if (c.renewal != null && c.renewal <= 2) risks.push({ sev: c.renewal <= 1 ? 'high' : 'med', text:`Renewal in ${fmtRenewalTime(c)} \u2014 needs proactive attention` });

  /* ── Executive Summary ── */
  let summary = '';
  // Lifecycle context prefix
  if (lc === 'onboarding')
    summary += `<em style="color:var(--blue)">This customer is in their onboarding phase \u2014 the focus should be on driving adoption and confirming early value, not expansion.</em><br><br>`;
  else if (lc === 'won')
    summary += `<em style="color:var(--purple)">This customer recently expanded \u2014 the focus should be on value realization of the new purchase before exploring further growth.</em><br><br>`;
  else if (lc === 'churned')
    summary += `<em style="color:var(--muted)">This customer has churned. This review should focus on lessons learned and assessing winback potential.</em><br><br>`;

  if (c.status === 'critical' || c.status === 'risk') {
    summary = `${name} is currently in a <strong>${statusLabel}</strong> state with a health score of ${c.score}/100. `;
    if (mom === 'dn') summary += 'The score has been declining, which warrants immediate attention. ';
    else if (mom === 'up') summary += 'However, the score is trending upward, indicating recent recovery efforts may be working. ';
    if (risks.length) summary += `There ${risks.length === 1 ? 'is 1 key concern' : 'are ' + risks.length + ' concerns'} to address. `;
    if (c.renewal != null && c.renewal <= 3) summary += `With renewal ${c.renewal <= 0 ? 'imminent' : 'approaching in ' + fmtRenewalTime(c)}, this QBR is critical for retention. `;
    summary += 'The focus for this meeting should be understanding root causes and building a joint recovery plan.';
  } else if (c.status === 'watch') {
    summary = `${name} is in <strong>Watch</strong> status (${c.score}/100). `;
    if (wins.length) summary += `There are positive signals, `;
    summary += `but ${risks.length ? risks.length + ' area' + (risks.length > 1 ? 's need' : ' needs') + ' attention' : 'some signals are mixed'}. `;
    summary += 'This QBR should balance acknowledging wins while proactively addressing gaps before they escalate.';
  } else if (c.status === 'expand') {
    summary = `${name} is performing strongly at ${c.score}/100 (<strong>${statusLabel}</strong>). `;
    if (wins.length) summary += `Key highlights include strong engagement and satisfaction. `;
    summary += 'This QBR is an opportunity to deepen the partnership, explore expansion, and build advocacy.';
  } else {
    summary = `${name} is in a <strong>${statusLabel}</strong> state with a health score of ${c.score}/100. `;
    if (mom === 'up') summary += 'The score is trending positively. ';
    if (wins.length && risks.length) summary += `There are clear strengths, but ${risks.map(r => r.label).join(' and ')} need${risks.length === 1 ? 's' : ''} attention. `;
    else if (wins.length) summary += 'Multiple positive signals are present. ';
    summary += 'This meeting should reinforce value, address any concerns, and align on goals for the next quarter.';
  }

  /* ── Suggested Agenda ── */
  const agenda = [];
  agenda.push({ time:'5 min', topic:'Welcome & Relationship Check-in', detail:'Open with a personal check-in. Ask how things are going overall before diving into business.' });
  // Lifecycle-specific agenda items
  if (lc === 'onboarding') {
    agenda.push({ time:'10 min', topic:'Onboarding Progress & Milestones', detail:'Review where they are in the onboarding journey. Confirm key milestones have been hit and identify any blockers.' });
    agenda.push({ time:'10 min', topic:'Adoption & Enablement Needs', detail:`Current adoption is at ${c.adoption != null ? c.adoption + '%' : 'TBD'}. Walk through which features are being used and schedule training for gaps.` });
  }
  if (lc === 'won') {
    agenda.push({ time:'10 min', topic:'Value Realization of Recent Expansion', detail:'Review whether the new capabilities are being used and delivering the expected outcomes.' });
    agenda.push({ time:'5 min', topic:'New Capabilities Adoption Check', detail:'Confirm the expanded scope is fully onboarded and users are trained.' });
  }
  if (wins.length)
    agenda.push({ time:'10 min', topic:'Celebrate Wins & Value Delivered', detail:'Walk through key successes and metrics that demonstrate ROI. Let the customer see the impact.' });
  if (risks.some(r => r.sev === 'high'))
    agenda.push({ time:'10 min', topic:'Address Key Concerns', detail:'Proactively raise the high-priority concerns identified below. Show you\'re aware and have a plan.' });
  else if (risks.length)
    agenda.push({ time:'5 min', topic:'Areas for Improvement', detail:'Brief discussion on areas where there\'s room to grow.' });
  if (lc !== 'onboarding' && c.adoption != null && c.adoption < 60)
    agenda.push({ time:'10 min', topic:'Product Adoption & Enablement', detail:`Current adoption is at ${c.adoption}%. Walk through underutilized features and their business impact.` });
  agenda.push({ time:'10 min', topic:'Goals for Next Quarter', detail:'Align on what success looks like for Q+1. Document concrete objectives together.' });
  if (lc !== 'churned' && c.renewal != null && c.renewal <= 6)
    agenda.push({ time:'5 min', topic:'Renewal & Partnership Discussion', detail:`Renewal is ${fmtRenewalTime(c)} out. Address timeline, scope, and any expansion interest.` });
  if (lc !== 'onboarding' && lc !== 'won' && lc !== 'churned' && (c.growth === 'strong' || c.growth === 'mild' || c.status === 'expand'))
    agenda.push({ time:'5 min', topic:'Expansion Opportunities', detail:'Explore where additional value could be unlocked \u2014 new users, features, or tiers.' });
  agenda.push({ time:'5 min', topic:'Action Items & Next Steps', detail:'Summarize agreed-upon action items with owners and timelines.' });

  /* ── Questions to Ask ── */
  const questions = [];
  // Lifecycle-specific questions
  if (lc === 'onboarding') {
    questions.push('Are you getting the value you expected from the platform so far?');
    questions.push('What would make the onboarding process smoother for your team?');
    questions.push('Who else on your team should we bring into the fold to drive adoption?');
  } else if (lc === 'won') {
    questions.push('How are the new capabilities working for your team?');
    questions.push('Is the expanded scope meeting the expectations we discussed?');
    questions.push('Are there any users who still need training on the new features?');
  } else {
    questions.push('What\'s top of mind for your team heading into next quarter?');
  }
  questions.push('Are there any internal changes (team, strategy, budget) we should be aware of?');
  if (c.logins != null && c.logins < 10)
    questions.push('What does a typical week look like for your team using the platform? Are there barriers to more frequent usage?');
  if (c.adoption != null && c.adoption < 50)
    questions.push('Are there specific features you\'ve wanted to try but haven\'t had time to explore?');
  if (c.tickets != null && c.tickets >= 3)
    questions.push('How has your experience with our support team been? Is there anything we can do to resolve these issues faster?');
  if (c.nps != null && npsIsDetractor(c.nps))
    questions.push('Your recent NPS feedback was lower than expected \u2014 can you help me understand what fell short?');
  if (lc !== 'onboarding' && lc !== 'won' && (c.growth === 'strong' || c.status === 'expand'))
    questions.push('Your team has been growing \u2014 are there additional users or departments that could benefit from the platform?');
  if (c.renewal != null && c.renewal <= 6)
    questions.push('As we approach renewal, is there anything you\'d like to see from us to make the decision easier?');
  if (c.days != null && c.days > 21)
    questions.push('It\'s been a while since we last connected \u2014 has anything changed on your end that I should know about?');
  if (sent && sent.val === 'negative')
    questions.push('I wanted to follow up on our last conversation. Has anything improved since then?');
  questions.push('What would make our partnership even more valuable to your organization over the next 6 months?');

  /* ── Recent Notes ── */
  const recentNotes = (c.notes || []).slice(0, 3);
  const notesHTML = recentNotes.map(n =>
    `<div class="qbr-note"><div class="qbr-note-date">${fmtDate(n.date)}</div>${escHtml(n.text)}</div>`
  ).join('');

  /* ── Render sections ── */
  const winsHTML = wins.map(w =>
    `<div class="qbr-win-row"><span class="qbr-win-dot"></span><span>${w}</span></div>`
  ).join('');

  const risksHTML = risks.map(r =>
    `<div class="qbr-risk-row ${r.sev === 'high' ? 'qbr-risk--high' : 'qbr-risk--med'}"><span class="qbr-risk-dot"></span><span>${r.text}</span></div>`
  ).join('');

  const agendaHTML = agenda.map((a, i) =>
    `<div class="qbr-agenda-item">
      <div class="qbr-agenda-num">${i + 1}</div>
      <div class="qbr-agenda-body">
        <div class="qbr-agenda-topic">${a.topic} <span class="qbr-agenda-time">${a.time}</span></div>
        <div class="qbr-agenda-detail">${a.detail}</div>
      </div>
    </div>`
  ).join('');

  const questionsHTML = questions.map(q =>
    `<div class="qbr-q-row"><span class="qbr-q-bullet">?</span><span>${q}</span></div>`
  ).join('');

  return `
    <div class="qbr-hdr">
      <div class="qbr-score" style="background:${statusColor}">
        <div class="qbr-score-num">${c.score}</div>
        <div class="qbr-score-lbl">${statusLabel}</div>
      </div>
      <div class="qbr-meta">
        <div style="font-size:var(--fs-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--blue);margin-bottom:2px">Quarterly Business Review</div>
        <h3>${escHtml(c.name)}</h3>
        <div style="font-size:var(--fs-base);color:var(--muted);display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px">
          <span style="color:${momColors[mom] || '#94a3b8'};font-weight:700">${momIcons[mom] || ''} ${momLabels[mom] || '\u2014'}</span>
          ${histLine ? `<span style="color:var(--border)">\u00b7</span><span style="font-weight:600">${histLine}</span>` : ''}
        </div>
        <div class="qbr-meta-tags">
          ${c.mrr ? `<span class="qbr-tag" style="display:inline-flex;align-items:center;gap:4px">${svgDollar} $${fmtNum(c.mrr)} MRR</span>` : ''}
          ${tierDisp ? `<span class="qbr-tag">${tierDisp}</span>` : ''}
          ${c.lifecycle ? `<span class="qbr-tag">${c.lifecycle}</span>` : ''}
          ${c.renewal != null ? `<span class="qbr-tag" style="display:inline-flex;align-items:center;gap:4px">${svgRenewal} ${c.renewal}mo to renewal${u ? ' \u00b7 ' + u.label : ''}</span>` : ''}
        </div>
      </div>
    </div>

    <div class="qbr-section">
      <div class="qbr-section-title">${svgSummary} Executive Summary</div>
      <div class="qbr-summary">${summary}</div>
    </div>

    ${wins.length ? `
    <div class="qbr-section">
      <div class="qbr-section-title">${svgWins} Wins & Highlights</div>
      <div class="qbr-wins">${winsHTML}</div>
    </div>` : ''}

    ${risks.length ? `
    <div class="qbr-section">
      <div class="qbr-section-title">${svgRisks} Risks & Concerns</div>
      <div class="qbr-risks">${risksHTML}</div>
    </div>` : ''}

    <div class="qbr-section">
      <div class="qbr-section-title">${svgAgenda} Suggested Agenda</div>
      <div class="qbr-agenda">${agendaHTML}</div>
    </div>

    <div class="qbr-section">
      <div class="qbr-section-title">${svgQuestions} Questions to Ask</div>
      <div class="qbr-questions">${questionsHTML}</div>
    </div>

    ${recentNotes.length ? `
    <div class="qbr-section">
      <div class="qbr-section-title">${svgNotes} Meeting Context \u2014 Recent Notes</div>
      <div class="qbr-notes">${notesHTML}</div>
    </div>` : ''}

    <div class="qbr-footer">Prepared ${date} \u00b7 IQ Cadence \u00b7 iqcadence.com</div>`;
}

/* ── Plain-text version (clipboard copy) ── */
function buildQBRText(c) {
  const cad   = getCadenceStatus(c);
  const sent  = latestSentiment(c);
  const u     = getRenewalUrgency(c);
  const momLabels = { up:'Improving', dn:'Declining', flat:'Flat', new:'New' };
  const sentLabels = { positive:'Positive', neutral:'Neutral', negative:'Negative' };
  const date  = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const hist = c.history || [];
  // Derive momentum from the last two history entries for consistency
  var mom, histLine;
  if (hist.length >= 2) {
    var prevScore = hist[hist.length-2].score, curScore = hist[hist.length-1].score;
    var histDiff = curScore - prevScore;
    histLine = prevScore + ' → ' + curScore + ' (' + (histDiff > 0 ? '+' : '') + histDiff + ' pts)';
    mom = histDiff >= momentumPts ? 'up' : histDiff <= -momentumPts ? 'dn' : 'flat';
  } else {
    histLine = c.score + ' (first score)';
    mom = 'new';
  }
  const tierMap = { smb:'SMB', mid:'Mid-Market', enterprise:'Enterprise' };
  const name = c.name || 'This account';
  const lc   = c.lifecycle || 'active';

  // Wins
  const wins = [];
  if (lc === 'onboarding' && c.adoption != null && c.adoption >= 40) wins.push(`Strong early adoption during onboarding (${c.adoption}%)`);
  if (lc === 'won' && c.logins != null && c.logins >= 10) wins.push('Smooth transition after expansion — engagement remains strong');
  if (c.logins != null && c.logins >= 15) wins.push(`Strong engagement — ${c.logins} logins in the past 30 days`);
  if (c.adoption != null && c.adoption >= 60) wins.push(`High feature adoption at ${c.adoption}%`);
  if (c.tickets != null && c.tickets <= 1) wins.push(`Clean support queue — ${c.tickets === 0 ? 'no' : 'only 1'} open ticket${c.tickets === 1 ? '' : 's'}`);
  if (c.nps != null && npsIsPromoter(c.nps)) wins.push(`NPS promoter (${npsDisplay(c.nps)}) — strong advocacy potential`);
  if (c.csat != null && csatIsGood(c.csat)) wins.push(`High satisfaction (CSAT ${csatDisplay(c.csat)})`);
  if (c.growth === 'strong' && lc !== 'onboarding' && lc !== 'won') wins.push('Strong growth trajectory — expansion opportunity');
  else if (c.growth === 'mild' && lc !== 'onboarding' && lc !== 'won') wins.push('Positive growth trend emerging');
  if (sent && sent.val === 'positive') wins.push(`Positive sentiment logged on ${fmtDate(sent.date)}`);
  if (mom === 'up') wins.push('Health score is trending upward');
  if (c.days != null && c.days <= 7) wins.push('Recently engaged — last contact within 7 days');

  // Risks
  const risks = [];
  if (c.logins != null && c.logins < 5) risks.push(`[HIGH] Low engagement — only ${c.logins} logins in the past 30 days`);
  else if (c.logins != null && c.logins < 12) risks.push(`[MED] Moderate engagement — ${c.logins} logins/month`);
  if (c.adoption != null && c.adoption < 25) risks.push(`[HIGH] Critical adoption gap — only ${c.adoption}% of features utilized`);
  else if (c.adoption != null && c.adoption < 50) risks.push(`[MED] Adoption at ${c.adoption}% — value left on the table`);
  if (c.tickets != null && c.tickets >= 5) risks.push(`[HIGH] ${c.tickets} open support tickets — unresolved friction`);
  else if (c.tickets != null && c.tickets >= 3) risks.push(`[MED] ${c.tickets} open tickets may indicate product friction`);
  if (c.nps != null && npsIsDetractor(c.nps)) risks.push(`[HIGH] NPS detractor (${npsDisplay(c.nps)}) — needs immediate attention`);
  if (c.csat != null && csatIsPoor(c.csat)) risks.push(`[HIGH] CSAT is ${csatDisplay(c.csat)} — satisfaction critically low`);
  if (c.days != null && c.days > 30) risks.push(`[HIGH] No contact in ${c.days} days — relationship at risk`);
  else if (c.days != null && c.days > 14) risks.push(`[MED] ${c.days} days since last contact — follow-up overdue`);
  if (c.growth === 'declining') risks.push('[MED] Growth signal is declining');
  if (sent && sent.val === 'negative') risks.push(`[HIGH] Negative sentiment logged on ${fmtDate(sent.date)}`);
  if (mom === 'dn') risks.push('[MED] Health score trending downward');
  if (c.renewal != null && c.renewal <= 2) risks.push(`[${c.renewal <= 1 ? 'HIGH' : 'MED'}] Renewal in ${fmtRenewalTime(c)} — needs proactive attention`);

  // Summary
  let summary = '';
  const sl = STATUS_LABEL[c.status] || 'Healthy';
  if (lc === 'onboarding')
    summary += '[ONBOARDING] Focus should be on driving adoption and confirming early value, not expansion. ';
  else if (lc === 'won')
    summary += '[RECENTLY EXPANDED] Focus should be on value realization of the new purchase. ';
  else if (lc === 'churned')
    summary += '[CHURNED] Focus on lessons learned and winback potential. ';

  if (c.status === 'critical' || c.status === 'risk') {
    summary += `${name} is currently in a ${sl} state with a health score of ${c.score}/100. `;
    if (mom === 'dn') summary += 'The score has been declining. ';
    if (risks.length) summary += `There are ${risks.length} concern(s) to address. `;
    if (c.renewal != null && c.renewal <= 3) summary += `Renewal is ${c.renewal <= 0 ? 'imminent' : 'in ' + fmtRenewalTime(c)}. `;
    summary += 'Focus this meeting on understanding root causes and building a joint recovery plan.';
  } else if (c.status === 'expand') {
    summary += `${name} is performing strongly at ${c.score}/100 (${sl}). `;
    summary += lc === 'onboarding' || lc === 'won' ? 'This QBR should reinforce early wins and confirm value delivery.' : 'This QBR is an opportunity to deepen the partnership, explore expansion, and build advocacy.';
  } else {
    summary += `${name} is in a ${sl} state (${c.score}/100). This meeting should reinforce value, address concerns, and align on goals for next quarter.`;
  }

  // Agenda
  const agenda = [];
  agenda.push('1. Welcome & Relationship Check-in (5 min)');
  if (lc === 'onboarding') {
    agenda.push(`${agenda.length + 1}. Onboarding Progress & Milestones (10 min)`);
    agenda.push(`${agenda.length + 1}. Adoption & Enablement Needs (10 min)`);
  }
  if (lc === 'won') {
    agenda.push(`${agenda.length + 1}. Value Realization of Recent Expansion (10 min)`);
    agenda.push(`${agenda.length + 1}. New Capabilities Adoption Check (5 min)`);
  }
  if (wins.length) agenda.push(`${agenda.length + 1}. Celebrate Wins & Value Delivered (10 min)`);
  if (risks.length) agenda.push(`${agenda.length + 1}. Address Concerns (10 min)`);
  if (lc !== 'onboarding' && c.adoption != null && c.adoption < 60) agenda.push(`${agenda.length + 1}. Product Adoption & Enablement (10 min)`);
  agenda.push(`${agenda.length + 1}. Goals for Next Quarter (10 min)`);
  if (lc !== 'churned' && c.renewal != null && c.renewal <= 6) agenda.push(`${agenda.length + 1}. Renewal & Partnership Discussion (5 min)`);
  if (lc !== 'onboarding' && lc !== 'won' && lc !== 'churned' && (c.growth === 'strong' || c.growth === 'mild' || c.status === 'expand')) agenda.push(`${agenda.length + 1}. Expansion Opportunities (5 min)`);
  agenda.push(`${agenda.length + 1}. Action Items & Next Steps (5 min)`);

  // Questions
  const questions = [];
  if (lc === 'onboarding') {
    questions.push('Are you getting the value you expected from the platform so far?');
    questions.push('What would make the onboarding process smoother for your team?');
    questions.push('Who else on your team should we bring into the fold to drive adoption?');
  } else if (lc === 'won') {
    questions.push('How are the new capabilities working for your team?');
    questions.push('Is the expanded scope meeting the expectations we discussed?');
    questions.push('Are there any users who still need training on the new features?');
  } else {
    questions.push('What\'s top of mind for your team heading into next quarter?');
  }
  questions.push('Are there any internal changes (team, strategy, budget) we should be aware of?');
  if (c.logins != null && c.logins < 10) questions.push('What does a typical week look like for your team using the platform?');
  if (c.adoption != null && c.adoption < 50) questions.push('Are there specific features you\'ve wanted to explore?');
  if (c.tickets != null && c.tickets >= 3) questions.push('How has your experience with our support team been?');
  if (lc !== 'onboarding' && lc !== 'won' && (c.growth === 'strong' || c.status === 'expand')) questions.push('Are there additional users or departments that could benefit from the platform?');
  if (c.renewal != null && c.renewal <= 6) questions.push('As we approach renewal, is there anything you\'d like to see from us?');
  questions.push('What would make our partnership even more valuable over the next 6 months?');

  const recentNotes = (c.notes || []).slice(0, 3).map(n => `  • [${fmtDate(n.date)}] ${n.text}`).join('\n');

  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QBR MEETING PREP — ${c.name.toUpperCase()}
Generated: ${date} · IQcadence CS Health Score
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ACCOUNT SNAPSHOT
  Health Score:    ${c.score} / 100  (${sl})
  Momentum:        ${momLabels[mom] || '—'}
  Score Trend:     ${histLine}
  MRR:             ${c.mrr ? '$' + fmtNum(c.mrr) : '—'}
  Tier:            ${tierMap[c.tier] || c.tier || '—'}
  Lifecycle:       ${c.lifecycle || '—'}
  Renewal:         ${c.renewal != null ? c.renewal + ' months' + (u ? ' — ' + u.label + ' urgency' : '') : '—'}

EXECUTIVE SUMMARY
  ${summary}
${wins.length ? `\nWINS & HIGHLIGHTS\n${wins.map(w => '  ✓ ' + w).join('\n')}` : ''}
${risks.length ? `\nRISKS & CONCERNS\n${risks.map(r => '  ⚠ ' + r).join('\n')}` : ''}

SUGGESTED AGENDA
${agenda.map(a => '  ' + a).join('\n')}

QUESTIONS TO ASK
${questions.map(q => '  ? ' + q).join('\n')}
${recentNotes ? `\nMEETING CONTEXT — RECENT NOTES\n${recentNotes}` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Prepared with IQ Cadence · iqcadence.com
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

function copyQBR() {
  const c = customers.find(x => x.id === detailId);
  const text = c ? buildQBRText(c) : el('qbr-content').textContent;
  navigator.clipboard.writeText(text).then(() => {
    toast('Copied to clipboard!', 'success');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Copied to clipboard!', 'success');
  });
}

function printQBR() {
  const pa = document.getElementById('print-area');
  pa.style.display = 'block';
  pa.innerHTML = `
    <style>
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;padding:32px;max-width:800px;margin:0 auto}
      .qbr-hdr{display:flex;gap:16px;align-items:center;padding:16px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:16px}
      .qbr-score{width:72px;height:72px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-weight:800;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .qbr-score-num{font-size:1.5rem;line-height:1}.qbr-score-lbl{font-size:var(--fs-2xs);text-transform:uppercase;letter-spacing:.5px;opacity:.9;margin-top:2px}
      .qbr-meta h3{margin:0 0 4px;font-size:1rem}
      .qbr-section{margin-bottom:14px}.qbr-section-title{font-size:var(--fs-sm);font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#64748b;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:7px}
      .qbr-summary{font-size:var(--fs-base);line-height:1.7;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .qbr-wins,.qbr-risks,.qbr-questions{display:grid;gap:2px}
      .qbr-win-row,.qbr-risk-row,.qbr-q-row{display:flex;align-items:center;gap:10px;padding:5px 8px;font-size:var(--fs-base)}
      .qbr-win-row:nth-child(odd),.qbr-risk-row:nth-child(odd),.qbr-q-row:nth-child(odd){background:#f8fafc;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .qbr-win-dot{width:8px;height:8px;border-radius:50%;background:#16a34a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .qbr-risk-dot{width:8px;height:8px;border-radius:50%;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .qbr-risk--high .qbr-risk-dot{background:#dc2626}.qbr-risk--med .qbr-risk-dot{background:#d97706}
      .qbr-agenda{display:grid;gap:6px}
      .qbr-agenda-item{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px}
      .qbr-agenda-num{width:26px;height:26px;border-radius:50%;background:#2563eb;color:#fff;font-size:var(--fs-sm);font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .qbr-agenda-topic{font-weight:700;font-size:var(--fs-base)}.qbr-agenda-time{font-weight:500;font-size:var(--fs-xs);color:#64748b;margin-left:6px}
      .qbr-agenda-detail{font-size:var(--fs-sm);color:#64748b;line-height:1.5;margin-top:3px}
      .qbr-q-bullet{width:20px;height:20px;border-radius:50%;background:#eff6ff;color:#2563eb;font-size:var(--fs-sm);font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .qbr-note{padding:6px 10px;border-left:3px solid #2563eb;background:#f8fafc;border-radius:0 6px 6px 0;font-size:var(--fs-base);margin-bottom:6px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .qbr-note-date{font-size:var(--fs-xs);color:#64748b;font-weight:600;margin-bottom:2px;text-transform:uppercase;letter-spacing:.3px}
      .qbr-tag{font-size:var(--fs-sm);padding:2px 8px;border:1px solid #e2e8f0;border-radius:100px;display:inline-block;margin-right:4px}
      .qbr-meta-tags{margin-top:6px}.qbr-footer{text-align:center;font-size:var(--fs-xs);color:#94a3b8;padding-top:10px;border-top:1px solid #e2e8f0;margin-top:8px}
    </style>
    ${el('qbr-content').innerHTML}`;
  window.print();
  setTimeout(() => { pa.style.display = 'none'; pa.innerHTML = ''; }, 1000);
}

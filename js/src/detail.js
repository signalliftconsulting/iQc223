// ─── SCORE FORM ─────────────────────────────────────────────
function rv(key, val) {
  document.getElementById('rv-' + key).textContent = val;
}

function getFormData() {
  return {
    name:     document.getElementById('f-name').value.trim(),
    manager:  (()=>{ const nEl=document.getElementById('f-manager-new'); if(nEl&&nEl.style.display!=='none'&&nEl.value.trim()) return nEl.value.trim(); const sEl=document.getElementById('f-manager'); return (sEl&&sEl.value&&sEl.value!=='__add_new__') ? sEl.value : ''; })(),
    mrr:      parseFloat(document.getElementById('f-mrr').value)      || 0,
    arr:      parseFloat(document.getElementById('f-arr')?.value)     || 0,
    since:    document.getElementById('f-since')?.value               || '',
    tier:     document.getElementById('f-tier').value,
    lifecycle:document.getElementById('f-lifecycle').value,
    tags:     document.getElementById('f-tags').value.split(',').map(t=>t.trim()).filter(Boolean),
    logins:   parseInt(document.getElementById('f-logins').value)     || 0,
    adoption: parseInt(document.getElementById('f-adoption').value)   || 0,
    tickets:  parseInt(document.getElementById('f-tickets').value)    || 0,
    nps:      document.getElementById('f-nps').value,
    days:         parseInt(document.getElementById('f-days').value)   || 0,
    renewal_date: document.getElementById('f-renewal-date')?.value || '',
    renewal:      (function() {
      const d = document.getElementById('f-renewal-date')?.value;
      if (!d) return 0;
      const ms = new Date(d) - new Date();
      return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24 * 30.44)));
    })(),
    growth:   document.getElementById('f-growth').value,
    note:     document.getElementById('f-note').value.trim(),
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

  // ── Validation ──────────────────────────────────────────────
  if (!data.name) { toast('Customer name is required', 'error'); return; }
  if (data.mrr < 0)       { toast('MRR cannot be negative', 'error'); return; }
  if (data.logins < 0 || data.logins > 30)   { toast('Logins must be between 0 and 30', 'error'); return; }
  if (data.adoption < 0 || data.adoption > 100){ toast('Adoption must be between 0% and 100%', 'error'); return; }
  if (data.tickets < 0)   { toast('Tickets cannot be negative', 'error'); return; }
  if (data.days < 0)      { toast('Days since contact cannot be negative', 'error'); return; }

  // Resolve weights: per-customer profile overrides global weights
  const matchedProfile = data.profile ? profiles.find(p => p.name === data.profile) : null;
  const resolvedWeights = matchedProfile ? matchedProfile.weights : weights;

  const { score, signals } = calcScore(data, resolvedWeights);
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

  // Score ring
  document.getElementById('score-num').textContent = score;
  const circ = 2 * Math.PI * 58;
  const fill = document.getElementById('ring-fill');
  fill.style.stroke           = STATUS_COLOR[status] || '#16a34a';
  fill.style.strokeDasharray  = circ;
  fill.style.strokeDashoffset = circ - (score / 100) * circ;

  // Badge
  const badgeEl = document.getElementById('score-badge');
  badgeEl.className   = 'badge badge-' + (STATUS_CSS[status] || 'healthy');
  badgeEl.textContent = STATUS_LABEL[status] || 'Healthy';

  // Rec
  document.getElementById('score-rec').innerHTML = rec;

  // Breakdown
  const bd = document.getElementById('breakdown-wrap');
  const signalDefs = [
    { key:'logins_n',   label:'Login Frequency',    color:'var(--blue)' },
    { key:'adoption_n', label:'Feature Adoption',   color:'var(--green)' },
    { key:'tickets_n',  label:'Support Health',     color:'var(--red)' },
    { key:'nps_n',      label:'NPS / CSAT',         color:'var(--purple)' },
    { key:'days_n',     label:'Contact Recency',    color:'var(--teal)' },
    { key:'growth_n',   label:'Growth Signal',      color:'var(--green)' }
  ];
  bd.innerHTML = signalDefs.map(s => `
    <div class="bd-row">
      <div class="bd-label">${s.label}</div>
      <div class="bd-bar"><div class="bd-fill" style="width:${Math.round(signals[s.key])}%;background:${s.color}"></div></div>
      <div class="bd-score">${Math.round(signals[s.key])}</div>
    </div>`).join('');

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
    logins:    data.logins    ?? null,
    adoption:  data.adoption  ?? null,
    tickets:   data.tickets   ?? null,
    nps:       data.nps       ?? null,
    days:      data.days      ?? null,
    growth:    data.growth    ?? null,
    lifecycle: data.lifecycle ?? null,
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
      parts.push(`NPS: ${curr.nps}`);
    } else if (curr.nps !== prev.nps) {
      parts.push(`NPS changed: ${prev.nps}→${curr.nps}`);
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
        dupe.logins          = data.logins;
        dupe.adoption        = data.adoption;
        dupe.tickets         = data.tickets;
        dupe.nps             = data.nps;
        dupe.days            = data.days;
        dupe._baseDays       = data.days;
        dupe.renewal         = data.renewal;
        dupe.renewal_date    = data.renewal_date || '';
        dupe.growth          = data.growth;
        dupe.mrr             = data.mrr;
        dupe.arr             = data.arr || (data.mrr * 12);
        dupe.since           = data.since || '';
        dupe.tier            = data.tier;
        dupe.lifecycle       = data.lifecycle;
        dupe.tags            = data.tags;
        dupe.scoring_profile = data.profile || '';
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
        nav('customers');
      }
    );
    return;
  }

  const cust = {
    id:              crypto.randomUUID(),
    name:            data.name,
    manager:         data.manager || '',
    scoring_profile: data.profile || '',
    mrr:             data.mrr,
    arr:             data.arr || (data.mrr * 12),
    since:           data.since || '',
    tier:            data.tier,
    lifecycle:       data.lifecycle,
    tags:            data.tags,
    logins:          data.logins,
    adoption:        data.adoption,
    tickets:         data.tickets,
    nps:             data.nps,
    days:            data.days,
    _baseDays:       data.days,
    renewal:         data.renewal,
    renewal_date:    data.renewal_date || '',
    growth:          data.growth,
    score,
    status,
    notes:    data.note ? [{ text: data.note, date: new Date().toISOString() }] : [],
    history:  [{ score, date: new Date().toISOString(), signals: buildHistorySnapshot(data) }],
    created:  new Date().toISOString()
  };
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
  nav('dashboard');
}

function resetForm() {
  document.getElementById('score-form').reset();
  document.getElementById('rv-logins').textContent   = '10 days';
  document.getElementById('rv-adoption').textContent = '50%';
  document.getElementById('rv-days').textContent     = '14 days';
  document.getElementById('f-logins').value   = 10;
  document.getElementById('f-adoption').value = 50;
  document.getElementById('f-days').value     = 14;
  document.getElementById('result-card').style.display        = 'none';
  document.getElementById('result-placeholder').style.display = 'block';
  document.getElementById('form-title').textContent = 'Score a Customer';
  pendingResult = null;
  document.getElementById('score-form').dataset.editId = '';
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
      .badge{display:inline-block;background:${colors[status]}22;color:${colors[status]};padding:4px 14px;border-radius:100px;font-weight:700;font-size:.88rem;border:1.5px solid ${colors[status]}55}
      .rec{background:#f1f5f9;border-left:4px solid ${colors[status]};padding:10px 14px;border-radius:4px;font-size:.88rem;line-height:1.6;margin-bottom:16px}
      .play{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:.84rem}
      table{width:100%;border-collapse:collapse;font-size:.82rem;margin-top:8px}
      th{text-align:left;color:#64748b;font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid #e2e8f0;padding:5px 8px}
      td{padding:6px 8px;border-bottom:1px solid #f1f5f9}
      .footer-p{margin-top:32px;font-size:.7rem;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
    </style>
    <h1>IQcadence Health Report — ${name}</h1>
    <p style="color:#64748b;font-size:.82rem">Generated ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} · IQcadence CS Health Score</p>
    <div style="margin:16px 0;display:flex;align-items:center;gap:20px;flex-wrap:wrap">
      <div class="score-big">${score}</div>
      <div>
        <div class="badge">${labels[status]}</div>
        <div style="margin-top:6px;font-size:.8rem;color:#64748b">MRR: $${(data.mrr||0).toLocaleString()} · Tier: ${(data.tier||'').toUpperCase()} · Stage: ${data.lifecycle||'—'}</div>
      </div>
    </div>
    <div class="rec">${rec.replace(/<[^>]+>/g,'')}</div>
    <h2>Signal Inputs</h2>
    <table>
      <tr><th>Signal</th><th>Value</th></tr>
      <tr><td>Login Frequency (30d)</td><td>${data.logins} days</td></tr>
      <tr><td>Feature Adoption</td><td>${data.adoption}%</td></tr>
      <tr><td>Open Support Tickets</td><td>${data.tickets}</td></tr>
      <tr><td>NPS / CSAT</td><td>${data.nps}</td></tr>
      <tr><td>Days Since Contact</td><td>${data.days}</td></tr>
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
  const logs = c.sentiment || [];
  const icons = { positive:'😊', neutral:'😐', negative:'😟' };
  const labels = { positive:'Positive', neutral:'Neutral', negative:'Negative' };

  el('dm-sentiment-list').innerHTML = logs.length
    ? logs.map((s,i) => `
        <div class="sent-log">
          <div class="sent-log__icon">${icons[s.val]||'😐'}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:.8rem">${labels[s.val]||s.val}</div>
            ${s.note ? `<div style="font-size:.75rem;color:var(--muted);margin-top:1px">${escHtml(s.note)}</div>` : ''}
          </div>
          <div class="sent-log__meta">${fmtDate(s.date)}</div>
          <button class="btn btn-xs btn-danger" style="margin-left:6px" onclick="deleteSentiment(${i})">✕</button>
        </div>`).join('')
    : '<p style="font-size:.82rem;color:var(--muted)">No sentiment logs yet. Log one above.</p>';
}

function deleteSentiment(idx) {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  c.sentiment.splice(idx,1);
  renderDetailSentiment();
  save(c).catch(e => console.error('Sentiment delete sync failed:', e));
}

// Latest sentiment for a customer
function latestSentiment(c) {
  try {
    const s = Array.isArray(c.sentiment) ? c.sentiment : (typeof c.sentiment === 'string' ? JSON.parse(c.sentiment) : []);
    return s.length ? s[0] : null;
  } catch(e) { return null; }
}

// ─── CUSTOMER DETAIL MODAL ───────────────────────────────────
function openDetail(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  detailId = id;

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

  dtab('overview');
  openModal('detail-modal');
}

function dtab(which) {
  ['overview','playbook','notes','sentiment','history'].forEach(t => {
    el('dt-'+t)?.classList.toggle('active', t===which);
    el('dp-'+t)?.classList.toggle('active', t===which);
  });
  if (which === 'overview')  renderDetailOverview();
  if (which === 'playbook')  { if (hasFeature('playbooks')) renderDetailPlaybook(); else el('dm-playbook').innerHTML = upgradeHTML('playbooks'); }
  if (which === 'notes')     renderDetailNotes();
  if (which === 'sentiment') { if (hasFeature('sentiment')) renderDetailSentiment(); else el('dm-sentiment-list').innerHTML = upgradeHTML('sentiment'); }
  if (which === 'history')   renderDetailHistory();
}

function renderDetailOverview() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const { signals } = calcScore(c, getActiveWeights(c));
  const rec    = makeRec(c.score, c);
  const delta  = scoreDelta(c);
  const cad    = getCadenceStatus(c);
  const sent   = latestSentiment(c);
  const nba    = buildNextBestAction(c);
  const sentIcon = sent ? ({ positive:'😊', neutral:'😐', negative:'😟' }[sent.val]||'') : null;
  // Map nba.level to urgency color
  const nbaColors = {
    urgent:'var(--red)', warn:'var(--amber)', expand:'var(--green)',
    renew:'var(--teal)', ok:'var(--blue)'
  };
  const nbaColor = nbaColors[nba.level] || 'var(--blue)';

  el('dm-overview').innerHTML = `
    <!-- Next Best Action banner -->
    <div style="background:${nbaColor}0f;border:1.5px solid ${nbaColor}33;border-radius:var(--r);padding:13px 15px;margin-bottom:16px">
      <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:${nbaColor};margin-bottom:5px">Next Best Action</div>
      <div style="font-weight:700;font-size:.9rem;color:var(--text);margin-bottom:5px">${nba.action}</div>
      <div style="font-size:.79rem;color:var(--muted);line-height:1.6">${nba.talk}</div>
    </div>
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;flex-wrap:wrap">
      ${buildRingHTML(c.score, c.status)}
      <div style="flex:1;min-width:0">
        <div style="font-size:2rem;font-weight:800;line-height:1;letter-spacing:-.03em">${c.score}<span style="font-size:.9rem;font-weight:500;color:var(--muted)"> / 100</span></div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${badgeHTML(c.status)}
          ${momentumHTML(c)}
          ${deltaHTML(delta)}
        </div>
        <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;font-size:.78rem">
          <div>
            <label style="display:block;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:2px">Manager</label>
            <select id="di-manager" onchange="if(this.value==='__add_new__'){this.style.display='none';document.getElementById('di-manager-new').style.display='';document.getElementById('di-manager-new').focus()}" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.78rem;background:var(--bg);color:var(--text)">${buildManagerSelectOptions(c.manager||'')}</select>
            <input type="text" id="di-manager-new" placeholder="New manager name..." style="display:none;width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.78rem;background:var(--bg);color:var(--text);margin-top:4px" onblur="if(!this.value){this.style.display='none';document.getElementById('di-manager').style.display='';document.getElementById('di-manager').value=''}" />
          </div>
          <div>
            <label style="display:block;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:2px">Tier</label>
            <select id="di-tier" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.78rem;background:var(--bg);color:var(--text)">
              <option value="smb" ${c.tier==='smb'?'selected':''}>SMB</option>
              <option value="mid" ${c.tier==='mid'?'selected':''}>Mid-Market</option>
              <option value="enterprise" ${c.tier==='enterprise'?'selected':''}>Enterprise</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:2px">Lifecycle</label>
            <select id="di-lifecycle" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.78rem;background:var(--bg);color:var(--text)">
              <option value="onboarding" ${c.lifecycle==='onboarding'?'selected':''}>Onboarding</option>
              <option value="active" ${c.lifecycle==='active'?'selected':''}>Active</option>
              <option value="atrisk" ${c.lifecycle==='atrisk'?'selected':''}>At Risk</option>
              <option value="won" ${c.lifecycle==='won'?'selected':''}>Won/Upsold</option>
              <option value="churned" ${c.lifecycle==='churned'?'selected':''}>Churned</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:2px">Next Touch</label>
            <input type="date" id="di-next-touch" value="${c.next_touch||''}" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.78rem;background:var(--bg);color:var(--text)" />
          </div>
          <div style="grid-column:1/-1">
            <label style="display:block;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:2px">Tags</label>
            <input type="text" id="di-tags" value="${escHtml((c.tags||[]).join(', '))}" placeholder="Comma-separated" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.78rem;background:var(--bg);color:var(--text)" />
          </div>
        </div>
        <div style="margin-top:6px;font-size:.76rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:10px">
          <span>MRR: <strong style="color:var(--text)">${c.mrr ? '$'+fmtNum(c.mrr) : '—'}</strong></span>
          ${c.scoring_profile ? `<span>Profile: <strong style="color:var(--text)">${escHtml(c.scoring_profile)}</strong></span>` : ''}
        </div>
      </div>
    </div>
    <!-- Signals row: cadence + urgency + sentiment -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;background:var(--bg);border-radius:var(--r);border:1px solid var(--border)">
      <div style="flex:1;min-width:110px">
        <div style="font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:3px">Check-in</div>
        <span class="${cad.cls}">${cad.label}</span>
      </div>
      <div style="flex:1;min-width:110px">
        <div style="font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:3px">Renewal</div>
        ${c.renewal != null ? urgencyHTML(c) + ` <span style="font-size:.7rem;color:var(--muted);margin-left:4px">(${c.renewal}mo)</span>` : '<span style="font-size:.75rem;color:var(--muted)">—</span>'}
      </div>
      <div style="flex:1;min-width:110px">
        <div style="font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:3px">Last Vibe</div>
        ${sentIcon ? `<span style="font-size:.85rem">${sentIcon}</span> <span style="font-size:.75rem;color:var(--muted)">${fmtDate(sent.date)}</span>` : '<span style="font-size:.75rem;color:var(--muted)">—</span>'}
      </div>
      <div style="flex:1;min-width:110px">
        <div style="font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--subtle);margin-bottom:3px">Next Touch</div>
        ${(()=>{
          if (!c.next_touch) return '<span style="font-size:.75rem;color:var(--muted)">Not scheduled</span>';
          const ntDays = Math.round((new Date(c.next_touch) - new Date()) / 86400000);
          if (ntDays < 0)  return `<span class="nt-badge nt-overdue">Overdue ${Math.abs(ntDays)}d</span>`;
          if (ntDays === 0) return `<span class="nt-badge nt-today">Today</span>`;
          return `<span class="nt-badge nt-ok">in ${ntDays}d</span>`;
        })()}
      </div>
    </div>
    <div class="rec-box" style="margin-bottom:14px">${rec}</div>
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      <button class="btn btn-primary btn-sm" onclick="saveDetailInline()" style="gap:4px">💾 Save Changes</button>
    </div>
    <div class="bd-title">Signal Breakdown</div>
    ${buildBreakdownHTML(signals, c)}
  `;
}

async function saveDetailInline() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;

  const mgrSelect = document.getElementById('di-manager');
  const mgrNew    = document.getElementById('di-manager-new');
  const tierInput = document.getElementById('di-tier');
  const lcInput  = document.getElementById('di-lifecycle');
  const ntInput  = document.getElementById('di-next-touch');
  const tagsInput = document.getElementById('di-tags');

  if (mgrNew && mgrNew.style.display !== 'none' && mgrNew.value.trim()) {
    c.manager = mgrNew.value.trim();
  } else if (mgrSelect && mgrSelect.value && mgrSelect.value !== '__add_new__') {
    c.manager = mgrSelect.value;
  }
  if (tierInput) c.tier      = tierInput.value;
  if (lcInput)   c.lifecycle = lcInput.value;
  if (ntInput)   c.next_touch = ntInput.value || null;
  if (tagsInput) {
    c.tags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
  }

  try {
    await save(c);
    refreshMgrDropdown();
    renderDetailOverview();
    // Update modal header subtitle
    el('dm-sub').innerHTML = `
      ${badgeHTML(c.status)} ${lifecycleBadge(c.lifecycle)}
      <span style="margin-left:6px;color:var(--muted)">Score: <strong>${c.score}</strong></span>
      ${c.mrr ? `<span style="margin-left:6px;color:var(--muted)">MRR: <strong>$${fmtNum(c.mrr)}</strong></span>` : ''}
    `;
    toast('Changes saved', 'success');
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
  const total = (w.logins + w.adoption + w.tickets + w.nps + w.days + w.growth) || 100;
  const defs = [
    { key:'logins_n',   label:'Login Frequency', color:'var(--blue)',   weight:w.logins,   raw: c ? `${c.logins} logins/mo`  : '' },
    { key:'adoption_n', label:'Feature Adoption', color:'var(--green)',  weight:w.adoption, raw: c ? `${c.adoption}% adopted`  : '' },
    { key:'tickets_n',  label:'Support Health',   color:'var(--red)',    weight:w.tickets,  raw: c ? `${c.tickets} tickets`    : '' },
    { key:'nps_n',      label:'NPS / CSAT',       color:'var(--purple)', weight:w.nps,      raw: c ? c.nps                     : '' },
    { key:'days_n',     label:'Contact Recency',  color:'var(--teal)',   weight:w.days,     raw: c ? `${c.days}d ago`          : '' },
    { key:'growth_n',   label:'Growth Signal',    color:'var(--green)',  weight:w.growth,   raw: c ? c.growth                  : '' }
  ];
  return defs.map(d => `
    <div class="bd-row">
      <div class="bd-label">${d.label}</div>
      <div class="bd-weight">${Math.round((d.weight / total) * 100)}%</div>
      <div class="bd-bar"><div class="bd-fill" style="width:${Math.round(signals[d.key])}%;background:${d.color}"></div></div>
      <div class="bd-score">${Math.round(signals[d.key])}</div>
      ${d.raw ? `<div class="bd-raw">${d.raw}</div>` : ''}
    </div>`).join('');
}

function renderDetailPlaybook() {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  const plays = buildPlaybook(c.score, c);
  const playTypeMap2 = { urgent:'U', engage:'E', coach:'C', adopt:'A', support:'S', expand:'X', renew:'R', ok:'OK' };
  const playClsMap2  = { urgent:'play-urgent', engage:'play-engage', coach:'play-coach', adopt:'play-adopt', support:'play-support', expand:'play-expand', renew:'play-renew', ok:'play-ok' };
  const checks = c.playbook_checks || {};
  const done = Object.keys(checks).length;
  const pct  = plays.length ? Math.round((done / plays.length) * 100) : 0;
  const header = plays.length > 1
    ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div class="playbook-title" style="margin:0">Action Playbook for ${escHtml(c.name)}</div>
        <span style="margin-left:auto;font-size:.72rem;color:var(--muted)">${done}/${plays.length} done</span>
        <div style="width:60px;height:5px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:var(--green);border-radius:3px"></div>
        </div>
      </div>`
    : `<div class="playbook-title" style="margin-bottom:10px">Action Playbook for ${escHtml(c.name)}</div>`;
  el('dm-playbook').innerHTML = header +
    plays.map((p, i) => {
      const checked = !!checks[i];
      const cls = playClsMap2[p.type] || '';
      const ltr = playTypeMap2[p.type] || '!';
      return `<label class="play-item${checked ? ' play-done' : ''}">
        <input type="checkbox" style="flex-shrink:0;margin-top:2px" ${checked ? 'checked' : ''} onchange="togglePlayCheck(${i},this.checked)" onclick="event.stopPropagation()">
        <div class="play-item__icon ${cls}">${ltr}</div>
        <div class="play-item__text">${p.text}</div>
      </label>`;
    }).join('');
}

function togglePlayCheck(idx, checked) {
  const c = customers.find(x => x.id === detailId);
  if (!c) return;
  c.playbook_checks = c.playbook_checks || {};
  if (checked) c.playbook_checks[idx] = true;
  else delete c.playbook_checks[idx];
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
    : '<p style="font-size:.82rem;color:var(--muted)">No notes yet. Add one below.</p>';
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
    : '<p style="font-size:.8rem;color:var(--muted)">Score at least twice to see trend.</p>';

  // List — newest first; arr[i+1] = previous (older) entry
  el('dm-history-list').innerHTML = hist.length
    ? [...hist].reverse().map((h, i, arr) => {
        const dotColor = STATUS_COLOR[getStatus(h.score)] || '#16a34a';
        const prev = arr[i + 1];

        // Score delta badge
        let deltaHtml = '';
        if (prev != null) {
          const d = h.score - prev.score;
          if      (d > 0) deltaHtml = `<span class="delta-up" style="font-size:.72rem">▲${d}</span>`;
          else if (d < 0) deltaHtml = `<span class="delta-dn" style="font-size:.72rem">▼${Math.abs(d)}</span>`;
          else             deltaHtml = `<span class="delta-eq" style="font-size:.72rem">→0</span>`;
        }

        // Signal diff — what actually changed
        const changes = diffSnapshots(h.signals || null, prev ? (prev.signals || null) : null);
        let reasonHtml = '';
        if (changes.length) {
          reasonHtml = `<div class="hist-reason">${changes.map(escHtml).join(' &nbsp;·&nbsp; ')}</div>`;
        } else if (!prev) {
          reasonHtml = `<div class="hist-reason" style="font-style:italic">Initial score entry</div>`;
        } else if (!h.signals) {
          // Old entry with no signals stored — just say no detail available
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
      }).join('')
    : '<p style="font-size:.82rem;color:var(--muted)">No history yet.</p>';
}

function buildSparkline(values, w, h) {
  if (values.length < 2) return '';
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 100);
  const range = max - min || 1;
  const xStep = (w - 10) / (values.length - 1);
  const points = values.map((v,i) => {
    const x = 5 + i * xStep;
    const y = h - 5 - ((v - min) / range) * (h - 10);
    return `${x},${y}`;
  }).join(' ');
  const last  = values[values.length-1];
  const prev  = values[values.length-2];
  const color = last > prev ? '#16a34a' : last < prev ? '#dc2626' : '#64748b';
  return `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="sparkline">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${values.map((v,i)=>{
        const x = 5+i*xStep, y = h-5-((v-min)/range)*(h-10);
        return `<circle cx="${x}" cy="${y}" r="3" fill="${color}" opacity="${i===values.length-1?1:.5}"/>`;
      }).join('')}
    </svg>`;
}

// Mini sparkline for customer table cells — reuses buildSparkline() at small scale
function buildSparklineMini(c) {
  const hist = (c.history||[]).slice(-10); // last 10 score points
  if (hist.length < 2) return '<span style="color:var(--subtle);font-size:.7rem">—</span>';
  return buildSparkline(hist.map(h=>h.score), 72, 22);
}

function editCustomer(id) {
  const cid = id || detailId;
  if (!cid) return;
  const c = customers.find(x => x.id === cid);
  if (!c) return;

  closeModal('detail-modal');
  nav('score');
  document.getElementById('form-title').textContent = 'Re-score: ' + c.name;
  document.getElementById('score-form').dataset.editId = c.id;

  el('f-name').value     = c.name;
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
  el('f-logins').value   = c.logins;     rv('logins',   c.logins+'  days');
  el('f-adoption').value = c.adoption;   rv('adoption', c.adoption+'%');
  el('f-tickets').value  = c.tickets;
  el('f-nps').value      = c.nps;
  el('f-days').value     = c.days;       rv('days', c.days+' days');
  if (el('f-renewal-date')) el('f-renewal-date').value = c.renewal_date || '';
  if (el('f-next-touch'))  el('f-next-touch').value  = c.next_touch   || '';
  el('f-growth').value   = c.growth || 'none';
  el('f-note').value     = '';

  // Override saveScore to update in-place
  window._editMode = c.id;
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
      const before = { name:c.name, manager:c.manager||'', score:c.score, status:c.status, mrr:c.mrr, arr:c.arr, tier:c.tier, lifecycle:c.lifecycle, logins:c.logins, adoption:c.adoption, tickets:c.tickets, nps:c.nps, days:c.days, growth:c.growth||'none', scoring_profile:c.scoring_profile||'' };
      c.name            = data.name;
      c.manager         = data.manager || '';
      c.scoring_profile = data.profile || '';
      c.score           = score;
      c.status          = status;
      c.logins          = data.logins;
      c.adoption        = data.adoption;
      c.tickets         = data.tickets;
      c.nps             = data.nps;
      c.days            = data.days;
      c._baseDays       = data.days;
      c.renewal         = data.renewal;
      c.renewal_date    = data.renewal_date || '';
      c.next_touch      = (el('f-next-touch') ? el('f-next-touch').value : '') || '';
      c.growth          = data.growth;
      c.mrr             = data.mrr;
      c.arr             = data.arr || (data.mrr * 12);
      c.since           = data.since || '';
      c.tier            = data.tier;
      c.lifecycle       = data.lifecycle;
      c.tags            = data.tags;
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
      const after = { name:c.name, manager:c.manager, score, status, mrr:c.mrr, arr:c.arr, tier:c.tier, lifecycle:c.lifecycle, logins:c.logins, adoption:c.adoption, tickets:c.tickets, nps:c.nps, days:c.days, growth:c.growth||'none', scoring_profile:c.scoring_profile||'' };
      const changes = Object.keys(after).filter(k => String(before[k]) !== String(after[k])).map(k => `${k}: ${before[k]} → ${after[k]}`);
      const summaryText = changes.length ? changes.join(', ') : 'Re-scored (no field changes)';
      logAudit('customer_updated', c.id, c.name, { score, status, summary: summaryText });
      pendingResult = null;
      resetForm();
      nav('customers');
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
    renderCustomers();
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
  logAudit('qbr_opened', c.id, c.name, { summary: 'QBR Prep opened' });
  el('qbr-title').textContent = c.name;
  el('qbr-content').textContent = buildQBRText(c);
  closeModal('detail-modal');
  openModal('qbr-modal');
}

function buildQBRText(c) {
  const nba   = buildNextBestAction(c);
  const plays = buildPlaybook(c.score, c);
  const rec   = makeRec(c.score, c).replace(/<[^>]+>/g, '');
  const mom   = getMomentum(c);
  const cad   = getCadenceStatus(c);
  const sent  = latestSentiment(c);
  const u     = getRenewalUrgency(c);
  const momLabels = { up:'Improving', dn:'Declining', flat:'Flat', new:'New' };
  const sentLabels = { positive:'Positive', neutral:'Neutral', negative:'Negative' };
  const date  = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

  // Score history summary
  const hist = c.history || [];
  const histLine = hist.length >= 2
    ? `${hist[hist.length-2].score} → ${hist[hist.length-1].score} (${hist[hist.length-1].score > hist[hist.length-2].score ? '+' : ''}${hist[hist.length-1].score - hist[hist.length-2].score} pts)`
    : `${c.score} (first score)`;

  // Recent notes
  const recentNotes = (c.notes || []).slice(0, 3).map(n => `  • [${fmtDate(n.date)}] ${n.text}`).join('\n');

  // Plays as plain text
  const playsText = plays.map(p => `  • ${p.text.replace(/<[^>]+>/g,'')}`).join('\n');

  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QBR PREP SUMMARY — ${c.name.toUpperCase()}
Generated: ${date} · IQcadence CS Health Score
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HEALTH SNAPSHOT
  Health Score:    ${c.score} / 100  (${rec.replace(/^[^:]+:\s*/,'').split('.')[0]})
  Status:          ${STATUS_LABEL[c.status] || 'Healthy'}
  Momentum:        ${momLabels[mom] || '—'}
  Score Trend:     ${histLine}
  MRR:             ${c.mrr ? '$' + fmtNum(c.mrr) : '—'}
  Tier:            ${(c.tier || '—').toUpperCase()}
  Lifecycle:       ${c.lifecycle || '—'}
  Renewal:         ${c.renewal != null ? c.renewal + ' months' + (u ? ' — ' + u.label + ' urgency' : '') : '—'}

SIGNAL BREAKDOWN
  Login Frequency:    ${c.logins} / 30 days
  Feature Adoption:   ${c.adoption}%
  Open Tickets:       ${c.tickets}
  NPS / CSAT:         ${c.nps}
  Days Since Contact: ${c.days} days  (${cad.label})
  Growth Signal:      ${c.growth}
  Last Vibe Check:    ${sent ? sentLabels[sent.val] + ' — ' + fmtDate(sent.date) + (sent.note ? ' ("' + sent.note + '")' : '') : 'Not logged'}

NEXT BEST ACTION
  ${nba.action}
  "${nba.talk.replace(/<[^>]+>/g,'')}"

RECOMMENDED PLAYBOOK
${playsText}
${recentNotes ? `\nRECENT NOTES\n${recentNotes}` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Prepared with IQ Cadence · iqcadence.com
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

function copyQBR() {
  const text = el('qbr-content').textContent;
  navigator.clipboard.writeText(text).then(() => {
    toast('Copied to clipboard!', 'success');
  }).catch(() => {
    // Fallback for older browsers
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
  const c = customers.find(x => x.id === detailId) || {};
  const pa = document.getElementById('print-area');
  pa.style.display = 'block';
  pa.innerHTML = `
    <style>
      body{font-family:'Courier New',monospace;color:#0f172a;padding:32px;max-width:800px;margin:0 auto;font-size:.82rem;line-height:1.7}
      pre{white-space:pre-wrap;word-break:break-word}
    </style>
    <pre>${escHtml(el('qbr-content').textContent)}</pre>`;
  window.print();
  setTimeout(() => { pa.style.display = 'none'; pa.innerHTML = ''; }, 1000);
}

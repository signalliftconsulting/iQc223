// ─── CSV IMPORT ─────────────────────────────────────────────

function _dismissCsvGuide() {
  _dismissGuide('csv-guide', 'iqc_csv_guide_dismissed', true);
  const b = document.getElementById('csv-guide-badge'); if (b) b.style.display = 'none';
}

function _updateCsvGuideBadge() {
  const b = el('csv-guide-badge');
  if (!b) return;
  try { b.style.display = localStorage.getItem('iqc_csv_guide_dismissed') === '1' ? 'none' : ''; } catch(e) { b.style.display = 'none'; }
}

function _renderCsvGuide() {
  _renderGuide('csv-guide', 'iqc_csv_guide_dismissed',
    '<strong>How to use CSV Import</strong><br>' +
    '<strong>No integration?</strong> Upload a full bulksheet with all your customer data — names, MRR, signals, etc. You can also add customers one at a time via <a href="#" onclick="event.stopPropagation();nav(\'score\')" style="color:var(--teal);font-weight:600">Score a Customer</a>.<br>' +
    '<strong>Using an integration?</strong> You only need to import customer names here. Keep the other columns blank — once your integration is connected, run a sync and it will fill in MRR, tickets, NPS, and other metrics automatically for matching customers.<br>' +
    '<strong>Tip:</strong> Download the <strong>Template CSV</strong> above to see all supported columns and the expected format.<br>' +
    '<strong>Note:</strong> You can also pull in customers directly from your integration by enabling the <strong>Import new accounts</strong> toggle in <a href="#" onclick="event.stopPropagation();nav(\'settings\');setTimeout(()=>cfgTab(\'api\'),100)" style="color:var(--teal);font-weight:600">Settings → Integrations</a>.');
}
function handleDragOver(e)  { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function handleDrop(e)      { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); const f=e.dataTransfer.files[0]; if(f) parseCSVFile(f); }
function handleFile(e)      { const f=e.target.files[0]; if(f) parseCSVFile(f); }

function parseCSVFile(file) {
  const reader = new FileReader();
  reader.onload = ev => parseCSVText(ev.target.result);
  reader.readAsText(file);
}

function parseCSVText(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) { toast('CSV must have a header row and at least one data row', 'error'); return; }
  csvHeaders = parseCSVLine(lines[0]);
  csvRows    = lines.slice(1).filter(l=>l.trim()).map(parseCSVLine);
  showColumnMap();
}

function parseCSVLine(line) {
  const res = [];
  let cur = '', inQ = false;
  for (let i=0; i<line.length; i++) {
    const ch = line[i];
    if (ch==='"') { inQ=!inQ; }
    else if (ch===','&&!inQ) { res.push(cur.trim()); cur=''; }
    else { cur+=ch; }
  }
  res.push(cur.trim());
  return res;
}

const APP_FIELDS = {
  name:            { label:'Customer Name', required:true },
  manager:         { label:'Assigned Manager', required:false },
  mrr:             { label:'MRR ($)',       required:false },
  arr:             { label:'ARR ($)',       required:false },
  logins:          { label:'Logins (30d)',  required:false },
  adoption:        { label:'Adoption %',   required:false },
  tickets:         { label:'Open Tickets', required:false },
  nps:             { label:'NPS (0–10)',   required:false },
  csat:            { label:'CSAT (1–5)',  required:false },
  days:            { label:'Days Since Contact', required:false },
  renewal_date:    { label:'Renewal Date', required:false },
  renewal:         { label:'Months to Renewal',  required:false },
  growth:          { label:'Growth Signal', required:false },
  tier:            { label:'Tier',          required:false },
  tags:            { label:'Tags',          required:false },
  lifecycle:       { label:'Lifecycle',     required:false },
  since:           { label:'Customer Since', required:false },
  next_touch:        { label:'Next Touch Date',    required:false },
  last_contact_date: { label:'Last Contact Date',  required:false },
  scoring_profile:     { label:'Scoring Profile',      required:false },
  external_id:         { label:'External ID',          required:false },
  stripe_customer_id:  { label:'Stripe Customer ID',   required:false },
  hubspot_company_id:  { label:'HubSpot Company ID',   required:false },
  renewal_date:        { label:'Renewal Date',          required:false },
  note:                { label:'Note',                  required:false },
  sentiment:           { label:'Sentiment',             required:false },
  history:             { label:'History (JSON)',        required:false }
};

const FIELD_ALIASES = {
  name:            ['name','company','customer','account','customer name','company name'],
  manager:         ['manager','assigned manager','csm','cs manager','owner','account owner','rep'],
  mrr:             ['mrr','monthly recurring revenue','revenue'],
  arr:             ['arr','annual recurring revenue','annual revenue'],
  logins:          ['logins','logins_30d','login_frequency','login frequency','logins 30d'],
  adoption:        ['adoption','feature_adoption_pct','feature adoption','adoption %','adoption pct'],
  tickets:         ['tickets','open_tickets','support tickets','open tickets','support_tickets'],
  nps:             ['nps','nps_score','nps_category','nps/csat','nps category'],
  csat:            ['csat','csat_score','satisfaction','customer satisfaction'],
  days:            ['days','days_since_contact','days since contact','last contact'],
  renewal_date:    ['renewal_date','renewal date','renews on','renews'],
  renewal:         ['renewal','months_to_renewal','months to renewal','renewal months'],
  growth:          ['growth','growth_signal','growth signal'],
  tier:            ['tier','segment'],
  tags:            ['tags','labels','tag'],
  lifecycle:       ['lifecycle','stage','lifecycle stage','status'],
  since:           ['since','customer since','customer_since','start date','start_date','joined'],
  next_touch:        ['next_touch','next touch','next contact','next_contact','scheduled touch'],
  last_contact_date: ['last_contact_date','last contact date','last_contact','last touch date'],
  scoring_profile:     ['scoring_profile','scoring profile','profile','score profile'],
  external_id:         ['external_id','external id','crm id','external identifier'],
  stripe_customer_id:  ['stripe_customer_id','stripe id','stripe customer id'],
  hubspot_company_id:  ['hubspot_company_id','hubspot id','hubspot company id'],
  note:                ['note','notes','comment','comments'],
  sentiment:           ['sentiment','sentiment value','customer sentiment'],
  history:             ['history','score history','health history']
};

function autoMap() {
  const mapping = {};
  Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
    const match = csvHeaders.findIndex(h => aliases.includes(h.toLowerCase().trim()));
    mapping[field] = match >= 0 ? match : -1;
  });
  return mapping;
}

/* Normalize various date formats → YYYY-MM-DD (ISO) for <input type="date"> & new Date() */
function normalizeDate(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';

  // Already ISO YYYY-MM-DD (with optional time portion)
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // MM/DD/YYYY or M/D/YYYY or MM-DD-YYYY
  const usMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (usMatch) {
    const [, m, d, y] = usMatch;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // MM/DD/YY or M/D/YY (2-digit year)
  const shortMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (shortMatch) {
    const [, m, d, yy] = shortMatch;
    const y = parseInt(yy) > 50 ? '19' + yy : '20' + yy;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // "Jan 15, 2026" / "January 15, 2026" / "15 Jan 2026"
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const namedMatch = s.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (namedMatch) {
    const mon = months[namedMatch[1].slice(0,3).toLowerCase()];
    if (mon) return `${namedMatch[3]}-${mon}-${namedMatch[2].padStart(2,'0')}`;
  }
  const namedMatch2 = s.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (namedMatch2) {
    const mon = months[namedMatch2[2].slice(0,3).toLowerCase()];
    if (mon) return `${namedMatch2[3]}-${mon}-${namedMatch2[1].padStart(2,'0')}`;
  }

  // Excel serial number (days since 1899-12-30)
  const num = parseFloat(s);
  if (!isNaN(num) && num > 30000 && num < 100000) {
    const d = new Date((num - 25569) * 86400000);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
  }

  // Last resort: try native Date parsing
  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) return fallback.toISOString().slice(0,10);

  return ''; // unrecognizable
}

function showColumnMap() {
  const auto = autoMap();
  const wrap = el('col-map-rows');
  wrap.innerHTML = Object.entries(APP_FIELDS).map(([field,meta]) => {
    const opts = csvHeaders.map((h,i)=>`<option value="${i}" ${auto[field]===i?'selected':''}>${h}</option>`).join('');
    return `
      <div class="col-map">
        <div style="font-size:.8rem;font-weight:600">${meta.label}${meta.required?' *':''}</div>
        <div class="col-map__arrow">→</div>
        <select id="cm-${field}">
          <option value="-1">— skip —</option>
          ${opts}
        </select>
      </div>`;
  }).join('');
  el('csv-map-wrap').style.display    = 'block';
  el('csv-prev-wrap').style.display   = 'none';
}

function applyMapping() {
  const mapping = {};
  Object.keys(APP_FIELDS).forEach(f => {
    mapping[f] = parseInt(el('cm-'+f)?.value ?? -1);
  });
  if (mapping.name < 0) { toast('Customer Name column is required', 'error'); return; }

  const growMap = { strong:['strong'], mild:['mild'], none:['none','flat',''] };

  const parsed = csvRows.map((row,ri) => {
    const get = (f, def='') => mapping[f]>=0 ? (row[mapping[f]]||'').trim() : def;
    // "CLEAR" keyword: explicitly clears a field (case-insensitive)
    const isClr = (f) => get(f).toLowerCase() === 'clear';

    // NPS: accept numeric 0-10, legacy categories, or encoded formats
    const npsRaw = get('nps','').trim();
    let nps = null;
    if (isClr('nps')) { nps = null; }
    else if (npsRaw && npsRaw !== 'unknown' && npsRaw !== 'N/A') {
      const num = parseFloat(npsRaw);
      if (!isNaN(num)) { nps = Math.max(0, Math.min(10, Math.round(num))); }
      else {
        const legacy = { promoter:10, passive:7, detractor:3 };
        if (legacy[npsRaw.toLowerCase()] !== undefined) nps = legacy[npsRaw.toLowerCase()];
      }
    }
    // CSAT: accept numeric 1-5
    const csatRaw = get('csat','').trim();
    let csat = null;
    if (isClr('csat')) { csat = null; }
    else if (csatRaw && csatRaw !== 'unknown' && csatRaw !== 'N/A') {
      const num = parseFloat(csatRaw);
      if (!isNaN(num)) { csat = Math.max(1, Math.min(5, Math.round(num))); }
    }
    const growRaw = isClr('growth') ? 'none' : get('growth','none').toLowerCase();
    let growth = 'none';
    Object.entries(growMap).forEach(([k,vs])=>{ if(vs.includes(growRaw)) growth=k; });

    const sentRaw = isClr('sentiment') ? '' : get('sentiment','').toLowerCase();
    const sentVal = ['positive','neutral','negative'].includes(sentRaw) ? sentRaw : '';

    // Track which fields are actually mapped in the CSV (for partial updates)
    const _mapped = Object.keys(mapping).filter(f => mapping[f] >= 0 && f !== 'name');

    return {
      _row: ri+2,
      _mapped,
      name:            get('name'),
      manager:         isClr('manager') ? '' : get('manager',''),
      mrr:             isClr('mrr') ? 0 : (parseFloat(get('mrr')) || 0),
      arr:             isClr('arr') ? 0 : (parseFloat(get('arr')) || 0),
      logins:          isClr('logins') ? null : (get('logins').trim() !== '' ? (parseInt(get('logins')) || 0) : null),
      adoption:        isClr('adoption') ? null : (get('adoption').trim() !== '' ? (parseInt(get('adoption')) || 0) : null),
      tickets:         isClr('tickets') ? null : (get('tickets').trim() !== '' ? (parseInt(get('tickets')) || 0) : null),
      nps,
      csat,
      days:            isClr('days') ? null : (get('days').trim() !== '' ? (parseInt(get('days')) || 0) : null),
      renewal_date:    isClr('renewal_date') ? '' : normalizeDate(get('renewal_date','')),
      renewal:         isClr('renewal') ? 0 : (parseInt(get('renewal'))|| 0),
      growth,
      tier:            ['smb','mid','enterprise'].includes(get('tier','mid').toLowerCase()) ? get('tier','mid').toLowerCase() : 'mid',
      tags:            isClr('tags') ? [] : get('tags').split(/[,|]/).map(t=>t.trim()).filter(Boolean),
      lifecycle:       ['onboarding','active','atrisk','won','churned'].includes(get('lifecycle','active').toLowerCase()) ? get('lifecycle','active').toLowerCase() : 'active',
      since:           isClr('since') ? '' : normalizeDate(get('since','')),
      next_touch:        isClr('next_touch') ? '' : normalizeDate(get('next_touch','')),
      last_contact_date: isClr('last_contact_date') ? '' : normalizeDate(get('last_contact_date','')),
      scoring_profile:   isClr('scoring_profile') ? '' : get('scoring_profile',''),
      _note:           get('note',''),
      _sentiment:      sentVal,
      _history:        get('history','')
    };
  }).filter(r => r.name);

  // Show preview — count new vs updates
  const _updateCount = parsed.filter(r => customers.some(c => c.name.toLowerCase() === r.name.toLowerCase())).length;
  const _newCount = parsed.length - _updateCount;

  el('csv-map-wrap').style.display  = 'none';
  el('csv-prev-wrap').style.display = 'block';
  el('csv-count').textContent       = `${parsed.length} rows ready to import`;
  el('csv-import-breakdown').innerHTML = `<span style="color:var(--green);font-weight:600">${_newCount} new</span> · <span style="color:var(--blue,#2563eb);font-weight:600">${_updateCount} update${_updateCount!==1?'s':''}</span>`;
  el('csv-err').textContent         = csvRows.length - parsed.length > 0
    ? `${csvRows.length - parsed.length} rows skipped (missing name)`
    : '';

  el('csv-prev').innerHTML = `
    <table>
      <thead><tr><th></th><th>Name</th><th>Score</th><th>MRR</th><th>NPS</th><th>CSAT</th><th>Tier</th></tr></thead>
      <tbody>${parsed.slice(0,8).map(r => {
        const {score} = scoreWithModel(r);
        const isUpdate = customers.some(c => c.name.toLowerCase() === r.name.toLowerCase());
        const tag = isUpdate
          ? '<span style="font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:8px;background:rgba(37,99,235,.12);color:#2563eb">UPDATE</span>'
          : '<span style="font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:8px;background:rgba(22,163,74,.12);color:#16a34a">NEW</span>';
        return `<tr>
          <td>${tag}</td>
          <td>${escHtml(r.name)}</td>
          <td><strong>${score}</strong></td>
          <td>${r.mrr?'$'+fmtNum(r.mrr):'—'}</td>
          <td>${r.nps != null ? r.nps : '—'}</td>
          <td>${r.csat != null ? r.csat : '—'}</td>
          <td>${r.tier}</td>
        </tr>`;
      }).join('')}
      ${parsed.length>8?`<tr><td colspan="7" style="color:var(--muted);font-style:italic">…and ${parsed.length-8} more</td></tr>`:''}
      </tbody>
    </table>`;

  // Stash for import
  el('csv-prev').dataset.json = JSON.stringify(parsed);
}

async function importCSV() {
  const raw = el('csv-prev').dataset.json;
  if (!raw) return;
  const rows = JSON.parse(raw);
  const toCreate = [], toUpdate = [];
  const now = new Date().toISOString();
  rows.forEach((r, i) => {
    // Extract transient import fields (prefixed with _)
    const importNote = r._note || '';
    const importSentiment = r._sentiment || '';
    const importHistory = r._history || '';
    const mappedFields = r._mapped || [];
    delete r._note; delete r._sentiment; delete r._history; delete r._row; delete r._mapped;

    // If renewal_date provided, recalculate renewal months
    if (r.renewal_date) {
      r.renewal = Math.max(0, Math.round((new Date(r.renewal_date) - new Date()) / (1000*60*60*24*30.44)));
    }

    const dupe = customers.find(c => c.name.toLowerCase() === r.name.toLowerCase());
    if (dupe) {
      // Only overwrite fields that were actually mapped in the CSV
      // Unmapped fields keep their existing values
      if (mappedFields.length) {
        for (const f of mappedFields) {
          if (f in r) dupe[f] = r[f];
        }
        // ARR follows MRR
        if (mappedFields.includes('mrr') && !mappedFields.includes('arr')) dupe.arr = (dupe.mrr || 0) * 12;
      } else {
        // Fallback: all fields mapped (legacy behavior)
        Object.assign(dupe, r);
      }
      const { score } = scoreWithModel(dupe);
      const status = getStatus(score);
      dupe.score = score;
      dupe.status = status;
      dupe._baseDays = dupe.days != null ? dupe.days : null;
      dupe.history = dupe.history || [];
      // Merge imported history entries if provided (JSON array)
      if (importHistory) {
        try {
          const parsed = JSON.parse(importHistory);
          if (Array.isArray(parsed)) {
            // Prepend imported entries before the current snapshot
            dupe.history = [...parsed, ...dupe.history];
          }
        } catch(_) { console.warn('Invalid history JSON for', r.name); }
      }
      dupe.history.push({ score, date: now, signals: buildHistorySnapshot(dupe) });
      // Append note if provided
      if (importNote) {
        dupe.notes = dupe.notes || [];
        dupe.notes.push({ text: importNote, date: now });
      }
      // Append sentiment if provided
      if (importSentiment) {
        dupe.sentiment = dupe.sentiment || [];
        dupe.sentiment.push({ val: importSentiment, note: 'CSV import', date: now });
      }
      applyAutoStage(dupe);
      toUpdate.push(dupe);
    } else {
      const { score } = scoreWithModel(r);
      const status = getStatus(score);
      const notes = importNote ? [{ text: importNote, date: now }] : [];
      const sentiment = importSentiment ? [{ val: importSentiment, note: 'CSV import', date: now }] : [];
      let importedHistory = [];
      if (importHistory) {
        try { const p = JSON.parse(importHistory); if (Array.isArray(p)) importedHistory = p; }
        catch(_) { console.warn('Invalid history JSON for', r.name); }
      }
      const newCust = {
        id: crypto.randomUUID(),
        ...r, score, status,
        _baseDays: r.days != null ? r.days : null,
        notes,
        sentiment,
        history: [...importedHistory, { score, date: now }],
        created: now
      };
      newCust.history[newCust.history.length - 1].signals = buildHistorySnapshot(newCust);
      applyAutoStage(newCust);
      customers.unshift(newCust);
      toCreate.push(newCust);
    }
  });
  clearCSV();
  const createdNames = toCreate.slice(0, 5).map(c => c.name).join(', ') + (toCreate.length > 5 ? ` +${toCreate.length - 5} more` : '');
  const updatedNames = toUpdate.slice(0, 5).map(c => c.name).join(', ') + (toUpdate.length > 5 ? ` +${toUpdate.length - 5} more` : '');
  const importParts = [];
  if (toCreate.length) importParts.push(`Created ${toCreate.length}: ${createdNames}`);
  if (toUpdate.length) importParts.push(`Updated ${toUpdate.length}: ${updatedNames}`);
  logAudit('csv_import', null, '', { summary: importParts.join(' · ') || 'No records imported' });
  toast(`Importing ${toCreate.length} new + ${toUpdate.length} updates…`, 'default');
  nav('customers');
  setLoading(true);
  try {
    await Promise.all([
      ...toCreate.map(c => atCreate(c).catch(()=>{})),
      ...toUpdate.map(c => atUpdate(c).catch(()=>{}))
    ]);
    toast(`Done: ${toCreate.length} added, ${toUpdate.length} updated`, 'success');
  } catch(e) {
    toast('Import finished — some records may not have synced', 'warn');
  } finally {
    setLoading(false);
    refreshMgrDropdown();
    renderCustomers();
  }
}

function clearCSV() {
  csvRows = null; csvHeaders = [];
  el('csv-map-wrap').style.display  = 'none';
  el('csv-prev-wrap').style.display = 'none';
  el('csv-input').value = '';
}

function dlTemplate() {
  const hdr = 'name,manager,mrr,arr,logins_30d,feature_adoption_pct,open_tickets,nps,csat,days_since_contact,renewal_date,months_to_renewal,growth_signal,tier,tags,lifecycle,customer_since,next_touch,last_contact_date,scoring_profile,note,sentiment';
  const sample = [
    'Acme Corp,Jane Smith,5000,60000,22,75,1,9,4,7,2026-09-15,8,strong,mid,"power-user,renewal-soon",active,2024-01-10,2026-03-01,2026-03-09,Global Weights,Great engagement,positive',
    'Beta Inc,Marcus Lee,1200,14400,8,40,3,5,,25,2026-05-01,3,none,smb,,onboarding,2025-11-01,,2026-02-19,Global Weights,Needs onboarding help,neutral',
    'Gamma LLC,Jane Smith,12000,144000,28,90,0,10,5,3,2027-01-20,11,strong,enterprise,enterprise-plan,active,2023-06-15,2026-03-10,2026-03-13,Global Weights,,positive'
  ].join('\n');
  dlText(hdr + '\n' + sample, 'cs-health-template.csv', 'text/csv');
}

function exportCSV() {
  const filtered = customers.filter(c => passesManagerFilter(c));
  const hdr = 'name,manager,score,status,mrr,arr,tier,lifecycle,logins,adoption,tickets,nps,csat,days,renewal_date,renewal,growth,tags,since,next_touch,last_contact_date,scoring_profile,note,sentiment,created';
  const rows = filtered.map(c => {
    const latestNote = (c.notes||[]).length ? c.notes[c.notes.length-1].text : '';
    const ls = latestSentiment(c);
    const latestSent = ls ? ls.val : '';
    return [
      c.name, c.manager||'', c.score, c.status,
      c.mrr||0, c.arr||0, c.tier||'mid', c.lifecycle||'active',
      c.logins != null ? c.logins : '', c.adoption != null ? c.adoption : '', c.tickets != null ? c.tickets : '', c.nps != null ? c.nps : '', c.csat != null ? c.csat : '', c.days != null ? c.days : '',
      c.renewal_date||'', c.renewal||0, c.growth||'none',
      (c.tags||[]).join('|'), c.since||'', c.next_touch||'',
      c.last_contact_date||'',
      c.scoring_profile||'Global Weights', latestNote, latestSent, c.created||''
    ].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',');
  });
  dlText(hdr + '\n' + rows.join('\n'), 'cs-health-export.csv', 'text/csv');
  toast(`Exported ${filtered.length} customer${filtered.length !== 1 ? 's' : ''}`);
}

function toggleExportDd(key) {
  const menu = el('export-menu-' + key);
  if (!menu) return;
  document.querySelectorAll('[id^="export-menu-"]').forEach(m => {
    if (m !== menu) m.classList.remove('open');
  });
  menu.classList.toggle('open');
}
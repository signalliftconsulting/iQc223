// ─── CSV IMPORT ─────────────────────────────────────────────
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
  nps:             { label:'NPS Category', required:false },
  days:            { label:'Days Since Contact', required:false },
  renewal_date:    { label:'Renewal Date', required:false },
  renewal:         { label:'Months to Renewal',  required:false },
  growth:          { label:'Growth Signal', required:false },
  tier:            { label:'Tier',          required:false },
  tags:            { label:'Tags',          required:false },
  lifecycle:       { label:'Lifecycle',     required:false },
  since:           { label:'Customer Since', required:false },
  next_touch:      { label:'Next Touch Date', required:false },
  scoring_profile: { label:'Scoring Profile', required:false },
  note:            { label:'Note',            required:false },
  sentiment:       { label:'Sentiment',       required:false }
};

const FIELD_ALIASES = {
  name:            ['name','company','customer','account','customer name','company name'],
  manager:         ['manager','assigned manager','csm','cs manager','owner','account owner','rep'],
  mrr:             ['mrr','monthly recurring revenue','revenue'],
  arr:             ['arr','annual recurring revenue','annual revenue'],
  logins:          ['logins','logins_30d','login_frequency','login frequency','logins 30d'],
  adoption:        ['adoption','feature_adoption_pct','feature adoption','adoption %','adoption pct'],
  tickets:         ['tickets','open_tickets','support tickets','open tickets','support_tickets'],
  nps:             ['nps','nps_category','csat','nps/csat','nps category'],
  days:            ['days','days_since_contact','days since contact','last contact'],
  renewal_date:    ['renewal_date','renewal date','renews on','renews'],
  renewal:         ['renewal','months_to_renewal','months to renewal','renewal months'],
  growth:          ['growth','growth_signal','growth signal'],
  tier:            ['tier','segment'],
  tags:            ['tags','labels','tag'],
  lifecycle:       ['lifecycle','stage','lifecycle stage','status'],
  since:           ['since','customer since','customer_since','start date','start_date','joined'],
  next_touch:      ['next_touch','next touch','next contact','next_contact','scheduled touch'],
  scoring_profile: ['scoring_profile','scoring profile','profile','score profile'],
  note:            ['note','notes','comment','comments'],
  sentiment:       ['sentiment','sentiment value','customer sentiment']
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

  const npsMap = {
    promoter:['promoter','9','10','9-10'],
    passive:['passive','7','8','7-8'],
    detractor:['detractor','0','1','2','3','4','5','6','0-6']
  };
  const growMap = { strong:['strong'], mild:['mild'], none:['none','flat',''] };

  const parsed = csvRows.map((row,ri) => {
    const get = (f, def='') => mapping[f]>=0 ? (row[mapping[f]]||'').trim() : def;
    const npsRaw = get('nps','unknown').toLowerCase();
    let nps = 'unknown';
    Object.entries(npsMap).forEach(([k,vs])=>{ if(vs.includes(npsRaw)) nps=k; });
    const growRaw = get('growth','none').toLowerCase();
    let growth = 'none';
    Object.entries(growMap).forEach(([k,vs])=>{ if(vs.includes(growRaw)) growth=k; });

    const sentRaw = get('sentiment','').toLowerCase();
    const sentVal = ['positive','neutral','negative'].includes(sentRaw) ? sentRaw : '';

    return {
      _row: ri+2,
      name:            get('name'),
      manager:         get('manager',''),
      mrr:             parseFloat(get('mrr')) || 0,
      arr:             parseFloat(get('arr')) || 0,
      logins:          parseInt(get('logins'))|| 0,
      adoption:        parseInt(get('adoption'))|| 0,
      tickets:         parseInt(get('tickets'))|| 0,
      nps,
      days:            parseInt(get('days'))  || 0,
      renewal_date:    normalizeDate(get('renewal_date','')),
      renewal:         parseInt(get('renewal'))|| 0,
      growth,
      tier:            ['smb','mid','enterprise'].includes(get('tier','mid').toLowerCase()) ? get('tier','mid').toLowerCase() : 'mid',
      tags:            get('tags').split(/[,|]/).map(t=>t.trim()).filter(Boolean),
      lifecycle:       ['onboarding','active','atrisk','won','churned'].includes(get('lifecycle','active').toLowerCase()) ? get('lifecycle','active').toLowerCase() : 'active',
      since:           normalizeDate(get('since','')),
      next_touch:      normalizeDate(get('next_touch','')),
      scoring_profile: get('scoring_profile',''),
      _note:           get('note',''),
      _sentiment:      sentVal
    };
  }).filter(r => r.name);

  // Show preview
  el('csv-map-wrap').style.display  = 'none';
  el('csv-prev-wrap').style.display = 'block';
  el('csv-count').textContent       = `${parsed.length} rows ready to import`;
  el('csv-err').textContent         = csvRows.length - parsed.length > 0
    ? `${csvRows.length - parsed.length} rows skipped (missing name)`
    : '';

  el('csv-prev').innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Score</th><th>MRR</th><th>NPS</th><th>Tier</th></tr></thead>
      <tbody>${parsed.slice(0,8).map(r => {
        const {score} = calcScore(r);
        return `<tr>
          <td>${escHtml(r.name)}</td>
          <td><strong>${score}</strong></td>
          <td>${r.mrr?'$'+fmtNum(r.mrr):'—'}</td>
          <td>${r.nps}</td>
          <td>${r.tier}</td>
        </tr>`;
      }).join('')}
      ${parsed.length>8?`<tr><td colspan="5" style="color:var(--muted);font-style:italic">…and ${parsed.length-8} more</td></tr>`:''}
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
    delete r._note; delete r._sentiment; delete r._row;

    // If renewal_date provided, recalculate renewal months
    if (r.renewal_date) {
      r.renewal = Math.max(0, Math.round((new Date(r.renewal_date) - new Date()) / (1000*60*60*24*30.44)));
    }

    const { score } = calcScore(r);
    const status = getStatus(score);
    const dupe = customers.find(c => c.name.toLowerCase() === r.name.toLowerCase());
    if (dupe) {
      Object.assign(dupe, { ...r, score, status });
      dupe._baseDays = dupe.days || 0;
      dupe.history = dupe.history || [];
      dupe.history.push({ score, date: now });
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
      toUpdate.push(dupe);
    } else {
      const notes = importNote ? [{ text: importNote, date: now }] : [];
      const sentiment = importSentiment ? [{ val: importSentiment, note: 'CSV import', date: now }] : [];
      const newCust = {
        id: crypto.randomUUID(),
        ...r, score, status,
        _baseDays: r.days || 0,
        notes,
        sentiment,
        history: [{ score, date: now }],
        created: now
      };
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
  const hdr = 'name,manager,mrr,arr,logins_30d,feature_adoption_pct,open_tickets,nps_category,days_since_contact,renewal_date,months_to_renewal,growth_signal,tier,tags,lifecycle,customer_since,next_touch,scoring_profile,note,sentiment';
  const sample = [
    'Acme Corp,Jane Smith,5000,60000,22,75,1,promoter,7,2026-09-15,8,strong,mid,"power-user,renewal-soon",active,2024-01-10,2026-03-01,Global Weights,Great engagement,positive',
    'Beta Inc,Marcus Lee,1200,14400,8,40,3,passive,25,2026-05-01,3,none,smb,,onboarding,2025-11-01,,Global Weights,Needs onboarding help,neutral',
    'Gamma LLC,Jane Smith,12000,144000,28,90,0,promoter,3,2027-01-20,11,strong,enterprise,enterprise-plan,active,2023-06-15,2026-03-10,Global Weights,,positive'
  ].join('\n');
  dlText(hdr + '\n' + sample, 'cs-health-template.csv', 'text/csv');
}

function exportCSV() {
  const filtered = customers.filter(c => passesManagerFilter(c));
  const hdr = 'name,manager,score,status,mrr,arr,tier,lifecycle,logins,adoption,tickets,nps,days,renewal_date,renewal,growth,tags,since,next_touch,scoring_profile,note,sentiment,created';
  const rows = filtered.map(c => {
    const latestNote = (c.notes||[]).length ? c.notes[c.notes.length-1].text : '';
    const latestSent = (c.sentiment||[]).length ? c.sentiment[c.sentiment.length-1].val : '';
    return [
      c.name, c.manager||'', c.score, c.status,
      c.mrr||0, c.arr||0, c.tier||'mid', c.lifecycle||'active',
      c.logins, c.adoption, c.tickets, c.nps, c.days,
      c.renewal_date||'', c.renewal||0, c.growth||'none',
      (c.tags||[]).join('|'), c.since||'', c.next_touch||'',
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
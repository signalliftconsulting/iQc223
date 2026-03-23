// ─── AUDIT LOG ───────────────────────────────────────────────

const AUDIT_ACTION_LABELS = {
  customer_created:      'Customer Created',
  customer_scored:       'Customer Scored',
  customer_updated:      'Customer Updated',
  customer_deleted:      'Moved to Trash',
  customer_restored:     'Restored from Trash',
  customer_hard_deleted: 'Permanently Deleted',
  csv_import:            'CSV Import',
  settings_changed:      'Settings Changed',
  weights_updated:       'Weights Updated',
  weights_reset:         'Weights Reset',
  thresholds_updated:    'Thresholds Updated',
  thresholds_reset:      'Thresholds Reset',
  profile_created:       'Profile Created',
  profile_updated:       'Profile Updated',
  profile_loaded:        'Profile Loaded',
  profile_deleted:       'Profile Deleted',
  note_added:            'Note Added',
  sentiment_logged:      'Sentiment Logged',
  alert_snoozed:         'Alert Snoozed',
  alert_dismissed:       'Alert Dismissed',
  alert_unsnoozed:       'Alert Unsnoozed',
  alerts_cleared:        'Snoozed Alerts Cleared',
  bulk_snooze:           'Bulk Alert Snooze',
  bulk_dismiss:          'Bulk Alert Dismiss',
  bulk_tag:              'Bulk Tag Applied',
  bulk_lifecycle:        'Bulk Lifecycle Update',
  bulk_delete:           'Bulk Delete',
  backup_exported:       'Backup Exported',
  backup_restored:       'Backup Restored',
  password_changed:      'Password Changed',
  report_printed:        'Report Printed',
  qbr_opened:            'QBR Prep Opened',
};

const AUDIT_ACTION_COLORS = {
  customer_created:      'var(--green)',
  customer_scored:       'var(--blue)',
  customer_updated:      'var(--blue)',
  customer_deleted:      'var(--amber)',
  customer_restored:     'var(--green)',
  customer_hard_deleted: 'var(--red)',
  csv_import:            'var(--purple)',
  settings_changed:      'var(--teal)',
  weights_updated:       'var(--teal)',
  weights_reset:         'var(--amber)',
  thresholds_updated:    'var(--teal)',
  thresholds_reset:      'var(--amber)',
  profile_created:       'var(--green)',
  profile_updated:       'var(--teal)',
  profile_loaded:        'var(--blue)',
  profile_deleted:       'var(--red)',
  note_added:            'var(--muted)',
  sentiment_logged:      'var(--amber)',
  alert_snoozed:         'var(--amber)',
  alert_dismissed:       'var(--muted)',
  alert_unsnoozed:       'var(--blue)',
  alerts_cleared:        'var(--amber)',
  bulk_snooze:           'var(--amber)',
  bulk_dismiss:          'var(--muted)',
  bulk_tag:              'var(--purple)',
  bulk_lifecycle:        'var(--teal)',
  bulk_delete:           'var(--red)',
  backup_exported:       'var(--blue)',
  backup_restored:       'var(--amber)',
  password_changed:      'var(--teal)',
  report_printed:        'var(--muted)',
  qbr_opened:            'var(--blue)',
};

let auditLogs   = [];
let auditOffset = 0;
const AUDIT_PAGE_SIZE = 50;
let _auditSortKey = 'created_at';
let _auditSortDir = -1;
let _auditSearch = '';

function sortAuditLog(key) {
  if (_auditSortKey === key) _auditSortDir *= -1;
  else { _auditSortKey = key; _auditSortDir = (key === 'customer_name' || key === 'action') ? 1 : -1; }
  renderAuditLog();
}

function auditSearchFilter(val) {
  _auditSearch = (val || '').toLowerCase();
  renderAuditLog();
}

// logAudit  - fire-and-forget insert to Supabase
function logAudit(action, customerId, customerName, details) {
  if (!currentUser) return;
  const d = { ...(details || {}), user_email: currentUser.email || '' };
  const cid = getEffectiveClientId();
  const entry = {
    user_id:       currentUser.id,
    client_id:     cid,
    action:        action,
    customer_id:   customerId || null,
    customer_name: customerName || '',
    details:       JSON.stringify(d),
    created_at:    new Date().toISOString()
  };
  sb.from('audit_logs').insert(entry).then(({ error }) => {
    if (error) {
      console.warn('[audit] Write failed:', error.message,
        '| action:', action,
        '| user:', currentUser.email,
        '| client_id:', cid,
        '| hint: Check RLS policy on audit_logs allows insert for this user/client');
    }
  });
}

// loadAuditLog  - fetch from Supabase with pagination + filter
async function loadAuditLog(forceRefresh) {
  if (forceRefresh) { auditLogs = []; auditOffset = 0; }

  const loading = document.getElementById('audit-loading');
  const table   = document.getElementById('audit-table');
  const empty   = document.getElementById('audit-empty');
  const pag     = document.getElementById('audit-pagination');
  if (!loading || !table) return;

  if (auditLogs.length === 0) {
    loading.style.display = 'block';
    table.style.display   = 'none';
    empty.style.display   = 'none';
    pag.style.display     = 'none';
  }

  try {
    const auditCid = getEffectiveClientId();
    let query = sb.from('audit_logs')
      .select('*');
    if (auditCid) {
      // Show logs for this client OR orphaned logs (client_id was null during prior bug)
      query = query.or('client_id.eq.' + auditCid + ',and(client_id.is.null,user_id.eq.' + currentUser.id + ')');
    } else {
      query = query.eq('user_id', currentUser.id);
    }
    query = query.order('created_at', { ascending: false })
      .range(auditOffset, auditOffset + AUDIT_PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) throw error;

    if (auditOffset === 0) {
      auditLogs = data || [];
    } else {
      auditLogs = auditLogs.concat(data || []);
    }

    loading.style.display = 'none';
    renderAuditLog();

    // Show "load more" if we got a full page
    if (data && data.length >= AUDIT_PAGE_SIZE) {
      pag.style.display = 'block';
    } else {
      pag.style.display = 'none';
    }

  } catch (err) {
    loading.style.display = 'none';
    empty.style.display   = 'block';
    console.error('Audit log load failed:', err);
  }
}

function loadMoreAudit() {
  auditOffset += AUDIT_PAGE_SIZE;
  loadAuditLog(false);
}

function renderAuditLog() {
  const table = document.getElementById('audit-table');
  const tbody = document.getElementById('audit-tbody');
  const empty = document.getElementById('audit-empty');
  const pagTop = document.getElementById('audit-pag-top');
  const pagBot = document.getElementById('audit-pag-bot');
  if (!tbody) return;

  // Apply action filter
  const filterVal = (document.getElementById('audit-filter-action') || {}).value || 'all';
  let filtered  = filterVal === 'all'
    ? auditLogs
    : auditLogs.filter(e => e.action === filterVal);

  // Apply search filter
  if (_auditSearch) {
    filtered = filtered.filter(e => {
      const label = (AUDIT_ACTION_LABELS[e.action] || e.action || '').toLowerCase();
      const name = (e.customer_name || '').toLowerCase();
      let email = '';
      try { const d = typeof e.details === 'string' ? JSON.parse(e.details) : (e.details || {}); email = (d.user_email || '').toLowerCase(); } catch {}
      return label.includes(_auditSearch) || name.includes(_auditSearch) || email.includes(_auditSearch);
    });
  }

  // Apply sort
  filtered = [...filtered].sort((a, b) => {
    let av, bv;
    switch (_auditSortKey) {
      case 'created_at': av = a.created_at || ''; bv = b.created_at || ''; break;
      case 'action': av = (AUDIT_ACTION_LABELS[a.action]||a.action||'').toLowerCase(); bv = (AUDIT_ACTION_LABELS[b.action]||b.action||'').toLowerCase(); break;
      case 'customer_name': av = (a.customer_name||'').toLowerCase(); bv = (b.customer_name||'').toLowerCase(); break;
      case 'user_email':
        try { const da = typeof a.details==='string'?JSON.parse(a.details):(a.details||{}); av = (da.user_email||'').toLowerCase(); } catch { av = ''; }
        try { const db = typeof b.details==='string'?JSON.parse(b.details):(b.details||{}); bv = (db.user_email||'').toLowerCase(); } catch { bv = ''; }
        break;
      default: av = a.created_at || ''; bv = b.created_at || '';
    }
    if (av < bv) return -1 * _auditSortDir;
    if (av > bv) return 1 * _auditSortDir;
    return 0;
  });

  if (filtered.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'block';
    if (pagTop) pagTop.innerHTML = '';
    if (pagBot) pagBot.innerHTML = '';
    return;
  }

  table.style.display = '';
  empty.style.display = 'none';

  // Paginate
  const pg = _pagGet('auditLog');
  const slice = filtered.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE);
  const pagNav = _pagHTML(filtered.length, 'auditLog', 'renderAuditLog');
  if (pagTop) pagTop.innerHTML = pagNav;
  if (pagBot) pagBot.innerHTML = pagNav;

  tbody.innerHTML = slice.map(e => {
    const dt   = new Date(e.created_at);
    const time = dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const label = AUDIT_ACTION_LABELS[e.action] || e.action;
    const color = AUDIT_ACTION_COLORS[e.action] || 'var(--muted)';

    /* ── Parse details + extract user email ── */
    let parsedDetails = {};
    try { parsedDetails = typeof e.details === 'string' ? JSON.parse(e.details) : (e.details || {}); } catch {}
    const userEmail = parsedDetails.user_email || currentUser?.email || ' -';

    /* ── Customer / scope column ── */
    let name;
    if (e.customer_name) {
      name = escHtml(e.customer_name);
    } else {
      const settingsActions = ['weights_updated','weights_reset','thresholds_updated','thresholds_reset','settings_changed','settings_reset'];
      const profileActions  = ['profile_created','profile_updated','profile_loaded','profile_deleted'];
      const importActions   = ['csv_import'];
      const alertActions    = ['alert_snoozed','alert_dismissed','alert_unsnoozed','alerts_cleared','bulk_snooze','bulk_dismiss'];
      const backupActions   = ['backup_exported','backup_restored'];
      const accountActions  = ['password_changed'];
      if (settingsActions.includes(e.action))      name = '<span style="color:var(--muted);font-style:italic">Global Settings</span>';
      else if (profileActions.includes(e.action))   name = '<span style="color:var(--muted);font-style:italic">Scoring Profiles</span>';
      else if (importActions.includes(e.action))    name = '<span style="color:var(--muted);font-style:italic">CSV Import</span>';
      else if (alertActions.includes(e.action))     name = '<span style="color:var(--muted);font-style:italic">Alerts</span>';
      else if (backupActions.includes(e.action))    name = '<span style="color:var(--muted);font-style:italic">Backup</span>';
      else if (accountActions.includes(e.action))   name = '<span style="color:var(--muted);font-style:italic">Account</span>';
      else if (e.action === 'bulk_tag' || e.action === 'bulk_lifecycle' || e.action === 'bulk_delete') name = '<span style="color:var(--muted);font-style:italic">Bulk Action</span>';
      else                                          name = '<span style="color:var(--subtle)"> -</span>';
    }

    /* ── Details column (exclude user_email from display) ── */
    let detailStr = '';
    try {
      const d = { ...parsedDetails };
      delete d.user_email;
      const keys = Object.keys(d);
      if (keys.length === 0) {
        detailStr = '<span style="color:var(--subtle)"> -</span>';
      } else if (d.summary) {
        detailStr = escHtml(d.summary);
      } else {
        const skip = new Set(['summary']);
        const parts = keys.filter(k => !skip.has(k)).slice(0, 5).map(k => {
          const v = typeof d[k] === 'object' ? JSON.stringify(d[k]) : d[k];
          return `<span style="color:var(--text);font-weight:600">${escHtml(k)}:</span> ${escHtml(String(v))}`;
        });
        if (keys.length > 5) parts.push(`<span style="color:var(--subtle)">+${keys.length - 5} more</span>`);
        detailStr = parts.join(' &nbsp;·&nbsp; ');
      }
    } catch {
      detailStr = '<span style="color:var(--subtle)"> -</span>';
    }

    return `<tr>
      <td style="white-space:nowrap;font-size:var(--fs-base);color:var(--muted)">${time}</td>
      <td style="font-size:var(--fs-base);color:var(--text)">${escHtml(userEmail)}</td>
      <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:var(--fs-sm);font-weight:700;color:${color};background:color-mix(in srgb, ${color} 12%, transparent)">${label}</span></td>
      <td style="font-weight:600;font-size:var(--fs-md)">${name}</td>
      <td style="font-size:var(--fs-base);color:var(--muted);max-width:480px;line-height:1.5">${detailStr}</td>
    </tr>`;
  }).join('');
}

function exportAuditLog() {
  if (!auditLogs.length) { toast('No audit entries to export', 'warn'); return; }
  const filterVal = (document.getElementById('audit-filter-action') || {}).value || 'all';
  const filtered  = filterVal === 'all' ? auditLogs : auditLogs.filter(e => e.action === filterVal);
  if (!filtered.length) { toast('No entries match current filter', 'warn'); return; }

  const hdr = 'timestamp,action,customer_name,details';
  const rows = filtered.map(e => {
    const ts    = new Date(e.created_at).toISOString();
    const label = AUDIT_ACTION_LABELS[e.action] || e.action;
    const name  = e.customer_name || '';
    let detail  = '';
    try {
      const d = typeof e.details === 'string' ? JSON.parse(e.details) : (e.details || {});
      detail = d.summary || Object.entries(d).map(([k,v]) => k + ':' + v).join('; ');
    } catch {}
    return [ts, label, name, detail].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
  });
  dlText(hdr + '\n' + rows.join('\n'), 'audit-log-export.csv', 'text/csv');
  toast('Audit log exported', 'success');
}


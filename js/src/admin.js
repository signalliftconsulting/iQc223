// ─── CLIENT MANAGEMENT (ADMIN ONLY) ─────────────────────────

async function loadAdminClients() {
  if (!isAdmin()) return;
  try {
    const { data, error } = await sb.from('clients')
      .select('*').order('name', { ascending: true });
    if (error) throw error;
    adminClients = data || [];
    refreshClientDropdown();
    refreshClientSelects();
  } catch(e) {
    console.warn('loadAdminClients:', e.message);
  }
}

// Populate the topbar client filter radio list
function refreshClientDropdown() {
  const list = document.getElementById('client-filter-list');
  if (!list) return;
  list.innerHTML = adminClients.map(c => `
    <div class="mgr-filter__item">
      <label>
        <input type="radio" name="client-radio" value="${escHtml(c.id)}"
          onchange="clientRadioChange(this)"
          ${activeClientId === c.id ? 'checked' : ''}>
        ${escHtml(c.name)}
      </label>
    </div>`).join('');
  updateClientFilterLabel();
}

// Populate client <select> dropdowns in create/edit user modals
function refreshClientSelects() {
  const opts = `<option value=""> - No client assigned  -</option>` +
    adminClients.map(c => `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`).join('');
  ['cu-client','eu-client'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) { const cur = sel.value; sel.innerHTML = opts; sel.value = cur; }
  });
}

function toggleClientDropdown() {
  const dd = document.getElementById('client-filter-dropdown');
  if (!dd) return;
  const isOpen = dd.style.display !== 'none';
  dd.style.display = isOpen ? 'none' : '';
  const btn = document.getElementById('client-filter-btn');
  if (btn) btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
  if (!isOpen) {
    const first = dd.querySelector('input[type=radio]');
    if (first) setTimeout(function() { first.focus(); }, 30);
    dd._kbHandler = dd._kbHandler || function(e) { _dropdownKeyNav(e, dd, 'client-filter-btn'); };
    dd.addEventListener('keydown', dd._kbHandler);
  }
}

document.addEventListener('click', function(e) {
  const wrap = document.getElementById('client-filter-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const dd = document.getElementById('client-filter-dropdown');
    if (dd) dd.style.display = 'none';
  }
});

async function clientRadioChange(radio) {
  activeClientId = radio.value;
  updateClientFilterLabel();
  document.getElementById('client-filter-dropdown').style.display = 'none';

  setLoading(true);
  try {
    // Reset in-memory settings to defaults, then load selected client's settings
    var _uxKeep2 = { iqc_uid:1, iqc_active_view:1, iqc_customers_cache:1, iqc_score_settings_clicked:1, iqc_score_settings_toured:1, iqc_qbr_clicked:1, iqc_welcome_v3:1, iqc_cookie_consent:1 };
    Object.keys(localStorage)
      .filter(k => k.startsWith('iqc_') && !_uxKeep2[k])
      .forEach(k => localStorage.removeItem(k));
    loadSettings(); // reset to defaults (localStorage now empty for settings keys)
    await loadSettingsFromSupabase(); // load selected client's settings from Supabase

    if (activeClientId === '__own__') {
      await loadCustomersFromSupabase();
    } else {
      await loadClientCustomers(activeClientId);
    }
    await resolveClientPlanTier();
  } catch(e) { /* use cache */ } finally {
    setLoading(false);
  }
  mgrFilterAll = true;
  activeManagers.clear();
  refreshMgrDropdown();
  refreshLiveScores();
  renderHomeBase();
  renderCustomers();
  renderAlerts();
  renderSettings();
  // Reload audit log if viewing audit
  try { if (localStorage.getItem('iqc_active_view') === 'audit') loadAuditLog(true); } catch(e) { console.warn('ls:', e.message); }
}

function updateClientFilterLabel() {
  const lbl = document.getElementById('client-filter-label');
  if (!lbl) return;
  if (activeClientId === '__own__') {
    lbl.textContent = 'My Data';
  } else {
    const c = adminClients.find(x => x.id === activeClientId);
    lbl.textContent = c ? c.name : 'Client';
  }
}

// Load all customers belonging to a given client (direct query by client_id)
// Falls back to user_id lookup if client_id column doesn't exist yet
async function loadClientCustomers(clientId, silent) {
  if (!silent) setLoading(true);
  try {
    let data, error;
    // Try direct client_id query first
    ({ data, error } = await sb.from('customers')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false }));

    if (error) {
      // Fallback: find all user_ids in this client, then query by user_id
      console.warn('client_id query unavailable, falling back to user lookup:', error.message);
      const { data: profiles } = await sb.from('user_profiles').select('user_id').eq('client_id', clientId);
      const uids = (profiles || []).map(p => p.user_id);
      if (uids.length) {
        ({ data, error } = await sb.from('customers')
          .select('*')
          .in('user_id', uids)
          .order('created_at', { ascending: false }));
        if (error) throw error;
      } else {
        data = [];
      }
    }

    const all = (data || []).map(fromRow);
    customers = all.filter(c => !c.deleted_at);
    trash     = all.filter(c =>  c.deleted_at);
  } catch(e) {
    toast('Could not load client data: ' + e.message, 'error');
    customers = [];
    trash = [];
  } finally {
    if (!silent) setLoading(false);
  }
}

async function renderClients() {
  if (!isAdmin()) { nav('homebase'); return; }
  await loadAdminClients();

  const loading = document.getElementById('clients-loading');
  const table   = document.getElementById('clients-table');
  const empty   = document.getElementById('clients-empty');
  const tbody   = document.getElementById('clients-tbody');
  const countEl = document.getElementById('clients-count');

  if (loading) loading.style.display = 'none';

  if (!adminClients.length) {
    if (empty) empty.style.display = '';
    if (table) table.style.display = 'none';
    if (countEl) countEl.textContent = '0 clients';
    return;
  }

  // Count users per client
  let profiles = [];
  try {
    const { data } = await sb.from('user_profiles').select('user_id, client_id');
    profiles = data || [];
  } catch(e) { console.warn('ls:', e.message); }
  const userCounts = {};
  profiles.forEach(p => { if (p.client_id) userCounts[p.client_id] = (userCounts[p.client_id]||0)+1; });

  // Count customers per client  - try client_id first, fall back to user→client mapping
  const custCounts = {};
  let totalCustomers = 0;
  try {
    const { data: custRows, error: custErr } = await sb.from('customers').select('client_id, user_id');
    if (custRows) {
      // Build user→client map for fallback
      const uidToClient = {};
      profiles.forEach(p => { if (p.client_id) uidToClient[p.user_id] = p.client_id; });

      custRows.forEach(r => {
        const cid = r.client_id || uidToClient[r.user_id] || null;
        if (cid) { custCounts[cid] = (custCounts[cid] || 0) + 1; }
        totalCustomers++;
      });
    }
  } catch(e) { console.warn('Customer count query:', e.message); }

  if (countEl) countEl.textContent = `${adminClients.length} client${adminClients.length!==1?'s':''} · ${totalCustomers} total customers`;
  if (empty) empty.style.display = 'none';
  if (table) table.style.display = '';

  tbody.innerHTML = adminClients.map(c => {
    const cc = custCounts[c.id] || 0;
    return `
    <tr>
      <td><input type="checkbox" class="client-sel" data-cid="${escHtml(c.id)}" onchange="adminUpdateBulkBar()" style="accent-color:var(--blue);cursor:pointer"/></td>
      <td><strong>${escHtml(c.name)}</strong></td>
      <td>${tierBadgeHTML(c.plan_tier || 'growth')}</td>
      <td>${userCounts[c.id] || 0}</td>
      <td><strong>${cc}</strong></td>
      <td style="color:var(--muted);font-size:var(--fs-base)">${escHtml(c.notes || ' -')}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-xs btn-outline" onclick="openEditClientModal('${escHtml(c.id)}','${escHtml(c.name)}',\`${escHtml(c.notes||'')}\`,'${escHtml(c.plan_tier||'growth')}')">Edit</button>
          <button class="btn btn-xs btn-danger" onclick="adminDeleteClient('${escHtml(c.id)}','${escHtml(c.name)}')">Remove</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Reset bulk bar
  const selAll = document.getElementById('clients-select-all');
  if (selAll) selAll.checked = false;
  adminUpdateBulkBar();
}

function adminToggleSelectAll(checked) {
  document.querySelectorAll('.client-sel').forEach(cb => { cb.checked = checked; });
  adminUpdateBulkBar();
}

function adminUpdateBulkBar() {
  const selected = document.querySelectorAll('.client-sel:checked');
  const bar = document.getElementById('clients-bulk-bar');
  const countEl = document.getElementById('clients-bulk-count');
  if (!bar) return;
  bar.style.display = selected.length > 0 ? 'flex' : 'none';
  if (countEl) countEl.textContent = selected.length + ' selected';
  // Sync select-all checkbox
  const all = document.querySelectorAll('.client-sel');
  const selAll = document.getElementById('clients-select-all');
  if (selAll) selAll.checked = all.length > 0 && selected.length === all.length;
}

async function adminBulkChangePlan() {
  const selected = Array.from(document.querySelectorAll('.client-sel:checked'));
  if (!selected.length) return;
  const tier = (document.getElementById('clients-bulk-tier') || {}).value || 'growth';
  const label = PLAN_TIER_LABELS[tier] || tier;
  const ids = selected.map(cb => cb.dataset.cid);

  try {
    const { error } = await sb.from('clients').update({ plan_tier: tier }).in('id', ids);
    if (error) throw error;
    toast(ids.length + ' client' + (ids.length !== 1 ? 's' : '') + ' changed to ' + label, 'success');
    adminClearSelection();
    await renderClients();
  } catch(e) {
    toast('Failed to update plans: ' + e.message, 'error');
  }
}

function adminClearSelection() {
  document.querySelectorAll('.client-sel').forEach(cb => { cb.checked = false; });
  const selAll = document.getElementById('clients-select-all');
  if (selAll) selAll.checked = false;
  adminUpdateBulkBar();
}

function openCreateClientModal() {
  if (!isAdmin()) return;
  el('cc-name').value  = '';
  el('cc-tier').value  = 'growth';
  el('cc-notes').value = '';
  el('cc-err').textContent = '';
  el('cc-btn').disabled = false;
  el('cc-btn').textContent = 'Add Client →';
  openModal('create-client-modal');
}

async function adminSaveClient() {
  const name      = el('cc-name').value.trim();
  const plan_tier = el('cc-tier').value || 'growth';
  const notes     = el('cc-notes').value.trim();
  if (!name) { el('cc-err').textContent = 'Business name is required.'; return; }
  el('cc-btn').disabled = true;
  el('cc-btn').textContent = 'Saving…';
  try {
    const { error } = await sb.from('clients').insert({
      id: crypto.randomUUID(), name, notes, plan_tier,
      user_id: currentUser.id,
      created_at: new Date().toISOString()
    });
    if (error) throw error;
    toast(`Client "${name}" added`, 'success');
    closeModal('create-client-modal');
    await loadAdminClients();
    renderClients();
  } catch(e) {
    el('cc-err').textContent = e.message || 'Save failed.';
    el('cc-btn').disabled = false;
    el('cc-btn').textContent = 'Add Client →';
  }
}

function openEditClientModal(id, name, notes, tier) {
  if (!isAdmin()) return;
  el('ec-id').value    = id;
  el('ec-name').value  = name;
  el('ec-tier').value  = tier || 'growth';
  el('ec-notes').value = notes;
  el('ec-err').textContent = '';
  el('ec-btn').disabled = false;
  el('ec-btn').textContent = 'Save Changes →';
  openModal('edit-client-modal');
}

async function adminUpdateClient() {
  const id        = el('ec-id').value;
  const name      = el('ec-name').value.trim();
  const plan_tier = el('ec-tier').value || 'growth';
  const notes     = el('ec-notes').value.trim();
  if (!name) { el('ec-err').textContent = 'Business name is required.'; return; }
  el('ec-btn').disabled = true;
  el('ec-btn').textContent = 'Saving…';
  try {
    const { error } = await sb.from('clients').update({ name, notes, plan_tier }).eq('id', id);
    if (error) throw error;
    toast(`Client updated`, 'success');
    closeModal('edit-client-modal');
    await loadAdminClients();
    renderClients();
  } catch(e) {
    el('ec-err').textContent = e.message || 'Save failed.';
    el('ec-btn').disabled = false;
    el('ec-btn').textContent = 'Save Changes →';
  }
}

async function adminDeleteClient(id, name) {
  if (!confirm(`Remove client "${name}"?\n\nUsers assigned to this client will become unassigned but their data is kept.`)) return;
  try {
    const { error } = await sb.from('clients').delete().eq('id', id);
    if (error) throw error;
    if (activeClientId === id) { activeClientId = '__own__'; updateClientFilterLabel(); }
    toast(`Client "${name}" removed`, 'warn');
    await loadAdminClients();
    renderClients();
  } catch(e) {
    toast('Remove failed: ' + e.message, 'error');
  }
}

// ─── USER MANAGEMENT (ADMIN ONLY) ────────────────────────────
// Uses the `profiles` Supabase table to track user metadata.
// Admin creates users via signUp, then stores business name in `user_profiles` table.
// Listing users: admin reads all rows from user_profiles (RLS allows admin to see all).
// Deleting users: removes from user_profiles + calls Supabase admin delete (requires service key  - we soft-delete via profile flag).

async function renderUsers() {
  if (!isAdmin()) { nav('homebase'); return; }

  const loading = el('users-loading');
  const table   = el('users-table');
  const empty   = el('users-empty');
  const tbody   = el('users-tbody');
  const countEl = el('users-count');

  if (loading) loading.style.display = '';
  if (table)   table.style.display   = 'none';
  if (empty)   empty.style.display   = 'none';

  try {
    // Load all user profiles (admin sees all via RLS policy)
    const { data: profiles_data, error } = await sb.from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;

    // For each profile, count their active (non-deleted) customers
    const { data: custData } = await sb.from('customers').select('user_id').is('deleted_at', null);
    const custCounts = {};
    (custData || []).forEach(r => {
      custCounts[r.user_id] = (custCounts[r.user_id] || 0) + 1;
    });

    if (loading) loading.style.display = 'none';

    if (!profiles_data || profiles_data.length === 0) {
      if (empty) empty.style.display = '';
      if (countEl) countEl.textContent = '0 users';
      return;
    }

    if (countEl) countEl.textContent = `${profiles_data.length} user${profiles_data.length!==1?'s':''}`;
    if (table) table.style.display = '';

    tbody.innerHTML = profiles_data.map(p => {
      const isSelf    = p.user_id === currentUser.id;
      const custCount = custCounts[p.user_id] || 0;
      const uid       = escHtml(p.user_id);
      const email     = escHtml(p.email || '');
      const clientId  = p.client_id || '';
      const client    = adminClients.find(c => c.id === clientId);
      const clientName = client ? escHtml(client.name) : '<span style="color:var(--subtle);font-style:italic"> -</span>';
      return `
        <tr>
          <td>
            <strong>${email || ' -'}</strong>
            ${isSelf ? '<span style="margin-left:6px;font-size:var(--fs-sm);background:var(--blue-l);color:var(--blue);padding:1px 6px;border-radius:4px;font-weight:700">YOU</span>' : ''}
          </td>
          <td>${clientName}</td>
          <td style="font-weight:600">${custCount}</td>
          <td style="color:var(--muted);font-size:var(--fs-base)">${fmtDate(p.created_at)}</td>
          <td>
            <div style="display:flex;gap:4px;flex-wrap:nowrap">
              <button class="btn btn-xs btn-outline" onclick="openEditUserModal('${escHtml(uid)}','${escHtml(email)}','${escHtml(clientId)}')">Edit</button>
              ${isSelf
                ? '<span style="font-size:var(--fs-sm);color:var(--subtle);padding:2px 4px">Can\'t Delete</span>'
                : `<button class="btn btn-xs btn-danger" onclick="adminDeleteUser('${escHtml(uid)}','${escHtml(email)}')">Remove</button>`}
            </div>
          </td>
        </tr>`;
    }).join('');

  } catch(e) {
    if (loading) loading.style.display = 'none';
    if (loading) loading.style.display = 'none';
    if (empty) {
      empty.style.display = '';
      if (e.message && e.message.includes('user_profiles')) {
        empty.innerHTML = `<strong>Setup required.</strong> The <code>user_profiles</code> table doesn't exist yet.<br><br>
          Run the SQL setup script in <strong>Supabase → SQL Editor</strong>, then reload this page.`;
      } else {
        empty.textContent = 'Error loading users: ' + e.message;
      }
    }
    console.error('renderUsers error:', e);
  }
}

function openCreateUserModal() {
  if (!isAdmin()) return;
  el('cu-email').value = '';
  el('cu-pw').value    = '';
  el('cu-err').textContent = '';
  el('cu-ok').textContent  = '';
  el('cu-btn').disabled    = false;
  el('cu-btn').textContent = 'Create User →';
  refreshClientSelects();
  el('cu-client').value = '';
  openModal('create-user-modal');
}

async function adminCreateUser() {
  if (!isAdmin()) return;
  const email    = el('cu-email').value.trim();
  const clientId = el('cu-client').value;
  const pw       = el('cu-pw').value;

  el('cu-err').textContent = '';
  el('cu-ok').textContent  = '';

  if (!email) { el('cu-err').textContent = 'Email is required.'; return; }
  if (!pw || pw.length < 8) { el('cu-err').textContent = 'Password must be at least 8 characters.'; return; }

  el('cu-btn').disabled = true;
  el('cu-btn').textContent = 'Creating…';

  try {
    // Save current admin session before signUp swaps it
    const { data: adminSession } = await sb.auth.getSession();
    const adminTokens = adminSession?.session ? {
      access_token: adminSession.session.access_token,
      refresh_token: adminSession.session.refresh_token,
    } : null;

    // Suppress ALL auth listener events during user creation.
    // signUp() swaps the session to the new user - we must block that entirely.
    window._adminCreatingUser = true;

    let signUpData, signUpErr;
    try {
      const result = await sb.auth.signUp({
        email, password: pw,
        options: { emailRedirectTo: window.location.href }
      });
      signUpData = result.data;
      signUpErr = result.error;
    } catch(signUpEx) {
      signUpErr = signUpEx;
    }

    // IMMEDIATELY restore admin session before doing anything else
    if (adminTokens) {
      await sb.auth.setSession(adminTokens);
      // Force a second restore after a tick to catch any async swaps
      await new Promise(function(r) { setTimeout(r, 500); });
      await sb.auth.setSession(adminTokens);
    }

    // Restore currentUser to admin
    currentUser = adminSession.session.user;

    if (signUpErr) { window._adminCreatingUser = false; throw signUpErr; }

    // If identities is empty, this email already exists in Supabase
    if (signUpData?.user?.identities?.length === 0) {
      window._adminCreatingUser = false;
      throw new Error('A user with email "' + email + '" already exists.');
    }

    const newUserId = signUpData?.user?.id;
    if (!newUserId) {
      window._adminCreatingUser = false;
      throw new Error('Signup succeeded but no user ID returned. Check Supabase Auth settings.');
    }

    const client = adminClients.find(function(c) { return c.id === clientId; });
    const { error: profileErr } = await sb.from('user_profiles').upsert({
      user_id:       newUserId,
      email,
      business_name: client ? client.name : '',
      client_id:     clientId || null,
      created_at:    new Date().toISOString()
    }, { onConflict: 'user_id' });

    if (profileErr) {
      window._adminCreatingUser = false;
      throw new Error('User created in Auth but profile save failed: ' + profileErr.message);
    }

    // Final session restore and flag clear
    if (adminTokens) await sb.auth.setSession(adminTokens);
    currentUser = adminSession.session.user;
    // Keep flag on long enough to catch any lingering async auth events
    setTimeout(function() { window._adminCreatingUser = false; }, 5000);

    el('cu-ok').textContent  = 'User "' + email + '" created! They can log in now with the password you set.';
    el('cu-btn').textContent = 'Create User →';
    el('cu-btn').disabled    = false;
    toast('User ' + email + ' created', 'success');
    setTimeout(function() { closeModal('create-user-modal'); renderUsers(); }, 2000);

  } catch(e) {
    window._adminCreatingUser = false;
    el('cu-err').textContent = e.message || 'Failed to create user.';
    el('cu-btn').textContent = 'Create User →';
    el('cu-btn').disabled    = false;
  }
}

async function adminDeleteUser(userId, email) {
  if (!isAdmin()) return;
  if (userId === currentUser.id) { toast("You can't delete yourself", 'error'); return; }
  if (!confirm(`Remove user "${email}"?\n\nThis deletes their profile record. Their customer data stays in the database but will be inaccessible until a new account is created with the same user ID.`)) return;

  try {
    const { error } = await sb.from('user_profiles').delete().eq('user_id', userId);
    if (error) throw error;
    toast(`User ${email} removed`, 'warn');
    renderUsers();
  } catch(e) {
    toast('Remove failed: ' + e.message, 'error');
  }
}

function openEditUserModal(userId, email, clientId) {
  if (!isAdmin()) return;
  el('eu-userid').value = userId;
  el('eu-email').value  = email;
  el('eu-err').textContent = '';
  // Clear password input
  const pwInput = el('eu-pw');
  if (pwInput) pwInput.value = '';
  // Reset password button state
  const pwStatus = el('eu-pw-status');
  if (pwStatus) { pwStatus.textContent = 'Sends a reset link to the user\'s email address.'; pwStatus.style.color = 'var(--muted)'; }
  const pwBtn = el('eu-pw-btn');
  if (pwBtn) { pwBtn.disabled = false; pwBtn.textContent = 'Send Password Reset Email →'; }
  el('eu-ok').textContent  = '';
  el('eu-btn').disabled    = false;
  el('eu-btn').textContent = 'Save Changes →';
  refreshClientSelects();
  el('eu-client').value = clientId || '';
  openModal('edit-user-modal');
}

async function adminSendPasswordReset() {
  if (!isAdmin()) return;
  const email = el('eu-email')?.value?.trim();
  if (!email) { el('eu-err').textContent = 'No email found.'; return; }

  el('eu-pw-btn').disabled = true;
  el('eu-pw-btn').textContent = 'Sending…';
  el('eu-err').textContent = '';

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href
  });

  if (error) {
    el('eu-err').textContent = 'Error: ' + error.message;
  } else {
    const status = el('eu-pw-status');
    if (status) { status.textContent = '✓ Reset link sent to ' + email; status.style.color = 'var(--green)'; }
    toast('Password reset email sent to ' + email, 'success');
  }

  el('eu-pw-btn').disabled = false;
  el('eu-pw-btn').textContent = 'Send Password Reset Email →';
}

async function adminSaveEdit() {
  // NOTE: Direct password set for other users requires the Supabase service-role key
  // (admin API), which is not available client-side. Use the "Send Password Reset Email"
  // button instead, or set passwords via Supabase Dashboard → Authentication → Users.
  if (!isAdmin()) return;
  const userId   = el('eu-userid').value;
  const clientId = el('eu-client').value;
  const pw       = el('eu-pw')?.value?.trim() || '';

  el('eu-err').textContent = '';
  el('eu-ok').textContent  = '';

  if (pw && pw.length < 8) {
    el('eu-err').textContent = 'Password must be at least 8 characters.';
    return;
  }
  if (pw) {
    el('eu-err').textContent = 'Direct password set is not available from the client. Use "Send Password Reset Email" or the Supabase Dashboard.';
    return;
  }

  el('eu-btn').disabled    = true;
  el('eu-btn').textContent = 'Saving…';

  try {
    const client = adminClients.find(c => c.id === clientId);
    const { error: profErr } = await sb.from('user_profiles')
      .update({ client_id: clientId || null, business_name: client ? client.name : '' })
      .eq('user_id', userId);
    if (profErr) throw profErr;

    el('eu-ok').textContent  = 'Profile updated!';
    el('eu-btn').textContent = 'Save Changes →';
    el('eu-btn').disabled    = false;
    toast('User updated', 'success');
    setTimeout(() => { closeModal('edit-user-modal'); renderUsers(); }, 1000);

  } catch(e) {
    el('eu-err').textContent = e.message || 'Save failed.';
    el('eu-btn').textContent = 'Save Changes →';
    el('eu-btn').disabled    = false;
  }
}

// ensureUserProfile() moved to auth.js (core bundle) — required during boot


// ─── USAGE ANALYTICS (ADMIN ONLY) ──────────────────────────
async function loadAnalytics() {
  if (!isAdmin()) return;
  const days = parseInt(document.getElementById('analytics-range')?.value || '30', 10);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  let events = [];
  try {
    const { data, error } = await sb.from('webhook_events')
      .select('event_type, payload, created_at, user_id')
      .eq('direction', 'inbound')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error) throw error;
    events = data || [];
  } catch(e) {
    console.warn('[analytics]', e.message);
    return;
  }

  // Parse payloads
  const parsed = events.map(e => {
    let p = {};
    try { p = JSON.parse(e.payload || '{}'); } catch(x) { console.warn('parse:', x.message); }
    return { ...e, p };
  });

  const pageViews = parsed.filter(e => e.event_type === 'page_view');
  const sessions = parsed.filter(e => e.event_type === 'session_start');
  const uniqueUsers = new Set(parsed.map(e => e.user_id));
  const uniqueSessions = new Set(parsed.map(e => e.p.session).filter(Boolean));

  // ── KPIs ──
  const kpiEl = document.getElementById('analytics-kpis');
  if (kpiEl) {
    kpiEl.innerHTML = [
      { label: 'Page Views', value: pageViews.length },
      { label: 'Sessions', value: uniqueSessions.size },
      { label: 'Unique Users', value: uniqueUsers.size },
      { label: 'Logins', value: sessions.length },
    ].map(k => `
      <div class="kpi-card">
        <div class="kpi-value">${k.value.toLocaleString()}</div>
        <div class="kpi-label">${k.label}</div>
      </div>`).join('');
  }

  // ── Page views by page (horizontal bars) ──
  const pageCounts = {};
  pageViews.forEach(e => {
    const pg = e.p.page || 'unknown';
    pageCounts[pg] = (pageCounts[pg] || 0) + 1;
  });
  const sortedPages = Object.entries(pageCounts).sort((a,b) => b[1] - a[1]);
  const maxCount = sortedPages.length ? sortedPages[0][1] : 1;
  const pagesEl = document.getElementById('analytics-pages');
  if (pagesEl) {
    if (!sortedPages.length) {
      pagesEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted)">No page views yet</div>';
    } else {
      pagesEl.innerHTML = sortedPages.map(([pg, cnt]) => `
        <div style="display:flex;align-items:center;gap:10px;padding:4px 0">
          <div style="width:100px;font-size:var(--fs-sm);color:var(--muted);text-align:right">${escHtml(pg)}</div>
          <div style="flex:1;background:var(--bg);border-radius:4px;height:22px;overflow:hidden">
            <div style="width:${(cnt/maxCount*100).toFixed(1)}%;background:var(--blue);height:100%;border-radius:4px;min-width:2px"></div>
          </div>
          <div style="width:40px;font-size:var(--fs-sm);font-weight:600">${cnt}</div>
        </div>`).join('');
    }
  }

  // ── DAU chart (simple bar chart by day) ──
  const dauMap = {};
  parsed.forEach(e => {
    const day = e.created_at?.slice(0, 10);
    if (!day) return;
    if (!dauMap[day]) dauMap[day] = new Set();
    dauMap[day].add(e.user_id);
  });
  const dauDays = Object.keys(dauMap).sort();
  const maxDau = dauDays.reduce((m, d) => Math.max(m, dauMap[d].size), 1);
  const dauEl = document.getElementById('analytics-dau');
  if (dauEl) {
    if (!dauDays.length) {
      dauEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted)">No data yet</div>';
    } else {
      dauEl.innerHTML = `<div style="display:flex;align-items:flex-end;gap:2px;height:120px;padding:0 4px">` +
        dauDays.map(d => {
          const cnt = dauMap[d].size;
          const pct = (cnt / maxDau * 100).toFixed(1);
          const label = d.slice(5); // MM-DD
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
            <div style="font-size:10px;color:var(--muted)">${cnt}</div>
            <div style="width:100%;background:var(--green);border-radius:3px 3px 0 0;height:${pct}%;min-height:2px" title="${d}: ${cnt} users"></div>
            <div style="font-size:9px;color:var(--muted);transform:rotate(-45deg);white-space:nowrap">${label}</div>
          </div>`;
        }).join('') + '</div>';
    }
  }

  // ── Recent sessions table ──
  const sessEl = document.getElementById('analytics-sessions');
  if (sessEl) {
    const recent = parsed.slice(0, 100);
    if (!recent.length) {
      sessEl.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--muted)">No events yet</td></tr>';
    } else {
      // Resolve user emails (batch)
      const userIds = [...new Set(recent.map(e => e.user_id))];
      let emailMap = {};
      try {
        const { data: profiles } = await sb.from('user_profiles')
          .select('user_id, email')
          .in('user_id', userIds);
        (profiles || []).forEach(p => { emailMap[p.user_id] = p.email; });
      } catch(e) { console.warn('ls:', e.message); }

      sessEl.innerHTML = recent.map(e => {
        const email = emailMap[e.user_id] || e.user_id.slice(0, 8);
        const page = e.p.page || e.event_type;
        const ago = _timeAgo(new Date(e.created_at));
        return `<tr>
          <td style="font-size:var(--fs-sm)">${escHtml(email)}</td>
          <td style="font-size:var(--fs-sm)">${escHtml(page)}</td>
          <td style="font-size:var(--fs-sm);color:var(--muted)">${ago}</td>
        </tr>`;
      }).join('');
    }
  }
}

function _timeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60)   return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
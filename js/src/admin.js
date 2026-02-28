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
  const opts = `<option value="">— No client assigned —</option>` +
    adminClients.map(c => `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`).join('');
  ['cu-client','eu-client'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) { const cur = sel.value; sel.innerHTML = opts; sel.value = cur; }
  });
}

function toggleClientDropdown() {
  const dd = document.getElementById('client-filter-dropdown');
  if (!dd) return;
  dd.style.display = dd.style.display === 'none' ? '' : 'none';
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

  if (activeClientId === '__own__') {
    // Reload admin's own customers
    setLoading(true);
    try {
      await loadCustomersFromSupabase();
    } catch(e) { /* use cache */ } finally {
      setLoading(false);
    }
  } else {
    // Load this client's customers (all users assigned to this client)
    await loadClientCustomers(activeClientId);
  }
  activeManagers.clear();
  refreshMgrDropdown();
  renderDashboard();
  renderCustomers();
  renderAlerts();
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

// Load all customers belonging to users assigned to a given client
async function loadClientCustomers(clientId) {
  setLoading(true);
  try {
    // Get all user_ids assigned to this client
    const { data: profiles, error: pErr } = await sb.from('user_profiles')
      .select('user_id').eq('client_id', clientId);
    if (pErr) throw pErr;

    const userIds = (profiles || []).map(p => p.user_id);
    if (!userIds.length) { customers = []; trash = []; setLoading(false); return; }

    // Load all customers for those users (active + soft-deleted)
    const { data, error } = await sb.from('customers')
      .select('*')
      .in('user_id', userIds)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const all = (data || []).map(fromRow);
    customers = all.filter(c => !c.deleted_at);
    trash     = all.filter(c =>  c.deleted_at);
  } catch(e) {
    toast('Could not load client data: ' + e.message, 'error');
    customers = [];
    trash = [];
  } finally {
    setLoading(false);
  }
}

async function renderClients() {
  if (!isAdmin()) { nav('dashboard'); return; }
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
  } catch(e) {}
  const userCounts = {};
  profiles.forEach(p => { if (p.client_id) userCounts[p.client_id] = (userCounts[p.client_id]||0)+1; });

  // Count customers per client (via user_profiles → customers)
  const custCounts = {};
  let totalCustomers = 0;
  try {
    // Get user_id → client_id mapping
    const userToClient = {};
    profiles.forEach(p => { if (p.client_id) userToClient[p.client_id] = userToClient[p.client_id] || []; });
    // Profiles already have client_id; query customer counts grouped by user_id
    const { data: custRows } = await sb.from('customers').select('user_id');
    if (custRows) {
      // Build user_id → client_id lookup
      const uidToClient = {};
      profiles.forEach(p => { if (p.client_id) uidToClient[p.user_id] = p.client_id; });
      custRows.forEach(r => {
        const cid = uidToClient[r.user_id];
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
      <td><strong>${escHtml(c.name)}</strong></td>
      <td>${tierBadgeHTML(c.plan_tier || 'starter')}</td>
      <td>${userCounts[c.id] || 0}</td>
      <td><strong>${cc}</strong></td>
      <td style="color:var(--muted);font-size:.8rem">${escHtml(c.notes || '—')}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-xs btn-outline" onclick="openEditClientModal('${escHtml(c.id)}','${escHtml(c.name)}',\`${escHtml(c.notes||'')}\`,'${escHtml(c.plan_tier||'starter')}')">Edit</button>
          <button class="btn btn-xs btn-danger" onclick="adminDeleteClient('${escHtml(c.id)}','${escHtml(c.name)}')">Remove</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openCreateClientModal() {
  if (!isAdmin()) return;
  el('cc-name').value  = '';
  el('cc-tier').value  = 'team';
  el('cc-notes').value = '';
  el('cc-err').textContent = '';
  el('cc-btn').disabled = false;
  el('cc-btn').textContent = 'Add Client →';
  openModal('create-client-modal');
}

async function adminSaveClient() {
  const name      = el('cc-name').value.trim();
  const plan_tier = el('cc-tier').value || 'team';
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
  el('ec-tier').value  = tier || 'starter';
  el('ec-notes').value = notes;
  el('ec-err').textContent = '';
  el('ec-btn').disabled = false;
  el('ec-btn').textContent = 'Save Changes →';
  openModal('edit-client-modal');
}

async function adminUpdateClient() {
  const id        = el('ec-id').value;
  const name      = el('ec-name').value.trim();
  const plan_tier = el('ec-tier').value || 'starter';
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
// Deleting users: removes from user_profiles + calls Supabase admin delete (requires service key — we soft-delete via profile flag).

async function renderUsers() {
  if (!isAdmin()) { nav('dashboard'); return; }

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
      const clientName = client ? escHtml(client.name) : '<span style="color:var(--subtle);font-style:italic">—</span>';
      return `
        <tr>
          <td>
            <strong>${email || '—'}</strong>
            ${isSelf ? '<span style="margin-left:6px;font-size:.7rem;background:var(--blue-l);color:var(--blue);padding:1px 6px;border-radius:4px;font-weight:700">YOU</span>' : ''}
          </td>
          <td>${clientName}</td>
          <td style="font-weight:600">${custCount}</td>
          <td style="color:var(--muted);font-size:.78rem">${fmtDate(p.created_at)}</td>
          <td>
            <div style="display:flex;gap:4px;flex-wrap:nowrap">
              <button class="btn btn-xs btn-outline" onclick="openEditUserModal('${uid}','${email}','${escHtml(clientId)}')">Edit</button>
              ${isSelf
                ? '<span style="font-size:.75rem;color:var(--subtle);padding:2px 4px">Can\'t Delete</span>'
                : `<button class="btn btn-xs btn-danger" onclick="adminDeleteUser('${uid}','${email}')">Remove</button>`}
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
    const { data: signUpData, error: signUpErr } = await sb.auth.signUp({
      email, password: pw,
      options: { emailRedirectTo: window.location.href }
    });
    if (signUpErr) throw signUpErr;

    // If identities is empty, this email already exists in Supabase
    if (signUpData?.user?.identities?.length === 0) {
      throw new Error(`A user with email "${email}" already exists.`);
    }

    const newUserId = signUpData?.user?.id;
    if (!newUserId) throw new Error('Signup succeeded but no user ID returned. Check Supabase Auth settings.');

    const client = adminClients.find(c => c.id === clientId);
    const { error: profileErr } = await sb.from('user_profiles').upsert({
      user_id:       newUserId,
      email,
      business_name: client ? client.name : '',
      client_id:     clientId || null,
      created_at:    new Date().toISOString()
    }, { onConflict: 'user_id' });

    if (profileErr) throw new Error('User created in Auth but profile save failed: ' + profileErr.message);

    el('cu-ok').textContent  = `User "${email}" created! They can log in now with the password you set.`;
    el('cu-btn').textContent = 'Create User →';
    el('cu-btn').disabled    = false;
    toast(`User ${email} created`, 'success');
    setTimeout(() => { closeModal('create-user-modal'); renderUsers(); }, 2000);

  } catch(e) {
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

// Auto-register current user's profile on login (so admin can see them)
async function ensureUserProfile(user) {
  try {
    const { data } = await sb.from('user_profiles').select('user_id, role').eq('user_id', user.id).single();
    if (!data) {
      // Not registered yet — create profile row
      await sb.from('user_profiles').insert({
        user_id:       user.id,
        email:         user.email,
        business_name: '',
        role:          'user',
        created_at:    new Date().toISOString()
      });
      _userRole = 'user';
    } else {
      // Store the server-fetched role (can't be spoofed from console)
      _userRole = data.role || 'user';
    }
    // Re-apply admin UI now that role is confirmed from server
    updateUserUI(user);
  } catch(e) { /* silent — non-critical */ }
}
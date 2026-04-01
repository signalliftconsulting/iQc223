// ─── AUTH ────────────────────────────────────────────────────
function showAuthGate() {
  document.getElementById('auth-gate').style.display = 'flex';
  document.querySelector('.shell')?.style.setProperty('display','none');
  document.querySelector('.footer')?.style.setProperty('display','none');
  document.body.classList.remove('authed');
}

function hideAuthGate() {
  document.getElementById('auth-gate').style.display = 'none';
  document.querySelector('.shell')?.style.removeProperty('display');
  document.querySelector('.footer')?.style.removeProperty('display');
  document.body.classList.add('authed');
}

function authTab(tab) {
  ['login','signup','reset','newpass'].forEach(t => {
    var form = document.getElementById('form-'+t);
    if (form) form.style.display = t===tab ? 'block' : 'none';
    const btn = document.getElementById('tab-'+t);
    if (btn) {
      btn.style.color = t===tab ? 'var(--text)' : 'var(--muted)';
      btn.style.borderBottomColor = t===tab ? 'var(--teal)' : 'transparent';
    }
  });
  // Hide/show tabs bar (reset and newpass forms show back link instead)
  var tabBar = document.querySelector('.auth-card > div:first-child');
  if (tabBar && tabBar.querySelector('#tab-login')) {
    tabBar.style.display = (tab === 'reset' || tab === 'newpass') ? 'none' : 'flex';
  }
  document.getElementById('auth-err').textContent = '';
  document.getElementById('auth-ok').textContent  = '';
}

function authSetBusy(busy) {
  ['login-btn','signup-btn','reset-btn','newpass-btn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.disabled = busy;
  });
}

function authErr(msg) {
  document.getElementById('auth-err').textContent = msg;
  document.getElementById('auth-ok').textContent  = '';
  authSetBusy(false);
}

function authOk(msg) {
  document.getElementById('auth-ok').textContent  = msg;
  document.getElementById('auth-err').textContent = '';
  authSetBusy(false);
}

async function authSignIn() {
  const email = el('login-email')?.value.trim();
  const pw    = el('login-pw')?.value;
  if (!email || !pw) { authErr('Please enter your email and password.'); return; }
  authSetBusy(true);
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  if (error) { authErr(error.message); return; }
  // onAuthStateChange will handle the rest
}

async function authSignUp() {
  const name    = el('signup-name')?.value.trim();
  const email   = el('signup-email')?.value.trim();
  const company = el('signup-company')?.value.trim();
  const pw      = el('signup-pw')?.value;
  const pw2     = el('signup-pw2')?.value;
  if (!name)       { authErr('Please enter your name.'); return; }
  if (!email)      { authErr('Please enter your email.'); return; }
  if (!company)    { authErr('Please enter your company name.'); return; }
  if (!pw)         { authErr('Please choose a password.'); return; }
  if (pw.length<8) { authErr('Password must be at least 8 characters.'); return; }
  if (pw !== pw2)  { authErr('Passwords do not match.'); return; }
  authSetBusy(true);
  const { error } = await sb.auth.signUp({
    email,
    password: pw,
    options: { data: { full_name: name, company_name: company } }
  });
  if (error) {
    const msg = error.message || '';
    if (msg.includes('already registered') || msg.includes('duplicate')) {
      authErr('This email is already registered. Try signing in.');
      return;
    }
    if (msg.includes('rate') || msg.includes('429') || msg.includes('Too many')) {
      authErr('Too many sign-up attempts. Please wait a few minutes and try again.');
      return;
    }
    // Supabase often returns "Database error" when the user IS created
    // but an internal post-signup hook fails. Check if it's a soft error.
    if (msg.toLowerCase().includes('database') || msg.toLowerCase().includes('unexpected')) {
      console.warn('[auth] signUp soft error (user likely created):', msg);
      // Show success anyway  -  the email will confirm if user was actually created
      authOk('Account created! Check your email to confirm, then sign in.');
      setTimeout(function() { authTab('login'); }, 4000);
      return;
    }
    authErr(error.message);
    return;
  }
  // Supabase sends confirmation email via Custom SMTP (Resend)
  // User must click confirm link before they can sign in
  authOk('Account created! Check your email to confirm, then sign in.');
  setTimeout(function() { authTab('login'); }, 4000);
}

async function authReset() {
  const email = el('reset-email')?.value.trim();
  if (!email) { authErr('Please enter your email address.'); return; }
  authSetBusy(true);
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://iqc223.com'
  });
  if (error) { authErr(error.message); return; }
  authOk('Check your email for a reset link.');
}

async function authSetNewPassword() {
  const pw  = el('newpass-pw')?.value;
  const pw2 = el('newpass-pw2')?.value;
  if (!pw)         { authErr('Please enter a new password.'); return; }
  if (pw.length<8) { authErr('Password must be at least 8 characters.'); return; }
  if (pw !== pw2)  { authErr('Passwords do not match.'); return; }
  authSetBusy(true);
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) { authErr(error.message); return; }
  authOk('Password updated! Redirecting to sign in...');
  setTimeout(function() { authTab('login'); }, 2000);
}

async function authSignOut() {
  // Clear any stuck loading overlay first
  _loadingCount = 0;
  clearTimeout(_loadingTimeout);
  _showOverlay(false);
  stopPolling();
  currentUser = null;
  _userRole   = null;
  _userClientId = null;
  customers   = [];
  trash       = [];
  // Clear all cached data to prevent leakage to next user (preserve UX flags like shimmer/tour dismissals)
  var _keepKeys = { iqc_score_settings_clicked:1, iqc_score_settings_toured:1, iqc_qbr_clicked:1, iqc_welcome_v3:1, iqc_cookie_consent:1 };
  Object.keys(localStorage).filter(k => k.startsWith('iqc_') && !_keepKeys[k]).forEach(k => localStorage.removeItem(k));
  // Show login immediately  - don't wait for Supabase
  showAuthGate();
  authTab('login');
  authSetBusy(false); // Re-enable sign-in buttons
  toast('Signed out', 'default');
  // Fire-and-forget Supabase sign out (don't block UI on network issues)
  try { await sb.auth.signOut(); } catch(e) { console.warn('Sign out request failed:', e); }
}

// Auto-register current user's profile on login (so admin can see them)
// Must be in core bundle  -  called by main.js during boot before any data loads.
var _ensureProfileBusy = false;
async function ensureUserProfile(user) {
  if (_ensureProfileBusy) return;
  _ensureProfileBusy = true;
  try { await _ensureUserProfileInner(user); } finally { _ensureProfileBusy = false; }
}
async function _ensureUserProfileInner(user) {
  try {
    const { data: rows } = await sb.from('user_profiles').select('user_id, role, client_id').eq('user_id', user.id).limit(1);
    const data = rows && rows.length ? rows[0] : null;
    if (!data) {
      // Not registered yet  -  create profile row
      var fullName = (user.user_metadata && user.user_metadata.full_name) || user.email.split('@')[0];
      var companyName = (user.user_metadata && user.user_metadata.company_name) || '';
      await sb.from('user_profiles').insert({
        user_id:       user.id,
        email:         user.email,
        business_name: companyName || fullName,
        role:          'user',
        created_at:    new Date().toISOString()
      });
      _userRole = 'user';
      _userClientId = null;

      // Auto-provision a client account for self-sign-up users
      try {
        // Check if client already exists (prevent duplicates)
        var _ecResult = await sb.from('clients').select('id').eq('user_id', user.id).limit(1);
        if (_ecResult.data && _ecResult.data.length) {
          _userClientId = _ecResult.data[0].id;
          await sb.from('user_profiles').update({ client_id: _userClientId }).eq('user_id', user.id);
          console.log('[auth] Found existing client:', _userClientId);
          toast('Account ready! Loading...', 'success');
          setTimeout(() => location.reload(), 600);
          return;
        } else {
          var clientName = companyName || (fullName + "'s Account");
          var { data: newClient, error: clientErr } = await sb.from('clients').insert({
            name:         clientName,
            user_id:      user.id,
            plan_tier:    'starter',
            trial_expires: new Date(Date.now() + 14 * 86400000).toISOString(),
            created_at:   new Date().toISOString()
          }).select('id').single();

          if (!clientErr && newClient) {
            _userClientId = newClient.id;
            await sb.from('user_profiles').update({ client_id: newClient.id }).eq('user_id', user.id);
            console.log('[auth] Auto-provisioned client:', clientName, newClient.id);
            toast('Account ready! Loading...', 'success');
            setTimeout(() => location.reload(), 600);
            return;
          } else {
            console.warn('[auth] Client creation failed:', clientErr?.message);
            toast('Account setup issue \u2014 refreshing...', 'warn');
            setTimeout(() => location.reload(), 2000);
            return;
          }
        }
      } catch(e2) { console.warn('[auth] Auto-provision error:', e2.message); }
    } else {
      // Store the server-fetched role (can't be spoofed from console)
      _userRole = data.role || 'user';
      _userClientId = data.client_id || null;

      // If profile exists but no client assigned, auto-provision one
      if (!_userClientId && _userRole !== 'admin') {
        // Check if client already exists for this user (prevent duplicates from double-fire)
        var _existCheck = await sb.from('clients').select('id').eq('user_id', user.id).limit(1);
        if (_existCheck.data && _existCheck.data.length) {
          // Client exists  -  link it and reload so all data loads with client_id
          _userClientId = _existCheck.data[0].id;
          await sb.from('user_profiles').update({ client_id: _userClientId }).eq('user_id', user.id);
          console.log('[auth] Found existing client for user:', _userClientId);
          toast('Account ready! Loading...', 'success');
          setTimeout(() => location.reload(), 600);
          return;
        } else {
          var _pName = (user.user_metadata && user.user_metadata.full_name) || user.email.split('@')[0];
          var _pCompany = (user.user_metadata && user.user_metadata.company_name) || '';
          var _pClientName = _pCompany || (_pName + "'s Account");
          console.log('[auth] Provisioning new client:', _pClientName);
          toast('Setting up your account...', 'default');
          var _pResult = await sb.from('clients').insert({
            name:         _pClientName,
            user_id:      user.id,
            plan_tier:    'starter',
            trial_expires: new Date(Date.now() + 14 * 86400000).toISOString(),
            created_at:   new Date().toISOString()
          }).select('id').single();

          if (!_pResult.error && _pResult.data) {
            _userClientId = _pResult.data.id;
            await sb.from('user_profiles').update({ client_id: _pResult.data.id }).eq('user_id', user.id);
            console.log('[auth] Auto-provisioned client:', _pClientName, _pResult.data.id);
            toast('Account ready! Loading...', 'success');
            // Reload so all data loads with the new client_id
            setTimeout(() => location.reload(), 600);
            return;
          } else {
            console.error('[auth] Client creation failed:', _pResult.error?.message);
            toast('Account setup issue \u2014 refreshing...', 'warn');
            setTimeout(() => location.reload(), 2000);
          }
        }
      }
    }
    // Re-apply admin UI now that role is confirmed from server
    updateUserUI(user);
  } catch(e) { console.warn('[auth] ensureUserProfile error:', e.message); }
}

function updateUserUI(user) {
  const pill   = el('user-pill');
  const avatar = el('user-avatar');
  const label  = el('user-email-lbl');
  const signout= el('signout-btn');
  const settingsEmail = el('settings-email');
  if (user) {
    const initials = user.email.slice(0,2).toUpperCase();
    if (pill)   { pill.style.display = 'none'; }
    if (avatar) avatar.textContent = initials;
    if (label)  label.textContent  = user.email;
    if (signout) signout.style.display = '';
    if (settingsEmail) settingsEmail.textContent = user.email;
    // Topbar avatar + menu
    const tbAvatar = el('tb-avatar');
    const tbInfo   = el('tb-user-info');
    const firstInitial = user.email.charAt(0).toUpperCase();
    if (tbAvatar) tbAvatar.textContent = firstInitial;
    if (tbInfo) tbInfo.textContent = user.email;
    // Sidebar user area
    const sbAvatar = el('sb-avatar');
    const sbName   = el('sb-name');
    const sbPlan   = el('sb-plan');
    if (sbAvatar) sbAvatar.textContent = firstInitial;
    if (sbName) sbName.textContent = user.email.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    if (sbPlan) sbPlan.textContent = user.email;

    // Show admin nav items  - uses isAdmin() which checks server-fetched role first
    const admin = isAdmin();
    ['ni-admin-sep','ni-admin-label','ni-clients','ni-users','ni-analytics'].forEach(id => {
      const el2 = document.getElementById(id);
      if (el2) el2.style.display = admin ? '' : 'none';
    });
    // Hide Plan & Billing tab and sidebar plan info for non-admin users
    const billingTab = document.getElementById('cfg-tab-billing');
    if (billingTab) billingTab.style.display = admin ? '' : 'none';
    if (sbPlan) sbPlan.style.display = admin ? '' : 'none';
    const cfw = document.getElementById('client-filter-wrap');
    if (cfw) cfw.style.display = admin ? '' : 'none';
    if (admin && typeof loadAdminClients === 'function') loadAdminClients();
  } else {
    if (pill)    pill.style.display    = 'none';
    if (signout) signout.style.display = 'none';
    ['ni-admin-sep','ni-admin-label','ni-clients','ni-users','ni-analytics'].forEach(id => {
      const el2 = document.getElementById(id);
      if (el2) el2.style.display = 'none';
    });
    const cfw = document.getElementById('client-filter-wrap');
    if (cfw) cfw.style.display = 'none';
    const billingTab2 = document.getElementById('cfg-tab-billing');
    if (billingTab2) billingTab2.style.display = 'none';
    const sbPlan2 = document.getElementById('sb-plan');
    if (sbPlan2) sbPlan2.style.display = 'none';
  }
}

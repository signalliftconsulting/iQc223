// ─── AUTH ────────────────────────────────────────────────────
function showAuthGate() {
  document.getElementById('auth-gate').style.display = 'flex';
  document.querySelector('.shell')?.style.setProperty('display','none');
  document.querySelector('.topbar')?.style.setProperty('visibility','hidden');
  document.querySelector('.footer')?.style.setProperty('display','none');
}

function hideAuthGate() {
  document.getElementById('auth-gate').style.display = 'none';
  document.querySelector('.shell')?.style.removeProperty('display');
  document.querySelector('.topbar')?.style.removeProperty('visibility');
  document.querySelector('.footer')?.style.removeProperty('display');
}

function authTab(tab) {
  ['login','signup','reset'].forEach(t => {
    document.getElementById('form-'+t).style.display  = t===tab ? 'block' : 'none';
    const btn = document.getElementById('tab-'+t);
    if (btn) btn.classList.toggle('active', t===tab);
  });
  document.getElementById('auth-err').textContent = '';
  document.getElementById('auth-ok').textContent  = '';
}

function authSetBusy(busy) {
  ['login-btn','signup-btn','reset-btn'].forEach(id => {
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
  const email = el('signup-email')?.value.trim();
  const pw    = el('signup-pw')?.value;
  const pw2   = el('signup-pw2')?.value;
  if (!email)      { authErr('Please enter your email.'); return; }
  if (!pw)         { authErr('Please choose a password.'); return; }
  if (pw.length<6) { authErr('Password must be at least 6 characters.'); return; }
  if (pw !== pw2)  { authErr('Passwords do not match.'); return; }
  authSetBusy(true);
  const { error } = await sb.auth.signUp({ email, password: pw });
  if (error) { authErr(error.message); return; }
  authOk('Account created! Check your email to confirm, then sign in.');
}

async function authReset() {
  const email = el('reset-email')?.value.trim();
  if (!email) { authErr('Please enter your email address.'); return; }
  authSetBusy(true);
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href
  });
  if (error) { authErr(error.message); return; }
  authOk('Reset link sent! Check your email.');
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
  // Clear all cached data to prevent leakage to next user
  Object.keys(localStorage).filter(k => k.startsWith('iqc_')).forEach(k => localStorage.removeItem(k));
  // Show login immediately  - don't wait for Supabase
  showAuthGate();
  authTab('login');
  toast('Signed out', 'default');
  // Fire-and-forget Supabase sign out (don't block UI on network issues)
  try { await sb.auth.signOut(); } catch(e) { console.warn('Sign out request failed:', e); }
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
    ['ni-admin-sep','ni-admin-label','ni-clients','ni-users'].forEach(id => {
      const el2 = document.getElementById(id);
      if (el2) el2.style.display = admin ? '' : 'none';
    });
    const cfw = document.getElementById('client-filter-wrap');
    if (cfw) cfw.style.display = admin ? '' : 'none';
    if (admin) loadAdminClients();
  } else {
    if (pill)    pill.style.display    = 'none';
    if (signout) signout.style.display = 'none';
    ['ni-admin-sep','ni-admin-label','ni-clients','ni-users'].forEach(id => {
      const el2 = document.getElementById(id);
      if (el2) el2.style.display = 'none';
    });
    const cfw = document.getElementById('client-filter-wrap');
    if (cfw) cfw.style.display = 'none';
  }
}

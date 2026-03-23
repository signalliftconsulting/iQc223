// ─── CACHE PRUNING ───────────────────────────────────────────
function _pruneAiLocalStorage() {
  try {
    for (var i = localStorage.length - 1; i >= 0; i--) {
      var k = localStorage.key(i);
      if (k && k.startsWith('iqc_ai_')) {
        try {
          var parsed = JSON.parse(localStorage.getItem(k));
          if (!parsed || !parsed.ts || (Date.now() - parsed.ts) > AI_PERSIST_TTL) {
            localStorage.removeItem(k);
          }
        } catch(e) { localStorage.removeItem(k); }
      }
    }
  } catch(e) { console.warn('ls:', e.message); }
}

// ─── WELCOME MODAL (first-time users) ────────────────────────
function showWelcome() {
  const m = document.getElementById('welcome-modal');
  if (!m) return;
  // Force visibility with inline styles to override all CSS rules
  m.style.cssText = 'display:flex;position:fixed;inset:0;z-index:10000;align-items:center;justify-content:center;background:rgba(15,23,42,.5);backdrop-filter:blur(3px);opacity:1;pointer-events:auto;padding:16px';
}
function closeWelcome() {
  const m = document.getElementById('welcome-modal');
  if (m) { m.style.cssText = 'display:none'; }
  // Only permanently dismiss if "Don't show again" is checked
  const dsa = document.getElementById('welcome-dsa');
  if (dsa && dsa.checked) {
    localStorage.setItem('iqc_welcome_v3', '1');
  }
}
function _maybeShowWelcome() {
  if (!localStorage.getItem('iqc_welcome_v3')) {
    setTimeout(showWelcome, 1200);
  }
}

// ─── WHAT'S NEW / CHANGELOG ──────────────────────────────────
const _CHANGELOG = [
  {
    version: '2.3',
    date: '2026-03-19',
    items: [
      { type: 'new', text: 'Usage Analytics - admin dashboard tracking page views, sessions, and user activity' },
      { type: 'new', text: 'Server-side plan enforcement - account and user limits enforced at the database level' },
      { type: 'new', text: 'Automated R2 backups - daily database snapshots to Cloudflare R2' },
      { type: 'new', text: 'What\'s New changelog - see what\'s changed right from the sidebar' },
    ]
  },
  {
    version: '2.2',
    date: '2026-03-15',
    items: [
      { type: 'new', text: 'Revenue Forecasting page with NRR projection, waterfall chart, and risk pipeline' },
      { type: 'new', text: 'Searchable client inputs in Trends - type to filter instead of scrolling dropdowns' },
      { type: 'improve', text: 'Trends analysis engine rewrite - statistical analysis with descriptive stats, context-aware insights' },
      { type: 'improve', text: 'Demo data overhaul - varied trajectories, staggered start dates, realistic mid-range scores' },
      { type: 'fix', text: 'Analysis numbers now match KPIs exactly across all views' },
      { type: 'fix', text: 'Admin user creation no longer auto-logs in as the new user' },
    ]
  },
  {
    version: '2.1',
    date: '2026-03-05',
    items: [
      { type: 'new', text: 'Segments analysis with tabbed insights - view by segments, tiers, or lifecycle stages' },
      { type: 'new', text: 'Interactive walkthroughs on every page with Tour buttons' },
      { type: 'new', text: 'Welcome modal for first-time users with "Don\'t show again" option' },
      { type: 'improve', text: 'Score Settings button on Home Base and Score a Customer for quick access' },
      { type: 'improve', text: 'Scoring config tab renamed from "Config" for clarity' },
      { type: 'fix', text: 'Cloudflare deploy fix - removed oversized binary from repo' },
    ]
  }
];

const _CHANGELOG_VERSION = '2.3'; // bump this when adding new entries

function showWhatsNew() {
  const body = document.getElementById('whatsnew-body');
  if (!body) return;

  const typeColors = { 'new': '#10b981', improve: '#3b82f6', fix: '#f59e0b' };
  const typeLabels = { 'new': 'NEW', improve: 'IMPROVED', fix: 'FIXED' };

  body.innerHTML = _CHANGELOG.map(release => `
    <div style="margin-bottom:18px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-weight:700;font-size:var(--fs-base);color:var(--fg)">v${release.version}</span>
        <span style="font-size:var(--fs-sm);color:var(--muted)">${release.date}</span>
      </div>
      ${release.items.map(item => `
        <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:5px;padding-left:4px">
          <span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;color:#fff;background:${typeColors[item.type]};flex-shrink:0;margin-top:2px">${typeLabels[item.type]}</span>
          <span style="font-size:var(--fs-sm);color:var(--text);line-height:1.5">${item.text}</span>
        </div>`).join('')}
    </div>`).join('<div style="border-top:1px solid var(--border);margin:0 0 18px"></div>');

  const modal = document.getElementById('whatsnew-modal');
  if (modal) modal.style.display = 'flex';

  // Mark this version as seen
  localStorage.setItem('iqc_changelog_seen', _CHANGELOG_VERSION);
}

function closeWhatsNew() {
  const modal = document.getElementById('whatsnew-modal');
  if (modal) modal.style.display = 'none';
}

function _maybeShowWhatsNew() {
  const seen = localStorage.getItem('iqc_changelog_seen');
  if (seen !== _CHANGELOG_VERSION) {
    // Show after a delay, but not on first ever visit (welcome modal takes priority)
    if (localStorage.getItem('iqc_welcome_v3')) {
      setTimeout(showWhatsNew, 2000);
    }
  }
}

// ─── USER-SWITCH GUARD ──────────────────────────────────────
// Detects when a different user signs in on the same browser and
// purges stale localStorage + in-memory state from the previous user.
function _checkUserSwitch(userId) {
  const prev = localStorage.getItem('iqc_uid');
  // Purge if: different user detected, OR iqc_uid never set but stale data exists (pre-update)
  var _uxKeep = { iqc_score_settings_clicked:1, iqc_score_settings_toured:1, iqc_qbr_clicked:1, iqc_welcome_v3:1, iqc_cookie_consent:1 };
  if (prev !== userId) {
    Object.keys(localStorage)
      .filter(k => k.startsWith('iqc_') && k !== 'iqc_uid' && !_uxKeep[k])
      .forEach(k => localStorage.removeItem(k));
    customers = [];
    trash = [];
    window._manualCSMs = [];
    auditLogs = []; auditOffset = 0;
    loadSettings(); // reset all in-memory state to defaults
    if (prev) console.info('[auth] User switch detected - cleared stale cache');
  }
  localStorage.setItem('iqc_uid', userId);
}

// ─── BOOT ────────────────────────────────────────────────────
(async function init() {
  // Load settings from localStorage immediately (fast local cache)
  loadSettings();

  // ── Step 1: Check for existing session instantly ──────────
  // getSession() reads from localStorage - no network call needed.
  // This prevents the flicker of showing the auth gate on refresh.
  const { data: { session: existingSession } } = await sb.auth.getSession();

  if (existingSession?.user) {
    // Already logged in - show app immediately
    currentUser = existingSession.user;
    _checkUserSwitch(currentUser.id);
    hideAuthGate();
    updateUserUI(currentUser);
    _updateAllGuideBadges();
    await ensureUserProfile(currentUser); // register in user_profiles + resolve _userClientId before loading data

    // Load from cache instantly - no spinner
    let hasCached = false;
    try {
      const cached = localStorage.getItem('iqc_customers_cache');
      if (cached) {
        customers = JSON.parse(cached);
        // Migrate cached data from older versions
        customers.forEach(c => {
          // Decode encoded "nps|csat" pair from old cache (pre-v128)
          if (typeof c.nps === 'string' && c.nps.includes('|')) {
            const fb = decodeFeedbackPair(c.nps);
            c.nps = fb.nps;
            c.csat = fb.csat;
          }
          // Backfill NPS/CSAT in old history signals (pre-v127)
          if (typeof _migrateHistory === 'function') _migrateHistory(c.history, c.nps, c.csat);
        });
        hasCached = true;
      }
    } catch(e) { console.warn('ls:', e.message); }

    // Restore last active view (or default to dashboard)
    const savedView = localStorage.getItem('iqc_active_view');
    const restoreView = savedView && VIEWS.includes(savedView) ? savedView : 'homebase';

    refreshLiveScores();
    refreshMgrDropdown();
    nav(restoreView);
    renderSettings();
    startPolling();

    // Sync from Supabase - only show spinner if no cache (first ever load)
    if (!hasCached) setLoading(true);
    try {
      await loadSettingsFromSupabase();
      _pruneAiLocalStorage();
      await loadCustomersFromSupabase();
      await resolveClientPlanTier();
      _loadAIUsage();
      // Check AI integration status early so homebase Focus List works
      // AI is platform-provided — no per-client integration check needed
    } catch(err) {
      console.error('Supabase sync error:', err?.message || err, err);
      if (err?.message?.includes('quota')) {
        console.warn('[sync] localStorage quota - clearing cache');
        try { localStorage.removeItem('iqc_customers_cache'); } catch(e2) { console.warn('ls:', e2.message); }
      } else {
        toast('Could not reach Supabase - showing cached data', 'warn');
      }
    } finally {
      setLoading(false);
      refreshLiveScores();
      refreshMgrDropdown();
      nav(restoreView);
      renderSettings();
      // Handle billing redirect
      var _billingParam = new URLSearchParams(window.location.search).get('billing');
      if (_billingParam === 'success') {
        toast('Subscription activated! Welcome to ' + (PLAN_TIER_LABELS[clientPlanTier] || clientPlanTier) + '.', 'success');
        window.history.replaceState({}, '', window.location.pathname);
        nav('settings'); setTimeout(function() { cfgTab('billing'); }, 200);
      } else if (_billingParam === 'canceled') {
        toast('Checkout canceled', 'warn');
        window.history.replaceState({}, '', window.location.pathname);
      }
      // Check and send any due scheduled reports
      if (typeof checkScheduledReports === 'function') setTimeout(checkScheduledReports, 3000);
      // Show/hide topbar Stripe sync button based on integration status
      if (typeof updateTopbarSyncVisibility === 'function') updateTopbarSyncVisibility();
      // Auto-sync Stripe on page load (silent) + start hourly interval
      if (typeof autoSyncStripe === 'function') {
        setTimeout(autoSyncStripe, 5000); // 5s delay to let UI settle
        _stripeSyncTimer = setInterval(autoSyncStripe, 60 * 60 * 1000);
      }
      // Auto-sync HubSpot on page load (silent) + start hourly interval
      if (typeof autoSyncHubSpot === 'function') {
        setTimeout(autoSyncHubSpot, 8000); // 8s delay (after Stripe)
        _hubspotSyncTimer = setInterval(autoSyncHubSpot, 60 * 60 * 1000);
      }
      // Auto-sync Salesforce on page load (silent) + start hourly interval
      if (typeof autoSyncSalesforce === 'function') {
        setTimeout(autoSyncSalesforce, 11000); // 11s delay (after HubSpot)
        setInterval(autoSyncSalesforce, 60 * 60 * 1000);
      }
      // Resume walkthrough panel if it was active
      if (typeof _wtResume === 'function') _wtResume();
      // Show welcome modal for first-time users, or What's New for returning users
      _maybeShowWelcome();
      _maybeShowWhatsNew();
    }

  } else {
    // No session - show auth gate
    showAuthGate();
  }

  // ── Step 2: Listen for future auth changes (sign in / sign out) ──
  sb.auth.onAuthStateChange(async (event, session) => {
    // Ignore INITIAL_SESSION - already handled above via getSession()
    if (event === 'INITIAL_SESSION') return;

    // Suppress auth events during admin user creation (signUp swaps session temporarily)
    if (window._adminCreatingUser) return;

    // TOKEN_REFRESHED fires silently when returning to the tab - don't reload
    if (event === 'TOKEN_REFRESHED') {
      currentUser = session?.user || null;
      silentSync(); // background refresh, no spinner
      return;
    }

    currentUser = session?.user || null;

    if (!currentUser) {
      stopPolling();
      customers = [];
      showAuthGate();
      authTab('login');
      return;
    }

    // SIGNED_IN can fire on token refresh after expiry - if we already have data
    // AND it's the same user, treat it like TOKEN_REFRESHED (silent sync, no overlay).
    // If it's a different user, fall through to full sign-in flow.
    const prevUid = localStorage.getItem('iqc_uid');
    if (customers.length > 0 && prevUid === currentUser.id) {
      silentSync();
      return;
    }

    // Skip everything during sign-up flow
    if (window._signUpInProgress) {
      console.log('[auth] Sign-up in progress — skipping onAuthStateChange');
      return;
    }

    // Check if email is verified before allowing access
    var _verifyCheck = await sb.from('user_profiles').select('email_verified').eq('user_id', currentUser.id).single();
    if (_verifyCheck.data && _verifyCheck.data.email_verified === false) {
      console.log('[auth] Unverified user — signing out');
      await sb.auth.signOut();
      showAuthGate();
      authTab('login');
      authErr('Please confirm your email before signing in.');
      return;
    }

    // Fresh sign-in only (no existing data loaded)
    _checkUserSwitch(currentUser.id);
    hideAuthGate();
    updateUserUI(currentUser);
    _updateAllGuideBadges();
    if (typeof _trackLogin === 'function') _trackLogin();
    await ensureUserProfile(currentUser); // resolve _userClientId before loading data
    nav('homebase');
    renderSettings();
    startPolling();

    setLoading(true);
    try {
      await loadSettingsFromSupabase();
      await loadCustomersFromSupabase();
      await resolveClientPlanTier();
      // Check AI integration status early so homebase Focus List works
      // AI is platform-provided — no per-client integration check needed
    } catch(err) {
      console.error('Supabase sync error:', err?.message || err, err);
      if (err?.message?.includes('quota')) {
        console.warn('[sync] localStorage quota - clearing cache');
        try { localStorage.removeItem('iqc_customers_cache'); } catch(e2) { console.warn('ls:', e2.message); }
      } else {
        toast('Could not reach Supabase - showing cached data', 'warn');
      }
    } finally {
      setLoading(false);
      refreshMgrDropdown();

      // Check for HubSpot OAuth callback
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('hubspot_connected') === '1') {
        // Clean URL
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
        toast('HubSpot connected successfully!', 'success');
        // Refresh integration cache and navigate to settings
        try { delete _integrationCache['hubspot']; } catch(_) { console.warn('ls:', _.message); }
        nav('settings');
        renderSettings();
      } else if (urlParams.get('hubspot_error')) {
        const err = urlParams.get('hubspot_error');
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
        toast('HubSpot connection failed: ' + err, 'error');
        nav('settings');
        renderSettings();
      } else if (urlParams.get('salesforce_connected') === '1') {
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
        toast('Salesforce connected successfully!', 'success');
        try { delete _integrationCache['salesforce']; } catch(_) { console.warn('ls:', _.message); }
        nav('settings');
        renderSettings();
      } else if (urlParams.get('salesforce_error')) {
        const err = urlParams.get('salesforce_error');
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
        toast('Salesforce connection failed: ' + err, 'error');
        nav('settings');
        renderSettings();
      } else {
        nav('homebase');
        renderSettings();
      }
      // Show welcome modal for first-time users, or What's New for returning users
      _maybeShowWelcome();
      _maybeShowWhatsNew();
    }
  });
})();

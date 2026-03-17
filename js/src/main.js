// ─── WELCOME MODAL (first-time users) ────────────────────────
function showWelcome() {
  const m = document.getElementById('welcome-modal');
  if (m) m.style.display = 'flex';
}
function closeWelcome() {
  const m = document.getElementById('welcome-modal');
  if (m) m.style.display = 'none';
  localStorage.setItem('iqc_welcome_v2', '1');
}
function _maybeShowWelcome() {
  if (!localStorage.getItem('iqc_welcome_v2')) {
    setTimeout(showWelcome, 600); // slight delay so app loads first
  }
}

// ─── USER-SWITCH GUARD ──────────────────────────────────────
// Detects when a different user signs in on the same browser and
// purges stale localStorage + in-memory state from the previous user.
function _checkUserSwitch(userId) {
  const prev = localStorage.getItem('iqc_uid');
  // Purge if: different user detected, OR iqc_uid never set but stale data exists (pre-update)
  if (prev !== userId) {
    Object.keys(localStorage)
      .filter(k => k.startsWith('iqc_') && k !== 'iqc_uid')
      .forEach(k => localStorage.removeItem(k));
    customers = [];
    trash = [];
    window._manualCSMs = [];
    auditLogs = []; auditOffset = 0;
    loadSettings(); // reset all in-memory state to defaults
    if (prev) console.info('[auth] User switch detected — cleared stale cache');
  }
  localStorage.setItem('iqc_uid', userId);
}

// ─── BOOT ────────────────────────────────────────────────────
(async function init() {
  // Load settings from localStorage immediately (fast local cache)
  loadSettings();

  // ── Step 1: Check for existing session instantly ──────────
  // getSession() reads from localStorage — no network call needed.
  // This prevents the flicker of showing the auth gate on refresh.
  const { data: { session: existingSession } } = await sb.auth.getSession();

  if (existingSession?.user) {
    // Already logged in — show app immediately
    currentUser = existingSession.user;
    _checkUserSwitch(currentUser.id);
    hideAuthGate();
    updateUserUI(currentUser);
    _updateAllGuideBadges();
    await ensureUserProfile(currentUser); // register in user_profiles + resolve _userClientId before loading data

    // Load from cache instantly — no spinner
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
    } catch(e) {}

    // Restore last active view (or default to dashboard)
    const savedView = localStorage.getItem('iqc_active_view');
    const restoreView = savedView && VIEWS.includes(savedView) ? savedView : 'homebase';

    refreshLiveScores();
    refreshMgrDropdown();
    nav(restoreView);
    renderSettings();
    startPolling();

    // Sync from Supabase — only show spinner if no cache (first ever load)
    if (!hasCached) setLoading(true);
    try {
      await loadSettingsFromSupabase();
      await loadCustomersFromSupabase();
      await resolveClientPlanTier();
    } catch(err) {
      console.error('Supabase sync error:', err?.message || err, err);
      if (err?.message?.includes('quota')) {
        console.warn('[sync] localStorage quota — clearing cache');
        try { localStorage.removeItem('iqc_customers_cache'); } catch(e2) {}
      } else {
        toast('Could not reach Supabase — showing cached data', 'warn');
      }
    } finally {
      setLoading(false);
      refreshLiveScores();
      refreshMgrDropdown();
      nav(restoreView);
      renderSettings();
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
      // Show welcome modal for first-time users
      _maybeShowWelcome();
    }

  } else {
    // No session — show auth gate
    showAuthGate();
  }

  // ── Step 2: Listen for future auth changes (sign in / sign out) ──
  sb.auth.onAuthStateChange(async (event, session) => {
    // Ignore INITIAL_SESSION — already handled above via getSession()
    if (event === 'INITIAL_SESSION') return;

    // TOKEN_REFRESHED fires silently when returning to the tab — don't reload
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

    // SIGNED_IN can fire on token refresh after expiry — if we already have data
    // AND it's the same user, treat it like TOKEN_REFRESHED (silent sync, no overlay).
    // If it's a different user, fall through to full sign-in flow.
    const prevUid = localStorage.getItem('iqc_uid');
    if (customers.length > 0 && prevUid === currentUser.id) {
      silentSync();
      return;
    }

    // Fresh sign-in only (no existing data loaded)
    _checkUserSwitch(currentUser.id);
    hideAuthGate();
    updateUserUI(currentUser);
    _updateAllGuideBadges();
    await ensureUserProfile(currentUser); // resolve _userClientId before loading data
    nav('homebase');
    renderSettings();
    startPolling();

    setLoading(true);
    try {
      await loadSettingsFromSupabase();
      await loadCustomersFromSupabase();
      await resolveClientPlanTier();
    } catch(err) {
      console.error('Supabase sync error:', err?.message || err, err);
      if (err?.message?.includes('quota')) {
        console.warn('[sync] localStorage quota — clearing cache');
        try { localStorage.removeItem('iqc_customers_cache'); } catch(e2) {}
      } else {
        toast('Could not reach Supabase — showing cached data', 'warn');
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
        try { delete _integrationCache['hubspot']; } catch(_) {}
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
        try { delete _integrationCache['salesforce']; } catch(_) {}
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
      // Show welcome modal for first-time users
      _maybeShowWelcome();
    }
  });
})();

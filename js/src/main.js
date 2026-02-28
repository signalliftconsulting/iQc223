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
    hideAuthGate();
    updateUserUI(currentUser);
    ensureUserProfile(currentUser); // register in user_profiles so admin can see this user

    // Load from cache instantly — no spinner
    let hasCached = false;
    try {
      const cached = localStorage.getItem('iqc_customers_cache');
      if (cached) { customers = JSON.parse(cached); hasCached = true; }
    } catch(e) {}

    refreshLiveScores();
    refreshMgrDropdown();
    renderDashboard();
    renderSettings();
    startPolling();

    // Sync from Supabase — only show spinner if no cache (first ever load)
    if (!hasCached) setLoading(true);
    try {
      await loadSettingsFromSupabase();
      await loadCustomersFromSupabase();
      await resolveClientPlanTier();
    } catch(err) {
      toast('Could not reach Supabase — showing cached data', 'warn');
    } finally {
      setLoading(false);
      refreshLiveScores();
      refreshMgrDropdown();
      renderDashboard();
      renderSettings();
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

    // Fresh sign-in only
    hideAuthGate();
    updateUserUI(currentUser);
    ensureUserProfile(currentUser);
    renderDashboard();
    renderSettings();
    startPolling();

    setLoading(true);
    try {
      await loadSettingsFromSupabase();
      await loadCustomersFromSupabase();
      await resolveClientPlanTier();
    } catch(err) {
      toast('Could not reach Supabase — showing cached data', 'warn');
    } finally {
      setLoading(false);
      refreshMgrDropdown();
      renderDashboard();
      renderSettings();
    }
  });
})();

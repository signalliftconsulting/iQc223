// ═══════════════════════════════════════════════════════════
// CREATE 10 DEMO CLIENTS + USERS
// ═══════════════════════════════════════════════════════════
//
// HOW TO RUN:
// 1. Log into iQcadence as admin in your browser
// 2. Open browser console (F12 > Console tab)
// 3. Paste this entire script and press Enter
// 4. Wait ~30 seconds for it to finish
// 5. Results table will print in the console
//
// Each iteration: creates a client, signs up a user,
// restores your admin session, links user to client.
// ═══════════════════════════════════════════════════════════

(async function() {
  const PASSWORD = 'hellouser2026!';
  const ACCOUNTS = [
    { num: '201', email: 'demo201@iqcadence.com', client: 'Demo201' },
    { num: '202', email: 'demo202@iqcadence.com', client: 'Demo202' },
    { num: '203', email: 'demo203@iqcadence.com', client: 'Demo203' },
    { num: '204', email: 'demo204@iqcadence.com', client: 'Demo204' },
    { num: '205', email: 'demo205@iqcadence.com', client: 'Demo205' },
    { num: '206', email: 'demo206@iqcadence.com', client: 'Demo206' },
    { num: '207', email: 'demo207@iqcadence.com', client: 'Demo207' },
    { num: '208', email: 'demo208@iqcadence.com', client: 'Demo208' },
    { num: '209', email: 'demo209@iqcadence.com', client: 'Demo209' },
    { num: '210', email: 'demo210@iqcadence.com', client: 'Demo210' },
  ];

  // Save admin session
  const { data: adminSession } = await sb.auth.getSession();
  const adminTokens = adminSession?.session ? {
    access_token: adminSession.session.access_token,
    refresh_token: adminSession.session.refresh_token,
  } : null;

  if (!adminTokens) {
    console.error('ERROR: Not logged in. Log in as admin first.');
    return;
  }

  const results = [];

  for (const acct of ACCOUNTS) {
    try {
      // 1. Create client
      const clientId = crypto.randomUUID();
      const { error: clientErr } = await sb.from('clients').insert({
        id: clientId,
        name: acct.client,
        notes: 'Demo account for early access testing',
        plan_tier: 'team',
        user_id: adminSession.session.user.id,
        created_at: new Date().toISOString()
      });
      if (clientErr) throw new Error('Client create failed: ' + clientErr.message);

      // 2. Sign up user (this swaps the session)
      const { data: signUpData, error: signUpErr } = await sb.auth.signUp({
        email: acct.email,
        password: PASSWORD,
        options: { emailRedirectTo: window.location.href }
      });
      if (signUpErr) throw new Error('SignUp failed: ' + signUpErr.message);

      // 3. Restore admin session immediately
      await sb.auth.setSession(adminTokens);

      const newUserId = signUpData?.user?.id;
      if (!newUserId) throw new Error('No user ID returned');

      if (signUpData?.user?.identities?.length === 0) {
        throw new Error('Email already exists');
      }

      // 4. Create user profile linked to client
      const { error: profileErr } = await sb.from('user_profiles').upsert({
        user_id: newUserId,
        email: acct.email,
        business_name: acct.client,
        client_id: clientId,
        created_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      if (profileErr) throw new Error('Profile save failed: ' + profileErr.message);

      results.push({ email: acct.email, client: acct.client, password: PASSWORD, status: 'OK' });
      console.log('Created: ' + acct.email + ' -> ' + acct.client);

    } catch (e) {
      // Restore admin session on error too
      if (adminTokens) await sb.auth.setSession(adminTokens);
      results.push({ email: acct.email, client: acct.client, password: PASSWORD, status: 'FAILED: ' + e.message });
      console.error('Failed: ' + acct.email + ' - ' + e.message);
    }
  }

  // Print results table
  console.log('\n═══ RESULTS ═══');
  console.table(results);
  console.log('\nAll accounts use password: ' + PASSWORD);
  console.log('Done! Refresh the Users page to see them.');
})();

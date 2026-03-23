// verify-email: handles the confirmation link click
// URL: /functions/v1/verify-email?token=xxx&email=xxx
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const email = url.searchParams.get("email");
  const redirect = url.searchParams.get("redirect") || "https://iqc223.com";

  if (!token || !email) {
    return new Response("<h2>Invalid verification link</h2>", {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Verify token matches what we stored
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const sb = createClient(supabaseUrl, serviceKey);

  // Look up the user profile by email
  const { data: profile, error: profileErr } = await sb
    .from("user_profiles")
    .select("user_id, email_verified, verification_token")
    .eq("email", email)
    .single();

  if (profileErr || !profile) {
    return new Response(`<html><head><meta http-equiv="refresh" content="3;url=${redirect}"></head><body style="font-family:system-ui;text-align:center;padding:60px"><h2>Account not found</h2><p>Redirecting to iQcadence...</p></body></html>`, {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (profile.email_verified) {
    // Already verified — just redirect
    return Response.redirect(redirect + "?verified=1", 302);
  }

  if (profile.verification_token !== token) {
    return new Response(`<html><head><meta http-equiv="refresh" content="3;url=${redirect}"></head><body style="font-family:system-ui;text-align:center;padding:60px"><h2>Invalid or expired link</h2><p>Please request a new confirmation email.</p><p>Redirecting to iQcadence...</p></body></html>`, {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Mark as verified
  const { error: updateErr } = await sb
    .from("user_profiles")
    .update({ email_verified: true, verification_token: null })
    .eq("user_id", profile.user_id);

  if (updateErr) {
    return new Response(`<html><body style="font-family:system-ui;text-align:center;padding:60px"><h2>Verification failed</h2><p>${updateErr.message}</p></body></html>`, {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Success — redirect to app with verified flag
  return Response.redirect(redirect + "?verified=1", 302);
});

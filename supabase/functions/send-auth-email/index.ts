import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "iQcadence <noreply@iqcadence.com>";

serve(async (req) => {
  // This is called by Supabase Auth as a custom email hook
  const payload = await req.json();

  // Supabase sends: { user, email_data: { token, token_hash, redirect_to, email_action_type } }
  const { user, email_data } = payload;
  const email = user?.email;
  const emailType = email_data?.email_action_type; // signup, recovery, invite, email_change
  const tokenHash = email_data?.token_hash;
  const redirectTo = email_data?.redirect_to || "https://iqc223.com";

  if (!email || !tokenHash) {
    return new Response(JSON.stringify({ error: "Missing email or token" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Build confirmation URL
  const confirmUrl = `https://qctiyigznbztxcowehnl.supabase.co/auth/v1/verify?token=${tokenHash}&type=${emailType}&redirect_to=${encodeURIComponent(redirectTo)}`;

  // Email templates by type
  let subject = "Confirm Your Email";
  let html = "";

  if (emailType === "signup") {
    subject = "Welcome to iQcadence — Confirm Your Email";
    html = `
      <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b">
        <div style="text-align:center;padding:24px 0">
          <img src="https://iqc223.com/Logo/iQcadence_logo.png" alt="iQcadence" style="height:40px;border-radius:8px" />
        </div>
        <h2 style="font-size:20px;margin:0 0 8px;text-align:center">Welcome to iQcadence</h2>
        <p style="font-size:14px;color:#64748b;text-align:center;line-height:1.6;margin:0 0 24px">Click the button below to confirm your email and activate your account.</p>
        <div style="text-align:center;margin-bottom:24px">
          <a href="${confirmUrl}" style="display:inline-block;background:#0f766e;color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Confirm Email</a>
        </div>
        <p style="font-size:12px;color:#94a3b8;text-align:center;line-height:1.5">If you didn't create an account, you can safely ignore this email.</p>
      </div>`;
  } else if (emailType === "recovery") {
    subject = "Reset Your iQcadence Password";
    html = `
      <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b">
        <div style="text-align:center;padding:24px 0">
          <img src="https://iqc223.com/Logo/iQcadence_logo.png" alt="iQcadence" style="height:40px;border-radius:8px" />
        </div>
        <h2 style="font-size:20px;margin:0 0 8px;text-align:center">Reset Your Password</h2>
        <p style="font-size:14px;color:#64748b;text-align:center;line-height:1.6;margin:0 0 24px">Click the button below to reset your password.</p>
        <div style="text-align:center;margin-bottom:24px">
          <a href="${confirmUrl}" style="display:inline-block;background:#0f766e;color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Reset Password</a>
        </div>
        <p style="font-size:12px;color:#94a3b8;text-align:center;line-height:1.5">If you didn't request this, you can safely ignore this email.</p>
      </div>`;
  } else {
    // Generic fallback for invite, email_change, etc.
    subject = "iQcadence — Verify Your Email";
    html = `
      <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b">
        <div style="text-align:center;padding:24px 0">
          <img src="https://iqc223.com/Logo/iQcadence_logo.png" alt="iQcadence" style="height:40px;border-radius:8px" />
        </div>
        <h2 style="font-size:20px;margin:0 0 8px;text-align:center">Verify Your Email</h2>
        <p style="font-size:14px;color:#64748b;text-align:center;line-height:1.6;margin:0 0 24px">Click the button below to verify your email address.</p>
        <div style="text-align:center;margin-bottom:24px">
          <a href="${confirmUrl}" style="display:inline-block;background:#0f766e;color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Verify Email</a>
        </div>
      </div>`;
  }

  // Send via Resend HTTP API
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      subject,
      html,
    }),
  });

  const result = await res.json();

  if (!res.ok) {
    console.error("Resend error:", result);
    return new Response(JSON.stringify({ error: result.message || "Email send failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log("Email sent:", email, emailType, result.id);
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// Minimal edge function — no imports to reduce cold start
Deno.serve(async (req) => {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
  const payload = await req.json();
  const { user, email_data } = payload;
  const email = user?.email;
  const emailType = email_data?.email_action_type;
  const tokenHash = email_data?.token_hash;
  const redirectTo = email_data?.redirect_to || "https://iqc223.com";

  if (!email || !tokenHash) {
    return new Response(JSON.stringify({ error: "Missing email or token" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const confirmUrl = `https://qctiyigznbztxcowehnl.supabase.co/auth/v1/verify?token=${tokenHash}&type=${emailType}&redirect_to=${encodeURIComponent(redirectTo)}`;

  const subjects: Record<string, string> = {
    signup: "Welcome to iQcadence — Confirm Your Email",
    recovery: "Reset Your iQcadence Password",
  };
  const subject = subjects[emailType] || "iQcadence — Verify Your Email";

  const headings: Record<string, string> = {
    signup: "Welcome to iQcadence",
    recovery: "Reset Your Password",
  };
  const heading = headings[emailType] || "Verify Your Email";

  const descs: Record<string, string> = {
    signup: "Click the button below to confirm your email and activate your account.",
    recovery: "Click the button below to reset your password.",
  };
  const desc = descs[emailType] || "Click the button below to verify your email address.";

  const btnLabels: Record<string, string> = {
    signup: "Confirm Email",
    recovery: "Reset Password",
  };
  const btnLabel = btnLabels[emailType] || "Verify Email";

  const html = `<div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b"><div style="text-align:center;padding:24px 0"><img src="https://iqc223.com/Logo/iQcadence_logo.png" alt="iQcadence" style="height:40px;border-radius:8px"/></div><h2 style="font-size:20px;margin:0 0 8px;text-align:center">${heading}</h2><p style="font-size:14px;color:#64748b;text-align:center;line-height:1.6;margin:0 0 24px">${desc}</p><div style="text-align:center;margin-bottom:24px"><a href="${confirmUrl}" style="display:inline-block;background:#0f766e;color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">${btnLabel}</a></div><p style="font-size:12px;color:#94a3b8;text-align:center;line-height:1.5">If you didn't request this, you can safely ignore this email.</p></div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "iQcadence <noreply@iqcadence.com>",
      to: [email],
      subject,
      html,
    }),
  });

  const result = await res.json();
  if (!res.ok) {
    return new Response(JSON.stringify({ error: result.message || "fail" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

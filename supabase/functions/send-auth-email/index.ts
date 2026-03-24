// send-auth-email: called by the app (not Supabase hooks) to send confirmation emails
// Expects JSON body: { email, name, type }
// type: "signup" | "resend" | "recovery"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "https://iqc223.com",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const corsHeaders = {
    "Access-Control-Allow-Origin": "https://iqc223.com",
    "Content-Type": "application/json",
  };

  try {
    const { email, name, type, support_data } = await req.json();

    // Handle support messages
    if (type === "support" && support_data) {
      const supportHtml = `<div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b">
        <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;font-size:18px">Support Request - ${support_data.category || "General"}</h2>
        </div>
        <div style="padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
          <p><strong>From:</strong> ${support_data.from_name || "Unknown"} (${support_data.from || "no email"})</p>
          <p><strong>Category:</strong> ${support_data.category || "Other"}</p>
          <p><strong>Subject:</strong> ${support_data.subject || "No subject"}</p>
          <p><strong>Plan:</strong> ${support_data.plan || "unknown"}</p>
          <p><strong>Client ID:</strong> ${support_data.client_id || "none"}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
          <p style="white-space:pre-wrap">${support_data.message || "No message"}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
          <p style="font-size:12px;color:#94a3b8">Sent at ${support_data.timestamp || new Date().toISOString()}</p>
        </div>
      </div>`;

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: "iQcadence Support <noreply@iqcadence.com>",
          to: ["support@iqcadence.com"],
          reply_to: support_data.from || undefined,
          subject: `[Support] ${support_data.category || "General"}: ${support_data.subject || "No subject"}`,
          html: supportHtml,
        }),
      });
      const result = await res.json();
      if (!res.ok) { console.error("Resend error:", result); return new Response(JSON.stringify({ error: "Send failed" }), { status: 500, headers: corsHeaders }); }
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    if (!email) {
      return new Response(JSON.stringify({ error: "Missing email" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Generate a secure random token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes, b => b.toString(16).padStart(2, "0")).join("");

    // Store token in user_profiles using service role (bypasses RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const sb = createClient(supabaseUrl, serviceKey);

    // Try to store token — retry if profile doesn't exist yet (race condition with sign-up)
    let tokenStored = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { error: updateErr, count } = await sb
        .from("user_profiles")
        .update({ verification_token: token })
        .eq("email", email);

      if (!updateErr) {
        tokenStored = true;
        break;
      }
      console.log(`Token store attempt ${attempt + 1} failed, retrying in 1s...`);
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!tokenStored) {
      console.error("Failed to store verification token after 5 attempts");
    }

    // Build verification URL
    const verifyUrl = `${supabaseUrl}/functions/v1/verify-email?token=${token}&email=${encodeURIComponent(email)}&redirect=https://iqc223.com`;

    const displayName = name || email.split("@")[0];

    // Email content
    let subject = "Welcome to iQcadence — Confirm Your Email";
    let heading = `Welcome, ${displayName}!`;
    let desc = "Click the button below to confirm your email and activate your account.";
    let btnLabel = "Confirm Email";

    if (type === "resend") {
      subject = "iQcadence — Confirm Your Email";
      heading = "Confirm Your Email";
      desc = "Click the button below to confirm your email and access iQcadence.";
    } else if (type === "recovery") {
      subject = "Reset Your iQcadence Password";
      heading = "Reset Your Password";
      desc = "Click the button below to reset your password.";
      btnLabel = "Reset Password";
    }

    const html = `<div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b"><div style="text-align:center;padding:24px 0"><img src="https://iqc223.com/Logo/iQcadence_logo.png" alt="iQcadence" style="height:40px;border-radius:8px"/></div><h2 style="font-size:20px;margin:0 0 8px;text-align:center">${heading}</h2><p style="font-size:14px;color:#64748b;text-align:center;line-height:1.6;margin:0 0 24px">${desc}</p><div style="text-align:center;margin-bottom:24px"><a href="${verifyUrl}" style="display:inline-block;background:#0f766e;color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">${btnLabel}</a></div><p style="font-size:12px;color:#94a3b8;text-align:center;line-height:1.5">If you didn't request this, you can safely ignore this email.</p></div>`;

    // Send via Resend
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
      console.error("Resend error:", result);
      return new Response(JSON.stringify({ error: result.message || "Email send failed" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (e) {
    console.error("send-auth-email error:", e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});

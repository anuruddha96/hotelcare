// Email settings backend.
//
// Two jobs, both admin/manager only:
//   status  — is the Resend key configured and accepted, and which domains are verified
//   test    — send a branded test message to the caller (or a given address)
//
// The key itself is never returned; only whether Resend accepts it.

import { createClient } from "npm:@supabase/supabase-js@2";
import { checkResendKey, loadEmailSettings, sendEmail, senderString } from "../_shared/emailSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ALLOWED_ROLES = ["admin", "manager", "top_management", "top_management_manager"];

function testHtml(orgName: string, sender: string) {
  return `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f1f5f9;padding:20px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:linear-gradient(135deg,#0f172a,#1d4ed8);padding:20px 24px;color:#fff">
        <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.8">Hotel Care</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px">E-mail is working</div>
      </div>
      <div style="padding:20px 24px;color:#334155;font-size:14px;line-height:1.6">
        <p style="margin:0 0 12px">This is a test message from <strong>${orgName}</strong>.</p>
        <p style="margin:0 0 12px">Sender used: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${sender}</code></p>
        <p style="margin:0;color:#64748b">If this landed in your inbox, ticket notifications, password resets and the
        morning revenue digest will be delivered the same way.</p>
      </div>
    </div>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: userRes } = await admin.auth.getUser(token);
    const user = userRes?.user;
    if (!user) return json({ error: "Not signed in" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("role, organization_slug, email, full_name")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile || !ALLOWED_ROLES.includes(String(profile.role))) {
      return json({ error: "Only admins and managers can manage e-mail settings." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "status");
    const orgSlug = (profile.organization_slug as string | null) ?? null;
    const settings = await loadEmailSettings(admin, orgSlug);

    if (action === "status") {
      const key = await checkResendKey();
      return json({ ok: true, key, settings, sender: senderString(settings) });
    }

    if (action === "test") {
      const to = String(body.to ?? profile.email ?? user.email ?? "").trim();
      if (!to) return json({ error: "No address to send the test to." }, 400);
      const result = await sendEmail({
        admin,
        organizationSlug: orgSlug,
        to: [to],
        subject: "Hotel Care — e-mail test",
        html: testHtml(orgSlug ?? "your property", senderString(settings)),
        kind: "transactional",
        settings: { ...settings, transactional_enabled: true }, // a test must work even while off
      });
      if (!result.ok) {
        return json({ error: result.error, keyProblem: result.keyProblem ?? false }, 502);
      }
      return json({ ok: true, id: result.id, from: result.from, to });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    console.error("email-config error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

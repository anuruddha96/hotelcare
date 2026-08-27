// Assistant side channel: saves a stopped reply, and receives problem reports
// from the copilot. The team's e-mail address is a server secret so it never
// reaches the browser bundle.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/emailSender.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

const SEVERITIES = ["low", "normal", "high", "urgent"];

async function handleIssueReport(service: any, userId: string, body: any) {
  const title = String(body?.title ?? "").trim().slice(0, 200);
  if (title.length < 3) return json({ error: "A short title is required" }, 400);
  const description = String(body?.description ?? "").slice(0, 4000);
  const aiSummary = body?.ai_summary ? String(body.ai_summary).slice(0, 4000) : null;
  const category = String(body?.category ?? "other").slice(0, 40);
  const severity = SEVERITIES.includes(body?.severity) ? body.severity : "normal";
  const threadId = typeof body?.thread_id === "string" ? body.thread_id : null;
  const context = body?.context && typeof body.context === "object" ? body.context : {};

  const { data: profile } = await service
    .from("profiles")
    .select("id,full_name,email,role,assigned_hotel,organization_slug")
    .eq("id", userId)
    .maybeSingle();

  const { data: report, error: insertError } = await service
    .from("assistant_issue_reports")
    .insert({
      user_id: userId,
      thread_id: threadId,
      organization_slug: profile?.organization_slug ?? null,
      hotel_id: profile?.assigned_hotel ?? null,
      role: profile?.role ?? null,
      title,
      description,
      ai_summary: aiSummary,
      category,
      severity,
      context,
      status: "open",
    })
    .select("id,created_at")
    .single();
  if (insertError) {
    console.error("issue report insert failed", insertError);
    return json({ error: "Could not save the report" }, 500);
  }

  const to = Deno.env.get("ASSISTANT_ISSUE_EMAIL");
  let emailed = false;
  if (to) {
    const rows: [string, string][] = [
      ["Reported by", `${profile?.full_name ?? "Unknown"} (${profile?.email ?? "no email"})`],
      ["Role", profile?.role ?? "unknown"],
      ["Property", profile?.assigned_hotel ?? "unassigned"],
      ["Organization", profile?.organization_slug ?? "unknown"],
      ["Severity", severity],
      ["Category", category],
      ["Page", String((context as any).route ?? "unknown")],
      ["Device", String((context as any).device ?? "unknown")],
    ];
    const html = `
      <h2>${escapeHtml(title)}</h2>
      <table cellpadding="4" style="font:14px/1.5 system-ui,sans-serif;border-collapse:collapse">
        ${rows.map(([k, v]) => `<tr><td><b>${escapeHtml(k)}</b></td><td>${escapeHtml(v)}</td></tr>`).join("")}
      </table>
      <h3>What happened</h3>
      <p style="font:14px/1.6 system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(description || "—")}</p>
      ${aiSummary ? `<h3>Assistant summary</h3><p style="font:14px/1.6 system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(aiSummary)}</p>` : ""}
      <p style="font:12px system-ui,sans-serif;color:#667">Report ${report.id} · ${report.created_at}</p>`;
    const result = await sendEmail({
      admin: service,
      organizationSlug: profile?.organization_slug ?? null,
      to: [to],
      subject: `[Hotel Care] ${String(severity).toUpperCase()} — ${title}`.slice(0, 120),
      html,
    });
    emailed = Boolean(result.ok);
    if (!result.ok) console.error("issue report email failed", result.error);
    if (emailed) {
      await service
        .from("assistant_issue_reports")
        .update({ emailed_at: new Date().toISOString() })
        .eq("id", report.id);
    }
  }

  return json({ ok: true, id: report.id, emailed });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Server configuration is incomplete" }, 500);

  const body = await req.json().catch(() => null);
  const kind = typeof body?.type === "string" ? body.type : "stopped_message";
  const threadId = typeof body?.thread_id === "string" ? body.thread_id : "";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (kind === "stopped_message" && (!threadId || !content || content.length > 100_000)) {
    return json({ error: "Invalid stopped message" }, 400);
  }


  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await authClient.auth.getUser(authHeader.slice(7));
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

  const { data: thread, error: threadError } = await service
    .from("assistant_threads")
    .select("id")
    .eq("id", threadId)
    .eq("user_id", userData.user.id)
    .single();
  if (threadError || !thread) return json({ error: "Conversation not found" }, 404);

  const { error: insertError } = await service.from("assistant_messages").insert({
    thread_id: threadId,
    user_id: userData.user.id,
    role: "assistant",
    content,
    refused: false,
  });
  if (insertError) return json({ error: `Could not save stopped message: ${insertError.message}` }, 500);

  const { error: updateError } = await service
    .from("assistant_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId)
    .eq("user_id", userData.user.id);
  if (updateError) return json({ error: `Could not update conversation: ${updateError.message}` }, 500);

  return json({ saved: true });
});
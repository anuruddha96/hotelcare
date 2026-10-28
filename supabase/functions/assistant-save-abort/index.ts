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
  const category = ["wrong_data", "assistant", "bug", "access", "idea", "other"].includes(body?.category)
    ? body.category : "other";
  const severity = SEVERITIES.includes(body?.severity) ? body.severity : "normal";
  const context = body?.context && typeof body.context === "object" && !Array.isArray(body.context)
    ? body.context : {};
  const diagnostics = body?.diagnostics && typeof body.diagnostics === "object" && !Array.isArray(body.diagnostics)
    ? body.diagnostics : {};
  const scalar = (value: unknown, max = 300) =>
    String(value ?? "").replace(/Bearer\s+[\w.-]+/gi, "Bearer [redacted]").slice(0, max);

  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id,full_name,email,role,assigned_hotel,organization_slug")
    .eq("id", userId).is("deleted_at", null).maybeSingle();
  if (profileError || !profile) return json({ error: "Active staff profile required" }, 403);

  // Never attach an issue to another employee's conversation.
  const requestedThread = typeof body?.thread_id === "string" && /^[\da-f-]{36}$/i.test(body.thread_id)
    ? body.thread_id : null;
  let threadId: string | null = null;
  if (requestedThread) {
    const { data: ownedThread } = await service.from("assistant_threads")
      .select("id").eq("id", requestedThread).eq("user_id", userId).maybeSingle();
    if (ownedThread) threadId = requestedThread;
  }

  // Map to the EXISTING production assistant_issue_reports schema.
  const { data: report, error: insertError } = await service.from("assistant_issue_reports").insert({
    user_id: userId,
    thread_id: threadId,
    organization_slug: profile.organization_slug ?? null,
    hotel_id: scalar(context.hotel_id || profile.assigned_hotel, 100) || null,
    title,
    user_description: description,
    ai_summary: aiSummary,
    category,
    severity,
    current_route: scalar(context.route, 500) || null,
    module: scalar(context.module, 80) || null,
    tab: scalar(context.tab, 120) || null,
    entity_type: scalar(context.entity_type, 100) || null,
    entity_id: scalar(context.entity_id, 200) || null,
    device: scalar(context.device, 250) || null,
    app_language: scalar(context.language, 20) || null,
    status: "open",
  }).select("id,created_at").single();
  if (insertError || !report) {
    console.error("assistant issue report database insert failed", insertError);
    return json({ error: "The report could not be saved. Please retry." }, 500);
  }

  const { data: adminProfiles, error: adminError } = await service.from("profiles")
    .select("email").eq("organization_slug", profile.organization_slug ?? "")
    .eq("role", "admin").is("deleted_at", null).limit(100);
  if (adminError) console.error("assistant issue admin lookup failed", adminError.message);
  const recipients = [...new Set([
    "anuruddha.dharmasena@gmail.com",
    ...(adminProfiles ?? []).map((admin: any) => String(admin.email ?? "").trim()),
  ].filter(Boolean))];

  const rows: [string, string][] = [
    ["Report reference", scalar(report.id)],
    ["Reported (UTC)", scalar(report.created_at)],
    ["Reported by", scalar(profile.full_name, 200)],
    ["Reporter email", scalar(profile.email, 200)],
    ["User ID", userId],
    ["Role", scalar(profile.role)],
    ["Hotel", scalar(context.hotel_id || profile.assigned_hotel)],
    ["Organization", scalar(profile.organization_slug)],
    ["Priority", severity],
    ["Category", category],
    ["Page", scalar(context.route, 500)],
    ["Module / tab", scalar(context.module) + " / " + scalar(context.tab)],
    ["Entity", scalar(context.entity_type) + " / " + scalar(context.entity_id)],
    ["Conversation ID", threadId ?? "None"],
    ["Device", scalar(context.device)],
    ["Browser", scalar(diagnostics.user_agent, 400)],
    ["Client timestamp", scalar(diagnostics.client_time)],
    ["Technical error", scalar(diagnostics.error, 700) || "Not provided"],
  ];
  const html = "<h2>HotelCare problem report: " + escapeHtml(title) + "</h2>" +
    "<table cellpadding=\"5\" style=\"font:14px/1.5 system-ui,sans-serif;border-collapse:collapse\">" +
    rows.map(([key, value]) => "<tr><td><b>" + escapeHtml(key) + "</b></td><td>" +
      escapeHtml(value || "—") + "</td></tr>").join("") + "</table>" +
    "<h3>What happened / request</h3><p style=\"white-space:pre-wrap\">" +
    escapeHtml(description || "—") + "</p>" +
    (aiSummary ? "<h3>Assistant summary</h3><p style=\"white-space:pre-wrap\">" +
      escapeHtml(aiSummary) + "</p>" : "");

  try {
    const sent = await sendEmail({
      admin: service,
      organizationSlug: profile.organization_slug ?? null,
      to: recipients,
      subject: ("[HotelCare] " + severity.toUpperCase() + " · " + title).slice(0, 120),
      html,
      text: rows.map(([key, value]) => key + ": " + value).join("\n") +
        "\n\nWhat happened:\n" + description,
    });
    if (!sent.ok) {
      console.error("assistant issue email delivery failed", {
        report_id: report.id, error: sent.error, recipient_count: recipients.length,
      });
    }
    return json({ ok: true, id: report.id, emailed: sent.ok === true });
  } catch (error) {
    console.error("assistant issue email transport exception", { report_id: report.id, error });
    return json({ ok: true, id: report.id, emailed: false });
  }
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

  if (kind === "issue_report") return await handleIssueReport(service, userData.user.id, body);

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
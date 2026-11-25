// Assistant side channel: saves a stopped reply, and receives problem reports
// from the copilot. The team's e-mail address is a server secret so it never
// reaches the browser bundle.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/emailSender.ts";
import { OWNER_EMAIL, SUPPORT_EMAIL } from "../_shared/assistantGovernance.ts";
import { generateLowCostText } from "../_shared/lowCostAi.ts";
import {
  fallbackTitle, formatAuditTrail, formatTranscript, formatUsageErrors, parseSummary, redact, SUMMARY_INSTRUCTIONS,
  type AuditRow, type TranscriptRow, type UsageErrorRow,
} from "../_shared/miraIssueReport.ts";

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

/**
 * The conversation and technical trail of a reported Mira chat. Everything is
 * read with the service role, but only for the reporter's own conversation.
 */
async function buildReportEvidence(service: any, userId: string, threadId: string | null, organizationSlug: string | null) {
  const since = new Date(Date.now() - 3 * 3_600_000).toISOString();
  const auditColumns = "created_at,question,model,scopes_used,refused,input_tokens,output_tokens,duration_ms,workflow";
  const [messages, audit, usageErrors] = await Promise.all([
    threadId
      ? service.from("assistant_messages").select("role,content,created_at,refused,model")
        .eq("thread_id", threadId).eq("user_id", userId).order("created_at", { ascending: false }).limit(16)
      : Promise.resolve({ data: [] }),
    threadId
      ? service.from("assistant_audit_log").select(auditColumns)
        .eq("thread_id", threadId).eq("user_id", userId).order("created_at", { ascending: false }).limit(10)
      : service.from("assistant_audit_log").select(auditColumns)
        .eq("user_id", userId).gte("created_at", since).order("created_at", { ascending: false }).limit(10),
    service.from("ai_usage_log").select("created_at,function_name,model,error")
      .eq("ok", false).eq("organization_slug", organizationSlug ?? "").gte("created_at", since)
      .order("created_at", { ascending: false }).limit(10),
  ]);
  const transcript = ((messages?.data ?? []) as TranscriptRow[]).reverse();
  const trail = ((audit?.data ?? []) as AuditRow[]).reverse();
  const errors = (usageErrors?.data ?? []) as UsageErrorRow[];
  return { transcript, trail, errors };
}

/** A short summary for the HotelCare team, written by a model from the evidence only. */
async function summarize(
  evidence: { transcript: TranscriptRow[]; trail: AuditRow[]; errors: UsageErrorRow[] },
  note: string, clientError: string,
): Promise<{ summary: string | null; title: string | null }> {
  if (!evidence.transcript.length && !note && !clientError) return { summary: null, title: null };
  const prompt = [
    `Person's note: ${redact(note, 1500) || "(none)"}`,
    `Error shown in the app: ${redact(clientError, 500) || "(none)"}`,
    "Transcript (oldest first):",
    formatTranscript(evidence.transcript, 900) || "(no conversation)",
    "Technical log:",
    formatAuditTrail(evidence.trail) || "(none)",
    formatUsageErrors(evidence.errors) || "",
  ].join("\n").slice(0, 24_000);
  try {
    // Staff and guest operations data: stays with the paid provider.
    const result = await generateLowCostText({
      prompt, instructions: SUMMARY_INSTRUCTIONS, sensitive: true, task: "internal",
      fallbackModel: "gpt-4.1-mini", maxOutputTokens: 450, validate: (text) => text.trim().length > 40,
    });
    return parseSummary(result.text);
  } catch (error) {
    console.error("issue report summary unavailable", error instanceof Error ? error.message : error);
    return { summary: null, title: null };
  }
}

async function handleIssueReport(service: any, userId: string, body: any) {
  const requestedTitle = String(body?.title ?? "").trim().slice(0, 200);
  const description = String(body?.description ?? "").slice(0, 4000);
  const hasThread = typeof body?.thread_id === "string" && body.thread_id.length > 0;
  // With a conversation attached, Mira writes the title and summary itself.
  if (requestedTitle.length < 3 && !hasThread && description.trim().length < 3) {
    return json({ error: "Tell us briefly what went wrong" }, 400);
  }
  let aiSummary = body?.ai_summary ? String(body.ai_summary).slice(0, 4000) : null;
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

  const evidence = await buildReportEvidence(service, userId, threadId, profile.organization_slug ?? null);
  const clientError = scalar(diagnostics.error, 700);
  let generatedTitle: string | null = null;
  if (!aiSummary && body?.auto_summary !== false) {
    const generated = await summarize(evidence, description, clientError);
    aiSummary = generated.summary;
    generatedTitle = generated.title;
  }
  const title = requestedTitle.length >= 3
    ? requestedTitle
    : (generatedTitle ?? fallbackTitle(evidence.transcript, description)).slice(0, 200);
  const reportedMessageId = typeof body?.message_id === "string" ? body.message_id.slice(0, 80) : null;
  const diagnosticsRecord = {
    client_error: clientError || null,
    user_agent: scalar(diagnostics.user_agent, 400) || null,
    client_time: scalar(diagnostics.client_time) || null,
    reported_message_id: reportedMessageId,
    turns: evidence.trail.map((row) => ({
      at: row.created_at, model: row.model, tools: row.scopes_used, refused: row.refused,
      tokens: (Number(row.input_tokens) || 0) + (Number(row.output_tokens) || 0), ms: row.duration_ms, workflow: row.workflow,
    })),
    service_errors: evidence.errors.map((row) => ({
      at: row.created_at, fn: row.function_name, model: row.model, error: redact(row.error, 300),
    })),
  };

  // Map to the EXISTING production assistant_issue_reports schema
  // (diagnostics arrives with the Mira v2 migration; tolerated until then).
  const reportRow = {
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
  };
  let { data: report, error: insertError } = await service.from("assistant_issue_reports")
    .insert({ ...reportRow, diagnostics: diagnosticsRecord }).select("id,created_at").single();
  if (insertError && /diagnostics|column|schema cache/i.test(String(insertError.message ?? ""))) {
    ({ data: report, error: insertError } = await service.from("assistant_issue_reports")
      .insert(reportRow).select("id,created_at").single());
  }
  if (insertError || !report) {
    console.error("assistant issue report database insert failed", insertError);
    return json({ error: "The report could not be saved. Please retry." }, 500);
  }

  const { data: adminProfiles, error: adminError } = await service.from("profiles")
    .select("email").eq("organization_slug", profile.organization_slug ?? "")
    .eq("role", "admin").is("deleted_at", null).limit(100);
  if (adminError) console.error("assistant issue admin lookup failed", adminError.message);
  // The HotelCare team inbox first; the owner and the organization's admins too.
  const recipients = [...new Set([
    SUPPORT_EMAIL,
    OWNER_EMAIL,
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
    ["Technical error", clientError || "Not provided"],
    ["Reported answer", reportedMessageId ?? "Whole conversation"],
  ];
  const transcriptText = formatTranscript(evidence.transcript) || "No conversation attached.";
  const trailText = [formatAuditTrail(evidence.trail), formatUsageErrors(evidence.errors)].filter(Boolean).join("\n") ||
    "No technical events recorded.";
  const pre = "white-space:pre-wrap;font:12px/1.45 ui-monospace,monospace;background:#f6f7f9;padding:10px;border-radius:6px";
  const html = "<h2>HotelCare problem report: " + escapeHtml(title) + "</h2>" +
    (aiSummary ? "<h3>Summary by Mira</h3><p style=\"white-space:pre-wrap\">" + escapeHtml(aiSummary) + "</p>" : "") +
    "<h3>What the person wrote</h3><p style=\"white-space:pre-wrap\">" + escapeHtml(description || "—") + "</p>" +
    "<table cellpadding=\"5\" style=\"font:14px/1.5 system-ui,sans-serif;border-collapse:collapse\">" +
    rows.map(([key, value]) => "<tr><td><b>" + escapeHtml(key) + "</b></td><td>" +
      escapeHtml(value || "—") + "</td></tr>").join("") + "</table>" +
    "<h3>Conversation (latest 16 messages)</h3><pre style=\"" + pre + "\">" + escapeHtml(transcriptText) + "</pre>" +
    "<h3>Technical log</h3><pre style=\"" + pre + "\">" + escapeHtml(trailText) + "</pre>";

  try {
    const sent = await sendEmail({
      admin: service,
      organizationSlug: profile.organization_slug ?? null,
      to: recipients,
      subject: ("[HotelCare] " + severity.toUpperCase() + " · " + title).slice(0, 120),
      html,
      text: (aiSummary ? "Summary by Mira:\n" + aiSummary + "\n\n" : "") +
        "What the person wrote:\n" + (description || "—") + "\n\n" +
        rows.map(([key, value]) => key + ": " + value).join("\n") +
        "\n\nConversation:\n" + transcriptText + "\n\nTechnical log:\n" + trailText,
    });
    if (!sent.ok) {
      console.error("assistant issue email delivery failed", {
        report_id: report.id, error: sent.error, recipient_count: recipients.length,
      });
    }
    return json({ ok: true, id: report.id, emailed: sent.ok === true, title, summary: aiSummary });
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
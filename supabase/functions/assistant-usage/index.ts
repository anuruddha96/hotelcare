// Mira usage endpoint.
//   status        signed-in person: their plan and how much they used (composer)
//   daily_report  cron (x-worker-secret): yesterday's usage per person, e-mailed
//                 to the owner and each organization's administrators
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ACCESS_ROLE_LABEL, effectiveAccessRole } from "../_shared/accessPolicy.ts";
import { assistantUsageStatus, OWNER_EMAIL } from "../_shared/assistantGovernance.ts";
import { addDays, budapestDate, budapestMidnightUtc } from "../_shared/miraDates.ts";
import { miraUsagePolicyFor } from "../_shared/miraUsagePolicy.ts";
import { aggregateUsage, reportEmail, type PersonRow } from "../_shared/miraUsageReport.ts";
import { sendEmail } from "../_shared/emailSender.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function db(): any {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

const TIER_LABEL: Record<string, string> = { leadership: "Unlimited", standard: "Standard", none: "No Mira" };

async function status(req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);
  const service = db();
  const { data: auth, error } = await service.auth.getUser(authHeader.slice(7));
  if (error || !auth.user) return json({ error: "Invalid session" }, 401);
  const [{ data: profile }, { data: unlimited }] = await Promise.all([
    service.from("profiles").select("*").eq("id", auth.user.id).is("deleted_at", null).maybeSingle(),
    service.from("assistant_unlimited_users").select("enabled").eq("user_id", auth.user.id).maybeSingle(),
  ]);
  if (!profile) return json({ error: "Profile not found" }, 403);
  const policy = miraUsagePolicyFor(profile, { unlimitedOverride: unlimited?.enabled === true });
  const quota = await assistantUsageStatus(service, auth.user.id, policy);
  const month = budapestDate().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  return json({
    ...quota,
    plan: TIER_LABEL[policy.tier],
    resets_on: m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`,
  });
}

async function dailyReport(req: Request): Promise<Response> {
  const service = db();
  const provided = req.headers.get("x-worker-secret") || "";
  const { data: secret, error: secretError } = await service.rpc("mira_usage_worker_secret");
  if (secretError || typeof secret !== "string" || secret.length < 32 || !provided || !timingSafeEqual(provided, secret)) {
    return json({ error: "FORBIDDEN" }, 403);
  }
  // "Yesterday" in Budapest, unless a day is given (re-sending a report).
  const body = await req.json().catch(() => ({}));
  const day = typeof body?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : addDays(budapestDate(), -1);
  const window = {
    dayStart: budapestMidnightUtc(day).toISOString(),
    dayEnd: budapestMidnightUtc(addDays(day, 1)).toISOString(),
    weekStart: budapestMidnightUtc(addDays(day, -6)).toISOString(),
    monthStart: budapestMidnightUtc(`${day.slice(0, 7)}-01`).toISOString(),
  };
  const from = window.weekStart < window.monthStart ? window.weekStart : window.monthStart;

  const [usage, refusals, alerts] = await Promise.all([
    service.from("assistant_monthly_message_usage").select("user_id,organization_slug,created_at,estimated_cost_usd")
      .gte("created_at", from).lt("created_at", window.dayEnd).limit(50_000),
    service.from("assistant_audit_log").select("user_id,organization_slug,created_at")
      .eq("refused", true).gte("created_at", window.weekStart).lt("created_at", window.dayEnd).limit(20_000),
    service.from("assistant_usage_alert_events").select("user_id,organization_slug,alert_type,created_at,message")
      .gte("created_at", window.dayStart).lt("created_at", window.dayEnd).limit(5_000),
  ]);
  if (usage.error) return json({ error: `usage read failed: ${usage.error.message}` }, 500);

  const usageRows = usage.data ?? [];
  const organizations = [...new Set([
    ...usageRows.filter((r: any) => r.created_at >= window.weekStart).map((r: any) => r.organization_slug),
    ...(alerts.data ?? []).map((r: any) => r.organization_slug),
  ].filter(Boolean))] as string[];

  const userIds = [...new Set([
    ...usageRows.map((r: any) => r.user_id),
    ...(refusals.data ?? []).map((r: any) => r.user_id),
    ...(alerts.data ?? []).map((r: any) => r.user_id),
  ])];
  const { data: profiles } = userIds.length
    ? await service.from("profiles").select("id,full_name,nickname,role,access_role,is_super_admin,organization_slug").in("id", userIds)
    : { data: [] };
  const { data: unlimitedRows } = userIds.length
    ? await service.from("assistant_unlimited_users").select("user_id,enabled").in("user_id", userIds)
    : { data: [] };
  const unlimited = new Set((unlimitedRows ?? []).filter((r: any) => r.enabled).map((r: any) => r.user_id));
  const people = new Map<string, PersonRow>((profiles ?? []).map((p: any) => [p.id, p]));
  const describe = (person: PersonRow | undefined) => {
    if (!person) return { role: "Removed user", tier: "—" };
    const policy = miraUsagePolicyFor(person as any, { unlimitedOverride: unlimited.has(person.id) });
    return { role: ACCESS_ROLE_LABEL[effectiveAccessRole(person as any)], tier: TIER_LABEL[policy.tier] };
  };

  const results: Record<string, unknown>[] = [];
  for (const organization of organizations) {
    const inOrg = (r: any) => r.organization_slug === organization;
    const rows = aggregateUsage({
      usage: usageRows.filter(inOrg),
      refusals: (refusals.data ?? []).filter(inOrg),
      alerts: (alerts.data ?? []).filter(inOrg),
      people, window, describe,
    });
    if (!rows.length) continue;
    const mail = reportEmail({ organization, day, rows });
    const { data: admins } = await service.from("profiles").select("email")
      .eq("organization_slug", organization).eq("role", "admin").is("deleted_at", null).limit(50);
    const to = [...new Set([OWNER_EMAIL, ...(admins ?? []).map((a: any) => String(a.email ?? "").trim())].filter(Boolean))];
    const sent = await sendEmail({ admin: service, organizationSlug: organization, to, subject: mail.subject, html: mail.html, text: mail.text, kind: "digest" });
    results.push({ organization, people: rows.length, messages: mail.totals.yesterday, flagged: mail.flagged, emailed: sent.ok === true });
    if (!sent.ok) console.error("Mira daily usage report not delivered", organization, sent.error);
  }
  return json({ day, reports: results });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const action = new URL(req.url).searchParams.get("action") ??
      (req.headers.get("x-worker-secret") ? "daily_report" : "status");
    if (action === "daily_report") return await dailyReport(req);
    return await status(req);
  } catch (error) {
    console.error("assistant-usage failed", error);
    return json({ error: error instanceof Error ? error.message : "Usage request failed" }, 500);
  }
});

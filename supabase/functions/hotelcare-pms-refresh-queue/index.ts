// Durable, server-only PMS queue controller. Dark until the explicit queue cutover.
// Internal tick uses the existing Vault-backed housekeeping worker secret.
// Manual callers must provide a verified user JWT; never accept a client-supplied
// organization slug or account ID as authorization.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const ROLES = new Set([
  "admin", "top_management", "top_management_manager", "manager",
  "housekeeping_manager", "reception_manager", "front_office",
]);
const PORTFOLIO_ROLES = new Set(["admin", "top_management", "top_management_manager"]);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const errorText = (v: unknown) => v instanceof Error ? v.message : String(v);
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function budapest() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (k: string) => parts.find(p => p.type === k)?.value || "";
  return { date: [part("year"), part("month"), part("day")].join("-"), hour: Number(part("hour")) };
}
async function enabled(): Promise<boolean> {
  const { data, error } = await admin.from("pms_refresh_queue_settings")
    .select("enabled").eq("id", true).maybeSingle();
  if (error) throw new Error("Unable to read PMS queue configuration");
  return data?.enabled === true;
}
async function getProfile(req: Request): Promise<{ id: string; role: string; organization_slug: string; assigned_hotel: string | null; hotel_id: string | null }> {
  const auth = req.headers.get("Authorization") || "";
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  if (!token || token === SERVICE) throw new Error("Sign in to request a PMS refresh");
  const { data: user, error: userError } = await admin.auth.getUser(token);
  if (userError || !user.user?.id) throw new Error("Invalid user session");
  const { data: profile, error } = await admin.from("profiles")
    .select("id,role,organization_slug,assigned_hotel,hotel_id")
    .eq("id", user.user.id).maybeSingle();
  if (error || !profile || !ROLES.has(String(profile.role))) {
    throw new Error("This account cannot request PMS refreshes");
  }
  if (!profile.organization_slug) throw new Error("Your organization could not be verified");
  return {
    id: String(profile.id), role: String(profile.role),
    organization_slug: String(profile.organization_slug),
    assigned_hotel: profile.assigned_hotel, hotel_id: profile.hotel_id,
  };
}
type JobTarget = { hotel_id: string; organization_slug: string; target_key: string; account_id: string | null };
async function authorizedTargets(
  profile: Awaited<ReturnType<typeof getProfile>>, hotelId: string,
): Promise<JobTarget[]> {
  if (!/^[a-zA-Z0-9_-]{2,90}$/.test(hotelId)) throw new Error("Invalid hotel");
  const { data: accounts, error: accountError } = await admin.from("pms_accounts")
    .select("id,hotel_id,organization_slug,label")
    .eq("hotel_id", hotelId).eq("pms_type", "previo")
    .eq("is_active", true).eq("sync_paused", false).order("label");
  if (accountError) throw new Error("Unable to verify PMS accounts");
  let org: string | null = null;
  let displayName: string | null = null;
  const targets: JobTarget[] = [];
  if (accounts?.length) {
    if (hotelId !== "slnt-group" || accounts.some(a => a.organization_slug !== "slnt")) {
      throw new Error("This multi-account PMS is not supported by the current server reconciler");
    }
    const orgs = [...new Set(accounts.map(a => String(a.organization_slug)))];
    if (orgs.length !== 1) throw new Error("PMS account organizations are ambiguous");
    org = orgs[0];
    for (const a of accounts) targets.push({
      hotel_id: hotelId, organization_slug: org, target_key: "account:" + a.id,
      account_id: a.id,
    });
  } else {
    const { data: configs, error: configError } = await admin.from("pms_configurations")
      .select("hotel_id").eq("hotel_id", hotelId).eq("pms_type", "previo")
      .eq("is_active", true).eq("sync_enabled", true);
    if (configError || configs?.length !== 1) throw new Error("Hotel PMS configuration is unavailable");
    const { data: hotelCfg, error: cfgError } = await admin.from("hotel_configurations")
      .select("hotel_name,organization_id,is_active").eq("hotel_id",hotelId).maybeSingle();
    if (cfgError || !hotelCfg?.is_active || !hotelCfg.organization_id) {
      throw new Error("Hotel organization configuration is unavailable");
    }
    displayName = hotelCfg.hotel_name;
    const { data: organization, error: orgError } = await admin.from("organizations")
      .select("slug,is_active").eq("id",hotelCfg.organization_id).maybeSingle();
    if (orgError || !organization?.is_active) throw new Error("Hotel organization is unavailable");
    org = organization.slug;
    targets.push({ hotel_id: hotelId, organization_slug: String(org),
      target_key: "hotel:" + hotelId, account_id: null });
  }
  if (org !== profile.organization_slug) throw new Error("You cannot refresh another organization");
  if (!PORTFOLIO_ROLES.has(profile.role)) {
    const access = [profile.hotel_id, profile.assigned_hotel]
      .some(v => !!v && (v === hotelId || v === displayName));
    if (!access) throw new Error("You cannot refresh a hotel outside your assigned property");
  }
  return targets;
}
async function handleUser(req: Request, body: Record<string, unknown>) {
  const profile = await getProfile(req);
  const isOn = await enabled();
  if (body.mode === "state") return respond({ ok: true, enabled: isOn });
  if (!isOn) return respond({ ok: true, enabled: false, reason: "queue_not_activated" });
  if (body.mode === "status") {
    const { data, error } = await admin.from("pms_refresh_jobs")
      .select("id,hotel_id,target_key,source,status,requested_at,started_at,finished_at,attempts,error_message")
      .eq("requested_by",profile.id).order("requested_at",{ascending:false}).limit(20);
    if (error) throw new Error("Cannot load your PMS refresh status");
    return respond({ ok: true, enabled: true, jobs: data || [] });
  }
  if (body.mode !== "enqueue") return respond({ error: "Unknown action" }, 400);
  const hotelId = typeof body.hotel_id === "string" ? body.hotel_id.trim() : "";
  const targets = await authorizedTargets(profile,hotelId);
  const { data: outstanding, error: pendingError } = await admin.from("pms_refresh_jobs")
    .select("id,hotel_id,target_key,status,requested_at")
    .eq("requested_by",profile.id).eq("hotel_id",hotelId)
    .eq("source","manual").in("status",["pending","running"]);
  if (pendingError) throw new Error("Unable to check existing PMS refresh requests");
  if (outstanding?.length) return respond({
    ok: true, enabled: true, queued: true, already_requested: true, jobs: outstanding,
  });
  const { data, error } = await admin.from("pms_refresh_jobs").insert(targets.map(t => ({
    ...t, business_date: budapest().date, source: "manual", priority: 100,
    requested_by: profile.id, status: "pending",
  }))).select("id,hotel_id,target_key,status,requested_at");
  if (error || !data?.length) throw new Error("Could not enqueue the PMS refresh");
  return respond({ ok:true, enabled:true, queued:true, jobs:data });
}
async function tick() {
  const isOn = await enabled();
  if (!isOn) return respond({ ok: true, enabled: false, skipped: true, reason: "queue_not_activated" });
  const clock = budapest();
  let scheduled = 0;
  if (clock.hour >= 6) {
    const { data, error } = await admin.rpc("hc_schedule_pms_refresh_day", { p_business_date: clock.date });
    if (error) throw new Error("PMS schedule creation failed: " + error.message);
    scheduled = Number(data || 0);
  }
  const { data: claimed, error: claimError } = await admin.rpc("hc_claim_next_pms_refresh_job");
  if (claimError) throw new Error("Atomic PMS job claim failed: " + claimError.message);
  const job = Array.isArray(claimed) ? claimed[0] : null;
  if (!job) return respond({ ok:true, enabled:true, scheduled, idle:true });
  const expected = await admin.rpc("get_housekeeping_release_worker_secret");
  if (expected.error || !expected.data) throw new Error("PMS worker credential unavailable");
  let outcome: "success" | "partial" | "failed" = "failed";
  let result: Record<string, unknown> | null = null;
  let failure: string | null = null;
  try {
    const response = await fetch(URL + "/functions/v1/hotelcare-pms-morning-sequence", {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "apikey": SERVICE,
        "Authorization": "Bearer " + SERVICE,
        "x-worker-secret": String(expected.data),
      },
      body: JSON.stringify({
        mode: "queue_execute", job_id: job.id, attempt: job.attempts,
        target_key: job.target_key, business_date: job.business_date,
      }),
      signal: AbortSignal.timeout(120000),
    });
    result = await response.json().catch(() => ({ error: "Invalid PMS executor response" }));
    if (!response.ok || result?.ok !== true) {
      throw new Error(String(result?.error || "Executor HTTP " + response.status));
    }
    outcome = result.status === "partial" ? "partial" : "success";
  } catch (error) {
    failure = errorText(error).slice(0,2000);
    console.error("[PMS queue] job failed", job.id, failure);
  }
  const { data: finished, error: finishError } = await admin.rpc("hc_finish_pms_refresh_job",{
    p_job_id:job.id, p_attempt:job.attempts,p_outcome:outcome,
    p_result:result,p_error:failure,
  });
  if (finishError || finished !== true) {
    return respond({ ok:false, error:"Could not safely finalize PMS job; lease may have expired",
      job_id:job.id },503);
  }
  return respond({ ok:outcome!=="failed", job_id:job.id, target_key:job.target_key,
    status:outcome, scheduled, error:failure },outcome==="failed"?503:200);
}
Deno.serve(async req => {
  if (req.method==="OPTIONS") return new Response(null,{headers:cors});
  if (req.method!=="POST") return respond({error:"POST required"},405);
  try {
    const body = await req.json().catch(() => ({})) as Record<string,unknown>;
    if (body.mode==="tick") {
      const secret = await admin.rpc("get_housekeeping_release_worker_secret");
      if (secret.error || !safeEqual(req.headers.get("x-worker-secret") || "",
        String(secret.data || ""))) return respond({ error:"Unauthorized" },401);
      return await tick();
    }
    return await handleUser(req,body);
  } catch(error) {
    const m = errorText(error);
    const authFailure = /cannot refresh|session|signed|organization|account cannot|assigned property|outside/.test(m.toLowerCase());
    console.error("[PMS queue] rejected request", m);
    return respond({ ok:false,error:m },authFailure?403:500);
  }
});

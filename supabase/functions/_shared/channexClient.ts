// Server-side Channex client + shared guards for the channex-* edge functions.
// The API key lives only in Supabase secrets. Staging only in this phase.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";

export const CHANNEX_BASE = (Deno.env.get("CHANNEX_BASE_URL") || "https://staging.channex.io").replace(/\/$/, "");
if (!/^https:\/\/staging\.channex\.io$/.test(CHANNEX_BASE)) {
  // Production is deliberately blocked until certification is passed and the owner approves.
  throw new Error("Channex production endpoint is not allowed in this phase");
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const serviceClient = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

export function channexApiKey(): string {
  return (Deno.env.get("HOTELCARE_CHANNEX_API") || Deno.env.get("CHANNEX_STAGING_API_KEY") || Deno.env.get("CHANNEX_API_KEY") || "").trim();
}

export type ChannexResponse = { status: number | null; body: any; retryAfter: string | null; durationMs: number; error?: string };

export async function channexRequest(method: string, path: string, body?: unknown): Promise<ChannexResponse> {
  const key = channexApiKey();
  if (!key) return { status: null, body: null, retryAfter: null, durationMs: 0, error: "Channex API key secret is not configured" };
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(CHANNEX_BASE + "/api/v1" + path, {
      method,
      headers: { "user-api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 2000) }; }
    return { status: res.status, body: parsed, retryAfter: res.headers.get("retry-after"), durationMs: Date.now() - started };
  } catch (e) {
    return { status: null, body: null, retryAfter: null, durationMs: Date.now() - started, error: String((e as Error)?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

export function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let n = 0;
  for (let i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return n === 0;
}

export async function integrationSecrets(db: SupabaseClient): Promise<{ worker: string; webhook: string }> {
  const { data, error } = await db.rpc("get_channex_integration_secrets");
  if (error || !data) throw new Error("Channex integration secrets unavailable");
  return { worker: String(data.worker || ""), webhook: String(data.webhook || "") };
}

export async function isWorkerCall(req: Request, db: SupabaseClient): Promise<boolean> {
  const header = req.headers.get("x-worker-secret") || "";
  if (!header) return false;
  const { worker } = await integrationSecrets(db);
  return safeEqual(header, worker);
}

export type Caller = { userId: string; role: string; isSuperAdmin: boolean };

/** Validates the user JWT and that the user may operate this hotel. Native hotels only. */
export async function authoriseUser(req: Request, db: SupabaseClient, hotelId: string, needManager = false): Promise<Caller> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const { data: u, error } = await db.auth.getUser(auth.slice(7));
  if (error || !u?.user) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const { data: allowed } = await db.rpc("can_access_pms_hotel", { _uid: u.user.id, _hotel_id: hotelId, _org_slug: null });
  if (!allowed) throw Object.assign(new Error("Forbidden for this hotel"), { status: 403 });
  const { data: native } = await db.rpc("pms_ari_native_hotel", { _hotel_id: hotelId });
  if (!native) throw Object.assign(new Error("Channex is only enabled for the Channex sandbox hotel in this phase"), { status: 403 });
  const { data: profile } = await db.from("profiles").select("role, is_super_admin").eq("id", u.user.id).maybeSingle();
  const role = String(profile?.role || "");
  const isSuperAdmin = Boolean(profile?.is_super_admin);
  if (needManager && !isSuperAdmin && !["admin", "top_management", "top_management_manager", "manager", "reception_manager"].includes(role)) {
    throw Object.assign(new Error("Manager role required"), { status: 403 });
  }
  return { userId: u.user.id, role, isSuperAdmin };
}

/** Today's date in the property's time zone (Channex dates are property-local). */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function logSync(db: SupabaseClient, row: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await db.from("channex_sync_log").insert(row).select("id").single();
  if (error) console.error("channex_sync_log insert failed", error.message);
  return data?.id ?? null;
}

/** Remove card/guarantee data before anything is stored or logged. */
export function stripCardData(rev: any): any {
  if (!rev || typeof rev !== "object") return rev;
  const copy = structuredClone(rev);
  if (copy.attributes) delete copy.attributes.guarantee;
  delete copy.guarantee;
  return copy;
}

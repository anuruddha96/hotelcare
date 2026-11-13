import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function serviceDb() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server configuration unavailable");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Cron/worker calls carry the Vault secret in x-worker-secret. */
// deno-lint-ignore no-explicit-any
export async function workerAuthorized(req: Request, db: any): Promise<boolean> {
  const provided = req.headers.get("x-worker-secret") || "";
  const { data, error } = await db.rpc("get_channex_worker_secret");
  return !error && safeEqual(provided, String(data || ""));
}

export type Caller = {
  userId: string;
  role: string;
  isSuperAdmin: boolean;
  organizationSlug: string | null;
};

export const VIEW_ROLES = ["admin", "top_management", "top_management_manager", "manager", "reception_manager", "reception", "front_office"];
export const MANAGE_ROLES = ["admin", "top_management", "top_management_manager", "manager"];
export const OWNER_ROLES = ["admin", "top_management", "top_management_manager"];

/** Validates the JWT and that the caller may access this exact hotel. Never trusts client-sent roles. */
// deno-lint-ignore no-explicit-any
export async function authorizeHotelCaller(req: Request, db: any, hotelId: string): Promise<Caller | Response> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: userData, error } = await userClient.auth.getUser();
  if (error || !userData?.user) return json({ ok: false, error: "Unauthorized" }, 401);

  const { data: profile } = await db.from("profiles")
    .select("role, organization_slug, is_super_admin").eq("id", userData.user.id).maybeSingle();
  if (!profile) return json({ ok: false, error: "Forbidden" }, 403);

  const { data: canAccess } = await db.rpc("user_can_access_hotel", { _uid: userData.user.id, _hotel_id: hotelId });
  if (canAccess !== true) return json({ ok: false, error: "Forbidden" }, 403);

  return {
    userId: userData.user.id,
    role: String(profile.role ?? ""),
    isSuperAdmin: profile.is_super_admin === true,
    organizationSlug: profile.organization_slug ?? null,
  };
}

export const hasRole = (c: Caller, roles: string[]) => c.isSuperAdmin || roles.includes(c.role);

/** Today in Budapest as YYYY-MM-DD. */
export function budapestToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

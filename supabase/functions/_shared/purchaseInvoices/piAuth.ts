/**
 * Caller authorization for purchase-invoice Edge Functions.
 *
 * Either a scheduled worker (x-worker-secret matching the Vault secret) or a
 * signed-in user. User capabilities are evaluated by the database with the
 * caller's own JWT (pi_module_access, pi_can_control_nav, fin_is_admin), so
 * the Edge Function never trusts client-sent roles or organization slugs.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped service-role client
export type Db = any;

export function serviceDb(): Db {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server configuration unavailable");
  return createClient(url, key, { auth: { persistSession: false } });
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface UserCaller {
  kind: "user";
  userId: string;
  organizationSlug: string;
  role: string;
  moduleAccess: boolean;
  canControlNav: boolean;
  isFinanceAdmin: boolean;
}
export interface WorkerCaller { kind: "worker" }
export type Caller = UserCaller | WorkerCaller;

export async function isWorkerRequest(req: Request, db: Db): Promise<boolean> {
  const provided = req.headers.get("x-worker-secret") || "";
  if (!provided) return false;
  const { data, error } = await db.rpc("get_purchase_invoice_worker_secret");
  return !error && safeEqual(provided, String(data || ""));
}

export async function authorizeCaller(req: Request, db: Db, options: { allowWorker?: boolean } = {}): Promise<Caller | Response> {
  if (options.allowWorker && req.headers.get("x-worker-secret")) {
    return (await isWorkerRequest(req, db)) ? { kind: "worker" } : json({ ok: false, error: "Unauthorized" }, 401);
  }
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: userData, error } = await userClient.auth.getUser();
  if (error || !userData?.user) return json({ ok: false, error: "Unauthorized" }, 401);
  const { data: profile } = await db.from("profiles").select("role, organization_slug").eq("id", userData.user.id).maybeSingle();
  if (!profile?.organization_slug) return json({ ok: false, error: "Forbidden" }, 403);
  const [access, control, admin] = await Promise.all([
    userClient.rpc("pi_module_access"),
    userClient.rpc("pi_can_control_nav"),
    userClient.rpc("fin_is_admin"),
  ]);
  if (access.data !== true) return json({ ok: false, error: "The Purchase Invoices module is not enabled for your account" }, 403);
  return {
    kind: "user",
    userId: userData.user.id,
    organizationSlug: String(profile.organization_slug),
    role: String(profile.role ?? ""),
    moduleAccess: true,
    canControlNav: control.data === true,
    isFinanceAdmin: admin.data === true,
  };
}

export class InputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

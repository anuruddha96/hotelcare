// Shared billing helpers for the module subscription flow.
//
// Prices are always VAT-EXCLUSIVE. Stripe sessions are created with
// automatic tax disabled so the amount charged is exactly what we quote and
// VAT is handled outside the app.

import { createClient } from "npm:@supabase/supabase-js@2";

export type ModuleKey = "revenue" | "operations";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export const BILLING_ROLES = ["admin", "top_management", "top_management_manager"];

export type Caller = {
  userId: string;
  role: string;
  organizationSlug: string | null;
  isSuperAdmin: boolean;
};

export async function requireBillingCaller(req: Request): Promise<Caller | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  // Validate the caller's JWT with the service-role client. Using the anon
  // client here breaks whenever the project's anon key/signing keys rotate,
  // which surfaced as a blanket 401 on every billing call.
  const token = authHeader.slice("Bearer ".length).trim();
  const { data: userData, error } = await admin().auth.getUser(token);
  if (error || !userData?.user) {
    console.error("billing auth failed", error?.message);
    return json({ error: "Unauthorized" }, 401);
  }

  const { data: profile } = await admin()
    .from("profiles")
    .select("role, organization_slug, is_super_admin")
    .eq("id", userData.user.id)
    .maybeSingle();

  const role = String(profile?.role ?? "");
  if (!profile || (!BILLING_ROLES.includes(role) && !profile.is_super_admin)) {
    return json({ error: "Forbidden" }, 403);
  }

  return {
    userId: userData.user.id,
    role,
    organizationSlug: (profile.organization_slug as string | null) ?? null,
    isSuperAdmin: Boolean(profile.is_super_admin),
  };
}

export type BillingSettings = {
  organization_slug: string;
  currency: string;
  revenue_price_cents: number;
  revenue_module_enabled: boolean;
  operations_price_cents: number;
  operations_module_enabled: boolean;
  operations_module_label: string;
  trial_enabled: boolean;
  trial_months: number;
  trial_start: string;
  stripe_publishable_key: string | null;
  payments_enabled: boolean;
};

export async function loadSettings(slug: string): Promise<BillingSettings> {
  const db = admin();
  const { data } = await db
    .from("billing_settings")
    .select("*")
    .eq("organization_slug", slug)
    .maybeSingle();

  if (data) return data as BillingSettings;

  const { data: created } = await db
    .from("billing_settings")
    .insert({ organization_slug: slug })
    .select("*")
    .single();
  return created as BillingSettings;
}

/** Hotels of an organization plus their billable room count. */
export async function loadHotels(slug: string) {
  const db = admin();
  const { data: org } = await db.from("organizations").select("id, name").eq("slug", slug).maybeSingle();
  if (!org) return [];

  const { data: hotels } = await db
    .from("hotel_configurations")
    .select("hotel_id, hotel_name, is_active")
    .eq("organization_id", org.id)
    .eq("is_active", true)
    .order("hotel_name");

  const out: { hotel_id: string; hotel_name: string; rooms: number }[] = [];
  for (const h of hotels ?? []) {
    const { data: rooms } = await db.rpc("billable_room_count", { _hotel_id: h.hotel_id });
    out.push({ hotel_id: h.hotel_id, hotel_name: h.hotel_name, rooms: Number(rooms ?? 0) });
  }
  return out;
}

export function priceFor(settings: BillingSettings, module: ModuleKey) {
  return module === "revenue" ? settings.revenue_price_cents : settings.operations_price_cents;
}

export function moduleEnabled(settings: BillingSettings, module: ModuleKey) {
  return module === "revenue" ? settings.revenue_module_enabled : settings.operations_module_enabled;
}

export function moduleLabel(settings: BillingSettings, module: ModuleKey) {
  return module === "revenue" ? "Revenue Management" : settings.operations_module_label;
}

export function trialEndsAt(settings: BillingSettings): string | null {
  if (!settings.trial_enabled) return null;
  const start = new Date(`${settings.trial_start}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + (settings.trial_months || 0));
  return end.toISOString();
}

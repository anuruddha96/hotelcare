// Shared billing helpers for the module subscription flow.
//
// Prices are always VAT-EXCLUSIVE. Stripe sessions are created with
// automatic tax disabled so the amount charged is exactly what we quote and
// VAT is handled outside the app.

import { createClient } from "npm:@supabase/supabase-js@2";

export type ModuleKey = "revenue_bi" | "revenue_automation" | "operations" | "maintenance";

/** Legacy key kept for old rows/clients. */
export const LEGACY_REVENUE = "revenue";

export function normaliseModule(module: string): ModuleKey {
  return module === "revenue" ? "revenue_automation" : (module as ModuleKey);
}

export function isRevenueModule(module: string) {
  return ["revenue", "revenue_bi", "revenue_automation"].includes(module);
}

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
  /** Business Intelligence tier — analytics only, no automated price changes. */
  revenue_bi_price_cents: number;
  /** BI + Automation tier — includes the automated pricing engine. */
  revenue_automation_price_cents: number;
  maintenance_module_enabled: boolean;
  maintenance_pricing_mode: "custom" | "per_room";
  maintenance_price_cents: number;
  /** VAT added on top of every quoted (net) amount. */
  vat_percent: number;
  billing_company_name: string | null;
  billing_address_line1: string | null;
  billing_address_line2: string | null;
  billing_address_city: string | null;
  billing_address_postal_code: string | null;
  billing_address_country: string | null;
  billing_tax_id: string | null;
  /** 'per_room' = fixed price per room, 'percent' = share of realised revenue. */
  revenue_pricing_mode: "per_room" | "percent";
  revenue_percent_bps: number;
  revenue_percent_min_cents: number;
  revenue_percent_cap_cents: number;
  /** Standard (list) prices, shown struck through while the promotion runs. */
  standard_revenue_bi_price_cents: number;
  standard_revenue_automation_price_cents: number;
  standard_operations_price_cents: number;
  early_bird_enabled: boolean;
  early_bird_label: string;
  early_bird_note: string;
  early_bird_ends_at: string | null;
  /** Days of continued access after the free trial ends. */
  grace_days: number;
};

/** First day of the month that precedes `ref` (UTC), as YYYY-MM-DD. */
export function lastMonthRange(ref = new Date()) {
  const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * Realised room revenue of a property for a date range, straight from the
 * synced Previo booking nights (de-duplicated per reservation/room/night).
 */
export async function realisedRevenueCents(hotelId: string, from: string, to: string) {
  const { data } = await admin().rpc("billing_realised_revenue", {
    _hotel_id: hotelId,
    _from: from,
    _to: to,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return {
    revenueCents: Math.round(Number(row?.revenue_eur ?? 0) * 100),
    roomNights: Number(row?.room_nights ?? 0),
  };
}

/** Percentage fee for a realised revenue amount, respecting the min and cap. */
export function percentFeeCents(settings: BillingSettings, revenueCents: number) {
  let fee = Math.round((revenueCents * (settings.revenue_percent_bps || 0)) / 10000);
  if (settings.revenue_percent_min_cents > 0) fee = Math.max(fee, settings.revenue_percent_min_cents);
  if (settings.revenue_percent_cap_cents > 0) fee = Math.min(fee, settings.revenue_percent_cap_cents);
  return fee;
}

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
  switch (normaliseModule(module)) {
    case "revenue_bi":
      return settings.revenue_bi_price_cents;
    case "revenue_automation":
      return settings.revenue_automation_price_cents || settings.revenue_price_cents;
    case "maintenance":
      return settings.maintenance_pricing_mode === "per_room" ? settings.maintenance_price_cents : 0;
    default:
      return settings.operations_price_cents;
  }
}

export function moduleEnabled(settings: BillingSettings, module: ModuleKey) {
  const key = normaliseModule(module);
  if (key === "maintenance") return settings.maintenance_module_enabled;
  if (isRevenueModule(key)) return settings.revenue_module_enabled;
  return settings.operations_module_enabled;
}

export function moduleLabel(settings: BillingSettings, module: ModuleKey) {
  switch (normaliseModule(module)) {
    case "revenue_bi":
      return "Revenue — Business Intelligence";
    case "revenue_automation":
      return "Revenue — BI + Automation";
    case "maintenance":
      return "Maintenance";
    default:
      return settings.operations_module_label;
  }
}

/** VAT amount for a net amount, using the organization's VAT rate. */
export function vatCents(settings: BillingSettings, netCents: number) {
  return Math.round((netCents * (Number(settings.vat_percent) || 0)) / 100);
}

/**
 * True when the free trial still covers a billing period, i.e. the trial ends
 * on or after the last day of that month. Trial months are never charged.
 */
export function trialCoversPeriod(settings: BillingSettings, periodEnd: string): boolean {
  const end = trialEndsAt(settings);
  if (!end) return false;
  return new Date(end).getTime() >= new Date(`${periodEnd}T00:00:00Z`).getTime();
}

export function trialEndsAt(settings: BillingSettings): string | null {
  if (!settings.trial_enabled) return null;
  const start = new Date(`${settings.trial_start}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + (settings.trial_months || 0));
  return end.toISOString();
}

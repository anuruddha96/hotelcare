// Pull restaurant/brunch reservations for one hotel + service date from the
// Sales Dashboard - RD Hotels project and mirror them into
// public.restaurant_reservations, so every hotel's /bb Reservations tab is
// populated without each hotel website having to push to HotelCare directly.
//
// Called by restaurant-reservations-list (and can be invoked directly for a
// manual refresh). Locally marked statuses (seated / no_show) are preserved.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { budapestDate, budapestDayRange, dashboardConfig, isRestaurantOutlet } from "../_shared/salesDashboard.ts";

interface DashboardReservation {
  id: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  party_size: number;
  starts_at: string;
  ends_at: string | null;
  status: string;
  occasion: string | null;
  special_requests: string | null;
  notes: string | null;
  source_project: string | null;
  source_reservation_id: string | null;
  updated_at: string | null;
  outlets: { slug: string | null } | null;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function syncHotelReservations(
  supabase: ReturnType<typeof createClient>,
  hotelId: string,
  serviceDate: string,
): Promise<{ synced: number; skipped: number; property: string | null; error?: string }> {
  const { data: source } = await supabase
    .from("restaurant_webhook_sources")
    .select("property_slug, hotel_id")
    .eq("hotel_id", hotelId)
    .eq("is_active", true)
    .maybeSingle();

  if (!source) return { synced: 0, skipped: 0, property: null, error: "Hotel is not mapped to a Sales Dashboard property" };

  const cfg = dashboardConfig();
  if (!cfg) return { synced: 0, skipped: 0, property: source.property_slug as string, error: "Sales Dashboard credentials are not configured" };

  const { start, end } = budapestDayRange(serviceDate);
  const params = new URLSearchParams({
    select:
      "id,guest_name,guest_email,guest_phone,party_size,starts_at,ends_at,status,occasion,special_requests,notes,source_project,source_reservation_id,updated_at,outlets(slug),properties!inner(slug)",
    "properties.slug": `eq.${source.property_slug}`,
    starts_at: `gte.${start.toISOString()}`,
    order: "starts_at.asc",
    limit: "500",
  });
  params.append("starts_at", `lt.${end.toISOString()}`);

  const res = await fetch(`${cfg.url}/rest/v1/reservations?${params.toString()}`, {
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Sales Dashboard read failed [${res.status}]: ${body.slice(0, 400)}`);
    return { synced: 0, skipped: 0, property: source.property_slug as string, error: `Dashboard responded ${res.status}` };
  }

  const rows = (await res.json()) as DashboardReservation[];
  const relevant = rows.filter((r) => isRestaurantOutlet(r.outlets?.slug));

  // Existing local rows so a staff mark is never overwritten by a stale
  // "booked" coming back from the dashboard.
  const { data: existing } = await supabase
    .from("restaurant_reservations")
    .select("source_reservation_id, status, status_marked_at")
    .eq("hotel_id", hotelId)
    .eq("service_date", serviceDate);
  const localByRef = new Map((existing ?? []).map((r: any) => [String(r.source_reservation_id), r]));

  const payload = relevant.map((r) => {
    const ref = r.source_reservation_id || `sd:${r.id}`;
    const local = localByRef.get(ref);
    const dashboardUpdated = r.updated_at ? new Date(r.updated_at).getTime() : 0;
    const markedAt = local?.status_marked_at ? new Date(local.status_marked_at).getTime() : 0;
    // Keep the local mark when it is newer than the dashboard's own change.
    const keepLocal = Boolean(local) && markedAt > dashboardUpdated && r.status !== "cancelled";
    return {
      hotel_id: hotelId,
      source_project: source.property_slug,
      source_reservation_id: ref,
      outlet_slug: r.outlets?.slug || "brunch",
      guest_name: r.guest_name,
      guest_email: r.guest_email,
      guest_phone: r.guest_phone,
      party_size: r.party_size ?? 2,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      service_date: budapestDate(r.starts_at),
      status: keepLocal ? local.status : r.status,
      occasion: r.occasion,
      special_requests: r.special_requests,
      notes: r.notes,
      raw_payload: { dashboard_id: r.id, dashboard_status: r.status, synced_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    };
  });

  if (payload.length) {
    const { error } = await supabase
      .from("restaurant_reservations")
      .upsert(payload, { onConflict: "hotel_id,source_project,source_reservation_id" });
    if (error) {
      console.error("restaurant_reservations upsert failed", error.message);
      return { synced: 0, skipped: rows.length - relevant.length, property: source.property_slug as string, error: error.message };
    }
  }

  return { synced: payload.length, skipped: rows.length - relevant.length, property: source.property_slug as string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const hotelId = typeof body?.hotel_id === "string" ? body.hotel_id.trim() : "";
    const serviceDate = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : budapestDate(new Date());
    if (!/^[0-9a-f-]{36}$/i.test(hotelId)) return json({ error: "Invalid hotel_id" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration unavailable" }, 500);
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const result = await syncHotelReservations(supabase, hotelId, serviceDate);
    return json({ ok: !result.error, ...result, service_date: serviceDate });
  } catch (e: any) {
    console.error("restaurant-reservations-sync error", e);
    return json({ error: e?.message ?? String(e) }, 400);
  }
});

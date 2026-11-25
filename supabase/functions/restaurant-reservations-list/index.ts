// Property-scoped restaurant reservation board for authenticated /bb staff.
// A shared tablet signs into a breakfast-staff account; anonymous callers must
// never receive guest names, phone numbers, or reservation notes.
//
// Before reading, it pulls the latest bookings from the Sales Dashboard (the
// source of truth for every RD property), throttled per hotel+date. Website
// webhooks remain the primary push path; the pull is the safety net when a
// website webhook is delayed or temporarily unavailable.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { syncHotelReservations } from "../_shared/syncReservations.ts";
import { authenticateRestaurantStaff, authorizeRestaurantHotel } from "../_shared/restaurantStaffAuth.ts";
import { budapestDate } from "../_shared/salesDashboard.ts";

const ipHits = new Map<string, { count: number; reset: number }>();
function rateLimit(ip: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const e = ipHits.get(ip);
  if (!e || now > e.reset) { ipHits.set(ip, { count: 1, reset: now + windowMs }); return true; }
  e.count++;
  return e.count <= limit;
}

// Throttle dashboard pulls: at most one per hotel+date per 45s per instance.
const lastSync = new Map<string, number>();
function shouldSync(key: string, force: boolean): boolean {
  const now = Date.now();
  const prev = lastSync.get(key) ?? 0;
  if (!force && now - prev < 45_000) return false;
  lastSync.set(key, now);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip)) {
      return new Response(JSON.stringify({ error: "Too many requests" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const hotelId = typeof body?.hotel_id === "string" ? body.hotel_id.trim() : "";
    const serviceDate = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : budapestDate(new Date());
    if (!hotelId || hotelId.length > 100) throw new Error("Missing or invalid hotel_id");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Server configuration unavailable");
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Authenticate before any guest-data reads or upstream synchronization.
    const session = await authenticateRestaurantStaff(req, supabase);
    if (!session.ok) return json({ error: session.error }, session.status);
    const access = await authorizeRestaurantHotel(supabase, session.actor, hotelId);
    if (!access.ok) return json({ error: access.error }, access.status);
    const reservationHotelId = access.hotel.reservationHotelId;
    const source = access.hotel.propertySlug ? { property_slug: access.hotel.propertySlug } : null;

    // Always ask the shared sync layer to refresh when a source is mapped.
    // Previously this call was silently skipped when the Sales Dashboard secret
    // was absent, making a broken feed indistinguishable from a genuine zero-
    // reservation day. syncHotelReservations already validates its own config
    // and returns a safe error, so let that error reach the caller.
    let syncAttempted = false;
    let syncError: string | null = source ? null : "Restaurant reservation source is not configured";
    let syncedCount = 0;
    if (source && shouldSync(`${reservationHotelId}:${serviceDate}`, body?.force === true)) {
      syncAttempted = true;
      try {
        const result = await syncHotelReservations(supabase, reservationHotelId, serviceDate);
        syncError = result.error ?? null;
        syncedCount = result.synced ?? 0;
      } catch (e) {
        syncError = e instanceof Error ? e.message : String(e);
        console.error("reservation pull failed", syncError);
      }
    }

    const { data, error } = await supabase
      .from("restaurant_reservations")
      .select("id, guest_name, guest_phone, party_size, starts_at, ends_at, created_at, booked_at, first_seen_at, status, occasion, special_requests, notes, outlet_slug, source_project, raw_payload, status_marked_at, status_marked_by, dashboard_sync_state, dashboard_synced_at")
      .eq("hotel_id", reservationHotelId)
      .eq("service_date", serviceDate)
      .order("starts_at", { ascending: true });

    if (error) throw error;

    // Track the last real website delivery separately from self-tests. Webhook
    // logs are keyed by property_slug (not hotel_id), so use the already-resolved
    // source mapping. This keeps feed-health detection accurate for Mika and all
    // other mapped properties.
    let webhookRows: Array<{ created_at: string; source_reservation_id: string | null }> = [];
    if (source?.property_slug) {
      const { data: recentWebhookRows, error: webhookLogError } = await supabase
        .from("restaurant_webhook_log")
        .select("created_at, source_reservation_id")
        .eq("property_slug", source.property_slug)
        .eq("outcome", "upserted")
        .order("created_at", { ascending: false })
        .limit(25);

      if (webhookLogError) {
        console.error("restaurant webhook health lookup failed", webhookLogError.message);
      } else {
        webhookRows = recentWebhookRows ?? [];
      }
    }

    const lastRealWebhook = webhookRows.find((r) => {
      const ref = String(r.source_reservation_id ?? "").toLowerCase();
      return !ref.startsWith("selftest") && !ref.startsWith("self-test");
    });
    const lastWebhookAt = lastRealWebhook?.created_at ?? null;

    // Never expose the raw upstream payload through the public BB list.
    // Only surface the small manual booking source label used in the UI.
    const rows = (data ?? []).map(({ raw_payload, ...r }: any) => ({
      ...r,
      booking_mode: r.source_project === "manual" &&
        ["phone", "walk_in", "hotel_guest", "other"].includes(raw_payload?.booking_mode)
        ? raw_payload.booking_mode : null,
    }));
    const active = rows.filter((r) => r.status !== "cancelled");
    const feedStatus = !source
      ? "unconfigured"
      : !syncError
        ? "dashboard"
        : lastWebhookAt
          ? "webhook"
          : "unavailable";

    return new Response(JSON.stringify({
      reservations: rows,
      service_date: serviceDate,
      total_reservations: active.length,
      total_covers: active.reduce((a, r) => a + (r.party_size || 0), 0),
      configured: Boolean(source),
      source_property: source?.property_slug ?? null,
      feed_status: feedStatus,
      sync_attempted: syncAttempted,
      sync_error: syncError,
      synced_count: syncedCount,
      last_webhook_at: lastWebhookAt,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("restaurant-reservations-list failed", e);
    return json({ error: "Could not retrieve restaurant reservations" }, 500);
  }
});

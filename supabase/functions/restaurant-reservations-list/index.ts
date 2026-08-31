// Public read endpoint for the /bb page: today's restaurant (brunch) reservations
// for one hotel. Mirrors the access model of breakfast-public-lookup — the BB page
// is used by restaurant staff on shared devices without a login.
//
// Before reading, it pulls the latest bookings from the Sales Dashboard (the
// source of truth for every RD property), throttled per hotel+date.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { syncHotelReservations } from "../_shared/syncReservations.ts";

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
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip)) {
      return new Response(JSON.stringify({ error: "Too many requests" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const hotelId = typeof body?.hotel_id === "string" ? body.hotel_id.trim() : "";
    const serviceDate = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : new Date().toISOString().slice(0, 10);
    if (!hotelId || hotelId.length > 100) throw new Error("Missing or invalid hotel_id");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Server configuration unavailable");
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // The public BB picker uses hotel_configurations.hotel_id (for example
    // "memories-budapest"), while website webhooks use the canonical UUID from
    // public.hotels. Resolve both forms before reading restaurant reservations.
    let reservationHotelId = hotelId;
    const { data: directSource } = await supabase
      .from("restaurant_webhook_sources")
      .select("hotel_id, property_slug")
      .eq("hotel_id", hotelId)
      .eq("is_active", true)
      .maybeSingle();

    let source = directSource;
    if (!source) {
      const { data: config } = await supabase
        .from("hotel_configurations")
        .select("hotel_name")
        .eq("hotel_id", hotelId)
        .eq("is_active", true)
        .maybeSingle();

      if (config?.hotel_name) {
        const { data: canonicalHotel } = await supabase
          .from("hotels")
          .select("id")
          .ilike("name", config.hotel_name)
          .maybeSingle();
        if (canonicalHotel?.id) reservationHotelId = canonicalHotel.id;
      }

      const { data: resolvedSource } = await supabase
        .from("restaurant_webhook_sources")
        .select("hotel_id, property_slug")
        .eq("hotel_id", reservationHotelId)
        .eq("is_active", true)
        .maybeSingle();
      source = resolvedSource;
    }


    // Optional: if an outbound-pull source is configured for this deployment,
    // refresh before reading. Reservations normally arrive by signed webhook,
    // so a missing pull configuration is not an error.
    let syncError: string | null = null;
    if (source && Deno.env.get("SALES_DASHBOARD_SERVICE_KEY") && shouldSync(`${reservationHotelId}:${serviceDate}`, body?.force === true)) {
      try {
        const result = await syncHotelReservations(supabase, reservationHotelId, serviceDate);
        syncError = result.error ?? null;
      } catch (e) {
        syncError = e instanceof Error ? e.message : String(e);
        console.error("reservation pull failed", syncError);
      }
    }


    const { data, error } = await supabase
      .from("restaurant_reservations")
      .select("id, guest_name, guest_phone, party_size, starts_at, ends_at, status, occasion, special_requests, notes, outlet_slug, status_marked_at, status_marked_by, dashboard_sync_state, dashboard_synced_at")
      .eq("hotel_id", reservationHotelId)
      .eq("service_date", serviceDate)
      .order("starts_at", { ascending: true });

    if (error) throw error;

    const rows = data ?? [];
    const active = rows.filter((r) => r.status !== "cancelled");
    return new Response(JSON.stringify({
      reservations: rows,
      service_date: serviceDate,
      total_reservations: active.length,
      total_covers: active.reduce((a, r) => a + (r.party_size || 0), 0),
      configured: Boolean(source),
      sync_error: syncError,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

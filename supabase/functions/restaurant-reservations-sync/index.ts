// Pull restaurant/brunch reservations for one hotel + service date from the
// Sales Dashboard - RD Hotels project and mirror them into
// public.restaurant_reservations, so every hotel's /bb Reservations tab is
// populated without each hotel website having to push to HotelCare directly.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { budapestDate } from "../_shared/salesDashboard.ts";
import { syncHotelReservations } from "../_shared/syncReservations.ts";
import { authenticateRestaurantStaff, authorizeRestaurantHotel, RESTAURANT_UUID } from "../_shared/restaurantStaffAuth.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const hotelId = typeof body?.hotel_id === "string" ? body.hotel_id.trim() : "";
    const serviceDate = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : budapestDate(new Date());
    if (!RESTAURANT_UUID.test(hotelId)) return json({ error: "Invalid hotel_id" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration unavailable" }, 500);
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Internal schedulers may use the service-role bearer, but not the public
    // anon/publishable key. Staff callers must be assigned to this property.
    const bearer = /^Bearer\s+([^\s]+)$/i.exec(req.headers.get("Authorization")?.trim() ?? "")?.[1] ?? "";
    const apiKey = req.headers.get("apikey") ?? "";
    const isInternalWorker = (bearer.length > 0 && bearer === serviceRoleKey)
      || (apiKey.length > 0 && apiKey === serviceRoleKey);
    if (!isInternalWorker) {
      const session = await authenticateRestaurantStaff(req, supabase);
      if (!session.ok) return json({ error: session.error }, session.status);
      const access = await authorizeRestaurantHotel(supabase, session.actor, hotelId);
      if (!access.ok) return json({ error: access.error }, access.status);
    }
    const result = await syncHotelReservations(supabase, hotelId, serviceDate);
    return json({ ok: !result.error, ...result, service_date: serviceDate });
  } catch (e: any) {
    console.error("restaurant-reservations-sync error", e);
    return json({ error: "Restaurant reservation synchronization failed" }, 500);
  }
});

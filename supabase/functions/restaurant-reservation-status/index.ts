// Signed-in, property-scoped /bb staff record arrival/no-show status.
// All status updates are attributed to a verified user and checked against
// the current status to avoid overwriting simultaneous changes.
//
// After the local status is stored we forward the reservation, signed, to the
// Sales Dashboard webhook so its analytics (covers, funnel, no-show rate) stay
// in sync. A failed forward never blocks the local update.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { pushStatusToDashboard } from "../_shared/syncReservations.ts";
import { authenticateRestaurantStaff, authorizeRestaurantHotel, restaurantStatusTransition } from "../_shared/restaurantStaffAuth.ts";


const ALLOWED = new Set(["booked", "seated", "no_show"]);

const ipHits = new Map<string, { count: number; reset: number }>();
function rateLimit(ip: string, limit = 120, windowMs = 60_000): boolean {
  const now = Date.now();
  const e = ipHits.get(ip);
  if (!e || now > e.reset) { ipHits.set(ip, { count: 1, reset: now + windowMs }); return true; }
  e.count++;
  return e.count <= limit;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip)) return json({ error: "Too many requests" }, 429);

    const body = await req.json().catch(() => null);
    const reservationId = typeof body?.reservation_id === "string" ? body.reservation_id.trim() : "";
    const status = typeof body?.status === "string" ? body.status.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(reservationId)) return json({ error: "Invalid reservation_id" }, 400);
    if (!ALLOWED.has(status)) return json({ error: "Invalid status" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration unavailable" }, 500);
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const session = await authenticateRestaurantStaff(req, supabase);
    if (!session.ok) return json({ error: session.error }, session.status);

    const { data: reservation, error: loadError } = await supabase
      .from("restaurant_reservations")
      .select("id, hotel_id, source_project, source_reservation_id, outlet_slug, guest_name, guest_email, guest_phone, party_size, starts_at, ends_at, occasion, special_requests, notes, status, dashboard_sync_state, raw_payload")
      .eq("id", reservationId)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!reservation) return json({ error: "Reservation not found" }, 404);
    const access = await authorizeRestaurantHotel(supabase, session.actor, reservation.hotel_id);
    if (!access.ok) return json({ error: access.error }, access.status);
    if (reservation.status === "cancelled") return json({ error: "Reservation is cancelled" }, 409);
    if (!restaurantStatusTransition(reservation.status, status, body?.confirm_correction === true)) {
      return json({ error: "This status change needs confirmation or the reservation has already been completed." }, 409);
    }
    if (reservation.status === status) {
      return json({ ok: true, status, dashboard_sync_state: reservation.dashboard_sync_state });
    }

    const nowIso = new Date().toISOString();

    // 1. Local status first — staff must never lose the mark to a network hiccup.
    const { data: changed, error: updateError } = await supabase
      .from("restaurant_reservations")
      .update({
        status,
        status_marked_at: nowIso,
        status_marked_by: session.actor.displayName,
        status_marked_user_id: session.actor.userId,
        dashboard_sync_state: "pending",
        dashboard_sync_error: null,
      })
      .eq("id", reservationId)
      .eq("status", reservation.status)
      .select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!changed) return json({ error: "Reservation was updated on another device. Refresh and try again." }, 409);

    // Manually entered BB bookings are local records, not Sales Dashboard rows.
    // Do not leave them forever marked "Sync pending" or send an unsigned
    // writeback with an invented remote reservation ID.
    if (reservation.source_project === "manual") {
      const { error: localError } = await supabase
        .from("restaurant_reservations")
        .update({ dashboard_sync_state: "local", dashboard_sync_error: null })
        .eq("id", reservationId).eq("status", status).eq("status_marked_at", nowIso);
      if (localError) throw localError;
      return json({ ok: true, status, status_marked_by: session.actor.displayName, dashboard_sync_state: "local", dashboard_sync_error: null });
    }

    // 2a. Preferred path — write the status straight onto the Sales Dashboard
    // reservation row (works for every property mirrored from the dashboard).
    let syncState = "pending";
    let syncError: string | null = null;
    const dashboardId = (reservation.raw_payload as Record<string, unknown> | null)?.dashboard_id;
    if (typeof dashboardId === "string" && dashboardId) {
      const direct = await pushStatusToDashboard(dashboardId, status);
      if (direct.ok) {
        syncState = "synced";
      } else {
        syncError = direct.error ?? "Dashboard update failed";
      }
    }

    // 2b. Fallback — the signed webhook path used by reservations that arrived
    // from a hotel website rather than a dashboard pull.
    const webhookUrl = Deno.env.get("SALES_DASHBOARD_WEBHOOK_URL");
    const webhookSecret = Deno.env.get("SALES_DASHBOARD_WEBHOOK_SECRET");

    if (syncState === "synced") {
      // nothing more to do
    } else if (!webhookUrl || !webhookSecret) {

      syncError = "Sales Dashboard webhook is not configured";
    } else if (!reservation.source_project || !reservation.source_reservation_id) {
      syncError = "Reservation has no dashboard source reference";
    } else {
      const payload = JSON.stringify({
        source_reservation_id: reservation.source_reservation_id,
        outlet_slug: reservation.outlet_slug,
        guest_name: reservation.guest_name,
        guest_email: reservation.guest_email,
        guest_phone: reservation.guest_phone,
        party_size: reservation.party_size,
        starts_at: reservation.starts_at,
        ends_at: reservation.ends_at,
        // starts_at/ends_at are stored as real UTC instants.
        timezone: "UTC",
        status,
        occasion: reservation.occasion,
        special_requests: reservation.special_requests,
        notes: reservation.notes,
      });
      try {
        const signature = await hmacHex(webhookSecret, payload);
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-property": reservation.source_project,
            "x-signature": signature,
          },
          body: payload,
        });
        if (res.ok) {
          syncState = "synced";
        } else {
          syncError = `Dashboard responded ${res.status}: ${(await res.text()).slice(0, 300)}`;
        }
      } catch (e) {
        syncError = e instanceof Error ? e.message : String(e);
      }
    }

    if (syncState === "synced") {
      syncError = null;
    } else if (syncError) {
      syncState = "failed";
      console.error("restaurant-reservation-status sync failed", syncError);
    }


    await supabase
      .from("restaurant_reservations")
      .update({
        dashboard_sync_state: syncState,
        dashboard_synced_at: syncState === "synced" ? new Date().toISOString() : null,
        dashboard_sync_error: syncError,
      })
      .eq("id", reservationId).eq("status", status).eq("status_marked_at", nowIso);

    return json({
      ok: true,
      status,
      status_marked_by: session.actor.displayName,
      dashboard_sync_state: syncState,
      dashboard_sync_error: syncError,
    });
  } catch (e: any) {
    console.error("restaurant-reservation-status error", e);
    return json({ error: e?.message ?? String(e) }, 400);
  }
});

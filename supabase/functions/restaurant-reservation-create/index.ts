// Authenticated staff-only booking creation from /bb.
// Guests and anonymous visitors cannot access the reservations board or create
// bookings. Verified staff may act only within their assigned organization/hotel.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { authenticateRestaurantStaff, authorizeRestaurantHotel } from "../_shared/restaurantStaffAuth.ts";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const modes = new Set(["phone", "walk_in", "hotel_guest", "other"]);

function budapestTime(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  function tzOffset(timestamp: number): number {
    const parts = Object.fromEntries(format.formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - timestamp;
  }
  const first = guess - tzOffset(guess);
  const actual = new Date(guess - tzOffset(first));
  const parts = Object.fromEntries(format.formatToParts(actual).map(p => [p.type, p.value]));
  if (+parts.year !== y || +parts.month !== m || +parts.day !== d || +parts.hour !== hour || +parts.minute !== minute)
    throw new Error("The selected arrival time does not exist in Budapest local time");
  return actual;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Staff sign-in is required" }, 401);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ error: "Server not configured" }, 500);
    const db = createClient(url, key);
    const session = await authenticateRestaurantStaff(req, db);
    if (!session.ok) return json({ error: session.error }, session.status);

    const body = await req.json().catch(() => null);
    const hotelCode = String(body?.hotel_id ?? "").trim();
    const guestName = String(body?.guest_name ?? "").trim();
    const guestEmail = String(body?.guest_email ?? "").trim().toLowerCase();
    const guestPhone = String(body?.guest_phone ?? "").trim();
    const note = String(body?.notes ?? "").trim();
    const date = String(body?.date ?? "").trim();
    const time = String(body?.time ?? "").trim();
    const partySize = Number(body?.party_size);
    const mode = String(body?.booking_mode ?? "phone");
    if (hotelCode.length < 2 || hotelCode.length > 100 || !/^[a-zA-Z0-9-]+$/.test(hotelCode))
      return json({ error: "Invalid hotel selection" }, 400);
    if (guestName.length < 2 || guestName.length > 120) return json({ error: "Enter the guest name (2–120 characters)" }, 400);
    if (guestEmail && (guestEmail.length > 250 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guestEmail)))
      return json({ error: "Invalid email" }, 400);
    if (guestPhone.length > 32 || note.length > 500) return json({ error: "Phone or notes are too long" }, 400);
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 30) return json({ error: "Guests must be between 1 and 30" }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !modes.has(mode))
      return json({ error: "Invalid date, arrival time or booking source" }, 400);

    const start = budapestTime(date, time);
    if (Math.abs(start.getTime() - Date.now()) > 370 * 24 * 3600_000)
      return json({ error: "Select a date within one year" }, 400);
    const access = await authorizeRestaurantHotel(db, session.actor, hotelCode);
    if (!access.ok) return json({ error: access.error }, access.status);
    if (!access.hotel.propertySlug) return json({ error: "Restaurant reservation feed is not configured" }, 409);
    const canonicalHotelId = access.hotel.reservationHotelId;

    const reservationId = crypto.randomUUID();
    const payload = {
      id: reservationId,
      hotel_id: canonicalHotelId,
      source_project: "manual",
      source_reservation_id: "manual:" + reservationId,
      outlet_slug: "brunch",
      guest_name: guestName,
      guest_email: guestEmail || null,
      guest_phone: guestPhone || null,
      party_size: partySize,
      starts_at: start.toISOString(),
      service_date: date,
      status: "booked",
      notes: note || null,
      raw_payload: { manual: true, booking_mode: mode, created_by: session.actor.userId },
      booked_at: new Date().toISOString(),
      dashboard_sync_state: "local",
    };
    const { data: created, error } = await db.from("restaurant_reservations")
      .insert(payload).select("id,guest_name,starts_at,service_date").single();
    if (error) throw error;
    return json({ ok: true, reservation: created }, 201);
  } catch (error) {
    console.error("restaurant-reservation-create", error);
    return json({ error: error instanceof Error ? error.message : "Could not save the reservation" }, 400);
  }
});

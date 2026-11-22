// Authenticated staff-only booking creation from /bb.
// Guests and anonymous visitors cannot access the reservations board or create
// bookings. Verified staff may act only within their assigned organization/hotel.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const allowedRoles = new Set(["admin", "top_management", "top_management_manager", "manager", "reception", "reception_manager", "front_office", "breakfast_staff"]);
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
    const { data: auth, error: authError } = await db.auth.getUser(jwt);
    if (authError || !auth.user) return json({ error: "Staff sign-in has expired" }, 401);
    const { data: profile } = await db.from("profiles")
      .select("role,assigned_hotel,hotel_id,organization_slug,is_super_admin,deleted_at")
      .eq("id", auth.user.id).maybeSingle();
    if (!profile || profile.deleted_at || !allowedRoles.has(profile.role))
      return json({ error: "This staff account cannot create restaurant reservations" }, 403);

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
    const { data: config } = await db.from("hotel_configurations")
      .select("hotel_id,hotel_name,organization_id").eq("hotel_id", hotelCode).eq("is_active", true).maybeSingle();
    if (!config) return json({ error: "Unknown hotel" }, 404);
    const { data: org } = await db.from("organizations").select("slug")
      .eq("id", config.organization_id).maybeSingle();
    if (!org || (!profile.is_super_admin && profile.organization_slug !== org.slug))
      return json({ error: "No access to this organization" }, 403);

    const executive = profile.is_super_admin || ["admin", "top_management", "top_management_manager"].includes(profile.role);
    const hotelNames = [config.hotel_id, config.hotel_name].map(x => String(x).toLowerCase());
    const assignment = [profile.assigned_hotel, profile.hotel_id].filter(Boolean).map(x => String(x).toLowerCase());
    if (!executive && !assignment.some(x => hotelNames.includes(x)))
      return json({ error: "This hotel is not assigned to your staff account" }, 403);

    const { data: hotel } = await db.from("hotels").select("id")
      .ilike("name", config.hotel_name).maybeSingle();
    if (!hotel) return json({ error: "Hotel does not have a restaurant reservation feed" }, 404);
    const { data: source } = await db.from("restaurant_webhook_sources")
      .select("hotel_id").eq("hotel_id", hotel.id).eq("is_active", true).maybeSingle();
    if (!source) return json({ error: "Restaurant reservation feed is not configured" }, 409);

    const reservationId = crypto.randomUUID();
    const payload = {
      id: reservationId,
      hotel_id: hotel.id,
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
      raw_payload: { manual: true, booking_mode: mode },
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

// HotelCare In-Suite pilot API: all guest access is device-bound; staff access is JWT + hotel scoped.
// No service-role key or PIN/token hashes are ever returned to a browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-insuite-device",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const send = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const deny = (message = "Not authorized", status = 403) => send({ error: message }, status);
const val = (s: unknown, limit = 500) => typeof s === "string" ? s.trim().slice(0, limit) : "";
const sha = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
};
// Server-side HMAC pepper makes six-digit PIN hashes resistant to offline dictionary attacks.
const pinHash = async (id: string, pin: string) => {
  const secret = Deno.env.get("INSUITE_PIN_PEPPER");
  if (!secret || secret.length < 32) throw Error("INSUITE_PIN_PEPPER must be configured (at least 32 chars)");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id + ":" + pin));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
};
const random = (count = 32) => {
  const bytes = crypto.getRandomValues(new Uint8Array(count));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};
const requestTypes = ["extra_towels", "extra_pillow", "blanket", "amenities", "water", "room_cleaning", "maintenance", "taxi", "call_back"] as const;
const serviceTypes = [...requestTypes, "breakfast", "room_service", "minibar", "gym", "spa", "sauna", "jacuzzi"] as const;
const isService = (v: string) => (requestTypes as readonly string[]).includes(v);
const orderTypes = ["breakfast", "room_service", "minibar"];
const bookingTypes = ["taxi", "gym", "spa", "sauna", "jacuzzi"];
const managers = new Set(["admin", "manager", "top_management", "top_management_manager", "housekeeping_manager", "reception_manager", "supervisor"]);
const admins = new Set(["admin", "manager", "top_management", "top_management_manager"]);
const reception = new Set(["reception", "front_office", "reception_manager"]);
const todayBudapest = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const validUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const cleanContent = (raw: any) => {
  const textFields = ["hotel_name", "welcome", "address", "reception_phone", "guest_wifi_ssid", "guest_wifi_password",
    "breakfast_hours", "restaurant_hours", "checkout_time", "contact_email", "house_rules", "transport_info",
    "facilities_info", "minibar_info", "sustainability_info"];
  const result: Record<string, unknown> = {};
  for (const field of textFields) result[field] = val(raw?.[field], field === "house_rules" ? 2500 : 500);
  for (const field of ["logo_url", "hero_url"]) {
    const v = val(raw?.[field], 900);
    result[field] = !v || /^https:\/\//i.test(v) ? v : "";
  }
  const color = val(raw?.primary_color, 24);
  result.primary_color = /^#[0-9a-f]{6}$/i.test(color) ? color : "#153B57";
  result.services = Object.fromEntries(serviceTypes.map((type) => [type, raw?.services?.[type] === true]));
  return result;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return deny("POST required", 405);
  try {
    const body = await req.json().catch(() => null);
    const action = val(body?.action, 60);
    if (!action) return deny("Action required", 400);
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    if (action === "pair") {
      const code = val(body.code, 40).toUpperCase().replace(/\s/g, "");
      if (!/^[A-F0-9]{24}$/.test(code)) return deny("Invalid or expired pairing code", 404);
      const hash = await sha(code);
      const { data: device } = await db.from("insuite_devices").select("*")
        .eq("pairing_hash", hash).eq("is_active", true)
        .gt("pairing_expires_at", new Date().toISOString()).is("device_token_hash", null).maybeSingle();
      if (!device) return deny("Invalid or expired pairing code", 404);
      const token = random(32);
      const { data: claimed, error } = await db.from("insuite_devices")
        .update({ device_token_hash: await sha(token), pairing_hash: null, pairing_expires_at: null, paired_at: new Date().toISOString() })
        .eq("id", device.id).eq("pairing_hash", hash).is("device_token_hash", null).select("id").maybeSingle();
      if (error || !claimed) return deny("Pairing code already used", 409);
      return send({ token });
    }

    if (action.startsWith("guest-")) {
      const token = val(req.headers.get("x-insuite-device"), 150);
      if (!/^[a-f0-9]{64}$/.test(token)) return deny("Tablet not paired", 401);
      const { data: device } = await db.from("insuite_devices").select("*")
        .eq("device_token_hash", await sha(token)).eq("is_active", true).maybeSingle();
      if (!device) return deny("Tablet disabled or not paired", 401);
      const [{ data: settings }, { data: room }] = await Promise.all([
        db.from("insuite_property_configs").select("published, enabled")
          .eq("organization_slug", device.organization_slug).eq("hotel_id", device.hotel_id).maybeSingle(),
        db.from("rooms").select("id, room_number, hotel, organization_slug").eq("id", device.room_id).maybeSingle(),
      ]);
      if (!settings?.enabled || !room || room.organization_slug !== device.organization_slug)
        return deny("This room tablet is currently unavailable", 403);
      const { data: owningOrg } = await db.from("organizations").select("id")
        .eq("slug", device.organization_slug).maybeSingle();
      if (!owningOrg) return deny("Room organization requires manager review", 403);
      const hotelConfig = await db.from("hotel_configurations").select("hotel_name, hotel_id")
        .eq("hotel_id", device.hotel_id).eq("organization_id", owningOrg.id).maybeSingle();
      if (!hotelConfig.data || ![hotelConfig.data.hotel_id, hotelConfig.data.hotel_name].includes(room.hotel))
        return deny("Room mapping requires manager review", 403);
      const config = settings.published || {};
      // A device identifies a physical room, never an authenticated occupant.
      // Guest operations are enabled only while this exact bound reservation
      // is independently confirmed checked-in by the hotel's PMS data.
      const { data: stay } = device.active_reservation_id
        ? await db.from("reservations")
          .select("id,room_id,status,organization_slug")
          .eq("id", device.active_reservation_id).maybeSingle()
        : { data: null };
      const stayActive = !!stay
        && stay.room_id === room.id && stay.organization_slug === device.organization_slug
        && stay.status === "checked_in";
      if (action === "guest-bootstrap") {
        await db.from("insuite_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);
        return send({ room_number: room.room_number, hotel_id: device.hotel_id, session_epoch: device.session_epoch, config, stay_active: stayActive, paired: true });
      }
      if (action === "guest-state") {
        if (!stayActive) return send({ requests: [], messages: [], orders: [], bookings: [],
          session_epoch: device.session_epoch, stay_active: false });
        const rawSince = Date.parse(val(body.since, 40));
        // Never expose previous guest history. State only includes entries created after THIS page load.
        const since = new Date(Math.max(Date.now() - 6 * 3600_000, Number.isFinite(rawSince) ? rawSince : Date.now())).toISOString();
        const [requests, messages, orders, bookings] = await Promise.all([
          db.from("insuite_service_requests").select("id,client_request_id,request_type,quantity,status,created_at")
            .eq("device_id", device.id).eq("session_epoch", device.session_epoch).gte("created_at", since).order("created_at").limit(50),
          db.from("insuite_messages").select("id,sender,body,created_at")
            .eq("device_id", device.id).eq("session_epoch", device.session_epoch).gte("created_at", since).order("created_at").limit(80),
          db.from("insuite_orders").select("id,kind,currency,quoted_total,status,requested_at,created_at")
            .eq("device_id", device.id).eq("session_epoch", device.session_epoch).gte("created_at", since).order("created_at").limit(50),
          db.from("insuite_booking_requests").select("id,kind,starts_at,party_size,status,staff_note,created_at")
            .eq("device_id", device.id).eq("session_epoch", device.session_epoch).gte("created_at", since).order("created_at").limit(50),
        ]);
        if (requests.error || messages.error || orders.error || bookings.error)
          return deny("Could not load updates", 503);
        return send({ requests: requests.data || [], messages: messages.data || [],
          orders: orders.data || [], bookings: bookings.data || [],
          session_epoch: device.session_epoch, stay_active: true });
      }
      
      if (action === "guest-menu") {
        const { data: items, error } = await db.from("insuite_catalog_items")
          .select("id,kind,name,description,image_url,allergens,price,currency,sort_order")
          .eq("organization_slug", device.organization_slug).eq("hotel_id", device.hotel_id)
          .eq("is_active", true).order("sort_order").order("name").limit(250);
        if (error) return deny("Menu unavailable", 503);
        return send({ items: (items || []).filter((item: any) => config.services?.[item.kind] === true) });
      }
      if (action === "guest-order") {
        if (!stayActive) return deny("Room stay must be verified at reception", 409);
        const kind = val(body.kind, 30);
        const clientId = val(body.client_request_id, 40);
        if (!orderTypes.includes(kind) || config.services?.[kind] !== true
          || !validUuid(clientId) || !Array.isArray(body.items)
          || body.items.length < 1 || body.items.length > 12
          || body.items.some((line: any) => !validUuid(val(line?.id, 40))
            || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 8))
          return deny("Invalid order or unavailable menu", 400);
        const requestedAt = val(body.requested_at, 50);
        if (!requestedAt || Number.isNaN(Date.parse(requestedAt))) return deny("Choose a delivery time", 400);
        const { count } = await db.from("insuite_orders").select("id", { count: "exact", head: true })
          .eq("device_id", device.id).gte("created_at", new Date(Date.now() - 60_000).toISOString());
        if ((count || 0) >= 2) return deny("Please wait before placing another order", 429);
        const { data: order, error } = await db.rpc("insuite_create_order", {
          _device_id: device.id, _session_epoch: device.session_epoch,
          _client_request_id: clientId, _kind: kind,
          _requested_at: requestedAt, _notes: val(body.notes, 400),
          _items: body.items.map((line: any) => ({ id: line.id, quantity: line.quantity })),
        });
        if (error) return deny("Order could not be placed. Verify menu and delivery time.", 409);
        return send({ order }, order?.repeated ? 200 : 201);
      }
      if (action === "guest-booking") {
        if (!stayActive) return deny("Room stay must be verified at reception", 409);
        const kind = val(body.kind, 30);
        const clientId = val(body.client_request_id, 40);
        const when = val(body.starts_at, 50);
        const partySize = Number(body.party_size);
        const millis = Date.parse(when);
        if (!bookingTypes.includes(kind) || config.services?.[kind] !== true
          || !validUuid(clientId) || !Number.isInteger(partySize)
          || partySize < 1 || partySize > 8 || !Number.isFinite(millis)
          || millis < Date.now() - 300_000 || millis > Date.now() + 30 * 86400_000)
          return deny("Invalid booking details", 400);
        const { data: existing } = await db.from("insuite_booking_requests")
          .select("id,status").eq("device_id", device.id).eq("client_request_id", clientId).maybeSingle();
        if (existing) return send({ booking: existing, repeated: true });
        const { count } = await db.from("insuite_booking_requests").select("id", { count: "exact", head: true })
          .eq("device_id", device.id).gte("created_at", new Date(Date.now() - 60_000).toISOString());
        if ((count || 0) >= 2) return deny("Please wait before another booking request", 429);
        const { data: booking, error } = await db.from("insuite_booking_requests").insert({
          organization_slug: device.organization_slug, hotel_id: device.hotel_id,
          room_id: room.id, device_id: device.id, reservation_id: stay.id,
          session_epoch: device.session_epoch, client_request_id: clientId,
          kind, starts_at: new Date(millis).toISOString(), party_size: partySize,
          notes: val(body.notes, 400),
        }).select("id,status").single();
        if (error?.code === "23505") {
          const { data: duplicate } = await db.from("insuite_booking_requests")
            .select("id,status").eq("device_id", device.id).eq("client_request_id", clientId).maybeSingle();
          if (duplicate) return send({ booking: duplicate, repeated: true });
        }
        if (error) throw error;
        return send({ booking }, 201);
      }
      if (action === "guest-request") {
        if (!stayActive) return deny("Room stay must be verified at reception", 409);
        const type = val(body.request_type, 40);
        const quantity = Number(body.quantity);
        const clientId = val(body.client_request_id, 40);
        if (!isService(type) || config.services?.[type] !== true || !validUuid(clientId)
          || !Number.isInteger(quantity) || quantity < 1 || quantity > 8) return deny("Service unavailable", 400);
        const detail = val(body.detail, 400);
        const previous = await db.from("insuite_service_requests").select("id,status")
          .eq("device_id", device.id).eq("client_request_id", clientId).maybeSingle();
        if (previous.data) return send({ request: previous.data, repeated: true });
        const { count } = await db.from("insuite_service_requests").select("id", { count: "exact", head: true })
          .eq("device_id", device.id).gte("created_at", new Date(Date.now() - 60_000).toISOString());
        if ((count || 0) >= 3) return deny("Please wait before sending another request", 429);

        const department = ["maintenance"].includes(type) ? "maintenance"
          : ["taxi", "call_back"].includes(type) ? "reception" : "housekeeping";
        let assignee: string | null = null;
        let workId: string | null = null;
        if (department === "housekeeping") {
          const { data: assignments } = await db.from("room_assignments")
            .select("id, assigned_to, status").eq("room_id", room.id)
            .eq("assignment_date", todayBudapest()).in("status", ["assigned", "in_progress"])
            .order("created_at", { ascending: false }).limit(10);
          for (const assignment of assignments || []) {
            if (!assignment.assigned_to) continue;
            const { data: attendance } = await db.from("staff_attendance")
              .select("status, check_out_time").eq("user_id", assignment.assigned_to)
              .eq("work_date", todayBudapest()).order("created_at", { ascending: false }).limit(1).maybeSingle();
            if (attendance && !attendance.check_out_time && attendance.status === "checked_in") {
              assignee = assignment.assigned_to; workId = assignment.id; break;
            }
          }
        }
        const { data: inserted, error } = await db.from("insuite_service_requests").insert({
          organization_slug: device.organization_slug, hotel_id: device.hotel_id, room_id: room.id,
          device_id: device.id, session_epoch: device.session_epoch, client_request_id: clientId,
          request_type: type, quantity, detail, department, assigned_to: assignee, assigned_room_work_id: workId,
          priority: ["maintenance", "call_back"].includes(type) ? "urgent" : "high",
        }).select("id,status").single();
        if (error) {
          if (error.code === "23505") {
            const { data: existing } = await db.from("insuite_service_requests").select("id,status")
              .eq("device_id", device.id).eq("client_request_id", clientId).maybeSingle();
            if (existing) return send({ request: existing, repeated: true });
          }
          throw error;
        }
        await db.from("insuite_request_events").insert({ request_id: inserted.id, new_status: "submitted" });
        return send({ request: inserted }, 201);
      }
      if (action === "guest-message") {
        if (!stayActive) return deny("Room stay must be verified at reception", 409);
        const message = val(body.message, 1000);
        if (!message || message.length > 1000) return deny("Message required", 400);
        const { count } = await db.from("insuite_messages").select("id", { count: "exact", head: true })
          .eq("device_id", device.id).eq("sender", "guest").gte("created_at", new Date(Date.now() - 60_000).toISOString());
        if ((count || 0) >= 6) return deny("Please wait before sending another message", 429);
        const { data, error } = await db.from("insuite_messages").insert({
          organization_slug: device.organization_slug, hotel_id: device.hotel_id,
          room_id: room.id, device_id: device.id, session_epoch: device.session_epoch,
          sender: "guest", body: message,
        }).select("id,created_at").single();
        if (error) throw error;
        return send({ message: data }, 201);
      }
      if (action === "guest-unlock") {
        if (!device.pin_hash) return deny("Maintenance PIN not set", 403);
        if (device.pin_locked_until && new Date(device.pin_locked_until).getTime() > Date.now())
          return deny("Too many attempts. Ask reception.", 429);
        const pin = val(body.pin, 12);
        if (!/^\d{6}$/.test(pin) || await pinHash(device.id, pin) !== device.pin_hash) {
          const attempts = (device.pin_failed_attempts || 0) + 1;
          await db.from("insuite_devices").update({ pin_failed_attempts: attempts,
            pin_locked_until: attempts >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null })
            .eq("id", device.id);
          return deny("Incorrect staff PIN", 403);
        }
        await db.from("insuite_devices").update({ pin_failed_attempts: 0, pin_locked_until: null }).eq("id", device.id);
        return send({ authorized: true, note: "App maintenance only. OS kiosk lock must be released through your MDM." });
      }
      return deny("Unknown guest action", 404);
    }

    if (!action.startsWith("staff-")) return deny("Unknown action", 404);
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return deny("Sign in required", 401);
    const { data: auth, error: authError } = await db.auth.getUser(jwt);
    if (authError || !auth.user) return deny("Invalid staff session", 401);
    const { data: profile } = await db.from("profiles")
      .select("id, role, organization_slug, assigned_hotel, is_super_admin")
      .eq("id", auth.user.id).maybeSingle();
    if (!profile?.organization_slug) return deny("Staff organization not found", 403);
    const role = String(profile.role || "");
    const manager = managers.has(role) || profile.is_super_admin === true;
    const administrator = admins.has(role) || profile.is_super_admin === true;
    const canReply = manager || reception.has(role);
    const hotelId = val(body.hotel_id, 130);
    if (!hotelId) return deny("Select a hotel first", 400);
    const { data: organization } = await db.from("organizations").select("id")
      .eq("slug", profile.organization_slug).maybeSingle();
    if (!organization) return deny("Organization missing", 403);
    const { data: hotel } = await db.from("hotel_configurations")
      .select("hotel_id, hotel_name, organization_id")
      .eq("hotel_id", hotelId).eq("organization_id", organization.id).maybeSingle();
    if (!hotel) return deny("Hotel not found", 404);
    const scoped = [hotel.hotel_id, hotel.hotel_name].includes(profile.assigned_hotel || "")
      || role === "top_management" || role === "top_management_manager" || profile.is_super_admin === true;
    if (!scoped) return deny("Select your assigned hotel", 403);
    const org = profile.organization_slug;
    const roomQuery = () => db.from("rooms").select("id,room_number,hotel,organization_slug")
      .eq("organization_slug", org).in("hotel", [hotel.hotel_id, hotel.hotel_name]).order("room_number").limit(1000);
    if (action === "staff-dashboard") {
      if (!manager && !canReply && role !== "housekeeping" && role !== "maintenance"
          && role !== "breakfast_staff") return deny("Role not permitted", 403);
      const [cfg, deviceResult, roomResult, requestResult, msgResult, alertResult, catalogResult, orderResult, bookingResult] = await Promise.all([
        db.from("insuite_property_configs").select("draft,published,enabled,updated_at")
          .eq("organization_slug", org).eq("hotel_id", hotelId).maybeSingle(),
        manager ? db.from("insuite_devices").select("id,room_id,label,is_active,paired_at,last_seen_at,created_at")
          .eq("organization_slug", org).eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(300)
          : Promise.resolve({ data: [] }),
        manager ? roomQuery() : Promise.resolve({ data: [] }),
        db.from("insuite_service_requests").select("id,room_id,request_type,quantity,detail,department,status,assigned_to,created_at,updated_at,priority")
          .eq("organization_slug", org).eq("hotel_id", hotelId)
          .gte("created_at", new Date(Date.now() - 3 * 86400_000).toISOString()).order("created_at", { ascending: false }).limit(200),
        canReply ? db.from("insuite_messages").select("id,room_id,device_id,session_epoch,sender,body,created_at")
          .eq("organization_slug", org).eq("hotel_id", hotelId)
          .gte("created_at", new Date(Date.now() - 86400_000).toISOString()).order("created_at", { ascending: false }).limit(200)
          : Promise.resolve({ data: [] }),
        db.from("insuite_staff_alerts").select("id,kind,title,body,room_id,request_id,message_id,created_at,acknowledged_at")
          .eq("organization_slug", org).eq("hotel_id", hotelId)
          .eq("recipient_id", profile.id)
          .is("acknowledged_at", null).order("created_at", { ascending: false }).limit(60),
        administrator ? db.from("insuite_catalog_items")
          .select("id,kind,name,description,image_url,allergens,price,currency,is_active,sort_order")
          .eq("organization_slug", org).eq("hotel_id", hotelId).order("kind").order("sort_order").limit(300)
          : Promise.resolve({ data: [] }),
        (canReply || role === "breakfast_staff") ? db.from("insuite_orders")
          .select("id,room_id,kind,notes,currency,quoted_total,requested_at,status,created_at")
          .eq("organization_slug", org).eq("hotel_id", hotelId)
          .gte("created_at", new Date(Date.now() - 3 * 86400_000).toISOString())
          .order("created_at", { ascending: false }).limit(150)
          : Promise.resolve({ data: [] }),
        canReply ? db.from("insuite_booking_requests")
          .select("id,room_id,kind,starts_at,party_size,notes,staff_note,status,created_at")
          .eq("organization_slug", org).eq("hotel_id", hotelId)
          .gte("created_at", new Date(Date.now() - 3 * 86400_000).toISOString())
          .order("created_at", { ascending: false }).limit(150)
          : Promise.resolve({ data: [] }),
      ]);
      const requests = (requestResult.data || []).filter((r: any) => manager || canReply || r.assigned_to === profile.id);
      // Reception sees only messages in the *currently active* device epoch, never previous guest sessions.
      const deviceEpochs = new Map<string, string>();
      if (canReply && (msgResult.data || []).length) {
        const ids = [...new Set((msgResult.data || []).map((m: any) => m.device_id))];
        const { data: activeDevices } = await db.from("insuite_devices").select("id,session_epoch").in("id", ids);
        for (const d of activeDevices || []) deviceEpochs.set(d.id, d.session_epoch);
      }
      return send({
        hotel_name: hotel.hotel_name,
        config: manager ? cfg.data || { draft: {}, published: {}, enabled: false } : { enabled: !!cfg.data?.enabled },
        rooms: roomResult.data || [], devices: deviceResult.data || [],
        requests, alerts: alertResult.data || [],
        catalog_items: catalogResult.data || [],
        orders: orderResult.data || [], bookings: bookingResult.data || [],
        messages: (msgResult.data || []).filter((m: any) => deviceEpochs.get(m.device_id) === m.session_epoch),
        room_labels: await (async () => {
          const ids = [...new Set([...requests.map((r: any) => r.room_id),
            ...(msgResult.data || []).map((m: any) => m.room_id),
            ...(orderResult.data || []).map((o: any) => o.room_id),
            ...(bookingResult.data || []).map((b: any) => b.room_id)])];
          if (!ids.length) return {};
          const { data } = await db.from("rooms").select("id,room_number").in("id", ids);
          return Object.fromEntries((data || []).map((r: any) => [r.id, r.room_number]));
        })(),
        can_manage: manager, can_configure: administrator, can_reply: canReply,
        can_manage_orders: canReply || role === "breakfast_staff",
      });
    }
    if (action === "staff-ack-alert") {
      const id = Number(body.alert_id);
      if (!Number.isSafeInteger(id) || id <= 0) return deny("Invalid alert", 400);
      const { data: updated } = await db.from("insuite_staff_alerts")
        .update({ acknowledged_at: new Date().toISOString() })
        .eq("id", id).eq("recipient_id", profile.id)
        .eq("organization_slug", org).eq("hotel_id", hotelId)
        .select("id").maybeSingle();
      return updated ? send({ acknowledged: true }) : deny("Alert not found", 404);
    }
    if (action === "staff-save-draft" || action === "staff-publish") {
      if (!administrator) return deny("Administrator permission required");
      if (action === "staff-save-draft") {
        const draft = cleanContent(body.draft);
        const { error } = await db.from("insuite_property_configs").upsert({
          organization_slug: org, hotel_id: hotelId, draft, updated_by: profile.id, updated_at: new Date().toISOString(),
        }, { onConflict: "organization_slug,hotel_id" });
        if (error) throw error;
        return send({ saved: true });
      }
      const { data: current } = await db.from("insuite_property_configs").select("draft")
        .eq("organization_slug", org).eq("hotel_id", hotelId).maybeSingle();
      if (!current) return deny("Save a draft before publishing", 400);
      const published = cleanContent(current.draft);
      if (!published.hotel_name) published.hotel_name = hotel.hotel_name;
      const { error } = await db.from("insuite_property_configs").update({
        published, enabled: true, updated_by: profile.id, updated_at: new Date().toISOString(),
      }).eq("organization_slug", org).eq("hotel_id", hotelId);
      if (error) throw error;
      return send({ published: true });
    }
    if (action === "staff-create-device") {
      if (!administrator) return deny("Administrator permission required");
      const roomId = val(body.room_id, 40);
      if (!validUuid(roomId)) return deny("Select a room", 400);
      const { data: room } = await roomQuery().eq("id", roomId).maybeSingle();
      if (!room) return deny("Room does not belong to this hotel", 403);
      const { data: existing } = await db.from("insuite_devices").select("id").eq("room_id", roomId)
        .eq("is_active", true).maybeSingle();
      if (existing) return deny("Revoke the existing room tablet before creating another", 409);
      const { data: stays, error: stayError } = await db.from("reservations")
        .select("id").eq("room_id", room.id).eq("organization_slug", org)
        .eq("status", "checked_in").limit(2);
      if (stayError) throw stayError;
      const activeStay = (stays || []).length === 1 ? stays[0].id : null;
      const id = crypto.randomUUID();
      const code = random(12).toUpperCase();
      const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
      const { error } = await db.from("insuite_devices").insert({
        id, organization_slug: org, hotel_id: hotelId, room_id: roomId,
        label: val(body.label, 80) || "Room " + room.room_number,
        active_reservation_id: activeStay,
        pairing_hash: await sha(code), pairing_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        pin_hash: await pinHash(id, pin), created_by: profile.id,
      });
      if (error) throw error;
      return send({ code, pin, expires_in_minutes: 15, room_number: room.room_number, device_id: id }, 201);
    }
    if (action === "staff-reconcile-stay") {
      if (!canReply) return deny("Front desk or manager permission required");
      const id = val(body.device_id, 40);
      if (!validUuid(id)) return deny("Invalid device", 400);
      const { data: device } = await db.from("insuite_devices")
        .select("id,room_id,active_reservation_id").eq("id", id).eq("organization_slug", org)
        .eq("hotel_id", hotelId).eq("is_active", true).maybeSingle();
      if (!device) return deny("Device not found", 404);
      const { data: active, error: activeError } = await db.from("reservations")
        .select("id").eq("room_id", device.room_id).eq("organization_slug", org)
        .eq("status", "checked_in").limit(2);
      if (activeError) throw activeError;
      if ((active || []).length !== 1) return deny("Exactly one verified checked-in reservation is required", 409);
      // Only rebind when the reservation changes; idempotent reconciliation does
      // not destroy an in-stay conversation.
      if (device.active_reservation_id === active[0].id) return send({ stay_active: true, unchanged: true });
      const { error } = await db.from("insuite_devices").update({
        active_reservation_id: active[0].id,
        session_epoch: crypto.randomUUID(), session_started_at: new Date().toISOString(),
      }).eq("id", device.id).eq("active_reservation_id", device.active_reservation_id);
      if (error) throw error;
      return send({ stay_active: true, session_rotated: true });
    }
    if (action === "staff-reset-session" || action === "staff-revoke-device") {
      if (!canReply && !administrator) return deny("Front desk or manager permission required");
      const id = val(body.device_id, 40);
      if (!validUuid(id)) return deny("Invalid device", 400);
      if (action === "staff-revoke-device" && !administrator) return deny("Administrator permission required");
      const patch = action === "staff-revoke-device"
        ? { is_active: false, device_token_hash: null, pairing_hash: null,
          active_reservation_id: null, session_epoch: crypto.randomUUID(), session_started_at: new Date().toISOString() }
        : { active_reservation_id: null, session_epoch: crypto.randomUUID(), session_started_at: new Date().toISOString() };
      const { data, error } = await db.from("insuite_devices").update(patch)
        .eq("id", id).eq("organization_slug", org).eq("hotel_id", hotelId).select("id").maybeSingle();
      if (error || !data) return deny("Device not found", 404);
      return send({ updated: true });
    }
    if (action === "staff-update-request") {
      const id = val(body.request_id, 40);
      const status = val(body.status, 40);
      if (!validUuid(id)) return deny("Invalid request", 400);
      const { data: item } = await db.from("insuite_service_requests").select("*").eq("id", id)
        .eq("organization_slug", org).eq("hotel_id", hotelId).maybeSingle();
      if (!item) return deny("Request not found", 404);
      if (!manager && !canReply && item.assigned_to !== profile.id) return deny("Not assigned to you");
      const transitions: Record<string, string[]> = {
        submitted: ["accepted", "unavailable", "cancelled"],
        accepted: ["in_progress", "completed", "unavailable"],
        in_progress: ["completed", "unavailable"],
      };
      if (!(transitions[item.status] || []).includes(status)) return deny("Invalid status transition", 409);
      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (status === "completed") patch.completed_at = new Date().toISOString();
      if (status === "accepted" && !item.assigned_to) patch.assigned_to = profile.id;
      const { data: updated, error } = await db.from("insuite_service_requests").update(patch)
        .eq("id", id).eq("status", item.status).eq("organization_slug", org).eq("hotel_id", hotelId)
        .select("id,status").maybeSingle();
      if (error || !updated) return deny("Request changed. Refresh and retry.", 409);
      await db.from("insuite_request_events").insert({
        request_id: id, old_status: item.status, new_status: status, actor_user_id: profile.id,
      });
      return send({ request: updated });
    }
    if (action === "staff-reply") {
      if (!canReply) return deny("Reception access required");
      const deviceId = val(body.device_id, 40);
      const message = val(body.message, 1000);
      if (!validUuid(deviceId) || !message) return deny("Device and message required", 400);
      const { data: device } = await db.from("insuite_devices")
        .select("id,room_id,session_epoch").eq("id", deviceId)
        .eq("organization_slug", org).eq("hotel_id", hotelId).eq("is_active", true).maybeSingle();
      if (!device) return deny("Device not found", 404);
      const { error } = await db.from("insuite_messages").insert({
        organization_slug: org, hotel_id: hotelId, room_id: device.room_id, device_id: device.id,
        session_epoch: device.session_epoch, sender: "reception", sender_user_id: profile.id, body: message,
      });
      if (error) throw error;
      return send({ sent: true }, 201);
    }
    return deny("Unknown staff action", 404);
  } catch (error) {
    console.error("[insuite-api] failed", error);
    return send({ error: "Service temporarily unavailable" }, 503);
  }
});

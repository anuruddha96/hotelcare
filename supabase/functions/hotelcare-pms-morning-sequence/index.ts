// One real PMS refresh per property/account per Budapest working day. The cron
// invokes this endpoint once per ten minutes; no browser session is needed.
// Existing independent checkout polling, revenue and release preflights stay intact.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const RD_ORDER = ["memories-budapest", "mika-downtown", "ottofiori", "gozsdu-court"];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
function equal(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function localClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)?.value || "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")), minute: Number(part("minute")),
  };
}
function orderedHotels(configs: Array<{ hotel_id: string }>) {
  return [...configs].sort((a, b) => {
    const ai = RD_ORDER.indexOf(a.hotel_id), bi = RD_ORDER.indexOf(b.hotel_id);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.hotel_id.localeCompare(b.hotel_id);
  });
}
async function callEdge(url: string, serviceKey: string, name: string, payload: Record<string, unknown>, secret?: string) {
  const response = await fetch(`${url}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`, ...(secret ? { "x-worker-secret": secret } : {}) },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(90000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false || body.error || body.result?.ok === false) {
    throw new Error(`${name}: ${body.error || body.result?.error || `HTTP ${response.status}`}`);
  }
  return body;
}

// The existing server room preflight refreshes Previo's physical room statuses.
// The manual PMS button also refreshes checkout/daily classification; do this
// only after a fresh authoritative date-specific reservation snapshot passes.
async function syncStandardHotel(admin: any, url: string, service: string, secret: string, hotelId: string, date: string) {
  await callEdge(url, service, "housekeeping-pms-preflight-worker", { mode: "sync_hotel", hotel_id: hotelId }, secret);
  const overview = await callEdge(url, service, "previo-sync-daily-overview", {
    hotelId, fromDate: date, days: 2,
  });
  if (overview.supported !== true || overview.rowsInserted <= 0) {
    throw new Error(`${hotelId}: authoritative Previo reservations were not refreshed`);
  }
  const { data: configurations, error: configError } = await admin.from("pms_configurations")
    .select("id").eq("hotel_id", hotelId).eq("is_active", true).eq("sync_enabled", true).eq("pms_type", "previo");
  if (configError || configurations?.length !== 1) throw new Error(`${hotelId}: PMS configuration is missing or ambiguous`);
  const [mappingResponse, snapshotsResponse] = await Promise.all([
    admin.from("pms_room_mappings").select("hotelcare_room_id,pms_room_name")
      .eq("pms_config_id", configurations[0].id).eq("is_active", true),
    admin.from("daily_overview_snapshots")
      .select("id,room_label,status,arrival_date,departure_date,pax,captured_at")
      .eq("hotel_id", hotelId).eq("business_date", date).eq("source", "previo"),
  ]);
  if (mappingResponse.error || snapshotsResponse.error) throw new Error(`${hotelId}: mapped reservation lookup failed`);
  const mappings = mappingResponse.data || [], snapshots = snapshotsResponse.data || [];
  if (!mappings.length || !snapshots.length) throw new Error(`${hotelId}: room mappings or reservations are empty`);
  const byName = new Map<string, any>();
  for (const row of snapshots) {
    const key = String(row.room_label || "").trim().toLowerCase();
    if (!key || byName.has(key)) throw new Error(`${hotelId}: duplicate or blank PMS reservation room label`);
    byName.set(key, row);
  }
  const pairs: Array<{ id: string; snapshot: any }> = [];
  const usedRoomIds = new Set<string>();
  const usedSnapshots = new Set<string>();
  for (const mapping of mappings) {
    const roomId = String(mapping.hotelcare_room_id || "");
    const snapshot = byName.get(String(mapping.pms_room_name || "").trim().toLowerCase());
    if (!roomId || !snapshot || usedRoomIds.has(roomId) || usedSnapshots.has(String(snapshot.id))) {
      throw new Error(`${hotelId}: incomplete or ambiguous mapping; no checkout/daily classifications changed`);
    }
    if (snapshot.status !== "departing" && snapshot.status !== "ongoing") {
      throw new Error(`${hotelId}: reservation state is not authoritative; classifications unchanged`);
    }
    usedRoomIds.add(roomId); usedSnapshots.add(String(snapshot.id));
    pairs.push({ id: roomId, snapshot });
  }
  const { data: rooms, error: roomsError } = await admin.from("rooms")
    .select("id,pms_metadata,is_checkout_room,guest_count,guest_nights_stayed")
    .in("id", [...usedRoomIds]);
  if (roomsError || rooms?.length !== pairs.length) throw new Error(`${hotelId}: mapped HotelCare inventory does not match Previo`);
  const roomById = new Map(rooms.map((r: any) => [String(r.id), r]));
  const syncedAt = new Date().toISOString();
  let checkout = 0, daily = 0, overridden = 0;
  for (const pair of pairs) {
    const room: any = roomById.get(pair.id);
    const s = pair.snapshot;
    const old = room.pms_metadata && typeof room.pms_metadata === "object" ? room.pms_metadata : {};
    const metadata: Record<string, any> = { ...old };
    const previousDate = String(old.lastPmsRefreshDate || old.pmsSyncDate || "").slice(0, 10);
    if (previousDate && previousDate < date) {
      for (const field of ["manual_checkout", "manual_daily", "manual_no_show", "manual_checkout_at", "manual_daily_at", "manual_moved_at", "manual_checkout_by", "manual_daily_by", "manual_moved_by"]) delete metadata[field];
    }
    const overrideDate = String(old.manual_moved_at || old.manual_checkout_changed_at || old.manual_daily_changed_at || old.manual_checkout_at || old.manual_daily_at || "").slice(0, 10);
    const manual = overrideDate === date;
    const departing = s.status === "departing" && s.departure_date === date;
    const effectiveCheckout = manual && (old.manual_daily === true || old.manual_checkout === false)
      ? false : manual && old.manual_checkout === true ? true : departing;
    if (manual) overridden++;
    if (effectiveCheckout) checkout++; else daily++;
    metadata.pmsSyncDate = date;
    metadata.lastPmsRefreshDate = date;
    metadata.scheduledDepartureToday = departing;
    metadata.scheduledDepartureTomorrow = s.departure_date > date && s.departure_date <= new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    metadata.arrivalDate = s.arrival_date;
    metadata.departureDate = s.departure_date;
    metadata.occupiedToday = true;
    metadata.stayThroughToday = !departing;
    metadata.lastServerMorningSyncAt = syncedAt;
    metadata.lastServerMorningSyncSource = "portfolio_morning_10min";
    const start = s.arrival_date ? Date.parse(`${s.arrival_date}T12:00:00Z`) : NaN;
    const night = Number.isFinite(start) ? Math.max(1, Math.floor((Date.parse(`${date}T12:00:00Z`) - start) / 86400000) + 1) : room.guest_nights_stayed;
    const { error: updateError } = await admin.from("rooms").update({
      is_checkout_room: effectiveCheckout, guest_count: s.pax ?? room.guest_count,
      guest_nights_stayed: night, pms_metadata: metadata, updated_at: syncedAt,
    }).eq("id", pair.id);
    if (updateError) throw new Error(`${hotelId}: mapped room update failed: ${updateError.message}`);
  }
  const unmatchedSnapshots = snapshots.length - usedSnapshots.size;
  const status = unmatchedSnapshots ? "partial" : "success";
  const { error: historyError } = await admin.from("pms_sync_history").insert({
    hotel_id: hotelId, sync_type: "rooms_refresh", direction: "from_previo", sync_status: status,
    error_message: unmatchedSnapshots ? `${unmatchedSnapshots} Previo reservation room(s) lack an active mapped physical room` : null,
    data: { trigger: "portfolio_morning_10min", business_date: date,
      rooms_updated: pairs.length, checkout_rooms: checkout, daily_rooms: daily,
      manager_overrides_preserved: overridden, unmapped_reservation_rooms: unmatchedSnapshots },
  });
  if (historyError) throw new Error(`${hotelId}: PMS history write failed: ${historyError.message}`);
  return { rooms_updated: pairs.length, checkout_rooms: checkout, daily_rooms: daily,
    unmapped_reservation_rooms: unmatchedSnapshots, status };
}

Deno.serve(async req => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const expected = await admin.rpc("get_housekeeping_release_worker_secret");
  if (expected.error || !equal(req.headers.get("x-worker-secret") || "", String(expected.data || ""))) {
    return json({ error: "Unauthorized" }, 401);
  }
  const clock = localClock();
  if (clock.hour < 6 || clock.hour > 8 || clock.minute % 10 !== 0) {
    return json({ ok: true, skipped: true, reason: "outside_Budapest_10min_window" });
  }
  const [configsRes, accountsRes] = await Promise.all([
    admin.from("pms_configurations").select("hotel_id").eq("pms_type", "previo")
      .eq("is_active", true).eq("sync_enabled", true),
    admin.from("pms_accounts").select("id,label,hotel_id,organization_slug")
      .eq("organization_slug", "slnt").eq("pms_type", "previo")
      .eq("is_active", true).eq("sync_paused", false).order("label", { ascending: true }),
  ]);
  if (configsRes.error || accountsRes.error) return json({ ok: false, error: "Unable to load PMS synchronization schedule" }, 500);
  const accounts = accountsRes.data || [];
  const accountHotels = new Set(accounts.map((a: any) => a.hotel_id));
  const hotels = orderedHotels((configsRes.data || []).filter((c: any) => !accountHotels.has(c.hotel_id)));
  const targets = [
    ...hotels.map(h => ({ type: "hotel", key: `hotel:${h.hotel_id}`, label: h.hotel_id, hotel_id: h.hotel_id, account_id: null as string | null })),
    ...accounts.map((a: any) => ({ type: "account", key: `account:${a.id}`, label: a.label, hotel_id: a.hotel_id, account_id: String(a.id) })),
  ];
  const slot = (clock.hour - 6) * 6 + Math.floor(clock.minute / 10);
  const target = targets[slot];
  if (!target) return json({ ok: true, skipped: true, reason: "no_active_target_for_slot", slot });
  const startedAt = new Date().toISOString();
  const claimed = await admin.from("pms_morning_sync_runs").insert({
    business_date: clock.date, target_key: target.key, slot, status: "running", started_at: startedAt,
  });
  if (claimed.error?.code === "23505") return json({ ok: true, skipped: true, reason: "already_attempted_today", target: target.label });
  if (claimed.error) return json({ ok: false, error: `PMS run claim failed: ${claimed.error.message}` }, 500);
  try {
    const result = target.type === "hotel"
      ? await syncStandardHotel(admin, url, service, String(expected.data), target.hotel_id, clock.date)
      : await callEdge(url, service, "slnt-pms-morning-sync", { mode: "sync_account", account_id: target.account_id }, String(expected.data));
    const status = (result as any).status === "partial" ? "partial" : "success";
    const updated = await admin.from("pms_morning_sync_runs").update({
      status, completed_at: new Date().toISOString(), result,
    }).eq("business_date", clock.date).eq("target_key", target.key);
    if (updated.error) throw new Error(`PMS run audit failed: ${updated.error.message}`);
    return json({ ok: true, business_date: clock.date, slot, target: target.label, status, result });
  } catch (error) {
    const failure = message(error);
    console.error(`[PMS morning sequence] ${target.key}: ${failure}`);
    await admin.from("pms_morning_sync_runs").update({
      status: "failed", completed_at: new Date().toISOString(), error_message: failure,
    }).eq("business_date", clock.date).eq("target_key", target.key);
    await admin.from("pms_sync_history").insert({
      hotel_id: target.hotel_id, sync_type: "rooms_refresh", direction: "from_previo",
      sync_status: "failed", error_message: failure,
      data: { trigger: "portfolio_morning_10min", business_date: clock.date,
        account_id: target.account_id, scheduled_slot: slot },
    });
    return json({ ok: false, target: target.label, error: failure }, 500);
  }
});

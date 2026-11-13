// channex-ari-worker — publishes HotelCare ARI changes to Channex (staging).
//
// Actions
//   drain      (cron, x-worker-secret)  drain the outbox for every publishing hotel
//   push_now   (user)                    drain one hotel right after a save in the UI
//   full_sync  (manager)                 500 days: 1 availability call + 1 restrictions call
//   bootstrap  (manager)                 create/find the Channex property, room types, rate plans; save mapping
//   set_flags  (manager)                 ari_enabled / bookings_enabled / kill_switch
//   status     (user)                    key configured, connection, pending counts
//
// The outbox is filled by database triggers on pms_ari_availability / pms_ari_rates,
// which change only when a user saves in HotelCare or a reservation changes.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  authoriseUser, channexApiKey, channexRequest, corsHeaders, isWorkerCall, json, logSync, serviceClient, todayIn,
} from "../_shared/channexClient.ts";
import {
  type AriKind, type OutboxRow, REQUESTS_PER_MINUTE_BUDGET, addDays, backoffSeconds, classifyStatus, coalesceOutbox,
  compressCells, dateSpan, extractTaskIds, extractWarnings, fullSyncCells,
} from "../_shared/channexAri.ts";

const FULL_SYNC_DAYS = 500;
const PATH: Record<AriKind, string> = { availability: "/availability", restrictions: "/restrictions" };
const MAP_KIND: Record<AriKind, string> = { availability: "room_type", restrictions: "rate_plan" };

type Connection = {
  hotel_id: string; channex_property_id: string | null; timezone: string | null; currency: string | null;
  ari_enabled: boolean; bookings_enabled: boolean; kill_switch: boolean; environment: string; organization_slug: string;
};

async function mappingFor(db: SupabaseClient, hotelId: string, kind: AriKind): Promise<Map<string, string>> {
  const { data, error } = await db.from("channex_mappings").select("local_id, channex_id").eq("hotel_id", hotelId).eq("kind", MAP_KIND[kind]);
  if (error) throw new Error("mapping: " + error.message);
  return new Map((data || []).map((m: any) => [String(m.local_id), String(m.channex_id)]));
}

async function requestsLastMinute(db: SupabaseClient, hotelId: string, kind: AriKind): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db.from("channex_sync_log").select("id", { count: "exact", head: true })
    .eq("hotel_id", hotelId).eq("kind", kind).not("http_status", "is", null).gte("created_at", since);
  return count || 0;
}

async function publishingConnections(db: SupabaseClient, hotelId?: string): Promise<Connection[]> {
  let q = db.from("channex_connections").select("*").eq("ari_enabled", true).eq("kill_switch", false).not("channex_property_id", "is", null);
  if (hotelId) q = q.eq("hotel_id", hotelId);
  const { data, error } = await q;
  if (error) throw new Error("connections: " + error.message);
  const out: Connection[] = [];
  for (const c of (data || []) as Connection[]) {
    const { data: native } = await db.rpc("pms_ari_native_hotel", { _hotel_id: c.hotel_id });
    if (native && c.environment === "staging") out.push(c);
  }
  return out;
}

async function drainKind(db: SupabaseClient, conn: Connection, kind: AriKind, source: string, userId?: string) {
  if (await requestsLastMinute(db, conn.hotel_id, kind) >= REQUESTS_PER_MINUTE_BUDGET) {
    return { kind, deferred: "rate_limit_budget" };
  }
  const { data: claimed, error } = await db.rpc("channex_claim_ari", { _hotel_id: conn.hotel_id, _kind: kind, _limit: 20000 });
  if (error) throw new Error("claim: " + error.message);
  const rows = (claimed || []) as Array<OutboxRow & { batch_id: string; attempts: number }>;
  if (!rows.length) return { kind, sent: 0 };
  const batchId = rows[0].batch_id;
  const attempts = Math.max(...rows.map((r) => r.attempts));

  const map = await mappingFor(db, conn.hotel_id, kind);
  let cells;
  try {
    cells = coalesceOutbox(rows).get(kind) || [];
  } catch (e) {
    await db.from("channex_ari_outbox").update({ status: "failed", error: String((e as Error).message) }).eq("batch_id", batchId);
    return { kind, failed: rows.length, error: String((e as Error).message) };
  }
  const { values, unmapped } = compressCells(kind, cells, conn.channex_property_id!, (id) => map.get(id));
  if (unmapped.length) {
    await db.from("channex_ari_outbox").update({ status: "failed", error: "No Channex mapping for this room type / rate plan" })
      .eq("batch_id", batchId).in("target_id", unmapped);
  }
  if (!values.length) return { kind, sent: 0, unmapped: unmapped.length };

  const body = { values };
  const res = await channexRequest("POST", PATH[kind], body);
  const cls = classifyStatus(res.status);
  const span = dateSpan(values);
  const taskIds = extractTaskIds(res.body);
  const warnings = extractWarnings(res.body);
  const logId = await logSync(db, {
    hotel_id: conn.hotel_id, kind, request_type: "delta", ok: cls === "ok", http_status: res.status,
    task_ids: taskIds, warnings: warnings.length ? warnings : null, value_count: values.length, outbox_count: rows.length,
    date_from: span.from, date_to: span.to, request_body: body, response_body: res.body,
    error: cls === "ok" ? null : (res.error || JSON.stringify(res.body?.errors || res.body || {}).slice(0, 1000)),
    duration_ms: res.durationMs, trigger_source: source, triggered_by: userId || null,
  });

  const mapped = rows.filter((r) => !unmapped.includes(r.target_id)).map((r) => r.id);
  if (cls === "ok") {
    await db.from("channex_ari_outbox").update({ status: "sent", sent_at: new Date().toISOString(), sync_log_id: logId, error: null }).in("id", mapped);
  } else if (cls === "retry") {
    const next = new Date(Date.now() + backoffSeconds(attempts, res.retryAfter) * 1000).toISOString();
    await db.from("channex_ari_outbox").update({ status: "pending", next_attempt_at: next, sync_log_id: logId, error: `HTTP ${res.status ?? "network"}; retrying` }).in("id", mapped);
  } else {
    await db.from("channex_ari_outbox").update({ status: "failed", sync_log_id: logId, error: `HTTP ${res.status}: rejected by Channex` }).in("id", mapped);
  }
  return { kind, status: res.status, result: cls, values: values.length, outbox: rows.length, task_ids: taskIds, warnings: warnings.length };
}

async function drainHotel(db: SupabaseClient, conn: Connection, source: string, userId?: string) {
  const results = [];
  for (const kind of ["availability", "restrictions"] as AriKind[]) {
    try { results.push(await drainKind(db, conn, kind, source, userId)); }
    catch (e) { results.push({ kind, error: String((e as Error).message) }); }
  }
  return { hotel_id: conn.hotel_id, results };
}

async function selectAll(db: SupabaseClient, table: string, select: string, apply: (q: any) => any) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await apply(db.from(table).select(select)).range(from, from + 999);
    if (error) throw new Error(table + ": " + error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function fullSync(db: SupabaseClient, conn: Connection, userId: string) {
  for (const kind of ["availability", "restrictions"] as AriKind[]) {
    if (await requestsLastMinute(db, conn.hotel_id, kind) >= REQUESTS_PER_MINUTE_BUDGET) {
      throw Object.assign(new Error("Channex rate limit budget reached; try again in a minute"), { status: 429 });
    }
  }
  const tz = conn.timezone || "Europe/Budapest";
  const from = todayIn(tz);
  const to = addDays(from, FULL_SYNC_DAYS - 1);

  // The full sync replaces whatever deltas are still queued.
  await db.from("channex_ari_outbox").update({ status: "superseded" }).eq("hotel_id", conn.hotel_id).eq("status", "pending");
  const { error: refreshErr } = await db.rpc("pms_ari_refresh_availability", { _hotel_id: conn.hotel_id, _from: from, _to: addDays(to, 1) });
  if (refreshErr) throw new Error("availability refresh: " + refreshErr.message);

  const roomMap = await mappingFor(db, conn.hotel_id, "availability");
  const planMap = await mappingFor(db, conn.hotel_id, "restrictions");
  const { data: roomTypes } = await db.from("room_types").select("id, num_rooms").eq("hotel_id", conn.hotel_id).eq("is_sellable", true);
  const { data: plans } = await db.from("rate_plans").select("id, base_rate, min_stay, max_stay").eq("hotel_id", conn.hotel_id).eq("is_active", true);
  const rooms = (roomTypes || []).filter((r: any) => roomMap.has(r.id));
  const ratePlans = (plans || []).filter((p: any) => planMap.has(p.id));
  if (!rooms.length || !ratePlans.length) throw new Error("Map room types and rate plans first (Bootstrap)");

  const avRows = await selectAll(db, "pms_ari_availability", "room_type_id, date, availability",
    (q) => q.eq("hotel_id", conn.hotel_id).gte("date", from).lte("date", to));
  const rateRows = await selectAll(db, "pms_ari_rates",
    "rate_plan_id, date, rate, min_stay_arrival, min_stay_through, max_stay, closed_to_arrival, closed_to_departure, stop_sell",
    (q) => q.eq("hotel_id", conn.hotel_id).gte("date", from).lte("date", to));

  const avStored = new Map(avRows.map((r: any) => [`${r.room_type_id}|${r.date}`, { availability: r.availability }]));
  const rateStored = new Map(rateRows.map((r: any) => {
    const { rate_plan_id, date, ...rest } = r;
    return [`${rate_plan_id}|${date}`, rest];
  }));
  const roomById = new Map(rooms.map((r: any) => [r.id, r]));
  const planById = new Map(ratePlans.map((p: any) => [p.id, p]));

  const avCells = fullSyncCells("availability", rooms.map((r: any) => r.id), from, FULL_SYNC_DAYS, avStored,
    (id) => ({ availability: Number(roomById.get(id)?.num_rooms || 0) }));
  const rateCells = fullSyncCells("restrictions", ratePlans.map((p: any) => p.id), from, FULL_SYNC_DAYS, rateStored, (id) => {
    const p: any = planById.get(id);
    return {
      rate: Number(p.base_rate || 0), min_stay_arrival: Math.max(1, Number(p.min_stay || 1)), min_stay_through: 1,
      max_stay: Number(p.max_stay || 0), closed_to_arrival: false, closed_to_departure: false, stop_sell: false,
    };
  });

  const out: any[] = [];
  for (const [kind, cells, map] of [["availability", avCells, roomMap], ["restrictions", rateCells, planMap]] as const) {
    const { values } = compressCells(kind, cells, conn.channex_property_id!, (id) => map.get(id));
    const body = { values };
    const res = await channexRequest("POST", PATH[kind], body);
    const cls = classifyStatus(res.status);
    const taskIds = extractTaskIds(res.body);
    const warnings = extractWarnings(res.body);
    await logSync(db, {
      hotel_id: conn.hotel_id, kind, request_type: "full_sync", ok: cls === "ok", http_status: res.status, task_ids: taskIds,
      warnings: warnings.length ? warnings : null, value_count: values.length, date_from: from, date_to: to,
      request_body: body, response_body: res.body, duration_ms: res.durationMs, trigger_source: "ui", triggered_by: userId,
      error: cls === "ok" ? null : (res.error || JSON.stringify(res.body?.errors || res.body || {}).slice(0, 1000)),
    });
    out.push({ kind, status: res.status, result: cls, values: values.length, task_ids: taskIds, warnings: warnings.length });
  }
  if (out.every((r) => r.result === "ok")) {
    await db.from("channex_connections").update({ last_full_sync_at: new Date().toISOString(), last_error: null }).eq("hotel_id", conn.hotel_id);
  }
  return { from, to, days: FULL_SYNC_DAYS, calls: out };
}

// ---------------------------------------------------------------------------
// Bootstrap: Channex property "Test Property - HotelCare" + room types + rate plans
// ---------------------------------------------------------------------------
const id = (x: any) => String(x?.id || x?.attributes?.id || "");
function must(res: Awaited<ReturnType<typeof channexRequest>>, what: string) {
  if (classifyStatus(res.status) !== "ok") {
    throw new Error(`${what}: HTTP ${res.status ?? "network"} ${res.error || JSON.stringify(res.body?.errors || res.body || {}).slice(0, 400)}`);
  }
  return res.body;
}

async function bootstrap(db: SupabaseClient, hotelId: string, userId: string) {
  const { data: hc } = await db.from("hotel_configurations").select("hotel_name, settings").eq("hotel_id", hotelId).single();
  const title = "Test Property - HotelCare";
  const currency = String(hc?.settings?.currency || "USD");
  const timezone = "Europe/Budapest";
  const steps: string[] = [];

  const { data: existingConn } = await db.from("channex_connections").select("*").eq("hotel_id", hotelId).maybeSingle();
  let propertyId: string | null = existingConn?.channex_property_id || null;
  if (propertyId) {
    const got = must(await channexRequest("GET", `/properties/${propertyId}`), "read property");
    const a = got?.data?.attributes || {};
    if (!a.property_type || !a.timezone) {
      must(await channexRequest("PUT", `/properties/${propertyId}`, { property: { property_type: "hotel", timezone } }), "update property type/timezone");
      steps.push("property type and timezone set");
    }
  } else {
    const list = must(await channexRequest("GET", "/properties?pagination[limit]=100"), "list properties");
    const matches = (list?.data || []).filter((p: any) => String(p.attributes?.title || "").trim() === title);
    if (matches.length > 1) throw new Error("More than one Channex property is called " + title + "; resolve in Channex first");
    if (matches.length === 1) {
      propertyId = id(matches[0]);
      const a = matches[0].attributes || {};
      if (!a.property_type || !a.timezone) {
        must(await channexRequest("PUT", `/properties/${propertyId}`, { property: { property_type: "hotel", timezone } }), "update property type/timezone");
      }
      steps.push("existing property found");
    } else {
      const created = must(await channexRequest("POST", "/properties", {
        property: { title, currency, timezone, property_type: "hotel", country: "HU", city: "Budapest", address: "Test address 1", zip_code: "1077" },
      }), "create property");
      propertyId = id(created?.data);
      steps.push("property created");
    }
    const { error } = await db.from("channex_connections").insert({
      hotel_id: hotelId, organization_slug: "channex", environment: "staging", mode: "off", kill_switch: true,
      is_sandbox_hotel: true, channex_property_id: propertyId, currency, timezone, primary_occupancy: 2,
      property_type: "hotel", ntak_reporting_path: "unconfirmed", ari_enabled: false, bookings_enabled: false,
    });
    if (error) throw new Error("save connection: " + error.message);
  }
  if (!propertyId) throw new Error("Channex property id missing");

  const { data: roomTypes } = await db.from("room_types").select("id, name, num_rooms").eq("hotel_id", hotelId).eq("is_sellable", true).order("sort_order");
  const remoteRooms = must(await channexRequest("GET", `/room_types?filter[property_id]=${propertyId}&pagination[limit]=100`), "list room types")?.data || [];
  const roomMap = new Map<string, string>();
  for (const rt of roomTypes || []) {
    const matches = remoteRooms.filter((r: any) => String(r.attributes?.title || "").trim() === rt.name);
    if (matches.length > 1) throw new Error("Duplicate Channex room type " + rt.name);
    let remoteId = matches[0] ? id(matches[0]) : "";
    if (!remoteId) {
      const created = must(await channexRequest("POST", "/room_types", {
        room_type: { property_id: propertyId, title: rt.name, count_of_rooms: rt.num_rooms, occ_adults: 2, occ_children: 0, occ_infants: 0, default_occupancy: 2, room_kind: "room" },
      }), "create room type " + rt.name);
      remoteId = id(created?.data);
      steps.push("room type created: " + rt.name);
    }
    roomMap.set(rt.id, remoteId);
    await db.from("channex_mappings").upsert({ hotel_id: hotelId, kind: "room_type", local_id: rt.id, channex_id: remoteId, channex_title: rt.name, settings: { count_of_rooms: rt.num_rooms } }, { onConflict: "hotel_id,kind,local_id" });
  }

  const { data: plans } = await db.from("rate_plans").select("id, name, room_type_id, base_rate, currency").eq("hotel_id", hotelId).eq("is_active", true).order("sort_order");
  const remotePlans = must(await channexRequest("GET", `/rate_plans?filter[property_id]=${propertyId}&pagination[limit]=100`), "list rate plans")?.data || [];
  for (const p of plans || []) {
    const roomRemote = roomMap.get(p.room_type_id);
    if (!roomRemote) throw new Error("Rate plan " + p.name + " has no mapped room type");
    const matches = remotePlans.filter((r: any) => String(r.attributes?.title || "").trim() === p.name &&
      String(r.attributes?.room_type_id || r.relationships?.room_type?.data?.id || "") === roomRemote);
    let remoteId = matches[0] ? id(matches[0]) : "";
    if (!remoteId) {
      const created = must(await channexRequest("POST", "/rate_plans", {
        rate_plan: { property_id: propertyId, room_type_id: roomRemote, title: p.name, currency: p.currency || currency,
                     sell_mode: "per_room", rate_mode: "manual", options: [{ occupancy: 2, is_primary: true, rate: 0 }] },
      }), "create rate plan " + p.name);
      remoteId = id(created?.data);
      steps.push("rate plan created: " + p.name);
    }
    await db.from("channex_mappings").upsert({ hotel_id: hotelId, kind: "rate_plan", local_id: p.id, channex_id: remoteId, channex_title: p.name, settings: { room_type_id: roomRemote } }, { onConflict: "hotel_id,kind,local_id" });
  }

  await logSync(db, { hotel_id: hotelId, kind: "property", request_type: "bootstrap", ok: true, http_status: 200,
    response_body: { property_id: propertyId, steps }, trigger_source: "ui", triggered_by: userId });
  return { property_id: propertyId, steps, room_types: roomMap.size, rate_plans: (plans || []).length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const db = serviceClient();
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "drain") {
      if (!(await isWorkerCall(req, db))) return json({ ok: false, error: "Unauthorized" }, 401);
      const conns = await publishingConnections(db);
      const results = [];
      for (const c of conns) results.push(await drainHotel(db, c, String(body?.trigger || "cron")));
      return json({ ok: true, hotels: results.length, results });
    }

    const hotelId = String(body?.hotel_id || "");
    if (!hotelId) return json({ ok: false, error: "hotel_id required" }, 400);
    const manager = ["full_sync", "bootstrap", "set_flags"].includes(action);
    const caller = await authoriseUser(req, db, hotelId, manager);

    if (action === "status") {
      const { data: conn } = await db.from("channex_connections").select("*").eq("hotel_id", hotelId).maybeSingle();
      const { count: pending } = await db.from("channex_ari_outbox").select("id", { count: "exact", head: true }).eq("hotel_id", hotelId).in("status", ["pending", "sending"]);
      const { count: failed } = await db.from("channex_ari_outbox").select("id", { count: "exact", head: true }).eq("hotel_id", hotelId).eq("status", "failed");
      return json({ ok: true, key_configured: Boolean(channexApiKey()), environment: "staging", connection: conn, pending: pending || 0, failed: failed || 0 });
    }
    if (action === "bootstrap") return json({ ok: true, ...(await bootstrap(db, hotelId, caller.userId)) });
    if (action === "set_flags") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const k of ["ari_enabled", "bookings_enabled", "kill_switch"]) if (typeof body?.[k] === "boolean") patch[k] = body[k];
      const { data, error } = await db.from("channex_connections").update(patch).eq("hotel_id", hotelId).select("*").maybeSingle();
      if (error || !data) throw new Error("Connection not found; run Bootstrap first");
      return json({ ok: true, connection: data });
    }

    const [conn] = await publishingConnections(db, hotelId);
    if (!conn) return json({ ok: false, error: "Channex publishing is off for this hotel (enable ARI and release the kill switch)" }, 409);
    if (action === "push_now") return json({ ok: true, ...(await drainHotel(db, conn, "ui", caller.userId)) });
    if (action === "full_sync") return json({ ok: true, ...(await fullSync(db, conn, caller.userId)) });
    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (e) {
    const status = Number((e as any)?.status) || 500;
    return json({ ok: false, error: String((e as Error)?.message || e).slice(0, 800) }, status);
  }
});

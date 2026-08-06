// Revenue Management sync (Previo XML API) — single hotel, on demand.
//
// Pulls three things for the requested horizon and stores them so the Revenue
// section can render accurate numbers without any file uploads:
//   1. getObjectKinds   -> room types + physical room counts (mapped into room_types)
//   2. getRates         -> base ("Alap") rate plan price per room type / date / occupancy, EUR
//   3. searchReservations -> one row per booked room-night incl. booking creation time
// From (3) we derive a daily snapshot (rooms sold, occupancy, revenue, ADR,
// new bookings created today) so net pickup can be compared day over day.
//
// This function is completely independent of the housekeeping PMS sync.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { callPrevioXml, loadPrevioCredentials } from "../_shared/previoCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CANCELLED_STATUS = 7;
const NOSHOW_STATUS = 8;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Budapest-local calendar date (YYYY-MM-DD). */
function budapestToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000,
  );
}

function grab(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** Previo returns "YYYY-MM-DD HH:MM:SS" in hotel-local (Budapest) time. */
function pmsTimestampToIso(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  // Budapest is UTC+1 / UTC+2. Resolve the offset for that exact date.
  const naive = Date.parse(`${m[1]}T${m[2]}Z`);
  const probe = new Date(naive);
  const tzName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Budapest",
    timeZoneName: "shortOffset",
  }).formatToParts(probe).find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const off = /GMT([+-]\d+)/.exec(tzName);
  const hours = off ? parseInt(off[1], 10) : 1;
  return new Date(naive - hours * 3600000).toISOString();
}

interface RoomTypeInfo {
  obkId: string;
  name: string;
  numRooms: number;
  maxOccupancy: number;
  order: number;
}

function parseObjectKinds(xml: string): RoomTypeInfo[] {
  return blocks(xml, "objectKind").map((b, i) => ({
    obkId: grab(b, "obkId") ?? "",
    name: grab(b, "name") ?? "Room type",
    numRooms: blocks(b, "object").length,
    maxOccupancy: parseInt(grab(b, "numOfBeds") ?? "2", 10) +
      parseInt(grab(b, "numOfExtraBeds") ?? "0", 10),
    order: parseInt(grab(b, "order") ?? String(i), 10),
  })).filter((r) => r.obkId);
}

interface RateRow {
  stay_date: string;
  obk_id: string;
  rate_plan_id: string;
  occupancy: number;
  price: number;
  currency: string;
  min_stay: number | null;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
}

/**
 * getRates returns <ratePlan><season from..to><objectKind><rate occupancy/price>.
 * Season ranges are inclusive of `from` and exclusive of `to` is NOT guaranteed —
 * Previo emits contiguous blocks, so we expand [from, to) and always cover `from`.
 */
function parseRates(xml: string, ratePlanFilter: string | null): RateRow[] {
  const rows: RateRow[] = [];
  for (const rp of blocks(xml, "ratePlan")) {
    const prlId = grab(rp, "prlId") ?? "base";
    if (ratePlanFilter && prlId !== ratePlanFilter) continue;
    for (const season of blocks(rp, "season")) {
      const from = (grab(season, "from") ?? "").slice(0, 10);
      const to = (grab(season, "to") ?? from).slice(0, 10);
      if (!from) continue;
      const span = Math.max(1, daysBetween(from, to) || 1);
      for (const ok of blocks(season, "objectKind")) {
        const obkId = grab(ok, "obkId");
        if (!obkId) continue;
        const minStay = grab(ok, "minStay");
        const cta = (grab(ok, "closeToArrival") ?? "false") === "true";
        const ctd = (grab(ok, "closeToDeparture") ?? "false") === "true";
        for (const rate of blocks(ok, "rate")) {
          const occupancy = parseInt(grab(rate, "occupancy") ?? "0", 10);
          const price = parseFloat(grab(rate, "price") ?? "");
          const currency = grab(rate, "code") ?? "EUR";
          if (!occupancy || !Number.isFinite(price)) continue;
          for (let i = 0; i < span; i++) {
            rows.push({
              stay_date: addDays(from, i),
              obk_id: obkId,
              rate_plan_id: prlId,
              occupancy,
              price,
              currency,
              min_stay: minStay ? parseInt(minStay, 10) : null,
              closed_to_arrival: cta,
              closed_to_departure: ctd,
            });
          }
        }
      }
    }
  }
  return rows;
}

interface Night {
  stay_date: string;
  cancelled_at?: string | null;
  res_id: string;
  /** Distinguishes each room of a multi-room reservation. */
  room_key: string;
  obk_id: string | null;
  obj_id: string | null;
  status_id: number;
  created_at_pms: string | null;
  nightly_price_eur: number | null;
  guests: number;
  /** Booking channel / OTA name when Previo exposes it. */
  source_name: string | null;
  total_price_eur: number | null;
  stay_from: string;
  stay_to: string;
}

function parseReservationNights(xml: string, from: string, to: string): Night[] {
  const out: Night[] = [];
  /** How many room items each reservation already produced in this document. */
  const seenRooms = new Map<string, number>();
  for (const r of blocks(xml, "reservation")) {
    const resId = grab(r, "resId");
    if (!resId) continue;
    const statusId = parseInt(grab(r, "statusId") ?? "0", 10);
    const isCancelled = statusId === CANCELLED_STATUS || statusId === NOSHOW_STATUS;

    const term = grab(r, "term") ?? "";
    const stayFrom = (grab(term, "from") ?? "").slice(0, 10);
    const stayTo = (grab(term, "to") ?? "").slice(0, 10);
    if (!stayFrom || !stayTo) continue;

    const nights = Math.max(1, daysBetween(stayFrom, stayTo));
    const total = parseFloat(grab(r, "price") ?? "");
    const nightly = Number.isFinite(total) ? Math.round((total / nights) * 100) / 100 : null;
    const guests = blocks(r, "guest").length || 1;
    const obkId = grab(grab(r, "objectKind") ?? "", "obkId") ?? grab(r, "obkId");
    const objId = grab(grab(r, "object") ?? "", "objId") ?? grab(r, "objId");
    const created = pmsTimestampToIso(grab(r, "created"));
    // Previo names the booking channel differently per endpoint version.
    const sourceRaw =
      grab(r, "sourceName") ?? grab(r, "source") ?? grab(r, "partner") ??
      grab(r, "channel") ?? grab(r, "marketCode") ?? null;
    const source = sourceRaw ? sourceRaw.replace(/<[^>]*>/g, "").trim() || null : null;
    // Previo exposes the cancellation moment under a few different tags
    // depending on the endpoint version; fall back to the last change.
    const cancelledAt = isCancelled
      ? pmsTimestampToIso(
          grab(r, "dateCanc") ?? grab(r, "canceled") ?? grab(r, "cancelled") ??
          grab(r, "changed") ?? grab(r, "modified") ?? grab(r, "created"),
        )
      : null;

    // A multi-room booking arrives as several reservation items sharing one
    // resId. Give each room item its own key (object / room type plus an
    // occurrence counter for identical rooms) so no room overwrites another —
    // otherwise rooms sold, and therefore occupancy, is undercounted.
    const baseKey = objId ?? obkId ?? "room";
    const seen = seenRooms.get(`${resId}|${baseKey}`) ?? 0;
    seenRooms.set(`${resId}|${baseKey}`, seen + 1);
    const roomKey = seen === 0 ? baseKey : `${baseKey}#${seen}`;

    for (let i = 0; i < nights; i++) {
      const stayDate = addDays(stayFrom, i);
      if (stayDate < from || stayDate > to) continue;
      out.push({
        stay_date: stayDate,
        res_id: resId,
        room_key: roomKey,
        obk_id: obkId,
        obj_id: objId,
        status_id: statusId,
        created_at_pms: created,
        cancelled_at: cancelledAt,
        nightly_price_eur: nightly,
        guests,
        source_name: source,
        total_price_eur: Number.isFinite(total) ? total : null,
        stay_from: stayFrom,
        stay_to: stayTo,
      });
    }
  }
  return out;
}

async function chunkedCall(
  method: string,
  creds: unknown,
  hotId: string,
  from: string,
  to: string,
  chunkDays: number,
): Promise<{ xml: string[]; errors: string[] }> {
  const xml: string[] = [];
  const errors: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    const end = addDays(cursor, chunkDays - 1) > to ? to : addDays(cursor, chunkDays - 1);
    const res = await callPrevioXml({
      method,
      creds: creds as never,
      pmsHotelId: hotId,
      extraXml: `<term><from>${cursor}</from><to>${end}</to></term>`,
    });
    if (res.ok) xml.push(res.text);
    else errors.push(`${method} ${cursor}..${end}: [${res.status}] ${res.errorMessage ?? "failed"}`);
    cursor = addDays(end, 1);
  }
  return { xml, errors };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(SUPABASE_URL, SERVICE);

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const hotelId: string = body.hotelId || "";
  const horizonDays: number = Math.min(400, Math.max(30, Number(body.horizonDays) || 190));
  if (!hotelId) return json({ error: "hotelId is required" }, 400);

  // ---- auth: signed-in user with access to this hotel, or service role ----
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  let actorId: string | null = null;
  let actorName: string | null = null;
  const probeToken = Deno.env.get("PREVIO_PROBE_TOKEN") || "";
  const probeAuthorized = !!probeToken && (req.headers.get("x-probe-token") || "") === probeToken;
  if (token !== SERVICE && !probeAuthorized) {
    if (!token) return json({ error: "Unauthorized" }, 401);
    const anon = createClient(SUPABASE_URL, ANON);
    const { data: userRes } = await anon.auth.getUser(token);
    if (!userRes?.user) return json({ error: "Unauthorized" }, 401);
    actorId = userRes.user.id;
    const { data: profile } = await service
      .from("profiles")
      .select("role, full_name, assigned_hotel, organization_slug")
      .eq("id", actorId)
      .maybeSingle();
    const role = (profile as { role?: string } | null)?.role ?? "";
    actorName = (profile as { full_name?: string } | null)?.full_name ?? null;
    const allowedRoles = ["admin", "top_management", "top_management_manager", "manager", "hotel_manager"];
    if (!allowedRoles.includes(role)) return json({ error: "Forbidden" }, 403);
  }

  const started = Date.now();
  const today = budapestToday();
  const from = today;
  const to = addDays(today, horizonDays);

  const { data: cfg } = await service
    .from("pms_configurations")
    .select("pms_hotel_id, credentials_secret_name")
    .eq("hotel_id", hotelId)
    .eq("pms_type", "previo")
    .maybeSingle();
  if (!cfg) return json({ error: `No Previo configuration for ${hotelId}` }, 404);

  const conf = cfg as { pms_hotel_id?: string; credentials_secret_name?: string };

  // Organization slug lives on hotel_configurations -> organizations.
  const { data: hotelCfg } = await service
    .from("hotel_configurations")
    .select("organization_id")
    .eq("hotel_id", hotelId)
    .maybeSingle();
  let orgSlug: string = body.orgSlug || "";
  const orgId = (hotelCfg as { organization_id?: string } | null)?.organization_id;
  if (orgId) {
    const { data: org } = await service.from("organizations").select("slug").eq("id", orgId).maybeSingle();
    orgSlug = (org as { slug?: string } | null)?.slug || orgSlug;
  }
  if (!orgSlug) return json({ error: `No organization found for ${hotelId}` }, 404);
  const hotId = String(conf.pms_hotel_id || "");
  let creds;
  try {
    creds = loadPrevioCredentials(conf.credentials_secret_name);
  } catch (e) {
    return json({ error: `Previo credentials unavailable: ${String(e)}` }, 500);
  }

  const errors: string[] = [];

  // ---------- 1. room types ----------
  let roomTypes: RoomTypeInfo[] = [];
  const kindsRes = await callPrevioXml({ method: "getObjectKinds", creds, pmsHotelId: hotId, extraXml: "" });
  if (kindsRes.ok) roomTypes = parseObjectKinds(kindsRes.text);
  else errors.push(`getObjectKinds: [${kindsRes.status}] ${kindsRes.errorMessage ?? "failed"}`);

  const nameByObk = new Map(roomTypes.map((r) => [r.obkId, r.name]));

  // Previo mixes three things in getObjectKinds: physical unit groups
  // ("Room (cap 2) — 15 units"), sellable rate-plan room types covering the
  // SAME physical rooms, and non-room products (breakfast, coffee, tickets).
  // Summing everything triples the denominator and craters occupancy.
  const NON_ROOM = /breakfast|coffee|dessert|reggeli|parking|transfer|ticket|látógat|latogat|spa|massage|extra/i;
  const UNIT_GROUP = /^Room \(cap/i;
  const isNonRoom = (name: string) => NON_ROOM.test(name);
  const hasUnitGroups = roomTypes.some((r) => UNIT_GROUP.test(r.name));
  const countsForInventory = (name: string) =>
    !isNonRoom(name) && (hasUnitGroups ? UNIT_GROUP.test(name) : true);
  const totalRoomsFromKinds = roomTypes
    .filter((r) => countsForInventory(r.name))
    .reduce((s, r) => s + r.numRooms, 0);
  const { data: revSettings } = await service
    .from("hotel_revenue_settings")
    .select("sellable_rooms")
    .eq("hotel_id", hotelId)
    .maybeSingle();
  const totalRooms =
    Number((revSettings as { sellable_rooms?: number } | null)?.sellable_rooms || 0) ||
    totalRoomsFromKinds;

  if (roomTypes.length && orgSlug) {
    const { data: existing } = await service
      .from("room_types")
      .select("id, pms_room_id, name, num_rooms")
      .eq("hotel_id", hotelId);
    const byPms = new Map(
      ((existing ?? []) as Array<{ id: string; pms_room_id: string | null }>)
        .filter((r) => r.pms_room_id)
        .map((r) => [String(r.pms_room_id), r]),
    );
    const hasReference = ((existing ?? []) as Array<{ id: string }>).length > 0;
    for (const rt of roomTypes) {
      const match = byPms.get(rt.obkId);
      if (match) {
        // Keep manual pricing/derivation edits, refresh only PMS-owned facts.
        await service.from("room_types")
          .update({
            name: rt.name,
            num_rooms: rt.numRooms,
            sort_order: rt.order,
            is_sellable: !isNonRoom(rt.name),
            counts_toward_inventory: countsForInventory(rt.name),
          })
          .eq("id", match.id);
      } else {
        await service.from("room_types").insert({
          hotel_id: hotelId,
          organization_slug: orgSlug,
          name: rt.name,
          pms_room_id: rt.obkId,
          num_rooms: rt.numRooms,
          is_sellable: !isNonRoom(rt.name),
          counts_toward_inventory: countsForInventory(rt.name),
          is_reference: !hasReference && rt.order === Math.min(...roomTypes.map((r) => r.order)),
          derivation_mode: "absolute",
          derivation_value: 0,
          base_price_eur: 100,
          min_price_eur: 50,
          max_price_eur: 500,
          sort_order: rt.order,
        });
      }
    }
  }

  // ---------- 2. rates ----------
  const ratesCall = await chunkedCall("getRates", creds, hotId, from, to, 45);
  errors.push(...ratesCall.errors);
  const rateRows = ratesCall.xml.flatMap((x) => parseRates(x, null));
  const dedupedRates = new Map<string, RateRow>();
  for (const r of rateRows) {
    if (r.stay_date < from || r.stay_date > to) continue;
    dedupedRates.set(`${r.stay_date}|${r.obk_id}|${r.rate_plan_id}|${r.occupancy}`, r);
  }
  const ratePayload = Array.from(dedupedRates.values()).map((r) => ({
    hotel_id: hotelId,
    organization_slug: orgSlug,
    stay_date: r.stay_date,
    obk_id: r.obk_id,
    room_type_name: nameByObk.get(r.obk_id) ?? null,
    rate_plan_id: r.rate_plan_id,
    occupancy: r.occupancy,
    price: r.price,
    currency: r.currency,
    min_stay: r.min_stay,
    closed_to_arrival: r.closed_to_arrival,
    closed_to_departure: r.closed_to_departure,
    source: "previo",
    captured_at: new Date().toISOString(),
  }));
  for (let i = 0; i < ratePayload.length; i += 500) {
    const { error } = await service
      .from("revenue_room_type_rates")
      .upsert(ratePayload.slice(i, i + 500), {
        onConflict: "hotel_id,stay_date,obk_id,rate_plan_id,occupancy",
      });
    if (error) errors.push(`rates upsert: ${error.message}`);
  }

  // ---------- 3. reservations -> booking nights ----------
  const resCall = await chunkedCall("searchReservations", creds, hotId, from, to, 31);
  errors.push(...resCall.errors);
  const nightMap = new Map<string, Night>();
  for (const xml of resCall.xml) {
    for (const n of parseReservationNights(xml, from, to)) {
      // Keyed per room item, so a two-room booking keeps both rooms.
      nightMap.set(`${n.res_id}|${n.room_key}|${n.stay_date}`, n);
    }
  }
  const allNights = Array.from(nightMap.values());
  const nights = allNights.filter((n) => !n.cancelled_at);
  const cancelledNights = allNights.filter((n) => !!n.cancelled_at);

  if (!resCall.errors.length) {
    // Full replace for the horizon so cancellations disappear immediately.
    const { error: delErr } = await service
      .from("revenue_booking_nights")
      .delete()
      .eq("hotel_id", hotelId)
      .gte("stay_date", from)
      .lte("stay_date", to);
    if (delErr) errors.push(`booking nights delete: ${delErr.message}`);

    const nightPayload = nights.map((n) => ({
      hotel_id: hotelId,
      organization_slug: orgSlug,
      stay_date: n.stay_date,
      res_id: n.res_id,
      room_key: n.room_key,
      obk_id: n.obk_id,
      room_type_name: n.obk_id ? nameByObk.get(n.obk_id) ?? null : null,
      obj_id: n.obj_id,
      status_id: n.status_id,
      created_at_pms: n.created_at_pms,
      nightly_price_eur: n.nightly_price_eur,
      guests: n.guests,
      source_name: n.source_name,
      total_price_eur: n.total_price_eur,
      stay_from: n.stay_from,
      stay_to: n.stay_to,
      captured_at: new Date().toISOString(),
    }));
    // The horizon was just deleted and the payload is already de-duplicated
    // per room-night, so a plain insert is both correct and immune to
    // ON CONFLICT inference problems.
    for (let i = 0; i < nightPayload.length; i += 500) {
      const { error } = await service
        .from("revenue_booking_nights")
        .insert(nightPayload.slice(i, i + 500));
      if (error) errors.push(`booking nights insert: ${error.message}`);
    }
  }

  // ---------- 3b. cancelled nights (make pickup able to go negative) ----------
  if (!resCall.errors.length) {
    const { error: delCancelErr } = await service
      .from("revenue_cancelled_nights")
      .delete()
      .eq("hotel_id", hotelId)
      .gte("stay_date", from)
      .lte("stay_date", to);
    if (delCancelErr) errors.push(`cancelled nights delete: ${delCancelErr.message}`);

    const cancelPayload = cancelledNights.map((n) => ({
      hotel_id: hotelId,
      organization_slug: orgSlug,
      stay_date: n.stay_date,
      res_id: n.res_id,
      room_key: n.room_key,
      obk_id: n.obk_id,
      obj_id: n.obj_id,
      room_type_name: n.obk_id ? nameByObk.get(n.obk_id) ?? null : null,
      nightly_price_eur: n.nightly_price_eur,
      cancelled_at: n.cancelled_at,
      status_id: n.status_id,
      created_at_pms: n.created_at_pms,
      guests: n.guests,
      total_price_eur: n.total_price_eur,
      stay_from: n.stay_from,
      stay_to: n.stay_to,
      source_name: n.source_name,
    }));
    for (let i = 0; i < cancelPayload.length; i += 500) {
      const { error } = await service
        .from("revenue_cancelled_nights")
        .insert(cancelPayload.slice(i, i + 500));
      if (error) errors.push(`cancelled nights insert: ${error.message}`);
    }
  }

  // ---------- 4. daily snapshot ----------
  const perDate = new Map<string, { sold: number; revenue: number; created: number }>();
  for (let i = 0; i <= horizonDays; i++) {
    perDate.set(addDays(from, i), { sold: 0, revenue: 0, created: 0 });
  }
  for (const n of nights) {
    const slot = perDate.get(n.stay_date);
    if (!slot) continue;
    slot.sold += 1;
    slot.revenue += n.nightly_price_eur ?? 0;
    if (n.created_at_pms && n.created_at_pms.slice(0, 10) === today) slot.created += 1;
  }
  const snapshots = Array.from(perDate.entries()).map(([stayDate, v]) => ({
    hotel_id: hotelId,
    organization_slug: orgSlug,
    stay_date: stayDate,
    captured_date: today,
    rooms_sold: v.sold,
    rooms_available: totalRooms,
    occupancy_pct: totalRooms ? Math.round((v.sold / totalRooms) * 1000) / 10 : 0,
    revenue_eur: Math.round(v.revenue * 100) / 100,
    adr_eur: v.sold ? Math.round((v.revenue / v.sold) * 100) / 100 : null,
    new_bookings: v.created,
    captured_at: new Date().toISOString(),
  }));
  if (!resCall.errors.length) {
    for (let i = 0; i < snapshots.length; i += 500) {
      const { error } = await service
        .from("revenue_daily_snapshots")
        .upsert(snapshots.slice(i, i + 500), { onConflict: "hotel_id,stay_date,captured_date" });
      if (error) errors.push(`snapshot upsert: ${error.message}`);
    }
  }

  const summary = {
    hotelId,
    orgSlug,
    from,
    to,
    roomTypes: roomTypes.length,
    totalRooms,
    rates: ratePayload.length,
    bookingNights: nights.length,
    snapshots: snapshots.length,
    durationMs: Date.now() - started,
    errors,
  };

  await service.from("pms_sync_history").insert({
    sync_type: "revenue_sync",
    direction: "inbound",
    hotel_id: hotelId,
    sync_status: errors.length ? "partial" : "success",
    error_message: errors.length ? errors.slice(0, 5).join(" | ") : null,
    data: summary,
    synced_by_user_id: actorId,
    synced_by_name: actorName,
  });

  return json({ success: errors.length === 0, ...summary });
});

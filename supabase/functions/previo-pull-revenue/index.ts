// Live Revenue sync from Previo (XML searchReservations + REST /rooms).
// HARD-GATED to hotel_id = 'previo-test'. Other hotels return
// { ok:true, supported:false } so the LiveSync UI degrades gracefully.
//
// Derives, for the next N days (default 365):
//   - occupancy_snapshots  (rooms_sold + occupancy_pct per stay_date)
//   - pickup_snapshots     (bookings_current = arrivals per stay_date)
//   - breakfast_roster     (one row per occupied room per stay_date)
//
// Snapshot tables are append-only history elsewhere; for live data we
// keep ONE current snapshot per (hotel, snapshot_label='previo-live')
// by deleting prior previo-live rows for the affected date range first.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth, safePrevioJson } from "../_shared/previoAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_HOTEL_ID = "previo-test";
const SNAPSHOT_LABEL = "previo-live";

interface PrevioRoom {
  roomId: number;
  name: string;
  capacity: number;
}

interface ParsedReservation {
  objId: number | null;
  roomName: string;
  arrivalDate: string;   // YYYY-MM-DD
  departureDate: string; // YYYY-MM-DD (exclusive)
  statusId: number;
  guestsCount: number;
  note: string | null;
  priceEur: number | null;       // total reservation price in EUR (null if missing)
  nights: number;                // nights count for ADR derivation
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(base: string, n: number): string {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anon = createClient(SUPABASE_URL, ANON);
    const { data: userRes } = await anon.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const service = createClient(SUPABASE_URL, SERVICE);

    const body = await req.json().catch(() => ({}));
    const hotelId: string = body.hotelId || "";
    const days: number = Math.min(Math.max(Number(body.days) || 365, 30), 540);

    if (!hotelId) {
      return new Response(JSON.stringify({ error: "hotelId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Hard gate: only previo-test gets live revenue. Other hotels gracefully
    // degrade so the UI shows "live not available, use XLSX upload".
    if (hotelId !== ALLOWED_HOTEL_ID) {
      return new Response(
        JSON.stringify({
          ok: true,
          supported: false,
          message:
            "Live Previo revenue sync is enabled only for the Previo Test hotel — use XLSX upload for this hotel.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: profile } = await service
      .from("profiles")
      .select("role, assigned_hotel, organization_slug")
      .eq("id", userRes.user.id)
      .maybeSingle();
    const isAdmin = profile?.role === "admin" || profile?.role === "top_management";
    if (!isAdmin && profile?.assigned_hotel !== hotelId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const orgSlug = profile?.organization_slug || "rdhotels";

    const { data: cfg } = await service
      .from("pms_configurations")
      .select("id, hotel_id, pms_hotel_id, credentials_secret_name, is_active")
      .eq("hotel_id", hotelId)
      .eq("pms_type", "previo")
      .maybeSingle();
    if (!cfg || !cfg.is_active) {
      return new Response(JSON.stringify({ ok: false, error: `No active Previo config for ${hotelId}` }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- 1. Total room inventory (denominator for occupancy) ----
    const { response: roomsResp } = await fetchPrevioWithAuth({
      credentialsSecretName: cfg.credentials_secret_name,
      path: "/rest/rooms",
      pmsHotelId: String(cfg.pms_hotel_id || ""),
    });
    if (!roomsResp.ok) {
      const t = await roomsResp.text();
      return new Response(
        JSON.stringify({ ok: false, error: `Previo /rest/rooms ${roomsResp.status}: ${t.slice(0, 200)}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const previoRooms = await safePrevioJson<PrevioRoom[]>(roomsResp, { path: "/rest/rooms" });
    const totalRooms = previoRooms.length;

    // ---- 2. Pull reservations for [today, today+days) via XML API ----
    const today = isoDate(new Date());
    const horizon = addDays(today, days);

    const rawSecret = String(Deno.env.get(cfg.credentials_secret_name || "") || "").trim();
    const stripQuotes = (s: string) =>
      (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))
        ? s.slice(1, -1).trim() : s;
    let xmlUser = ""; let xmlPass = "";
    const cleaned = stripQuotes(rawSecret);
    try {
      const j = JSON.parse(cleaned);
      if (j && typeof j === "object") {
        xmlUser = stripQuotes(String(j.username ?? j.user ?? j.login ?? j.email ?? ""));
        xmlPass = stripQuotes(String(j.password ?? j.pass ?? j.secret ?? ""));
      }
    } catch { /* fall through */ }
    if (!xmlUser || !xmlPass) {
      const m = cleaned.match(/^([^:\s]+):(.+)$/);
      if (m) { xmlUser = stripQuotes(m[1]); xmlPass = stripQuotes(m[2]); }
    }
    if (!xmlUser || !xmlPass) {
      return new Response(JSON.stringify({ ok: false, error: "Could not parse Previo credentials" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const xmlBody = `<?xml version="1.0"?>
<request>
<login>${xmlUser}</login>
<password>${xmlPass}</password>
<hotId>${String(cfg.pms_hotel_id || "")}</hotId>
<term><from>${today}</from><to>${horizon}</to></term>
</request>`;
    const xmlResp = await fetch("https://api.previo.cz/x1/hotel/searchReservations/", {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=UTF-8" },
      body: xmlBody,
    });
    const xmlText = await xmlResp.text();
    if (!xmlResp.ok || /<error>/i.test(xmlText)) {
      const errMatch = xmlText.match(/<message>([^<]*)<\/message>/i);
      return new Response(
        JSON.stringify({ ok: false, error: `Previo XML ${xmlResp.status}: ${errMatch?.[1] || xmlText.slice(0, 200)}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const reservations: ParsedReservation[] = [];
    const blocks = xmlText.match(/<reservation>[\s\S]*?<\/reservation>/g) || [];
    const grab = (s: string, tag: string) => {
      const m = s.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m ? m[1].trim() : "";
    };
    for (const block of blocks) {
      const fromStr = grab(block, "from");
      const toStr = grab(block, "to");
      if (!fromStr || !toStr) continue;
      const statusId = parseInt(grab(block, "statusId") || "0", 10);
      if (statusId === 7 || statusId === 8) continue; // skip cancelled / no-show
      const objMatch = block.match(/<object>[\s\S]*?<objId>(\d+)<\/objId>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/object>/);
      const objId = objMatch ? parseInt(objMatch[1], 10) : null;
      const roomName = objMatch ? objMatch[2].trim() : "";
      if (!roomName && !objId) continue;
      const guestsCount = (block.match(/<guest>/g) || []).length;
      const noteMatch = block.match(/<note>([^<]*)<\/note>/);
      reservations.push({
        objId,
        roomName,
        arrivalDate: fromStr.slice(0, 10),
        departureDate: toStr.slice(0, 10),
        statusId,
        guestsCount: guestsCount || 1,
        note: noteMatch ? (noteMatch[1].trim() || null) : null,
      });
    }

    // ---- 3. Aggregate per stay_date ----
    interface DayAgg {
      rooms_sold: number;
      arrivals: number;
      occupied: ParsedReservation[];
    }
    const dayMap = new Map<string, DayAgg>();
    for (let i = 0; i < days; i++) {
      dayMap.set(addDays(today, i), { rooms_sold: 0, arrivals: 0, occupied: [] });
    }
    for (const r of reservations) {
      // Occupancy: for each day d in [arrival, departure)
      let cursor = r.arrivalDate < today ? today : r.arrivalDate;
      while (cursor < r.departureDate && cursor < horizon) {
        const agg = dayMap.get(cursor);
        if (agg) {
          agg.rooms_sold += 1;
          agg.occupied.push(r);
        }
        cursor = addDays(cursor, 1);
      }
      // Arrivals (pickup)
      if (r.arrivalDate >= today && r.arrivalDate < horizon) {
        const agg = dayMap.get(r.arrivalDate);
        if (agg) agg.arrivals += 1;
      }
    }

    // ---- 4. Persist (delete prior previo-live rows in range, then insert) ----
    const capturedAt = new Date().toISOString();

    await service.from("occupancy_snapshots")
      .delete()
      .eq("hotel_id", hotelId)
      .eq("snapshot_label", SNAPSHOT_LABEL)
      .gte("stay_date", today)
      .lt("stay_date", horizon);

    await service.from("pickup_snapshots")
      .delete()
      .eq("hotel_id", hotelId)
      .eq("snapshot_label", SNAPSHOT_LABEL)
      .gte("stay_date", today)
      .lt("stay_date", horizon);

    const occRows: any[] = [];
    const pickupRows: any[] = [];
    for (const [stay_date, agg] of dayMap) {
      const occupancy_pct = totalRooms > 0 ? Math.round((agg.rooms_sold * 1000) / totalRooms) / 10 : 0;
      occRows.push({
        hotel_id: hotelId,
        organization_slug: orgSlug,
        stay_date,
        occupancy_pct,
        rooms_sold: agg.rooms_sold,
        captured_at: capturedAt,
        snapshot_label: SNAPSHOT_LABEL,
        uploaded_by: userRes.user.id,
        source: "previo",
      });
      pickupRows.push({
        hotel_id: hotelId,
        organization_slug: orgSlug,
        stay_date,
        bookings_current: agg.arrivals,
        bookings_last_year: null,
        delta: null,
        captured_at: capturedAt,
        uploaded_by: userRes.user.id,
        source: "previo",
        snapshot_label: SNAPSHOT_LABEL,
      });
    }

    // Chunk inserts to stay under PostgREST limits.
    const chunk = <T>(arr: T[], n: number) => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    };

    let occInserted = 0;
    for (const part of chunk(occRows, 200)) {
      const { error } = await service.from("occupancy_snapshots").insert(part);
      if (!error) occInserted += part.length;
      else console.error("occupancy_snapshots insert error:", error.message);
    }
    let pickupInserted = 0;
    for (const part of chunk(pickupRows, 200)) {
      const { error } = await service.from("pickup_snapshots").insert(part);
      if (!error) pickupInserted += part.length;
      else console.error("pickup_snapshots insert error:", error.message);
    }

    // ---- 5. Breakfast roster (upsert per room/day for /bb) ----
    const breakfastRows: any[] = [];
    for (const [stay_date, agg] of dayMap) {
      for (const res of agg.occupied) {
        if (!res.roomName) continue;
        breakfastRows.push({
          hotel_id: hotelId,
          organization_slug: orgSlug,
          stay_date,
          room_number: res.roomName,
          guest_names: [],
          pax: res.guestsCount,
          breakfast_count: res.guestsCount,
          lunch_count: 0,
          dinner_count: 0,
          all_inclusive_count: 0,
          source_notes: res.note,
          uploaded_by: userRes.user.id,
          uploaded_at: capturedAt,
        });
      }
    }
    let breakfastUpserted = 0;
    for (const part of chunk(breakfastRows, 200)) {
      const { error } = await service.from("breakfast_roster").upsert(part, {
        onConflict: "hotel_id,stay_date,room_number",
      });
      if (!error) breakfastUpserted += part.length;
      else console.error("breakfast_roster upsert error:", error.message);
    }

    // ---- 5b. Seed Rooms Setup + Daily Rates + sensible defaults (idempotent) ----
    let roomTypesSeeded = 0;
    let dailyRatesSeeded = 0;

    const { count: existingRoomTypes } = await service
      .from("room_types").select("id", { count: "exact", head: true })
      .eq("hotel_id", hotelId);

    if ((existingRoomTypes ?? 0) === 0 && previoRooms.length > 0) {
      const byCapacity = new Map<number, PrevioRoom[]>();
      for (const r of previoRooms) {
        const arr = byCapacity.get(r.capacity) ?? [];
        arr.push(r);
        byCapacity.set(r.capacity, arr);
      }
      const sorted = Array.from(byCapacity.entries()).sort((a, b) => b[1].length - a[1].length);
      const rtRows = sorted.map(([cap, rooms], idx) => ({
        hotel_id: hotelId,
        organization_slug: orgSlug,
        name: `Room (cap ${cap}) — ${rooms.length} units`,
        pms_room_id: rooms.map((r) => r.roomId).join(","),
        num_rooms: rooms.length,
        is_reference: idx === 0,
        derivation_mode: "absolute",
        derivation_value: 0,
        base_price_eur: 120,
        min_price_eur: 70,
        max_price_eur: 350,
        sort_order: idx,
      }));
      const { error: rtErr } = await service.from("room_types").insert(rtRows);
      if (!rtErr) roomTypesSeeded = rtRows.length;
      else console.error("room_types seed error:", rtErr.message);
    }

    const { data: existingRates } = await service
      .from("daily_rates").select("stay_date")
      .eq("hotel_id", hotelId).gte("stay_date", today).lt("stay_date", horizon).limit(2000);
    const existingRateDates = new Set((existingRates ?? []).map((r: any) => r.stay_date));

    const { data: refRoomRows } = await service
      .from("room_types").select("base_price_eur,is_reference")
      .eq("hotel_id", hotelId);
    const refRoom = (refRoomRows ?? []).find((r: any) => r.is_reference) ?? (refRoomRows ?? [])[0];
    const seedRate = Number(refRoom?.base_price_eur) || 120;

    const rateRows: any[] = [];
    for (let i = 0; i < days; i++) {
      const stay_date = addDays(today, i);
      if (existingRateDates.has(stay_date)) continue;
      rateRows.push({
        hotel_id: hotelId, organization_slug: orgSlug, stay_date,
        rate_eur: seedRate, source: "manual",
      });
    }
    for (const part of chunk(rateRows, 300)) {
      const { error } = await service.from("daily_rates").insert(part);
      if (!error) dailyRatesSeeded += part.length;
      else console.error("daily_rates seed error:", error.message);
    }

    // Default settings + dow/monthly/occupancy targets (insert if missing).
    await service.from("hotel_revenue_settings").upsert(
      { hotel_id: hotelId, organization_slug: orgSlug },
      { onConflict: "hotel_id", ignoreDuplicates: true },
    );
    const dowDefaults = [
      { dow: 0, percent: 0 }, { dow: 1, percent: 0 }, { dow: 2, percent: 0 },
      { dow: 3, percent: 0 }, { dow: 4, percent: 10 }, { dow: 5, percent: 15 },
      { dow: 6, percent: 5 },
    ].map((x) => ({ ...x, hotel_id: hotelId, organization_slug: orgSlug }));
    await service.from("dow_adjustments").upsert(dowDefaults, { onConflict: "hotel_id,dow", ignoreDuplicates: true });
    const monthDefaults = Array.from({ length: 12 }, (_, i) => ({
      hotel_id: hotelId, organization_slug: orgSlug, month: i + 1, percent: 0,
    }));
    await service.from("monthly_adjustments").upsert(monthDefaults, { onConflict: "hotel_id,month", ignoreDuplicates: true });
    const occDefaults = Array.from({ length: 12 }, (_, i) => ({
      hotel_id: hotelId, organization_slug: orgSlug, month: i + 1, target_pct: 75,
    }));
    await service.from("occupancy_targets").upsert(occDefaults, { onConflict: "hotel_id,month", ignoreDuplicates: true });

    // ---- 6. Log PMS sync history (revenue) ----
    try {
      await service.from("pms_sync_history").insert({
        hotel_id: hotelId,
        sync_type: "revenue_live",
        direction: "from_previo",
        sync_status: "success",
        changed_by: userRes.user.id,
        data: {
          days, totalRooms, reservations: reservations.length,
          occInserted, pickupInserted, breakfastUpserted,
          roomTypesSeeded, dailyRatesSeeded,
        },
      } as any);
    } catch { /* non-fatal */ }

    // ---- 7. Chain autopilot tick (best-effort, non-blocking error) ----
    try {
      await service.functions.invoke("revenue-autopilot-tick", { body: { hotelId } });
    } catch (e) {
      console.error("autopilot chain failed:", e);
    }

    return new Response(
      JSON.stringify({
        ok: true, supported: true, days, totalRooms,
        reservations: reservations.length,
        upserts: {
          occupancy: occInserted, pickup: pickupInserted,
          breakfast: breakfastUpserted,
          roomTypes: roomTypesSeeded, dailyRates: dailyRatesSeeded,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("previo-pull-revenue error:", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || "Unknown error" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

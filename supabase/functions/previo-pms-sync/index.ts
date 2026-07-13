// One-click PMS sync for Previo hotels.
// Returns rows shaped exactly like the Excel PMS export so the frontend can
// feed them into the same processing pipeline used for manual file uploads.
//
// Roster strategy:
//   - REST tenants: fetch rooms from /rest/rooms (includes clean status).
//   - XML tenants (e.g. Ottofiori): use the local `rooms` table for the hotel
//     as the authoritative roster (every physical room), then enrich with
//     reservations pulled from Previo XML `searchReservations`. This
//     guarantees every room is included in the sync even when it has no
//     reservation in the window.
//
// Window: [today, today+3) so that reservations departing tomorrow are
// visible and rooms can be flagged `DepartureTomorrow` / `IsCheckoutRoom`
// ahead of time.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth, safePrevioJson } from "../_shared/previoAuth.ts";
import { callPrevioXml, loadPrevioCredentials } from "../_shared/previoCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PrevioRoom {
  roomId: number;
  name: string;
  roomKindName: string;
  roomTypeId: number;
  roomCleanStatusId: number;
  capacity: number;
  extraCapacity: number;
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(base: string, n: number): string {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diffDays(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
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

    const body = await req.json().catch(() => ({} as any));
    const targetHotel: string = body.hotelId;
    const dryRun: boolean = body.dryRun === true;
    if (!targetHotel) {
      return new Response(JSON.stringify({ error: "hotelId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization: admin/top_management OR manager assigned to the hotel.
    const { data: profile } = await service
      .from("profiles")
      .select("role, assigned_hotel")
      .eq("id", userRes.user.id)
      .maybeSingle();
    const isAdmin = profile?.role === "admin" || profile?.role === "top_management";
    if (!isAdmin && profile?.assigned_hotel !== targetHotel) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cfg } = await service
      .from("pms_configurations")
      .select("id, hotel_id, pms_hotel_id, credentials_secret_name")
      .eq("hotel_id", targetHotel)
      .eq("pms_type", "previo")
      .maybeSingle();
    if (!cfg) {
      return new Response(
        JSON.stringify({ error: `No Previo config for ${targetHotel}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let credsProtocol: "xml" | "rest" = "rest";
    try {
      const c = loadPrevioCredentials(cfg.credentials_secret_name);
      credsProtocol = c.protocol;
    } catch (e: any) {
      return new Response(
        JSON.stringify({ ok: false, error: e?.message || "Credential load failed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let rooms: PrevioRoom[] = [];
    let rosterSource: "rest" | "local" | "reservations" = "reservations";

    if (credsProtocol === "rest") {
      const { response: resp } = await fetchPrevioWithAuth({
        credentialsSecretName: cfg.credentials_secret_name,
        path: "/rest/rooms",
        pmsHotelId: String(cfg.pms_hotel_id || ""),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        console.error(`Previo /rest/rooms ${resp.status}:`, txt.slice(0, 500));
        return new Response(
          JSON.stringify({ error: `Previo ${resp.status}: ${txt.slice(0, 300)}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      rooms = await safePrevioJson<PrevioRoom[]>(resp, { path: "/rest/rooms" });
      rosterSource = "rest";
    } else {
      // XML tenants: use local `rooms` table as authoritative roster so every
      // physical room is included, even those without reservations.
      const { data: localRooms } = await service
        .from("rooms")
        .select("room_number, room_type, pms_metadata")
        .eq("hotel", targetHotel);
      if (localRooms && localRooms.length > 0) {
        rooms = localRooms.map((r: any) => ({
          roomId: Number(r.pms_metadata?.roomId ?? 0),
          name: r.room_number,
          roomKindName: r.room_type ?? "",
          roomTypeId: 0,
          roomCleanStatusId: 0,
          capacity: 0,
          extraCapacity: 0,
        }));
        rosterSource = "local";
      }
    }

    const today = todayUtcDate();
    const tomorrow = addDays(today, 1);
    const windowEnd = addDays(today, 3);

    interface ParsedReservation {
      objId: number | null;
      roomName: string;
      arrivalDate: string;
      departureDate: string;
      statusId: number;
      guestsCount: number;
      note: string | null;
    }
    const reservationsByRoomName = new Map<string, ParsedReservation>();
    const reservationsByObjId = new Map<number, ParsedReservation>();
    let reservationFetchError: string | null = null;
    try {
      const creds = loadPrevioCredentials(cfg.credentials_secret_name);
      const xmlResult = await callPrevioXml({
        method: "searchReservations",
        creds,
        pmsHotelId: String(cfg.pms_hotel_id || ""),
        extraXml: `<term><from>${today}</from><to>${windowEnd}</to></term>`,
      });
      const xmlText = xmlResult.text;
      if (!xmlResult.ok) {
        reservationFetchError = `XML API ${xmlResult.status}: ${xmlResult.errorMessage || xmlText.slice(0, 200)}`;
        console.warn(`[previo-pms-sync] XML reservations failed: ${reservationFetchError}`);
      } else {
        const blocks = xmlText.match(/<reservation>[\s\S]*?<\/reservation>/g) || [];
        const grab = (s: string, tag: string) => {
          const m = s.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
          return m ? m[1].trim() : "";
        };
        for (const block of blocks) {
          const fromStr = grab(block, "from");
          const toStr = grab(block, "to");
          if (!fromStr || !toStr) continue;
          const arrival = fromStr.slice(0, 10);
          const departure = toStr.slice(0, 10);
          const statusId = parseInt(grab(block, "statusId") || "0", 10);
          if (statusId === 7 || statusId === 8) continue;
          const objMatch = block.match(/<object>[\s\S]*?<objId>(\d+)<\/objId>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/object>/);
          const objId = objMatch ? parseInt(objMatch[1], 10) : null;
          const roomName = objMatch ? objMatch[2].trim() : "";
          if (!roomName && !objId) continue;
          const guestsCount = (block.match(/<guest>/g) || []).length;
          const noteMatch = block.match(/<note>([^<]*)<\/note>/);
          const rec: ParsedReservation = {
            objId,
            roomName,
            arrivalDate: arrival,
            departureDate: departure,
            statusId,
            guestsCount,
            note: noteMatch ? noteMatch[1].trim() || null : null,
          };
          // Prefer the reservation that dictates *today's* housekeeping work.
          // Same-day turnover: Previo returns BOTH the outgoing (departure
          // today) and the incoming (arrival today, departure future)
          // reservations for the same room. The outgoing one wins because the
          // room needs checkout cleaning before the new guest can arrive.
          const rank = (r: ParsedReservation) => {
            if (r.departureDate === today) return 4;                                   // checkout today
            if (r.arrivalDate < today && r.departureDate > today) return 3;            // true stay-through
            if (r.arrivalDate === today && r.departureDate > today) return 2;          // arrival only
            if (r.departureDate === tomorrow) return 1;
            return 0;
          };
          const replaceIfBetter = (existing: ParsedReservation | undefined) => {
            if (!existing) return true;
            return rank(rec) > rank(existing);
          };
          if (roomName && replaceIfBetter(reservationsByRoomName.get(roomName))) {
            reservationsByRoomName.set(roomName, rec);
          }
          if (objId != null && replaceIfBetter(reservationsByObjId.get(objId))) {
            reservationsByObjId.set(objId, rec);
          }
        }
        console.log(`[previo-pms-sync] XML returned ${blocks.length} reservations, indexed ${reservationsByRoomName.size} rooms`);
      }
    } catch (e: any) {
      reservationFetchError = e?.message || String(e);
      console.warn(`[previo-pms-sync] XML reservations threw: ${reservationFetchError}`);
    }

    // Fallback: no roster (empty local table) — synthesise from reservations.
    if (rooms.length === 0 && reservationsByRoomName.size > 0) {
      const seen = new Set<string>();
      for (const rec of reservationsByRoomName.values()) {
        const key = String(rec.objId ?? rec.roomName);
        if (seen.has(key)) continue;
        seen.add(key);
        rooms.push({
          roomId: rec.objId ?? 0,
          name: rec.roomName,
          roomKindName: "",
          roomTypeId: 0,
          roomCleanStatusId: 0,
          capacity: rec.guestsCount || 0,
          extraCapacity: 0,
        });
      }
      rosterSource = "reservations";
    }

    const rows = rooms.map((r) => {
      const res = (r.roomId ? reservationsByObjId.get(r.roomId) : undefined)
        ?? reservationsByRoomName.get(r.name);
      const isOccupied = !!res && res.arrivalDate <= today && res.departureDate > today;
      const isDeparture = !!res && res.departureDate === today;
      const isDepartureTomorrow = !!res && res.departureDate === tomorrow;
      const isArrival = !!res && res.arrivalDate === today;
      const isCheckedOut = !!res && res.statusId === 5 && isDeparture;
      const isCheckoutRoom = isCheckedOut || isDeparture || isDepartureTomorrow;
      const totalNights = res ? diffDays(res.arrivalDate, res.departureDate) : 0;
      const currentNight = res
        ? Math.min(totalNights, Math.max(1, diffDays(res.arrivalDate, today) + (isDeparture ? 0 : 1)))
        : 0;
      const cleanMap: Record<number, string> = { 1: "Untidy", 2: "Clean", 3: "Clean", 4: "Untidy", 5: "Untidy" };
      const statusLabel = cleanMap[r.roomCleanStatusId] ?? "";

      return {
        Room: r.name,
        RoomId: r.roomId,
        RoomKindName: r.roomKindName,
        Occupied: isOccupied || isDeparture ? "Yes" : "No",
        Departure: isDeparture ? "12:00" : null,
        DepartureTomorrow: isDepartureTomorrow,
        DepartureDate: res?.departureDate ?? null,
        ArrivalDate: res?.arrivalDate ?? null,
        Arrival: isArrival ? "15:00" : null,
        CheckedOut: isCheckedOut,
        IsCheckoutRoom: isCheckoutRoom,
        ReservationStatusId: res?.statusId ?? null,
        People: res?.guestsCount ?? (isOccupied || isDeparture ? r.capacity : 0),
        "Night / Total": totalNights > 0 ? `${currentNight}/${totalNights}` : null,
        Note: res?.note ?? null,
        Nationality: null,
        Defect: null,
        Status: statusLabel,
      };
    });

    const departureCount = rows.filter((r) => r.Departure).length;
    const departureTomorrowCount = rows.filter((r) => r.DepartureTomorrow).length;
    const checkedOutCount = rows.filter((r) => r.CheckedOut).length;
    const arrivalCount = rows.filter((r) => r.Arrival).length;
    console.log(`[previo-pms-sync] emitted ${rows.length} rows (${departureCount} depart today, ${departureTomorrowCount} depart tomorrow, ${checkedOutCount} checked-out, ${arrivalCount} arrivals; roster=${rosterSource}, dryRun=${dryRun})`);

    return new Response(
      JSON.stringify({
        ok: true,
        hotel_id: targetHotel,
        dryRun,
        rosterSource,
        rowCount: rows.length,
        departuresToday: departureCount,
        departuresTomorrow: departureTomorrowCount,
        checkedOutToday: checkedOutCount,
        arrivalsToday: arrivalCount,
        reservationsAvailable: reservationsByRoomName.size,
        reservationFetchError,
        rows,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("previo-pms-sync error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// One-click PMS sync for Previo test hotel.
// Pulls /rest/rooms (incl. today's reservation per room) and returns rows
// shaped exactly like the Excel PMS export so the frontend can feed them
// into the same processing pipeline used for manual file uploads.
//
// HARD GUARD: only operates for hotel_id = 'previo-test'. Returns an error
// for any other hotel so OttoFiori and others are never touched.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth, safePrevioJson } from "../_shared/previoAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_HOTEL_ID = "previo-test";

interface PrevioRoom {
  roomId: number;
  name: string;
  roomKindName: string;
  roomTypeId: number;
  roomCleanStatusId: number;
  capacity: number;
  extraCapacity: number;
  reservation?: {
    reservationId: number;
    arrivalDate: string;   // YYYY-MM-DD
    departureDate: string; // YYYY-MM-DD
    status: string;
    guestsCount?: number;
    note?: string;
  };
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
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

    // Auth: require Bearer token
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

    const { hotelId } = await req.json().catch(() => ({}));
    const targetHotel = hotelId || ALLOWED_HOTEL_ID;

    // SAFETY: hard-gate to previo-test
    if (targetHotel !== ALLOWED_HOTEL_ID) {
      return new Response(
        JSON.stringify({
          error: `previo-pms-sync is restricted to hotel '${ALLOWED_HOTEL_ID}'. Got '${targetHotel}'.`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Authorization: must be admin/manager assigned to the hotel (or admin/top_management)
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

    // Load PMS config
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

    const rooms = await safePrevioJson<PrevioRoom[]>(resp, { path: "/rest/rooms" });
    const today = todayUtcDate();

    // Pull today's reservations via the Previo XML API. The REST API has no
    // list endpoint for reservations, but the XML `searchReservations` method
    // returns full reservation objects with the assigned room (object/name)
    // and term (from/to). We index by room name (since /rest/rooms uses the
    // same `name`) and by objId for safety.
    interface ParsedReservation {
      objId: number | null;
      roomName: string;
      arrivalDate: string;   // YYYY-MM-DD
      departureDate: string; // YYYY-MM-DD
      statusId: number;
      guestsCount: number;
      note: string | null;
    }
    const reservationsByRoomName = new Map<string, ParsedReservation>();
    const reservationsByObjId = new Map<number, ParsedReservation>();
    let reservationFetchError: string | null = null;
    try {
      // Read raw credentials directly from the configured secret so we can
      // embed login/password in the XML body (XML API uses inline auth, not
      // Basic Auth headers).
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
      } catch {}
      if (!xmlUser || !xmlPass) {
        const m = cleaned.match(/^([^:\s]+):(.+)$/);
        if (m) { xmlUser = stripQuotes(m[1]); xmlPass = stripQuotes(m[2]); }
      }

      if (!xmlUser || !xmlPass) {
        reservationFetchError = "Could not parse Previo XML credentials";
      } else {
        // XML API requires from < to. Use [today, today+2) to safely capture
        // anything departing today (term.to date == today).
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        const xmlBody = `<?xml version="1.0"?>
<request>
<login>${xmlUser}</login>
<password>${xmlPass}</password>
<hotId>${String(cfg.pms_hotel_id || "")}</hotId>
<term><from>${today}</from><to>${tomorrow}</to></term>
</request>`;
        const xmlResp = await fetch("https://api.previo.cz/x1/hotel/searchReservations/", {
          method: "POST",
          headers: { "Content-Type": "text/xml; charset=UTF-8" },
          body: xmlBody,
        });
        const xmlText = await xmlResp.text();
        if (!xmlResp.ok || /<error>/i.test(xmlText)) {
          const errMatch = xmlText.match(/<message>([^<]*)<\/message>/i);
          reservationFetchError = `XML API ${xmlResp.status}: ${errMatch?.[1] || xmlText.slice(0, 200)}`;
          console.warn(`[previo-pms-sync] XML reservations failed: ${reservationFetchError}`);
        } else {
          // Naive XML parse — extract each <reservation>...</reservation> block.
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
            // Skip cancelled (7) and no-show (8) reservations
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

            // Prefer the reservation departing today (checkout) over an
            // arrival or stay-through when one room has multiple records.
            const replaceIfBetter = (existing: ParsedReservation | undefined) => {
              if (!existing) return true;
              if (rec.departureDate === today && existing.departureDate !== today) return true;
              if (existing.departureDate === today) return false;
              if (rec.arrivalDate <= today && rec.departureDate > today) return true;
              return false;
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
      }
    } catch (e: any) {
      reservationFetchError = e?.message || String(e);
      console.warn(`[previo-pms-sync] XML reservations threw: ${reservationFetchError}`);
    }

    // Build Excel-compatible rows. Header names match those that PMSUpload's
    // fuzzy column matcher recognizes (English variants).
    const rows = rooms.map((r) => {
      const res = reservationsByObjId.get(r.roomId) ?? reservationsByRoomName.get(r.name);
      const isOccupied = !!res && res.arrivalDate <= today && res.departureDate > today;
      const isDeparture = !!res && res.departureDate === today;
      const isArrival = !!res && res.arrivalDate === today;
      const totalNights = res ? diffDays(res.arrivalDate, res.departureDate) : 0;
      const currentNight = res
        ? Math.min(totalNights, Math.max(1, diffDays(res.arrivalDate, today) + (isDeparture ? 0 : 1)))
        : 0;

      // roomCleanStatusId: 1 = clean, 2 = dirty/untidy in Previo (best-effort mapping)
      const statusLabel = r.roomCleanStatusId === 1 ? "Clean" : "Untidy";

      return {
        Room: r.name,
        RoomId: r.roomId,
        RoomKindName: r.roomKindName,
        Occupied: isOccupied || isDeparture ? "Yes" : "No",
        // Excel uses time strings; we don't have actual times from /rest/rooms,
        // so use sentinel "12:00" if the date matches today. The pipeline only
        // cares whether departure is non-empty, not the exact time.
        Departure: isDeparture ? "12:00" : null,
        Arrival: isArrival ? "15:00" : null,
        People: res?.guestsCount ?? (isOccupied || isDeparture ? r.capacity : 0),
        "Night / Total": totalNights > 0 ? `${currentNight}/${totalNights}` : null,
        Note: res?.note ?? null,
        Nationality: null,
        Defect: null,
        Status: statusLabel,
      };
    });

    const departureCount = rows.filter((r) => r.Departure).length;
    const arrivalCount = rows.filter((r) => r.Arrival).length;
    console.log(`[previo-pms-sync] emitted ${rows.length} rows (${departureCount} departures, ${arrivalCount} arrivals today)`);

    return new Response(
      JSON.stringify({
        ok: true,
        hotel_id: targetHotel,
        rowCount: rows.length,
        departuresToday: departureCount,
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

// One-click PMS sync for Previo hotels.
// Returns rows shaped exactly like the Excel PMS export so the frontend can
// feed them into the same processing pipeline used for manual file uploads.
//
// Roster strategy:
//   - REST tenants: fetch rooms from /rest/rooms for room roster / clean status.
//   - XML Hotel.searchReservations is the authoritative source for today's
//     checkout/daily/no-show buckets because it contains stay dates, room
//     objects, statuses, guest counts, and night totals.
//   - A roster-only REST sync is never reported as a complete PMS bucket sync.
//
// Window: [today, today+3) so that reservations departing tomorrow are
// visible and rooms can be flagged `DepartureTomorrow` / `IsCheckoutRoom`
// ahead of time.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth, safePrevioJson } from "../_shared/previoAuth.ts";
import { callPrevioXml, loadPrevioCredentials, type PrevioXmlAuthVariant } from "../_shared/previoCredentials.ts";

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
  reservation?: Record<string, unknown> | null;
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

function extractRoomNumber(raw: string): string {
  const match = String(raw ?? "").match(/(\d{3})(?:\D*)$/) ?? String(raw ?? "").match(/\d+/);
  return match ? match[1] : String(raw ?? "").trim();
}

function cleanDate(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

function cleanTime(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  const match = s.match(/[T\s](\d{2}:\d{2})/) ?? s.match(/^(\d{2}:\d{2})/);
  return match ? match[1] : null;
}

function statusIdFrom(raw: any): number {
  if (!raw || typeof raw !== "object") return 0;
  const status = raw.status;
  const value = raw.statusId ?? raw.reservationStatusId ?? raw.cosId ?? raw.commissionStatusId
    ?? (status && typeof status === "object" ? status.id : status);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function listFromRestPayload(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.reservations)) return payload.reservations;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function roomNameFromRestReservation(raw: any): string {
  const candidates = [
    raw?.roomName,
    raw?.room_name,
    raw?.room,
    raw?.objectName,
    raw?.object?.name,
    raw?.rooms?.[0]?.name,
    raw?.roomReservations?.[0]?.room?.name,
    raw?.reservationRooms?.[0]?.room?.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === "object" && typeof candidate.name === "string" && candidate.name.trim()) return candidate.name.trim();
  }
  return "";
}

function roomIdFromRestReservation(raw: any): number | null {
  const value = raw?.roomId ?? raw?.room_id ?? raw?.objId ?? raw?.objectId ?? raw?.object?.objId
    ?? raw?.room?.roomId ?? raw?.rooms?.[0]?.roomId ?? raw?.roomReservations?.[0]?.roomId
    ?? raw?.roomReservations?.[0]?.room?.roomId ?? raw?.reservationRooms?.[0]?.room?.roomId;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isCheckedOutStatus(statusId: number): boolean {
  return statusId === 5 || statusId === 9;
}

function isNoShowStatus(statusId: number): boolean {
  return statusId === 8;
}

const RESERVATION_UNAVAILABLE_MANAGER_MESSAGE =
  "PMS room list synced, but Previo did not send checkout/daily data. Room buckets were not changed.";

function isAuthFailure(status: number, message: string | null, text = ""): boolean {
  const haystack = `${message || ""} ${text.slice(0, 500)}`;
  return status === 401 || status === 403 || /invalid login|invalid password|unauthori[sz]ed|forbidden/i.test(haystack);
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
      .select("id, hotel_id, pms_hotel_id, credentials_secret_name, settings")
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
    const { data: hotelCfgForKeys } = await service
      .from("hotel_configurations")
      .select("hotel_name")
      .eq("hotel_id", targetHotel)
      .maybeSingle();
    const localHotelKeys = Array.from(new Set([targetHotel, (hotelCfgForKeys as any)?.hotel_name].filter(Boolean)));
    const canonicalHotelName = (hotelCfgForKeys as any)?.hotel_name || targetHotel;

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
        .select("hotel, room_number, room_type, pms_metadata")
        .in("hotel", localHotelKeys);
      if (localRooms && localRooms.length > 0) {
        const byNumber = new Map<string, any>();
        for (const room of localRooms as any[]) {
          const key = extractRoomNumber(room.room_number);
          const current = byNumber.get(key);
          const score = (candidate: any) =>
            (candidate.hotel === canonicalHotelName ? 100 : 0) +
            (candidate.pms_metadata?.roomId ? 20 : 0);
          if (!current || score(room) > score(current)) byNumber.set(key, room);
        }
        rooms = Array.from(byNumber.values()).map((r: any) => ({
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
    // Widen the *arrival-side* window backwards so mid-stay guests (who
    // arrived days/weeks ago) are still returned. Previo's <term> filters
    // by arrival date, so a today-only window silently drops every
    // stay-through and today-departing reservation → they'd fall into
    // the !res branch and get mis-flagged as no-shows.
    const windowStart = addDays(today, -30);

    interface ParsedReservation {
      objId: number | null;
      roomName: string;
      arrivalDate: string;
      departureDate: string;
      departureTime: string | null;
      statusId: number;
      guestsCount: number;
      note: string | null;
    }
    const reservationsByRoomName = new Map<string, ParsedReservation>();
    const reservationsByObjId = new Map<number, ParsedReservation>();
    let reservationFetchError: string | null = null;
    let reservationFallbackSource: string | null = null;
    let reservationIssue: Record<string, unknown> | null = null;
    let reservationSource: string | null = null;
    const reservationDiagnostics: Array<Record<string, unknown>> = [];

    const indexReservation = (rec: ParsedReservation) => {
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
      if (rec.roomName && replaceIfBetter(reservationsByRoomName.get(rec.roomName))) {
        reservationsByRoomName.set(rec.roomName, rec);
      }
      const numericRoomName = extractRoomNumber(rec.roomName);
      if (numericRoomName && numericRoomName !== rec.roomName && replaceIfBetter(reservationsByRoomName.get(numericRoomName))) {
        reservationsByRoomName.set(numericRoomName, rec);
      }
      if (rec.objId != null && replaceIfBetter(reservationsByObjId.get(rec.objId))) {
        reservationsByObjId.set(rec.objId, rec);
      }
    };
    const parseReservationXml = (xmlText: string, source: string) => {
      const blocks = xmlText.match(/<reservation>[\s\S]*?<\/reservation>/g) || [];
      const grab = (s: string, tag: string) => {
        const m = s.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
        return m ? m[1].trim() : "";
      };
      let indexed = 0;
      for (const block of blocks) {
        const fromStr = grab(block, "from");
        const toStr = grab(block, "to");
        if (!fromStr || !toStr) continue;
        const arrival = fromStr.slice(0, 10);
        const departure = toStr.slice(0, 10);
        let departureTime: string | null = null;
        const timeMatch = toStr.match(/[T\s](\d{2}:\d{2})/);
        if (timeMatch) departureTime = timeMatch[1];
        const statusId = parseInt(grab(block, "statusId") || grab(block, "cosId") || "0", 10);
        if (statusId === 7) continue;
        const objMatch = block.match(/<object>[\s\S]*?<objId>(\d+)<\/objId>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/object>/);
        const objId = objMatch ? parseInt(objMatch[1], 10) : null;
        const roomName = objMatch ? objMatch[2].trim() : "";
        if (!roomName && !objId) continue;
        const guestsCount = (block.match(/<guest>/g) || []).length
          || Number(grab(block, "numOfGuests") || grab(block, "persons") || grab(block, "pax") || 0)
          || 0;
        const noteMatch = block.match(/<note>([^<]*)<\/note>/);
        indexReservation({
          objId,
          roomName,
          arrivalDate: arrival,
          departureDate: departure,
          departureTime,
          statusId,
          guestsCount,
          note: noteMatch ? noteMatch[1].trim() || null : null,
        });
        indexed++;
      }
      reservationDiagnostics.push({ source, blocks: blocks.length, indexed });
      return indexed;
    };

    try {
      const creds = loadPrevioCredentials(cfg.credentials_secret_name);
      const configuredXmlVariant = typeof (cfg as any).settings?.previo_xml_auth_variant === "string"
        ? ((cfg as any).settings.previo_xml_auth_variant as PrevioXmlAuthVariant)
        : undefined;
      const xmlAttempts = [
        {
          source: "xml_searchReservations_overlap",
          // Authoritative housekeeping snapshot: every reservation overlapping
          // today/tomorrow, including stay-through guests who arrived earlier.
          extraXml: `<term><from>${today}</from><to>${windowEnd}</to><termType>overlap</termType></term>`,
        },
        {
          source: "xml_searchReservations_checkout",
          // Ensures today's departures are present even if overlap filtering
          // excludes already checked-out reservations in some Previo tenants.
          extraXml: `<term><from>${today}</from><to>${tomorrow}</to><termType>check-out</termType></term>`,
        },
        {
          source: "xml_searchReservations_checkin",
          // Captures today's arrivals/no-shows for the no-show bucket.
          extraXml: `<term><from>${today}</from><to>${tomorrow}</to><termType>check-in</termType></term>`,
        },
        {
          source: "xml_searchReservations_legacy_window",
          // Legacy fallback retained for tenants that have not enabled termType.
          extraXml: `<term><from>${windowStart}</from><to>${windowEnd}</to></term>`,
        },
      ];

      for (const attempt of xmlAttempts) {
        const before = reservationsByRoomName.size;
        const xmlResult = await callPrevioXml({
          method: "searchReservations",
          creds,
          pmsHotelId: String(cfg.pms_hotel_id || ""),
          extraXml: attempt.extraXml,
          authVariant: configuredXmlVariant,
        });
        const xmlText = xmlResult.text;
        if (!xmlResult.ok) {
          const authFailure = isAuthFailure(xmlResult.status, xmlResult.errorMessage, xmlText);
          reservationFetchError = authFailure
            ? "Previo rejected reservation/departure API login."
            : `Previo reservation/departure API ${xmlResult.status}: ${xmlResult.errorMessage || xmlText.slice(0, 200)}`;
          reservationIssue = {
            type: authFailure ? "previo_reservation_auth" : "previo_reservation_unavailable",
            status: xmlResult.status,
            protocol: credsProtocol,
            usedAuthVariant: xmlResult.usedAuthVariant ?? null,
            managerMessage: null,
            adminMessage: reservationFetchError,
            detail: xmlResult.errorMessage || null,
            source: attempt.source,
          };
          reservationDiagnostics.push({ source: attempt.source, ok: false, status: xmlResult.status, error: xmlResult.errorMessage || xmlText.slice(0, 160) });
          console.warn(`[previo-pms-sync] XML reservations ${attempt.source} failed: ${reservationFetchError}`);
          if (authFailure) break;
          continue;
        }
        const indexed = parseReservationXml(xmlText, attempt.source);
        if (indexed > 0 && reservationsByRoomName.size > before) {
          reservationIssue = null;
          reservationFetchError = null;
          reservationSource = reservationSource ? `${reservationSource}+${attempt.source}` : attempt.source;
        }
      }
      console.log(`[previo-pms-sync] XML indexed ${reservationsByRoomName.size} reservation rooms from ${reservationSource || "none"}`);
    } catch (e: any) {
      reservationFetchError = e?.message || String(e);
      reservationIssue = {
        type: "previo_reservation_unavailable",
        protocol: credsProtocol,
        managerMessage: null,
        adminMessage: reservationFetchError,
      };
      console.warn(`[previo-pms-sync] XML reservations threw: ${reservationFetchError}`);
    }

    // REST /rest/rooms sometimes embeds the current reservation object. Use it
    // when present so API sync can match the same departure/stay-through data
    // as the cleaning export without relying only on XML searchReservations.
    let restReservationsIndexed = 0;
    for (const room of rooms) {
      const res: any = (room as any).reservation;
      if (!res || typeof res !== "object") continue;
      const arrivalRaw = res.arrivalDate ?? res.arrival ?? res.from ?? res.dateFrom ?? res.startDate ?? res.checkIn;
      const departureRaw = res.departureDate ?? res.departure ?? res.to ?? res.dateTo ?? res.endDate ?? res.checkOut;
      const arrivalDate = cleanDate(arrivalRaw);
      const departureDate = cleanDate(departureRaw);
      if (!arrivalDate || !departureDate) continue;
      const statusId = statusIdFrom(res);
      if (statusId === 7) continue;
      const guests = Array.isArray(res.guests) ? res.guests.length
        : Array.isArray(res.guestList) ? res.guestList.length
          : Number(res.guestsCount ?? res.people ?? res.persons ?? res.pax ?? 0) || 0;
      indexReservation({
        objId: Number.isFinite(Number(room.roomId)) && Number(room.roomId) > 0 ? Number(room.roomId) : null,
        roomName: String(room.name ?? "").trim(),
        arrivalDate,
        departureDate,
        departureTime: cleanTime(departureRaw),
        statusId,
        guestsCount: guests,
        note: res.note || res.notes || res.comment ? String(res.note ?? res.notes ?? res.comment).trim() : null,
      });
      restReservationsIndexed++;
    }
    if (restReservationsIndexed > 0) {
      console.log(`[previo-pms-sync] REST room payload indexed ${restReservationsIndexed} embedded reservations`);
    }
    const restReservationProbeEnabled = (cfg as any).settings?.previo_rest_reservation_probe_enabled === true;
    if (reservationsByRoomName.size === 0 && credsProtocol === "rest" && restReservationProbeEnabled) {
      const restReservationPaths = [
        `/rest/reservations?from=${windowStart}&to=${windowEnd}`,
        `/rest/reservations?dateFrom=${windowStart}&dateTo=${windowEnd}`,
        `/rest/reservations?arrivalDateFrom=${windowStart}&arrivalDateTo=${windowEnd}`,
        `/rest/reservations?departureDateFrom=${today}&departureDateTo=${windowEnd}`,
      ];
      for (const path of restReservationPaths) {
        try {
          const { response } = await fetchPrevioWithAuth({
            credentialsSecretName: cfg.credentials_secret_name,
            path,
            pmsHotelId: String(cfg.pms_hotel_id || ""),
          });
          if (!response.ok) {
            const text = await response.text();
            console.warn(`[previo-pms-sync] REST reservation probe ${path} returned ${response.status}: ${text.slice(0, 120)}`);
            continue;
          }
          const payload = await response.json().catch(() => null);
          const items = listFromRestPayload(payload);
          let indexed = 0;
          for (const item of items) {
            const arrivalDate = cleanDate(item?.arrivalDate ?? item?.arrival ?? item?.from ?? item?.dateFrom ?? item?.startDate ?? item?.checkIn);
            const departureDate = cleanDate(item?.departureDate ?? item?.departure ?? item?.to ?? item?.dateTo ?? item?.endDate ?? item?.checkOut);
            if (!arrivalDate || !departureDate) continue;
            const roomName = roomNameFromRestReservation(item);
            const objId = roomIdFromRestReservation(item);
            if (!roomName && !objId) continue;
            const guests = Array.isArray(item?.guests) ? item.guests.length
              : Array.isArray(item?.guestList) ? item.guestList.length
                : Number(item?.guestsCount ?? item?.people ?? item?.persons ?? item?.pax ?? item?.guestCount ?? 0) || 0;
            indexReservation({
              objId,
              roomName,
              arrivalDate,
              departureDate,
              departureTime: cleanTime(item?.departureDate ?? item?.departure ?? item?.to ?? item?.dateTo ?? item?.endDate ?? item?.checkOut),
              statusId: statusIdFrom(item),
              guestsCount: guests,
              note: item?.note || item?.notes || item?.comment ? String(item.note ?? item.notes ?? item.comment).trim() : null,
            });
            indexed++;
          }
          console.log(`[previo-pms-sync] REST reservation endpoint ${path} returned ${items.length} rows, indexed ${indexed}`);
          if (indexed > 0) {
            reservationFallbackSource = "rest_reservations";
            reservationSource = reservationSource ? `${reservationSource}+rest_reservations` : "rest_reservations";
            reservationIssue = null;
            break;
          }
        } catch (e: any) {
          console.warn(`[previo-pms-sync] REST reservation probe ${path} failed: ${e?.message || String(e)}`);
        }
      }
    }

    // Safety net: if the live reservation feed is unavailable/empty, do NOT
    // let the REST room roster (which may have clean statuses but no departure
    // data) wipe checkout rooms back into daily rooms. Rehydrate from today's
    // PMS upload if present; otherwise the frontend preserves current checkout
    // flags because reservationDataAuthoritative remains false.
    if (reservationsByRoomName.size === 0) {
      try {
        const { data: hotelCfg } = await service
          .from("hotel_configurations")
          .select("hotel_name")
          .eq("hotel_id", targetHotel)
          .maybeSingle();
        const hotelFilters = Array.from(new Set([targetHotel, (hotelCfg as any)?.hotel_name].filter(Boolean)));
        const todayStart = `${today}T00:00:00Z`;
        const todayEnd = `${tomorrow}T00:00:00Z`;
        const { data: latestUpload } = await service
          .from("pms_upload_summary")
          .select("checkout_rooms, daily_cleaning_rooms, upload_date")
          .in("hotel_filter", hotelFilters)
          .gte("upload_date", todayStart)
          .lt("upload_date", todayEnd)
          .order("upload_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        const checkoutRows = Array.isArray((latestUpload as any)?.checkout_rooms)
          ? (latestUpload as any).checkout_rooms
          : [];
        const dailyRows = Array.isArray((latestUpload as any)?.daily_cleaning_rooms)
          ? (latestUpload as any).daily_cleaning_rooms
          : [];
        for (const item of checkoutRows) {
          const roomName = String(item?.roomNumber ?? item?.room_number ?? "").trim();
          if (!roomName) continue;
          // Use real totalNights when the upload captured them so downstream
          // Night/Total reflects the actual stay, not a synthesized 1/1.
          const totalN = Number(item?.totalNights ?? 0) || 0;
          const arrival = totalN > 0 ? addDays(today, -Math.max(0, totalN - 1)) : addDays(today, -1);
          indexReservation({
            objId: null,
            roomName,
            arrivalDate: arrival,
            departureDate: today,
            departureTime: item?.departureTime ? String(item.departureTime) : null,
            statusId: item?.status === "checked_out" ? 5 : 1,
            guestsCount: Number(item?.guestCount ?? 0) || 0,
            note: item?.notes ? String(item.notes) : null,
          });
        }
        for (const item of dailyRows) {
          const roomName = String(item?.roomNumber ?? item?.room_number ?? "").trim();
          if (!roomName) continue;
          // Preserve real currentNight / totalNights from the upload so this
          // fallback doesn't collapse every daily room to 2/2 depart-tomorrow.
          const curN = Number(item?.currentNight ?? 0) || 0;
          const totalN = Number(item?.totalNights ?? 0) || 0;
          const arrival = curN > 0 ? addDays(today, -(curN - 1)) : addDays(today, -1);
          const remaining = totalN > 0 && curN > 0 ? Math.max(1, totalN - curN + 1) : 1;
          const departure = addDays(today, remaining);
          indexReservation({
            objId: null,
            roomName,
            arrivalDate: arrival,
            departureDate: departure,
            departureTime: null,
            statusId: 1,
            guestsCount: Number(item?.guestCount ?? 0) || 0,
            note: item?.notes ? String(item.notes) : null,
          });
        }
        if (checkoutRows.length || dailyRows.length) {
          reservationFallbackSource = "today_pms_upload_summary";
          reservationSource = reservationSource ? `${reservationSource}+today_pms_upload_summary` : "today_pms_upload_summary";
          reservationIssue = null;
          console.log(`[previo-pms-sync] reservation feed unavailable/empty; recovered ${checkoutRows.length} checkout and ${dailyRows.length} daily rooms from ${reservationFallbackSource}`);
        }
      } catch (e: any) {
        console.warn(`[previo-pms-sync] PMS upload fallback failed: ${e?.message || String(e)}`);
      }
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
      const roomNumber = extractRoomNumber(r.name);
      const res = (r.roomId ? reservationsByObjId.get(r.roomId) : undefined)
        ?? reservationsByRoomName.get(r.name)
        ?? (roomNumber !== r.name ? reservationsByRoomName.get(roomNumber) : undefined);
      const isOccupied = !!res && res.arrivalDate <= today && res.departureDate > today;
      const isDeparture = !!res && res.departureDate === today;
      const isDepartureTomorrow = !!res && res.departureDate === tomorrow;
      const isArrival = !!res && res.arrivalDate === today;
      const isCheckedOut = !!res && isCheckedOutStatus(res.statusId) && isDeparture;
      // Only real checkouts (today or already checked out) belong in the
      // Checkout Rooms bucket. "Departs tomorrow" stays a daily room but
      // still surfaces via the C/O+1 badge (DepartureTomorrow flag below).
      const isCheckoutRoom = isCheckedOut || isDeparture;
      const totalNights = res ? diffDays(res.arrivalDate, res.departureDate) : 0;
      const currentNight = res
        ? Math.min(totalNights, Math.max(1, diffDays(res.arrivalDate, today) + (isDeparture ? 0 : 1)))
        : 0;
      const cleanMap: Record<number, string> = { 1: "Untidy", 2: "Clean", 3: "Clean", 4: "Untidy", 5: "Untidy" };
      const statusLabel = cleanMap[r.roomCleanStatusId] ?? "";

      // Belt-and-braces: only flag DepartureTomorrow when this is the guest's
      // LAST night (currentNight === totalNights). Protects against stale or
      // synthesised reservations painting a mid-stay room as C/O+1.
      const departureTomorrowConfirmed =
        isDepartureTomorrow && totalNights > 0 && currentNight === totalNights;

      // No-show is a RESERVATION state, not "the room has no reservation".
      // Real definition: reception booked a guest to arrive today and they
      // never checked in. Previo marks such reservations with statusId 6.
      // A room with no reservation at all is simply vacant.
      const noteLower = (res?.note ?? "").toLowerCase();
      const isNoShow = !!res
        && res.arrivalDate === today
        && (isNoShowStatus(res.statusId) || noteLower.includes("no show") || noteLower.includes("no-show"));

      return {
        Room: r.name,
        RoomId: r.roomId,
        RoomKindName: r.roomKindName,
        Occupied: isOccupied || isDeparture ? "Yes" : "No",
        // Prefer the real reservation departure time; fall back to 11:00
        // (Ottofiori standard check-out) so the chip is never blank.
        Departure: isDeparture ? (res?.departureTime || "11:00") : null,
        DepartureTomorrow: departureTomorrowConfirmed,
        DepartureDate: res?.departureDate ?? null,
        ArrivalDate: res?.arrivalDate ?? null,
        Arrival: isArrival ? "15:00" : null,
        CheckedOut: isCheckedOut,
        IsCheckoutRoom: isCheckoutRoom,
        IsNoShow: isNoShow,
        ReservationStatusId: res?.statusId ?? null,
        People: res?.guestsCount ?? (isOccupied || isDeparture ? r.capacity : 0),
        "Night / Total": totalNights > 0 ? `${currentNight}/${totalNights}` : null,
        CurrentNight: currentNight || null,
        TotalNights: totalNights || null,
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
    const effectiveReservationSource = reservationsByRoomName.size > 0
      ? reservationSource ?? reservationFallbackSource ?? (restReservationsIndexed > 0 ? "rest_rooms_embedded_reservation" : "xml_searchReservations")
      : null;
    const reservationDataAuthoritative = reservationsByRoomName.size > 0;
    const managerFacingSuccess = reservationDataAuthoritative;
    const managerMessage = managerFacingSuccess
      ? null
      : RESERVATION_UNAVAILABLE_MANAGER_MESSAGE;
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
        reservationDataAuthoritative,
        managerFacingSuccess,
        reservationSource: effectiveReservationSource,
        reservationFetchError,
        reservationIssue,
        managerMessage,
        reservationFallbackSource,
        reservationDiagnostics,
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

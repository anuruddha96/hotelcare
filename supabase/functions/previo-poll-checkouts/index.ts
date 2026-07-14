// Polls Previo every few minutes for reception-confirmed departures and
// room state changes, emits a row into `pms_change_events` for every
// meaningful diff, places a `pms_hold` on assignments that conflict with
// an incoming change, and auto-releases checkout rooms for cleaning.
//
// Auth modes
// ----------
//  - Bearer = SUPABASE_SERVICE_ROLE_KEY  -> server-to-server (used by pg_cron)
//  - Bearer = user JWT                   -> authenticated user (managers / admins)
//
// Hotel scope
// -----------
//  - body.hotelId provided  -> only that hotel
//  - body.hotelId omitted   -> fan-out across every active Previo config
//                              whose pms_configurations.settings does NOT
//                              contain { disable_checkout_poll: true }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth, safePrevioJson } from "../_shared/previoAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PrevioRoom {
  roomId: number;
  name: string;
  roomCleanStatusId?: number;
  reservation?: {
    arrivalDate?: string;
    departureDate?: string;
    statusId?: number;
  } | null;
}

const todayUtc = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const extractNum = (raw: string) => {
  const m = String(raw ?? "").match(/\d+/);
  return m ? m[0] : String(raw ?? "").trim();
};

interface PollResult {
  hotel_id: string;
  checked: number;
  marked: number;
  cleared: number;
  events: number;
  conflicts: number;
  errors: string[];
  unmatched: string[];
  reservationFetchError: string | null;
}

async function pollOneHotel(
  service: any,
  hotelId: string,
  cfg: { credentials_secret_name: string; pms_hotel_id: any },
): Promise<PollResult> {
  const result: PollResult = {
    hotel_id: hotelId,
    checked: 0, marked: 0, cleared: 0, events: 0, conflicts: 0,
    errors: [], unmatched: [], reservationFetchError: null,
  };

  const { data: hotelCfg } = await service
    .from("hotel_configurations")
    .select("hotel_name")
    .eq("hotel_id", hotelId)
    .maybeSingle();
  const hotelKeys = Array.from(new Set([hotelId, (hotelCfg as any)?.hotel_name].filter(Boolean)));

  // 1. Fetch roster + reservation state from Previo REST. This endpoint works
  // for every tenant (REST username/password AND single-key ApiKey tenants like
  // Ottofiori), which is why it powers the manual PMS Refresh. We use it here
  // to identify statusId=5 (departed) rooms for today WITHOUT touching the XML
  // endpoint — the XML endpoint rejects REST ApiKeys with 401 and was blocking
  // the auto-checkout flow.
  let rooms: PrevioRoom[] = [];
  try {
    const { response: resp } = await fetchPrevioWithAuth({
      credentialsSecretName: cfg.credentials_secret_name,
      path: "/rest/rooms",
      pmsHotelId: String(cfg.pms_hotel_id || ""),
    });
    if (!resp.ok) {
      const t = await resp.text();
      result.errors.push(`Previo /rest/rooms ${resp.status}: ${t.slice(0, 200)}`);
      return result;
    }
    rooms = await safePrevioJson<PrevioRoom[]>(resp, { path: "/rest/rooms" });
  } catch (e: any) {
    result.errors.push(`Previo /rest/rooms fetch: ${e?.message || e}`);
    return result;
  }
  result.checked = rooms.length;

  // 2. Identify today's departures from the reservation payload embedded in
  // each /rest/rooms row. statusId===5 == "departed" in Previo.
  const today = todayUtc();
  const checkedOutByName = new Map<string, string>(); // name -> reservationId ("" — REST /rest/rooms does not expose one)
  const checkedOutByObjId = new Map<number, string>();
  for (const r of rooms) {
    const res = r.reservation;
    if (!res) continue;
    const departure = res.departureDate ? String(res.departureDate).slice(0, 10) : "";
    if (res.statusId !== 5 || departure !== today) continue;
    const name = String(r.name ?? "").trim();
    if (name) checkedOutByName.set(name, "");
    if (r.roomId != null && !isNaN(Number(r.roomId))) {
      checkedOutByObjId.set(Number(r.roomId), "");
    }
  }

  const trueCheckoutRoomIds = new Set<string>();
  const departedRooms = rooms.filter((r) =>
    checkedOutByObjId.has(r.roomId) || checkedOutByName.has(r.name),
  );


  // 3. Process each departed room
  for (const r of departedRooms) {
    try {
      const rawName = String(r.name ?? "").trim();
      const numToken = extractNum(rawName);
      const previoRoomId = r.roomId != null ? String(r.roomId) : "";
      const reservationId =
        checkedOutByObjId.get(r.roomId) || checkedOutByName.get(rawName) || "";

      const tryQ = async (mut: (q: any) => any) => {
        const { data } = await mut(
          service
            .from("rooms")
            .select("id, status, is_checkout_room, room_number, pms_metadata")
            .in("hotel", hotelKeys),
        ).maybeSingle();
        return (data as any) || null;
      };
      let localRoom = await tryQ((q: any) => q.eq("room_number", rawName));
      if (!localRoom && rawName) localRoom = await tryQ((q: any) => q.ilike("room_number", rawName));
      if (!localRoom && numToken && numToken !== rawName)
        localRoom = await tryQ((q: any) => q.eq("room_number", numToken));
      if (!localRoom && previoRoomId)
        localRoom = await tryQ((q: any) => q.filter("pms_metadata->>roomId", "eq", previoRoomId));

      if (!localRoom) {
        result.unmatched.push(rawName || previoRoomId);
        continue;
      }
      trueCheckoutRoomIds.add(localRoom.id);

      const wasCheckout = !!localRoom.is_checkout_room;

      // Look up today's active assignments first so we can protect an
      // in-progress housekeeper cleaning from having its status stomped.
      const { data: existingAsg } = await service
        .from("room_assignments")
        .select("id, status, assignment_type, assigned_to, pms_hold")
        .eq("room_id", localRoom.id)
        .eq("assignment_date", today)
        .in("status", ["assigned", "in_progress"]);
      const hasActiveAssignment = (existingAsg ?? []).length > 0;

      const existingMeta = (localRoom.pms_metadata && typeof localRoom.pms_metadata === "object")
        ? localRoom.pms_metadata : {};
      const updateData: Record<string, any> = {
        is_checkout_room: true,
        checkout_time: nowIso(),
        updated_at: nowIso(),
        pms_metadata: {
          ...existingMeta,
          checkedOutToday: true,
          readyToClean: true,
          checkedOutAt: nowIso(),
        },
      };
      // Only touch status when no housekeeper is actively working the room.
      // Otherwise the assignment/pms_hold flow governs the transition.
      if (!hasActiveAssignment && localRoom.status !== "dirty") {
        updateData.status = "dirty";
      }

      const { error: updErr } = await service
        .from("rooms")
        .update(updateData)
        .eq("id", localRoom.id);
      if (updErr) throw updErr;


      // Only emit when this is a *new* signal (status flipped to checkout).
      if (!wasCheckout) {
        const conflicts = (existingAsg ?? []).filter(
          (a: any) => a.assignment_type !== "checkout_cleaning",
        );
        const isConflict = conflicts.length > 0;
        const { data: evt } = await service
          .from("pms_change_events")
          .insert({
            hotel_id: hotelId,
            room_id: localRoom.id,
            room_label: localRoom.room_number || rawName,
            event_type: "checkout_confirmed",
            source: "poll_checkouts",
            previo_reservation_id: reservationId || null,
            before: { is_checkout_room: false, status: localRoom.status },
            after: { is_checkout_room: true, status: "dirty" },
            is_conflict: isConflict,
            conflicts_with_assignment_id: conflicts[0]?.id ?? null,
          })
          .select("id")
          .single();
        result.events++;
        if (isConflict) {
          result.conflicts++;
          await service
            .from("room_assignments")
            .update({
              pms_hold: true,
              pms_hold_reason: "Guest checked out — assignment type may need to change",
              pms_hold_event_id: evt?.id ?? null,
              updated_at: nowIso(),
            })
            .in("id", conflicts.map((c: any) => c.id));
        }
      }

      // Auto-release checkout-cleaning assignments (they're now safe to start).
      const { data: released } = await service
        .from("room_assignments")
        .update({ ready_to_clean: true, updated_at: nowIso() })
        .select("id")
        .eq("room_id", localRoom.id)
        .eq("assignment_date", today)
        .eq("assignment_type", "checkout_cleaning")
        .in("status", ["assigned", "in_progress"])
        .or("ready_to_clean.is.false,ready_to_clean.is.null");
      result.marked += released?.length ?? 0;
    } catch (e: any) {
      result.errors.push(`${r.name}: ${e?.message || e}`);
    }
  }

  // 4. Clear stale checkout flags (guest now back, or earlier false positive).
  // NEVER clear a room that is still scheduled to depart today or already
  // marked checked-out today via the PMS upload / sync — otherwise a poll
  // that only sees statusId=5 (already-departed) reservations would wipe
  // legitimate scheduled-departure rooms out of the checkout bucket.
  try {
    const { data: stale } = await service
      .from("rooms")
      .select("id, room_number, pms_metadata")
      .in("hotel", hotelKeys)
      .eq("is_checkout_room", true);
    const staleRows = (stale ?? []).filter((r: any) => {
      if (trueCheckoutRoomIds.has(r.id)) return false;
      const meta = r.pms_metadata || {};
      if (meta.scheduledDepartureToday === true) return false;
      if (meta.checkedOutToday === true) return false;
      const lastRefresh = meta.lastPmsRefreshDate || meta.pmsUploadDate;
      if (lastRefresh === today) return false; // trust today's upload/sync
      return true;
    });
    if (staleRows.length > 0) {
      const ids = staleRows.map((r: any) => r.id);
      await service
        .from("rooms")
        .update({ is_checkout_room: false, checkout_time: null, updated_at: nowIso() })
        .in("id", ids);
      result.cleared = ids.length;
      const evtRows = staleRows.map((r: any) => ({
        hotel_id: hotelId,
        room_id: r.id,
        room_label: r.room_number,
        event_type: "checkout_cleared",
        source: "poll_checkouts",
        before: { is_checkout_room: true },
        after: { is_checkout_room: false },
        is_conflict: false,
      }));
      if (evtRows.length) await service.from("pms_change_events").insert(evtRows);
      result.events += evtRows.length;
    }
  } catch (e: any) {
    result.errors.push(`stale cleanup: ${e?.message || e}`);
  }

  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {

    const body = await req.json().catch(() => ({} as any));
    const hotelIdInput: string = body?.hotelId || "";
    const isCronTrigger = body?.trigger === "cron";

    const authHeader = req.headers.get("Authorization") || "";
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const service = createClient(SUPABASE_URL, SERVICE);

    let isServiceCall = false;
    let userId: string | null = null;
    let profile: any = null;

    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      if (token === SERVICE) {
        isServiceCall = true;
      } else if (token && token !== ANON) {
        const anon = createClient(SUPABASE_URL, ANON);
        const { data: userRes } = await anon.auth.getUser(token);
        if (userRes?.user) {
          userId = userRes.user.id;
          const { data: p } = await service
            .from("profiles").select("role, assigned_hotel")
            .eq("id", userId).maybeSingle();
          profile = p;
        }
      }
    }

    // Cron fan-out: anonymous trigger allowed when no hotelId targeted.
    if (!isServiceCall && !userId && !isCronTrigger) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve which hotels to poll.
    let targets: { hotel_id: string; pms_hotel_id: any; credentials_secret_name: string }[] = [];
    if (hotelIdInput) {
      if (!isServiceCall) {
        const isAdmin = profile?.role === "admin" || profile?.role === "top_management";
        if (!isAdmin && profile?.assigned_hotel !== hotelIdInput) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      const { data: cfg } = await service
        .from("pms_configurations")
        .select("hotel_id, pms_hotel_id, credentials_secret_name, settings")
        .eq("hotel_id", hotelIdInput)
        .eq("pms_type", "previo")
        .eq("is_active", true)
        .maybeSingle();
      if (!cfg) {
        return new Response(JSON.stringify({ error: `No active Previo config for ${hotelIdInput}` }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if ((cfg as any).settings?.disable_checkout_poll) {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "disabled in settings" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      targets.push(cfg as any);
    } else {
      // Fan-out: service-role OR cron trigger only.
      if (!isServiceCall && !isCronTrigger) {
        return new Response(JSON.stringify({ error: "hotelId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: cfgs } = await service
        .from("pms_configurations")
        .select("hotel_id, pms_hotel_id, credentials_secret_name, settings")
        .eq("pms_type", "previo")
        .eq("is_active", true);
      targets = (cfgs ?? []).filter((c: any) => !c.settings?.disable_checkout_poll) as any;
    }

    const perHotel: PollResult[] = [];
    for (const t of targets) {
      try {
        const r = await pollOneHotel(service, t.hotel_id, t);
        perHotel.push(r);
        await service.from("pms_sync_history").insert({
          sync_type: "checkouts_poll",
          direction: "from_previo",
          hotel_id: t.hotel_id,
          data: r,
          changed_by: userId,
          sync_status: r.errors.length ? "partial" : "success",
          error_message: r.errors.length ? r.errors.slice(0, 5).join(" | ") : null,
        });
      } catch (e: any) {
        perHotel.push({
          hotel_id: t.hotel_id, checked: 0, marked: 0, cleared: 0,
          events: 0, conflicts: 0, errors: [e?.message || String(e)],
          unmatched: [], reservationFetchError: null,
        });
      }
    }

    const totals = perHotel.reduce(
      (acc, r) => ({
        marked: acc.marked + r.marked,
        cleared: acc.cleared + r.cleared,
        events: acc.events + r.events,
        conflicts: acc.conflicts + r.conflicts,
        errors: acc.errors + r.errors.length,
      }),
      { marked: 0, cleared: 0, events: 0, conflicts: 0, errors: 0 },
    );

    return new Response(JSON.stringify({ ok: true, hotels: perHotel.length, ...totals, perHotel }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

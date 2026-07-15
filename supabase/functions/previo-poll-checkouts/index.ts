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
import { callPrevioXml, loadPrevioCredentials } from "../_shared/previoCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PrevioRoom {
  roomId: number;
  name: string;
  roomCleanStatusId?: number;
  cleanStatusId?: number;
  roomCleanStatus?: number | string | { id?: number | string; name?: string };
  cleanStatus?: number | string | { id?: number | string; name?: string };
  reservation?: {
    arrivalDate?: string;
    departureDate?: string;
    arrival?: string;
    departure?: string;
    from?: string;
    to?: string;
    statusId?: number | string;
    reservationStatusId?: number | string;
    cosId?: number | string;
    commissionStatusId?: number | string;
    roomReservationStatusId?: number | string;
    status?: number | string | { id?: number | string; name?: string };
    state?: string;
  } | null;
}

const todayUtc = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const addDays = (base: string, n: number) => {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const extractNum = (raw: string) => {
  const m = String(raw ?? "").match(/\d+/);
  return m ? m[0] : String(raw ?? "").trim();
};
const cleanDate = (raw: unknown) => {
  const s = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
};
const statusToken = (raw: unknown): string => {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return statusToken(obj.id ?? obj.name ?? obj.status ?? obj.value);
  }
  return String(raw ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
};
const isCheckedOutStatus = (raw: unknown) => {
  const n = Number(raw);
  if (Number.isFinite(n) && (n === 5 || n === 9)) return true;
  const t = statusToken(raw);
  return ["5", "9", "checkedout", "checkedouttoday", "departed", "departure", "left", "leaved"].includes(t);
};
const reservationLooksCheckedOut = (res: any) => {
  if (!res || typeof res !== "object") return false;
  return isCheckedOutStatus(res.statusId)
    || isCheckedOutStatus(res.reservationStatusId)
    || isCheckedOutStatus(res.cosId)
    || isCheckedOutStatus(res.commissionStatusId)
    || isCheckedOutStatus(res.roomReservationStatusId)
    || isCheckedOutStatus(res.status)
    || isCheckedOutStatus(res.state)
    || res.checkedOut === true
    || res.isCheckedOut === true
    || res.departed === true
    || res.isDeparted === true;
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
  departed: number;
  diagnostics: Array<Record<string, unknown>>;
  revertedCheckedOut: number;
  heldAssignments: number;
}

async function pollOneHotel(
  service: any,
  hotelId: string,
  cfg: { credentials_secret_name: string; pms_hotel_id: any },
  dryRun = false,
): Promise<PollResult> {
  const result: PollResult = {
    hotel_id: hotelId,
    checked: 0, marked: 0, cleared: 0, events: 0, conflicts: 0,
    errors: [], unmatched: [], reservationFetchError: null, departed: 0, diagnostics: [],
    revertedCheckedOut: 0, heldAssignments: 0,
  };

  const { data: hotelCfg } = await service
    .from("hotel_configurations")
    .select("hotel_name")
    .eq("hotel_id", hotelId)
    .maybeSingle();
  const hotelKeys = Array.from(new Set([hotelId, (hotelCfg as any)?.hotel_name].filter(Boolean)));

  const { data: localScheduled } = await service
    .from("rooms")
    .select("id, room_number, is_checkout_room, pms_metadata")
    .in("hotel", hotelKeys)
    .or("is_checkout_room.eq.true,pms_metadata->>scheduledDepartureToday.eq.true")
    .limit(50);
  const localScheduledRooms = (localScheduled ?? []) as any[];
  const localScheduledByName = new Map<string, any>();
  const localScheduledByObjId = new Map<number, any>();
  for (const local of localScheduledRooms) {
    const name = String(local.room_number ?? "").trim();
    const num = extractNum(name);
    if (name) localScheduledByName.set(name, local);
    if (num && num !== name) localScheduledByName.set(num, local);
    const objId = Number(local.pms_metadata?.roomId);
    if (Number.isFinite(objId) && objId > 0) localScheduledByObjId.set(objId, local);
  }

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

  // 2. Identify today's departures. REST is the primary source, but Previo's
  // REST reservation payload is not perfectly consistent across tenants/test
  // accounts: statusId may arrive as a string, a nested status object, or the
  // reservation may disappear from the room after checkout. For REST-credential
  // hotels we therefore add the same XML searchReservations evidence used by
  // manual PMS Refresh. ApiKey/XML-only tenants like Ottofiori keep using REST
  // only, so the previously working clean-status push is untouched.
  const today = todayUtc();
  const checkedOutByName = new Map<string, string>(); // name -> reservationId ("" — REST /rest/rooms does not expose one)
  const checkedOutByObjId = new Map<number, string>();
  const checkoutSignals: Array<{ name: string; objId: number | null; reservationId: string; source: string }> = [];
  const addCheckoutSignal = (nameRaw: unknown, objIdRaw: unknown, reservationId: unknown, source: string) => {
    const name = String(nameRaw ?? "").trim();
    const objId = Number(objIdRaw);
    const safeObjId = Number.isFinite(objId) && objId > 0 ? objId : null;
    const safeReservationId = String(reservationId ?? "").trim();
    if (!name && !safeObjId) return;
    checkoutSignals.push({ name, objId: safeObjId, reservationId: safeReservationId, source });
    if (name) {
      checkedOutByName.set(name, safeReservationId);
      const num = extractNum(name);
      if (num && num !== name) checkedOutByName.set(num, safeReservationId);
    }
    if (safeObjId != null) checkedOutByObjId.set(safeObjId, safeReservationId);
  };

  for (const r of rooms) {
    const res: any = r.reservation;
    const exactLocalMatch = localScheduledByObjId.get(Number(r.roomId));
    const localMatch = exactLocalMatch
      ?? localScheduledByName.get(String(r.name ?? "").trim())
      ?? localScheduledByName.get(extractNum(String(r.name ?? "")));
    const localScheduledDepartureToday = localMatch?.pms_metadata?.scheduledDepartureToday === true;
    if (!res) {
      if (localMatch) {
        result.diagnostics.push({
          source: "rest-room",
          room: r.name,
          roomId: r.roomId,
          localRoom: localMatch.room_number,
          localScheduledDepartureToday,
          localIsCheckoutRoom: localMatch.is_checkout_room === true,
          roomCleanStatus: r.roomCleanStatusId ?? r.cleanStatusId ?? null,
          reservationPresent: false,
          accepted: false,
          reason: "no reservation payload from Previo REST; room clean status alone is not enough evidence to mark checked-out",
        });
      }
      continue;
    }
    const departure = cleanDate(res.departureDate ?? res.departure ?? res.to);
    const checkedOut = reservationLooksCheckedOut(res);
    if (departure === today || checkedOut || localMatch) {
      result.diagnostics.push({
        source: "rest-room",
        room: r.name,
        roomId: r.roomId,
        localRoom: localMatch?.room_number ?? null,
        localScheduledDepartureToday,
        localIsCheckoutRoom: localMatch?.is_checkout_room === true,
        reservationPresent: true,
        departure,
        statusId: res.statusId ?? null,
        reservationStatusId: res.reservationStatusId ?? null,
        cosId: res.cosId ?? null,
        commissionStatusId: res.commissionStatusId ?? null,
        roomReservationStatusId: res.roomReservationStatusId ?? null,
        status: typeof res.status === "object" ? JSON.stringify(res.status).slice(0, 120) : res.status ?? null,
        roomCleanStatus: r.roomCleanStatusId ?? r.cleanStatusId ?? null,
        checkedOut,
        accepted: checkedOut && departure === today,
      });
    }
    if (!checkedOut || departure !== today) continue;
    addCheckoutSignal(r.name, r.roomId, res.reservationId ?? res.id ?? "", "rest-room-reservation");
  }

  try {
    const creds = loadPrevioCredentials(cfg.credentials_secret_name);
    const xmlResult = await callPrevioXml({
      method: "searchReservations",
      creds,
      pmsHotelId: String(cfg.pms_hotel_id || ""),
      extraXml: `<term><from>${today}</from><to>${addDays(today, 1)}</to></term>`,
    });
    if (!xmlResult.ok) {
      // Best-effort only. Ottofiori's REST ApiKey is known to reject the XML
      // endpoint with 401, but REST polling still works there. Keep the poll
      // successful and only expose the XML miss as diagnostics.
      result.diagnostics.push({
        source: "xml-searchReservations",
        accepted: false,
        status: xmlResult.status,
        reason: xmlResult.errorMessage || xmlResult.text.slice(0, 120),
      });
    } else {
      const blocks = xmlResult.text.match(/<reservation>[\s\S]*?<\/reservation>/g) || [];
      const grab = (s: string, tag: string) => {
        const m = s.match(new RegExp(`<${tag}>([^<]*)<\/${tag}>`));
        return m ? m[1].trim() : "";
      };
      for (const block of blocks) {
        const departure = cleanDate(grab(block, "to"));
        const statusId = grab(block, "statusId");
        if (departure !== today || !isCheckedOutStatus(statusId)) continue;
        const objMatch = block.match(/<object>[\s\S]*?<objId>(\d+)<\/objId>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/object>/);
        const reservationId = grab(block, "resId") || grab(block, "reservationId") || grab(block, "id");
        const objId = objMatch ? objMatch[1] : "";
        const roomName = objMatch ? objMatch[2].trim() : "";
        result.diagnostics.push({
          source: "xml-searchReservations",
          room: roomName,
          roomId: objId || null,
          departure,
          statusId,
          accepted: true,
        });
        addCheckoutSignal(roomName, objId, reservationId, "xml-searchReservations");
      }
    }
  } catch (e: any) {
    result.diagnostics.push({
      source: "xml-searchReservations",
      accepted: false,
      reason: e?.message || String(e),
    });
  }

  const trueCheckoutRoomIds = new Set<string>();
  const departedRoomMap = new Map<string, PrevioRoom>();
  for (const r of rooms.filter((r) =>
    checkedOutByObjId.has(r.roomId) || checkedOutByName.has(r.name),
  )) {
    departedRoomMap.set(`${r.roomId || ""}:${r.name || ""}`, r);
  }
  for (const sig of checkoutSignals) {
    if (![...departedRoomMap.values()].some((r) =>
      (sig.objId != null && Number(r.roomId) === sig.objId) || (sig.name && String(r.name).trim() === sig.name),
    )) {
      departedRoomMap.set(`${sig.objId || ""}:${sig.name || ""}`, {
        roomId: sig.objId ?? 0,
        name: sig.name,
      });
    }
  }
  const departedRooms = [...departedRoomMap.values()];
  result.departed = departedRooms.length;


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

      if (dryRun) {
        result.marked += (existingAsg ?? []).filter((a: any) => a.assignment_type === "checkout_cleaning").length;
        continue;
      }

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
        .in("status", ["assigned", "in_progress"]);
      result.marked += released?.length ?? 0;
    } catch (e: any) {
      result.errors.push(`${r.name}: ${e?.message || e}`);
    }
  }

  // 3.5. Reconcile false positives: any local room currently flagged as
  // checkedOutToday whose Previo REST payload still shows an active in-house
  // reservation (departure later than today, or departure=today without a
  // checked-out status) is reverted so HC does not send housekeepers to an
  // occupied room. This self-heals stale flags stamped by earlier versions
  // of the poll or by aggressive manual marking.
  try {
    if (!dryRun) {
      const { data: flagged } = await service
        .from("rooms")
        .select("id, room_number, status, pms_metadata, is_checkout_room")
        .in("hotel", hotelKeys)
        .filter("pms_metadata->>checkedOutToday", "eq", "true");
      const roomsByObjId = new Map<number, PrevioRoom>();
      const roomsByName = new Map<string, PrevioRoom>();
      for (const pr of rooms) {
        const oid = Number(pr.roomId);
        if (Number.isFinite(oid) && oid > 0) roomsByObjId.set(oid, pr);
        const nm = String(pr.name ?? "").trim();
        if (nm) roomsByName.set(nm, pr);
      }
      const revertEvents: any[] = [];
      for (const local of (flagged ?? []) as any[]) {
        if (trueCheckoutRoomIds.has(local.id)) continue; // just re-verified this run
        const meta = local.pms_metadata || {};
        const objId = Number(meta.roomId);
        const previoName = String(meta.previoName ?? "").trim();
        const pr = (Number.isFinite(objId) && objId > 0 && roomsByObjId.get(objId))
          || (previoName && roomsByName.get(previoName))
          || null;
        const res: any = pr?.reservation;
        let revertReason = "";
        if (res && reservationLooksCheckedOut(res)) {
          continue; // Previo confirms departure — keep flagged
        }
        if (res) {
          const dep = cleanDate(res.departureDate ?? res.departure ?? res.to);
          if (dep && dep > today) {
            revertReason = `Previo still reports active reservation (departure=${dep})`;
          } else {
            continue; // reservation present, departs today, not marked checked-out — ambiguous, leave as-is
          }
        } else if (pr) {
          // Previo returned this room in the roster but with NO reservation
          // payload. That alone is not proof of checkout — earlier versions of
          // this poll wrongly stamped this as a departure. Require a real
          // corroborating event (from either the accept path today OR a prior
          // legitimate checkout_confirmed row) before trusting the flag.
          const { data: confirmEvt } = await service
            .from("pms_change_events")
            .select("id")
            .eq("hotel_id", hotelId)
            .eq("room_id", local.id)
            .eq("event_type", "checkout_confirmed")
            .gte("detected_at", `${today}T00:00:00Z`)
            .limit(1);
          if ((confirmEvt ?? []).length > 0) continue; // legitimately confirmed earlier today
          revertReason = "no reservation payload from Previo and no confirming checkout event today";
        } else {
          continue; // room not in Previo roster at all — do not touch
        }

        const { checkedOutAt: _a, readyToClean: _b, ...restMeta } = meta;
        const newMeta = { ...restMeta, checkedOutToday: false };
        const { error: updErr } = await service.from("rooms").update({
          is_checkout_room: false,
          checkout_time: null,
          pms_metadata: newMeta,
          updated_at: nowIso(),
        }).eq("id", local.id);
        if (updErr) {
          result.errors.push(`reconcile ${local.room_number}: ${updErr.message}`);
          continue;
        }

        // Hold any active checkout_cleaning assignment for today so the HK
        // does not walk into an occupied room. Preserve in-progress work.
        const { data: held } = await service
          .from("room_assignments")
          .update({
            pms_hold: true,
            pms_hold_reason: "Previo still shows guest in-house — checkout flag was reverted",
            ready_to_clean: false,
            updated_at: nowIso(),
          })
          .select("id")
          .eq("room_id", local.id)
          .eq("assignment_date", today)
          .eq("assignment_type", "checkout_cleaning")
          .in("status", ["assigned", "in_progress"]);
        result.heldAssignments += held?.length ?? 0;

        revertEvents.push({
          hotel_id: hotelId,
          room_id: local.id,
          room_label: local.room_number,
          event_type: "checkout_reverted",
          source: "poll_checkouts_reconcile",
          before: { is_checkout_room: true, checkedOutToday: true },
          after: { is_checkout_room: false, checkedOutToday: false },
          is_conflict: false,
        });
        result.diagnostics.push({
          source: "reconcile",
          room: local.room_number,
          roomId: objId || null,
          reason: `Previo still reports active reservation (departure=${dep}); reverting false checkout`,
          accepted: false,
        });
        result.revertedCheckedOut++;
      }
      if (revertEvents.length) {
        await service.from("pms_change_events").insert(revertEvents);
        result.events += revertEvents.length;
      }
    }
  } catch (e: any) {
    result.errors.push(`reconcile: ${e?.message || e}`);
  }

  // 4. Clear stale checkout flags (guest now back, or earlier false positive).
  // NEVER clear a room that is still scheduled to depart today or already
  // marked checked-out today via the PMS upload / sync — otherwise a poll
  // that only sees statusId=5 (already-departed) reservations would wipe
  // legitimate scheduled-departure rooms out of the checkout bucket.
  try {
    if (dryRun) return result;
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
    const dryRun = body?.dryRun === true;

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
        const r = await pollOneHotel(service, t.hotel_id, t, dryRun);
        perHotel.push(r);
        if (!dryRun) {
          await service.from("pms_sync_history").insert({
            sync_type: "checkouts_poll",
            direction: "from_previo",
            hotel_id: t.hotel_id,
            data: r,
            changed_by: userId,
            sync_status: r.errors.length ? "partial" : "success",
            error_message: r.errors.length ? r.errors.slice(0, 5).join(" | ") : null,
          });
        }
      } catch (e: any) {
        perHotel.push({
          hotel_id: t.hotel_id, checked: 0, marked: 0, cleared: 0,
          events: 0, conflicts: 0, errors: [e?.message || String(e)],
          unmatched: [], reservationFetchError: null, departed: 0, diagnostics: [],
          revertedCheckedOut: 0, heldAssignments: 0,
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

    return new Response(JSON.stringify({ ok: true, dryRun, hotels: perHotel.length, ...totals, perHotel }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

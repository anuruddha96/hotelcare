// Shared PMS refresh routine used by both the manual PmsRefreshButton and
// the LiveSync auto-sync on login. Pulls today's snapshot from Previo and
// updates only PMS-derived fields on `rooms` — never touches assignments.

import { supabase } from "@/integrations/supabase/client";
import { resolveHotelKeys } from "@/lib/hotelKeys";

export type PmsSyncStatus = "success" | "partial" | "error" | "idle";

export interface PmsSyncResult {
  status: PmsSyncStatus;
  updated: number;
  total: number;
  notFound: number;
  checkouts: number;
  errors: string[];
  proposedChanges?: ProposedRoomChange[];
  unmapped?: Array<{ pms_room_id: string; pms_room_name: string; room_kind_name: string; extracted_number: string }>;
}

/**
 * A per-room diff between the app's current state and what the PMS refresh
 * would set. Used by the preview dialog so managers can review before
 * applying. Populated for every fetched row (including "no change" rows so
 * the UI can show a complete room-by-room summary).
 */
export interface ProposedRoomChange {
  roomKey: string;                // stable id (local room id or PMS room name)
  roomLabel: string;              // display room number
  isNewChange: boolean;           // false => "no change" row
  fields: Array<{
    field: string;                // human label
    before: any;
    after: any;
    category: "status" | "occupancy" | "checkout" | "guest" | "note" | "linen";
  }>;
  raw: {
    row: any;
    currentStatus?: string;
    currentGuestCount?: number;
    currentIsCheckoutRoom?: boolean;
  };
}

const extractRoomNumber = (raw: string): string => {
  const m = String(raw).match(/\d+/);
  return m ? m[0] : String(raw).trim();
};

const excelTimeToString = (val: any): string | null => {
  if (val === null || val === undefined || val === "") return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
};

const parseNightTotal = (val: any): { currentNight: number; totalNights: number } | null => {
  if (!val) return null;
  const m = String(val).match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  return { currentNight: parseInt(m[1], 10), totalNights: parseInt(m[2], 10) };
};

/**
 * Fetch the PMS snapshot and (optionally) apply it to the `rooms` table.
 * When `dryRun` is true, no writes are performed and `proposedChanges` is
 * returned so the UI can render a preview.
 */
export async function runPmsRefresh(
  hotelId: string,
  options: { dryRun?: boolean } = {},
): Promise<PmsSyncResult> {
  const dryRun = options.dryRun === true;

  // Step 1 — sync rooms catalog + mapping. Safe in dry-run because
  // `mapOnly:true` never writes to public.rooms; it only heals
  // pms_room_mappings and reports back any Previo rooms we couldn't
  // auto-match. In apply-mode we send `importLocal:true` so hotels with
  // room_import_enabled also get their room roster upserted.
  let unmapped: PmsSyncResult["unmapped"] = [];
  try {
    const { data: mapData } = await supabase.functions.invoke("previo-sync-rooms", {
      body: dryRun ? { hotelId, mapOnly: true } : { hotelId, importLocal: true },
    });
    const res = (mapData as any)?.results;
    if (res && Array.isArray(res.unmapped)) unmapped = res.unmapped;
  } catch (e) {
    console.warn("[pmsRefresh] catalog sync warning:", e);
  }

  // Step 2 — pull today's PMS snapshot.
  const { data, error } = await supabase.functions.invoke("previo-pms-sync", {
    body: { hotelId, dryRun },
  });
  if (error || (data && (data as any).ok === false)) {
    throw new Error((data as any)?.error || error?.message || "PMS sync failed");
  }
  const rows: any[] = (data as any)?.rows || [];
  const pmsCheckoutSignals =
    Number((data as any)?.departuresToday ?? 0) +
    Number((data as any)?.departuresTomorrow ?? 0) +
    Number((data as any)?.checkedOutToday ?? 0);
  const weakReservationSnapshot = rows.length > 0 && pmsCheckoutSignals === 0;
  if (rows.length === 0) {
    return {
      status: "success", updated: 0, total: 0, notFound: 0, checkouts: 0, errors: [],
      proposedChanges: dryRun ? [] : undefined,
      unmapped,
    };
  }

  const keys = await resolveHotelKeys(hotelId);
  const hotelKeys = keys.length ? keys : [hotelId];
  const canonicalHotelKey = hotelKeys.find((key) => key !== hotelId) ?? hotelId;

  let updated = 0;
  let notFound = 0;
  let checkouts = 0;
  const errors: string[] = [];
  const proposedChanges: ProposedRoomChange[] = [];
  const today = new Date().toISOString().split("T")[0];
  const matchedRoomIds = new Set<string>();

  for (const row of rows) {
    try {
      const rawRoomName = String(row.Room ?? "").trim();
      if (!rawRoomName) continue;
      const roomNumber = extractRoomNumber(rawRoomName);
      const previoRoomId = row.RoomId != null ? String(row.RoomId) : "";

      const lookup = async (matcher: (q: any) => any) => {
        const q = supabase.from("rooms")
          .select("id, hotel, room_number, status, guest_count, is_checkout_room, pms_metadata")
          .in("hotel", hotelKeys);
        return await matcher(q);
      };

      let { data: roomsFound } = await lookup((q) => q.eq("room_number", rawRoomName));
      if ((!roomsFound || roomsFound.length === 0) && rawRoomName !== roomNumber) {
        ({ data: roomsFound } = await lookup((q) => q.ilike("room_number", rawRoomName)));
      }
      if ((!roomsFound || roomsFound.length === 0) && roomNumber && roomNumber !== rawRoomName) {
        ({ data: roomsFound } = await lookup((q) => q.eq("room_number", roomNumber)));
      }
      if ((!roomsFound || roomsFound.length === 0) && previoRoomId) {
        ({ data: roomsFound } = await lookup((q) =>
          q.filter("pms_metadata->>roomId", "eq", previoRoomId),
        ));
      }
      if (!roomsFound || roomsFound.length === 0) {
        notFound++;
        if (dryRun) {
          proposedChanges.push({
            roomKey: `pms:${rawRoomName}`,
            roomLabel: rawRoomName,
            isNewChange: true,
            fields: [{ field: "Room match", before: "(not found in app)", after: "(unmapped)", category: "note" }],
            raw: { row },
          });
        }
        continue;
      }
      const room: any = [...roomsFound].sort((a: any, b: any) => {
        const score = (candidate: any) =>
          (candidate.hotel === canonicalHotelKey ? 100 : 0) +
          (candidate.pms_metadata?.roomId ? 20 : 0) +
          (candidate.is_checkout_room ? 5 : 0);
        return score(b) - score(a);
      })[0];
      matchedRoomIds.add(room.id);

      const departureParsed = excelTimeToString(row.Departure);
      const isScheduledDeparture = departureParsed !== null;
      const isDepartureTomorrow = row.DepartureTomorrow === true;
      const isCheckedOut = row.CheckedOut === true;
      // Authoritative checkout-room flag: only real checkout or scheduled
      // departure TODAY. Departure-tomorrow rooms remain daily rooms and
      // are marked via the C/O+1 badge (scheduledDepartureTomorrow metadata).
      const shouldBeCheckoutRoom = row.IsCheckoutRoom === true || isCheckedOut || isScheduledDeparture;

      const existingMetadata = room.pms_metadata && typeof room.pms_metadata === "object"
        ? room.pms_metadata
        : undefined;

      const nightTotal = parseNightTotal(row["Night / Total"]);
      let guestNightsStayed = 0;
      let towel = false;
      let linen = false;
      if (nightTotal) {
        guestNightsStayed = nightTotal.currentNight;
        if (guestNightsStayed >= 3) {
          const cyc = (guestNightsStayed - 3) % 4;
          if (cyc === 0) towel = true;
          else if (cyc === 2) linen = true;
        }
      }

      const previoStatusRaw = row.Status ? String(row.Status).trim().toLowerCase() : "";
      const mappedStatus =
        previoStatusRaw === "" ? null
        : previoStatusRaw.startsWith("clean") ? "clean"
        : "dirty";

      const nextGuestCount = Number(row.People ?? 0);

      // Compute the diff for the preview.
      const changeFields: ProposedRoomChange["fields"] = [];
      if (mappedStatus && room.status && mappedStatus !== room.status) {
        changeFields.push({
          field: "Clean status", before: room.status, after: mappedStatus, category: "status",
        });
      }
      if (typeof room.guest_count === "number" && room.guest_count !== nextGuestCount) {
        changeFields.push({
          field: "Guests", before: room.guest_count, after: nextGuestCount, category: "guest",
        });
      }
      const currentCheckoutFlag = !!room.is_checkout_room;
      const preserveExistingCheckout = weakReservationSnapshot && currentCheckoutFlag && !shouldBeCheckoutRoom;
      const effectiveCheckoutFlag = preserveExistingCheckout ? true : shouldBeCheckoutRoom;
      if (effectiveCheckoutFlag !== currentCheckoutFlag) {
        const label = isCheckedOut
          ? "Checked out"
          : isScheduledDeparture
            ? "Departure today"
            : isDepartureTomorrow
              ? "Departure tomorrow"
              : preserveExistingCheckout
                ? "Preserved — PMS reservation data unavailable"
                : "No checkout";
        changeFields.push({
          field: "Checkout room", before: currentCheckoutFlag, after: `${effectiveCheckoutFlag} (${label})`, category: "checkout",
        });
      }
      if (towel || linen) {
        changeFields.push({
          field: "Linen/towel", before: "-", after: `${linen ? "linen" : ""}${towel && linen ? " + " : ""}${towel ? "towel" : ""}`, category: "linen",
        });
      }
      if (row.Note) {
        changeFields.push({ field: "PMS note", before: "-", after: String(row.Note), category: "note" });
      }

      proposedChanges.push({
        roomKey: `id:${room.id}`,
        roomLabel: room.room_number || rawRoomName,
        isNewChange: changeFields.length > 0,
        fields: changeFields,
        raw: {
          row,
          currentStatus: room.status,
          currentGuestCount: room.guest_count,
          currentIsCheckoutRoom: currentCheckoutFlag,
        },
      });

      // Dry-run: skip all writes.
      if (dryRun) {
        continue;
      }

      const updateData: Record<string, any> = {
        guest_count: nextGuestCount,
        guest_nights_stayed: guestNightsStayed,
        towel_change_required: towel,
        linen_change_required: linen,
        updated_at: new Date().toISOString(),
        pms_metadata: {
          ...(existingMetadata ?? {}),
          pmsSyncDate: today,
          lastPmsRefreshDate: today,
          scheduledDepartureToday: preserveExistingCheckout
            ? existingMetadata?.scheduledDepartureToday
            : isScheduledDeparture,
          scheduledDepartureTomorrow: preserveExistingCheckout
            ? existingMetadata?.scheduledDepartureTomorrow
            : isDepartureTomorrow,
          departureTime: preserveExistingCheckout
            ? existingMetadata?.departureTime
            : departureParsed,
          checkedOutToday: preserveExistingCheckout
            ? existingMetadata?.checkedOutToday
            : isCheckedOut,
        },
      };
      if (mappedStatus) {
        updateData.status = mappedStatus;
        if (mappedStatus === "clean") {
          updateData.last_cleaned_at = new Date().toISOString();
        }
      }
      // Always write the authoritative checkout flag so rooms that are no
      // longer departing today/tomorrow get reset to false. Preserve any
      // manual override (manager toggled it in the UI). If the PMS response
      // contains no checkout signals at all, treat it as a weak/partial feed
      // and never clear an existing checkout flag from that response.
      const manualOverride = existingMetadata?.manual_checkout === true;
      if (!preserveExistingCheckout) {
        updateData.is_checkout_room = manualOverride ? true : shouldBeCheckoutRoom;
      }
      if (isCheckedOut) updateData.checkout_time = new Date().toISOString();
      if (towel) updateData.last_towel_change = today;
      if (linen) updateData.last_linen_change = today;
      if (row.Note) updateData.notes = String(row.Note);

      // Emit pms_change_events for material changes.
      const eventInserts: any[] = [];
      const pushEvent = (event_type: string, before: any, after: any, is_conflict = false) => {
        eventInserts.push({
          hotel_id: hotelId,
          room_id: room.id,
          room_label: room.room_number || rawRoomName,
          event_type,
          source: "pms_sync",
          before, after, is_conflict,
        });
      };
      if (mappedStatus && room.status && mappedStatus !== room.status) {
        pushEvent("status_changed", { status: room.status }, { status: mappedStatus }, false);
      }
      if (isCheckedOut && !currentCheckoutFlag) {
        pushEvent("checkout_confirmed", { is_checkout_room: false }, { is_checkout_room: true }, false);
      }
      if (isDepartureTomorrow && !currentCheckoutFlag) {
        pushEvent("status_changed",
          { scheduledDepartureTomorrow: false },
          { scheduledDepartureTomorrow: true, reason: "departure_tomorrow_daily_room" }, false);
      }
      if (typeof room.guest_count === "number" && room.guest_count !== nextGuestCount) {
        const wasVacant = room.guest_count === 0;
        const nowOccupied = nextGuestCount > 0;
        const isConflict = wasVacant && nowOccupied;
        pushEvent(
          isConflict ? "room_newly_occupied" : "occupancy_changed",
          { guest_count: room.guest_count },
          { guest_count: nextGuestCount },
          isConflict,
        );
      }

      const { error: updErr } = await supabase
        .from("rooms")
        .update(updateData)
        .eq("id", room.id);
      if (updErr) {
        errors.push(`Room ${rawRoomName}: ${updErr.message}`);
        continue;
      }
      updated++;
      if (shouldBeCheckoutRoom || preserveExistingCheckout) checkouts++;

      if (eventInserts.length > 0) {
        const insertRes: any = await supabase
          .from("pms_change_events" as any)
          .insert(eventInserts)
          .select("id, is_conflict");
        const inserted: any[] = insertRes?.data ?? [];
        const conflictEvtId = inserted.find((e: any) => e.is_conflict)?.id;
        if (conflictEvtId) {
          const { data: existingAsg } = await supabase
            .from("room_assignments")
            .select("id, assignment_type")
            .eq("room_id", room.id)
            .eq("assignment_date", today)
            .in("status", ["assigned", "in_progress"]);
          const collide = (existingAsg ?? []).filter((a: any) => a.assignment_type !== "checkout_cleaning");
          if (collide.length > 0) {
            await supabase
              .from("room_assignments")
              .update({
                pms_hold: true,
                pms_hold_reason: "PMS reports room state change — review needed",
                pms_hold_event_id: conflictEvtId,
                updated_at: new Date().toISOString(),
              } as any)
              .in("id", collide.map((c: any) => c.id));
          }
        }
      }
    } catch (e: any) {
      errors.push(`Row error: ${e?.message || String(e)}`);
    }
  }

  const status: PmsSyncStatus = errors.length ? "partial" : "success";

  if (!dryRun) {
    if (hotelId === "previo-test") {
      try {
        await supabase.functions.invoke("previo-poll-checkouts", { body: { hotelId } });
      } catch (e) {
        console.warn("[pmsRefresh] poll-checkouts warning:", e);
      }
    }

    try {
      await supabase.from("pms_sync_history").insert({
        hotel_id: hotelId,
        sync_type: "rooms_refresh",
        sync_status: status,
        error_message: errors.length ? errors.slice(0, 5).join(" | ") : null,
        data: { updated, notFound, total: rows.length, checkouts },
      } as any);
    } catch { /* non-fatal */ }
  }

  return {
    status, updated, total: rows.length, notFound, checkouts, errors,
    proposedChanges: dryRun ? proposedChanges : undefined,
    unmapped,
  };
}

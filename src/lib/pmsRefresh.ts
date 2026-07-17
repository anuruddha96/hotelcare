// Shared PMS refresh routine used by both the manual PmsRefreshButton and
// the LiveSync auto-sync on login. Pulls today's snapshot from Previo and
// updates only PMS-derived fields on `rooms` — never touches assignments.

import { supabase } from "@/integrations/supabase/client";
import { resolveHotelKeys } from "@/lib/hotelKeys";
import { classifyPmsHousekeepingRow } from "@/lib/pmsClassification";
import { inferBedConfigFromNote } from "@/lib/bedConfigInference";
import { buildRoomNotes, parseRoomFlags } from "@/lib/room-service-flags";

const STALE_NOTE_PREFIXES = /^\s*(early checkout[^—-]*[-—]?\s*|no show\s*[-—]?\s*)/i;
const RESERVATION_NOTE_BLOB = /Booking\.com|Partner'?s room name|Commission note|Virtual [Cc]redit [Cc]ard|Cancellation Policy|Payment description|Payout type|Total price|Deposit Policy|Syst[ée]m\s*-/i;
const MANUAL_ROOM_OVERRIDE_KEYS = [
  "manual_checkout", "manual_checkout_at", "manual_checkout_by",
  "manual_daily", "manual_daily_at", "manual_daily_by",
  "manual_moved_at", "manual_moved_by",
];

// Previo concatenates all department-tab notes into a single `note` field,
// each prefixed with a Czech/English label: `Systém -` (OTA / channel-manager
// blob), `Recepce -` (reception), `Kuchyně -` (kitchen / breakfast),
// `Housekeeping -`, etc. Only the operational (non-Systém) sections are
// useful to the housekeeper — the Systém section is Booking.com pricing,
// commission, policies, and VCC data that must never surface.
const SECTION_LABEL_RE = /\b(Syst[ée]m|Recepce|Reception|Kuchyn[ěe]|Kitchen|Housekeeping|H[oó]zvezet[ée]s|Takar[ií]t[aá]s|Poznámka)\s*-\s*/gi;
const OTA_SECTION_LABEL_RE = /^(Syst[ée]m)$/i;
const PAYMENT_NOISE_RE = /\b(VCC\b[^.\n]*|Collect payment from guests[^.\n]*|Payment[^.\n]*|Virtual [Cc]redit [Cc]ard[^.\n]*)/gi;

const decodeHtmlEntities = (s: string): string =>
  s
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;039;|&#039;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&");

/**
 * Extract only the reception / housekeeping / kitchen sections from Previo's
 * concatenated `note` field. Drops the Systém (OTA) section and payment /
 * VCC noise. Returns null if nothing operational is left.
 */
export const extractHousekeepingSectionsFromRawNote = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  // Decode entities, strip HTML tags, collapse whitespace.
  const text = decodeHtmlEntities(String(raw))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  // Split on department labels while keeping the label as delimiter.
  const parts: Array<{ label: string; body: string }> = [];
  const matches = Array.from(text.matchAll(SECTION_LABEL_RE));
  if (matches.length === 0) {
    // No labels — if the whole thing is a reservation blob, drop it.
    return RESERVATION_NOTE_BLOB.test(text) ? null : text;
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const label = (m[1] || "").trim();
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const body = text.slice(start, end).trim();
    if (body) parts.push({ label, body });
  }

  const kept: string[] = [];
  for (const { label, body } of parts) {
    if (OTA_SECTION_LABEL_RE.test(label)) continue;                       // drop OTA blob
    if (RESERVATION_NOTE_BLOB.test(body)) continue;                       // drop any body that leaked OTA content
    const cleaned = body.replace(PAYMENT_NOISE_RE, " ").replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    kept.push(cleaned);
  }
  const joined = kept.join(" • ").trim();
  return joined || null;
};

const getDateOnly = (value: unknown): string | null => {
  if (!value) return null;
  const raw = String(value);
  const direct = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().split("T")[0];
};

const hasManualRoomOverride = (meta?: Record<string, any> | null): boolean =>
  !!meta && (meta.manual_checkout === true || meta.manual_daily === true || "manual_checkout" in meta || "manual_daily" in meta);

const isStaleManualRoomOverride = (meta: Record<string, any> | undefined, today: string): boolean => {
  if (!hasManualRoomOverride(meta)) return false;
  const manualDate = getDateOnly(meta?.manual_moved_at ?? meta?.manual_checkout_at ?? meta?.manual_daily_at);
  if (manualDate) return manualDate < today;
  const syncDate = getDateOnly(meta?.pmsSyncDate ?? meta?.lastPmsRefreshDate);
  return !!syncDate && syncDate < today;
};

const stripManualRoomOverride = (meta: Record<string, any> | undefined): Record<string, any> | undefined => {
  if (!meta) return undefined;
  const cleaned = { ...meta };
  for (const key of MANUAL_ROOM_OVERRIDE_KEYS) delete cleaned[key];
  return cleaned;
};

const cleanSyncedHousekeepingNote = (row: any): string | null => {
  // Prefer explicit internal-note field. Otherwise parse Previo's
  // concatenated `Note` field to extract only the non-Systém sections.
  const internal = row?.NoteInternal ? String(row.NoteInternal).trim() : "";
  if (internal && !RESERVATION_NOTE_BLOB.test(internal)) return internal;
  const parsed = extractHousekeepingSectionsFromRawNote(row?.Note ?? row?.NoteOta ?? null);
  return parsed;
};

export type PmsSyncStatus = "success" | "partial" | "error" | "idle";

export interface PmsSyncResult {
  status: PmsSyncStatus;
  updated: number;
  total: number;
  notFound: number;
  checkouts: number;
  errors: string[];
  managerMessage?: string;
  reservationDataAuthoritative?: boolean;
  reservationIssue?: Record<string, any> | null;
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
  const reservationDataAuthoritative = (data as any)?.reservationDataAuthoritative !== false;
  const managerFacingSuccess = (data as any)?.managerFacingSuccess === true;
  const reservationIssue = (data as any)?.reservationIssue ?? null;
  const reservationFetchError = (data as any)?.reservationFetchError ?? null;
  const reservationManagerMessage = !reservationDataAuthoritative && !managerFacingSuccess
    ? "PMS room list synced, but Previo did not send checkout/daily data. Room buckets were not changed."
    : undefined;
  if (rows.length === 0) {
    return {
      status: "success", updated: 0, total: 0, notFound: 0, checkouts: 0, errors: [],
      managerMessage: reservationManagerMessage,
      reservationDataAuthoritative,
      reservationIssue,
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
  const protectedCheckoutAssignmentRoomIds = new Set<string>();

  if (reservationManagerMessage) {
    errors.push(reservationManagerMessage!);
  }

  try {
    const { data: protectedAssignments } = await supabase
      .from("room_assignments")
      .select("room_id")
      .eq("assignment_date", today)
      .eq("assignment_type", "checkout_cleaning")
      .eq("status", "in_progress");
    for (const assignment of protectedAssignments ?? []) {
      if ((assignment as any).room_id) protectedCheckoutAssignmentRoomIds.add((assignment as any).room_id);
    }
  } catch (e) {
    console.warn("[pmsRefresh] checkout assignment protection skipped:", e);
  }

  // New-day DND reset: when the most recent PMS refresh for this hotel was
  // on an earlier calendar day, clear all DND flags so the new day starts
  // fresh. Runs once per calendar day (subsequent same-day refreshes are
  // no-ops because lastPmsRefreshDate is already today).
  if (!dryRun) {
    try {
      const { data: probe } = await supabase
        .from("rooms")
        .select("pms_metadata")
        .in("hotel", hotelKeys)
        .not("pms_metadata->>lastPmsRefreshDate", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastRefresh = (probe as any)?.pms_metadata?.lastPmsRefreshDate ?? null;
      if (!lastRefresh || lastRefresh < today) {
        // 1. Clear yesterday's DND flags.
        await supabase
          .from("rooms")
          .update({
            is_dnd: false,
            dnd_marked_at: null,
            dnd_marked_by: null,
            updated_at: new Date().toISOString(),
          })
          .in("hotel", hotelKeys)
          .eq("is_dnd", true);

        // 2. Strip stale manual bucket overrides + stale note prefixes from
        //    yesterday so today's PMS refresh can classify the room fresh.
        //    Same-day manual moves are unaffected (they're written after this
        //    block runs). We only touch rooms whose PMS metadata is older than
        //    today.
        const { data: staleRooms } = await supabase
          .from("rooms")
          .select("id, notes, pms_metadata")
          .in("hotel", hotelKeys);
        const cleanupUpdates: Array<Promise<any>> = [];
        for (const r of staleRooms ?? []) {
          const meta = (r as any).pms_metadata && typeof (r as any).pms_metadata === "object"
            ? { ...(r as any).pms_metadata }
            : null;
          const oldSyncDate = meta?.pmsSyncDate ?? meta?.lastPmsRefreshDate ?? null;
          const isStale = !oldSyncDate || oldSyncDate < today;
          if (!isStale) continue;

          const patch: Record<string, any> = {};
          if (meta) {
            let changed = false;
            for (const k of MANUAL_ROOM_OVERRIDE_KEYS) {
              if (k in meta) { delete meta[k]; changed = true; }
            }
            if (changed) patch.pms_metadata = meta;
          }
          const notes = (r as any).notes as string | null;
          if (notes) {
            let cleanedNotes: string | null = notes;
            if (STALE_NOTE_PREFIXES.test(cleanedNotes)) {
              cleanedNotes = cleanedNotes.replace(STALE_NOTE_PREFIXES, "").trim();
            }
            // Also strip Previo OTA reservation blobs that older refreshes
            // may have written into rooms.notes. Preserve any operational
            // (Recepce/Kuchyně/Housekeeping) sections if present.
            if (cleanedNotes && RESERVATION_NOTE_BLOB.test(cleanedNotes)) {
              const flags = parseRoomFlags(cleanedNotes);
              const rescued = extractHousekeepingSectionsFromRawNote(flags.cleanNotes);
              cleanedNotes = buildRoomNotes(
                {
                  collectExtraTowels: flags.collectExtraTowels,
                  roomCleaning: flags.roomCleaning,
                },
                rescued ?? "",
              ) || null;
            }
            if (cleanedNotes !== notes) patch.notes = cleanedNotes || null;
          }
          if (Object.keys(patch).length > 0) {
            patch.updated_at = new Date().toISOString();
            cleanupUpdates.push(
              (async () => {
                await supabase.from("rooms").update(patch).eq("id", (r as any).id);
              })(),
            );
          }
        }
        if (cleanupUpdates.length) await Promise.all(cleanupUpdates);

        console.log(
          `[pmsRefresh] New-day reset for hotel ${hotelId} (last refresh ${lastRefresh ?? "never"}): DND cleared, ${cleanupUpdates.length} rooms cleaned of stale manual overrides / notes`,
        );
      }
    } catch (e) {
      console.warn("[pmsRefresh] New-day reset skipped:", e);
    }
  }



  for (const row of rows) {
    try {
      const rawRoomName = String(row.Room ?? "").trim();
      if (!rawRoomName) continue;
      const roomNumber = extractRoomNumber(rawRoomName);
      const previoRoomId = row.RoomId != null ? String(row.RoomId) : "";

      const lookup = async (matcher: (q: any) => any) => {
        const q = supabase.from("rooms")
          .select("id, hotel, room_number, status, guest_count, is_checkout_room, pms_metadata, bed_configuration, notes")
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

      const classification = classifyPmsHousekeepingRow(row);
      const departureParsed = classification.departureTime;
      const isScheduledDeparture = classification.isScheduledDeparture;
      const isDepartureTomorrow = classification.isDepartureTomorrow;
      const explicitCheckoutStatus = row.CheckedOut === true
        || Number(row.ReservationStatusId) === 6
        || Number(row.ReservationStatusId) === 9
        || String(row.Status ?? row.ReservationStatus ?? "")
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, "")
          .match(/^(checkedout|departed|left|leaved)$/) !== null;
      const isCheckedOut = classification.isCheckedOut && explicitCheckoutStatus;
      // Authoritative checkout-room flag: only real checkout or scheduled
      // departure TODAY. Last-night Night/Total rows with blank Departure stay
      // daily and are marked via the C/O+1 badge.
      const shouldBeCheckoutRoom = classification.isCheckoutRoom;

      const rawExistingMetadata = room.pms_metadata && typeof room.pms_metadata === "object"
        ? room.pms_metadata
        : undefined;
      const staleManualOverride = isStaleManualRoomOverride(rawExistingMetadata, today);
      const existingMetadata = staleManualOverride
        ? stripManualRoomOverride(rawExistingMetadata)
        : rawExistingMetadata;

      const nightTotal = classification.nightTotal;
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
      const pmsNeedsCleaning = reservationDataAuthoritative && (
        shouldBeCheckoutRoom || classification.isDailyRoom || row.IsNoShow === true
      );
      const effectiveStatus = pmsNeedsCleaning
        ? row.IsNoShow === true
          ? "clean"
          : "dirty"
        : mappedStatus;

      const nextGuestCount = Number(row.People ?? 0);

      // Compute the diff for the preview.
      const changeFields: ProposedRoomChange["fields"] = [];
      if (effectiveStatus && room.status && effectiveStatus !== room.status) {
        changeFields.push({
          field: "Clean status", before: room.status, after: effectiveStatus, category: "status",
        });
      }
      if (reservationDataAuthoritative && typeof room.guest_count === "number" && room.guest_count !== nextGuestCount) {
        changeFields.push({
          field: "Guests", before: room.guest_count, after: nextGuestCount, category: "guest",
        });
      }
      const currentCheckoutFlag = !!room.is_checkout_room;
      const manualOverride = existingMetadata?.manual_checkout === true;
      const hasProtectedCheckoutAssignment = protectedCheckoutAssignmentRoomIds.has(room.id);
      const preserveExistingCheckout = currentCheckoutFlag && !shouldBeCheckoutRoom && (
        !reservationDataAuthoritative || manualOverride || hasProtectedCheckoutAssignment
      );
      const effectiveCheckoutFlag = preserveExistingCheckout ? true : shouldBeCheckoutRoom;
      if (reservationDataAuthoritative && effectiveCheckoutFlag !== currentCheckoutFlag) {
        const label = isCheckedOut
          ? "Checked out"
          : isScheduledDeparture
            ? "Departure today"
            : isDepartureTomorrow
              ? "Departure tomorrow"
              : preserveExistingCheckout
                ? manualOverride
                  ? "Preserved — manual checkout"
                  : hasProtectedCheckoutAssignment
                    ? "Preserved — checkout cleaning in progress"
                    : "Preserved — PMS reservation data unavailable"
                : "No checkout";
        changeFields.push({
          field: "Checkout room", before: currentCheckoutFlag, after: `${effectiveCheckoutFlag} (${label})`, category: "checkout",
        });
      }
      if (staleManualOverride) {
        changeFields.push({
          field: "Manual marker",
          before: rawExistingMetadata?.manual_checkout === true ? "Manual checkout" : "Manual daily",
          after: "Cleared (previous work day)",
          category: "checkout",
        });
      }
      if (reservationDataAuthoritative && (towel || linen)) {
        changeFields.push({
          field: "Linen/towel", before: "-", after: `${linen ? "linen" : ""}${towel && linen ? " + " : ""}${towel ? "towel" : ""}`, category: "linen",
        });
      }
      const housekeepingNote = reservationDataAuthoritative ? cleanSyncedHousekeepingNote(row) : null;
      if (reservationDataAuthoritative && housekeepingNote) {
        changeFields.push({ field: "Housekeeping note", before: "-", after: housekeepingNote, category: "note" });
      }

      // Auto-detect bed configuration only from Previo's dedicated
      // housekeeping/reception operational note. Never infer from OTA booking
      // blobs or partner room-category labels.
      const inferredBed = housekeepingNote ? inferBedConfigFromNote(housekeepingNote) : null;
      const currentBedConfig = (room as any).bed_configuration as string | null | undefined;
      const currentWasAutoInferred = !!existingMetadata?.inferredBedConfig;
      const shouldSetBedConfig = !!inferredBed && (!currentBedConfig || currentWasAutoInferred || currentBedConfig !== inferredBed.value);
      if (shouldSetBedConfig) {
        changeFields.push({
          field: "Bed config (auto from housekeeping note)",
          before: currentBedConfig ?? "-",
          after: `${inferredBed!.value} (from housekeeping note)`,
          category: "note",
        });
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
        updated_at: new Date().toISOString(),
        pms_metadata: {
          ...(existingMetadata ?? {}),
          pmsSyncDate: today,
          lastPmsRefreshDate: today,
        },
      };
      if (reservationDataAuthoritative) {
        updateData.guest_count = nextGuestCount;
        updateData.guest_nights_stayed = guestNightsStayed;
        updateData.towel_change_required = towel;
        updateData.linen_change_required = linen;
        updateData.pms_metadata.scheduledDepartureToday = isScheduledDeparture;
        updateData.pms_metadata.scheduledDepartureTomorrow = isDepartureTomorrow;
        updateData.pms_metadata.departureTime = departureParsed;
        updateData.pms_metadata.checkedOutToday = isCheckedOut;
        updateData.pms_metadata.reservationStatusId = row.RawReservationStatusId ?? row.ReservationStatusId ?? null;
        updateData.pms_metadata.currentNight = nightTotal?.currentNight ?? row.CurrentNight ?? existingMetadata?.currentNight ?? null;
        updateData.pms_metadata.totalNights = nightTotal?.totalNights ?? row.TotalNights ?? existingMetadata?.totalNights ?? null;
        updateData.pms_metadata.isNoShow = row.IsNoShow === true;
        updateData.pms_metadata.noteOta = row.NoteOta ?? null;
        updateData.pms_metadata.noteInternal = housekeepingNote ?? null;
        if (!inferredBed) {
          delete updateData.pms_metadata.inferredBedConfig;
          if (currentWasAutoInferred) updateData.bed_configuration = null;
        }
        if (isCheckedOut) {
          updateData.pms_metadata.readyToClean = true;
          updateData.pms_metadata.checkedOutAt = new Date().toISOString();
        }
        if (!isCheckedOut) {
          delete updateData.pms_metadata.readyToClean;
          delete updateData.pms_metadata.checkedOutAt;
        }
      }
      if (effectiveStatus) {
        updateData.status = effectiveStatus;
        if (effectiveStatus === "clean") {
          updateData.last_cleaned_at = new Date().toISOString();
        }
      }
      // PMS sync is authoritative for today's buckets only when the snapshot
      // contains reservation/departure data (live API or today's upload
      // fallback). Otherwise preserve checkout flags instead of wiping true
      // checkouts based on a status-only room roster.
      if (reservationDataAuthoritative) {
        updateData.is_checkout_room = preserveExistingCheckout ? true : shouldBeCheckoutRoom;
      }

      // `checkout_time` is an actual departed timestamp, not the scheduled
      // departure time from PMS. Scheduled checkouts stay blocked until PMS
      // confirms the guest has checked out.
      if (reservationDataAuthoritative) {
        updateData.checkout_time = isCheckedOut ? new Date().toISOString() : null;
        if (towel) updateData.last_towel_change = today;
        if (linen) updateData.last_linen_change = today;
        const currentFlags = parseRoomFlags((room as any).notes ?? null);
        updateData.notes = buildRoomNotes(
          {
            collectExtraTowels: currentFlags.collectExtraTowels,
            roomCleaning: currentFlags.roomCleaning,
          },
          housekeepingNote ?? "",
        ) || null;
      }
      if (shouldSetBedConfig && inferredBed) {
        updateData.bed_configuration = inferredBed.value;
        updateData.pms_metadata.inferredBedConfig = {
          value: inferredBed.value,
          keyword: inferredBed.matchedKeyword,
          at: new Date().toISOString(),
        };
      }

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
      if (effectiveStatus && room.status && effectiveStatus !== room.status) {
        pushEvent("status_changed", { status: room.status }, { status: effectiveStatus }, false);
      }
      if (reservationDataAuthoritative && isCheckedOut && !currentCheckoutFlag) {
        pushEvent("checkout_confirmed", { is_checkout_room: false }, { is_checkout_room: true }, false);
      }
      if (reservationDataAuthoritative && isDepartureTomorrow && !currentCheckoutFlag) {
        pushEvent("status_changed",
          { scheduledDepartureTomorrow: false },
          { scheduledDepartureTomorrow: true, reason: "departure_tomorrow_daily_room" }, false);
      }
      const wasNoShow = existingMetadata?.isNoShow === true;
      if (reservationDataAuthoritative && row.IsNoShow === true && !wasNoShow) {
        pushEvent("no_show_detected", { isNoShow: false }, { isNoShow: true }, false);
      }
      if (reservationDataAuthoritative && typeof room.guest_count === "number" && room.guest_count !== nextGuestCount) {
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
      if (updateData.is_checkout_room) checkouts++;

      if (reservationDataAuthoritative && isCheckedOut) {
        await supabase
          .from("room_assignments")
          .update({
            ready_to_clean: true,
            pms_hold: false,
            pms_hold_reason: null,
            pms_hold_event_id: null,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("room_id", room.id)
          .eq("assignment_date", today)
          .eq("assignment_type", "checkout_cleaning")
          .in("status", ["assigned", "in_progress"]);
      }

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
    try {
      await supabase.functions.invoke("previo-poll-checkouts", { body: { hotelId } });
    } catch (e) {
      console.warn("[pmsRefresh] poll-checkouts warning:", e);
    }

    try {
      await supabase.from("pms_sync_history").insert({
        hotel_id: hotelId,
        sync_type: "rooms_refresh",
        sync_status: status,
        error_message: errors.length ? errors.slice(0, 5).join(" | ") : null,
        data: {
          updated,
          notFound,
          total: rows.length,
          checkouts,
          reservationDataAuthoritative,
          managerFacingSuccess,
          reservationSource: (data as any)?.reservationSource ?? null,
          reservationFallbackSource: (data as any)?.reservationFallbackSource ?? null,
          reservationFetchError,
          reservationIssue,
          managerMessage: reservationManagerMessage ?? null,
        },
      } as any);
    } catch { /* non-fatal */ }
  }

  return {
    status, updated, total: rows.length, notFound, checkouts, errors,
    managerMessage: reservationManagerMessage,
    reservationDataAuthoritative,
    reservationIssue,
    proposedChanges: dryRun ? proposedChanges : undefined,
    unmapped,
  };
}

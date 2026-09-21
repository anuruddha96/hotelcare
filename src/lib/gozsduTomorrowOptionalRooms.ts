import type { RoomForAssignment } from './roomAssignmentAlgorithm';

export type GozsduOptionalKind = 'no_show' | 'arrival_only' | 'vacant';
export type GozsduRosterRow = {
  room_label: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  status?: string | null;
  captured_at?: string | null;
};
export type GozsduOptionalRoom = {
  id: string;
  label: string;
  kind: GozsduOptionalKind;
  evidence: string;
  room: RoomForAssignment;
};

const selections = new Map<string, Set<string>>();
export function gozsduOptionKey(organizationSlug: string, hotelId: string, date: string): string {
  return `${organizationSlug}::${hotelId}::${date}`;
}
export function setGozsduOptionalSelection(key: string, roomIds: readonly string[]): void {
  selections.set(key, new Set(roomIds));
}
export function getGozsduOptionalSelection(key: string): ReadonlySet<string> {
  return selections.get(key) || new Set<string>();
}
export function clearGozsduOptionalSelection(key: string): void {
  selections.delete(key);
}

function addDays(iso: string, offset: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * A selected-date Previo snapshot only contains guests who slept the preceding
 * night. Its absence does NOT prove a no-show, and arrival-only units must not
 * be silently classified as checkout or vacant. Consult the adjacent business
 * dates and canonical Gozsdu registry name; never fuzzy-match room numbers.
 * Operationally unavailable units and manual maintenance holds are not choices.
 */
export function buildGozsduOptionalRooms(args: {
  roomRows: any[];
  selectedRows: GozsduRosterRow[];
  precedingRows: GozsduRosterRow[];
  followingRows: GozsduRosterRow[];
  selectedDate: string;
}): GozsduOptionalRoom[] {
  const priorDate = addDays(args.selectedDate, -1);
  const selected = new Set(args.selectedRows.map(row => row.room_label?.trim()).filter(Boolean));
  const preceding = new Map(args.precedingRows.map(row => [row.room_label?.trim(), row]));
  const following = new Map(args.followingRows.map(row => [row.room_label?.trim(), row]));
  const seen = new Set<string>();
  const candidates: GozsduOptionalRoom[] = [];
  for (const room of args.roomRows) {
    const metadata = room.pms_metadata || {};
    const pmsName = String(metadata.gozsduAvailability?.pmsRoomName || '').trim();
    if (!pmsName) throw new Error(`Gozsdu registry mapping missing for local room ${room.room_number}.`);
    if (seen.has(pmsName)) throw new Error(`Duplicate Gozsdu registry mapping for ${pmsName}.`);
    seen.add(pmsName);
    if (selected.has(pmsName)) continue;
    if (metadata.gozsduAvailability?.status !== 'operating'
      || room.status === 'out_of_order' || metadata.manualHousekeepingHold === true) continue;

    const next = following.get(pmsName);
    const previous = preceding.get(pmsName);
    const arrivalOnly = next?.arrival_date === args.selectedDate;
    // isNoShow by itself is a live/today flag, NOT proof of a no-show tomorrow.
    const dateConfirmedNoShow = metadata.isNoShow === true && metadata.noShowDate === args.selectedDate;
    const kind: GozsduOptionalKind = dateConfirmedNoShow ? 'no_show' : arrivalOnly ? 'arrival_only' : 'vacant';
    const evidence = dateConfirmedNoShow
      ? 'No-show explicitly recorded for selected date; optional manager cleaning'
      : arrivalOnly
        ? 'Guest arrives on selected date; not a checkout or overnight stayover'
        : previous?.departure_date === priorDate
          ? 'Previous-day departure; no selected-date occupied reservation'
          : 'No occupied reservation in selected-date Previo feed; verify vacancy before assigning';
    const roomForAssignment: RoomForAssignment = {
      ...room,
      is_checkout_room: false,
      ready_to_clean: false,
      towel_change_required: false,
      linen_change_required: false,
      pms_metadata: {
        ...metadata,
        scheduledDepartureToday: false,
        plannedHousekeepingDate: args.selectedDate,
        gozsduOptionalCleaning: { kind, evidence, selectedDate: args.selectedDate, pmsRoomName: pmsName },
      },
    } as RoomForAssignment;
    candidates.push({ id: room.id, label: pmsName, kind, evidence, room: roomForAssignment });
  }
  return candidates.sort((a, b) => a.label.localeCompare(b.label));
}

/** Reject unknown/now-booked selections rather than accidentally adding a
 * checkout or silently promoting a previously vacant room. */
export function selectGozsduOptionalRooms(
  candidates: readonly GozsduOptionalRoom[], selectedRoomIds: ReadonlySet<string>,
): RoomForAssignment[] {
  const available = new Set(candidates.map(candidate => candidate.id));
  for (const id of selectedRoomIds) {
    if (!available.has(id)) throw new Error('Optional Gozsdu room availability changed. Reopen the planner; nothing was saved.');
  }
  return candidates.filter(candidate => selectedRoomIds.has(candidate.id)).map(candidate => candidate.room);
}

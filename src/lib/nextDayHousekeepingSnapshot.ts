import type { RoomForAssignment } from '@/lib/roomAssignmentAlgorithm';
import { isGozsduCourtHotel, getGozsduHousekeepingCycle } from '@/lib/gozsdu-housekeeping';

export type DailyOverviewWorkRow = {
  room_label: string | null;
  room_number: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  status: string | null;
  housekeeping_dep: string | null;
  housekeeping_stay: string | null;
  captured_at: string | null;
};
export type SelectedDateWorkload = {
  rooms: RoomForAssignment[];
  checkoutCount: number;
  dailyCount: number;
  potentialCheckoutCount: number;
  capturedAt: string | null;
  sourceRows: number;
};
function compact(value: unknown): string {
  return String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * An unsold planning room is an operating room with no active reservation in
 * the selected-date PMS snapshot at the time tomorrow's plan is prepared.
 *
 * It is included only as provisional workload so a manager may pre-assign a
 * cleaner. It is NOT a checkout yet. Morning PMS revalidation decides whether
 * the room becomes a checkout, a stay-over service, or no housekeeping task.
 *
 * Keep the legacy potentialCheckout markers readable because approved plans
 * created before this rollout may still be waiting for morning release.
 */
export function isUnsoldPlanningRoom(
  room: Pick<RoomForAssignment, 'pms_metadata'>,
): boolean {
  return room.pms_metadata?.unsoldAtPlanning === true
    || room.pms_metadata?.planningStatus === 'unsold_now'
    || room.pms_metadata?.potentialCheckout === true
    || room.pms_metadata?.selectedDateSnapshotKind === 'potential_checkout';
}

/** Backward-compatible alias used by existing planner/revalidation code. */
export function isPotentialCheckoutRoom(
  room: Pick<RoomForAssignment, 'pms_metadata'>,
): boolean {
  return isUnsoldPlanningRoom(room);
}
/** Preserve full slash codes, numeric labels and full PMS names as distinct aliases. */
export function nextDayRoomMatchTokens(value: unknown): string[] {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  const tokens = new Set<string>();
  const slash = raw.match(/(?:^|\D)(\d+)\s*\/\s*(\d+)(?:\D|$)/);
  if (slash) tokens.add(`unit:${slash[1]}/${slash[2]}`);
  else {
    const number = raw.match(/(?:^|\D)(\d{2,4})(?:\D|$)/);
    if (number) tokens.add(`room:${number[1]}`);
  }
  const full = compact(raw);
  if (full) tokens.add(`full:${full}`);
  return [...tokens];
}
function dayNumber(date: string | null): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed / 86_400_000 : null;
}
function serviceNight(arrivalDate: string | null, selectedDate: string): number | null {
  const arrival = dayNumber(arrivalDate);
  const selected = dayNumber(selectedDate);
  if (arrival === null || selected === null || selected < arrival) return null;
  return Math.round(selected - arrival) + 1;
}
function classifySnapshotRow(row: DailyOverviewWorkRow, selectedDate: string): 'checkout' | 'daily' | null {
  const checkout = row.departure_date === selectedDate || row.status === 'departing'
    || String(row.housekeeping_dep || '').toUpperCase() === 'DEP';
  if (checkout) return 'checkout';
  const daily = row.status === 'ongoing' || (!!row.arrival_date && !!row.departure_date
    && row.arrival_date < selectedDate && row.departure_date > selectedDate);
  return daily ? 'daily' : null;
}
function buildRoomIndex(roomRows: any[]) {
  const index = new Map<string, any[]>();
  for (const room of roomRows) {
    const names = [room.room_number];
    // Gozsdu's PMS labels contain building prefixes, but local room numbers
    // can be short. The canonical registry alias disambiguates all 82 units.
    if (isGozsduCourtHotel(room.hotel) && room.pms_metadata?.gozsduAvailability?.pmsRoomName) {
      names.push(room.pms_metadata.gozsduAvailability.pmsRoomName);
    }
    for (const name of names) for (const token of nextDayRoomMatchTokens(name)) {
      const existing = index.get(token) || [];
      if (!existing.some(candidate => candidate.id === room.id)) existing.push(room);
      index.set(token, existing);
    }
  }
  return index;
}
function resolveRoom(index: Map<string, any[]>, row: DailyOverviewWorkRow): any | null {
  let sawAmbiguous = false;
  for (const value of [row.room_number, row.room_label]) {
    const tokens = nextDayRoomMatchTokens(value);
    // Full canonical names win over fuzzy numeric suffixes, avoiding cross-building matches.
    tokens.sort((a, b) => Number(b.startsWith('full:')) - Number(a.startsWith('full:')));
    for (const token of tokens) {
      const candidates = index.get(token) || [];
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) sawAmbiguous = true;
    }
  }
  if (sawAmbiguous) throw new Error(`Ambiguous PMS room mapping for ${row.room_number || row.room_label || 'unknown room'}.`);
  return null;
}
/** Build selected-date workload from Previo snapshot, never guessing from a stale room reservation. */
export function buildSelectedDateHousekeepingWorkload(
  roomRows: any[], snapshotRows: DailyOverviewWorkRow[], selectedDate: string,
): SelectedDateWorkload {
  const roomIndex = buildRoomIndex(roomRows);
  const mappedRoomIds = new Set<string>();
  const representedRoomIds = new Set<string>();
  const rooms: RoomForAssignment[] = [];
  const unmapped: string[] = [];
  let capturedAt: string | null = null;

  for (const snapshot of snapshotRows) {
    if (snapshot.captured_at && (!capturedAt || snapshot.captured_at > capturedAt)) capturedAt = snapshot.captured_at;

    const kind = classifySnapshotRow(snapshot, selectedDate);
    const room = resolveRoom(roomIndex, snapshot);
    if (room) representedRoomIds.add(room.id);

    // A reservation row can be relevant to occupancy without being a cleaning
    // task (for example an arrival-day row). Such a room is booked, so it must
    // not be misclassified below as a vacant potential checkout.
    if (!kind) continue;
    if (!room) { unmapped.push(snapshot.room_number || snapshot.room_label || 'unknown room'); continue; }
    if (mappedRoomIds.has(room.id)) throw new Error(`Previo returned more than one selected-date row for HotelCare room ${room.room_number}.`);
    mappedRoomIds.add(room.id);
    const metadata = (room.pms_metadata || {}) as Record<string, any>;
    if (room.status === 'out_of_order' || metadata.manualHousekeepingHold === true || metadata.isNoShow === true) continue;
    if (isGozsduCourtHotel(room.hotel) && metadata.gozsduAvailability?.status !== 'operating') continue;
    const isCheckout = kind === 'checkout';
    let towelChange = false;
    let linenChange = false;
    if (!isCheckout) {
      const night = serviceNight(snapshot.arrival_date, selectedDate);
      if (isGozsduCourtHotel(room.hotel)) {
        const departure = dayNumber(snapshot.departure_date);
        const arrival = dayNumber(snapshot.arrival_date);
        const totalNights = arrival === null || departure === null ? 0 : Math.max(0, departure - arrival);
        const cycle = getGozsduHousekeepingCycle({ currentNight: night, totalNights, isCheckout: false });
        towelChange = cycle.service === 'towel_change';
        linenChange = cycle.service === 'change_room';
        // A Gozsdu stay-over room without a service due must never enter tomorrow's plan.
        if (!cycle.serviceDue) continue;
      } else if (night !== null && night >= 3) {
        const cycle = (night - 3) % 4;
        towelChange = cycle === 0;
        linenChange = cycle === 2;
      }
    }
    rooms.push({ ...room,
      is_checkout_room: isCheckout, ready_to_clean: !isCheckout,
      towel_change_required: towelChange, linen_change_required: linenChange,
      pms_metadata: { ...metadata, scheduledDepartureToday: isCheckout,
        plannedHousekeepingDate: selectedDate, plannedFromDailyOverview: true,
        selectedDateSnapshotKind: kind, selectedDateArrival: snapshot.arrival_date,
        selectedDateDeparture: snapshot.departure_date,
        selectedDateSnapshotCapturedAt: snapshot.captured_at,
        potentialCheckout: false,
      },
    } as RoomForAssignment);
  }

  // Previo's daily-overview feed is reservation-based, not an inventory list.
  // Therefore an operating HotelCare room absent from the exact-date snapshot
  // is genuinely unbooked at capture time. Include it in advance planning as a
  // provisional worst-case checkout. The morning release worker independently
  // revalidates reservations and skips it if it is still vacant.
  for (const room of roomRows) {
    if (representedRoomIds.has(room.id) || mappedRoomIds.has(room.id)) continue;
    const metadata = (room.pms_metadata || {}) as Record<string, any>;
    if (room.status === 'out_of_order' || metadata.manualHousekeepingHold === true || metadata.isNoShow === true) continue;
    if (isGozsduCourtHotel(room.hotel) && metadata.gozsduAvailability?.status !== 'operating') continue;

    rooms.push({
      ...room,
      is_checkout_room: true,
      ready_to_clean: false,
      towel_change_required: false,
      linen_change_required: false,
      pms_metadata: {
        ...metadata,
        scheduledDepartureToday: false,
        plannedHousekeepingDate: selectedDate,
        plannedFromDailyOverview: true,
        selectedDateSnapshotKind: 'potential_checkout',
        selectedDateArrival: null,
        selectedDateDeparture: null,
        selectedDateSnapshotCapturedAt: capturedAt,
        // New neutral planning semantics. Legacy potentialCheckout fields are
        // retained for plans created by older frontends and release workers.
        planningStatus: 'unsold_now',
        unsoldAtPlanning: true,
        unsoldReason: 'no_reservation_at_planning_sync',
        potentialCheckout: true,
        potentialCheckoutReason: 'unbooked_for_selected_date',
      },
    } as RoomForAssignment);
  }
  if (unmapped.length > 0) {
    const unique = [...new Set(unmapped)];
    throw new Error(`Previo room mapping is incomplete for ${selectedDate}: ${unique.slice(0, 8).join(', ')}`
      + (unique.length > 8 ? ` +${unique.length - 8} more` : ''));
  }
  const checkoutCount = rooms.filter(room => room.is_checkout_room).length;
  const potentialCheckoutCount = rooms.filter(isPotentialCheckoutRoom).length;
  return {
    rooms,
    checkoutCount,
    dailyCount: rooms.length - checkoutCount,
    potentialCheckoutCount,
    capturedAt,
    sourceRows: snapshotRows.length,
  };
}

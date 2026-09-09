import type { RoomForAssignment } from '@/lib/roomAssignmentAlgorithm';

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
  capturedAt: string | null;
  sourceRows: number;
};

function compact(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Stable room aliases for Previo ↔ HotelCare matching.
 *
 * Mika is the important edge case: Previo exposes apartment codes such as
 * `1/2`, while HotelCare labels them `SUITE - 1/2`, `ST - 1/6`, etc. The old
 * fallback-to-last-digit approach made 1/2, 2/2, 102 and other rooms collide.
 * Keep the whole slash code or the whole numeric room number instead.
 */
export function nextDayRoomMatchTokens(value: unknown): string[] {
  const raw = String(value ?? '').trim();
  if (!raw) return [];

  const tokens = new Set<string>();
  const slash = raw.match(/(?:^|\D)(\d+)\s*\/\s*(\d+)(?:\D|$)/);
  if (slash) {
    tokens.add(`unit:${slash[1]}/${slash[2]}`);
  } else {
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
  // Existing housekeeping cadence uses tomorrowNight = currentNight + 1.
  // On the selected morning this is one more than elapsed stay nights.
  return Math.round(selected - arrival) + 1;
}

function classifySnapshotRow(row: DailyOverviewWorkRow, selectedDate: string): 'checkout' | 'daily' | null {
  const checkout = row.departure_date === selectedDate
    || row.status === 'departing'
    || String(row.housekeeping_dep || '').toUpperCase() === 'DEP';
  if (checkout) return 'checkout';

  const daily = row.status === 'ongoing'
    || (!!row.arrival_date && !!row.departure_date
      && row.arrival_date < selectedDate && row.departure_date > selectedDate);
  return daily ? 'daily' : null;
}

function buildRoomIndex(roomRows: any[]) {
  const index = new Map<string, any[]>();
  for (const room of roomRows) {
    for (const token of nextDayRoomMatchTokens(room.room_number)) {
      const existing = index.get(token) || [];
      if (!existing.some(candidate => candidate.id === room.id)) existing.push(room);
      index.set(token, existing);
    }
  }
  return index;
}

function resolveRoom(index: Map<string, any[]>, row: DailyOverviewWorkRow): any | null {
  const values = [row.room_number, row.room_label];
  let sawAmbiguous = false;
  for (const value of values) {
    for (const token of nextDayRoomMatchTokens(value)) {
      const candidates = index.get(token) || [];
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) sawAmbiguous = true;
    }
  }
  if (sawAmbiguous) {
    throw new Error(`Ambiguous PMS room mapping for ${row.room_number || row.room_label || 'unknown room'}.`);
  }
  return null;
}

/**
 * Build the actual selected-date housekeeping workload from the fresh Previo
 * daily-overview snapshot. This avoids inferring tomorrow from today's single
 * room reservation, which is incorrect on same-day room turnovers.
 */
export function buildSelectedDateHousekeepingWorkload(
  roomRows: any[],
  snapshotRows: DailyOverviewWorkRow[],
  selectedDate: string,
): SelectedDateWorkload {
  const roomIndex = buildRoomIndex(roomRows);
  const mappedRoomIds = new Set<string>();
  const rooms: RoomForAssignment[] = [];
  const unmapped: string[] = [];
  let capturedAt: string | null = null;

  for (const snapshot of snapshotRows) {
    const kind = classifySnapshotRow(snapshot, selectedDate);
    if (!kind) continue;

    const room = resolveRoom(roomIndex, snapshot);
    if (!room) {
      unmapped.push(snapshot.room_number || snapshot.room_label || 'unknown room');
      continue;
    }
    if (mappedRoomIds.has(room.id)) {
      throw new Error(`Previo returned more than one selected-date row for HotelCare room ${room.room_number}.`);
    }
    mappedRoomIds.add(room.id);

    const metadata = (room.pms_metadata || {}) as Record<string, any>;
    if (room.status === 'out_of_order' || metadata.manualHousekeepingHold === true || metadata.isNoShow === true) {
      continue;
    }

    const isCheckout = kind === 'checkout';
    let towelChange = false;
    let linenChange = false;
    if (!isCheckout) {
      const night = serviceNight(snapshot.arrival_date, selectedDate);
      if (night !== null && night >= 3) {
        const cycle = (night - 3) % 4;
        towelChange = cycle === 0;
        linenChange = cycle === 2;
      }
    }

    if (snapshot.captured_at && (!capturedAt || snapshot.captured_at > capturedAt)) {
      capturedAt = snapshot.captured_at;
    }

    rooms.push({
      ...room,
      is_checkout_room: isCheckout,
      ready_to_clean: !isCheckout,
      towel_change_required: towelChange,
      linen_change_required: linenChange,
      pms_metadata: {
        ...metadata,
        scheduledDepartureToday: isCheckout,
        plannedHousekeepingDate: selectedDate,
        plannedFromDailyOverview: true,
        selectedDateSnapshotKind: kind,
        selectedDateArrival: snapshot.arrival_date,
        selectedDateDeparture: snapshot.departure_date,
        selectedDateSnapshotCapturedAt: snapshot.captured_at,
      },
    } as RoomForAssignment);
  }

  if (unmapped.length > 0) {
    const unique = [...new Set(unmapped)];
    throw new Error(
      `Previo room mapping is incomplete for ${selectedDate}: ${unique.slice(0, 8).join(', ')}`
      + (unique.length > 8 ? ` +${unique.length - 8} more` : ''),
    );
  }

  const checkoutCount = rooms.filter(room => room.is_checkout_room).length;
  return {
    rooms,
    checkoutCount,
    dailyCount: rooms.length - checkoutCount,
    capturedAt,
    sourceRows: snapshotRows.length,
  };
}

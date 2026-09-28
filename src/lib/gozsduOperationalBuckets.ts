import { getGozsduHousekeepingCycle, GOZSDU_COURT_HOTEL_ID } from './gozsdu-housekeeping';
import { isGozsduAwaitingArrival, type GozsduRosterEntry } from './gozsduPmsRoster';
import { readGozsduRoomOverride } from './gozsduRoomBucketOverride';

export type GozsduOperationalBucket = 'checkout' | 'service' | 'arrival' | 'other' | 'noshow';

export type GozsduOperationalRoom = {
  id: string;
  hotel: string | null;
  room_number: string;
  is_checkout_room: boolean | null;
  guest_nights_stayed?: number | null;
  pms_metadata?: any;
};

export type GozsduOperationalAssignment = {
  room_id: string;
  assignment_type: string;
  status: string;
};

/**
 * One canonical selector for the historical duplicate Gozsdu room rows.
 * The manager view has always preferred the row that already owns today's
 * housekeeping assignment; otherwise the canonical `gozsdu-court` row wins.
 * Laundryner must make the exact same choice or the registry/PMS roster maps to
 * a different UUID and the two screens silently classify different rooms.
 */
export function selectGozsduOperationalRooms<T extends GozsduOperationalRoom>(
  rawRooms: T[], assignments: GozsduOperationalAssignment[],
): T[] {
  const assignedIds = new Set(assignments.map(row => row.room_id));
  const deduped = new Map<string, T>();
  for (const room of rawRooms) {
    const existing = deduped.get(room.room_number);
    if (!existing || (assignedIds.has(room.id) && !assignedIds.has(existing.id))
      || (!assignedIds.has(existing.id) && room.hotel === GOZSDU_COURT_HOTEL_ID)) {
      deduped.set(room.room_number, room);
    }
  }
  return [...deduped.values()].sort((a, b) =>
    a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
}

function fallbackCheckout(room: GozsduOperationalRoom, assignment: GozsduOperationalAssignment | undefined, selectedDate: string): boolean {
  const pms = room.pms_metadata || {};
  if (pms.manual_daily === true) return false;
  return room.is_checkout_room === true || pms.scheduledDepartureToday === true
    || pms.checkedOutToday === true
    || (pms.pmsSyncDate !== selectedDate && assignment?.assignment_type === 'checkout_cleaning');
}

function fallbackNoShow(room: GozsduOperationalRoom, selectedDate: string): boolean {
  const pms = room.pms_metadata || {};
  return pms.pmsSyncDate === selectedDate
    && (pms.isNoShow === true || Number(pms.reservationStatusId) === 8);
}

function fallbackServiceDue(room: GozsduOperationalRoom): boolean {
  const pms = room.pms_metadata || {};
  return getGozsduHousekeepingCycle({
    currentNight: pms.currentNight ?? room.guest_nights_stayed,
    totalNights: pms.totalNights,
    isCheckout: false,
  }).service !== 'none';
}

/**
 * Single bucket authority shared by Manager Overview and Laundryner.
 * Verified PMS roster wins. A date-scoped manager override is next. If the
 * full selected-day roster cannot be verified, both screens use the same
 * conservative PMS-night fallback. Stale `gozsduHousekeeping` snapshots and
 * assignment notes are never accepted as proof of Second-day service.
 */
export function resolveGozsduOperationalBucket(
  room: GozsduOperationalRoom,
  assignment: GozsduOperationalAssignment | undefined,
  selectedDate: string,
  verified?: Pick<GozsduRosterEntry, 'bucket'> | null,
): GozsduOperationalBucket {
  if (verified?.bucket) return verified.bucket;

  const override = readGozsduRoomOverride(room.pms_metadata, selectedDate);
  if (override?.bucket === 'service') return 'service';
  if (override?.bucket === 'other') return 'other';

  const hasActiveCheckout = assignment?.assignment_type === 'checkout_cleaning'
    && assignment.status === 'in_progress';
  if (isGozsduAwaitingArrival(room, selectedDate) && !hasActiveCheckout) return 'arrival';
  if (fallbackCheckout(room, assignment, selectedDate)) return 'checkout';
  if (fallbackNoShow(room, selectedDate)) return 'noshow';
  if (fallbackServiceDue(room)) return 'service';
  return 'other';
}

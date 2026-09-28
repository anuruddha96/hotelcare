import { isEligibleLaundryRoom, type LaundryBucket, type LaundryRoom } from './gozsduLaundryner';
import { getGozsduHousekeepingCycle } from './gozsdu-housekeeping';
import { readGozsduRoomOverride } from './gozsduRoomBucketOverride';
import { resolveGozsduOperationalBucket } from './gozsduOperationalBuckets';

export type LaundryAssignment = {
  id: string;
  room_id: string;
  assigned_to: string | null;
  assignment_type: string;
  status: string;
  ready_to_clean: boolean | null;
  is_dnd: boolean | null;
  pms_hold: boolean | null;
  pms_hold_reason?: string | null;
  pms_hold_event_id?: string | null;
  supervisor_approved?: boolean | null;
  notes?: string | null;
  updated_at?: string | null;
};

export type LaundryAccess = 'ready' | 'guest_permission' | 'guest_inside' | 'dnd' | 'unavailable';
export type LaundryService = 'full' | 'textile' | 'towel' | 'daily' | 'none';

/** Null-safe because dialog controls may render during their closed state. */
export const isCheckout = (room: LaundryRoom | null | undefined): boolean =>
  room?.is_checkout_room === true || room?.pms_metadata?.scheduledDepartureToday === true;

export function activeLaundryAssignments(rows: LaundryAssignment[]): LaundryAssignment[] {
  return rows.filter(row => row.assignment_type !== 'maintenance' && row.status !== 'cancelled'
    && row.status !== 'dnd_pending_retry' && ['assigned', 'in_progress'].includes(row.status));
}

/** Only an actual in-progress housekeeping assignment indicates somebody is cleaning. */
export function activeCleaningHousekeeperIds(rows: LaundryAssignment[]): string[] {
  return [...new Set(rows.filter(row => row.status === 'in_progress' && !!row.assigned_to
    && ['checkout_cleaning', 'daily_cleaning', 'deep_cleaning'].includes(row.assignment_type))
    .map(row => row.assigned_to as string))];
}

/**
 * A verified early checkout may have been assigned as daily_cleaning first.
 * This is strictly a linen-recording exception after supervisor approval,
 * NOT permission to resolve the housekeeping hold or to change room status.
 * The database guard additionally verifies the linked system checkout event.
 */
export function approvedEarlyCheckoutForLinen(room: LaundryRoom, rows: LaundryAssignment[]): boolean {
  const relevant = rows.filter(row => row.assignment_type !== 'maintenance'
    && ['assigned', 'in_progress', 'completed'].includes(row.status));
  return room.status === 'clean' && relevant.length === 1 && relevant[0].assignment_type === 'daily_cleaning'
    && relevant[0].status === 'completed' && relevant[0].supervisor_approved === true
    && relevant[0].ready_to_clean === true && relevant[0].pms_hold === true
    && relevant[0].pms_hold_reason === 'Guest checked out — assignment type may need to change'
    && !!relevant[0].pms_hold_event_id && relevant[0].is_dnd !== true;
}

/**
 * A completed checkout already checked and approved by a supervisor is a
 * valid linen-only operational release when Previo's REST room has switched to
 * the incoming arrival and omitted the departed reservation (4005 case).
 * Require today's PMS-derived departure date, no current/incoming occupant,
 * a clean room and ONE completed/approved/unheld RTC checkout assignment.
 * This never changes occupancy, PMS flags or the housekeeping assignment.
 */
export function approvedOperationalCheckoutForLinen(room: LaundryRoom, rows: LaundryAssignment[], date: string): boolean {
  const meta = room.pms_metadata || {};
  if (room.is_checkout_room !== true || room.status !== 'clean'
    || meta.lastPmsRefreshDate !== date || meta.gozsduVerifiedDepartureDate !== date
    || meta.occupiedToday !== false || meta.stayThroughToday === true
    || meta.gozsduIncomingGuestNotArrived !== true || meta.isNoShow === true) return false;
  const relevant = rows.filter(row => row.assignment_type !== 'maintenance'
    && ['assigned', 'in_progress', 'completed'].includes(row.status));
  return relevant.length === 1 && relevant[0].assignment_type === 'checkout_cleaning'
    && relevant[0].status === 'completed' && relevant[0].supervisor_approved === true
    && relevant[0].ready_to_clean === true && relevant[0].pms_hold !== true
    && relevant[0].is_dnd !== true;
}

/**
 * Ordinary checkouts require actual PMS checkout and RTC release. If Previo
 * drops an already-departed reservation from REST/XML, the narrowly scoped
 * completed + supervisor-approved operational release above enables only
 * linen recording; an in-progress or unapproved checkout remains blocked.
 */
export function laundryAccess(room: LaundryRoom, assignments: LaundryAssignment[], date: string): LaundryAccess {
  if (!isEligibleLaundryRoom(room)) return 'unavailable';
  if (room.is_dnd || assignments.some(row => row.is_dnd)) return 'dnd';
  if (!isCheckout(room)) return 'guest_permission';
  const meta = room.pms_metadata || {};
  if (approvedOperationalCheckoutForLinen(room, assignments, date)) return 'ready';
  if (meta.lastPmsRefreshDate !== date || meta.checkedOutToday !== true || meta.readyToClean !== true
    || (meta.readyToCleanDate && meta.readyToCleanDate !== date)) return 'guest_inside';
  const relevant = assignments.filter(row => row.assignment_type !== 'maintenance'
    && ['assigned', 'in_progress', 'completed'].includes(row.status));
  const checkouts = relevant.filter(row => row.assignment_type === 'checkout_cleaning');
  const conflicting = relevant.filter(row => row.assignment_type !== 'checkout_cleaning');
  const normalCheckout = checkouts.length > 0 && conflicting.length === 0
    && checkouts.every(row => row.ready_to_clean === true && row.pms_hold !== true && row.is_dnd !== true);
  return normalCheckout || approvedEarlyCheckoutForLinen(room, assignments) ? 'ready' : 'guest_inside';
}

/**
 * Service label helper. A date-scoped manager override is respected. Otherwise
 * calculate from the same PMS 3/N, 5/N, 7/N... cycle used by the manager view.
 * Never resurrect a stale `gozsduHousekeeping` snapshot or towel-note as proof
 * that a room belongs in Second-day service.
 */
function plannedLaundryService(room: LaundryRoom, assignments: LaundryAssignment[], date: string): 'none' | 'towel_change' | 'change_room' {
  const metadata = room.pms_metadata || {};
  const override = readGozsduRoomOverride(metadata, date);
  if (override) return override.bucket === 'service' ? override.service : 'none';

  const currentNight = Number(metadata.currentNight);
  const totalNights = Number(metadata.totalNights);
  if (Number.isInteger(currentNight) && currentNight > 0
    && Number.isInteger(totalNights) && totalNights >= currentNight) {
    const cycle = getGozsduHousekeepingCycle({ currentNight, totalNights, isCheckout: false });
    if (cycle.serviceDue) return cycle.service;
  }
  return 'none';
}

/** Show the same actual service type used to place the room in its queue. */
export function laundryService(room: LaundryRoom, assignments: LaundryAssignment[], date: string): LaundryService {
  if (isCheckout(room)) return 'full';
  const service = plannedLaundryService(room, assignments, date);
  if (service === 'towel_change') return 'towel';
  if (service === 'change_room') return 'textile';
  if (activeLaundryAssignments(assignments).some(row => row.assignment_type === 'daily_cleaning')) return 'daily';
  return 'none';
}

/**
 * Degraded bucket classification is intentionally the exact manager fallback.
 * This prevents Laundryner from producing its own larger Second-day list when
 * the verified PMS roster is temporarily unavailable.
 */
export function laundryBucket(room: LaundryRoom, assignments: LaundryAssignment[], date: string): LaundryBucket {
  const assignment = assignments.find(row => row.status !== 'cancelled' && row.assignment_type !== 'maintenance');
  const bucket = resolveGozsduOperationalBucket(room, assignment, date);
  return bucket === 'service' ? 'second_day'
    : bucket === 'arrival' ? 'arrival'
      : bucket === 'checkout' ? 'checkout' : 'other';
}

export function groupCurrentLaundryRooms(
  rooms: LaundryRoom[], assignments: LaundryAssignment[], date: string,
  managerBuckets?: Map<string, 'checkout' | 'service' | 'arrival' | 'other' | 'noshow'>,
) {
  const grouped: Record<LaundryBucket, LaundryRoom[]> = { checkout: [], second_day: [], arrival: [], other: [] };
  const byRoom = new Map<string, LaundryAssignment[]>();
  for (const row of assignments) byRoom.set(row.room_id, [...(byRoom.get(row.room_id) || []), row]);
  for (const room of rooms) {
    const managerBucket = managerBuckets?.get(room.id);
    if (managerBucket) {
      // Verified/fallback manager bucket is authoritative. Do not run a second
      // Laundryner eligibility/service classifier on top of it.
      if (managerBucket === 'noshow') continue;
      const bucket: LaundryBucket = managerBucket === 'service' ? 'second_day'
        : managerBucket === 'arrival' ? 'arrival'
          : managerBucket === 'checkout' ? 'checkout' : 'other';
      grouped[bucket].push(room);
      continue;
    }
    if (!isEligibleLaundryRoom(room)) continue;
    grouped[laundryBucket(room, byRoom.get(room.id) || [], date)].push(room);
  }
  for (const group of Object.values(grouped)) group.sort((a, b) => {
    const aCleaning = activeCleaningHousekeeperIds(byRoom.get(a.id) || []).length > 0;
    const bCleaning = activeCleaningHousekeeperIds(byRoom.get(b.id) || []).length > 0;
    return Number(bCleaning) - Number(aCleaning)
      || a.room_number.localeCompare(b.room_number, undefined, { numeric: true });
  });
  return grouped;
}

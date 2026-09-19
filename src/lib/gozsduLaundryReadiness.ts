import { isEligibleLaundryRoom, type LaundryBucket, type LaundryRoom } from './gozsduLaundryner';
import { readGozsduRoomOverride } from './gozsduRoomBucketOverride';

export type LaundryAssignment = {
  id: string;
  room_id: string;
  assigned_to: string | null;
  assignment_type: string;
  status: string;
  ready_to_clean: boolean | null;
  is_dnd: boolean | null;
  pms_hold: boolean | null;
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

/** A completed checkout is not an active housekeeping assignment, but the linen
 * record must remain editable after the housekeeper finishes/gets approved.
 * Keep the original strict same-day PMS checkout/release checks: neither a clean
 * room nor approval on its own establishes that the guest has departed. */
export function laundryAccess(room: LaundryRoom, assignments: LaundryAssignment[], date: string): LaundryAccess {
  if (!isEligibleLaundryRoom(room)) return 'unavailable';
  if (room.is_dnd || assignments.some(row => row.is_dnd)) return 'dnd';
  if (!isCheckout(room)) return 'guest_permission';
  const meta = room.pms_metadata || {};
  const relevant = assignments.filter(row => row.assignment_type !== 'maintenance'
    && ['assigned', 'in_progress', 'completed'].includes(row.status));
  const checkouts = relevant.filter(row => row.assignment_type === 'checkout_cleaning');
  const conflicting = relevant.filter(row => row.assignment_type !== 'checkout_cleaning');
  if (meta.lastPmsRefreshDate !== date || meta.checkedOutToday !== true || meta.readyToClean !== true
    || (meta.readyToCleanDate && meta.readyToCleanDate !== date) || !checkouts.length || conflicting.length
    || checkouts.some(row => row.ready_to_clean !== true || row.pms_hold === true || row.is_dnd === true)) return 'guest_inside';
  return 'ready';
}

/** Show what was specifically planned for the room; a generic daily assignment is
 * a fallback service label, never proof that it belongs in second-day service. */
export function laundryService(room: LaundryRoom, assignments: LaundryAssignment[], date: string): LaundryService {
  if (isCheckout(room)) return 'full';
  const override = readGozsduRoomOverride(room.pms_metadata, date);
  const planned = override?.bucket === 'service' ? override.service
    : override ? 'none' : room.pms_metadata?.gozsduHousekeeping?.serviceType;
  if (planned === 'towel_change') return 'towel';
  if (planned === 'change_room') return 'textile';
  if (override?.bucket === 'other') return 'none';
  if (assignments.some(row => row.notes?.includes('[TOWEL_CHANGE_ONLY]'))) return 'towel';
  if (activeLaundryAssignments(assignments).some(row => row.assignment_type === 'daily_cleaning')) return 'daily';
  return 'none';
}

/** Mirror the manager's explicit service bucket and service-due PMS policy.
 * A generic daily assignment or night parity must never merge Other rooms
 * into Second-day stayovers. Each room belongs to exactly one queue. */
export function laundryBucket(room: LaundryRoom, assignments: LaundryAssignment[], date: string): LaundryBucket {
  if (isCheckout(room)) return 'checkout';
  const override = readGozsduRoomOverride(room.pms_metadata, date);
  if (override) return override.bucket === 'service' ? 'second_day' : 'other';
  const plan = room.pms_metadata?.gozsduHousekeeping;
  if (plan) return plan.serviceDue === true && ['towel_change', 'change_room'].includes(plan.serviceType)
    ? 'second_day' : 'other';
  return assignments.some(row => activeLaundryAssignments([row]).length > 0
    && row.notes?.includes('[TOWEL_CHANGE_ONLY]')) ? 'second_day' : 'other';
}

export function groupCurrentLaundryRooms(rooms: LaundryRoom[], assignments: LaundryAssignment[], date: string) {
  const grouped: Record<LaundryBucket, LaundryRoom[]> = { checkout: [], second_day: [], other: [] };
  const byRoom = new Map<string, LaundryAssignment[]>();
  for (const row of assignments) byRoom.set(row.room_id, [...(byRoom.get(row.room_id) || []), row]);
  for (const room of rooms) if (isEligibleLaundryRoom(room)) {
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

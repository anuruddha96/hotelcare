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

/** An assignment alone is not evidence that somebody is inside a room. Only today's
 * actual in_progress housekeeping assignments may display the active-cleaning label. */
export function activeCleaningHousekeeperIds(rows: LaundryAssignment[]): string[] {
  return [...new Set(rows.filter(row => row.status === 'in_progress' && !!row.assigned_to
    && ['checkout_cleaning', 'daily_cleaning', 'deep_cleaning'].includes(row.assignment_type))
    .map(row => row.assigned_to as string))];
}

/** Never interpret a scheduled departure, a dirty room or an old day's RTC as permission to enter. */
export function laundryAccess(room: LaundryRoom, assignments: LaundryAssignment[], date: string): LaundryAccess {
  if (!isEligibleLaundryRoom(room)) return 'unavailable';
  if (room.is_dnd || assignments.some(row => row.is_dnd)) return 'dnd';
  if (!isCheckout(room)) return 'guest_permission';
  const meta = room.pms_metadata || {};
  const live = activeLaundryAssignments(assignments).filter(row => row.assignment_type === 'checkout_cleaning');
  const otherActive = activeLaundryAssignments(assignments).filter(row => row.assignment_type !== 'checkout_cleaning');
  if (meta.lastPmsRefreshDate !== date || meta.checkedOutToday !== true || meta.readyToClean !== true
    || (meta.readyToCleanDate && meta.readyToCleanDate !== date) || !live.length || otherActive.length
    || live.some(row => row.ready_to_clean !== true || row.pms_hold === true || row.is_dnd === true)) return 'guest_inside';
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

/** Mirror the manager's explicit service bucket and service-due PMS policy. In
 * particular, 'daily_cleaning' and even currentNight alone MUST NOT merge generic
 * Other rooms into Second-day stayovers. Each room belongs to exactly one queue. */
export function laundryBucket(room: LaundryRoom, assignments: LaundryAssignment[], date: string): LaundryBucket {
  if (isCheckout(room)) return 'checkout';
  const override = readGozsduRoomOverride(room.pms_metadata, date);
  if (override) return override.bucket === 'service' ? 'second_day' : 'other';
  const plan = room.pms_metadata?.gozsduHousekeeping;
  if (plan) return plan.serviceDue === true && ['towel_change', 'change_room'].includes(plan.serviceType)
    ? 'second_day' : 'other';
  // Legacy rooms without a policy: only an explicit towel-only instruction is
  // sufficient to place them in the second-day queue. Never guess from nights.
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
  // The same ranking is applied independently inside each of the THREE distinct
  // queues; do not combine service-due stayovers with generic Other rooms.
  for (const group of Object.values(grouped)) group.sort((a, b) => {
    const aCleaning = activeCleaningHousekeeperIds(byRoom.get(a.id) || []).length > 0;
    const bCleaning = activeCleaningHousekeeperIds(byRoom.get(b.id) || []).length > 0;
    return Number(bCleaning) - Number(aCleaning)
      || a.room_number.localeCompare(b.room_number, undefined, { numeric: true });
  });
  return grouped;
}

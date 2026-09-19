import { getLaundryBucket, isEligibleLaundryRoom, type LaundryBucket, type LaundryRoom } from './gozsduLaundryner';

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

/** The hotel overview's service metadata and manager override are authoritative; night parity is not. */
export function laundryService(room: LaundryRoom, assignments: LaundryAssignment[], date: string): LaundryService {
  if (isCheckout(room)) return 'full';
  const override = room.pms_metadata?.hotelcareHousekeepingOverrides?.[date];
  const manual = override?.service;
  const planned = manual || room.pms_metadata?.gozsduHousekeeping?.serviceType;
  if (planned === 'towel_change') return 'towel';
  if (planned === 'change_room') return 'textile';
  if (assignments.some(row => row.notes?.includes('[TOWEL_CHANGE_ONLY]'))) return 'towel';
  if (activeLaundryAssignments(assignments).some(row => row.assignment_type === 'daily_cleaning')) return 'daily';
  return 'none';
}

export function laundryBucket(room: LaundryRoom, assignments: LaundryAssignment[], date: string): LaundryBucket {
  if (isCheckout(room)) return 'checkout';
  if (room.pms_metadata?.gozsduHousekeeping || room.pms_metadata?.hotelcareHousekeepingOverrides?.[date]) {
    return laundryService(room, assignments, date) !== 'none' ? 'second_day' : 'other';
  }
  return getLaundryBucket(room);
}

export function groupCurrentLaundryRooms(rooms: LaundryRoom[], assignments: LaundryAssignment[], date: string) {
  const grouped: Record<LaundryBucket, LaundryRoom[]> = { checkout: [], second_day: [], other: [] };
  const byRoom = new Map<string, LaundryAssignment[]>();
  for (const row of assignments) byRoom.set(row.room_id, [...(byRoom.get(row.room_id) || []), row]);
  for (const room of rooms) if (isEligibleLaundryRoom(room)) {
    grouped[laundryBucket(room, byRoom.get(room.id) || [], date)].push(room);
  }
  for (const group of Object.values(grouped)) group.sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  return grouped;
}

import { calculateRoomTime, type AssignmentPreview, type RoomForAssignment } from './roomAssignmentAlgorithm';
import { BREAK_TIME_MINUTES } from './roomAssignmentAlgorithmCore';
import { isPotentialCheckoutRoom } from './nextDayHousekeepingSnapshot';

export type ScheduledWorker = { id: string; organization_slug: string; assigned_hotel: string | null; hotel_id?: string | null; deleted_at?: string | null };
export type WorkSchedule = { user_id: string; status: string; work_date: string; shift_start?: string | null; shift_end?: string | null };
export type PlanValidation = { valid: boolean; reason: string };
const checkout = (room: RoomForAssignment) => room.is_checkout_room === true
  || room.pms_metadata?.scheduledDepartureToday === true;

/** A malformed or partial published shift must not authorize an overlong plan. */
function shiftClockMinutes(value: string | null | undefined): number | null {
  const match = value?.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Read-only validation before any destructive upsert/delete/approval. */
export function validateNextDayPlan(args: {
  expectedRooms: RoomForAssignment[];
  previews: AssignmentPreview[];
  selectedStaffIds: string[];
  workers: ScheduledWorker[];
  schedules: WorkSchedule[];
  organizationSlug: string;
  hotelKeys: string[];
  selectedDate: string;
  excludedRoomIds?: string[];
  maintenanceHoldRoomIds?: string[];
}): PlanValidation {
  const reject = (reason: string): PlanValidation => ({ valid: false, reason });
  const selected = new Set(args.selectedStaffIds);
  if (!args.organizationSlug || !args.selectedDate || !args.hotelKeys.length) return reject('Missing authorized organization, hotel, or work date.');
  if (selected.size !== args.selectedStaffIds.length || !selected.size) return reject('Choose distinct eligible cleaners before approving.');
  if (new Set(args.previews.map(preview => preview.staffId)).size !== args.previews.length)
    return reject('The plan contains duplicate housekeeper cards. Regenerate before approval.');
  const workerMap = new Map(args.workers.map(worker => [worker.id, worker]));
  for (const id of selected) {
    const worker = workerMap.get(id);
    if (!worker || worker.organization_slug !== args.organizationSlug || worker.deleted_at
      || !args.hotelKeys.includes(worker.assigned_hotel || '') && !args.hotelKeys.includes(worker.hotel_id || ''))
      return reject('Selected cleaner does not belong to the authorized property and organization.');
  }
  const schedules = new Map(args.schedules.map(row => [row.user_id, row]));
  if (args.schedules.length) for (const id of selected) {
    const row = schedules.get(id);
    if (!row || row.work_date !== args.selectedDate
      || ['off', 'absent', 'leave', 'sick', 'cancelled', 'canceled', 'draft', 'unpublished'].includes(row.status.toLowerCase()))
      return reject('An employee is absent, off duty, or not scheduled for this date.');
    if (shiftClockMinutes(row.shift_start) === null || shiftClockMinutes(row.shift_end) === null)
      return reject('A selected employee has an incomplete shift. Correct the schedule before approval.');
  }
  const excluded = new Set([...(args.excludedRoomIds || []), ...(args.maintenanceHoldRoomIds || [])]);
  const authorizedRooms = args.expectedRooms.filter(room => !excluded.has(room.id));
  const expectedIds = authorizedRooms.map(room => room.id);
  if (expectedIds.length !== new Set(expectedIds).size || !expectedIds.length)
    return reject('PMS inventory is incomplete, duplicated or empty. Refresh before approval.');
  if (authorizedRooms.some(room => !args.hotelKeys.includes(room.hotel)))
    return reject('PMS workload contains a room from another property.');
  const expected = new Map(authorizedRooms.map(room => [room.id, room]));
  const planned = args.previews.flatMap(preview => preview.rooms.map(room => ({ room, owner: preview.staffId })));
  if (planned.length !== expected.size || new Set(planned.map(entry => entry.room.id)).size !== expected.size)
    return reject('The plan omits or duplicates rooms. Regenerate from the latest PMS snapshot.');
  for (const entry of planned) {
    const authoritative = expected.get(entry.room.id);
    if (!authoritative || !selected.has(entry.owner) || checkout(authoritative) !== checkout(entry.room)
      || isPotentialCheckoutRoom(authoritative) !== isPotentialCheckoutRoom(entry.room)
      || !!authoritative.towel_change_required !== !!entry.room.towel_change_required
      || !!authoritative.linen_change_required !== !!entry.room.linen_change_required)
      return reject('The plan is stale, has an unauthorized owner, or a room cleaning type changed. Regenerate.');
  }
  // A manager can move rooms after regeneration, so validate the actual plan
  // against the authoritative room minutes at approval, not a stale preview total.
  // Existing hotels without a published schedule retain their manual planning flow.
  if (args.schedules.length) for (const preview of args.previews) {
    const row = schedules.get(preview.staffId);
    if (!row) return reject('An assigned housekeeper is no longer scheduled.');
    const start = shiftClockMinutes(row.shift_start);
    const end = shiftClockMinutes(row.shift_end);
    if (start === null || end === null) return reject('A selected employee has an incomplete shift.');
    const shiftLength = (end - start + 1440) % 1440 || 1440;
    const availableRoomMinutes = Math.max(0, shiftLength - BREAK_TIME_MINUTES);
    const authoritativeMinutes = preview.rooms.reduce((total, room) =>
      total + calculateRoomTime(expected.get(room.id)!), 0);
    if (authoritativeMinutes > availableRoomMinutes)
      return reject('A housekeeper’s room workload exceeds the published shift after the required break. Rebalance before approval.');
  }
  return { valid: true, reason: '' };
}

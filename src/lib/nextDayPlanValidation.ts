import type { AssignmentPreview, RoomForAssignment } from './roomAssignmentAlgorithm';

export type ScheduledWorker = { id: string; organization_slug: string; assigned_hotel: string | null; hotel_id?: string | null; deleted_at?: string | null };
export type WorkSchedule = { user_id: string; status: string; work_date: string; shift_start?: string | null; shift_end?: string | null };
export type PlanValidation = { valid: boolean; reason: string };
const checkout = (room: RoomForAssignment) => room.is_checkout_room === true
  || room.pms_metadata?.scheduledDepartureToday === true;

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
    if (!row || row.work_date !== args.selectedDate || ['off', 'absent', 'leave', 'sick', 'cancelled'].includes(row.status))
      return reject('An employee is absent, off duty, or not scheduled for this date.');
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
      || !!authoritative.towel_change_required !== !!entry.room.towel_change_required
      || !!authoritative.linen_change_required !== !!entry.room.linen_change_required)
      return reject('The plan is stale, has an unauthorized owner, or a room cleaning type changed. Regenerate.');
  }
  return { valid: true, reason: '' };
}

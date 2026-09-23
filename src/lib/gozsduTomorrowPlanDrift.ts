import type { RoomForAssignment } from './roomAssignmentAlgorithm';
import { isPotentialCheckoutRoom } from './nextDayHousekeepingSnapshot';

type PlanRoom = Pick<RoomForAssignment, 'id' | 'is_checkout_room' | 'towel_change_required' | 'linen_change_required' | 'pms_metadata'>;

type DriftResult = {
  newlyDue: number;
  noLongerDue: number;
  changedCleaningType: number;
  duplicateAssignments: number;
};

/** Compare the refreshed Gozsdu PMS workload with the manager's proposed room
 * work. Respect explicit manager exclusions/maintenance holds. */
export function checkGozsduTomorrowPlanDrift(
  current: PlanRoom[],
  proposed: PlanRoom[],
  excludedRoomIds: readonly string[] = [],
): DriftResult {
  const currentById = new Map(current.map(room => [room.id, room]));
  const proposedById = new Map(proposed.map(room => [room.id, room]));
  const excluded = new Set(excludedRoomIds);
  let newlyDue = 0;
  let noLongerDue = 0;
  let changedCleaningType = 0;

  for (const room of current) {
    if (!proposedById.has(room.id) && !excluded.has(room.id)) newlyDue += 1;
  }
  for (const room of proposed) {
    const fresh = currentById.get(room.id);
    if (!fresh) {
      noLongerDue += 1;
      continue;
    }
    const checkout = (value: PlanRoom) => value.is_checkout_room === true
      || value.pms_metadata?.scheduledDepartureToday === true;
    if (checkout(room) !== checkout(fresh)
      || isPotentialCheckoutRoom(room) !== isPotentialCheckoutRoom(fresh)
      || Boolean(room.towel_change_required) !== Boolean(fresh.towel_change_required)
      || Boolean(room.linen_change_required) !== Boolean(fresh.linen_change_required)) {
      changedCleaningType += 1;
    }
  }
  return {
    newlyDue,
    noLongerDue,
    changedCleaningType,
    duplicateAssignments: proposed.length - proposedById.size,
  };
}

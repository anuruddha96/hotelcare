import type { RoomForAssignment } from '@/lib/roomAssignmentAlgorithm';

export interface AutoAssignRoomEligibility {
  hasActiveAssignment?: boolean;
  hasCompletedAssignment?: boolean;
}

/**
 * Auto Assign represents the day's PMS workload, not only rooms whose
 * housekeeping status has already changed to `dirty`. A clean room can still
 * be a checkout or daily service room for today.
 */
export function isRoomEligibleForAutoAssign(
  room: Pick<RoomForAssignment, 'status'>,
  assignment: AutoAssignRoomEligibility = {},
): boolean {
  if (assignment.hasActiveAssignment) return true;
  if (assignment.hasCompletedAssignment) return false;
  return room.status !== 'out_of_order';
}


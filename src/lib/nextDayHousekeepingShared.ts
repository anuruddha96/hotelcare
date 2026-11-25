import type { AssignmentPreview, RoomForAssignment } from '@/lib/roomAssignmentAlgorithm';

export type SharedPlanItemLike = {
  room_id: string;
  assigned_to: string;
  source?: string | null;
  recommendation_context?: {
    assignment_role?: string | null;
    suggested_staff_id?: string | null;
  } | null;
};

export type SharedRoomPartition<T extends SharedPlanItemLike> = {
  primaryItems: T[];
  sharedByRoom: Map<string, string>;
};

export function planItemRole(item: SharedPlanItemLike): 'primary' | 'shared' {
  if (item.recommendation_context?.assignment_role === 'shared' || item.source === 'shared') {
    return 'shared';
  }
  return 'primary';
}

/**
 * Restore persisted plans while remaining backward compatible with early plans
 * that could contain duplicate room rows before assignment_role was introduced.
 * The first non-shared row is primary; one additional row becomes the helper.
 */
export function partitionSharedPlanItems<T extends SharedPlanItemLike>(
  items: T[],
): SharedRoomPartition<T> {
  const primaryByRoom = new Map<string, T>();
  const sharedByRoom = new Map<string, string>();

  for (const item of items) {
    const role = planItemRole(item);
    if (role === 'shared') {
      if (!sharedByRoom.has(item.room_id)) sharedByRoom.set(item.room_id, item.assigned_to);
      continue;
    }

    if (!primaryByRoom.has(item.room_id)) {
      primaryByRoom.set(item.room_id, item);
    } else if (!sharedByRoom.has(item.room_id)) {
      // Legacy duplicate: preserve it as a helper instead of silently dropping it.
      sharedByRoom.set(item.room_id, item.assigned_to);
    }
  }

  return { primaryItems: [...primaryByRoom.values()], sharedByRoom };
}

export function setSharedRoomHelper(
  previous: Map<string, string>,
  roomId: string,
  helperStaffId: string | null,
  primaryStaffId: string | null | undefined,
): Map<string, string> {
  const next = new Map(previous);
  if (!helperStaffId || !roomId || helperStaffId === primaryStaffId) {
    next.delete(roomId);
    return next;
  }
  next.set(roomId, helperStaffId);
  return next;
}

export function removeStaffFromSharedRooms(
  previous: Map<string, string>,
  staffId: string,
): Map<string, string> {
  const next = new Map(previous);
  for (const [roomId, helperId] of next.entries()) {
    if (helperId === staffId) next.delete(roomId);
  }
  return next;
}

export function getPrimaryOwnerByRoom(previews: AssignmentPreview[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const preview of previews) {
    for (const room of preview.rooms) owners.set(room.id, preview.staffId);
  }
  return owners;
}

export function getSharedRoomsForStaff(
  rooms: RoomForAssignment[],
  sharedByRoom: Map<string, string>,
  staffId: string,
): RoomForAssignment[] {
  return rooms.filter(room => sharedByRoom.get(room.id) === staffId);
}

/**
 * A shared clean is one room, not two rooms. For workload display and persisted
 * estimated_duration, split the normal duration between the primary and helper.
 */
export function splitSharedDuration(totalMinutes: number): number {
  return Math.max(1, Math.ceil(totalMinutes / 2));
}

export function adjustedStaffMinutes(options: {
  preview: AssignmentPreview;
  allRooms: RoomForAssignment[];
  sharedByRoom: Map<string, string>;
  calculateRoomTime: (room: RoomForAssignment) => number;
}): number {
  const { preview, allRooms, sharedByRoom, calculateRoomTime } = options;
  let minutes = preview.estimatedMinutes;

  for (const room of preview.rooms) {
    if (sharedByRoom.has(room.id)) {
      const normal = calculateRoomTime(room);
      minutes -= normal - splitSharedDuration(normal);
    }
  }

  for (const room of getSharedRoomsForStaff(allRooms, sharedByRoom, preview.staffId)) {
    minutes += splitSharedDuration(calculateRoomTime(room));
  }

  return Math.max(0, minutes);
}

// All hotels use the shared fairness/locality algorithm and bounded candidate
// diversification. Gozsdu additionally keeps its strict mapped-building rules.
// Hotel Memories can use manager-configured physical adjacency across sections.
// Only an explicit manager drag/tap can override Gozsdu rules, never Auto Assign.
export * from './roomAssignmentAlgorithmGozsduLegacy';

import * as original from './roomAssignmentAlgorithmGozsduLegacy';
import { isGozsduCourtHotel } from './gozsdu-housekeeping';
import { isActiveGozsduLaundryner } from './gozsduLaundryDutySession';
import {
  gozsduRoomsCanShare,
  planGozsduBuildingAssignments,
} from './gozsduBuildingAssignment';
import { rebalanceGozsduAssignments } from './gozsduAssignmentBalance';
import { diversifyHousekeepingCandidate } from './housekeepingCandidateDiversification';
import { autoAssignMemoriesSpatially } from './memoriesSpatialAssignment';

export const autoAssignRooms: typeof original.autoAssignRooms = (
  rooms, staff, wingProximityMap, affinityMap, hotelConfig,
) => {
  const onlyGozsdu = rooms.length > 0
    && rooms.every(room => isGozsduCourtHotel(room.hotel))
    && (!hotelConfig?.hotelName || isGozsduCourtHotel(hotelConfig.hotelName));
  // A mixed-hotel list is not a safe source for local optimization. Preserve the
  // historical fallback here; the caller's organization/hotel scope still needs
  // independent server-side validation before any plan may be saved.
  if (!onlyGozsdu && new Set(rooms.map(room => room.hotel)).size > 1) {
    return original.autoAssignRooms(rooms, staff, wingProximityMap, affinityMap, hotelConfig);
  }

  const hotelName = hotelConfig?.hotelName || rooms[0]?.hotel;
  const isMemories = original.isHotelMemoriesBudapest(hotelName);
  const preliminary = onlyGozsdu
    ? planGozsduBuildingAssignments(
      rooms, staff.filter(person => !isActiveGozsduLaundryner(person.id)), hotelConfig,
    )
    : isMemories
      ? autoAssignMemoriesSpatially(
        original.autoAssignRooms,
        rooms,
        staff,
        wingProximityMap,
        affinityMap,
        hotelConfig,
      )
      : original.autoAssignRooms(rooms, staff, wingProximityMap, affinityMap, hotelConfig);
  if (!preliminary.length) return preliminary;
  const balanced = onlyGozsdu ? rebalanceGozsduAssignments(preliminary) : preliminary;
  // The existing UI generates ten seeded options and chooses the fairest.
  // Instead of rotating identical whole room bundles, offer it valid real-room
  // exchanges. The pass preserves coverage, shift safety and Gozsdu routes.
  return diversifyHousekeepingCandidate(balanced, {
    randomSeed: hotelConfig?.randomSeed,
    affinityMap,
    enforceGozsduRoutes: onlyGozsdu,
  });
};

/**
 * Default callers retain the strict mapped-building restriction. Only the
 * Gozsdu UI passes `allowGozsduManagerOverride=true` after checking the user's
 * manager role for a deliberate drag/tap; the automatic planner never does.
 * Laundryner exclusion and destination validation apply even to managers.
 */
export const moveRoom = (
  previews: Parameters<typeof original.moveRoom>[0],
  roomId: string,
  fromStaffId: string,
  toStaffId: string,
  allowGozsduManagerOverride = false,
): ReturnType<typeof original.moveRoom> => {
  const movingRoom = previews.find(person => person.staffId === fromStaffId)
    ?.rooms.find(room => room.id === roomId);
  if (movingRoom && isGozsduCourtHotel(movingRoom.hotel)) {
    if (isActiveGozsduLaundryner(toStaffId)) return previews;
    const destination = previews.find(person => person.staffId === toStaffId);
    if (!destination || (!allowGozsduManagerOverride
      && !gozsduRoomsCanShare([...destination.rooms, movingRoom]))) return previews;
  }
  return original.moveRoom(previews, roomId, fromStaffId, toStaffId);
};

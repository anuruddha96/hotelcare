// All other properties still use the existing portfolio algorithm verbatim.
// Gozsdu alone applies the manager's actual mapped building-sharing constraints
// for AUTOMATIC suggestions. A manager may explicitly override them by moving
// a room in the preview; no automatic generation ever opts into that exception.
export * from './roomAssignmentAlgorithmGozsduLegacy';

import * as original from './roomAssignmentAlgorithmGozsduLegacy';
import { isGozsduCourtHotel } from './gozsdu-housekeeping';
import { isActiveGozsduLaundryner } from './gozsduLaundryDutySession';
import {
  gozsduRoomsCanShare,
  planGozsduBuildingAssignments,
} from './gozsduBuildingAssignment';
import { rebalanceGozsduAssignments } from './gozsduAssignmentBalance';

export const autoAssignRooms: typeof original.autoAssignRooms = (
  rooms, staff, wingProximityMap, affinityMap, hotelConfig,
) => {
  const onlyGozsdu = rooms.length > 0
    && rooms.every(room => isGozsduCourtHotel(room.hotel))
    && (!hotelConfig?.hotelName || isGozsduCourtHotel(hotelConfig.hotelName));
  if (!onlyGozsdu) {
    return original.autoAssignRooms(rooms, staff, wingProximityMap, affinityMap, hotelConfig);
  }
  const eligibleStaff = staff.filter(person => !isActiveGozsduLaundryner(person.id));
  const preliminary = planGozsduBuildingAssignments(rooms, eligibleStaff, hotelConfig);
  return preliminary.length ? rebalanceGozsduAssignments(preliminary) : preliminary;
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

// All other properties still use the existing portfolio algorithm verbatim.
// Gozsdu alone applies the manager's actual mapped building-sharing constraints.
export * from './roomAssignmentAlgorithmGozsduLegacy';

import * as original from './roomAssignmentAlgorithmGozsduLegacy';
import { isGozsduCourtHotel } from './gozsdu-housekeeping';
import { isActiveGozsduLaundryner } from './gozsduLaundryDutySession';
import {
  gozsduRoomsCanShare,
  planGozsduBuildingAssignments,
} from './gozsduBuildingAssignment';

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
  return planGozsduBuildingAssignments(rooms, eligibleStaff, hotelConfig);
};

export const moveRoom: typeof original.moveRoom = (previews, roomId, fromStaffId, toStaffId) => {
  const movingRoom = previews.flatMap(person => person.rooms).find(room => room.id === roomId);
  if (movingRoom && isGozsduCourtHotel(movingRoom.hotel)) {
    if (isActiveGozsduLaundryner(toStaffId)) return previews;
    const destination = previews.find(person => person.staffId === toStaffId);
    if (!destination || !gozsduRoomsCanShare([...destination.rooms, movingRoom])) return previews;
  }
  return original.moveRoom(previews, roomId, fromStaffId, toStaffId);
};

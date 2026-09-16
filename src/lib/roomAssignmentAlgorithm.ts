// Preserve the original building-aware Gozsdu planner and every other hotel's
// algorithm unchanged. Only the Gozsdu Auto Assign session supplies date-scoped
// Laundryner exclusion IDs to this small adapter.
export * from './roomAssignmentAlgorithmGozsduLegacy';

import * as original from './roomAssignmentAlgorithmGozsduLegacy';
import { isGozsduCourtHotel } from './gozsdu-housekeeping';
import { isActiveGozsduLaundryner } from './gozsduLaundryDutySession';

export const autoAssignRooms: typeof original.autoAssignRooms = (
  rooms, staff, wingProximityMap, affinityMap, hotelConfig,
) => {
  const onlyGozsdu = rooms.length > 0
    && rooms.every(room => isGozsduCourtHotel(room.hotel))
    && (!hotelConfig?.hotelName || isGozsduCourtHotel(hotelConfig.hotelName));
  const eligibleStaff = onlyGozsdu
    ? staff.filter(person => !isActiveGozsduLaundryner(person.id))
    : staff;
  return original.autoAssignRooms(rooms, eligibleStaff, wingProximityMap, affinityMap, hotelConfig);
};

export const moveRoom: typeof original.moveRoom = (previews, roomId, fromStaffId, toStaffId) => {
  const movingRoom = previews.flatMap(person => person.rooms).find(room => room.id === roomId);
  if (movingRoom && isGozsduCourtHotel(movingRoom.hotel) && isActiveGozsduLaundryner(toStaffId)) {
    // Ignore a stale drag/drop target. A matching database trigger is the
    // authoritative defense for races, legacy drafts and direct API writes.
    return previews;
  }
  return original.moveRoom(previews, roomId, fromStaffId, toStaffId);
};

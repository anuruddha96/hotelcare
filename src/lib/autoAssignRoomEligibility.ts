import type { RoomForAssignment } from '@/lib/roomAssignmentAlgorithm';
import { getGozsduHousekeepingCycle, isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';

export interface AutoAssignRoomEligibility {
  hasActiveAssignment?: boolean;
  hasCompletedAssignment?: boolean;
}

type EligibilityRoom = Pick<RoomForAssignment, 'status' | 'hotel' | 'is_checkout_room' | 'pms_metadata'>;

/**
 * Auto Assign represents the day's PMS workload. Gozsdu Court Budapest is the
 * only exception: an explicitly operating room must also be due for checkout
 * or its every-second-night stay-over service. All other hotels are unchanged.
 */
export function isRoomEligibleForAutoAssign(
  room: EligibilityRoom,
  assignment: AutoAssignRoomEligibility = {},
): boolean {
  if (assignment.hasCompletedAssignment) return false;

  if (isGozsduCourtHotel(room.hotel)) {
    // Reattached by a server-side room trigger after every PMS synchronization;
    // a missing registry entry is not evidence that the room is operating.
    if (room.pms_metadata?.gozsduAvailability?.status !== 'operating') return false;

    const isNoShow = room.pms_metadata?.isNoShow === true
      || Number(room.pms_metadata?.reservationStatusId) === 8;
    if (isNoShow) return false;

    const checkout = room.is_checkout_room === true
      || room.pms_metadata?.scheduledDepartureToday === true
      || room.pms_metadata?.checkedOutToday === true;
    if (checkout) return true;

    const storedService = room.pms_metadata?.gozsduHousekeeping?.serviceType;
    if (storedService === 'towel_change' || storedService === 'change_room') return true;
    if (storedService === 'none') return false;

    return getGozsduHousekeepingCycle({
      currentNight: room.pms_metadata?.currentNight,
      totalNights: room.pms_metadata?.totalNights,
      isCheckout: false,
    }).serviceDue;
  }

  if (assignment.hasActiveAssignment) return true;
  return room.status !== 'out_of_order';
}

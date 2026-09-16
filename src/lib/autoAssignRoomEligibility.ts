import type { RoomForAssignment } from '@/lib/roomAssignmentAlgorithm';
import { getGozsduHousekeepingCycle, isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';

export interface AutoAssignRoomEligibility {
  hasActiveAssignment?: boolean;
  hasCompletedAssignment?: boolean;
}

type EligibilityRoom = Pick<RoomForAssignment, 'status' | 'hotel' | 'is_checkout_room' | 'pms_metadata'>;

/**
 * Auto Assign represents the day's PMS workload, not only rooms whose
 * housekeeping status has already changed to `dirty`. A clean room can still
 * be a checkout or daily service room for today.
 *
 * Gozsdu Court Budapest is the one deliberate exception to the generic
 * stay-over workload. It does not provide daily service: only checkout rooms
 * and stay-over rooms due under its every-second-night cycle are eligible.
 * The exact property gate keeps every other hotel's existing behaviour intact.
 */
export function isRoomEligibleForAutoAssign(
  room: EligibilityRoom,
  assignment: AutoAssignRoomEligibility = {},
): boolean {
  if (assignment.hasCompletedAssignment) return false;

  if (isGozsduCourtHotel(room.hotel)) {
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

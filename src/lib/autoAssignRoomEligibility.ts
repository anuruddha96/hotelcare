import type { RoomForAssignment } from '@/lib/roomAssignmentAlgorithm';
import { getGozsduHousekeepingCycle, isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';

export interface AutoAssignRoomEligibility {
  hasActiveAssignment?: boolean;
  hasCompletedAssignment?: boolean;
}

type EligibilityRoom = Pick<RoomForAssignment, 'status' | 'hotel' | 'is_checkout_room' | 'pms_metadata'>
  & Partial<Pick<RoomForAssignment, 'towel_change_required' | 'linen_change_required'>>;

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

    // These are fresh, read-only workload projections calculated for the
    // selected planning date, so today's persisted PMS counters do not apply.
    if (room.pms_metadata?.plannedFromDailyOverview === true
      && room.pms_metadata?.selectedDateSnapshotKind === 'daily') {
      return room.towel_change_required === true || room.linen_change_required === true;
    }
    const tomorrowService = room.pms_metadata?.gozsduTomorrowService;
    if (tomorrowService === 'towel_change' || tomorrowService === 'change_room') return true;

    // The persisted serviceType may still be from the old 2/4/6 rule. Do not
    // let that stale value override the hotel's PMS 3/5/7 calculation.
    return getGozsduHousekeepingCycle({
      currentNight: room.pms_metadata?.currentNight,
      totalNights: room.pms_metadata?.totalNights,
      isCheckout: false,
    }).serviceDue;
  }

  if (assignment.hasActiveAssignment) return true;
  return room.status !== 'out_of_order';
}

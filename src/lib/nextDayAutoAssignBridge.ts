// Preserve the portfolio's existing tomorrow planning and persistence logic
// verbatim. Only Gozsdu's unsupported-snapshot fallback is adapted here.
export * from './nextDayAutoAssignBridgeCore';

import * as core from './nextDayAutoAssignBridgeCore';
import { getGozsduHousekeepingCycle, isGozsduCourtHotel } from './gozsdu-housekeeping';
import type { RoomForAssignment } from './roomAssignmentAlgorithm';

type TomorrowArgs = Parameters<typeof core.buildTomorrowAutoAssignRooms>[0];

/** An unsupported Previo tomorrow snapshot must not accidentally restore
 * daily service for every Gozsdu apartment. Only the exact property is gated;
 * the normal authoritative selected-date snapshot and all other hotels remain
 * untouched. This routine only prepares a preview and does not modify rooms. */
export async function buildTomorrowAutoAssignRooms(args: TomorrowArgs):
  ReturnType<typeof core.buildTomorrowAutoAssignRooms> {
  const workload = await core.buildTomorrowAutoAssignRooms(args);
  if (!isGozsduCourtHotel(args.hotelId) || workload.source !== 'metadata-fallback') return workload;

  const operatingRooms = workload.rooms.flatMap((room): RoomForAssignment[] => {
    if (room.pms_metadata?.gozsduAvailability?.status !== 'operating'
      || room.pms_metadata?.isNoShow === true) return [];
    const checkout = room.is_checkout_room === true || room.pms_metadata?.scheduledDepartureToday === true;
    if (checkout) {
      return [{ ...room, towel_change_required: false, linen_change_required: false }];
    }

    const current = Number(room.pms_metadata?.currentNight);
    const total = Number(room.pms_metadata?.totalNights);
    if (!Number.isInteger(current) || current < 1 || !Number.isInteger(total) || total <= current) return [];
    const cycle = getGozsduHousekeepingCycle({
      currentNight: current + 1,
      totalNights: total,
      isCheckout: false,
    });
    if (!cycle.serviceDue) return [];
    return [{
      ...room,
      towel_change_required: cycle.service === 'towel_change',
      linen_change_required: cycle.service === 'change_room',
      pms_metadata: {
        ...room.pms_metadata,
        gozsduTomorrowService: cycle.service,
      },
    }];
  });
  return { ...workload, rooms: operatingRooms };
}

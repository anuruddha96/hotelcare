import { supabase } from '@/integrations/supabase/client';
import { GOZSDU_COURT_HOTEL_ID } from './gozsdu-housekeeping';
import { reconcileGozsduPmsRoster, type GozsduPmsRow } from './gozsduPmsRoster';
import type { RoomForAssignment } from './roomAssignmentAlgorithmCore';

type Registry = { room_id: string; pms_room_name: string; service_status: string };

/** This is strictly an in-memory read-only projection. A full fresh 82-room
 * snapshot is mandatory; sparse 'actually checked out' polling must not set
 * today's scheduled departures or overwrite manager bed/size settings. */
export function projectVerifiedGozsduWorkload(
  rooms: RoomForAssignment[], registry: Registry[], snapshots: GozsduPmsRow[], selectedDate: string,
): RoomForAssignment[] {
  const { byRoom } = reconcileGozsduPmsRoster(rooms, registry, snapshots, selectedDate);
  return rooms.map(room => {
    const verified = byRoom.get(room.id)!;
    const checkout = verified.bucket === 'checkout';
    return {
      ...room,
      is_checkout_room: checkout,
      towel_change_required: verified.service === 'towel_change',
      linen_change_required: verified.service === 'change_room',
      pms_metadata: {
        ...(room.pms_metadata || {}),
        // These flags are projected for today's Auto Assign only, never saved.
        scheduledDepartureToday: checkout,
        checkedOutToday: checkout && room.pms_metadata?.checkedOutToday === true,
        currentNight: verified.night,
        totalNights: verified.totalNights,
        scheduledDepartureTomorrow: verified.leavesTomorrow,
        gozsduHousekeeping: {
          ...(room.pms_metadata?.gozsduHousekeeping || {}),
          serviceType: verified.service,
        },
      },
    };
  });
}

export async function fetchVerifiedGozsduAutoAssignRooms(
  rooms: RoomForAssignment[], organizationSlug: string, selectedDate: string,
): Promise<RoomForAssignment[]> {
  const [registryResult, snapshotResult] = await Promise.all([
    (supabase as any).from('gozsdu_housekeeping_room_registry')
      .select('room_id,pms_room_name,service_status'),
    (supabase as any).from('daily_overview_snapshots')
      .select('room_label,room_number,arrival_date,departure_date,status,housekeeping_dep,captured_at')
      .eq('organization_slug', organizationSlug)
      .eq('hotel_id', GOZSDU_COURT_HOTEL_ID)
      .eq('business_date', selectedDate)
      .eq('source', 'previo'),
  ]);
  if (registryResult.error || snapshotResult.error) throw new Error(
    `Gozsdu Previo data could not be verified: ${registryResult.error?.message || snapshotResult.error?.message}`,
  );
  return projectVerifiedGozsduWorkload(
    rooms, registryResult.data as Registry[], snapshotResult.data as GozsduPmsRow[], selectedDate,
  );
}

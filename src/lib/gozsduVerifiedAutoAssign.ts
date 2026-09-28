import { supabase } from '@/integrations/supabase/client';
import { GOZSDU_COURT_HOTEL_ID } from './gozsdu-housekeeping';
import {
  isGozsduAwaitingArrival,
  missingGozsduPmsRooms,
  reconcileGozsduPmsRoster,
  type GozsduPmsRow,
} from './gozsduPmsRoster';
import type { RoomForAssignment } from './roomAssignmentAlgorithmCore';

type Registry = { room_id: string; pms_room_name: string; service_status: string };

/** Strict, read-only projection used whenever the selected-day PMS coverage is complete. */
export function projectVerifiedGozsduWorkload(
  rooms: RoomForAssignment[], registry: Registry[], snapshots: GozsduPmsRow[], selectedDate: string,
): RoomForAssignment[] {
  const { byRoom } = reconcileGozsduPmsRoster(rooms, registry, snapshots, selectedDate);
  const fullNames = new Map(registry.map(entry => [entry.room_id, entry.pms_room_name]));
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
        gozsduAvailability: { ...(room.pms_metadata?.gozsduAvailability || {}),
          pmsRoomName: fullNames.get(room.id) },
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

function hasExactRegistryIdentity(rooms: RoomForAssignment[], registry: Registry[]): boolean {
  if (!rooms.length || rooms.length !== registry.length) return false;
  const localIds = new Set(rooms.map(room => room.id));
  const registryIds = new Set(registry.map(entry => entry.room_id));
  return localIds.size === rooms.length
    && registryIds.size === registry.length
    && registry.every(entry => localIds.has(entry.room_id))
    && rooms.every(room => registryIds.has(room.id));
}

/**
 * A single missing selected-day Previo row must not take the whole Gozsdu operation offline.
 * We still fail closed for stale/duplicate/malformed data and registry mismatches. Only rooms
 * whose PMS row is genuinely absent are quarantined from Auto Assign until Previo supplies them.
 */
export function projectVerifiedGozsduWorkloadWithMissingRoomFallback(
  rooms: RoomForAssignment[], registry: Registry[], snapshots: GozsduPmsRow[], selectedDate: string,
): RoomForAssignment[] {
  try {
    return projectVerifiedGozsduWorkload(rooms, registry, snapshots, selectedDate);
  } catch (originalError) {
    // Never let the fallback hide a local/registry configuration problem.
    if (!hasExactRegistryIdentity(rooms, registry)) throw originalError;

    const missingNames = new Set(missingGozsduPmsRooms(registry, snapshots));
    if (!missingNames.size) throw originalError;

    const roomById = new Map(rooms.map(room => [room.id, room]));
    const quarantined = registry.filter(entry => {
      if (!missingNames.has(entry.pms_room_name)) return false;
      const room = roomById.get(entry.room_id);
      // Explicit date-matched pending arrivals are already safely rehydrated by the strict reconciler.
      return !!room && !isGozsduAwaitingArrival(room, selectedDate);
    });
    if (!quarantined.length) throw originalError;

    const quarantinedIds = new Set(quarantined.map(entry => entry.room_id));
    const verifiedRooms = rooms.filter(room => !quarantinedIds.has(room.id));
    const verifiedRegistry = registry.filter(entry => !quarantinedIds.has(entry.room_id));

    // Re-run the strict reconciliation on the remaining rooms. Any stale, duplicate,
    // unmapped or malformed PMS data still throws and keeps Auto Assign fail-closed.
    const projected = projectVerifiedGozsduWorkload(
      verifiedRooms, verifiedRegistry, snapshots, selectedDate,
    );

    console.warn(
      `[Gozsdu Auto Assign] Quarantined ${quarantined.length} room(s) missing from selected-day PMS: ${quarantined.map(entry => entry.pms_room_name).join(', ')}`,
    );
    return projected;
  }
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
  return projectVerifiedGozsduWorkloadWithMissingRoomFallback(
    rooms, registryResult.data as Registry[], snapshotResult.data as GozsduPmsRow[], selectedDate,
  );
}

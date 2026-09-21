// Preserve the portfolio's existing tomorrow planning and persistence logic
// verbatim. Only Gozsdu-specific snapshot verification and unsupported-snapshot
// fallback are adapted here.
export * from './nextDayAutoAssignBridgeCore';

import * as core from './nextDayAutoAssignBridgeCore';
import { supabase } from '@/integrations/supabase/client';
import { getGozsduHousekeepingCycle, isGozsduCourtHotel } from './gozsdu-housekeeping';
import { verifyGozsduTomorrowSnapshot, type GozsduTomorrowSnapshotRow } from './gozsduTomorrowSnapshotAuthority';
import type { RoomForAssignment } from './roomAssignmentAlgorithm';

type TomorrowArgs = Parameters<typeof core.buildTomorrowAutoAssignRooms>[0];
type SnapshotArgs = Parameters<typeof core.ensureTomorrowPmsSnapshot>[0];

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Gozsdu Court only: the exact-date Previo roster determines which rooms exist
 * for next-day planning. Its size need not equal the static HotelCare registry:
 * excluded/unavailable units and non-guest stays can change between dates.
 * A missing, stale or malformed feed still fails closed. Other hotels continue
 * through their original inventory and coverage checks without any change.
 */
export async function ensureTomorrowPmsSnapshot(args: SnapshotArgs):
  ReturnType<typeof core.ensureTomorrowPmsSnapshot> {
  if (!isGozsduCourtHotel(args.hotelId)) return core.ensureTomorrowPmsSnapshot(args);

  const readExactDate = async () => {
    const { data, error } = await (supabase as any)
      .from('daily_overview_snapshots')
      .select('business_date,room_label,room_number,captured_at')
      .eq('organization_slug', args.organizationSlug)
      .eq('hotel_id', args.hotelId)
      .eq('business_date', args.selectedDate)
      .eq('source', 'previo');
    if (error) throw error;
    return verifyGozsduTomorrowSnapshot(
      (data || []) as GozsduTomorrowSnapshotRow[], args.selectedDate,
    );
  };

  if (!args.forceFresh) {
    const current = await readExactDate();
    if (current) {
      return {
        capturedAt: current.capturedAt,
        rowCount: current.rowCount,
        roomCount: current.rowCount,
        reused: true,
        authoritative: true,
      };
    }
  }

  // Re-fetch the exact business date; a successful today's poll cannot stand
  // in for tomorrow's overview. Do not mutate today's room/checkout flags.
  const { data: overview, error: syncError } = await supabase.functions.invoke(
    'previo-sync-daily-overview', {
      body: {
        hotelId: args.hotelId,
        fromDate: shiftDate(args.selectedDate, -1),
        toDate: shiftDate(args.selectedDate, 1),
        days: 2,
      },
    },
  );
  if (syncError || (overview as any)?.ok === false || (overview as any)?.error) {
    throw new Error(
      (overview as any)?.error || syncError?.message || 'Could not load the selected-date Previo room snapshot.',
    );
  }

  const current = await readExactDate();
  if (!current) {
    throw new Error(`Previo did not provide a valid fresh room snapshot for ${args.selectedDate}. Nothing was assigned.`);
  }
  return {
    capturedAt: current.capturedAt,
    rowCount: current.rowCount,
    roomCount: current.rowCount,
    reused: false,
    authoritative: true,
  };
}

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

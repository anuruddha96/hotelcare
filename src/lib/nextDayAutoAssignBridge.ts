// Preserve the portfolio's existing tomorrow planning and persistence logic
// verbatim. Only Gozsdu-specific snapshot verification, optional work and
// save revalidation are adapted here.
export * from './nextDayAutoAssignBridgeCore';

import * as core from './nextDayAutoAssignBridgeCore';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from './hotelKeys';
import { GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME, getGozsduHousekeepingCycle, isGozsduCourtHotel } from './gozsdu-housekeeping';
import { verifyGozsduTomorrowSnapshot, type GozsduTomorrowSnapshotRow } from './gozsduTomorrowSnapshotAuthority';
import { checkGozsduTomorrowPlanDrift } from './gozsduTomorrowPlanDrift';
import {
  buildGozsduOptionalRooms, getGozsduOptionalSelection, gozsduOptionKey,
  selectGozsduOptionalRooms, type GozsduOptionalRoom, type GozsduRosterRow,
} from './gozsduTomorrowOptionalRooms';
import type { RoomForAssignment } from './roomAssignmentAlgorithm';

type TomorrowArgs = Parameters<typeof core.buildTomorrowAutoAssignRooms>[0];
type SnapshotArgs = Parameters<typeof core.ensureTomorrowPmsSnapshot>[0];
type SaveArgs = Parameters<typeof core.saveApprovedNextDayAutoAssignPlan>[0];

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Gozsdu's exact-date roster can be smaller than its 82-unit registry.
 * A missing, stale, duplicate or malformed PMS feed still fails closed. */
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
    if (current) return {
      capturedAt: current.capturedAt, rowCount: current.rowCount,
      roomCount: current.rowCount, reused: true, authoritative: true,
    };
  }
  // Fetch the selected business date, never today checkout flags.
  const { data: overview, error: syncError } = await supabase.functions.invoke(
    'previo-sync-daily-overview', {
      body: {
        hotelId: args.hotelId,
        fromDate: shiftDate(args.selectedDate, -1),
        toDate: shiftDate(args.selectedDate, 2),
        days: 3,
      },
    },
  );
  if (syncError || (overview as any)?.ok === false || (overview as any)?.error) {
    throw new Error((overview as any)?.error || syncError?.message || 'Could not load the selected-date Previo room snapshot.');
  }
  const current = await readExactDate();
  if (!current) throw new Error(`Previo did not provide a valid fresh room snapshot for ${args.selectedDate}. Nothing was assigned.`);
  return {
    capturedAt: current.capturedAt, rowCount: current.rowCount,
    roomCount: current.rowCount, reused: false, authoritative: true,
  };
}

/** Adjacent snapshots identify arrival-only and previous-day departure units;
 * neither may be promoted to a selected-date checkout. Requires the complete
 * same-batch selected-date and next-date feeds to avoid false vacancy labels. */
export async function loadGozsduTomorrowOptionalCandidates(args: {
  organizationSlug: string;
  selectedDate: string;
  roomRows: any[];
  expectedCapture?: string | null;
}): Promise<GozsduOptionalRoom[]> {
  const dates = [shiftDate(args.selectedDate, -1), args.selectedDate, shiftDate(args.selectedDate, 1)];
  const { data, error } = await (supabase as any)
    .from('daily_overview_snapshots')
    .select('business_date,room_label,arrival_date,departure_date,status,captured_at')
    .eq('organization_slug', args.organizationSlug)
    .eq('hotel_id', GOZSDU_COURT_HOTEL_ID)
    .eq('source', 'previo')
    .in('business_date', dates);
  if (error) throw error;
  const rows = data || [];
  const selected = rows.filter((row: any) => row.business_date === args.selectedDate);
  const following = rows.filter((row: any) => row.business_date === dates[2]);
  if (!selected.length || !following.length) {
    throw new Error('Gozsdu adjacent PMS rosters are missing; cannot safely identify empty or arrival-only rooms. Refresh Previo.');
  }
  const selectedCapture = selected[0].captured_at;
  if (!selectedCapture || selected.some((row: any) => row.captured_at !== selectedCapture)
    || (args.expectedCapture && selectedCapture !== args.expectedCapture)
    || following.some((row: any) => row.captured_at !== selectedCapture)) {
    throw new Error('Gozsdu selected-date and arrival rosters came from different PMS batches. Refresh Previo.');
  }
  return buildGozsduOptionalRooms({
    selectedDate: args.selectedDate,
    roomRows: args.roomRows,
    selectedRows: selected as GozsduRosterRow[],
    precedingRows: rows.filter((row: any) => row.business_date === dates[0]) as GozsduRosterRow[],
    followingRows: following as GozsduRosterRow[],
  });
}

/** Only the exact Gozsdu property gets optional manager-selected work.
 * Existing mandatory checkout and due-stayover calculation is untouched. */
export async function buildTomorrowAutoAssignRooms(args: TomorrowArgs):
  ReturnType<typeof core.buildTomorrowAutoAssignRooms> {
  const workload = await core.buildTomorrowAutoAssignRooms(args);
  if (!isGozsduCourtHotel(args.hotelId)) return workload;
  if (workload.source === 'selected-date') {
    const selectedIds = getGozsduOptionalSelection(gozsduOptionKey(args.organizationSlug, GOZSDU_COURT_HOTEL_ID, args.selectedDate));
    if (!selectedIds.size) return workload;
    const candidates = await loadGozsduTomorrowOptionalCandidates({
      organizationSlug: args.organizationSlug,
      selectedDate: args.selectedDate,
      roomRows: args.roomRows,
      expectedCapture: workload.capturedAt,
    });
    const optionalRooms = selectGozsduOptionalRooms(candidates, selectedIds);
    const mandatoryIds = new Set(workload.rooms.map(room => room.id));
    if (optionalRooms.some(room => mandatoryIds.has(room.id))) throw new Error('Gozsdu optional room overlaps mandatory work. Reopen planning.');
    return { ...workload, rooms: [...workload.rooms, ...optionalRooms] };
  }
  // Unsupported snapshot fallback must not accidentally restore daily service
  // for every Gozsdu apartment, and never adds unverified optional units.
  const operatingRooms = workload.rooms.flatMap((room): RoomForAssignment[] => {
    if (room.pms_metadata?.gozsduAvailability?.status !== 'operating'
      || room.pms_metadata?.isNoShow === true) return [];
    const checkout = room.is_checkout_room === true || room.pms_metadata?.scheduledDepartureToday === true;
    if (checkout) return [{ ...room, towel_change_required: false, linen_change_required: false }];
    const current = Number(room.pms_metadata?.currentNight);
    const total = Number(room.pms_metadata?.totalNights);
    if (!Number.isInteger(current) || current < 1 || !Number.isInteger(total) || total <= current) return [];
    const cycle = getGozsduHousekeepingCycle({ currentNight: current + 1, totalNights: total, isCheckout: false });
    if (!cycle.serviceDue) return [];
    return [{ ...room,
      towel_change_required: cycle.service === 'towel_change',
      linen_change_required: cycle.service === 'change_room',
      pms_metadata: { ...room.pms_metadata, gozsduTomorrowService: cycle.service },
    }];
  });
  return { ...workload, rooms: operatingRooms };
}

/** Re-fetch immediately before approval and reject changed checkout/service
 * or optional vacancy/arrival evidence. Do not modify other tenants. */
export async function saveApprovedNextDayAutoAssignPlan(args: SaveArgs):
  ReturnType<typeof core.saveApprovedNextDayAutoAssignPlan> {
  if (!isGozsduCourtHotel(args.hotelId)) return core.saveApprovedNextDayAutoAssignPlan(args);
  const source = await ensureTomorrowPmsSnapshot({
    organizationSlug: args.organizationSlug, hotelId: GOZSDU_COURT_HOTEL_ID,
    selectedDate: args.selectedDate, forceFresh: true,
  });
  const resolvedKeys = await resolveHotelKeys(GOZSDU_COURT_HOTEL_ID);
  const hotelKeys = [...new Set([...resolvedKeys, GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME])];
  const { data: roomRows, error: roomError } = await supabase
    .from('rooms')
    .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
    .in('hotel', hotelKeys)
    .eq('organization_slug', args.organizationSlug);
  if (roomError || !roomRows) throw new Error('Could not verify Gozsdu room mappings. The tomorrow plan was not saved.');
  const workload = await buildTomorrowAutoAssignRooms({
    organizationSlug: args.organizationSlug,
    hotelId: GOZSDU_COURT_HOTEL_ID,
    selectedDate: args.selectedDate,
    roomRows,
  });
  if (workload.source !== 'selected-date' || workload.capturedAt !== source.capturedAt) {
    throw new Error('Previo changed during Gozsdu plan verification. Reopen Auto Assign for a fresh preview. Nothing was saved.');
  }
  const proposed = args.previews.flatMap(preview => preview.rooms);
  const drift = checkGozsduTomorrowPlanDrift(workload.rooms, proposed,
    [...(args.excludedRoomIds || []), ...(args.maintenanceHoldRoomIds || [])]);
  const freshByRoom = new Map(workload.rooms.map(room => [room.id, room]));
  const changedOptional = proposed.some(room => {
    const oldKind = room.pms_metadata?.gozsduOptionalCleaning?.kind;
    const newKind = freshByRoom.get(room.id)?.pms_metadata?.gozsduOptionalCleaning?.kind;
    return oldKind !== newKind;
  });
  if (Object.values(drift).some(count => count > 0) || changedOptional) {
    throw new Error(
      `Gozsdu PMS workload changed: ${drift.newlyDue} newly due, ${drift.noLongerDue} no longer due, `
      + `${drift.changedCleaningType} cleaning type change(s), ${drift.duplicateAssignments} duplicate(s)${changedOptional ? ', optional vacancy changed' : ''}. Reopen Auto Assign and regenerate. Nothing was saved.`,
    );
  }
  return core.saveApprovedNextDayAutoAssignPlan({
    ...args, hotelId: GOZSDU_COURT_HOTEL_ID, pmsSyncedAt: source.capturedAt,
  });
}

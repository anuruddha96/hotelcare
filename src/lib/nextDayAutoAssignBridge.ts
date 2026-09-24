// Preserve the portfolio's existing tomorrow planning and persistence logic.
// Every property receives scoped roster and selected-date verification before
// save. Gozsdu retains its additional property-specific inventory/drift rules.
export * from './nextDayAutoAssignBridgeCore';

import * as core from './nextDayAutoAssignBridgeCore';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from './hotelKeys';
import { GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME, getGozsduHousekeepingCycle, isGozsduCourtHotel } from './gozsdu-housekeeping';
import { verifyGozsduTomorrowSnapshot, type GozsduTomorrowSnapshotRow } from './gozsduTomorrowSnapshotAuthority';
import { checkGozsduTomorrowPlanDrift } from './gozsduTomorrowPlanDrift';
import type { RoomForAssignment } from './roomAssignmentAlgorithm';
import { validateNextDayPlan } from './nextDayPlanValidation';

type TomorrowArgs = Parameters<typeof core.buildTomorrowAutoAssignRooms>[0];
type SnapshotArgs = Parameters<typeof core.ensureTomorrowPmsSnapshot>[0];
type SaveArgs = Parameters<typeof core.saveApprovedNextDayAutoAssignPlan>[0];

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Gozsdu's selected-date Previo roster determines which rooms are operating;
 * an unsupported, stale or malformed feed still fails closed. */
export async function ensureTomorrowPmsSnapshot(args: SnapshotArgs):
  ReturnType<typeof core.ensureTomorrowPmsSnapshot> {
  if (!isGozsduCourtHotel(args.hotelId)) return core.ensureTomorrowPmsSnapshot(args);

  args.onProgress?.({ phase: 'checking-cache', attempt: 1, maxAttempts: 3 });

  const readExactDate = async () => {
    const { data, error } = await (supabase as any)
      .from('daily_overview_snapshots')
      .select('business_date,room_label,room_number,captured_at')
      .eq('organization_slug', args.organizationSlug)
      .eq('hotel_id', args.hotelId)
      .eq('business_date', args.selectedDate)
      .eq('source', 'previo');
    if (error) throw error;
    const rows = (data || []) as GozsduTomorrowSnapshotRow[];
    return {
      rows,
      verified: verifyGozsduTomorrowSnapshot(rows, args.selectedDate),
    };
  };

  if (!args.forceFresh) {
    const current = await readExactDate();
    if (current.verified) {
      return {
        capturedAt: current.verified.capturedAt,
        rowCount: current.verified.rowCount,
        roomCount: current.verified.rowCount,
        reused: true,
        authoritative: true,
      };
    }
  }

  await core.invokeTomorrowDailyOverviewWithRetry({
    ...args,
    fromDate: shiftDate(args.selectedDate, -1),
    toDate: shiftDate(args.selectedDate, 1),
    days: 2,
  });

  args.onProgress?.({ phase: 'validating-snapshot', attempt: 1, maxAttempts: 3 });
  const current = await readExactDate();
  if (!current.verified) {
    // A non-empty malformed/stale roster still fails closed. Only a genuinely
    // empty exact-date result after the successful sync means "all vacant".
    if (current.rows.length === 0) {
      const resolvedKeys = await resolveHotelKeys(GOZSDU_COURT_HOTEL_ID);
      const hotelKeys = [...new Set([...resolvedKeys, GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME])];
      const { count, error: countError } = await supabase
        .from('rooms')
        .select('id', { count: 'exact', head: true })
        .eq('organization_slug', args.organizationSlug)
        .in('hotel', hotelKeys);
      if (countError || !count) throw new Error('Could not verify Gozsdu room inventory after the empty Previo snapshot.');
      return {
        capturedAt: new Date().toISOString(),
        rowCount: 0,
        roomCount: Number(count),
        reused: false,
        authoritative: true,
      };
    }
    throw new Error(`Previo did not provide a valid fresh room snapshot for ${args.selectedDate}. Nothing was assigned.`);
  }
  return {
    capturedAt: current.verified.capturedAt,
    rowCount: current.verified.rowCount,
    roomCount: current.verified.rowCount,
    reused: false,
    authoritative: true,
  };
}

/** Gozsdu fallback never invents daily service for apartments without a
 * verified stay and configured cleaning cycle. This prepares a preview only. */
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

/** Preflight is deliberately performed BEFORE any upsert, delete, assignment,
 * or approval. Auth/RLS is not replaced by client-side property filters. */
async function verifyPlanAccessAndRoster(args: SaveArgs, hotelKeys: string[]) {
  const { data: allowed, error: accessError } = await supabase.rpc(
    'can_manage_next_day_housekeeping_plan',
    { p_organization_slug: args.organizationSlug, p_hotel_id: args.hotelId },
  );
  if (accessError || allowed !== true) throw new Error('You do not have permission to approve this property’s housekeeping plan.');
  const [workersResult, schedulesResult] = await Promise.all([
    supabase.from('profiles')
      .select('id,organization_slug,assigned_hotel,hotel_id,deleted_at,role,acts_as_housekeeper')
      .eq('organization_slug', args.organizationSlug)
      .in('id', args.selectedStaffIds),
    (supabase as any).from('staff_schedules')
      .select('user_id,status,work_date,shift_start,shift_end')
      .eq('organization_slug', args.organizationSlug)
      .eq('hotel_id', args.hotelId)
      .eq('work_date', args.selectedDate),
  ]);
  if (workersResult.error || schedulesResult.error)
    throw new Error('Cannot verify eligible staff or the selected-date work schedule. Nothing was saved.');
  const workers = workersResult.data || [];
  if (workers.some(worker => worker.role !== 'housekeeping' && !worker.acts_as_housekeeper))
    throw new Error('Only eligible housekeeping employees can receive automatic room assignments.');
  if (args.selectedStaffIds.some(id => !workers.some(worker => worker.id === id)))
    throw new Error('A selected employee is missing from the authorized organization. Nothing was saved.');
  return { workers, schedules: schedulesResult.data || [], hotelKeys };
}

/** Snapshot authority checks cover EVERY Previo row. The workload builder's
 * timestamp only covers rows requiring service, so a later check-in/no-service
 * row must not incorrectly invalidate a fresh, complete inventory. Conversely,
 * relevant work dated after the verified snapshot must be rejected. */
export function compatibleHousekeepingSnapshotTime(authoritative: string, workload: string | null): boolean {
  const latest = Date.parse(authoritative);
  const relevant = Date.parse(workload || '');
  return Number.isFinite(latest) && Number.isFinite(relevant)
    && relevant <= latest && latest - relevant <= 15 * 60 * 1000;
}

/** Exact-date Previo revalidation, organization-scoped room inventory, role,
 * schedule and full room-coverage checks for ALL non-Gozsdu properties. */
async function saveVerifiedPortfolioPlan(args: SaveArgs):
  ReturnType<typeof core.saveApprovedNextDayAutoAssignPlan> {
  const resolved = await resolveHotelKeys(args.hotelId);
  const hotelKeys = [...new Set([args.hotelId, args.hotelName, ...resolved].filter(Boolean))];
  const roster = await verifyPlanAccessAndRoster(args, hotelKeys);
  const source = await ensureTomorrowPmsSnapshot({
    organizationSlug: args.organizationSlug,
    hotelId: args.hotelId,
    selectedDate: args.selectedDate,
    forceFresh: true,
  });
  if (!source.authoritative) throw new Error('An authoritative Previo snapshot is unavailable. Nothing was saved.');
  const { data: roomRows, error: roomError } = await supabase.from('rooms')
    .select('id,room_number,hotel,floor_number,room_size_sqm,room_capacity,is_checkout_room,pms_metadata,status,towel_change_required,linen_change_required,wing,elevator_proximity,room_category,bed_configuration,notes,checkout_time')
    .eq('organization_slug', args.organizationSlug)
    .in('hotel', hotelKeys);
  if (roomError || !roomRows) throw new Error('Could not validate this organization’s room inventory. Nothing was saved.');
  const workload = await buildTomorrowAutoAssignRooms({
    organizationSlug: args.organizationSlug,
    hotelId: args.hotelId,
    selectedDate: args.selectedDate,
    roomRows,
    pmsSyncedAt: source.capturedAt,
  });
  if (workload.source !== 'selected-date'
    || !compatibleHousekeepingSnapshotTime(source.capturedAt, workload.capturedAt))
    throw new Error('PMS data is stale or changed while verifying the date. Reopen the planner and regenerate.');
  const result = validateNextDayPlan({
    expectedRooms: workload.rooms,
    previews: args.previews,
    selectedStaffIds: args.selectedStaffIds,
    workers: roster.workers,
    schedules: roster.schedules,
    organizationSlug: args.organizationSlug,
    hotelKeys,
    selectedDate: args.selectedDate,
    excludedRoomIds: args.excludedRoomIds,
    maintenanceHoldRoomIds: args.maintenanceHoldRoomIds,
  });
  if (!result.valid) throw new Error(result.reason + ' Nothing was saved.');
  return core.saveApprovedNextDayAutoAssignPlan({ ...args, pmsSyncedAt: source.capturedAt });
}

/** Gozsdu adds exact-date PMS occupancy and stay-cycle drift checks on top of
 * the same staff authorization, isolation and coverage requirements. */
export async function saveApprovedNextDayAutoAssignPlan(args: SaveArgs):
  ReturnType<typeof core.saveApprovedNextDayAutoAssignPlan> {
  if (!isGozsduCourtHotel(args.hotelId)) return saveVerifiedPortfolioPlan(args);

  const resolvedKeys = await resolveHotelKeys(GOZSDU_COURT_HOTEL_ID);
  const hotelKeys = [...new Set([...resolvedKeys, GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME])];
  const roster = await verifyPlanAccessAndRoster(args, hotelKeys);
  const source = await ensureTomorrowPmsSnapshot({
    organizationSlug: args.organizationSlug,
    hotelId: GOZSDU_COURT_HOTEL_ID,
    selectedDate: args.selectedDate,
    forceFresh: true,
  });
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
    pmsSyncedAt: source.capturedAt,
  });
  if (workload.source !== 'selected-date'
    || !compatibleHousekeepingSnapshotTime(source.capturedAt, workload.capturedAt)) {
    throw new Error('Previo changed during Gozsdu plan verification. Reopen Auto Assign for a fresh preview. Nothing was saved.');
  }

  const proposed = args.previews.flatMap(preview => preview.rooms);
  const drift = checkGozsduTomorrowPlanDrift(
    workload.rooms,
    proposed,
    [...(args.excludedRoomIds || []), ...(args.maintenanceHoldRoomIds || [])],
  );
  if (Object.values(drift).some(count => count > 0)) {
    throw new Error(
      `Previo's Gozsdu housekeeping workload changed: ${drift.newlyDue} new room(s) due, `
      + `${drift.noLongerDue} no longer due, ${drift.changedCleaningType} checkout/service change(s), `
      + `${drift.duplicateAssignments} duplicate(s). Reopen Auto Assign and regenerate the preview; nothing was saved.`,
    );
  }
  const result = validateNextDayPlan({
    expectedRooms: workload.rooms,
    previews: args.previews,
    selectedStaffIds: args.selectedStaffIds,
    workers: roster.workers,
    schedules: roster.schedules,
    organizationSlug: args.organizationSlug,
    hotelKeys,
    selectedDate: args.selectedDate,
    excludedRoomIds: args.excludedRoomIds,
    maintenanceHoldRoomIds: args.maintenanceHoldRoomIds,
  });
  if (!result.valid) throw new Error(result.reason + ' Nothing was saved.');
  return core.saveApprovedNextDayAutoAssignPlan({
    ...args,
    hotelId: GOZSDU_COURT_HOTEL_ID,
    pmsSyncedAt: source.capturedAt,
  });
}

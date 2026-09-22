import { readFileSync, writeFileSync } from 'node:fs';
const path = 'src/lib/nextDayAutoAssignBridge.ts';
let source = readFileSync(path, 'utf8');
const once = (from, to) => {
  if (source.indexOf(from) < 0 || source.split(from).length !== 2)
    throw new Error(`Invalid unique next-day source anchor: ${from.slice(0, 65)}`);
  source = source.replace(from, to);
};
once("import type { RoomForAssignment } from './roomAssignmentAlgorithm';",
"import type { RoomForAssignment } from './roomAssignmentAlgorithm';\nimport { validateNextDayPlan } from './nextDayPlanValidation';");
const helper = `
/** No plan is modified until authorization, staff eligibility and a fresh exact-
 * date PMS workload have all been verified. Each query is tenant-scoped AND
 * enforced by RLS; no client-only hotel-name matching is relied on. */
async function saveVerifiedPortfolioPlan(args: SaveArgs):
  ReturnType<typeof core.saveApprovedNextDayAutoAssignPlan> {
  const { data: allowed, error: accessError } = await supabase.rpc(
    'can_manage_next_day_housekeeping_plan',
    { p_organization_slug: args.organizationSlug, p_hotel_id: args.hotelId },
  );
  if (accessError || allowed !== true) throw new Error('You do not have permission to approve this property’s housekeeping plan.');
  const resolved = await resolveHotelKeys(args.hotelId);
  const keys = [...new Set([args.hotelId, args.hotelName, ...resolved].filter(Boolean))];
  const [workersResult, schedulesResult, source] = await Promise.all([
    supabase.from('profiles')
      .select('id,organization_slug,assigned_hotel,hotel_id,deleted_at,role,acts_as_housekeeper')
      .eq('organization_slug', args.organizationSlug)
      .in('id', args.selectedStaffIds),
    (supabase as any).from('staff_schedules')
      .select('user_id,status,work_date,shift_start,shift_end')
      .eq('organization_slug', args.organizationSlug)
      .eq('hotel_id', args.hotelId)
      .eq('work_date', args.selectedDate),
    ensureTomorrowPmsSnapshot({ organizationSlug: args.organizationSlug,
      hotelId: args.hotelId, selectedDate: args.selectedDate, forceFresh: true }),
  ]);
  if (workersResult.error || schedulesResult.error || !source.authoritative)
    throw new Error('Cannot verify staff availability or a fresh PMS snapshot. Nothing was saved.');
  if ((workersResult.data || []).some(worker => worker.role !== 'housekeeping' && !worker.acts_as_housekeeper))
    throw new Error('Only eligible housekeeping employees can receive automatic room assignments.');
  const { data: roomRows, error: roomError } = await supabase.from('rooms')
    .select('id,room_number,hotel,floor_number,room_size_sqm,room_capacity,is_checkout_room,pms_metadata,status,towel_change_required,linen_change_required,wing,elevator_proximity,room_category,bed_configuration,notes,checkout_time')
    .eq('organization_slug', args.organizationSlug)
    .in('hotel', keys);
  if (roomError || !roomRows) throw new Error('Could not validate this organization’s room inventory. Nothing was saved.');
  const workload = await buildTomorrowAutoAssignRooms({ organizationSlug: args.organizationSlug,
    hotelId: args.hotelId, selectedDate: args.selectedDate, roomRows });
  if (workload.source !== 'selected-date' || workload.capturedAt !== source.capturedAt)
    throw new Error('PMS data is stale or changed while verifying the date. Reopen the planner and regenerate.');
  const result = validateNextDayPlan({
    expectedRooms: workload.rooms,
    previews: args.previews,
    selectedStaffIds: args.selectedStaffIds,
    workers: workersResult.data || [],
    schedules: schedulesResult.data || [],
    organizationSlug: args.organizationSlug,
    hotelKeys: keys,
    selectedDate: args.selectedDate,
    excludedRoomIds: args.excludedRoomIds,
    maintenanceHoldRoomIds: args.maintenanceHoldRoomIds,
  });
  if (!result.valid) throw new Error(result.reason + ' Nothing was saved.');
  return core.saveApprovedNextDayAutoAssignPlan({ ...args, pmsSyncedAt: source.capturedAt });
}

`;
once("/** Gozsdu only: a preview is not a promise that Previo's reservations will stay",
helper + "/** Gozsdu only: a preview is not a promise that Previo's reservations will stay");
once("  if (!isGozsduCourtHotel(args.hotelId)) return core.saveApprovedNextDayAutoAssignPlan(args);",
"  if (!isGozsduCourtHotel(args.hotelId)) return saveVerifiedPortfolioPlan(args);");
once("    .in('hotel', hotelKeys);\n  if (roomError || !roomRows)",
"    .in('hotel', hotelKeys)\n    .eq('organization_slug', args.organizationSlug);\n  if (roomError || !roomRows)");
writeFileSync(path, source);
console.log('Added tenant-scoped, exact-date PMS/staff coverage checks before any non-Gozsdu save.');

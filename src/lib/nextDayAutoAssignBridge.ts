import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { runPmsRefresh } from '@/lib/pmsRefresh';
import {
  buildSelectedDateHousekeepingWorkload,
  type DailyOverviewWorkRow,
} from '@/lib/nextDayHousekeepingSnapshot';
import {
  calculateRoomTime,
  getFloorFromRoomNumber,
  type AssignmentPreview,
  type RoomForAssignment,
} from '@/lib/roomAssignmentAlgorithm';
import { splitSharedDuration } from '@/lib/nextDayHousekeepingShared';

export const TOMORROW_PMS_REUSE_MS = 15 * 60 * 1000;

export type NextDayPlanItem = {
  id: string;
  room_id: string;
  assigned_to: string;
  assignment_type: 'checkout_cleaning' | 'daily_cleaning';
  priority: number | null;
  source: 'auto' | 'manager' | 'manual' | 'learned' | 'shared';
  recommendation_context?: Record<string, any> | null;
};

export type NextDayPlan = {
  id: string;
  status: 'draft' | 'approved' | 'releasing' | 'released' | 'cancelled' | 'failed';
  auto_release: boolean;
  release_timezone: string;
  created_by: string;
  pms_synced_at: string | null;
};

export type NextDayAreaTask = {
  id?: string;
  task_key: string;
  task_name: string;
  task_type: string;
  assigned_to: string;
  source: 'mapped' | 'manual';
  section_id?: string | null;
  section_task_id?: string | null;
  estimated_duration?: number | null;
  sort_order?: number;
};

export type ExistingNextDayPlan = {
  plan: NextDayPlan | null;
  staffIds: string[];
  items: NextDayPlanItem[];
  areas: NextDayAreaTask[];
};

export type TomorrowSnapshotState = {
  capturedAt: string;
  rowCount: number;
  roomCount: number;
  reused: boolean;
  authoritative: boolean;
};

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function asFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toTomorrowFallbackRoom(room: any, selectedDate: string): RoomForAssignment | null {
  const metadata = (room.pms_metadata || {}) as Record<string, any>;
  if (
    room.status === 'out_of_order'
    || metadata.manualHousekeepingHold === true
    || metadata.isNoShow === true
  ) return null;

  const checkoutTomorrow = metadata.scheduledDepartureTomorrow === true;
  const occupiedToday = metadata.occupiedToday === true || metadata.stayThroughToday === true;
  const departingToday = room.is_checkout_room === true || metadata.scheduledDepartureToday === true;
  const currentNight = asFiniteNumber(metadata.currentNight);
  const totalNights = asFiniteNumber(metadata.totalNights);
  const reservationContinues = currentNight === null || totalNights === null || currentNight < totalNights;
  const dailyTomorrow = !checkoutTomorrow && !departingToday && occupiedToday && reservationContinues;

  if (!checkoutTomorrow && !dailyTomorrow) return null;

  let towelChange = false;
  let linenChange = false;
  if (!checkoutTomorrow && currentNight !== null) {
    const tomorrowNight = currentNight + 1;
    if (tomorrowNight >= 3) {
      const cycle = (tomorrowNight - 3) % 4;
      towelChange = cycle === 0;
      linenChange = cycle === 2;
    }
  }

  return {
    ...room,
    is_checkout_room: checkoutTomorrow,
    ready_to_clean: !checkoutTomorrow,
    towel_change_required: towelChange,
    linen_change_required: linenChange,
    pms_metadata: {
      ...metadata,
      scheduledDepartureToday: checkoutTomorrow,
      plannedHousekeepingDate: selectedDate,
      plannedFromScheduledDepartureTomorrow: checkoutTomorrow,
    },
  } as RoomForAssignment;
}

async function findReusableSnapshot(args: {
  organizationSlug: string;
  hotelId: string;
  selectedDate: string;
}): Promise<TomorrowSnapshotState | null> {
  const resolvedKeys = await resolveHotelKeys(args.hotelId);
  const hotelKeys = Array.from(new Set([args.hotelId, ...resolvedKeys].filter(Boolean)));

  const [snapshotResult, roomCountResult] = await Promise.all([
    (supabase as any)
      .from('daily_overview_snapshots')
      .select('captured_at')
      .eq('organization_slug', args.organizationSlug)
      .eq('hotel_id', args.hotelId)
      .eq('business_date', args.selectedDate)
      .eq('source', 'previo'),
    supabase
      .from('rooms')
      .select('id', { count: 'exact', head: true })
      .in('hotel', hotelKeys),
  ]);

  if (snapshotResult.error || roomCountResult.error) return null;
  const snapshotRows = (snapshotResult.data || []) as Array<{ captured_at: string | null }>;
  const capturedTimes = snapshotRows
    .map(row => row.captured_at ? Date.parse(row.captured_at) : Number.NaN)
    .filter(Number.isFinite);
  const roomCount = Number(roomCountResult.count || 0);
  if (!roomCount || capturedTimes.length < roomCount || snapshotRows.length < roomCount) return null;

  const oldest = Math.min(...capturedTimes);
  const newest = Math.max(...capturedTimes);
  const now = Date.now();
  if (oldest > now + 60_000 || now - oldest > TOMORROW_PMS_REUSE_MS) return null;

  return {
    capturedAt: new Date(newest).toISOString(),
    rowCount: snapshotRows.length,
    roomCount,
    reused: true,
    authoritative: true,
  };
}

export async function ensureTomorrowPmsSnapshot(args: {
  organizationSlug: string;
  hotelId: string;
  selectedDate: string;
  forceFresh?: boolean;
}): Promise<TomorrowSnapshotState> {
  if (!args.forceFresh) {
    const reusable = await findReusableSnapshot(args);
    if (reusable) return reusable;
  }

  const result = await runPmsRefresh(args.hotelId, { trigger: 'manual' });
  if (result.status === 'error' || result.reservationDataAuthoritative === false) {
    throw new Error(
      result.managerMessage
      || result.errors?.join(' · ')
      || 'Previo reservation data was not authoritative.',
    );
  }

  const { data: overviewData, error: overviewError } = await supabase.functions.invoke(
    'previo-sync-daily-overview',
    {
      body: {
        hotelId: args.hotelId,
        fromDate: args.selectedDate,
        toDate: addIsoDays(args.selectedDate, 1),
        days: 1,
      },
    },
  );
  if (overviewError || (overviewData as any)?.ok === false || (overviewData as any)?.error) {
    throw new Error(
      (overviewData as any)?.error
      || overviewError?.message
      || 'Could not load the selected-date Previo reservation snapshot.',
    );
  }

  const reusable = await findReusableSnapshot(args);
  if (reusable) return { ...reusable, reused: false };

  // Some portfolio PMS configurations do not expose the selected-date feed.
  // They keep using the safe metadata fallback, while standard Previo hotels
  // fail loudly if a complete selected-date snapshot was expected but missing.
  if ((overviewData as any)?.supported === false) {
    return {
      capturedAt: new Date().toISOString(),
      rowCount: Number((overviewData as any)?.rowsInserted || 0),
      roomCount: 0,
      reused: false,
      authoritative: true,
    };
  }

  throw new Error('Previo refreshed, but the complete tomorrow room snapshot is not available yet. Please retry.');
}

export async function buildTomorrowAutoAssignRooms(args: {
  organizationSlug: string;
  hotelId: string;
  selectedDate: string;
  roomRows: any[];
}): Promise<{ rooms: RoomForAssignment[]; capturedAt: string | null; source: 'selected-date' | 'metadata-fallback' }> {
  const { data, error } = await (supabase as any)
    .from('daily_overview_snapshots')
    .select('room_label,room_number,arrival_date,departure_date,status,housekeeping_dep,housekeeping_stay,captured_at')
    .eq('organization_slug', args.organizationSlug)
    .eq('hotel_id', args.hotelId)
    .eq('business_date', args.selectedDate)
    .eq('source', 'previo');
  if (error) throw error;

  const snapshots = (data || []) as DailyOverviewWorkRow[];
  if (snapshots.length > 0) {
    const workload = buildSelectedDateHousekeepingWorkload(args.roomRows, snapshots, args.selectedDate);
    return {
      rooms: workload.rooms,
      capturedAt: workload.capturedAt,
      source: 'selected-date',
    };
  }

  return {
    rooms: args.roomRows
      .map(room => toTomorrowFallbackRoom(room, args.selectedDate))
      .filter(Boolean) as RoomForAssignment[],
    capturedAt: null,
    source: 'metadata-fallback',
  };
}

export async function loadExistingNextDayPlan(args: {
  organizationSlug: string;
  hotelId: string;
  selectedDate: string;
}): Promise<ExistingNextDayPlan> {
  const { data: planData, error: planError } = await (supabase as any)
    .from('next_day_housekeeping_plans')
    .select('id,status,auto_release,release_timezone,created_by,pms_synced_at')
    .eq('organization_slug', args.organizationSlug)
    .eq('hotel_id', args.hotelId)
    .eq('plan_date', args.selectedDate)
    .maybeSingle();
  if (planError) throw planError;
  const plan = (planData || null) as NextDayPlan | null;
  if (!plan) return { plan: null, staffIds: [], items: [], areas: [] };

  const [staffResult, itemResult, areaResult] = await Promise.all([
    (supabase as any)
      .from('next_day_housekeeping_plan_staff')
      .select('user_id,selected')
      .eq('plan_id', plan.id),
    (supabase as any)
      .from('next_day_housekeeping_plan_items')
      .select('id,room_id,assigned_to,assignment_type,priority,source,recommendation_context')
      .eq('plan_id', plan.id),
    (supabase as any)
      .from('next_day_housekeeping_plan_area_tasks')
      .select('id,task_key,task_name,task_type,assigned_to,source,section_id,section_task_id,estimated_duration,sort_order')
      .eq('plan_id', plan.id),
  ]);
  if (staffResult.error) throw staffResult.error;
  if (itemResult.error) throw itemResult.error;
  // During a rolling frontend deploy the area-task migration may not exist yet;
  // keep room planning readable, but never silently discard an error when saving.
  const areas = areaResult.error ? [] : (areaResult.data || []);

  return {
    plan,
    staffIds: (staffResult.data || []).filter((row: any) => row.selected).map((row: any) => row.user_id),
    items: (itemResult.data || []) as NextDayPlanItem[],
    areas: areas as NextDayAreaTask[],
  };
}

export async function saveApprovedNextDayAutoAssignPlan(args: {
  userId: string;
  organizationSlug: string;
  hotelId: string;
  hotelName: string;
  selectedDate: string;
  pmsSyncedAt: string;
  previews: AssignmentPreview[];
  selectedStaffIds: string[];
  scheduleByUser?: Map<string, any>;
  excludedRoomIds?: string[];
  maintenanceHoldRoomIds?: string[];
  autoRelease: boolean;
  existingPlan?: NextDayPlan | null;
  suggestedByRoom?: Map<string, string>;
  sharedByRoom?: Map<string, string>;
  mappedAreaTasks?: Array<{
    id: string;
    task_name: string;
    staff_id: string;
    section_id?: string | null;
    estimated_duration?: number | null;
    sort_order?: number;
  }>;
  manualAreaTasks?: Array<{
    key: string;
    name: string;
    assignedTo: string;
    estimatedDuration?: number | null;
  }>;
}): Promise<{ planId: string; roomCount: number; areaCount: number }> {
  const existing = args.existingPlan || null;
  if (existing?.status === 'released' || existing?.status === 'releasing') {
    throw new Error('This tomorrow plan is already being released or has been released.');
  }

  if (existing && existing.status !== 'draft') {
    const { error } = await (supabase as any)
      .from('next_day_housekeeping_plans')
      .update({ status: 'draft' })
      .eq('id', existing.id);
    if (error) throw error;
  }

  const primaryEntries = args.previews.flatMap(preview => preview.rooms.map(room => ({
    room,
    staffId: preview.staffId,
  })));
  if (primaryEntries.length === 0) throw new Error('There are no rooms in tomorrow’s assignment.');

  const primaryByRoom = new Map(primaryEntries.map(entry => [entry.room.id, entry.staffId]));
  const sharedEntries = Array.from(args.sharedByRoom || new Map<string, string>()).flatMap(([roomId, helperId]) => {
    const primary = primaryEntries.find(entry => entry.room.id === roomId);
    if (!primary || primary.staffId === helperId || !args.selectedStaffIds.includes(helperId)) return [];
    return [{ room: primary.room, staffId: helperId, primaryStaffId: primary.staffId }];
  });

  const mappedAreaTasks = (args.mappedAreaTasks || []).filter(task => args.selectedStaffIds.includes(task.staff_id));
  const manualAreaTasks = (args.manualAreaTasks || []).filter(task => args.selectedStaffIds.includes(task.assignedTo));
  const releaseTimezone = existing?.release_timezone || 'Europe/Budapest';

  const { data: planRow, error: planError } = await (supabase as any)
    .from('next_day_housekeeping_plans')
    .upsert({
      organization_slug: args.organizationSlug,
      hotel_id: args.hotelId,
      plan_date: args.selectedDate,
      status: 'draft',
      auto_release: args.autoRelease,
      release_time: '08:00:00',
      release_timezone: releaseTimezone,
      pms_synced_at: args.pmsSyncedAt,
      pms_sync_snapshot: {
        source: 'unified_auto_room_assignment',
        captured_at: args.pmsSyncedAt,
        hotel_name: args.hotelName,
      },
      algorithm_version: 'auto-room-assignment-v5-unified-next-day-2026-09',
      generation_context: {
        source: 'unified_auto_room_assignment',
        plan_date: args.selectedDate,
        room_count: primaryEntries.length,
        assignment_count: primaryEntries.length + sharedEntries.length,
        checkout_count: primaryEntries.filter(entry => entry.room.is_checkout_room).length,
        daily_count: primaryEntries.filter(entry => !entry.room.is_checkout_room).length,
        selected_staff_ids: args.selectedStaffIds,
        shared_room_count: sharedEntries.length,
        mapped_area_count: mappedAreaTasks.length,
        manual_area_count: manualAreaTasks.length,
        excluded_room_ids: args.excludedRoomIds || [],
        planned_maintenance_hold_room_ids: args.maintenanceHoldRoomIds || [],
        generated_at: new Date().toISOString(),
      },
      created_by: existing?.created_by || args.userId,
      approved_by: null,
      approved_at: null,
      last_error: null,
    }, { onConflict: 'organization_slug,hotel_id,plan_date' })
    .select('id')
    .single();
  if (planError) throw planError;
  const planId = planRow.id as string;

  const deleteResults = await Promise.all([
    (supabase as any).from('next_day_housekeeping_plan_area_tasks').delete().eq('plan_id', planId),
    (supabase as any).from('next_day_housekeeping_plan_items').delete().eq('plan_id', planId),
    (supabase as any).from('next_day_housekeeping_plan_staff').delete().eq('plan_id', planId),
  ]);
  const deleteError = deleteResults.find(result => result.error)?.error;
  if (deleteError) throw deleteError;

  const staffPayload = args.selectedStaffIds.map(staffId => {
    const schedule = args.scheduleByUser?.get(staffId);
    return {
      plan_id: planId,
      user_id: staffId,
      selected: true,
      source: schedule ? 'schedule' : 'manual',
      shift_snapshot: schedule ? {
        schedule_id: schedule.id,
        status: schedule.status,
        shift_start: schedule.shift_start,
        shift_end: schedule.shift_end,
        notes: schedule.notes,
      } : {},
      created_by: args.userId,
    };
  });
  if (staffPayload.length) {
    const { error } = await (supabase as any).from('next_day_housekeeping_plan_staff').insert(staffPayload);
    if (error) throw error;
  }

  const itemPayload = [
    ...primaryEntries.map(({ room, staffId }) => {
      const suggested = args.suggestedByRoom?.get(room.id) || staffId;
      const helperId = args.sharedByRoom?.get(room.id) || null;
      const normalDuration = calculateRoomTime(room);
      return {
        plan_id: planId,
        room_id: room.id,
        assigned_to: staffId,
        assignment_type: room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning',
        priority: room.is_checkout_room ? 1 : 2,
        estimated_duration: helperId ? splitSharedDuration(normalDuration) : normalDuration,
        notes: null,
        source: suggested !== staffId ? 'manager' : 'auto',
        recommendation_context: {
          assignment_role: 'primary',
          suggested_staff_id: suggested,
          final_staff_id: staffId,
          manager_changed: suggested !== staffId,
          shared_primary_staff_id: helperId ? staffId : null,
          shared_helper_staff_id: helperId,
          room_number: room.room_number,
          room_kind: room.is_checkout_room ? 'checkout' : 'daily',
          floor_number: room.floor_number ?? getFloorFromRoomNumber(room.room_number),
          housekeeping_section_id: room.housekeeping_section_id || null,
          housekeeping_section_name: room.housekeeping_section_name || null,
          towel_change_required: room.towel_change_required === true,
          linen_change_required: room.linen_change_required === true,
        },
      };
    }),
    ...sharedEntries.map(({ room, staffId, primaryStaffId }) => ({
      plan_id: planId,
      room_id: room.id,
      assigned_to: staffId,
      assignment_type: room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning',
      priority: room.is_checkout_room ? 1 : 2,
      estimated_duration: splitSharedDuration(calculateRoomTime(room)),
      notes: null,
      source: 'shared',
      recommendation_context: {
        assignment_role: 'shared',
        suggested_staff_id: null,
        final_staff_id: staffId,
        manager_changed: false,
        shared_primary_staff_id: primaryStaffId,
        shared_helper_staff_id: staffId,
        room_number: room.room_number,
      },
    })),
  ];
  const { error: itemError } = await (supabase as any).from('next_day_housekeeping_plan_items').insert(itemPayload);
  if (itemError) throw itemError;

  const areaPayload = [
    ...mappedAreaTasks.map((task, index) => ({
      plan_id: planId,
      task_key: `mapped:${task.id}`,
      task_name: task.task_name,
      task_type: 'housekeeping_section',
      assigned_to: task.staff_id,
      source: 'mapped',
      section_id: task.section_id || null,
      section_task_id: task.id,
      estimated_duration: task.estimated_duration || null,
      sort_order: task.sort_order ?? index,
      created_by: args.userId,
    })),
    ...manualAreaTasks.map((task, index) => ({
      plan_id: planId,
      task_key: `manual:${task.key}`,
      task_name: task.name,
      task_type: task.key,
      assigned_to: task.assignedTo,
      source: 'manual',
      section_id: null,
      section_task_id: null,
      estimated_duration: task.estimatedDuration || null,
      sort_order: 1000 + index,
      created_by: args.userId,
    })),
  ];
  if (areaPayload.length) {
    const { error: areaError } = await (supabase as any)
      .from('next_day_housekeeping_plan_area_tasks')
      .insert(areaPayload);
    if (areaError) throw areaError;
  }

  const { error: approveError } = await (supabase as any)
    .from('next_day_housekeeping_plans')
    .update({
      status: 'approved',
      auto_release: args.autoRelease,
      pms_synced_at: args.pmsSyncedAt,
      approved_by: args.userId,
      last_error: null,
    })
    .eq('id', planId);
  if (approveError) throw approveError;

  return { planId, roomCount: primaryEntries.length, areaCount: areaPayload.length };
}

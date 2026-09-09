import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BrainCircuit,
  CalendarClock,
  Check,
  Clock,
  Loader2,
  RefreshCw,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { runPmsRefresh } from '@/lib/pmsRefresh';
import {
  buildSelectedDateHousekeepingWorkload,
  type DailyOverviewWorkRow,
} from '@/lib/nextDayHousekeepingSnapshot';
import {
  calculateRoomTime,
  calculateTimeEstimation,
  calculateRoomWeight,
  computeFairnessMetrics,
  getFloorFromRoomNumber,
  moveRoom,
  type AssignmentPreview,
  type RoomForAssignment,
  type StaffForAssignment,
} from '@/lib/roomAssignmentAlgorithm';
import {
  EMPTY_HOUSEKEEPING_ASSIGNMENT_SIGNALS,
  generateLearnedHousekeepingPreview,
  loadHousekeepingAssignmentSignals,
  type HousekeepingAssignmentSignals,
} from '@/lib/housekeepingAssignmentLearning';
import {
  adjustedStaffMinutes,
  getPrimaryOwnerByRoom,
  getSharedRoomsForStaff,
  partitionSharedPlanItems,
  removeStaffFromSharedRooms,
  setSharedRoomHelper,
  splitSharedDuration,
} from '@/lib/nextDayHousekeepingShared';
import {
  getHousekeepingAutomationLanguage,
  housekeepingAutomationText,
  type HousekeepingAutomationLanguage,
} from '@/lib/housekeepingAutomationTranslations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';

interface NextDayAssignmentPlannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate: string;
  onAssignmentCreated: (roomCount?: number, staffCount?: number) => void;
}

type ScheduleRow = {
  id: string;
  user_id: string;
  work_date: string;
  shift_start: string;
  shift_end: string;
  status: 'draft' | 'published' | 'off';
  notes: string | null;
};

type PlanRow = {
  id: string;
  status: 'draft' | 'approved' | 'releasing' | 'released' | 'cancelled' | 'failed';
  auto_release: boolean;
  release_timezone: string;
  created_by: string;
  pms_synced_at: string | null;
};

type PlanItemRow = {
  room_id: string;
  assigned_to: string;
  assignment_type: 'checkout_cleaning' | 'daily_cleaning';
  source?: 'auto' | 'manager' | 'manual' | 'learned' | 'shared';
  recommendation_context?: {
    suggested_staff_id?: string;
    final_staff_id?: string;
    manager_changed?: boolean;
    assignment_role?: 'primary' | 'shared';
    shared_primary_staff_id?: string;
    shared_helper_staff_id?: string;
  } | null;
};

type PlannerStep = 'staff' | 'review';
type SyncStage = 'contacting' | 'checkouts' | 'received' | 'arranging';

const SYNC_PROGRESS: Record<SyncStage, number> = {
  contacting: 15,
  checkouts: 40,
  received: 72,
  arranging: 92,
};

const RECENT_TOMORROW_PMS_SNAPSHOT_MS = 15 * 60 * 1000;

type ReusableTomorrowSnapshot = {
  capturedAt: string;
  rowCount: number;
  roomCount: number;
};

function syncStageLabel(stage: SyncStage, language: HousekeepingAutomationLanguage) {
  if (stage === 'contacting') return housekeepingAutomationText('contactingPrevio', language);
  if (stage === 'checkouts') return housekeepingAutomationText('gettingCheckouts', language);
  if (stage === 'received') return housekeepingAutomationText('roomInfoReceived', language);
  return housekeepingAutomationText('arrangingRooms', language);
}

function asFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function findReusableTomorrowSnapshot(args: {
  organizationSlug: string;
  hotelId: string;
  selectedDate: string;
}): Promise<ReusableTomorrowSnapshot | null> {
  try {
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
      .filter(value => Number.isFinite(value));
    const roomCount = Number(roomCountResult.count || 0);

    if (capturedTimes.length === 0 || roomCount <= 0 || snapshotRows.length < roomCount) return null;

    const now = Date.now();
    const oldestCapturedAt = Math.min(...capturedTimes);
    const newestCapturedAt = Math.max(...capturedTimes);
    const completeSnapshotIsRecent =
      now - oldestCapturedAt >= 0
      && now - oldestCapturedAt <= RECENT_TOMORROW_PMS_SNAPSHOT_MS
      && newestCapturedAt <= now + 60_000;

    if (!completeSnapshotIsRecent) return null;

    return {
      capturedAt: new Date(newestCapturedAt).toISOString(),
      rowCount: snapshotRows.length,
      roomCount,
    };
  } catch (error) {
    console.warn('[NextDayAssignmentPlanner] recent snapshot check failed:', error);
    return null;
  }
}

function getTomorrowAssignmentType(room: RoomForAssignment): PlanItemRow['assignment_type'] {
  return room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning';
}

/**
 * Fallback used only by portfolio/non-standard PMS configurations that do not
 * expose the selected-date daily-overview feed. Standard Previo hotels use the
 * fresh selected-date snapshot instead (see loadPlanningData).
 */
function toTomorrowWorkRoom(room: any, selectedDate: string): RoomForAssignment | null {
  const metadata = (room.pms_metadata || {}) as Record<string, any>;

  if (
    room.status === 'out_of_order'
    || metadata.manualHousekeepingHold === true
    || metadata.isNoShow === true
  ) {
    return null;
  }

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

function buildPreview(staff: StaffForAssignment, rooms: RoomForAssignment[]): AssignmentPreview {
  const sorted = [...rooms].sort((a, b) => {
    if (a.is_checkout_room !== b.is_checkout_room) return a.is_checkout_room ? -1 : 1;
    const floorA = a.floor_number ?? getFloorFromRoomNumber(a.room_number);
    const floorB = b.floor_number ?? getFloorFromRoomNumber(b.room_number);
    if (floorA !== floorB) return floorA - floorB;
    return a.room_number.localeCompare(b.room_number, undefined, { numeric: true });
  });

  return {
    staffId: staff.id,
    staffName: staff.full_name,
    rooms: sorted,
    totalWeight: sorted.reduce((sum, item) => sum + calculateRoomWeight(item), 0),
    checkoutCount: sorted.filter(item => item.is_checkout_room).length,
    dailyCount: sorted.filter(item => !item.is_checkout_room).length,
    ...calculateTimeEstimation(sorted),
  };
}

export function NextDayAssignmentPlanner({
  open,
  onOpenChange,
  selectedDate,
  onAssignmentCreated,
}: NextDayAssignmentPlannerProps) {
  const { user, profile } = useAuth();
  const [language, setLanguage] = useState<HousekeepingAutomationLanguage>('en');
  const [step, setStep] = useState<PlannerStep>('staff');
  const [syncing, setSyncing] = useState(false);
  const [syncStage, setSyncStage] = useState<SyncStage>('contacting');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [partialSync, setPartialSync] = useState(false);
  const [pmsSyncedAt, setPmsSyncedAt] = useState<string | null>(null);
  const [pmsSnapshot, setPmsSnapshot] = useState<Record<string, unknown>>({});
  const [hotelName, setHotelName] = useState('');
  const [allStaff, setAllStaff] = useState<StaffForAssignment[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string>>(new Set());
  const [tomorrowRooms, setTomorrowRooms] = useState<RoomForAssignment[]>([]);
  const [assignmentSignals, setAssignmentSignals] = useState<HousekeepingAssignmentSignals>(
    EMPTY_HOUSEKEEPING_ASSIGNMENT_SIGNALS,
  );
  const [previews, setPreviews] = useState<AssignmentPreview[]>([]);
  const [suggestedByRoom, setSuggestedByRoom] = useState<Map<string, string>>(new Map());
  const [sharedByRoom, setSharedByRoom] = useState<Map<string, string>>(new Map());
  const [selectedMove, setSelectedMove] = useState<{ roomId: string; fromStaffId: string } | null>(null);
  const [shareRoomId, setShareRoomId] = useState<string | null>(null);
  const [autoRelease, setAutoRelease] = useState(true);
  const [saving, setSaving] = useState(false);
  const [existingPlan, setExistingPlan] = useState<PlanRow | null>(null);
  const [existingPlanChanged, setExistingPlanChanged] = useState(false);
  const syncGeneration = useRef(0);

  const text = (key: Parameters<typeof housekeepingAutomationText>[0]) =>
    housekeepingAutomationText(key, language);

  const scheduleByUser = useMemo(
    () => new Map(schedules.map(schedule => [schedule.user_id, schedule])),
    [schedules],
  );

  const staffNameById = useMemo(
    () => new Map(allStaff.map(staff => [staff.id, staff.full_name])),
    [allStaff],
  );

  const selectedStaff = useMemo(
    () => allStaff.filter(staff => selectedStaffIds.has(staff.id)),
    [allStaff, selectedStaffIds],
  );

  const checkoutCount = useMemo(
    () => tomorrowRooms.filter(room => room.is_checkout_room).length,
    [tomorrowRooms],
  );
  const dailyCount = tomorrowRooms.length - checkoutCount;
  const fairness = useMemo(
    () => previews.length ? computeFairnessMetrics(previews) : null,
    [previews],
  );
  const primaryOwnerByRoom = useMemo(
    () => getPrimaryOwnerByRoom(previews),
    [previews],
  );

  const activeShareRoom = useMemo(
    () => shareRoomId ? tomorrowRooms.find(room => room.id === shareRoomId) || null : null,
    [shareRoomId, tomorrowRooms],
  );

  const resetPlanner = () => {
    setStep('staff');
    setSyncError(null);
    setPartialSync(false);
    setPmsSyncedAt(null);
    setPmsSnapshot({});
    setHotelName('');
    setAllStaff([]);
    setSchedules([]);
    setSelectedStaffIds(new Set());
    setTomorrowRooms([]);
    setAssignmentSignals(EMPTY_HOUSEKEEPING_ASSIGNMENT_SIGNALS);
    setPreviews([]);
    setSuggestedByRoom(new Map());
    setSharedByRoom(new Map());
    setSelectedMove(null);
    setShareRoomId(null);
    setAutoRelease(true);
    setExistingPlan(null);
    setExistingPlanChanged(false);
  };

  const loadPlanningData = async () => {
    if (!profile?.assigned_hotel || !profile.organization_slug) {
      throw new Error('Hotel access is missing.');
    }

    const hotelId = profile.assigned_hotel;
    const { data: hotelConfig, error: hotelConfigError } = await supabase
      .from('hotel_configurations')
      .select('hotel_name')
      .eq('hotel_id', hotelId)
      .maybeSingle();
    if (hotelConfigError) throw hotelConfigError;

    const resolvedHotelName = hotelConfig?.hotel_name || hotelId;
    setHotelName(resolvedHotelName);
    const resolvedKeys = await resolveHotelKeys(resolvedHotelName);
    const hotelKeys = Array.from(new Set(
      [hotelId, resolvedHotelName, ...resolvedKeys].filter(Boolean),
    ));

    setSyncStage('received');

    const [staffResult, scheduleResult, roomResult, snapshotResult, pmsConfigResult, planResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .eq('organization_slug', profile.organization_slug)
        .or('role.eq.housekeeping,acts_as_housekeeper.eq.true')
        .in('assigned_hotel', hotelKeys)
        .order('full_name'),
      (supabase as any)
        .from('staff_schedules')
        .select('id,user_id,work_date,shift_start,shift_end,status,notes')
        .eq('organization_slug', profile.organization_slug)
        .eq('hotel_id', hotelId)
        .eq('work_date', selectedDate),
      supabase
        .from('rooms')
        .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
        .in('hotel', hotelKeys),
      (supabase as any)
        .from('daily_overview_snapshots')
        .select('room_label,room_number,arrival_date,departure_date,status,housekeeping_dep,housekeeping_stay,captured_at')
        .eq('organization_slug', profile.organization_slug)
        .eq('hotel_id', hotelId)
        .eq('business_date', selectedDate)
        .eq('source', 'previo'),
      (supabase as any)
        .from('pms_configurations')
        .select('id,pms_type,is_active')
        .eq('hotel_id', hotelId)
        .eq('pms_type', 'previo')
        .maybeSingle(),
      (supabase as any)
        .from('next_day_housekeeping_plans')
        .select('id,status,auto_release,release_timezone,created_by,pms_synced_at')
        .eq('organization_slug', profile.organization_slug)
        .eq('hotel_id', hotelId)
        .eq('plan_date', selectedDate)
        .maybeSingle(),
    ]);

    if (staffResult.error) throw staffResult.error;
    if (scheduleResult.error) throw scheduleResult.error;
    if (roomResult.error) throw roomResult.error;
    if (snapshotResult.error) throw snapshotResult.error;
    if (pmsConfigResult.error) throw pmsConfigResult.error;
    if (planResult.error) throw planResult.error;

    const staffRows = (staffResult.data || []) as StaffForAssignment[];
    const scheduleRows = (scheduleResult.data || []) as ScheduleRow[];
    const standardPrevio = pmsConfigResult.data?.is_active === true;
    const selectedDateWorkload = standardPrevio
      ? buildSelectedDateHousekeepingWorkload(
        roomResult.data || [],
        (snapshotResult.data || []) as DailyOverviewWorkRow[],
        selectedDate,
      )
      : null;
    const rawRooms = standardPrevio
      ? selectedDateWorkload!.rooms
      : (roomResult.data || [])
        .map(room => toTomorrowWorkRoom(room, selectedDate))
        .filter(Boolean) as RoomForAssignment[];
    const plan = (planResult.data || null) as PlanRow | null;

    const learning = await loadHousekeepingAssignmentSignals({
      supabase,
      organizationSlug: profile.organization_slug,
      hotelId,
      hotelKeys,
      rooms: rawRooms,
    });
    const rooms = learning.rooms;

    setAllStaff(staffRows);
    setSchedules(scheduleRows);
    setTomorrowRooms(rooms);
    setAssignmentSignals(learning.signals);
    setExistingPlan(plan);
    setAutoRelease(plan?.auto_release ?? true);
    setSyncStage('arranging');

    if (standardPrevio && selectedDateWorkload) {
      setPmsSnapshot(previous => ({
        ...previous,
        workloadSource: 'previo_daily_overview_selected_date',
        selectedDate,
        selectedDateRows: selectedDateWorkload.sourceRows,
        selectedDateMappedRooms: selectedDateWorkload.rooms.length,
        selectedDateCheckouts: selectedDateWorkload.checkoutCount,
        selectedDateDaily: selectedDateWorkload.dailyCount,
        selectedDateCapturedAt: selectedDateWorkload.capturedAt,
      }));
    }

    const scheduledIds = new Set(
      scheduleRows
        .filter(schedule => schedule.status !== 'off')
        .map(schedule => schedule.user_id),
    );
    const availableStaffIds = new Set(staffRows.map(staff => staff.id));
    const defaultSelection = new Set(
      Array.from(scheduledIds).filter(id => availableStaffIds.has(id)),
    );

    if (plan?.id) {
      const [planStaffResult, planItemsResult] = await Promise.all([
        (supabase as any)
          .from('next_day_housekeeping_plan_staff')
          .select('user_id,selected')
          .eq('plan_id', plan.id),
        (supabase as any)
          .from('next_day_housekeeping_plan_items')
          .select('room_id,assigned_to,assignment_type,source,recommendation_context')
          .eq('plan_id', plan.id),
      ]);
      if (planStaffResult.error) throw planStaffResult.error;
      if (planItemsResult.error) throw planItemsResult.error;

      const items = (planItemsResult.data || []) as PlanItemRow[];
      const savedStaffIds = new Set<string>(
        (planStaffResult.data || [])
          .filter((row: any) => row.selected)
          .map((row: any) => row.user_id),
      );
      for (const item of items) {
        if (availableStaffIds.has(item.assigned_to)) savedStaffIds.add(item.assigned_to);
      }
      setSelectedStaffIds(savedStaffIds.size ? savedStaffIds : defaultSelection);

      const roomMap = new Map(rooms.map(room => [room.id, room]));
      const itemRoomIds = new Set(items.map(item => item.room_id));
      const workloadRoomIds = new Set(rooms.map(room => room.id));
      const roomSetChanged =
        itemRoomIds.size !== workloadRoomIds.size
        || Array.from(itemRoomIds).some(id => !workloadRoomIds.has(id));
      const cleaningTypeChanged = items.some(item => {
        const freshRoom = roomMap.get(item.room_id);
        return !!freshRoom && item.assignment_type !== getTomorrowAssignmentType(freshRoom);
      });
      const planChanged = roomSetChanged || cleaningTypeChanged;
      setExistingPlanChanged(planChanged);

      if (items.length > 0) {
        const partitioned = partitionSharedPlanItems(items);
        const staffMap = new Map(staffRows.map(staff => [staff.id, staff]));
        const ownerIds = Array.from(new Set(partitioned.primaryItems.map(item => item.assigned_to)));
        const restored = ownerIds.map(ownerId => {
          const staff = staffMap.get(ownerId) || {
            id: ownerId,
            full_name: `Staff ${ownerId.slice(0, 6)}`,
            nickname: null,
          };
          const assignedRooms = partitioned.primaryItems
            .filter(item => item.assigned_to === ownerId)
            .map(item => roomMap.get(item.room_id))
            .filter(Boolean) as RoomForAssignment[];
          return buildPreview(staff, assignedRooms);
        });
        setPreviews(restored);
        setSharedByRoom(partitioned.sharedByRoom);
        setSuggestedByRoom(new Map(partitioned.primaryItems.map(item => [
          item.room_id,
          item.recommendation_context?.suggested_staff_id || item.assigned_to,
        ])));
        setStep('review');
        return;
      }
    }

    setSelectedStaffIds(defaultSelection);
    setSharedByRoom(new Map());
    if (defaultSelection.size > 0 && rooms.length > 0) {
      const staff = staffRows.filter(person => defaultSelection.has(person.id));
      const generated = generateLearnedHousekeepingPreview(
        rooms,
        staff,
        resolvedHotelName,
        learning.signals,
      );
      setPreviews(generated);
      setSuggestedByRoom(new Map(generated.flatMap(preview =>
        preview.rooms.map(room => [room.id, preview.staffId] as [string, string]),
      )));
    }
  };

  const prepareTomorrow = async (forceFresh = false) => {
    if (!profile?.assigned_hotel || !profile.organization_slug) return;

    const generation = ++syncGeneration.current;
    setSyncing(true);
    setSyncError(null);
    setPartialSync(false);
    setSyncStage('contacting');

    let stageTimer: number | null = null;

    try {
      if (!forceFresh) {
        const reusableSnapshot = await findReusableTomorrowSnapshot({
          organizationSlug: profile.organization_slug,
          hotelId: profile.assigned_hotel,
          selectedDate,
        });
        if (syncGeneration.current !== generation) return;

        if (reusableSnapshot) {
          setSyncStage('arranging');
          setPmsSyncedAt(reusableSnapshot.capturedAt);
          setPartialSync(false);
          setPmsSnapshot({
            status: 'success',
            reusedRecentSnapshot: true,
            freshnessWindowMinutes: RECENT_TOMORROW_PMS_SNAPSHOT_MS / 60_000,
            selectedDate,
            selectedDateOverviewRows: reusableSnapshot.rowCount,
            expectedHotelRooms: reusableSnapshot.roomCount,
            capturedAt: reusableSnapshot.capturedAt,
          });
          await loadPlanningData();
          return;
        }
      }

      stageTimer = window.setTimeout(() => {
        if (syncGeneration.current === generation) setSyncStage('checkouts');
      }, 650);

      const result = await runPmsRefresh(profile.assigned_hotel, { trigger: 'manual' });
      if (syncGeneration.current !== generation) return;

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
            hotelId: profile.assigned_hotel,
            fromDate: selectedDate,
            toDate: addIsoDays(selectedDate, 1),
            days: 1,
          },
        },
      );
      if (syncGeneration.current !== generation) return;
      if (overviewError || (overviewData as any)?.ok === false || (overviewData as any)?.error) {
        throw new Error(
          (overviewData as any)?.error
          || overviewError?.message
          || 'Could not load the selected-date Previo reservation snapshot.',
        );
      }

      const syncedAt = new Date().toISOString();
      setPmsSyncedAt(syncedAt);
      setPartialSync(result.status === 'partial');
      setPmsSnapshot({
        status: result.status,
        updated: result.updated,
        total: result.total,
        notFound: result.notFound,
        checkoutsToday: result.checkouts,
        errors: result.errors,
        reservationDataAuthoritative: result.reservationDataAuthoritative !== false,
        managerMessage: result.managerMessage || null,
        selectedDateOverviewSupported: (overviewData as any)?.supported !== false,
        selectedDateOverviewRows: Number((overviewData as any)?.rowsInserted || 0),
        selectedDateOverviewWindow: (overviewData as any)?.window || null,
        capturedAt: syncedAt,
      });

      await loadPlanningData();
    } catch (error) {
      console.error('[NextDayAssignmentPlanner] preparation failed:', error);
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      if (stageTimer !== null) window.clearTimeout(stageTimer);
      if (syncGeneration.current === generation) setSyncing(false);
    }
  };

  useEffect(() => {
    if (!open) {
      syncGeneration.current += 1;
      return;
    }

    setLanguage(getHousekeepingAutomationLanguage());
    resetPlanner();
    void prepareTomorrow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedDate, profile?.assigned_hotel, profile?.organization_slug]);

  const toggleStaff = (staffId: string) => {
    const removing = selectedStaffIds.has(staffId);
    setSelectedStaffIds(previous => {
      const next = new Set(previous);
      if (next.has(staffId)) next.delete(staffId);
      else next.add(staffId);
      return next;
    });
    if (removing) {
      setSharedByRoom(previous => removeStaffFromSharedRooms(previous, staffId));
    }
    setPreviews([]);
    setSuggestedByRoom(new Map());
    setSelectedMove(null);
    setShareRoomId(null);
    setStep('staff');
  };

  const generatePreview = () => {
    if (selectedStaff.length === 0) {
      toast.warning(text('noStaff'));
      return;
    }
    if (tomorrowRooms.length === 0) return;

    const generated = generateLearnedHousekeepingPreview(
      tomorrowRooms,
      selectedStaff,
      hotelName || profile?.assigned_hotel || '',
      assignmentSignals,
    );
    setPreviews(generated);
    setSuggestedByRoom(new Map(generated.flatMap(preview =>
      preview.rooms.map(room => [room.id, preview.staffId] as [string, string]),
    )));
    setSharedByRoom(new Map());
    setExistingPlanChanged(false);
    setSelectedMove(null);
    setShareRoomId(null);
    setStep('review');
  };

  const applyMove = (roomId: string, fromStaffId: string, toStaffId: string) => {
    if (!roomId || !fromStaffId || !toStaffId || fromStaffId === toStaffId) return;
    setPreviews(previous => moveRoom(previous, roomId, fromStaffId, toStaffId));
    setSharedByRoom(previous => {
      if (previous.get(roomId) === toStaffId) {
        return setSharedRoomHelper(previous, roomId, null, toStaffId);
      }
      return previous;
    });
    setSelectedMove(null);
    setShareRoomId(null);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>, toStaffId: string) => {
    event.preventDefault();
    const roomId = event.dataTransfer.getData('hotelcare-nextday-room-id');
    const fromStaffId = event.dataTransfer.getData('hotelcare-nextday-from-staff');
    applyMove(roomId, fromStaffId, toStaffId);
  };

  const chooseSharedHelper = (roomId: string, helperStaffId: string | null) => {
    const primaryStaffId = primaryOwnerByRoom.get(roomId);
    if (!primaryStaffId) return;
    if (helperStaffId && !selectedStaffIds.has(helperStaffId)) return;
    setSharedByRoom(previous => setSharedRoomHelper(
      previous,
      roomId,
      helperStaffId,
      primaryStaffId,
    ));
    setSelectedMove(null);
    setShareRoomId(null);
  };

  const saveApprovedPlan = async () => {
    if (!user || !profile?.organization_slug || !profile.assigned_hotel || !pmsSyncedAt) return;
    if (previews.length === 0 || previews.every(preview => preview.rooms.length === 0)) return;

    if (existingPlanChanged) {
      toast.warning(text('existingPlanChanged'));
      return;
    }

    if (existingPlan?.status === 'released' || existingPlan?.status === 'releasing') {
      toast.error('This plan is already being released or has been released.');
      return;
    }

    setSaving(true);
    try {
      const primaryEntries = previews.flatMap(preview => preview.rooms.map(room => ({
        room,
        staffId: preview.staffId,
        assignmentRole: 'primary' as const,
      })));
      const roomById = new Map(tomorrowRooms.map(room => [room.id, room]));
      const sharedEntries = Array.from(sharedByRoom.entries()).flatMap(([roomId, helperStaffId]) => {
        const room = roomById.get(roomId);
        const primaryStaffId = primaryOwnerByRoom.get(roomId);
        if (!room || !primaryStaffId || primaryStaffId === helperStaffId || !selectedStaffIds.has(helperStaffId)) {
          return [];
        }
        return [{ room, staffId: helperStaffId, assignmentRole: 'shared' as const }];
      });
      const finalEntries = [...primaryEntries, ...sharedEntries];
      const changedCount = primaryEntries.filter(
        entry => suggestedByRoom.get(entry.room.id) !== entry.staffId,
      ).length;
      const releaseTimezone = existingPlan?.release_timezone || 'Europe/Budapest';

      const planPayload = {
        organization_slug: profile.organization_slug,
        hotel_id: profile.assigned_hotel,
        plan_date: selectedDate,
        status: 'draft',
        auto_release: autoRelease,
        release_time: '08:00:00',
        release_timezone: releaseTimezone,
        pms_synced_at: pmsSyncedAt,
        pms_sync_snapshot: pmsSnapshot,
        algorithm_version: 'room-assignment-v4-learned-shared-next-day-2026-09',
        generation_context: {
          source: 'next_day_manager_planner',
          hotel_name: hotelName,
          plan_date: selectedDate,
          room_count: primaryEntries.length,
          assignment_count: finalEntries.length,
          shared_room_count: sharedEntries.length,
          checkout_count: primaryEntries.filter(entry => entry.room.is_checkout_room).length,
          daily_count: primaryEntries.filter(entry => !entry.room.is_checkout_room).length,
          selected_staff_ids: Array.from(selectedStaffIds),
          manager_changed_room_count: changedCount,
          historical_affinity_pair_count: assignmentSignals.affinityPairCount,
          learning_model_version: assignmentSignals.modelVersion,
          learning_confidence: assignmentSignals.learningConfidence,
          learning_correction_count: assignmentSignals.correctionCount,
          learning_sample_count: assignmentSignals.sampleCount,
          workload_derivation: 'fresh_previo_daily_overview_selected_date',
          shared_cleaning_model: 'one_primary+one_helper;split_estimated_duration',
          generated_at: new Date().toISOString(),
        },
        created_by: existingPlan?.created_by || user.id,
        approved_by: null,
        approved_at: null,
        last_error: null,
      };

      const { data: plan, error: planError } = await (supabase as any)
        .from('next_day_housekeeping_plans')
        .upsert(planPayload, { onConflict: 'organization_slug,hotel_id,plan_date' })
        .select('id')
        .single();
      if (planError) throw planError;
      const planId = plan.id as string;

      const [deleteStaffResult, deleteItemsResult] = await Promise.all([
        (supabase as any)
          .from('next_day_housekeeping_plan_staff')
          .delete()
          .eq('plan_id', planId),
        (supabase as any)
          .from('next_day_housekeeping_plan_items')
          .delete()
          .eq('plan_id', planId),
      ]);
      if (deleteStaffResult.error) throw deleteStaffResult.error;
      if (deleteItemsResult.error) throw deleteItemsResult.error;

      const staffPayload = Array.from(selectedStaffIds).map(staffId => {
        const schedule = scheduleByUser.get(staffId);
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
          created_by: user.id,
        };
      });

      if (staffPayload.length > 0) {
        const { error } = await (supabase as any)
          .from('next_day_housekeeping_plan_staff')
          .insert(staffPayload);
        if (error) throw error;
      }

      const itemPayload = finalEntries.map(({ room, staffId, assignmentRole }) => {
        const primaryStaffId = primaryOwnerByRoom.get(room.id) || staffId;
        const sharedHelperStaffId = sharedByRoom.get(room.id) || null;
        const suggestedStaffId = suggestedByRoom.get(room.id) || primaryStaffId;
        const managerChanged = assignmentRole === 'primary' && suggestedStaffId !== staffId;
        const normalDuration = calculateRoomTime(room);
        const estimatedDuration = sharedHelperStaffId
          ? splitSharedDuration(normalDuration)
          : normalDuration;
        return {
          plan_id: planId,
          room_id: room.id,
          assigned_to: staffId,
          assignment_type: getTomorrowAssignmentType(room),
          priority: room.is_checkout_room ? 1 : 2,
          estimated_duration: estimatedDuration,
          notes: null,
          source: assignmentRole === 'shared'
            ? 'shared'
            : managerChanged ? 'manager' : 'auto',
          recommendation_context: {
            assignment_role: assignmentRole,
            suggested_staff_id: assignmentRole === 'primary' ? suggestedStaffId : null,
            final_staff_id: staffId,
            manager_changed: managerChanged,
            shared_primary_staff_id: sharedHelperStaffId ? primaryStaffId : null,
            shared_helper_staff_id: sharedHelperStaffId,
            room_number: room.room_number,
            room_kind: room.is_checkout_room ? 'checkout' : 'daily',
            floor_number: room.floor_number ?? getFloorFromRoomNumber(room.room_number),
            housekeeping_section_id: room.housekeeping_section_id || null,
            housekeeping_section_name: room.housekeeping_section_name || null,
            towel_change_required: room.towel_change_required === true,
            linen_change_required: room.linen_change_required === true,
            historical_affinity_pair_count: assignmentSignals.affinityPairCount,
            learning_model_version: assignmentSignals.modelVersion,
            learning_confidence: assignmentSignals.learningConfidence,
          },
        };
      });

      if (itemPayload.length > 0) {
        const { error } = await (supabase as any)
          .from('next_day_housekeeping_plan_items')
          .insert(itemPayload);
        if (error) throw error;
      }

      const { data: approvedPlan, error: approveError } = await (supabase as any)
        .from('next_day_housekeeping_plans')
        .update({
          status: 'approved',
          auto_release: autoRelease,
          pms_synced_at: pmsSyncedAt,
          approved_by: user.id,
          last_error: null,
        })
        .eq('id', planId)
        .select('id,status,auto_release,release_timezone,created_by,pms_synced_at')
        .single();
      if (approveError) throw approveError;

      setExistingPlan(approvedPlan as PlanRow);
      setExistingPlanChanged(false);
      window.dispatchEvent(new CustomEvent('hk-next-day-plan-changed', {
        detail: {
          hotelId: profile.assigned_hotel,
          planDate: selectedDate,
          planId,
        },
      }));
      onAssignmentCreated(primaryEntries.length, selectedStaffIds.size);
      toast.success(text('saved'));
      onOpenChange(false);
    } catch (error) {
      console.error('[NextDayAssignmentPlanner] save failed:', error);
      toast.error(error instanceof Error ? error.message : 'Could not save tomorrow’s plan.');
    } finally {
      setSaving(false);
    }
  };

  const activeMoveRoom = useMemo(() => {
    if (!selectedMove) return null;
    return previews
      .find(preview => preview.staffId === selectedMove.fromStaffId)
      ?.rooms.find(room => room.id === selectedMove.roomId) || null;
  }, [previews, selectedMove]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[94vh] max-h-[94vh] w-[98vw] max-w-[1500px] flex-col overflow-hidden p-4 sm:p-6">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-lg sm:text-xl">
            <CalendarClock className="h-5 w-5 text-primary" />
            {text('title')}
            <Badge variant="outline">{selectedDate}</Badge>
            {existingPlan && (
              <Badge variant={existingPlan.status === 'approved' ? 'default' : 'secondary'}>
                {existingPlan.status}
              </Badge>
            )}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{text('subtitle')}</p>
        </DialogHeader>

        {syncing ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <div className="w-full max-w-xl space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-primary/10 p-3">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
                <div>
                  <p className="font-semibold">{syncStageLabel(syncStage, language)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{selectedDate}</p>
                </div>
              </div>
              <Progress value={SYNC_PROGRESS[syncStage]} className="h-2" />
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                {(['contacting', 'checkouts', 'received', 'arranging'] as SyncStage[]).map((stage, index) => (
                  <div
                    key={stage}
                    className={SYNC_PROGRESS[syncStage] >= SYNC_PROGRESS[stage] ? 'font-medium text-foreground' : ''}
                  >
                    {index + 1}. {syncStageLabel(stage, language)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : syncError ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <div className="w-full max-w-xl rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
              <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
              <h3 className="font-semibold">{text('syncFailed')}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{syncError}</p>
              <Button className="mt-5" onClick={() => void prepareTomorrow(true)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {text('retrySync')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                <Check className="mr-1 h-3 w-3" />
                {text('pmsFresh')}
              </Badge>
              {pmsSyncedAt && (
                <span className="text-muted-foreground">
                  {new Date(pmsSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {assignmentSignals.correctionCount > 0 && (
                <Badge variant="outline" className="border-violet-300 text-violet-700 dark:text-violet-300">
                  <BrainCircuit className="mr-1 h-3 w-3" />
                  {text('learningActive')} {Math.round(assignmentSignals.learningConfidence * 100)}% · {assignmentSignals.correctionCount}
                </Badge>
              )}
              {sharedByRoom.size > 0 && (
                <Badge variant="outline" className="border-sky-300 text-sky-700 dark:text-sky-300">
                  <Users className="mr-1 h-3 w-3" />
                  {text('sharedCleaning')}: {sharedByRoom.size}
                </Badge>
              )}
              <span className="ml-auto font-medium">
                {text('tomorrowWorkload')}: {tomorrowRooms.length} {text('rooms')} · {checkoutCount} {text('checkouts')} · {dailyCount} {text('daily')}
              </span>
            </div>

            {partialSync && (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                {text('warningPartial')}
              </div>
            )}

            {existingPlan && (
              <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${existingPlanChanged ? 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200' : 'bg-muted/30'}`}>
                <strong>{text('existingPlan')}.</strong>{' '}
                {existingPlanChanged ? text('existingPlanChanged') : ''}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto py-3">
              {tomorrowRooms.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                  <Check className="mx-auto mb-3 h-12 w-12 opacity-40" />
                  <p>{text('noRooms')}</p>
                </div>
              ) : step === 'staff' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3 rounded-xl bg-muted p-3">
                    <div className="text-center">
                      <p className="text-2xl font-bold">{tomorrowRooms.length}</p>
                      <p className="text-xs text-muted-foreground">{text('rooms')}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-amber-600">{checkoutCount}</p>
                      <p className="text-xs text-muted-foreground">{text('checkouts')}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-blue-600">{dailyCount}</p>
                      <p className="text-xs text-muted-foreground">{text('daily')}</p>
                    </div>
                  </div>

                  <h3 className="flex items-center gap-2 font-medium">
                    <Users className="h-4 w-4" />
                    {text('selectStaff')} ({selectedStaffIds.size})
                  </h3>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {allStaff.map(staff => {
                      const schedule = scheduleByUser.get(staff.id);
                      const selected = selectedStaffIds.has(staff.id);
                      return (
                        <button
                          key={staff.id}
                          type="button"
                          onClick={() => toggleStaff(staff.id)}
                          className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/60'}`}
                        >
                          <Checkbox checked={selected} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{staff.full_name}</span>
                            {staff.nickname && (
                              <span className="block truncate text-xs text-muted-foreground">{staff.nickname}</span>
                            )}
                          </span>
                          {schedule ? (
                            <span className="text-right text-xs">
                              <Badge variant={schedule.status === 'published' ? 'default' : 'outline'}>
                                {schedule.status === 'published' ? text('published') : text('draft')}
                              </Badge>
                              <span className="mt-1 block text-muted-foreground">
                                {schedule.shift_start?.slice(0, 5)}–{schedule.shift_end?.slice(0, 5)}
                              </span>
                            </span>
                          ) : (
                            <Badge variant="secondary">{text('noSchedule')}</Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm">
                    <div>
                      <strong>{tomorrowRooms.length}</strong> {text('rooms')} →{' '}
                      <strong>{previews.filter(preview => preview.rooms.length > 0 || getSharedRoomsForStaff(tomorrowRooms, sharedByRoom, preview.staffId).length > 0).length}</strong> staff
                      {sharedByRoom.size > 0 && (
                        <span className="ml-2 text-xs text-sky-700 dark:text-sky-300">· {sharedByRoom.size} {text('sharedRooms')}</span>
                      )}
                    </div>
                    {fairness && (
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        <span>CO ±{fairness.checkoutDiff}</span>
                        <span>Daily ±{fairness.dailyDiff}</span>
                        <span>Time ±{fairness.timeSpreadMinutes}m</span>
                        <span>Floors {fairness.splitFloorCount}</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {previews.map(preview => {
                      const helperRooms = getSharedRoomsForStaff(tomorrowRooms, sharedByRoom, preview.staffId);
                      const displayMinutes = adjustedStaffMinutes({
                        preview,
                        allRooms: tomorrowRooms,
                        sharedByRoom,
                        calculateRoomTime,
                      });
                      return (
                        <div
                          key={preview.staffId}
                          onDragOver={event => event.preventDefault()}
                          onDrop={event => handleDrop(event, preview.staffId)}
                          onClick={() => {
                            if (selectedMove && selectedMove.fromStaffId !== preview.staffId) {
                              applyMove(selectedMove.roomId, selectedMove.fromStaffId, preview.staffId);
                            }
                          }}
                          className={`min-h-48 rounded-xl border bg-card ${selectedMove && selectedMove.fromStaffId !== preview.staffId ? 'cursor-pointer ring-2 ring-primary/50' : ''}`}
                        >
                          <div className="border-b bg-muted/40 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate font-semibold">{preview.staffName}</span>
                              <span className="text-xs text-muted-foreground">{displayMinutes}m</span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {preview.checkoutCount} {text('checkouts')} · {preview.dailyCount} {text('daily')}
                              {helperRooms.length > 0 && <span> · +{helperRooms.length} {text('sharedCleaning')}</span>}
                            </div>
                          </div>

                          <div className="space-y-2 p-2">
                            {preview.rooms.length === 0 && helperRooms.length === 0 && (
                              <div className="rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">
                                Drop a room here
                              </div>
                            )}

                            {preview.rooms.map(room => {
                              const selected = selectedMove?.roomId === room.id;
                              const changed = suggestedByRoom.get(room.id)
                                && suggestedByRoom.get(room.id) !== preview.staffId;
                              const helperId = sharedByRoom.get(room.id);
                              return (
                                <div key={room.id} className="space-y-1">
                                  <button
                                    type="button"
                                    draggable
                                    onDragStart={event => {
                                      event.stopPropagation();
                                      event.dataTransfer.setData('hotelcare-nextday-room-id', room.id);
                                      event.dataTransfer.setData('hotelcare-nextday-from-staff', preview.staffId);
                                      event.dataTransfer.effectAllowed = 'move';
                                    }}
                                    onClick={event => {
                                      event.stopPropagation();
                                      setShareRoomId(null);
                                      setSelectedMove(selected ? null : {
                                        roomId: room.id,
                                        fromStaffId: preview.staffId,
                                      });
                                    }}
                                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-sm ${selected ? 'border-primary ring-2 ring-primary/30' : room.is_checkout_room ? 'border-amber-300 bg-amber-50/70 dark:bg-amber-950/20' : 'border-blue-200 bg-blue-50/60 dark:bg-blue-950/20'}`}
                                  >
                                    <span className="flex items-center gap-2">
                                      <strong>{room.room_number}</strong>
                                      <Badge variant="outline" className="text-[10px]">
                                        {room.is_checkout_room ? 'CO' : 'D'}
                                      </Badge>
                                      {room.linen_change_required && (
                                        <Badge variant="outline" className="text-[10px]">C</Badge>
                                      )}
                                      {room.towel_change_required && (
                                        <Badge variant="outline" className="text-[10px]">T</Badge>
                                      )}
                                      {helperId && (
                                        <Badge variant="outline" className="border-sky-300 text-[10px] text-sky-700 dark:text-sky-300">
                                          <Users className="mr-1 h-2.5 w-2.5" />2
                                        </Badge>
                                      )}
                                    </span>
                                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                      F{room.floor_number ?? getFloorFromRoomNumber(room.room_number)}
                                      {changed && <span className="text-primary">●</span>}
                                    </span>
                                  </button>

                                  {selectedStaffIds.size > 1 && (
                                    <div className="flex items-center justify-between gap-2 px-1">
                                      <button
                                        type="button"
                                        className="flex items-center gap-1 text-[10px] font-medium text-sky-700 hover:underline dark:text-sky-300"
                                        onClick={event => {
                                          event.stopPropagation();
                                          setSelectedMove(null);
                                          setShareRoomId(previous => previous === room.id ? null : room.id);
                                        }}
                                      >
                                        <Users className="h-3 w-3" />
                                        {text('shareRoom')}
                                      </button>
                                      {helperId && (
                                        <span className="truncate text-[10px] text-muted-foreground">
                                          {text('sharedWith')} {staffNameById.get(helperId) || helperId.slice(0, 6)}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {helperRooms.length > 0 && (
                              <div className="mt-3 space-y-1.5 border-t border-sky-200 pt-2 dark:border-sky-900">
                                <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                                  {text('sharedRooms')}
                                </p>
                                {helperRooms.map(room => {
                                  const primaryId = primaryOwnerByRoom.get(room.id);
                                  return (
                                    <div key={`shared-${room.id}`} className="rounded-lg border border-sky-200 bg-sky-50/60 px-2.5 py-2 text-xs dark:border-sky-900 dark:bg-sky-950/20">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-semibold">{room.room_number}</span>
                                        <Badge variant="outline" className="border-sky-300 text-[10px] text-sky-700 dark:text-sky-300">
                                          <Users className="mr-1 h-2.5 w-2.5" />{text('sharedCleaning')}
                                        </Badge>
                                      </div>
                                      <p className="mt-1 truncate text-[10px] text-muted-foreground">
                                        {text('primaryCleaner')}: {primaryId ? (staffNameById.get(primaryId) || primaryId.slice(0, 6)) : '—'}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {activeShareRoom && (() => {
                    const primaryId = primaryOwnerByRoom.get(activeShareRoom.id);
                    const helperId = sharedByRoom.get(activeShareRoom.id);
                    return (
                      <div className="rounded-xl border border-sky-300 bg-sky-50/60 p-3 dark:border-sky-900 dark:bg-sky-950/20">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="flex items-center gap-2 text-sm font-semibold">
                              <Users className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                              {text('sharedCleaning')} · {activeShareRoom.room_number}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {text('primaryCleaner')}: {primaryId ? (staffNameById.get(primaryId) || primaryId.slice(0, 6)) : '—'}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">{text('shareHint')}</p>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => setShareRoomId(null)}>
                            {text('close')}
                          </Button>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedStaff
                            .filter(staff => staff.id !== primaryId)
                            .map(staff => (
                              <Button
                                key={staff.id}
                                type="button"
                                size="sm"
                                variant={helperId === staff.id ? 'default' : 'outline'}
                                className="h-8"
                                onClick={() => chooseSharedHelper(activeShareRoom.id, staff.id)}
                              >
                                <Users className="mr-1.5 h-3.5 w-3.5" />
                                {staff.full_name}
                              </Button>
                            ))}
                          {helperId && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 text-destructive hover:text-destructive"
                              onClick={() => chooseSharedHelper(activeShareRoom.id, null)}
                            >
                              {text('removeShare')}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    {activeMoveRoom ? (
                      <>
                        <strong className="text-foreground">
                          {text('selectedRoom')}: {activeMoveRoom.room_number}.
                        </strong>{' '}
                        {text('tapMove')}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-1 h-6 px-2 text-xs"
                          onClick={() => setSelectedMove(null)}
                        >
                          {text('cancelMove')}
                        </Button>
                      </>
                    ) : text('tapMove')}
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4">
                    <Checkbox
                      checked={autoRelease}
                      onCheckedChange={checked => setAutoRelease(checked === true)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {text('autoRelease')}
                        <Badge variant="outline">
                          <Clock className="mr-1 h-3 w-3" />
                          {text('releaseAt')}
                        </Badge>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {autoRelease ? text('autoReleaseHint') : text('heldHint')}
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>

            <DialogFooter className="flex-shrink-0 gap-2 border-t pt-3">
              {tomorrowRooms.length === 0 ? (
                <Button variant="outline" onClick={() => onOpenChange(false)}>{text('close')}</Button>
              ) : step === 'staff' ? (
                <>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>{text('close')}</Button>
                  <Button onClick={generatePreview} disabled={selectedStaffIds.size === 0}>
                    {text('generate')}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setStep('staff')}>{text('back')}</Button>
                  <Button variant="outline" onClick={generatePreview}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {text('regenerate')}
                  </Button>
                  <Button
                    onClick={saveApprovedPlan}
                    disabled={saving || previews.length === 0 || existingPlanChanged}
                    title={existingPlanChanged ? text('existingPlanChanged') : undefined}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {text('saving')}
                      </>
                    ) : (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        {text('savePlan')}
                      </>
                    )}
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

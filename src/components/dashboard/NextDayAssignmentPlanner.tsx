import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CalendarClock, Check, Clock, Loader2, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { runPmsRefresh, type PmsSyncResult } from '@/lib/pmsRefresh';
import {
  autoAssignRooms,
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
  getHousekeepingAutomationLanguage,
  housekeepingAutomationText,
  type HousekeepingAutomationLanguage,
} from '@/lib/housekeepingAutomationTranslations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
};

type PlannerStep = 'staff' | 'review';

type SyncStage = 'contacting' | 'checkouts' | 'received' | 'arranging';

const SYNC_PROGRESS: Record<SyncStage, number> = {
  contacting: 15,
  checkouts: 40,
  received: 72,
  arranging: 92,
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

/**
 * Convert today's authoritative Previo snapshot into tomorrow's housekeeping
 * workload. The live `is_checkout_room` flag is intentionally ignored because
 * it describes today, while `scheduledDepartureTomorrow` describes the plan day.
 */
function toTomorrowWorkRoom(room: any, selectedDate: string): RoomForAssignment | null {
  const metadata = (room.pms_metadata || {}) as Record<string, any>;
  if (room.status === 'out_of_order' || metadata.manualHousekeepingHold === true || metadata.isNoShow === true) {
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

function generateBestPreview(
  rooms: RoomForAssignment[],
  staff: StaffForAssignment[],
  hotelName: string,
): AssignmentPreview[] {
  let best: AssignmentPreview[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = autoAssignRooms(rooms, staff, undefined, undefined, {
      hotelName,
      randomSeed: 1109 + attempt * 7919,
    });
    const score = computeFairnessMetrics(candidate).score;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best || autoAssignRooms(rooms, staff, undefined, undefined, { hotelName });
}

export function NextDayAssignmentPlanner({
  open,
  onOpenChange,
  selectedDate,
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
  const [previews, setPreviews] = useState<AssignmentPreview[]>([]);
  const [suggestedByRoom, setSuggestedByRoom] = useState<Map<string, string>>(new Map());
  const [selectedMove, setSelectedMove] = useState<{ roomId: string; fromStaffId: string } | null>(null);
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

  const selectedStaff = useMemo(
    () => allStaff.filter(staff => selectedStaffIds.has(staff.id)),
    [allStaff, selectedStaffIds],
  );

  const checkoutCount = useMemo(
    () => tomorrowRooms.filter(room => room.is_checkout_room).length,
    [tomorrowRooms],
  );
  const dailyCount = tomorrowRooms.length - checkoutCount;
  const fairness = useMemo(() => previews.length ? computeFairnessMetrics(previews) : null, [previews]);

  const resetPlanner = () => {
    setStep('staff');
    setSyncError(null);
    setPartialSync(false);
    setPmsSyncedAt(null);
    setPmsSnapshot({});
    setAllStaff([]);
    setSchedules([]);
    setSelectedStaffIds(new Set());
    setTomorrowRooms([]);
    setPreviews([]);
    setSuggestedByRoom(new Map());
    setSelectedMove(null);
    setAutoRelease(true);
    setExistingPlan(null);
    setExistingPlanChanged(false);
  };

  const loadPlanningData = async (syncResult: PmsSyncResult, syncedAt: string) => {
    if (!profile?.assigned_hotel || !profile.organization_slug) throw new Error('Hotel access is missing.');

    const { data: hotelConfig } = await supabase
      .from('hotel_configurations')
      .select('hotel_name')
      .eq('hotel_id', profile.assigned_hotel)
      .maybeSingle();
    const resolvedHotelName = hotelConfig?.hotel_name || profile.assigned_hotel;
    setHotelName(resolvedHotelName);
    const resolvedKeys = await resolveHotelKeys(resolvedHotelName);
    const hotelKeys = resolvedKeys.length ? resolvedKeys : [resolvedHotelName, profile.assigned_hotel];

    setSyncStage('received');

    const [staffResult, scheduleResult, roomResult, planResult] = await Promise.all([
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
        .eq('hotel_id', profile.assigned_hotel)
        .eq('work_date', selectedDate),
      supabase
        .from('rooms')
        .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
        .in('hotel', hotelKeys),
      (supabase as any)
        .from('next_day_housekeeping_plans')
        .select('id,status,auto_release,release_timezone,created_by,pms_synced_at')
        .eq('organization_slug', profile.organization_slug)
        .eq('hotel_id', profile.assigned_hotel)
        .eq('plan_date', selectedDate)
        .maybeSingle(),
    ]);

    if (staffResult.error) throw staffResult.error;
    if (scheduleResult.error) throw scheduleResult.error;
    if (roomResult.error) throw roomResult.error;
    if (planResult.error) throw planResult.error;

    const staffRows = (staffResult.data || []) as StaffForAssignment[];
    const scheduleRows = (scheduleResult.data || []) as ScheduleRow[];
    const rooms = (roomResult.data || [])
      .map(room => toTomorrowWorkRoom(room, selectedDate))
      .filter(Boolean) as RoomForAssignment[];
    const plan = (planResult.data || null) as PlanRow | null;

    setAllStaff(staffRows);
    setSchedules(scheduleRows);
    setTomorrowRooms(rooms);
    setExistingPlan(plan);
    setAutoRelease(plan?.auto_release ?? true);
    setSyncStage('arranging');

    const scheduledIds = new Set(
      scheduleRows.filter(schedule => schedule.status !== 'off').map(schedule => schedule.user_id),
    );
    const availableStaffIds = new Set(staffRows.map(staff => staff.id));
    const defaultSelection = new Set(Array.from(scheduledIds).filter(id => availableStaffIds.has(id)));

    if (plan?.id) {
      const [planStaffResult, planItemsResult] = await Promise.all([
        (supabase as any)
          .from('next_day_housekeeping_plan_staff')
          .select('user_id,selected')
          .eq('plan_id', plan.id),
        (supabase as any)
          .from('next_day_housekeeping_plan_items')
          .select('room_id,assigned_to,assignment_type')
          .eq('plan_id', plan.id),
      ]);
      if (planStaffResult.error) throw planStaffResult.error;
      if (planItemsResult.error) throw planItemsResult.error;

      const savedStaffIds = new Set<string>(
        (planStaffResult.data || []).filter((row: any) => row.selected).map((row: any) => row.user_id),
      );
      const effectiveSelection = savedStaffIds.size ? savedStaffIds : defaultSelection;
      setSelectedStaffIds(effectiveSelection);

      const items = (planItemsResult.data || []) as PlanItemRow[];
      const roomMap = new Map(rooms.map(room => [room.id, room]));
      const itemRoomIds = new Set(items.map(item => item.room_id));
      const workloadRoomIds = new Set(rooms.map(room => room.id));
      const changed =
        itemRoomIds.size !== workloadRoomIds.size ||
        Array.from(itemRoomIds).some(id => !workloadRoomIds.has(id));
      setExistingPlanChanged(changed);

      if (items.length > 0) {
        const staffMap = new Map(staffRows.map(staff => [staff.id, staff]));
        const ownerIds = Array.from(new Set(items.map(item => item.assigned_to)));
        const restored = ownerIds.map(ownerId => {
          const staff = staffMap.get(ownerId) || {
            id: ownerId,
            full_name: `Staff ${ownerId.slice(0, 6)}`,
            nickname: null,
          };
          const assignedRooms = items
            .filter(item => item.assigned_to === ownerId)
            .map(item => roomMap.get(item.room_id))
            .filter(Boolean) as RoomForAssignment[];
          return buildPreview(staff, assignedRooms);
        });
        setPreviews(restored);
        setSuggestedByRoom(new Map(items.map(item => [item.room_id, item.assigned_to])));
        setStep('review');
        return;
      }
    }

    setSelectedStaffIds(defaultSelection);
    if (defaultSelection.size > 0 && rooms.length > 0) {
      const selected = staffRows.filter(staff => defaultSelection.has(staff.id));
      const generated = generateBestPreview(rooms, selected, resolvedHotelName);
      setPreviews(generated);
      setSuggestedByRoom(new Map(generated.flatMap(preview =>
        preview.rooms.map(room => [room.id, preview.staffId] as [string, string]),
      )));
    }
  };

  const prepareTomorrow = async () => {
    if (!profile?.assigned_hotel || !profile.organization_slug) return;
    const generation = ++syncGeneration.current;
    setSyncing(true);
    setSyncError(null);
    setPartialSync(false);
    setSyncStage('contacting');

    const stageTimer = window.setTimeout(() => {
      if (syncGeneration.current === generation) setSyncStage('checkouts');
    }, 650);

    try {
      const result = await runPmsRefresh(profile.assigned_hotel, { trigger: 'manual' });
      if (syncGeneration.current !== generation) return;
      if (result.status === 'error' || result.reservationDataAuthoritative === false) {
        throw new Error(result.managerMessage || result.errors?.join(' · ') || 'Previo reservation data was not authoritative.');
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
        capturedAt: syncedAt,
      });
      await loadPlanningData(result, syncedAt);
    } catch (error) {
      console.error('[NextDayAssignmentPlanner] preparation failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      setSyncError(message);
    } finally {
      window.clearTimeout(stageTimer);
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
    // The selected date/hotel define a unique planning session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedDate, profile?.assigned_hotel, profile?.organization_slug]);

  const toggleStaff = (staffId: string) => {
    setSelectedStaffIds(previous => {
      const next = new Set(previous);
      if (next.has(staffId)) next.delete(staffId);
      else next.add(staffId);
      return next;
    });
    setPreviews([]);
    setSuggestedByRoom(new Map());
    setSelectedMove(null);
    setStep('staff');
  };

  const generatePreview = () => {
    if (selectedStaff.length === 0) {
      toast.warning(text('noStaff'));
      return;
    }
    if (tomorrowRooms.length === 0) return;
    const generated = generateBestPreview(tomorrowRooms, selectedStaff, hotelName || profile?.assigned_hotel || '');
    setPreviews(generated);
    setSuggestedByRoom(new Map(generated.flatMap(preview =>
      preview.rooms.map(room => [room.id, preview.staffId] as [string, string]),
    )));
    setSelectedMove(null);
    setStep('review');
  };

  const applyMove = (roomId: string, fromStaffId: string, toStaffId: string) => {
    if (!roomId || !fromStaffId || !toStaffId || fromStaffId === toStaffId) return;
    setPreviews(previous => moveRoom(previous, roomId, fromStaffId, toStaffId));
    setSelectedMove(null);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>, toStaffId: string) => {
    event.preventDefault();
    const roomId = event.dataTransfer.getData('hotelcare-nextday-room-id');
    const fromStaffId = event.dataTransfer.getData('hotelcare-nextday-from-staff');
    applyMove(roomId, fromStaffId, toStaffId);
  };

  const saveApprovedPlan = async () => {
    if (!user || !profile?.organization_slug || !profile.assigned_hotel || !pmsSyncedAt) return;
    if (previews.length === 0 || previews.every(preview => preview.rooms.length === 0)) return;
    if (existingPlan?.status === 'released' || existingPlan?.status === 'releasing') {
      toast.error('This plan is already being released or has been released.');
      return;
    }

    setSaving(true);
    try {
      const finalEntries = previews.flatMap(preview => preview.rooms.map(room => ({
        room,
        staffId: preview.staffId,
      })));
      const changedCount = finalEntries.filter(entry => suggestedByRoom.get(entry.room.id) !== entry.staffId).length;
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
        algorithm_version: 'room-assignment-v2-next-day-2026-09',
        generation_context: {
          source: 'next_day_manager_planner',
          hotel_name: hotelName,
          plan_date: selectedDate,
          room_count: finalEntries.length,
          checkout_count: finalEntries.filter(entry => entry.room.is_checkout_room).length,
          daily_count: finalEntries.filter(entry => !entry.room.is_checkout_room).length,
          selected_staff_ids: Array.from(selectedStaffIds),
          manager_changed_room_count: changedCount,
          workload_derivation: 'scheduledDepartureTomorrow+occupiedToday/currentNight',
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
        (supabase as any).from('next_day_housekeeping_plan_staff').delete().eq('plan_id', planId),
        (supabase as any).from('next_day_housekeeping_plan_items').delete().eq('plan_id', planId),
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
        const { error } = await (supabase as any).from('next_day_housekeeping_plan_staff').insert(staffPayload);
        if (error) throw error;
      }

      const itemPayload = finalEntries.map(({ room, staffId }) => {
        const suggestedStaffId = suggestedByRoom.get(room.id) || staffId;
        return {
          plan_id: planId,
          room_id: room.id,
          assigned_to: staffId,
          assignment_type: room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning',
          priority: room.is_checkout_room ? 1 : 2,
          estimated_duration: calculateRoomTime(room),
          notes: null,
          source: suggestedStaffId === staffId ? 'auto' : 'manager',
          recommendation_context: {
            suggested_staff_id: suggestedStaffId,
            final_staff_id: staffId,
            manager_changed: suggestedStaffId !== staffId,
            room_number: room.room_number,
            room_kind: room.is_checkout_room ? 'checkout' : 'daily',
            floor_number: room.floor_number ?? getFloorFromRoomNumber(room.room_number),
            housekeeping_section_id: room.housekeeping_section_id || null,
            housekeeping_section_name: room.housekeeping_section_name || null,
            towel_change_required: room.towel_change_required === true,
            linen_change_required: room.linen_change_required === true,
          },
        };
      });
      if (itemPayload.length > 0) {
        const { error } = await (supabase as any).from('next_day_housekeeping_plan_items').insert(itemPayload);
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
        detail: { hotelId: profile.assigned_hotel, planDate: selectedDate, planId },
      }));
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
            {existingPlan && <Badge variant={existingPlan.status === 'approved' ? 'default' : 'secondary'}>{existingPlan.status}</Badge>}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{text('subtitle')}</p>
        </DialogHeader>

        {syncing ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <div className="w-full max-w-xl space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-primary/10 p-3"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                <div>
                  <p className="font-semibold">{syncStageLabel(syncStage, language)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{selectedDate}</p>
                </div>
              </div>
              <Progress value={SYNC_PROGRESS[syncStage]} className="h-2" />
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                {(['contacting', 'checkouts', 'received', 'arranging'] as SyncStage[]).map((stage, index) => (
                  <div key={stage} className={SYNC_PROGRESS[syncStage] >= SYNC_PROGRESS[stage] ? 'font-medium text-foreground' : ''}>
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
              <Button className="mt-5" onClick={() => void prepareTomorrow()}>
                <RefreshCw className="mr-2 h-4 w-4" />{text('retrySync')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <Badge variant="outline" className="border-emerald-300 text-emerald-700"><Check className="mr-1 h-3 w-3" />{text('pmsFresh')}</Badge>
              {pmsSyncedAt && <span className="text-muted-foreground">{new Date(pmsSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
              <span className="ml-auto font-medium">{text('tomorrowWorkload')}: {tomorrowRooms.length} {text('rooms')} · {checkoutCount} {text('checkouts')} · {dailyCount} {text('daily')}</span>
            </div>

            {partialSync && <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{text('warningPartial')}</div>}
            {existingPlan && <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${existingPlanChanged ? 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200' : 'bg-muted/30'}`}><strong>{text('existingPlan')}.</strong> {existingPlanChanged ? text('existingPlanChanged') : ''}</div>}

            <div className="min-h-0 flex-1 overflow-y-auto py-3">
              {tomorrowRooms.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground"><Check className="mx-auto mb-3 h-12 w-12 opacity-40" /><p>{text('noRooms')}</p></div>
              ) : step === 'staff' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3 rounded-xl bg-muted p-3">
                    <div className="text-center"><p className="text-2xl font-bold">{tomorrowRooms.length}</p><p className="text-xs text-muted-foreground">{text('rooms')}</p></div>
                    <div className="text-center"><p className="text-2xl font-bold text-amber-600">{checkoutCount}</p><p className="text-xs text-muted-foreground">{text('checkouts')}</p></div>
                    <div className="text-center"><p className="text-2xl font-bold text-blue-600">{dailyCount}</p><p className="text-xs text-muted-foreground">{text('daily')}</p></div>
                  </div>

                  <h3 className="flex items-center gap-2 font-medium"><Users className="h-4 w-4" />{text('selectStaff')} ({selectedStaffIds.size})</h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {allStaff.map(staff => {
                      const schedule = scheduleByUser.get(staff.id);
                      const selected = selectedStaffIds.has(staff.id);
                      return (
                        <button key={staff.id} type="button" onClick={() => toggleStaff(staff.id)} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/60'}`}>
                          <Checkbox checked={selected} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{staff.full_name}</span>
                            {staff.nickname && <span className="block truncate text-xs text-muted-foreground">{staff.nickname}</span>}
                          </span>
                          {schedule ? (
                            <span className="text-right text-xs">
                              <Badge variant={schedule.status === 'published' ? 'default' : 'outline'}>{schedule.status === 'published' ? text('published') : text('draft')}</Badge>
                              <span className="mt-1 block text-muted-foreground">{schedule.shift_start?.slice(0, 5)}–{schedule.shift_end?.slice(0, 5)}</span>
                            </span>
                          ) : <Badge variant="secondary">{text('noSchedule')}</Badge>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm">
                    <div><strong>{previews.reduce((sum, preview) => sum + preview.rooms.length, 0)}</strong> {text('rooms')} → <strong>{previews.filter(preview => preview.rooms.length > 0).length}</strong> staff</div>
                    {fairness && <div className="flex gap-3 text-xs text-muted-foreground"><span>CO ±{fairness.checkoutDiff}</span><span>Daily ±{fairness.dailyDiff}</span><span>Time ±{fairness.timeSpreadMinutes}m</span><span>Floors {fairness.splitFloorCount}</span></div>}
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {previews.map(preview => (
                      <div
                        key={preview.staffId}
                        onDragOver={event => event.preventDefault()}
                        onDrop={event => handleDrop(event, preview.staffId)}
                        onClick={() => selectedMove && selectedMove.fromStaffId !== preview.staffId && applyMove(selectedMove.roomId, selectedMove.fromStaffId, preview.staffId)}
                        className={`min-h-48 rounded-xl border bg-card ${selectedMove && selectedMove.fromStaffId !== preview.staffId ? 'cursor-pointer ring-2 ring-primary/50' : ''}`}
                      >
                        <div className="border-b bg-muted/40 px-3 py-2">
                          <div className="flex items-center justify-between gap-2"><span className="truncate font-semibold">{preview.staffName}</span><span className="text-xs text-muted-foreground">{preview.estimatedMinutes}m</span></div>
                          <div className="mt-1 text-xs text-muted-foreground">{preview.checkoutCount} {text('checkouts')} · {preview.dailyCount} {text('daily')}</div>
                        </div>
                        <div className="space-y-2 p-2">
                          {preview.rooms.length === 0 && <div className="rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">Drop a room here</div>}
                          {preview.rooms.map(room => {
                            const selected = selectedMove?.roomId === room.id;
                            const changed = suggestedByRoom.get(room.id) && suggestedByRoom.get(room.id) !== preview.staffId;
                            return (
                              <button
                                key={room.id}
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
                                  setSelectedMove(selected ? null : { roomId: room.id, fromStaffId: preview.staffId });
                                }}
                                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-sm ${selected ? 'border-primary ring-2 ring-primary/30' : room.is_checkout_room ? 'border-amber-300 bg-amber-50/70 dark:bg-amber-950/20' : 'border-blue-200 bg-blue-50/60 dark:bg-blue-950/20'}`}
                              >
                                <span className="flex items-center gap-2"><strong>{room.room_number}</strong><Badge variant="outline" className="text-[10px]">{room.is_checkout_room ? 'CO' : 'D'}</Badge>{room.linen_change_required && <Badge variant="outline" className="text-[10px]">C</Badge>}{room.towel_change_required && <Badge variant="outline" className="text-[10px]">T</Badge>}</span>
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">F{room.floor_number ?? getFloorFromRoomNumber(room.room_number)}{changed && <span className="text-primary">●</span>}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    {activeMoveRoom ? <><strong className="text-foreground">{text('selectedRoom')}: {activeMoveRoom.room_number}.</strong> {text('tapMove')} <Button variant="ghost" size="sm" className="ml-1 h-6 px-2 text-xs" onClick={() => setSelectedMove(null)}>{text('cancelMove')}</Button></> : text('tapMove')}
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4">
                    <Checkbox checked={autoRelease} onCheckedChange={checked => setAutoRelease(checked === true)} className="mt-0.5" />
                    <span>
                      <span className="flex flex-wrap items-center gap-2 font-medium">{text('autoRelease')}<Badge variant="outline"><Clock className="mr-1 h-3 w-3" />{text('releaseAt')}</Badge></span>
                      <span className="mt-1 block text-xs text-muted-foreground">{autoRelease ? text('autoReleaseHint') : text('heldHint')}</span>
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
                    {text('generate')}<ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setStep('staff')}>{text('back')}</Button>
                  <Button variant="outline" onClick={generatePreview}><RefreshCw className="mr-2 h-4 w-4" />{text('regenerate')}</Button>
                  <Button onClick={saveApprovedPlan} disabled={saving || previews.length === 0}>
                    {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{text('saving')}</> : <><Check className="mr-2 h-4 w-4" />{text('savePlan')}</>}
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

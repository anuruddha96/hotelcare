import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  EyeOff,
  Loader2,
  MapPin,
  Printer,
  RefreshCw,
  Shuffle,
  Shirt,
  Trash2,
  Undo2,
  Users,
  Wand2,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import {
  AssignmentPreview,
  BREAK_TIME_MINUTES,
  CHECKOUT_MINUTES,
  DAILY_MINUTES,
  FairnessMetrics,
  HotelAssignmentConfig,
  RoomAffinityMap,
  STANDARD_SHIFT_MINUTES,
  RoomForAssignment,
  StaffForAssignment,
  WingProximityMap,
  autoAssignRooms,
  buildAffinityMap,
  buildWingProximityMap,
  calculateRoomWeight,
  calculateTimeEstimation,
  computeFairnessMetrics,
  formatMinutesToTime,
  getFloorFromRoomNumber,
  moveRoom,
} from '@/lib/roomAssignmentAlgorithm';
import {
  assignSectionTasksToStaff,
  sectionTaskMinutesForStaff,
  type HousekeepingSectionTaskTemplate,
} from '@/lib/housekeepingSectionTasks';
import { moveSelectedRooms } from '@/lib/autoAssignmentBulkMove';
import { generateSmartHousekeepingPlan, type HousekeepingPlanningGoal } from '@/lib/housekeepingSmartPlanner';
import { sanitizeStaffPreferences } from '@/lib/housekeepingAssignmentLearning';
import { isPmsRtcToday } from '@/lib/pmsReadiness';
import { isRoomEligibleForAutoAssign } from '@/lib/autoAssignRoomEligibility';
import { assignRoomToStaff, unassignRoom } from '@/lib/hkAssignmentDnd';
import { getLocalDateString } from '@/lib/utils';
import { isPotentialCheckoutRoom } from '@/lib/nextDayHousekeepingSnapshot';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { hasManagerPowers } from '@/lib/roleAccess';
import { isActiveGozsduLaundryner } from '@/lib/gozsduLaundryDutySession';
import { gozsduCanReviewAssignment, gozsduPreviewCoversWork } from '@/lib/gozsduAutoAssignGuard';
import { gozsduAllocationRespectsBuildings } from '@/lib/gozsduBuildingAssignment';
import { fetchVerifiedGozsduAutoAssignRooms } from '@/lib/gozsduVerifiedAutoAssign';
import {
  buildTomorrowAutoAssignRooms,
  loadExistingNextDayPlan,
  saveApprovedNextDayAutoAssignPlan,
  type NextDayPlan,
} from '@/lib/nextDayAutoAssignBridge';

const PUBLIC_AREAS = [
  { key: 'lobby_cleaning', name: 'Lobby', icon: '🏨' },
  { key: 'reception_cleaning', name: 'Reception', icon: '🛎️' },
  { key: 'back_office_cleaning', name: 'Back Office', icon: '🏢' },
  { key: 'kitchen_cleaning', name: 'Kitchen', icon: '🍳' },
  { key: 'guest_toilets_men', name: 'Guest Toilets (Men)', icon: '🚹' },
  { key: 'guest_toilets_women', name: 'Guest Toilets (Women)', icon: '🚺' },
  { key: 'common_areas_cleaning', name: 'Common Areas', icon: '🏠' },
  { key: 'stairways_cleaning', name: 'Stairways & Corridors', icon: '🚶' },
  { key: 'breakfast_room_cleaning', name: 'Breakfast Room', icon: '🍽️' },
  { key: 'dining_area_cleaning', name: 'Dining Area', icon: '🍴' },
];

interface AutoRoomAssignmentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate: string;
  onAssignmentCreated: (roomCount?: number, staffCount?: number) => void;
  planningMode?: 'live' | 'next-day';
  pmsSyncedAt?: string | null;
  laundryDutyIds?: readonly string[];
  laundryDutyCommitRevision?: number;
}

const EMPTY_LAUNDRY_DUTY: readonly string[] = [];
type Step = 'select-staff' | 'preview' | 'confirm' | 'public-areas';

type ExistingAssignment = {
  id: string;
  room_id: string;
  assigned_to: string;
  assignment_type: string;
  status: string;
  priority: number | null;
  ready_to_clean: boolean | null;
  pms_hold: boolean | null;
  pms_hold_reason: string | null;
};

interface SavedState {
  staffIds: string[];
  previews: AssignmentPreview[];
  excludedRoomIds?: string[];
  maintenanceHoldRoomIds?: string[];
  savedAt: number;
  lockedRoomIds?: string[];
}

const isCheckoutLike = (room: RoomForAssignment): boolean =>
  room.is_checkout_room === true || room.pms_metadata?.scheduledDepartureToday === true;

const needsTowelChange = (room: RoomForAssignment): boolean =>
  !!room.towel_change_required && !isCheckoutLike(room);

const needsLinenChange = (room: RoomForAssignment): boolean =>
  !!room.linen_change_required && !isCheckoutLike(room);

function getSaveKey(organization: string | null | undefined, hotel: string | null | undefined, date: string): string {
  // v2 invalidates drafts created by the old dirty-only room filter. Without
  // this, a manager could reopen today's two-room draft after the fix and
  // still not see the full PMS workload until manually regenerating it.
  return `auto_assignment_v3_${organization || 'unknown'}_${hotel || 'unknown'}_${date}`;
}

function roomOrdinal(roomNumber: string): number {
  const values = String(roomNumber || '').match(/\d+/g);
  return values?.length ? Number(values[values.length - 1]) : Number.MAX_SAFE_INTEGER;
}

function sortPreviewRooms(rooms: RoomForAssignment[]): RoomForAssignment[] {
  return [...rooms].sort((a, b) => {
    const rank = (room: RoomForAssignment) => isPotentialCheckoutRoom(room) ? 1 : isCheckoutLike(room) ? 0 : 2;
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    const floorA = a.floor_number ?? getFloorFromRoomNumber(a.room_number);
    const floorB = b.floor_number ?? getFloorFromRoomNumber(b.room_number);
    if (floorA !== floorB) return floorA - floorB;
    return roomOrdinal(a.room_number) - roomOrdinal(b.room_number) || a.room_number.localeCompare(b.room_number);
  });
}

function buildPreview(staffId: string, staffName: string, rooms: RoomForAssignment[]): AssignmentPreview {
  const sorted = sortPreviewRooms(rooms);
  const estimate = calculateTimeEstimation(sorted);
  return {
    staffId,
    staffName,
    rooms: sorted,
    totalWeight: sorted.reduce((sum, room) => sum + calculateRoomWeight(room), 0),
    checkoutCount: sorted.filter(isCheckoutLike).length,
    dailyCount: sorted.filter(room => !isCheckoutLike(room)).length,
    ...estimate,
  };
}

export function AutoRoomAssignment({
  open,
  onOpenChange,
  selectedDate,
  onAssignmentCreated,
  planningMode = 'live',
  pmsSyncedAt = null,
  laundryDutyIds = EMPTY_LAUNDRY_DUTY,
  laundryDutyCommitRevision = 0,
}: AutoRoomAssignmentProps) {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const isNextDayPlanning = planningMode === 'next-day';
  const isGozsdu = isGozsduCourtHotel(profile?.assigned_hotel);
  const isLaundryner = (staffId: string) => isGozsdu
    && (laundryDutyIds.includes(staffId) || isActiveGozsduLaundryner(staffId));

  const [step, setStep] = useState<Step>('select-staff');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [allStaff, setAllStaff] = useState<StaffForAssignment[]>([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string>>(new Set());
  const [checkedInStaff, setCheckedInStaff] = useState<Set<string>>(new Set());
  const [dirtyRooms, setDirtyRooms] = useState<RoomForAssignment[]>([]);
  const [excludedRoomIds, setExcludedRoomIds] = useState<Set<string>>(new Set());
  const [maintenanceHoldRoomIds, setMaintenanceHoldRoomIds] = useState<Set<string>>(new Set());
  const [assignmentPreviews, setAssignmentPreviews] = useState<AssignmentPreview[]>([]);
  const [previewHistory, setPreviewHistory] = useState<AssignmentPreview[][]>([]);
  const [selectedRoomForMove, setSelectedRoomForMove] = useState<{ roomId: string; fromStaffId: string } | null>(null);
  // Independently controlled: drag/tap-to-move remains available while rooms are checked for a bulk transfer.
  const [bulkSelectedRoomIds, setBulkSelectedRoomIds] = useState<Set<string>>(new Set());
  const [bulkDestinationStaffId, setBulkDestinationStaffId] = useState<string>('');
  const [dragOverStaffId, setDragOverStaffId] = useState<string | null>(null);
  const [draggingRoomId, setDraggingRoomId] = useState<string | null>(null);
  const [justDroppedRoomId, setJustDroppedRoomId] = useState<string | null>(null);
  const [justDroppedStaffId, setJustDroppedStaffId] = useState<string | null>(null);
  const [fairnessMetrics, setFairnessMetrics] = useState<FairnessMetrics | null>(null);
  const [wingProximity, setWingProximity] = useState<WingProximityMap | undefined>();
  const [roomAffinity, setRoomAffinity] = useState<RoomAffinityMap | undefined>();
  const [editingExistingAssignments, setEditingExistingAssignments] = useState(false);
  const [restoredFromSave, setRestoredFromSave] = useState(false);
  const [showOverAllocationDialog, setShowOverAllocationDialog] = useState(false);
  const [overAllocatedStaff, setOverAllocatedStaff] = useState<AssignmentPreview[]>([]);
  const [publicAreaAssignments, setPublicAreaAssignments] = useState<Map<string, string>>(new Map());
  const [sectionTaskTemplates, setSectionTaskTemplates] = useState<HousekeepingSectionTaskTemplate[]>([]);
  // Manager overrides of the automatic public-area owner, keyed by section task id.
  const [sectionTaskOwners, setSectionTaskOwners] = useState<Map<string, string>>(new Map());
  // Public-area work already started/finished today: owner is fixed, no reassignment.
  const [lockedSectionTasks, setLockedSectionTasks] = useState<Map<string, { status: string; assignedTo: string | null }>>(new Map());
  const [draggingAreaTaskId, setDraggingAreaTaskId] = useState<string | null>(null);
  const [nextDayPlan, setNextDayPlan] = useState<NextDayPlan | null>(null);
  const [nextDayPmsSyncedAt, setNextDayPmsSyncedAt] = useState<string | null>(pmsSyncedAt);
  const [autoRelease, setAutoRelease] = useState(true);
  const [sharedByRoom, setSharedByRoom] = useState<Map<string, string>>(new Map());
  const [suggestedByRoom, setSuggestedByRoom] = useState<Map<string, string>>(new Map());
  const [tomorrowSchedules, setTomorrowSchedules] = useState<any[]>([]);
  const [planningGoal, setPlanningGoal] = useState<HousekeepingPlanningGoal>('rebalance');
  const [planningExplanation, setPlanningExplanation] = useState('');
  const [lockedRoomIds, setLockedRoomIds] = useState<Set<string>>(new Set());
  const [lockHistory, setLockHistory] = useState<Set<string>[]>([]);
  const [historicalSampleCount, setHistoricalSampleCount] = useState(0);
  const [historicalPreferences, setHistoricalPreferences] = useState<Record<string, string[]>>({});

  const existingAssignmentsRef = useRef<Map<string, ExistingAssignment>>(new Map());
  const hotelKeysRef = useRef<string[]>([]);
  const managerHotelRef = useRef<string>('');
  const draftRestoredRef = useRef(false);
  const laundryCommitRef = useRef(laundryDutyCommitRevision);
  const roomSectionsRef = useRef<Map<string, { id: string; name: string }>>(new Map());

  const saveKey = getSaveKey(profile?.organization_slug, profile?.assigned_hotel, selectedDate);
  // The shared duty bridge is populated before Gozsdu's board mounts. Count
  // only CLEANING staff; selected laundry collectors never enter the preview.
  const cleaningStaffIds = useMemo(
    () => new Set([...selectedStaffIds].filter(id => !isGozsdu || !isActiveGozsduLaundryner(id))),
    [selectedStaffIds, isGozsdu, laundryDutyIds],
  );

  const effectiveRooms = useMemo(
    () => dirtyRooms.filter(room => !excludedRoomIds.has(room.id) && !maintenanceHoldRoomIds.has(room.id)),
    [dirtyRooms, excludedRoomIds, maintenanceHoldRoomIds],
  );

  const selectedRoomContext = useMemo(() => {
    if (!selectedRoomForMove) return null;
    const preview = assignmentPreviews.find(p => p.staffId === selectedRoomForMove.fromStaffId);
    const room = preview?.rooms.find(r => r.id === selectedRoomForMove.roomId);
    if (!preview || !room) return null;
    return { preview, room };
  }, [assignmentPreviews, selectedRoomForMove]);

  const bulkRoomContexts = useMemo(() => assignmentPreviews.flatMap(person =>
    person.rooms.filter(room => bulkSelectedRoomIds.has(room.id))
      .map(room => ({ room, fromStaffId: person.staffId })),
  ), [assignmentPreviews, bulkSelectedRoomIds]);

  // Live PMS refresh and regeneration can remove rooms from the preview. Never
  // keep a hidden selection that might later move a different room by mistake.
  useEffect(() => {
    const available = new Set(assignmentPreviews.flatMap(person => person.rooms.map(room => room.id)));
    setBulkSelectedRoomIds(previous => {
      const valid = new Set([...previous].filter(id => available.has(id)));
      return valid.size === previous.size ? previous : valid;
    });
  }, [assignmentPreviews]);

  const automaticSectionTasks = useMemo(
    () => assignSectionTasksToStaff(assignmentPreviews, sectionTaskTemplates),
    [assignmentPreviews, sectionTaskTemplates],
  );

  /**
   * The public-area work as the manager currently sees it: automatic owner,
   * overridden by a drag/shuffle, and finally pinned to the real owner when
   * the task is already in progress or done for the day.
   */
  const sectionTasks = useMemo(() => automaticSectionTasks.map(task => {
    const locked = lockedSectionTasks.get(task.id);
    const lockedOwnerId = locked && locked.status !== 'assigned' ? locked.assignedTo : null;
    const ownerId = lockedOwnerId || sectionTaskOwners.get(task.id) || task.staff_id;
    const ownerName = assignmentPreviews.find(p => p.staffId === ownerId)?.staffName
      || allStaff.find(s => s.id === ownerId)?.full_name
      || task.staff_name;
    return {
      ...task,
      staff_id: ownerId,
      staff_name: ownerName,
      lockedStatus: locked && locked.status !== 'assigned' ? locked.status : null,
    };
  }), [automaticSectionTasks, sectionTaskOwners, lockedSectionTasks, assignmentPreviews, allStaff]);

  const staffIdsWithWork = useMemo(() => new Set([
    ...assignmentPreviews.filter(preview => preview.rooms.length > 0).map(preview => preview.staffId),
    ...sectionTasks.map(task => task.staff_id),
  ]), [assignmentPreviews, sectionTasks]);

  const maxTime = useMemo(() => {
    const active = assignmentPreviews.filter(preview => staffIdsWithWork.has(preview.staffId));
    return Math.max(...active.map(p =>
      p.totalWithBreak + sectionTaskMinutesForStaff(sectionTasks, p.staffId)
    ), 1);
  }, [assignmentPreviews, sectionTasks, staffIdsWithWork]);

  const bulkDestination = assignmentPreviews.find(person => person.staffId === bulkDestinationStaffId);
  const bulkMovableRooms = bulkRoomContexts.filter(entry => entry.fromStaffId !== bulkDestinationStaffId);
  const bulkProjectedMinutes = bulkDestination
    ? calculateTimeEstimation([...bulkDestination.rooms, ...bulkMovableRooms.map(entry => entry.room)]).totalWithBreak
      + sectionTaskMinutesForStaff(sectionTasks, bulkDestination.staffId)
    : null;

  const toggleBulkRooms = (roomIds: string[]) => {
    if (!roomIds.length) return;
    setBulkSelectedRoomIds(previous => {
      const next = new Set(previous);
      const allSelected = roomIds.every(id => next.has(id));
      for (const id of roomIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const getManagerHotel = async (): Promise<string | null> => {
    if (!profile?.assigned_hotel) return null;
    const { data } = await supabase
      .from('hotel_configurations')
      .select('hotel_name')
      .eq('hotel_id', profile.assigned_hotel)
      .maybeSingle();
    return data?.hotel_name || profile.assigned_hotel;
  };

  const addSectionContext = (room: any): RoomForAssignment => {
    const section = roomSectionsRef.current.get(room.id);
    return {
      ...room,
      housekeeping_section_id: section?.id || null,
      housekeeping_section_name: section?.name || null,
    } as RoomForAssignment;
  };

  const refreshLiveRoomState = async () => {
    if (isNextDayPlanning) return;
    const keys = hotelKeysRef.current;
    if (!open || keys.length === 0) return;

    const { data: roomRows, error: roomErr } = await supabase
      .from('rooms')
      .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
      .in('hotel', keys)
      .eq('organization_slug', profile?.organization_slug || '');
    if (roomErr || !roomRows) return;

    let currentRooms = roomRows.map(addSectionContext);
    if (isGozsdu) {
      if (!profile?.organization_slug) return;
      try {
        currentRooms = await fetchVerifiedGozsduAutoAssignRooms(currentRooms, profile.organization_slug, selectedDate);
      } catch (error) {
        // Keep the last verified preview; never replace it with misleading imported flags.
        console.warn('[Gozsdu Auto Assign] date-matched PMS refresh not verified', error);
        return;
      }
    }
    const roomIds = currentRooms.map(room => room.id);
    let assignmentRows: any[] = [];
    if (roomIds.length > 0) {
      const { data } = await supabase
        .from('room_assignments')
        .select('room_id, assigned_to, ready_to_clean, pms_hold, pms_hold_reason, status, assignment_type')
        .eq('assignment_date', selectedDate)
        .in('room_id', roomIds);
      assignmentRows = data || [];
    }

    const assignmentMap = new Map(assignmentRows.map(row => [row.room_id, row]));
    const activeRoomIds = new Set(assignmentRows
      .filter(row => ['assigned', 'in_progress', 'dnd_pending_retry'].includes(row.status))
      .map(row => row.room_id));
    const completedRoomIds = new Set(assignmentRows
      .filter(row => row.status === 'completed')
      .map(row => row.room_id));
    const availableRooms = currentRooms
      .filter(room => isRoomEligibleForAutoAssign(room, {
        hasActiveAssignment: activeRoomIds.has(room.id),
        hasCompletedAssignment: completedRoomIds.has(room.id),
      }))
      .map(room => ({
        ...room,
        ready_to_clean: assignmentMap.get(room.id)?.ready_to_clean ?? false,
      })) as RoomForAssignment[];
    const availableRoomMap = new Map(availableRooms.map(room => [room.id, room]));

    setDirtyRooms(availableRooms);

    setAssignmentPreviews(previous => previous.map(preview =>
      buildPreview(
        preview.staffId,
        preview.staffName,
        preview.rooms
          .map(room => availableRoomMap.get(room.id))
          .filter(Boolean) as RoomForAssignment[],
      ),
    ));
  };

  useEffect(() => {
    if (!open || isNextDayPlanning) return;
    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (cancelled) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void refreshLiveRoomState(), 250);
    };

    const channel = supabase
      .channel(`auto-assign-live-${profile?.assigned_hotel || 'hotel'}-${selectedDate}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, schedule)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'room_assignments',
        filter: `assignment_date=eq.${selectedDate}`,
      }, schedule)
      .subscribe();

    const poll = setInterval(schedule, 20_000);
    const onPmsSync = () => schedule();
    const onVisible = () => { if (!document.hidden) schedule(); };
    window.addEventListener('pms-sync-completed', onPmsSync);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      clearInterval(poll);
      supabase.removeChannel(channel);
      window.removeEventListener('pms-sync-completed', onPmsSync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [open, selectedDate, profile?.assigned_hotel, isNextDayPlanning]);

  useEffect(() => {
    if (isNextDayPlanning && pmsSyncedAt) setNextDayPmsSyncedAt(pmsSyncedAt);
  }, [isNextDayPlanning, pmsSyncedAt]);

  const fetchData = async (preserveDraft: boolean = false) => {
    setLoading(true);
    try {
      if (!profile?.organization_slug) throw new Error('Organization access could not be verified');
      const hotelName = await getManagerHotel();
      if (!hotelName) {
        toast.error(t('autoAssign.noHotelAssigned'));
        return;
      }
      managerHotelRef.current = hotelName;

      const resolvedKeys = await resolveHotelKeys(hotelName);
      const hotelKeys = resolvedKeys.length ? resolvedKeys : [hotelName];
      hotelKeysRef.current = hotelKeys;

      const { data: staffData, error: staffErr } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .or('role.eq.housekeeping,acts_as_housekeeper.eq.true')
        .in('assigned_hotel', hotelKeys)
        .eq('organization_slug', profile.organization_slug)
        .order('full_name');
      if (staffErr) throw staffErr;
      const staffList = (staffData || []) as StaffForAssignment[];
      setAllStaff(staffList);

      const hotelStaffIds = new Set(staffList.map(staff => staff.id));
      let checked = new Set<string>();
      if (isNextDayPlanning) {
        const { data: scheduleData, error: scheduleError } = await (supabase as any)
          .from('staff_schedules')
          .select('id,user_id,work_date,shift_start,shift_end,status,notes')
          .eq('organization_slug', profile.organization_slug)
          .eq('hotel_id', profile.assigned_hotel)
          .eq('work_date', selectedDate);
        if (scheduleError) throw scheduleError;
        const schedules = scheduleData || [];
        setTomorrowSchedules(schedules);
        checked = new Set(
          schedules
            .filter((row: any) => row.status !== 'off' && hotelStaffIds.has(row.user_id))
            .map((row: any) => row.user_id),
        );
      } else {
        const { data: attendanceData } = await supabase
          .from('staff_attendance')
          .select('user_id')
          .eq('work_date', selectedDate)
          .in('status', ['checked_in', 'on_break']);
        checked = new Set((attendanceData || []).map(row => row.user_id).filter(id => hotelStaffIds.has(id)));
        setTomorrowSchedules([]);
      }
      setCheckedInStaff(checked);

      const { data: roomRows, error: roomsErr } = await supabase
        .from('rooms')
        .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
        .in('hotel', hotelKeys)
        .eq('organization_slug', profile.organization_slug);
      if (roomsErr) throw roomsErr;

      const { data: sectionRows, error: sectionError } = await (supabase as any)
        .from('hotel_housekeeping_sections')
        .select('id, name, floor_number')
        .eq('hotel_name', hotelName)
        .eq('is_active', true)
        .order('floor_number')
        .order('sort_order');
      if (sectionError) throw sectionError;

      const sectionById = new Map<string, { id: string; name: string; floor_number: number }>(
        (sectionRows || []).map((section: any) => [section.id, section]),
      );
      let sectionRoomRows: Array<{ room_id: string; section_id: string }> = [];
      let sectionTaskRows: any[] = [];
      if (sectionById.size > 0) {
        const sectionIds = Array.from(sectionById.keys());
        const [sectionRoomsResult, sectionTasksResult] = await Promise.all([
          (supabase as any)
            .from('hotel_housekeeping_section_rooms')
            .select('room_id, section_id')
            .in('section_id', sectionIds),
          (supabase as any)
            .from('hotel_housekeeping_section_tasks')
            .select('id, section_id, task_name, icon, estimated_duration, auto_assign, is_active, sort_order')
            .in('section_id', sectionIds)
            .eq('is_active', true)
            .eq('auto_assign', true)
            .order('sort_order'),
        ]);
        if (sectionRoomsResult.error) throw sectionRoomsResult.error;
        if (sectionTasksResult.error) throw sectionTasksResult.error;
        sectionRoomRows = sectionRoomsResult.data || [];
        sectionTaskRows = sectionTasksResult.data || [];
      }

      // Public-area rows already created for this hotel/date: anything past
      // 'assigned' is being worked on and must keep its current owner.
      const sectionTaskIds = sectionTaskRows.map((task: any) => task.id);
      if (!isNextDayPlanning && sectionTaskIds.length > 0) {
        const { data: liveTaskRows } = await (supabase as any)
          .from('general_tasks')
          .select('housekeeping_section_task_id, status, assigned_to')
          .eq('hotel', hotelName)
          .eq('assigned_date', selectedDate)
          .in('housekeeping_section_task_id', sectionTaskIds);
        setLockedSectionTasks(new Map((liveTaskRows || []).map((row: any) => [
          row.housekeeping_section_task_id,
          { status: row.status as string, assignedTo: row.assigned_to as string | null },
        ])));
      } else {
        setLockedSectionTasks(new Map());
      }

      roomSectionsRef.current = new Map(sectionRoomRows.flatMap(mapping => {
        const section = sectionById.get(mapping.section_id);
        return section ? [[mapping.room_id, { id: section.id, name: section.name }]] : [];
      }));
      setSectionTaskTemplates(sectionTaskRows.flatMap(task => {
        const section = sectionById.get(task.section_id);
        return section ? [{
          ...task,
          section_name: section.name,
          floor_number: section.floor_number,
        } as HousekeepingSectionTaskTemplate] : [];
      }));

      const allHotelRooms = (roomRows || []).map(addSectionContext);
      const verifiedLiveRooms = isGozsdu && !isNextDayPlanning
        ? await fetchVerifiedGozsduAutoAssignRooms(allHotelRooms, profile.organization_slug, selectedDate)
        : allHotelRooms;
      let workingRooms: RoomForAssignment[] = [];
      let existingRows: ExistingAssignment[] = [];
      let selectedFromDb = new Set<string>(checked);
      let savedManagerRoomIds = new Set<string>();

      if (isNextDayPlanning) {
        if (!profile.assigned_hotel) throw new Error('Hotel access is missing');
        const [workload, saved] = await Promise.all([
          buildTomorrowAutoAssignRooms({
            organizationSlug: profile.organization_slug,
            hotelId: profile.assigned_hotel,
            selectedDate,
            roomRows: allHotelRooms,
            pmsSyncedAt,
          }),
          loadExistingNextDayPlan({
            organizationSlug: profile.organization_slug,
            hotelId: profile.assigned_hotel,
            selectedDate,
          }),
        ]);
        workingRooms = workload.rooms;
        setNextDayPlan(saved.plan);
        setAutoRelease(saved.plan?.auto_release ?? true);
        setNextDayPmsSyncedAt(pmsSyncedAt || workload.capturedAt || saved.plan?.pms_synced_at || null);

        savedManagerRoomIds = new Set(saved.items.filter(item => item.recommendation_context?.manager_changed === true).map(item => item.room_id));
        const primaryItems = saved.items.filter(item =>
          item.source !== 'shared' && item.recommendation_context?.assignment_role !== 'shared'
        );
        const sharedItems = saved.items.filter(item =>
          item.source === 'shared' || item.recommendation_context?.assignment_role === 'shared'
        );
        setSharedByRoom(new Map(sharedItems.map(item => [item.room_id, item.assigned_to])));
        setSuggestedByRoom(new Map(primaryItems.map(item => [
          item.room_id,
          item.recommendation_context?.suggested_staff_id || item.assigned_to,
        ])));
        setSectionTaskOwners(new Map(saved.areas.flatMap(area =>
          area.source === 'mapped' && area.section_task_id
            ? [[area.section_task_id, area.assigned_to] as [string, string]]
            : []
        )));
        setPublicAreaAssignments(new Map(saved.areas.flatMap(area =>
          area.source === 'manual' && area.task_key.startsWith('manual:')
            ? [[area.task_key.slice('manual:'.length), area.assigned_to] as [string, string]]
            : []
        )));

        existingRows = primaryItems.map(item => ({
          id: item.id,
          room_id: item.room_id,
          assigned_to: item.assigned_to,
          assignment_type: item.assignment_type,
          status: 'assigned',
          priority: item.priority,
          ready_to_clean: item.assignment_type === 'daily_cleaning',
          pms_hold: false,
          pms_hold_reason: null,
        }));
        const planOwners = new Set(existingRows.map(row => row.assigned_to));
        selectedFromDb = new Set([
          ...Array.from(checked),
          ...saved.staffIds,
          ...Array.from(planOwners),
          ...sharedItems.map(item => item.assigned_to),
        ]);
      } else {
        setNextDayPlan(null);
        setAutoRelease(true);
        setSharedByRoom(new Map());
        setSuggestedByRoom(new Map());
        const roomIds = allHotelRooms.map(room => room.id);
        if (roomIds.length > 0) {
          const { data, error } = await supabase
            .from('room_assignments')
            .select('id, room_id, assigned_to, assignment_type, status, priority, ready_to_clean, pms_hold, pms_hold_reason')
            .eq('assignment_date', selectedDate)
            .in('room_id', roomIds);
          if (error) throw error;
          const assignmentRows = (data || []) as ExistingAssignment[];
          existingRows = assignmentRows.filter(row =>
            ['assigned', 'in_progress', 'dnd_pending_retry'].includes(row.status)
          );
          const completedRoomIds = new Set(assignmentRows
            .filter(row => row.status === 'completed')
            .map(row => row.room_id));
          const assignedRoomIds = new Set(existingRows.map(row => row.room_id));
          workingRooms = verifiedLiveRooms
            .filter(room => isRoomEligibleForAutoAssign(room, {
              hasActiveAssignment: assignedRoomIds.has(room.id),
              hasCompletedAssignment: completedRoomIds.has(room.id),
            }))
            .map(room => ({
              ...room,
              ready_to_clean: existingRows.find(row => row.room_id === room.id)?.ready_to_clean ?? false,
            }));
        } else {
          workingRooms = [];
        }
        const ownerIds = new Set(existingRows.map(row => row.assigned_to));
        selectedFromDb = new Set<string>([...Array.from(checked), ...Array.from(ownerIds)]);
      }

      // Existing live work must NEVER be hidden if database duty state conflicts.
      if (isGozsdu && existingRows.some(row => isActiveGozsduLaundryner(row.assigned_to))) {
        throw new Error('A Laundryner still owns cleaning work. Resolve this conflict before Auto Assign.');
      }
      if (isGozsdu) {
        selectedFromDb = new Set([...selectedFromDb].filter(id => !isActiveGozsduLaundryner(id)));
      }
      existingAssignmentsRef.current = new Map(existingRows.map(row => [row.room_id, row]));
      setDirtyRooms(workingRooms);

      if (!preserveDraft) {
        if (existingRows.length > 0) {
          setEditingExistingAssignments(true);
          setSelectedStaffIds(selectedFromDb);
          const roomMap = new Map(workingRooms.map(room => [room.id, room]));
          const staffById = new Map(staffList.map(staff => [staff.id, staff]));
          const ownerIds = new Set(existingRows.map(row => row.assigned_to));
          const previewStaff: StaffForAssignment[] = [];
          for (const staff of staffList) {
            if (selectedFromDb.has(staff.id)) previewStaff.push(staff);
          }
          for (const ownerId of ownerIds) {
            if (!staffById.has(ownerId)) {
              previewStaff.push({ id: ownerId, full_name: `Staff ${ownerId.slice(0, 6)}`, nickname: null });
            }
          }
          const previews = previewStaff.map(staff => {
            const rooms = existingRows
              .filter(row => row.assigned_to === staff.id)
              .map(row => roomMap.get(row.room_id))
              .filter(Boolean) as RoomForAssignment[];
            return buildPreview(staff.id, staff.full_name, rooms);
          });
          setAssignmentPreviews(previews);
          setFairnessMetrics(computeFairnessMetrics(previews));
          setPreviewHistory([]);
          setPlanningExplanation('Existing assignment loaded. Regeneration preserves manager-adjusted rooms.');
          setLockedRoomIds(new Set(isNextDayPlanning ? [...savedManagerRoomIds] : []));
          setStep('preview');
        } else {
          setEditingExistingAssignments(false);
          setSelectedStaffIds(selectedFromDb);
          setAssignmentPreviews([]);
          setFairnessMetrics(null);
          setPlanningExplanation('');
          setLockedRoomIds(new Set());
          setStep('select-staff');
        }
      } else {
        setEditingExistingAssignments(existingRows.length > 0);
        const liveRoomMap = new Map(workingRooms.map(room => [room.id, room]));
        setAssignmentPreviews(previous => previous.map(preview => buildPreview(
          preview.staffId,
          preview.staffName,
          preview.rooms.map(room => liveRoomMap.get(room.id) || room),
        )));
      }

      const { data: layoutData } = await supabase
        .from('hotel_floor_layouts')
        .select('floor_number, wing, x, y')
        .eq('hotel_name', hotelName);
      setWingProximity(layoutData?.length ? buildWingProximityMap(layoutData.map(row => ({
        floor_number: row.floor_number,
        wing: row.wing,
        x: Number(row.x),
        y: Number(row.y),
      }))) : undefined);

      const { data: patternData } = await supabase
        .from('assignment_patterns')
        .select('room_number_a, room_number_b, pair_count, last_seen_at')
        .eq('hotel', hotelName)
        .eq('organization_slug', profile.organization_slug)
        .order('last_seen_at', { ascending: false })
        .limit(250);
      // Keep tenant-specific historical signals bounded, recent and interpretable.
      const recentPatterns = (patternData || []).flatMap(pattern => {
        const age = pattern.last_seen_at ? (Date.now() - Date.parse(pattern.last_seen_at)) / 86400000 : 999;
        if (!Number.isFinite(age) || age < 0 || age > 180 || pattern.pair_count < 2) return [];
        return [{ ...pattern, pair_count: Math.max(1, Math.round(pattern.pair_count * Math.exp(-age / 90))) }];
      });
      setRoomAffinity(recentPatterns.length >= 3 ? buildAffinityMap(recentPatterns) : undefined);
      const { data: learningProfile } = await (supabase as any)
        .from('housekeeping_assignment_learning_profiles')
        .select('sample_count,correction_count,staff_preferences')
        .eq('organization_slug', profile.organization_slug)
        .eq('hotel_id', profile.assigned_hotel)
        .maybeSingle();
      const samples = Math.max(0, Number(learningProfile?.sample_count) || 0);
      setHistoricalSampleCount(samples);
      const validStaffIds = new Set(staffList.map(staff => staff.id));
      const localPrefs = sanitizeStaffPreferences(learningProfile?.staff_preferences);
      setHistoricalPreferences(samples >= 5
        ? Object.fromEntries(Object.entries(localPrefs).filter(([id]) => validStaffIds.has(id))) : {});
    } catch (error) {
      console.error('[AutoRoomAssignment] fetch failed:', error);
      toast.error(isGozsdu && error instanceof Error
        ? `Gozsdu PMS could not be verified. Refresh Previo and retry: ${error.message}`
        : t('autoAssign.failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;

    setSelectedRoomForMove(null);
    setBulkSelectedRoomIds(new Set());
    setBulkDestinationStaffId('');
    setShowOverAllocationDialog(false);
    setPublicAreaAssignments(new Map());
    setPreviewHistory([]);
    setLockHistory([]);
    setPlanningExplanation('');

    let restored = false;
    try {
      // Live Gozsdu PMS changes during the shift: never resurrect an older
      // local 48-room snapshot when today's authoritative workload is 35.
      // Keep other hotels' existing draft restoration unchanged.
      if (isGozsdu) localStorage.removeItem(saveKey);
      const saved = isGozsdu ? null : localStorage.getItem(saveKey);
      if (saved) {
        const data: SavedState = JSON.parse(saved);
        if (Date.now() - data.savedAt < 12 * 60 * 60 * 1000 && data.previews?.length > 0) {
          restored = true;
          setSelectedStaffIds(new Set(data.staffIds || []));
          setAssignmentPreviews(data.previews);
          setFairnessMetrics(computeFairnessMetrics(data.previews));
          setExcludedRoomIds(new Set(data.excludedRoomIds || []));
          setMaintenanceHoldRoomIds(new Set(data.maintenanceHoldRoomIds || []));
          setRestoredFromSave(true);
          setLockedRoomIds(new Set(data.lockedRoomIds || []));
          setStep('preview');
        } else {
          localStorage.removeItem(saveKey);
        }
      }
    } catch {
      localStorage.removeItem(saveKey);
    }

    if (!restored) {
      setExcludedRoomIds(new Set());
      setMaintenanceHoldRoomIds(new Set());
      setRestoredFromSave(false);
    }
    draftRestoredRef.current = restored;
    void fetchData(restored);
  }, [open, selectedDate]);

  // Done in the Laundryner picker invalidates only this board's unconfirmed
  // suggestion. Do not change its React key, unmount the modal or refetch PMS.
  useEffect(() => {
    if (!open || !isGozsdu || laundryCommitRef.current === laundryDutyCommitRevision) return;
    laundryCommitRef.current = laundryDutyCommitRevision;
    setSelectedStaffIds(previous => new Set([...previous].filter(id => !isLaundryner(id))));
    setAssignmentPreviews([]);
    setFairnessMetrics(null);
    setPreviewHistory([]);
    setLockHistory([]);
    setLockedRoomIds(new Set());
    setSectionTaskOwners(new Map());
    setSharedByRoom(new Map());
    setSuggestedByRoom(new Map());
    setSelectedRoomForMove(null);
    setBulkSelectedRoomIds(new Set());
    setBulkDestinationStaffId('');
    setStep('select-staff');
  }, [open, isGozsdu, laundryDutyCommitRevision, laundryDutyIds]);

  useEffect(() => {
    if (!open || isGozsdu) return;
    if (selectedStaffIds.size === 0 && assignmentPreviews.length === 0) return;
    const data: SavedState = {
      staffIds: Array.from(selectedStaffIds),
      previews: assignmentPreviews,
      excludedRoomIds: Array.from(excludedRoomIds),
      maintenanceHoldRoomIds: Array.from(maintenanceHoldRoomIds),
      savedAt: Date.now(),
      lockedRoomIds: Array.from(lockedRoomIds),
    };
    try {
      localStorage.setItem(saveKey, JSON.stringify(data));
    } catch {
      // Browser storage is best-effort only.
    }
  }, [open, saveKey, isGozsdu, selectedStaffIds, assignmentPreviews, excludedRoomIds, maintenanceHoldRoomIds, lockedRoomIds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && step === 'preview') {
        if (previewHistory.length > 0) {
          event.preventDefault();
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step, previewHistory, lockHistory]);

  const pushHistory = (previews: AssignmentPreview[]) => {
    setPreviewHistory(history => [...history.slice(-19), previews]);
    setLockHistory(history => [...history.slice(-19), new Set(lockedRoomIds)]);
  };

  const handleUndo = () => {
    if (previewHistory.length === 0) return;
    const previous = previewHistory[previewHistory.length - 1];
    const restoredRoomIds = new Set(previous.flatMap(preview => preview.rooms.map(room => room.id)));
    setPreviewHistory(history => history.slice(0, -1));
    setLockedRoomIds(lockHistory[lockHistory.length - 1] || new Set());
    setLockHistory(history => history.slice(0, -1));
    setAssignmentPreviews(previous);
    setFairnessMetrics(computeFairnessMetrics(previous));
    setMaintenanceHoldRoomIds(ids => new Set(Array.from(ids).filter(id => !restoredRoomIds.has(id))));
    setExcludedRoomIds(ids => new Set(Array.from(ids).filter(id => !restoredRoomIds.has(id))));
    setSelectedRoomForMove(null);
    setBulkSelectedRoomIds(new Set());
    toast.success(t('autoAssign.undoSuccess'));
  };

  const handleClearSaved = () => {
    localStorage.removeItem(saveKey);
    setRestoredFromSave(false);
    setExcludedRoomIds(new Set());
    setMaintenanceHoldRoomIds(new Set());
    setLockedRoomIds(new Set());
    setSelectedRoomForMove(null);
    setBulkSelectedRoomIds(new Set());
    setBulkDestinationStaffId('');
    void fetchData(false);
  };

  const toggleStaffSelection = (staffId: string) => {
    if (isLaundryner(staffId)) {
      toast.info('This employee is on Laundryner duty. Remove that duty first to assign cleaning rooms.');
      return;
    }
    setSelectedStaffIds(previous => {
      const next = new Set(previous);
      if (next.has(staffId)) next.delete(staffId);
      else next.add(staffId);
      return next;
    });
  };

  const toggleRoomExclusion = (roomId: string) => {
    setExcludedRoomIds(previous => {
      const next = new Set(previous);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  };

  const handleGeneratePreview = async () => {
    const selectedStaff = allStaff.filter(staff => cleaningStaffIds.has(staff.id));
    const roomsToAssign = effectiveRooms;
    if (selectedStaff.length === 0 || roomsToAssign.length === 0) {
      if (isGozsdu) toast.warning(selectedStaff.length === 0
        ? 'Select at least one cleaning housekeeper. Laundryners cannot receive rooms.'
        : 'There are no eligible rooms to assign. Refresh PMS or check exclusions.');
      return;
    }

    const hotelName = managerHotelRef.current || await getManagerHotel();
    let hotelConfig: HotelAssignmentConfig = { hotelName: hotelName || undefined };

    try {
      const { data: configData } = await supabase
        .from('hotel_configurations')
        .select('settings')
        .eq('hotel_name', hotelName || '')
        .maybeSingle();
      const settings = (configData?.settings as any) || {};
      if (settings.wing_zone_mapping) hotelConfig.wingZoneMapping = settings.wing_zone_mapping;

      hotelConfig.staffPreferences = historicalPreferences;
    } catch {
      // Smart settings are optional; assignment still works with algorithm defaults.
    }

    try {
      const searchKeys = hotelKeysRef.current.length ? hotelKeysRef.current : [hotelName || ''];
      const { data: profileRow } = await (supabase as any)
        .from('hotel_autoassign_profiles')
        .select('floor_grouping_weight, checkout_first')
        .in('hotel_id', searchKeys)
        .eq('organization_slug', profile?.organization_slug || '')
        .limit(1)
        .maybeSingle();
      if (profileRow?.floor_grouping_weight != null) {
        hotelConfig.floorPenaltyMultiplier = Number(profileRow.floor_grouping_weight);
      }
      if (profileRow?.checkout_first != null) {
        hotelConfig.checkoutFirstGrouping = !!profileRow.checkout_first;
      }
    } catch {
      // Per-hotel tuning is optional.
    }

    const scheduleRows = isNextDayPlanning ? tomorrowSchedules : [];
    const scheduleByStaff = new Map(scheduleRows.map((row: any) => [row.user_id, row]));
    if (isNextDayPlanning && scheduleRows.length && selectedStaff.some(staff => {
      const row = scheduleByStaff.get(staff.id) as any;
      return !row || ['off', 'leave', 'sick', 'absent', 'cancelled'].includes(row.status);
    })) {
      toast.error('Some selected employees have no active shift on this date. Update their schedule or remove them before regenerating.');
      return;
    }
    const toMinutes = (value: unknown): number | null => {
      if (typeof value !== 'string' || !/^\d{2}:\d{2}/.test(value)) return null;
      const [hours, minutes] = value.split(':').map(Number);
      return hours * 60 + minutes;
    };
    const shiftMinutes = new Map<string, number>();
    if (isNextDayPlanning) for (const staff of selectedStaff) {
      const schedule = scheduleByStaff.get(staff.id) as any;
      if (!schedule) continue;
      const start = toMinutes(schedule.shift_start);
      const end = toMinutes(schedule.shift_end);
      if (start !== null && end !== null) shiftMinutes.set(staff.id, (end - start + 1440) % 1440 || 1440);
    }
    const fixedAreaOwners = new Map(sectionTaskOwners);
    lockedSectionTasks.forEach((value, taskId) => {
      if (value.status !== 'assigned' && value.assignedTo) fixedAreaOwners.set(taskId, value.assignedTo);
    });
    // A room can enter progress after the board opened. Always reload its
    // live ownership before suggesting any rearrangement; manager unlocks must
    // never override an active in-progress or DND retry assignment.
    const inProgressRoomIds = new Set<string>();
    if (!isNextDayPlanning && roomsToAssign.length) {
      const { data: currentWork, error: currentWorkError } = await supabase
        .from('room_assignments')
        .select('room_id,assigned_to,status')
        .eq('assignment_date', selectedDate)
        .in('room_id', roomsToAssign.map(room => room.id));
      if (currentWorkError) {
        toast.error('Cannot verify current room ownership. Refresh before regenerating.');
        return;
      }
      const previewOwners = new Map(assignmentPreviews.flatMap(person =>
        person.rooms.map(room => [room.id, person.staffId] as const)));
      for (const row of currentWork || []) {
        if (row.status !== 'in_progress' && row.status !== 'dnd_pending_retry') continue;
        if (previewOwners.get(row.room_id) !== row.assigned_to) {
          toast.error('An in-progress room changed since the preview. Refresh before regenerating.');
          return;
        }
        inProgressRoomIds.add(row.room_id);
      }
    }
    const enforcedLocks = new Set([...lockedRoomIds, ...inProgressRoomIds]);
    hotelConfig.staffPreferences = historicalPreferences;
    const result = generateSmartHousekeepingPlan({
      rooms: roomsToAssign,
      staff: selectedStaff,
      organizationSlug: profile?.organization_slug || '',
      hotelId: profile?.assigned_hotel || '',
      hotelConfig,
      goal: planningGoal,
      previous: assignmentPreviews.length ? assignmentPreviews : undefined,
      lockedRoomIds: enforcedLocks,
      shiftMinutes,
      publicAreaTemplates: sectionTaskTemplates,
      fixedAreaOwners,
      wingProximity,
      affinity: roomAffinity,
      historicalSampleCount,
      gozsdu: isGozsdu,
      seed: Date.now(),
    });
    setPlanningExplanation(result.reason);
    if (!result.changed || !result.plan) {
      if (result.plan) toast.info(result.reason);
      else toast.error(result.reason);
      return;
    }
    const previews = result.plan;
    if (isGozsdu && !gozsduPreviewCoversWork(previews, roomsToAssign.length, cleaningStaffIds, isLaundryner)) {
      toast.error('Allocation incomplete: check building routes, unavailable rooms and staffing.');
      return;
    }
    pushHistory(assignmentPreviews);
    setAssignmentPreviews(previews);
    if (isNextDayPlanning) {
      setSuggestedByRoom(new Map(previews.flatMap(preview =>
        preview.rooms.map(room => [room.id, preview.staffId] as [string, string]),
      )));
      setSharedByRoom(new Map());
    }
    setFairnessMetrics(computeFairnessMetrics(previews));
    setSelectedRoomForMove(null);
    setBulkSelectedRoomIds(new Set());
    setBulkDestinationStaffId('');
    setStep('preview');
  };

  const applyRoomMove = (roomId: string, fromStaffId: string, toStaffId: string) => {
    if (!roomId || !fromStaffId || !toStaffId || fromStaffId === toStaffId) return;
    // Building restrictions apply to automatic proposals. A deliberate manual
    // move may override the route only for a verified manager role.
    const managerOverride = isGozsdu && hasManagerPowers(profile?.role);
    const next = moveRoom(assignmentPreviews, roomId, fromStaffId, toStaffId, managerOverride);
    if (isGozsdu && next === assignmentPreviews) {
      toast.warning(isLaundryner(toStaffId)
        ? 'Laundryners cannot receive cleaning rooms.'
        : 'These buildings cannot be combined automatically. Only managers can override manually.');
      return;
    }
    if (managerOverride && !gozsduAllocationRespectsBuildings(next)) {
      toast.info('Manager override: this housekeeper now has rooms across mapped buildings. Automatic allocation rules remain unchanged.');
    }
    pushHistory(assignmentPreviews);
    setLockedRoomIds(previous => new Set([...previous, roomId]));
    setAssignmentPreviews(next);
    if (isNextDayPlanning && sharedByRoom.get(roomId) === toStaffId) {
      setSharedByRoom(previous => {
        const updated = new Map(previous);
        updated.delete(roomId);
        return updated;
      });
    }
    setFairnessMetrics(computeFairnessMetrics(next));
    setSelectedRoomForMove(null);
    setBulkSelectedRoomIds(previous => {
      if (!previous.has(roomId)) return previous;
      const nextSelection = new Set(previous);
      nextSelection.delete(roomId);
      return nextSelection;
    });
    setJustDroppedRoomId(roomId);
    setJustDroppedStaffId(toStaffId);
    setTimeout(() => {
      setJustDroppedRoomId(null);
      setJustDroppedStaffId(null);
    }, 650);
  };

  const handleBulkRoomMove = () => {
    if (!bulkDestinationStaffId || !cleaningStaffIds.has(bulkDestinationStaffId) || isLaundryner(bulkDestinationStaffId)) {
      toast.warning('Choose an eligible housekeeper from this hotel. Laundryners cannot receive rooms.');
      return;
    }
    const managerOverride = isGozsdu && hasManagerPowers(profile?.role);
    const result = moveSelectedRooms(
      assignmentPreviews, [...bulkSelectedRoomIds], bulkDestinationStaffId,
      { allowGozsduManagerOverride: managerOverride, destinationIsLaundryner: isLaundryner(bulkDestinationStaffId) },
    );
    if (result.error) {
      toast.warning(result.error === 'restricted_move'
        ? 'One or more selected rooms cannot be moved under the building rules. Nothing was changed.'
        : result.error === 'nothing_to_move'
          ? 'All selected rooms are already with this housekeeper. Choose other rooms.'
          : 'The selection or housekeeper has changed. Review the rooms and try again. Nothing was moved.');
      return;
    }
    if (managerOverride && !gozsduAllocationRespectsBuildings(result.previews)) {
      toast.info('Manager override: the selected rooms cross mapped buildings. Automatic allocation rules remain unchanged.');
    }
    pushHistory(assignmentPreviews); // one Undo restores the whole bulk action
    setLockedRoomIds(previous => new Set([...previous, ...result.movedRoomIds]));
    setAssignmentPreviews(result.previews);
    setFairnessMetrics(computeFairnessMetrics(result.previews));
    if (isNextDayPlanning) {
      setSharedByRoom(previous => {
        const updated = new Map(previous);
        result.movedRoomIds.forEach(id => {
          if (updated.get(id) === bulkDestinationStaffId) updated.delete(id);
        });
        return updated;
      });
    }
    setBulkSelectedRoomIds(new Set());
    setBulkDestinationStaffId('');
    setSelectedRoomForMove(null);
    toast.success(`${result.movedRoomIds.length} rooms moved in the preview. Confirm the plan to save.`);
  };

  const removeRoomFromPreview = (roomId: string, fromStaffId: string, markExcluded: boolean = true) => {
    pushHistory(assignmentPreviews);
    setLockedRoomIds(previous => new Set([...previous].filter(id => id !== roomId)));
    const next = assignmentPreviews.map(preview => {
      if (preview.staffId !== fromStaffId) return preview;
      return buildPreview(preview.staffId, preview.staffName, preview.rooms.filter(room => room.id !== roomId));
    });
    setAssignmentPreviews(next);
    setFairnessMetrics(computeFairnessMetrics(next));
    if (markExcluded) {
      setExcludedRoomIds(previous => new Set([...Array.from(previous), roomId]));
    }
    if (isNextDayPlanning) {
      setSharedByRoom(previous => {
        const updated = new Map(previous);
        updated.delete(roomId);
        return updated;
      });
    }
    setSelectedRoomForMove(null);
    setBulkSelectedRoomIds(previous => {
      if (!previous.has(roomId)) return previous;
      const updated = new Set(previous);
      updated.delete(roomId);
      return updated;
    });
  };

  const stageMaintenanceHold = (room: RoomForAssignment, fromStaffId: string) => {
    setMaintenanceHoldRoomIds(previous => new Set([...Array.from(previous), room.id]));
    removeRoomFromPreview(room.id, fromStaffId, true);
    toast.info(isNextDayPlanning
      ? `Room ${room.room_number} will be excluded from tomorrow’s housekeeping plan as a planned maintenance hold.`
      : `Room ${room.room_number} will be put on maintenance hold when you confirm.`);
  };

  const getDropStaffAtPoint = (x: number, y: number, fromStaffId: string): string | null => {
    for (const element of document.elementsFromPoint(x, y)) {
      const target = (element as HTMLElement).closest<HTMLElement>('[data-staff-drop-id]');
      const staffId = target?.dataset.staffDropId;
      if (staffId && staffId !== fromStaffId) return staffId;
    }
    return null;
  };

  /** Move one public-area task to another housekeeper (blocked once started). */
  const movePublicAreaTask = (taskId: string, toStaffId: string) => {
    const task = sectionTasks.find(item => item.id === taskId);
    if (!task) return;
    if (task.lockedStatus) {
      toast.warning(
        task.lockedStatus === 'completed'
          ? `${task.task_name} is already finished and cannot be moved.`
          : `${task.task_name} is already being worked on by ${task.staff_name}. It cannot be reassigned now.`
      );
      return;
    }
    if (task.staff_id === toStaffId) return;
    setSectionTaskOwners(previous => new Map(previous).set(taskId, toStaffId));
    setJustDroppedStaffId(toStaffId);
    setTimeout(() => setJustDroppedStaffId(current => current === toStaffId ? null : current), 650);
    const toName = assignmentPreviews.find(p => p.staffId === toStaffId)?.staffName || 'housekeeper';
    toast.success(`${task.task_name} → ${toName}`);
  };

  /** Redistribute only the movable public-area tasks across the busiest-last staff. */
  const shufflePublicAreas = () => {
    const eligible = assignmentPreviews.filter(preview => cleaningStaffIds.has(preview.staffId));
    if (eligible.length === 0) return;
    const movable = sectionTasks.filter(task => !task.lockedStatus);
    if (movable.length === 0) {
      toast.info('No public areas can be moved right now.');
      return;
    }

    // Start from the room workload plus the minutes already pinned by locked tasks.
    const load = new Map(eligible.map(preview => [preview.staffId, preview.totalWithBreak]));
    for (const task of sectionTasks) {
      if (!task.lockedStatus) continue;
      load.set(task.staff_id, (load.get(task.staff_id) || 0) + task.estimated_duration);
    }

    const next = new Map(sectionTaskOwners);
    for (const task of [...movable].sort((a, b) => b.estimated_duration - a.estimated_duration)) {
      const owner = eligible
        .slice()
        .sort((a, b) =>
          (load.get(a.staffId) || 0) - (load.get(b.staffId) || 0)
          || a.staffName.localeCompare(b.staffName)
        )[0];
      next.set(task.id, owner.staffId);
      load.set(owner.staffId, (load.get(owner.staffId) || 0) + task.estimated_duration);
    }
    setSectionTaskOwners(next);
    toast.success(`Shuffled ${movable.length} public area${movable.length === 1 ? '' : 's'}.`);
  };

  const handleProceedToConfirm = () => {
    if (isGozsdu && (!gozsduCanReviewAssignment(assignmentPreviews, cleaningStaffIds, isLaundryner)
      || (!hasManagerPowers(profile?.role) && !gozsduAllocationRespectsBuildings(assignmentPreviews)))) {
      toast.error('No valid cleaning allocation to confirm. Select a cleaning housekeeper and regenerate.');
      setStep('select-staff');
      return;
    }
    const overAllocated = assignmentPreviews
      .filter(preview => staffIdsWithWork.has(preview.staffId))
      .map(preview => {
        const totalWithAreas = preview.totalWithBreak
          + sectionTaskMinutesForStaff(sectionTasks, preview.staffId);
        return {
          ...preview,
          totalWithBreak: totalWithAreas,
          exceedsShift: totalWithAreas > STANDARD_SHIFT_MINUTES,
          overageMinutes: Math.max(0, totalWithAreas - STANDARD_SHIFT_MINUTES),
        };
      })
      .filter(preview => preview.exceedsShift);
    if (overAllocated.length > 0) {
      setOverAllocatedStaff(overAllocated);
      setShowOverAllocationDialog(true);
      return;
    }
    setStep('confirm');
  };

  const persistAssignmentPatterns = async () => {
    if (!profile?.organization_slug || editingExistingAssignments) return;
    const hotelName = managerHotelRef.current;
    if (!hotelName) return;
    const calls: PromiseLike<any>[] = [];
    for (const preview of assignmentPreviews) {
      const numbers = preview.rooms.map(room => room.room_number);
      for (let i = 0; i < numbers.length; i++) {
        for (let j = i + 1; j < numbers.length; j++) {
          const [a, b] = numbers[i] < numbers[j] ? [numbers[i], numbers[j]] : [numbers[j], numbers[i]];
          calls.push(supabase.rpc('upsert_assignment_pattern' as any, {
            p_hotel: hotelName,
            p_room_a: a,
            p_room_b: b,
            p_org_slug: profile.organization_slug,
          }));
        }
      }
    }
    if (calls.length) void Promise.allSettled(calls);
  };

  const persistAutomaticSectionTasks = async (): Promise<number> => {
    if (sectionTasks.length === 0) return 0;
    const hotelName = managerHotelRef.current || await getManagerHotel();
    if (!hotelName) throw new Error('Hotel could not be resolved for mapped area work');

    const { data, error } = await (supabase as any).rpc('assign_housekeeping_section_tasks', {
      p_hotel_name: hotelName,
      p_assigned_date: selectedDate,
      p_assignments: sectionTasks
        .filter(task => !task.lockedStatus)
        .map(task => ({
          section_task_id: task.id,
          assigned_to: task.staff_id,
        })),
    });
    if (error) throw error;
    return Number(data || 0);
  };

  const handleConfirmAssignment = async () => {
    if (!user || !profile?.organization_slug) return;
    if (isGozsdu && (!gozsduCanReviewAssignment(assignmentPreviews, cleaningStaffIds, isLaundryner)
      || (!hasManagerPowers(profile?.role) && !gozsduAllocationRespectsBuildings(assignmentPreviews))
      || sectionTasks.some(task => isLaundryner(task.staff_id)))) {
      toast.error('The allocation is empty or conflicts with Laundryner duty. Regenerate before saving.');
      setStep('select-staff');
      return;
    }
    if (isNextDayPlanning) {
      setStep('public-areas');
      return;
    }
    setSubmitting(true);
    try {
      const finalEntries = assignmentPreviews.flatMap(preview => preview.rooms
        .filter(room => !maintenanceHoldRoomIds.has(room.id))
        .map(room => ({ room, staffId: preview.staffId })));
      const finalIds = new Set(finalEntries.map(entry => entry.room.id));
      const initialIds = new Set(existingAssignmentsRef.current.keys());
      const scopeIds = Array.from(new Set([
        ...Array.from(initialIds),
        ...Array.from(finalIds),
        ...Array.from(maintenanceHoldRoomIds),
      ]));

      let currentRows: ExistingAssignment[] = [];
      if (scopeIds.length > 0) {
        const { data, error } = await supabase
          .from('room_assignments')
          .select('id, room_id, assigned_to, assignment_type, status, priority, ready_to_clean, pms_hold, pms_hold_reason')
          .eq('assignment_date', selectedDate)
          .in('room_id', scopeIds);
        if (error) throw error;
        currentRows = (data || []) as ExistingAssignment[];
      }
      const currentByRoom = new Map(currentRows.map(row => [row.room_id, row]));

      // Stage-specific maintenance hold: only the selected room is changed.
      // Reservation/PMS data and all other room statuses remain untouched.
      for (const roomId of maintenanceHoldRoomIds) {
        const room = dirtyRooms.find(candidate => candidate.id === roomId);
        if (!room) continue;
        const metadata = (room.pms_metadata as any) || {};
        const previousStatus = room.status === 'out_of_order'
          ? metadata.manualHousekeepingHoldPreviousStatus || 'dirty'
          : room.status || 'dirty';
        const { error } = await supabase
          .from('rooms')
          .update({
            status: 'out_of_order',
            pms_metadata: {
              ...metadata,
              manualHousekeepingHold: true,
              manualHousekeepingHoldAt: new Date().toISOString(),
              manualHousekeepingHoldBy: profile?.full_name || user.id,
              manualHousekeepingHoldPreviousStatus: previousStatus,
              manualHousekeepingHoldReason: 'Maintenance hold from Auto Room Assignment',
            },
          } as any)
          .eq('id', roomId);
        if (error) throw error;
      }

      // Delta-only save. Unchanged assignments are not written. A moved room
      // updates only assigned_to/assigned_by via the shared safe helper, which
      // preserves ready_to_clean, PMS hold, notes, progress and timestamps.
      for (const { room, staffId } of finalEntries) {
        const current = currentByRoom.get(room.id);
        if (current?.assigned_to === staffId) continue;
        const checkout = isCheckoutLike(room);
        await assignRoomToStaff({
          roomId: room.id,
          staffId,
          assignmentDate: selectedDate,
          assignedBy: user.id,
          organizationSlug: profile.organization_slug,
          isCheckoutRoom: checkout,
          readyToClean: checkout ? (room.ready_to_clean === true || isPmsRtcToday(room.pms_metadata as any)) : true,
          priority: checkout ? 1 : 2,
        });
      }

      // Only rooms that were part of the manager's original editable board can
      // be removed. This prevents a save from deleting unrelated assignments.
      for (const roomId of initialIds) {
        if (!finalIds.has(roomId) && currentByRoom.has(roomId)) {
          await unassignRoom(roomId, selectedDate);
        }
      }
      // A maintenance hold on a newly-current assignment must also release the
      // cleaner, but again only for that explicit room.
      for (const roomId of maintenanceHoldRoomIds) {
        if (!initialIds.has(roomId) && currentByRoom.has(roomId)) {
          await unassignRoom(roomId, selectedDate);
        }
      }

      const mappedTaskCount = await persistAutomaticSectionTasks();

      localStorage.removeItem(saveKey);
      await persistAssignmentPatterns();
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));

      const totalRooms = finalEntries.length;
      const staffCount = staffIdsWithWork.size;
      onAssignmentCreated(totalRooms, staffCount);

      if (editingExistingAssignments) {
        toast.success(`Assignments updated: ${totalRooms} rooms and ${mappedTaskCount} mapped area tasks.`);
        setMaintenanceHoldRoomIds(new Set());
        onOpenChange(false);
      } else {
        toast.success(`${t('autoAssign.assigned')} ${totalRooms} ${t('autoAssign.roomsTo')} ${staffCount} ${t('autoAssign.housekeepers')} · ${mappedTaskCount} mapped area tasks`);
        setStep('public-areas');
      }
    } catch (error) {
      console.error('[AutoRoomAssignment] save failed:', error);
      toast.error(t('autoAssign.failedToAssign'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignPublicAreas = async () => {
    if (isNextDayPlanning) {
      if (!user || !profile?.organization_slug || !profile.assigned_hotel || !nextDayPmsSyncedAt) {
        toast.error('Tomorrow PMS data is missing. Close and reopen Auto Assign to refresh it.');
        return;
      }
      setSubmitting(true);
      try {
        const scheduleByUser = new Map(tomorrowSchedules.map((row: any) => [row.user_id, row]));
        const manualAreaTasks = Array.from(publicAreaAssignments.entries()).flatMap(([areaKey, staffId]) => {
          const area = PUBLIC_AREAS.find(candidate => candidate.key === areaKey);
          return area ? [{ key: area.key, name: area.name, assignedTo: staffId }] : [];
        });
        const saved = await saveApprovedNextDayAutoAssignPlan({
          userId: user.id,
          organizationSlug: profile.organization_slug,
          hotelId: profile.assigned_hotel,
          hotelName: managerHotelRef.current || profile.assigned_hotel,
          selectedDate,
          pmsSyncedAt: nextDayPmsSyncedAt,
          previews: assignmentPreviews,
          selectedStaffIds: Array.from(cleaningStaffIds),
          scheduleByUser,
          excludedRoomIds: Array.from(excludedRoomIds),
          maintenanceHoldRoomIds: Array.from(maintenanceHoldRoomIds),
          autoRelease,
          existingPlan: nextDayPlan,
          suggestedByRoom,
          sharedByRoom,
          mappedAreaTasks: sectionTasks.map(task => ({
            id: task.id,
            task_name: task.task_name,
            staff_id: task.staff_id,
            section_id: task.section_id,
            estimated_duration: task.estimated_duration,
            sort_order: task.sort_order,
          })),
          manualAreaTasks,
        });
        localStorage.removeItem(saveKey);
        window.dispatchEvent(new CustomEvent('hk-next-day-plan-changed', {
          detail: { hotelId: profile.assigned_hotel, planDate: selectedDate, planId: saved.planId },
        }));
        onAssignmentCreated(saved.roomCount, cleaningStaffIds.size);
        toast.success(`Tomorrow’s plan approved: ${saved.roomCount} rooms · ${saved.areaCount} public-area tasks · release ${autoRelease ? '08:00' : 'held'}.`);
        onOpenChange(false);
      } catch (error) {
        console.error('[AutoRoomAssignment] tomorrow plan save failed:', error);
        toast.error(error instanceof Error ? error.message : 'Could not approve tomorrow’s plan.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (publicAreaAssignments.size === 0 || !user) {
      onOpenChange(false);
      return;
    }
    if (!profile?.organization_slug) return;

    setSubmitting(true);
    try {
      const hotelName = managerHotelRef.current || await getManagerHotel();
      const tasks = Array.from(publicAreaAssignments.entries()).map(([areaKey, staffId]) => {
        const area = PUBLIC_AREAS.find(candidate => candidate.key === areaKey)!;
        return {
          task_name: area.name,
          task_description: area.name,
          task_type: areaKey,
          assigned_to: staffId,
          assigned_by: user.id,
          assigned_date: getLocalDateString(),
          hotel: hotelName || '',
          priority: 1,
          status: 'assigned',
          organization_slug: profile.organization_slug,
        };
      });
      const { error } = await supabase.from('general_tasks').insert(tasks as any);
      if (error) throw error;
      onAssignmentCreated(tasks.length, 0);
      toast.success(`${t('autoAssign.assigned')} ${tasks.length} ${t('autoAssign.publicAreas')}`);
      onOpenChange(false);
    } catch (error) {
      console.error('[AutoRoomAssignment] public areas failed:', error);
      toast.error(t('autoAssign.failedToAssignAreas'));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrintAssignments = () => {
    const active = assignmentPreviews.filter(preview => staffIdsWithWork.has(preview.staffId));
    if (!active.length) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return toast.error(t('autoAssign.popupBlocked'));
    const body = active.map(preview => {
      const mappedTasks = sectionTasks.filter(task => task.staff_id === preview.staffId);
      const totalMinutes = preview.totalWithBreak + sectionTaskMinutesForStaff(sectionTasks, preview.staffId);
      return `
      <section style="page-break-after:always;font-family:Arial;padding:20px">
        <h2>${preview.staffName}</h2>
        <p>${selectedDate} · ${preview.rooms.length} rooms · ${mappedTasks.length} mapped areas · ${formatMinutesToTime(totalMinutes)}</p>
        <table style="width:100%;border-collapse:collapse">
          <tr><th style="border:1px solid #ddd;padding:6px">Room</th><th style="border:1px solid #ddd;padding:6px">Type</th><th style="border:1px solid #ddd;padding:6px">${isGozsdu ? 'Building' : 'Floor'}</th><th style="border:1px solid #ddd;padding:6px">Special</th></tr>
          ${sortPreviewRooms(preview.rooms).map(room => {
            const special = [
              !isPotentialCheckoutRoom(room) && (room.ready_to_clean || isPmsRtcToday(room.pms_metadata as any)) ? 'RTC' : '',
              isPotentialCheckoutRoom(room) ? 'Currently unbooked' : '',
              needsTowelChange(room) ? 'Towel' : '',
              needsLinenChange(room) ? 'Clean Room' : '',
              room.bed_configuration ? `Bed: ${room.bed_configuration}` : '',
            ].filter(Boolean).join(', ');
            const type = isPotentialCheckoutRoom(room) ? 'Potential checkout' : isCheckoutLike(room) ? 'Checkout' : 'Daily';
            return `<tr><td style="border:1px solid #ddd;padding:6px"><b>${roomDisplayName(room)}</b></td><td style="border:1px solid #ddd;padding:6px">${type}</td><td style="border:1px solid #ddd;padding:6px">${isGozsdu ? room.housekeeping_section_name || 'Unmapped building' : `F${room.floor_number ?? getFloorFromRoomNumber(room.room_number)}`}</td><td style="border:1px solid #ddd;padding:6px">${special || '—'}</td></tr>`;
          }).join('')}
        </table>
        ${mappedTasks.length ? `<h3 style="margin-top:20px">Mapped area work</h3><ul>${mappedTasks.map(task => `<li>${task.icon} <b>${task.task_name}</b> — ${task.section_name} (${task.estimated_duration} min)</li>`).join('')}</ul>` : ''}
      </section>`;
    }).join('');
    printWindow.document.write(`<!doctype html><html><head><title>Housekeeping ${selectedDate}</title></head><body>${body}</body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
  };

  const getCategoryShortName = (category: string): string => {
    const lower = category.toLowerCase();
    if (lower.includes('single')) return 'Sgl';
    if (lower.includes('triple')) return 'Trpl';
    if (lower.includes('quad')) return 'Quad';
    if (lower.includes('queen')) return 'Queen';
    if (lower.includes('double or twin') || lower.includes('twin or double')) return 'DB/TW';
    if (lower.includes('double')) return 'Dbl';
    if (lower.includes('twin')) return 'Twin';
    if (lower.includes('suite')) return 'Suite';
    if (lower.includes('economy')) return 'Eco';
    if (lower.includes('comfort')) return 'Comf';
    if (lower.includes('deluxe')) return 'Dlx';
    return category.substring(0, 4);
  };

  const roomDisplayName = (room: RoomForAssignment): string =>
    isGozsdu ? (room.pms_metadata?.gozsduAvailability?.pmsRoomName || room.room_number) : room.room_number;

  const groupByFloor = (rooms: RoomForAssignment[]) => {
    if (isGozsdu) {
      const mapped = new Map<string, RoomForAssignment[]>();
      for (const room of rooms) {
        const building = room.housekeeping_section_name || 'Unmapped building';
        if (!mapped.has(building)) mapped.set(building, []);
        mapped.get(building)!.push(room);
      }
      return Array.from(mapped.entries()).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
        .map(([floor, group]) => ({ floor, rooms: sortPreviewRooms(group) }));
    }
    const map = new Map<number, RoomForAssignment[]>();
    for (const room of rooms) {
      const floor = room.floor_number ?? getFloorFromRoomNumber(room.room_number);
      if (!map.has(floor)) map.set(floor, []);
      map.get(floor)!.push(room);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([floor, floorRooms]) => ({ floor: String(floor), rooms: sortPreviewRooms(floorRooms) }));
  };

  const renderRoomChip = (room: RoomForAssignment, preview: AssignmentPreview) => {
    const selected = selectedRoomForMove?.roomId === room.id;
    const checkedForBulk = bulkSelectedRoomIds.has(room.id);
    const potentialCheckout = isPotentialCheckoutRoom(room);
    const checkout = isCheckoutLike(room);
    const rtc = !potentialCheckout && checkout && (room.ready_to_clean === true || isPmsRtcToday(room.pms_metadata as any));
    const held = room.status === 'out_of_order';
    const color = held
      ? 'bg-red-100 text-red-900 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-200'
      : potentialCheckout
        ? 'bg-violet-100 text-violet-900 hover:bg-violet-200 dark:bg-violet-900/35 dark:text-violet-200'
        : checkout
          ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300'
          : 'bg-blue-100 text-blue-900 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300';

    return (
      <motion.div
        key={room.id}
        layout
        drag
        dragMomentum={false}
        dragElastic={0.16}
        dragSnapToOrigin
        whileDrag={{ scale: 1.08, zIndex: 80, boxShadow: '0 12px 30px rgba(15,23,42,.24)' }}
        onDragStart={() => {
          setDraggingRoomId(room.id);
          setSelectedRoomForMove(null);
        }}
        onDrag={(_, info) => setDragOverStaffId(getDropStaffAtPoint(info.point.x, info.point.y, preview.staffId))}
        onDragEnd={(_, info) => {
          const target = getDropStaffAtPoint(info.point.x, info.point.y, preview.staffId);
          setDraggingRoomId(null);
          setDragOverStaffId(null);
          if (target) applyRoomMove(room.id, preview.staffId, target);
        }}
        onTap={event => {
          event.stopPropagation();
          if (selectedRoomForMove && selectedRoomForMove.fromStaffId !== preview.staffId) {
            applyRoomMove(selectedRoomForMove.roomId, selectedRoomForMove.fromStaffId, preview.staffId);
            return;
          }
          setSelectedRoomForMove(selected ? null : { roomId: room.id, fromStaffId: preview.staffId });
        }}
        className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] leading-tight font-medium select-none touch-none cursor-grab active:cursor-grabbing ${color} ${
          selected ? 'ring-2 ring-primary ring-offset-1 scale-105' : checkedForBulk ? 'ring-2 ring-sky-500 ring-offset-1' : ''
        } ${draggingRoomId === room.id ? 'opacity-75' : ''} ${justDroppedRoomId === room.id ? 'ring-2 ring-green-500' : ''}`}
        title={`Room ${roomDisplayName(room)}${potentialCheckout ? ' · Potential checkout · currently unbooked' : ''}${rtc ? ' · Ready to clean' : ''}${held ? ' · Maintenance hold' : ''}`}
      >
        <button
          type="button"
          aria-label={`${checkedForBulk ? 'Deselect' : 'Select'} room ${roomDisplayName(room)} for bulk assignment`}
          aria-pressed={checkedForBulk}
          title={checkedForBulk ? 'Remove from bulk selection' : 'Select for bulk assignment'}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); toggleBulkRooms([room.id]); }}
          className={`mr-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 bg-background/90 ${checkedForBulk ? 'border-sky-600 bg-sky-600 text-white' : 'border-current/50 text-current'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
        >{checkedForBulk ? <Check className="h-3 w-3" /> : <span className="h-1 w-1 rounded-full bg-current opacity-30" />}</button>
        <span className="font-semibold">{roomDisplayName(room)}</span>
        {potentialCheckout && <span className="rounded bg-violet-700 px-1 text-[8px] font-extrabold text-white" title="Potential checkout · currently unbooked">POT</span>}
        {lockedRoomIds.has(room.id) && <button type="button" className="rounded border border-amber-500 px-1 text-[9px]" title="Manual assignment locked; tap to allow auto-regeneration" aria-label={'Unlock room ' + roomDisplayName(room)} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setLockedRoomIds(previous => new Set([...previous].filter(id => id !== room.id))); }}>🔒</button>}
        {rtc && <span className="rounded bg-green-600 px-0.5 text-[8px] font-extrabold text-white">RTC</span>}
        {held && <span className="rounded bg-red-600 px-0.5 text-[8px] font-extrabold text-white">HOLD</span>}
        {room.room_category && <span className="text-[9px] opacity-70">{getCategoryShortName(room.room_category)}</span>}
        {needsTowelChange(room) && <span className="text-[9px] font-bold text-blue-600">T</span>}
        {needsLinenChange(room) && <span className="text-[9px] font-bold text-orange-600">C</span>}
        {room.bed_configuration && <span className="text-[9px] opacity-70">🛏️{room.bed_configuration.slice(0, 6)}</span>}
      </motion.div>
    );
  };

  const renderPublicAreaChip = (task: (typeof sectionTasks)[number], ownerStaffId: string) => (
    <motion.div
      key={task.id}
      layout
      data-public-area-task-id={task.id}
      drag={!task.lockedStatus}
      dragMomentum={false}
      dragElastic={0.16}
      dragSnapToOrigin
      whileDrag={task.lockedStatus ? undefined : { scale: 1.08, zIndex: 80, boxShadow: '0 12px 30px rgba(15,23,42,.24)' }}
      onDragStart={() => {
        if (task.lockedStatus) return;
        setDraggingAreaTaskId(task.id);
        setSelectedRoomForMove(null);
      }}
      onDrag={(_, info) => {
        if (!task.lockedStatus) setDragOverStaffId(getDropStaffAtPoint(info.point.x, info.point.y, ownerStaffId));
      }}
      onDragEnd={(_, info) => {
        if (task.lockedStatus) return;
        const target = getDropStaffAtPoint(info.point.x, info.point.y, ownerStaffId);
        setDraggingAreaTaskId(null);
        setDragOverStaffId(null);
        if (target) movePublicAreaTask(task.id, target);
      }}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] leading-tight font-medium select-none touch-none border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200 ${
        task.lockedStatus
          ? 'cursor-not-allowed border-dashed opacity-70'
          : 'cursor-grab active:cursor-grabbing hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
      } ${draggingAreaTaskId === task.id ? 'opacity-75 ring-2 ring-primary' : ''}`}
      title={`${task.task_name} · ${task.section_name} · ${task.estimated_duration} min${task.lockedStatus ? ` · ${task.lockedStatus === 'completed' ? 'Done' : 'In progress'}` : ' · Drag to another housekeeper'}`}
    >
      <span aria-hidden>{task.icon || '🧹'}</span>
      <span className="font-semibold">{task.task_name}</span>
      <span className="text-[9px] opacity-60">{task.section_name}</span>
      {task.lockedStatus && (
        <span className="rounded border px-1 text-[8px] opacity-80">
          {task.lockedStatus === 'completed' ? 'Done' : 'Working'}
        </span>
      )}
    </motion.div>
  );

  // Read from the verified, date-scoped Gozsdu duty session, never a draft.
  const laundrynerStaff = isGozsdu ? allStaff.filter(staff => isLaundryner(staff.id)) : [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={`flex min-h-0 flex-col gap-2 p-3 sm:gap-4 sm:p-6 ${isGozsdu ? 'h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden sm:h-[min(92vh,900px)] sm:w-[95vw] sm:max-w-[95vw]' : `max-h-[92vh] ${step === 'preview' ? 'max-w-[100vw] sm:max-w-[95vw] w-full' : 'max-w-4xl'}`}`}>
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <Wand2 className="h-5 w-5" />
              {t('autoAssign.title')}
              {editingExistingAssignments && <Badge variant="outline" className="border-blue-300 text-blue-700">Editing current assignments</Badge>}
              {restoredFromSave && <Badge variant="outline" className="border-green-300 text-green-700">{t('autoAssign.restored')}</Badge>}
              <Badge variant="outline" className={isNextDayPlanning ? 'border-blue-300 text-blue-700' : 'border-emerald-300 text-emerald-700'}>{isNextDayPlanning ? `Tomorrow · 08:00 release` : '● Live'}</Badge>
            </DialogTitle>
          </DialogHeader>

          <div className={isGozsdu ? 'grid grid-cols-4 items-center gap-1 py-1 text-center sm:flex sm:flex-wrap sm:justify-center' : 'flex flex-wrap items-center justify-center gap-1.5 py-1'}>
            <Badge variant={step === 'select-staff' ? 'default' : 'secondary'} className="text-xs">1. {t('autoAssign.stepStaff')}</Badge>
            <ArrowRight className={`h-3 w-3 text-muted-foreground ${isGozsdu ? 'hidden sm:block' : ''}`} />
            <Badge variant={step === 'preview' ? 'default' : 'secondary'} className="text-xs">2. {t('autoAssign.stepPreview')}</Badge>
            <ArrowRight className={`h-3 w-3 text-muted-foreground ${isGozsdu ? 'hidden sm:block' : ''}`} />
            <Badge variant={step === 'confirm' ? 'default' : 'secondary'} className="text-xs">3. {t('autoAssign.stepConfirm')}</Badge>
            <ArrowRight className={`h-3 w-3 text-muted-foreground ${isGozsdu ? 'hidden sm:block' : ''}`} />
            <Badge variant={step === 'public-areas' ? 'default' : 'secondary'} className="text-xs">4. {t('autoAssign.stepPublicAreas')}</Badge>
          </div>

          {isGozsdu && !loading && step !== 'select-staff' && (
            <div data-testid="gozsdu-laundryner-progress-summary" role="status" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-emerald-300 bg-emerald-50/70 px-2.5 py-1.5 text-xs text-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100">
              <span className="inline-flex shrink-0 items-center gap-1 font-semibold"><Shirt className="h-3.5 w-3.5" />Laundryners ({laundrynerStaff.length})</span>
              {laundrynerStaff.length > 0
                ? laundrynerStaff.map(staff => <Badge key={staff.id} variant="outline" className="max-w-full border-emerald-400 bg-background text-[11px] text-emerald-800 dark:text-emerald-100"><Check className="mr-1 h-3 w-3 shrink-0" /><span className="truncate">{staff.nickname || staff.full_name}</span></Badge>)
                : <span>None selected</span>}
              <span className="text-[11px] text-muted-foreground">0 cleaning rooms · 0 public areas · Back to Staff to edit</span>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-1">
            {loading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : step === 'select-staff' ? (
              <div className="space-y-4">
                {isGozsdu && <div data-gozsdu-laundryner-slot className="min-w-0" />}
                <div className={`grid ${isNextDayPlanning ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'} gap-3 rounded-lg bg-muted p-3`}>
                  <div className="text-center"><p className="text-2xl font-bold">{effectiveRooms.length}</p><p className="text-xs text-muted-foreground">{t('autoAssign.totalRooms')}</p></div>
                  <div className="text-center"><p className="text-2xl font-bold text-amber-600">{effectiveRooms.filter(room => isCheckoutLike(room) && !isPotentialCheckoutRoom(room)).length}</p><p className="text-xs text-muted-foreground">{t('autoAssign.checkouts')}</p></div>
                  {isNextDayPlanning && <div className="text-center"><p className="text-2xl font-bold text-violet-600">{effectiveRooms.filter(isPotentialCheckoutRoom).length}</p><p className="text-xs text-muted-foreground">Potential</p></div>}
                  <div className="text-center"><p className="text-2xl font-bold text-blue-600">{effectiveRooms.filter(room => !isCheckoutLike(room)).length}</p><p className="text-xs text-muted-foreground">{t('autoAssign.daily')}</p></div>
                </div>

                <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-sm dark:bg-blue-950/30">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <span>{isGozsdu ? 'Cleaning times use each room’s configured size and verified beds; Laundryners receive no rooms.' : <>{t('autoAssign.checkoutRooms')}: <b>{CHECKOUT_MINUTES} min</b> · {t('autoAssign.dailyRooms')}: <b>{DAILY_MINUTES} min</b> · {t('autoAssign.break')}: <b>{BREAK_TIME_MINUTES} min</b></>}</span>
                </div>

                {dirtyRooms.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground"><AlertCircle className="mx-auto mb-3 h-10 w-10 opacity-50" /><p>{t('autoAssign.noDirtyRooms')}</p></div>
                ) : (
                  <>
                    <h3 className="flex items-center gap-2 font-medium"><Users className="h-4 w-4" />{t('autoAssign.selectHousekeepers')} ({cleaningStaffIds.size} {t('autoAssign.selected')})</h3>
                    <div className="grid max-h-[38vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                      {allStaff.map(staff => {
                        const laundryner = isLaundryner(staff.id);
                        const selected = !laundryner && cleaningStaffIds.has(staff.id);
                        return (
                          <button key={staff.id} type="button" disabled={laundryner} onClick={() => toggleStaffSelection(staff.id)} className={`flex items-center gap-3 rounded-lg border p-3 text-left ${laundryner ? 'cursor-not-allowed border-emerald-300 bg-emerald-50/60 opacity-80 dark:bg-emerald-950/20' : selected ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>
                            {laundryner
                              ? <span aria-label="Selected as Laundryner duty, not for cleaning" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-emerald-600 bg-emerald-600 text-white"><Check className="h-3 w-3" /></span>
                              : <Checkbox checked={selected} />}
                            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{staff.full_name}</span>{staff.nickname && <span className="block truncate text-xs text-muted-foreground">{staff.nickname}</span>}</span>
                            {laundryner && <Badge variant="secondary" className="shrink-0 border border-emerald-400 text-[10px]">✓ 🧺 Laundryner</Badge>}
                            {checkedInStaff.has(staff.id) && <Badge variant="outline" className="border-green-500 text-green-600"><Check className="mr-1 h-3 w-3" />{isNextDayPlanning ? 'Scheduled' : t('autoAssign.checkedIn')}</Badge>}
                          </button>
                        );
                      })}
                    </div>

                    <div className="rounded-lg border p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="flex items-center gap-2 text-sm font-medium"><EyeOff className="h-4 w-4" />{t('autoAssign.excludeRooms')} ({excludedRoomIds.size}/{dirtyRooms.length})</p>
                        <Button size="sm" variant="ghost" onClick={() => setExcludedRoomIds(new Set())}>{t('autoAssign.includeAll')}</Button>
                      </div>
                      <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                        {dirtyRooms.map(room => {
                          const excluded = excludedRoomIds.has(room.id);
                          return <button key={room.id} type="button" onClick={() => toggleRoomExclusion(room.id)} className={`rounded border px-2 py-1 text-xs font-medium ${excluded ? 'border-red-400 bg-red-100 text-red-800 line-through' : isPotentialCheckoutRoom(room) ? 'border-violet-300 bg-violet-50 text-violet-800 dark:bg-violet-950/30 dark:text-violet-200' : 'bg-muted'}`}>{roomDisplayName(room)}{isPotentialCheckoutRoom(room) ? ' · POT' : ''}{excluded ? ' ✕' : ''}</button>;
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : step === 'preview' ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                  <p><strong>{assignmentPreviews.reduce((sum, preview) => sum + preview.rooms.length, 0)}</strong> {t('autoAssign.rooms')} + <strong>{sectionTasks.length}</strong> mapped area tasks → <strong>{staffIdsWithWork.size}</strong> {t('autoAssign.staff')}</p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>🟨 {t('autoAssign.checkout')}</span>{isNextDayPlanning && <span>🟪 Potential checkout</span>}<span>🟦 {t('autoAssign.daily')}</span><span>🧹 mapped area</span><span className="font-bold text-green-600">RTC</span><span className="font-bold text-red-600">HOLD</span><span className="font-bold text-blue-600">T</span><span className="font-bold text-orange-600">C</span>
                  </div>
                  {fairnessMetrics && <div className="flex flex-wrap gap-2 text-xs"><span>CO±{fairnessMetrics.checkoutDiff}</span><span>Daily±{fairnessMetrics.dailyDiff}</span><span>⏱{fairnessMetrics.timeSpreadMinutes}m</span><span>{isGozsdu ? 'Building' : 'F'}↔{fairnessMetrics.splitFloorCount}</span></div>}
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs">
                  <label htmlFor="hk-planning-goal" className="font-semibold">Regeneration goal</label>
                  <Select value={planningGoal} onValueChange={value => setPlanningGoal(value as HousekeepingPlanningGoal)}>
                    <SelectTrigger id="hk-planning-goal" aria-label="Regeneration goal" className="h-8 w-full sm:w-[220px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rebalance">Rebalance workload</SelectItem>
                      <SelectItem value="locality">Keep rooms close</SelectItem>
                      <SelectItem value="checkouts">Balance checkouts</SelectItem>
                      <SelectItem value="alternative">Try another arrangement</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground">{lockedRoomIds.size} manually locked room(s)</span>
                  {planningExplanation && <p role="status" className="w-full text-foreground">{planningExplanation}</p>}
                </div>
                <div role="note" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-sky-200 bg-sky-50/70 px-2.5 py-1.5 text-[11px] text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
                  <span><strong>One room:</strong> drag its chip or tap it, then tap another staff card.</span>
                  <span><strong>Several rooms:</strong> tap the circles, choose a housekeeper, then tap Done.</span>
                  <span className="text-muted-foreground">Both methods work together; nothing saves until Confirm.</span>
                </div>

                <div className={isMobile && assignmentPreviews.length >= 3 ? (isGozsdu ? 'grid grid-cols-1 min-[520px]:grid-cols-2 gap-2' : 'grid grid-cols-2 gap-2 overflow-y-auto') : 'flex gap-2 overflow-x-auto'}>
                  {assignmentPreviews.map(preview => {
                    const checkouts = preview.rooms.filter(isCheckoutLike);
                    const daily = preview.rooms.filter(room => !isCheckoutLike(room));
                    const isDropTarget = selectedRoomForMove && selectedRoomForMove.fromStaffId !== preview.staffId;
                    const isDragOver = dragOverStaffId === preview.staffId;
                    const mappedTasks = sectionTasks.filter(task => task.staff_id === preview.staffId);
                    const mappedTaskMinutes = sectionTaskMinutesForStaff(sectionTasks, preview.staffId);
                    const totalWithAreas = preview.totalWithBreak + mappedTaskMinutes;
                    const exceedsShift = totalWithAreas > STANDARD_SHIFT_MINUTES;
                    const workload = Math.min(100, Math.round((totalWithAreas / maxTime) * 100));
                    const style: React.CSSProperties = isMobile && assignmentPreviews.length >= 3 ? { minWidth: 0 } : { minWidth: isMobile ? 150 : 200, flex: '1 1 0' };
                    return (
                      <motion.div
                        layout
                        key={preview.staffId}
                        data-staff-drop-id={preview.staffId}
                        style={style}
                        onClick={() => isDropTarget && selectedRoomForMove && applyRoomMove(selectedRoomForMove.roomId, selectedRoomForMove.fromStaffId, preview.staffId)}
                        className={`flex min-h-[130px] flex-col rounded-lg border ${bulkDestinationStaffId === preview.staffId ? 'ring-2 ring-sky-500 bg-sky-50/30 dark:bg-sky-950/20' : ''} ${isDropTarget ? 'ring-2 ring-primary' : ''} ${isDragOver ? 'border-dashed bg-blue-50 ring-2 ring-blue-500 dark:bg-blue-950/30' : ''} ${justDroppedStaffId === preview.staffId ? 'ring-2 ring-green-500' : ''} ${exceedsShift ? 'border-destructive' : ''}`}
                      >
                        <div className="border-b bg-muted/40 px-2 py-1.5">
                          <div className="flex items-center justify-between gap-1"><span className="min-w-0 truncate text-xs font-semibold">{preview.staffName}</span><Button type="button" size="sm" variant={bulkDestinationStaffId === preview.staffId ? 'default' : 'outline'} aria-pressed={bulkDestinationStaffId === preview.staffId} className="h-6 shrink-0 px-1 text-[9px]" onClick={event => { event.stopPropagation(); setBulkDestinationStaffId(preview.staffId); }}>{bulkDestinationStaffId === preview.staffId ? '✓ Target' : 'Assign here'}</Button>{exceedsShift && <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" />}</div>
                          <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground"><span>{checkouts.length}co · {daily.length}d · {mappedTasks.length} areas</span><span>{formatMinutesToTime(totalWithAreas)}</span></div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted"><div className={`h-full ${exceedsShift ? 'bg-destructive' : workload > 80 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${workload}%` }} /></div>
                        </div>
                        <div className="flex-1 space-y-1.5 overflow-y-auto p-1.5">
                          {checkouts.length > 0 && <div><div className="mb-0.5 flex flex-wrap items-center justify-between gap-1"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">{t('autoAssign.checkouts')}</p><button type="button" className="text-[9px] text-sky-700 underline dark:text-sky-300" onClick={event => { event.stopPropagation(); toggleBulkRooms(checkouts.map(room => room.id)); }}>{checkouts.every(room => bulkSelectedRoomIds.has(room.id)) ? 'Deselect all' : 'Select all'}</button></div>{groupByFloor(checkouts).map(group => <div key={`co-${group.floor}`} className="mb-1 flex items-start gap-1"><span className="mt-0.5 rounded bg-muted px-0.5 text-[8px] text-muted-foreground">{isGozsdu ? group.floor : `F${group.floor}`}</span><div className="flex flex-wrap gap-1">{group.rooms.map(room => renderRoomChip(room, preview))}</div></div>)}</div>}
                          {daily.length > 0 && <div><div className="mb-0.5 flex flex-wrap items-center justify-between gap-1"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">{t('autoAssign.daily')}</p><button type="button" className="text-[9px] text-sky-700 underline dark:text-sky-300" onClick={event => { event.stopPropagation(); toggleBulkRooms(daily.map(room => room.id)); }}>{daily.every(room => bulkSelectedRoomIds.has(room.id)) ? 'Deselect all' : 'Select all'}</button></div>{groupByFloor(daily).map(group => <div key={`d-${group.floor}`} className="mb-1 flex items-start gap-1"><span className="mt-0.5 rounded bg-muted px-0.5 text-[8px] text-muted-foreground">{isGozsdu ? group.floor : `F${group.floor}`}</span><div className="flex flex-wrap gap-1">{group.rooms.map(room => renderRoomChip(room, preview))}</div></div>)}</div>}
                          {mappedTasks.length > 0 && <div><p className="mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">Public areas · drag to reassign</p><div className="flex flex-wrap gap-1">{mappedTasks.map(task => renderPublicAreaChip(task, preview.staffId))}</div></div>}
                          {preview.rooms.length === 0 && mappedTasks.length === 0 && <div className={`rounded border border-dashed p-3 text-center text-[10px] text-muted-foreground ${isDragOver ? 'border-primary bg-primary/5' : ''}`}>Drop a room or public area here</div>}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {sectionTasks.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 text-primary" />
                      <span><strong className="text-foreground">{sectionTasks.length} public area task{sectionTasks.length === 1 ? '' : 's'}</strong> · drag the green area chips directly between housekeeper columns.</span>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={shufflePublicAreas}>
                      <Shuffle className="mr-1 h-3.5 w-3.5" />Shuffle public areas
                    </Button>
                  </div>
                )}

                {selectedRoomContext ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-sm">
                    <span className="text-xs font-medium">Room {selectedRoomContext.room.room_number} selected</span>
                    <span className="text-[10px] text-muted-foreground">Tap another staff column to move it, or:</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => removeRoomFromPreview(selectedRoomContext.room.id, selectedRoomContext.preview.staffId, true)}><X className="mr-1 h-3.5 w-3.5" />Remove assignment</Button>
                    <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => stageMaintenanceHold(selectedRoomContext.room, selectedRoomContext.preview.staffId)}><Wrench className="mr-1 h-3.5 w-3.5" />Maintenance hold</Button>
                    {isNextDayPlanning && cleaningStaffIds.size > 1 && (
                      <Select
                        value={sharedByRoom.get(selectedRoomContext.room.id) || 'none'}
                        onValueChange={value => setSharedByRoom(previous => {
                          const next = new Map(previous);
                          if (value === 'none') next.delete(selectedRoomContext.room.id);
                          else next.set(selectedRoomContext.room.id, value);
                          return next;
                        })}
                      >
                        <SelectTrigger className="h-7 w-[190px] text-xs"><Users className="mr-1 h-3.5 w-3.5" /><SelectValue placeholder="Share cleaning" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not shared</SelectItem>
                          {allStaff
                            .filter(staff => cleaningStaffIds.has(staff.id) && staff.id !== selectedRoomContext.preview.staffId)
                            .map(staff => <SelectItem key={staff.id} value={staff.id}>Share with {staff.full_name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedRoomForMove(null)}>Cancel</Button>
                  </div>
                ) : (
                  <p className="text-center text-[10px] text-muted-foreground">{t('autoAssign.dragToReassign')} · public areas use the same drag-and-drop columns · {t('autoAssign.tapToMove')} · tap a room for Remove / Maintenance</p>
                )}

                {maintenanceHoldRoomIds.size > 0 && <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200"><Wrench className="mr-1 inline h-3.5 w-3.5" />{maintenanceHoldRoomIds.size} room{maintenanceHoldRoomIds.size === 1 ? '' : 's'} {isNextDayPlanning ? 'will be excluded from tomorrow’s plan as planned maintenance holds.' : 'will be placed on maintenance hold when you confirm.'}</div>}
              </div>
            ) : step === 'confirm' ? (
              <div className="space-y-4 py-6 text-center">
                <Check className="mx-auto h-14 w-14 text-green-600" />
                <h3 className="text-xl font-semibold">{editingExistingAssignments ? 'Save assignment changes' : t('autoAssign.readyToAssign')}</h3>
                <p className="text-muted-foreground">{assignmentPreviews.reduce((sum, preview) => sum + preview.rooms.length, 0)} {t('autoAssign.roomsWillBeAssigned')} {staffIdsWithWork.size} {t('autoAssign.housekeepers')}. {sectionTasks.length} mapped area tasks will follow their nearest section owner.</p>
                {isNextDayPlanning && assignmentPreviews.some(preview => preview.rooms.some(isPotentialCheckoutRoom)) && (
                  <p className="mx-auto max-w-xl rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-100">
                    <strong>{assignmentPreviews.reduce((sum, preview) => sum + preview.rooms.filter(isPotentialCheckoutRoom).length, 0)} potential checkout room(s)</strong> are currently unbooked. They are included for workload planning and will be revalidated against fresh PMS data before morning release.
                  </p>
                )}
                {editingExistingAssignments && <p className="mx-auto max-w-xl rounded-lg bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">Only changed rooms will be written. Untouched assignments, ready-to-clean flags, progress, notes and PMS hold data stay unchanged.</p>}
                {maintenanceHoldRoomIds.size > 0 && <p className="mx-auto max-w-xl rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">{maintenanceHoldRoomIds.size} selected room{maintenanceHoldRoomIds.size === 1 ? '' : 's'} will be marked Out of Order / Maintenance and removed from housekeeping assignment.</p>}
                <div className="space-y-2 text-left">
                  {assignmentPreviews.filter(preview => staffIdsWithWork.has(preview.staffId)).map(preview => { const areaCount = sectionTasks.filter(task => task.staff_id === preview.staffId).length; const total = preview.totalWithBreak + sectionTaskMinutesForStaff(sectionTasks, preview.staffId); return <div key={preview.staffId} className="flex items-center justify-between rounded bg-muted p-2"><span className="font-medium">{preview.staffName}</span><div className="flex items-center gap-2"><Badge variant="outline">{preview.rooms.length} {t('autoAssign.rooms')}</Badge><Badge variant="outline">{areaCount} areas</Badge><span className="text-sm text-green-600">{formatMinutesToTime(total)}</span></div></div>; })}
                </div>
                {isNextDayPlanning && (
                  <label className="mx-auto flex max-w-xl cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 text-left">
                    <Checkbox checked={autoRelease} onCheckedChange={value => setAutoRelease(value === true)} className="mt-0.5" />
                    <span>
                      <span className="font-medium">Automatically release tomorrow’s approved plan at 08:00</span>
                      <span className="mt-1 block text-xs text-muted-foreground">If unticked, the plan stays approved but held until an eligible manager releases or changes it.</span>
                    </span>
                  </label>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-center"><Check className="mx-auto mb-2 h-12 w-12 text-green-600" /><h3 className="text-lg font-semibold">{isNextDayPlanning ? 'Review tomorrow’s public areas' : t('autoAssign.roomsAssignedSuccess')}</h3><p className="text-sm text-muted-foreground">{isNextDayPlanning ? 'Mapped section tasks are included in the same 08:00 plan. Add any extra one-off public areas, then approve the complete plan.' : 'Mapped section tasks are already assigned. Add only any extra one-off public areas needed today.'}</p></div>
                <div className="space-y-2">
                  {PUBLIC_AREAS.map(area => <div key={area.key} className="flex items-center gap-3 rounded-lg border p-3"><span className="text-lg">{area.icon}</span><span className="min-w-0 flex-1 text-sm font-medium">{area.name}</span><Select value={publicAreaAssignments.get(area.key) || ''} onValueChange={value => setPublicAreaAssignments(previous => { const next = new Map(previous); if (value === 'none') next.delete(area.key); else next.set(area.key, value); return next; })}><SelectTrigger className="w-[160px]"><SelectValue placeholder={t('autoAssign.notAssigned')} /></SelectTrigger><SelectContent><SelectItem value="none">{t('autoAssign.notAssigned')}</SelectItem>{allStaff.filter(staff => cleaningStaffIds.has(staff.id)).map(staff => <SelectItem key={staff.id} value={staff.id}>{staff.full_name}</SelectItem>)}</SelectContent></Select></div>)}
                </div>
              </div>
            )}
          </div>

          {step === 'preview' && bulkRoomContexts.length > 0 && (
            <div data-testid="auto-assign-bulk-bar" className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border-2 border-sky-300 bg-background p-2 shadow-sm">
              <span className="text-xs font-semibold">{bulkRoomContexts.length} selected · {bulkRoomContexts.filter(entry => entry.room.is_checkout_room || entry.room.pms_metadata?.scheduledDepartureToday === true).length} checkout · {bulkRoomContexts.filter(entry => !isCheckoutLike(entry.room)).length} daily</span>
              <Select value={bulkDestinationStaffId || undefined} onValueChange={setBulkDestinationStaffId}>
                <SelectTrigger className="h-8 min-w-[145px] flex-1 text-xs sm:max-w-[230px]" aria-label="Bulk assignment destination housekeeper"><SelectValue placeholder="Choose housekeeper" /></SelectTrigger>
                <SelectContent>{assignmentPreviews.filter(person => cleaningStaffIds.has(person.staffId) && !isLaundryner(person.staffId)).map(person => <SelectItem key={person.staffId} value={person.staffId}>{person.staffName}</SelectItem>)}</SelectContent>
              </Select>
              {bulkProjectedMinutes !== null && <span className={`text-[11px] ${bulkProjectedMinutes > STANDARD_SHIFT_MINUTES ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>After move: {formatMinutesToTime(bulkProjectedMinutes)}{bulkProjectedMinutes > STANDARD_SHIFT_MINUTES ? ' · exceeds shift' : ''}</span>}
              <Button type="button" size="sm" className="h-8 flex-1 sm:flex-none" disabled={!bulkDestinationStaffId || bulkMovableRooms.length === 0 || !cleaningStaffIds.has(bulkDestinationStaffId) || isLaundryner(bulkDestinationStaffId)} onClick={handleBulkRoomMove}>Done · Move {bulkMovableRooms.length} room{bulkMovableRooms.length === 1 ? '' : 's'}</Button>
              <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setBulkSelectedRoomIds(new Set())}>Clear selection</Button>
              <span className="w-full text-[10px] text-muted-foreground">This changes the preview only. Use Proceed to Confirm to save.</span>
            </div>
          )}

          <DialogFooter className={isGozsdu ? '!grid grid-cols-2 gap-2 border-t pt-2 sm:!flex sm:flex-wrap sm:justify-end' : 'flex-shrink-0 gap-2'}>
            {step === 'select-staff' && <><Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button><Button onClick={handleGeneratePreview} disabled={cleaningStaffIds.size === 0 || effectiveRooms.length === 0}>{t('autoAssign.generatePreview')}<ArrowRight className="ml-2 h-4 w-4" /></Button></>}
            {step === 'preview' && <>
              {restoredFromSave && <Button variant="ghost" size="sm" className="mr-auto text-muted-foreground" onClick={handleClearSaved}><Trash2 className="mr-1 h-3.5 w-3.5" />{t('autoAssign.clearSaved')}</Button>}
              {previewHistory.length > 0 && <Button variant="ghost" size="sm" onClick={handleUndo}><Undo2 className="mr-1 h-3.5 w-3.5" />{t('autoAssign.undo')} ({previewHistory.length})</Button>}
              <Button variant="outline" onClick={() => setStep('select-staff')}>{t('autoAssign.back')}</Button>
              <Button variant="outline" onClick={handleGeneratePreview} disabled={isGozsdu && (cleaningStaffIds.size === 0 || effectiveRooms.length === 0)}><RefreshCw className="mr-2 h-4 w-4" />{t('autoAssign.regenerate')}</Button>
              <Button onClick={handleProceedToConfirm} disabled={isGozsdu && !gozsduCanReviewAssignment(assignmentPreviews, cleaningStaffIds, isLaundryner)} className={isGozsdu ? 'col-span-2 sm:w-auto' : undefined}>{editingExistingAssignments ? 'Review changes' : t('autoAssign.proceedToConfirm')}<ArrowRight className="ml-2 h-4 w-4" /></Button>
            </>}
            {step === 'confirm' && <><Button variant="outline" onClick={() => setStep('preview')}>{t('autoAssign.back')}</Button><Button variant="outline" onClick={handlePrintAssignments}><Printer className="mr-2 h-4 w-4" />{t('autoAssign.print')}</Button><Button onClick={handleConfirmAssignment} disabled={submitting || (isGozsdu && !gozsduCanReviewAssignment(assignmentPreviews, cleaningStaffIds, isLaundryner))}>{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('autoAssign.assigning')}</> : <><Check className="mr-2 h-4 w-4" />{isNextDayPlanning ? 'Continue to Public Areas' : editingExistingAssignments ? 'Save Changes' : t('autoAssign.confirmAndAssign')}</>}</Button></>}
            {step === 'public-areas' && <><Button variant="outline" onClick={() => isNextDayPlanning ? setStep('confirm') : onOpenChange(false)}>{isNextDayPlanning ? t('autoAssign.back') : t('autoAssign.skipAndClose')}</Button><Button onClick={handleAssignPublicAreas} disabled={submitting || (!isNextDayPlanning && publicAreaAssignments.size === 0)}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}{isNextDayPlanning ? `Approve tomorrow’s plan (${sectionTasks.length + publicAreaAssignments.size} areas)` : `${t('autoAssign.assignAreas')} (${publicAreaAssignments.size})`}</Button></>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showOverAllocationDialog} onOpenChange={setShowOverAllocationDialog}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-5 w-5" />{t('autoAssign.shiftExceeded')}</AlertDialogTitle><AlertDialogDescription asChild><div className="space-y-3"><p>{t('autoAssign.shiftExceededDesc')}</p>{overAllocatedStaff.map(staff => <div key={staff.staffId} className="flex items-center justify-between rounded bg-destructive/10 p-2"><span>{staff.staffName}</span><b>{formatMinutesToTime(staff.totalWithBreak)}</b></div>)}</div></AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t('autoAssign.goBackAndAdjust')}</AlertDialogCancel><AlertDialogAction onClick={() => { setShowOverAllocationDialog(false); setStep('confirm'); }}>{t('autoAssign.proceedAnyway')}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

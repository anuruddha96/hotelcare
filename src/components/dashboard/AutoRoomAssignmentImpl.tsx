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
import { isPmsRtcToday } from '@/lib/pmsReadiness';
import { isRoomEligibleForAutoAssign } from '@/lib/autoAssignRoomEligibility';
import { assignRoomToStaff, unassignRoom } from '@/lib/hkAssignmentDnd';
import { getLocalDateString } from '@/lib/utils';

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
}

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
}

const isCheckoutLike = (room: RoomForAssignment): boolean =>
  room.is_checkout_room === true || room.pms_metadata?.scheduledDepartureToday === true;

const needsTowelChange = (room: RoomForAssignment): boolean =>
  !!room.towel_change_required && !isCheckoutLike(room);

const needsLinenChange = (room: RoomForAssignment): boolean =>
  !!room.linen_change_required && !isCheckoutLike(room);

function getSaveKey(hotel: string | null | undefined, date: string): string {
  // v2 invalidates drafts created by the old dirty-only room filter. Without
  // this, a manager could reopen today's two-room draft after the fix and
  // still not see the full PMS workload until manually regenerating it.
  return `auto_assignment_v2_${hotel || 'unknown'}_${date}`;
}

function roomOrdinal(roomNumber: string): number {
  const values = String(roomNumber || '').match(/\d+/g);
  return values?.length ? Number(values[values.length - 1]) : Number.MAX_SAFE_INTEGER;
}

function sortPreviewRooms(rooms: RoomForAssignment[]): RoomForAssignment[] {
  return [...rooms].sort((a, b) => {
    const aCheckout = isCheckoutLike(a);
    const bCheckout = isCheckoutLike(b);
    if (aCheckout !== bCheckout) return aCheckout ? -1 : 1;
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
}: AutoRoomAssignmentProps) {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

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

  const existingAssignmentsRef = useRef<Map<string, ExistingAssignment>>(new Map());
  const hotelKeysRef = useRef<string[]>([]);
  const managerHotelRef = useRef<string>('');
  const draftRestoredRef = useRef(false);
  const roomSectionsRef = useRef<Map<string, { id: string; name: string }>>(new Map());

  const saveKey = getSaveKey(profile?.assigned_hotel, selectedDate);

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
    const keys = hotelKeysRef.current;
    if (!open || keys.length === 0) return;

    const { data: roomRows, error: roomErr } = await supabase
      .from('rooms')
      .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
      .in('hotel', keys);
    if (roomErr || !roomRows) return;

    const roomIds = roomRows.map(room => room.id);
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
    const availableRooms = roomRows
      .filter(room => isRoomEligibleForAutoAssign(room, {
        hasActiveAssignment: activeRoomIds.has(room.id),
        hasCompletedAssignment: completedRoomIds.has(room.id),
      }))
      .map(room => ({
        ...addSectionContext(room),
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
    if (!open) return;
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
  }, [open, selectedDate, profile?.assigned_hotel]);

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
      const { data: attendanceData } = await supabase
        .from('staff_attendance')
        .select('user_id')
        .eq('work_date', selectedDate)
        .in('status', ['checked_in', 'on_break']);
      const checked = new Set((attendanceData || []).map(row => row.user_id).filter(id => hotelStaffIds.has(id)));
      setCheckedInStaff(checked);

      const { data: roomRows, error: roomsErr } = await supabase
        .from('rooms')
        .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
        .in('hotel', hotelKeys);
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
      if (sectionTaskIds.length > 0) {
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
      const roomIds = allHotelRooms.map(room => room.id);
      let assignmentRows: ExistingAssignment[] = [];
      if (roomIds.length > 0) {
        const { data, error } = await supabase
          .from('room_assignments')
          .select('id, room_id, assigned_to, assignment_type, status, priority, ready_to_clean, pms_hold, pms_hold_reason')
          .eq('assignment_date', selectedDate)
          .in('room_id', roomIds);
        if (error) throw error;
        assignmentRows = (data || []) as ExistingAssignment[];
      }

      const existingRows = assignmentRows.filter(row =>
        ['assigned', 'in_progress', 'dnd_pending_retry'].includes(row.status)
      );
      const completedRoomIds = new Set(assignmentRows
        .filter(row => row.status === 'completed')
        .map(row => row.room_id));

      existingAssignmentsRef.current = new Map(existingRows.map(row => [row.room_id, row]));
      const existingByRoom = existingAssignmentsRef.current;
      const assignedRoomIds = new Set(existingRows.map(row => row.room_id));
      const workingRooms = allHotelRooms
        .filter(room => isRoomEligibleForAutoAssign(room, {
          hasActiveAssignment: assignedRoomIds.has(room.id),
          hasCompletedAssignment: completedRoomIds.has(room.id),
        }))
        .map(room => ({
          ...room,
          ready_to_clean: existingByRoom.get(room.id)?.ready_to_clean ?? false,
        }));
      setDirtyRooms(workingRooms);

      const ownerIds = new Set(existingRows.map(row => row.assigned_to));
      const selectedFromDb = new Set<string>([...Array.from(checked), ...Array.from(ownerIds)]);

      if (!preserveDraft) {
        if (existingRows.length > 0) {
          setEditingExistingAssignments(true);
          setSelectedStaffIds(selectedFromDb);
          const roomMap = new Map(workingRooms.map(room => [room.id, room]));
          const staffById = new Map(staffList.map(staff => [staff.id, staff]));
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
          setStep('preview');
        } else {
          setEditingExistingAssignments(false);
          setSelectedStaffIds(checked);
          setAssignmentPreviews([]);
          setFairnessMetrics(null);
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
        .select('room_number_a, room_number_b, pair_count')
        .eq('hotel', hotelName)
        .eq('organization_slug', profile.organization_slug);
      setRoomAffinity(patternData?.length ? buildAffinityMap(patternData) : undefined);
    } catch (error) {
      console.error('[AutoRoomAssignment] fetch failed:', error);
      toast.error(t('autoAssign.failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;

    setSelectedRoomForMove(null);
    setShowOverAllocationDialog(false);
    setPublicAreaAssignments(new Map());
    setPreviewHistory([]);

    let restored = false;
    try {
      const saved = localStorage.getItem(saveKey);
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

  useEffect(() => {
    if (!open) return;
    if (selectedStaffIds.size === 0 && assignmentPreviews.length === 0) return;
    const data: SavedState = {
      staffIds: Array.from(selectedStaffIds),
      previews: assignmentPreviews,
      excludedRoomIds: Array.from(excludedRoomIds),
      maintenanceHoldRoomIds: Array.from(maintenanceHoldRoomIds),
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(saveKey, JSON.stringify(data));
    } catch {
      // Browser storage is best-effort only.
    }
  }, [open, saveKey, selectedStaffIds, assignmentPreviews, excludedRoomIds, maintenanceHoldRoomIds]);

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
  }, [step, previewHistory]);

  const pushHistory = (previews: AssignmentPreview[]) => {
    setPreviewHistory(history => [...history.slice(-19), previews]);
  };

  const handleUndo = () => {
    if (previewHistory.length === 0) return;
    const previous = previewHistory[previewHistory.length - 1];
    const restoredRoomIds = new Set(previous.flatMap(preview => preview.rooms.map(room => room.id)));
    setPreviewHistory(history => history.slice(0, -1));
    setAssignmentPreviews(previous);
    setFairnessMetrics(computeFairnessMetrics(previous));
    setMaintenanceHoldRoomIds(ids => new Set(Array.from(ids).filter(id => !restoredRoomIds.has(id))));
    setExcludedRoomIds(ids => new Set(Array.from(ids).filter(id => !restoredRoomIds.has(id))));
    setSelectedRoomForMove(null);
    toast.success(t('autoAssign.undoSuccess'));
  };

  const handleClearSaved = () => {
    localStorage.removeItem(saveKey);
    setRestoredFromSave(false);
    setExcludedRoomIds(new Set());
    setMaintenanceHoldRoomIds(new Set());
    setSelectedRoomForMove(null);
    void fetchData(false);
  };

  const toggleStaffSelection = (staffId: string) => {
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
    const selectedStaff = allStaff.filter(staff => selectedStaffIds.has(staff.id));
    const roomsToAssign = effectiveRooms;
    if (selectedStaff.length === 0 || roomsToAssign.length === 0) return;

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

      const insightsKey = `ai_insights_${hotelName}`;
      const cached = localStorage.getItem(insightsKey);
      if (cached) {
        const insights = JSON.parse(cached);
        if (Date.now() - (insights.cachedAt || 0) < 7 * 24 * 60 * 60 * 1000) {
          hotelConfig.staffPreferences = insights.staff_preferences;
        }
      }
    } catch {
      // Smart settings are optional; assignment still works with algorithm defaults.
    }

    try {
      const searchKeys = hotelKeysRef.current.length ? hotelKeysRef.current : [hotelName || ''];
      const { data: profileRow } = await (supabase as any)
        .from('hotel_autoassign_profiles')
        .select('floor_grouping_weight, checkout_first')
        .in('hotel_id', searchKeys)
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

    let best: AssignmentPreview[] | null = null;
    let bestMetrics: FairnessMetrics | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < 10; i++) {
      const candidate = autoAssignRooms(
        roomsToAssign,
        selectedStaff,
        wingProximity,
        roomAffinity,
        { ...hotelConfig, randomSeed: Date.now() + i * 7919 },
      );
      const metrics = computeFairnessMetrics(candidate);
      if (metrics.score < bestScore) {
        best = candidate;
        bestMetrics = metrics;
        bestScore = metrics.score;
      }
    }

    const previews = best || autoAssignRooms(roomsToAssign, selectedStaff, wingProximity, roomAffinity, hotelConfig);
    pushHistory(assignmentPreviews);
    setAssignmentPreviews(previews);
    setFairnessMetrics(bestMetrics || computeFairnessMetrics(previews));
    setSelectedRoomForMove(null);
    setStep('preview');
  };

  const applyRoomMove = (roomId: string, fromStaffId: string, toStaffId: string) => {
    if (!roomId || !fromStaffId || !toStaffId || fromStaffId === toStaffId) return;
    pushHistory(assignmentPreviews);
    const next = moveRoom(assignmentPreviews, roomId, fromStaffId, toStaffId);
    setAssignmentPreviews(next);
    setFairnessMetrics(computeFairnessMetrics(next));
    setSelectedRoomForMove(null);
    setJustDroppedRoomId(roomId);
    setJustDroppedStaffId(toStaffId);
    setTimeout(() => {
      setJustDroppedRoomId(null);
      setJustDroppedStaffId(null);
    }, 650);
  };

  const removeRoomFromPreview = (roomId: string, fromStaffId: string, markExcluded: boolean = true) => {
    pushHistory(assignmentPreviews);
    const next = assignmentPreviews.map(preview => {
      if (preview.staffId !== fromStaffId) return preview;
      return buildPreview(preview.staffId, preview.staffName, preview.rooms.filter(room => room.id !== roomId));
    });
    setAssignmentPreviews(next);
    setFairnessMetrics(computeFairnessMetrics(next));
    if (markExcluded) {
      setExcludedRoomIds(previous => new Set([...Array.from(previous), roomId]));
    }
    setSelectedRoomForMove(null);
  };

  const stageMaintenanceHold = (room: RoomForAssignment, fromStaffId: string) => {
    setMaintenanceHoldRoomIds(previous => new Set([...Array.from(previous), room.id]));
    removeRoomFromPreview(room.id, fromStaffId, true);
    toast.info(`Room ${room.room_number} will be put on maintenance hold when you confirm.`);
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
    const toName = assignmentPreviews.find(p => p.staffId === toStaffId)?.staffName || 'housekeeper';
    toast.success(`${task.task_name} → ${toName}`);
  };

  /** Redistribute only the movable public-area tasks across the busiest-last staff. */
  const shufflePublicAreas = () => {
    const eligible = assignmentPreviews.filter(preview => selectedStaffIds.has(preview.staffId));
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
          <tr><th style="border:1px solid #ddd;padding:6px">Room</th><th style="border:1px solid #ddd;padding:6px">Type</th><th style="border:1px solid #ddd;padding:6px">Floor</th><th style="border:1px solid #ddd;padding:6px">Special</th></tr>
          ${sortPreviewRooms(preview.rooms).map(room => {
            const special = [
              room.ready_to_clean || isPmsRtcToday(room.pms_metadata as any) ? 'RTC' : '',
              needsTowelChange(room) ? 'Towel' : '',
              needsLinenChange(room) ? 'Clean Room' : '',
              room.bed_configuration ? `Bed: ${room.bed_configuration}` : '',
            ].filter(Boolean).join(', ');
            return `<tr><td style="border:1px solid #ddd;padding:6px"><b>${room.room_number}</b></td><td style="border:1px solid #ddd;padding:6px">${isCheckoutLike(room) ? 'Checkout' : 'Daily'}</td><td style="border:1px solid #ddd;padding:6px">F${room.floor_number ?? getFloorFromRoomNumber(room.room_number)}</td><td style="border:1px solid #ddd;padding:6px">${special || '—'}</td></tr>`;
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

  const groupByFloor = (rooms: RoomForAssignment[]) => {
    const map = new Map<number, RoomForAssignment[]>();
    for (const room of rooms) {
      const floor = room.floor_number ?? getFloorFromRoomNumber(room.room_number);
      if (!map.has(floor)) map.set(floor, []);
      map.get(floor)!.push(room);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([floor, floorRooms]) => ({ floor, rooms: sortPreviewRooms(floorRooms) }));
  };

  const renderRoomChip = (room: RoomForAssignment, preview: AssignmentPreview) => {
    const selected = selectedRoomForMove?.roomId === room.id;
    const checkout = isCheckoutLike(room);
    const rtc = checkout && (room.ready_to_clean === true || isPmsRtcToday(room.pms_metadata as any));
    const held = room.status === 'out_of_order';
    const color = held
      ? 'bg-red-100 text-red-900 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-200'
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
          selected ? 'ring-2 ring-primary ring-offset-1 scale-105' : ''
        } ${draggingRoomId === room.id ? 'opacity-75' : ''} ${justDroppedRoomId === room.id ? 'ring-2 ring-green-500' : ''}`}
        title={`Room ${room.room_number}${rtc ? ' · Ready to clean' : ''}${held ? ' · Maintenance hold' : ''}`}
      >
        <span className="font-semibold">{room.room_number}</span>
        {rtc && <span className="rounded bg-green-600 px-0.5 text-[8px] font-extrabold text-white">RTC</span>}
        {held && <span className="rounded bg-red-600 px-0.5 text-[8px] font-extrabold text-white">HOLD</span>}
        {room.room_category && <span className="text-[9px] opacity-70">{getCategoryShortName(room.room_category)}</span>}
        {needsTowelChange(room) && <span className="text-[9px] font-bold text-blue-600">T</span>}
        {needsLinenChange(room) && <span className="text-[9px] font-bold text-orange-600">C</span>}
        {room.bed_configuration && <span className="text-[9px] opacity-70">🛏️{room.bed_configuration.slice(0, 6)}</span>}
      </motion.div>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={`max-h-[92vh] flex flex-col p-3 sm:p-6 gap-2 sm:gap-4 ${step === 'preview' ? 'max-w-[100vw] sm:max-w-[95vw] w-full' : 'max-w-4xl'}`}>
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <Wand2 className="h-5 w-5" />
              {t('autoAssign.title')}
              {editingExistingAssignments && <Badge variant="outline" className="border-blue-300 text-blue-700">Editing current assignments</Badge>}
              {restoredFromSave && <Badge variant="outline" className="border-green-300 text-green-700">{t('autoAssign.restored')}</Badge>}
              <Badge variant="outline" className="border-emerald-300 text-emerald-700">● Live</Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-center gap-1.5 py-1">
            <Badge variant={step === 'select-staff' ? 'default' : 'secondary'} className="text-xs">1. {t('autoAssign.stepStaff')}</Badge>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge variant={step === 'preview' ? 'default' : 'secondary'} className="text-xs">2. {t('autoAssign.stepPreview')}</Badge>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge variant={step === 'confirm' ? 'default' : 'secondary'} className="text-xs">3. {t('autoAssign.stepConfirm')}</Badge>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge variant={step === 'public-areas' ? 'default' : 'secondary'} className="text-xs">4. {t('autoAssign.stepPublicAreas')}</Badge>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-1">
            {loading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : step === 'select-staff' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted p-3">
                  <div className="text-center"><p className="text-2xl font-bold">{effectiveRooms.length}</p><p className="text-xs text-muted-foreground">{t('autoAssign.totalRooms')}</p></div>
                  <div className="text-center"><p className="text-2xl font-bold text-amber-600">{effectiveRooms.filter(isCheckoutLike).length}</p><p className="text-xs text-muted-foreground">{t('autoAssign.checkouts')}</p></div>
                  <div className="text-center"><p className="text-2xl font-bold text-blue-600">{effectiveRooms.filter(room => !isCheckoutLike(room)).length}</p><p className="text-xs text-muted-foreground">{t('autoAssign.daily')}</p></div>
                </div>

                <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-sm dark:bg-blue-950/30">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <span>{t('autoAssign.checkoutRooms')}: <b>{CHECKOUT_MINUTES} min</b> · {t('autoAssign.dailyRooms')}: <b>{DAILY_MINUTES} min</b> · {t('autoAssign.break')}: <b>{BREAK_TIME_MINUTES} min</b></span>
                </div>

                {dirtyRooms.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground"><AlertCircle className="mx-auto mb-3 h-10 w-10 opacity-50" /><p>{t('autoAssign.noDirtyRooms')}</p></div>
                ) : (
                  <>
                    <h3 className="flex items-center gap-2 font-medium"><Users className="h-4 w-4" />{t('autoAssign.selectHousekeepers')} ({selectedStaffIds.size} {t('autoAssign.selected')})</h3>
                    <div className="grid max-h-[38vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                      {allStaff.map(staff => {
                        const selected = selectedStaffIds.has(staff.id);
                        return (
                          <button key={staff.id} type="button" onClick={() => toggleStaffSelection(staff.id)} className={`flex items-center gap-3 rounded-lg border p-3 text-left ${selected ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>
                            <Checkbox checked={selected} />
                            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{staff.full_name}</span>{staff.nickname && <span className="block truncate text-xs text-muted-foreground">{staff.nickname}</span>}</span>
                            {checkedInStaff.has(staff.id) && <Badge variant="outline" className="border-green-500 text-green-600"><Check className="mr-1 h-3 w-3" />{t('autoAssign.checkedIn')}</Badge>}
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
                          return <button key={room.id} type="button" onClick={() => toggleRoomExclusion(room.id)} className={`rounded border px-2 py-1 text-xs font-medium ${excluded ? 'border-red-400 bg-red-100 text-red-800 line-through' : 'bg-muted'}`}>{room.room_number}{excluded ? ' ✕' : ''}</button>;
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
                    <span>🟨 {t('autoAssign.checkout')}</span><span>🟦 {t('autoAssign.daily')}</span><span>🧹 mapped area</span><span className="font-bold text-green-600">RTC</span><span className="font-bold text-red-600">HOLD</span><span className="font-bold text-blue-600">T</span><span className="font-bold text-orange-600">C</span>
                  </div>
                  {fairnessMetrics && <div className="flex flex-wrap gap-2 text-xs"><span>CO±{fairnessMetrics.checkoutDiff}</span><span>Daily±{fairnessMetrics.dailyDiff}</span><span>⏱{fairnessMetrics.timeSpreadMinutes}m</span><span>F↔{fairnessMetrics.splitFloorCount}</span></div>}
                </div>

                <div className={isMobile && assignmentPreviews.length >= 3 ? 'grid grid-cols-2 gap-2 overflow-y-auto' : 'flex gap-2 overflow-x-auto'}>
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
                        className={`flex min-h-[130px] flex-col rounded-lg border ${isDropTarget ? 'ring-2 ring-primary' : ''} ${isDragOver ? 'border-dashed bg-blue-50 ring-2 ring-blue-500 dark:bg-blue-950/30' : ''} ${justDroppedStaffId === preview.staffId ? 'ring-2 ring-green-500' : ''} ${exceedsShift ? 'border-destructive' : ''}`}
                      >
                        <div className="border-b bg-muted/40 px-2 py-1.5">
                          <div className="flex items-center justify-between gap-1"><span className="truncate text-xs font-semibold">{preview.staffName}</span>{exceedsShift && <AlertTriangle className="h-3 w-3 text-destructive" />}</div>
                          <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground"><span>{checkouts.length}co · {daily.length}d · {mappedTasks.length} areas</span><span>{formatMinutesToTime(totalWithAreas)}</span></div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted"><div className={`h-full ${exceedsShift ? 'bg-destructive' : workload > 80 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${workload}%` }} /></div>
                        </div>
                        <div className="flex-1 space-y-1.5 overflow-y-auto p-1.5">
                          {checkouts.length > 0 && <div><p className="mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{t('autoAssign.checkouts')}</p>{groupByFloor(checkouts).map(group => <div key={`co-${group.floor}`} className="mb-1 flex items-start gap-1"><span className="mt-0.5 rounded bg-muted px-0.5 text-[8px] text-muted-foreground">F{group.floor}</span><div className="flex flex-wrap gap-1">{group.rooms.map(room => renderRoomChip(room, preview))}</div></div>)}</div>}
                          {daily.length > 0 && <div><p className="mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{t('autoAssign.daily')}</p>{groupByFloor(daily).map(group => <div key={`d-${group.floor}`} className="mb-1 flex items-start gap-1"><span className="mt-0.5 rounded bg-muted px-0.5 text-[8px] text-muted-foreground">F{group.floor}</span><div className="flex flex-wrap gap-1">{group.rooms.map(room => renderRoomChip(room, preview))}</div></div>)}</div>}
                          {mappedTasks.length > 0 && <div><p className="mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">Mapped area work</p><div className="flex flex-wrap gap-1">{mappedTasks.map(task => <span key={task.id} className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" title={`${task.section_name} · ${task.estimated_duration} min`}>{task.icon} {task.task_name} <span className="opacity-60">{task.section_name}</span></span>)}</div></div>}
                          {preview.rooms.length === 0 && <div className="rounded border border-dashed p-3 text-center text-[10px] text-muted-foreground">Drop or tap a room here</div>}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {selectedRoomContext ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-sm">
                    <span className="text-xs font-medium">Room {selectedRoomContext.room.room_number} selected</span>
                    <span className="text-[10px] text-muted-foreground">Tap another staff column to move it, or:</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => removeRoomFromPreview(selectedRoomContext.room.id, selectedRoomContext.preview.staffId, true)}><X className="mr-1 h-3.5 w-3.5" />Remove assignment</Button>
                    <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => stageMaintenanceHold(selectedRoomContext.room, selectedRoomContext.preview.staffId)}><Wrench className="mr-1 h-3.5 w-3.5" />Maintenance hold</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedRoomForMove(null)}>Cancel</Button>
                  </div>
                ) : (
                  <p className="text-center text-[10px] text-muted-foreground">{t('autoAssign.dragToReassign')} · {t('autoAssign.tapToMove')} · tap a room for Remove / Maintenance</p>
                )}

                {maintenanceHoldRoomIds.size > 0 && <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200"><Wrench className="mr-1 inline h-3.5 w-3.5" />{maintenanceHoldRoomIds.size} room{maintenanceHoldRoomIds.size === 1 ? '' : 's'} will be placed on maintenance hold when you confirm.</div>}
              </div>
            ) : step === 'confirm' ? (
              <div className="space-y-4 py-6 text-center">
                <Check className="mx-auto h-14 w-14 text-green-600" />
                <h3 className="text-xl font-semibold">{editingExistingAssignments ? 'Save assignment changes' : t('autoAssign.readyToAssign')}</h3>
                <p className="text-muted-foreground">{assignmentPreviews.reduce((sum, preview) => sum + preview.rooms.length, 0)} {t('autoAssign.roomsWillBeAssigned')} {staffIdsWithWork.size} {t('autoAssign.housekeepers')}. {sectionTasks.length} mapped area tasks will follow their nearest section owner.</p>
                {editingExistingAssignments && <p className="mx-auto max-w-xl rounded-lg bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">Only changed rooms will be written. Untouched assignments, ready-to-clean flags, progress, notes and PMS hold data stay unchanged.</p>}
                {maintenanceHoldRoomIds.size > 0 && <p className="mx-auto max-w-xl rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">{maintenanceHoldRoomIds.size} selected room{maintenanceHoldRoomIds.size === 1 ? '' : 's'} will be marked Out of Order / Maintenance and removed from housekeeping assignment.</p>}
                <div className="space-y-2 text-left">
                  {assignmentPreviews.filter(preview => staffIdsWithWork.has(preview.staffId)).map(preview => { const areaCount = sectionTasks.filter(task => task.staff_id === preview.staffId).length; const total = preview.totalWithBreak + sectionTaskMinutesForStaff(sectionTasks, preview.staffId); return <div key={preview.staffId} className="flex items-center justify-between rounded bg-muted p-2"><span className="font-medium">{preview.staffName}</span><div className="flex items-center gap-2"><Badge variant="outline">{preview.rooms.length} {t('autoAssign.rooms')}</Badge><Badge variant="outline">{areaCount} areas</Badge><span className="text-sm text-green-600">{formatMinutesToTime(total)}</span></div></div>; })}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-center"><Check className="mx-auto mb-2 h-12 w-12 text-green-600" /><h3 className="text-lg font-semibold">{t('autoAssign.roomsAssignedSuccess')}</h3><p className="text-sm text-muted-foreground">Mapped section tasks are already assigned. Add only any extra one-off public areas needed today.</p></div>
                <div className="space-y-2">
                  {PUBLIC_AREAS.map(area => <div key={area.key} className="flex items-center gap-3 rounded-lg border p-3"><span className="text-lg">{area.icon}</span><span className="min-w-0 flex-1 text-sm font-medium">{area.name}</span><Select value={publicAreaAssignments.get(area.key) || ''} onValueChange={value => setPublicAreaAssignments(previous => { const next = new Map(previous); if (value === 'none') next.delete(area.key); else next.set(area.key, value); return next; })}><SelectTrigger className="w-[160px]"><SelectValue placeholder={t('autoAssign.notAssigned')} /></SelectTrigger><SelectContent><SelectItem value="none">{t('autoAssign.notAssigned')}</SelectItem>{allStaff.filter(staff => selectedStaffIds.has(staff.id)).map(staff => <SelectItem key={staff.id} value={staff.id}>{staff.full_name}</SelectItem>)}</SelectContent></Select></div>)}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex-shrink-0 gap-2">
            {step === 'select-staff' && <><Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button><Button onClick={handleGeneratePreview} disabled={selectedStaffIds.size === 0 || effectiveRooms.length === 0}>{t('autoAssign.generatePreview')}<ArrowRight className="ml-2 h-4 w-4" /></Button></>}
            {step === 'preview' && <>
              {restoredFromSave && <Button variant="ghost" size="sm" className="mr-auto text-muted-foreground" onClick={handleClearSaved}><Trash2 className="mr-1 h-3.5 w-3.5" />{t('autoAssign.clearSaved')}</Button>}
              {previewHistory.length > 0 && <Button variant="ghost" size="sm" onClick={handleUndo}><Undo2 className="mr-1 h-3.5 w-3.5" />{t('autoAssign.undo')} ({previewHistory.length})</Button>}
              <Button variant="outline" onClick={() => setStep('select-staff')}>{t('autoAssign.back')}</Button>
              <Button variant="outline" onClick={handleGeneratePreview}><RefreshCw className="mr-2 h-4 w-4" />{t('autoAssign.regenerate')}</Button>
              <Button onClick={handleProceedToConfirm}>{editingExistingAssignments ? 'Review changes' : t('autoAssign.proceedToConfirm')}<ArrowRight className="ml-2 h-4 w-4" /></Button>
            </>}
            {step === 'confirm' && <><Button variant="outline" onClick={() => setStep('preview')}>{t('autoAssign.back')}</Button><Button variant="outline" onClick={handlePrintAssignments}><Printer className="mr-2 h-4 w-4" />{t('autoAssign.print')}</Button><Button onClick={handleConfirmAssignment} disabled={submitting}>{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('autoAssign.assigning')}</> : <><Check className="mr-2 h-4 w-4" />{editingExistingAssignments ? 'Save Changes' : t('autoAssign.confirmAndAssign')}</>}</Button></>}
            {step === 'public-areas' && <><Button variant="outline" onClick={() => onOpenChange(false)}>{t('autoAssign.skipAndClose')}</Button><Button onClick={handleAssignPublicAreas} disabled={submitting || publicAreaAssignments.size === 0}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}{t('autoAssign.assignAreas')} ({publicAreaAssignments.size})</Button></>}
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

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  Check,
  GripVertical,
  Loader2,
  RefreshCw,
  Star,
  Users,
  Wand2,
  Layers3,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import {
  buildSelectedDateHousekeepingWorkload,
  isUnsoldPlanningRoom,
  type DailyOverviewWorkRow,
} from '@/lib/nextDayHousekeepingSnapshot';
import { calculateRoomTime, type RoomForAssignment } from '@/lib/roomAssignmentAlgorithm';
import {
  filterRoomsToMappedTeam,
  filterSnapshotRowsToMappedRooms,
  loadActiveSlntTeamScope,
  summarizeTeamWorkload,
  slntTeamBPropertyKey,
} from '@/lib/slntTeamHousekeepingScope';
import {
  isMissingTeamBOptionalSchemaError,
  resolveTeamBOperationalStaffing,
  staffingSourceLabel,
  type StaffingSource,
} from '@/lib/slntTeamBOperationalStaffing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate: string;
  onAssignmentCreated: (roomCount?: number, staffCount?: number) => void;
};

type ExistingTask = {
  room_id: string;
  assignment_type: 'checkout_cleaning' | 'daily_cleaning';
  status: 'queued' | 'claimed' | 'cancelled';
  planned_candidate_user_id: string | null;
};

type PlannerStaff = {
  id: string;
  full_name: string;
  is_default: boolean;
  from_schedule: boolean;
};

type Step = 'staff' | 'rooms';
const UNASSIGNED = '__unassigned__';

const COPY = {
  en: {
    title: 'Plan Team B',
    subtitle: 'Choose who is working. HotelCare uses the saved Team B plan first, then the published Staff Schedule, then Team B defaults.',
    loading: 'Loading Team B reservations and staff…',
    refresh: 'Refresh Previo',
    noRooms: 'No Team B housekeeping workload was found for this date.',
    checkout: 'Checkout', daily: 'Stayover', unbooked: 'Unbooked', towel: 'Towel change', fullClean: 'Full clean', onRequest: 'On request', legend: 'Legend',
    save: 'Save Team B plan', saving: 'Saving Team B plan…', saved: 'Team B plan saved.', close: 'Close',
    alreadyPrepared: 'Saved plan',
    changed: 'The room workload changed since this date was last saved. Review the updated rooms before saving again.',
    stepStaff: '1. Working staff', stepRooms: '2. Room assignments',
    whoWorks: 'Who is working on this date?',
    whoWorksHelp: 'Scheduled staff are selected automatically. You can change this operational plan without changing the HR Staff Schedule.',
    defaultLabel: 'Default', defaultHelp: 'Auto-select when no schedule exists', scheduled: 'Staff Schedule',
    continue: 'Continue to room assignments', back: 'Back to staff', noStaff: 'Select at least one cleaner to continue.',
    firstTime: 'No saved day plan, published schedule or defaults exist yet, so all Team B staff are selected for this first plan.',
    defaultsOnly: 'Use defaults', selectAll: 'Select all', clear: 'Clear', working: 'working',
    unassigned: 'Unassigned', moveHere: 'Move selected here', moveSelectedHere: 'Move selected rooms here', clearSelection: 'Clear selection', selectedRooms: 'rooms selected', selectProperty: 'Select property', dropHere: 'Drop here', dragRoom: 'Drag room',
    selectHint: 'Rooms are grouped by property first so a cleaner is not sent back and forth between distant locations. Select one or multiple rooms, then move them together to a cleaner. Dragging a single room still works.',
    rooms: 'rooms', noMembers: 'No Team B staff are configured. Add staff from Team B · today first.',
    compatibility: 'Operational day staffing storage is not available. Published Staff Schedule staff can still be planned safely; staff overrides require the Team B database update.',
  },
  hu: {
    title: 'B csapat tervezése',
    subtitle: 'Válassza ki, kik dolgoznak. A HotelCare először a mentett B csapat tervet, majd a közzétett munkabeosztást, végül az alapértelmezett személyzetet használja.',
    loading: 'B csapat foglalások és személyzet betöltése…',
    refresh: 'Previo frissítése',
    noRooms: 'Erre a napra nem található B csapat takarítási feladat.',
    checkout: 'Kijelentkezés', daily: 'Maradó vendég', unbooked: 'Eladatlan', towel: 'Törölközőcsere', fullClean: 'Teljes takarítás', onRequest: 'Kérésre', legend: 'Jelmagyarázat',
    save: 'B csapat terv mentése', saving: 'B csapat terv mentése…', saved: 'A B csapat terve elmentve.', close: 'Bezárás',
    alreadyPrepared: 'Mentett terv',
    changed: 'A szobafeladatok megváltoztak az utolsó mentés óta. Mentés előtt ellenőrizze a frissített szobákat.',
    stepStaff: '1. Dolgozó személyzet', stepRooms: '2. Szobabeosztás',
    whoWorks: 'Ki dolgozik ezen a napon?',
    whoWorksHelp: 'A beosztott dolgozókat automatikusan kijelöljük. Az operatív terv itt módosítható az HR munkabeosztás megváltoztatása nélkül.',
    defaultLabel: 'Alapértelmezett', defaultHelp: 'Automatikus kijelölés, ha nincs beosztás', scheduled: 'Munkabeosztás',
    continue: 'Tovább a szobabeosztáshoz', back: 'Vissza a személyzethez', noStaff: 'A folytatáshoz válasszon legalább egy takarítót.',
    firstTime: 'Még nincs mentett napi terv, közzétett beosztás vagy alapértelmezett személyzet, ezért az első tervhez minden B csapattag ki van jelölve.',
    defaultsOnly: 'Alapértelmezettek', selectAll: 'Összes kijelölése', clear: 'Törlés', working: 'dolgozik',
    unassigned: 'Kiosztatlan', moveHere: 'Kijelölt áthelyezése ide', moveSelectedHere: 'Kijelölt szobák áthelyezése ide', clearSelection: 'Kijelölés törlése', selectedRooms: 'szoba kijelölve', selectProperty: 'Ingatlan kijelölése', dropHere: 'Húzza ide', dragRoom: 'Szoba húzása',
    selectHint: 'A szobákat először ingatlan szerint csoportosítjuk, hogy a takarítónak ne kelljen távoli helyszínek között ingáznia. Jelöljön ki egy vagy több szobát, majd helyezze át őket együtt egy takarítóhoz. Egy szoba továbbra is húzható.',
    rooms: 'szoba', noMembers: 'Nincs B csapat személyzet beállítva. Először adjon hozzá dolgozókat a B csapat · ma résznél.',
    compatibility: 'Az operatív napi személyzeti tároló még nem érhető el. A közzétett munkabeosztás biztonságosan használható; egyedi személyzeti felülíráshoz adatbázis-frissítés szükséges.',
  },
};

function rebalanceOwners(
  rooms: RoomForAssignment[], staff: PlannerStaff[], selectedStaffIds: Set<string>, previousOwners: Map<string, string>, preferredOwners: Map<string, string> = new Map(),
) {
  const selectedStaff = staff.filter(person => selectedStaffIds.has(person.id));
  if (selectedStaff.length === 0) return new Map<string, string>();
  const selectedIds = new Set(selectedStaff.map(person => person.id));
  const roomIds = new Set(rooms.map(room => room.id));
  const result = new Map<string, string>();
  const loads = new Map(selectedStaff.map(person => [person.id, 0]));

  // Preserve explicit/saved manager choices first.
  for (const [roomId, ownerId] of previousOwners) {
    if (!roomIds.has(roomId) || !selectedIds.has(ownerId)) continue;
    const room = rooms.find(candidate => candidate.id === roomId);
    if (!room) continue;
    result.set(roomId, ownerId);
    loads.set(ownerId, (loads.get(ownerId) || 0) + calculateRoomTime(room));
  }

  // Reuse learned property preferences only for still-unassigned properties.
  // A saved day-plan/manual room move above always wins.
  const propertyRooms = new Map<string, RoomForAssignment[]>();
  for (const room of rooms.filter(candidate => !result.has(candidate.id))) {
    const key = slntTeamBPropertyKey(room.room_number);
    const group = propertyRooms.get(key) || [];
    group.push(room);
    propertyRooms.set(key, group);
  }
  for (const [property, group] of propertyRooms) {
    const preferredOwner = preferredOwners.get(property);
    if (!preferredOwner || !selectedIds.has(preferredOwner)) continue;
    for (const room of group) result.set(room.id, preferredOwner);
    loads.set(preferredOwner, (loads.get(preferredOwner) || 0) + group.reduce((sum, room) => sum + calculateRoomTime(room), 0));
  }

  // SLNT is an apartment portfolio, not one building. Assign each physical
  // property as a batch before balancing the next property. This avoids sending
  // several cleaners to the same remote address just to equalize room counts.
  const propertyGroups = new Map<string, RoomForAssignment[]>();
  for (const room of rooms.filter(candidate => !result.has(candidate.id))) {
    const key = slntTeamBPropertyKey(room.room_number);
    const group = propertyGroups.get(key) || [];
    group.push(room);
    propertyGroups.set(key, group);
  }
  const groups = Array.from(propertyGroups.values()).sort((a, b) =>
    b.reduce((sum, room) => sum + calculateRoomTime(room), 0)
      - a.reduce((sum, room) => sum + calculateRoomTime(room), 0));

  for (const group of groups) {
    const owner = selectedStaff.reduce((best, candidate) =>
      (loads.get(candidate.id) || 0) < (loads.get(best.id) || 0) ? candidate : best, selectedStaff[0]);
    for (const room of group) result.set(room.id, owner.id);
    loads.set(owner.id, (loads.get(owner.id) || 0) + group.reduce((sum, room) => sum + calculateRoomTime(room), 0));
  }
  return result;
}

export function SlntSelectedDateAssignmentPlanner({ open, onOpenChange, selectedDate, onAssignmentCreated }: Props) {
  const { profile } = useAuth();
  const language: 'en' | 'hu' = profile?.preferred_language?.toLowerCase().startsWith('hu') ? 'hu' : 'en';
  const t = COPY[language];
  const [step, setStep] = useState<Step>('staff');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomForAssignment[]>([]);
  const [allStaff, setAllStaff] = useState<PlannerStaff[]>([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string>>(new Set());
  const [defaultStaffIds, setDefaultStaffIds] = useState<Set<string>>(new Set());
  const [staffingSource, setStaffingSource] = useState<StaffingSource>('none');
  const [supportsDayStaffing, setSupportsDayStaffing] = useState(true);
  const [owners, setOwners] = useState<Map<string, string>>(new Map());
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(new Set());
  const [existingTasks, setExistingTasks] = useState<ExistingTask[]>([]);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [preferredOwners, setPreferredOwners] = useState<Map<string, string>>(new Map());
  const plannerScrollerRef = useRef<HTMLDivElement | null>(null);
  const touchDragStartRef = useRef<{ roomId: string; roomNumber: string; startX: number; startY: number; pointerId: number } | null>(null);
  const [touchDrag, setTouchDrag] = useState<{ roomId: string; roomNumber: string; x: number; y: number; active: boolean } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const summary = useMemo(() => summarizeTeamWorkload(rooms), [rooms]);
  const workingStaff = useMemo(() => allStaff.filter(person => selectedStaffIds.has(person.id)), [allStaff, selectedStaffIds]);
  const activeExisting = useMemo(() => existingTasks.filter(task => task.status !== 'cancelled'), [existingTasks]);
  const existingChanged = useMemo(() => {
    if (activeExisting.length === 0) return false;
    if (activeExisting.length !== rooms.length) return true;
    const existingByRoom = new Map(activeExisting.map(task => [task.room_id, task.assignment_type]));
    return rooms.some(room => existingByRoom.get(room.id) !== (room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning'));
  }, [activeExisting, rooms]);

  const columns = useMemo(() => {
    const entries = [...workingStaff.map(person => ({ id: person.id, name: person.full_name })), { id: UNASSIGNED, name: t.unassigned }];
    return entries.map(entry => ({
      ...entry,
      rooms: rooms.filter(room => (owners.get(room.id) || UNASSIGNED) === entry.id)
        .sort((a, b) => {
          const rank = (room: RoomForAssignment) => room.is_checkout_room ? 0 : room.linen_change_required ? 1 : room.towel_change_required ? 2 : isUnsoldPlanningRoom(room) ? 4 : 3;
          const priority = rank(a) - rank(b);
          return priority || a.room_number.localeCompare(b.room_number, undefined, { numeric: true });
        }),
    })).filter(entry => entry.id !== UNASSIGNED || entry.rooms.length > 0);
  }, [owners, rooms, t.unassigned, workingStaff]);

  const load = async (forceFresh = true) => {
    if (!profile?.organization_slug || !profile.assigned_hotel) return;
    setLoading(true); setError(null);
    try {
      let syncData: any = null;
      if (forceFresh) {
        const nextDate = new Date(`${selectedDate}T00:00:00Z`); nextDate.setUTCDate(nextDate.getUTCDate() + 1);
        const { data, error: syncError } = await supabase.functions.invoke('slnt-sync-daily-overview', {
          body: { hotelId: 'slnt-group', fromDate: selectedDate, toDate: nextDate.toISOString().slice(0, 10), days: 1 },
        });
        if (syncError || (data as any)?.ok === false || (data as any)?.error || (data as any)?.supported === false) {
          throw new Error((data as any)?.error || syncError?.message || 'Could not load SLNT Previo data for this date.');
        }
        syncData = data;
      }

      const hotelId = 'slnt-group';
      const hotelKeys = await resolveHotelKeys(hotelId);
      const keys = Array.from(new Set([hotelId, 'SLNT Group', ...hotelKeys]));
      const teamScope = await loadActiveSlntTeamScope('slnt', hotelId);

      // Core planning data: no newer staffing schema is required here.
      const [roomResult, snapshotResult, taskResult, memberResult] = await Promise.all([
        supabase.from('rooms').select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time').in('hotel', keys),
        (supabase as any).from('daily_overview_snapshots').select('room_label,room_number,arrival_date,departure_date,status,housekeeping_dep,housekeeping_stay,captured_at').eq('organization_slug', 'slnt').eq('hotel_id', hotelId).eq('business_date', selectedDate).eq('source', 'previo'),
        (supabase as any).from('housekeeping_team_tasks').select('room_id,assignment_type,status,planned_candidate_user_id').eq('organization_slug', 'slnt').eq('hotel_id', hotelId).eq('service_date', selectedDate),
        (supabase as any).from('housekeeping_team_members').select('user_id').eq('team_id', teamScope.teamId).eq('is_active', true),
      ]);
      if (roomResult.error) throw roomResult.error;
      if (snapshotResult.error) throw snapshotResult.error;
      if (taskResult.error) throw taskResult.error;
      if (memberResult.error) throw memberResult.error;

      const memberIds = (memberResult.data || []).map((row: any) => row.user_id as string);
      if (memberIds.length === 0) throw new Error(t.noMembers);

      const [profileResult, scheduleResult, preferenceResult] = await Promise.all([
        (supabase as any).from('profiles').select('id,full_name').in('id', memberIds).is('deleted_at', null),
        (supabase as any).from('staff_schedules').select('user_id,status').eq('organization_slug', 'slnt').eq('work_date', selectedDate).in('user_id', memberIds),
        (supabase as any).from('housekeeping_team_property_preferences').select('property_key,user_id').eq('team_id', teamScope.teamId),
      ]);
      const nameMap = new Map((profileResult.data || []).map((person: any) => [person.id, person.full_name]));
      const publishedIds = new Set<string>((scheduleResult.error ? [] : (scheduleResult.data || []))
        .filter((row: any) => row.status === 'published').map((row: any) => row.user_id));
      const preferences = new Map<string, string>();
      if (!preferenceResult.error) {
        for (const row of preferenceResult.data || []) preferences.set(String(row.property_key), String(row.user_id));
      } else if (!isMissingTeamBOptionalSchemaError(preferenceResult.error)) {
        console.warn('[SlntSelectedDateAssignmentPlanner] property preferences unavailable:', preferenceResult.error);
      }
      setPreferredOwners(preferences);

      let defaults = new Set<string>();
      const defaultsResult = await (supabase as any).from('housekeeping_team_members')
        .select('user_id,is_default').eq('team_id', teamScope.teamId).eq('is_active', true);
      if (!defaultsResult.error) {
        defaults = new Set<string>((defaultsResult.data || []).filter((row: any) => row.is_default).map((row: any) => row.user_id));
      } else if (!isMissingTeamBOptionalSchemaError(defaultsResult.error)) {
        console.warn('[SlntSelectedDateAssignmentPlanner] defaults unavailable:', defaultsResult.error);
      }

      let dayIds = new Set<string>();
      let dayStaffSupported = true;
      const dayStaffResult = await (supabase as any).from('housekeeping_team_day_staff')
        .select('user_id').eq('team_id', teamScope.teamId).eq('service_date', selectedDate);
      if (!dayStaffResult.error) {
        dayIds = new Set<string>((dayStaffResult.data || []).map((row: any) => row.user_id));
      } else if (isMissingTeamBOptionalSchemaError(dayStaffResult.error)) {
        dayStaffSupported = false;
      } else {
        console.warn('[SlntSelectedDateAssignmentPlanner] day staffing unavailable:', dayStaffResult.error);
      }
      setSupportsDayStaffing(dayStaffSupported);

      const tasks = (taskResult.data || []) as ExistingTask[];
      const taskOwners = new Set<string>(tasks.filter(task => task.status !== 'cancelled' && !!task.planned_candidate_user_id).map(task => task.planned_candidate_user_id as string));
      const explicitIds = dayIds.size > 0 ? dayIds : taskOwners;
      const staffing = resolveTeamBOperationalStaffing({
        memberIds,
        dayPlanIds: explicitIds,
        publishedIds,
        defaultIds: defaults,
        allowMemberFallback: true,
      });
      const selected = staffing.selectedIds;
      setStaffingSource(staffing.source);

      const staffRows: PlannerStaff[] = memberIds.map(id => ({
        id,
        full_name: (nameMap.get(id) as string | undefined) || `Team B · ${id.slice(0, 8)}`,
        is_default: defaults.has(id),
        from_schedule: publishedIds.has(id),
      })).sort((a, b) => a.full_name.localeCompare(b.full_name));

      const mappedRooms = filterRoomsToMappedTeam(roomResult.data || [], teamScope.roomIds);
      if (mappedRooms.length !== teamScope.roomIds.length) throw new Error(`Team B room registry is incomplete: ${mappedRooms.length}/${teamScope.roomIds.length} mapped rooms are available.`);
      const scopedSnapshot = filterSnapshotRowsToMappedRooms((snapshotResult.data || []) as DailyOverviewWorkRow[], mappedRooms);
      const workload = buildSelectedDateHousekeepingWorkload(mappedRooms, scopedSnapshot, selectedDate);
      const savedOwners = new Map<string, string>(tasks.flatMap(task =>
        task.status !== 'cancelled' && task.planned_candidate_user_id && selected.has(task.planned_candidate_user_id)
          ? [[task.room_id, task.planned_candidate_user_id] as [string, string]] : []));

      setRooms(workload.rooms); setAllStaff(staffRows); setSelectedStaffIds(selected); setDefaultStaffIds(defaults);
      setOwners(rebalanceOwners(workload.rooms, staffRows, selected, savedOwners, preferences));
      setExistingTasks(tasks); setCapturedAt(syncData?.capturedAt || workload.capturedAt || null);
      setSelectedRoomIds(new Set()); setStep('staff');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not prepare Team B for this date.';
      console.error('[SlntSelectedDateAssignmentPlanner] load failed:', cause);
      setError(message); setRooms([]); setAllStaff([]); setSelectedStaffIds(new Set()); setDefaultStaffIds(new Set()); setOwners(new Map()); setExistingTasks([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { if (open) void load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, selectedDate]);

  const toggleWorking = (userId: string, checked: boolean) => setSelectedStaffIds(previous => {
    const next = new Set(previous); if (checked) next.add(userId); else next.delete(userId); return next;
  });
  const toggleDefault = (userId: string, checked: boolean) => {
    setDefaultStaffIds(previous => { const next = new Set(previous); if (checked) next.add(userId); else next.delete(userId); return next; });
    if (checked) toggleWorking(userId, true);
  };
  const continueToRooms = () => {
    if (selectedStaffIds.size === 0) { toast.warning(t.noStaff); return; }
    setOwners(previous => rebalanceOwners(rooms, allStaff, selectedStaffIds, previous, preferredOwners)); setSelectedRoomIds(new Set()); setStep('rooms');
  };
  const moveRooms = (roomIds: Iterable<string>, staffId: string) => {
    const ids = Array.from(roomIds);
    setOwners(previous => {
      const next = new Map(previous);
      for (const roomId of ids) {
        if (staffId === UNASSIGNED) next.delete(roomId); else next.set(roomId, staffId);
      }
      return next;
    });
    setSelectedRoomIds(new Set());
  };
  const moveRoom = (roomId: string, staffId: string) => moveRooms([roomId], staffId);
  const resolveDropTarget = (clientX: number, clientY: number) => {
    const target = document.elementFromPoint(clientX, clientY)?.closest('[data-team-drop-id]') as HTMLElement | null;
    return target?.dataset.teamDropId || null;
  };
  const beginTouchDrag = (event: React.PointerEvent<HTMLButtonElement>, room: RoomForAssignment) => {
    if (event.pointerType === 'mouse') return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    touchDragStartRef.current = {
      roomId: room.id,
      roomNumber: room.room_number,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
    };
    setTouchDrag({ roomId: room.id, roomNumber: room.room_number, x: event.clientX, y: event.clientY, active: false });
  };
  const updateTouchDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = touchDragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - start.startX, event.clientY - start.startY);
    if (distance < 8 && !touchDrag?.active) return;
    event.preventDefault();

    const scroller = plannerScrollerRef.current;
    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      const edge = 44;
      if (event.clientX < bounds.left + edge) scroller.scrollBy({ left: -22, behavior: 'auto' });
      else if (event.clientX > bounds.right - edge) scroller.scrollBy({ left: 22, behavior: 'auto' });
    }

    setTouchDrag({ roomId: start.roomId, roomNumber: start.roomNumber, x: event.clientX, y: event.clientY, active: true });
    setDropTargetId(resolveDropTarget(event.clientX, event.clientY));
  };
  const finishTouchDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = touchDragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const targetId = resolveDropTarget(event.clientX, event.clientY) || dropTargetId;
    if (touchDrag?.active && targetId) {
      event.preventDefault();
      event.stopPropagation();
      moveRoom(start.roomId, targetId);
    }
    touchDragStartRef.current = null;
    setTouchDrag(null);
    setDropTargetId(null);
  };
  const toggleRoomSelection = (roomId: string) => setSelectedRoomIds(previous => {
    const next = new Set(previous);
    if (next.has(roomId)) next.delete(roomId); else next.add(roomId);
    return next;
  });
  const togglePropertySelection = (propertyRooms: RoomForAssignment[]) => setSelectedRoomIds(previous => {
    const next = new Set(previous);
    const allSelected = propertyRooms.every(room => next.has(room.id));
    for (const room of propertyRooms) allSelected ? next.delete(room.id) : next.add(room.id);
    return next;
  });

  const savePlan = async () => {
    if (selectedStaffIds.size === 0) { toast.warning(t.noStaff); setStep('staff'); return; }
    setSaving(true);
    try {
      const tasks = rooms.map(room => ({
        room_id: room.id,
        assignment_type: room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning',
        priority: isUnsoldPlanningRoom(room) ? 3 : room.is_checkout_room ? 1 : 2,
        estimated_duration: calculateRoomTime(room),
        notes: isUnsoldPlanningRoom(room) ? 'Unbooked at planning sync — revalidate before cleaning.' : null,
        planned_candidate_user_id: owners.get(room.id) || null,
      }));

      let saved = false;
      if (supportsDayStaffing) {
        const { data, error: saveError } = await (supabase as any).rpc('prepare_slnt_team_b_day_plan', {
          p_service_date: selectedDate,
          p_staff_ids: Array.from(selectedStaffIds),
          p_default_staff_ids: Array.from(defaultStaffIds),
          p_tasks: tasks,
        });
        if (!saveError) {
          const row = Array.isArray(data) ? data[0] : data;
          toast.success(`${t.saved}${row?.queued_count !== undefined ? ` ${row.queued_count} ${t.rooms}.` : ''}`);
          saved = true;
        } else if (!isMissingTeamBOptionalSchemaError(saveError)) {
          throw saveError;
        }
      }

      if (!saved) {
        // Compatibility mode can still save room ownership safely through the legacy
        // task RPC. It cannot persist a custom day-staff override until the new
        // migration is applied, but it must not block an otherwise valid plan.
        const { error: legacyError } = await (supabase as any).rpc('prepare_slnt_team_b_tasks', {
          p_service_date: selectedDate,
          p_tasks: tasks,
        });
        if (legacyError) throw legacyError;
        toast.success(t.saved);
      }
      // Learn the manager's final physical-property choices for future Auto Assign.
      // Only learn an unambiguous property: every room at that property must end
      // with the same selected cleaner. This avoids learning accidental splits.
      const roomsByProperty = new Map<string, RoomForAssignment[]>();
      for (const room of rooms) {
        const key = slntTeamBPropertyKey(room.room_number);
        const group = roomsByProperty.get(key) || [];
        group.push(room); roomsByProperty.set(key, group);
      }
      const preferences = Array.from(roomsByProperty.entries()).flatMap(([property_key, propertyRooms]) => {
        const staffIds = new Set(propertyRooms.map(room => owners.get(room.id)).filter(Boolean) as string[]);
        return staffIds.size === 1 ? [{ property_key, user_id: Array.from(staffIds)[0] }] : [];
      });
      if (preferences.length > 0) {
        const { error: preferenceError } = await (supabase as any).rpc('save_slnt_team_b_property_preferences', {
          p_preferences: preferences,
        });
        if (preferenceError && !isMissingTeamBOptionalSchemaError(preferenceError)) {
          console.warn('[SlntSelectedDateAssignmentPlanner] could not learn property preferences:', preferenceError);
        }
      }
      onAssignmentCreated(rooms.length, selectedStaffIds.size); onOpenChange(false);
    } catch (cause) {
      console.error('[SlntSelectedDateAssignmentPlanner] save failed:', cause);
      toast.error(cause instanceof Error ? cause.message : 'Could not save Team B plan.');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[96dvh] max-h-[96dvh] w-[99vw] max-w-none flex-col overflow-hidden p-0">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden p-3 pb-24 sm:p-4 sm:pb-24">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-lg sm:text-xl">
            <CalendarClock className="h-5 w-5 text-primary" />{t.title}<Badge variant="outline">{selectedDate}</Badge>
            {activeExisting.length > 0 && <Badge className="bg-emerald-600"><Check className="mr-1 h-3 w-3" />{t.alreadyPrepared}</Badge>}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </DialogHeader>

        <div className="flex flex-shrink-0 items-center gap-2 border-b pb-3">
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${step === 'staff' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{t.stepStaff}</div>
          <div className="h-px w-5 bg-border" />
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${step === 'rooms' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{t.stepRooms}</div>
        </div>

        {loading ? (
          <div className="flex min-h-0 flex-1 items-start justify-center pt-5"><div className="w-full max-w-xl rounded-2xl border bg-card p-5"><div className="flex items-center gap-3"><Loader2 className="h-6 w-6 animate-spin text-primary" /><div><p className="font-semibold">{t.loading}</p><p className="mt-1 text-sm text-muted-foreground">{selectedDate}</p></div></div></div></div>
        ) : error ? (
          <div className="flex min-h-0 flex-1 items-start justify-center pt-5"><div className="w-full max-w-xl rounded-2xl border border-destructive/30 bg-destructive/5 p-5"><div className="flex gap-3"><AlertCircle className="mt-0.5 h-5 w-5 text-destructive" /><div className="min-w-0"><p className="font-semibold">{error}</p><Button className="mt-4" variant="outline" onClick={() => void load(true)}><RefreshCw className="mr-2 h-4 w-4" />{t.refresh}</Button></div></div></div></div>
        ) : step === 'staff' ? (
          <div className="min-h-0 flex-1 overflow-y-auto py-4">
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="rounded-2xl border bg-card p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div><h3 className="text-lg font-semibold">{t.whoWorks}</h3><p className="mt-1 text-sm text-muted-foreground">{t.whoWorksHelp}</p></div>
                  <Badge variant="secondary">{selectedStaffIds.size} {t.working}</Badge>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">Starting point: {staffingSourceLabel(staffingSource)}</div>
                {!supportsDayStaffing && <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{t.compatibility}</div>}
                {staffingSource === 'members' && <div className="mt-3 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">{t.firstTime}</div>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSelectedStaffIds(new Set(allStaff.map(person => person.id)))}>{t.selectAll}</Button>
                  {defaultStaffIds.size > 0 && <Button size="sm" variant="outline" onClick={() => setSelectedStaffIds(new Set(defaultStaffIds))}>{t.defaultsOnly}</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setSelectedStaffIds(new Set())}>{t.clear}</Button>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {allStaff.map(person => (
                    <div key={person.id} className={`rounded-xl border p-3 ${selectedStaffIds.has(person.id) ? 'border-primary/50 bg-primary/[0.04]' : 'bg-background'}`}>
                      <label className="flex cursor-pointer items-start gap-3">
                        <Checkbox className="mt-0.5" checked={selectedStaffIds.has(person.id)} onCheckedChange={checked => toggleWorking(person.id, checked === true)} />
                        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{person.full_name}</span>{person.from_schedule && <Badge variant="secondary" className="text-[10px]">{t.scheduled}</Badge>}</div></div>
                      </label>
                      {supportsDayStaffing && <button type="button" onClick={() => toggleDefault(person.id, !defaultStaffIds.has(person.id))} className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><Star className={`h-3.5 w-3.5 ${defaultStaffIds.has(person.id) ? 'fill-current text-amber-500' : ''}`} />{t.defaultLabel} · {t.defaultHelp}</button>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-xl border bg-card p-3"><strong className="block text-xl">{summary.confirmedCheckoutCount}</strong>{t.checkout}</div>
                <div className="rounded-xl border bg-card p-3"><strong className="block text-xl">{summary.dailyCount}</strong>{t.daily}</div>
                <div className="rounded-xl border bg-card p-3"><strong className="block text-xl">{summary.unsoldCount}</strong>{t.unbooked}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 py-2">
            {existingChanged && <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{t.changed}</div>}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">{t.selectHint}</span>{capturedAt && <span className="text-xs text-muted-foreground">PMS: {new Date(capturedAt).toLocaleString()}</span>}</div>
            {selectedRoomIds.size > 0 && <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.04] px-3 py-2 text-xs"><Layers3 className="h-4 w-4 text-primary" /><strong>{selectedRoomIds.size} {t.selectedRooms}</strong><Button size="sm" variant="ghost" className="h-7" onClick={() => setSelectedRoomIds(new Set())}>{t.clearSelection}</Button></div>}
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <span className="font-semibold text-foreground">{t.legend}</span>
              <span className="text-amber-700">■ {t.checkout}</span>
              <span className="text-orange-700">T · {t.towel}</span>
              <span className="text-rose-700">C · {t.fullClean}</span>
              <span className="text-blue-700">■ {t.onRequest}</span>
              <span className="text-violet-700">■ {t.unbooked}</span>
            </div>
            {rooms.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">{t.noRooms}</div> : (
              <div ref={plannerScrollerRef} className="flex min-h-0 w-full snap-x snap-mandatory gap-2 overflow-x-auto pb-3 md:grid md:snap-none md:overflow-visible" style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))` }}>
                {columns.map(column => {
                  const isDropTarget = dropTargetId === column.id;
                  return (
                  <section
                    key={column.id}
                    data-team-drop-id={column.id}
                    className={`flex w-[72vw] min-w-[190px] max-w-[240px] snap-start flex-col rounded-lg border bg-card transition-all duration-200 md:w-auto md:min-w-0 md:max-w-none ${isDropTarget ? 'scale-[1.01] border-primary bg-primary/[0.05] shadow-lg ring-2 ring-primary/30' : ''}`}
                    onDragOver={event => { event.preventDefault(); setDropTargetId(column.id); }}
                    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTargetId(null); }}
                    onDrop={event => {
                      event.preventDefault();
                      const roomId = event.dataTransfer.getData('text/plain');
                      if (roomId) moveRoom(roomId, column.id);
                      setDropTargetId(null);
                    }}
                  >
                    <div className={`border-b px-2 py-1.5 transition-colors ${isDropTarget ? 'bg-primary/10' : ''}`}>
                      <div className="flex items-center justify-between gap-1">
                        <div className="min-w-0 truncate text-sm font-semibold">{column.name}</div>
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{column.rooms.length}</Badge>
                      </div>
                      <div className="text-[10px] text-muted-foreground">≈ {Math.round(column.rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0) / 60 * 10) / 10}h</div>
                      {isDropTarget && <div className="mt-1 rounded bg-primary px-2 py-1 text-center text-[10px] font-semibold text-primary-foreground animate-pulse">{t.dropHere}</div>}
                      {selectedRoomIds.size > 0 && <Button className="mt-1 h-6 w-full px-1 text-[10px]" size="sm" variant="outline" onClick={() => moveRooms(selectedRoomIds, column.id)}>{selectedRoomIds.size > 1 ? `${t.moveSelectedHere} (${selectedRoomIds.size})` : t.moveHere}</Button>}
                    </div>
                    <div className="min-h-0 flex-1 space-y-1 p-1.5">
                      {Array.from(new Map(column.rooms.map(room => [slntTeamBPropertyKey(room.room_number), column.rooms.filter(candidate => slntTeamBPropertyKey(candidate.room_number) === slntTeamBPropertyKey(room.room_number))])).entries()).flatMap(([property, propertyRooms]) => [
                        <button key={`property-${column.id}-${property}`} type="button" className="mt-1 flex w-full items-center justify-between gap-2 rounded bg-muted/60 px-2 py-1 text-[10px] font-semibold hover:bg-muted" onClick={() => togglePropertySelection(propertyRooms)}>
                          <span className="min-w-0 flex-1 truncate text-left">{property}</span><span className="shrink-0">{t.selectProperty} · {propertyRooms.length}</span>
                        </button>,
                        ...propertyRooms.map(room => {
                        const unsold = isUnsoldPlanningRoom(room); const selected = selectedRoomIds.has(room.id);
                        const serviceLabel = room.is_checkout_room ? t.checkout : room.linen_change_required ? t.fullClean : room.towel_change_required ? t.towel : unsold ? t.unbooked : t.onRequest;
                        const serviceCode = room.is_checkout_room ? null : room.linen_change_required ? 'C' : room.towel_change_required ? 'T' : null;
                        const serviceClass = room.is_checkout_room ? 'bg-amber-100 text-amber-800' : room.linen_change_required ? 'bg-rose-100 text-rose-800' : room.towel_change_required ? 'bg-orange-100 text-orange-800' : unsold ? 'bg-violet-100 text-violet-800' : 'bg-blue-100 text-blue-800';
                        const isTouchDragging = touchDrag?.active && touchDrag.roomId === room.id;
                        return (
                          <div
                            key={room.id}
                            role="button"
                            tabIndex={0}
                            draggable
                            onDragStart={event => {
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData('text/plain', room.id);
                            }}
                            onDragEnd={() => setDropTargetId(null)}
                            onClick={() => { if (!touchDrag?.active) toggleRoomSelection(room.id); }}
                            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleRoomSelection(room.id); } }}
                            className={`flex w-full items-center gap-1 rounded border px-1.5 py-1 text-left text-[11px] leading-tight transition-all duration-200 ${isTouchDragging ? 'opacity-30 scale-95' : ''} ${selected ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'bg-background hover:border-primary/50'}`}
                            title={serviceLabel}
                          >
                            <button
                              type="button"
                              aria-label={`${t.dragRoom}: ${room.room_number}`}
                              className="flex h-7 w-7 shrink-0 touch-none items-center justify-center rounded text-muted-foreground active:scale-95 active:bg-muted"
                              onClick={event => event.stopPropagation()}
                              onPointerDown={event => beginTouchDrag(event, room)}
                              onPointerMove={updateTouchDrag}
                              onPointerUp={finishTouchDrag}
                              onPointerCancel={() => { touchDragStartRef.current = null; setTouchDrag(null); setDropTargetId(null); }}
                            >
                              <GripVertical className="h-4 w-4" />
                            </button>
                            <span className="min-w-0 flex-1 truncate font-medium">{room.room_number}</span>
                            {serviceCode && <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${serviceClass}`}>{serviceCode}</span>}
                            <span className={`max-w-[86px] truncate rounded px-1 py-0.5 text-[9px] font-medium ${serviceClass}`}>{serviceLabel}</span>
                          </div>
                        );
                        }),
                      ])}
                    </div>
                  </section>
                  );
                })}
              </div>
            )}
          </div>
        )}

        </div>
        {touchDrag?.active && (
          <div
            className="pointer-events-none fixed z-[100] flex max-w-[220px] items-center gap-2 rounded-xl border border-primary/40 bg-background/95 px-3 py-2 text-sm font-semibold shadow-2xl ring-2 ring-primary/20 backdrop-blur transition-transform duration-75"
            style={{ left: Math.min(touchDrag.x + 14, window.innerWidth - 230), top: Math.max(12, touchDrag.y - 24) }}
          >
            <GripVertical className="h-4 w-4 text-primary" />
            <span className="truncate">{touchDrag.roomNumber}</span>
          </div>
        )}
        <DialogFooter className="absolute inset-x-0 bottom-0 z-20 flex-shrink-0 gap-2 border-t bg-background/95 px-4 py-3 shadow-[0_-8px_20px_rgba(0,0,0,0.06)] backdrop-blur sm:justify-between">
          <div>{step === 'rooms' && <Button variant="outline" onClick={() => setStep('staff')}><ArrowLeft className="mr-2 h-4 w-4" />{t.back}</Button>}</div>
          <div className="flex gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>{t.close}</Button>{step === 'staff' ? <Button disabled={selectedStaffIds.size === 0 || rooms.length === 0} onClick={continueToRooms}><Wand2 className="mr-2 h-4 w-4" />{t.continue}</Button> : <Button disabled={saving || !!error || rooms.length === 0} onClick={() => void savePlan()}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}{saving ? t.saving : t.save}</Button>}</div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

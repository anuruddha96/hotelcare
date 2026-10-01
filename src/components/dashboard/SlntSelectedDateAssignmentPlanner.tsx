import { useEffect, useMemo, useState } from 'react';
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
} from '@/lib/slntTeamHousekeepingScope';
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
};

type Step = 'staff' | 'rooms';

const UNASSIGNED = '__unassigned__';

const COPY = {
  en: {
    title: 'Plan Team B',
    subtitle: 'Choose who is working first. HotelCare will then balance the rooms automatically, and you can make changes before saving.',
    loading: 'Loading Team B reservations and cleaners…',
    refresh: 'Refresh Previo',
    noRooms: 'No Team B housekeeping workload was found for this date.',
    checkout: 'Checkout',
    daily: 'Daily',
    unbooked: 'Unbooked',
    save: 'Save Team B plan',
    saving: 'Saving Team B plan…',
    saved: 'Team B plan saved.',
    close: 'Close',
    alreadyPrepared: 'Saved plan',
    changed: 'The room workload changed since this date was last saved. Review the updated rooms before saving again.',
    stepStaff: '1. Working staff',
    stepRooms: '2. Room assignments',
    whoWorks: 'Who is working on this date?',
    whoWorksHelp: 'Tick the cleaners working this day. Default staff are automatically selected on new dates, but you can untick them for a day off.',
    defaultLabel: 'Default',
    defaultHelp: 'Auto-select on new dates',
    continue: 'Continue to room assignments',
    back: 'Back to staff',
    noStaff: 'Select at least one cleaner to continue.',
    firstTime: 'No default staff are set yet. All Team B cleaners are selected for this first plan. Mark your usual cleaners as Default once and future dates will start with them selected.',
    defaultsOnly: 'Use defaults',
    selectAll: 'Select all',
    clear: 'Clear',
    working: 'working',
    unassigned: 'Unassigned',
    moveHere: 'Move selected here',
    selectHint: 'Rooms were balanced automatically. Drag a room to another cleaner, or tap a room and then “Move selected here”.',
    rooms: 'rooms',
  },
  hu: {
    title: 'B csapat tervezése',
    subtitle: 'Először válassza ki, kik dolgoznak. A HotelCare ezután automatikusan kiegyensúlyozza a szobákat, majd mentés előtt módosíthatja a beosztást.',
    loading: 'B csapat foglalások és takarítók betöltése…',
    refresh: 'Previo frissítése',
    noRooms: 'Erre a napra nem található B csapat takarítási feladat.',
    checkout: 'Kijelentkezés',
    daily: 'Napi',
    unbooked: 'Eladatlan',
    save: 'B csapat terv mentése',
    saving: 'B csapat terv mentése…',
    saved: 'A B csapat terve elmentve.',
    close: 'Bezárás',
    alreadyPrepared: 'Mentett terv',
    changed: 'A szobafeladatok megváltoztak az utolsó mentés óta. Mentés előtt ellenőrizze a frissített szobákat.',
    stepStaff: '1. Dolgozó személyzet',
    stepRooms: '2. Szobabeosztás',
    whoWorks: 'Ki dolgozik ezen a napon?',
    whoWorksHelp: 'Jelölje ki az aznap dolgozó takarítókat. Az alapértelmezett dolgozókat az új napokon automatikusan kijelöljük, de szabadnap esetén kikapcsolhatja őket.',
    defaultLabel: 'Alapértelmezett',
    defaultHelp: 'Új napokon automatikusan kijelölve',
    continue: 'Tovább a szobabeosztáshoz',
    back: 'Vissza a személyzethez',
    noStaff: 'A folytatáshoz válasszon legalább egy takarítót.',
    firstTime: 'Még nincs alapértelmezett személyzet. Ennél az első tervnél minden B csapattag ki van jelölve. Jelölje meg egyszer a szokásos dolgozókat Alapértelmezettként, és a jövőbeli napok velük indulnak.',
    defaultsOnly: 'Alapértelmezettek',
    selectAll: 'Összes kijelölése',
    clear: 'Törlés',
    working: 'dolgozik',
    unassigned: 'Kiosztatlan',
    moveHere: 'Kijelölt áthelyezése ide',
    selectHint: 'A szobákat automatikusan kiegyensúlyoztuk. Húzza a szobát másik takarítóhoz, vagy koppintson rá, majd válassza az „Áthelyezés ide” lehetőséget.',
    rooms: 'szoba',
  },
};

function rebalanceOwners(
  rooms: RoomForAssignment[],
  staff: PlannerStaff[],
  selectedStaffIds: Set<string>,
  previousOwners: Map<string, string>,
): Map<string, string> {
  const selectedStaff = staff.filter(person => selectedStaffIds.has(person.id));
  if (selectedStaff.length === 0) return new Map();

  const selectedIds = new Set(selectedStaff.map(person => person.id));
  const roomIds = new Set(rooms.map(room => room.id));
  const result = new Map<string, string>();
  const loads = new Map(selectedStaff.map(person => [person.id, 0]));

  for (const [roomId, ownerId] of previousOwners) {
    if (!roomIds.has(roomId) || !selectedIds.has(ownerId)) continue;
    const room = rooms.find(candidate => candidate.id === roomId);
    if (!room) continue;
    result.set(roomId, ownerId);
    loads.set(ownerId, (loads.get(ownerId) || 0) + calculateRoomTime(room));
  }

  const remaining = rooms
    .filter(room => !result.has(room.id))
    .sort((a, b) => calculateRoomTime(b) - calculateRoomTime(a));

  for (const room of remaining) {
    const owner = selectedStaff.reduce((best, candidate) =>
      (loads.get(candidate.id) || 0) < (loads.get(best.id) || 0) ? candidate : best,
    selectedStaff[0]);
    result.set(room.id, owner.id);
    loads.set(owner.id, (loads.get(owner.id) || 0) + calculateRoomTime(room));
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
  const [owners, setOwners] = useState<Map<string, string>>(new Map());
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [existingTasks, setExistingTasks] = useState<ExistingTask[]>([]);
  const [hasSavedDayStaff, setHasSavedDayStaff] = useState(false);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);

  const summary = useMemo(() => summarizeTeamWorkload(rooms), [rooms]);
  const workingStaff = useMemo(
    () => allStaff.filter(person => selectedStaffIds.has(person.id)),
    [allStaff, selectedStaffIds],
  );
  const activeExisting = useMemo(() => existingTasks.filter(task => task.status !== 'cancelled'), [existingTasks]);
  const existingChanged = useMemo(() => {
    if (activeExisting.length === 0) return false;
    if (activeExisting.length !== rooms.length) return true;
    const currentTypes = new Map(rooms.map(room => [room.id, room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning']));
    const existingByRoom = new Map(activeExisting.map(task => [task.room_id, task.assignment_type]));
    return rooms.some(room => existingByRoom.get(room.id) !== currentTypes.get(room.id));
  }, [activeExisting, rooms]);

  const columns = useMemo(() => {
    const entries = [
      ...workingStaff.map(person => ({ id: person.id, name: person.full_name, person })),
      { id: UNASSIGNED, name: t.unassigned, person: null },
    ];
    return entries.map(entry => ({
      ...entry,
      rooms: rooms
        .filter(room => (owners.get(room.id) || UNASSIGNED) === entry.id)
        .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })),
    })).filter(entry => entry.id !== UNASSIGNED || entry.rooms.length > 0);
  }, [owners, rooms, t.unassigned, workingStaff]);

  const load = async (forceFresh = true) => {
    if (!profile?.organization_slug || !profile.assigned_hotel) return;
    setLoading(true);
    setError(null);
    try {
      let syncData: any = null;
      if (forceFresh) {
        const nextDate = new Date(`${selectedDate}T00:00:00Z`);
        nextDate.setUTCDate(nextDate.getUTCDate() + 1);
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

      const [roomResult, snapshotResult, taskResult, memberResult, dayStaffResult] = await Promise.all([
        supabase.from('rooms')
          .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
          .in('hotel', keys),
        (supabase as any).from('daily_overview_snapshots')
          .select('room_label,room_number,arrival_date,departure_date,status,housekeeping_dep,housekeeping_stay,captured_at')
          .eq('organization_slug', 'slnt').eq('hotel_id', hotelId).eq('business_date', selectedDate).eq('source', 'previo'),
        (supabase as any).from('housekeeping_team_tasks')
          .select('room_id,assignment_type,status,planned_candidate_user_id')
          .eq('organization_slug', 'slnt').eq('hotel_id', hotelId).eq('service_date', selectedDate),
        (supabase as any).from('housekeeping_team_members')
          .select('user_id,is_default').eq('team_id', teamScope.teamId).eq('is_active', true),
        (supabase as any).from('housekeeping_team_day_staff')
          .select('user_id').eq('team_id', teamScope.teamId).eq('service_date', selectedDate),
      ]);
      if (roomResult.error) throw roomResult.error;
      if (snapshotResult.error) throw snapshotResult.error;
      if (taskResult.error) throw taskResult.error;
      if (memberResult.error) throw memberResult.error;
      if (dayStaffResult.error) throw dayStaffResult.error;

      const members = (memberResult.data || []) as Array<{ user_id: string; is_default: boolean }>;
      const memberIds = members.map(row => row.user_id);
      const profileResult = memberIds.length
        ? await (supabase as any).from('profiles').select('id,full_name').in('id', memberIds).is('deleted_at', null)
        : { data: [], error: null };
      if (profileResult.error) throw profileResult.error;

      const defaultIds = new Set(members.filter(row => row.is_default).map(row => row.user_id));
      const staffRows: PlannerStaff[] = (profileResult.data || [])
        .map((person: any) => ({
          id: person.id,
          full_name: person.full_name,
          is_default: defaultIds.has(person.id),
        }))
        .sort((a: PlannerStaff, b: PlannerStaff) => a.full_name.localeCompare(b.full_name));

      const savedDayIds = new Set((dayStaffResult.data || []).map((row: any) => row.user_id));
      const tasks = (taskResult.data || []) as ExistingTask[];
      const savedTaskOwners = new Set(tasks
        .filter(task => task.status !== 'cancelled' && !!task.planned_candidate_user_id)
        .map(task => task.planned_candidate_user_id as string));

      let initialSelected = new Set<string>();
      if (savedDayIds.size > 0) initialSelected = savedDayIds;
      else if (savedTaskOwners.size > 0) initialSelected = savedTaskOwners;
      else if (defaultIds.size > 0) initialSelected = defaultIds;
      else initialSelected = new Set(staffRows.map(person => person.id));

      const validMemberIds = new Set(staffRows.map(person => person.id));
      initialSelected = new Set(Array.from(initialSelected).filter(id => validMemberIds.has(id)));

      const mappedRooms = filterRoomsToMappedTeam(roomResult.data || [], teamScope.roomIds);
      if (mappedRooms.length !== teamScope.roomIds.length) {
        throw new Error(`Team B room registry is incomplete: ${mappedRooms.length}/${teamScope.roomIds.length} mapped rooms are available.`);
      }
      const scopedSnapshot = filterSnapshotRowsToMappedRooms((snapshotResult.data || []) as DailyOverviewWorkRow[], mappedRooms);
      const workload = buildSelectedDateHousekeepingWorkload(mappedRooms, scopedSnapshot, selectedDate);
      const savedOwners = new Map(tasks.flatMap(task =>
        task.status !== 'cancelled' && task.planned_candidate_user_id && initialSelected.has(task.planned_candidate_user_id)
          ? [[task.room_id, task.planned_candidate_user_id] as [string, string]]
          : []
      ));

      setRooms(workload.rooms);
      setAllStaff(staffRows);
      setSelectedStaffIds(initialSelected);
      setDefaultStaffIds(defaultIds);
      setOwners(rebalanceOwners(workload.rooms, staffRows, initialSelected, savedOwners));
      setExistingTasks(tasks);
      setHasSavedDayStaff(savedDayIds.size > 0);
      setCapturedAt(syncData?.capturedAt || workload.capturedAt || null);
      setSelectedRoomId(null);
      setStep('staff');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not prepare Team B for this date.';
      console.error('[SlntSelectedDateAssignmentPlanner] load failed:', cause);
      setError(message);
      setRooms([]);
      setAllStaff([]);
      setSelectedStaffIds(new Set());
      setDefaultStaffIds(new Set());
      setOwners(new Map());
      setExistingTasks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedDate]);

  const toggleWorking = (userId: string, checked: boolean) => {
    setSelectedStaffIds(previous => {
      const next = new Set(previous);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  };

  const toggleDefault = (userId: string, checked: boolean) => {
    setDefaultStaffIds(previous => {
      const next = new Set(previous);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
    if (checked) toggleWorking(userId, true);
  };

  const continueToRooms = () => {
    if (selectedStaffIds.size === 0) {
      toast.warning(t.noStaff);
      return;
    }
    setOwners(previous => rebalanceOwners(rooms, allStaff, selectedStaffIds, previous));
    setSelectedRoomId(null);
    setStep('rooms');
  };

  const moveRoom = (roomId: string, staffId: string) => {
    setOwners(previous => {
      const next = new Map(previous);
      if (staffId === UNASSIGNED) next.delete(roomId);
      else next.set(roomId, staffId);
      return next;
    });
    setSelectedRoomId(null);
  };

  const savePlan = async () => {
    if (selectedStaffIds.size === 0) {
      toast.warning(t.noStaff);
      setStep('staff');
      return;
    }
    setSaving(true);
    try {
      const tasks = rooms.map(room => {
        const unsold = isUnsoldPlanningRoom(room);
        return {
          room_id: room.id,
          assignment_type: room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning',
          priority: unsold ? 3 : room.is_checkout_room ? 1 : 2,
          estimated_duration: calculateRoomTime(room),
          notes: unsold ? 'Unbooked at planning sync — revalidate before cleaning.' : null,
          planned_candidate_user_id: owners.get(room.id) || null,
        };
      });
      const { data, error: saveError } = await (supabase as any).rpc('prepare_slnt_team_b_day_plan', {
        p_service_date: selectedDate,
        p_staff_ids: Array.from(selectedStaffIds),
        p_default_staff_ids: Array.from(defaultStaffIds),
        p_tasks: tasks,
      });
      if (saveError) throw saveError;
      const row = Array.isArray(data) ? data[0] : data;
      const queued = row?.queued_count;
      toast.success(`${t.saved}${queued !== undefined ? ` ${queued} ${t.rooms}.` : ''}`);
      onAssignmentCreated(rooms.length, selectedStaffIds.size);
      onOpenChange(false);
    } catch (cause) {
      console.error('[SlntSelectedDateAssignmentPlanner] save failed:', cause);
      toast.error(cause instanceof Error ? cause.message : 'Could not save Team B plan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[94vh] max-h-[94vh] w-[98vw] max-w-[1500px] flex-col overflow-hidden p-4 sm:p-5">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-lg sm:text-xl">
            <CalendarClock className="h-5 w-5 text-primary" />
            {t.title}
            <Badge variant="outline">{selectedDate}</Badge>
            {activeExisting.length > 0 && <Badge className="bg-emerald-600"><Check className="mr-1 h-3 w-3" />{t.alreadyPrepared}</Badge>}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </DialogHeader>

        <div className="flex flex-shrink-0 items-center gap-2 border-b pb-3">
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${step === 'staff' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {t.stepStaff}
          </div>
          <div className="h-px w-5 bg-border" />
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${step === 'rooms' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {t.stepRooms}
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-0 flex-1 items-start justify-center pt-5">
            <div className="w-full max-w-xl rounded-2xl border bg-card p-5">
              <div className="flex items-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <div><p className="font-semibold">{t.loading}</p><p className="mt-1 text-sm text-muted-foreground">{selectedDate}</p></div>
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="flex min-h-0 flex-1 items-start justify-center pt-5">
            <div className="w-full max-w-xl rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-center">
              <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
              <p className="font-semibold">{error}</p>
              <Button className="mt-4" onClick={() => void load(true)}><RefreshCw className="mr-2 h-4 w-4" />{t.refresh}</Button>
            </div>
          </div>
        ) : step === 'staff' ? (
          <div className="min-h-0 flex-1 overflow-y-auto py-4">
            <div className="mx-auto max-w-4xl space-y-4">
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">{t.whoWorks}</h3>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t.whoWorksHelp}</p>
                  </div>
                  <Badge variant="outline">{selectedStaffIds.size} {t.working}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSelectedStaffIds(new Set(defaultStaffIds))} disabled={defaultStaffIds.size === 0}>
                    <Star className="mr-2 h-4 w-4" />{t.defaultsOnly}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setSelectedStaffIds(new Set(allStaff.map(person => person.id)))}>{t.selectAll}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedStaffIds(new Set())}>{t.clear}</Button>
                </div>
              </div>

              {!hasSavedDayStaff && defaultStaffIds.size === 0 && allStaff.length > 0 && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950 dark:bg-sky-950/20 dark:text-sky-100">
                  {t.firstTime}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {allStaff.map(person => {
                  const working = selectedStaffIds.has(person.id);
                  const isDefault = defaultStaffIds.has(person.id);
                  return (
                    <div key={person.id} className={`rounded-xl border p-4 transition ${working ? 'border-primary/50 bg-primary/[0.03]' : 'bg-card'}`}>
                      <label className="flex cursor-pointer items-center gap-3">
                        <Checkbox checked={working} onCheckedChange={checked => toggleWorking(person.id, checked === true)} />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">{person.full_name}</div>
                          <div className="text-xs text-muted-foreground">{working ? t.working : '—'}</div>
                        </div>
                      </label>
                      <label className="mt-3 flex cursor-pointer items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
                        <Checkbox checked={isDefault} onCheckedChange={checked => toggleDefault(person.id, checked === true)} />
                        <Star className="h-3.5 w-3.5" />
                        <span><strong className="text-foreground">{t.defaultLabel}</strong> · {t.defaultHelp}</span>
                      </label>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-xl border bg-muted/20 p-3 text-center text-xs">
                <div><strong className="block text-lg text-amber-600">{summary.confirmedCheckoutCount}</strong>{t.checkout}</div>
                <div><strong className="block text-lg text-blue-600">{summary.dailyCount}</strong>{t.daily}</div>
                <div><strong className="block text-lg">{summary.unsoldCount}</strong>{t.unbooked}</div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
              <div className="flex flex-wrap gap-3 text-sm">
                <span><b className="text-amber-600">{summary.confirmedCheckoutCount}</b> {t.checkout}</span>
                <span><b className="text-blue-600">{summary.dailyCount}</b> {t.daily}</span>
                <span><b>{summary.unsoldCount}</b> {t.unbooked}</span>
                <span><b>{workingStaff.length}</b> Staff</span>
              </div>
              {capturedAt && <span className="text-xs text-muted-foreground">PMS: {new Date(capturedAt).toLocaleString()}</span>}
            </div>
            {existingChanged && <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t.changed}</div>}
            <p className="mt-2 text-xs text-muted-foreground">{t.selectHint}</p>

            <div className="min-h-0 flex-1 overflow-auto py-3">
              {rooms.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">{t.noRooms}</div>
              ) : (
                <div className="flex min-w-max items-stretch gap-2">
                  {columns.map(column => {
                    const minutes = column.rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0);
                    return (
                      <section
                        key={column.id}
                        className="flex w-[260px] flex-col rounded-xl border bg-card"
                        onDragOver={event => event.preventDefault()}
                        onDrop={event => {
                          event.preventDefault();
                          const roomId = event.dataTransfer.getData('text/plain');
                          if (roomId) moveRoom(roomId, column.id);
                        }}
                      >
                        <div className="sticky top-0 z-10 rounded-t-xl border-b bg-card px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0"><div className="truncate font-semibold">{column.name}</div></div>
                            <Badge variant="outline">{column.rooms.length}</Badge>
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">≈ {Math.floor(minutes / 60)}h {minutes % 60}m</div>
                          {selectedRoomId && <Button size="sm" variant="outline" className="mt-2 h-7 w-full text-xs" onClick={() => moveRoom(selectedRoomId, column.id)}>{t.moveHere}</Button>}
                        </div>
                        <div className="space-y-1.5 p-2">
                          {column.rooms.map(room => {
                            const unsold = isUnsoldPlanningRoom(room);
                            const selected = selectedRoomId === room.id;
                            return (
                              <button
                                key={room.id}
                                type="button"
                                draggable
                                onDragStart={event => event.dataTransfer.setData('text/plain', room.id)}
                                onClick={() => setSelectedRoomId(selected ? null : room.id)}
                                className={`flex w-full items-center gap-1.5 rounded-lg border px-2 py-2 text-left text-xs transition ${selected ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'bg-background hover:border-primary/60'}`}
                              >
                                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1 truncate font-medium">{room.room_number}</span>
                                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${unsold ? 'bg-violet-100 text-violet-800' : room.is_checkout_room ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                                  {unsold ? t.unbooked : room.is_checkout_room ? t.checkout : t.daily}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        <DialogFooter className="flex-shrink-0 gap-2 border-t pt-3 sm:justify-between">
          <div>
            {step === 'rooms' && <Button variant="outline" onClick={() => setStep('staff')}><ArrowLeft className="mr-2 h-4 w-4" />{t.back}</Button>}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t.close}</Button>
            {step === 'staff' ? (
              <Button disabled={selectedStaffIds.size === 0 || rooms.length === 0} onClick={continueToRooms}>
                <Wand2 className="mr-2 h-4 w-4" />{t.continue}
              </Button>
            ) : (
              <Button disabled={saving || !!error || rooms.length === 0} onClick={() => void savePlan()}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
                {saving ? t.saving : t.save}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

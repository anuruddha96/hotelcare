import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, Check, GripVertical, Loader2, RefreshCw, Users } from 'lucide-react';
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
  shift_start: string | null;
  shift_end: string | null;
};

const UNASSIGNED = '__unassigned__';

const COPY = {
  en: {
    title: 'Team B room assignment',
    subtitle: 'Plan the selected date like normal Auto Assign. Drag rooms between housekeepers, or select a room and tap another housekeeper. Team B keeps its shared-queue safety on the work date.',
    loading: 'Getting Team B reservations and published staff…',
    refresh: 'Refresh Previo',
    noRooms: 'No Team B housekeeping workload was found for this date.',
    checkout: 'Checkout',
    daily: 'Daily',
    unbooked: 'Unbooked',
    prepare: 'Save Team B plan',
    updating: 'Saving Team B plan…',
    prepared: 'Team B plan saved.',
    close: 'Close',
    changed: 'The Team B workload changed since this date was last prepared. Saving again reconciles only unclaimed future tasks.',
    alreadyPrepared: 'Plan already prepared',
    provisional: 'Provisional',
    noStaff: 'No published Team B housekeepers are scheduled for this date. Publish the Staff Schedule first, or keep rooms unassigned.',
    unassigned: 'Unassigned',
    moveHere: 'Move selected here',
    selectHint: 'Drag a room to another column. On touch devices, tap a room and then “Move selected here”.',
    rooms: 'rooms',
  },
  hu: {
    title: 'B csapat szobabeosztása',
    subtitle: 'A kiválasztott napot a normál Auto Assign nézethez hasonlóan tervezheti. Húzza a szobákat a takarítók között, vagy válasszon szobát és másik takarítót. A munkanapon a B csapat közös lista biztonsági logikája megmarad.',
    loading: 'B csapat foglalások és közzétett dolgozók betöltése…',
    refresh: 'Previo frissítése',
    noRooms: 'Erre a napra nem található B csapat takarítási feladat.',
    checkout: 'Kijelentkezés',
    daily: 'Napi',
    unbooked: 'Eladatlan',
    prepare: 'B csapat terv mentése',
    updating: 'B csapat terv mentése…',
    prepared: 'A B csapat terve elmentve.',
    close: 'Bezárás',
    changed: 'A B csapat feladatai megváltoztak az utolsó előkészítés óta. Az új mentés csak a még fel nem vett jövőbeli feladatokat egyezteti.',
    alreadyPrepared: 'A terv már elkészült',
    provisional: 'Ideiglenes',
    noStaff: 'Erre a napra nincs közzétett B csapat takarító. Először tegye közzé a Staff Schedule-t, vagy hagyja a szobákat kiosztatlanul.',
    unassigned: 'Kiosztatlan',
    moveHere: 'Kijelölt áthelyezése ide',
    selectHint: 'Húzza a szobát egy másik oszlopba. Érintőképernyőn koppintson a szobára, majd az „Áthelyezés ide” gombra.',
    rooms: 'szoba',
  },
};

function balanceRooms(rooms: RoomForAssignment[], staff: PlannerStaff[]): Map<string, string> {
  const result = new Map<string, string>();
  if (staff.length === 0) return result;
  const loads = new Map(staff.map(person => [person.id, 0]));
  [...rooms]
    .sort((a, b) => calculateRoomTime(b) - calculateRoomTime(a))
    .forEach(room => {
      const owner = staff.reduce((best, candidate) =>
        (loads.get(candidate.id) || 0) < (loads.get(best.id) || 0) ? candidate : best,
      staff[0]);
      result.set(room.id, owner.id);
      loads.set(owner.id, (loads.get(owner.id) || 0) + calculateRoomTime(room));
    });
  return result;
}

export function SlntSelectedDateAssignmentPlanner({ open, onOpenChange, selectedDate, onAssignmentCreated }: Props) {
  const { profile } = useAuth();
  const language: 'en' | 'hu' = profile?.preferred_language?.toLowerCase().startsWith('hu') ? 'hu' : 'en';
  const t = COPY[language];
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomForAssignment[]>([]);
  const [staff, setStaff] = useState<PlannerStaff[]>([]);
  const [owners, setOwners] = useState<Map<string, string>>(new Map());
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [existingTasks, setExistingTasks] = useState<ExistingTask[]>([]);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);

  const summary = useMemo(() => summarizeTeamWorkload(rooms), [rooms]);
  const activeExisting = useMemo(() => existingTasks.filter(task => task.status !== 'cancelled'), [existingTasks]);
  const existingChanged = useMemo(() => {
    if (activeExisting.length === 0) return false;
    if (activeExisting.length !== rooms.length) return true;
    const currentTypes = new Map(rooms.map(room => [room.id, room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning']));
    const existingByRoom = new Map(activeExisting.map(task => [task.room_id, task.assignment_type]));
    return rooms.some(room => existingByRoom.get(room.id) !== currentTypes.get(room.id));
  }, [activeExisting, rooms]);

  const columns = useMemo(() => {
    const entries = [...staff.map(person => ({ id: person.id, name: person.full_name, person })), { id: UNASSIGNED, name: t.unassigned, person: null }];
    return entries.map(entry => ({
      ...entry,
      rooms: rooms
        .filter(room => (owners.get(room.id) || UNASSIGNED) === entry.id)
        .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })),
    })).filter(entry => entry.id !== UNASSIGNED || entry.rooms.length > 0 || staff.length === 0);
  }, [owners, rooms, staff, t.unassigned]);

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

      const [roomResult, snapshotResult, taskResult, memberResult] = await Promise.all([
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
          .select('user_id').eq('team_id', teamScope.teamId).eq('is_active', true),
      ]);
      if (roomResult.error) throw roomResult.error;
      if (snapshotResult.error) throw snapshotResult.error;
      if (taskResult.error) throw taskResult.error;
      if (memberResult.error) throw memberResult.error;

      const memberIds = (memberResult.data || []).map((row: any) => row.user_id);
      const [profileResult, scheduleResult] = memberIds.length ? await Promise.all([
        (supabase as any).from('profiles').select('id,full_name').in('id', memberIds).is('deleted_at', null),
        (supabase as any).from('staff_schedules')
          .select('user_id,status,shift_start,shift_end')
          .eq('organization_slug', 'slnt').eq('hotel_id', hotelId).eq('work_date', selectedDate)
          .eq('status', 'published').in('user_id', memberIds),
      ]) : [{ data: [], error: null }, { data: [], error: null }];
      if (profileResult.error) throw profileResult.error;
      if (scheduleResult.error) throw scheduleResult.error;

      const scheduleByUser = new Map((scheduleResult.data || []).map((row: any) => [row.user_id, row]));
      const publishedStaff: PlannerStaff[] = (profileResult.data || [])
        .filter((person: any) => scheduleByUser.has(person.id))
        .map((person: any) => {
          const schedule: any = scheduleByUser.get(person.id);
          return { id: person.id, full_name: person.full_name, shift_start: schedule?.shift_start || null, shift_end: schedule?.shift_end || null };
        })
        .sort((a: PlannerStaff, b: PlannerStaff) => a.full_name.localeCompare(b.full_name));

      const mappedRooms = filterRoomsToMappedTeam(roomResult.data || [], teamScope.roomIds);
      if (mappedRooms.length !== teamScope.roomIds.length) {
        throw new Error(`Team B room registry is incomplete: ${mappedRooms.length}/${teamScope.roomIds.length} mapped rooms are available.`);
      }
      const scopedSnapshot = filterSnapshotRowsToMappedRooms((snapshotResult.data || []) as DailyOverviewWorkRow[], mappedRooms);
      const workload = buildSelectedDateHousekeepingWorkload(mappedRooms, scopedSnapshot, selectedDate);
      const tasks = (taskResult.data || []) as ExistingTask[];
      const validStaffIds = new Set(publishedStaff.map(person => person.id));
      const savedOwners = new Map(tasks.flatMap(task =>
        task.status !== 'cancelled' && task.planned_candidate_user_id && validStaffIds.has(task.planned_candidate_user_id)
          ? [[task.room_id, task.planned_candidate_user_id] as [string, string]]
          : []
      ));
      const balanced = balanceRooms(workload.rooms.filter(room => !savedOwners.has(room.id)), publishedStaff);
      setRooms(workload.rooms);
      setStaff(publishedStaff);
      setOwners(new Map([...balanced, ...savedOwners]));
      setExistingTasks(tasks);
      setCapturedAt(syncData?.capturedAt || workload.capturedAt || null);
      setSelectedRoomId(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not prepare Team B for this date.';
      console.error('[SlntSelectedDateAssignmentPlanner] load failed:', cause);
      setError(message);
      setRooms([]);
      setStaff([]);
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

  const moveRoom = (roomId: string, staffId: string) => {
    setOwners(previous => {
      const next = new Map(previous);
      if (staffId === UNASSIGNED) next.delete(roomId);
      else next.set(roomId, staffId);
      return next;
    });
    setSelectedRoomId(null);
  };

  const prepare = async () => {
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
      const { data, error: saveError } = await (supabase as any).rpc('prepare_slnt_team_b_tasks', {
        p_service_date: selectedDate,
        p_tasks: tasks,
      });
      if (saveError) throw saveError;
      const queued = Array.isArray(data) ? data[0]?.queued_count : data?.queued_count;
      toast.success(`${t.prepared}${queued !== undefined ? ` ${queued} ${t.rooms}.` : ''}`);
      onAssignmentCreated(rooms.length, staff.length);
      onOpenChange(false);
    } catch (cause) {
      console.error('[SlntSelectedDateAssignmentPlanner] prepare failed:', cause);
      toast.error(cause instanceof Error ? cause.message : 'Could not save Team B plan.');
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[94vh] max-h-[94vh] w-[98vw] max-w-[1500px] flex-col overflow-hidden p-4 sm:p-5">
      <DialogHeader className="flex-shrink-0">
        <DialogTitle className="flex flex-wrap items-center gap-2 text-lg sm:text-xl">
          <CalendarClock className="h-5 w-5 text-primary" />{t.title}<Badge variant="outline">{selectedDate}</Badge>
          {activeExisting.length > 0 && <Badge className="bg-emerald-600"><Check className="mr-1 h-3 w-3" />{t.alreadyPrepared}</Badge>}
        </DialogTitle>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </DialogHeader>

      {loading ? <div className="flex min-h-0 flex-1 items-start justify-center pt-5">
        <div className="w-full max-w-xl rounded-2xl border bg-card p-5"><div className="flex items-center gap-3"><Loader2 className="h-6 w-6 animate-spin text-primary" /><div><p className="font-semibold">{t.loading}</p><p className="mt-1 text-sm text-muted-foreground">{selectedDate}</p></div></div></div>
      </div> : error ? <div className="flex min-h-0 flex-1 items-start justify-center pt-5">
        <div className="w-full max-w-xl rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-center"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" /><p className="font-semibold">{error}</p><Button className="mt-4" onClick={() => void load(true)}><RefreshCw className="mr-2 h-4 w-4" />{t.refresh}</Button></div>
      </div> : <>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
          <div className="flex flex-wrap gap-3 text-sm">
            <span><b className="text-amber-600">{summary.confirmedCheckoutCount}</b> {t.checkout}</span>
            <span><b className="text-blue-600">{summary.dailyCount}</b> {t.daily}</span>
            <span><b>{summary.unsoldCount}</b> {t.unbooked}</span>
            <span><b>{staff.length}</b> Staff</span>
          </div>
          {capturedAt && <span className="text-xs text-muted-foreground">PMS: {new Date(capturedAt).toLocaleString()}</span>}
        </div>
        {staff.length === 0 && <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t.noStaff}</div>}
        {existingChanged && <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t.changed}</div>}
        <p className="mt-2 text-xs text-muted-foreground">{t.selectHint}</p>

        <div className="min-h-0 flex-1 overflow-auto py-3">
          {rooms.length === 0 ? <div className="py-12 text-center text-muted-foreground">{t.noRooms}</div> :
            <div className="flex min-w-max items-stretch gap-2">
              {columns.map(column => {
                const minutes = column.rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0);
                return <section
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
                      <div className="min-w-0"><div className="truncate font-semibold">{column.name}</div>{column.person?.shift_start && <div className="text-[11px] text-muted-foreground">{column.person.shift_start.slice(0, 5)}–{column.person.shift_end?.slice(0, 5) || ''}</div>}</div>
                      <Badge variant="outline">{column.rooms.length}</Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">≈ {Math.floor(minutes / 60)}h {minutes % 60}m</div>
                    {selectedRoomId && <Button size="sm" variant="outline" className="mt-2 h-7 w-full text-xs" onClick={() => moveRoom(selectedRoomId, column.id)}>{t.moveHere}</Button>}
                  </div>
                  <div className="space-y-1.5 p-2">
                    {column.rooms.map(room => {
                      const unsold = isUnsoldPlanningRoom(room);
                      const selected = selectedRoomId === room.id;
                      return <button
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
                      </button>;
                    })}
                  </div>
                </section>;
              })}
            </div>}
        </div>
      </>}

      <DialogFooter className="flex-shrink-0 gap-2 border-t pt-3 sm:justify-between">
        <Button variant="outline" onClick={() => onOpenChange(false)}>{t.close}</Button>
        <Button disabled={loading || saving || !!error || rooms.length === 0} onClick={() => void prepare()}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}{saving ? t.updating : t.prepare}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

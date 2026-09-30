import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, Check, Loader2, RefreshCw, Users } from 'lucide-react';
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
  loadActiveSlntTeamRoomIds,
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
};

const COPY = {
  en: {
    title: 'Prepare Team B shared queue',
    subtitle: 'All Team B rooms stay assigned to the team. Individual ownership happens only when a cleaner claims a room on the work date.',
    loading: 'Getting Team B reservations from both SLNT Previo accounts…',
    refresh: 'Refresh Previo',
    noRooms: 'No Team B housekeeping workload was found for this date.',
    checkout: 'Confirmed checkout',
    daily: 'Daily',
    unbooked: 'Unbooked',
    prepare: 'Prepare Team B queue',
    updating: 'Updating Team B queue…',
    prepared: 'Team B queue prepared.',
    close: 'Close',
    changed: 'The Team B workload changed since this date was last prepared. Preparing again will reconcile only unclaimed future tasks.',
    alreadyPrepared: 'Team queue already prepared',
    provisional: 'Provisional · revalidate on work date',
  },
  hu: {
    title: 'B csapat közös feladatlistájának előkészítése',
    subtitle: 'Minden B csapat szoba a csapathoz marad rendelve. Egyéni felelős csak akkor lesz, amikor a takarító a munka napján felveszi a szobát.',
    loading: 'A B csapat foglalásainak lekérése mindkét SLNT Previo-fiókból…',
    refresh: 'Previo frissítése',
    noRooms: 'Erre a napra nem található B csapat takarítási feladat.',
    checkout: 'Megerősített kijelentkezés',
    daily: 'Napi',
    unbooked: 'Eladatlan',
    prepare: 'B csapat lista előkészítése',
    updating: 'B csapat lista frissítése…',
    prepared: 'A B csapat listája előkészítve.',
    close: 'Bezárás',
    changed: 'A B csapat feladatai megváltoztak az utolsó előkészítés óta. Az új előkészítés csak a még fel nem vett jövőbeli feladatokat egyezteti.',
    alreadyPrepared: 'A csapatlista már elő van készítve',
    provisional: 'Ideiglenes · a munka napján újra ellenőrizendő',
  },
};

export function SlntSelectedDateAssignmentPlanner({ open, onOpenChange, selectedDate, onAssignmentCreated }: Props) {
  const { profile } = useAuth();
  const language: 'en' | 'hu' = profile?.preferred_language?.toLowerCase().startsWith('hu') ? 'hu' : 'en';
  const t = COPY[language];
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomForAssignment[]>([]);
  const [existingTasks, setExistingTasks] = useState<ExistingTask[]>([]);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);

  const summary = useMemo(() => summarizeTeamWorkload(rooms), [rooms]);
  const currentTypes = useMemo(() => new Map(rooms.map(room => [
    room.id,
    room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning',
  ])), [rooms]);
  const activeExisting = useMemo(() => existingTasks.filter(task => task.status !== 'cancelled'), [existingTasks]);
  const existingChanged = useMemo(() => {
    if (activeExisting.length === 0) return false;
    if (activeExisting.length !== rooms.length) return true;
    const existingByRoom = new Map(activeExisting.map(task => [task.room_id, task.assignment_type]));
    return rooms.some(room => existingByRoom.get(room.id) !== currentTypes.get(room.id));
  }, [activeExisting, currentTypes, rooms]);

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
      const teamRoomIds = await loadActiveSlntTeamRoomIds('slnt', hotelId);

      const [roomResult, snapshotResult, taskResult] = await Promise.all([
        supabase.from('rooms')
          .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
          .in('hotel', keys),
        (supabase as any).from('daily_overview_snapshots')
          .select('room_label,room_number,arrival_date,departure_date,status,housekeeping_dep,housekeeping_stay,captured_at')
          .eq('organization_slug', 'slnt').eq('hotel_id', hotelId).eq('business_date', selectedDate).eq('source', 'previo'),
        (supabase as any).from('housekeeping_team_tasks')
          .select('room_id,assignment_type,status')
          .eq('organization_slug', 'slnt').eq('hotel_id', hotelId).eq('service_date', selectedDate),
      ]);
      if (roomResult.error) throw roomResult.error;
      if (snapshotResult.error) throw snapshotResult.error;
      if (taskResult.error) throw taskResult.error;

      const mappedRooms = filterRoomsToMappedTeam(roomResult.data || [], teamRoomIds);
      if (mappedRooms.length !== teamRoomIds.length) {
        throw new Error(`Team B room registry is incomplete: ${mappedRooms.length}/${teamRoomIds.length} mapped rooms are available.`);
      }
      const scopedSnapshot = filterSnapshotRowsToMappedRooms(
        (snapshotResult.data || []) as DailyOverviewWorkRow[],
        mappedRooms,
      );
      const workload = buildSelectedDateHousekeepingWorkload(mappedRooms, scopedSnapshot, selectedDate);
      setRooms(workload.rooms);
      setExistingTasks((taskResult.data || []) as ExistingTask[]);
      setCapturedAt(syncData?.capturedAt || workload.capturedAt || null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not prepare Team B for this date.';
      console.error('[SlntSelectedDateAssignmentPlanner] load failed:', cause);
      setError(message);
      setRooms([]);
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
        };
      });
      const { data, error: saveError } = await (supabase as any).rpc('prepare_slnt_team_b_tasks', {
        p_service_date: selectedDate,
        p_tasks: tasks,
      });
      if (saveError) throw saveError;
      const queued = Array.isArray(data) ? data[0]?.queued_count : data?.queued_count;
      toast.success(`${t.prepared}${queued !== undefined ? ` ${queued} rooms.` : ''}`);
      onAssignmentCreated(rooms.length, 0);
      onOpenChange(false);
    } catch (cause) {
      console.error('[SlntSelectedDateAssignmentPlanner] prepare failed:', cause);
      toast.error(cause instanceof Error ? cause.message : 'Could not prepare Team B queue.');
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[94vh] max-h-[94vh] w-[98vw] max-w-[1100px] flex-col overflow-hidden p-4 sm:p-6">
      <DialogHeader className="flex-shrink-0">
        <DialogTitle className="flex flex-wrap items-center gap-2 text-lg sm:text-xl">
          <CalendarClock className="h-5 w-5 text-primary" />{t.title}<Badge variant="outline">{selectedDate}</Badge>
          {activeExisting.length > 0 && <Badge className="bg-emerald-600"><Check className="mr-1 h-3 w-3" />{t.alreadyPrepared}</Badge>}
        </DialogTitle>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </DialogHeader>

      {loading ? <div className="flex min-h-0 flex-1 items-start justify-center pt-5">
        <div className="w-full max-w-xl rounded-2xl border bg-card p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-full bg-primary/10 p-3"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div><div><p className="font-semibold">{t.loading}</p><p className="mt-1 text-sm text-muted-foreground">{selectedDate}</p></div></div></div>
      </div> : error ? <div className="flex min-h-0 flex-1 items-start justify-center pt-5">
        <div className="w-full max-w-xl rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-center"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" /><p className="font-semibold">{error}</p><Button className="mt-4" onClick={() => void load(true)}><RefreshCw className="mr-2 h-4 w-4" />{t.refresh}</Button></div>
      </div> : <>
        <div className="mt-1 grid grid-cols-3 gap-2 rounded-xl border bg-muted/30 p-3 text-center">
          <div><p className="text-2xl font-bold text-amber-600">{summary.confirmedCheckoutCount}</p><p className="text-xs text-muted-foreground">{t.checkout}</p></div>
          <div><p className="text-2xl font-bold text-blue-600">{summary.dailyCount}</p><p className="text-xs text-muted-foreground">{t.daily}</p></div>
          <div><p className="text-2xl font-bold text-slate-600">{summary.unsoldCount}</p><p className="text-xs text-muted-foreground">{t.unbooked}</p></div>
        </div>
        {existingChanged && <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t.changed}</div>}
        {capturedAt && <p className="mt-2 text-xs text-muted-foreground">PMS snapshot: {new Date(capturedAt).toLocaleString()}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto py-3">
          {rooms.length === 0 ? <div className="py-12 text-center text-muted-foreground">{t.noRooms}</div> : <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.slice().sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })).map(room => {
              const unsold = isUnsoldPlanningRoom(room);
              return <div key={room.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2"><span className="font-medium">{room.room_number}</span><Badge variant={unsold ? 'secondary' : room.is_checkout_room ? 'destructive' : 'outline'}>{unsold ? t.unbooked : room.is_checkout_room ? t.checkout : t.daily}</Badge></div>
                {unsold && <p className="mt-1 text-xs text-muted-foreground">{t.provisional}</p>}
              </div>;
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

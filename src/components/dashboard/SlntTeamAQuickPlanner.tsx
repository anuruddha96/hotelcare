import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { assignRoomToStaff } from '@/lib/hkAssignmentDnd';
import { buildSelectedDateHousekeepingWorkload, type DailyOverviewWorkRow, isUnsoldPlanningRoom } from '@/lib/nextDayHousekeepingSnapshot';
import { filterSnapshotRowsToMappedRooms, loadActiveSlntTeamScope } from '@/lib/slntTeamHousekeepingScope';
import type { RoomForAssignment } from '@/lib/roomAssignmentAlgorithm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

type Staff = { id: string; full_name: string };
type Assignment = { room_id: string; assigned_to: string; status: string };
const iso = (day: Date) => format(day, 'yyyy-MM-dd');
const local = (day: string) => new Date(day + 'T12:00:00');
const NONE = '__unassigned__';

/** SLNT-only: days off are exceptions, not published shifts. Existing RD rosters stay untouched. */
export function SlntTeamAQuickPlanner() {
  const { user, profile } = useAuth();
  const { language } = useTranslation();
  const hu = language === 'hu';
  const dates = useMemo(() => Array.from({ length: 14 }, (_, n) => iso(addDays(local(todayBudapest()), n))), []);
  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [rooms, setRooms] = useState<RoomForAssignment[]>([]);
  const [assigned, setAssigned] = useState<Map<string, Assignment>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [overviewCount, setOverviewCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!profile?.organization_slug || !profile.assigned_hotel) return;
    setLoading(true); setError(null);
    try {
      const scope = await loadActiveSlntTeamScope('slnt', 'slnt-group', 'team-a');
      const ids = scope.roomIds;
      setTeamId(scope.teamId); setRoomIds(ids);
      const [memberRows, roomRows, overviewRows, assignmentRows, dayOffRows, scheduleRows] = await Promise.all([
        (supabase as any).from('housekeeping_team_members').select('user_id').eq('team_id', scope.teamId).eq('is_active', true),
        supabase.from('rooms').select('id,room_number,room_name,hotel,status,pms_metadata,notes,is_checkout_room,room_size_sqm,room_capacity,towel_change_required,linen_change_required,checkout_time').in('id', ids),
        (supabase as any).from('daily_overview_snapshots')
          .select('room_label,room_number,arrival_date,departure_date,status,housekeeping_dep,housekeeping_stay,captured_at')
          .eq('organization_slug', 'slnt').eq('hotel_id', 'slnt-group').eq('source', 'previo').eq('business_date', selectedDate),
        supabase.from('room_assignments').select('room_id,assigned_to,status').eq('assignment_date', selectedDate).in('room_id', ids),
        (supabase as any).from('slnt_team_a_days_off').select('user_id').eq('team_id', scope.teamId).eq('work_date', selectedDate),
        (supabase as any).from('staff_schedules').select('user_id,status').eq('organization_slug', 'slnt')
          .eq('work_date', selectedDate).eq('status', 'off'),
      ]);
      for (const result of [memberRows,roomRows,overviewRows,assignmentRows,dayOffRows,scheduleRows]) if (result.error) throw result.error;
      if ((roomRows.data||[]).length !== ids.length) throw new Error('Team A apartment mapping requires review.');
      const memberIds = (memberRows.data || []).map((m: any) => String(m.user_id));
      if (memberIds.length === 0) throw new Error('No active Team A cleaners configured.');
      const profiles = await supabase.from('profiles').select('id,full_name').in('id', memberIds).in('organization_slug', ['slnt','slnt-group']);
      if (profiles.error) throw profiles.error;
      setStaff((profiles.data || []).map(p => ({ id: p.id, full_name: p.full_name || p.id })));
      setOff(new Set([
        ...(dayOffRows.data || []).map((r: any) => r.user_id as string),
        ...(scheduleRows.data || []).map((r: any) => r.user_id as string),
      ]));
      setAssigned(new Map((assignmentRows.data || []).filter(a => a.status !== 'cancelled')
        .map(a => [a.room_id, a as Assignment])));
      setOverviewCount((overviewRows.data || []).length);
      if (!(overviewRows.data || []).length) {
        // Never invent a workload from an empty or failed PMS snapshot.
        setRooms([]); setCaptured(null);
      } else {
        const mappedRows = roomRows.data || [];
        const filtered = filterSnapshotRowsToMappedRooms(
          overviewRows.data as DailyOverviewWorkRow[], mappedRows as any,
        );
        const workload = buildSelectedDateHousekeepingWorkload(mappedRows, filtered, selectedDate);
        setRooms(workload.rooms); setCaptured(workload.capturedAt);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load Team A planning.');
      setRooms([]);
    } finally { setLoading(false); }
  }, [selectedDate,profile?.assigned_hotel,profile?.organization_slug]);

  useEffect(() => { void refresh(); }, [refresh]);

  const refreshPrevio = async () => {
    setBusy('pms');
    try {
      const from = local(selectedDate);
      const to = iso(addDays(from, 1));
      const { data, error: syncError } = await supabase.functions.invoke('slnt-sync-daily-overview', {
        body: { hotelId: 'slnt-group', fromDate: selectedDate, toDate: to, days: 1 },
      });
      if (syncError || (data as any)?.ok === false || (data as any)?.error) {
        throw new Error((data as any)?.error || syncError?.message || 'Previo sync failed');
      }
      await refresh();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Previo sync failed'); }
    finally { setBusy(null); }
  };

  const setDayOff = async (id: string, isOff: boolean) => {
    if (!teamId || busy) return;
    setBusy(id);
    const { error: saveError } = await (supabase as any).rpc('slnt_set_team_a_day_off', {
      p_team_id: teamId, p_user_id: id, p_work_date: selectedDate, p_is_off: isOff,
    });
    if (saveError) toast.error(saveError.message);
    else toast.success(hu ? 'Elérhetőség mentve.' : 'Availability saved.');
    await refresh(); setBusy(null);
  };

  const assign = async (room: RoomForAssignment, staffId: string) => {
    if (!user?.id || busy) return;
    if (staffId !== NONE && off.has(staffId)) {
      toast.error(hu ? 'A dolgozó szabadnapos.' : 'This cleaner is off today.'); return;
    }
    setBusy(room.id);
    try {
      if (staffId === NONE) {
        const current = assigned.get(room.id);
        if (!current || current.status === 'in_progress' || current.status === 'completed') {
          throw new Error(hu ? 'Az aktív feladatot nem lehet törölni.' : 'Active/completed work cannot be removed.');
        }
        const { error: deleteError } = await supabase.from('room_assignments').delete()
          .eq('room_id',room.id).eq('assignment_date',selectedDate).neq('status','in_progress');
        if (deleteError) throw deleteError;
      } else {
        await assignRoomToStaff({
          roomId: room.id, staffId, assignedBy: user.id, assignmentDate: selectedDate,
          organizationSlug: 'slnt', isCheckoutRoom: room.is_checkout_room,
          readyToClean: room.ready_to_clean, preventOutOfOrder: true,
        });
      }
      toast.success(hu ? 'Feladat mentve.' : 'Assignment saved.');
      await refresh();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not save assignment.'); }
    finally { setBusy(null); }
  };

  return (
    <Card className="w-full" data-training="slnt-team-a-calendar">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" />
          {hu ? 'A csapat – egyszerű takarítási terv' : 'Team A — simple cleaning plan'}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{hu
          ? 'Válassz napot, jelöld a szabadnapokat, és oszd ki a lakásokat. Műszakot nem kell létrehozni.'
          : 'Choose a date, mark days off and assign apartments. No shifts to create.'}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-7 gap-1" data-training="slnt-team-a-days">
          {dates.map(date => <button key={date} type="button" aria-pressed={date === selectedDate}
            data-training="slnt-team-a-day" onClick={() => setSelectedDate(date)}
            className={`rounded-md border p-2 text-center text-xs transition-colors ${date === selectedDate ? 'border-primary bg-primary/10 font-semibold' : 'hover:bg-muted'}`}>
            <span className="block">{format(local(date), 'EEE')}</span>
            <span className="block text-base">{format(local(date), 'd')}</span>
          </button>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong>{format(local(selectedDate), 'yyyy-MM-dd')}</strong>
          <Button variant="outline" size="sm" disabled={busy === 'pms'} onClick={() => void refreshPrevio()}>
            <RefreshCw className="mr-2 h-4 w-4" />{hu ? 'Previo frissítése' : 'Refresh Previo'}
          </Button>
        </div>
        <div className="space-y-2" data-training="slnt-team-a-availability">
          <p className="font-semibold">{hu ? 'Ki dolgozik?' : 'Who is working?'}</p>
          {staff.map(person => <div key={person.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
            <span>{person.full_name}</span>
            <Button size="sm" variant={off.has(person.id) ? 'secondary' : 'outline'}
              disabled={!!busy} onClick={() => void setDayOff(person.id, !off.has(person.id))}
              data-training="slnt-team-a-day-off">
              {off.has(person.id) ? (hu ? 'Szabadnap – visszaállítás' : 'Day off — change') : (hu ? 'Szabadnap jelölése' : 'Mark day off')}
            </Button>
          </div>)}
        </div>
        {loading ? <p className="text-sm">{hu ? 'Betöltés…' : 'Loading…'}</p>
          : error ? <p role="alert" className="text-sm text-destructive">{error}</p>
          : overviewCount === 0 ? <p role="status" className="rounded-md border p-3 text-sm">
            {hu ? 'Ehhez a naphoz még nincs Previo-adat. A szobák kiosztása előtt frissítsd az adatokat.'
              : 'No Previo snapshot for this day. Refresh before assigning apartments.'}
          </p> : <>
            <div className="flex items-center justify-between">
              <strong>{hu ? 'Takarítandó apartmanok' : 'Apartments to clean'}</strong>
              <Badge variant="secondary">{rooms.length}</Badge>
            </div>
            {captured && <p className="text-xs text-muted-foreground">Previo: {new Date(captured).toLocaleString()}</p>}
            <div className="space-y-2" data-training="slnt-team-a-assignments">
              {rooms.map(room => <div key={room.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <div className="min-w-32 flex-1">
                  <p className="font-semibold">{room.room_number}</p>
                  <p className="text-xs text-muted-foreground">
                    {isUnsoldPlanningRoom(room) ? (hu ? 'Ideiglenes – nincs foglalás' : 'Provisional — unsold')
                      : room.is_checkout_room ? (hu ? 'Kijelentkezés' : 'Checkout')
                      : (hu ? 'Napi szolgáltatás' : 'Stayover service')}
                  </p>
                </div>
                <Select value={assigned.get(room.id)?.assigned_to || NONE}
                  disabled={!!busy || assigned.get(room.id)?.status === 'in_progress' || assigned.get(room.id)?.status === 'completed'}
                  onValueChange={id => void assign(room,id)}>
                  <SelectTrigger className="w-full sm:w-52" data-training="slnt-team-a-assign">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{hu ? 'Nincs kiosztva' : 'Unassigned'}</SelectItem>
                    {staff.filter(p => !off.has(p.id)).map(p => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>)}
              {rooms.length === 0 && <p className="text-sm text-muted-foreground">
                {hu ? 'Nincs takarítandó apartman.' : 'No apartments need service.'}
              </p>}
            </div>
          </>}
      </CardContent>
    </Card>
  );
}

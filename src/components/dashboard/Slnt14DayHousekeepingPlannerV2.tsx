import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3, Loader2, RefreshCw, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { resolveCanonicalHotelId, resolveHotelKeys } from '@/lib/hotelKeys';
import { hasManagerPowers } from '@/lib/roleAccess';
import {
  buildSlnt14DayPlanningWindow,
  groupRowsByBusinessDate,
  isSlntOrganization,
} from '@/lib/slnt14DayHousekeeping';
import {
  buildSelectedDateHousekeepingWorkload,
  type DailyOverviewWorkRow,
} from '@/lib/nextDayHousekeepingSnapshot';
import {
  filterRoomsToMappedTeam,
  filterSnapshotRowsToMappedRooms,
  loadActiveSlntTeamScope,
  summarizeTeamWorkload,
} from '@/lib/slntTeamHousekeepingScope';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SlntSelectedDateAssignmentPlanner } from './SlntSelectedDateAssignmentPlanner';

type SyncMode = 'range' | 'daily-fallback' | null;

type DaySummary = {
  date: string;
  checkoutCount: number;
  dailyCount: number;
  unsoldCount: number;
  towelCount: number;
  linenCount: number;
  pmsCapturedAt: string | null;
  queuedTasks: number;
  plannedStaff: number;
};

function formatDay(date: string) {
  const value = new Date(`${date}T12:00:00`);
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(value),
    shortDate: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(value),
  };
}

function queueBadge(count: number) {
  return count > 0
    ? <Badge className="bg-emerald-600">Saved · {count} rooms</Badge>
    : <Badge variant="secondary">Not planned</Badge>;
}

async function invokeSlntOverview(args: { hotelId: string; fromDate: string; toDate: string; days: number }) {
  const { data, error } = await supabase.functions.invoke('slnt-sync-daily-overview', { body: args });
  if (error) throw error;
  if ((data as any)?.ok === false || (data as any)?.error || (data as any)?.supported === false) {
    throw new Error((data as any)?.error || 'SLNT Previo planning sync is not available.');
  }
  return data as any;
}

export function Slnt14DayHousekeepingPlannerV2() {
  const { profile } = useAuth();
  const organizationSlug = profile?.organization_slug || '';
  const isSlnt = isSlntOrganization(organizationSlug);
  const canManage = !!profile?.role && hasManagerPowers(profile.role);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<DaySummary[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayPlannerOpen, setDayPlannerOpen] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncMode>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [defaultStaffCount, setDefaultStaffCount] = useState(0);

  const planningWindow = useMemo(() => buildSlnt14DayPlanningWindow(todayBudapest()), [open]);

  const loadStoredRange = useCallback(async (hotelId: string, hotelKeys: string[]) => {
    if (!organizationSlug) return;
    const teamScope = await loadActiveSlntTeamScope(organizationSlug, hotelId);

    const [roomResult, snapshotResult, taskResult, dayStaffResult, memberResult] = await Promise.all([
      supabase.from('rooms')
        .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
        .in('hotel', hotelKeys),
      (supabase as any).from('daily_overview_snapshots')
        .select('business_date,room_label,room_number,arrival_date,departure_date,status,housekeeping_dep,housekeeping_stay,captured_at')
        .eq('organization_slug', organizationSlug).eq('hotel_id', hotelId).eq('source', 'previo')
        .gte('business_date', planningWindow.fromDate).lt('business_date', planningWindow.toDateExclusive),
      (supabase as any).from('housekeeping_team_tasks')
        .select('service_date,status').eq('team_id', teamScope.teamId)
        .gte('service_date', planningWindow.fromDate).lt('service_date', planningWindow.toDateExclusive)
        .neq('status', 'cancelled'),
      (supabase as any).from('housekeeping_team_day_staff')
        .select('service_date,user_id').eq('team_id', teamScope.teamId)
        .gte('service_date', planningWindow.fromDate).lt('service_date', planningWindow.toDateExclusive),
      (supabase as any).from('housekeeping_team_members')
        .select('user_id,is_default').eq('team_id', teamScope.teamId).eq('is_active', true),
    ]);
    if (roomResult.error) throw roomResult.error;
    if (snapshotResult.error) throw snapshotResult.error;
    if (taskResult.error) throw taskResult.error;
    if (dayStaffResult.error) throw dayStaffResult.error;
    if (memberResult.error) throw memberResult.error;

    const rooms = filterRoomsToMappedTeam(roomResult.data || [], teamScope.roomIds);
    if (rooms.length !== teamScope.roomIds.length) {
      throw new Error(`Team B room registry is incomplete: ${rooms.length}/${teamScope.roomIds.length} mapped rooms are available.`);
    }

    const portfolioSnapshotRows = (snapshotResult.data || []) as Array<DailyOverviewWorkRow & { business_date: string }>;
    if (portfolioSnapshotRows.length === 0) {
      throw new Error('Previo returned no future reservation snapshot. The planner will not guess Team B workload.');
    }

    const scopedSnapshotRows = filterSnapshotRowsToMappedRooms(portfolioSnapshotRows, rooms);
    const snapshotsByDate = groupRowsByBusinessDate(scopedSnapshotRows, planningWindow.dates);
    const tasksByDate = groupRowsByBusinessDate(
      ((taskResult.data || []) as Array<{ service_date: string; status: string }>).map(row => ({ ...row, business_date: row.service_date })),
      planningWindow.dates,
    );
    const staffByDate = groupRowsByBusinessDate(
      ((dayStaffResult.data || []) as Array<{ service_date: string; user_id: string }>).map(row => ({ ...row, business_date: row.service_date })),
      planningWindow.dates,
    );

    const defaults = ((memberResult.data || []) as Array<{ user_id: string; is_default: boolean }>).filter(row => row.is_default).length;
    setDefaultStaffCount(defaults);

    const next = planningWindow.dates.map(date => {
      const workload = buildSelectedDateHousekeepingWorkload(rooms, snapshotsByDate.get(date) || [], date);
      const counts = summarizeTeamWorkload(workload.rooms);
      return {
        date,
        checkoutCount: counts.confirmedCheckoutCount,
        dailyCount: counts.dailyCount,
        unsoldCount: counts.unsoldCount,
        towelCount: workload.rooms.filter(room => room.towel_change_required === true).length,
        linenCount: workload.rooms.filter(room => room.linen_change_required === true).length,
        pmsCapturedAt: workload.capturedAt,
        queuedTasks: (tasksByDate.get(date) || []).length,
        plannedStaff: (staffByDate.get(date) || []).length,
      } satisfies DaySummary;
    });

    setSummaries(next);
    setLastSyncedAt(next.map(day => day.pmsCapturedAt).filter((value): value is string => !!value).sort().at(-1) || new Date().toISOString());
  }, [organizationSlug, planningWindow.dates.join('|'), planningWindow.fromDate, planningWindow.toDateExclusive]);

  const syncDailyFallback = useCallback(async (hotelId: string) => {
    for (const date of planningWindow.dates) {
      const nextDate = new Date(`${date}T00:00:00Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      await invokeSlntOverview({ hotelId, fromDate: date, toDate: nextDate.toISOString().slice(0, 10), days: 1 });
    }
  }, [planningWindow.dates.join('|')]);

  const refreshRange = useCallback(async () => {
    if (!profile?.assigned_hotel || !organizationSlug || !isSlnt) return;
    setLoading(true);
    setError(null);
    try {
      const [hotelId, hotelKeys] = await Promise.all([
        resolveCanonicalHotelId(profile.assigned_hotel),
        resolveHotelKeys(profile.assigned_hotel),
      ]);
      if (!hotelId || hotelKeys.length === 0) throw new Error('The selected SLNT property could not be resolved.');
      try {
        const range = await invokeSlntOverview({ hotelId, fromDate: planningWindow.fromDate, toDate: planningWindow.toDateExclusive, days: 14 });
        setSyncMode('range');
        setLastSyncedAt(range?.capturedAt || new Date().toISOString());
      } catch (rangeError) {
        console.warn('[Slnt14DayHousekeepingPlanner] range sync failed; trying exact dates.', rangeError);
        await syncDailyFallback(hotelId);
        setSyncMode('daily-fallback');
        setLastSyncedAt(new Date().toISOString());
      }
      await loadStoredRange(hotelId, hotelKeys);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not prepare the next 14 days.';
      console.error('[Slnt14DayHousekeepingPlanner] refresh failed:', cause);
      setSummaries([]);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [isSlnt, loadStoredRange, organizationSlug, planningWindow.fromDate, planningWindow.toDateExclusive, profile?.assigned_hotel, syncDailyFallback]);

  useEffect(() => {
    if (open && isSlnt && canManage) void refreshRange();
  }, [open, isSlnt, canManage, refreshRange]);

  const openDayPlanner = (date: string) => {
    setSelectedDate(date);
    setOpen(false);
    setDayPlannerOpen(true);
  };

  if (!isSlnt || !canManage || !profile?.assigned_hotel) return null;
  const selectedSummary = summaries.find(day => day.date === selectedDate) || null;

  return (
    <>
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <CalendarDays className="h-4 w-4 text-primary" />
              Team B schedule · next 14 days
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick a date, choose who is working, then HotelCare balances the 46 Team B rooms automatically.
            </p>
          </div>
          <Button onClick={() => setOpen(true)} className="shrink-0">
            <CalendarDays className="mr-2 h-4 w-4" />Plan Team B schedule
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[94vh] max-h-[94vh] w-[98vw] max-w-[1500px] flex-col overflow-hidden p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              Team B schedule · next 14 days
              <Badge variant="outline">{planningWindow.fromDate} → {planningWindow.dates.at(-1)}</Badge>
              {defaultStaffCount > 0 && <Badge variant="secondary">{defaultStaffCount} default staff</Badge>}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div className="text-xs text-muted-foreground">
              {syncMode === 'range' && 'Previo: both SLNT accounts synced'}
              {syncMode === 'daily-fallback' && 'Previo: exact-date fallback used'}
              {!syncMode && 'Preparing live Team B planning data'}
              {lastSyncedAt ? ` · Updated ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </div>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void refreshRange()}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh 14 days
            </Button>
          </div>

          <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-sm text-sky-950 dark:bg-sky-950/20 dark:text-sky-100">
            Simple flow: <strong>choose a date → select working staff → review auto-balanced rooms → save.</strong> The Master Staff Schedule is separate and is not required here.
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            {error && <div role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
            {loading && summaries.length === 0 ? (
              <div className="flex min-h-32 items-start justify-center pt-6 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading Team B reservations…
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {summaries.map(day => {
                  const label = formatDay(day.date);
                  const selected = selectedDate === day.date;
                  const staffLabel = day.plannedStaff > 0
                    ? `${day.plannedStaff} staff selected`
                    : defaultStaffCount > 0
                      ? `${defaultStaffCount} defaults ready`
                      : 'Choose staff';
                  return (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() => setSelectedDate(day.date)}
                      className={`rounded-xl border p-3 text-left transition hover:border-primary hover:bg-primary/[0.03] ${selected ? 'border-primary ring-1 ring-primary' : 'bg-background'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold">{label.weekday} · {label.shortDate}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{day.date}</div>
                        </div>
                        {queueBadge(day.queuedTasks)}
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="rounded-md bg-muted/60 px-2 py-1.5"><strong className="block text-sm text-foreground">{day.checkoutCount}</strong>Checkout</div>
                        <div className="rounded-md bg-muted/60 px-2 py-1.5"><strong className="block text-sm text-foreground">{day.dailyCount}</strong>Daily</div>
                        <div className="rounded-md bg-muted/60 px-2 py-1.5"><strong className="block text-sm text-foreground">{day.unsoldCount}</strong>Unbooked</div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                        <span className={`rounded-full border px-2 py-0.5 ${day.plannedStaff > 0 ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : ''}`}>{staffLabel}</span>
                        {day.towelCount > 0 && <span className="rounded-full border px-2 py-0.5">Towel {day.towelCount}</span>}
                        {day.linenCount > 0 && <span className="rounded-full border px-2 py-0.5">Linen {day.linenCount}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedSummary && (
              <div className="sticky bottom-0 mt-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-primary" />{selectedSummary.date}</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedSummary.checkoutCount} checkout · {selectedSummary.dailyCount} daily · {selectedSummary.unsoldCount} unbooked · {selectedSummary.plannedStaff > 0 ? `${selectedSummary.plannedStaff} staff selected` : 'staff not selected yet'}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => openDayPlanner(selectedSummary.date)}>
                    <Wand2 className="mr-2 h-4 w-4" />
                    {selectedSummary.queuedTasks > 0 ? 'Review staff & rooms' : 'Choose staff & assign rooms'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            Unbooked rooms stay visible as provisional worst-case workload; they are not counted as confirmed checkouts.
          </div>
        </DialogContent>
      </Dialog>

      {selectedDate && dayPlannerOpen && (
        <SlntSelectedDateAssignmentPlanner
          open={dayPlannerOpen}
          selectedDate={selectedDate}
          onOpenChange={(nextOpen) => {
            setDayPlannerOpen(nextOpen);
            if (!nextOpen) {
              setOpen(true);
              void (async () => {
                try {
                  const [hotelId, hotelKeys] = await Promise.all([
                    resolveCanonicalHotelId(profile.assigned_hotel),
                    resolveHotelKeys(profile.assigned_hotel),
                  ]);
                  if (hotelId && hotelKeys.length > 0) await loadStoredRange(hotelId, hotelKeys);
                } catch (cause) {
                  console.warn('[Slnt14DayHousekeepingPlanner] post-plan refresh failed:', cause);
                }
              })();
            }
          }}
          onAssignmentCreated={() => undefined}
        />
      )}
    </>
  );
}

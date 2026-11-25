import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3, Loader2, RefreshCw, Users, Wand2 } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NextDayAssignmentPlanner } from './NextDayAssignmentPlanner';

type PlanStatus = 'draft' | 'approved' | 'releasing' | 'released' | 'cancelled' | 'failed';

type DaySummary = {
  date: string;
  checkoutCount: number;
  dailyCount: number;
  potentialCheckoutCount: number;
  towelCount: number;
  linenCount: number;
  pmsCapturedAt: string | null;
  planStatus: PlanStatus | null;
  publishedStaff: number;
  draftStaff: number;
  offStaff: number;
};

type SyncMode = 'range' | 'daily-fallback' | null;

function formatDay(date: string): { weekday: string; shortDate: string } {
  const value = new Date(`${date}T12:00:00`);
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(value),
    shortDate: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(value),
  };
}

function planBadge(status: PlanStatus | null) {
  if (status === 'released') return <Badge className="bg-emerald-600">Released</Badge>;
  if (status === 'approved') return <Badge className="bg-emerald-600">Approved</Badge>;
  if (status === 'releasing') return <Badge>Releasing</Badge>;
  if (status === 'draft') return <Badge variant="outline">Draft</Badge>;
  if (status === 'failed') return <Badge variant="destructive">Needs review</Badge>;
  if (status === 'cancelled') return <Badge variant="secondary">Cancelled</Badge>;
  return <Badge variant="secondary">Not prepared</Badge>;
}

/**
 * SLNT-only future housekeeping surface.
 *
 * It intentionally reuses the same Previo daily-overview feed and selected-date
 * workload builder as tomorrow planning. The preferred path is one range sync
 * covering D+1..D+14. If that range call cannot complete, the exact same edge
 * function is retried once per business date. Group A/B assignment is a later
 * configuration layer and is deliberately not hardcoded here.
 */
export function Slnt14DayHousekeepingPlanner() {
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

  const planningWindow = useMemo(
    () => buildSlnt14DayPlanningWindow(todayBudapest()),
    [open],
  );

  const loadStoredRange = useCallback(async (hotelId: string, hotelKeys: string[]) => {
    if (!organizationSlug) return;
    const [roomResult, snapshotResult, planResult, scheduleResult] = await Promise.all([
      supabase
        .from('rooms')
        .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
        .in('hotel', hotelKeys),
      (supabase as any)
        .from('daily_overview_snapshots')
        .select('business_date,room_label,room_number,arrival_date,departure_date,status,housekeeping_dep,housekeeping_stay,captured_at')
        .eq('organization_slug', organizationSlug)
        .eq('hotel_id', hotelId)
        .eq('source', 'previo')
        .gte('business_date', planningWindow.fromDate)
        .lt('business_date', planningWindow.toDateExclusive),
      (supabase as any)
        .from('next_day_housekeeping_plans')
        .select('plan_date,status')
        .eq('organization_slug', organizationSlug)
        .eq('hotel_id', hotelId)
        .gte('plan_date', planningWindow.fromDate)
        .lt('plan_date', planningWindow.toDateExclusive),
      (supabase as any)
        .from('staff_schedules')
        .select('work_date,status')
        .eq('organization_slug', organizationSlug)
        .eq('hotel_id', hotelId)
        .gte('work_date', planningWindow.fromDate)
        .lt('work_date', planningWindow.toDateExclusive),
    ]);

    if (roomResult.error) throw roomResult.error;
    if (snapshotResult.error) throw snapshotResult.error;
    if (planResult.error) throw planResult.error;
    if (scheduleResult.error) throw scheduleResult.error;

    const snapshotRows = (snapshotResult.data || []) as Array<DailyOverviewWorkRow & { business_date: string }>;
    const snapshotsByDate = groupRowsByBusinessDate(snapshotRows, planningWindow.dates);
    const planByDate = new Map<string, PlanStatus>(
      (planResult.data || []).map((plan: any) => [plan.plan_date, plan.status as PlanStatus]),
    );
    const schedulesByDate = groupRowsByBusinessDate(
      ((scheduleResult.data || []) as Array<{ work_date: string; status: string }>).map(row => ({
        ...row,
        business_date: row.work_date,
      })),
      planningWindow.dates,
    );

    const next = planningWindow.dates.map(date => {
      const workload = buildSelectedDateHousekeepingWorkload(
        roomResult.data || [],
        snapshotsByDate.get(date) || [],
        date,
      );
      const schedules = schedulesByDate.get(date) || [];
      return {
        date,
        checkoutCount: Math.max(0, workload.checkoutCount - workload.potentialCheckoutCount),
        dailyCount: workload.dailyCount,
        potentialCheckoutCount: workload.potentialCheckoutCount,
        towelCount: workload.rooms.filter(room => room.towel_change_required === true).length,
        linenCount: workload.rooms.filter(room => room.linen_change_required === true).length,
        pmsCapturedAt: workload.capturedAt,
        planStatus: planByDate.get(date) || null,
        publishedStaff: schedules.filter(row => row.status === 'published').length,
        draftStaff: schedules.filter(row => row.status === 'draft').length,
        offStaff: schedules.filter(row => row.status === 'off').length,
      } satisfies DaySummary;
    });

    setSummaries(next);
    const newestCapture = next
      .map(day => day.pmsCapturedAt)
      .filter((value): value is string => !!value)
      .sort()
      .at(-1) || null;
    if (newestCapture) setLastSyncedAt(newestCapture);
  }, [organizationSlug, planningWindow.dates.join('|'), planningWindow.fromDate, planningWindow.toDateExclusive]);

  const syncDailyFallback = useCallback(async (hotelId: string) => {
    for (const date of planningWindow.dates) {
      const nextDate = new Date(`${date}T00:00:00Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      const toDate = nextDate.toISOString().slice(0, 10);
      const { data, error: invokeError } = await supabase.functions.invoke('previo-sync-daily-overview', {
        body: { hotelId, fromDate: date, toDate, days: 1 },
      });
      if (invokeError || (data as any)?.ok === false || (data as any)?.error) {
        throw new Error((data as any)?.error || invokeError?.message || `Could not sync ${date} from Previo.`);
      }
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

      const { data, error: invokeError } = await supabase.functions.invoke('previo-sync-daily-overview', {
        body: {
          hotelId,
          fromDate: planningWindow.fromDate,
          toDate: planningWindow.toDateExclusive,
          days: 14,
        },
      });

      const rangeFailed = !!invokeError || (data as any)?.ok === false || (data as any)?.error || (data as any)?.supported === false;
      if (rangeFailed) {
        console.warn('[Slnt14DayHousekeepingPlanner] range sync unavailable; using date-by-date fallback.', invokeError || data);
        await syncDailyFallback(hotelId);
        setSyncMode('daily-fallback');
      } else {
        setSyncMode('range');
      }

      setLastSyncedAt(new Date().toISOString());
      await loadStoredRange(hotelId, hotelKeys);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not prepare the next 14 days.';
      console.error('[Slnt14DayHousekeepingPlanner] refresh failed:', cause);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [
    isSlnt,
    loadStoredRange,
    organizationSlug,
    planningWindow.fromDate,
    planningWindow.toDateExclusive,
    profile?.assigned_hotel,
    syncDailyFallback,
  ]);

  useEffect(() => {
    if (!open || !isSlnt || !canManage) return;
    void refreshRange();
  }, [open, isSlnt, canManage, refreshRange]);

  const openStaffSchedule = (date: string) => {
    if (!profile?.assigned_hotel) return;
    setOpen(false);
    window.dispatchEvent(new CustomEvent('hotelcare:open-slnt-staff-schedule', {
      detail: { hotel: profile.assigned_hotel, date },
    }));
  };

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
              Next 14 days assignments
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Prepare SLNT housekeeping day by day from live Previo reservations. Today&apos;s Auto Assign remains separate.
            </p>
          </div>
          <Button onClick={() => setOpen(true)} className="shrink-0">
            <CalendarDays className="mr-2 h-4 w-4" />
            Plan next 14 days
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[94vh] max-h-[94vh] w-[98vw] max-w-[1500px] flex-col overflow-hidden p-4 sm:p-6">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              Next 14 days assignments
              <Badge variant="outline">{planningWindow.fromDate} → {planningWindow.dates.at(-1)}</Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div className="text-xs text-muted-foreground">
              {syncMode === 'range' && 'Previo: one 14-day range request'}
              {syncMode === 'daily-fallback' && 'Previo: date-by-date fallback used'}
              {!syncMode && 'Preparing Previo planning data'}
              {lastSyncedAt ? ` · Updated ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </div>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void refreshRange()}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh 14 days
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-4">
            <div className="mb-4 rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
              <strong>Group mapping pending Excel.</strong> The 14-day PMS, workload, plan lifecycle and Staff Schedule foundations are active now. Group A/B room ownership will be connected as a separate assignment strategy when the mapping sheet is imported.
            </div>

            {error && (
              <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {loading && summaries.length === 0 ? (
              <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Loading the next 14 days from Previo…
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {summaries.map(day => {
                  const label = formatDay(day.date);
                  const selected = selectedDate === day.date;
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
                        {planBadge(day.planStatus)}
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="rounded-md bg-muted/60 px-2 py-1.5"><strong className="block text-sm text-foreground">{day.checkoutCount}</strong>Checkout</div>
                        <div className="rounded-md bg-muted/60 px-2 py-1.5"><strong className="block text-sm text-foreground">{day.dailyCount}</strong>Daily</div>
                        <div className="rounded-md bg-muted/60 px-2 py-1.5"><strong className="block text-sm text-foreground">{day.potentialCheckoutCount}</strong>Unsold</div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                        {day.towelCount > 0 && <span className="rounded-full border px-2 py-0.5">Towel {day.towelCount}</span>}
                        {day.linenCount > 0 && <span className="rounded-full border px-2 py-0.5">Linen {day.linenCount}</span>}
                        <span className="rounded-full border px-2 py-0.5">Published staff {day.publishedStaff}</span>
                        {day.draftStaff > 0 && <span className="rounded-full border px-2 py-0.5">Draft {day.draftStaff}</span>}
                        {day.offStaff > 0 && <span className="rounded-full border px-2 py-0.5">Off {day.offStaff}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedSummary && (
              <div className="sticky bottom-0 mt-4 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      {selectedSummary.date}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedSummary.checkoutCount} confirmed checkouts · {selectedSummary.dailyCount} daily rooms · {selectedSummary.potentialCheckoutCount} unsold/provisional · {selectedSummary.publishedStaff} published staff
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => openStaffSchedule(selectedSummary.date)}>
                      <Users className="mr-2 h-4 w-4" />
                      Staff schedule
                    </Button>
                    <Button size="sm" onClick={() => openDayPlanner(selectedSummary.date)}>
                      <Wand2 className="mr-2 h-4 w-4" />
                      Prepare / review day
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            Future plans remain date-specific. Existing manager changes are loaded from the saved plan instead of being recreated.
          </div>
        </DialogContent>
      </Dialog>

      {selectedDate && dayPlannerOpen && (
        <NextDayAssignmentPlanner
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

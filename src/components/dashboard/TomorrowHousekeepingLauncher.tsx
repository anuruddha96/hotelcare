import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format } from 'date-fns';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Eye,
  Loader2,
  PauseCircle,
  X,
} from 'lucide-react';
import { AutoRoomAssignment } from './AutoRoomAssignment';
import { TodayHousekeepingPlanReviewDialog } from './TodayHousekeepingPlanReviewDialog';
import { TomorrowReleaseTimeControl } from './TomorrowReleaseTimeControl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { isBudapestNineOrLater, todayBudapest } from '@/lib/budapestTime';
import { resolveCanonicalHotelId } from '@/lib/hotelKeys';
import { hasManagerPowers } from '@/lib/roleAccess';
import { housekeepingAutomationText } from '@/lib/housekeepingAutomationTranslations';
import { housekeepingTeamViewText } from '@/lib/housekeepingTeamViewTranslations';
import {
  findCurrentDayHousekeepingReviewPlan,
  findTomorrowHousekeepingPlan,
} from '@/lib/nextDayHousekeepingLauncher';
import { normalizeNextDayReleaseTime } from '@/lib/nextDayReleaseTime';
import {
  tomorrowHousekeepingStatusText,
  type TomorrowHousekeepingStatusTextKey,
} from '@/lib/tomorrowHousekeepingStatusTranslations';

type TomorrowPlanRow = {
  id: string;
  plan_date: string;
  status: 'draft' | 'approved' | 'releasing' | 'released' | 'cancelled' | 'failed';
  auto_release: boolean;
  release_time: string | null;
  scheduled_release_at: string | null;
  release_revalidation_status: 'pending' | 'running' | 'passed' | 'failed' | null;
  release_revalidation_attempt_count: number | null;
  release_result: Record<string, unknown> | null;
  last_error: string | null;
  released_at: string | null;
};

type StatusPresentation = {
  labelKey: TomorrowHousekeepingStatusTextKey;
  hintKey: TomorrowHousekeepingStatusTextKey;
  actionKey: TomorrowHousekeepingStatusTextKey;
  badgeClassName: string;
  Icon: React.ComponentType<{ className?: string }>;
  spin?: boolean;
};

function numberFrom(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getStatusPresentation(
  plan: TomorrowPlanRow | null,
  loading: boolean,
  unavailable: boolean,
): StatusPresentation {
  if (loading) {
    return {
      labelKey: 'checkingStatus',
      hintKey: 'checkingStatus',
      actionKey: 'preparePlan',
      badgeClassName: 'border-primary/30 bg-primary/10 text-primary',
      Icon: Loader2,
      spin: true,
    };
  }

  if (unavailable) {
    return {
      labelKey: 'statusUnavailable',
      hintKey: 'statusUnavailableHint',
      actionKey: 'reviewPlan',
      badgeClassName: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
      Icon: AlertTriangle,
    };
  }

  if (!plan) {
    return {
      labelKey: 'notPrepared',
      hintKey: 'notPreparedHint',
      actionKey: 'preparePlan',
      badgeClassName: 'border-muted-foreground/25 bg-muted/50 text-muted-foreground',
      Icon: CircleDashed,
    };
  }

  if (plan.status === 'released') {
    return {
      labelKey: 'released',
      hintKey: 'releasedHint',
      actionKey: 'reviewPlan',
      badgeClassName: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
      Icon: CheckCircle2,
    };
  }

  if (plan.status === 'failed') {
    return {
      labelKey: 'failed',
      hintKey: 'failedHint',
      actionKey: 'reviewPlan',
      badgeClassName: 'border-destructive/30 bg-destructive/10 text-destructive',
      Icon: AlertTriangle,
    };
  }

  if (plan.status === 'cancelled') {
    return {
      labelKey: 'cancelled',
      hintKey: 'cancelledHint',
      actionKey: 'preparePlan',
      badgeClassName: 'border-muted-foreground/25 bg-muted/50 text-muted-foreground',
      Icon: CircleDashed,
    };
  }

  if (plan.status === 'releasing' || plan.release_revalidation_status === 'running') {
    return {
      labelKey: 'releasing',
      hintKey: 'releasingHint',
      actionKey: 'reviewPlan',
      badgeClassName: 'border-primary/30 bg-primary/10 text-primary',
      Icon: Loader2,
      spin: true,
    };
  }

  if (plan.status === 'draft') {
    return {
      labelKey: 'draftPlan',
      hintKey: 'draftPlanHint',
      actionKey: 'continuePlan',
      badgeClassName: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
      Icon: CalendarClock,
    };
  }

  if (plan.status === 'approved' && !plan.auto_release) {
    return {
      labelKey: 'approvedHeld',
      hintKey: 'approvedHeldHint',
      actionKey: 'reviewPlan',
      badgeClassName: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
      Icon: PauseCircle,
    };
  }

  if (
    plan.status === 'approved'
    && plan.release_revalidation_status === 'failed'
    && numberFrom(plan.release_revalidation_attempt_count) > 0
  ) {
    return {
      labelKey: 'releaseRetrying',
      hintKey: 'releaseRetryingHint',
      actionKey: 'reviewPlan',
      badgeClassName: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
      Icon: Loader2,
      spin: true,
    };
  }

  return {
    labelKey: 'approvedAuto',
    hintKey: 'approvedAutoHint',
    actionKey: 'reviewPlan',
    badgeClassName: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
    Icon: CheckCircle2,
  };
}

function ReleaseSummary({ plan }: { plan: TomorrowPlanRow }) {
  const releaseResult = plan.release_result || {};
  const plannedAssignments = numberFrom(releaseResult.planned_assignments);
  const releasedAssignments = numberFrom(releaseResult.released_assignments);
  const skippedAssignments = Math.max(0, plannedAssignments - releasedAssignments);
  const overnightChanges = numberFrom(releaseResult.overnight_type_changes);

  if (plan.status !== 'released' || plannedAssignments <= 0) return null;

  return (
    <div
      className="flex flex-wrap gap-2 text-xs text-muted-foreground"
      aria-label={housekeepingTeamViewText('releaseSummary')}
    >
      <span className="rounded-full border bg-background/70 px-2.5 py-1">
        <strong className="font-semibold text-foreground">{releasedAssignments}</strong>{' '}
        {tomorrowHousekeepingStatusText('releasedAssignments')}
      </span>
      {skippedAssignments > 0 ? (
        <span className="rounded-full border bg-background/70 px-2.5 py-1">
          <strong className="font-semibold text-foreground">{skippedAssignments}</strong>{' '}
          {tomorrowHousekeepingStatusText('skippedAssignments')}
        </span>
      ) : null}
      {overnightChanges > 0 ? (
        <span className="rounded-full border bg-background/70 px-2.5 py-1">
          <strong className="font-semibold text-foreground">{overnightChanges}</strong>{' '}
          {tomorrowHousekeepingStatusText('overnightChanges')}
        </span>
      ) : null}
    </div>
  );
}

function dismissalStorageKey(kind: 'today' | 'tomorrow', date: string) {
  return `hotelcare:housekeeping-team-view:${kind}:${date}`;
}

function readDismissed(kind: 'today' | 'tomorrow', date: string) {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(dismissalStorageKey(kind, date)) === '1';
}

/**
 * Team View entry point for next-day housekeeping.
 *
 * Today's operational plan (prepared yesterday) is a separate, read-only review
 * surface so it never disappears when the tomorrow planner is hidden or opened.
 * Tomorrow preparation becomes available from 09:00 Europe/Budapest.
 */
export function TomorrowHousekeepingLauncher() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [todayPlan, setTodayPlan] = useState<TomorrowPlanRow | null>(null);
  const [tomorrowPlan, setTomorrowPlan] = useState<TomorrowPlanRow | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [budapestDate, setBudapestDate] = useState(todayBudapest());
  const [planningWindowOpen, setPlanningWindowOpen] = useState(isBudapestNineOrLater());
  const [todayDismissed, setTodayDismissed] = useState(false);
  const [tomorrowDismissed, setTomorrowDismissed] = useState(false);
  const requestGeneration = useRef(0);

  const tomorrowDate = useMemo(
    () => format(addDays(new Date(`${budapestDate}T12:00:00`), 1), 'yyyy-MM-dd'),
    [budapestDate],
  );

  const canManage = hasManagerPowers(profile?.role);

  useEffect(() => {
    setTodayDismissed(readDismissed('today', budapestDate));
    setTomorrowDismissed(readDismissed('tomorrow', tomorrowDate));
  }, [budapestDate, tomorrowDate]);

  const dismissCard = useCallback((kind: 'today' | 'tomorrow', date: string) => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(dismissalStorageKey(kind, date), '1');
    }
    if (kind === 'today') setTodayDismissed(true);
    else setTomorrowDismissed(true);
  }, []);

  const loadStatus = useCallback(async (showLoading = false) => {
    if (!canManage || !profile?.assigned_hotel || !profile.organization_slug) {
      setTodayPlan(null);
      setTomorrowPlan(null);
      setStatusUnavailable(false);
      setStatusLoading(false);
      return;
    }

    const generation = ++requestGeneration.current;
    if (showLoading) setStatusLoading(true);

    try {
      const hotelId = await resolveCanonicalHotelId(profile.assigned_hotel);
      if (!hotelId) throw new Error('Hotel ID could not be resolved.');

      const { data, error } = await (supabase as any)
        .from('next_day_housekeeping_plans')
        .select('id,plan_date,status,auto_release,release_time,scheduled_release_at,release_revalidation_status,release_revalidation_attempt_count,release_result,last_error,released_at')
        .eq('organization_slug', profile.organization_slug)
        .eq('hotel_id', hotelId)
        .in('plan_date', [budapestDate, tomorrowDate]);

      if (error) throw error;
      if (requestGeneration.current !== generation) return;

      const rows = (data || []) as TomorrowPlanRow[];
      setTodayPlan(findCurrentDayHousekeepingReviewPlan(rows, budapestDate));
      setTomorrowPlan(findTomorrowHousekeepingPlan(rows, tomorrowDate));
      setStatusUnavailable(false);
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      console.warn('[TomorrowHousekeepingLauncher] plan status unavailable:', error);
      setTodayPlan(null);
      setTomorrowPlan(null);
      setStatusUnavailable(true);
    } finally {
      if (requestGeneration.current === generation) setStatusLoading(false);
    }
  }, [
    budapestDate,
    canManage,
    profile?.assigned_hotel,
    profile?.organization_slug,
    tomorrowDate,
  ]);

  useEffect(() => {
    if (!canManage) return;

    void loadStatus(true);

    const refresh = () => {
      const currentBudapestDate = todayBudapest();
      const availableNow = isBudapestNineOrLater();
      const dateChanged = currentBudapestDate !== budapestDate;
      const windowChanged = availableNow !== planningWindowOpen;

      if (dateChanged) setBudapestDate(currentBudapestDate);
      if (windowChanged) setPlanningWindowOpen(availableNow);
      if (!dateChanged && !windowChanged) void loadStatus(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('hk-next-day-plan-changed', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    const interval = window.setInterval(refresh, 30_000);

    return () => {
      window.removeEventListener('hk-next-day-plan-changed', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(interval);
    };
  }, [canManage, budapestDate, loadStatus, planningWindowOpen]);

  if (!canManage || (!planningWindowOpen && !todayPlan)) return null;

  const closePlanner = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) void loadStatus(false);
  };

  const todayPresentation = getStatusPresentation(todayPlan, false, false);
  const TodayStatusIcon = todayPresentation.Icon;
  const todayReleaseTime = normalizeNextDayReleaseTime(todayPlan?.release_time);
  const todayStatusHint = tomorrowHousekeepingStatusText(todayPresentation.hintKey).replace('08:00', todayReleaseTime);

  const tomorrowPresentation = getStatusPresentation(tomorrowPlan, statusLoading, statusUnavailable);
  const TomorrowStatusIcon = tomorrowPresentation.Icon;
  const tomorrowReleaseTime = normalizeNextDayReleaseTime(tomorrowPlan?.release_time);
  const tomorrowStatusHint = tomorrowHousekeepingStatusText(tomorrowPresentation.hintKey).replace('08:00', tomorrowReleaseTime);
  const tomorrowActionLabel = tomorrowHousekeepingStatusText(tomorrowPresentation.actionKey);

  return (
    <>
      <div className="space-y-3">
        {todayPlan && !todayDismissed ? (
          <Card
            className="relative overflow-hidden border-slate-300/70 bg-gradient-to-r from-slate-50 via-background to-background shadow-sm dark:border-slate-700 dark:from-slate-950/40"
            data-training="today-housekeeping-plan-review"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 z-10 h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
              aria-label={housekeepingTeamViewText('dismissToday')}
              title={housekeepingTeamViewText('dismissToday')}
              onClick={() => dismissCard('today', budapestDate)}
            >
              <X className="h-4 w-4" />
            </Button>
            <CardContent className="p-4 pr-12 sm:p-5 sm:pr-14">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                    <Eye className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold leading-tight">{housekeepingTeamViewText('todayTitle')}</h3>
                      <Badge variant="outline" className={`gap-1.5 ${todayPresentation.badgeClassName}`}>
                        <TodayStatusIcon className={`h-3.5 w-3.5 ${todayPresentation.spin ? 'animate-spin' : ''}`} />
                        {tomorrowHousekeepingStatusText(todayPresentation.labelKey)}
                      </Badge>
                      <TomorrowReleaseTimeControl plan={todayPlan} onSaved={() => void loadStatus(false)} />
                      <Badge variant="secondary">{todayPlan.plan_date}</Badge>
                    </div>
                    <p className="max-w-3xl text-sm text-muted-foreground">{todayStatusHint}</p>
                    <ReleaseSummary plan={todayPlan} />
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReviewOpen(true)}
                  className="w-full shrink-0 gap-2 sm:w-auto"
                >
                  <Eye className="h-4 w-4" />
                  {housekeepingTeamViewText('viewAssignments')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {planningWindowOpen && !tomorrowDismissed ? (
          <Card
            className="relative overflow-hidden border-primary/30 bg-gradient-to-r from-primary/10 via-primary/5 to-background shadow-sm"
            data-training="tomorrow-housekeeping-plan"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 z-10 h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
              aria-label={housekeepingTeamViewText('dismissTomorrow')}
              title={housekeepingTeamViewText('dismissTomorrow')}
              onClick={() => dismissCard('tomorrow', tomorrowDate)}
            >
              <X className="h-4 w-4" />
            </Button>
            <CardContent className="p-4 pr-12 sm:p-5 sm:pr-14">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <CalendarClock className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold leading-tight">{housekeepingAutomationText('title')}</h3>
                      <Badge variant="outline" className={`gap-1.5 ${tomorrowPresentation.badgeClassName}`}>
                        <TomorrowStatusIcon className={`h-3.5 w-3.5 ${tomorrowPresentation.spin ? 'animate-spin' : ''}`} />
                        {tomorrowHousekeepingStatusText(tomorrowPresentation.labelKey)}
                      </Badge>
                      <TomorrowReleaseTimeControl plan={tomorrowPlan} onSaved={() => void loadStatus(false)} />
                      <Badge variant="secondary">{tomorrowDate}</Badge>
                    </div>

                    <p className="max-w-3xl text-sm text-muted-foreground">{tomorrowStatusHint}</p>
                    {tomorrowPlan ? (
                      <ReleaseSummary plan={tomorrowPlan} />
                    ) : (
                      <p className="max-w-3xl text-xs text-muted-foreground/80">
                        {housekeepingAutomationText('subtitle')}
                      </p>
                    )}
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="w-full shrink-0 gap-2 sm:w-auto"
                  data-tour="prepare-tomorrow-housekeeping"
                  disabled={statusLoading}
                >
                  <CalendarClock className="h-4 w-4" />
                  <span className="max-w-[240px] truncate">{tomorrowActionLabel}</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <TodayHousekeepingPlanReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        plan={todayPlan}
      />

      {open ? (
        <AutoRoomAssignment
          open={open}
          onOpenChange={closePlanner}
          selectedDate={tomorrowDate}
          onAssignmentCreated={() => {
            setOpen(false);
            void loadStatus(false);
          }}
        />
      ) : null}
    </>
  );
}

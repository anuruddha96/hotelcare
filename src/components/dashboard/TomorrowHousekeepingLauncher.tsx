import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format } from 'date-fns';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Loader2,
  PauseCircle,
} from 'lucide-react';
import { AutoRoomAssignment } from './AutoRoomAssignment';
import { TomorrowReleaseTimeControl } from './TomorrowReleaseTimeControl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { isBudapestNoonOrLater, todayBudapest } from '@/lib/budapestTime';
import { resolveCanonicalHotelId } from '@/lib/hotelKeys';
import { hasManagerPowers } from '@/lib/roleAccess';
import { housekeepingAutomationText } from '@/lib/housekeepingAutomationTranslations';
import { normalizeNextDayReleaseTime } from '@/lib/nextDayReleaseTime';
import {
  tomorrowHousekeepingStatusText,
  type TomorrowHousekeepingStatusTextKey,
} from '@/lib/tomorrowHousekeepingStatusTranslations';

type TomorrowPlanRow = {
  id: string;
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

/**
 * Discoverable Team View entry point for the next-day housekeeping planner.
 *
 * Tomorrow planning is intentionally available only from 12:00 Budapest time.
 * Before noon the component renders nothing, keeping the morning workspace
 * focused on today's operation. The actual planning workflow stays owned by
 * AutoRoomAssignment/NextDayAssignmentPlanner.
 */
export function TomorrowHousekeepingLauncher() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<TomorrowPlanRow | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [budapestDate, setBudapestDate] = useState(todayBudapest());
  const [planningWindowOpen, setPlanningWindowOpen] = useState(isBudapestNoonOrLater());
  const requestGeneration = useRef(0);

  const tomorrowDate = useMemo(
    () => format(addDays(new Date(`${budapestDate}T12:00:00`), 1), 'yyyy-MM-dd'),
    [budapestDate],
  );

  const canManage = hasManagerPowers(profile?.role);

  const loadStatus = useCallback(async (showLoading = false) => {
    if (!canManage || !profile?.assigned_hotel || !profile.organization_slug) {
      setPlan(null);
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
        .select('id,status,auto_release,release_time,scheduled_release_at,release_revalidation_status,release_revalidation_attempt_count,release_result,last_error,released_at')
        .eq('organization_slug', profile.organization_slug)
        .eq('hotel_id', hotelId)
        .eq('plan_date', tomorrowDate)
        .maybeSingle();

      if (error) throw error;
      if (requestGeneration.current !== generation) return;

      setPlan((data || null) as TomorrowPlanRow | null);
      setStatusUnavailable(false);
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      console.warn('[TomorrowHousekeepingLauncher] plan status unavailable:', error);
      setStatusUnavailable(true);
    } finally {
      if (requestGeneration.current === generation) setStatusLoading(false);
    }
  }, [canManage, profile?.assigned_hotel, profile?.organization_slug, tomorrowDate]);

  useEffect(() => {
    if (!canManage) return;

    if (planningWindowOpen) {
      void loadStatus(true);
    } else {
      requestGeneration.current += 1;
      setOpen(false);
      setPlan(null);
      setStatusUnavailable(false);
      setStatusLoading(false);
    }

    const refresh = () => {
      const currentBudapestDate = todayBudapest();
      const availableNow = isBudapestNoonOrLater();
      setBudapestDate(current => current === currentBudapestDate ? current : currentBudapestDate);
      setPlanningWindowOpen(current => current === availableNow ? current : availableNow);
      if (availableNow && planningWindowOpen) void loadStatus(false);
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
  }, [canManage, loadStatus, planningWindowOpen]);

  if (!canManage || !planningWindowOpen) return null;

  const title = housekeepingAutomationText('title');
  const subtitle = housekeepingAutomationText('subtitle');
  const releaseTime = normalizeNextDayReleaseTime(plan?.release_time);
  const presentation = getStatusPresentation(plan, statusLoading, statusUnavailable);
  const StatusIcon = presentation.Icon;
  const statusLabel = tomorrowHousekeepingStatusText(presentation.labelKey);
  const statusHint = tomorrowHousekeepingStatusText(presentation.hintKey).replace('08:00', releaseTime);
  const actionLabel = tomorrowHousekeepingStatusText(presentation.actionKey);

  const releaseResult = plan?.release_result || {};
  const plannedAssignments = numberFrom(releaseResult.planned_assignments);
  const releasedAssignments = numberFrom(releaseResult.released_assignments);
  const skippedAssignments = Math.max(0, plannedAssignments - releasedAssignments);
  const overnightChanges = numberFrom(releaseResult.overnight_type_changes);
  const showReleaseSummary = plan?.status === 'released' && plannedAssignments > 0;

  const closePlanner = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) void loadStatus(false);
  };

  return (
    <>
      <Card
        className="overflow-hidden border-primary/30 bg-gradient-to-r from-primary/10 via-primary/5 to-background shadow-sm"
        data-training="tomorrow-housekeeping-plan"
      >
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold leading-tight">{title}</h3>
                  <Badge variant="outline" className={`gap-1.5 ${presentation.badgeClassName}`}>
                    <StatusIcon className={`h-3.5 w-3.5 ${presentation.spin ? 'animate-spin' : ''}`} />
                    {statusLabel}
                  </Badge>
                  <TomorrowReleaseTimeControl plan={plan} onSaved={() => void loadStatus(false)} />
                  <Badge variant="secondary">{tomorrowDate}</Badge>
                </div>

                <p className="max-w-3xl text-sm text-muted-foreground">{statusHint}</p>

                {showReleaseSummary ? (
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground" aria-label="Tomorrow housekeeping release summary">
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
                ) : (
                  <p className="max-w-3xl text-xs text-muted-foreground/80">{subtitle}</p>
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
              <span className="max-w-[240px] truncate">{actionLabel}</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {open && (
        <AutoRoomAssignment
          open={open}
          onOpenChange={closePlanner}
          selectedDate={tomorrowDate}
          onAssignmentCreated={() => {
            setOpen(false);
            void loadStatus(false);
          }}
        />
      )}
    </>
  );
}

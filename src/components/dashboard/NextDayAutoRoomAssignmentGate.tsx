import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Database,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { tomorrowBudapest } from '@/lib/budapestTime';
import { resolveCanonicalHotelId } from '@/lib/hotelKeys';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { isVerifiedSparseTomorrowSnapshot } from '@/lib/nextDayPmsGateCoverage';
import {
  ensureTomorrowPmsSnapshot,
  type TomorrowPmsProgressEvent,
  type TomorrowPmsProgressPhase,
  type TomorrowSnapshotState,
} from '@/lib/nextDayAutoAssignBridge';
import { AutoRoomAssignment as AutoRoomAssignmentImpl } from './AutoRoomAssignmentImpl';

type Props = React.ComponentProps<typeof AutoRoomAssignmentImpl>;

type Stage = 'checking' | 'syncing' | 'ready' | 'error';

type PmsDaySummary = {
  date: string;
  checkoutCount: number;
  dailyCount: number;
  otherCount: number;
  totalRows: number;
  capturedAt: string | null;
};

const EXPECTED_SYNC_SECONDS = 15;

const PHASE_PROGRESS: Record<TomorrowPmsProgressPhase, number> = {
  'checking-cache': 14,
  'refreshing-session': 28,
  'refreshing-live-room-state': 45,
  'contacting-previo': 66,
  retrying: 72,
  'validating-snapshot': 88,
};

const PHASE_STEP: Record<TomorrowPmsProgressPhase, number> = {
  'checking-cache': 0,
  'refreshing-session': 0,
  'refreshing-live-room-state': 1,
  'contacting-previo': 1,
  retrying: 1,
  'validating-snapshot': 2,
};

function progressCopy(event: TomorrowPmsProgressEvent, selectedDate: string): {
  title: string;
  detail: string;
} {
  switch (event.phase) {
    case 'checking-cache':
      return {
        title: 'Checking the latest verified PMS snapshot',
        detail: `Looking for a recent exact-date snapshot for ${selectedDate} before contacting Previo.`,
      };
    case 'refreshing-session':
      return {
        title: 'Preparing a secure PMS connection',
        detail: 'HotelCare is refreshing the signed-in session before the live PMS request.',
      };
    case 'refreshing-live-room-state':
      return {
        title: 'Refreshing live room status',
        detail: 'Current PMS room state is being checked without changing any housekeeping assignment.',
      };
    case 'contacting-previo':
      return {
        title: event.attempt > 1
          ? `Downloading tomorrow’s reservations · attempt ${event.attempt}/${event.maxAttempts}`
          : 'Downloading tomorrow’s reservations from Previo',
        detail: `Only the ${selectedDate} dataset will be used for tomorrow’s plan.`,
      };
    case 'retrying':
      return {
        title: `Connection was slow · retrying automatically ${event.attempt}/${event.maxAttempts}`,
        detail: 'No action is needed. HotelCare is retrying the PMS request safely.',
      };
    case 'validating-snapshot':
      return {
        title: 'Validating tomorrow’s room data',
        detail: 'Checking the date, room coverage and PMS freshness before the assignment screen opens.',
      };
  }
}

function friendlyPmsError(raw: string | null): {
  title: string;
  detail: string;
  technical: string | null;
} {
  const message = raw || 'Unknown PMS verification error.';
  if (/failed to send a request to the edge function|failed to fetch|network|load failed|fetcherror|connection (?:reset|closed)|timeout|timed out/i.test(message)) {
    return {
      title: 'Previo connection did not complete',
      detail: 'HotelCare retried the live PMS request automatically, but the connection still did not complete. No tomorrow plan was changed or saved.',
      technical: message,
    };
  }
  if (/session expired|sign in again|unauthorized|401/i.test(message)) {
    return {
      title: 'Your PMS session needs to be refreshed',
      detail: 'Please sign in again, then retry. No tomorrow plan was changed or saved.',
      technical: message,
    };
  }
  return {
    title: 'Could not verify tomorrow’s PMS data',
    detail: message,
    technical: null,
  };
}

function classifyPmsDayRow(row: any, selectedDate: string): 'checkout' | 'daily' | 'other' {
  const checkout = row.departure_date === selectedDate
    || row.status === 'departing'
    || String(row.housekeeping_dep || '').toUpperCase() === 'DEP';
  if (checkout) return 'checkout';

  const daily = row.status === 'ongoing'
    || (!!row.arrival_date && !!row.departure_date
      && row.arrival_date < selectedDate && row.departure_date > selectedDate);
  return daily ? 'daily' : 'other';
}

async function loadExactPmsDaySummary(args: {
  organizationSlug: string;
  hotelId: string;
  selectedDate: string;
  allowOtherRows: boolean;
}): Promise<PmsDaySummary | null> {
  const { data, error } = await (supabase as any)
    .from('daily_overview_snapshots')
    .select('business_date,arrival_date,departure_date,status,housekeeping_dep,captured_at')
    .eq('organization_slug', args.organizationSlug)
    .eq('hotel_id', args.hotelId)
    .eq('business_date', args.selectedDate)
    .eq('source', 'previo');
  if (error) throw error;

  const rows = data || [];
  if (rows.length === 0) return null;
  if (rows.some((row: any) => row.business_date !== args.selectedDate)) {
    throw new Error(`PMS date isolation failed: received a row outside ${args.selectedDate}.`);
  }

  let checkoutCount = 0;
  let dailyCount = 0;
  let otherCount = 0;
  let capturedAt: string | null = null;
  for (const row of rows) {
    const kind = classifyPmsDayRow(row, args.selectedDate);
    if (kind === 'checkout') checkoutCount += 1;
    else if (kind === 'daily') dailyCount += 1;
    else otherCount += 1;
    if (row.captured_at && (!capturedAt || row.captured_at > capturedAt)) capturedAt = row.captured_at;
  }

  // Only Gozsdu allows other rows in the authoritative feed: these are not
  // automatically housekeeping work. Its existing property-specific service
  // cycle and non-operating-room exclusions still decide what gets assigned.
  if (otherCount > 0 && !args.allowOtherRows) {
    throw new Error(
      `Previo returned ${otherCount} unclassified room row(s) for ${args.selectedDate}.`,
    );
  }

  return {
    date: args.selectedDate,
    checkoutCount,
    dailyCount,
    otherCount,
    totalRows: rows.length,
    capturedAt,
  };
}

export function NextDayAutoRoomAssignmentGate(props: Props) {
  const { profile } = useAuth();
  const [stage, setStage] = useState<Stage>('checking');
  const [snapshot, setSnapshot] = useState<TomorrowSnapshotState | null>(null);
  const [summary, setSummary] = useState<PmsDaySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pmsProgress, setPmsProgress] = useState<TomorrowPmsProgressEvent>({
    phase: 'checking-cache',
    attempt: 1,
    maxAttempts: 3,
  });
  const generation = useRef(0);
  const startedAt = useRef<number | null>(null);

  const prepare = async (forceFresh = false) => {
    if (!profile?.assigned_hotel || !profile.organization_slug) return;
    const current = ++generation.current;
    startedAt.current = Date.now();
    setElapsedSeconds(0);
    setPmsProgress({ phase: 'checking-cache', attempt: 1, maxAttempts: 3 });
    setStage(forceFresh ? 'syncing' : 'checking');
    setError(null);
    setSummary(null);
    try {
      const expectedTomorrow = tomorrowBudapest();
      if (props.selectedDate !== expectedTomorrow) {
        throw new Error(
          `Tomorrow planning date mismatch. Budapest tomorrow is ${expectedTomorrow}, but the screen requested ${props.selectedDate}. Nothing was assigned.`,
        );
      }

      // Profiles created before canonical hotel IDs were enforced may still
      // contain display names such as "Hotel Mika Downtown". Integration
      // requests and PMS snapshot queries must always use hotel_id instead.
      const canonicalHotelId = await resolveCanonicalHotelId(profile.assigned_hotel);
      if (!canonicalHotelId) {
        throw new Error('The assigned hotel could not be resolved to a PMS property. Nothing was assigned.');
      }
      const isGozsdu = isGozsduCourtHotel(canonicalHotelId);

      const result = await ensureTomorrowPmsSnapshot({
        organizationSlug: profile.organization_slug,
        hotelId: canonicalHotelId,
        selectedDate: expectedTomorrow,
        forceFresh,
        onProgress: (event) => {
          if (current !== generation.current) return;
          setPmsProgress(event);
          setStage(event.phase === 'checking-cache' ? 'checking' : 'syncing');
        },
      });
      if (current !== generation.current) return;

      setPmsProgress({ phase: 'validating-snapshot', attempt: 1, maxAttempts: 3 });
      setStage('syncing');
      const exactDay = await loadExactPmsDaySummary({
        organizationSlug: profile.organization_slug,
        hotelId: canonicalHotelId,
        selectedDate: expectedTomorrow,
        allowOtherRows: isGozsdu,
      });
      if (current !== generation.current) return;

      const verifiedEmpty = result.authoritative === true
        && result.roomCount > 0
        && result.rowCount === 0
        && exactDay === null;

      // Gozsdu trusts the fresh Previo roster itself, not its static inventory
      // size. A successful zero-row reservation sync is also authoritative:
      // every operating room is currently unbooked and becomes provisional.
      if (isGozsdu && !verifiedEmpty
        && (!exactDay || result.rowCount !== exactDay.totalRows || !result.authoritative)) {
        throw new Error(`The verified Previo snapshot for ${expectedTomorrow} changed. Please refresh before assigning.`);
      }
      if (result.roomCount > 0 && !verifiedEmpty) {
        if (!exactDay) {
          throw new Error(`The Previo snapshot for ${expectedTomorrow} is missing. Nothing was assigned.`);
        }
        if (exactDay.totalRows < result.roomCount
          && !isVerifiedSparseTomorrowSnapshot({
            hotelId: canonicalHotelId,
            roomCount: result.roomCount,
            verifiedRowCount: result.rowCount,
            exactDayRowCount: exactDay.totalRows,
            authoritative: result.authoritative,
          })) {
          throw new Error(
            `The Previo snapshot for ${expectedTomorrow} is incomplete (${exactDay.totalRows}/${result.roomCount} rooms). Nothing was assigned.`,
          );
        }
      }

      const resolvedSummary: PmsDaySummary | null = exactDay || (verifiedEmpty ? {
        date: expectedTomorrow,
        checkoutCount: 0,
        dailyCount: 0,
        otherCount: 0,
        totalRows: 0,
        capturedAt: result.capturedAt,
      } : null);

      setSummary(resolvedSummary);
      setSnapshot(result);
      setStage('ready');

      if (resolvedSummary) {
        toast.success(
          `PMS ${resolvedSummary.date}: ${resolvedSummary.checkoutCount} check-outs · ${resolvedSummary.dailyCount} stay-overs${resolvedSummary.otherCount ? ` · ${resolvedSummary.otherCount} other` : ''} · ${resolvedSummary.totalRows} booked rooms`,
          { id: `next-day-pms-${canonicalHotelId}-${resolvedSummary.date}` },
        );
      }
    } catch (cause) {
      if (current !== generation.current) return;
      console.error('[NextDayAutoRoomAssignmentGate] PMS preparation failed:', cause);
      setSnapshot(null);
      setSummary(null);
      setError(cause instanceof Error ? cause.message : String(cause));
      setStage('error');
    }
  };

  useEffect(() => {
    if (!props.open) {
      generation.current += 1;
      startedAt.current = null;
      setStage('checking');
      setSnapshot(null);
      setSummary(null);
      setError(null);
      setElapsedSeconds(0);
      setPmsProgress({ phase: 'checking-cache', attempt: 1, maxAttempts: 3 });
      return;
    }
    void prepare(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.selectedDate, profile?.assigned_hotel, profile?.organization_slug]);

  useEffect(() => {
    if (!props.open || stage === 'ready' || stage === 'error' || !startedAt.current) return;
    const updateElapsed = () => {
      if (!startedAt.current) return;
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [props.open, stage]);

  if (!props.open) return null;

  if (stage === 'ready' && snapshot) {
    return (
      <AutoRoomAssignmentImpl
        {...props}
        planningMode="next-day"
        pmsSyncedAt={summary?.capturedAt || snapshot.capturedAt}
      />
    );
  }

  const copy = progressCopy(pmsProgress, props.selectedDate);
  const currentStep = PHASE_STEP[pmsProgress.phase];
  const progressValue = Math.min(
    94,
    PHASE_PROGRESS[pmsProgress.phase] + Math.min(7, Math.floor(elapsedSeconds / 3)),
  );
  const isSlow = elapsedSeconds > EXPECTED_SYNC_SECONDS;
  const errorPresentation = friendlyPmsError(error);
  const hotelLabel = profile?.assigned_hotel || 'this property';

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex h-[94vh] max-h-[94vh] w-[98vw] max-w-[1500px] flex-col overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-xl">
            <CalendarClock className="h-5 w-5 text-primary" />
            Auto Room Assignment
            <Badge variant="outline">Tomorrow · {props.selectedDate}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 items-center justify-center">
          {stage === 'error' ? (
            <div className="w-full max-w-2xl rounded-3xl border border-destructive/25 bg-gradient-to-b from-destructive/5 to-background p-6 shadow-sm sm:p-8">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                <AlertCircle className="h-7 w-7 text-destructive" />
              </div>
              <div className="mt-4 text-center">
                <h3 className="text-lg font-semibold">{errorPresentation.title}</h3>
                <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
                  {errorPresentation.detail}
                </p>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border bg-background/80 p-4 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Elapsed</p>
                  <p className="mt-1 font-semibold">{elapsedSeconds}s</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Last attempt</p>
                  <p className="mt-1 font-semibold">{pmsProgress.attempt}/{pmsProgress.maxAttempts}</p>
                </div>
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-left text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Safety lock stayed active: HotelCare did not reuse today’s room classification and did not save a tomorrow plan.</span>
              </div>

              {errorPresentation.technical ? (
                <details className="mt-4 rounded-xl border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium text-foreground">Technical detail</summary>
                  <p className="mt-2 break-words">{errorPresentation.technical}</p>
                </details>
              ) : null}

              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => props.onOpenChange(false)}>Close</Button>
                <Button onClick={() => void prepare(true)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry fresh sync
                </Button>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-2xl space-y-5 rounded-3xl border bg-gradient-to-b from-primary/[0.04] to-card p-6 shadow-sm sm:p-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="rounded-2xl bg-primary/10 p-3">
                    {pmsProgress.phase === 'checking-cache'
                      ? <Database className="h-6 w-6 text-primary" />
                      : <Loader2 className="h-6 w-6 animate-spin text-primary" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg font-semibold">Preparing tomorrow’s housekeeping</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {hotelLabel} · live Previo data for {props.selectedDate}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Badge variant="outline" className={isSlow ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200' : ''}>
                    <Clock3 className="mr-1 h-3.5 w-3.5" />
                    {elapsedSeconds}s elapsed
                  </Badge>
                  <Badge variant="secondary">Target &lt; {EXPECTED_SYNC_SECONDS}s</Badge>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{copy.title}</span>
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{Math.round(progressValue)}%</span>
                </div>
                <Progress value={progressValue} className="h-2.5" />
                <p className="mt-2 text-sm text-muted-foreground">{copy.detail}</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { label: 'Secure connection', Icon: ShieldCheck },
                  { label: 'Read Previo data', Icon: Wifi },
                  { label: 'Verify tomorrow', Icon: CheckCircle2 },
                ].map(({ label, Icon }, index) => {
                  const complete = index < currentStep;
                  const active = index === currentStep;
                  return (
                    <div
                      key={label}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                        active ? 'border-primary/35 bg-primary/5' : complete ? 'bg-muted/30' : 'opacity-60'
                      }`}
                    >
                      {complete
                        ? <Check className="h-4 w-4 text-primary" />
                        : active
                          ? <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          : <Icon className="h-4 w-4 text-muted-foreground" />}
                      <span className={active || complete ? 'font-medium' : ''}>{label}</span>
                    </div>
                  );
                })}
              </div>

              {isSlow ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    This is taking longer than the {EXPECTED_SYNC_SECONDS}-second target. HotelCare is still working and will retry temporary connection failures automatically. Nothing is being assigned while verification is running.
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-xl border bg-background/70 p-3 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>Today’s checkout/daily classification is never reused for tomorrow. The assignment screen opens only after the exact tomorrow snapshot passes verification.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

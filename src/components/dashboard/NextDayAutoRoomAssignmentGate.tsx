import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CalendarClock, Check, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { tomorrowBudapest } from '@/lib/budapestTime';
import { resolveCanonicalHotelId } from '@/lib/hotelKeys';
import { ensureTomorrowPmsSnapshot, type TomorrowSnapshotState } from '@/lib/nextDayAutoAssignBridge';
import { AutoRoomAssignment as AutoRoomAssignmentImpl } from './AutoRoomAssignmentImpl';

type Props = React.ComponentProps<typeof AutoRoomAssignmentImpl>;

type Stage = 'checking' | 'syncing' | 'ready' | 'error';

type PmsDaySummary = {
  date: string;
  checkoutCount: number;
  dailyCount: number;
  totalRows: number;
  capturedAt: string | null;
};

function classifyPmsDayRow(row: any, selectedDate: string): 'checkout' | 'daily' | null {
  const checkout = row.departure_date === selectedDate
    || row.status === 'departing'
    || String(row.housekeeping_dep || '').toUpperCase() === 'DEP';
  if (checkout) return 'checkout';

  const daily = row.status === 'ongoing'
    || (!!row.arrival_date && !!row.departure_date
      && row.arrival_date < selectedDate && row.departure_date > selectedDate);
  return daily ? 'daily' : null;
}

async function loadExactPmsDaySummary(args: {
  organizationSlug: string;
  hotelId: string;
  selectedDate: string;
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
  let capturedAt: string | null = null;
  for (const row of rows) {
    const kind = classifyPmsDayRow(row, args.selectedDate);
    if (kind === 'checkout') checkoutCount += 1;
    else if (kind === 'daily') dailyCount += 1;
    if (row.captured_at && (!capturedAt || row.captured_at > capturedAt)) capturedAt = row.captured_at;
  }

  if (checkoutCount + dailyCount !== rows.length) {
    throw new Error(
      `Previo returned ${rows.length - checkoutCount - dailyCount} unclassified room row(s) for ${args.selectedDate}.`,
    );
  }

  return {
    date: args.selectedDate,
    checkoutCount,
    dailyCount,
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
  const generation = useRef(0);

  const prepare = async (forceFresh = false) => {
    if (!profile?.assigned_hotel || !profile.organization_slug) return;
    const current = ++generation.current;
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

      const result = await ensureTomorrowPmsSnapshot({
        organizationSlug: profile.organization_slug,
        hotelId: canonicalHotelId,
        selectedDate: expectedTomorrow,
        forceFresh,
      });
      if (current !== generation.current) return;

      const exactDay = await loadExactPmsDaySummary({
        organizationSlug: profile.organization_slug,
        hotelId: canonicalHotelId,
        selectedDate: expectedTomorrow,
      });
      if (current !== generation.current) return;

      // Standard Previo properties must have a complete selected-date dataset.
      // Fail closed instead of ever falling back to today's checkout/daily flags.
      if (result.roomCount > 0) {
        if (!exactDay) {
          throw new Error(`The Previo snapshot for ${expectedTomorrow} is missing. Nothing was assigned.`);
        }
        if (exactDay.totalRows < result.roomCount) {
          throw new Error(
            `The Previo snapshot for ${expectedTomorrow} is incomplete (${exactDay.totalRows}/${result.roomCount} rooms). Nothing was assigned.`,
          );
        }
      }

      setSummary(exactDay);
      setSnapshot(result);
      setStage('ready');

      if (exactDay) {
        toast.success(
          `PMS ${exactDay.date}: ${exactDay.checkoutCount} check-outs · ${exactDay.dailyCount} daily · ${exactDay.totalRows} rooms`,
          { id: `next-day-pms-${canonicalHotelId}-${exactDay.date}` },
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
      setStage('checking');
      setSnapshot(null);
      setSummary(null);
      setError(null);
      return;
    }
    void prepare(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.selectedDate, profile?.assigned_hotel, profile?.organization_slug]);

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
            <div className="w-full max-w-xl rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
              <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
              <h3 className="font-semibold">Could not verify tomorrow’s PMS data</h3>
              <p className="mt-2 text-sm text-muted-foreground">{error}</p>
              <p className="mt-2 text-xs text-muted-foreground">For safety, HotelCare will not show or save a tomorrow plan until the exact tomorrow dataset is verified.</p>
              <div className="mt-5 flex justify-center gap-2">
                <Button variant="outline" onClick={() => props.onOpenChange(false)}>Close</Button>
                <Button onClick={() => void prepare(true)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry fresh sync
                </Button>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-xl space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-primary/10 p-3">
                  {stage === 'checking'
                    ? <Check className="h-6 w-6 text-primary" />
                    : <Loader2 className="h-6 w-6 animate-spin text-primary" />}
                </div>
                <div>
                  <p className="font-semibold">
                    {stage === 'checking'
                      ? `Verifying Previo for ${props.selectedDate} only…`
                      : `Refreshing Previo for ${props.selectedDate} only…`}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Today’s checkout/daily classification is never reused for tomorrow. A complete exact-date snapshot is required.
                  </p>
                </div>
              </div>
              <Progress value={stage === 'checking' ? 32 : 72} className="h-2" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

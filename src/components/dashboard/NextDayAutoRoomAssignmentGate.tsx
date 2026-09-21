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
import { resolveCanonicalHotelId, resolveHotelKeys } from '@/lib/hotelKeys';
import { GOZSDU_COURT_HOTEL_ID, isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { isVerifiedSparseTomorrowSnapshot } from '@/lib/nextDayPmsGateCoverage';
import {
  ensureTomorrowPmsSnapshot, buildTomorrowAutoAssignRooms,
  loadExistingNextDayPlan, loadGozsduTomorrowOptionalCandidates,
  type TomorrowSnapshotState,
} from '@/lib/nextDayAutoAssignBridge';
import {
  clearGozsduOptionalSelection, gozsduOptionKey, setGozsduOptionalSelection,
  type GozsduOptionalRoom,
} from '@/lib/gozsduTomorrowOptionalRooms';
import { AutoRoomAssignment as AutoRoomAssignmentImpl } from './AutoRoomAssignmentImpl';

type Props = React.ComponentProps<typeof AutoRoomAssignmentImpl>;
type Stage = 'checking' | 'syncing' | 'options' | 'ready' | 'error';
type PmsDaySummary = {
  date: string;
  checkoutCount: number;
  dailyCount: number;
  otherCount: number;
  totalRows: number;
  capturedAt: string | null;
};
type GozsduBreakdown = {
  checkouts: number;
  towels: number;
  textiles: number;
  normalStayovers: number;
  unavailableOrNonGuest: number;
};

function classifyPmsDayRow(row: any, selectedDate: string): 'checkout' | 'daily' | 'other' {
  if (row.departure_date === selectedDate || row.status === 'departing'
    || String(row.housekeeping_dep || '').toUpperCase() === 'DEP') return 'checkout';
  const daily = row.status === 'ongoing'
    || (!!row.arrival_date && !!row.departure_date
      && row.arrival_date < selectedDate && row.departure_date > selectedDate);
  return daily ? 'daily' : 'other';
}

async function loadExactPmsDaySummary(args: {
  organizationSlug: string; hotelId: string; selectedDate: string; allowOtherRows: boolean;
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
  if (!rows.length) return null;
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
  if (otherCount && !args.allowOtherRows) {
    throw new Error(`Previo returned ${otherCount} unclassified room row(s) for ${args.selectedDate}.`);
  }
  return { date: args.selectedDate, checkoutCount, dailyCount, otherCount, totalRows: rows.length, capturedAt };
}

export function NextDayAutoRoomAssignmentGate(props: Props) {
  const { profile } = useAuth();
  const [stage, setStage] = useState<Stage>('checking');
  const [snapshot, setSnapshot] = useState<TomorrowSnapshotState | null>(null);
  const [summary, setSummary] = useState<PmsDaySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [optional, setOptional] = useState<GozsduOptionalRoom[]>([]);
  const [optionalIds, setOptionalIds] = useState<Set<string>>(new Set());
  const [breakdown, setBreakdown] = useState<GozsduBreakdown | null>(null);
  const generation = useRef(0);
  const key = gozsduOptionKey(profile?.organization_slug || '', GOZSDU_COURT_HOTEL_ID, props.selectedDate);

  const prepare = async (forceFresh = false) => {
    if (!profile?.assigned_hotel || !profile.organization_slug) return;
    const current = ++generation.current;
    setStage(forceFresh ? 'syncing' : 'checking');
    setError(null);
    setSummary(null);
    setOptional([]);
    setOptionalIds(new Set());
    setBreakdown(null);
    clearGozsduOptionalSelection(key);
    try {
      const expectedTomorrow = tomorrowBudapest();
      if (props.selectedDate !== expectedTomorrow) {
        throw new Error(`Tomorrow planning date mismatch. Budapest tomorrow is ${expectedTomorrow}, but the screen requested ${props.selectedDate}. Nothing was assigned.`);
      }
      const canonicalHotelId = await resolveCanonicalHotelId(profile.assigned_hotel);
      if (!canonicalHotelId) throw new Error('The assigned hotel could not be resolved to a PMS property. Nothing was assigned.');
      const isGozsdu = isGozsduCourtHotel(canonicalHotelId);
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
        allowOtherRows: isGozsdu,
      });
      if (current !== generation.current) return;
      if (isGozsdu && (!exactDay || result.rowCount !== exactDay.totalRows || !result.authoritative
        || exactDay.capturedAt !== result.capturedAt)) {
        throw new Error(`The verified Previo snapshot for ${expectedTomorrow} changed. Refresh before assigning.`);
      }
      if (result.roomCount > 0) {
        if (!exactDay) throw new Error(`The Previo snapshot for ${expectedTomorrow} is missing. Nothing was assigned.`);
        if (exactDay.totalRows < result.roomCount
          && !isVerifiedSparseTomorrowSnapshot({
            hotelId: canonicalHotelId, roomCount: result.roomCount,
            verifiedRowCount: result.rowCount, exactDayRowCount: exactDay.totalRows,
            authoritative: result.authoritative,
          })) {
          throw new Error(`The Previo snapshot for ${expectedTomorrow} is incomplete (${exactDay.totalRows}/${result.roomCount} rooms). Nothing was assigned.`);
        }
      }
      if (isGozsdu && exactDay) {
        const keys = await resolveHotelKeys(profile.assigned_hotel);
        const { data: roomRows, error: roomError } = await supabase.from('rooms')
          .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
          .in('hotel', keys)
          .eq('organization_slug', profile.organization_slug);
        if (roomError || !roomRows || !roomRows.length) throw new Error('Gozsdu room registry could not be verified.');
        const candidates = await loadGozsduTomorrowOptionalCandidates({
          organizationSlug: profile.organization_slug,
          selectedDate: expectedTomorrow,
          roomRows,
          expectedCapture: result.capturedAt,
        });
        if (current !== generation.current) return;
        const saved = await loadExistingNextDayPlan({
          organizationSlug: profile.organization_slug,
          hotelId: canonicalHotelId,
          selectedDate: expectedTomorrow,
        });
        if (current !== generation.current) return;
        const candidateIds = new Set(candidates.map(room => room.id));
        const initiallySelected = new Set(saved.items.map(item => item.room_id).filter(id => candidateIds.has(id)));
        setGozsduOptionalSelection(key, [...initiallySelected]);
        const work = await buildTomorrowAutoAssignRooms({
          organizationSlug: profile.organization_slug,
          hotelId: canonicalHotelId,
          selectedDate: expectedTomorrow,
          roomRows,
        });
        if (current !== generation.current) return;
        if (work.source !== 'selected-date' || work.capturedAt !== result.capturedAt) {
          throw new Error('Gozsdu workload and PMS snapshot changed. Refresh planning.');
        }
        const mandatory = work.rooms.filter(room => !room.pms_metadata?.gozsduOptionalCleaning);
        const checkouts = mandatory.filter(room => room.is_checkout_room);
        if (checkouts.length !== exactDay.checkoutCount) {
          throw new Error(`Gozsdu has ${exactDay.checkoutCount} PMS departures but only ${checkouts.length} assignable checkouts. Check no-shows/holds; do not publish mismatched numbers.`);
        }
        const towels = mandatory.filter(room => !room.is_checkout_room && room.towel_change_required).length;
        const textiles = mandatory.filter(room => !room.is_checkout_room && room.linen_change_required).length;
        const operating = roomRows.filter(room => (room.pms_metadata as any)?.gozsduAvailability?.status === 'operating').length;
        const normalStayovers = Math.max(0, exactDay.dailyCount - towels - textiles - (roomRows.length - operating));
        setBreakdown({ checkouts: checkouts.length, towels, textiles, normalStayovers,
          unavailableOrNonGuest: roomRows.length - operating });
        setOptional(candidates);
        setOptionalIds(initiallySelected);
        setSummary(exactDay);
        setSnapshot(result);
        setStage('options');
        return;
      }
      setSummary(exactDay);
      setSnapshot(result);
      setStage('ready');
      if (exactDay) toast.success(`PMS ${exactDay.date}: ${exactDay.checkoutCount} check-outs · ${exactDay.dailyCount} stay-overs · ${exactDay.totalRows} rooms`,
        { id: `next-day-pms-${canonicalHotelId}-${exactDay.date}` });
    } catch (cause) {
      if (current !== generation.current) return;
      console.error('[NextDayAutoRoomAssignmentGate] PMS preparation failed:', cause);
      clearGozsduOptionalSelection(key);
      setSnapshot(null);
      setSummary(null);
      setError(cause instanceof Error ? cause.message : String(cause));
      setStage('error');
    }
  };

  useEffect(() => {
    if (!props.open) {
      generation.current += 1;
      clearGozsduOptionalSelection(key);
      setStage('checking');
      setSnapshot(null);
      setSummary(null);
      setError(null);
      setOptional([]);
      setBreakdown(null);
      return;
    }
    void prepare(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.selectedDate, profile?.assigned_hotel, profile?.organization_slug]);

  if (!props.open) return null;
  if (stage === 'ready' && snapshot) return (
    <AutoRoomAssignmentImpl {...props} planningMode="next-day" pmsSyncedAt={summary?.capturedAt || snapshot.capturedAt} />
  );

  const noShows = optional.filter(room => room.kind === 'no_show').length;
  const arrivals = optional.filter(room => room.kind === 'arrival_only').length;
  const vacant = optional.filter(room => room.kind === 'vacant').length;
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
        {stage === 'options' && summary && breakdown ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-semibold">Verified Previo departures and Gozsdu housekeeping work</p>
              <p className="mt-1 text-xs text-muted-foreground">Business date {summary.date} · Previo captured {summary.capturedAt ? new Date(summary.capturedAt).toLocaleString('en-GB', { timeZone: 'Europe/Budapest' }) : 'unknown'} (Budapest). Counts below are separate; vacant rooms are never invented checkouts.</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded border bg-background p-2"><strong className="text-xl">{summary.checkoutCount}</strong><p>Previo checkouts</p></div>
                <div className="rounded border bg-background p-2"><strong className="text-xl">{summary.dailyCount}</strong><p>All stayovers</p></div>
                <div className="rounded border bg-background p-2"><strong className="text-xl">{breakdown.towels + breakdown.textiles}</strong><p>Stayover services due</p></div>
                <div className="rounded border bg-background p-2"><strong className="text-xl">{breakdown.checkouts + breakdown.towels + breakdown.textiles + optionalIds.size}</strong><p>Selected cleaning work</p></div>
              </div>
              <p className="mt-2 text-xs">Due: {breakdown.towels} towel · {breakdown.textiles} complete textile · {breakdown.normalStayovers} operating stayovers not due. {breakdown.unavailableOrNonGuest} non-operating/non-guest units are excluded from automatic work.</p>
              <p className="mt-1 text-xs font-semibold">Optional: {noShows} date-confirmed no-shows · {vacant} vacant candidates · {arrivals} arrival-only rooms. A missing reservation is not proof of a no-show.</p>
            </div>
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-semibold">Manager choice: optional room cleaning ({optionalIds.size}/{optional.length} selected)</p>
              <p className="mt-1 text-xs text-muted-foreground">None selected by default unless previously included in this hotel's saved plan. Do not include an arrival-only room unless inspection or pre-arrival cleaning is required. Unavailable rooms cannot be selected.</p>
              <div className="mt-3 grid max-h-[38vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                {optional.length === 0 && <p>No additional available candidates in the verified roster.</p>}
                {optional.map(candidate => (
                  <label key={candidate.id} className="flex cursor-pointer items-start gap-2 rounded-lg border p-3">
                    <input type="checkbox" className="mt-0.5 h-4 w-4" checked={optionalIds.has(candidate.id)}
                      onChange={event => setOptionalIds(previous => {
                        const next = new Set(previous);
                        if (event.target.checked) next.add(candidate.id);
                        else next.delete(candidate.id);
                        return next;
                      })} />
                    <span><span className="font-semibold">{candidate.label}</span>{' · '}
                      <Badge variant="outline">{candidate.kind === 'no_show' ? 'Confirmed no-show' : candidate.kind === 'arrival_only' ? 'Arrival only' : 'Vacant candidate'}</Badge>
                      <span className="mt-1 block text-xs text-muted-foreground">{candidate.evidence}</span></span>
                  </label>
                ))}
              </div>
            </div>
            <p className="text-xs text-amber-700">If your Previo interface shows a different checkout count, compare its selected date and export before approving. This wizard will not fabricate missing departures; a fresh PMS check runs again on approval.</p>
            <div className="mt-auto flex flex-wrap justify-end gap-2 border-t pt-3">
              <Button variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button>
              <Button variant="outline" onClick={() => void prepare(true)}><RefreshCw className="mr-1 h-4 w-4" />Refresh Previo</Button>
              <Button onClick={() => {
                setGozsduOptionalSelection(key, [...optionalIds]);
                setStage('ready');
              }}>Continue to staff selection · {breakdown.checkouts + breakdown.towels + breakdown.textiles + optionalIds.size} rooms</Button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {stage === 'error' ? (
              <div className="w-full max-w-xl rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
                <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
                <h3 className="font-semibold">Could not verify tomorrow’s PMS data</h3>
                <p className="mt-2 text-sm text-muted-foreground">{error}</p>
                <p className="mt-2 text-xs text-muted-foreground">For safety, nothing can be assigned until the exact date is verified.</p>
                <div className="mt-5 flex justify-center gap-2">
                  <Button variant="outline" onClick={() => props.onOpenChange(false)}>Close</Button>
                  <Button onClick={() => void prepare(true)}><RefreshCw className="mr-2 h-4 w-4" />Retry fresh sync</Button>
                </div>
              </div>
            ) : (
              <div className="w-full max-w-xl space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-primary/10 p-3">
                    {stage === 'checking' ? <Check className="h-6 w-6 text-primary" /> : <Loader2 className="h-6 w-6 animate-spin text-primary" />}
                  </div>
                  <div>
                    <p className="font-semibold">{stage === 'checking' ? `Verifying Previo for ${props.selectedDate} only…` : `Refreshing Previo for ${props.selectedDate} only…`}</p>
                    <p className="mt-1 text-sm text-muted-foreground">Today’s checkout/daily classification is never reused for tomorrow.</p>
                  </div>
                </div>
                <Progress value={stage === 'checking' ? 32 : 72} className="h-2" />
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

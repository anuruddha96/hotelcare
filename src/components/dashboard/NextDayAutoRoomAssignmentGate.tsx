import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CalendarClock, Check, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ensureTomorrowPmsSnapshot, type TomorrowSnapshotState } from '@/lib/nextDayAutoAssignBridge';
import { AutoRoomAssignment as AutoRoomAssignmentImpl } from './AutoRoomAssignmentImpl';

type Props = React.ComponentProps<typeof AutoRoomAssignmentImpl>;

type Stage = 'checking' | 'syncing' | 'ready' | 'error';

export function NextDayAutoRoomAssignmentGate(props: Props) {
  const { profile } = useAuth();
  const [stage, setStage] = useState<Stage>('checking');
  const [snapshot, setSnapshot] = useState<TomorrowSnapshotState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const prepare = async (forceFresh = false) => {
    if (!profile?.assigned_hotel || !profile.organization_slug) return;
    const current = ++generation.current;
    setStage(forceFresh ? 'syncing' : 'checking');
    setError(null);
    try {
      const result = await ensureTomorrowPmsSnapshot({
        organizationSlug: profile.organization_slug,
        hotelId: profile.assigned_hotel,
        selectedDate: props.selectedDate,
        forceFresh,
      });
      if (current !== generation.current) return;
      setSnapshot(result);
      setStage('ready');
    } catch (cause) {
      if (current !== generation.current) return;
      console.error('[NextDayAutoRoomAssignmentGate] PMS preparation failed:', cause);
      setError(cause instanceof Error ? cause.message : String(cause));
      setStage('error');
    }
  };

  useEffect(() => {
    if (!props.open) {
      generation.current += 1;
      setStage('checking');
      setSnapshot(null);
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
        pmsSyncedAt={snapshot.capturedAt}
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
              <h3 className="font-semibold">Could not prepare tomorrow’s PMS data</h3>
              <p className="mt-2 text-sm text-muted-foreground">{error}</p>
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
                      ? 'Checking for a recent complete Previo snapshot…'
                      : 'Refreshing tomorrow’s Previo room information…'}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    A complete snapshot from the last 15 minutes is reused automatically.
                  </p>
                </div>
              </div>
              <Progress value={stage === 'checking' ? 28 : 68} className="h-2" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { CameraOff, CheckCircle2, Clock, Loader2, Pause, Shirt } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { DirtyLinenDialog } from './DirtyLinenDialog';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { appendTowelChangeOnlyOutcome, isHotelMikaDowntown } from '@/lib/mika-towel-service';
import { toast } from 'sonner';

interface BreakPeriod {
  start: string;
  end?: string;
}

interface PausableTimerComponentProps {
  assignmentId: string;
  startedAt: string;
  userId: string;
}

type TowelServiceContext = {
  roomId: string;
  roomNumber: string;
  hotel: string;
  assignmentType: string;
  assignmentStatus: string;
  assignmentNotes: string | null;
  towelChangeRequired: boolean;
  isCheckout: boolean;
};

export function PausableTimerComponent({ assignmentId, startedAt, userId }: PausableTimerComponentProps) {
  const { language } = useTranslation();
  const [elapsed, setElapsed] = useState(0);
  const [breakPeriods, setBreakPeriods] = useState<BreakPeriod[]>([]);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [totalBreakTime, setTotalBreakTime] = useState(0);

  // Mika towel-only service state. The timer is rendered for the active room on
  // both desktop and mobile, so this adds the shortcut without changing the
  // shared room-card completion/photo logic.
  const [towelContext, setTowelContext] = useState<TowelServiceContext | null>(null);
  const [towelDialogOpen, setTowelDialogOpen] = useState(false);
  const [linenDialogOpen, setLinenDialogOpen] = useState(false);
  const [checkingLinen, setCheckingLinen] = useState(false);
  const [hasLinenRecord, setHasLinenRecord] = useState(false);
  const [completingTowelService, setCompletingTowelService] = useState(false);
  const [returnToTowelDialog, setReturnToTowelDialog] = useState(false);

  const copy = language === 'hu'
    ? {
        button: 'Csak törölköző',
        title: 'Csak törölközőcsere',
        description: 'Használd, ha a vendég csak tiszta törölközőt kért, teljes szobatakarítást nem.',
        noPhotos: 'Fotó nem szükséges',
        safety: 'Ez csak a törölközőszervizt zárja le. A szoba nem lesz tisztának jelölve, és nem küldünk „clean” státuszt a PMS-be.',
        linen: '1. Szennyes textília rögzítése',
        linenDone: 'Rögzítve',
        linenNeeded: 'Először rögzítsd a begyűjtött szennyes törölközőket.',
        complete: '2. Törölközőcsere lezárása',
        completed: 'Törölközőcsere lezárva',
        completedDesc: 'Csak a törölközőszerviz lett lezárva. Teljes szobatakarítás nem lett rögzítve.',
        cancel: 'Mégse',
        error: 'A törölközőcsere nem zárható le. Próbáld újra.',
      }
    : {
        button: 'Towel only',
        title: 'Towel change only',
        description: 'Use this when the guest requested fresh towels only and no full room cleaning was done.',
        noPhotos: 'No photos required',
        safety: 'This closes only the towel service. The room is not marked clean and no “clean” status is sent to the PMS.',
        linen: '1. Update dirty linen',
        linenDone: 'Recorded',
        linenNeeded: 'Please record the collected dirty towels first.',
        complete: '2. Complete towel change only',
        completed: 'Towel change only completed',
        completedDesc: 'Only the towel service was closed. No full room cleaning was recorded.',
        cancel: 'Cancel',
        error: 'Could not complete the towel change. Please try again.',
      };

  const loadTowelContext = useCallback(async () => {
    if (!assignmentId) {
      setTowelContext(null);
      return;
    }

    try {
      const { data: assignment, error: assignmentError } = await supabase
        .from('room_assignments')
        .select('room_id, assignment_type, status, notes')
        .eq('id', assignmentId)
        .maybeSingle();
      if (assignmentError || !assignment?.room_id) {
        setTowelContext(null);
        return;
      }

      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('id, room_number, hotel, is_checkout_room, pms_metadata, towel_change_required')
        .eq('id', assignment.room_id)
        .maybeSingle();
      if (roomError || !room) {
        setTowelContext(null);
        return;
      }

      const pmsMeta = room.pms_metadata as any;
      const hasFreshPms = pmsMeta?.pmsSyncDate === todayBudapest();
      const pmsSaysCheckout = room.is_checkout_room === true || pmsMeta?.scheduledDepartureToday === true;
      const isCheckout = hasFreshPms
        ? pmsSaysCheckout
        : assignment.assignment_type === 'checkout_cleaning' || pmsSaysCheckout;

      setTowelContext({
        roomId: assignment.room_id,
        roomNumber: room.room_number || '—',
        hotel: room.hotel || '',
        assignmentType: assignment.assignment_type || '',
        assignmentStatus: assignment.status || '',
        assignmentNotes: assignment.notes || null,
        towelChangeRequired: !!room.towel_change_required,
        isCheckout,
      });
    } catch (error) {
      console.warn('Could not load towel-only service context:', error);
      setTowelContext(null);
    }
  }, [assignmentId]);

  useEffect(() => {
    void loadTowelContext();
  }, [loadTowelContext]);

  const towelOnlyAvailable = !!towelContext
    && isHotelMikaDowntown(towelContext.hotel)
    && towelContext.assignmentType === 'daily_cleaning'
    && towelContext.assignmentStatus === 'in_progress'
    && !towelContext.isCheckout;

  const refreshLinenStatus = useCallback(async (): Promise<boolean> => {
    if (!assignmentId) return false;
    setCheckingLinen(true);
    try {
      const { data, error } = await supabase
        .from('dirty_linen_counts')
        .select('id, count')
        .eq('assignment_id', assignmentId)
        .gt('count', 0)
        .limit(1);
      if (error) throw error;
      const recorded = !!data?.length;
      setHasLinenRecord(recorded);
      return recorded;
    } catch (error) {
      console.error('Failed to check Mika towel-service linen record:', error);
      setHasLinenRecord(false);
      return false;
    } finally {
      setCheckingLinen(false);
    }
  }, [assignmentId]);

  const openTowelDialog = () => {
    setTowelDialogOpen(true);
    void refreshLinenStatus();
  };

  const openDirtyLinenFromTowelFlow = () => {
    setReturnToTowelDialog(true);
    setTowelDialogOpen(false);
    setLinenDialogOpen(true);
  };

  const handleLinenOpenChange = (open: boolean) => {
    setLinenDialogOpen(open);
    if (!open && returnToTowelDialog) {
      setReturnToTowelDialog(false);
      void refreshLinenStatus().then(() => setTowelDialogOpen(true));
    }
  };

  const completeTowelOnly = async () => {
    if (!towelOnlyAvailable || !towelContext || completingTowelService) return;

    const linenReady = await refreshLinenStatus();
    if (!linenReady) {
      toast.error(copy.linenNeeded);
      openDirtyLinenFromTowelFlow();
      return;
    }

    setCompletingTowelService(true);
    const now = new Date().toISOString();
    const nextNotes = appendTowelChangeOnlyOutcome(towelContext.assignmentNotes, now);
    const towelWasRequired = towelContext.towelChangeRequired;

    try {
      // Fulfil only the towel request. Never write rooms.status here: this was
      // not a full clean and must not change the room's cleanliness state.
      const { error: roomError } = await supabase
        .from('rooms')
        .update({ towel_change_required: false } as any)
        .eq('id', towelContext.roomId);
      if (roomError) throw roomError;

      // This is a service-only auto-close, not a supervisor cleanliness
      // approval. Marking supervisor_approved=true keeps it out of the normal
      // cleaning approval queue, whose approval action would otherwise push a
      // clean status to Previo. No supervisor identity is attributed.
      const { error: assignmentError } = await (supabase as any)
        .from('room_assignments')
        .update({
          status: 'completed',
          completed_at: now,
          notes: nextNotes,
          supervisor_approved: true,
          supervisor_approved_by: null,
          supervisor_approved_at: null,
        })
        .eq('id', assignmentId)
        .eq('status', 'in_progress');

      if (assignmentError) {
        // If assignment closing failed, restore a request that was visible
        // before the attempt so it cannot disappear silently.
        if (towelWasRequired) {
          await supabase
            .from('rooms')
            .update({ towel_change_required: true } as any)
            .eq('id', towelContext.roomId);
        }
        throw assignmentError;
      }

      const { error: noteError } = await supabase
        .from('housekeeping_notes')
        .insert({
          room_id: towelContext.roomId,
          assignment_id: assignmentId,
          note_type: 'general',
          content: 'Towel change only completed — dirty linen recorded. Full room cleaning/photos were not performed. Service-only auto-close; room clean/PMS status unchanged.',
          created_by: userId,
        } as any);
      if (noteError) console.warn('Towel service completed but audit note insert failed:', noteError);

      setTowelDialogOpen(false);
      setTowelContext((current) => current ? { ...current, assignmentStatus: 'completed', towelChangeRequired: false, assignmentNotes: nextNotes } : current);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
      toast.success(copy.completed, { description: copy.completedDesc });
    } catch (error) {
      console.error('Failed to complete Mika towel-only service:', error);
      toast.error(copy.error);
    } finally {
      setCompletingTowelService(false);
    }
  };

  // Check current attendance status
  useEffect(() => {
    const checkAttendanceStatus = async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('staff_attendance')
        .select('status, break_started_at')
        .eq('user_id', userId)
        .eq('work_date', today)
        .maybeSingle();

      if (data?.status === 'on_break' && data.break_started_at) {
        setIsOnBreak(true);
        // Check if we need to add this break period to our tracking
        const currentBreakStart = data.break_started_at;
        const existingBreak = breakPeriods.find(bp => 
          bp.start === currentBreakStart && !bp.end
        );
        
        if (!existingBreak) {
          setBreakPeriods(prev => [...prev, { start: currentBreakStart }]);
        }
      } else {
        setIsOnBreak(false);
      }
    };

    checkAttendanceStatus();
    
    // Set up real-time listener for attendance changes
    const channel = supabase
      .channel(`attendance-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff_attendance',
          filter: `user_id=eq.${userId}`
        },
        async (payload) => {
          const newData = payload.new as any;
          if (newData?.status === 'on_break' && newData.break_started_at) {
            setIsOnBreak(true);
            // Add new break period if not already tracked
            const existingBreak = breakPeriods.find(bp => 
              bp.start === newData.break_started_at && !bp.end
            );
            if (!existingBreak) {
              setBreakPeriods(prev => [...prev, { start: newData.break_started_at }]);
            }
          } else if (newData?.status === 'checked_in' && newData.break_ended_at) {
            setIsOnBreak(false);
            // Close the current break period
            setBreakPeriods(prev => 
              prev.map(bp => 
                !bp.end && bp.start ? { ...bp, end: newData.break_ended_at } : bp
              )
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, breakPeriods]);

  // Calculate total break time
  useEffect(() => {
    const calculateBreakTime = () => {
      let total = 0;
      const now = new Date();
      
      breakPeriods.forEach(period => {
        const start = new Date(period.start);
        const end = period.end ? new Date(period.end) : now;
        total += Math.floor((end.getTime() - start.getTime()) / 1000);
      });
      
      setTotalBreakTime(total);
    };

    calculateBreakTime();
    const interval = setInterval(calculateBreakTime, 1000);
    return () => clearInterval(interval);
  }, [breakPeriods]);

  // Update timer
  useEffect(() => {
    const updateElapsed = () => {
      const startTime = new Date(startedAt).getTime();
      const now = Date.now();
      let totalElapsed = Math.floor((now - startTime) / 1000);

      // Safety guard against bad client clocks / stale data: if the stored
      // start time is in the future or absurdly old (> 12h), don't display
      // a wildly wrong timer — clamp to 0 so the UI doesn't lie.
      if (!Number.isFinite(totalElapsed) || totalElapsed < 0 || totalElapsed > 12 * 60 * 60) {
        totalElapsed = 0;
      }

      // Subtract break time from total elapsed time
      setElapsed(Math.max(0, totalElapsed - totalBreakTime));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [startedAt, totalBreakTime]);

  // Update room assignment with break periods when component unmounts or break changes
  useEffect(() => {
    const updateBreakPeriods = async () => {
      await supabase
        .from('room_assignments')
        .update({
          break_periods: JSON.stringify(breakPeriods),
          total_break_time_minutes: Math.floor(totalBreakTime / 60)
        })
        .eq('id', assignmentId);
    };

    if (breakPeriods.length > 0) {
      updateBreakPeriods();
    }
  }, [breakPeriods, totalBreakTime, assignmentId]);

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${remainingSeconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${remainingSeconds}s`;
    }
  };

  const getTimerColor = () => {
    if (isOnBreak) return 'text-yellow-600'; // Yellow when on break
    if (elapsed < 1800) return 'text-green-600'; // Under 30 minutes
    if (elapsed < 3600) return 'text-yellow-600'; // Under 1 hour
    return 'text-red-600'; // Over 1 hour
  };

  return (
    <>
      <div className="flex flex-col gap-1 min-w-0">
        <Badge variant="outline" className={`${getTimerColor()} border-current text-xs px-2 py-1 flex items-center gap-1 w-fit`}>
          {isOnBreak ? <Pause className="h-3 w-3 flex-shrink-0" /> : <Clock className="h-3 w-3 flex-shrink-0" />}
          <span className="truncate font-semibold">{formatTime(elapsed)}</span>
          {isOnBreak && <span className="text-xs font-bold">(ON BREAK)</span>}
        </Badge>
        {totalBreakTime > 0 && (
          <Badge variant="secondary" className="text-xs px-2 py-1 w-fit bg-yellow-100 text-yellow-800 border-yellow-300">
            🕐 Break Time: {formatTime(totalBreakTime)}
          </Badge>
        )}

        {towelOnlyAvailable && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openTowelDialog}
            className="mt-1 h-auto min-h-8 w-fit max-w-full border-sky-400 bg-sky-50 px-2 py-1 text-[11px] font-bold leading-tight text-sky-800 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-200"
            data-training="mika-towel-change-only-button"
          >
            <Shirt className="mr-1 h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-normal">{copy.button}</span>
          </Button>
        )}
      </div>

      {towelOnlyAvailable && towelContext && (
        <>
          <Dialog open={towelDialogOpen} onOpenChange={(open) => !completingTowelService && setTowelDialogOpen(open)}>
            <DialogContent className="w-[94vw] max-w-md rounded-2xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-lg">
                  <span>🧺</span> {copy.title} — {towelContext.roomNumber}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-800 dark:bg-sky-950/20">
                  <div className="flex items-center gap-2 text-sm font-semibold text-sky-900 dark:text-sky-100">
                    <CameraOff className="h-4 w-4" /> {copy.noPhotos}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-sky-800 dark:text-sky-200">{copy.description}</p>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100">
                  {copy.safety}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="min-h-12 w-full justify-between whitespace-normal border-amber-300 px-3"
                  onClick={openDirtyLinenFromTowelFlow}
                  disabled={completingTowelService}
                >
                  <span className="flex items-center gap-2 text-left"><Shirt className="h-4 w-4 shrink-0" /> {copy.linen}</span>
                  {checkingLinen
                    ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    : hasLinenRecord
                      ? <Badge className="ml-2 shrink-0 bg-emerald-600">✓ {copy.linenDone}</Badge>
                      : null}
                </Button>

                <Button
                  type="button"
                  className="min-h-12 w-full whitespace-normal bg-sky-700 font-bold hover:bg-sky-800"
                  onClick={() => void completeTowelOnly()}
                  disabled={completingTowelService || checkingLinen}
                  data-training="mika-complete-towel-change-only"
                >
                  {completingTowelService ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  {copy.complete}
                </Button>

                <Button type="button" variant="ghost" className="w-full" onClick={() => setTowelDialogOpen(false)} disabled={completingTowelService}>
                  {copy.cancel}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <DirtyLinenDialog
            open={linenDialogOpen}
            onOpenChange={handleLinenOpenChange}
            roomId={towelContext.roomId}
            roomNumber={towelContext.roomNumber}
            assignmentId={assignmentId}
          />
        </>
      )}
    </>
  );
}

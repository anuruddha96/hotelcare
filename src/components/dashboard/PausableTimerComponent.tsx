import React, { useState, useEffect } from 'react';
import { Clock, Pause } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

interface BreakPeriod {
  start: string;
  end?: string;
}

interface PausableTimerComponentProps {
  assignmentId: string;
  startedAt: string;
  userId: string;
}

export function PausableTimerComponent({ assignmentId, startedAt, userId }: PausableTimerComponentProps) {
  const [elapsed, setElapsed] = useState(0);
  const [breakPeriods, setBreakPeriods] = useState<BreakPeriod[]>([]);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [totalBreakTime, setTotalBreakTime] = useState(0);

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
      const totalElapsed = Math.floor((now - startTime) / 1000);
      
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
      <span className="text-[10px] text-muted-foreground">Work time (break excluded)</span>
    </div>
  );
}
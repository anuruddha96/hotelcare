import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

interface BreakTimerProps {
  breakType: string;
  startedAt: string;
  onComplete?: () => void;
}

export function BreakTimer({ breakType, startedAt, onComplete }: BreakTimerProps) {
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isOvertime, setIsOvertime] = useState(false);
  const [breakDuration, setBreakDuration] = useState(30); // default 30 minutes

  // Fetch break duration from database
  useEffect(() => {
    const fetchBreakDuration = async () => {
      const { data, error } = await supabase
        .from('break_types')
        .select('duration_minutes')
        .eq('name', breakType)
        .eq('is_active', true)
        .single();

      if (!error && data) {
        setBreakDuration(data.duration_minutes);
      }
    };

    fetchBreakDuration();
  }, [breakType]);

  useEffect(() => {
    const startTime = new Date(startedAt).getTime();
    
    const updateTimer = () => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTime) / 1000); // seconds elapsed
      const totalSeconds = breakDuration * 60; // convert to seconds
      const remaining = totalSeconds - elapsed;
      
      setTimeRemaining(remaining);
      setIsOvertime(remaining <= 0);
      
      if (remaining <= -300 && onComplete) { // 5 minutes overtime
        onComplete();
      }
    };

    // Update immediately
    updateTimer();
    
    // Then update every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [breakType, startedAt, onComplete, breakDuration]);

  const formatTime = (seconds: number) => {
    const absSeconds = Math.abs(seconds);
    const minutes = Math.floor(absSeconds / 60);
    const remainingSeconds = absSeconds % 60;
    
    const sign = seconds < 0 ? '-' : '';
    return `${sign}${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const getTimerColor = () => {
    if (isOvertime) return 'bg-red-500 text-white animate-pulse';
    if (timeRemaining <= 300) return 'bg-orange-500 text-white'; // 5 minutes left
    return 'bg-blue-500 text-white';
  };

  const getBreakTypeName = () => {
    return `${breakType.charAt(0).toUpperCase() + breakType.slice(1)} Break (${breakDuration} min)`;
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-3 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border-2 border-blue-200 shadow-sm">
      {/* Break Type Badge */}
      <Badge variant="outline" className="text-sm font-semibold bg-white border-blue-300 text-blue-700 px-3 py-1">
        {getBreakTypeName()}
      </Badge>
      
      {/* Timer Display */}
      <div className={`relative inline-flex items-center gap-3 px-6 py-4 rounded-2xl shadow-md ${getTimerColor()} transition-all duration-300`}>
        <Clock className="h-6 w-6" />
        <span className="font-mono text-3xl font-bold tracking-tight">
          {formatTime(timeRemaining)}
        </span>
      </div>
      
      {/* Status Messages */}
      {isOvertime && (
        <div className="flex items-center gap-2 bg-red-100 text-red-700 px-4 py-2 rounded-full animate-pulse">
          <span className="text-lg">⚠️</span>
          <span className="text-sm font-semibold">Break time exceeded</span>
        </div>
      )}
      {timeRemaining <= 300 && timeRemaining > 0 && (
        <div className="flex items-center gap-2 bg-orange-100 text-orange-700 px-4 py-2 rounded-full">
          <span className="text-lg">⏰</span>
          <span className="text-sm font-semibold">Break ending soon</span>
        </div>
      )}
    </div>
  );
}
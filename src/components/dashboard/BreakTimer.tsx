import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface BreakTimerProps {
  breakType: string;
  startedAt: string;
  onComplete?: () => void;
}

const BREAK_DURATIONS = {
  'short': 5, // 5 minutes
  'coffee': 10, // 10 minutes  
  'lunch': 30, // 30 minutes
};

export function BreakTimer({ breakType, startedAt, onComplete }: BreakTimerProps) {
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isOvertime, setIsOvertime] = useState(false);

  useEffect(() => {
    const startTime = new Date(startedAt).getTime();
    const duration = BREAK_DURATIONS[breakType as keyof typeof BREAK_DURATIONS] || 10;
    
    const updateTimer = () => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTime) / 1000); // seconds elapsed
      const totalSeconds = duration * 60; // convert to seconds
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
  }, [breakType, startedAt, onComplete]);

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
    switch (breakType) {
      case 'short': return 'Short Break (5 min)';
      case 'coffee': return 'Coffee Break (10 min)'; 
      case 'lunch': return 'Lunch Break (30 min)';
      default: return 'Break';
    }
  };

  return (
    <div className="text-center space-y-2">
      <Badge variant="outline" className="text-sm">
        {getBreakTypeName()}
      </Badge>
      <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${getTimerColor()}`}>
        <Clock className="h-4 w-4" />
        <span className="font-mono text-lg font-bold">
          {formatTime(timeRemaining)}
        </span>
      </div>
      {isOvertime && (
        <div className="text-xs text-red-600 font-medium">
          Break time exceeded
        </div>
      )}
      {timeRemaining <= 300 && timeRemaining > 0 && (
        <div className="text-xs text-orange-600 font-medium">
          Break ending soon
        </div>
      )}
    </div>
  );
}
import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface TimerComponentProps {
  startedAt: string;
}

export function TimerComponent({ startedAt }: TimerComponentProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startTime = new Date(startedAt).getTime();
    
    const updateElapsed = () => {
      const now = Date.now();
      const diff = now - startTime;
      setElapsed(Math.floor(diff / 1000)); // Convert to seconds
    };

    // Update immediately
    updateElapsed();
    
    // Then update every second
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [startedAt]);

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
    if (elapsed < 1800) return 'text-green-600'; // Under 30 minutes
    if (elapsed < 3600) return 'text-yellow-600'; // Under 1 hour
    return 'text-red-600'; // Over 1 hour
  };

  return (
    <Badge variant="outline" className={`${getTimerColor()} border-current`}>
      <Clock className="h-3 w-3 mr-1" />
      {formatTime(elapsed)}
    </Badge>
  );
}
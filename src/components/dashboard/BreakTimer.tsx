import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Clock, Volume2, VolumeX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  const [alarmMuted, setAlarmMuted] = useState(false);
  const [lastAlarmTime, setLastAlarmTime] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);

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

  // Play alarm sound using Web Audio API
  const playAlarmSound = useCallback(() => {
    if (alarmMuted) return;
    
    try {
      // Create audio context if not exists
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const ctx = audioContextRef.current;
      
      // Play a sequence of beeps
      const playBeep = (startTime: number, frequency: number, duration: number) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.5, startTime); // Louder
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        
        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
      };
      
      const now = ctx.currentTime;
      
      // Play 5 ascending beeps for more attention
      playBeep(now, 800, 0.15);
      playBeep(now + 0.2, 900, 0.15);
      playBeep(now + 0.4, 1000, 0.15);
      playBeep(now + 0.6, 1100, 0.15);
      playBeep(now + 0.8, 1200, 0.2);
      
      // Try to vibrate on mobile
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 200]);
      }
      
      // Show browser notification if permitted
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Break Ending!', {
          body: `Your ${breakType} break is about to end!`,
          icon: '/favicon.ico',
          tag: 'break-alarm',
          requireInteraction: true
        });
      }
      
    } catch (error) {
      console.error('Error playing alarm sound:', error);
    }
  }, [alarmMuted, breakType]);

  useEffect(() => {
    const startTime = new Date(startedAt).getTime();
    
    const updateTimer = () => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTime) / 1000); // seconds elapsed
      const totalSeconds = breakDuration * 60; // convert to seconds
      const remaining = totalSeconds - elapsed;
      
      setTimeRemaining(remaining);
      setIsOvertime(remaining <= 0);
      
      // Play alarm at 2 minutes remaining AND repeat every 30 seconds
      const shouldPlayAlarm = remaining <= 120 && remaining > -300; // Between 2 min left and 5 min overtime
      const timeSinceLastAlarm = now - lastAlarmTime;
      
      if (shouldPlayAlarm && timeSinceLastAlarm >= 30000) { // 30 seconds between alarms
        setLastAlarmTime(now);
        playAlarmSound();
      }
      
      if (remaining <= -300 && onComplete) { // 5 minutes overtime
        onComplete();
      }
    };

    // Update immediately
    updateTimer();
    
    // Then update every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [breakType, startedAt, onComplete, breakDuration, playAlarmSound, lastAlarmTime]);

  // Cleanup audio context on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const formatTime = (seconds: number) => {
    const absSeconds = Math.abs(seconds);
    const minutes = Math.floor(absSeconds / 60);
    const remainingSeconds = absSeconds % 60;
    
    const sign = seconds < 0 ? '-' : '';
    return `${sign}${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const getTimerColor = () => {
    if (isOvertime) return 'bg-red-500 text-white animate-pulse';
    if (timeRemaining <= 120) return 'bg-orange-500 text-white animate-pulse'; // 2 minutes left - pulse
    if (timeRemaining <= 300) return 'bg-yellow-500 text-white'; // 5 minutes left
    return 'bg-blue-500 text-white';
  };

  const getBreakTypeName = () => {
    return `${breakType.charAt(0).toUpperCase() + breakType.slice(1)} Break (${breakDuration} min)`;
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-3 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border-2 border-blue-200 shadow-sm">
      {/* Break Type Badge */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-sm font-semibold bg-white border-blue-300 text-blue-700 px-3 py-1">
          {getBreakTypeName()}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => setAlarmMuted(!alarmMuted)}
          title={alarmMuted ? 'Unmute alarm' : 'Mute alarm'}
        >
          {alarmMuted ? (
            <VolumeX className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Volume2 className="h-4 w-4 text-blue-600" />
          )}
        </Button>
      </div>
      
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
          <span className="text-sm font-semibold">Break time exceeded! Return to work.</span>
        </div>
      )}
      {timeRemaining <= 120 && timeRemaining > 0 && (
        <div className="flex items-center gap-2 bg-orange-100 text-orange-700 px-4 py-2 rounded-full animate-pulse">
          <span className="text-lg">🔔</span>
          <span className="text-sm font-semibold">Break ending in {Math.ceil(timeRemaining / 60)} min!</span>
        </div>
      )}
      {timeRemaining > 120 && timeRemaining <= 300 && (
        <div className="flex items-center gap-2 bg-yellow-100 text-yellow-700 px-4 py-2 rounded-full">
          <span className="text-lg">⏰</span>
          <span className="text-sm font-semibold">Break ending soon</span>
        </div>
      )}
    </div>
  );
}

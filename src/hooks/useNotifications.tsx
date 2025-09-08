import { useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { useTranslation } from './useTranslation';

export function useNotifications() {
  const { user } = useAuth();
  const { t } = useTranslation();

  // Create notification sound
  const playNotificationSound = useCallback(() => {
    try {
      // Create a simple notification sound using Web Audio API
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
      console.log('Notification sound not supported:', error);
    }
  }, []);

  // Show notification banner with sound
  const showNotification = useCallback((message: string, type: 'success' | 'info' | 'warning' = 'info') => {
    playNotificationSound();
    toast[type](message, {
      duration: 5000,
      position: 'top-right',
    });
  }, [playNotificationSound]);

  // Listen for new assignments (for housekeeping staff)
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('new-assignments-notification')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'room_assignments',
          filter: `assigned_to=eq.${user.id}`
        },
        (payload) => {
          showNotification(t('notifications.newAssignment'), 'info');
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, showNotification, t]);

  return {
    playNotificationSound,
    showNotification
  };
}

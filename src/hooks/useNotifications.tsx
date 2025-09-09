import { useEffect, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { useTranslation } from './useTranslation';

export function useNotifications() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');

  // Initialize notification permission status
  useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  // Request notification permission and save preference
  const requestNotificationPermission = useCallback(async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      
      if (user?.id && permission !== 'default') {
        // Save preference to database
        await supabase
          .from('notification_preferences')
          .upsert({
            user_id: user.id,
            browser_notifications_enabled: permission === 'granted'
          });
      }
      return permission === 'granted';
    }
    return Notification.permission === 'granted';
  }, [user?.id]);

  // Enhanced notification sound with multiple tones
  const playNotificationSound = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Create a more distinctive notification sound
      const createTone = (frequency: number, startTime: number, duration: number) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime + startTime);
        gainNode.gain.setValueAtTime(0.4, audioContext.currentTime + startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + startTime + duration);
        
        oscillator.start(audioContext.currentTime + startTime);
        oscillator.stop(audioContext.currentTime + startTime + duration);
      };

      // Create a sequence of tones for a more distinctive sound
      createTone(880, 0, 0.15);      // High note
      createTone(660, 0.15, 0.15);   // Medium note  
      createTone(880, 0.3, 0.2);     // High note again
      
    } catch (error) {
      console.log('Notification sound not supported:', error);
    }
  }, []);

  // Show browser notification
  const showBrowserNotification = useCallback(async (title: string, message: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification(title, {
        body: message,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'hotel-notification',
        requireInteraction: false
      });

      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000);
      
      return notification;
    }
    return null;
  }, []);

  // Enhanced notification with sound and browser notification
  const showNotification = useCallback(async (
    message: string, 
    type: 'success' | 'info' | 'warning' = 'info',
    title?: string
  ) => {
    // Play sound
    playNotificationSound();
    
    // Show toast
    toast[type](message, {
      duration: 5000,
      position: 'top-right',
    });

    // Show browser notification if permission granted
    if (title && notificationPermission === 'granted') {
      await showBrowserNotification(title, message);
    } else if (notificationPermission === 'default') {
      // Try to request permission on first notification
      const granted = await requestNotificationPermission();
      if (granted && title) {
        await showBrowserNotification(title, message);
      }
    }
  }, [playNotificationSound, showBrowserNotification, notificationPermission, requestNotificationPermission]);

  // Listen for new assignments and break requests
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('notifications-channel')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'room_assignments',
          filter: `assigned_to=eq.${user.id}`
        },
        (payload) => {
          showNotification(
            t('notifications.newAssignment'), 
            'info',
            t('notifications.newAssignmentTitle')
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'break_requests'
        },
        (payload) => {
          showNotification(
            t('notifications.newBreakRequest'),
            'info',
            t('notifications.newBreakRequestTitle')
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'break_requests',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          const newRecord = payload.new as any;
          if (newRecord.status === 'approved') {
            showNotification(
              t('notifications.breakRequestApproved'),
              'success',
              t('notifications.breakRequestTitle')
            );
          } else if (newRecord.status === 'rejected') {
            showNotification(
              t('notifications.breakRequestRejected'),
              'warning',
              t('notifications.breakRequestTitle')
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, showNotification, t]);

  return {
    playNotificationSound,
    showNotification,
    requestNotificationPermission,
    notificationPermission
  };
}

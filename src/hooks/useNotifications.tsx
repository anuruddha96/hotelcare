import { useEffect, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { useTranslation } from './useTranslation';
import { serviceWorkerManager } from '@/lib/serviceWorkerManager';

// Add CSS for flash animation
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes flash {
      0% { background-color: transparent; }
      50% { background-color: rgba(59, 130, 246, 0.1); }
      100% { background-color: transparent; }
    }
  `;
  document.head.appendChild(style);
}

// Shared AudioContext to unlock and reuse on iOS Safari
let sharedAudioContext: (AudioContext & { close?: () => Promise<void> }) | null = null;

export function useNotifications() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');

  // Initialize notification permission status and service worker
  useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }

    // Register service worker for persistent notifications
    serviceWorkerManager.register().then((registration) => {
      if (registration) {
        console.log('Service Worker registered for notifications');
      }
    });
  }, []);

  // Request notification permission with iOS Safari compatibility
  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      console.log('Browser does not support notifications');
      return false;
    }

    // Check current permission
    if (Notification.permission === 'granted') {
      return true;
    }
    
    if (Notification.permission === 'denied') {
      console.log('Notifications are blocked by user');
      return false;
    }
    
    try {
      // iOS Web Push works only when installed to Home Screen (standalone)
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (navigator as any).standalone === true;
      if (isIOS && !isStandalone) {
        // Inform user how to enable on iOS Safari
        toast.info(t('notifications.iosInstructions'));
        setNotificationPermission('default');
        return false;
      }

      // Request permission - must be triggered by user interaction on iOS
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
      
      if (permission === 'granted') {
        // Test notification to ensure it works
        const testNotification = new Notification('Notifications Enabled!', {
          body: 'You will now receive notifications for room assignments and approvals.',
          icon: '/favicon.ico',
          silent: false
        });
        setTimeout(() => testNotification.close(), 3000);
      }
      
      return permission === 'granted';
    } catch (error) {
      console.log('Error requesting notification permission:', error);
      return false;
    }
  }, [user?.id]);

  // Prepare audio on first user gesture for iOS Safari
  const ensureAudioUnlocked = useCallback(() => {
    try {
      if (!sharedAudioContext) {
        sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      // Resume context and play a near-silent blip to unlock
      sharedAudioContext.resume?.();
      const osc = sharedAudioContext.createOscillator();
      const gain = sharedAudioContext.createGain();
      gain.gain.value = 0.0001; // inaudible unlock blip
      osc.connect(gain);
      gain.connect(sharedAudioContext.destination);
      osc.start();
      setTimeout(() => {
        try { osc.stop(); } catch {}
      }, 50);
    } catch (e) {
      console.log('Audio unlock failed:', e);
    }
  }, []);

  // Enhanced iOS-compatible notification sound and vibration
  const playNotificationSound = useCallback(() => {
    try {
      // Vibration for mobile devices (works on iOS when website is added to home screen)
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 200]);
      }

      // Create audio element for iOS Safari compatibility
      const audio = new Audio();
      audio.preload = 'auto';
      
      // Create a data URL with beep sound for iOS compatibility
      const createBeepDataURL = () => {
        const sampleRate = 8000;
        const duration = 0.3;
        const samples = sampleRate * duration;
        const buffer = new ArrayBuffer(44 + samples * 2);
        const view = new DataView(buffer);
        
        // WAV header
        const writeString = (offset: number, string: string) => {
          for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
          }
        };
        
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + samples * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, samples * 2, true);
        
        // Generate beep sound
        for (let i = 0; i < samples; i++) {
          const sample = Math.sin(2 * Math.PI * 1000 * i / sampleRate) * 0.5;
          view.setInt16(44 + i * 2, sample * 32767, true);
        }
        
        return `data:audio/wav;base64,${btoa(String.fromCharCode(...new Uint8Array(buffer)))}`;
      };
      
      audio.src = createBeepDataURL();
      
      // iOS Safari requires user interaction, so play with error handling
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Fallback: try Web Audio API for desktop browsers
          try {
            if (!sharedAudioContext) {
              sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            }
            const audioContext = sharedAudioContext;
            // Try resuming (required on iOS)
            audioContext.resume?.();

            // Beep using Web Audio (more reliable on iOS once unlocked)
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(950, audioContext.currentTime);
            // Quick attack-decay envelope for attention
            gainNode.gain.setValueAtTime(0.001, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.3, audioContext.currentTime + 0.02);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.35);
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.4);
          } catch (webAudioError) {
            console.log('Web Audio not supported:', webAudioError);
          }
        });
      }
      
    } catch (error) {
      console.log('Notification sound not supported:', error);
    }
  }, []);

  // Show browser notification using Service Worker for persistence
  const showBrowserNotification = useCallback(async (title: string, message: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        // Use service worker for persistent notifications
        await serviceWorkerManager.sendNotification(title, message, {
          timestamp: Date.now(),
          url: window.location.href
        });
        
        return true;
      } catch (error) {
        console.error('Service Worker notification failed, using fallback:', error);
        
        // Fallback to regular notification
        const notification = new Notification(title, {
          body: message,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: 'hotel-notification',
          requireInteraction: true
        } as any);

        // Auto-close after 5 seconds
        setTimeout(() => notification.close(), 5000);
        
        return notification;
      }
    }
    return null;
  }, []);

  // Enhanced notification with sound, browser notification, and visual fallback
  const showNotification = useCallback(async (
    message: string, 
    type: 'success' | 'info' | 'warning' = 'info',
    title?: string
  ) => {
    // Play sound and vibration
    playNotificationSound();
    
    // Show toast notification
    toast[type](message, {
      duration: 5000,
      position: 'top-center',
      style: {
        background: type === 'warning' ? '#FED7AA' : type === 'success' ? '#D1FAE5' : '#DBEAFE',
        color: type === 'warning' ? '#9A3412' : type === 'success' ? '#065F46' : '#1E40AF',
        border: `2px solid ${type === 'warning' ? '#FB923C' : type === 'success' ? '#10B981' : '#3B82F6'}`,
        fontSize: '13px',
        fontWeight: '500',
        maxWidth: '90vw'
      }
    });

    // Try browser notification if permission granted
    if (title && notificationPermission === 'granted') {
      try {
        const notification = new Notification(title, {
          body: message,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: 'hotel-notification',
          requireInteraction: true,
          silent: false
        });

        // Handle notification click
        notification.onclick = () => {
          window.focus();
          notification.close();
        };

        // Auto-close after 8 seconds
        setTimeout(() => notification.close(), 8000);
      } catch (error) {
        console.log('Browser notification failed:', error);
      }
    } else if (notificationPermission === 'default' && title) {
      // Try to request permission on first notification
      try {
        const granted = await requestNotificationPermission();
        if (granted) {
          const notification = new Notification(title, {
            body: message,
            icon: '/favicon.ico',
            requireInteraction: true,
            silent: false
          });
        setTimeout(() => notification.close(), 5000);
      }
      } catch (error) {
        console.log('Failed to request notification permission:', error);
      }
    }

    // Dispatch custom event for visual notification fallback
    if (title) {
      window.dispatchEvent(new CustomEvent('visual-notification', {
        detail: { title, message, type }
      }));
    }
  }, [playNotificationSound, showBrowserNotification, notificationPermission, requestNotificationPermission]);

  // Listen for new assignments, break requests, and pending approvals
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
          event: 'UPDATE',
          schema: 'public',
          table: 'room_assignments',
          filter: 'status=eq.completed'
        },
        (payload) => {
          const newRecord = payload.new as any;
          const oldRecord = payload.old as any;
          
          // Notify managers/supervisors when a task is completed (new pending approval)
          if (oldRecord.status !== 'completed' && newRecord.status === 'completed' && 
              (user.role === 'manager' || user.role === 'housekeeping_manager' || user.role === 'admin')) {
            showNotification(
              t('notifications.newPendingApproval'),
              'warning',
              t('notifications.newPendingApprovalTitle')
            );
          }
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
  }, [user?.id, user?.role, showNotification, t]);

  return {
    playNotificationSound,
    showNotification,
    requestNotificationPermission,
    notificationPermission,
    ensureAudioUnlocked
  };
}

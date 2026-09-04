import { useEffect, useCallback, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { useTranslation } from './useTranslation';
import { serviceWorkerManager } from '@/lib/serviceWorkerManager';
import { resolveHotelKeys } from '@/lib/hotelKeys';

// Add CSS for flash animation (only once)
if (typeof document !== 'undefined' && !document.getElementById('notification-flash-style')) {
  const style = document.createElement('style');
  style.id = 'notification-flash-style';
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

// Track if service worker has been registered (singleton)
let serviceWorkerRegistered = false;

export function useNotifications() {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const initRef = useRef(false);

  // Initialize notification permission status and service worker (once)
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }

    // Register service worker only once across all hook instances
    if (!serviceWorkerRegistered) {
      serviceWorkerRegistered = true;
      serviceWorkerManager.register().then((registration) => {
        if (registration) {
          console.log('Service Worker registered for notifications');
        }
      });
    }
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
        // Mobile browsers (notably iOS PWAs) should use the Service Worker
        // notification API rather than the window Notification constructor.
        await serviceWorkerManager.sendNotification(
          'Hotel Care',
          'You will now receive notifications for room assignments and approvals.',
          { timestamp: Date.now(), url: window.location.href }
        );
      }

      return permission === 'granted';
    } catch (error) {
      console.log('Error requesting notification permission:', error);
      return false;
    }
  }, [user?.id, t]);

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

  // Enhanced iOS-compatible notification sound - rich two-tone chime
  const playNotificationSound = useCallback(() => {
    try {
      // Vibration for mobile devices
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 200]);
      }

      // Use Web Audio API for a rich two-tone chime
      try {
        if (!sharedAudioContext) {
          sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = sharedAudioContext;
        ctx.resume?.();

        const now = ctx.currentTime;

        // Create a rich two-tone chime (C5 + E5) with harmonics
        const playTone = (freq: number, startTime: number, duration: number, volume: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, startTime);
          gain.gain.setValueAtTime(0.001, startTime);
          gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + duration + 0.05);
        };

        // First chime: C5 (523Hz) + overtone
        playTone(523, now, 0.3, 0.15);
        playTone(1046, now, 0.2, 0.05); // octave overtone

        // Second chime: E5 (659Hz) + overtone, slightly delayed
        playTone(659, now + 0.15, 0.35, 0.12);
        playTone(1318, now + 0.15, 0.25, 0.04); // octave overtone

        // Soft third: G5 (784Hz) for a pleasant resolution
        playTone(784, now + 0.3, 0.3, 0.06);

      } catch (webAudioError) {
        console.log('Web Audio not supported:', webAudioError);
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
          url: window.location.href,
        });

        return true;
      } catch (error) {
        console.error('Service Worker notification failed, using fallback:', error);

        // Desktop fallback. Some mobile browsers do not allow this constructor.
        try {
          const notification = new Notification(title, {
            body: message,
            icon: '/icon-192.png',
            badge: '/icon-maskable-512.png',
            tag: 'hotel-notification',
          } as any);
          setTimeout(() => notification.close(), 5000);
          return notification;
        } catch (fallbackError) {
          console.log('Direct notification fallback failed:', fallbackError);
        }
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
      duration: 4000,
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

    // Always brand the title with "Hotel Care" prefix when sending OS-level notification
    const brandedTitle = title ? `Hotel Care · ${title}` : 'Hotel Care';

    // Use ServiceWorkerRegistration.showNotification for installed mobile apps/PWAs.
    if (title && notificationPermission === 'granted') {
      await showBrowserNotification(brandedTitle, message);
    } else if (notificationPermission === 'default' && title) {
      // This succeeds on desktop when the browser allows it. On iOS the user
      // must grant permission from the explicit notification banner/button.
      try {
        const granted = await requestNotificationPermission();
        if (granted) {
          await showBrowserNotification(brandedTitle, message);
        }
      } catch (error) {
        console.log('Failed to request notification permission:', error);
      }
    }

  }, [playNotificationSound, showBrowserNotification, notificationPermission, requestNotificationPermission]);

  // Listen for new assignments, break requests, and pending approvals.
  // Every manager-facing event is scoped to the ACTIVE property; RD Hotels
  // properties share one organization_slug so org-only filtering is not enough.
  useEffect(() => {
    if (!user?.id || !profile?.assigned_hotel) return;

    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setup = async () => {
      const resolvedKeys = await resolveHotelKeys(profile.assigned_hotel);
      const activeHotelKeys = resolvedKeys.length
        ? resolvedKeys
        : [profile.assigned_hotel];
      if (disposed) return;

      const isRoomInActiveHotel = async (roomId?: string | null): Promise<boolean> => {
        if (!roomId || activeHotelKeys.length === 0) return false;
        const { data: room, error } = await supabase
          .from('rooms')
          .select('hotel')
          .eq('id', roomId)
          .maybeSingle();
        if (error || !room?.hotel || disposed) return false;
        return activeHotelKeys.includes(room.hotel);
      };

      const isUserInActiveHotel = async (staffId?: string | null): Promise<boolean> => {
        if (!staffId) return false;
        const { data: staff, error } = await supabase
          .from('profiles')
          .select('assigned_hotel')
          .eq('id', staffId)
          .maybeSingle();
        if (error || !staff?.assigned_hotel || disposed) return false;
        const staffKeys = await resolveHotelKeys(staff.assigned_hotel);
        const comparable = staffKeys.length ? staffKeys : [staff.assigned_hotel];
        return comparable.some((key) => activeHotelKeys.includes(key));
      };

      const approvalRoles = new Set([
        'manager',
        'housekeeping_manager',
        'admin',
        'top_management',
        'top_management_manager',
        'supervisor',
      ]);

      channel = supabase
        .channel(`notifications-channel-${user.id}-${profile.assigned_hotel}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'room_assignments',
            filter: `assigned_to=eq.${user.id}`
          },
          async (payload) => {
            const newRecord = payload.new as any;
            if (!(await isRoomInActiveHotel(newRecord.room_id))) return;
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
          async (payload) => {
            const newRecord = payload.new as any;
            const oldRecord = payload.old as any;

            // Notify eligible supervisors only for a NEW completion belonging
            // to their currently selected/assigned hotel.
            if (
              oldRecord.status !== 'completed' &&
              newRecord.status === 'completed' &&
              !!profile?.role &&
              approvalRoles.has(profile.role) &&
              await isRoomInActiveHotel(newRecord.room_id)
            ) {
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
          async (payload) => {
            if (!approvalRoles.has(profile.role || '')) return;
            const newRecord = payload.new as any;
            const staffId = newRecord.user_id || newRecord.requested_by;
            if (!(await isUserInActiveHotel(staffId))) return;
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
    };

    void setup();

    return () => {
      disposed = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [user?.id, profile?.role, profile?.assigned_hotel, showNotification, t]);

  return {
    playNotificationSound,
    showNotification,
    requestNotificationPermission,
    notificationPermission,
    ensureAudioUnlocked
  };
}
